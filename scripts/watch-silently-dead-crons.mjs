#!/usr/bin/env node
// READ-ONLY. Which scheduled workflows have been failing every run, unnoticed?
//
// WHY THIS EXISTS. On 2026-09-15 a repo-wide look at Actions found
// `odds-backfill.yml` red on EVERY scheduled run from 2026-09-01 to that day —
// fifteen consecutive failures, all `[odds-backfill] missing ODDS_API_KEY`,
// exit 1 before a line of its own logic ran. Nobody saw it because every check
// in this repo, mine included, asks about ONE workflow at a time. A daily cron
// that dies at its first guard produces no artifact, no alert and no diff; its
// only evidence is a red dot on a page no session opens.
//
// So this asks the question none of the per-workflow checks can: across every
// scheduled workflow, is any of them failing consistently?
//
// It is deliberately not "did the last run fail" — a single failure is noise,
// and a watch that fires on noise gets ignored, which is how the fifteen days
// happened in the first place.
//
// READ-ONLY: the GitHub API, GET only. It touches no D1 and no relay.
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKEN = process.env.GITHUB_TOKEN;

// FOUR REPOS, NOT ONE, AND THE REASON IS MEASURED. This watch existed to escape
// the blindness that let odds-backfill.yml die for fifteen days. It was scoped
// to the repo it runs in, so on 2026-09-17 it reported 0 dead crons while:
//
//   field-laboratory / drift-sentinel   8 consecutive scheduled failures, from 09-13
//   field-playground / Build Check      3 consecutive scheduled failures, from 09-15
//
// Both crossed its own STREAK threshold. Neither was in its 150. A repo-wide
// watch that is one repo wide is the same defect one level out, for the third
// time in two days — after `?per_page=100` against 150 workflows, and after a
// coverage line that named its numerator and not its denominator.
//
// Cross-repo reads need RELAY_GH_PAT, not the run's GITHUB_TOKEN, which is
// scoped to its own repo. That PAT is the established mechanism here: eight
// workflows already use it, including contracts-identity-check.yml, which
// checks out jubilant-bassoon with it and calls it "already proven".
export const REPOS = (process.env.DEAD_CRON_REPOS || [
  'jeffunglesbee-create/field-relay-nba',
  'jeffunglesbee-create/jubilant-bassoon',
  'jeffunglesbee-create/field-laboratory',
  'jeffunglesbee-create/field-playground',
].join(',')).split(',').map(r => r.trim()).filter(Boolean);
// How many consecutive non-working runs (failed, skipped, or never started — see
// DEAD_CONCLUSIONS) make a workflow "dead" rather than flaky.
const STREAK = Number(process.env.DEAD_CRON_STREAK || 3);
// A workflow added moments ago has not failed to fire. Beyond this, a declared
// cron with no run is a finding. 40 days clears the longest schedule in this
// repo (monthly, `23 8 4 * *`) plus a full cycle.
export const GRACE = Number(process.env.NEVER_FIRED_GRACE_DAYS || 40);

// ── THE TRANSPORT ───────────────────────────────────────────────────────────
// ONE GitHub 502 ended the 2026-11-25 run. gh() made a single fetch with no
// timeout, the throw reached the top-level catch, nothing had been written (the
// report and the log come after all four repos are surveyed), and the commit step
// printed 'nothing to commit': 320 good readings and the day's log, gone. The same
// query answers 200 now, so the fault was GitHub's and transient.
//
// A RETRY RE-ISSUES THE IDENTICAL GET to the identical source with the identical
// credential, and returns that source's real answer or nothing. It substitutes no
// second source, cached copy, default or empty reading. What is retried is only what
// says the REQUEST did not get a real answer: a 5xx, a transport error, an aborted
// (timed-out) attempt, a body cut off mid-read. A 4xx is GitHub's real answer and is
// never retried — including 403 and 429, which are rate limits, not outages.
//
// BOUNDED, and the bounds are asserted in --self-test: an unasserted tolerance grows
// until nothing can fail (the NEVER_FIRED_GRACE_DAYS lesson, mutation D7).
export const RETRIES = Number(process.env.DEAD_CRON_RETRIES || 3);                              // 1 + 3 attempts
export const BACKOFF_MS = (i) => Number(process.env.DEAD_CRON_BACKOFF_MS || 1000) * 2 ** i;      // 1 s, 2 s, 4 s
export const RETRY_BUDGET_MS = Number(process.env.DEAD_CRON_RETRY_BUDGET_MS || 120000);          // sleeping, per RUN
export const ATTEMPT_TIMEOUT_MS = Number(process.env.DEAD_CRON_TIMEOUT_MS || 20000);             // per attempt
// A test seam, like DEAD_CRON_REPOS: the end-to-end cases point the real script at a local fake.
const API = process.env.DEAD_CRON_API_BASE || 'https://api.github.com';
export const retryableStatus = (s) => s >= 500 && s <= 599;

/** A read that could not be made. `kind`: 'http' (GitHub answered with a status),
 *  'transport' (no usable answer: reset, abort, body cut off) or 'short-read'. */
export class GhError extends Error {
  constructor(message, { path, status = null, attempts = 1, kind = 'http', requestId = null } = {}) {
    super(message);
    this.name = 'GhError';
    Object.assign(this, { path, status, attempts, kind, requestId });
  }
}
const RUN_BUDGET = { left: RETRY_BUDGET_MS };
const log = [];

// The workflow FILE, not the API: the API does not report whether a workflow
// declares a schedule, only whether runs exist — and runs existing is the thing
// being questioned. Read over the contents API rather than off disk, because
// three of the four repos are not checked out. Uniform for all four on purpose:
// a local-disk path for one repo and an API path for the others would be two
// implementations of one question, which is how the four sport-key registries
// and the two site vocabularies happened.
const BASELINE_FILE = 'docs/dead-cron-baseline.json';

/**
 * THIS WATCH, WHICH HAD BECOME ITS OWN FINDING.
 *
 * It exits 1 whenever it has findings (`if (failed) process.exit(1)` below).
 * Three findings in a row therefore make IT a workflow with three consecutive
 * failed scheduled runs, which the next run reports as new decay — and that
 * report exits 1 again. A closed loop.
 *
 * MEASURED, not reasoned about. Its first reds were 2026-10-01, when
 * seed-coverage.yml went new. By 2026-10-03 it had three, and the 2026-10-04
 * run listed `jeffunglesbee-create/field-relay-nba:.github/workflows/
 * silently-dead-crons.yml` under NEW, not in the baseline — beside the one
 * genuine finding it had that day. It would have stayed there forever: a
 * self-sustaining entry can never settle, because the thing keeping it red is
 * its own redness.
 *
 * A detector's red IS its output. docs/declared-detectors.json already says
 * that for other workflows; this is the same rule applied to the file that
 * enforces it. Excluded rather than declared, because a declaration is a
 * statement about a condition someone should fix, and there is no condition
 * here to fix.
 *
 * REPO-QUALIFIED, for the reason `declaredKey` is. Excluding a bare path would
 * let a genuinely dead namesake in another repo go unreported — the exact
 * failure that forced repo-qualified keys on 2026-09-17.
 */
const SELF = 'jeffunglesbee-create/field-relay-nba:.github/workflows/silently-dead-crons.yml';

/** Is this workflow the watch itself, in the repo it actually runs from? */
export const isSelf = (repo, path) => `${repo}:${path}` === SELF;

/** THE RATCHET. Green means NO NEW DECAY, not "nothing is broken".
 *
 *  A COUNT WOULD NOT DO. docs/run-clock-closing-baseline.txt holds a bare
 *  number and that was right for a one-time cleanup of 58 rows. Here it would
 *  be wrong: fix drift-sentinel on the same day a different cron rots and the
 *  count stays 4, the run stays green, and a new decay is invisible. So the
 *  baseline is a SET OF KEYS, and it is the key that must already be admitted.
 *
 *  Returns { unexpected, carried, unread, resolved }:
 *    unexpected  found dead, not in the baseline          -> FAIL, this is new rot
 *    carried     found dead, admitted in the baseline     -> reported with its age
 *    unread      in the baseline, its read FAILED today   -> not judged; NOT "resolved"
 *    resolved    in the baseline, read, no longer dead    -> "stale, remove it", NOT a failure
 *
 *  resolved must never fail the run. A watch that goes red when you fix
 *  something teaches people to stop fixing things.
 *
 *  UNREAD IS NOT RESOLVED. A key that is absent from `found` because its read failed
 *  was not fixed; nobody looked. Filed as resolved, one failed read would print "fixed
 *  or gone; remove it" against the one workflow the baseline exists to keep admitting. */
export function ratchetVerdict(foundKeys, baselineEntries, unreadKeyList = []) {
  const found = new Set(foundKeys), unread = new Set(unreadKeyList);
  const base  = new Set(Object.keys(baselineEntries || {}));
  return {
    unexpected: [...found].filter(k => !base.has(k)).sort(),
    carried:    [...found].filter(k =>  base.has(k)).sort(),
    unread:     [...base ].filter(k => !found.has(k) &&  unread.has(k)).sort(),
    resolved:   [...base ].filter(k => !found.has(k) && !unread.has(k)).sort(),
  };
}

/** The baseline keys whose reading failed today. A workflow-level failure covers its own key;
 *  a repo whose LISTING failed covers every key under it. The prefix carries the colon, so
 *  `o/r` does not cover a namesake `o/r2`. */
export const unreadKeys = (surveys, baselineKeys) => surveys.flatMap(s => s.unreadRepo
  ? baselineKeys.filter(k => k.startsWith(`${s.repo}:`))
  : s.unread.map(u => declaredKey(s.repo, u.path)));

/** review_by is what stops the baseline becoming the furniture it replaced.
 *  Past that date an entry fails the run BY NAME. Deferring is allowed;
 *  deferring silently is not — moving the date means writing a new reason. */
export function overdueReviews(carriedKeys, baselineEntries, today = new Date().toISOString().slice(0, 10)) {
  return carriedKeys.filter((k) => {
    const by = baselineEntries?.[k]?.review_by;
    // NO review_by IS OVERDUE, NOT EXEMPT. An entry without a date would
    // otherwise be the quietest possible way to silence a cron forever — the
    // same absence-read-as-permission shape as a zero denominator (Rule 99).
    if (!by) return true;
    return by < today;
  }).sort();
}

/** Repo-qualified, because `.github/workflows/deploy.yml` exists in all four. */
export const declaredKey = (repo, path) => `${repo}:${path}`;

// COMMENTED LINES ARE NOT A SCHEDULE. A schedule retired by commenting it out
// leaves `#   - cron: '...'` in the file, and the bare regex matched it, so a
// workflow with no schedule at all was judged as one that never fired:
// jubilant-bassoon soccer-fbref-mls.yml sat in the baseline as `never_fired`
// from 2026-09-17 until 2026-10-17. Only a line that STARTS with `#` is
// dropped, so a live cron followed by a trailing comment still counts.
export const uncommented = (src) => String(src || '').split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
export const cronFromSource = (src) => (uncommented(src).match(/cron:\s*'([^']+)'/) || [])[1] || null;

// NO CATCH HERE, AND THERE USED TO BE ONE. `catch (_) { return null; }` turned a contents
// read that FAILED into "no schedule: block, not judged" — about 408 times a run, with no
// comment saying why. That is absence read as not-applicable (Rule 99) on the same fault
// class the transport now handles. A failed read throws GhError; surveyRepo files it UNREAD.
export async function cronOf(repo, path, read = gh) {
  const body = await read(`/repos/${repo}/contents/${path}`);
  if (!body || !body.content) return null;
  return cronFromSource(Buffer.from(body.content, 'base64').toString('utf8'));
}

/** Which of `zero-scheduled-run` workflows are a finding rather than a fact.
 *  Pure, so it can be tested without the network — the credentials here are a
 *  proxy placeholder in a sandbox and the real token only exists in CI. */
export function overdueNeverFired(neverFired, graceDays, now = Date.now()) {
  return neverFired.filter(w => (now - Date.parse(w.created_at)) / 86400000 > graceDays);
}

/** A page loop that stops early is the defect this whole commit is about, so
 *  the predicate that decides "keep going" is exported and pinned. */
export const wantsAnotherPage = (batchLength, perPage) => batchLength >= perPage;

/** The short-read assertion, separated from the fetching so it can fail on
 *  purpose without a network. */
export function shortRead(collected, total) {
  return total !== null && total !== undefined && collected < total
    ? `pagination short-read: collected ${collected} of ${total}` : null;
}

/** WHAT "DEAD" MEANS, in one place, so the survey, the report and the tests cannot
 *  disagree. A scheduled workflow is dead when NONE of its last STREAK completed
 *  scheduled runs worked: each ran and failed, was skipped by its own job `if:`,
 *  or never started. Until 2026-11-02 only the first was counted. The other two
 *  were measured, and both were invisible here:
 *
 *    field-relay-nba / nfl-epa-route-probe.yml   66 of 66 scheduled runs `skipped`.
 *      Its job `if:` read an upstream `workflow_run` conclusion that a `schedule`
 *      event does not carry, so it was false on every tick. Green on the Actions
 *      page, never executed once, and absent from this watch: the old test was
 *      `every(r => r.conclusion === 'failure')`, which is false for a skipped run.
 *    jubilant-bassoon / patent-watch.yml          21 of 21 `startup_failure`, from
 *      2026-06-10. The caller passes an input the called workflow does not declare,
 *      so GitHub refuses the run before any job exists.
 *
 *  `cancelled` is NOT in the set on purpose: `concurrency: cancel-in-progress`
 *  produces it legitimately, so a streak of it is not evidence of a dead cron.
 *  `timed_out`, `action_required` and `neutral` are left out for a different
 *  reason: no workflow in the four repos has one as its whole window, so there is
 *  nothing measured to judge. The COVERAGE block says so rather than leaving the
 *  reader to infer it. */
export const DEAD_CONCLUSIONS = new Set(['failure', 'skipped', 'startup_failure']);

/** 'failure' | 'skipped' | 'startup_failure' when every run in the window shares
 *  one dead conclusion; 'mixed' when all are dead but not alike; null when the
 *  window is too short, or any run in it worked or ended some other way. */
export function streakKind(conclusions, streak = STREAK) {
  if (conclusions.length < streak) return null;
  if (!conclusions.every(c => DEAD_CONCLUSIONS.has(c))) return null;
  const distinct = [...new Set(conclusions)];
  return distinct.length === 1 ? distinct[0] : 'mixed';
}

const DEAD_LEAD = {
  failure: 'red',
  skipped: 'every scheduled run SKIPPED (the job never started)',
  startup_failure: 'every scheduled run STARTUP_FAILURE (the workflow never started)',
};

/** The report text for one dead workflow. The `failure` text is byte-for-byte what
 *  this printed before 2026-11-02, so two months of committed logs still compare. */
export function deadLines(d) {
  const lead = d.outcome === 'mixed'
    ? `no scheduled run worked: ${d.conclusions.join(', ')}`
    : DEAD_LEAD[d.outcome];
  if (lead === undefined) throw new Error(`deadLines: unknown outcome ${JSON.stringify(d.outcome)}`);
  return `      ${d.path}\n        ${lead} since at least ${d.since}, latest ${d.latest}\n        ${d.url}`;
}

/** Every dead workflow across the surveyed repos, whatever its kind. This list is
 *  what the ratchet judges, so it is derived from the surveys and not from the
 *  report loop: a change to how the report is printed cannot change what is judged. */
export const allDead = (surveys) => surveys.flatMap(r => r.dead);

/** Every read that could not be made, as printable keys: one per unread workflow, one per
 *  repo whose listing failed. The COVERAGE count and the exit both come from here, so they
 *  cannot disagree. */
export const unreadItems = (surveys) => surveys.flatMap(s => s.unreadRepo
  ? [`${s.repo} (the whole repo: its workflow listing could not be read)`]
  : s.unread.map(u => declaredKey(s.repo, u.path)));

if (process.argv.includes('--self-test')) {
  let bad = 0;
  // Strict equality, so every case must produce a SCALAR. Three array cases
  // were written here first and all three "failed" against an identical
  // expectation — a check reporting a defect that was its own. Arrays join.
  // COUNTED, NOT ASSERTED. The total below was the string `28/28`, hardcoded.
  // Three assertions were added on 2026-10-04 and it still printed 28/28 — a
  // reader comparing runs would have seen no change at all, and a DELETED
  // assertion would have been equally invisible. A self-reported number is not
  // evidence of anything, which is the rule this repo applies to scores and had
  // not applied to its own test count.
  let ran = 0;
  const one = (label, got, want, why) => (ran++, got === want
    ? console.log(`  PASS  ${label} -> ${JSON.stringify(got)}  (${why})`)
    : (bad++, console.log(`  FAIL  ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`)));
  const DAY = 86400000, NOW = Date.parse('2026-09-17T03:00:00Z');
  const wf = (path, ageDays) => ({ path, created_at: new Date(NOW - ageDays * DAY).toISOString() });

  // The page loop. 150 workflows in a 100-per-page world was the real number.
  one('a full page means more to come', wantsAnotherPage(100, 100), true, 'exactly the shape that was missed — 150 read as 100');
  one('a short page ends it',           wantsAnotherPage(50, 100),  false, 'the last page');
  one('an empty page ends it',          wantsAnotherPage(0, 100),   false, 'nothing left');

  // The short-read assertion. A loop that trusts itself is how this began.
  one('collected everything',  shortRead(150, 150), null, 'no truncation');
  one('collected 100 of 150',  shortRead(100, 150) !== null, true, 'the exact defect, now fatal instead of silent');
  one('no total reported',     shortRead(100, null), null, 'cannot assert against a number the API did not send');

  // The grace window: a never-fired cron is not automatically a fault.
  one('added today',   overdueNeverFired([wf('a.yml', 0)], 40, NOW).length, 0, 'has not had a slot yet');
  one('monthly, 11d',  overdueNeverFired([wf('bsd-leagues-baseline.yml', 11)], 40, NOW).length, 0,
      'real case: added 09-06 with a day-4 cron, next due 10-04');
  one('90 days, never fired', overdueNeverFired([wf('c.yml', 90)], 40, NOW).length, 1,
      'a cron that has never run in three months is not a cron');
  one('exactly at the grace', overdueNeverFired([wf('d.yml', 40)], 40, NOW).length, 0, 'strictly greater, so the boundary is not a fault');

  // THE GRACE ITSELF IS BOUNDED. Every predicate above takes graceDays as an
  // argument, so widening the DEFAULT was invisible to all of them — mutation
  // D7 set it to 100000 and nothing went red. A tolerance nobody can assert
  // against is a tolerance that grows until the watch cannot fail, which is how
  // a watch like this ends quietly rather than being switched off.
  one('the default grace is bounded', GRACE > 0 && GRACE <= 90, true,
      'longest schedule here is monthly, so 40 clears it with a full cycle spare; 90 is the ceiling');

  // THE REPO LIST. A watch that silently narrows to one repo is the defect this
  // change fixes; it reported 0 dead crons on a day two other repos were red.
  one('all four repos are watched', REPOS.length, 4, 'relay, client, laboratory, playground');
  one('the relay is still among them', REPOS.includes('jeffunglesbee-create/field-relay-nba'), true,
      'widening must not drop the repo it started with');
  one('the two red repos are among them',
      REPOS.includes('jeffunglesbee-create/field-laboratory') &&
      REPOS.includes('jeffunglesbee-create/field-playground'), true,
      'drift-sentinel at 8 consecutive failures and Build Check at 3 — the reason this widened');

  // DETECTOR KEYS. `.github/workflows/deploy.yml` exists in all four repos.
  one('a key carries its repo', declaredKey('o/r', '.github/workflows/x.yml'), 'o/r:.github/workflows/x.yml',
      'an unqualified key would let one repo excuse another repo\'s dead namesake');
  one('two repos, same path, different keys',
      declaredKey('o/a', '.github/workflows/deploy.yml') !== declaredKey('o/b', '.github/workflows/deploy.yml'), true,
      'the collision that made qualification necessary');

  // CRON EXTRACTION, now over API-fetched source rather than a local file.
  one('a scheduled workflow', cronFromSource("on:\n  schedule:\n    - cron: '0 11 * * *'\n"), '0 11 * * *', 'declared');
  one('a workflow with no schedule', cronFromSource('on:\n  push:\n    branches: [main]\n'), null,
      'nothing to judge — this is the bucket that must stay separate');
  one('an empty body', cronFromSource(''), null, 'a failed contents fetch is not a declared cron');
  // The real shape, from jubilant-bassoon soccer-fbref-mls.yml: a schedule
  // retired by commenting it out. It has no schedule, so nothing is due.
  one('a retired, commented-out schedule',
      cronFromSource("on:\n  # schedule:\n  #   - cron: '0 8 * * 1'\n  workflow_dispatch:\n"), null,
      'a comment is not a schedule — this one was baselined as never-fired for a month');
  one('a live cron with a trailing comment',
      cronFromSource("on:\n  schedule:\n    - cron: '0 6 * * 1'  # weekly\n"), '0 6 * * 1',
      'only a commented LINE is skipped, not a line that carries a comment');

  // ── THE RATCHET ────────────────────────────────────────────────────────
  const BASE = { 'r:a.yml': { review_by: '2026-10-17' }, 'r:b.yml': { review_by: '2026-10-17' } };
  const rv = (found) => ratchetVerdict(found, BASE);

  one('nothing rotting', [rv([]).unexpected.length, rv([]).resolved.length].join('/'), '0/2',
      'both baseline entries resolved — and that is not a failure');
  one('exactly the admitted set', rv(['r:a.yml','r:b.yml']).unexpected.length, 0,
      'steady state: known rot, nothing new — the run is GREEN with two things broken');
  // ── THE SELF-REFERENCE, which closed on 2026-10-04 ────────────────────
  one('the watch excludes ITSELF, in the repo it runs from',
      String(isSelf('jeffunglesbee-create/field-relay-nba',
                    '.github/workflows/silently-dead-crons.yml')), 'true',
      'it exits 1 on any finding, so three findings make it its own finding');
  one('a NAMESAKE IN ANOTHER REPO is still judged',
      String(isSelf('jeffunglesbee-create/jubilant-bassoon',
                    '.github/workflows/silently-dead-crons.yml')), 'false',
      'an unqualified exclusion would excuse a genuinely dead cron elsewhere — the 2026-09-17 lesson');
  one('a different workflow in the same repo is still judged',
      String(isSelf('jeffunglesbee-create/field-relay-nba',
                    '.github/workflows/deploy.yml')), 'false');
  one('a NEW dead cron', rv(['r:a.yml','r:b.yml','r:c.yml']).unexpected.join(','), 'r:c.yml',
      'the only thing that should ever fail this watch');
  one('one fixed, one new, count unchanged',
      [rv(['r:a.yml','r:c.yml']).unexpected, rv(['r:a.yml','r:c.yml']).resolved].map(x => x.join(',')).join(' | '),
      'r:c.yml | r:b.yml',
      'THE CASE A COUNT CANNOT SEE: 2 before, 2 after, and a new decay hiding behind a fix');
  one('a fix is never a failure', rv(['r:a.yml']).unexpected.length, 0,
      'b resolved; a watch that goes red when you fix something teaches people to stop');

  // review_by, the part that stops the baseline becoming furniture
  const TODAY = '2026-09-17';
  one('inside its review window', overdueReviews(['r:a.yml'], BASE, TODAY).length, 0, 'deferred, with a date');
  one('past its review_by',
      overdueReviews(['r:x.yml'], { 'r:x.yml': { review_by: '2026-09-16' } }, TODAY).join(','), 'r:x.yml',
      'yesterday — the entry now fails by name until someone restates the deferral');
  one('review_by is today', overdueReviews(['r:x.yml'], { 'r:x.yml': { review_by: TODAY } }, TODAY).length, 0,
      'the day itself is still inside; it fails tomorrow');
  one('NO review_by at all', overdueReviews(['r:x.yml'], { 'r:x.yml': {} }, TODAY).join(','), 'r:x.yml',
      'absent is overdue, not exempt — an undated entry is the quietest way to silence a cron forever');

  // ── WHAT "DEAD" MEANS ───────────────────────────────────────────────────
  // nfl-epa-route-probe.yml: 66 of 66 scheduled runs `skipped`, which is not a
  // failure, so none was ever counted by this watch. patent-watch.yml: 21 of 21
  // `startup_failure`. Both measured on 2026-11-02, both invisible to a test that
  // read `every(r => r.conclusion === 'failure')`.
  one('the window is the default the cases below assume', STREAK, 3, 'DEAD_CRON_STREAK is not set in CI');
  const kind = (...cs) => String(streakKind(cs, 3));
  one('three failures', kind('failure', 'failure', 'failure'), 'failure', 'the original definition, unchanged');
  one('three skipped', kind('skipped', 'skipped', 'skipped'), 'skipped',
      'nfl-epa-route-probe.yml: 66 of 66, not a failure and so never counted');
  one('three startup_failure', kind('startup_failure', 'startup_failure', 'startup_failure'), 'startup_failure',
      'patent-watch.yml: 21 of 21 since 2026-06-10, no job ever created');
  one('failure and skipped mixed', kind('failure', 'skipped', 'failure'), 'mixed',
      'no run worked, so dead, though not alike');
  one('a success in the window', kind('failure', 'success', 'failure'), 'null',
      'one working run in three is flaky, not dead');
  one('the newest run worked', kind('success', 'skipped', 'skipped'), 'null',
      'a probe fixed yesterday must read healthy today, not stay dead until the skips roll off');
  one('only two runs', kind('skipped', 'skipped'), 'null', 'a window shorter than the streak proves nothing');
  one('cancelled is not dead', kind('cancelled', 'cancelled', 'cancelled'), 'null',
      'concurrency cancel-in-progress produces it legitimately');
  one('an unmeasured conclusion is not dead', kind('timed_out', 'timed_out', 'timed_out'), 'null',
      'not judged, and the COVERAGE block says so');

  // ── THE TRANSPORT (ghRequest), against a scripted fetch ─────────────────────
  // THE DEFECT: a single GitHub 502 aborted the 2026-11-25 run and took the day's log
  // with it. Every case below asserts a RECORDED FACT (calls made, sleeps asked for,
  // signals seen), never an exception thrown by the fake: a throw inside the fake is
  // caught by the very retry under test, and one mutant read as a pass that way.
  const res = (status, body = {}, { cut = false } = {}) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: (h) => (h === 'x-github-request-id' ? `REQ-${status}` : null) },
    json: async () => { if (cut) throw new TypeError('terminated'); return body; },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  // steps: 200 | an HTTP status | 'net' | 'cut' (200, body dies mid-read) | 'hang' (never
  // answers until its abort signal fires). The last step repeats forever. The injected
  // sleep records what was asked and throws after 10, so an unbounded loop goes red
  // here instead of hanging the run.
  const drive = async (steps, opts = {}) => {
    const rec = { calls: 0, sleeps: [], signals: 0, aborted: 0, reasons: [], abortAfter: [], thrown: null, out: null };
    const fetchFn = (_url, init) => {
      if (init && init.signal instanceof AbortSignal) rec.signals++;
      const step = steps[Math.min(rec.calls++, steps.length - 1)];
      if (step === 'net') return Promise.reject(new TypeError('fetch failed'));
      if (step === 'cut') return Promise.resolve(res(200, {}, { cut: true }));
      // AbortSignal.timeout()'s timer is unref'd, so a fake that merely waits leaves the event
      // loop empty and Node exits 13 on the unsettled await — the first run of this case did.
      // A real hung socket keeps the loop alive; this timer does the same, and it also
      // rejects on its own when NO signal arrives, so a missing signal is reported as a
      // recorded fact (T9b) instead of a hang or a crash.
      // `aborted`, `reasons` and `abortAfter` are RECORDED when the signal itself fires. T9a used
      // to pass with the signal deleted: the 1500 ms timer above rejected the attempt instead, and
      // the retry loop cannot tell a timer's rejection from an abort's.
      if (step === 'hang') return new Promise((_, rej) => {
        const t0 = Date.now();
        const keep = setTimeout(() => rej(new Error('fake: nothing aborted this attempt')), 1500);
        if (init && init.signal) init.signal.addEventListener('abort', () => {
          clearTimeout(keep); rec.aborted++; rec.reasons.push(init.signal.reason && init.signal.reason.name);
          rec.abortAfter.push(Date.now() - t0); rej(init.signal.reason);
        });
      });
      return Promise.resolve(step === 200 ? res(200, { ok: true })
        : res(step, { message: step >= 500 ? 'Server Error' : 'Not Found' }));
    };
    const sleep = async (ms) => { rec.sleeps.push(ms); if (rec.sleeps.length > 10) throw new Error('RUNAWAY: more than 10 sleeps'); };
    // A FRESH BUDGET PER CALL. The in-process cases used to draw on the one module-level RUN_BUDGET
    // (about 25 s of its 120 s between them), so adding enough exhausting cases would have failed
    // later ones for an unrelated reason. The per-RUN property itself is E2E-14.
    try { rec.out = await ghRequest('/p', { token: 't', fetchFn, sleep, budget: { left: RETRY_BUDGET_MS }, ...opts }); } catch (e) { rec.thrown = e; }
    return rec;
  };
  const gist = (r, n = 40) => `${r.calls} call(s), sleeps [${r.sleeps}], ${r.thrown ? `threw ${r.thrown.message.slice(0, n)}` : `read ${JSON.stringify(r.out)}`}`;

  one('T1 a 502 then a 200 reads', gist(await drive([502, 200])), '2 call(s), sleeps [1000], read {"ok":true}',
      'THE 2026-11-25 SHAPE: one transient 5xx must cost one repeated GET, not the day');
  one('T2 three 502s then a 200 reads', gist(await drive([502, 502, 502, 200])),
      '4 call(s), sleeps [1000,2000,4000], read {"ok":true}', 'the whole default backoff, 1 s then 2 s then 4 s');
  const t3 = await drive([502]);
  one('T3 502 forever is a GhError after exactly 1+RETRIES calls',
      `${t3.calls}|${t3.thrown && t3.thrown.status}|${t3.thrown && t3.thrown.attempts}|${t3.thrown ? t3.thrown.message.startsWith('GitHub 502 on /p:') : 'no throw'}`,
      `${1 + RETRIES}|502|${1 + RETRIES}|true`, 'bounded: it gives up, and says how many attempts it made');
  const t4 = await drive([404]);
  one('T4 a 404 is one call and no sleep', gist(t4, 17), '1 call(s), sleeps [], threw GitHub 404 on /p:', 'a 4xx is GitHub\'s real answer');
  // EVERY 4xx, not a sample: 401, 403 and 429 were pinned and a retried 408 (or 400, 410, 422) read green.
  const t5 = [];
  for (let st = 400; st <= 499; st++) { const r = await drive([st]); if (r.calls !== 1 || r.sleeps.length) t5.push(`${st}:${r.calls}/${r.sleeps.length}`); }
  one('T5 every status 400-499 is one call and no sleep', t5.length ? t5.join(' ') : 'all 100', 'all 100',
      'a rate limit is an answer, not an outage; retrying it spends the quota it reports. The offenders are listed, status:calls/sleeps');
  one('T6 a transport error then a 200 reads', gist(await drive(['net', 200])), '2 call(s), sleeps [1000], read {"ok":true}',
      'a reset connection carries no answer, so it is retried');
  const t7 = await drive(['net']);
  one('T7 a transport error forever is a GhError with no status',
      `${t7.calls}|${t7.thrown && t7.thrown.status}|${t7.thrown && t7.thrown.kind}`, `${1 + RETRIES}|null|transport`,
      'kind says it was not an HTTP answer');
  one('T8 a body cut off mid-read is retried', gist(await drive(['cut', 200])), '2 call(s), sleeps [1000], read {"ok":true}',
      'res.json() is awaited INSIDE the try; un-awaited, the cut escapes the loop');
  const t9 = await drive(['hang', 200], { timeoutMs: 25 });
  one('T9a a hung fetch is aborted by its signal and retried', `${gist(t9)}|aborted ${t9.aborted}|${t9.reasons.join(',')}`,
      '2 call(s), sleeps [1000], read {"ok":true}|aborted 1|TimeoutError',
      'no timeout means one hung socket holds the runner for hours; the abort is a recorded fact, not the fake\'s own timer');
  one('T9b every attempt carried an abort signal', t9.signals === t9.calls, true, `${t9.signals} signals over ${t9.calls} attempts`);
  one('T10a a spent budget stops retrying', gist(await drive([502], { budget: { left: 0 } }), 17),
      '1 call(s), sleeps [], threw GitHub 502 on /p:', 'the retry budget is per RUN, so an outage cannot multiply into hours');
  one('T10b a wait larger than the budget left is not slept', gist(await drive([502], { budget: { left: 2500 } }), 17),
      '2 call(s), sleeps [1000], threw GitHub 502 on /p:', '1000 fits in 2500, the next 2000 does not');
  one('T11 only 5xx is retryable', [499, 500, 599, 600].map(retryableStatus).join(','), 'false,true,true,false', 'the edges of the class');
  // THE BOUNDS ARE ASSERTED. Every case above takes the knobs as arguments, so widening
  // a DEFAULT is invisible to them (D7 did that to the grace and nothing went red).
  one('T12a the default retries are bounded', RETRIES >= 1 && RETRIES <= 5, true, 'at least one retry, no more than five');
  one('T12b the default retry budget is bounded', RETRY_BUDGET_MS >= 1 && RETRY_BUDGET_MS <= 300000, true, 'sleeping, per run, at most five minutes');
  one('T12c the default attempt timeout is bounded', ATTEMPT_TIMEOUT_MS >= 1000 && ATTEMPT_TIMEOUT_MS <= 60000, true,
      'a GitHub list answers in well under a second; a minute is the ceiling');
  one('T12d the default backoff doubles from a positive start', BACKOFF_MS(0) >= 1 && BACKOFF_MS(0) <= 10000 && BACKOFF_MS(2) === 4 * BACKOFF_MS(0), true,
      'DEAD_CRON_* is not set in CI');
  one('T13 a 4xx message is byte for byte what gh() threw', t4.thrown && t4.thrown.message, 'GitHub 404 on /p: {"message":"Not Found"}',
      'two months of committed logs and the first FAIL line still compare');
  one('T14 the GitHub request id is kept on the error', t4.thrown && t4.thrown.requestId, 'REQ-404',
      'a future 5xx can be reported to GitHub; gh() used to discard every header');
  // THE DEFAULT SLEEP, which every case above replaces. A no-op sleep fires the retries back to
  // back and a x1000 one costs seventeen minutes a retry; both left the first 121 cases green.
  // The race is a watchdog: a wrong sleep must read as a failed case, not a stalled run.
  const watchdog = (ms) => new Promise((r) => setTimeout(() => r('WATCHDOG'), ms));
  const t16t0 = Date.now();
  const t16 = await Promise.race([drive([502, 200], { sleep: undefined, backoff: () => 150 }), watchdog(3000)]);
  const t16ms = Date.now() - t16t0;
  one('T16 the real sleep really waits, and not for long', t16 !== 'WATCHDOG' && t16ms >= 120 && t16ms < 1500, true,
      `one retry after a 150 ms backoff took ${t16ms} ms${t16 === 'WATCHDOG' ? ' (watchdog fired)' : ''}`);
  // THE TIMEOUT VALUE, not only that a signal exists (T9b) and that a hung child dies before the
  // 20 s killer (E2E-12): x10, x2 and a hardcoded 20000 all read green. 200 ms in, abort observed
  // by the fake between 160 and 320 ms: a x2 value lands at 400.
  const t17 = await drive(['hang', 200], { timeoutMs: 200 });
  one('T17 the per-attempt timeout VALUE is honoured', t17.abortAfter.length === 1 && t17.abortAfter[0] >= 160 && t17.abortAfter[0] <= 320, true,
      `a 200 ms timeout aborted after [${t17.abortAfter}] ms`);

  // The survey, against a fake of the API. The fake answers the REAL query or
  // nothing: a URL that has drifted (no `status=completed`, another per_page or
  // event) reads as "no runs", so it fails the cases below instead of passing.
  // `faults` injects a read that could not be made: { runs: { 'x.yml': Error }, contents: { 'y.yml': Error } }.
  const fakeIo = (byPath, crons = {}, faults = {}) => {
    const wfs = Object.keys(byPath).map((p, i) => ({
      id: i + 1, name: `wf ${p}`, path: p, state: 'active', created_at: '2026-01-01T00:00:00Z' }));
    const want = ['event=schedule', 'per_page=3', 'status=completed'].join('&');
    return {
      ghAll: async () => wfs,
      gh: async (path) => {
        const m = /\/workflows\/(\d+)\/runs\?(.*)$/.exec(path);
        if (m && faults.runs && faults.runs[wfs[Number(m[1]) - 1].path]) throw faults.runs[wfs[Number(m[1]) - 1].path];
        const cs = m && m[2].split('&').sort().join('&') === want ? byPath[wfs[Number(m[1]) - 1].path] : [];
        return { workflow_runs: cs.map((c, i) => ({
          conclusion: c, created_at: `2026-10-0${3 - i}T00:00:00Z`, html_url: `u/${m[1]}/${i}` })) };
      },
      cronOf: async (_repo, p) => {
        if (faults.contents && faults.contents[p]) throw faults.contents[p];
        return p in crons ? crons[p] : null;
      },
    };
  };
  const SKIPS = ['skipped', 'skipped', 'skipped'];
  const sv = await surveyRepo('o/r', {}, fakeIo({
    'epa.yml': SKIPS,
    'ok.yml': ['success', 'skipped', 'skipped'],
    'red.yml': ['failure', 'failure', 'failure'],
    'sf.yml': ['startup_failure', 'startup_failure', 'startup_failure'],
    'mix.yml': ['failure', 'skipped', 'failure'],
    'short.yml': ['skipped', 'skipped'],
    'none.yml': [],
  }, { 'none.yml': '0 1 * * *' }));
  one('survey: which workflows are dead', sv.dead.map(d => d.path).join(','), 'epa.yml,red.yml,sf.yml,mix.yml',
      'the all-skipped probe is now among them');
  one('survey: how each is dead', sv.dead.map(d => d.outcome).join(','), 'skipped,failure,startup_failure,mixed',
      'the kind travels with the entry, so the report can say which');
  one('survey: who is healthy', sv.healthy.join(','), 'wf ok.yml,wf short.yml',
      'a success in the window, or fewer runs than the streak');
  one('survey: a cron that never produced a run', sv.neverFired.map(w => w.path).join(','), 'none.yml',
      'the zero-run branch is untouched by this change');
  one('survey: the window bounds', sv.dead.map(d => `${d.since}|${d.latest}`)[0],
      '2026-10-01T00:00:00Z|2026-10-03T00:00:00Z', 'oldest and newest of the three, as before');
  const dv = await surveyRepo('o/r', { 'o/r:epa.yml': { reports: 'r', red_because: 'b', tracked_by: 't' } },
                              fakeIo({ 'epa.yml': SKIPS }));
  one('survey: a declared detector that never runs keeps its own bucket',
      [dv.dead.length, dv.detectors.length].join('/'), '0/1', 'declared paths are routed whatever the kind');
  const sf = await surveyRepo('jeffunglesbee-create/field-relay-nba', {},
                              fakeIo({ '.github/workflows/silently-dead-crons.yml': SKIPS }));
  one('survey: this watch, all skipped, is excluded as itself',
      [sf.dead.length, sf.selfRed.length].join('/'), '0/1', 'self-exclusion applies to every kind, not only failure');
  one('the ratchet judges every kind',
      allDead([{ dead: [{ outcome: 'skipped' }] }, { dead: [{ outcome: 'failure' }, { outcome: 'startup_failure' }] }]).length,
      3, 'derived from the surveys, not from the report loop');

  // ── UNREAD: a read that could not be made is neither dead, nor healthy, nor "no schedule" ──
  // The 2026-11-25 failure was one workflow of 509. Per-REPO containment would have thrown
  // away jubilant-bassoon's 93 good readings; per-WORKFLOW keeps 141 of 142. A repo is
  // wholly UNREAD only when its listing cannot be read.
  const settle = async (p) => { try { return { v: await p }; } catch (e) { return { e }; } };
  const whyNot = (r) => `threw ${r.e && r.e.message.slice(0, 30)}`;
  const WFS = {
    'epa.yml': SKIPS, 'ok.yml': ['success', 'skipped', 'skipped'], 'red.yml': ['failure', 'failure', 'failure'],
    'sf.yml': ['startup_failure', 'startup_failure', 'startup_failure'], 'mix.yml': ['failure', 'skipped', 'failure'],
    'short.yml': ['skipped', 'skipped'], 'none.yml': [],
  };
  const gone = (st, n) => new GhError(`GitHub ${st} on /x: e`, { path: '/x', status: st, attempts: n });
  const s1 = await settle(surveyRepo('o/r', {}, fakeIo(WFS, { 'none.yml': '0 1 * * *' }, { runs: { 'red.yml': gone(502, 4) } })));
  one('S1a one workflow\'s exhausted read is UNREAD', s1.e ? whyNot(s1) : s1.v.unread.map(u => u.path).join(','), 'red.yml',
      'the day is not lost to one read, and the read is named');
  one('S1b the other workflows are still judged', s1.e ? whyNot(s1) : `${s1.v.dead.map(d => d.path)}|${s1.v.healthy}|${s1.v.neverFired.length}`,
      'epa.yml,sf.yml,mix.yml|wf ok.yml,wf short.yml|1', 'identical to the survey above minus red.yml, which is neither dead nor healthy');
  one('S1c the unread entry carries what was tried', s1.e ? whyNot(s1) : `${s1.v.unread[0]?.status}|${s1.v.unread[0]?.attempts}|${s1.v.unreadRepo}`,
      '502|4|null', 'status and attempts reach the report; a workflow-level failure is not a repo-level one');
  const s2 = await settle(surveyRepo('o/r', {}, fakeIo({ 'none.yml': [] }, {}, { contents: { 'none.yml': gone(502, 4) } })));
  one('S2 an exhausted contents read is UNREAD, not "no schedule"',
      s2.e ? whyNot(s2) : [s2.v.unread.length, s2.v.noCron.length, s2.v.neverFired.length].join('/'), '1/0/0',
      'cronOf used to swallow every error and return null: ~408 reads a run filed as "no schedule, not judged"');
  // S2 above runs the survey against a fake that REPLACES cronOf, so it cannot see cronOf's own
  // behaviour; mutation G14 (the swallow put back) read NOT CAUGHT by S2 until these two.
  const c2 = await settle(cronOf('o/r', 'w.yml', async () => { throw gone(502, 4); }));
  one('S2b cronOf lets a failed contents read propagate', c2.e instanceof GhError ? `GhError ${c2.e.status}` : c2.e ? `threw ${c2.e.message}` : `returned ${JSON.stringify(c2.v)}`,
      'GhError 502', 'a failed read must reach the survey as an error, never as "no schedule"');
  const c3 = await settle(cronOf('o/r', 'w.yml', async () => ({ content: Buffer.from("on:\n  schedule:\n    - cron: '0 1 * * *'\n").toString('base64') })));
  one('S2c cronOf still reads a cron from a successful read', c3.e ? `threw ${c3.e.message}` : c3.v, '0 1 * * *', 'the control: removing the swallow must not break the read');
  const s3 = await settle(surveyRepo('o/r', {}, fakeIo(WFS, {}, { runs: { 'red.yml': new TypeError('a bug') } })));
  one('S3 a code error is not filed as UNREAD', s3.e instanceof TypeError, true, 'only a failed READ is containable; a bug must still stop the run');
  const okSurvey = (repo) => ({ repo, total: 3, active: 3, dead: [], healthy: ['a', 'b', 'c'], noCron: [], neverFired: [],
    detectors: [], selfRed: [], unread: [], unreadRepo: null });
  const a1 = await settle(surveyAll(['o/x', 'o/y'], {}, async (repo) => { if (repo === 'o/x') throw gone(502, 4); return okSurvey(repo); }));
  one('A1a one repo\'s listing failure leaves the other repo\'s reading',
      a1.e ? whyNot(a1) : a1.v.map(r => `${r.repo}:${r.unreadRepo ? 'UNREAD' : r.total}`).join(','), 'o/x:UNREAD,o/y:3',
      'a failure in the first repo must not discard the second');
  one('A1b the unread repo carries what was tried', a1.e ? whyNot(a1) : `${a1.v[0].unreadRepo.status}|${a1.v[0].unreadRepo.attempts}`, '502|4', 'reported, not swallowed');
  const a2 = await settle(surveyAll(['o/x'], {}, async () => { throw new TypeError('a bug'); }));
  one('A2 a code error still aborts the run', a2.e instanceof TypeError, true, 'containment is for failed reads only');
  const r1 = ratchetVerdict(['a'], { a: {}, b: {} }, ['b']);
  one('R1a an admitted key whose read failed is not "resolved"', r1.resolved.join(','), '',
      'it would print "fixed or gone; remove it" for something nobody read');
  one('R1b it is reported as unread, and is not new', `${r1.unread.join(',')}|${r1.unexpected.length}`, 'b|0', 'not judged today, not a finding');
  one('R1c an admitted key that was read and is gone still resolves', ratchetVerdict(['a'], { a: {}, b: {} }, []).resolved.join(','), 'b',
      'a fix is never punished, and unread must not swallow it either');
  const ukSurveys = [{ repo: 'o/r', unreadRepo: { why: 'x' }, unread: [] }, { repo: 'o/q', unreadRepo: null, unread: [{ path: 'x.yml' }] }];
  one('R2 a wholly unread repo covers its baseline keys, and only its own',
      unreadKeys(ukSurveys, ['o/r:a.yml', 'o/r2:a.yml', 'o/q:x.yml', 'o/q:y.yml']).join(','), 'o/r:a.yml,o/q:x.yml',
      'a namesake repo (o/r2) and an unaffected workflow (o/q:y.yml) are not covered');

  const E = { path: 'w.yml', since: 'S', latest: 'L', url: 'U' };
  one('failure text is unchanged', deadLines({ ...E, outcome: 'failure' }),
      '      w.yml\n        red since at least S, latest L\n        U', 'two months of committed logs still compare');
  one('skipped says SKIPPED', deadLines({ ...E, outcome: 'skipped' }).includes('SKIPPED'), true,
      'a probe that never ran must read differently from one that failed');
  one('startup_failure says so', deadLines({ ...E, outcome: 'startup_failure' }).includes('STARTUP_FAILURE'), true,
      'a refused workflow file is a different repair from a failing job');
  one('mixed lists what happened',
      deadLines({ ...E, outcome: 'mixed', conclusions: ['failure', 'skipped', 'failure'] }).includes('failure, skipped, failure'),
      true, 'a mixture has no single word, so the conclusions are the report');
  let refused = false;
  try { deadLines({ ...E, outcome: 'cancelled' }); } catch (e) { refused = true; }
  one('an unknown outcome is refused', refused, true, 'a typo must not print as an empty lead');

  // ── END TO END: THE WHOLE SCRIPT, as a child process, against a local fake of GitHub ──
  // Everything above runs pieces. The half COVERAGE used to admit it never reached is the
  // real fetch, the report loop, the log write and the EXIT CODE — which is exactly where
  // 2026-11-25 happened: the exit path discarded the day. So this spawns THIS file
  // (import.meta.url — never a hardcoded path, or every mutant is judged against the
  // unmutated source) with DEAD_CRON_API_BASE pointed at a server in this process.
  // The server answers only the REAL URL shapes; a drifted query reads as a 404.
  const FIXTURE = {
    'o/a': [
      { id: 1, name: 'healthy', path: '.github/workflows/healthy.yml', runs: ['success', 'success', 'failure'] },
      { id: 2, name: 'idle', path: '.github/workflows/idle.yml', runs: [], source: 'on:\n  push:\n' },
    ],
    'o/b': [
      { id: 1, name: 'rot', path: '.github/workflows/rot.yml', runs: ['failure', 'failure', 'failure'] },
      { id: 2, name: 'fine', path: '.github/workflows/fine.yml', runs: ['success', 'success', 'success'] },
    ],
  };
  const ADMITTED = 'o/b:.github/workflows/rot.yml'; // dead, and admitted in the fixture baseline
  // The request id a faulted response carries, derived from the URL key so the log line can be asserted.
  const reqId = (key) => `FAKE-${key.replace(/[^A-Za-z0-9]+/g, '-')}`;
  // faults: { 'runs:o/a:1': { times: 1 | Infinity, mode: 502 | 404 | 'reset' | 'cut' | 'hang' } }
  const fakeGitHub = (faults) => new Promise((resolve) => {
    const hits = {};
    const server = createServer((req, rsp) => {
      // STRICT: a request without the credential or the media type is refused and COUNTED, so a
      // dropped Authorization header turns the control red. The fake used to answer anything with
      // the right URL, and the header was a line no case could see.
      if (req.headers.authorization !== 'Bearer x' || req.headers.accept !== 'application/vnd.github+json') {
        hits['rejected: authorization or accept header missing or wrong'] = (hits['rejected: authorization or accept header missing or wrong'] || 0) + 1;
        rsp.statusCode = 401; return rsp.end('{"message":"Bad credentials"}');
      }
      const u = new URL(req.url, 'http://fake');
      const m = /^\/repos\/([^/]+\/[^/]+)\/(?:actions\/workflows(?:\/(\d+)\/runs)?|contents\/(.+))$/.exec(u.pathname);
      const wfs = m && FIXTURE[m[1]];
      const q = [...u.searchParams].map(([k, v]) => `${k}=${v}`).sort().join('&');
      let key = null, body = null;
      if (wfs && m[3] !== undefined) {
        const w = wfs.find(x => x.path === decodeURIComponent(m[3]));
        if (w) { key = `contents:${m[1]}:${w.path}`; body = { content: Buffer.from(w.source || '').toString('base64'), encoding: 'base64' }; }
      } else if (wfs && m[2] !== undefined) {
        const w = wfs.find(x => String(x.id) === m[2]);
        if (w && q === 'event=schedule&per_page=3&status=completed') {
          key = `runs:${m[1]}:${w.id}`;
          body = { workflow_runs: w.runs.map((c, i) => ({ conclusion: c, created_at: `2026-10-0${3 - i}T00:00:00Z`, html_url: `u/${w.id}/${i}` })) };
        }
      } else if (wfs && q === 'page=1&per_page=100') {
        key = `list:${m[1]}`;
        body = { total_count: wfs.length, workflows: wfs.map(w => ({ id: w.id, name: w.name, path: w.path, state: 'active', created_at: '2026-01-01T00:00:00Z' })) };
      }
      if (key === null) { hits[`unmatched ${req.url}`] = (hits[`unmatched ${req.url}`] || 0) + 1; rsp.statusCode = 404; return rsp.end('{"message":"Not Found"}'); }
      hits[key] = (hits[key] || 0) + 1;
      const f = faults[key];
      if (f && hits[key] <= f.times) {
        if (typeof f.mode === 'number') {
          rsp.statusCode = f.mode; rsp.setHeader('x-github-request-id', reqId(key));
          return rsp.end(f.mode >= 500 ? '{ "message": "Server Error" }' : '{"message":"Not Found"}');
        }
        if (f.mode === 'reset') return req.socket.destroy();
        if (f.mode === 'hang') return; // never answered
        if (f.mode === 'cut') {
          rsp.writeHead(200, { 'content-type': 'application/json', 'content-length': 4000 });
          rsp.write('{"workflow_runs": [{"concl');
          return setTimeout(() => req.socket.destroy(), 30);
        }
        if (f.mode === 'short') body = { ...body, total_count: 150 }; // claims 150, sends 2: answered below
      }
      rsp.setHeader('content-type', 'application/json');
      rsp.end(JSON.stringify(body));
    });
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, hits,
      close: () => { server.closeAllConnections(); server.close(); } }));
  });
  const runChild = async ({ faults = {}, env = {}, baseline = true } = {}) => {
    const fake = await fakeGitHub(faults);
    const dir = mkdtempSync(join(tmpdir(), 'dead-cron-e2e-'));
    mkdirSync(join(dir, 'docs')); mkdirSync(join(dir, 'outbox'));
    writeFileSync(join(dir, 'docs/declared-detectors.json'), JSON.stringify({ detectors: {} }));
    if (baseline) writeFileSync(join(dir, 'docs/dead-cron-baseline.json'), JSON.stringify({ entries: {
      [ADMITTED]: { kind: 'failure', red_since: '2026-01-01', first_seen: '2026-01-01', unblocked_by: 'fixture', review_by: '2099-01-01' } } }));
    // HERMETIC: nothing of this process's environment leaks in, so DEAD_CRON_* or a
    // proxy variable set around the self-test cannot change what the child does.
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], { cwd: dir, env: {
      PATH: process.env.PATH, GITHUB_TOKEN: 'x', DEAD_CRON_API_BASE: `http://127.0.0.1:${fake.port}`,
      DEAD_CRON_REPOS: 'o/a,o/b', DEAD_CRON_BACKOFF_MS: '1', ...env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const killer = setTimeout(() => child.kill('SIGKILL'), 20000);
    const [code, signal] = await new Promise((r) => child.on('close', (c, sg) => r([c, sg])));
    clearTimeout(killer);
    const names = readdirSync(join(dir, 'outbox')).filter(f => f.endsWith('.log'));
    const log = names.map(f => readFileSync(join(dir, 'outbox', f), 'utf8')).join('\n');
    rmSync(dir, { recursive: true, force: true });
    fake.close();
    return { code: signal ? `killed by ${signal}` : code, stdout, stderr, hits: fake.hits, log, logs: names.length };
  };
  const FOREVER = Infinity;
  const R = {};
  const SCEN = {
    control:  {},
    once:     { faults: { 'runs:o/a:1': { times: 1, mode: 502 } } },
    reset:    { faults: { 'runs:o/a:1': { times: 1, mode: 'reset' } } },
    cut:      { faults: { 'runs:o/a:1': { times: 1, mode: 'cut' } } },
    hang:     { faults: { 'runs:o/a:1': { times: 1, mode: 'hang' } }, env: { DEAD_CRON_TIMEOUT_MS: '300' } },
    forever:  { faults: { 'runs:o/a:1': { times: FOREVER, mode: 502 } } },
    listing:  { faults: { 'list:o/a': { times: FOREVER, mode: 502 } } },
    notfound: { faults: { 'runs:o/a:1': { times: FOREVER, mode: 404 } } },
    admitted: { faults: { 'runs:o/b:1': { times: FOREVER, mode: 502 } } },
    listingB: { faults: { 'list:o/b': { times: FOREVER, mode: 502 } } },
    nobaseline: { baseline: false },
    contents: { faults: { 'contents:o/a:.github/workflows/idle.yml': { times: FOREVER, mode: 502 } } },
    contents404: { faults: { 'contents:o/a:.github/workflows/idle.yml': { times: FOREVER, mode: 404 } } },
    nobudget: { faults: { 'runs:o/a:1': { times: FOREVER, mode: 502 } }, env: { DEAD_CRON_RETRY_BUDGET_MS: '0' } },
    short:    { faults: { 'list:o/a': { times: FOREVER, mode: 'short' } } },
    // the retry budget is per RUN: two reads that both fail, 100 ms backoff, 150 ms of budget in all
    budget2:  { faults: { 'runs:o/a:1': { times: FOREVER, mode: 502 }, 'runs:o/b:1': { times: FOREVER, mode: 502 } },
                env: { DEAD_CRON_BACKOFF_MS: '100', DEAD_CRON_RETRY_BUDGET_MS: '150' } },
    // a transport fault that never clears, on each kind of read (only 5xx and 404 were driven to UNREAD)
    contentsReset: { faults: { 'contents:o/a:.github/workflows/idle.yml': { times: FOREVER, mode: 'reset' } } },
    runsReset:     { faults: { 'runs:o/a:1': { times: FOREVER, mode: 'reset' } } },
  };
  await Promise.all(Object.entries(SCEN).map(async ([k, v]) => { R[k] = await runChild(v); }));
  const h = (r, k) => r.hits[k] || 0;
  const unmatched = (r) => Object.keys(r.hits).filter(k => k.startsWith('unmatched') || k.startsWith('rejected')).join(',') || 'none';

  one('E2E-0 control: a clean read exits 0 and leaves one log', `${R.control.code}|${R.control.logs}`, '0|1',
      'without this, an exit-1 case below could pass from a broken harness');
  one('E2E-0b control: the fake saw only real URL shapes, each with its Authorization and Accept headers', unmatched(R.control), 'none',
      'a drifted query would read as a 404 and show here; a dropped header is refused with a 401 and counted');
  one('E2E-0c control: every URL read exactly once', ['list:o/a', 'runs:o/a:1', 'runs:o/a:2', 'contents:o/a:.github/workflows/idle.yml', 'runs:o/b:1']
      .map(k => h(R.control, k)).join(','), '1,1,1,1,1', 'no retry when nothing failed');
  one('E2E-1 a 502 once then a 200: exit 0', R.once.code, 0,
      'THE 2026-11-25 DEFECT, END TO END: one transient 502 aborted the run with no log');
  one('E2E-1b that URL was requested exactly twice', h(R.once, 'runs:o/a:1'), 2, 'one repeat, not zero and not a storm');
  one('E2E-1c and the log exists', R.once.logs, 1, 'the day is not lost');
  one('E2E-10 a connection reset once then a 200: exit 0, two requests', `${R.reset.code}|${h(R.reset, 'runs:o/a:1')}`, '0|2',
      'the real fetch\'s transport error, not a scripted one');
  one('E2E-11 a body cut off mid-read once then a 200: exit 0, two requests', `${R.cut.code}|${h(R.cut, 'runs:o/a:1')}`, '0|2',
      'the real fetch\'s truncated body, read through res.json()');
  one('E2E-12 an attempt that never answers is aborted and retried: exit 0, two requests', `${R.hang.code}|${h(R.hang, 'runs:o/a:1')}`, '0|2',
      'the real per-attempt timeout (300 ms here, 20 s by default) against a real hung connection');

  const A = 'UNREAD workflows, not judged';
  const attemptsOf = (n) => `\\[${n} attempt\\(s\\)\\]`;
  const T = RETRIES + 1;
  one('E2E-2a 502 forever on one workflow: the run is RED', R.forever.code, 1, 'a watch that could not read must not report green');
  one('E2E-2b it was tried exactly 1+RETRIES times', h(R.forever, 'runs:o/a:1'), T, 'bounded, and not zero');
  one('E2E-2c the log exists on the red day', R.forever.logs, 1, 'the artifact that went missing on 2026-11-25');
  one('E2E-2d the log names the unread workflow with what was tried',
      new RegExp(`${A}\\s+: 1\\n\\s+\\.github/workflows/healthy\\.yml\\s+GitHub 502 on [^\\n]*${attemptsOf(T)}`).test(R.forever.log), true, 'named, with the count of attempts');
  one('E2E-2e every other reading is in the log',
      /── o\/a ──\n[^\n]*\n[^\n]*\n\s+no schedule: block, not judged\s+: 1/.test(R.forever.log) &&
      /── o\/b ──\n\s+2 workflow\(s\), 2 active  \(all pages read\)\n\s+scheduled and healthy\s+: 1/.test(R.forever.log), true,
      'o/a\'s other workflow and all of o/b survive the one failed read');
  one('E2E-2f stderr says FAIL and names it', /FAIL: 1 read\(s\) could not be made[\s\S]*healthy\.yml/.test(R.forever.stderr) && !/OK: across/.test(R.forever.stdout), true,
      'red by name, and no OK line');
  one('E2E-3a 502 forever on a repo\'s listing: the run is RED and the other repo is read',
      `${R.listing.code}|${h(R.listing, 'list:o/a')}|${h(R.listing, 'runs:o/a:1')}|${h(R.listing, 'runs:o/b:1')}`, `1|${T}|0|1`,
      'the listing is retried, o/a\'s workflows are not queried, o/b is');
  one('E2E-3b the log says so, and keeps o/b',
      /── o\/a ──\n\s+workflow listing UNREAD/.test(R.listing.log) && /UNREAD, WHOLE REPO NOT JUDGED\s+: GitHub 502/.test(R.listing.log) &&
      /── o\/b ──\n\s+2 workflow\(s\), 2 active  \(all pages read\)/.test(R.listing.log), true, 'the unread repo says so instead of printing 0 workflows');
  const unreadSection = R.listing.log.split('── o/b ──')[0];
  one('E2E-3c the unread repo\'s section claims no counts and no "(all pages read)"',
      R.listing.logs === 1 && unreadSection.includes('── o/a ──') && !unreadSection.includes('(all pages read)') && !/\d+ workflow\(s\), \d+ active/.test(unreadSection), true,
      'the claim would be false. A log must EXIST and hold the section for this to mean anything: an absence asserted of a missing log is a vacuous pass. The first version looked only at the line after the header and passed with the guard removed');
  one('E2E-4 a 404 is tried once, UNREAD, RED', `${R.notfound.code}|${h(R.notfound, 'runs:o/a:1')}|${
      new RegExp(`${A}\\s+: 1\\n\\s+\\.github/workflows/healthy\\.yml\\s+GitHub 404 on [^\\n]*${attemptsOf(1)}`).test(R.notfound.log)}`, '1|1|true',
      'GitHub\'s own answer is never retried, and it still is not read as healthy');
  one('E2E-5a an admitted key whose read failed is NOT "fixed or gone"',
      R.admitted.logs === 1 && !R.admitted.log.includes('fixed or gone; remove it') && !R.admitted.stdout.includes('BASELINE IS STALE'), true,
      'the one baselined workflow in production would have been reported "remove it" on any unread day; the log must EXIST, or the absence is vacuous');
  one('E2E-5b it is reported as unread, and the run is RED',
      `${R.admitted.code}|${/UNREAD today, admitted keys not judged\s+: 1\n\s+o\/b:\.github\/workflows\/rot\.yml/.test(R.admitted.log)}`, '1|true', 'named in the ratchet section');
  one('E2E-5c an admitted key under a repo whose LISTING failed is not "fixed or gone" either',
      `${R.listingB.code}|${R.listingB.logs}|${!R.listingB.log.includes('fixed or gone; remove it')}|${
        /UNREAD today, admitted keys not judged\s+: 1\n\s+o\/b:\.github\/workflows\/rot\.yml/.test(R.listingB.log)}`, '1|1|true|true',
      'the whole-repo path of the same rule: every baseline key under an unread repo is unread, not resolved');
  one('E2E-6a COVERAGE states the UNREAD count', new RegExp(`COVERAGE:[\\s\\S]*UNREAD \\(could not be read after retries, NOT judged; the run is RED for it\\): 1 workflow\\(s\\), 0 whole repo\\(s\\)`).test(R.forever.log),
      true, 'Rule 91: the denominator is in the output, not in the reader\'s head');
  one('E2E-6b the unread workflow is in the denominator and out of JUDGED',
      /COVERAGE: 2 repos, 4 workflows, 4 active, 2 JUDGED/.test(R.forever.log) && /COVERAGE: 2 repos, 4 workflows, 4 active, 3 JUDGED/.test(R.control.log), true,
      '3 judged on a clean read, 2 with one unread, 4 workflows either way');
  one('E2E-6c a clean read says 0 unread', /UNREAD \(could not be read after retries[^\n]*: 0 workflow\(s\), 0 whole repo\(s\)/.test(R.control.log), true, 'zero is printed, not omitted');
  one('E2E-6d a whole unread repo is counted', /UNREAD \(could not be read after retries[^\n]*: 0 workflow\(s\), 1 whole repo\(s\)/.test(R.listing.log), true, 'the listing failure shows in COVERAGE too');
  one('E2E-7 a code error still leaves a log', `${R.nobaseline.code}|${R.nobaseline.logs}|${R.nobaseline.log.includes('ABORTED')}|${R.nobaseline.log.includes('── o/b ──')}|${R.nobaseline.stderr.startsWith('FAIL:')}`,
      '1|1|true|true|true', 'the readings made before the abort are kept, and the log says it was aborted');
  one('E2E-8a an exhausted contents read is UNREAD, not "no schedule"',
      `${R.contents.code}|${h(R.contents, 'contents:o/a:.github/workflows/idle.yml')}|${
        new RegExp(`${A}\\s+: 1\\n\\s+\\.github/workflows/idle\\.yml`).test(R.contents.log)}|${
        /── o\/a ──[\s\S]*?no schedule: block, not judged\s+: 0/.test(R.contents.log)}`, `1|${T}|true|true`,
      'cronOf\'s swallow is gone');
  one('E2E-8b a 404 on a contents read is UNREAD too, tried once', `${R.contents404.code}|${h(R.contents404, 'contents:o/a:.github/workflows/idle.yml')}`, '1|1',
      'a workflow file deleted between the listing and the read is red once, by name, not silently "no schedule"');
  one('E2E-9 with the retry budget at 0 a 502 is tried once', `${R.nobudget.code}|${h(R.nobudget, 'runs:o/a:1')}`, '1|1', 'the budget is real, not decoration');
  one('E2E-13a a short listing is contained to its repo',
      `${R.short.code}|${/UNREAD, WHOLE REPO NOT JUDGED\s+: pagination short-read: collected 2 of 150/.test(R.short.log)}|${/── o\/b ──\n\s+2 workflow\(s\), 2 active/.test(R.short.log)}`,
      '1|true|true', 'ghAll\'s own short-read throw used to abort every repo after it');
  one('E2E-13b a short read is one response, not retried', h(R.short, 'list:o/a'), 1, 'the repeat would re-ask the same question of the same source');
  one('E2E-14 the retry budget is per RUN: the second failing read gets only what the first left',
      `${h(R.budget2, 'runs:o/a:1')}|${h(R.budget2, 'runs:o/b:1')}`, '2|1',
      '150 ms of budget, 100 ms then 200 ms of backoff: the first read spends 100 and is refused the 200, the second is refused its first 100. A per-call budget gives 2|2');
  one('E2E-15a a contents read that resets forever is UNREAD, not "no schedule"',
      `${R.contentsReset.code}|${h(R.contentsReset, 'contents:o/a:.github/workflows/idle.yml')}|${
        new RegExp(`${A}\\s+: 1\\n\\s+\\.github/workflows/idle\\.yml\\s+GitHub transport error`).test(R.contentsReset.log)}|${
        /── o\/a ──[\s\S]*?no schedule: block, not judged\s+: 0/.test(R.contentsReset.log)}`, `1|${T}|true|true`,
      'the transport kind, driven through the UNREAD path of the contents read: only 5xx and 404 had been');
  one('E2E-16a a runs read that resets forever is UNREAD, not healthy',
      `${R.runsReset.code}|${h(R.runsReset, 'runs:o/a:1')}|${
        new RegExp(`${A}\\s+: 1\\n\\s+\\.github/workflows/healthy\\.yml\\s+GitHub transport error`).test(R.runsReset.log)}|${
        /── o\/a ──\n[^\n]*\n\s+scheduled and healthy\s+: 0/.test(R.runsReset.log)}`, `1|${T}|true|true`,
      'the transport kind, driven through the UNREAD path of the runs read');
  one('E2E-17 the GitHub request id reaches the log line, for a workflow and for a whole repo',
      `${R.forever.log.includes('(x-github-request-id FAKE-runs-o-a-1)')}|${R.listing.log.includes('(x-github-request-id FAKE-list-o-a)')}`, 'true|true',
      'a 5xx can be reported to GitHub only if the id was kept: the unit case T14 cannot see the report line');

  console.log(bad ? `\n${bad} of ${ran} FAILED` : `\nself-test: ${ran}/${ran}`);
  console.log(`COVERAGE: ${ran} cases, in ${Object.keys(SCEN).length} END TO END scenarios and the rest pure: each scenario runs the whole script, as a child process,`);
  console.log(`  against a local fake of the GitHub REST API (${Object.keys(FIXTURE).length} repos, ${Object.values(FIXTURE).flat().length} workflows) that answers only the real URL shapes`);
  console.log(`  and refuses a request without its Authorization and Accept headers — the real fetch, retry, report loop,`);
  console.log(`  log write and exit code. The rest run the pure predicates`);
  console.log(`  (page loop, short read, grace, repo list, detector keys, cron extraction, the ratchet, the dead-window`);
  console.log(`  definition, the transport against a scripted fetch, the survey and UNREAD against a fake of the API).`);
  console.log(`  NOT reached: the real GitHub API; the default base URL, because DEAD_CRON_API_BASE is set in every scenario`);
  console.log(`  here, so the real fetch is never pointed at it; and the User-Agent header, which undici replaces when it is`);
  console.log(`  absent, so its absence cannot be seen. A live 502 cannot be forced and the sandbox token is a proxy`);
  console.log(`  placeholder, so the local fake is the proof artifact for the failure path. The live half is verified by`);
  console.log(`  dispatching the workflow and reading its committed outbox log.`);
  process.exit(bad ? 1 : 0);
}
const say = (s) => { console.log(s); log.push(s); };
/** An error body can span lines; the log is line-oriented. */
const oneLine = (t) => String(t).replace(/\s+/g, ' ');
/** GitHub's request id, when it sent one, so a 5xx can be reported to GitHub. */
const requestIdOf = (u) => (u.requestId ? `  (x-github-request-id ${u.requestId})` : '');

/** The one place this script talks to GitHub. Everything it needs is a parameter so
 *  --self-test can drive it with a scripted fetch and a recorded sleep. */
export async function ghRequest(path, { token, fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    retries = RETRIES, backoff = BACKOFF_MS, timeoutMs = ATTEMPT_TIMEOUT_MS, budget = RUN_BUDGET } = {}) {
  let attempt = 0;
  for (;;) {
    attempt++;
    let failure, retry;
    try {
      const res = await fetchFn(`${API}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
                   'User-Agent': 'field-relay-dead-cron-watch' }, signal: AbortSignal.timeout(timeoutMs) });
      // AWAITED INSIDE THE TRY: a body cut off mid-read rejects here, and that is a
      // transport fault to retry, not an exception to let escape the loop.
      if (res.ok) return await res.json();
      retry = retryableStatus(res.status);
      failure = new GhError(`GitHub ${res.status} on ${path}: ${await bodyText(res)}`,
        { path, status: res.status, requestId: res.headers.get('x-github-request-id') });
    } catch (e) {
      failure = new GhError(`GitHub transport error on ${path}: ${e.message}`, { path, kind: 'transport' });
      retry = true;
    }
    failure.attempts = attempt;
    if (!retry || attempt > retries) throw failure;
    const wait = backoff(attempt - 1);
    if (budget.left < wait) throw failure;
    budget.left -= wait;
    await sleep(wait);
  }
}

/** The error body is for the message only. The verdict was already taken from the status. */
async function bodyText(res) {
  try { return (await res.text()).slice(0, 200); }
  catch (e) { return `(response body unreadable: ${e.message})`; }
}

async function gh(path) {
  if (!TOKEN) throw new Error('GITHUB_TOKEN is not set');
  return ghRequest(path, { token: TOKEN });
}

/** Every page, and it PROVES it got every page rather than trusting the loop:
 *  the API reports total_count, so a collected length below it is a truncation
 *  and throws. A silent short read is what this function exists to end. */
async function ghAll(path, key, perPage = 100) {
  const out = [];
  let total = null;
  for (let page = 1; page <= 50; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const body = await gh(`${path}${sep}per_page=${perPage}&page=${page}`);
    if (total === null) total = body.total_count ?? null;
    const batch = body[key] || [];
    out.push(...batch);
    if (!wantsAnotherPage(batch.length, perPage)) break;
  }
  const short = shortRead(out.length, total);
  if (short) throw new GhError(`${short} on ${path}`, { path, kind: 'short-read' });
  return out;
}

/** One repo's verdict. Pure of the OUTPUT side so the caller shapes reporting;
 *  the network lives here and nowhere else. */
async function surveyRepo(repo, declared, io = { gh, ghAll, cronOf }) {
  // The network is a parameter so the classification below can run against a fake
  // in --self-test. It was the half of this watch that no test reached, and it is
  // where `every(r => r.conclusion === 'failure')` hid a 66-run streak of skips.
  const { gh, ghAll, cronOf } = io;
  // PAGINATED, AND IT WAS NOT. Until 2026-09-17 this was a single
  // `?per_page=100` against a repo holding 150 workflows: the watch built
  // specifically to escape per-workflow blindness read two thirds of the repo
  // and printed `100 workflow(s)` as though that were the total.
  const workflows = await ghAll(`/repos/${repo}/actions/workflows`, 'workflows');
  const active = workflows.filter(w => w.state === 'active');

  const dead = [], healthy = [], noCron = [], neverFired = [], detectors = [], selfRed = [], unread = [];
  for (const w of active) {
    // A READ THAT COULD NOT BE MADE IS NEITHER DEAD, NOR HEALTHY, NOR "NO SCHEDULE". It is
    // UNREAD, at the grain of the read that failed: one workflow here, a whole repo only when
    // its listing fails (surveyAll). Only GhError is contained; any other throw is a bug and
    // still stops the run.
    try {
      const { workflow_runs = [] } = await gh(
        `/repos/${repo}/actions/workflows/${w.id}/runs?event=schedule&per_page=${STREAK}&status=completed`);
      // ZERO SCHEDULED RUNS IS TWO DIFFERENT ANSWERS AND THEY WERE ONE BUCKET.
      // A workflow with no `schedule:` block has nothing to judge — correct.
      // A workflow that DECLARES a cron and has never produced a run is the
      // deadest a cron can be, and it was being filed under "not judged" with
      // only a count printed beside it. Absence read as not-applicable (Rule 99).
      if (!workflow_runs.length) {
        const cron = await cronOf(repo, w.path);
        (cron ? neverFired : noCron).push({ ...w, cron });
        continue;
      }
      const conclusions = workflow_runs.map(r => r.conclusion);
      const outcome = streakKind(conclusions);
      if (outcome !== null) {
        const entry = { repo, name: w.name, path: w.path, outcome, conclusions,
                        since: workflow_runs[workflow_runs.length - 1].created_at,
                        latest: workflow_runs[0].created_at, url: workflow_runs[0].html_url };
        // KEYS ARE REPO-QUALIFIED. A bare `.github/workflows/deploy.yml` exists in
        // all four repos, so an unqualified declaration would excuse a genuinely
        // dead cron in one repo because a different repo declared its namesake.
        const key = declaredKey(repo, w.path);
        if (isSelf(repo, w.path)) selfRed.push(entry);
        else if (declared[key]) detectors.push({ ...entry, ...declared[key] });
        else dead.push(entry);
      }
      else healthy.push(w.name);
    } catch (e) {
      if (!(e instanceof GhError)) throw e;
      unread.push({ repo, name: w.name, path: w.path, status: e.status, attempts: e.attempts, requestId: e.requestId, why: e.message });
    }
  }
  return { repo, total: workflows.length, active: active.length, dead, healthy, noCron, neverFired, detectors, selfRed, unread, unreadRepo: null };
}

/** Every repo, and a repo whose LISTING cannot be read is UNREAD, not fatal: the repos
 *  after it are still read. Before this, one throw here discarded every repo already
 *  surveyed and every repo not yet reached. */
export async function surveyAll(repos, declared, survey = surveyRepo) {
  const out = [];
  for (const repo of repos) {
    try { out.push(await survey(repo, declared)); }
    catch (e) {
      if (!(e instanceof GhError)) throw e;
      out.push({ repo, total: 0, active: 0, dead: [], healthy: [], noCron: [], neverFired: [], detectors: [], selfRed: [],
                 unread: [], unreadRepo: { status: e.status, attempts: e.attempts, requestId: e.requestId, why: e.message } });
    }
  }
  return out;
}

(async () => {
  say(`=== silently dead crons  repos=${REPOS.length}  streak=${STREAK}  utc=${new Date().toISOString()} ===`);
  say(`    ${REPOS.join('\n    ')}`);

  // A DETECTOR'S RED IS ITS OUTPUT. brief-label-migration.yml and
  // rule90-staleness-monitor.yml both exit non-zero while the condition they
  // report holds — verified by reading their exit paths, not inferred from the
  // fact that they are red. Listing them as dead every day would make this
  // watch the noise it exists to prevent.
  const declared = JSON.parse(readFileSync('docs/declared-detectors.json', 'utf8')).detectors || {};

  const surveys = await surveyAll(REPOS, declared);

  const dead = allDead(surveys), neverFired = [];
  for (const r of surveys) {
    say(`\n  ── ${r.repo} ──`);
    // A repo whose listing could not be read has NO counts, which is not the same as zero:
    // printing "0 workflow(s)" would be absence read as a fact (Rule 99).
    if (r.unreadRepo) {
      say(`    workflow listing UNREAD: this repo's counts are unknown, not zero`);
      say(`    UNREAD, WHOLE REPO NOT JUDGED     : ${oneLine(r.unreadRepo.why)}  [${r.unreadRepo.attempts} attempt(s)]${requestIdOf(r.unreadRepo)}`);
      continue;
    }
    say(`    ${r.total} workflow(s), ${r.active} active  (all pages read)`);
    say(`    scheduled and healthy             : ${r.healthy.length}`);
    say(`    no schedule: block, not judged     : ${r.noCron.length}`);
    say(`    declared detectors, red on purpose : ${r.detectors.length}   (not failures)`);
    say(`    UNREAD workflows, not judged      : ${r.unread.length}`);
    for (const u of r.unread) say(`      ${u.path}  ${oneLine(u.why)}  [${u.attempts} attempt(s)]${requestIdOf(u)}`);
    // PRINTED, NOT SILENTLY DROPPED. A guard that removes a finding without
    // saying so is the amnesty shape this repo watches for, and the reader has
    // to be able to see that the exclusion fired at all.
    for (const e of r.selfRed) {
      const days = ((Date.now() - Date.parse(e.since)) / 86400000).toFixed(1);
      say(`    THIS WATCH ITSELF, excluded          : red ${days} days, since ${e.since}`);
      say(`      ${e.path} — it exits 1 on any finding, so three findings make it`);
      say(`      its own finding. Excluded from judgement; see SELF in this script.`);
    }
    for (const d of r.detectors) {
      const days = ((Date.now() - Date.parse(d.since)) / 86400000).toFixed(1);
      say(`      ${d.path}  red at least ${days} days`);
      say(`        reports: ${d.reports}`);
      say(`        now:     ${d.red_because}`);
      say(`        tracked: ${d.tracked_by}`);
    }
    say(`    DECLARES A CRON, NEVER FIRED       : ${r.neverFired.length}`);
    for (const w of r.neverFired) {
      const age = ((Date.now() - Date.parse(w.created_at)) / 86400000).toFixed(1);
      say(`      ${w.path}   cron ${w.cron || '?'}   added ${String(w.created_at).slice(0, 10)} (${age}d ago)`);
      neverFired.push({ ...w, repo: r.repo });
    }
    const plain = r.dead.filter(d => d.outcome === 'failure');
    const other = r.dead.filter(d => d.outcome !== 'failure');
    say(`    FAILING ${STREAK} CONSECUTIVE RUNS  : ${plain.length}`);
    for (const d of plain) say(deadLines(d));
    say(`    NO RUN WORKED, NOT PLAIN FAILURE   : ${other.length}   (skipped, startup_failure or mixed)`);
    for (const d of other) say(deadLines(d));
  }

  if (neverFired.length) {
    say(`\n    A never-fired cron is NOT automatically a fault: a monthly cron added`);
    say(`    after its day-of-month, or a workflow added today, has legitimately not`);
    say(`    reached a slot. The cron and the age are printed so that is decidable`);
    say(`    here rather than inferred from a count. NEVER_FIRED_GRACE_DAYS=${GRACE}.`);
  }

  // COVERAGE STATES THE DENOMINATOR, NOT THE NUMERATOR. The old line named what
  // was fetched and said nothing about what was not — first the 50 workflows
  // past an unpaginated cap, then the three repos outside the one it ran in.
  const judged = surveys.reduce((n, r) => n + r.healthy.length + r.dead.length + r.detectors.length, 0);
  const tot    = surveys.reduce((n, r) => n + r.total, 0);
  const act    = surveys.reduce((n, r) => n + r.active, 0);
  const nocron = surveys.reduce((n, r) => n + r.noCron.length, 0);
  say(`\n    COVERAGE: ${REPOS.length} repos, ${tot} workflows, ${act} active, ${judged} JUDGED`);
  say(`    (>= ${STREAK} completed scheduled runs each). NOT judged: ${nocron} with no`);
  say(`    schedule: block — their failures surface on the commit that caused them —`);
  say(`    and ${neverFired.length} that declare a cron but have never produced a run,`);
  say(`    named above rather than counted. A workflow is judged on its last ${STREAK}`);
  say(`    scheduled runs whenever they happened, so a firing delay cannot skew it.`);
  say(`    DEAD means none of those ${STREAK} runs worked: each failed, was skipped, or never`);
  say(`    started (startup_failure). A window holding anything else — a success, or`);
  say(`    cancelled, timed_out, action_required, neutral — is counted healthy above.`);
  say(`    NOT covered: any repo outside the ${REPOS.length} listed at the top.`);
  // A read that could not be made is a third kind of NOT judged, and it is a denominator
  // the reader needs beside the JUDGED figure: a number printed without it claims the whole.
  const unreadN = surveys.reduce((n, r) => n + r.unread.length, 0);
  const unreadRepos = surveys.filter(r => r.unreadRepo).length;
  say(`    UNREAD (could not be read after retries, NOT judged; the run is RED for it): ${unreadN} workflow(s), ${unreadRepos} whole repo(s)`);


  // Written BEFORE any exit, so the day the watch fails is not the day its
  // artifact is missing — the ordering defect the pairing watch shipped (M28).
  const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).entries || {};
  const overdue  = overdueNeverFired(neverFired, GRACE);

  // ONE KEY SPACE for both kinds. A dead cron and a never-fired cron are both
  // "this is rotting and nobody has fixed it"; splitting them into two ratchets
  // would be two implementations of one question.
  const foundKeys = [
    ...dead.map(d => declaredKey(d.repo, d.path)),
    ...overdue.map(w => declaredKey(w.repo, w.path)),
  ];
  const r = ratchetVerdict(foundKeys, baseline, unreadKeys(surveys, Object.keys(baseline)));
  const stale = overdueReviews(r.carried, baseline);

  say(`\n  ── ratchet (${BASELINE_FILE}) ──`);
  say(`    carried, already admitted : ${r.carried.length}`);
  for (const k of r.carried) {
    const e = baseline[k] || {};
    const days = e.first_seen ? ((Date.now() - Date.parse(e.first_seen)) / 86400000).toFixed(0) : '?';
    say(`      ${k}`);
    say(`        kind ${e.kind || '?'}  red since ${e.red_since || '?'}  admitted ${days}d ago  review by ${e.review_by || 'NEVER — overdue by construction'}`);
    say(`        unblocked by: ${e.unblocked_by || '(not stated)'}`);
  }
  say(`    NEW, not in the baseline  : ${r.unexpected.length}`);
  for (const k of r.unexpected) say(`      ${k}`);
  say(`    UNREAD today, admitted keys not judged : ${r.unread.length}`);
  for (const k of r.unread) say(`      ${k}`);
  say(`    baseline entries resolved : ${r.resolved.length}`);
  for (const k of r.resolved) say(`      ${k}   <- fixed or gone; remove it from ${BASELINE_FILE}`);
  say(`    reviews overdue           : ${stale.length}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(`outbox/silently-dead-crons-${stamp}.log`, log.join('\n') + '\n');

  let failed = false;
  if (r.unexpected.length) {
    failed = true;
    console.error(`\nFAIL: ${r.unexpected.length} workflow(s) are rotting and are NOT in ${BASELINE_FILE}.`);
    for (const k of r.unexpected) console.error(`      ${k}`);
    console.error(`      This is NEW decay. Fix it, or admit it in the baseline with a`);
    console.error(`      red_since, an unblocked_by and a review_by — an entry is an`);
    console.error(`      admission with a date on it, not a way to make this quiet.`);
  }
  if (stale.length) {
    failed = true;
    console.error(`\nFAIL: ${stale.length} baseline entr(ies) are past their own review_by.`);
    for (const k of stale) console.error(`      ${k}  review_by ${baseline[k]?.review_by || '(absent — absent is overdue)'}`);
    console.error(`      Deferring again is allowed. Doing it silently is not: move the`);
    console.error(`      date and write why, in the same commit.`);
  }

  // A WATCH THAT COULD NOT READ DOES NOT REPORT GREEN. The log above already holds every
  // reading that WAS made; this only decides the colour. Before 2026-11-26 one failed read
  // meant no log at all, because the throw came before the write.
  const unreadAll = unreadItems(surveys);
  if (unreadAll.length) {
    failed = true;
    console.error(`\nFAIL: ${unreadAll.length} read(s) could not be made after retries, so this run's reading is INCOMPLETE.`);
    for (const k of unreadAll) console.error(`      ${k}`);
    console.error(`      A watch that could not read does not report green. Every other reading is in the log.`);
  }

  // RESOLVED NEVER FAILS. A watch that goes red when you fix something teaches
  // people to stop fixing things — which is the behaviour this whole ratchet
  // exists to avoid.
  if (r.resolved.length) {
    console.log(`\nBASELINE IS STALE: ${r.resolved.length} entr(ies) are no longer rotting.`);
    for (const k of r.resolved) console.log(`      ${k}`);
    console.log(`      Remove them from ${BASELINE_FILE}. Not a failure — this is the`);
    console.log(`      direction the ratchet is supposed to turn.`);
  }

  if (failed) process.exit(1);
  console.log(`\nOK: across ${REPOS.length} repos, no NEW decay. ${r.carried.length} known entr(ies) carried,`);
  console.log(`each inside its own review_by. Green here means nothing got worse — it does`);
  console.log(`NOT mean nothing is broken; ${r.carried.length} thing(s) still are, named above.`);
})().catch(e => { console.error('FAIL:', e.message); writeAbortLog(e); process.exit(1); });

/** An unexpected throw (a missing baseline, a parse error, a bug) used to leave NO log, which is
 *  the artifact the 2026-11-25 run lacked. It leaves what was said so far, marked ABORTED. */
function writeAbortLog(e) {
  try {
    log.push(`\nABORTED, the run did not finish: ${e.message}`);
    writeFileSync(`outbox/silently-dead-crons-${new Date().toISOString().replace(/[:.]/g, '-')}.log`, log.join('\n') + '\n');
  } catch (w) { console.error('could not write the abort log:', w.message); }
}
