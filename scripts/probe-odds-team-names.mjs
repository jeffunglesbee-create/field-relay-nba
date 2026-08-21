#!/usr/bin/env node
// Scoped strictly to the odds join. Read-only, no Odds API key used.
//
// Diagnosis so far, from source rather than guesswork: the alias table in
// src/identity-resolver.js has sections for WC/International, EPL, MLS, WNBA,
// MLB, NBA and Ligue 1 -- and NO La Liga section at all. That matches today
// exactly: Ligue 1 (Marseille/Strasbourg) matched, La Liga did not. EPL has 12
// clubs listed and neither Arsenal nor Coventry, and Coventry were promoted for
// 2026-27, so the EPL list is stale for the new intake.
//
// TWO THINGS TO SETTLE BEFORE WRITING ANY ALIAS.
//
// 1. MY OWN "MLS IS THE VOLUME CASE" CLAIM IS PROBABLY WRONG. MLS has all 30
//    clubs aliased and still read 108/548 = 20%. But MLS is the one competition
//    pre-seeded months ahead, so that denominator is full of FUTURE fixtures
//    that legitimately have no opening line yet. Re-measured here against past
//    dates only. If the past-only rate is high, MLS is fine and I mis-sized it.
//
// 2. WHAT D1 ACTUALLY STORES. An alias table needs the real strings, not
//    remembered ones. This dumps the distinct home/away names D1 holds for the
//    competitions with no coverage, which is the half of each mapping that can
//    be established without the Odds API key.
//
// What this deliberately does NOT do: invent the Odds API side of the mapping.
// That requires reading their canonical names, which requires the key, which is
// exposed and must be rotated first. Writing aliases against remembered names
// would be exactly the invention Rule 2 forbids.

import { writeFileSync } from 'node:fs';
const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
async function d1(sql, params = []) {
    const r = await fetch(`${RELAY}/d1/execute`, { method: 'POST',
        headers: { 'X-FIELD-Relay': 'field-relay-cron-2026', 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ sql, params }) });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
    const j = JSON.parse(t);
    if (j.ok === false) throw new Error(`relay error: ${j.error}`);
    return j.results || [];
}
const m = { probed_at: new Date().toISOString(), query_ok: false };
try {
    // 1. Coverage on PAST dates only -- the honest denominator.
    m.coverage_past_only = await d1(
        `SELECT sport, COUNT(*) AS played_rows,
                SUM(CASE WHEN opening_odds IS NOT NULL THEN 1 ELSE 0 END) AS with_open,
                ROUND(100.0 * SUM(CASE WHEN opening_odds IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct
         FROM regular_season_games
         WHERE date < date('now') AND sport IN ('MLS','EPL','La Liga','Ligue 1','MLB','WNBA')
         GROUP BY sport ORDER BY played_rows DESC`);

    // Same split for MLS specifically, past vs future, to show the effect.
    m.mls_past_vs_future = await d1(
        `SELECT CASE WHEN date < date('now') THEN 'played' ELSE 'future' END AS bucket,
                COUNT(*) AS n,
                SUM(CASE WHEN opening_odds IS NOT NULL THEN 1 ELSE 0 END) AS with_open
         FROM regular_season_games WHERE sport = 'MLS' GROUP BY bucket`);

    // 2. The real D1 strings for the uncovered competitions.
    m.laliga_names = await d1(
        `SELECT DISTINCT home AS team FROM regular_season_games WHERE sport = 'La Liga'
         UNION SELECT DISTINCT away FROM regular_season_games WHERE sport = 'La Liga'
         ORDER BY team`);
    m.epl_names = await d1(
        `SELECT DISTINCT home AS team FROM regular_season_games WHERE sport = 'EPL'
         UNION SELECT DISTINCT away FROM regular_season_games WHERE sport = 'EPL'
         ORDER BY team`);
    m.query_ok = true;
} catch (e) { m.error = String(e.message || e); }
const stamp = m.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const out = `outbox/odds-team-names-${stamp}.json`;
writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
console.log(JSON.stringify(m, null, 2));
console.log(`\nwrote ${out}`);
if (!m.query_ok) process.exit(1);
