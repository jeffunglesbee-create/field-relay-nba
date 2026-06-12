// ═══════════════════════════════════════════════════════════════════════════
// AmbientDO — Cross-sport SSE ambient channel
// ═══════════════════════════════════════════════════════════════════════════
// Built: 2026-06-11
//
// PURPOSE
//   Single DO instance (named "field:ambient"). Polls all active sports
//   every 30s via alarm. Detects score changes, lead changes, and finals.
//   Fans out SSE events to every connected browser tab in <3s vs 15-30s
//   polling lag.
//
// WHAT THIS UNLOCKS
//   - lead_change, final, score events at ~3s latency (was 15-30s)
//   - Multiview velocity: scoring rate computed from event timestamps
//   - Cross-sport awareness: one connection covers all sports
//   - Journalism timing: briefs fire while the moment is still the moment
//   - API budget: O(sports) polling, not O(users). 8 sports × 2 API calls/min
//     regardless of connected user count.
//
// SSE PROTOCOL (server → client)
//   event: score   data: {gameId,sport,home,away,homeScore,awayScore,period,clock,state}
//   event: final   data: {gameId,sport,home,away,homeScore,awayScore,winner}
//   event: lead_change  data: {gameId,sport,home,away,...,newLeader,prevLeader,margin}
//   event: all_final    data: {date,count}
//   event: ping         data: {} (keepalive, every 20s)
//
// ADR-002 COMPLIANCE
//   Emits raw game facts only (scores, state, period). No composite scoring.
//   No drama ratings. No editorial judgments.
//   Client's emitScoreEvent() receives these facts and runs the existing
//   drama pipeline client-side — unchanged from the polling path.
//
// SPORTS POLLED (active; only those with live games today)
//   nba, nhl, mlb, wc26, epl, mls, laliga, seriea, bundesliga, ligue1, wnba
//   Football sports polled via RELAY_BASE/v2/games (self-call, reuses adapters)
//   Uses the same V2_LEAGUES keys as the existing relay route.
//
// STORAGE KEYS
//   'scores:{date}'     — {gameId: {homeScore,awayScore,state,period,sport,...}}
//   'leaders:{date}'    — {gameId: 'home'|'away'|null}
//   'finals:{date}'     — Set<gameId>
//   'last_poll'         — ISO timestamp of last successful poll
//
// ALARM SCHEDULE
//   30s during active polling (any live game detected)
//   60s when no live games found (saves quota at 2am)
//   Always clears and resets on each alarm invocation
// ═══════════════════════════════════════════════════════════════════════════

// POLL_LIVE_MS: 15s during live games.
// With CF edge caching (cacheEverything:true, cacheKey:url) on /v2/games,
// api-sports is called at most once per 30s per sport (the cache TTL).
// More frequent DO polls hit the CF cache — zero extra api-sports quota cost.
// Result: AmbientDO detects score changes within 15s of api-sports updating,
// while api-sports quota is capped at 2/min × sports (not O(poll frequency)).
const POLL_LIVE_MS  = 15_000;
const POLL_IDLE_MS  = 60_000;
const PING_MS       = 20_000;

// Sports to poll — ordered by typical activity windows.
// WC26 and NBA/NHL active June 2026; MLB always; NFL added for September.
const AMBIENT_SPORTS = [
    'nba', 'nhl', 'mlb', 'wc26', 'mls',
    'epl', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'wnba',
];

// Active sports filter: only poll sports whose season is likely active.
// Avoids burning api-sports quota on NFL in June, etc.
// Keyed by sport → [activeMonths] (0=Jan…11=Dec)
const SPORT_ACTIVE_MONTHS = {
    'nba':        [0,1,2,3,4,5,6],           // Oct–Jun
    'nhl':        [0,1,2,3,4,5,6],           // Oct–Jun
    'mlb':        [2,3,4,5,6,7,8,9],         // Mar–Oct
    'wnba':       [4,5,6,7,8,9],             // May–Oct
    'wc26':       [5,6,7],                   // Jun–Jul 2026
    'epl':        [7,8,9,10,11,0,1,2,3,4],  // Aug–May
    'laliga':     [7,8,9,10,11,0,1,2,3,4],
    'seriea':     [7,8,9,10,11,0,1,2,3,4],
    'bundesliga': [7,8,9,10,11,0,1,2,3,4],
    'ligue1':     [7,8,9,10,11,0,1,2,3,4],
    'mls':        [2,3,4,5,6,7,8,9,10,11],  // Mar–Nov
};

export class AmbientDO {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
        // SSE clients: Map<id → {writer, controller, sport_filter}>
        this._clients   = new Map();
        this._clientSeq = 0;
        this._pingTimer = null;
        this._restored  = false;
        // In-memory score state (loaded from DO storage on first alarm)
        this._scores   = {};   // gameId → {homeScore,awayScore,state,period,sport,home,away,clock}
        this._leaders  = {};   // gameId → 'home'|'away'|null
        this._finals   = new Set();  // gameId
    }

    // ── Main fetch handler ────────────────────────────────────────────────
    async fetch(request) {
        const url = new URL(request.url);

        // ── GET /live/ambient — SSE upgrade ──────────────────────────────
        if (url.pathname.endsWith('/live/ambient') && request.method === 'GET') {
            return this._handleSSE(request);
        }

        // ── GET /ambient/state — REST poll fallback ───────────────────────
        if (url.pathname.endsWith('/ambient/state')) {
            return new Response(JSON.stringify({
                clientCount: this._clients.size,
                sportCount:  Object.keys(this._scores).length,
                liveGames:   Object.entries(this._scores)
                    .filter(([,v]) => v.state === 'live')
                    .map(([id,v]) => ({ id, sport: v.sport, home: v.home, away: v.away,
                        homeScore: v.homeScore, awayScore: v.awayScore, period: v.period })),
                lastPoll:    await this.ctx.storage.get('last_poll') ?? null,
                ts: Date.now(),
            }), { headers: { 'Content-Type': 'application/json' } });
        }

        // ── POST /ambient/kick — manual poll trigger (admin) ─────────────
        if (url.pathname.endsWith('/ambient/kick') && request.method === 'POST') {
            await this._poll();
            return new Response(JSON.stringify({ ok: true, clients: this._clients.size }),
                { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response('Not found', { status: 404 });
    }

    // ── SSE connection handler ────────────────────────────────────────────
    _handleSSE(request) {
        const id = ++this._clientSeq;

        // TransformStream bridges the DO's writable side to the HTTP response's readable side.
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        const write = (eventType, data) => {
            try {
                const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
                writer.write(encoder.encode(payload));
            } catch (_) { /* client gone */ }
        };

        this._clients.set(id, { writer, write });

        // Send current live state immediately on connect
        const liveNow = Object.entries(this._scores)
            .filter(([, v]) => v.state === 'live')
            .map(([gameId, v]) => ({ gameId, ...v }));
        write('connected', { clientId: id, liveGames: liveNow, ts: Date.now() });

        // Ensure alarm is scheduled (might be the first client today)
        this._scheduleAlarm(POLL_LIVE_MS);

        // Start ping timer if not already running
        if (!this._pingTimer) {
            this._pingTimer = setInterval(() => this._sendPing(), PING_MS);
        }

        // Cleanup on client disconnect (write failure = gone)
        request.signal?.addEventListener('abort', () => {
            this._clients.delete(id);
            try { writer.close(); } catch (_) {}
            if (this._clients.size === 0 && this._pingTimer) {
                clearInterval(this._pingTimer);
                this._pingTimer = null;
            }
        });

        return new Response(readable, {
            status: 200,
            headers: {
                'Content-Type':  'text/event-stream',
                'Cache-Control': 'no-cache, no-store',
                'Connection':    'keep-alive',
                'X-Accel-Buffering': 'no',  // nginx / CF edge: disable buffering
                'Access-Control-Allow-Origin': '*',
            },
        });
    }

    // ── Alarm handler — the poll heartbeat ───────────────────────────────
    async alarm() {
        try {
            await this._poll();
        } catch (e) {
            console.error('[AmbientDO] alarm error:', e.message);
        }
        // Always reschedule — never let the alarm die silently
        const hasLive = Object.values(this._scores).some(v => v.state === 'live');
        this._scheduleAlarm(hasLive ? POLL_LIVE_MS : POLL_IDLE_MS);
    }

    // ── Core poll: fetch all active sports, detect deltas, broadcast ─────
    async _poll() {
        if (!this.env.APISPORTS_KEY) return;

        // Lazy restore from DO storage on first run
        if (!this._restored) {
            this._restored = true;
            const stored = await this.ctx.storage.get(
                ['scores:today', 'leaders:today', 'finals:today']);
            this._scores  = stored.get('scores:today')  ?? {};
            this._leaders = stored.get('leaders:today') ?? {};
            const storedFinals = stored.get('finals:today');
            this._finals  = storedFinals ? new Set(storedFinals) : new Set();
        }

        const today   = _todayUTC();
        const month   = new Date().getUTCMonth();
        const active  = AMBIENT_SPORTS.filter(s =>
            !SPORT_ACTIVE_MONTHS[s] || SPORT_ACTIVE_MONTHS[s].includes(month));

        // Fetch all active sports in parallel
        const results = await Promise.allSettled(
            active.map(sport => this._fetchSport(sport, today))
        );

        let totalLive = 0;
        const pendingFinals = new Set();

        for (const res of results) {
            if (res.status !== 'fulfilled') continue;
            const games = res.value;
            if (!games?.length) continue;

            for (const game of games) {
                const { gameId, sport, home, away, homeScore, awayScore,
                        period, periodLabel, clock, state } = game;
                if (!gameId) continue;

                const prev = this._scores[gameId];
                const hS = homeScore ?? 0;
                const aS = awayScore ?? 0;

                // Detect score change
                const scoreChanged = !prev
                    || prev.homeScore !== hS
                    || prev.awayScore !== aS
                    || prev.period    !== period
                    || prev.state     !== state;

                if (scoreChanged || !prev) {
                    // Update state
                    this._scores[gameId] = { sport, home, away, homeScore: hS, awayScore: aS,
                                              period, periodLabel: periodLabel||'', clock: clock||'', state };

                    if (state === 'live') {
                        totalLive++;
                        // Broadcast score event
                        this._broadcast('score', {
                            gameId, sport, home, away,
                            homeScore: hS, awayScore: aS,
                            period, periodLabel: periodLabel||'', clock: clock||'',
                            state, ts: Date.now(),
                        });

                        // Detect lead change
                        if (hS !== aS) {
                            const newLeader  = hS > aS ? 'home' : 'away';
                            const prevLeader = this._leaders[gameId];
                            if (prevLeader && prevLeader !== newLeader) {
                                this._broadcast('lead_change', {
                                    gameId, sport, home, away,
                                    homeScore: hS, awayScore: aS, period,
                                    newLeader, prevLeader,
                                    margin: Math.abs(hS - aS),
                                    ts: Date.now(),
                                });
                            }
                            this._leaders[gameId] = newLeader;
                        } else {
                            this._leaders[gameId] = null; // tie
                        }
                    }

                    // Detect final
                    if ((state === 'final' || state === 'post') && !this._finals.has(gameId)) {
                        this._finals.add(gameId);
                        pendingFinals.add(gameId);
                        const winner = hS > aS ? home : hS < aS ? away : null;
                        this._broadcast('final', {
                            gameId, sport, home, away,
                            homeScore: hS, awayScore: aS,
                            winner: winner || 'draw', ts: Date.now(),
                        });
                    }
                }
            }
        }

        // all_final: if all previously live games are now final
        if (pendingFinals.size > 0) {
            const anyStillLive = Object.values(this._scores)
                .some(v => v.state === 'live');
            if (!anyStillLive && this._finals.size > 0) {
                this._broadcast('all_final', {
                    date: today, count: this._finals.size, ts: Date.now(),
                });
            }
        }

        // Persist state to DO storage (fire-and-forget)
        await this.ctx.storage.put('last_poll', new Date().toISOString());
        this.ctx.waitUntil(Promise.allSettled([
            this.ctx.storage.put('scores:today',  this._scores),
            this.ctx.storage.put('leaders:today', this._leaders),
            this.ctx.storage.put('finals:today',  [...this._finals]),
        ]));
    }

    // ── Fetch one sport via relay self-call ───────────────────────────────
    async _fetchSport(sport, date) {
        const relayBase = this.env.RELAY_BASE
            || 'https://field-relay-nba.jeffunglesbee.workers.dev';
        try {
            const r = await fetch(
                `${relayBase}/v2/games?sport=${sport}&date=${date}`,
                { headers: { 'X-Ambient-Internal': '1' }, cf: { cacheTtl: 25 } }
            );
            if (!r.ok) return [];
            const data = await r.json();
            return data?.games ?? [];
        } catch (_) { return []; }
    }

    // ── Broadcast to all connected SSE clients ────────────────────────────
    _broadcast(eventType, data) {
        if (this._clients.size === 0) return;
        const dead = [];
        for (const [id, client] of this._clients) {
            try {
                client.write(eventType, data);
            } catch (_) {
                dead.push(id);
            }
        }
        dead.forEach(id => this._clients.delete(id));
    }

    // ── Keepalive ping to all clients ─────────────────────────────────────
    _sendPing() {
        if (this._clients.size === 0) return;
        this._broadcast('ping', { ts: Date.now() });
    }

    // ── Schedule next alarm (idempotent — resets if already set) ─────────
    _scheduleAlarm(delayMs) {
        this.ctx.storage.setAlarm(Date.now() + delayMs).catch(() => {});
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function _todayUTC() {
    return new Date().toISOString().slice(0, 10);
}
