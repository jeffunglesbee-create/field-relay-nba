// What does resetting odds_backfill_progress ACTUALLY cost?
//
// THE GRANULARITY MISMATCH, which is the whole point of this script:
//
//   the gap is per SPORT-DATE  — 12 sports became reachable on 2026-09-15
//   the progress table is per DATE — odds_backfill_progress PRIMARY KEY (date)
//
// processDate() filters candidates by key-mappability alone and groups by sport
// (.github/scripts/odds-backfill.js ~278). It has NO per-game "already has an
// odds_history row" skip. So deleting one progress row re-fetches EVERY mappable
// sport on that date — MLB, MLS, EPL included — not just the newly-reachable
// ones. INSERT OR IGNORE keeps the data honest; the credits are spent anyway.
//
// The earlier 3,500-credit figure (run 35017010215) was the cost of the GAP:
// 175 stranded sport-date pairs x 20. It is NOT the cost of a date-level reset,
// and quoting it for that would be the same substitution this session keeps
// finding. This measures both, and the difference between them is the waste.
//
// READ-ONLY. The d1 helper rejects any statement that is not a SELECT.

import { backfillSportToOddsKey } from '../src/odds-sport-keys.js';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SINCE = process.argv.find(a => a.startsWith('--since='))?.split('=')[1] || '2026-05-09';
const PER_CALL_COST = 20;   // odds-backfill.js:35

// The twelve that became reachable on 2026-09-15: ten by deleting the fourth
// registry, two by adding vendor-verified cup keys.
const NEWLY_REACHABLE = new Set([
  'la liga', 'ligue 1', 'bundesliga', 'serie a', 'cfl', 'cfb', 'nfl', 'ufl', 'afl', 'ipl',
  'uefa champions league', 'efl cup',
]);

async function d1(sql, params = []) {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error(`refusing non-SELECT: ${sql.slice(0, 80)}`);
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!res.ok || body.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  const r = body.results || body.result || [];
  return Array.isArray(r) ? (r[0]?.results || r) : (r.results || []);
}

console.log(`=== progress reset cost  utc=${new Date().toISOString()} ===`);
console.log(`window: games dated >= ${SINCE}   PER_CALL_COST=${PER_CALL_COST}\n`);

const rows = await d1(
  `SELECT DISTINCT LOWER(sport) AS s, date FROM regular_season_games WHERE date >= ?`, [SINCE]);
if (!rows.length) { console.log('no rows — refusing to report a cost'); process.exit(1); }

const mappable = rows.filter(r => !!backfillSportToOddsKey(r.s));
const newPairs = mappable.filter(r => NEWLY_REACHABLE.has(r.s));
const datesTouched = new Set(newPairs.map(r => r.date));
const rerunPairs = mappable.filter(r => datesTouched.has(r.date));
const wastePairs = rerunPairs.length - newPairs.length;

const fmt = (n) => `${String(n).padStart(4)} pairs = ${String(n * PER_CALL_COST).padStart(6)} credits`;
console.log(`  newly-reachable sport-dates (the actual gap)   : ${fmt(newPairs.length)}`);
console.log(`  dates those fall on                            : ${datesTouched.size}`);
console.log(`  ALL mappable sport-dates on those dates        : ${fmt(rerunPairs.length)}`);
console.log(`  -> re-fetched despite already being complete   : ${fmt(wastePairs)}`);
console.log(`\n  a date-level reset costs ${(rerunPairs.length / Math.max(newPairs.length, 1)).toFixed(1)}x the gap it closes.`);

const bySport = {};
for (const r of rerunPairs) if (!NEWLY_REACHABLE.has(r.s)) bySport[r.s] = (bySport[r.s] || 0) + 1;
const waste = Object.entries(bySport).sort((a, b) => b[1] - a[1]);
if (waste.length) {
  console.log(`\n  the re-fetch, by sport that is already complete:`);
  for (const [s, n] of waste) console.log(`      ${String(n).padStart(4)}  ${s}`);
}

console.log(`\nCOVERAGE: regular_season_games only, dated >= ${SINCE}. postseason_games`);
console.log(`would add more on both sides. Counts REACHABILITY and billing shape, not`);
console.log(`whether the vendor holds data for any given fixture — a fetch that returns`);
console.log(`nothing still bills.`);
console.log(`\nNOTE: this prices the date-level reset only. A targeted fill that asks for`);
console.log(`the ${newPairs.length} new pairs alone would cost ${newPairs.length * PER_CALL_COST} credits and needs no progress`);
console.log(`reset — but it is a NEW live write path, which is a separate authorisation.`);
