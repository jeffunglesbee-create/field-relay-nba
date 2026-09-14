#!/usr/bin/env node
// CAN THESE ROWS EVER RECEIVE ODDS?
//
// The same-slate collision check exists to stop a false ODDS fact: two rows the
// odds join cannot tell apart. The 82 postseason escalations carry no odds at
// all, and their leagues are not MLS — CONCACAF Champions Cup, U.S. Open Cup,
// TELUS Canadian Championship — filed under `sport = MLS`.
//
// runOddsBackfillForDate buckets by SPORT, so those rows are matched against a
// `soccer_usa_mls` payload, which carries league fixtures. If no row of those
// leagues has EVER received odds while MLS-league rows have, the collision
// between them cannot produce a false odds fact and the check is catching them
// by proxy rather than by cause.
//
// Asserted nowhere; measured here. SELECTs only.
import { writeFileSync } from 'node:fs';
const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function d1(sql) {
  if (!GATE) throw new Error('RELAY_SHARED_SECRET is not set');
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('SELECTs only');
  const r = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE, 'User-Agent': UA },
    body: JSON.stringify({ sql, params: [] }),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || b.success === false) throw new Error(`d1 HTTP ${r.status}: ${JSON.stringify(b).slice(0, 300)}`);
  return b.results || [];
}

(async () => {
  const out = {};
  for (const table of ['postseason_games', 'regular_season_games']) {
    out[table] = await d1(
      `SELECT COALESCE(league,'(null)') AS league, COUNT(*) AS rows,
              SUM(CASE WHEN opening_odds IS NOT NULL THEN 1 ELSE 0 END) AS with_opening,
              SUM(CASE WHEN closing_odds IS NOT NULL THEN 1 ELSE 0 END) AS with_closing,
              MIN(date) AS first_date, MAX(date) AS last_date
         FROM ${table} WHERE sport = 'MLS' GROUP BY COALESCE(league,'(null)') ORDER BY rows DESC`);
    console.log(`\n=== ${table}, sport = 'MLS'`);
    console.log('league'.padEnd(34) + 'rows  open  close  dates');
    for (const r of out[table]) {
      console.log(String(r.league).padEnd(34)
        + String(r.rows).padStart(4) + String(r.with_opening).padStart(6)
        + String(r.with_closing).padStart(7) + '  ' + r.first_date + '..' + r.last_date);
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const p = `outbox/odds-reachability-by-league-${stamp}.json`;
  writeFileSync(p, JSON.stringify({ checked_at: new Date().toISOString(), by_table: out }, null, 2));
  console.log(`\nwrote ${p}`);
})().catch(e => { console.error(`FAILED: ${e.message}`); process.exit(1); });
