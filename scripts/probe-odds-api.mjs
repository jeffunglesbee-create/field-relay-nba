#!/usr/bin/env node
// Odds API probe. Read-only, and deliberately cheap.
//
// WHY: EPL and La Liga carry closing_odds but no opening_odds (measured
// 2026-08-21: has_open 0 / has_close 1 for both, while MLB 15/15, WNBA 3/3,
// Ligue 1 1/1). The sport-key maps are NOT the cause -- src/index.js:5947-5949
// has `epl` and `'la liga'`, and ambient-do.js:72,74 has both too. So the
// mapping hypothesis is already dead and this probe does not re-test it.
//
// Two live hypotheses, and they need different fixes, so guessing is expensive:
//
//   H1 TIMING. snapshotCronOdds builds its sport list from D1 at runtime --
//      `SELECT DISTINCT sport ... WHERE opening_odds IS NULL` -- so a
//      competition is only covered if its game rows already EXIST when the
//      snapshot runs. Today's odds_api change_log writes stop at 10:00:56. If
//      the EPL/La Liga rows were seeded after that, they simply were not in the
//      table yet and no amount of key-mapping would have helped.
//
//   H2 QUOTA SHORT-CIRCUIT. That same loop does `if (lastQuota < 50) return` --
//      a RETURN, not a continue. Every sport after the one that trips the floor
//      gets nothing, and the sport order comes from D1's DISTINCT. Soccer
//      landing late in that order would be silently starved on busy days.
//
// SECURITY: the key is read from env and never printed, never interpolated into
// logged output. Only counts, HTTP statuses and header-derived numbers are
// emitted. /v4/sports is the Odds API's documented ZERO-credit endpoint, so the
// quota read itself costs nothing (Rule 78).

import { writeFileSync } from 'node:fs';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const ODDS_KEY = process.env.ODDS_API_KEY || '';

async function d1(sql, params = []) {
    const r = await fetch(`${RELAY}/d1/execute`, {
        method: 'POST',
        headers: { 'X-FIELD-Relay': 'field-relay-cron-2026', 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ sql, params }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
    const j = JSON.parse(t);
    if (j.ok === false) throw new Error(`relay error: ${j.error}`);
    return j.results || [];
}

const m = {
    probed_at: new Date().toISOString(),
    query_ok: false,
    key_present: !!ODDS_KEY,          // presence only -- never the value
    quota: null,
    sport_keys_active: null,
    h1_timing: null,
    h2_order_and_quota: null,
    opening_by_sport_today: null,
    epl_laliga_history: null,
    error: null,
};

try {
    // ── H1: did the rows exist when the snapshot ran? ────────────────────────
    // Their own created_at against the last odds_api write of the day.
    m.h1_timing = await d1(
        `SELECT sport, id, created_at,
                CASE WHEN opening_odds IS NULL THEN 'NULL' ELSE 'set' END AS opening,
                CASE WHEN closing_odds IS NULL THEN 'NULL' ELSE 'set' END AS closing
         FROM regular_season_games
         WHERE date = '2026-08-21' AND sport IN ('EPL','La Liga','Ligue 1','MLB','WNBA')
         ORDER BY created_at ASC`);

    m.opening_by_sport_today = await d1(
        `SELECT c.source, COUNT(*) AS n, MIN(c.ts) AS first_, MAX(c.ts) AS last_
         FROM change_log c WHERE c.field = 'opening_odds' AND c.ts LIKE '2026-08-21%'
         GROUP BY c.source`);

    // ── H2: what the sport list looks like, in D1's own order ────────────────
    // Reproduces snapshotCronOdds' query exactly, so the ORDER it would iterate
    // is visible rather than assumed.
    m.h2_order_and_quota = await d1(
        `SELECT DISTINCT sport FROM regular_season_games
         WHERE date = '2026-08-21' AND opening_odds IS NULL AND sport IS NOT NULL`);

    // Have these two EVER had an opening line? If never, this is structural
    // rather than a bad day.
    m.epl_laliga_history = await d1(
        `SELECT sport,
                COUNT(*) AS rows_,
                SUM(CASE WHEN opening_odds IS NOT NULL THEN 1 ELSE 0 END) AS with_open,
                SUM(CASE WHEN closing_odds IS NOT NULL THEN 1 ELSE 0 END) AS with_close
         FROM regular_season_games
         WHERE sport IN ('EPL','La Liga','Ligue 1','MLS','MLB','WNBA')
         GROUP BY sport ORDER BY rows_ DESC`);
    m.query_ok = true;
} catch (e) { m.error = String(e.message || e); }

// ── Quota + sport availability (zero-credit endpoint) ───────────────────────
if (ODDS_KEY) {
    try {
        const r = await fetch(`https://api.the-odds-api.com/v4/sports?apiKey=${ODDS_KEY}`);
        m.quota = {
            http: r.status,
            remaining: parseInt(r.headers.get('x-requests-remaining') || '0', 10) || 0,
            used: parseInt(r.headers.get('x-requests-used') || '0', 10) || 0,
            floor: 50,   // ODDS_QUOTA_FLOOR, src/index.js:5960
        };
        m.quota.headroom_above_floor = m.quota.remaining - m.quota.floor;
        if (r.ok) {
            const list = await r.json();
            const want = ['soccer_epl', 'soccer_spain_la_liga', 'soccer_france_ligue_one',
                          'baseball_mlb', 'basketball_wnba'];
            m.sport_keys_active = want.map(k => {
                const hit = (list || []).find(s => s.key === k);
                return { key: k, present: !!hit, active: hit?.active ?? null };
            });
        }
    } catch (e) { m.quota = { error: String(e.message || e) }; }
} else {
    m.quota = { skipped: 'ODDS_API_KEY not in env — quota and sport-activity unread' };
}

const stamp = m.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const out = `outbox/odds-api-probe-${stamp}.json`;
writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
console.log(JSON.stringify(m, null, 2));
console.log(`\nwrote ${out}`);
if (!m.query_ok) { console.error('D1 QUERIES FAILED — says nothing about the data.'); process.exit(1); }
