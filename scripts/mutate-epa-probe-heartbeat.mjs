#!/usr/bin/env node
// Rule 90 for scripts/check-epa-probe-heartbeat.mjs: break the probe script and
// the workflow one line at a time, and demand that the check goes red.
//
// Each mutation is a bug somebody could plausibly write, named for the claim it
// breaks: "NOT OBSERVABLE is fatal on a deploy, neutral on the heartbeat, and the
// step that shows the verdict never turns it red". Each asserts its anchor is
// unique and applied before it is believed; NOT CAUGHT with nothing mutated would
// be worse than no test. The unmutated check must be green first, or every mutant
// would be "caught" by a check that was already red.
//
// Run: node scripts/mutate-epa-probe-heartbeat.mjs   (needs the three files staged or committed)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const WF = '.github/workflows/nfl-epa-route-probe.yml';
const PR = 'scripts/nfl-epa-route-probe.mjs';
const CHECK = 'scripts/check-epa-probe-heartbeat.mjs';

// `git diff --quiet` (working tree against the index): the restore below rewrites
// the working tree, so that is what must be clean.
for (const f of [WF, PR, CHECK]) {
  if (spawnSync('git', ['diff', '--quiet', '--', f]).status !== 0) {
    console.log(`FAIL — ${f} has unstaged changes; restore would lose them.`);
    process.exit(1);
  }
}
const orig = new Map([WF, PR].map((f) => [f, fs.readFileSync(f, 'utf8')]));
const restore = () => { for (const [f, t] of orig) fs.writeFileSync(f, t); };
process.on('exit', restore);
const run = () => spawnSync('node', [CHECK], { encoding: 'utf8' });

const base = run();
if (base.status !== 0) {
  console.log('FAIL — the unmutated check is not green, so no mutant means anything:');
  console.log(`${base.stdout}${base.stderr}`.split('\n').filter((l) => /FAIL/.test(l)).join('\n'));
  process.exit(1);
}
console.log('baseline: the unmutated check is green');

// [id, file, anchor (must occur exactly once), replacement, the bug it stands for]
const M = [
  ['W1', WF, 'if (!d.game) {', 'if (false) {',
    'the guard is removed: the step reads d.game.name from an artifact with no game, the original defect'],
  ['W2', WF, 'if (!d.game) {', 'if (d.game) {',
    'the guard is inverted'],
  ['W3', WF, '::notice::${d.verdict} — no game was observable', '::notice::no game was observable',
    'the no-game line stops naming the verdict'],
  ['W4', WF, 'so the route was not exercised (${d.trigger})', 'so the route was not exercised (${d.trigger}, ${d.route_plays} plays)',
    'the no-game line reads a count the artifact does not have'],
  ['W5', WF, "github.event_name == 'schedule' && '1' || '0'", "github.event_name == 'workflow_run' && '1' || '0'",
    'the heartbeat flag follows the deploy, not the cron'],
  ['W6', WF, "&& '1' || '0' }}", "&& '0' || '0' }}",
    'the heartbeat flag is never set'],
  ['W7', WF, 'run: node scripts/nfl-epa-route-probe.mjs', 'run: node scripts/nfl-epa-transcription-check.mjs',
    'the workflow runs a different script from the one the check runs'],
  ['P1', PR, 'process.exit(HEARTBEAT ? 0 : 1);', 'process.exit(1);',
    'no game is fatal on the heartbeat too: red every off-season day'],
  ['P2', PR, 'process.exit(HEARTBEAT ? 0 : 1);', 'process.exit(0);',
    'no game is neutral on a deploy too: a deploy that cannot be checked passes'],
  ['P3', PR, "process.env.EPA_PROBE_HEARTBEAT === '1'", "process.env.EPA_PROBE_HEARTBEAT === '2'",
    'the script never recognises the flag the workflow sets'],
  ['P4', PR, "trigger: HEARTBEAT ? 'heartbeat' : 'deploy',\n    verdict: 'NOT OBSERVABLE',", "trigger: 'deploy',\n    verdict: 'NOT OBSERVABLE',",
    'the artifact calls a heartbeat a deploy'],
  ['P5', PR, "verdict: 'NOT OBSERVABLE',", "verdict: 'NOT RUN',",
    'the verdict words change between the log and the manifest'],
  ['P6', PR, 'wf(`outbox/nfl-epa-route-probe-${TS}.json`, JSON.stringify({', 'void (`outbox/nfl-epa-route-probe-${TS}.json`, JSON.stringify({',
    'the NOT OBSERVABLE manifest is not written'],
];

let caught = 0, missed = 0;
for (const [id, file, from, to, why] of M) {
  const text = orig.get(file);
  const n = text.split(from).length - 1;
  if (n !== 1) { console.log(`FAIL — ${id}: the anchor occurs ${n} times in ${file}, it must occur exactly once`); process.exit(1); }
  const mutated = text.replace(from, () => to);
  if (mutated === text) { console.log(`FAIL — ${id}: the mutation changed nothing`); process.exit(1); }
  fs.writeFileSync(file, mutated);
  const r = run();
  fs.writeFileSync(file, text);
  const failing = `${r.stdout}${r.stderr}`.split('\n').filter((l) => /^\s+FAIL/.test(l)).length;
  if (r.status !== 0) { caught++; console.log(`  CAUGHT      ${id}  ${why}  (${failing} assertion(s) red)`); }
  else { missed++; console.log(`  NOT CAUGHT  ${id}  ${why}`); }
}

const clean = [...orig].every(([f, t]) => fs.readFileSync(f, 'utf8') === t);
console.log(`\n${caught} of ${M.length} caught${clean ? '' : '; FILES NOT RESTORED'}`);
process.exit(missed || !clean ? 1 : 0);
