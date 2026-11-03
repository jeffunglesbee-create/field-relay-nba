// The judge behind scripts/check-workflow-timeouts.mjs: does a workflow bound its jobs and its requests?
// docs/CC-CMD-2026-11-03-workflow-jobs-have-no-time-limit.md, TASK 1.
//
// WHY IT EXISTS. Run 41650246688, attempt 1, held a runner for 941 s on one Apps Script request and
// ended `Connection reset by peer`. The job set no timeout-minutes and the inline Python called
// urlopen(req) with no timeout, so GitHub's default job limit (360 minutes) was the only bound. Nothing
// in the repository looked at a time limit: scripts/workflow-yaml-check.mjs asks whether a workflow
// parses, has a trigger and a runnable job, and whether a scheduled one can run on a schedule event.
//
// WHAT IT JUDGES. A workflow handed to it as PARSED YAML (scripts/lib/parse-workflow-yaml.mjs, the
// parser the gate uses; a string scan is not a parse):
//   1. every job that is not a reusable-workflow call sets timeout-minutes, as a number, above 0 and at
//      most JOB_MAX_MINUTES;
//   2. every `urlopen(` in a `run:` block carries a literal `timeout=` keyword above 0 and at most
//      REQUEST_MAX_SECONDS ('timeout=None' is no timeout, and a variable cannot be judged);
//   3. when strict, the workflow has at least one such job and at least one such request. A check that
//      finds nothing to judge is not a pass: if the Python is rewritten to something else, this goes red
//      until it is re-aimed.
//
// WHAT IT DOES NOT JUDGE, and says so in its own output (Rule 91): any workflow outside PROTECTED, and
// any request that is not a Python `urlopen(` call: an aliased import, opener.open(), requests, curl
// without --max-time, Node fetch, a script under scripts/ that a workflow calls. A positional timeout,
// urlopen(req, None, 120), is not read either; the keyword form is required. A comment inside a `run:`
// block that mentions `urlopen(` is judged as a call. TASK 2 of the CC-CMD widens the job rule to every
// workflow with a ratchet.
//
// WHAT A REQUEST LIMIT IS. urlopen's timeout is a wait for the peer, not a deadline for the exchange.
// Probed 2026-11-03: a local server answered one byte a second for 8 s, and urlopen(timeout=3) read all
// of it without raising, 8.0 s after it started. The limit ends a peer that goes silent; a peer that keeps
// sending is ended by the job limit, which is why both are required and neither is enough alone.
//
// Pure functions: nothing here reads a file.

export const JOB_MAX_MINUTES = 30;        // a protected job's limit may not exceed this
export const REQUEST_MAX_SECONDS = 300;   // nor may a protected request's
export const PROTECTED = ['drive-upload-outbox.yml'];

/** Every `urlopen(` in the `run:` blocks of a parsed workflow, with its argument text.
 *  { job, step, args } where args is the text between the call's parentheses, or null when they
 *  never balance (a call this reader cannot bound, which the judge reports instead of guessing). */
export function requestSites(doc) {
  const sites = [];
  for (const [job, j] of Object.entries((doc && doc.jobs) || {})) {
    if (!j || typeof j !== 'object') continue;
    (Array.isArray(j.steps) ? j.steps : []).forEach((s, i) => {
      const run = s && typeof s.run === 'string' ? s.run : '';
      const step = (s && s.name) || `step ${i + 1}`;
      for (const m of run.matchAll(/\burlopen\s*\(/g)) {
        let depth = 1, k = m.index + m[0].length;
        for (; k < run.length && depth > 0; k++) depth += (run[k] === '(') - (run[k] === ')');
        sites.push({ job, step, args: depth === 0 ? run.slice(m.index + m[0].length, k - 1) : null });
      }
    });
  }
  return sites;
}

/** What a call's arguments say about its timeout:
 *  { kind: 'number', value } | { kind: 'absent' } | { kind: 'none' } | { kind: 'variable', text }. */
export function requestTimeout(args) {
  const m = String(args).match(/(?:^|[\s,])timeout\s*=\s*([^,)\s]+)/);
  if (!m) return { kind: 'absent' };
  if (m[1] === 'None') return { kind: 'none' };
  return /^\d+(\.\d+)?$/.test(m[1]) ? { kind: 'number', value: Number(m[1]) } : { kind: 'variable', text: m[1] };
}

/** The finding for one job, or null when it is bounded. The caller has already set aside a
 *  reusable-workflow call (`uses:`), which cannot take the key. */
export function judgeJob(name, job) {
  const v = job['timeout-minutes'];
  if (v === undefined) return `job "${name}" sets no timeout-minutes (GitHub's default is 360 minutes)`;
  if (typeof v !== 'number' || !Number.isFinite(v)) return `job "${name}" timeout-minutes is ${JSON.stringify(v)}, not a number, so it cannot be checked`;
  if (v <= 0) return `job "${name}" timeout-minutes ${v} is not above 0`;
  if (v > JOB_MAX_MINUTES) return `job "${name}" timeout-minutes ${v} exceeds the cap of ${JOB_MAX_MINUTES} minutes`;
  return null;
}

/** The finding for one request site, or null when it is bounded. */
export function judgeSite(s) {
  const where = `request in job "${s.job}", step "${s.step}"`;
  if (s.args === null) return `${where}: the urlopen( call never closes, so its timeout cannot be read`;
  const t = requestTimeout(s.args);
  if (t.kind === 'absent') return `${where} has no timeout= keyword (urlopen waits as long as the peer allows; a positional timeout is not read)`;
  if (t.kind === 'none') return `${where} sets timeout=None, which is no timeout`;
  if (t.kind === 'variable') return `${where} sets timeout=${t.text}, not a literal number, so it cannot be checked`;
  if (t.value <= 0) return `${where} sets timeout=${t.value}, not above 0`;
  if (t.value > REQUEST_MAX_SECONDS) return `${where} sets timeout=${t.value}, over the cap of ${REQUEST_MAX_SECONDS} seconds`;
  return null;
}

/** { findings, jobs, reusable, sites } for one parsed workflow. `strict` (the default) also demands
 *  that there is something to judge; a caller that sweeps every workflow passes strict: false. */
export function judgeWorkflow(doc, { strict = true } = {}) {
  const findings = [];
  let jobs = 0, reusable = 0;
  for (const [name, job] of Object.entries((doc && doc.jobs) || {})) {
    if (!job || typeof job !== 'object') continue;
    if (job.uses) { reusable++; continue; }
    jobs++;
    const f = judgeJob(name, job);
    if (f) findings.push(f);
  }
  const sites = requestSites(doc);
  if (strict && jobs === 0) findings.push('no job that takes timeout-minutes was found, so the job limit has nothing to judge');
  if (strict && sites.length === 0) findings.push('no urlopen( request site found, so the request limit has nothing to judge');
  for (const s of sites) {
    const f = judgeSite(s);
    if (f) findings.push(f);
  }
  return { findings, jobs, reusable, sites: sites.length };
}

/** Rule 91: what the run looked at, in the same breath as its verdict. */
export function coverageLine({ files, judged, jobs, sites }) {
  return `checked ${judged} of ${files} workflow file(s): ${jobs} job(s) and ${sites} urlopen call(s). `
    + `The other ${files - judged} file(s) are NOT judged here, and neither is any request that is not a Python urlopen `
    + `(docs/CC-CMD-2026-11-03-workflow-jobs-have-no-time-limit.md, TASK 2).`;
}
