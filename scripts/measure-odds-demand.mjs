#!/usr/bin/env node
// What would a ceiling derived from the WORK be, instead of from the plan?
//
// Every ceiling in this repo is a slice of the supply, by its own comment:
//   ODDS_DAILY_CEILING = 3800    "85K/month / ~22 active days"
//   ODDS_HARD_LIMIT    = 85000   "leaves 15K ... out of the 100K/month plan"
//   DAILY_CEILING      = 2700    derivation undocumented, tied to no work
//
// None is computed from how many games actually need odds. So a day that needs
// 80 credits and spends 3,565 is legal, and that is the measured shape: ~3,565
// a day sustained against a 3,800 ceiling.
//
// This computes the other number. Demand = sport-dates that still lack odds,
// times the per-call cost. It asserts nothing about what the ceiling SHOULD be;
// it puts the two figures side by side so the gap is a fact rather than a
// feeling.
//
// READ-ONLY. The d1 helper refuses any statement that is not a SELECT.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE  = process.env.RELAY_SHARED_SECRET;   // no default: an unset secret must 401, not look set
const PER_CALL_COST = 20;                        // odds-backfill.js:35 — 10 cr x 2 markets
const DAYS  = Number(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] || 7);

async function d1(sql, params = []) {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error(`refusing non-SELECT: ${sql.slice(0, 60)}`);
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!res.ok || body.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  const r = body.results || body.result || [];
  return Array.isArray(r) ? (r[0]?.results || r) : (r.results || []);
}

const since = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
console.log(`=== odds demand vs allowance  utc=${new Date().toISOString()} ===`);
console.log(`window: games dated >= ${since}   PER_CALL_COST=${PER_CALL_COST}\n`);

// Demand is per SPORT-DATE, because that is the unit the vendor bills. A date
// with 40 games in one sport costs one call, not forty.
const rows = await d1(
  `SELECT date, LOWER(sport) AS sport, COUNT(*) AS games,
          SUM(CASE WHEN opening_odds IS NULL THEN 1 ELSE 0 END) AS missing
     FROM regular_season_games
    WHERE date >= ?
    GROUP BY date, LOWER(sport)
    ORDER BY date DESC, sport`, [since]);

if (!rows.length) {
  console.log(`FAIL: no rows since ${since}. An absent denominator is not a demand of zero.`);
  process.exit(1);
}

const byDate = new Map();
for (const r of rows) {
  const need = Number(r.missing) > 0;
  const e = byDate.get(r.date) || { pairs: 0, needPairs: 0, games: 0, missing: 0 };
  e.pairs++; if (need) e.needPairs++;
  e.games += Number(r.games); e.missing += Number(r.missing);
  byDate.set(r.date, e);
}

const ALLOWANCE = 3800;   // src/budget-helpers.js ODDS_DAILY_CEILING
console.log(`  date         sport-dates  needing odds   games missing   DEMAND   allowance   ratio`);
let totalDemand = 0;
for (const [date, e] of [...byDate.entries()].sort().reverse()) {
  const demand = e.needPairs * PER_CALL_COST;
  totalDemand += demand;
  const ratio = demand ? (ALLOWANCE / demand).toFixed(0) + 'x' : '—';
  console.log(`  ${date}   ${String(e.pairs).padStart(11)}  ${String(e.needPairs).padStart(12)}`
    + `  ${String(e.missing).padStart(13)}   ${String(demand).padStart(6)}   ${String(ALLOWANCE).padStart(9)}   ${ratio.padStart(5)}`);
}

console.log(`\n  total demand over ${byDate.size} day(s)   : ${totalDemand} credits`);
console.log(`  allowance over the same days  : ${ALLOWANCE * byDate.size} credits`);
console.log(`  the allowance exceeds the work by a factor of `
  + `${totalDemand ? (ALLOWANCE * byDate.size / totalDemand).toFixed(1) : 'undefined (demand is 0)'}`);

console.log(`\nCOVERAGE: regular_season_games only. postseason_games would add to BOTH`);
console.log(`sides. Demand counts sport-dates with at least one NULL opening_odds — it is`);
console.log(`what a fetch would COST, not what the vendor actually holds. A sport-date the`);
console.log(`vendor has no data for still costs 20 and fills nothing, so this is a floor on`);
console.log(`spend and a ceiling on value. It proposes no number; it prints two.`);
