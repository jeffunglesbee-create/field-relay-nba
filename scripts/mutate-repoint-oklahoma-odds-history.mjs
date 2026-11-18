#!/usr/bin/env node
// Rule 90 harness for scripts/check-repoint-oklahoma-odds-history.mjs.
//
// Every mutation is a way the repoint writer could move a row it was not ordered to
// move, move the right row into a state that arms a refill or a duplicate, change a
// column it should not, write twice, report done when it is not, or be dispatched the
// wrong way. A check that has only ever passed has proven nothing: each mutation below
// must turn it RED, for the reason named.
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

const MOD = 'scripts/repoint-oklahoma-odds-history.mjs';
const CHECK = 'scripts/check-repoint-oklahoma-odds-history.mjs';
const WF = '.github/workflows/repoint-oklahoma-odds-history.yml';
const TREE = [MOD, CHECK, WF, 'scripts/lib/allowed-tables.cjs', 'src/index.js'];
const CONCURRENCY = 4;

const M = (name, file, anchor, replace, expect) => ({ name, file, anchor, replace, expect });
const MUTATIONS = [
  // ── the statement's guards, one at a time ──
  M('G1  the primary key is not addressed', MOD,
    'WHERE id = ? AND game_id = ? ', 'WHERE ? IS NOT NULL AND game_id = ? ',
    'guard id: with a second row on the old game id, exactly one row changes and the other stays'),
  M('G2  the old game id is not required', MOD,
    'AND game_id = ? ', 'AND ? IS NOT NULL ',
    'guard game_id: a row on some other game id is not moved'),
  M('G3  a history row already on the keeper does not block', MOD,
    'AND NOT EXISTS (SELECT 1 FROM odds_history x WHERE x.game_id = ?) ', 'AND ? IS NOT NULL ',
    'guard keeper-free: a history row already on the keeper blocks the move'),
  M('G4  a row under the new-style id does not block', MOD,
    'AND NOT EXISTS (SELECT 1 FROM odds_history y WHERE y.id = ?) ', 'AND ? IS NOT NULL ',
    'guard new-style id: a row under the new-style id blocks the move'),
  M('G5  a keeper with no opening line does not block', MOD,
    ' AND k.opening_odds IS NOT NULL', '',
    'guard keeper-opening: a keeper with no opening line blocks the move'),
  M('G6  a keeper with no closing line does not block', MOD,
    ' AND k.closing_odds IS NOT NULL', '',
    'guard keeper-closing: a keeper with no closing line blocks the move'),
  M('G7  a missing keeper does not block', MOD,
    'AND EXISTS (SELECT 1 FROM regular_season_games k WHERE k.id = ? AND k.opening_odds IS NOT NULL AND k.closing_odds IS NOT NULL) ', 'AND ? IS NOT NULL ',
    'guard keeper-exists: no keeper row blocks the move'),
  M('G8  a games row still under the old id does not block', MOD,
    'AND NOT EXISTS (SELECT 1 FROM regular_season_games g WHERE g.id = ?) ', 'AND ? IS NOT NULL ',
    'guard old-games-row: a games row still under the old id blocks the move'),
  M('G9  a missing progress row does not block', MOD,
    'AND EXISTS (SELECT 1 FROM odds_backfill_progress p WHERE p.date = ?)', 'AND ? IS NOT NULL',
    'guard progress: no 2026-11-15 progress row blocks the move'),
  M('G10 the row is moved to the old game id instead of the keeper', MOD,
    'params: [KEEPER, PK, STALE, KEEPER, NEW_STYLE_ID, KEEPER, STALE, PROGRESS_DATE]', 'params: [STALE, PK, STALE, KEEPER, NEW_STYLE_ID, KEEPER, STALE, PROGRESS_DATE]',
    'fresh: the row is now on the keeper'),
  M('G11 the statement addresses the wrong primary key', MOD,
    'params: [KEEPER, PK, STALE,', 'params: [KEEPER, NEW_STYLE_ID, STALE,',
    'fresh: the statement changes exactly one row'),
  M('G12 the statement also rewrites a second column', MOD,
    'UPDATE odds_history SET game_id = ? WHERE id', "UPDATE odds_history SET game_id = ?, date = '2026-11-15' WHERE id",
    'fresh: every other column of that row, the primary key included, is byte-identical'),
  // ── the pinned facts ──
  M('K1  the primary key is wrong', MOD,
    "export const PK = 'CFB_2026-11-14_e401856887_draftkings_close';", "export const PK = 'CFB_2026-11-14_e401856887_draftkings_closed';",
    'the pinned facts are what the owner\'s order and the D1 read said'),
  M('K2  the new-style id is wrong', MOD,
    "export const NEW_STYLE_ID = 'CFB_2026-11-15_e401856887_draftkings_close';", "export const NEW_STYLE_ID = 'CFB_2026-11-15_e401856887_draftkings_open';",
    'the pinned facts are what the owner\'s order and the D1 read said'),
  M('K3  the progress date is wrong', MOD,
    "export const PROGRESS_DATE = '2026-11-15';", "export const PROGRESS_DATE = '2026-11-16';",
    'the pinned facts are what the owner\'s order and the D1 read said'),
  M('K4  the pinned created_at is wrong', MOD,
    "created_at: '2026-11-15 16:51:48',", "created_at: '2026-11-15 16:51:49',",
    'the pinned facts are what the owner\'s order and the D1 read said'),
  M('K5  the pinned snapshot_time is wrong', MOD,
    "snapshot_time: '2026-11-14T23:55:04Z'", "snapshot_time: '2026-11-14T23:55:05Z'",
    'the pinned facts are what the owner\'s order and the D1 read said'),
  M('K6  the pinned home price is wrong', MOD,
    'home_ml: 1.68,', 'home_ml: 1.69,',
    'the pinned facts are what the owner\'s order and the D1 read said'),
  M('K7  the pinned row is not frozen', MOD,
    'export const ROW = Object.freeze({', 'export const ROW = ({',
    'the pinned row is frozen'),
  M('K8  the history read selects every column', MOD,
    'SELECT id, game_id, sport, date, home_team, away_team, commence_time, home_ml, away_ml, draw_ml, over_under, over_price, under_price, bookmaker, snapshot_time, snapshot_type, created_at FROM odds_history WHERE id = ?', 'SELECT * FROM odds_history WHERE id = ?',
    'the history read names its columns'),
  // ── the preconditions ──
  M('E1  a third games row for the event is allowed', MOD,
    'state.games.length === 1 && Boolean(keeper)', 'Boolean(keeper)',
    'a third games row for the event is refused'),
  M('E2  an unscored keeper (no home score) is allowed', MOD,
    'keeper.home_score != null && ', '',
    'an unscored keeper (no home score) is refused'),
  M('E3  an unscored keeper (no away score) is allowed', MOD,
    'keeper.away_score != null && ', '',
    'an unscored keeper (no away score) is refused'),
  M('E4  a postseason row for the event is allowed', MOD,
    'keeper.away_score != null && state.postseasonCount === 0,', 'keeper.away_score != null,',
    'a postseason row for the event is refused'),
  M('E5  a keeper with no opening line is allowed', MOD,
    "Boolean(keeper) && present(keeper.opening_odds), 'opening_odds is empty'", "true, 'opening_odds is empty'",
    'a keeper with no opening line (NULL) is refused'),
  M('E6  a keeper with no closing line is allowed', MOD,
    "Boolean(keeper) && present(keeper.closing_odds), 'closing_odds is empty'", "true, 'closing_odds is empty'",
    'a keeper with no closing line (NULL) is refused'),
  M('E7  an empty line counts as a line', MOD,
    "const present = (v) => typeof v === 'string' && v.length > 0;", "const present = (v) => typeof v === 'string';",
    'a keeper with an empty opening line is refused'),
  M('E8  a NULL line counts as a line', MOD,
    "const present = (v) => typeof v === 'string' && v.length > 0;", 'const present = (v) => v !== undefined;',
    'a keeper with no opening line (NULL) is refused'),
  M('E9  a missing progress row is allowed', MOD,
    'state.progress.length === 1 && state.progress[0].date === PROGRESS_DATE, ', 'true, ',
    'no 2026-11-15 progress row is refused'),
  M('E10 a progress row for another date is allowed', MOD,
    'state.progress.length === 1 && state.progress[0].date === PROGRESS_DATE, ', 'state.progress.length === 1, ',
    'evaluate refuses a progress row that is not 2026-11-15'),
  M('E11 a history row that differs from the pin is allowed', MOD,
    'matchesPinned(row),', 'row !== null,',
    'a history row with another sport is refused'),
  M('E12 created_at is not part of the pin', MOD,
    "Object.keys(ROW).every(k => k === 'game_id' || r[k] === ROW[k])", "Object.keys(ROW).every(k => k === 'game_id' || k === 'created_at' || r[k] === ROW[k])",
    'a history row with another created_at is refused'),
  M('E13 a taken new-style id is allowed', MOD,
    'state.newStyle === 0, ', 'true, ',
    'a row under the new-style id is refused'),
  M('E14 a row on some other game id is allowed', MOD,
    'phase !== \'refuse\', ', 'true, ',
    'a history row on some other game id is refused'),
  M('E15 any other game id reads as done', MOD,
    ": at === KEEPER ? 'done' : 'refuse';", ": 'done';",
    'a history row on some other game id is refused'),
  M('E16 a second row on the old game id is allowed before the move', MOD,
    'state.onOld === 1 && state.onKeeper === 0', 'state.onKeeper === 0',
    'a second history row on the old game id is refused'),
  M('E17 a row already on the keeper is allowed before the move', MOD,
    'state.onOld === 1 && state.onKeeper === 0', 'state.onOld === 1',
    'a history row already on the keeper, beside the one before the move, is refused'),
  M('E18 a row left on the old game id is allowed after the move', MOD,
    'state.onOld === 0 && state.onKeeper === 1', 'state.onKeeper === 1',
    'after the move, a row left on the old game id is refused'),
  M('E19 a second row on the keeper is allowed after the move', MOD,
    'state.onOld === 0 && state.onKeeper === 1', 'state.onOld === 0',
    'after the move, a second row on the keeper is refused'),
  M('E20 two rows for the primary key read as one', MOD,
    'state.rows.length === 1 ? state.rows[0] : null', 'state.rows.length >= 1 ? state.rows[0] : null',
    'evaluate refuses two history rows for the primary key'),
  M('E21 a count that never arrived is read as zero', MOD,
    'Number(arr(name)[0]?.n ?? NaN)', 'Number(arr(name)[0] === undefined ? 0 : arr(name)[0].n)',
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
    'if (changes !== 1) {', 'if (false) {',
    'executor: a write with no changes count stops the run'),
  M('X4  a write that reports 2 rows passes', MOD,
    'if (changes !== 1) {', 'if (changes < 1) {',
    'executor: a write that reports 2 rows stops the run'),
  M('X5  a write that changes 0 rows passes', MOD,
    'if (changes !== 1) {', 'if (changes === undefined) {',
    'executor: a write that changes 0 rows stops the run'),
  M('X6  the verdict is not read back', MOD,
    "const ok = again.ok && again.phase === 'done' && gamesSame;", 'const ok = true;',
    'executor: a column of the row that changed during the run is a mismatch'),
  M('X7  the re-read\'s own preconditions are not required', MOD,
    "const ok = again.ok && again.phase === 'done' && gamesSame;", "const ok = again.phase === 'done' && gamesSame;",
    'executor: a column of the row that changed during the run is a mismatch'),
  M('X8  the games table is not compared after the run', MOD,
    "again.phase === 'done' && gamesSame;", "again.phase === 'done';",
    'executor: a games row that changed during the run is a mismatch'),
  M('X9  a finished job is written again', MOD,
    "if (ev.phase === 'done') {", 'if (false) {',
    'executor: a second apply is a no-op that says so'),
  M('X10 a failing statement does not say what failed', MOD,
    'STOP: ${s.name} failed: ${e.message}', 'STOP: ${s.name} failed',
    'executor: a failing statement stops the run and names the error'),
  M('X11 a missing results array is read as an empty table', MOD,
    'return { results: b.results, meta: b.meta };', 'return { results: Array.isArray(b.results) ? b.results : [], meta: b.meta === undefined ? {} : b.meta };',
    'relayD1: a success body with no results array leaves results missing'),
  M('X12 a body that is not JSON is read as an empty answer', MOD,
    'catch (e) { throw new Error(`d1 HTTP ${res.status}: body is not JSON: ${text.slice(0, 200)}`); }', 'catch (e) { b = {}; }',
    'relayD1: a body that is not JSON is a failure'),
  M('X13 a JSON null body passes', MOD,
    "if (b === null || typeof b !== 'object') throw new Error(", 'if (false) throw new Error(',
    'relayD1: a body that is JSON null is a failure'),
  M('X14 an HTTP error with a success body passes', MOD,
    'if (!res.ok || b.success === false) throw', 'if (b.success === false) throw',
    'relayD1: an HTTP error status is a failure even when the body says success'),
  M('X15 success:false on HTTP 200 passes', MOD,
    'if (!res.ok || b.success === false) throw', 'if (!res.ok) throw',
    'relayD1: success:false is a failure even on HTTP 200'),
  M('X16 a request can hang forever', MOD,
    '      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),\n', '',
    'relayD1: the request is a POST to /d1/execute with the secret header'),
  M('X17 a call can be made with no secret', MOD,
    "if (!secret) throw new Error('RELAY_SHARED_SECRET is not set; refusing to call /d1/execute');", '',
    'relayD1: no secret means no call'),
  M('X18 the CLI applies by default', MOD,
    "apply: process.argv.includes('--apply')", 'apply: true',
    'cli: with no flag it is a dry run'),
  M('X19 the CLI runs without a secret', MOD,
    'relayD1(process.env.RELAY_SHARED_SECRET)', "relayD1(process.env.RELAY_SHARED_SECRET || 'x')",
    'cli: with no secret it refuses before any call'),
  M('X20 the log is not written as it goes', MOD,
    "appendFileSync(running, s + '\\n');", '',
    'cli: the dry run left a log named for its outcome, holding what was printed'),
  M('X21 the header does not carry the run', MOD,
    '${runId ? `  ${runId}` : \'\'} ===', ' ===',
    'executor: and prints the statement, that nothing was written, and the run identity'),
  M('X22 the CLI never names the run', MOD,
    'process.env.GITHUB_RUN_ID ? ', 'false ? ',
    'cli: the log names the run and its outcome'),
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
    'group: oklahoma-odds-history-repoint', 'group: x',
    'workflow: one run at a time, and a running one is never cancelled'),
  M('W5  Node is not pinned to 22', WF,
    "node-version: '22'", "node-version: '20'",
    'workflow: Node 22 is pinned'),
  M('W6  the input is interpolated into the script', WF,
    'if [ "$APPLY_INPUT" = "APPLY" ]; then', 'if [ "${{ github.event.inputs.apply }}" = "APPLY" ]; then',
    'workflow: the apply input reaches the shell through env'),
  M('W7  the secret reaches the commit step', WF,
    'PROBE_AUTHOR_NAME="oklahoma-odds-history-repoint" \\', 'RELAY_SHARED_SECRET="x" PROBE_AUTHOR_NAME="oklahoma-odds-history-repoint" \\',
    'workflow: the secret is in the Run step only'),
  M('W8  the log step stages all of outbox', WF,
    'PROBE_PATHS="outbox/oklahoma-odds-history-repoint-*.log"', 'PROBE_PATHS="outbox/"',
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
  M('W13 the Run step applies another script', WF,
    'node scripts/repoint-oklahoma-odds-history.mjs --apply', 'node scripts/write-oklahoma-audit-rows.mjs --apply',
    'workflow gate: the literal APPLY adds --apply'),
  M('W14 the harness is not run before the plan', WF,
    '          node scripts/mutate-repoint-oklahoma-odds-history.mjs\n', '',
    'workflow: it runs this check and this harness, and the script it applies is this one'),
  M('W15 the apply input defaults to APPLY', WF,
    "default: 'dry-run'", "default: 'APPLY'",
    'workflow: the apply input defaults to a dry run'),
  M('W16 the Run step comes before the plan step', WF,
    '      - name: The plan must pass its own checks, and its own mutations, before it may run\n',
    '      - name: Run\n        run: echo x\n      - name: The plan must pass its own checks, and its own mutations, before it may run\n',
    'workflow: the plan step comes before Run, and Run before the log step'),
  M('W17 the secret is set at job level', WF,
    '    timeout-minutes: 30\n', '    timeout-minutes: 30\n    env:\n      RELAY_SHARED_SECRET: ${{ secrets.RELAY_SHARED_SECRET }}\n',
    'workflow: the secret appears once, in the Run step'),
  M('W18 permissions are widened', WF,
    'permissions:\n  contents: write\n', 'permissions: write-all\n',
    'workflow: permissions are contents: write and nothing else'),
  M('W19 env is set at workflow level', WF,
    'permissions:\n  contents: write\n', 'permissions:\n  contents: write\n\nenv:\n  X: 1\n',
    'workflow: env is set in the Run step only'),
  M('W20 another expression is interpolated into the script', WF,
    'authorised by input"', 'authorised by ${{ github.actor }}"',
    'workflow: the expressions are exactly the secret and the apply input, in that order'),
  M('X23 the apply path prints the secret', MOD,
    'say(`\\n--- 2. write`);', 'say(`\\n--- 2. write ${process.env.RELAY_SHARED_SECRET}`);',
    'cli: no run prints the secret, in the console or in a log file'),
  M('X24 a re-read that fails does not say the write landed', MOD,
    'the write reported changes=1 but the re-read failed: ${e.message}', 'the re-read failed',
    'executor: a re-read that fails after the write says the write landed, and what to do'),
  M('G13 the handler\'s table regex stops seeing UPDATE (the check must notice its copy has drifted)', 'src/index.js',
    'const tableName = sql.match(/(?:INTO|FROM|UPDATE|TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?)\\s+(\\w+)/i)?.[1];',
    'const tableName = sql.match(/(?:INTO|FROM|TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?)\\s+(\\w+)/i)?.[1];',
    "the check's table regex is the /d1/execute handler's"),
];

// ── copies, not the real files ──────────────────────────────────────────
function makeTree(mut) {
  const root = mkdtempSync(join(tmpdir(), 'repoint-mut-'));
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
