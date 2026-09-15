#!/usr/bin/env node
// change_log is how this repo answers "who wrote this row", and on 2026-09-14 a
// whole task was spent reconstructing the authorship of 62 rows from it. A
// writer that logs writes it did not make poisons that answer.
//
// MEASURED 2026-09-15: 22 archived closing lines carry a DraftKings
// American-odds blob with no total. odds-backfill cannot emit that — it
// converts the odds_history row, so it would carry that row's bookmaker and its
// over_under — yet change_log named odds_backfill for all 22, in exactly 44
// entries: two per game. Two per game is the signature. The sync loop ran
// `for (const table of ['regular_season_games', 'postseason_games'])` and logged
// after every UPDATE, and the candidate predicate is "opening_odds IS NULL OR
// closing_odds IS NULL" — so a game needing only its opening line still got a
// closing_odds entry for an UPDATE that matched nothing.
//
// These assertions hold the three facts that make the log true: one table, only
// empty fields, and a game that exists somewhere.
//
// Rule 90: mutation-tested by scripts/mutate-odds-backfill-attribution.mjs.
import { readFileSync } from 'node:fs';

let fails = 0, n = 0;
const ok = (f, why) => {
  n++;
  let pass = false;
  try { pass = (typeof f === 'function' ? f() : f) === true; }
  catch (e) { console.log(`FAIL  ${why} — threw ${e.message}`); fails++; return; }
  if (!pass) { fails++; console.log(`FAIL  ${why}`); }
};

const SRC = readFileSync('.github/scripts/odds-backfill.js', 'utf8');

// --- the candidate query carries what the loop needs to be honest
ok(() => /END AS game_table/.test(SRC),
   'the candidate query names the table the game is actually in');
ok(() => /AS opening_is_null/.test(SRC) && /AS closing_is_null/.test(SRC),
   'the candidate query says which columns are actually empty');

// --- the loop writes one table, chosen from the row
ok(() => /for \(const table of \[row\.game_table\]\)/.test(SRC),
   'the sync loop writes the one table the game is in');
ok(() => !/for \(const table of \['regular_season_games', 'postseason_games'\]\)/.test(SRC),
   'no loop still writes both games tables blindly');
ok(() => /if \(!row\.game_table\) \{[\s\S]{0,200}?continue;/.test(SRC),
   'a game in neither table is skipped rather than logged twice');

// --- only genuinely empty fields are written, and therefore logged
ok(() => /const isEmpty = \{ opening_odds: !!row\.opening_is_null, closing_odds: !!row\.closing_is_null \};/.test(SRC),
   'emptiness is read from the row, not assumed from the candidate predicate');
ok(() => /const fields = wanted\.filter\(f => isEmpty\[f\]\);/.test(SRC),
   'the fields written are the intersection of wanted and empty');
ok(() => !/const fields = \(isPast && measuredCapture\)/.test(SRC),
   'the old unconditional both-fields decision is gone');

// --- the change_log insert still exists and still reports its own failure
ok(() => /INSERT INTO change_log \(game_id, source, field, old_value, new_value, ts\)/.test(SRC),
   'the change_log insert is still there');
ok(() => /this row will be unattributable/.test(SRC),
   'a failed change_log insert is still reported, not swallowed');

// --- the comment that was false does not come back
ok(() => !/Candidates are pre-filtered \(field IS NULL\), so the UPDATE above matched\./.test(SRC),
   'the false justification comment is not restored');

// --- the counters that make a quiet run legible
ok(() => /skippedNoTable/.test(SRC) && /skippedFilled/.test(SRC),
   'the run reports what it skipped instead of skipping silently');
ok(() => /neither logged to change_log/.test(SRC),
   'the summary line says those skips produced no change_log rows');

// --- the blob shape that proved odds-backfill innocent must stay derivable
ok(() => /source: row\.bookmaker \|\| 'odds-api-historical'/.test(SRC),
   "the blob's source is the odds_history row's bookmaker");
ok(() => /home: decimalToAmerican\(row\.home_ml\)/.test(SRC),
   'the blob converts the odds_history decimal price');
ok(() => /odds\.total = \{ over: row\.over_under, under: row\.over_under \}/.test(SRC),
   "the blob carries the odds_history row's total when it has one");

console.log(`${n - fails}/${n} assertions pass`);
process.exit(fails ? 1 : 0);
