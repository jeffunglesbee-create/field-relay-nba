#!/usr/bin/env node
// Rule 90 for the repo-wide cron watch.
//
// Every mutation here restores a shape this file actually shipped with. The
// watch was built on 2026-09-15 to catch odds-backfill.yml dying silently for
// fifteen days, and on 2026-09-17 a full paginated sweep found it had the same
// blindness one level up: `?per_page=100` against 150 workflows, printing
// "100 workflow(s)" as though that were the repo.
//
// Each mutation asserts its anchor is unique and applied before reporting a
// result. NOT CAUGHT with nothing mutated is worse than no test.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const WATCH = 'scripts/watch-silently-dead-crons.mjs';
const SELF  = [WATCH, '--self-test'];
// A self-test run takes seconds. The ceiling only has to be FINITE: a mutant
// that makes the file hang (a missing request timeout is exactly that) must
// read as a defect of the run, not stall the harness. A timeout is never a catch.
const RUN_TIMEOUT_MS = 180000;

/** One self-test run, with its stdout kept. It used to be `stdio: 'ignore'`, so
 *  the harness could say THAT a mutant went red and never WHY: a parse error, a
 *  crash and a failed assertion all looked alike. */
const selfTest = () => {
  const r = spawnSync('node', SELF, { encoding: 'utf8', timeout: RUN_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status, timedOut: r.error?.code === 'ETIMEDOUT', stdout: r.stdout || '' };
};
/** The labels of the cases that went red: `  FAIL  <label>: got ... want ...`. */
const failedLabels = (stdout) => [...stdout.matchAll(/^ {2}FAIL {2}(.*?): got /gm)].map(m => m[1]);

// `git diff --quiet`, not `git status --porcelain`: the latter reports a STAGED
// change too, so it refused to run on a file that had just been staged for
// exactly this. The restore below rewrites the working tree, so what must be
// clean is the working tree against the index — which is what --quiet asks.
for (const f of [WATCH]) {
  if (spawnSync('git', ['diff', '--quiet', '--', f]).status !== 0) {
    console.log(`FAIL — ${f} has unstaged changes; restore would lose them.`);
    process.exit(1);
  }
}
if (selfTest().code !== 0) {
  console.log(`FAIL — ${WATCH} --self-test is already red on clean source.`);
  process.exit(1);
}
console.log(`baseline: ${WATCH} --self-test passes on clean source\n`);

const MUTATIONS = [
  { name: 'D1 the page loop stops after the first page',
    anchor: 'export const wantsAnotherPage = (batchLength, perPage) => batchLength >= perPage;',
    replace: 'export const wantsAnotherPage = () => false;',
    catches: 'the shape that shipped — 150 workflows read as 100, 50 never examined' },

  { name: 'D2 the short-read assertion stops asserting',
    anchor: "  return total !== null && total !== undefined && collected < total\n    ? `pagination short-read: collected ${collected} of ${total}` : null;",
    replace: '  return null;',
    catches: 'a truncated fetch passes silently, which is exactly how this went unnoticed' },

  { name: 'D3 a short read is judged with the wrong comparison',
    anchor: '  return total !== null && total !== undefined && collected < total',
    replace: '  return total !== null && total !== undefined && collected > total',
    catches: 'collecting FEWER than the API reports stops being the failure' },

  // D4 REMOVED 2026-09-17. It replaced the null/undefined guard with
  // `Number(total) >= 0`, and Number(null) is 0 — so the mutant returns
  // non-null only when `collected < 0`, which cannot happen. Behaviourally
  // equivalent, therefore uncatchable, therefore not a test. Same call as M7 in
  // the matcher harness and A7 in the attribution one: dead code with an
  // untestable mutation is worse than neither (Rule 90's corollary).

  // ── the 2026-09-17 widening: one repo watched, three red ones invisible ──
  { name: 'D8 the watch narrows back to one repo',
    // The first version of this mutant did not parse (its `.concat([` swallowed the
    // closing paren), so the self-test went red from the PARSER and it read CAUGHT for
    // two months without ever having been a mutation. `node --check` below found it.
    anchor: "].join(',')).split(',').map(r => r.trim()).filter(Boolean);",
    replace: "].slice(0, 1).join(',')).split(',').map(r => r.trim()).filter(Boolean);",
    catches: 'the shape that reported 0 dead crons while two other repos were multi-day red' },

  { name: 'D9 the laboratory and playground are dropped',
    anchor: "  'jeffunglesbee-create/field-laboratory',\n  'jeffunglesbee-create/field-playground',",
    replace: '',
    catches: 'drift-sentinel at 8 consecutive failures and Build Check at 3 go unwatched again' },

  { name: 'D10 detector keys stop carrying their repo',
    anchor: 'export const declaredKey = (repo, path) => `${repo}:${path}`;',
    replace: 'export const declaredKey = (repo, path) => path;',
    catches: 'one repo\'s declaration excuses a dead cron of the same name in another' },

  { name: 'D11 cron extraction stops distinguishing a scheduled workflow',
    anchor: "export const cronFromSource = (src) => (uncommented(src).match(/cron:\\s*'([^']+)'/) || [])[1] || null;",
    replace: 'export const cronFromSource = () => null;',
    catches: 'every never-fired cron is filed as "no schedule block" and never judged' },

  { name: 'D18 a commented-out schedule reads as a declared cron again',
    anchor: "export const uncommented = (src) => String(src || '').split('\\n').filter(l => !/^\\s*#/.test(l)).join('\\n');",
    replace: "export const uncommented = (src) => String(src || '');",
    catches: 'a schedule retired by commenting it out is judged as a cron that never fired' },

  { name: 'D12 a push-only workflow reads as a declared cron',
    anchor: "(uncommented(src).match(/cron:\\s*'([^']+)'/) || [])[1] || null",
    replace: "(uncommented(src).match(/cron:\\s*'([^']+)'/) || [])[1] || 'unknown'",
    catches: 'the no-schedule bucket floods into never-fired and the signal drowns' },

  // ── the ratchet: green means NO NEW DECAY, and that must be breakable ──
  { name: 'D13 the ratchet stops noticing new decay',
    anchor: "    unexpected: [...found].filter(k => !base.has(k)).sort(),",
    replace: '    unexpected: [],',
    catches: 'a cron that rots tomorrow is filed as already-known and never reported' },

  { name: 'D14 a fix turns the run RED',
    anchor: "    resolved:   [...base ].filter(k => !found.has(k) && !unread.has(k)).sort(),",
    replace: '    resolved:   [],',
    catches: 'the stale-baseline signal disappears, so a fixed entry is carried forever' },

  { name: 'D15 the ratchet degrades to a COUNT',
    anchor: "    unexpected: [...found].filter(k => !base.has(k)).sort(),\n    carried:    [...found].filter(k =>  base.has(k)).sort(),",
    replace: "    unexpected: found.size > base.size ? ['count-exceeded'] : [],\n    carried:    [...found],",
    catches: 'one fixed and one new on the same day keeps the count at 2 and the run green' },

  { name: 'D16 an entry with no review_by is exempt instead of overdue',
    anchor: '    if (!by) return true;',
    replace: '    if (!by) return false;',
    catches: 'an undated entry is the quietest possible way to silence a cron forever' },

  { name: 'D17 review_by stops expiring',
    anchor: '    return by < today;',
    replace: '    return false;',
    catches: 'the baseline becomes the furniture it was built to replace' },

  { name: 'D5 the never-fired grace becomes unreachable',
    anchor: 'export function overdueNeverFired(neverFired, graceDays, now = Date.now()) {\n  return neverFired.filter(w => (now - Date.parse(w.created_at)) / 86400000 > graceDays);',
    replace: 'export function overdueNeverFired(neverFired, graceDays, now = Date.now()) {\n  return [];',
    catches: 'a cron that has never fired in three months is never reported' },

  { name: 'D6 the grace boundary becomes inclusive',
    anchor: '  return neverFired.filter(w => (now - Date.parse(w.created_at)) / 86400000 > graceDays);',
    replace: '  return neverFired.filter(w => (now - Date.parse(w.created_at)) / 86400000 >= graceDays);',
    catches: 'a workflow exactly at the grace is called a fault — the boundary case is pinned' },

  { name: 'D7 the grace is widened until nothing can fail',
    anchor: "const GRACE = Number(process.env.NEVER_FIRED_GRACE_DAYS || 40);",
    replace: 'const GRACE = Number(process.env.NEVER_FIRED_GRACE_DAYS || 100000);',
    catches: 'the way a watch like this ends quietly — raising the bar instead of reading it' },

  // ── 2026-11-02: "dead" widened from `failure` to {failure, skipped, startup_failure} ──
  // nfl-epa-route-probe.yml was `skipped` on 66 of 66 scheduled runs and
  // patent-watch.yml `startup_failure` on 21 of 21. The old test was
  // `every(r => r.conclusion === 'failure')`, so neither was ever seen.
  { name: 'E1 a skipped streak stops counting as dead',
    anchor: "export const DEAD_CONCLUSIONS = new Set(['failure', 'skipped', 'startup_failure']);",
    replace: "export const DEAD_CONCLUSIONS = new Set(['failure', 'startup_failure']);",
    catches: 'the EPA probe, skipped on 66 of 66 scheduled runs, goes uncounted again and unreported' },

  { name: 'E2 a startup_failure streak stops counting as dead',
    anchor: "export const DEAD_CONCLUSIONS = new Set(['failure', 'skipped', 'startup_failure']);",
    replace: "export const DEAD_CONCLUSIONS = new Set(['failure', 'skipped']);",
    catches: 'patent-watch.yml, refused at startup on 21 of 21 runs, is invisible again' },

  { name: 'E3 one failure among successes is enough to be dead',
    anchor: '  if (!conclusions.every(c => DEAD_CONCLUSIONS.has(c))) return null;',
    replace: '  if (!conclusions.some(c => DEAD_CONCLUSIONS.has(c))) return null;',
    catches: 'every flaky workflow is reported dead and the list stops meaning anything' },

  { name: 'E4 a window shorter than the streak is judged',
    anchor: '  if (conclusions.length < streak) return null;',
    replace: '',
    catches: 'a workflow added this morning, with two skipped runs, is called dead' },

  { name: 'E5 a mixed window is reported as its first conclusion',
    anchor: "  return distinct.length === 1 ? distinct[0] : 'mixed';",
    replace: '  return distinct[0];',
    catches: 'failure, skipped, failure reads as a plain failure streak and the report lies about it' },

  { name: 'E6 the survey goes back to counting only failure',
    anchor: '    const outcome = streakKind(conclusions);',
    replace: "    const outcome = conclusions.length >= STREAK && conclusions.every(c => c === 'failure') ? 'failure' : null;",
    catches: 'the exact shape that hid the EPA probe: the pure function is right and the survey does not use it' },

  { name: 'E7 the run query drops status=completed',
    anchor: '&per_page=${STREAK}&status=completed',
    replace: '&per_page=${STREAK}',
    catches: 'in-progress runs enter the window, which is then judged on runs that have no conclusion yet' },

  { name: 'E8 the entry stops carrying its outcome',
    anchor: 'path: w.path, outcome, conclusions,',
    replace: 'path: w.path, conclusions,',
    catches: 'the report cannot say whether a workflow failed, was skipped or never started' },

  { name: 'E9 the skipped report reads as a plain failure',
    anchor: "  skipped: 'every scheduled run SKIPPED (the job never started)',",
    replace: "  skipped: 'red',",
    catches: 'a probe that never ran is described as one that failed, and the repair is looked for in the wrong place' },

  { name: 'E10 the ratchet is fed only the failures',
    anchor: 'export const allDead = (surveys) => surveys.flatMap(r => r.dead);',
    replace: "export const allDead = (surveys) => surveys.flatMap(r => r.dead.filter(d => d.outcome === 'failure'));",
    catches: 'skipped and never-started workflows are printed but never judged, so they can never turn the run red' },

  { name: 'E11 a mixed window is reported without its conclusions',
    anchor: "    ? `no scheduled run worked: ${d.conclusions.join(', ')}`",
    replace: '    ? `no scheduled run worked`',
    catches: 'a mixture has no single word, so without the list the reader is told nothing' },

  { name: 'E12 the failure text drifts',
    anchor: "  failure: 'red',",
    replace: "  failure: 'RED',",
    catches: 'two months of committed outbox logs stop comparing against the new ones' },

  { name: 'E13 this watch is judged against itself again',
    anchor: '      if (isSelf(repo, w.path)) selfRed.push(entry);',
    replace: '      if (false) selfRed.push(entry);',
    catches: 'it exits 1 on any finding, so three findings make it its own finding' },

  { name: 'E14 a declared detector is routed into dead',
    anchor: '      else if (declared[key]) detectors.push({ ...entry, ...declared[key] });',
    replace: '',
    catches: 'a detector that is red or idle on purpose floods the dead list every day' },

  { name: 'E15 every workflow with a window is dead',
    anchor: '    if (outcome !== null) {',
    replace: '    if (outcome !== undefined) {',
    catches: 'null !== undefined is true, so a healthy workflow is reported dead' },

  // ── 2026-11-26: ONE GitHub 502 aborted the run and took the day's log with it ──
  // Each of these restores a way the fix could silently come undone. `case` names the self-test
  // case(s) that must go red for it: red for any other reason (a crash, an unrelated case) does
  // not count, so a guard cannot be credited for a catch it did not make.
  // ── the transport ──
  { name: 'G1 every 4xx is retried',
    anchor: 'export const retryableStatus = (s) => s >= 500 && s <= 599;',
    replace: 'export const retryableStatus = (s) => s >= 400 && s <= 599;',
    case: ['T4', 'T5', 'T11'],
    catches: 'a 404 or a rate limit is hammered four times; the quota a 429 reports is spent retrying it' },

  { name: 'G2 a 5xx is no longer retried',
    anchor: 'export const retryableStatus = (s) => s >= 500 && s <= 599;',
    replace: 'export const retryableStatus = () => false;',
    case: ['T1', 'T2', 'T3'],
    catches: 'the 2026-11-25 defect itself: one 502 ends the run' },

  { name: 'G3 the 5xx boundary moves up by one',
    anchor: 'export const retryableStatus = (s) => s >= 500 && s <= 599;',
    replace: 'export const retryableStatus = (s) => s > 500 && s <= 599;',
    case: ['T11'],
    catches: 'a plain 500 stops being retried while every other 5xx still is' },

  { name: 'G40 only a 429 is retried besides the 5xx',
    anchor: 'export const retryableStatus = (s) => s >= 500 && s <= 599;',
    replace: 'export const retryableStatus = (s) => (s >= 500 && s <= 599) || s === 429;',
    case: ['T5'],
    catches: 'the rate limit is retried into the quota it reports' },

  { name: 'G4 a transport error is no longer retried',
    anchor: '      retry = true;',
    replace: '      retry = false;',
    case: ['T6', 'T7', 'T8', 'T9a'],
    catches: 'a reset connection, an aborted attempt or a cut body ends the run' },

  { name: 'G5 the retry count stops bounding the loop',
    anchor: '    if (!retry || attempt > retries) throw failure;',
    replace: '    if (!retry) throw failure;',
    case: ['T3', 'T7'],
    catches: 'a persistent 502 is retried until the budget runs out instead of giving up' },

  { name: 'G6 the backoff is zero',
    anchor: '    const wait = backoff(attempt - 1);',
    replace: '    const wait = 0;',
    case: ['T1', 'T2'],
    catches: 'the retries are fired back to back at a server that just said it was struggling' },

  { name: 'G7 the default retry count is widened until nothing can fail',
    anchor: 'process.env.DEAD_CRON_RETRIES || 3',
    replace: 'process.env.DEAD_CRON_RETRIES || 100000',
    case: ['T12a'],
    catches: 'the way a bound ends quietly: raised, with no case aimed at the default' },

  { name: 'G8 the retry budget stops being enforced',
    anchor: '    if (budget.left < wait) throw failure;\n',
    replace: '',
    case: ['T10a', 'T10b'],
    catches: 'an outage multiplies every failed read by its full backoff, which is hours' },

  { name: 'G9 the default retry budget is widened until nothing can fail',
    anchor: 'process.env.DEAD_CRON_RETRY_BUDGET_MS || 120000',
    replace: 'process.env.DEAD_CRON_RETRY_BUDGET_MS || 1e12',
    case: ['T12b'],
    catches: 'the budget becomes decoration' },

  { name: 'G10 a body cut off mid-read escapes the retry loop',
    anchor: '      if (res.ok) return await res.json();',
    replace: '      if (res.ok) return res.json();',
    case: ['T8', 'E2E-11'],
    catches: 'the un-awaited rejection leaves the try, so a truncated body ends the run as an unrelated TypeError' },

  { name: 'G11 the per-attempt timeout is removed',
    anchor: ', signal: AbortSignal.timeout(timeoutMs)',
    replace: '',
    case: ['T9b', 'E2E-12'],
    catches: 'one hung socket holds the runner for hours, which today has no limit at all' },

  { name: 'G28 the default attempt timeout is widened until nothing can fail',
    anchor: 'process.env.DEAD_CRON_TIMEOUT_MS || 20000',
    // The value must stay INSIDE AbortSignal.timeout's range (2^31-1 ms) or it is not a widening
    // but a break: 1e12 throws and 4e9 silently becomes a 1 ms timeout, and the first version
    // of this mutant (1e12) was "caught" by 35 cases that had nothing to do with it.
    replace: 'process.env.DEAD_CRON_TIMEOUT_MS || 2000000000',
    case: ['T12c'],
    catches: 'a timeout that exists and never fires' },

  { name: 'G29 the default backoff is zero',
    anchor: 'process.env.DEAD_CRON_BACKOFF_MS || 1000',
    replace: 'process.env.DEAD_CRON_BACKOFF_MS || 0',
    case: ['T2', 'T12d'],
    catches: 'every retry is immediate' },

  { name: 'G30 the backoff stops growing',
    anchor: '|| 1000) * 2 ** i;',
    replace: '|| 1000) * 1;',
    case: ['T2', 'T12d'],
    catches: 'a struggling server is asked at a constant rate' },

  { name: 'G12 the error text drifts',
    anchor: '`GitHub ${res.status} on ${path}: ${await bodyText(res)}`',
    replace: '`GitHub error ${res.status} on ${path}: ${await bodyText(res)}`',
    case: ['T13', 'T4'],
    catches: 'the first FAIL line stops matching two months of committed logs' },

  { name: 'G13 the attempt count is not reported',
    anchor: '    failure.attempts = attempt;',
    replace: '    failure.attempts = 1;',
    case: ['T3', 'E2E-2d'],
    catches: 'the log says one attempt was made when four were' },

  { name: 'G31 the GitHub request id is dropped',
    anchor: "requestId: res.headers.get('x-github-request-id') }",
    replace: 'requestId: null }',
    case: ['T14'],
    catches: 'a future 5xx cannot be reported to GitHub, which is where gh() started' },

  // ── UNREAD ──
  { name: 'G14 a failed contents read is swallowed into "no schedule" again',
    anchor: '  const body = await read(`/repos/${repo}/contents/${path}`);',
    replace: '  let body; try { body = await read(`/repos/${repo}/contents/${path}`); } catch (_) { return null; }',
    case: ['S2b', 'E2E-8a', 'E2E-8b'],
    catches: 'about 408 failed reads a run read as "nothing to judge" — the fallback this fix removes' },

  { name: 'G15 an exhausted read is counted healthy',
    anchor: '      unread.push({ repo, name: w.name, path: w.path, status: e.status, attempts: e.attempts, requestId: e.requestId, why: e.message });',
    replace: '      healthy.push(w.name);',
    case: ['S1a', 'S1b', 'E2E-2d'],
    catches: 'a workflow nobody could read reports green' },

  { name: 'G43 the unread entry loses its status',
    anchor: 'unread.push({ repo, name: w.name, path: w.path, status: e.status,',
    replace: 'unread.push({ repo, name: w.name, path: w.path, status: null,',
    case: ['S1c'],
    catches: 'the report cannot say what GitHub answered' },

  { name: 'G16 a code error is filed as UNREAD',
    anchor: '      if (!(e instanceof GhError)) throw e;\n      unread.push({',
    replace: '      unread.push({',
    case: ['S3'],
    catches: 'a bug in the survey reads as an unread workflow and the run carries on' },

  { name: 'G17 a code error is filed as an unread repo',
    anchor: '      if (!(e instanceof GhError)) throw e;\n      out.push({',
    replace: '      out.push({',
    case: ['A2'],
    catches: 'a bug in a survey is contained instead of stopping the run' },

  { name: 'G18 one repo\'s failed listing aborts every repo after it',
    anchor: '      if (!(e instanceof GhError)) throw e;\n      out.push({',
    replace: '      throw e;\n      out.push({',
    case: ['A1a', 'A1b', 'E2E-3a', 'E2E-3b'],
    catches: 'the 2026-11-25 shape one level up: a repo\'s failure discards the others\' readings' },

  { name: 'G27 a short listing is a plain Error again',
    anchor: "throw new GhError(`${short} on ${path}`, { path, kind: 'short-read' })",
    replace: 'throw new Error(`${short} on ${path}`)',
    case: ['E2E-13a'],
    catches: 'a truncated listing aborts every repo instead of marking one repo unread' },

  { name: 'G42 the unread repo loses its attempt count',
    anchor: 'unreadRepo: { status: e.status, attempts: e.attempts,',
    replace: 'unreadRepo: { status: e.status, attempts: 1,',
    case: ['A1b'],
    catches: 'the log says one attempt when the listing was tried four times' },

  // ── the ratchet ──
  { name: 'G19 an unread admitted key reads as "fixed or gone"',
    anchor: '    resolved:   [...base ].filter(k => !found.has(k) && !unread.has(k)).sort(),',
    replace: '    resolved:   [...base ].filter(k => !found.has(k)).sort(),',
    case: ['R1a', 'E2E-5a'],
    catches: 'the one baselined workflow is reported "remove it" on any day its read failed' },

  { name: 'G20 a wholly unread repo covers no baseline key',
    anchor: '  ? baselineKeys.filter(k => k.startsWith(`${s.repo}:`))',
    replace: '  ? []',
    case: ['R2', 'E2E-5c'],
    catches: 'every admitted key under a repo whose listing failed reads as fixed' },

  { name: 'G21 a repo prefix matches its namesake',
    anchor: '  ? baselineKeys.filter(k => k.startsWith(`${s.repo}:`))',
    replace: '  ? baselineKeys.filter(k => k.startsWith(s.repo))',
    case: ['R2'],
    catches: 'o/r covers o/r2\'s keys, which were read' },

  { name: 'G33 the ratchet is not told what was unread',
    anchor: 'unreadKeys(surveys, Object.keys(baseline)))',
    replace: '[])',
    case: ['E2E-5a', 'E2E-5b', 'E2E-5c'],
    catches: 'the unit is right and the call site does not use it — the shape that hid the EPA probe' },

  { name: 'G34 the ratchet does not print what was unread',
    anchor: '  say(`    UNREAD today, admitted keys not judged : ${r.unread.length}`);\n',
    replace: '',
    case: ['E2E-5b', 'E2E-5c'],
    catches: 'an admitted key goes unjudged and nothing in the log says so' },

  // ── the colour, the report and the log ──
  { name: 'G22 a watch that could not read reports green',
    anchor: '  if (unreadAll.length) {\n    failed = true;',
    replace: '  if (unreadAll.length) {\n    failed = failed;',
    case: ['E2E-2a', 'E2E-3a', 'E2E-4', 'E2E-2f'],
    catches: 'an incomplete reading passes as a complete one' },

  { name: 'G35 a wholly unread repo does not turn the run red',
    anchor: '  ? [`${s.repo} (the whole repo: its workflow listing could not be read)`]',
    replace: '  ? []',
    case: ['E2E-3a'],
    catches: 'a repo nobody could list reports green' },

  { name: 'G23 COVERAGE stops stating the UNREAD count',
    anchor: '  say(`    UNREAD (could not be read after retries, NOT judged; the run is RED for it): ${unreadN} workflow(s), ${unreadRepos} whole repo(s)`);\n',
    replace: '',
    case: ['E2E-6a', 'E2E-6c', 'E2E-6d'],
    catches: 'Rule 91: a JUDGED figure with its denominator out of sight claims the whole' },

  { name: 'G38 an unread workflow is counted as JUDGED',
    anchor: 'n + r.healthy.length + r.dead.length + r.detectors.length, 0);',
    replace: 'n + r.healthy.length + r.dead.length + r.detectors.length + r.unread.length, 0);',
    case: ['E2E-6b'],
    catches: 'the numerator claims a workflow nobody read' },

  { name: 'G24 an unread repo is reported as read, with zero workflows',
    anchor: "      continue;\n    }\n    say(`    ${r.total} workflow(s), ${r.active} active  (all pages read)`);",
    replace: "    }\n    say(`    ${r.total} workflow(s), ${r.active} active  (all pages read)`);",
    case: ['E2E-3c'],
    catches: '"0 workflow(s), (all pages read)" for a repo whose listing failed: absence read as a fact' },

  { name: 'G26 the unread workflows are counted but not named',
    anchor: '    for (const u of r.unread) say(',
    replace: '    for (const u of []) say(',
    case: ['E2E-2d', 'E2E-4', 'E2E-8a'],
    catches: 'the log says one read failed and not which' },

  { name: 'G25 an aborted run leaves no log',
    anchor: 'function writeAbortLog(e) {\n  try {',
    replace: 'function writeAbortLog(e) {\n  return; try {',
    case: ['E2E-7'],
    catches: 'the other way to lose the day: a missing baseline, a parse error or a bug throws before the write' },
];

/** Is this red a CATCH? Not every red is. A mutant that stays green is missed; one that
 *  hangs proves nothing; and a mutant that names the case that must catch it
 *  (`case`, a label prefix or a list of them) is caught only if THOSE cases went
 *  red — a crash, or some other case failing, would otherwise credit a guard that
 *  never fired. `case` is optional, so D1-E15 keep the judgement they were written under. */
const judge = (mut, run) => {
  if (run.timedOut) return { caught: false, note: `TIMED OUT after ${RUN_TIMEOUT_MS} ms — a hang is not a catch` };
  if (run.code === 0) return { caught: false, note: 'the self-test stayed green' };
  const labels = failedLabels(run.stdout);
  const want = mut.case === undefined ? [] : [].concat(mut.case);
  const missing = want.filter(c => !labels.some(l => l === c || l.startsWith(`${c} `)));
  if (missing.length) {
    return { caught: false, note: `red, but NOT by ${missing.join(', ')} — red by: ${labels.join(' | ') || '(no FAIL line: a crash, not an assertion)'}` };
  }
  return { caught: true, note: `by: ${labels.slice(0, 4).join(' | ') || '(no FAIL line: a crash, not an assertion)'}${labels.length > 4 ? ` | +${labels.length - 4} more` : ''}` };
};

let caught = 0;
for (const mut of MUTATIONS) {
  const original = fs.readFileSync(WATCH, 'utf8');
  const hits = original.split(mut.anchor).length - 1;
  if (hits !== 1) {
    console.log(`FAIL       ${mut.name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`);
    continue;
  }
  const mutated = original.replace(mut.anchor, () => mut.replace);
  if (mutated === original) {
    console.log(`FAIL       ${mut.name}\n            file unchanged — NOTHING MUTATED.`);
    continue;
  }
  let verdict;
  try {
    fs.writeFileSync(WATCH, mutated);
    // A mutant that does not PARSE makes the self-test red for the wrong reason: the
    // parser caught it, not the guard (outbox/cc-session-2026-10-05-dead-cron-self-
    // reference.md, S2). That is not a mutation, so it is not a catch.
    const parse = spawnSync('node', ['--check', WATCH], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS });
    verdict = parse.status !== 0
      ? { caught: false, note: `NOT A MUTATION — the mutated file does not parse: ${String(parse.stderr).split('\n').find(l => /Error/.test(l)) || 'node --check failed'}` }
      : judge(mut, selfTest());
  } finally {
    fs.writeFileSync(WATCH, original);
  }
  console.log(`${verdict.caught ? 'CAUGHT    ' : 'NOT CAUGHT'} ${mut.name}\n            ${verdict.note}\n            (${mut.catches})`);
  if (verdict.caught) caught++;
}

console.log(`\n${caught} of ${MUTATIONS.length} mutations caught.`);
console.log(`COVERAGE: ${MUTATIONS.length} mutations, ${MUTATIONS.filter(x => x.case !== undefined).length} of them (G1-G43) with the case(s) that must catch them named and checked.`);
console.log(`D1-E15 mutate the PURE predicates — page loop, short-read assertion, grace, the repo`);
console.log(`list, detector-key qualification, cron extraction, the RATCHET and the dead-window`);
console.log(`definition — and are judged by the self-test going red. G1-G43 mutate the transport`);
console.log(`(retry, backoff, budget, timeout, cut-off body), UNREAD, the ratchet's unread bucket,`);
console.log(`COVERAGE, the exit colour and the abort log, and are judged by the NAMED case failing.`);
console.log(`Since 2026-11-26 the self-test also runs the WHOLE script as a child process against a`);
console.log(`local fake of the GitHub REST API, so the real fetch, the report loop, the log write`);
console.log(`and the exit path ARE exercised. NOT exercised: the real GitHub API — the sandbox token`);
console.log(`is a proxy placeholder and RELAY_GH_PAT exists only in CI, and a live 502 cannot be`);
console.log(`forced — so the live half is verified by dispatching the workflow and reading its`);
console.log(`committed log.`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
