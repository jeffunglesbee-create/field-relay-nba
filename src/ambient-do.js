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

// ── Live In-Play Odds Constants ──────────────────────────────────────────────
// Maps FIELD sport key → Odds API v4 sport key for live in-play endpoint.
// Only sports with Odds API live coverage are listed.
const ODDS_SPORT_KEYS = {
    'nba':        'basketball_nba',
    'nhl':        'icehockey_nhl',
    'mlb':        'baseball_mlb',
    'wnba':       'basketball_wnba',
    'wc26':       'soccer_fifa_world_cup',
    'epl':        'soccer_epl',
    'mls':        'soccer_usa_mls',
    'laliga':     'soccer_spain_la_liga',
    'seriea':     'soccer_italy_serie_a',
    'bundesliga': 'soccer_germany_bundesliga',
    'ligue1':     'soccer_france_ligue_one',
};

// Priority tiers: cooldown between odds fetches per game.
// High = more frequent polling (postseason/knockout).
// Spec Gap 6: date-based postseason windows + sport tier defaults.
const ODDS_PRIORITY = {
    high:   30_000,   // WC knockout, NBA Finals, Stanley Cup Finals — 30s
    medium: 60_000,   // Regular season NBA/NHL/MLB/EPL — 60s
    low:    180_000,  // MLS/WNBA/minor leagues — 180s
};

// Soccer sports: BLEND odds-derived WP with Dixon-Coles model.
// Non-soccer: REPLACE (implied odds ARE the WP directly).
const SOCCER_SPORTS = new Set(['wc26','epl','mls','laliga','seriea','bundesliga','ligue1']);

// WP broadcast threshold: only emit wp_update when |delta| >= this value
const WP_DELTA_THRESHOLD = 0.02;

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
        // Live odds WP state (Spec Gap 8: AmbientDO owns WP, not GameDO)
        this._wpState  = {};   // gameId → {homeWP,awayWP,drawWP,prevHomeWP,source,confidence,bookmakerCount,ts}
        this._wpPeaks  = {};   // gameId → peakWP (highest favored-team WP seen)
        this._oddsLastFetch = {};  // sport → timestamp of last Odds API call (cooldown enforcement)
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
                        homeScore: v.homeScore, awayScore: v.awayScore, period: v.period,
                        wp: this._wpState[id] || null })),
                lastPoll:    await this.ctx.storage.get('last_poll') ?? null,
                ts: Date.now(),
            }), { headers: { 'Content-Type': 'application/json' } });
        }

        // ── GET /live-wp/test — deployment verification for live odds ─────
        // Returns odds fetch status, WP state, peak tracking, cooldown timers.
        if (url.pathname.endsWith('/live-wp/test')) {
            const liveGames = Object.entries(this._scores).filter(([,v]) => v.state === 'live');
            const wpEntries = Object.entries(this._wpState);
            return new Response(JSON.stringify({
                ok: true,
                oddsApiConfigured: !!(this.env.ODDS_API_KEY),
                liveGameCount: liveGames.length,
                wpTrackedCount: wpEntries.length,
                wpState: Object.fromEntries(wpEntries.map(([id, wp]) => [id, {
                    homeWP: wp.homeWP, awayWP: wp.awayWP, drawWP: wp.drawWP,
                    confidence: wp.confidence, bookmakerCount: wp.bookmakerCount,
                    peakWP: this._wpPeaks[id] ?? null,
                    peakCollapse: this._wpPeaks[id] ? +(this._wpPeaks[id] - Math.max(wp.homeWP, wp.awayWP)).toFixed(3) : 0,
                }])),
                cooldowns: Object.fromEntries(Object.entries(this._oddsLastFetch)
                    .map(([s, ts]) => [s, { lastFetchMs: Date.now() - ts, lastFetchISO: new Date(ts).toISOString() }])),
                sportMappings: ODDS_SPORT_KEYS,
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
                ['scores:today', 'leaders:today', 'finals:today', 'wp:today']);
            this._scores  = stored.get('scores:today')  ?? {};
            this._leaders = stored.get('leaders:today') ?? {};
            const storedFinals = stored.get('finals:today');
            this._finals  = storedFinals ? new Set(storedFinals) : new Set();
            this._wpState = stored.get('wp:today') ?? {};
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
        // Games that just transitioned pre→live this poll cycle. Closing-
        // odds capture runs once per game after the per-game loop (so we
        // don't block scoring fan-out on an Odds-API round-trip).
        const pendingStarts = [];

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

                // Detect pre→live transition (kickoff / first pitch). Fires
                // exactly once per game per DO instance lifetime — `_gameStarts`
                // dedups across consecutive poll cycles where the game stays
                // live. Capture runs after the loop so scoring fan-out isn't
                // blocked on an Odds-API round-trip.
                const prevState = prev?.state || 'pre';
                const isNewLive = (state === 'live' || state === 'in')
                    && prevState !== 'live' && prevState !== 'in';
                if (isNewLive) {
                    if (!this._gameStarts) this._gameStarts = new Set();
                    if (!this._gameStarts.has(gameId)) {
                        this._gameStarts.add(gameId);
                        pendingStarts.push({ gameId, sport, home, away });
                    }
                }

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

                        // Forward WC live scores to BracketDO so it can
                        // recompute projections provisionally before the
                        // game goes final. Fire-and-forget so a slow or
                        // failed BracketDO never blocks the SSE poll loop.
                        if (sport === 'wc26' && this.env?.BRACKET_DO) {
                            try {
                                const bracketStub = this.env.BRACKET_DO.get(
                                    this.env.BRACKET_DO.idFromName('wc2026')
                                );
                                this.ctx.waitUntil(bracketStub.fetch('https://bracket-do/bracket/live-score', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        gameId, home, away,
                                        homeScore: hS, awayScore: aS,
                                        group: game.round || '',
                                        minute: clock || '',
                                        isLive: true,
                                    }),
                                }).catch(e => console.warn('[AmbientDO] bracket bridge:', e.message)));
                            } catch (_) { /* BRACKET_DO unbound — silent */ }
                        }

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

        // ── Closing-odds capture on pre→live transitions ────────────────
        // Each game gets its closing odds snapshotted at the moment it
        // goes live (closing odds disappear from The Odds API within
        // minutes of kickoff/first-pitch). Fire-and-forget per game so
        // a single Odds-API failure doesn't cascade across the slate.
        if (pendingStarts.length > 0 && this.env.ODDS_API_KEY) {
            for (const start of pendingStarts) {
                try { await this._captureClosingOdds(start); }
                catch (e) { console.warn('[AmbientDO] closing odds capture failed:', e.message); }
            }
        }

        // ── Live in-play odds → WP (Spec Steps 3-5) ─────────────────────
        // Only fetch when live games exist and Odds API key is configured.
        // AmbientDO-gated: saves 95% credits vs time-based polling.
        if (totalLive > 0 && this.env.ODDS_API_KEY) {
            try { await this._fetchLiveOdds(); } catch (e) {
                console.error('[AmbientDO] live odds error:', e.message);
            }
        }

        // Persist state to DO storage (fire-and-forget)
        await this.ctx.storage.put('last_poll', new Date().toISOString());
        this.ctx.waitUntil(Promise.allSettled([
            this.ctx.storage.put('scores:today',  this._scores),
            this.ctx.storage.put('leaders:today', this._leaders),
            this.ctx.storage.put('finals:today',  [...this._finals]),
            this.ctx.storage.put('wp:today',      this._wpState),
        ]));
    }

    // ── Live in-play odds → WP conversion ──────────────────────────────
    // Polls Odds API v4 /odds-live for each sport with live games.
    // Enforces per-sport cooldown (priority tier). Converts implied odds → WP.
    // Broadcasts wp_update SSE events when |delta| >= WP_DELTA_THRESHOLD.
    // Spec Gaps 2-8 implementation.
    async _fetchLiveOdds() {
        const apiKey = this.env.ODDS_API_KEY;
        if (!apiKey) return;

        // Group live games by sport
        const liveBySport = {};
        for (const [gameId, info] of Object.entries(this._scores)) {
            if (info.state !== 'live') continue;
            const sport = info.sport;
            if (!ODDS_SPORT_KEYS[sport]) continue;
            (liveBySport[sport] = liveBySport[sport] || []).push({ gameId, ...info });
        }

        const now = Date.now();
        await Promise.allSettled(Object.entries(liveBySport).map(async ([sport, games]) => {
            // Cooldown check (priority-tier gated)
            const cooldown = _getOddsCooldown(sport);
            const lastFetch = this._oddsLastFetch[sport] || 0;
            if (now - lastFetch < cooldown) return;
            this._oddsLastFetch[sport] = now;

            const oddsSportKey = ODDS_SPORT_KEYS[sport];
            // Cross-cutting monthly credit guard (KV-backed via
            // FIELD_JOURNALISM). Hard floor at ODDS_HARD_LIMIT credits/month.
            // Mirrors src/index.js consumeOddsCredit() — same KV key scheme.
            // Aborts the fetch when the limit is reached, leaving the sport's
            // _oddsLastFetch updated so we don't loop on this sport.
            if (!(await _consumeAmbientOddsCredit(this.env, 1))) return;
            // F3 fallback: WC-only, 180s minimum cooldown. If the primary key
            // returns 401/429 and env.ODDS_API_KEY_FALLBACK is set, retry once
            // with the fallback (Starter tier, 500 credits/month). Other
            // sports are NOT eligible — the fallback budget is reserved for
            // the WC live path that drives the on-screen WP bars.
            const useFallback = sport === 'wc26' && this.env.ODDS_API_KEY_FALLBACK;
            // Enforce 180s minimum cooldown when on the fallback path.
            if (useFallback) {
                const fbLastKey = `fb:${sport}`;
                const fbLast = this._oddsLastFetch[fbLastKey] || 0;
                if (now - fbLast < 180_000) {
                    // Mark sport cooldown so we don't loop while throttled.
                    // Will get a chance next medium-tier interval.
                }
            }
            const buildUrl = (k) =>
                `https://api.the-odds-api.com/v4/sports/${oddsSportKey}/odds-live?apiKey=${k}&regions=us,eu&markets=h2h&oddsFormat=decimal`;
            const cfInit = { cf: { cacheTtl: 60, cacheEverything: true } };
            try {
                // Cache TTL aligned to the medium-tier cooldown floor (60 s)
                // — cache hits when cooldown unblocks.
                let r = await fetch(buildUrl(apiKey), cfInit);
                if (!r.ok && (r.status === 401 || r.status === 429) && useFallback) {
                    // Warn-once-per-day log of fallback engagement.
                    try {
                        const day = new Date().toISOString().slice(0, 10);
                        const flag = `odds:fallback:logged:${day}`;
                        const already = await this.env.FIELD_JOURNALISM.get(flag);
                        if (!already) {
                            console.warn(`[ambient-odds-fallback] primary ${r.status}; switching to ODDS_API_KEY_FALLBACK for WC live`);
                            await this.env.FIELD_JOURNALISM.put(flag, '1', { expirationTtl: 86400 });
                        }
                    } catch (_) { /* logging best-effort */ }
                    r = await fetch(buildUrl(this.env.ODDS_API_KEY_FALLBACK), cfInit);
                    this._oddsLastFetch[`fb:${sport}`] = now;
                }
                if (!r.ok) return;
                const oddsGames = await r.json();
                if (!Array.isArray(oddsGames)) return;

                for (const og of oddsGames) {
                    // Match Odds API game → FIELD game by team names
                    const matched = games.find(g =>
                        (_teamMatch(og.home_team, g.home) && _teamMatch(og.away_team, g.away)) ||
                        (_teamMatch(og.home_team, g.away) && _teamMatch(og.away_team, g.home))
                    );
                    if (!matched) continue;

                    // Average h2h odds across all bookmakers (Spec Gap 4)
                    const h2h = { home: 0, away: 0, draw: 0, n: 0 };
                    for (const bm of (og.bookmakers || [])) {
                        const mkt = (bm.markets || []).find(m => m.key === 'h2h');
                        if (!mkt) continue;
                        const hO = mkt.outcomes.find(o => o.name === og.home_team);
                        const aO = mkt.outcomes.find(o => o.name === og.away_team);
                        const dO = mkt.outcomes.find(o => o.name === 'Draw');
                        if (hO && aO) {
                            h2h.home += 1 / hO.price;
                            h2h.away += 1 / aO.price;
                            if (dO) h2h.draw += 1 / dO.price;
                            h2h.n++;
                        }
                    }
                    if (h2h.n === 0) continue;

                    // Remove vig: normalize implied probabilities to sum to 1
                    const rH = h2h.home / h2h.n;
                    const rA = h2h.away / h2h.n;
                    const rD = h2h.draw / h2h.n;
                    const vigSum = rH + rA + rD;
                    if (vigSum <= 0) continue;

                    let homeWP = +(rH / vigSum).toFixed(3);
                    let awayWP = +(rA / vigSum).toFixed(3);
                    let drawWP = SOCCER_SPORTS.has(sport) ? +(rD / vigSum).toFixed(3) : 0;

                    // Non-soccer: draw odds fold into home/away (2-way market)
                    if (!SOCCER_SPORTS.has(sport) && drawWP > 0) {
                        const twoWay = homeWP + awayWP;
                        if (twoWay > 0) {
                            homeWP = +(homeWP / twoWay).toFixed(3);
                            awayWP = +(awayWP / twoWay).toFixed(3);
                            drawWP = 0;
                        }
                    }

                    // Confidence flag (Spec Gap 4): max bookmaker deviation
                    let maxDev = 0;
                    for (const bm of (og.bookmakers || [])) {
                        const mkt = (bm.markets || []).find(m => m.key === 'h2h');
                        if (!mkt) continue;
                        const hO = mkt.outcomes.find(o => o.name === og.home_team);
                        if (hO) {
                            const bmWP = (1 / hO.price) / vigSum;
                            maxDev = Math.max(maxDev, Math.abs(bmWP - homeWP));
                        }
                    }
                    const confidence = maxDev > 0.10 ? 'low' : 'normal';

                    // Handle home/away flip if Odds API has teams swapped
                    const flipped = _teamMatch(og.home_team, matched.away);
                    if (flipped) [homeWP, awayWP] = [awayWP, homeWP];

                    // Check delta against previous WP
                    const prev = this._wpState[matched.gameId];
                    const prevHomeWP = prev?.homeWP ?? null;
                    const wpDelta = prevHomeWP !== null ? +(homeWP - prevHomeWP).toFixed(3) : 0;

                    // Update WP state
                    this._wpState[matched.gameId] = {
                        homeWP, awayWP, drawWP,
                        prevHomeWP: prevHomeWP ?? homeWP,
                        source: 'odds-api',
                        confidence,
                        bookmakerCount: h2h.n,
                        ts: now,
                    };

                    // Peak tracking (Spec comeback detection)
                    const favWP = Math.max(homeWP, awayWP);
                    const prevPeak = this._wpPeaks[matched.gameId] ?? 0;
                    if (favWP > prevPeak) this._wpPeaks[matched.gameId] = favWP;
                    const peakWP = this._wpPeaks[matched.gameId];
                    const peakCollapse = +(peakWP - favWP).toFixed(3);

                    // Urgency computation (Spec formula)
                    const closeness = +(1 - Math.abs(homeWP - 0.5)).toFixed(3);
                    const lateness  = _estimateLateness(sport, matched.period);
                    const recentDelta = Math.abs(wpDelta);
                    const urgency = +(peakCollapse * 4 + recentDelta * 3 + closeness * 2 + lateness * 1).toFixed(2);

                    // Broadcast wp_update if delta exceeds threshold or first WP
                    if (prevHomeWP === null || Math.abs(wpDelta) >= WP_DELTA_THRESHOLD) {
                        this._broadcast('wp_update', {
                            gameId: matched.gameId, sport,
                            home: matched.home, away: matched.away,
                            homeWP, awayWP, drawWP,
                            wpDelta, peakCollapse, peakWP,
                            urgency, source: 'odds-api', confidence,
                            bookmakerCount: h2h.n,
                            ts: now,
                        });
                    }
                }
            } catch (e) {
                console.warn(`[AmbientDO] odds fetch ${sport}:`, e.message);
            }
        }));
    }

    // ── Closing-odds capture on pre→live transition ──────────────────────
    // Fetches current-market odds at the moment a game goes live, then
    // UPDATEs both archive tables WHERE closing_odds IS NULL. Writes one
    // change_log row per UPDATE so the Brief Freshness Guard (commit
    // e24dde9) can detect closing-line shifts after publication.
    //
    // Daily budget cap: 30 captures/day (~1% of the 2700 Odds-API daily
    // ceiling). Counter resets at UTC midnight via `_closingOddsDate`.
    //
    // ARCHIVE_DB binding is inherited from the parent Worker — Cloudflare
    // DOs share env, no per-DO wrangler declaration needed.
    async _captureClosingOdds({ gameId, sport, home, away }) {
        const oddsKey = ODDS_SPORT_KEYS[sport];
        if (!oddsKey) return; // sport not covered by Odds API
        const apiKey = this.env.ODDS_API_KEY;
        if (!apiKey) return;

        // Daily cap (Rule 78 / API-COST-A).
        const today = new Date().toISOString().slice(0, 10);
        if (this._closingOddsDate !== today) {
            this._closingOddsDate = today;
            this._closingOddsToday = 0;
        }
        if ((this._closingOddsToday || 0) >= 30) {
            console.warn('[closing-odds] daily cap reached (30)');
            return;
        }
        this._closingOddsToday = (this._closingOddsToday || 0) + 1;

        const url = `https://api.the-odds-api.com/v4/sports/${oddsKey}/odds`
            + `?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals`
            + `&oddsFormat=american`;
        let events;
        try {
            const r = await fetch(url, {
                headers: { 'User-Agent': 'FIELD-relay/2026' },
                cf: { cacheTtl: 0 },
            });
            if (!r.ok) {
                console.warn(`[closing-odds] fetch ${r.status} for ${sport}`);
                return;
            }
            events = await r.json();
        } catch (e) {
            console.warn(`[closing-odds] fetch error for ${sport}: ${e.message}`);
            return;
        }
        if (!Array.isArray(events)) return;

        // Bidirectional substring match on NFD-normalised alphanumerics —
        // tolerant of "Türkiye" vs "Turkey", "DR Congo" vs "Congo DR",
        // "Czech Republic" vs "Czechia". Same pattern as the client's
        // _wcMatchTeamName helper.
        const norm = s => (s || '').toLowerCase().normalize('NFD')
            .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
        const nH = norm(home), nA = norm(away);
        const event = events.find(e => {
            const eh = norm(e.home_team), ea = norm(e.away_team);
            return (eh.includes(nH) || nH.includes(eh))
                && (ea.includes(nA) || nA.includes(ea));
        });
        if (!event?.bookmakers?.length) return;

        const bk = event.bookmakers[0];
        const ml = bk.markets?.find(m => m.key === 'h2h');
        const sp = bk.markets?.find(m => m.key === 'spreads');
        const to = bk.markets?.find(m => m.key === 'totals');
        const odds = {
            source: bk.key,
            captured_at: new Date().toISOString(),
            moneyline: {
                home: ml?.outcomes?.find(o => o.name === event.home_team)?.price ?? null,
                away: ml?.outcomes?.find(o => o.name === event.away_team)?.price ?? null,
                draw: ml?.outcomes?.find(o => o.name === 'Draw')?.price ?? null,
            },
            spread: {
                home: sp?.outcomes?.find(o => o.name === event.home_team)?.point ?? null,
                away: sp?.outcomes?.find(o => o.name === event.away_team)?.point ?? null,
            },
            total: {
                over:  to?.outcomes?.find(o => o.name === 'Over')?.point ?? null,
                under: to?.outcomes?.find(o => o.name === 'Under')?.point ?? null,
            },
        };
        const oddsJson = JSON.stringify(odds);

        // Find the matching archive row (id contains normalised team names
        // for most relay-cron writers) and UPDATE. Both tables checked.
        for (const table of ['regular_season_games', 'postseason_games']) {
            try {
                const candidates = await this._d1Query(
                    `SELECT id FROM ${table}
                     WHERE date = ? AND closing_odds IS NULL LIMIT 50`,
                    [today]
                );
                const match = candidates.find(r =>
                    r.id && (r.id.includes(nH) || r.id.includes(nA))
                );
                if (!match) continue;
                await this._d1Query(
                    `UPDATE ${table} SET closing_odds = ?
                     WHERE id = ? AND closing_odds IS NULL`,
                    [oddsJson, match.id]
                );
                // change_log entry — Brief Freshness Guard reads this to
                // flag stale briefs when closing odds shift after pub.
                await this._d1Query(
                    `INSERT INTO change_log
                       (game_id, source, field, old_value, new_value, ts)
                     VALUES (?, 'closing_odds_capture', 'closing_odds', NULL, ?, datetime('now'))`,
                    [match.id, oddsJson]
                ).catch(() => { /* change_log may be absent on cold deploy */ });
                console.log(`[closing-odds] captured ${home} vs ${away} → ${table}/${match.id}`);
            } catch (e) {
                console.warn(`[closing-odds] ${table} update failed: ${e.message}`);
            }
        }
    }

    // Thin D1 wrapper. DOs share the parent Worker's env, so ARCHIVE_DB is
    // directly accessible. Returns [] when the binding is missing so the
    // capture path can degrade silently.
    async _d1Query(sql, params = []) {
        if (!this.env || !this.env.ARCHIVE_DB) return [];
        const stmt = this.env.ARCHIVE_DB.prepare(sql);
        const bound = params.length ? stmt.bind(...params) : stmt;
        const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
        if (isSelect) {
            const r = await bound.all();
            return r.results || [];
        }
        await bound.run();
        return [];
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

// ── Odds API credit guard (KV-backed, monthly) ───────────────────────────
// Mirrors src/index.js consumeOddsCredit() using the same FIELD_JOURNALISM
// KV key (`odds:credits:YYYY-MM`). Cross-process circuit breaker — when the
// monthly cumulative cost hits ODDS_HARD_LIMIT we abort outgoing fetches.
// Degrade-open on KV failure to avoid blocking live coverage on a KV blip.
const _AMBIENT_ODDS_HARD_LIMIT = 18000;
function _ambientOddsCreditMonthKey() {
    const d = new Date();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `odds:credits:${d.getUTCFullYear()}-${m}`;
}
async function _consumeAmbientOddsCredit(env, units) {
    if (!env || !env.FIELD_JOURNALISM) return true;
    try {
        const key = _ambientOddsCreditMonthKey();
        const raw = await env.FIELD_JOURNALISM.get(key);
        const used = raw ? parseInt(raw, 10) || 0 : 0;
        if (used + units > _AMBIENT_ODDS_HARD_LIMIT) {
            const warnedKey = `${key}:warned:limit`;
            const already = await env.FIELD_JOURNALISM.get(warnedKey);
            if (!already) {
                console.warn(`[ambient-odds-guard] HARD LIMIT — used=${used} + ${units} > ${_AMBIENT_ODDS_HARD_LIMIT}; suppressing live odds fetches`);
                await env.FIELD_JOURNALISM.put(warnedKey, '1', { expirationTtl: 60 * 86400 });
            }
            return false;
        }
        await env.FIELD_JOURNALISM.put(key, String(used + units), { expirationTtl: 60 * 86400 });
        return true;
    } catch (_) {
        return true;
    }
}

// Spec Gap 6: priority-tier cooldown for odds polling.
// Date-based postseason detection + sport defaults.
function _getOddsCooldown(sport) {
    const month = new Date().getUTCMonth(); // 0-indexed
    // WC knockout: July (month 6) = high priority
    if (sport === 'wc26' && month >= 6) return ODDS_PRIORITY.high;
    if (sport === 'wc26') return ODDS_PRIORITY.medium; // group stage
    // NBA/NHL: June = Finals → high
    if ((sport === 'nba' || sport === 'nhl') && month === 5) return ODDS_PRIORITY.high;
    // Low-priority sports
    if (sport === 'mls' || sport === 'wnba') return ODDS_PRIORITY.low;
    // Default: medium
    return ODDS_PRIORITY.medium;
}

// Fuzzy team-name match (mirrors teamNameMatch in index.js).
// Lightweight inline version for AmbientDO — avoids cross-module import.
function _teamMatch(a, b) {
    if (!a || !b) return false;
    const norm = s => s.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const na = norm(a), nb = norm(b);
    if (na === nb) return true;
    // 5-char prefix overlap
    if (na.length >= 5 && nb.length >= 5) {
        if (nb.includes(na.slice(0, 5)) || na.includes(nb.slice(0, 5))) return true;
    }
    return false;
}

// Estimate game lateness (0→1) from period number.
// Used in urgency formula: late-game WP swings are more dramatic.
function _estimateLateness(sport, period) {
    if (!period || period <= 0) return 0;
    const totalPeriods = { nba: 4, nhl: 3, mlb: 9, wnba: 4 };
    const total = totalPeriods[sport] || 2; // soccer = 2 halves
    return Math.min(1, period / total);
}
