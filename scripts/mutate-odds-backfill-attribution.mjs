#!/usr/bin/env node
// Rule 90 harness for scripts/check-odds-backfill-attribution.mjs.
//
// Every mutation restores a way this writer can name itself as the author of a
// row it did not write. That is the dangerous direction: the log still looks
// complete, and the next session reads it as evidence — as one did on
// 2026-09-14, spending a task reconstructing authorship from it.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SRC = '.github/scripts/odds-backfill.js';
const CHECK = 'scripts/check-odds-backfill-attribution.mjs';
const BAK = `${SRC}.mutbak`;

const MUTATIONS = [
  // THE ORIGINAL DEFECT, restored exactly. Two change_log rows per game, one of
  // them for a table the game is not in.
  { name: 'B1  the loop writes both games tables again',
    anchor: "    for (const table of [row.game_table]) {",
    replace: "    for (const table of ['regular_season_games', 'postseason_games']) {",
    expect: 'the sync loop writes the one table the game is in' },

  // The other half of the same defect: a game needing only its opening line
  // still logs a closing_odds write.
  { name: 'B2  every wanted field is written whether empty or not',
    anchor: "    const fields = wanted.filter(f => isEmpty[f]);",
    replace: "    const fields = wanted;",
    expect: 'the fields written are the intersection of wanted and empty' },

  // Emptiness asserted rather than read — true of the candidate set as a whole,
  // false of any individual column.
  { name: 'B3  emptiness is assumed instead of read from the row',
    anchor: "    const isEmpty = { opening_odds: !!row.opening_is_null, closing_odds: !!row.closing_is_null };",
    replace: "    const isEmpty = { opening_odds: true, closing_odds: true };",
    expect: 'emptiness is read from the row, not assumed from the candidate predicate' },

  // A game in neither table: previously two no-op UPDATEs and two log rows.
  { name: 'B4  a game in no games table is no longer skipped',
    anchor: "    if (!row.game_table) {\n      skippedNoTable++;",
    replace: "    if (false) {\n      skippedNoTable++;",
    expect: 'a game in neither table is skipped rather than logged twice' },

  // The query stops carrying what the loop needs, which makes every guard above
  // silently vacuous rather than wrong.
  { name: 'B5  the candidate query stops naming the table',
    anchor: "            END AS game_table,",
    replace: "            END AS not_used_table,",
    expect: 'the candidate query names the table the game is actually in' },

  { name: 'B6  the candidate query stops reporting emptiness',
    anchor: "            ) AS closing_is_null",
    replace: "            ) AS closing_unused",
    expect: 'the candidate query says which columns are actually empty' },

  // The comment that asserted the invariant while the code broke it.
  { name: 'B7  the false justification comment comes back',
    anchor: "          // Log to change_log for O(1) Newspaper \"What's Moving\" + Brief Freshness Guard.",
    replace: "          // Log to change_log for O(1) Newspaper \"What's Moving\" + Brief Freshness Guard.\n          // Candidates are pre-filtered (field IS NULL), so the UPDATE above matched.",
    expect: 'the false justification comment is not restored' },

  // Attribution must still be recorded, and its failure still audible.
  { name: 'B8  a failed change_log insert goes quiet again',
    anchor: "this row will be unattributable",
    replace: "this row was written",
    expect: 'a failed change_log insert is still reported, not swallowed' },

  // The three blob facts that proved this writer innocent of the 22. If any
  // drifts, that argument stops being reproducible from source.
  { name: 'B9  the blob stops carrying the history row bookmaker',
    anchor: "      source: row.bookmaker || 'odds-api-historical',",
    replace: "      source: 'odds-api-historical',",
    expect: "the blob's source is the odds_history row's bookmaker" },

  { name: 'B10  the blob stops converting the decimal price',
    anchor: "        home: decimalToAmerican(row.home_ml),",
    replace: "        home: row.home_ml,",
    expect: 'the blob converts the odds_history decimal price' },

  { name: 'B11  the blob stops carrying the total',
    anchor: "      odds.total = { over: row.over_under, under: row.over_under };",
    replace: "      odds.total = { over: null, under: null };",
    expect: "the blob carries the odds_history row's total when it has one" },

  { name: 'B12  a quiet run stops saying what it skipped',
    anchor: "neither logged to change_log",
    replace: "done",
    expect: 'the summary line says those skips produced no change_log rows' },
];

let bad = 0;
for (const m of MUTATIONS) {
  const before = readFileSync(SRC, 'utf8');
  const hits = before.split(m.anchor).length - 1;
  if (hits !== 1) {
    bad++;
    console.error(`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s), expected 1. NOTHING WAS MUTATED.`);
    continue;
  }
  const after = before.replace(m.anchor, m.replace);
  if (after === before) { bad++; console.error(`  NO EFFECT  ${m.name}`); continue; }
  copyFileSync(SRC, BAK);
  writeFileSync(SRC, after);
  let out = '', code = 0;
  try { out = execFileSync('node', [CHECK], { encoding: 'utf8' }); }
  catch (e) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`; }
  finally { copyFileSync(BAK, SRC); unlinkSync(BAK); }
  const red = out.split('\n').filter(l => l.startsWith('FAIL'));
  if (code === 0) { bad++; console.error(`  NOT CAUGHT  ${m.name}`); }
  else if (!red.some(l => l.includes(m.expect))) {
    bad++;
    console.error(`  WRONG REASON  ${m.name}\n          no FAIL line mentioned "${m.expect}".\n${red.join('\n')}`);
  } else console.log(`  caught  ${m.name}\n          by "${m.expect}" (${red.length} red)`);
}

execFileSync('node', ['--check', SRC]);
console.log(`\nran ${MUTATIONS.length} mutation(s) against ${CHECK}; ${SRC} restored and parsing`);
process.exit(bad ? 1 : 0);
