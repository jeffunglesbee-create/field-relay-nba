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
import { writeFileSync, readFileSync } from 'node:fs';

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
 *  Returns { unexpected, carried, resolved }:
 *    unexpected  found dead, not in the baseline          -> FAIL, this is new rot
 *    carried     found dead, admitted in the baseline     -> reported with its age
 *    resolved    in the baseline, no longer found dead    -> "stale, remove it", NOT a failure
 *
 *  resolved must never fail the run. A watch that goes red when you fix
 *  something teaches people to stop fixing things. */
export function ratchetVerdict(foundKeys, baselineEntries) {
  const found = new Set(foundKeys);
  const base  = new Set(Object.keys(baselineEntries || {}));
  return {
    unexpected: [...found].filter(k => !base.has(k)).sort(),
    carried:    [...found].filter(k =>  base.has(k)).sort(),
    resolved:   [...base ].filter(k => !found.has(k)).sort(),
  };
}

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

async function cronOf(repo, path) {
  try {
    const body = await gh(`/repos/${repo}/contents/${path}`);
    if (!body || !body.content) return null;
    return cronFromSource(Buffer.from(body.content, 'base64').toString('utf8'));
  } catch (_) { return null; }
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
  // nfl-epa-route-probe.yml: 66 of 66 scheduled runs `skipped`, green on the
  // Actions page and absent from this watch. patent-watch.yml: 21 of 21
  // `startup_failure`. Both measured on 2026-11-02, both invisible to a test that
  // read `every(r => r.conclusion === 'failure')`.
  one('the window is the default the cases below assume', STREAK, 3, 'DEAD_CRON_STREAK is not set in CI');
  const kind = (...cs) => String(streakKind(cs, 3));
  one('three failures', kind('failure', 'failure', 'failure'), 'failure', 'the original definition, unchanged');
  one('three skipped', kind('skipped', 'skipped', 'skipped'), 'skipped',
      'nfl-epa-route-probe.yml: 66 of 66, green on the Actions page');
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

  // The survey, against a fake of the API. The fake answers the REAL query or
  // nothing: a URL that has drifted (no `status=completed`, another per_page or
  // event) reads as "no runs", so it fails the cases below instead of passing.
  const fakeIo = (byPath, crons = {}) => {
    const wfs = Object.keys(byPath).map((p, i) => ({
      id: i + 1, name: `wf ${p}`, path: p, state: 'active', created_at: '2026-01-01T00:00:00Z' }));
    const want = ['event=schedule', 'per_page=3', 'status=completed'].join('&');
    return {
      ghAll: async () => wfs,
      gh: async (path) => {
        const m = /\/workflows\/(\d+)\/runs\?(.*)$/.exec(path);
        const cs = m && m[2].split('&').sort().join('&') === want ? byPath[wfs[Number(m[1]) - 1].path] : [];
        return { workflow_runs: cs.map((c, i) => ({
          conclusion: c, created_at: `2026-10-0${3 - i}T00:00:00Z`, html_url: `u/${m[1]}/${i}` })) };
      },
      cronOf: async (_repo, p) => (p in crons ? crons[p] : null),
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

  console.log(bad ? `\n${bad} of ${ran} FAILED` : `\nself-test: ${ran}/${ran}`);
  console.log(`COVERAGE: the pure predicates — page loop, short read, grace, repo list,\n  detector keys, cron extraction, the ratchet, the dead-window definition and the per-repo`);
  console.log(`survey (run against a fake of the API that answers only the real query). It does NOT`);
  console.log(`reach the real API — the sandbox token here is a proxy placeholder — so the live half`);
  console.log(`is verified by dispatching the workflow and reading its committed outbox log.`);
  process.exit(bad ? 1 : 0);
}
const say = (s) => { console.log(s); log.push(s); };

async function gh(path) {
  if (!TOKEN) throw new Error('GITHUB_TOKEN is not set');
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json',
               'User-Agent': 'field-relay-dead-cron-watch' },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
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
  if (short) throw new Error(`${short} on ${path}`);
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

  const dead = [], healthy = [], noCron = [], neverFired = [], detectors = [], selfRed = [];
  for (const w of active) {
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
  }
  return { repo, total: workflows.length, active: active.length, dead, healthy, noCron, neverFired, detectors, selfRed };
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

  const surveys = [];
  for (const repo of REPOS) surveys.push(await surveyRepo(repo, declared));

  const dead = allDead(surveys), neverFired = [];
  for (const r of surveys) {
    say(`\n  ── ${r.repo} ──`);
    say(`    ${r.total} workflow(s), ${r.active} active  (all pages read)`);
    say(`    scheduled and healthy             : ${r.healthy.length}`);
    say(`    no schedule: block, not judged     : ${r.noCron.length}`);
    say(`    declared detectors, red on purpose : ${r.detectors.length}   (not failures)`);
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
  const r = ratchetVerdict(foundKeys, baseline);
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
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
