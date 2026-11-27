#!/usr/bin/env node
// Rule 90 for check 16 of verify-staged-items (the 524-row UEFA history write): each mutation breaks one clause of uefaHistoryWritten / UEFA_HISTORY_WINDOWS (scripts/staged-verdicts.mjs) or of the
// executor block (scripts/verify-staged-items.mjs), and scripts/staged-verdicts-check.mjs must go red on a line naming uefa_history_written. A check that has only ever passed has proven nothing.
// Each mutation asserts its anchor is unique and applied before reporting a result (NOT CAUGHT with nothing mutated is worse than no test). A crash or a timeout is BROKE, not CAUGHT: an
// assertion about this check must have fired. Mutates in place and restores; needs both files' changes staged or committed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const V = 'scripts/staged-verdicts.mjs', X = 'scripts/verify-staged-items.mjs', CHECK = 'scripts/staged-verdicts-check.mjs', ID = 'uefa_history_written';
for (const f of [V, X]) if (spawnSync('git', ['diff', '--quiet', '--', f]).status !== 0) { console.log(`FAIL — ${f} has unstaged changes; restoring would lose them.`); process.exit(1); }
if (spawnSync('node', [CHECK], { stdio: 'ignore' }).status !== 0) { console.log(`FAIL — ${CHECK} is already red on clean source.`); process.exit(1); }
console.log(`baseline: ${CHECK} passes on clean source\n`);

const M = [
  // the verdict
  ['V1 a count above ESPN\'s is not a failure', V, 'return over.length ? ', 'return false ? ', 'a duplicated or mislabelled row reads as progress'],
  ['V2 PASS tolerates one missing row per window', V, 'rows.every((r) => r.scored === r.expected)', 'rows.every((r) => r.scored >= r.expected - 1)', 'a write one row short reads as done'],
  ['V3 an unwritten history is not PENDING', V, 'histHave === 0 ? ', 'false ? ', 'the state the owner has not acted on reads as partial progress'],
  ['V4 a partly written history is PENDING', V, 'histHave === 0 ? ', 'histHave < histTotal ? ', 'a write that started is reported as one that has not'],
  ['V5 the number of windows is not checked', V, 'windows.length !== known.length || bad.length', 'bad.length', 'a verdict judged on a payload with a window too many'],
  ['V6 a count that is NaN is accepted', V, '!Number.isInteger(byKey[k.key]?.scored) || byKey[k.key].scored < 0', "!(typeof byKey[k.key]?.scored === 'number') || byKey[k.key].scored < 0", 'a D1 answer that is not a count is judged as one'],
  ['V7 a negative count is accepted', V, ' || byKey[k.key].scored < 0)', ')', 'a count below zero is judged as one'],
  ['V8 a malformed payload is PENDING, not FAIL', V, 'bad.length)\n    return `FAIL', 'bad.length)\n    return `PENDING', 'a broken contract between the executor and the verdict reads as waiting'],
  ['V9 the first window expects one row fewer', V, "to: '2026-04-30', expected: 186 },\n  { key: 'uel_history'", "to: '2026-04-30', expected: 185 },\n  { key: 'uel_history'", 'the Champions League history is called complete one row early'],
  ['V10 the last window reaches past the cron', V, "to: '2026-11-25', expected: 57", "to: '2026-11-30', expected: 57", 'a window the cron keeps filling turns a perfect write red on the next matchday'],
  ['V11 every window counts as history', V, "r.key.endsWith('_history')", 'true', 'the 55 Conference rows already archived read as the history write having started'],
  ['V12 the negative control no longer fails', V, "{ windows: [{ key: 'ucl_history', scored: 187 }", "{ windows: [{ key: 'ucl_history', scored: 186 }", 'a verdict that passes its own negative control'],
  // the executor
  ['E1 only the regular-season table is read', X, 'FROM postseason_games WHERE sport = ?1', 'FROM regular_season_games WHERE sport = ?1', 'a row filed under the postseason table is never counted'],
  ['E2 rows are counted, not scored rows', X, 'COUNT(home_score) AS scored FROM regular_season_games', 'COUNT(*) AS scored FROM regular_season_games', 'an archived row with no score counts as archived'],
  ['E3 the label is matched with LIKE', X, 'FROM regular_season_games WHERE sport = ?1 AND date BETWEEN ?2 AND ?3 \'', 'FROM regular_season_games WHERE sport LIKE ?1 AND date BETWEEN ?2 AND ?3 \'', 'the Qualifying labels are counted as the league labels'],
  ['E4 the verdict is given the row count, not the scored count', X, 'scored: Number(r?.scored)', 'scored: Number(r?.n)', 'rows with no score pass as archived'],
  ['E5 the manifest records no qualifying rows', X, 'qualifying_rows: windows.reduce(', 'qualifying_rows: 0 * windows.reduce(', 'the manifest says nothing was found when 55 rows were'],
  ['E6 the window\'s end date is the start date', X, '[w.label, w.from, w.to],', '[w.label, w.from, w.from],', 'every window is one day long'],
  ['E7 the verdict is bypassed', X, 'status: uefaHistoryWritten({ windows }),', "status: 'PASS',", 'the manifest says PASS whatever the archive holds'],
  ['E8 the check count is not raised', X, 'const EXPECTED_CHECKS = 16;', 'const EXPECTED_CHECKS = 15;', 'all_passed can be true with check 16 unaccounted for'],
  ['E9 only three windows are read', X, 'for (const w of UEFA_HISTORY_WINDOWS) {', 'for (const w of UEFA_HISTORY_WINDOWS.slice(0, 3)) {', 'the Conference May to November window is never counted'],
];

let caught = 0, ran = 0;
for (const [name, file, anchor, replace, why] of M) {
  const src = fs.readFileSync(file, 'utf8');
  const hits = src.split(anchor).length - 1;
  if (hits !== 1) { console.log(`FAIL       ${name}\n            anchor matched ${hits} times in ${file}, expected 1 - NOTHING MUTATED.`); continue; }
  if (anchor === replace) { console.log(`FAIL       ${name}\n            replacement equals the anchor - NOTHING MUTATED.`); continue; }
  ran++;
  fs.writeFileSync(file, src.replace(anchor, () => replace));
  const run = spawnSync('node', [CHECK], { encoding: 'utf8', timeout: 60000 });
  fs.writeFileSync(file, src);
  const fails = String(run.stdout ?? '').split('\n').filter((l) => /^\s*FAIL\s/.test(l) && l.includes(ID));
  const red = run.status !== 0 && fails.length > 0;
  console.log(`${red ? 'CAUGHT    ' : run.status !== 0 ? 'BROKE     ' : 'NOT CAUGHT'} ${name}\n            (${why})${red ? `\n            <- ${fails[0].trim().slice(0, 140)}` : ''}`);
  if (red) caught++;
}
console.log(`\n${caught} of ${M.length} mutations caught (${ran} applied).`);
process.exit(caught === M.length ? 0 : 1);
