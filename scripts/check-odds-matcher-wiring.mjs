#!/usr/bin/env node
// The structural half: every odds writer imports src/odds-name-match.js and
// none of them keeps a private matcher or price reader.
//
// check-odds-matcher.mjs proves the module is CORRECT. It cannot prove anyone
// USES it — the fourth sport-key registry (deleted 2026-09-15) sat beside a
// correct shared lookup for 73 days. This is the check that would have caught
// that one, aimed at the matcher instead.

import fs from 'node:fs';

const CONSUMERS = [
  '.github/scripts/odds-backfill.js',
  'scripts/targeted-odds-fill.mjs',
];

// Each pattern is a way a private copy comes back. The message says what the
// copy would BE, because "regex matched" is not a finding.
const BANNED = [
  [/function\s+normTeam\s*\(/,                        'a private normTeam() is back'],
  [/norm\w*\(\s*e\.home_team\s*\)\s*===/,             'whole-string equality on home_team — the matcher that scored 0 of 80'],
  [/events\.find\(\s*e\s*=>/,                         'a local events.find() matcher instead of matchSlate'],
  [/findVendorEvent\s*\(/,                            'per-GAME matching, which cannot pair an initialism by elimination'],
  [/outcomes[\s\S]{0,40}?\.find\(\s*o\s*=>[\s\S]{0,80}?home_team/, 'a local h2h price lookup instead of h2hPrices'],
];

let failed = 0;
console.log('=== odds matcher wiring ===\n');

for (const f of CONSUMERS) {
  const src = fs.readFileSync(f, 'utf8');
  const imports = /import\s*\{[^}]*\bmatchSlate\b[^}]*\}\s*from\s*'[^']*odds-name-match\.js'/.test(src);
  imports ? console.log(`  PASS  ${f} imports matchSlate from the shared module`)
          : (failed++, console.log(`  FAIL  ${f} does not import matchSlate`));

  // Importing is not using. A call site can carry the import and still pair
  // nothing — mutation M13 does exactly that, and an import-only check passes it.
  const calls = /\bmatchSlate\s*\(/.test(src);
  calls ? console.log(`  PASS  ${f} actually calls matchSlate`)
        : (failed++, console.log(`  FAIL  ${f} imports matchSlate but never calls it`));

  const prices = /\bh2hPrices\s*\(/.test(src);
  prices ? console.log(`  PASS  ${f} reads prices through h2hPrices`)
         : (failed++, console.log(`  FAIL  ${f} does not call h2hPrices`));

  for (const [re, what] of BANNED) {
    re.test(src) ? (failed++, console.log(`  FAIL  ${f}: ${what}`))
                 : console.log(`  PASS  ${f}: no ${what.replace(/ is back$| — .*$/, '')}`);
  }
}

// THE SYNC GIVES EACH TEAM ITS OWN PRICE (docs/CC-CMD-2026-10-19-cfb-stage2-wrong-pair.md
// task 2). syncOddsToGameTables wrote `home: decimalToAmerican(row.home_ml)` by
// position, and a swapped pairing gave Virginia West Virginia's +870. The price
// must be re-keyed through pricesByTeam, whose behaviour check-odds-matcher.mjs
// tests on that real row; this check holds the sync to calling it.
{
  const f = '.github/scripts/odds-backfill.js';
  const src = fs.readFileSync(f, 'utf8');
  const at = src.indexOf('async function syncOddsToGameTables');
  const body = at > -1 ? src.slice(at) : '';
  if (!body) { failed++; console.log(`  FAIL  ${f}: syncOddsToGameTables not found — nothing to check`); }
  else {
    /\bpricesByTeam\s*\(/.test(body)
      ? console.log(`  PASS  ${f}: the sync re-keys prices through pricesByTeam`)
      : (failed++, console.log(`  FAIL  ${f}: the sync does not call pricesByTeam`));
    /decimalToAmerican\(\s*row\.(home|away)_ml\s*\)/.test(body)
      ? (failed++, console.log(`  FAIL  ${f}: the sync converts row.home_ml / row.away_ml by position`))
      : console.log(`  PASS  ${f}: the sync does not convert a price by position`);
  }
}

// THE KICKOFF REACHES THE MATCHER (docs/CC-CMD-2026-10-19-odds-stage1-wrong-game.md).
// matchSlate refuses on the archive game's start_time, and a missing instant
// refuses nothing, so a consumer that stops selecting it turns the rule off
// without a single failure. The backfill's games come from /context/date, whose
// payload carries start_time (probed 2026-10-20 through the relay self-probe);
// the targeted fill selects its own.
{
  const f = 'scripts/targeted-odds-fill.mjs';
  const src = fs.readFileSync(f, 'utf8');
  /SELECT id, LOWER\(sport\)[^`]*\bstart_time\b[^`]*FROM regular_season_games/.test(src)
    ? console.log(`  PASS  ${f}: the games it pairs carry start_time`)
    : (failed++, console.log(`  FAIL  ${f}: the games SELECT drops start_time, so the kickoff refusal never fires`));
  const cron = fs.readFileSync('.github/scripts/odds-backfill.js', 'utf8');
  /fetch\(`\$\{RELAY_BASE\}\/context\/date\/\$\{isoDate\}`\)/.test(cron)
    ? console.log(`  PASS  .github/scripts/odds-backfill.js: its games come from /context/date, which carries start_time`)
    : (failed++, console.log(`  FAIL  .github/scripts/odds-backfill.js: games no longer come from /context/date; re-probe start_time`));
}

// THE PROVIDER READING MUST SURVIVE A FAILING VERDICT. The first live run of
// this watcher exited at the pairing FAIL before it ever recorded the day's
// spend — and a failing day is exactly the one whose cost you want. Same shape
// as the --names early return that committed nothing on 2026-09-15.
{
  const f = 'scripts/watch-odds-pairing-rate.mjs';
  const src = fs.readFileSync(f, 'utf8');
  const write = src.indexOf('writeFileSync(SERIES');
  const burnExit = src.indexOf('date(s) were billed and paired nothing');
  write > -1 && burnExit > -1 && write > burnExit && !/paired nothing[\s\S]{0,600}process\.exit\(1\)/.test(src)
    ? console.log(`  PASS  ${f}: the provider reading is written even when the pairing check fails`)
    : (failed++, console.log(`  FAIL  ${f}: a failing pairing verdict can skip the provider reading`));
}

// An UNKNOWN baseline may not be subtracted as a zero. The seeded readings
// predate the pairing counter and carry null deliberately; `?? 0` in the
// reporting line converts that back into a difference nobody measured.
{
  const f = 'scripts/watch-odds-pairing-rate.mjs';
  const src = fs.readFileSync(f, 'utf8');
  /games_paired_in_window\s*\?\?\s*0/.test(src)
    ? (failed++, console.log(`  FAIL  ${f}: an unknown pairing baseline is coerced to 0`))
    : console.log(`  PASS  ${f}: an unknown pairing baseline is not coerced to 0`);
}

// A PARTIAL sum may not be published under the name of a total. total() reports
// how many rows carried no numeric value; if any did, the window figure is
// unknown and must be stored as null. `gamesTotal.sum` alone would publish the
// sum of whatever happened to be readable and no reader could tell.
{
  const f = 'scripts/watch-odds-pairing-rate.mjs';
  const src = fs.readFileSync(f, 'utf8');
  /games_paired_in_window:\s*gamesTotal\.skipped\s*\?\s*null\s*:\s*gamesTotal\.sum/.test(src)
    ? console.log(`  PASS  ${f}: a partial window total is published as null, not as a sum`)
    : (failed++, console.log(`  FAIL  ${f}: the window total is published without gating on skipped rows`));
}

console.log(`\nCOVERAGE: ${CONSUMERS.length} consumers, ${BANNED.length} banned shapes each, import AND call asserted.`);
console.log(`Structural only — that a call site imports the module does not prove it`);
console.log(`uses the result correctly. check-odds-matcher.mjs covers the module itself.`);
console.log(failed ? `\n${failed} FAILED` : `\nall checks passed`);
process.exit(failed ? 1 : 0);
