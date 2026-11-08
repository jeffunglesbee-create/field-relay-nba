// Which jubilant-bassoon workflows have actually lost a run's output to a rejected `git push`?
//
// Background (docs/CC-CMD-2026-11-02-scheduled-job-skipped-every-time.md, Observed 2026-11-08): patent-fulltext.yml ended its "Commit results" step in a bare
// `git push`, the 2026-11-04 weekly run's push was rejected "fetch first", and the run's whole output went with the runner. A census of the client's workflows found 16
// OTHER files with a bare `git push` and no `pull --rebase` anywhere in them, 6 of them on a schedule. That census says what is CAPABLE of failing, not what has: this
// reads the run history of each (every completed run the API still lists, up to 100 per workflow), takes the runs that failed, reads their jobs, and for every job whose
// failed step is a commit/push step reads the job log for git's rejection text.
//
// A failure is CLASSIFIED push-rejected only when BOTH hold: a step whose name matches /commit|push/i concluded failure, AND that job's log contains "[rejected]" or
// "fetch first" or "non-fast-forward". The classifier is a pure function, self-tested below against the real log tail of the 2026-11-04 failure and against a
// successful job's log, and each of its two conditions is mutated and must be caught. CONTROLS at run time: the known-rejected job (patent-fulltext, run 41919349025, job
// 126889897528) must classify push-rejected, and the commit step of the dispatch run 42508334232 (the fixed file, success) must not.
//
// Read-only: it sends GITHUB_TOKEN (RELAY_GH_PAT in the workflow, the dead-cron watch's own mechanism) to api.github.com only and writes nothing but its outbox file.
// Usage: GITHUB_TOKEN=... node scripts/probe-client-bare-push-failures-2026-11-08.mjs      or      node scripts/probe-client-bare-push-failures-2026-11-08.mjs --self-test
import { writeFileSync, mkdirSync } from 'node:fs'

const OWNER = 'jeffunglesbee-create', REPO = 'jubilant-bassoon'
// The census of 2026-11-08: workflows with `git push` and no `pull --rebase`/retry anywhere in the file (patent-fulltext is the one fixed on 2026-11-08, e4093fa).
const WORKFLOWS = ['patent-fulltext', 'competitor-probe', 'golf-contract-probe', 'golf-espn-eur-gir-probe', 'golf-espn-scottish-open-gir-probe', 'golf-espn-stat-names-probe',
  'golf-espn-tourcast-probe', 'nhl-analytics-probe', 'oura-fetch', 'send-outbox', 'sign-shortcut', 'smoke-and-verify', 'update-drama-profiles', 'wc-situation-probe',
  'whoop-auth-exchange', 'whoop-auto-auth', 'whoop-fetch']
const CONTROL_POSITIVE = { run: 41919349025, job: 126889897528 }
const CONTROL_NEGATIVE_RUN = 42508334232
const MAX_RUNS = 100

const REJECT = /\[rejected\]|fetch first|non-fast-forward/i
const COMMITSTEP = /commit|push/i
// the classifier, parameterised so the self-test can mutate each condition
export function classify(job, log, { reject = REJECT, step = COMMITSTEP, needStep = true, needLog = true } = {}) {
  const failedSteps = (job.steps || []).filter(s => s.conclusion === 'failure').map(s => s.name)
  const stepHit = failedSteps.some(n => step.test(n))
  const logHit = reject.test(log || '')
  return { failedSteps, stepHit, logHit, pushRejected: (needStep ? stepHit : true) && (needLog ? logHit : true) }
}

if (process.argv.includes('--self-test')) {
  // the real tail of job 126889897528 (jubilant-bassoon run 41919349025, 2026-11-04) and a successful push's output
  const POS_LOG = " ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to 'https://github.com/jeffunglesbee-create/jubilant-bassoon'\nhint: Updates were rejected because the remote contains work that you do not"
  const NEG_LOG = '   45a888c..9f67782  HEAD -> main'
  const pos = { steps: [{ name: '3/3 Upload to Dropbox (if configured)', conclusion: 'success' }, { name: 'Commit results', conclusion: 'failure' }] }
  const otherFail = { steps: [{ name: 'Run watcher', conclusion: 'failure' }] }
  const cases = [
    ['real rejected tail, failed commit step       -> push-rejected', classify(pos, POS_LOG).pushRejected === true],
    ['successful push output, failed commit step   -> not rejected (the log condition)', classify(pos, NEG_LOG).pushRejected === false],
    ['rejection text but the failed step is another -> not rejected (the step condition)', classify(otherFail, POS_LOG).pushRejected === false],
    ['no failed step at all                         -> not rejected', classify({ steps: [{ name: 'Commit results', conclusion: 'success' }] }, POS_LOG).pushRejected === false],
  ]
  // MUTANTS: each condition removed must change a verdict above
  const mut = [
    ['M1 the log condition dropped', () => classify(pos, NEG_LOG, { needLog: false }).pushRejected === true],
    ['M2 the step condition dropped', () => classify(otherFail, POS_LOG, { needStep: false }).pushRejected === true],
    ['M3 the rejection regex matches nothing', () => classify(pos, POS_LOG, { reject: /^\b$/ }).pushRejected === false],
    ['M4 the step regex matches nothing', () => classify(pos, POS_LOG, { step: /^\b$/ }).pushRejected === false],
  ]
  let bad = 0
  for (const [n, ok] of cases) { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n}`); if (!ok) bad++ }
  for (const [n, caught] of mut) { console.log(`${caught ? 'ok  ' : 'FAIL'}  ${n}: ${caught ? 'CAUGHT (the mutant changes a verdict)' : 'NOT CAUGHT'}`); if (!caught) bad++ }
  console.log(`${cases.length + mut.length - bad} of ${cases.length + mut.length} self-test checks pass`)
  process.exit(bad ? 1 : 0)
}

const TOKEN = process.env.GITHUB_TOKEN
if (!TOKEN) { console.error('GITHUB_TOKEN is not set'); process.exit(2) }
const H = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'field-relay-probe' }
async function gh(path, text = false) {
  const r = await fetch(`https://api.github.com${path}`, { headers: H, redirect: 'follow', signal: AbortSignal.timeout(30_000) })
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`)
  return text ? r.text() : r.json()
}
async function jobsOf(runId) { return (await gh(`/repos/${OWNER}/${REPO}/actions/runs/${runId}/jobs?per_page=100`)).jobs || [] }
async function logOf(jobId) { try { return await gh(`/repos/${OWNER}/${REPO}/actions/jobs/${jobId}/logs`, true) } catch (e) { return `LOG UNREADABLE: ${e.message}` } }

const out = { at: new Date().toISOString(), repo: `${OWNER}/${REPO}`, controls: {}, workflows: {} }

// CONTROLS first: nothing below means anything if either is wrong.
const posJob = (await jobsOf(CONTROL_POSITIVE.run)).find(j => j.id === CONTROL_POSITIVE.job)
const posLog = posJob ? await logOf(posJob.id) : ''
out.controls.positive = posJob ? { job: posJob.id, ...classify(posJob, posLog) } : { job: CONTROL_POSITIVE.job, missing: true }
const negJobs = await jobsOf(CONTROL_NEGATIVE_RUN)
const negJob = negJobs.find(j => (j.steps || []).some(s => /commit/i.test(s.name)))
const negLog = negJob ? await logOf(negJob.id) : ''
out.controls.negative = negJob ? { job: negJob.id, conclusion: negJob.conclusion, ...classify(negJob, negLog) } : { missing: true }
const controlsOk = out.controls.positive.pushRejected === true && out.controls.negative.pushRejected === false && !out.controls.negative.missing
console.log(`CONTROL positive (run ${CONTROL_POSITIVE.run}, job ${CONTROL_POSITIVE.job}): ${out.controls.positive.pushRejected ? 'push-rejected (as it must be)' : 'NOT CLASSIFIED push-rejected'}`)
console.log(`CONTROL negative (run ${CONTROL_NEGATIVE_RUN}, a successful commit step): ${out.controls.negative.pushRejected === false ? 'not rejected (as it must be)' : 'WRONGLY rejected or missing'}`)
if (!controlsOk) { out.broken = true; console.log('THE READING IS BROKEN (a control failed); nothing below says anything about the workflows.') }

let totalRuns = 0, totalFailed = 0, totalCommitFail = 0, totalRejected = 0
for (const wf of WORKFLOWS) {
  const w = { runsExamined: 0, completed: 0, failed: 0, failedAtCommitStep: 0, pushRejected: 0, rejectedRuns: [], capped: false, unreadable: 0 }
  try {
    const first = await gh(`/repos/${OWNER}/${REPO}/actions/workflows/${wf}.yml/runs?status=completed&per_page=${MAX_RUNS}`)
    const runs = first.workflow_runs || []
    w.totalCompletedRunsListedByApi = first.total_count
    w.capped = first.total_count > runs.length
    w.runsExamined = runs.length
    w.completed = runs.length
    for (const run of runs) {
      if (run.conclusion !== 'failure') continue
      w.failed++
      const jobs = await jobsOf(run.id)
      for (const j of jobs) {
        const c0 = classify(j, '')
        if (!c0.stepHit) continue
        w.failedAtCommitStep++
        const log = await logOf(j.id)
        if (log.startsWith('LOG UNREADABLE')) { w.unreadable++; continue }
        if (classify(j, log).pushRejected) { w.pushRejected++; w.rejectedRuns.push({ run: run.id, event: run.event, at: run.created_at, job: j.name }) }
      }
    }
  } catch (e) { w.error = String(e.message || e) }
  out.workflows[wf] = w
  totalRuns += w.runsExamined; totalFailed += w.failed; totalCommitFail += w.failedAtCommitStep; totalRejected += w.pushRejected
  console.log(`${wf.padEnd(36)} runs ${String(w.runsExamined).padStart(3)}${w.capped ? ` of ${w.totalCompletedRunsListedByApi} (CAPPED)` : ''}  failed ${String(w.failed).padStart(3)}  at a commit/push step ${String(w.failedAtCommitStep).padStart(2)}  push-rejected ${String(w.pushRejected).padStart(2)}${w.unreadable ? `  (${w.unreadable} log unreadable)` : ''}${w.error ? `  ERROR ${w.error}` : ''}`)
}
out.summary = { workflows: WORKFLOWS.length, runsExamined: totalRuns, failed: totalFailed, failedAtCommitStep: totalCommitFail, pushRejected: totalRejected }
out.coverage = `${WORKFLOWS.length} workflows; up to ${MAX_RUNS} most recent completed runs each (a CAPPED line says the API holds more); only failed runs were opened; a failure counts as push-rejected only when a commit/push step failed AND its log names the rejection. Runs older than the first ${MAX_RUNS} per workflow are NOT read, and a run whose log has expired is counted as unreadable, not as clean.`
console.log(`SUMMARY ${totalRuns} runs, ${totalFailed} failed, ${totalCommitFail} failed at a commit/push step, ${totalRejected} of those rejected by the remote`)
console.log(`COVERAGE: ${out.coverage}`)
mkdirSync('outbox', { recursive: true })
writeFileSync(`outbox/probe-client-bare-push-failures-${out.at.replace(/[:.]/g, '-')}.json`, JSON.stringify(out, null, 2))
if (out.broken) process.exit(1)
