// ═══════════════════════════════════════════════════════════════════════════
// GameDO — Durable Object for per-game live state fan-out
// ═══════════════════════════════════════════════════════════════════════════
// Built: May 31 2026 (Workers Plus active — Account b57e9af57ab46c52ca9215804e689c29)
//
// PURPOSE
//   One DO instance per active game. Multiple browsers WebSocket-connect to
//   the game's DO. The DO polls the data source (API-Sports primary,
//   ESPN fallback) once per cycle and fans out raw score facts to all
//   connected clients via WebSocket.
//
// ADR-002 COMPLIANCE (relay-is-dumb)
//   DO ships ONLY raw facts: {homeScore, awayScore, period, clock, state, ts}.
//   Drama computation, CRUNCH TIME detection, watch verdicts — all browser-side.
//   DO is a fact distributor + push fan-out, never an intelligence layer.
//
// RUWT (US 9,421,446 B2) COMPLIANCE
//   No composite interest level value computed here.
//   No threshold comparison here.
//   CRUNCH TIME notifications fired here are TRIGGERED by browsers that
//   compute the named condition locally — not by server-side scoring.
//
// HIBERNATION
//   Uses Hibernation WebSocket API (ctx.acceptWebSocket).
//   DO can sleep between events; state persists via DO storage.
//   Alarms wake the DO for polling cycles.
//
// FEATURES
//   - WOW 1: WebSocket fan-out of score deltas (~99% ESPN/API-Sports reduction)
//   - WOW 2: Crunch fan-out — browsers signal CRUNCH TIME; DO fans Web Push
// ═══════════════════════════════════════════════════════════════════════════

const POLL_INTERVAL_MS    = 25000;  // 25s default poll cadence (between sub-50s ESPN/API-Sports limits)
const IDLE_SHUTDOWN_MS    = 5 * 60 * 1000;  // 5 min with no sessions → stop polling
const CRUNCH_DEDUP_TTL_MS = 30 * 60 * 1000; // 30 min dedup window per (gameId, type, period)

// Permitted control messages from clients. DO NOT INVENT — additive only.
const ALLOWED_CLIENT_MSG_TYPES = new Set([
    'hello',         // {type:'hello', gameId, sport} — confirms identity (DO already knows from URL)
    'pin',           // {type:'pin', subscription, prefs} — pin this game for push when backgrounded
    'unpin',         // {type:'unpin', endpoint} — remove pin
    'signal-crunch', // {type:'signal-crunch', period, gameId} — browser locally detected CRUNCH TIME
    'ping',          // keepalive
]);

// Sport → V2 sport key for relay /v2/games lookup
const SPORT_TO_V2 = {
    'nba': 'nba', 'nhl': 'nhl', 'mlb': 'mlb', 'wnba': 'wnba',
    'epl': 'epl', 'mls': 'mls', 'ucl': 'ucl',
    'wc26': 'wc26',  // WC 2026 added June 4 2026
};

// Max WP history entries per game (~180 = full 90 min at 30s poll cadence)
const WP_HISTORY_MAX = 180;

export class GameDO {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
        // Restore last-known state across hibernation (re-init runs on wake).
        this.gameId      = null;
        this.sport       = null;
        this.lastFacts   = null;
        this.lastSeen    = Date.now();
        // Read persisted state from DO storage (async, awaited on first request).
        this._restored   = false;
    }

    async _restore() {
        if (this._restored) return;
        const stored = await this.ctx.storage.get(['gameId', 'sport', 'lastFacts', 'lastSeen']);
        this.gameId    = stored.get('gameId')    ?? this.gameId;
        this.sport     = stored.get('sport')     ?? this.sport;
        this.lastFacts = stored.get('lastFacts') ?? this.lastFacts;
        this.lastSeen  = stored.get('lastSeen')  ?? Date.now();
        this._restored = true;
    }

    async fetch(request) {
        await this._restore();
        const url      = new URL(request.url);
        const pathname = url.pathname;

        // ── WebSocket upgrade ────────────────────────────────────────────
        // Path: /ws — clients connect via /ws/game/:sport/:gameId on the worker,
        // worker derives the DO id and forwards. By the time we get here, the
        // URL has been rewritten and only the upgrade matters.
        if (request.headers.get('Upgrade') === 'websocket') {
            // Persist identity from query params on first connection.
            const qSport  = url.searchParams.get('sport');
            const qGameId = url.searchParams.get('gameId');
            if (qSport && !this.sport)     { this.sport  = qSport;  await this.ctx.storage.put('sport',  qSport);  }
            if (qGameId && !this.gameId)   { this.gameId = qGameId; await this.ctx.storage.put('gameId', qGameId); }

            const pair   = new WebSocketPair();
            const client = pair[0], server = pair[1];

            // Hibernation API: ctx.acceptWebSocket replaces server.accept().
            // DO can hibernate while clients stay connected.
            this.ctx.acceptWebSocket(server);

            // Schedule first poll if this is the first connection.
            await this._ensurePolling();

            // Send last-known facts immediately so client doesn't wait a cycle.
            if (this.lastFacts) {
                try { server.send(JSON.stringify({ type: 'facts', ...this.lastFacts })); }
                catch(_) { /* connection may already be torn — ignore */ }
            } else {
                // No facts yet — trigger an immediate poll so the new client gets data fast.
                this.ctx.waitUntil(this._poll());
            }

            return new Response(null, { status: 101, webSocket: client });
        }

        // ── POST /pin — server-side pin from non-WebSocket clients (e.g. SW) ──
        if (pathname.endsWith('/pin') && request.method === 'POST') {
            try {
                const body = await request.json();
                const { subscription, prefs } = body || {};
                if (!subscription?.endpoint) return new Response('Missing subscription', { status: 400 });
                const key = 'pin:' + this._hashEndpoint(subscription.endpoint);
                await this.ctx.storage.put(key, { subscription, prefs: prefs || {}, ts: Date.now() });
                return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
            } catch(e) {
                return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500 });
            }
        }

        // ── POST /unpin ──────────────────────────────────────────────────
        if (pathname.endsWith('/unpin') && request.method === 'POST') {
            try {
                const { endpoint } = await request.json();
                if (!endpoint) return new Response('Missing endpoint', { status: 400 });
                const key = 'pin:' + this._hashEndpoint(endpoint);
                await this.ctx.storage.delete(key);
                return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
            } catch(e) {
                return new Response(JSON.stringify({ ok: false }), { status: 500 });
            }
        }

        // ── POST /signal/crunch — browser/SW signals locally-computed CRUNCH TIME ──
        // Per RUWT: this DO does NOT compute the condition. It only fans out the
        // notification on behalf of the client that already made the determination.
        if (pathname.endsWith('/signal/crunch') && request.method === 'POST') {
            try {
                const body = await request.json();
                const { period, gameId } = body || {};
                if (!period && period !== 0) return new Response('Missing period', { status: 400 });

                // Dedup: one CRUNCH notification per (gameId, period) per 30 min.
                const dedupKey = `crunch:${gameId || this.gameId}:p${period}`;
                const last     = await this.ctx.storage.get(dedupKey);
                if (last && (Date.now() - last) < CRUNCH_DEDUP_TTL_MS) {
                    return new Response(JSON.stringify({ ok: true, deduped: true }),
                        { headers: { 'Content-Type': 'application/json' } });
                }
                await this.ctx.storage.put(dedupKey, Date.now());

                // Fan out to all pinned subscribers for this game.
                const sent = await this._fanoutCrunch(body);
                return new Response(JSON.stringify({ ok: true, sent }),
                    { headers: { 'Content-Type': 'application/json' } });
            } catch(e) {
                return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500 });
            }
        }

        // ── POST /crunch — relay-side CRUNCH signal (fire-and-forget from V2 loop) ──
        // Relay computes named condition (binary fact); DO fans out to push subscribers.
        // Fixes route mismatch: relay fires to /crunch, browser fires via WebSocket signal-crunch.
        if (pathname.endsWith('/crunch') && request.method === 'POST') {
            try {
                const body = await request.json();
                const { condition, gameId } = body || {};
                if (!condition) return new Response(JSON.stringify({ ok: false, error: 'Missing condition' }),
                    { headers: { 'Content-Type': 'application/json' } });
                // Dedup per (gameId, condition) per 30 min
                const dedupKey = `crunch:${gameId || this.gameId}:${condition}`;
                const last = await this.ctx.storage.get(dedupKey);
                if (last && (Date.now() - last) < CRUNCH_DEDUP_TTL_MS) {
                    return new Response(JSON.stringify({ ok: true, deduped: true }),
                        { headers: { 'Content-Type': 'application/json' } });
                }
                await this.ctx.storage.put(dedupKey, Date.now());
                const sent = await this._fanoutCrunch(body);
                return new Response(JSON.stringify({ ok: true, sent }),
                    { headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500 });
            }
        }

        // ── POST /wp — relay writes live win probability; DO stores state and returns delta ──
        // Called by relay V2 polling loop for every live football game with winProb computed.
        // DO stores: openingWP (immutable first-live value), lastWP, wpHistory (bounded).
        // Returns: {openingWP, wpDelta, recentHistory} — relay attaches to game object.
        //
        // ADR-002 compliance: DO stores and returns probability FACTS only.
        // Drama computation, display thresholds — all browser-side.
        if (pathname.endsWith('/wp') && request.method === 'POST') {
            try {
                const body = await request.json();
                const { wp, elapsed } = body || {};
                if (!wp || typeof wp.homeWin !== 'number') {
                    return new Response(JSON.stringify({ ok: false, error: 'Invalid wp object' }),
                        { status: 400, headers: { 'Content-Type': 'application/json' } });
                }
                // Load current WP state from DO storage
                const stored = await this.ctx.storage.get(['openingWP', 'lastWP', 'wpHistory']);
                const openingWP  = stored.get('openingWP')  ?? null;
                const lastWP     = stored.get('lastWP')     ?? null;
                const wpHistory  = stored.get('wpHistory')  ?? [];

                // Compute delta vs previous poll
                const wpDelta = lastWP !== null ? {
                    homeWin: parseFloat((wp.homeWin - lastWP.homeWin).toFixed(4)),
                    awayWin: parseFloat((wp.awayWin - lastWP.awayWin).toFixed(4)),
                    draw:    parseFloat((wp.draw    - lastWP.draw   ).toFixed(4)),
                } : null;

                // Store opening WP once (immutable — pre-game lambda baked in at kickoff)
                const newOpeningWP = openingWP ?? { ...wp, elapsed: elapsed ?? 0, storedAt: Date.now() };

                // Append to history (bounded — discard oldest when full)
                const entry = { elapsed: elapsed ?? 0, homeWin: wp.homeWin, draw: wp.draw };
                const newHistory = [...wpHistory, entry].slice(-WP_HISTORY_MAX);

                // Persist (single put batches all keys)
                await this.ctx.storage.put({
                    openingWP: newOpeningWP,
                    lastWP:    { ...wp, elapsed: elapsed ?? 0, ts: Date.now() },
                    wpHistory: newHistory,
                });

                // Fan out WP update to connected WebSocket clients
                this._broadcast({ type: 'wp', wp, elapsed, wpDelta, ts: Date.now() });

                return new Response(JSON.stringify({
                    ok:            true,
                    openingWP:     newOpeningWP,
                    wpDelta,
                    recentHistory: newHistory.slice(-20),  // last 20 points for sparkline
                    historyLen:    newHistory.length,
                }), { headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                return new Response(JSON.stringify({ ok: false, error: e.message }),
                    { status: 500, headers: { 'Content-Type': 'application/json' } });
            }
        }

        return new Response('GameDO: unknown route', { status: 404 });
    }

    // ── Hibernation WebSocket handlers ────────────────────────────────────

    async webSocketMessage(ws, message) {
        await this._restore();
        let msg;
        try { msg = typeof message === 'string' ? JSON.parse(message) : null; }
        catch(_) { msg = null; }
        if (!msg || !ALLOWED_CLIENT_MSG_TYPES.has(msg.type)) return;

        this.lastSeen = Date.now();
        await this.ctx.storage.put('lastSeen', this.lastSeen);

        if (msg.type === 'ping') {
            try { ws.send(JSON.stringify({ type: 'pong', ts: Date.now() })); } catch(_) {}
            return;
        }

        if (msg.type === 'pin' && msg.subscription?.endpoint) {
            const key = 'pin:' + this._hashEndpoint(msg.subscription.endpoint);
            await this.ctx.storage.put(key, { subscription: msg.subscription, prefs: msg.prefs || {}, ts: Date.now() });
            try { ws.send(JSON.stringify({ type: 'pinned' })); } catch(_) {}
            return;
        }

        if (msg.type === 'unpin' && msg.endpoint) {
            const key = 'pin:' + this._hashEndpoint(msg.endpoint);
            await this.ctx.storage.delete(key);
            try { ws.send(JSON.stringify({ type: 'unpinned' })); } catch(_) {}
            return;
        }

        if (msg.type === 'signal-crunch') {
            const period   = msg.period;
            const dedupKey = `crunch:${this.gameId}:p${period}`;
            const last     = await this.ctx.storage.get(dedupKey);
            if (last && (Date.now() - last) < CRUNCH_DEDUP_TTL_MS) return;
            await this.ctx.storage.put(dedupKey, Date.now());
            this.ctx.waitUntil(this._fanoutCrunch(msg));
            return;
        }
    }

    async webSocketClose(ws, code, reason, wasClean) {
        // No-op: hibernation runtime tracks sessions via ctx.getWebSockets().
        // If sessions go to zero, alarm will detect and stop polling.
    }

    async webSocketError(ws, error) {
        // Same as close — runtime cleans up the session list.
    }

    // ── Polling cycle ─────────────────────────────────────────────────────

    async _ensurePolling() {
        const existing = await this.ctx.storage.getAlarm();
        if (existing == null) {
            await this.ctx.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
        }
    }

    async alarm() {
        await this._restore();
        // Drop polling if no sessions are connected and we've been idle.
        const sessions = this.ctx.getWebSockets();
        const idleFor  = Date.now() - this.lastSeen;
        if (sessions.length === 0 && idleFor > IDLE_SHUTDOWN_MS) {
            // No alarm rearm — DO will hibernate.
            return;
        }
        try { await this._poll(); }
        catch(_) { /* swallow — re-armed below regardless */ }
        // Re-arm next cycle.
        await this.ctx.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
    }

    async _poll() {
        if (!this.gameId || !this.sport) return;
        const facts = await this._fetchFacts();
        if (!facts) return;
        // Diff against lastFacts; only broadcast on change.
        if (this._sameFacts(facts, this.lastFacts)) {
            this.lastSeen = Date.now();
            return;
        }
        this.lastFacts = facts;
        this.lastSeen  = Date.now();
        await this.ctx.storage.put({ lastFacts: facts, lastSeen: this.lastSeen });
        this._broadcast({ type: 'facts', ...facts });
    }

    // Fetch from API-Sports primary; fallback to ESPN if API-Sports returns nothing.
    // ADR-002: API-Sports is the GREEN+contract source. ESPN is fallback only
    //          during the migration window; remove fallback after ESPN cutover.
    async _fetchFacts() {
        const v2Sport = SPORT_TO_V2[this.sport];
        // ─ Try API-Sports (primary) ─
        if (v2Sport) {
            try {
                const today = new Date().toISOString().slice(0, 10);
                const url   = `https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=${v2Sport}&date=${today}`;
                const resp  = await fetch(url, { cf: { cacheTtl: 10 } });
                if (resp.ok) {
                    const data  = await resp.json();
                    const games = data?.games || [];
                    const match = games.find(g => String(g.id) === String(this.gameId));
                    if (match) {
                        return {
                            gameId:     String(this.gameId),
                            sport:      this.sport,
                            state:      match.state || 'pre',
                            homeScore:  match?.home?.score ?? null,
                            awayScore:  match?.away?.score ?? null,
                            period:     match.periodNum ?? null,
                            periodLabel: match.periodLabel || '',
                            clock:      match.clock || '',
                            source:     'apisports',
                            ts:         Date.now(),
                        };
                    }
                }
            } catch(_) { /* fall through to ESPN */ }
        }
        // ─ ESPN fallback (transitional — ADR-002 deprecation window) ─
        // Intentionally not implemented as a deep fallback here: the worker has
        // ESPN scoreboard routes already; if API-Sports misses this game, the
        // browser's existing polling fallback path handles it (dual-mode design).
        // Returning null here causes the DO to skip this cycle silently.
        return null;
    }

    _sameFacts(a, b) {
        if (!a || !b) return false;
        return a.homeScore === b.homeScore
            && a.awayScore === b.awayScore
            && a.period    === b.period
            && a.clock     === b.clock
            && a.state     === b.state;
    }

    _broadcast(obj) {
        const json     = JSON.stringify(obj);
        const sessions = this.ctx.getWebSockets();
        for (const ws of sessions) {
            try { ws.send(json); } catch(_) { /* dead socket — runtime will clean up */ }
        }
    }

    // ── Push fan-out for CRUNCH TIME ──────────────────────────────────────
    // Reads pinned subscriptions from DO storage, calls sendWebPush from the
    // main worker module. Browser computed the named condition; DO delivers.
    async _fanoutCrunch(signalBody) {
        const pins = await this.ctx.storage.list({ prefix: 'pin:' });
        if (pins.size === 0) return 0;

        // Compose factual payload — no excitement language, no composite value.
        // Names the binary condition that the client already determined.
        const payload = {
            type:        'CRUNCH_TIME_SIGNAL',
            gameId:      this.gameId,
            sport:       this.sport,
            home:        signalBody?.home  || '',
            away:        signalBody?.away  || '',
            homeScore:   signalBody?.homeScore  ?? null,
            awayScore:   signalBody?.awayScore  ?? null,
            period:      signalBody?.period     ?? null,
            periodLabel: signalBody?.periodLabel || '',
            broadcast:   signalBody?.broadcast   || '',
            watchUrl:    signalBody?.watchUrl    || '/',
            ts:          Date.now(),
        };

        // Send sequentially to avoid bursting. Each send uses the existing
        // sendWebPush helper from index.js — imported via env.
        let sent = 0;
        for (const [_key, val] of pins) {
            try {
                if (this.env._sendWebPush) {
                    const res = await this.env._sendWebPush(val.subscription, payload, this.env);
                    if (res && res.ok) sent++;
                }
            } catch(_) { /* per-subscriber failure does not block fan-out */ }
        }
        return sent;
    }

    _hashEndpoint(endpoint) {
        // Same hashing pattern as PUSH_SUBS KV in src/index.js for consistency.
        return btoa(endpoint).slice(0, 32).replace(/[^a-zA-Z0-9]/g, '');
    }
}
