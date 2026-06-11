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

        // 3. Compute new projections (N=2000 — same as cron)
        let newSnapshot = null;
        try {
            newSnapshot = computeTournamentProjections({
                currentStandings: standings,
                remainingFixtures,
                oddsProbs,
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

        // 8. Fan out to all WebSocket clients
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
                    fifaCode:   t.fifaCode,
                    group:      t.group,
                    champBefore: Math.round((p.pChampion ?? 0) * 1000) / 10,
                    champAfter:  Math.round((t.pChampion ?? 0) * 1000) / 10,
                    champDelta:  Math.round(champDelta * 10) / 10,
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
