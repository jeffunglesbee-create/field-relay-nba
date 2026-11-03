#!/usr/bin/env node
// Rule 90 for the protected-workflow time limits: scripts/check-workflow-timeouts.mjs is not trusted
// until it has failed on purpose.
// docs/CC-CMD-2026-11-03-workflow-jobs-have-no-time-limit.md, TASK 1.
//
// Two kinds of break, and "red" means something goes wrong for either.
//
//   THE SUBJECT. Ten directories, each holding a copy of the REAL .github/workflows/drive-upload-outbox.yml
//   with one thing done to it (or, for the last two, no such file), are run through the real live check. The
//   copies are made by editing the real file's text, so they have the real shape: a block scalar of echo
//   lines that write the Python.
//
//     good               the workflow as it is, beside an unbounded decoy   exit 0 (a file outside PROTECTED is not judged)
//     no-job-limit       timeout-minutes removed                            exit 1, naming the key
//     no-request-limit   timeout= removed from urlopen                      exit 1, naming the keyword
//     no-limits          both removed (the shape that hung on 2026-11-03)   exit 1, two findings
//     job-too-long       timeout-minutes: 360                               exit 1, over the cap
//     request-none       timeout=None                                       exit 1
//     request-too-long   timeout=3600                                       exit 1, over the cap
//     python-rewritten   urlopen replaced by another call                   exit 1 (nothing left to judge is not a pass)
//     missing            no drive-upload-outbox.yml at all                  exit 1 (renamed or deleted)
//     broken             a file that is not YAML                            exit 1 (does not parse)
//
//   THE CHECK. Each mutation below breaks one line of the judge (scripts/lib/workflow-timeouts.mjs) or the
//   live check (scripts/check-workflow-timeouts.mjs) and demands that its self-test or one of the fixtures
//   stops giving the verdict it must give. The mutations are made in a copy of those files under the
//   temporary directory, never in the working tree, so an interrupted run leaves nothing to restore.
//
//   THE WIRING. A check that no workflow runs fails nothing. The parsed workflow-yaml-gate.yml must hold a step
//   that runs the live check, and the parsed guards.yml a step that runs this self-test and these mutants;
//   and each of those two tests must itself go red when its step is taken out. It proves the steps are in the
//   files, not that GitHub ran them: the run of the push that lands it is that evidence.
//
// Each mutation asserts its anchor is unique and applied before reporting. NOT CAUGHT with nothing mutated
// is worse than no test.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseYaml } from './lib/parse-workflow-yaml.mjs';

const WF = '.github/workflows/drive-upload-outbox.yml';
const GATE_WF = '.github/workflows/workflow-yaml-gate.yml';
const GUARDS_WF = '.github/workflows/guards.yml';
const SRC = ['scripts/check-workflow-timeouts.mjs', 'scripts/lib/workflow-timeouts.mjs', 'scripts/lib/parse-workflow-yaml.mjs'];
const LIB = 'scripts/lib/workflow-timeouts.mjs';
const CHECK = 'scripts/check-workflow-timeouts.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-timeouts-mutate-'));
const done = (code) => { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(code); };

// ── fixtures, derived from the real workflow's text ───────────────────────
const real = fs.readFileSync(WF, 'utf8');
/** Exactly one match, or stop: nothing is derived from a guess. */
const once = (re, what) => {
  const hits = (real.match(new RegExp(re.source, re.flags.replace('g', '') + 'g')) || []).length;
  if (hits !== 1) {
    console.log(`FAIL — cannot derive the fixtures: ${what}: expected 1 match of ${re} in ${WF}, found ${hits}.`);
    console.log('       If a limit was removed, the live check (workflow-yaml-gate.yml) names it. If the workflow was restructured, re-aim this harness.');
    done(1);
  }
  return re;
};
const JOB_LINE = once(/^ {4}timeout-minutes: *\d+ *\n/m, 'the job limit line');
const REQ_KW = once(/,timeout=\d+/, 'the request limit keyword');
const CALL = once(/urllib\.request\.urlopen\(req,timeout=\d+\)/, 'the urlopen call');

const DECOY = 'name: decoy\non: workflow_dispatch\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo no limits here\n';
const put = (dir, files) => {
  const d = path.join(tmp, dir);
  fs.mkdirSync(d, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(d, name), text);
  return d;
};
const NAME = 'drive-upload-outbox.yml';
const DIRS = {
  good: put('good', { [NAME]: real, 'decoy.yml': DECOY }),
  'no-job-limit': put('no-job-limit', { [NAME]: real.replace(JOB_LINE, '') }),
  'no-request-limit': put('no-request-limit', { [NAME]: real.replace(REQ_KW, '') }),
  'no-limits': put('no-limits', { [NAME]: real.replace(JOB_LINE, '').replace(REQ_KW, '') }),
  'job-too-long': put('job-too-long', { [NAME]: real.replace(JOB_LINE, '    timeout-minutes: 360\n') }),
  'request-none': put('request-none', { [NAME]: real.replace(REQ_KW, ',timeout=None') }),
  'request-too-long': put('request-too-long', { [NAME]: real.replace(REQ_KW, ',timeout=3600') }),
  'python-rewritten': put('python-rewritten', { [NAME]: real.replace(CALL, 'http.client.fetch(req)') }),
  missing: put('missing', { 'decoy.yml': DECOY }),
  broken: put('broken', { [NAME]: 'on: [unclosed\njobs: {\n' }),
};
// [fixture, exit status, text the output must contain]
const EXPECT = [
  ['good', 0, ['0 finding(s)', 'checked 1 of 2 workflow file(s): 1 job(s) and 1 urlopen call(s)']],
  ['no-job-limit', 1, ['1 finding(s)', 'sets no timeout-minutes']],
  ['no-request-limit', 1, ['1 finding(s)', 'has no timeout= keyword']],
  ['no-limits', 1, ['2 finding(s)', 'sets no timeout-minutes', 'has no timeout= keyword']],
  ['job-too-long', 1, ['exceeds the cap of 30 minutes']],
  ['request-none', 1, ['sets timeout=None']],
  ['request-too-long', 1, ['over the cap of 300 seconds']],
  ['python-rewritten', 1, ['no urlopen( request site found']],
  ['missing', 1, ['protected workflow not found']],
  ['broken', 1, ['does not parse']],
];

// ── the copy that gets mutated ────────────────────────────────────────────
const mirror = (f) => path.join(tmp, 'mirror', f);
for (const f of SRC) {
  fs.mkdirSync(path.dirname(mirror(f)), { recursive: true });
  fs.copyFileSync(f, mirror(f));
}
const runCheck = (args, env) => {
  const r = spawnSync('node', [mirror(CHECK), ...args], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000 });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

/** What must hold. Returns the list of broken expectations; empty means all hold. */
function broken(stopAtFirst = false) {
  const problems = [];
  const note = (p) => { problems.push(p); return stopAtFirst; };
  const st = runCheck(['--self-test'], {});
  // The count must be printed: a self-test that never ran also exits 0.
  if ((st.status !== 0 || !/workflow-timeouts self-test: (\d+)\/\1\b/.test(st.out)) && note("the judge's self-test is red, or did not run")) return problems;
  for (const [name, status, needles] of EXPECT) {
    const r = runCheck([], { WORKFLOW_DIR: DIRS[name] });
    const missing = needles.filter((s) => !r.out.includes(s));
    if ((r.status !== status || missing.length)
      && note(`the live check gives the wrong verdict on "${name}" (exit ${r.status}, wanted ${status}${missing.length ? `; output lacks "${missing[0]}"` : ''})`)) return problems;
  }
  return problems;
}

const base = broken();
if (base.length) {
  console.log(`FAIL — red on clean source: ${base.join('; ')}`);
  done(1);
}
console.log(`baseline: the judge self-test and all ${EXPECT.length} fixtures hold on clean source`);

// ── the wiring ────────────────────────────────────────────────────────────
const readDoc = async (f) => {
  const r = await parseYaml(fs.readFileSync(f, 'utf8'), f);
  if (!r.ok || !r.doc) { console.log(`FAIL — ${f} does not parse: ${r.error}`); done(1); }
  return r.doc;
};
const runs = (doc) => Object.values((doc && doc.jobs) || {})
  .flatMap((j) => (Array.isArray(j && j.steps) ? j.steps : []))
  .map((s) => (s && typeof s.run === 'string' ? s.run : ''));
/** The wiring problems in a parsed gate and a parsed guards workflow; empty means both steps are there. */
const wiring = (gate, guards) => {
  const p = [];
  if (!runs(gate).some((r) => /node scripts\/check-workflow-timeouts\.mjs(?!\s+--self-test)/.test(r))) p.push('workflow-yaml-gate.yml does not run the live check');
  if (!runs(guards).some((r) => r.includes('check-workflow-timeouts.mjs --self-test') && r.includes('mutate-workflow-timeouts.mjs'))) p.push('guards.yml does not run the self-test and the mutants');
  return p;
};
/** The same workflow with every step that runs this check taken out. */
const without = (doc) => {
  const d = JSON.parse(JSON.stringify(doc));
  for (const j of Object.values(d.jobs || {})) {
    if (Array.isArray(j.steps)) j.steps = j.steps.filter((s) => !(typeof s.run === 'string' && s.run.includes('check-workflow-timeouts.mjs')));
  }
  return d;
};
const gateDoc = await readDoc(GATE_WF);
const guardsDoc = await readDoc(GUARDS_WF);
const wired = wiring(gateDoc, guardsDoc);
const gateGone = wiring(without(gateDoc), guardsDoc);
const guardsGone = wiring(gateDoc, without(guardsDoc));
// When a step really is missing, say that and nothing else: the polarity tests below only mean something
// once the real files are wired.
const wiringBad = wired.length
  ? wired.map((p) => `clean source: ${p}`)
  : [
    ...(gateGone.length === 1 && gateGone[0].startsWith('workflow-yaml-gate.yml') ? [] : ['the wiring test stays green with the gate step taken out']),
    ...(guardsGone.length === 1 && guardsGone[0].startsWith('guards.yml') ? [] : ['the wiring test stays green with the guards step taken out']),
  ];
if (wiringBad.length) { console.log(`FAIL — ${wiringBad.join('; ')}`); done(1); }
console.log('wiring: the gate runs the live check, guards runs the self-test and the mutants, and each test goes red without its step\n');

const raw = String.raw;
const MUTATIONS = [
  { name: 'J1 a job with no timeout-minutes passes', file: LIB,
    anchor: '  if (v === undefined) return ', replace: '  if (false) return ',
    catches: 'the shape that held a runner for 941 s is no longer a finding' },
  { name: 'J2 the job cap is not enforced', file: LIB,
    anchor: '  if (v > JOB_MAX_MINUTES) return ', replace: '  if (false) return ',
    catches: 'timeout-minutes: 360 (the default, written down) passes' },
  { name: 'J3 timeout-minutes: 0 passes', file: LIB,
    anchor: '  if (v <= 0) return', replace: '  if (false) return',
    catches: 'a limit of zero is accepted as a limit' },
  { name: 'J4 a non-number timeout-minutes passes', file: LIB,
    anchor: "  if (typeof v !== 'number' || !Number.isFinite(v)) return", replace: '  if (false) return',
    catches: 'a quoted number or an expression is accepted without being read' },
  { name: 'J5 a urlopen with no timeout passes', file: LIB,
    anchor: "  if (t.kind === 'absent') return", replace: '  if (false) return',
    catches: 'urlopen(req): the exact call that hung' },
  { name: 'J6 timeout=None passes', file: LIB,
    anchor: "  if (t.kind === 'none') return", replace: '  if (false) return',
    catches: 'the default, spelled out, is accepted as a limit' },
  { name: 'J7 a variable timeout passes', file: LIB,
    anchor: "  if (t.kind === 'variable') return", replace: '  if (false) return',
    catches: 'a value the file cannot show is accepted unread' },
  { name: 'J8 timeout=0 passes', file: LIB,
    anchor: '  if (t.value <= 0) return', replace: '  if (false) return',
    catches: 'a request limit of zero is accepted' },
  { name: 'J9 the request cap is not enforced', file: LIB,
    anchor: '  if (t.value > REQUEST_MAX_SECONDS) return', replace: '  if (false) return',
    catches: 'timeout=3600 passes' },
  { name: 'J10 a call that never closes passes', file: LIB,
    anchor: '  if (s.args === null) return', replace: '  if (false) return',
    catches: 'a call the reader cannot bound is reported as something else, or not at all' },
  { name: 'J11 a reusable-workflow call is judged like a job', file: LIB,
    anchor: '    if (job.uses) { reusable++; continue; }', replace: '    if (job.uses) { reusable++; }',
    catches: 'a uses: job, which cannot take the key, fails for lacking it' },
  { name: 'J12 strict stops demanding a request site', file: LIB,
    anchor: '  if (strict && sites.length === 0)', replace: '  if (false && sites.length === 0)',
    catches: 'a workflow whose Python was rewritten to something else passes with nothing judged' },
  { name: 'J13 strict stops demanding a job', file: LIB,
    anchor: '  if (strict && jobs === 0)', replace: '  if (false && jobs === 0)',
    catches: 'a protected workflow with no job passes with nothing judged' },
  { name: 'J14 strict is off by default', file: LIB,
    anchor: '{ strict = true } = {}', replace: '{ strict = false } = {}',
    catches: 'every caller that does not say so loses the nothing-to-judge rule' },
  { name: 'J15 the argument scan stops at the first closing parenthesis', file: LIB,
    anchor: raw`depth += (run[k] === '(') - (run[k] === ')');`, replace: raw`depth -= (run[k] === ')');`,
    catches: 'urlopen(Request(url), timeout=120) reads as urlopen(Request(url, which has no timeout' },
  { name: 'J16 the word boundary before urlopen is dropped', file: LIB,
    anchor: raw`/\burlopen\s*\(/g`, replace: raw`/urlopen\s*\(/g`,
    catches: 'myurlopen( is judged as a request' },
  { name: 'J17 the timeout keyword matches inside another name', file: LIB,
    anchor: raw`/(?:^|[\s,])timeout\s*=\s*([^,)\s]+)/`, replace: raw`/timeout\s*=\s*([^,)\s]+)/`,
    catches: 'mytimeout=5 is read as a timeout' },
  { name: 'J18 the job cap is raised past the default', file: LIB,
    anchor: 'export const JOB_MAX_MINUTES = 30;', replace: 'export const JOB_MAX_MINUTES = 3000;',
    catches: 'a limit of 360 minutes passes' },
  { name: 'J19 the request cap is raised past the hang', file: LIB,
    anchor: 'export const REQUEST_MAX_SECONDS = 300;', replace: 'export const REQUEST_MAX_SECONDS = 30000;',
    catches: 'a limit longer than the 941 s hang passes' },
  { name: 'J20 nothing is protected', file: LIB,
    anchor: "export const PROTECTED = ['drive-upload-outbox.yml'];", replace: 'export const PROTECTED = [];',
    catches: 'the live check judges no workflow and says green' },

  { name: 'C1 a finding no longer fails the exit code', file: CHECK,
    anchor: '  process.exit(failures.length ? 1 : 0);', replace: '  process.exit(0);',
    catches: 'findings are printed and ignored' },
  { name: 'C2 a missing protected workflow is not reported', file: CHECK,
    anchor: '    if (!fs.existsSync(full)) {', replace: '    if (false) {',
    catches: 'renaming drive-upload-outbox.yml silences the guard' },
  { name: 'C3 a workflow that does not parse is not reported as such', file: CHECK,
    anchor: "    if (!ok || !doc || typeof doc !== 'object') {", replace: '    if (false) {',
    catches: 'a broken file is judged as an empty one and the reason is lost' },
  { name: 'C4 the findings are not printed', file: CHECK,
    anchor: '  for (const m of failures) console.log(`  FAIL ${m}`);', replace: '',
    catches: 'a red check that does not say what is wrong' },
  { name: 'C5 the coverage line is not printed', file: CHECK,
    anchor: '  console.log(`  ${coverageLine({ files: all.length, judged, jobs, sites })}`);', replace: '',
    catches: 'a green check that no longer says how few workflows it looked at' },
  { name: 'C6 judged workflows are not counted', file: CHECK,
    anchor: '    judged++; jobs += r.jobs; sites += r.sites;', replace: '    jobs += r.jobs; sites += r.sites;',
    catches: 'the coverage line reads 0 of N while the check passes' },
  { name: 'C7 the live check stops being strict', file: CHECK,
    anchor: '    const r = judgeWorkflow(doc);', replace: '    const r = judgeWorkflow(doc, { strict: false });',
    catches: 'the rewritten-Python case passes: nothing left to judge reads as nothing wrong' },
  { name: 'C8 --self-test runs the live check instead', file: CHECK,
    anchor: "if (process.argv.includes('--self-test')) await selfTest();", replace: 'if (false) await selfTest();',
    catches: 'guards.yml runs a self-test that proves nothing' },
];

let caught = 0;
for (const mut of MUTATIONS) {
  const original = fs.readFileSync(mirror(mut.file), 'utf8');
  const hits = original.split(mut.anchor).length - 1;
  if (hits !== 1) {
    console.log(`FAIL       ${mut.name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`);
    continue;
  }
  fs.writeFileSync(mirror(mut.file), original.replace(mut.anchor, () => mut.replace));
  if (fs.readFileSync(mirror(mut.file), 'utf8') === original) {
    console.log(`FAIL       ${mut.name}\n            file unchanged — NOTHING MUTATED.`);
    continue;
  }
  const why = broken(true);
  fs.writeFileSync(mirror(mut.file), original);
  console.log(`${why.length ? 'CAUGHT    ' : 'NOT CAUGHT'} ${mut.name}\n            (${mut.catches})`);
  if (why.length) { console.log(`            red: ${why[0]}`); caught++; }
}

// The mirror must be clean again: a restore that did not restore would make every later result wrong.
const after = broken();
if (after.length) { console.log(`\nFAIL — red after restoring: ${after.join('; ')}`); done(1); }

console.log(`\n${caught} of ${MUTATIONS.length} mutations caught.`);
console.log('COVERAGE: the judge (job key, urlopen keyword, both caps, the strict rule, reusable-workflow jobs, argument');
console.log('scan, word boundary, the protected list) and the live check (exit code, missing and unparseable file,');
console.log('findings, coverage line), through ten fixture directories made from the real drive-upload-outbox.yml and run');
console.log('by the real check, and the presence of the gate step and the guards step in the parsed workflows. It does NOT');
console.log('prove that GitHub ran them (the push that lands this is that evidence), and it does not judge any workflow');
console.log('but the one in PROTECTED.');
done(caught === MUTATIONS.length ? 0 : 1);
