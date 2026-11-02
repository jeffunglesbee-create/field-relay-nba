#!/usr/bin/env node
// Self-test for scripts/lib/workflow-if-eval.mjs, the judge behind assertion 5 of
// scripts/workflow-yaml-check.mjs ("a scheduled workflow has a root job that can
// run on a schedule event"). The check itself runs inside that gate, on every
// push that touches .github/workflows/; this file proves the judge is right, on
// every push, and scripts/mutate-workflow-if-eval.mjs proves THIS file can fail.
//
// The shape it exists for is nfl-epa-route-probe.yml, which skipped 66 of 66
// scheduled runs because its job `if:` read `github.event.workflow_run.conclusion`.
// Run: node scripts/check-workflow-if-eval.mjs
import { judgeIf, judgeWorkflow, coverageLine, hasSchedule } from './lib/workflow-if-eval.mjs';

let ran = 0, bad = 0;
// Strict equality over scalars, and COUNTED: a hardcoded total hides a deleted case.
const one = (label, got, want, why) => (ran++, got === want
  ? console.log(`  PASS  ${label} -> ${JSON.stringify(got)}  (${why})`)
  : (bad++, console.log(`  FAIL  ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`)));
const v = (src) => String(judgeIf(src).verdict);

// ── the shape that shipped, and its repair ─────────────────────────────────
const EPA_BUGGY = "${{ github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success' }}";
const EPA_FIXED = "${{ github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success' }}";
one('the shipped condition, on a schedule', v(EPA_BUGGY), 'false',
    'dispatch is false and null == \'success\' is false: 66 of 66 runs skipped');
one('its repair', v(EPA_FIXED), 'true', 'only a workflow_run event is gated on an upstream conclusion');
one('the same repair, unwrapped', v("github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success'"),
    'true', 'provenance-runtime-probe.yml writes it without ${{ }}');

// ── the event name ─────────────────────────────────────────────────────────
one('event is schedule', v("github.event_name == 'schedule'"), 'true', 'the one fact a scheduled run is sure of');
one('event is push', v("github.event_name == 'push'"), 'false', 'a push-only job never runs on a tick');
one('string equality ignores case', v("github.event_name == 'SCHEDULE'"), 'true', 'GitHub compares strings case-insensitively');
one('context names ignore case', v("GITHUB.EVENT_NAME == 'schedule'"), 'true', 'so do property names');
one('bracket access', v("github['event_name'] == 'schedule'"), 'true', 'an equivalent spelling');
one('not workflow_run', v("github.event_name != 'workflow_run'"), 'true', 'the repair\'s first operand');
one('dispatch or push', v("github.event_name == 'push' || github.event_name == 'workflow_dispatch'"), 'false',
    'neither is schedule');

// ── payload keys that belong to other events ───────────────────────────────
one('workflow_run conclusion', v("github.event.workflow_run.conclusion == 'success'"), 'false',
    'null == \'success\': null is 0 and \'success\' is NaN');
one('null equals the empty string', v("github.event.workflow_run.conclusion == ''"), 'true',
    'both coerce to 0 — GitHub\'s own rule, and the one that makes the case above not a typo');
one('an input, negated', v('!inputs.skip'), 'true', 'the inputs context is empty on a schedule: !null');
one('an input, compared', v("inputs.dry_run == 'true'"), 'false', 'a dispatch default is not applied to a tick');
one('an event input', v("github.event.inputs.mode == 'full'"), 'false', 'the same fact through the event');

// ── values this file cannot know are UNDECIDED, never guessed ──────────────
one('the ref', v("github.ref == 'refs/heads/main'"), 'null', 'not modelled');
one('the cron string', v("github.event.schedule == '0 14 * * *'"), 'null', 'present in the payload, value unknown here');
one('a repository variable', v("vars.ENABLED == 'true'"), 'null', 'set in the repo\'s settings, not in the file');
one('the repository', v("github.repository == 'o/r'"), 'null', 'not modelled');
one('an upstream job result', v("needs.a.result == 'success'"), 'null', 'a root job has none, but it is not this file\'s call');
one('fromJSON', v("fromJSON('[1]')[0] == 1"), 'null', 'a function this file does not evaluate');

// ── three-valued composition ───────────────────────────────────────────────
one('unknown and false', v("github.ref == 'refs/heads/main' && github.event_name == 'push'"), 'false',
    'false whichever way the unknown falls');
one('unknown or true', v("github.ref == 'refs/heads/main' || github.event_name == 'schedule'"), 'true',
    'true whichever way the unknown falls');
one('unknown and true', v("github.ref == 'refs/heads/main' && github.event_name == 'schedule'"), 'null', 'depends on the unknown');
one('unknown or false', v("github.ref == 'refs/heads/main' || github.event_name == 'push'"), 'null', 'depends on the unknown');
one('not unknown', v("!(github.ref == 'refs/heads/main')"), 'null', 'still unknown');
one('not false', v("!(github.event_name == 'push')"), 'true', 'a negated known fact');
one('parentheses', v("(github.event_name == 'push' || github.event_name == 'pull_request') && true"), 'false',
    'grouping changes the answer');
one('precedence', v("github.event_name == 'schedule' || github.event_name == 'push' && false"), 'true',
    '&& binds tighter than ||');

// ── status functions, for a root job with no upstream ──────────────────────
one('always()', v('always()'), 'true', 'runs regardless');
one('success()', v('success()'), 'true', 'nothing upstream has failed');
one('failure()', v('failure()'), 'false', 'nothing upstream has failed');
one('cancelled()', v('cancelled()'), 'false', 'not cancelled at the start');
one('!cancelled()', v('!cancelled()'), 'true', 'the usual spelling of "unless cancelled"');
one('contains, known', v("contains('workflow_dispatch,schedule', github.event_name)"), 'true', 'case-insensitive substring');
one('startsWith, known', v("startsWith(github.event_name, 'sched')"), 'true', 'a prefix');
one('endsWith, known', v("endsWith(github.event_name, 'x')"), 'false', 'a suffix');
one('contains of a null', v("contains(github.event.workflow_run.name, 'x')"), 'null', 'a null argument is not modelled');
one('format', v("format('{0}', github.event_name) == 'schedule'"), 'null', 'a function this file does not evaluate');

// ── literals, numbers and the `if:` YAML hands over ────────────────────────
one('YAML false', String(judgeIf(false).verdict), 'false', 'a job disabled with `if: false`');
one('YAML true', String(judgeIf(true).verdict), 'true', 'a literal');
one('no if at all', String(judgeIf(undefined).verdict), 'true', 'an unconditional job');
one('YAML zero', String(judgeIf(0).verdict), 'false', 'falsy');
one('an empty value', String(judgeIf(null).verdict), 'null', '`if:` with nothing after it: not guessed');
one('numeric comparison', v('1 < 2'), 'true', 'relational operators coerce to numbers');
one('numeric comparison, false', v('2 < 1'), 'false', 'and can be false');
one('an escaped quote', v("github.event_name == 'it''s'"), 'false', '\'\' is one quote inside a string');
one('across lines', v("github.event_name == 'push' ||\n  github.event_name == 'schedule'"), 'true', 'a folded scalar');

// ── what cannot be read says so, and is counted as such ────────────────────
one('malformed', v('github.event_name =='), 'null', 'not parsed, so not judged');
one('malformed, why', judgeIf('github.event_name ==').why, 'unparseable', 'counted under its own heading');
one('a text template', v('run if ${{ github.event_name }}'), 'null', 'string interpolation, not an expression');
one('a text template, why', judgeIf('run if ${{ github.event_name }}').why, 'template', 'counted under its own heading');
one('unknown, why', judgeIf("github.ref == 'x'").why, 'unknown', 'counted under its own heading');

// ── the workflow-level rule ────────────────────────────────────────────────
const wf = (on, jobs) => ({ true: on, jobs });
const SCHED = { schedule: [{ cron: '0 14 * * *' }] };
const job = (iff, extra = {}) => ({ 'runs-on': 'ubuntu-latest', ...(iff === undefined ? {} : { if: iff }), ...extra });
const nFind = (doc) => judgeWorkflow(doc).findings.length;

const epa = (iff) => wf({ workflow_dispatch: null, ...SCHED, workflow_run: { workflows: ['Deploy RELAY Worker'], types: ['completed'] } },
                        { probe: job(iff) });
one('the shipped workflow', nFind(epa(EPA_BUGGY)), 1, 'the only root job is provably skipped');
one('the shipped workflow, named', judgeWorkflow(epa(EPA_BUGGY)).findings[0].includes('probe'), true, 'the finding names the job');
one('the repaired workflow', nFind(epa(EPA_FIXED)), 0, 'the root job runs on a tick');
one('not scheduled', nFind(wf({ push: {} }, { a: job("github.event_name == 'push'") })), 0, 'no cron, nothing to skip');
one('two roots, one skipped',
    nFind(wf(SCHED, { sweep: job(undefined), 'on-push': job("github.event_name == 'push'") })), 0,
    'auto-merge-stray-branches.yml: a push job beside a scheduled one is design');
one('two roots, both skipped',
    nFind(wf(SCHED, { a: job("github.event_name == 'push'"), b: job("github.event_name == 'workflow_dispatch'") })), 1,
    'nothing can run on a tick');
one('a root that cannot be decided', nFind(wf(SCHED, { a: job("github.ref == 'refs/heads/main'") })), 0,
    'claims only what it can prove');
one('a root with no if', nFind(wf(SCHED, { a: job(undefined) })), 0, 'unconditional');
one('a skipped root with an always() dependent',
    nFind(wf(SCHED, { a: job("github.event_name == 'push'"), b: job('always()', { needs: 'a' }) })), 1,
    'the work in the root never ran; a summary job that runs anyway does not change that');
one('needs: [] is still a root', nFind(wf(SCHED, { a: job("github.event_name == 'push'", { needs: [] }) })), 1,
    'an empty list is no dependency');
one('every job has needs', judgeWorkflow(wf(SCHED, { a: job(undefined, { needs: 'b' }), b: job(undefined, { needs: 'a' }) })).roots.length, 0,
    'nothing to judge, and the coverage line says so');
one('every job has needs, no finding',
    nFind(wf(SCHED, { a: job(undefined, { needs: 'b' }), b: job(undefined, { needs: 'a' }) })), 0,
    'every() of nothing is true: a workflow with no root must not read as one whose roots all skip');
one('a reusable-workflow job', nFind(wf(SCHED, { a: { uses: './.github/workflows/x.yml', if: "github.event_name == 'push'" } })), 1,
    'uses: jobs carry an if too');
one('on: a string', hasSchedule({ on: 'schedule', jobs: {} }), true, 'the short form');
one('on: a list', hasSchedule({ on: ['push', 'schedule'], jobs: {} }), true, 'the list form');
one('on: a list without it', hasSchedule({ on: ['push'], jobs: {} }), false, 'no schedule');
one('on: parsed as the boolean key', hasSchedule({ true: SCHED, jobs: {} }), true, 'YAML 1.1 reads bare `on` as true');
one('on: the string key', hasSchedule({ on: SCHED, jobs: {} }), true, 'a parser that keeps `on`');
one('a nothing document', hasSchedule(null), false, 'does not throw');

// ── the coverage line states a denominator ─────────────────────────────────
const cov = coverageLine([judgeWorkflow(epa(EPA_BUGGY)), judgeWorkflow(epa(EPA_FIXED)), judgeWorkflow(wf({ push: {} }, {}))]);
one('coverage, scheduled of all', cov.includes('2 of 3 workflow(s) declare a schedule'), true, cov);
one('coverage, the split', cov.includes('2 root job(s) judged on a schedule event: 1 run, 1 skipped, 0 undecided'), true,
    'what was skipped is counted, not only what failed');

console.log(bad ? `\n${bad} of ${ran} FAILED` : `\nworkflow-if-eval self-test: ${ran}/${ran}`);
console.log('COVERAGE: the judge on `schedule` only — event name, absent payload keys, the empty inputs context,');
console.log('status functions, contains/startsWith/endsWith — and the root-job rule. It does NOT read a');
console.log('workflow file; the real corpus is judged by workflow-yaml-check.mjs, and that wiring is');
console.log('proven by scripts/mutate-workflow-if-eval.mjs.');
process.exit(bad ? 1 : 0);
