#!/usr/bin/env node
// Rule 90 harness for scripts/check-write-oklahoma-audit-rows.mjs.
//
// Every mutation is a way the audit-row writer could write a wrong entry, write
// one twice, write against a state the owner did not order it for, report done
// when it is not, or be dispatched the wrong way. A check that has only ever
// passed has proven nothing: each mutation below must turn it RED, for the
// reason named.
//
// THE HARNESS ASSERTS ITS OWN ANCHORS. An anchor that occurs 0 or 2+ times mutates
// nothing, and "NOT CAUGHT" with no mutation applied would be worse than no test
// (field-relay-nba Rule 90's corollary).
//
// IT MUTATES COPIES. Each mutant is written into a throwaway tree under the OS
// temp directory and the check runs there, so the checked-in script is never
// rewritten and a killed run cannot leave a guard-stripped writer on disk next to
// the workflow step that applies it.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const MOD = 'scripts/write-oklahoma-audit-rows.mjs';
const CHECK = 'scripts/check-write-oklahoma-audit-rows.mjs';
const WF = '.github/workflows/write-oklahoma-audit-rows.yml';
const TREE = [MOD, CHECK, WF, 'scripts/lib/allowed-tables.cjs', 'src/index.js'];
const CONCURRENCY = 4;

const M = (name, file, anchor, replace, expect) => ({ name, file, anchor, replace, expect });
const MUTATIONS = [
  // ── statement 1, the copy entry ──
  M('G1  the copy entry ignores change_log 26626\'s line', MOD,
    "AND k.opening_odds = (SELECT c.new_value FROM change_log c WHERE c.id = ? AND c.game_id = ? AND c.field = 'opening_odds') ", 'AND ? IS NOT NULL AND ? IS NOT NULL ',
    'guard 1: a keeper whose line differs from change_log 26626 gets no copy entry'),
  M('G2  the copy entry ignores 26626\'s game id', MOD,
    "WHERE c.id = ? AND c.game_id = ? AND c.field = 'opening_odds')", "WHERE c.id = ? AND ? IS NOT NULL AND c.field = 'opening_odds')",
    'guard 1: change_log 26626 on another game id gives no copy entry'),
  M('G3  the copy entry ignores 26626\'s field', MOD,
    "AND c.field = 'opening_odds') ", 'AND 1 = 1) ',
    'guard 1: change_log 26626 with another field gives no copy entry'),
  M('G4  the copy entry can be written twice', MOD,
    "AND NOT EXISTS (SELECT 1 FROM change_log x WHERE x.game_id = k.id AND x.source = ? AND x.field = 'opening_odds')", 'AND ? IS NOT NULL',
    'guard 1: a second run writes no second copy entry'),
  // ── statement 2, the deletion entry ──
  M('G5  the deletion entry ignores the closing log\'s text', MOD,
    'AND c.new_value = ? ', 'AND ? IS NOT NULL ',
    'guard 2: a closing log whose text differs gives no deletion entry'),
  M('G6  the deletion entry ignores the closing log\'s game id', MOD,
    'AND c.game_id = ? AND c.new_value', 'AND ? IS NOT NULL AND c.new_value',
    'guard 2: a closing log on another game id gives no deletion entry'),
  M('G7  the deletion entry ignores the opening log\'s game id', MOD,
    'AND o.game_id = ? AND c.game_id', 'AND ? IS NOT NULL AND c.game_id',
    'guard 2: an opening log on another game id gives no deletion entry'),
  M('G8  the deletion entry ignores what the keeper holds', MOD,
    'AND o.new_value = (SELECT k.opening_odds FROM regular_season_games k WHERE k.id = ?) ', 'AND ? IS NOT NULL ',
    'guard 2: an opening log that differs from the keeper\'s line gives no deletion entry'),
  M('G9  the deletion entry is written while the old row still exists', MOD,
    'AND NOT EXISTS (SELECT 1 FROM regular_season_games g WHERE g.id = ?) ', 'AND ? IS NOT NULL ',
    'guard 2: a games row that still exists under the old id gives no deletion entry'),
  M('G10 the deletion entry can be written twice', MOD,
    "AND NOT EXISTS (SELECT 1 FROM change_log x WHERE x.game_id = o.game_id AND x.source = ? AND x.field = 'row_deleted')", 'AND ? IS NOT NULL',
    'guard 2: a second run writes no second deletion entry'),
  M('G11 the deletion entry does not name the keeper', MOD,
    'KEEPER, ts, CLOSE_LOG, OPEN_LOG', 'STALE, ts, CLOSE_LOG, OPEN_LOG',
    'fresh: the deletion entry carries the removed row exactly, key for key, and names the keeper'),
  M('G12 the deletion entry carries the opening blob as its closing blob', MOD,
    "'closing_odds', c.new_value)", "'closing_odds', o.new_value)",
    'fresh: both blobs inside the deletion entry equal the rows they came from'),
  // ── the pinned facts ──
  M('K1  the opening log id is wrong', MOD,
    'export const OPEN_LOG = 26626;', 'export const OPEN_LOG = 26627;',
    'the pinned facts are what the owner\'s order and the D1 read said'),
  M('K2  the old row\'s created_at is wrong', MOD,
    "created_at: '2026-11-14 10:01:36',", "created_at: '2026-11-14 10:01:37',",
    'the pinned facts are what the owner\'s order and the D1 read said'),
  M('K3  the closing blob is not the text the old row was read with', MOD,
    '"moneyline":{"home":-147,"away":124}', '"moneyline":{"home":-148,"away":124}',
    'the closing blob is the text the old row was read with'),
  M('K4  the pinned facts are not frozen', MOD,
    "export const BASELINE = Object.freeze({ stale_change_log: 2, keeper_change_log: 1, stale_odds_history: 1 });", "export const BASELINE = { stale_change_log: 2, keeper_change_log: 1, stale_odds_history: 1 };",
    'the pinned facts are frozen'),
  // ── the preconditions ──
  M('E1  a third row for the event is allowed', MOD,
    'state.rows.length === 1 && Boolean(keeper) && keeper.home_score', 'Boolean(keeper) && keeper.home_score',
    'a third row for the event is refused'),
  M('E2  an unscored keeper is allowed', MOD,
    'Boolean(keeper) && keeper.home_score != null && keeper.away_score != null && state.postseasonCount === 0,', 'Boolean(keeper) && state.postseasonCount === 0,',
    'an unscored keeper (no home score) is refused'),
  M('E3  a postseason row for the event is allowed', MOD,
    ' && state.postseasonCount === 0,', ',',
    'a postseason row for the event is refused'),
  M('E4  a keeper with no line is allowed', MOD,
    "check('the keeper holds an opening line', line != null, 'opening_odds is null')", "check('the keeper holds an opening line', true, 'opening_odds is null')",
    'a keeper with no line is refused'),
  M('E5  change_log 26626 may differ from the keeper\'s line', MOD,
    '&& line != null && open.new_value === line,', '&& line != null,',
    'a keeper whose line is not change_log 26626\'s is refused'),
  M('E6  change_log 26626 may be on another game id', MOD,
    'Boolean(open) && open.game_id === STALE && ', 'Boolean(open) && ',
    'change_log 26626 on another game id is refused'),
  M('E7  change_log 26626 may be from another source', MOD,
    "open.source === 'odds_api' && ", '',
    'change_log 26626 on another source is refused'),
  M('E8  change_log 26626 may be another field', MOD,
    "open.field === 'opening_odds' && line", 'line',
    'change_log 26626 on another field is refused'),
  M('E9  change_log 26722 may hold other text', MOD,
    'close.new_value === CLOSING_BLOB,', 'true,',
    'change_log 26722 with different text is refused'),
  M('E10 change_log 26722 may be on another game id', MOD,
    'Boolean(close) && close.game_id === STALE && ', 'Boolean(close) && ',
    'change_log 26722 on another game id is refused'),
  M('E11 change_log 26722 may be from another source', MOD,
    "close.source === 'odds_backfill' && ", '',
    'change_log 26722 on another source is refused'),
  M('E12 change_log 26722 may be another field', MOD,
    "close.field === 'closing_odds' && close.new_value", 'close.new_value',
    'change_log 26722 on another field is refused'),
  M('E13 a third change_log row on the old id is allowed', MOD,
    'state.logStale === BASELINE.stale_change_log && ', '',
    'a third change_log row on the old id is refused'),
  M('E14 no change_log row on the keeper is allowed', MOD,
    'state.logKeeper === BASELINE.keeper_change_log && ', '',
    'no change_log row on the keeper is refused'),
  M('E15 another row of this plan\'s source is allowed', MOD,
    ' && state.ownOther === 0,', ',',
    'another row of this plan\'s source is refused'),
  M('E16 a second odds_history row on the old id is allowed', MOD,
    'state.historyStale <= BASELINE.stale_odds_history, ', 'true, ',
    'a second odds_history row on the old id is refused'),
  M('E16b the one expected odds_history row is refused', MOD,
    'state.historyStale <= BASELINE.stale_odds_history, ', 'state.historyStale < BASELINE.stale_odds_history, ',
    'fresh: every precondition holds'),
  M('E16c the repointed state is refused again (the old equality)', MOD,
    'state.historyStale <= BASELINE.stale_odds_history, ', 'state.historyStale === BASELINE.stale_odds_history, ',
    'after the repoint (no odds_history row on the old id) every precondition still holds'),
  M('E17 a duplicated entry is allowed', MOD,
    'state.copy.length <= 1 && state.deleted.length <= 1,', 'true,',
    'two copy entries are refused'),
  M('E18 a copy entry may carry another line', MOD,
    'copy.old_value === null && copy.new_value === line && line != null,', 'true,',
    'a copy entry that carries another line is refused'),
  M('E19 a deletion entry may carry anything', MOD,
    'JSON.stringify(parse(gone.old_value)) === JSON.stringify(want) && gone.new_value === KEEPER,', 'true,',
    'a deletion entry that is not JSON is refused'),
  M('E20 a deletion entry need not name the keeper', MOD,
    ' && gone.new_value === KEEPER,', ',',
    'a deletion entry that does not name the keeper is refused'),
  M('E21 a count that never arrived is read as zero', MOD,
    'Number(arr(name)[0]?.n ?? NaN)', 'Number(arr(name)[0]?.n ?? 0)',
    'stateFrom: a count read with no rows is NaN'),
  M('E22 a read that returned no array is read as empty', MOD,
    'if (!Array.isArray(results[name])) throw new Error(`read "${name}" returned no result array`);', '',
    'stateFrom: a read that returned no array throws'),
  // ── the executor ──
  M('X1  a dry run writes', MOD,
    'if (!apply) {', 'if (false) {',
    'executor: a dry run exits 0 as a dry run and issues no write'),
  M('X2  a state the owner did not order this for is not refused', MOD,
    'if (!ev.ok) {', 'if (false) {',
    'under --apply, before any write'),
  M('X3  a write with a wrong or absent changes count passes', MOD,
    'if (changes !== want) {', 'if (false) {',
    'executor: a write with no changes count stops the run'),
  M('X4  a partial run expects the same count as a fresh one', MOD,
    'const want = ev.phase === \'fresh\' || (s.name.startsWith(\'1\') ? before.copy.length === 0 : before.deleted.length === 0) ? 1 : 0;', 'const want = 1;',
    'executor: a re-run issues both statements, the first changes 0 rows'),
  M('X5  the verdict is not read back', MOD,
    "const ok = again.ok && again.phase === 'done' && sameKeeper && untouched;", 'const ok = true;',
    'executor: an entry that does not hold what it should is a mismatch'),
  M('X6  the games table is not compared after the run', MOD,
    "&& sameKeeper && untouched;", '&& untouched;',
    'executor: a games row that changed during the run is a mismatch'),
  M('X7  the rows that existed are not compared after the run', MOD,
    "&& sameKeeper && untouched;", '&& sameKeeper;',
    'executor: a change_log row that existed and changed during the run is a mismatch'),
  M('X8  a finished job is written again', MOD,
    "if (ev.phase === 'done') {", 'if (false) {',
    'executor: a second apply is a no-op that says so'),
  M('X9  a failing statement does not say what failed', MOD,
    'STOP: ${s.name} failed: ${e.message}', 'STOP: ${s.name} failed',
    'executor: a failing statement stops the run and names the error'),
  M('X10 a missing results array is read as an empty table', MOD,
    'return { results: b.results, meta: b.meta };', 'return { results: Array.isArray(b.results) ? b.results : [], meta: b.meta === undefined ? {} : b.meta };',
    'relayD1: a success body with no results array leaves results missing'),
  M('X11 a body that is not JSON is read as an empty answer', MOD,
    'catch (e) { throw new Error(`d1 HTTP ${res.status}: body is not JSON: ${text.slice(0, 200)}`); }', 'catch (e) { b = {}; }',
    'relayD1: a body that is not JSON is a failure'),
  M('X12 a JSON null body passes', MOD,
    "if (b === null || typeof b !== 'object') throw new Error(", 'if (false) throw new Error(',
    'relayD1: a body that is JSON null is a failure'),
  M('X13 an HTTP error with a success body passes', MOD,
    'if (!res.ok || b.success === false) throw', 'if (b.success === false) throw',
    'relayD1: an HTTP error status is a failure even when the body says success'),
  M('X14 success:false on HTTP 200 passes', MOD,
    'if (!res.ok || b.success === false) throw', 'if (!res.ok) throw',
    'relayD1: success:false is a failure even on HTTP 200'),
  M('X15 a request can hang forever', MOD,
    '      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),\n', '',
    'relayD1: the request is a POST to /d1/execute with the secret header'),
  M('X16 a call can be made with no secret', MOD,
    "if (!secret) throw new Error('RELAY_SHARED_SECRET is not set; refusing to call /d1/execute');", '',
    'relayD1: no secret means no call'),
  M('X17 the CLI applies by default', MOD,
    "apply: process.argv.includes('--apply')", 'apply: true',
    'cli: with no flag it is a dry run'),
  M('X18 the CLI runs without a secret', MOD,
    'relayD1(process.env.RELAY_SHARED_SECRET)', "relayD1(process.env.RELAY_SHARED_SECRET || 'x')",
    'cli: with no secret it refuses before any call'),
  M('X19 the log is not written as it goes', MOD,
    "appendFileSync(running, s + '\\n');", '',
    'cli: the dry run left a log named for its outcome, holding what was printed'),
  M('X20 the header does not carry the run', MOD,
    '${runId ? `  ${runId}` : \'\'} ===', ' ===',
    'executor: and prints both statements, that nothing was written, and the run identity'),
  // ── the workflow ──
  M('W1  any non-empty input applies', WF,
    'if [ "$APPLY_INPUT" = "APPLY" ]; then', 'if [ -n "$APPLY_INPUT" ]; then',
    'workflow gate: "dry-run" is a dry run'),
  M('W2  the job runs from any ref', WF,
    "if: github.ref == 'refs/heads/main'", "if: github.ref != ''",
    'workflow: the job runs only on main'),
  M('W3  a running write can be cancelled', WF,
    'cancel-in-progress: false', 'cancel-in-progress: true',
    'workflow: one run at a time, and a running one is never cancelled'),
  M('W4  two runs can overlap', WF,
    'group: oklahoma-audit-rows', 'group: x',
    'workflow: one run at a time, and a running one is never cancelled'),
  M('W5  Node is not pinned to 22', WF,
    "node-version: '22'", "node-version: '20'",
    'workflow: Node 22 is pinned'),
  M('W6  the input is interpolated into the script', WF,
    'if [ "$APPLY_INPUT" = "APPLY" ]; then', 'if [ "${{ github.event.inputs.apply }}" = "APPLY" ]; then',
    'workflow: the apply input reaches the shell through env'),
  M('W7  the secret reaches the commit step', WF,
    'PROBE_AUTHOR_NAME="oklahoma-audit-rows" \\', 'RELAY_SHARED_SECRET="x" PROBE_AUTHOR_NAME="oklahoma-audit-rows" \\',
    'workflow: the secret is in the Run step only'),
  M('W8  the log step stages all of outbox', WF,
    'PROBE_PATHS="outbox/oklahoma-audit-rows-*.log"', 'PROBE_PATHS="outbox/"',
    "workflow: only this workflow's own log is staged"),
  M('W9  the log step skips a failed run', WF,
    'if: always()', 'if: success()',
    'workflow: the log step runs even when an earlier step failed'),
  M('W10 the clean-tree assertion is dropped', WF,
    'git diff --exit-code -- scripts .github', 'true',
    'workflow: the checked-in plan is what runs'),
  M('W11 the workflow gains a push trigger', WF,
    '  workflow_dispatch:\n    inputs:', '  push:\n  workflow_dispatch:\n    inputs:',
    'workflow: dispatch only'),
  M('W12 the job has no timeout', WF,
    'timeout-minutes: 30', 'x-timeout: 30',
    'workflow: the job declares a timeout'),
];

// ── copies, not the real files ──────────────────────────────────────────
function makeTree(mut) {
  const root = mkdtempSync(join(tmpdir(), 'audit-rows-mut-'));
  for (const f of TREE) {
    mkdirSync(join(root, dirname(f)), { recursive: true });
    copyFileSync(f, join(root, f));
  }
  if (mut) {
    const file = join(root, mut.file);
    writeFileSync(file, readFileSync(file, 'utf8').replace(mut.anchor, () => mut.replace));
  }
  return root;
}
const runCheck = (root) => new Promise((resolve) => {
  const p = spawn(process.execPath, ['--no-warnings', CHECK], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
  p.on('close', code => resolve({ code, out }));
});

const missing = TREE.filter(f => !existsSync(f));
if (missing.length) { console.error(`missing: ${missing.join(', ')}`); process.exit(1); }

// the unmutated copy must pass, or every "caught" below could be a broken copy
const baseRoot = makeTree(null);
const base = await runCheck(baseRoot);
rmSync(baseRoot, { recursive: true, force: true });
if (base.code !== 0) { console.error(`BASELINE FAILED: the unmutated copy does not pass\n${base.out.split('\n').filter(l => l.startsWith('FAIL')).join('\n')}`); process.exit(1); }
console.log(`baseline: ${base.out.trim().split('\n').pop()}`);

let bad = 0;
const queue = [...MUTATIONS];
const report = [];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const m = queue.shift();
    const before = readFileSync(m.file, 'utf8');
    const hits = before.split(m.anchor).length - 1;
    if (hits !== 1) { bad++; report.push({ m, lines: [`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s) in ${m.file}, expected 1. NOTHING WAS MUTATED.`] }); continue; }
    if (before.replace(m.anchor, () => m.replace) === before) { bad++; report.push({ m, lines: [`  NO EFFECT  ${m.name}`] }); continue; }
    const root = makeTree(m);
    const { code, out } = await runCheck(root);
    rmSync(root, { recursive: true, force: true });
    const red = out.split('\n').filter(l => l.startsWith('FAIL'));
    if (code === 0) { bad++; report.push({ m, lines: [`  NOT CAUGHT  ${m.name}`] }); }
    else if (!red.some(l => l.includes(m.expect))) {
      bad++;
      report.push({ m, lines: [`  WRONG REASON  ${m.name}\n          no FAIL line mentioned "${m.expect}"\n${red.slice(0, 4).map(l => '          ' + l.slice(0, 220)).join('\n')}${red.length ? '' : '\n          (no FAIL lines; the check crashed?)\n' + out.split('\n').slice(-6).join('\n')}`] });
    } else report.push({ m, lines: [`  caught  ${m.name}\n          by "${m.expect}" (${red.length} red)`] });
  }
}));
for (const r of report.sort((a, b) => MUTATIONS.indexOf(a.m) - MUTATIONS.indexOf(b.m))) for (const l of r.lines) (l.startsWith('  caught') ? console.log : console.error)(l);

for (const f of [MOD, CHECK]) execFileSync(process.execPath, ['--check', f]);
console.log(`\nran ${MUTATIONS.length} mutation(s) against ${CHECK}, each in a throwaway copy; the checked-in files were not touched${bad ? `; ${bad} PROBLEM(S)` : ''}`);
process.exit(bad ? 1 : 0);
