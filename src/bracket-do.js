// ═══════════════════════════════════════════════════════════════════════════
// BracketDO — Durable Object for WC 2026 bracket live state + narrative delta
// ═══════════════════════════════════════════════════════════════════════════
// Built: 2026-06-11
//
// PURPOSE
//   Single DO instance (named "wc2026"). Tracks WC bracket state across the
//   full tournament. On each confirmed final result:
//     1. Recomputes Monte Carlo projections with updated standings
//     2. Computes delta vs prior snapshot (narrative seeds: "Brazil 67% → 41%")
//     3. Saves snapshot to DO storage (persistent audit trail)
//     4. Fans out {type:'bracket:updated', delta, snapshot} to all WebSocket clients
//     5. Queues journalism brief if delta exceeds significance threshold
//
// ADR-002 COMPLIANCE
//   BracketDO computes BRACKET PROBABILITY FACTS only (Monte Carlo output).
//   No composite interest/excitement scores. No drama ratings.
//   Rule A compliant: no server-side drama state.
//   Rule E compliant: no server-side drama state rendering.
//
// RUWT PATENT DEFENSE
//   Path probabilities (pChampion, pAdvance etc.) are mathematical outputs of
//   a Poisson simulation. They are factual statistics, not composite interest
//   levels with threshold-based recommendations.
//
// ARCHITECTURE
//   One instance for whole tournament (not per-game like GameDO).
//   Uses Hibernation WebSocket API — can sleep between matches.
//   DO storage keys:
//     'snapshot:current'  — latest full projection snapshot
//     'snapshot:prev'     — previous snapshot (for delta computation)
//     'delta:last'        — last computed delta (narrative seeds)
//     'results:all'       — array of all confirmed results (audit trail)
//     'standings:{grp}'   — per-group standings map
//
// WEBSOCKET MESSAGE TYPES (server → client)
//   { type: 'bracket:current', snapshot, delta, resultCount }
//     — sent immediately on connect with current state
//   { type: 'bracket:updated', delta, snapshot, trigger }
//     — sent to all clients when bracket state changes
//   { type: 'bracket:pong' }  — keepalive response
//
// WEBSOCKET MESSAGE TYPES (client → server)
//   { type: 'bracket:ping' }  — keepalive
//   { type: 'bracket:subscribe', filter }  — future: per-team filtering
//
// SIGNIFICANCE THRESHOLD
//   A delta triggers a journalism brief if any team's pChampion shifts ≥ 5pp.
//   Threshold chosen to filter noise while catching meaningful bracket shifts.
// ═══════════════════════════════════════════════════════════════════════════

import { computeTournamentProjections, computeMovers } from './wc-tournament-projections.js';

const NARRATIVE_THRESHOLD_PP = 5.0;   // min pp shift to queue journalism brief
const SNAPSHOT_MAX_STORED    = 50;    // max snapshots in audit trail
const RELAY_BASE = 'https://field-relay-nba.jeffunglesbee.workers.dev';
// Per-game cooldown for /bracket/live-score recomputes. Soccer score events
// can fire several times in a minute around a goal celebration / VAR review;
// 30s lets us catch the next genuine state change without burning sims.
const LIVE_RECOMPUTE_COOLDOWN_MS = 30 * 1000;

// Case-insensitive team name match. Standings + oddsProbs may carry slightly
// different casings or accents (Türkiye vs Turkiye); a coarse match keeps
// the live recompute usable until full name normalisation lands.
function _teamsMatch(a, b) {
    if (!a || !b) return false;
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

// Is this odds-probs fixture the same match as the live event? Tolerates
// home/away order flip — the oddsProbs feed sometimes orders by api-sports'
// raw fixture, not by the relay's normalisation.
function _isSameMatch(fixture, liveResult) {
    const fh = fixture.home_team, fa = fixture.away_team;
    const lh = liveResult.home,    la = liveResult.away;
    return (_teamsMatch(fh, lh) && _teamsMatch(fa, la))
        || (_teamsMatch(fh, la) && _teamsMatch(fa, lh));
}

// Layer a live result into the in-memory standings object the canonical
// recompute would otherwise see. Bumps played, won/drawn/lost, gf/ga/gd,
// points for both teams in the affected group, then re-sorts the group.
// Returns false when the team names can't be found in any group — caller
// uses that to broadcast a no-op acknowledgement instead of running sims.
function _applyLiveToStandings(standings, liveResult) {
    if (!standings || typeof standings !== 'object') return false;
    let h, a, group;
    for (const [gid, teams] of Object.entries(standings)) {
        if (!Array.isArray(teams)) continue;
        const hi = teams.find(t => _teamsMatch(t.team, liveResult.home));
        const ai = teams.find(t => _teamsMatch(t.team, liveResult.away));
        if (hi && ai) { h = hi; a = ai; group = gid; break; }
    }
    if (!h || !a) return false;
    const hs = Number(liveResult.hs) || 0;
    const as = Number(liveResult.as) || 0;
    for (const t of [h, a]) t.played = (t.played || 0) + 1;
    h.gf = (h.gf || 0) + hs; h.ga = (h.ga || 0) + as; h.gd = h.gf - h.ga;
    a.gf = (a.gf || 0) + as; a.ga = (a.ga || 0) + hs; a.gd = a.gf - a.ga;
    if (hs > as) {
        h.won  = (h.won  || 0) + 1; h.points = (h.points || 0) + 3;
        a.lost = (a.lost || 0) + 1;
    } else if (hs < as) {
        a.won  = (a.won  || 0) + 1; a.points = (a.points || 0) + 3;
        h.lost = (h.lost || 0) + 1;
    } else {
        h.drawn = (h.drawn || 0) + 1; h.points = (h.points || 0) + 1;
        a.drawn = (a.drawn || 0) + 1; a.points = (a.points || 0) + 1;
    }
    standings[group].sort((x, y) =>
        (y.points - x.points) || (y.gd - x.gd) || (y.gf - x.gf));
    return true;
}

export class BracketDO {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
        this._restored = false;
        this.currentSnapshot = null;
        this.prevSnapshot    = null;
        this.lastDelta       = null;
        this.allResults      = [];    // [{gameId, group, home, away, hs, as, ts}]
    }

    // ── Restore persisted state from DO storage ───────────────────────────
    async _restore() {
        if (this._restored) return;
        this._restored = true;
        const stored = await this.ctx.storage.get([
            'snapshot:current', 'snapshot:prev',
            'delta:last', 'results:all',
        ]);
        this.currentSnapshot = stored.get('snapshot:current') ?? null;
        this.prevSnapshot    = stored.get('snapshot:prev')    ?? null;
        this.lastDelta       = stored.get('delta:last')       ?? null;
        this.allResults      = stored.get('results:all')      ?? [];
    }

    // ── Main fetch handler ────────────────────────────────────────────────
    async fetch(request) {
        await this._restore();
        const url = new URL(request.url);

        // ── WebSocket upgrade — browser connecting for live updates ──────
        if (request.headers.get('Upgrade') === 'websocket') {
            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);
            this.ctx.acceptWebSocket(server);

            // Send current state immediately on connect
            const greeting = {
                type: 'bracket:current',
                snapshot: this.currentSnapshot,
                delta: this.lastDelta,
                resultCount: this.allResults.length,
                ts: Date.now(),
            };
            server.send(JSON.stringify(greeting));

            return new Response(null, { status: 101, webSocket: client });
        }

        // ── POST /bracket/live-score — called by AmbientDO on WC score change ──
        // Payload: { gameId, home, away, homeScore, awayScore, group, minute, isLive }
        // Recomputes projections provisionally with the live score layered into
        // standings. Transient: not persisted as the canonical snapshot, not
        // written to KV. The next writeWCResult call (game final) overwrites
        // the transient state via the normal /bracket/result path.
        if (url.pathname.endsWith('/bracket/live-score') && request.method === 'POST') {
            let body;
            try { body = await request.json(); }
            catch (_) { return new Response('Bad JSON', { status: 400 }); }
            const { gameId, home, away, homeScore, awayScore, minute } = body;
            if (!gameId || !home || !away) {
                return new Response('Missing fields', { status: 400 });
            }
            // Per-game cooldown — avoid recomputing Monte Carlo (~2k sims) on
            // every rapid-fire score event. 30s is a comfortable buffer for
            // typical soccer scoring cadence.
            if (!this._liveLast) this._liveLast = new Map();
            const lastTs = this._liveLast.get(gameId) || 0;
            if (Date.now() - lastTs < LIVE_RECOMPUTE_COOLDOWN_MS) {
                return new Response(JSON.stringify({ ok: true, throttled: true }),
                    { headers: { 'Content-Type': 'application/json' } });
            }
            this._liveLast.set(gameId, Date.now());

            const liveResult = {
                gameId,
                home, away,
                hs: Number(homeScore) || 0,
                as: Number(awayScore) || 0,
                minute: minute || '',
                isLive: true,
                ts: Date.now(),
            };
            const broadcast = await this._recomputeLiveAndBroadcast(liveResult);
            return new Response(JSON.stringify({ ok: true, broadcast }),
                { headers: { 'Content-Type': 'application/json' } });
        }

        // ── POST /bracket/result — called by relay when a WC game goes final ──
        // Payload: { gameId, group_id, home, away, home_score, away_score, matchDate }
        if (url.pathname.endsWith('/bracket/result') && request.method === 'POST') {
            let body;
            try { body = await request.json(); }
            catch (_) { return new Response('Bad JSON', { status: 400 }); }

            const { gameId, group_id, home, away, home_score, away_score } = body;
            if (!gameId || !group_id || !home || !away)
                return new Response('Missing fields', { status: 400 });

            // Dedup: skip if already recorded
            if (this.allResults.some(r => r.gameId === gameId)) {
                return new Response(JSON.stringify({ ok: true, skipped: true }), {
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            // Record result
            const result = {
                gameId, group: group_id, home, away,
                hs: home_score, as: away_score,
                ts: Date.now(),
            };
            this.allResults.push(result);
            // Cap audit trail in memory (D1 is the full record)
            if (this.allResults.length > SNAPSHOT_MAX_STORED) {
                this.allResults = this.allResults.slice(-SNAPSHOT_MAX_STORED);
            }

            // Recompute projections and fan out
            const updated = await this._recomputeAndBroadcast(result);

            await this.ctx.storage.put('results:all', this.allResults);

            return new Response(JSON.stringify({ ok: true, updated }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // ── GET /bracket/state — current snapshot (REST poll fallback) ────
        if (url.pathname.endsWith('/bracket/state') && request.method === 'GET') {
            return new Response(JSON.stringify({
                snapshot: this.currentSnapshot,
                delta: this.lastDelta,
                resultCount: this.allResults.length,
                lastResult: this.allResults.at(-1) ?? null,
                ts: Date.now(),
            }), { headers: { 'Content-Type': 'application/json' } });
        }

        // ── POST /bracket/refresh — force projection recompute (admin) ───
        if (url.pathname.endsWith('/bracket/refresh') && request.method === 'POST') {
            await this._recomputeAndBroadcast(null);
            return new Response(JSON.stringify({ ok: true }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }

        return new Response('Not found', { status: 404 });
    }

    // ── WebSocket message handler (hibernation API) ───────────────────────
    async webSocketMessage(ws, message) {
        try {
            const msg = JSON.parse(message);
            if (msg.type === 'bracket:ping') {
                ws.send(JSON.stringify({ type: 'bracket:pong', ts: Date.now() }));
            }
            // bracket:subscribe — future: per-team filtering (no-op for now)
        } catch (_) {}
    }

    webSocketClose() { /* hibernation handles cleanup */ }
    webSocketError() { /* hibernation handles cleanup */ }

    // ── Core: recompute + persist + fan-out ───────────────────────────────
    async _recomputeAndBroadcast(triggerResult) {
        // 1. Fetch current standings from D1 (relay endpoint — already computed)
        let standings = {};
        let oddsProbs = [];
        try {
            const [sRes, oRes] = await Promise.allSettled([
                fetch(`${RELAY_BASE}/wc/standings`, { cache: 'no-store' }),
                fetch(`${RELAY_BASE}/wc/odds-probs`, { cache: 'no-store' }),
            ]);
            if (sRes.status === 'fulfilled' && sRes.value.ok)
                standings = (await sRes.value.json()).groups ?? {};
            if (oRes.status === 'fulfilled' && oRes.value.ok)
                oddsProbs = (await oRes.value.json()).probs ?? [];
        } catch (_) {}

        // 2. Build remaining fixtures
        const nowMs = Date.now();
        const remainingFixtures = oddsProbs
            .filter(g => new Date(g.commence).getTime() > nowMs)
            .map(g => ({
                home: g.home_team, away: g.away_team,
                pHome: g.pHome, pDraw: g.pDraw || (1 - g.pHome - g.pAway) / 2,
                pAway: g.pAway,
                lambdaHome: g.lambdaHome, lambdaAway: g.lambdaAway,
            }));

        // 3. Query current third-place standings from D1 for bracket reality
        let currentThirdPlace = null;
        if (this.env.ARCHIVE_DB) {
            try {
                const tpRes = await this.env.ARCHIVE_DB.prepare(
                    'SELECT * FROM wc_third_place_standings ORDER BY cross_group_rank ASC'
                ).all();
                if (tpRes.results?.length >= 8) currentThirdPlace = tpRes.results;
            } catch (_) { /* D1 miss is non-fatal — falls back to Monte Carlo */ }
        }

        // 4. Compute new projections (N=2000 — same as cron)
        let newSnapshot = null;
        try {
            newSnapshot = computeTournamentProjections({
                currentStandings: standings,
                remainingFixtures,
                oddsProbs,
                currentThirdPlace,
                N: 2000,
            });
            // Attach trigger context
            newSnapshot._trigger = triggerResult
                ? `${triggerResult.home} ${triggerResult.hs}-${triggerResult.as} ${triggerResult.away}`
                : 'manual_refresh';
            newSnapshot._triggeredAt = new Date().toISOString();
        } catch (e) {
            console.error('[BracketDO] projection error:', e.message);
            return false;
        }

        // 4. Compute delta vs previous snapshot
        const delta = this._computeDelta(this.currentSnapshot, newSnapshot, triggerResult);

        // 5. Rotate snapshots
        this.prevSnapshot    = this.currentSnapshot;
        this.currentSnapshot = newSnapshot;
        this.lastDelta       = delta;

        // 6. Persist to DO storage
        await Promise.allSettled([
            this.ctx.storage.put('snapshot:current', newSnapshot),
            this.ctx.storage.put('snapshot:prev',    this.prevSnapshot),
            this.ctx.storage.put('delta:last',        delta),
        ]);

        // 7. Update FIELD_JOURNALISM KV so /wc/projections serves fresh data
        if (this.env.FIELD_JOURNALISM) {
            const kv = this.env.FIELD_JOURNALISM;
            await Promise.allSettled([
                kv.put('wc:projections:current', JSON.stringify(newSnapshot), { expirationTtl: 7 * 86400 }),
                newSnapshot.bracketSlots && Object.keys(newSnapshot.bracketSlots).length > 0
                    ? kv.put('wc:bracket:current', JSON.stringify({
                        bracketSlots: newSnapshot.bracketSlots,
                        generatedAt:  newSnapshot.generatedAt,
                        N: newSnapshot.N,
                      }), { expirationTtl: 7 * 86400 })
                    : Promise.resolve(),
            ]);
        }

        // 8. Write movers/delta to FIELD_JOURNALISM KV for /wc/movers endpoint
        if (delta && this.env.FIELD_JOURNALISM) {
            try {
                await this.env.FIELD_JOURNALISM.put('wc:movers:current', JSON.stringify(delta), { expirationTtl: 86400 });
            } catch (_) {}
        }
        // Also rotate prev in KV for the cron path
        if (this.env.FIELD_JOURNALISM) {
            try {
                await this.env.FIELD_JOURNALISM.put('wc:projections:prev', JSON.stringify(newSnapshot), { expirationTtl: 7 * 86400 });
            } catch (_) {}
        }

        // 9. Fan out to all WebSocket clients
        const message = JSON.stringify({
            type:    'bracket:updated',
            delta,
            trigger: newSnapshot._trigger,
            ts:      Date.now(),
            teamCount: newSnapshot.teams?.length ?? 0,
        });
        const sessions = this.ctx.getWebSockets();
        let fanOutCount = 0;
        for (const ws of sessions) {
            try { ws.send(message); fanOutCount++; }
            catch (_) {}
        }

        // 9. Queue journalism brief if delta is significant
        if (delta?.significant && this.env.JOURNALISM_QUEUE) {
            try {
                await this.env.JOURNALISM_QUEUE.send({
                    type:       'wc-bracket-shift',
                    briefType:  'wc-bracket-shift',
                    delta,
                    trigger:    newSnapshot._trigger,
                    timestamp:  newSnapshot._triggeredAt,
                });
            } catch (_) {}
        }

        console.log(`[BracketDO] recomputed: ${newSnapshot.teams?.length} teams · delta significant: ${delta?.significant} · ws clients: ${fanOutCount}`);
        return true;
    }

    // ── Provisional live-score recompute ─────────────────────────────────
    // Same Monte Carlo engine as _recomputeAndBroadcast, but the live game's
    // hypothetical-final is layered into standings + removed from remaining
    // fixtures BEFORE simulation. Transient: this.currentSnapshot, KV, and
    // the audit trail are NOT touched. The next /bracket/result POST (game
    // final) overwrites the transient view via the normal recompute path.
    async _recomputeLiveAndBroadcast(liveResult) {
        // 1. Fetch the same inputs the canonical recompute uses
        let standings = {};
        let oddsProbs = [];
        try {
            const [sRes, oRes] = await Promise.allSettled([
                fetch(`${RELAY_BASE}/wc/standings`, { cache: 'no-store' }),
                fetch(`${RELAY_BASE}/wc/odds-probs`, { cache: 'no-store' }),
            ]);
            if (sRes.status === 'fulfilled' && sRes.value.ok)
                standings = (await sRes.value.json()).groups ?? {};
            if (oRes.status === 'fulfilled' && oRes.value.ok)
                oddsProbs = (await oRes.value.json()).probs ?? [];
        } catch (_) { /* will produce no-op below */ }

        // 2. Layer the live result into the team's group standings
        const layered = _applyLiveToStandings(standings, liveResult);
        if (!layered) {
            // Team names didn't match — broadcast a lightweight acknowledgement
            // so the client knows the goal was received but the bracket
            // couldn't be recomputed. No projection update.
            const ackMsg = JSON.stringify({
                type:    'bracket:live-score-noop',
                isLive:  true,
                gameId:  liveResult.gameId,
                reason:  'name_mismatch',
                trigger: `${liveResult.home} ${liveResult.hs}-${liveResult.as} ${liveResult.away}`,
                ts:      Date.now(),
            });
            for (const ws of this.ctx.getWebSockets()) {
                try { ws.send(ackMsg); } catch (_) {}
            }
            console.warn(`[BracketDO] live-score name mismatch: ${liveResult.home} / ${liveResult.away}`);
            return false;
        }

        // 3. Remove the live game from remaining fixtures so Monte Carlo
        //    doesn't simulate it twice (once via layered standings, again
        //    via odds-derived fixtures).
        const nowMs = Date.now();
        const remainingFixtures = oddsProbs
            .filter(g => new Date(g.commence).getTime() > nowMs)
            .filter(g => !_isSameMatch(g, liveResult))
            .map(g => ({
                home: g.home_team, away: g.away_team,
                pHome: g.pHome, pDraw: g.pDraw || (1 - g.pHome - g.pAway) / 2,
                pAway: g.pAway,
                lambdaHome: g.lambdaHome, lambdaAway: g.lambdaAway,
            }));

        // 4. Query current third-place standings for live bracket reality
        let liveThirdPlace = null;
        if (this.env.ARCHIVE_DB) {
            try {
                const tpRes = await this.env.ARCHIVE_DB.prepare(
                    'SELECT * FROM wc_third_place_standings ORDER BY cross_group_rank ASC'
                ).all();
                if (tpRes.results?.length >= 8) liveThirdPlace = tpRes.results;
            } catch (_) { /* non-fatal */ }
        }

        // 5. Compute the live-adjusted projection
        let liveSnapshot = null;
        try {
            liveSnapshot = computeTournamentProjections({
                currentStandings: standings,
                remainingFixtures,
                oddsProbs,
                currentThirdPlace: liveThirdPlace,
                N: 2000,
            });
            liveSnapshot._trigger     = `${liveResult.home} ${liveResult.hs}-${liveResult.as} ${liveResult.away} (${liveResult.minute || 'live'})`;
            liveSnapshot._triggeredAt = new Date().toISOString();
            liveSnapshot._isLive      = true;
        } catch (e) {
            console.error('[BracketDO] live projection error:', e.message);
            return false;
        }

        // 5. Delta against the canonical current snapshot (NOT the previous
        //    live one — we want the client to see "how much did this goal
        //    move us from the official picture").
        const delta = this._computeDelta(this.currentSnapshot, liveSnapshot, {
            gameId: liveResult.gameId,
            home: liveResult.home, away: liveResult.away,
            hs: liveResult.hs, as: liveResult.as,
        });

        // 6. Fan out — flag the broadcast as live so consumers can render
        //    differently (e.g. dashed border, "live" badge).
        const message = JSON.stringify({
            type:      'bracket:updated',
            isLive:    true,
            delta,
            trigger:   liveSnapshot._trigger,
            ts:        Date.now(),
            teamCount: liveSnapshot.teams?.length ?? 0,
        });
        let fanOutCount = 0;
        for (const ws of this.ctx.getWebSockets()) {
            try { ws.send(message); fanOutCount++; } catch (_) {}
        }

        // 7. Transient persistence — keep the live snapshot in DO storage
        //    (separate key from the canonical snapshot) so /bracket/state
        //    can optionally expose it. NO KV write. NO mutation of
        //    this.currentSnapshot / this.prevSnapshot / this.lastDelta.
        try {
            await this.ctx.storage.put('snapshot:live', {
                snapshot: liveSnapshot,
                delta,
                trigger: liveSnapshot._trigger,
                ts: Date.now(),
            });
        } catch (_) { /* transient anyway */ }

        console.log(`[BracketDO] live recompute: ${liveSnapshot.teams?.length} teams · ws clients: ${fanOutCount}`);
        return true;
    }

    // ── Compute delta between two snapshots ──────────────────────────────
    // Returns narrative seeds: biggest movers, significant shifts
    _computeDelta(prev, curr, triggerResult) {
        if (!prev || !curr) return null;

        const prevByName = {};
        for (const t of (prev.teams || [])) prevByName[t.name] = t;

        const shifts = [];
        for (const t of (curr.teams || [])) {
            const p = prevByName[t.name];
            if (!p) continue;
            const champDelta = ((t.pChampion ?? 0) - (p.pChampion ?? 0)) * 100;
            const advDelta   = ((t.pAdvance  ?? 0) - (p.pAdvance  ?? 0)) * 100;
            if (Math.abs(champDelta) >= 0.5 || Math.abs(advDelta) >= 1.0) {
                shifts.push({
                    name:       t.name,
                    team:       t.name,     // client alias (CASCADE reads s.team)
                    fifaCode:   t.fifaCode,
                    group:      t.group,
                    champBefore: Math.round((p.pChampion ?? 0) * 1000) / 10,
                    champAfter:  Math.round((t.pChampion ?? 0) * 1000) / 10,
                    champDelta:  Math.round(champDelta * 10) / 10,
                    pChampDelta: Math.round(champDelta * 10) / 1000, // client alias (0-1 scale)
                    advBefore:   Math.round((p.pAdvance  ?? 0) * 1000) / 10,
                    advAfter:    Math.round((t.pAdvance  ?? 0) * 1000) / 10,
                    advDelta:    Math.round(advDelta * 10) / 10,
                });
            }
        }

        // Sort by absolute championship probability shift
        shifts.sort((a, b) => Math.abs(b.champDelta) - Math.abs(a.champDelta));

        const maxChampShift = shifts.length > 0 ? Math.abs(shifts[0].champDelta) : 0;
        const significant   = maxChampShift >= NARRATIVE_THRESHOLD_PP;

        // Build human-readable narrative seeds for journalism
        const narrativeSeeds = shifts.slice(0, 5).map(s => {
            const dir = s.champDelta > 0 ? '↑' : '↓';
            return `${s.name} ${s.champBefore}% → ${s.champAfter}% (${dir}${Math.abs(s.champDelta).toFixed(1)}pp)`;
        });

        return {
            significant,
            maxChampShift,
            shifts: shifts.slice(0, 10),  // top 10 movers
            narrativeSeeds,
            triggerGame: triggerResult
                ? `${triggerResult.home} ${triggerResult.hs}–${triggerResult.as} ${triggerResult.away}`
                : null,
            computedAt: new Date().toISOString(),
        };
    }
}
