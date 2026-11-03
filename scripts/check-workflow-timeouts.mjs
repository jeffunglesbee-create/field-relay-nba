#!/usr/bin/env node
// Do the protected workflows bound their jobs and their requests?
// docs/CC-CMD-2026-11-03-workflow-jobs-have-no-time-limit.md, TASK 1.
//
//   node scripts/check-workflow-timeouts.mjs              the live check: judge each PROTECTED workflow
//                                                         under WORKFLOW_DIR (default .github/workflows)
//   node scripts/check-workflow-timeouts.mjs --self-test  prove the judge on counted cases
//
// The live check runs in workflow-yaml-gate.yml whenever a workflow changes, which is the only moment it
// can catch anything. The self-test and scripts/mutate-workflow-timeouts.mjs run in guards.yml on every
// push and prove that the live check can still fail.
//
// The shape it exists for is drive-upload-outbox.yml before 2026-11-03: run 41650246688 attempt 1 held a
// runner for 941 s on one Apps Script request, and nothing bounded either the request or the job.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseYaml } from './lib/parse-workflow-yaml.mjs';
import {
  PROTECTED, JOB_MAX_MINUTES, REQUEST_MAX_SECONDS,
  requestSites, requestTimeout, judgeWorkflow, coverageLine,
} from './lib/workflow-timeouts.mjs';

// ── the live check ─────────────────────────────────────────────────────────
async function live() {
  const DIR = process.env.WORKFLOW_DIR || '.github/workflows';
  const all = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)) : [];
  const failures = [];
  let judged = 0, jobs = 0, sites = 0;
  for (const f of PROTECTED) {
    const full = path.join(DIR, f);
    if (!fs.existsSync(full)) {
      failures.push(`${full}: protected workflow not found. Renamed or deleted, so nothing guards its limits; re-aim PROTECTED in scripts/lib/workflow-timeouts.mjs`);
      continue;
    }
    const { ok, doc, error } = await parseYaml(fs.readFileSync(full, 'utf8'), full);
    if (!ok || !doc || typeof doc !== 'object') { failures.push(`${full}: does not parse${error ? `: ${error}` : ''}`); continue; }
    const r = judgeWorkflow(doc);
    judged++; jobs += r.jobs; sites += r.sites;
    for (const m of r.findings) failures.push(`${full}: ${m}`);
  }
  console.log(`workflow-timeouts: ${PROTECTED.length} protected workflow(s) in ${DIR}, ${failures.length} finding(s) `
    + `(job cap ${JOB_MAX_MINUTES} min, request cap ${REQUEST_MAX_SECONDS} s)`);
  console.log(`  ${coverageLine({ files: all.length, judged, jobs, sites })}`);
  for (const m of failures) console.log(`  FAIL ${m}`);
  process.exit(failures.length ? 1 : 0);
}

// ── the self-test ──────────────────────────────────────────────────────────
async function selfTest() {
  let ran = 0, bad = 0;
  // Strict equality over scalars, and COUNTED: a hardcoded total hides a deleted case.
  const one = (label, got, want, why) => (ran++, got === want
    ? console.log(`  PASS  ${label} -> ${JSON.stringify(got)}  (${why})`)
    : (bad++, console.log(`  FAIL  ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`)));
  const T = (args) => requestTimeout(args);
  const tk = (args) => T(args).kind;
  const wf = (jobs) => ({ true: { workflow_dispatch: null }, jobs });
  const step = (run, name = 'Upload') => ({ name, run });
  const job = (extra, steps) => ({ 'runs-on': 'ubuntu-latest', ...extra, steps });
  const GOOD_RUN = "echo '  resp=urllib.request.urlopen(req,timeout=120); print(resp.read().decode())' >> /tmp/upload.py";
  const n = (doc, opts) => judgeWorkflow(doc, opts).findings.length;
  const f0 = (doc, opts) => judgeWorkflow(doc, opts).findings[0] ?? '';

  // ── what a call's arguments say about its timeout ────────────────────────
  one('keyword, no spaces', JSON.stringify(T('req,timeout=120')), '{"kind":"number","value":120}', 'the shape the workflow now has');
  one('keyword, spaces', JSON.stringify(T('req, timeout = 120')), '{"kind":"number","value":120}', 'spacing is not meaning');
  one('keyword, a fraction', JSON.stringify(T('req, timeout=2.5')), '{"kind":"number","value":2.5}', 'a float is a number');
  one('keyword after a nested call', JSON.stringify(T('Request(url, data=d), timeout=120')), '{"kind":"number","value":120}', 'the arguments are the text between the outer parentheses');
  one('no timeout', tk('req'), 'absent', 'urlopen(req): the shape that hung');
  one('timeout=None', tk('req, timeout=None'), 'none', 'None is the default spelled out: no timeout');
  one('a variable', tk('req, timeout=T'), 'variable', 'cannot be judged from the file');
  one('a call', tk('req, timeout=int(os.environ["T"])'), 'variable', 'nor can an expression');
  one('another keyword that ends in timeout', tk('req, mytimeout=5'), 'absent', 'only the keyword urlopen reads');
  one('timeout inside another name', tk('req, context=timeout_ctx'), 'absent', 'a name that contains the word is not the keyword');
  one('positional', tk('req, None, 120'), 'absent', 'urlopen(url, data, timeout): real, but the keyword form is the one this reads');

  // ── where the calls are ──────────────────────────────────────────────────
  const sitesOf = (run) => requestSites(wf({ a: job({}, [step(run)]) }));
  one('one call', sitesOf('x=urlopen(req)').length, 1, 'found in a run block');
  one('a qualified call', sitesOf(GOOD_RUN).length, 1, 'inside an echo of the generated Python, as the workflow writes it');
  one('a space before the parenthesis', sitesOf('urlopen (req, timeout=9)').length, 1, 'Python allows it');
  one('a longer name is not a call', sitesOf('myurlopen(req)').length, 0, 'word boundary');
  one('two calls', sitesOf('urlopen(a)\nurlopen(b, timeout=5)').length, 2, 'each is judged');
  one('nested parentheses, balanced', sitesOf('urlopen(Request(url, data=d), timeout=120)')[0].args, 'Request(url, data=d), timeout=120', 'the scan counts depth');
  one('never closes', sitesOf('urlopen(req, timeout=120')[0].args, null, 'reported, not guessed');
  one('names the job', sitesOf('urlopen(req)')[0].job, 'a', 'so a finding can point at it');
  one('names the step', sitesOf('urlopen(req)')[0].step, 'Upload', 'and at the step');
  one('a step with no run', requestSites(wf({ a: job({}, [{ uses: 'actions/checkout@v4' }]) })).length, 0, 'does not throw');
  one('a job with no steps', requestSites(wf({ a: { 'runs-on': 'x' } })).length, 0, 'does not throw');
  one('a nothing document', requestSites(null).length, 0, 'does not throw');

  // ── the job limit ────────────────────────────────────────────────────────
  const withJob = (extra, run = GOOD_RUN) => wf({ upload: job(extra, [step(run)]) });
  one('bounded job and request', n(withJob({ 'timeout-minutes': 15 })), 0, 'the workflow as fixed');
  one('no job limit', n(withJob({})), 1, 'GitHub\'s default is 360 minutes');
  one('no job limit, named', f0(withJob({})).includes('job "upload" sets no timeout-minutes'), true, 'the finding names the job and the key');
  one('job limit at the cap', n(withJob({ 'timeout-minutes': 30 })), 0, 'the cap itself is allowed');
  one('job limit over the cap', n(withJob({ 'timeout-minutes': 31 })), 1, 'one minute over');
  one('job limit at the default', n(withJob({ 'timeout-minutes': 360 })), 1, 'writing the default down is not a bound');
  one('job limit zero', n(withJob({ 'timeout-minutes': 0 })), 1, 'not above 0');
  one('job limit a string', n(withJob({ 'timeout-minutes': '15' })), 1, 'a quoted number is not read as one');
  one('job limit an expression', n(withJob({ 'timeout-minutes': '${{ inputs.minutes }}' })), 1, 'cannot be judged from the file');
  one('job limit a boolean', n(withJob({ 'timeout-minutes': true })), 1, 'not a number');
  one('a second job with no limit',
      n(wf({ upload: job({ 'timeout-minutes': 15 }, [step(GOOD_RUN)]), other: job({}, [step('echo hi')]) })), 1,
      'every job is judged, not only the first');
  one('a second job with no limit, named',
      f0(wf({ upload: job({ 'timeout-minutes': 15 }, [step(GOOD_RUN)]), other: job({}, [step('echo hi')]) })).includes('job "other"'), true,
      'and the finding says which');

  // ── the request limit ────────────────────────────────────────────────────
  const withReq = (run) => withJob({ 'timeout-minutes': 15 }, run);
  one('no request limit', n(withReq('urlopen(req)')), 1, 'the shape that hung for 941 s');
  one('no request limit, named', f0(withReq('urlopen(req)')).includes('has no timeout= keyword'), true, 'the finding names the keyword');
  one('request limit at the cap', n(withReq('urlopen(req, timeout=300)')), 0, 'the cap itself is allowed');
  one('request limit over the cap', n(withReq('urlopen(req, timeout=301)')), 1, 'one second over');
  one('request limit zero', n(withReq('urlopen(req, timeout=0)')), 1, 'not above 0');
  one('request limit None', n(withReq('urlopen(req, timeout=None)')), 1, 'the default, spelled out');
  one('request limit a variable', n(withReq('urlopen(req, timeout=T)')), 1, 'cannot be judged from the file');
  one('request limit positional', n(withReq('urlopen(req, None, 120)')), 1, 'not read: write timeout=');
  one('a bounded and an unbounded request', n(withReq('urlopen(a, timeout=5)\nurlopen(b)')), 1, 'each call is judged on its own');
  one('a call that never closes', n(withReq('urlopen(req, timeout=120')), 1, 'reported');
  one('a call that never closes, named', f0(withReq('urlopen(req, timeout=120')).includes('never closes'), true, 'and the finding says why, not "no timeout"');
  one('both limits gone', n(withJob({}, 'urlopen(req)')), 2, 'run 41650246688: two findings, one per missing limit');

  // ── something to judge ───────────────────────────────────────────────────
  one('no request site, strict', n(withJob({ 'timeout-minutes': 15 }, 'echo hi')), 1, 'a check that finds nothing is not a pass');
  one('no request site, not strict', n(withJob({ 'timeout-minutes': 15 }, 'echo hi'), { strict: false }), 0, 'a sweep of every workflow does not need one');
  one('no job at all, strict', n(wf({})), 2, 'nothing to judge on either count');
  one('no job at all, not strict', n(wf({}), { strict: false }), 0, 'nothing to judge, nothing wrong');
  one('a nothing document, strict', n(null), 2, 'does not throw');
  one('a reusable-workflow call is not a job here', judgeWorkflow(wf({ call: { uses: './.github/workflows/x.yml' } }), { strict: false }).findings.length, 0, 'uses: jobs cannot take the key');
  one('a reusable-workflow call, counted', judgeWorkflow(wf({ call: { uses: './.github/workflows/x.yml' } }), { strict: false }).reusable, 1, 'and is counted on its own');
  one('a reusable call beside a bounded job',
      n(wf({ call: { uses: './x.yml' }, upload: job({ 'timeout-minutes': 15 }, [step(GOOD_RUN)]) })), 0, 'only the real job is judged');
  one('a reusable call beside an unbounded job',
      n(wf({ call: { uses: './x.yml' }, upload: job({}, [step(GOOD_RUN)]) })), 1, 'and it is still judged');

  // ── through the real parser, the way the gate reads a file ───────────────
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-timeouts-'));
  const yml = (jobLimit, call) => `name: fixture
on: workflow_dispatch
jobs:
  upload:
    runs-on: ubuntu-latest
${jobLimit}    steps:
      - name: Upload
        run: |
          echo 'try:' >> /tmp/upload.py
          echo '  resp=urllib.request.urlopen(req${call}); print(resp.read().decode())' >> /tmp/upload.py
`;
  const parsed = async (text) => {
    const file = path.join(tmp, 'fixture.yml');
    fs.writeFileSync(file, text);
    const r = await parseYaml(text, file);
    return r.ok ? judgeWorkflow(r.doc) : { findings: [`parse: ${r.error}`], jobs: 0, sites: 0 };
  };
  const fixed = await parsed(yml('    timeout-minutes: 15\n', ',timeout=120'));
  one('parsed, both limits', fixed.findings.length, 0, 'an integer in YAML reaches the judge as a number');
  one('parsed, one job and one call', `${fixed.jobs}/${fixed.sites}`, '1/1', 'a block scalar of echo lines is read as the workflow reads it');
  const hung = await parsed(yml('', ''));
  one('parsed, both limits gone', hung.findings.length, 2, 'the shape of 2026-11-03');
  one('parsed, the request limit gone', (await parsed(yml('    timeout-minutes: 15\n', ''))).findings.length, 1, 'only the request is named');
  one('parsed, the job limit gone', (await parsed(yml('', ',timeout=120'))).findings.length, 1, 'only the job is named');
  fs.rmSync(tmp, { recursive: true, force: true });

  // ── the coverage line states a denominator ───────────────────────────────
  const cov = coverageLine({ files: 200, judged: 1, jobs: 1, sites: 1 });
  one('coverage, the denominator', cov.includes('checked 1 of 200 workflow file(s): 1 job(s) and 1 urlopen call(s)'), true, cov);
  one('coverage, what is not judged', cov.includes('The other 199 file(s) are NOT judged here'), true, 'a green check does not say "all workflows are bounded"');

  console.log(bad ? `\n${bad} of ${ran} FAILED` : `\nworkflow-timeouts self-test: ${ran}/${ran}`);
  console.log('COVERAGE: the judge on parsed workflows: the job key (missing, over the cap, zero, a string, an expression),');
  console.log('the urlopen keyword (missing, None, a variable, positional, over the cap, zero), balanced-parenthesis');
  console.log('argument reading, reusable-workflow jobs, the strict rule, and the real parser on a block scalar. It does');
  console.log('NOT read a workflow file from the repository; the live check does, and scripts/mutate-workflow-timeouts.mjs');
  console.log('proves the live check goes red when a limit is removed. It does not judge requests that are not a Python urlopen.');
  process.exit(bad ? 1 : 0);
}

if (process.argv.includes('--self-test')) await selfTest();
else await live();
