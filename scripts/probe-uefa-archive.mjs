#!/usr/bin/env node
// CI-as-proxy probe: did the UEFA club competitions actually reach the archive?
//
// WHY THIS EXISTS (CC-CMD-2026-08-20-uefa-club-competitions):
// The fix added six UEFA rows to the cron LEAGUES table so the journalism
// cycle's pre-game seed writes them into ARCHIVE_DB.regular_season_games,
// which is the ONLY thing /context/date reads. That code path was argued from
// source but never observed live, because:
//
//   * the sandbox 403s *.workers.dev, so no direct curl;
//   * the GET self-probe cannot filter the games table, and /context/date
//     returns ~155 KB (truncated before any UEFA row is visible) behind a
//     Cache-Control: max-age=300 that made two reads byte-identical;
//   * /archive/query?sport=... reads the BRIEFS table, not games -- the trap
//     that made both the CC-CMD's evidence and this session's first
//     done-condition probe non-answers.
//
// A GitHub runner has unrestricted egress and can POST /d1/execute, so it can
// count the actual rows. This is the Rule 90 CI-as-proxy pattern: the artifact
// is a committed manifest of booleans and counts, not a prose "looks right".
//
// Reports rows-not-yet-present as landed:false with a NON-ZERO exit ONLY when
// --strict is passed. Default is exit 0 so a scheduled/dispatch run records the
// state without a red X on a day that legitimately has no UEFA fixtures.

import { writeFileSync } from 'node:fs';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const STRICT = process.argv.includes('--strict');

// Must match SOCCER_LEAGUE_LABELS / the cron LEAGUES rows exactly.
const EXPECTED = [
    'UEFA Champions League',
    'UEFA Europa League',
    'UEFA Europa Conference League',
    'UEFA Champions League Qualifying',
    'UEFA Europa League Qualifying',
    'UEFA Europa Conference League Qualifying',
];

async function d1(sql, params = []) {
    const r = await fetch(`${RELAY}/d1/execute`, {
        method: 'POST',
        headers: {
            'X-FIELD-Relay': 'field-relay-cron-2026',
            'Content-Type': 'application/json',
            'User-Agent': UA,   // bare/default UA is 403'd at the CF edge
        },
        body: JSON.stringify({ sql, params }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
    let j;
    try { j = JSON.parse(text); }
    catch { throw new Error(`non-JSON response: ${text.slice(0, 300)}`); }
    return j.results || [];
}

const today = new Date().toISOString().slice(0, 10);
const manifest = {
    probed_at: new Date().toISOString(),
    date_probed: today,
    expected_labels: EXPECTED,
    query_ok: false,
    landed: false,
    uefa_rows_total: null,
    uefa_rows_today: null,
    labels_present: [],
    labels_missing: null,
    sample: [],
    // Distinguishes "the archive genuinely has none" from "the probe broke".
    // A null count with query_ok:false is NOT evidence about the archive.
    error: null,
};

try {
    // LIKE 'UEFA%' rather than an IN over EXPECTED on purpose: if a label ever
    // drifts, this still finds the row and labels_present shows the real string,
    // which is the thing worth knowing. An exact IN would silently report zero.
    const total = await d1(
        `SELECT COUNT(*) AS n FROM regular_season_games WHERE sport LIKE 'UEFA%'`);
    const todayRows = await d1(
        `SELECT COUNT(*) AS n FROM regular_season_games WHERE sport LIKE 'UEFA%' AND date = ?`,
        [today]);
    const labels = await d1(
        `SELECT sport, COUNT(*) AS n FROM regular_season_games
         WHERE sport LIKE 'UEFA%' GROUP BY sport ORDER BY n DESC`);
    const sample = await d1(
        `SELECT id, sport, date, home, away, venue, start_time
         FROM regular_season_games WHERE sport LIKE 'UEFA%'
         ORDER BY date DESC LIMIT 5`);

    manifest.query_ok = true;
    manifest.uefa_rows_total = total[0]?.n ?? 0;
    manifest.uefa_rows_today = todayRows[0]?.n ?? 0;
    manifest.labels_present = labels.map(r => ({ sport: r.sport, rows: r.n }));
    manifest.labels_missing = EXPECTED.filter(l => !labels.some(r => r.sport === l));
    manifest.sample = sample;
    manifest.landed = manifest.uefa_rows_total > 0;
} catch (e) {
    manifest.error = String(e.message || e);
}

const stamp = manifest.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const out = `outbox/uefa-archive-probe-manifest-${stamp}.json`;
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');

console.log(JSON.stringify(manifest, null, 2));
console.log(`\nwrote ${out}`);

if (!manifest.query_ok) {
    console.error('PROBE FAILED — the query did not run. This says nothing about the archive.');
    process.exit(1);
}
if (manifest.landed) {
    console.log(`PASS: ${manifest.uefa_rows_total} UEFA row(s) archived `
              + `(${manifest.uefa_rows_today} dated ${today}); `
              + `labels seen: ${manifest.labels_present.map(l => l.sport).join(', ')}`);
    process.exit(0);
}
console.log('landed=false — no UEFA rows in regular_season_games yet.');
if (STRICT) { console.error('--strict: failing.'); process.exit(1); }
process.exit(0);
