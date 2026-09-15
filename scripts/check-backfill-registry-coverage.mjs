// The backfill has a FOURTH sport-key registry, and nothing knew.
//
// src/odds-sport-keys.js calls itself "the one place a sport's Odds API key is
// written down" and documents three tables: ARCHIVE (16), CRON (6), AMBIENT (11).
// `.github/scripts/odds-backfill.js` line 48 declares its own private
// SPORT_TO_ODDS_KEY with EIGHT entries, imports none of them, and that table is
// what decides which games the historical backfill will even attempt.
//
// It contains no American football key of any kind — not cfb, not nfl, not cfl,
// not ufl — while ARCHIVE carries all four. So every CFB game is dropped at the
// candidate filter (odds-backfill.js:278) before a single fetch, which is why
// 177 CFB games dated >= 2026-09-01 have no odds_history row at all.
//
// THE PART WORTH RECORDING: src/odds-sport-keys.js's own header says
//
//   "MLS, Bundesliga, CFB and NFL resolve through these tables and still
//    receive nothing; the cause is downstream of every table here."
//
// A prior session checked the three DOCUMENTED tables, found CFB present in
// ARCHIVE, and concluded the cause must be downstream. It was upstream — in a
// table that file does not mention, in a directory it does not look at. Reading
// the registry that is written down is not the same as reading the registry
// that runs (Rule 100: source versus copy).
//
// This check fails when the backfill's private table cannot serve a sport the
// archive actually stores games for, so the divergence cannot widen silently.
// It does NOT propose adding keys: each added sport costs 10 credits x region x
// market per sport-date on a metered account (Rule 78), which is a budget
// decision and not a script's to make.
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

// Parsed from source rather than imported: odds-backfill.js is a script with
// top-level side effects, so importing it would run the backfill.
function backfillRegistry() {
  const src = fs.readFileSync('.github/scripts/odds-backfill.js', 'utf8');
  const m = src.match(/const SPORT_TO_ODDS_KEY = \{([\s\S]*?)\n\};/);
  if (!m) throw new Error('SPORT_TO_ODDS_KEY not found in odds-backfill.js — the anchor moved');
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*'([^']+)':\s*'([^']+)'/);
    if (kv) out[kv[1]] = kv[2];
  }
  if (!Object.keys(out).length) throw new Error('parsed zero entries — refusing to report coverage');
  return out;
}

(async () => {
  console.log(`=== backfill registry coverage  utc=${new Date().toISOString()} ===\n`);

  const { ARCHIVE_SPORT_TO_ODDS_KEY: ARCHIVE } =
    await import('../src/odds-sport-keys.js');
  const BACKFILL = backfillRegistry();

  console.log(`ARCHIVE_SPORT_TO_ODDS_KEY (src/odds-sport-keys.js) : ${Object.keys(ARCHIVE).length} keys`);
  console.log(`SPORT_TO_ODDS_KEY (.github/scripts/odds-backfill.js): ${Object.keys(BACKFILL).length} keys\n`);

  // The backfill keys on the archive's `sport` column verbatim and
  // case-sensitively; ARCHIVE lowercases and looks up case-insensitively.
  const bfLower = new Set(Object.keys(BACKFILL).map(k => k.toLowerCase()));
  const missing = Object.keys(ARCHIVE).filter(k => !bfLower.has(k));

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

  if (missing.length) {
    console.log(`\nFAIL — ${missing.length} archive sport(s) unreachable by the backfill.`);
    process.exit(1);
  }
  console.log(`\nPASS — the backfill can name every sport the archive has a key for.`);
})().catch(e => { console.error(`ERROR ${e.message}`); process.exit(1); });
