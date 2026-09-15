// The backfill HAD a fourth sport-key registry. This is what stops it returning.
//
// src/odds-sport-keys.js calls itself "the one place a sport's Odds API key is
// written down" and documented three tables: ARCHIVE (16), CRON (6), AMBIENT (11).
// `.github/scripts/odds-backfill.js` carried a private eight-entry
// SPORT_TO_ODDS_KEY, imported none of them, and that table decided what the
// historical backfill would even attempt. It held no American football key of
// any kind, so every CFB game was dropped at the candidate filter before a
// single fetch — 177 of them dated 2026-09-01 alone.
//
// THE PART WORTH RECORDING: src/odds-sport-keys.js's own header said
//
//   "MLS, Bundesliga, CFB and NFL resolve through these tables and still
//    receive nothing; the cause is downstream of every table here."
//
// A prior session checked the three DOCUMENTED tables, found CFB present in
// ARCHIVE, and concluded the cause must be downstream. It was upstream — in a
// table that file did not mention, in a directory it did not look at. Reading
// the registry that is written down is not the same as reading the registry
// that runs (Rule 100: source versus copy).
//
// The private table is now deleted and the lookup lives in the canonical module
// as backfillSportToOddsKey(). This check asserts BOTH halves: that no private
// registry has come back, and that the real function reaches every archive
// sport. It asks the function rather than copying its table, because a copy
// here would be the fifth registry.
//
// READ-ONLY.

import fs from 'node:fs';
import { createRequire } from 'node:module';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SINCE = process.argv.find(a => a.startsWith('--since='))?.split('=')[1] || '2026-09-01';

async function d1(sql, params = []) {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error(`refusing non-SELECT: ${sql.slice(0, 80)}`);
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!res.ok || body.success === false) {
    throw new Error(`d1 exec failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 400)}`);
  }
  const r = body.results || body.result || [];
  return Array.isArray(r) ? (r[0]?.results || r) : (r.results || []);
}

// The private table is GONE (see the file header). What this now guards is that
// it does not come back: the script must carry no registry literal of its own
// and must import the canonical lookup. Parsing source is the only option —
// importing odds-backfill.js would run the backfill.
function assertNoPrivateRegistry() {
  const src = fs.readFileSync('.github/scripts/odds-backfill.js', 'utf8');
  const problems = [];
  if (/const\s+SPORT_TO_ODDS_KEY\s*=\s*\{/.test(src))
    problems.push('a private SPORT_TO_ODDS_KEY literal is back');
  if (/const\s+\w*EXTRA_SPORT_KEYS\s*=\s*\{/.test(src))
    problems.push('a local EXTRA_SPORT_KEYS literal is back (it belongs in src/odds-sport-keys.js)');
  if (!/import\s*\{[^}]*backfillSportToOddsKey[^}]*\}\s*from\s*'\.\.\/\.\.\/src\/odds-sport-keys\.js'/.test(src))
    problems.push('does not import backfillSportToOddsKey from the canonical module');
  return problems;
}

(async () => {
  console.log(`=== backfill registry coverage  utc=${new Date().toISOString()} ===\n`);

  const { ARCHIVE_SPORT_TO_ODDS_KEY: ARCHIVE, backfillSportToOddsKey } =
    await import('../src/odds-sport-keys.js');

  const structural = assertNoPrivateRegistry();
  for (const p of structural) console.log(`FAIL  ${p}`);
  console.log(`structural: ${structural.length ? structural.length + ' problem(s)' : 'no private registry, imports the canonical lookup'}\n`);

  // Reachability is asked of the REAL function the backfill calls, not of a
  // table this script copied. A copy here would be the fifth registry.
  const reach = k => !!backfillSportToOddsKey(k);
  const bfLower = new Set(Object.keys(ARCHIVE).filter(reach));
  const missing = Object.keys(ARCHIVE).filter(k => !reach(k));

  console.log(`sports the archive has a key for that the backfill CANNOT fetch: ${missing.length}`);
  console.log(`  ${missing.join(', ')}\n`);

  // How much does that actually cost? Count the games sitting behind each gap.
  const rows = await d1(
    `SELECT LOWER(sport) AS s, COUNT(*) AS n,
            SUM(CASE WHEN opening_odds IS NULL THEN 1 ELSE 0 END) AS null_open
       FROM regular_season_games
      WHERE date >= ?
      GROUP BY s ORDER BY n DESC`, [SINCE]);

  console.log(`regular_season_games dated >= ${SINCE}, by sport column:`);
  let strandedGames = 0, strandedNull = 0;
  for (const r of rows) {
    const reach = bfLower.has(r.s) ? 'backfill CAN fetch'
                : ARCHIVE[r.s]     ? 'STRANDED — archive has a key, backfill does not'
                : 'no key in either table';
    if (reach.startsWith('STRANDED')) { strandedGames += r.n; strandedNull += r.null_open; }
    console.log(`  ${String(r.n).padStart(4)} games  ${String(r.null_open).padStart(4)} null  ${String(r.s).padEnd(12)} ${reach}`);
  }

  console.log(`\nSTRANDED TOTAL: ${strandedGames} games, ${strandedNull} with opening_odds NULL,`);
  console.log(`in sports the vendor sells and the archive knows the key for, which the`);
  console.log(`backfill's private table cannot name.`);

  console.log(`\nCOVERAGE: regular_season_games only, dated >= ${SINCE}. postseason_games`);
  console.log(`and earlier dates are not counted here. This reports REACHABILITY, not`);
  console.log(`whether the vendor actually has data for any given fixture.`);

  // ── What would closing the gap actually cost? ─────────────────────────────
  // PER_CALL_COST = 20 (odds-backfill.js:35 — 10 credits x 2 markets, regions=us),
  // billed once per SPORT-DATE, not per game. So the outlay is the number of new
  // sport-date pairs, times 20 — and a sport with 177 games on 15 dates costs the
  // same as a sport with 15.
  const PER_CALL_COST = 20;
  const strandedSports = missing.filter(k => ARCHIVE[k]);
  if (!strandedSports.length) {
    // Nothing stranded means nothing to cost. Said explicitly rather than
    // printing a table of zeros, and short-circuited because `IN ()` is a
    // syntax error, not an empty set.
    console.log(`\n── PROPOSED OUTLAY ──`);
    console.log(`  none: no archive sport is unreachable, so there is no gap to close.`);
    console.log(`  The spend this replaces was measured at 67 credits/day before the`);
    console.log(`  registry was unified (run 35017010215); that is now the live rate.`);
  } else {
  const inList = strandedSports.map(() => '?').join(',');

  const [allTime] = await d1(
    `SELECT COUNT(*) AS pairs FROM (
       SELECT DISTINCT LOWER(sport) AS s, date FROM regular_season_games
        WHERE LOWER(sport) IN (${inList}))`, strandedSports);

  const [last14] = await d1(
    `SELECT COUNT(*) AS pairs FROM (
       SELECT DISTINCT LOWER(sport) AS s, date FROM regular_season_games
        WHERE LOWER(sport) IN (${inList})
          AND date >= date('now','-14 day') AND date < date('now'))`, strandedSports);

  const [since] = await d1(
    `SELECT COUNT(*) AS pairs FROM (
       SELECT DISTINCT LOWER(sport) AS s, date FROM regular_season_games
        WHERE LOWER(sport) IN (${inList}) AND date >= ?)`, [...strandedSports, SINCE]);

  console.log(`\n── PROPOSED OUTLAY (PER_CALL_COST=${PER_CALL_COST} per sport-date) ──`);
  console.log(`  one-time, every archived date         : ${allTime.pairs} pairs = ${allTime.pairs * PER_CALL_COST} credits`);
  console.log(`  one-time, dates >= ${SINCE}       : ${since.pairs} pairs = ${since.pairs * PER_CALL_COST} credits`);
  console.log(`  ongoing, last 14 complete days        : ${last14.pairs} pairs = ${last14.pairs * PER_CALL_COST} credits`);
  console.log(`  ongoing, implied per-day run rate     : ${(last14.pairs / 14).toFixed(1)} pairs = ${Math.round(last14.pairs / 14 * PER_CALL_COST)} credits/day`);
  console.log(`\n  The per-day figure is the one that recurs. The one-time figures are`);
  console.log(`  only spent if odds_backfill_progress is reset for those dates —`);
  console.log(`  adding keys alone backfills NOTHING, because every past date is`);
  console.log(`  already recorded complete (odds-backfill.js:389 counts`);
  console.log(`  no_mappable_sports as done).`);
  console.log(`\n  COVERAGE: regular_season_games only. postseason_games would add`);
  console.log(`  more pairs and is not counted. Backward-looking: a sport's future`);
  console.log(`  fixtures are not in the archive yet, so the run rate is a proxy`);
  console.log(`  from recent history, not a forecast.`);
  }

  if (missing.length || structural.length) {
    console.log(`\nFAIL — ${missing.length} unreachable sport(s), ${structural.length} structural problem(s).`);
    process.exit(1);
  }
  console.log(`\nPASS — no private registry, and the backfill reaches all ${Object.keys(ARCHIVE).length} archive sports.`);
  console.log(`       WC aliases: ${backfillSportToOddsKey('FIFA World Cup') || 'MISSING'}`);
})().catch(e => { console.error(`ERROR ${e.message}`); process.exit(1); });
