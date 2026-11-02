#!/usr/bin/env node
// Rule 90 for assertion 5 of the workflow YAML gate: a scheduled workflow must have
// a root job that can run on a schedule event.
//
// It breaks the judge (scripts/lib/workflow-if-eval.mjs) and the gate wiring
// (scripts/workflow-yaml-check.mjs) one line at a time, and demands that something
// goes red. "Red" is: the judge's own self-test fails, OR one of four small
// workflow directories, run through the real gate, stops giving the verdict it
// must give:
//
//   buggy   the shape that skipped 66 of 66 runs          gate must exit 1, naming the job
//   fixed   its repair                                    gate must exit 0 and report 1 run
//   pair    a push job beside a scheduled job             gate must exit 0 (design, not a fault)
//   broken  a file that is not YAML                       gate must still exit 1 ("does not parse")
//
// The last one is a regression for assertion 1, not a proof of it: assertions 1-4
// have never had a mutation harness, and this adds one fixture, not four.
//
// Each mutation asserts its anchor is unique and applied before reporting. NOT
// CAUGHT with nothing mutated is worse than no test.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LIB = 'scripts/lib/workflow-if-eval.mjs';
const GATE = 'scripts/workflow-yaml-check.mjs';
const SELF = 'scripts/check-workflow-if-eval.mjs';

// `git diff --quiet` (working tree against the index), not `git status`: the
// restore below rewrites the working tree, so that is what must be clean.
for (const f of [LIB, GATE, SELF]) {
  if (spawnSync('git', ['diff', '--quiet', '--', f]).status !== 0) {
    console.log(`FAIL — ${f} has unstaged changes; restore would lose them.`);
    process.exit(1);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-if-eval-'));
const put = (dir, name, text) => {
  fs.mkdirSync(path.join(tmp, dir), { recursive: true });
  fs.writeFileSync(path.join(tmp, dir, name), text);
  return path.join(tmp, dir);
};
const BUGGY_IF = "${{ github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success' }}";
const FIXED_IF = "${{ github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success' }}";
const epa = (iff) => `name: EPA-shaped
on:
  workflow_dispatch:
  schedule:
    - cron: '0 14 * * *'
  workflow_run:
    workflows: ["Deploy RELAY Worker"]
    types: [completed]
jobs:
  probe:
    runs-on: ubuntu-latest
    if: ${iff}
    steps:
      - run: echo hi
`;
const DIRS = {
  buggy: put('buggy', 'epa.yml', epa(BUGGY_IF)),
  fixed: put('fixed', 'epa.yml', epa(FIXED_IF)),
  pair: put('pair', 'auto.yml', `name: pair
on:
  schedule:
    - cron: '0 6 * * *'
  push:
    branches: [main]
jobs:
  sweep:
    runs-on: ubuntu-latest
    steps:
      - run: echo sweep
  on-push:
    runs-on: ubuntu-latest
    if: github.event_name == 'push'
    steps:
      - run: echo push
`),
  broken: put('broken', 'x.yml', 'on: [unclosed\njobs: {\n'),
};
const gate = (dir) => {
  const r = spawnSync('node', [GATE], { env: { ...process.env, WORKFLOW_DIR: dir }, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

/** What must hold. Returns the list of broken expectations; empty means all hold. */
function broken() {
  const problems = [];
  if (spawnSync('node', [SELF], { stdio: 'ignore' }).status !== 0) problems.push('the judge\'s self-test is red');
  const a = gate(DIRS.buggy);
  if (!(a.status === 1 && a.out.includes('every root job is provably skipped') && a.out.includes('probe'))) {
    problems.push('the gate does not fail the shape that skipped 66 of 66 runs');
  }
  const b = gate(DIRS.fixed);
  if (!(b.status === 0 && b.out.includes('1 of 1 workflow(s) declare a schedule') && b.out.includes('1 run, 0 skipped'))) {
    problems.push('the gate fails, or mis-reports, the repaired shape');
  }
  const c = gate(DIRS.pair);
  if (!(c.status === 0 && c.out.includes('2 root job(s) judged on a schedule event: 1 run, 1 skipped'))) {
    problems.push('the gate fails a push job that sits beside a scheduled one');
  }
  const d = gate(DIRS.broken);
  if (!(d.status === 1 && d.out.includes('does not parse'))) problems.push('the gate stopped failing a file that is not YAML');
  return problems;
}

const base = broken();
if (base.length) {
  console.log(`FAIL — red on clean source: ${base.join('; ')}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}
console.log('baseline: the judge self-test and all four gate fixtures hold on clean source\n');

const MUTATIONS = [
  { name: 'M1 string equality becomes case-sensitive', file: LIB,
    anchor: "  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();",
    replace: "  if (typeof a === 'string' && typeof b === 'string') return a === b;",
    catches: 'GitHub compares strings case-insensitively; \'SCHEDULE\' would no longer equal \'schedule\'' },

  { name: 'M2 an absent payload key reads as undecided', file: LIB,
    anchor: "    if (ctx.eventName === 'schedule' && p.length >= 3 && p[1] === 'event' && ABSENT_ON_SCHEDULE.has(p[2])) return null;",
    replace: "    if (ctx.eventName === 'schedule' && p.length >= 3 && p[1] === 'event' && ABSENT_ON_SCHEDULE.has(p[2])) return UNK;",
    catches: 'the shipped shape is no longer provable, so the 66-of-66 workflow passes the gate' },

  { name: 'M3 the inputs context reads as undecided', file: LIB,
    anchor: "  if (ctx.eventName === 'schedule' && p[0] === 'inputs' && p.length >= 2) return null;",
    replace: "  if (ctx.eventName === 'schedule' && p[0] === 'inputs' && p.length >= 2) return UNK;",
    catches: 'a job gated on a dispatch input can no longer be shown to skip on a tick' },

  { name: 'M4 || returns its right operand when the left is true', file: LIB,
    anchor: '      if (tl === true) return l;',
    replace: '      if (tl === true) return evaluate(n.r, ctx);',
    catches: 'the repair itself reads as skipped, because the right half is evaluated although the left is true' },

  { name: 'M5 && returns its right operand when the left is false', file: LIB,
    anchor: '      if (tl === false) return l;',
    replace: '      if (tl === false) return evaluate(n.r, ctx);',
    catches: 'a falsy left operand stops short-circuiting, so a skipped job reads as runnable' },

  { name: 'M6 ! stops negating', file: LIB,
    anchor: "    case 'not': { const t = truth(evaluate(n.x, ctx)); return t === null ? UNK : !t; }",
    replace: "    case 'not': { const t = truth(evaluate(n.x, ctx)); return t === null ? UNK : t; }",
    catches: '!cancelled() and !inputs.skip are judged backwards' },

  { name: 'M7 an undecided condition reads as false', file: LIB,
    anchor: "  return t === null ? { verdict: null, why: 'unknown' } : { verdict: t, why: 'decided' };",
    replace: "  return { verdict: t === true, why: 'decided' };",
    catches: 'the check guesses, and fails workflows it cannot actually judge' },

  { name: 'M8 an unparseable condition reads as false', file: LIB,
    anchor: "  catch (e) { return { verdict: null, why: 'unparseable' }; }",
    replace: "  catch (e) { return { verdict: false, why: 'unparseable' }; }",
    catches: 'a condition this file cannot read is reported as a workflow that never runs' },

  { name: 'M9 the ${{ }} wrapper is not stripped', file: LIB,
    anchor: "  if (wrapped && !wrapped[1].includes('${{') && !wrapped[1].includes('}}')) src = wrapped[1];",
    replace: '  if (false) src = wrapped[1];',
    catches: 'the shipped condition is wrapped, so it becomes a text template and is never judged' },

  { name: 'M10 null stops coercing to 0', file: LIB,
    anchor: '  if (v === null || v === false) return 0;',
    replace: '  if (v === false) return 0;',
    catches: 'null == \'success\' is undecided, which is the comparison that skipped 66 of 66 runs' },

  { name: 'M11 a non-numeric string coerces to 0', file: LIB,
    anchor: '    if (!/\\d/.test(v) && !/infinity|nan/i.test(v)) return NaN;',
    replace: '    if (!/\\d/.test(v) && !/infinity|nan/i.test(v)) return 0;',
    catches: '\'success\' becomes 0, so null == \'success\' is TRUE and the bug reads as a working condition' },

  { name: 'M12 always() reads as false', file: LIB,
    anchor: "    case 'always': case 'success': return true;",
    replace: "    case 'always': case 'success': return false;",
    catches: 'an always() job is reported as one that never runs' },

  { name: 'M13 cancelled() reads as true', file: LIB,
    anchor: "    case 'failure': case 'cancelled': return false;",
    replace: "    case 'failure': case 'cancelled': return true;",
    catches: '!cancelled() is judged as a job that never runs' },

  { name: 'M14 a list-form trigger is not recognised as scheduled', file: LIB,
    anchor: "  if (Array.isArray(t)) return t.includes('schedule');",
    replace: '  if (Array.isArray(t)) return false;',
    catches: '`on: [push, schedule]` workflows escape the check' },

  { name: 'M15 a string-form trigger is not recognised as scheduled', file: LIB,
    anchor: "  if (typeof t === 'string') return t === 'schedule';",
    replace: '  if (typeof t === \'string\') return false;',
    catches: '`on: schedule` workflows escape the check' },

  { name: 'M16 the YAML 1.1 boolean key is not read', file: LIB,
    anchor: "  const t = doc && (doc.on ?? doc['true']);",
    replace: '  const t = doc && doc.on;',
    catches: 'every workflow whose `on` parses as `true` — all of them — looks unscheduled and is never judged' },

  { name: 'M17 a job downstream of a skipped root counts as a root', file: LIB,
    anchor: "    .filter(([, j]) => j && typeof j === 'object' && !hasNeeds(j))",
    replace: "    .filter(([, j]) => j && typeof j === 'object')",
    catches: 'a summary job with always() masks a root that never ran' },

  { name: 'M18 one skipped root is enough to fail', file: LIB,
    anchor: '  if (roots.length && roots.every((r) => r.verdict === false)) {',
    replace: '  if (roots.length && roots.some((r) => r.verdict === false)) {',
    catches: 'a push job beside a scheduled job (auto-merge-stray-branches.yml) is called a fault' },

  { name: 'M19 a workflow with no root job is vacuous', file: LIB,
    anchor: '  if (roots.length && roots.every((r) => r.verdict === false)) {',
    replace: '  if (roots.every((r) => r.verdict === false)) {',
    catches: 'every workflow whose jobs all have `needs` fails, because every() of nothing is true' },

  { name: 'M20 needs: [] stops being a root', file: LIB,
    anchor: 'const hasNeeds = (job) => (Array.isArray(job.needs) ? job.needs.length > 0 :',
    replace: 'const hasNeeds = (job) => (Array.isArray(job.needs) ? true :',
    catches: 'an empty needs list hides a root job from the rule' },

  { name: 'M21 the coverage line stops counting skipped roots', file: LIB,
    anchor: '    + `${count((r) => r.verdict === true)} run, ${count((r) => r.verdict === false)} skipped, `',
    replace: '    + `${count((r) => r.verdict === true)} run, 0 skipped, `',
    catches: 'the denominator hides what the check found, so a run that skips everything looks like one that skips nothing' },

  { name: 'G1 the gate stops reporting the scheduled-job findings', file: GATE,
    anchor: '  for (const m of wv.findings) fail(m);',
    replace: '',
    catches: 'the judge is right and nothing asks it, so the shipped shape passes the gate' },

  { name: 'G2 the gate stops printing the coverage line', file: GATE,
    anchor: 'console.log(`  ${coverageLine(judged)}`);',
    replace: '',
    catches: 'a green gate that no longer says how many scheduled jobs it looked at' },

  { name: 'G3 the gate stops collecting what it judged', file: GATE,
    anchor: '  judged.push(wv);',
    replace: '',
    catches: 'the coverage line reads 0 of 0 while the check passes' },

  { name: 'G4 a finding no longer fails the gate', file: GATE,
    anchor: 'process.exit(failures.length ? 1 : 0);',
    replace: 'process.exit(0);',
    catches: 'findings are printed and ignored' },
];

let caught = 0;
for (const mut of MUTATIONS) {
  const original = fs.readFileSync(mut.file, 'utf8');
  const hits = original.split(mut.anchor).length - 1;
  if (hits !== 1) {
    console.log(`FAIL       ${mut.name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`);
    continue;
  }
  fs.writeFileSync(mut.file, original.replace(mut.anchor, mut.replace));
  if (fs.readFileSync(mut.file, 'utf8') === original) {
    console.log(`FAIL       ${mut.name}\n            file unchanged — NOTHING MUTATED.`);
    continue;
  }
  const why = broken();
  fs.writeFileSync(mut.file, original);
  console.log(`${why.length ? 'CAUGHT    ' : 'NOT CAUGHT'} ${mut.name}\n            (${mut.catches})`);
  if (why.length) { console.log(`            red: ${why.join('; ')}`); caught++; }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${caught} of ${MUTATIONS.length} mutations caught.`);
console.log('COVERAGE: the judge (event name, absent payload keys, the empty inputs context, coercion, short-circuit,');
console.log('status functions, the trigger forms, the root-job rule, the coverage line) and the gate wiring, through');
console.log('four fixture directories run by the real workflow-yaml-check.mjs. It does NOT prove assertions 1-4');
console.log('(one regression fixture, not a mutation), and it does not read the real workflows: the gate does, on');
console.log('every push that touches .github/workflows/.');
process.exit(caught === MUTATIONS.length ? 0 : 1);
