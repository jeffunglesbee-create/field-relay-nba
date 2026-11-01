#!/usr/bin/env node
// Rule 90 for the vendor-watch half (check 8 of verify-staged-items) and the CFL-abort-repeat half (check 9) of scripts/staged-verdicts.mjs: each mutation breaks one clause of
// vendorWatchPayload, vendorWatchLogFiles, vendorWatchWindowAligned, cflAbortArtifactFiles, cflAbortRepeatPayload or cflAbortRepeatLosesNothing, and scripts/staged-verdicts-check.mjs
// must go red on a line naming that check. Found by the 2026-11-01 review of Task 3: of 20 mutants of the
// payload builder, 8 survived the first set of tests (a refusal state could be dropped, the last series row could replace the judged run's own, the file-selection half had no test).
// Each asserts its anchor is unique and applied before reporting a result. Mutates in place and restores; needs the file's changes staged or committed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const FILE = 'scripts/staged-verdicts.mjs';
const CHECK = 'scripts/staged-verdicts-check.mjs';
if (spawnSync('git', ['diff', '--quiet', '--', FILE]).status !== 0) { console.log(`FAIL — ${FILE} has unstaged changes; restoring would lose them.`); process.exit(1); }
if (spawnSync('node', [CHECK], { stdio: 'ignore' }).status !== 0) { console.log(`FAIL — ${CHECK} is already red on clean source.`); process.exit(1); }
console.log(`baseline: ${CHECK} passes on clean source\n`);

const REFUSALS = ['month-boundary', 'no-data', 'counter-reset', 'window-drift', 'ledger-unreadable', 'ci-unreadable', 'ledger-went-backwards'];
const JUDGED = ['tracks-the-bill', 'counter-under-counts', 'we-overcharge-ourselves'];
const list = (xs) => `[${xs.map((x) => `'${x}'`).join(', ')}]`;
const M = [];
const VW = 'vendor_watch_window_aligned', CA = 'cfl_abort_repeat_loses_nothing';
for (const s of REFUSALS) M.push([`R-${s}: the refusal state "${s}" is dropped from the list`, `export const VENDOR_WATCH_REFUSALS = ${list(REFUSALS)}`, `export const VENDOR_WATCH_REFUSALS = ${list(REFUSALS.filter((x) => x !== s))}`, 'a transient refusal reads as an unknown state']);
for (const s of JUDGED) M.push([`J-${s}: the judged verdict "${s}" is dropped from the list`, `export const VENDOR_WATCH_JUDGED = ${list(JUDGED)}`, `export const VENDOR_WATCH_JUDGED = ${list(JUDGED.filter((x) => x !== s))}`, 'a verdict that lost its window line stops being a FAIL']);
M.push(
  ['S1 the log list is not sorted', '  .sort()\n', '\n', 'the "first" judged log is whichever readdir returned first'],
  ['S2 the date filter starts a day early', ">= '2026-11-02')", ">= '2026-11-01')", 'the month-boundary refusal of 2026-11-01 counts as a run since Task 1'],
  ['S3 the filename pattern is not anchored at the end', 'T\\d{4}\\.log$/.test(f)', 'T\\d{4}\\.log/.test(f)', 'a backup copy of a log is read as a log'],
  ['S4 the newest log decides, not the first judged one', 'const decided = judgedLogs[0] || logs[logs.length - 1]', 'const decided = logs[logs.length - 1]', 'a later refusal erases a verdict already reached'],
  ['S5 the LAST judged log decides', 'const decided = judgedLogs[0] || logs[logs.length - 1]', 'const decided = judgedLogs[judgedLogs.length - 1] || logs[logs.length - 1]', 'a later broken run turns an earlier PASS into FAIL'],
  ['S6 the judged run\'s series row is the LAST row', 'rows.find((r) => r.at === utc)', 'rows[rows.length - 1]', 'a later run that stored a KV ledger turns a PASS into FAIL'],
  ['S7 a KV ledger source is accepted', "row.ledger_source === 'd1'", 'true', 'a KV fallback is stored as a baseline and called good'],
  ['S8 a non-numeric ledger is accepted', "typeof row.ledger_month_used === 'number'", 'true', 'a null ledger leaves the next window with no baseline'],
  ['S9 a row that aged out is a FAIL', "(utc && rows.length && utc < String(rows[0].at)) ? 'aged-out' : 'missing'", "'missing'", 'a verdict reached months ago turns red when its row is trimmed'],
  ['S10 a judged log is also given a refusal', "refusal: isJudged ? '' :", 'refusal:', 'a judged log reads as a refusal and never passes'],
  ['S11 the coverage counts every log, not the judged ones', 'judgedLogs: judgedLogs.length,', 'judgedLogs: logs.length,', 'PASS rests on 1 of N and the N is hidden'],
  ['S12 the second diagnostic half is not required', "t.includes('NOT the verdict') && t.includes('residual against that')", "t.includes('NOT the verdict')", 'a log with a diagnostic number and no label'],
  ['S13 the first diagnostic half is not required', "t.includes('NOT the verdict') && t.includes('residual against that')", "t.includes('residual against that')", 'a log whose diagnostic is not labelled as one'],
  ['S14 known CI spend is not required', "hasKnownCi: t.includes('known CI spend')", 'hasKnownCi: true', 'the residual subtracts an operand the log does not show'],
  ['S15 a log with no verdict line is a verdict-count FAIL', ": state ? `unrecognised:${state}` : 'no-verdict'", ": state ? `unrecognised:${state}` : ''", 'a relay error on the day reads as a regression'],
  ['S16 an unknown verdict state is a verdict-count FAIL', "state ? `unrecognised:${state}` : 'no-verdict'", "'no-verdict'", 'a new state the list does not know reads as a regression'],
  ['S17 the join key is dropped (the first row is taken)', 'rows.find((r) => r.at === utc)', 'rows[0]', 'the judged run\'s row is whichever came first'],
  ['C1 no artifact is not PENDING', 'repeats === 0 ? "PENDING', 'false ? "PENDING', 'a fix nobody has tested reads as a regression', CA],
  ['C2 the pre-fix artifact counts as a repeat', "a && typeof a === 'object' && Array.isArray(a.latency_samples_ms)", "a && typeof a === 'object'", 'the lossy run that motivated the fix reads as the fix failing', CA],
  ['C3 an inconclusive repeat is not PENDING', "verdict.startsWith('inconclusive') ?", 'false ?', 'a run the ledger could not read reads as a regression', CA],
  ['C4 a lossy verdict is not named', "verdict !== 'abort-loses-nothing' ?", 'false ?', 'the failure message stops saying what the repeat returned', CA],
  ['C5 fewer than 3 cut calls pass', 'effective >= 3', 'effective >= 0', 'abort-loses-nothing on calls that were never cut', CA],
  ['C6 a by_site that moved passes', '(byDelta !== 0 ||', '(', 'a verdict that contradicts its own deltas passes', CA],
  ['C7 short tallies pass', 'hitDelta !== calls)', 'false)', 'a verdict that contradicts its own deltas passes', CA],
  ['C8 the OLDEST repeat decides', 'repeats[repeats.length - 1]', 'repeats[0]', 'a later lossy run is hidden by an earlier pass', CA],
  ['C10 the artifact filename pattern is not anchored at the end', 'Z\\.json$/.test(f)).sort()', 'Z\\.json/.test(f)).sort()', 'a backup copy of an artifact is read as one', CA],
  ['C11 the artifact list is not sorted', 'Z\\.json$/.test(f)).sort()', 'Z\\.json$/.test(f))', 'the newest repeat is whichever readdir returned last', CA],
);


let caught = 0, ran = 0;
for (const [name, anchor, replace, why, id = VW] of M) {
  const src = fs.readFileSync(FILE, 'utf8');
  const hits = src.split(anchor).length - 1;
  if (hits !== 1) { console.log(`FAIL       ${name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`); continue; }
  if (anchor === replace) { console.log(`FAIL       ${name}\n            replacement equals the anchor — NOTHING MUTATED.`); continue; }
  ran++;
  fs.writeFileSync(FILE, src.replace(anchor, () => replace));
  const run = spawnSync('node', [CHECK], { encoding: 'utf8', timeout: 60000 });
  fs.writeFileSync(FILE, src);
  const fails = String(run.stdout ?? '').split('\n').filter((l) => l.includes('FAIL') && l.includes(id));
  const red = run.status !== 0 && fails.length > 0;   // a crash, a syntax error or a timeout is BROKE, not CAUGHT: an assertion on that check's verdict must have fired
  console.log(`${red ? 'CAUGHT    ' : run.status !== 0 ? 'BROKE     ' : 'NOT CAUGHT'} ${name}\n            (${why})${red ? `\n            <- ${fails[0].trim().slice(0, 130)}` : ''}`);
  if (red) caught++;
}
console.log(`\n${caught} of ${M.length} mutations caught (${ran} applied).`);
process.exit(caught === M.length ? 0 : 1);
