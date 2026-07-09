// ═══════════════════════════════════════════════════════════════════════════
// UserDO — Durable Object for per-user FIELD state
// ═══════════════════════════════════════════════════════════════════════════
// Built: June 11 2026
//
// PURPOSE
//   One DO instance per FIELD user, keyed by a client-generated UUID stored
//   in localStorage as `field_user_id`. No email, no account, no PII.
//   The UUID is the only identifier. Transforms FIELD from a stateless tool
//   into a companion that knows your relationship with sports over time.
//
// PRIVACY
//   No personally identifiable information is stored.
//   No IP addresses, no device fingerprints, no emails.
//   The UUID is generated client-side (crypto.randomUUID) and is opaque.
//   deviceSyncToken = SHA-256(userId) — allows QR sync without exposing UUID.
//
// STORED STATE
//   seriesLedger:        { 'CAR_VGK_SCF_2026': [game events] }
//                        Tracks games watched per active series. Enables
//                        series continuity features (NW-3 Rival Intelligence).
//   watchHistory:        [{ gameId, sport, ts }] — rolling 30 days
//                        What games you've opened briefs for.
//   dramaticMomentsMissed: [{ gameId, sport, peakDrama, ts }]
//                        Games that peaked (drama > 75) while user was offline.
//                        Powers NW-2 Smart Catch-Up Brief.
//   pickLedger:          { picks: [...], totalMade, totalCorrect }
//                        Cumulative pick 'em record. PERMANENT — never purged,
//                        unlike watchHistory. Resolved picks carry
//                        revealedProbability + probabilitySource for display.
//   deviceSyncToken:     sha256(userId) — derived, not stored separately.
//                        Client uses to verify QR sync (PREF-SYNC-QR).
//
// ROUTES (all require ?userId= param matching the DO key)
//   POST /user/init    — create or verify DO; returns { ok, syncToken, state }
//   GET  /user/state   — return full user state
//   POST /user/event   — append an event { type, payload }
//     event types:
//       'watch_open'    — { gameId, sport } — user opened a game brief
//       'series_game'   — { seriesKey, gameId, sport, ts } — game added to ledger
//       'peak_missed'   — { gameId, sport, peakDrama } — high-drama game while offline
//       'pick_made'     — { gameId, sport, predictedWinner } — user made a pick
//       'pick_resolved' — { gameId, wasCorrect, revealedProbability, probabilitySource }
//
// TTL / RETENTION
//   watchHistory: purged to rolling 30 days on every write
//   dramaticMomentsMissed: purged after 7 days (catch-up window)
//   seriesLedger: kept for active series (sport seasons, ~6 months max)
//   pickLedger: PERMANENT — append-only, never purged
// ═══════════════════════════════════════════════════════════════════════════

import { resolveWinProbability, isWpUnsupportedSport, normalizeSportCode } from './wp-resolver.js';

const WATCH_HISTORY_TTL_MS  = 30 * 24 * 60 * 60 * 1000; // 30 days
const MISSED_PEAK_TTL_MS    = 7  * 24 * 60 * 60 * 1000; // 7 days
const MAX_WATCH_HISTORY     = 200;
const MAX_MISSED            = 50;

export class UserDO {
  constructor(state, env) {
    this.state = state;
    this.env   = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const method = request.method;

    // All routes require ?userId= for logging/audit; the DO is already keyed
    // by userId so this is belt-and-suspenders verification.
    const userId = url.searchParams.get('userId') || '';
    if (!userId || userId.length < 8) {
      return new Response(JSON.stringify({ ok: false, error: 'missing userId' }),
        { status: 400, headers: _cors() });
    }

    try {
      if (method === 'POST' && url.pathname === '/user/init') {
        return await this._handleInit(userId);
      }
      if (method === 'GET' && url.pathname === '/user/state') {
        return await this._handleState(userId);
      }
      if (method === 'POST' && url.pathname === '/user/event') {
        const body = await request.json().catch(() => null);
        return await this._handleEvent(userId, body);
      }
      return new Response(JSON.stringify({ ok: false, error: 'not found' }),
        { status: 404, headers: _cors() });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: String(err) }),
        { status: 500, headers: _cors() });
    }
  }

  // ── /user/init ────────────────────────────────────────────────────────────
  // Creates the DO state if first visit, or verifies on subsequent visits.
  // Returns: { ok, created, syncToken, stateSize }
  async _handleInit(userId) {
    const existing = await this.state.storage.get('meta');
    const syncToken = await _sha256(userId);
    if (!existing) {
      // First init — seed the state structure
      const now = Date.now();
      await this.state.storage.put('meta', { userId: _obfuscate(userId), createdAt: now, updatedAt: now });
      await this.state.storage.put('watchHistory', []);
      await this.state.storage.put('seriesLedger', {});
      await this.state.storage.put('dramaticMomentsMissed', []);
      await this.state.storage.put('pickLedger', { picks: [], totalMade: 0, totalCorrect: 0 });
      return new Response(JSON.stringify({ ok: true, created: true, syncToken }),
        { status: 200, headers: _cors() });
    }
    // Existing DO — bump updatedAt
    await this.state.storage.put('meta', { ...existing, updatedAt: Date.now() });
    const wh = (await this.state.storage.get('watchHistory')) || [];
    const mm = (await this.state.storage.get('dramaticMomentsMissed')) || [];
    return new Response(JSON.stringify({
      ok: true, created: false, syncToken,
      stateSize: { watchHistory: wh.length, missedPeaks: mm.length }
    }), { status: 200, headers: _cors() });
  }

  // ── /user/state ──────────────────────────────────────────────────────────
  // Returns full user state. Client uses for catch-up brief construction.
  async _handleState(userId) {
    const [meta, wh, sl, mm, pl] = await Promise.all([
      this.state.storage.get('meta'),
      this.state.storage.get('watchHistory'),
      this.state.storage.get('seriesLedger'),
      this.state.storage.get('dramaticMomentsMissed'),
      this.state.storage.get('pickLedger'),
    ]);
    if (!meta) {
      return new Response(JSON.stringify({ ok: false, error: 'not initialized' }),
        { status: 404, headers: _cors() });
    }
    const syncToken = await _sha256(userId);
    const ledger = pl || { picks: [], totalMade: 0, totalCorrect: 0 };
    const accuracyRate = ledger.totalMade > 0
      ? Math.round((ledger.totalCorrect / ledger.totalMade) * 1000) / 1000
      : null;
    return new Response(JSON.stringify({
      ok: true, syncToken,
      watchHistory:           (wh  || []).slice(-50),  // last 50 for client
      seriesLedger:           sl  || {},
      dramaticMomentsMissed:  mm  || [],
      picks: {
        totalMade:    ledger.totalMade,
        totalCorrect: ledger.totalCorrect,
        accuracyRate,
      },
      updatedAt:              meta.updatedAt,
    }), { status: 200, headers: _cors() });
  }

  // ── /user/event ──────────────────────────────────────────────────────────
  // Appends a user event. Handles TTL pruning on write.
  async _handleEvent(userId, body) {
    if (!body || !body.type) {
      return new Response(JSON.stringify({ ok: false, error: 'missing event type' }),
        { status: 400, headers: _cors() });
    }
    const now = Date.now();
    const type = body.type;

    if (type === 'watch_open') {
      // Append to watchHistory, prune to rolling 30d + max 200
      let wh = (await this.state.storage.get('watchHistory')) || [];
      wh.push({ gameId: body.gameId || '', sport: body.sport || '', ts: now });
      const cutoff = now - WATCH_HISTORY_TTL_MS;
      wh = wh.filter(e => e.ts > cutoff).slice(-MAX_WATCH_HISTORY);
      await this.state.storage.put('watchHistory', wh);
      await this._touchMeta(now);
      return new Response(JSON.stringify({ ok: true, watchHistoryLen: wh.length }),
        { headers: _cors() });
    }

    if (type === 'series_game') {
      // Append game to series ledger under the series key
      const seriesKey = body.seriesKey || '';
      if (!seriesKey) return new Response(JSON.stringify({ ok: false, error: 'missing seriesKey' }),
        { status: 400, headers: _cors() });
      let sl = (await this.state.storage.get('seriesLedger')) || {};
      if (!sl[seriesKey]) sl[seriesKey] = [];
      sl[seriesKey].push({ gameId: body.gameId || '', sport: body.sport || '', ts: now });
      await this.state.storage.put('seriesLedger', sl);
      await this._touchMeta(now);
      return new Response(JSON.stringify({ ok: true, seriesGames: sl[seriesKey].length }),
        { headers: _cors() });
    }

    if (type === 'peak_missed') {
      // Record a game that peaked while user was away
      let mm = (await this.state.storage.get('dramaticMomentsMissed')) || [];
      mm.push({ gameId: body.gameId || '', sport: body.sport || '',
                peakDrama: body.peakDrama || 0, ts: now });
      const cutoff = now - MISSED_PEAK_TTL_MS;
      mm = mm.filter(e => e.ts > cutoff).slice(-MAX_MISSED);
      await this.state.storage.put('dramaticMomentsMissed', mm);
      await this._touchMeta(now);
      return new Response(JSON.stringify({ ok: true, missedCount: mm.length }),
        { headers: _cors() });
    }

    if (type === 'pick_made') {
      const { gameId, sport, predictedWinner } = body;
      if (!gameId || !predictedWinner) {
        return new Response(JSON.stringify({ ok: false, error: 'missing gameId or predictedWinner' }),
          { status: 400, headers: _cors() });
      }
      let pl = (await this.state.storage.get('pickLedger')) || { picks: [], totalMade: 0, totalCorrect: 0 };
      pl.picks.push({ gameId, sport: sport || '', predictedWinner, ts: now, resolved: false });
      pl.totalMade++;
      await this.state.storage.put('pickLedger', pl);
      await this._touchMeta(now);
      return new Response(JSON.stringify({ ok: true, totalMade: pl.totalMade }),
        { headers: _cors() });
    }

    if (type === 'pick_resolved') {
      const { gameId, wasCorrect, revealedProbability, probabilitySource } = body;
      if (!gameId) {
        return new Response(JSON.stringify({ ok: false, error: 'missing gameId' }),
          { status: 400, headers: _cors() });
      }
      let pl = (await this.state.storage.get('pickLedger')) || { picks: [], totalMade: 0, totalCorrect: 0 };
      const pick = pl.picks.find(p => p.gameId === gameId && !p.resolved);
      if (!pick) {
        return new Response(JSON.stringify({ ok: false, error: 'pick not found or already resolved' }),
          { status: 404, headers: _cors() });
      }
      let finalProbability = revealedProbability ?? null;
      let finalSource      = probabilitySource || null;
      let finalLabel       = null;
      if (finalProbability == null && pick.sport && pick.predictedWinner) {
        try {
          const wp = await resolveWinProbability(
            pick.sport,
            { gameId: pick.gameId, predictedWinner: pick.predictedWinner },
            this.env
          );
          if (wp) {
            finalProbability = wp.probability;
            finalSource      = wp.source;
            finalLabel       = wp.label;
          } else if (!isWpUnsupportedSport(pick.sport)) {
            if (!normalizeSportCode(pick.sport)) {
              // Genuinely unrecognized sport label -- not in SPORT_LABEL_MAP at all,
              // not even via normalizeSportCode's own fallback matching. Tracked under
              // a separate codex key (not wp-resolution-failures) so a burst of drift
              // entries for one new client label can't evict genuine resolution-failure
              // signal for other, already-supported sports from that incident's
              // 10-entry recent[] window.
              await _recordWpResolutionFailure(this.env, pick.sport, pick.gameId,
                'sport label not found in SPORT_LABEL_MAP',
                { codexKey: 'wp-sport-label-drift', titleLabel: 'Unrecognized sport label seen', predictedWinner: pick.predictedWinner });
            } else {
              await _recordWpResolutionFailure(this.env, pick.sport, pick.gameId, 'resolveWinProbability returned null', { predictedWinner: pick.predictedWinner });
            }
          }
        } catch (_e) {
          try { await _recordWpResolutionFailure(this.env, pick.sport, pick.gameId, _e?.message || 'threw', { predictedWinner: pick.predictedWinner }); } catch (_) {}
        }
      }
      pick.resolved            = true;
      pick.wasCorrect          = !!wasCorrect;
      pick.revealedProbability = finalProbability;
      pick.probabilitySource   = finalSource;
      if (wasCorrect) pl.totalCorrect++;
      await this.state.storage.put('pickLedger', pl);
      await this._touchMeta(now);
      const resp = { ok: true, totalCorrect: pl.totalCorrect };
      if (finalProbability != null) {
        resp.resolvedProbability = finalProbability;
        resp.probabilitySource   = finalSource;
        resp.probabilityLabel    = finalLabel;
      }
      return new Response(JSON.stringify(resp), { headers: _cors() });
    }

    return new Response(JSON.stringify({ ok: false, error: `unknown event type: ${type}` }),
      { status: 400, headers: _cors() });
  }

  async _touchMeta(now) {
    const meta = await this.state.storage.get('meta');
    if (meta) await this.state.storage.put('meta', { ...meta, updatedAt: now });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function _recordWpResolutionFailure(env, sport, gameId, reason, opts = {}) {
    const { codexKey = 'wp-resolution-failures', titleLabel = 'WP resolution failed', predictedWinner } = opts;
    if (!env.ARCHIVE_DB) return;
    try {
        const existing = await env.ARCHIVE_DB.prepare(
            `SELECT content FROM codex WHERE key = ?`
        ).bind(codexKey).first();
        const prior = existing ? JSON.parse(existing.content || '{}') : { count: 0, recent: [] };
        const count = (prior.count || 0) + 1;
        // predictedWinner omitted entirely (not written as literal `undefined`)
        // when not provided, so both pre-change entries and any future caller
        // that doesn't pass it parse cleanly without implying false precision.
        const entry = { sport, gameId, reason, at: new Date().toISOString() };
        if (predictedWinner) entry.predictedWinner = predictedWinner;
        const recent = [entry, ...(prior.recent || [])].slice(0, 10);
        await env.ARCHIVE_DB.prepare(`
            INSERT INTO codex (key, category, title, content, status, updated_at)
            VALUES (?, 'incident', ?, ?, 'open', datetime('now'))
            ON CONFLICT(key) DO UPDATE SET
                title=excluded.title, content=excluded.content,
                status='open', updated_at=datetime('now')
        `).bind(
            codexKey,
            `${titleLabel} ${count}x (most recent: ${sport} ${gameId})`,
            JSON.stringify({ count, recent })
        ).run();
    } catch (_) { /* best-effort tracking, must never break pick resolution itself */ }
}

async function _sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// Obfuscate UUID for meta storage (first 8 chars only — not reversible to full UUID)
function _obfuscate(userId) {
  return userId.slice(0, 8) + '…';
}

function _cors() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };
}
