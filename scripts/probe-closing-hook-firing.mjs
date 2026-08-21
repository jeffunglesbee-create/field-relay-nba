#!/usr/bin/env node
// Has AmbientDO._captureClosingOdds EVER fired? Read-only.
//
// The backfill gate (887c843) is necessary but the live desk shows it is not
// sufficient. Arsenal v Coventry and Betis v Real Sociedad both render "one
// snapshot" -- opening only, closing_odds NULL -- and both are Final. The
// column was FREE for them; the batch never touched today's soccer. So the
// hook had an open lane and still did not write.
//
// change_log is the witness: _captureClosingOdds inserts source
// 'closing_odds_capture' on every successful write. Zero rows means the hook
// has never landed once, and the backfill was masking a second, independent
// defect rather than causing this one.
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
    m.change_log_by_source = await d1(
        `SELECT source, COUNT(*) AS n, MAX(ts) AS last_ts FROM change_log
         GROUP BY source ORDER BY n DESC`);
    m.capture_events = await d1(
        `SELECT COUNT(*) AS n, MIN(ts) AS first_, MAX(ts) AS last_ FROM change_log
         WHERE source = 'closing_odds_capture'`);
    // Today's soccer: is closing really NULL while opening is set?
    m.today_odds_state = await d1(
        `SELECT sport, COUNT(*) AS n,
                SUM(CASE WHEN opening_odds IS NOT NULL THEN 1 ELSE 0 END) AS has_open,
                SUM(CASE WHEN closing_odds IS NOT NULL THEN 1 ELSE 0 END) AS has_close
         FROM regular_season_games WHERE date = '2026-08-21' GROUP BY sport ORDER BY n DESC`);
    m.query_ok = true;
} catch (e) { m.error = String(e.message || e); }
const stamp = m.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const out = `outbox/closing-hook-firing-${stamp}.json`;
writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
console.log(JSON.stringify(m, null, 2));
console.log(`\nwrote ${out}`);
if (!m.query_ok) process.exit(1);
