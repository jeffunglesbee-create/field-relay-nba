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
const REPO = process.env.GITHUB_REPOSITORY || 'jeffunglesbee-create/field-relay-nba';
// How many consecutive failures make a workflow "dead" rather than flaky.
const STREAK = Number(process.env.DEAD_CRON_STREAK || 3);
// A workflow added moments ago has not failed to fire. Beyond this, a declared
// cron with no run is a finding. 40 days clears the longest schedule in this
// repo (monthly, `23 8 4 * *`) plus a full cycle.
export const GRACE = Number(process.env.NEVER_FIRED_GRACE_DAYS || 40);
const log = [];

// Read from the workflow FILE, not from the API: the API does not report
// whether a workflow declares a schedule, only whether runs exist — and runs
// existing is the thing being questioned.
function cronOf(path) {
  try { return (readFileSync(path, 'utf8').match(/cron:\s*'([^']+)'/) || [])[1] || null; }
  catch (_) { return null; }
}
const declaresCron = (path) => cronOf(path) !== null;

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

if (process.argv.includes('--self-test')) {
  let bad = 0;
  const one = (label, got, want, why) => got === want
    ? console.log(`  PASS  ${label} -> ${JSON.stringify(got)}  (${why})`)
    : (bad++, console.log(`  FAIL  ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`));
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

  console.log(bad ? `\n${bad} FAILED` : `\nself-test: 11/11`);
  console.log(`COVERAGE: three pure predicates. It does NOT reach the GitHub API — the`);
  console.log(`sandbox token here is a proxy placeholder, so the live half is verified by`);
  console.log(`dispatching the workflow and reading its committed outbox log.`);
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

(async () => {
  say(`=== silently dead crons  repo=${REPO}  streak=${STREAK}  utc=${new Date().toISOString()} ===`);

  // PAGINATED, AND IT WAS NOT. Until 2026-09-17 this was a single
  // `?per_page=100` against a repo holding 150 workflows: the watch built
  // specifically to escape per-workflow blindness read two thirds of the repo
  // and printed `100 workflow(s)` as though that were the total. All four
  // never-fired crons happened to sit in the unread 50. Nothing dead was
  // hiding there that day, which was luck rather than design.
  const workflows = await ghAll(`/repos/${REPO}/actions/workflows`, 'workflows');
  const active = workflows.filter(w => w.state === 'active');
  say(`\n    ${workflows.length} workflow(s), ${active.length} active  (all pages read)`);

  // A DETECTOR'S RED IS ITS OUTPUT. brief-label-migration.yml and
  // rule90-staleness-monitor.yml both exit non-zero while the condition they
  // report holds — verified by reading their exit paths, not inferred from the
  // fact that they are red. Listing them as dead every day would make this
  // watch the noise it exists to prevent.
  const declared = JSON.parse(readFileSync('docs/declared-detectors.json', 'utf8')).detectors || {};

  const dead = [], healthy = [], noCron = [], neverFired = [], detectors = [];
  for (const w of active) {
    const { workflow_runs = [] } = await gh(
      `/repos/${REPO}/actions/workflows/${w.id}/runs?event=schedule&per_page=${STREAK}&status=completed`);
    // ZERO SCHEDULED RUNS IS TWO DIFFERENT ANSWERS AND THEY WERE ONE BUCKET.
    // A workflow with no `schedule:` block has nothing to judge — correct.
    // A workflow that DECLARES a cron and has never produced a run is the
    // deadest a cron can be, and it was being filed under "not judged" with
    // only a count printed beside it. Absence read as not-applicable (Rule 99),
    // in the watch built to catch a cron nobody could see.
    if (!workflow_runs.length) {
      (declaresCron(w.path) ? neverFired : noCron).push(w);
      continue;
    }
    const streak = workflow_runs.every(r => r.conclusion === 'failure');
    if (streak && workflow_runs.length >= STREAK) {
      const entry = { name: w.name, path: w.path, since: workflow_runs[workflow_runs.length - 1].created_at,
                      latest: workflow_runs[0].created_at, url: workflow_runs[0].html_url };
      if (declared[w.path]) detectors.push({ ...entry, ...declared[w.path] });
      else dead.push(entry);
    }
    else healthy.push(w.name);
  }

  say(`\n    declared detectors, red on purpose: ${detectors.length}   (not failures)`);
  for (const d of detectors) {
    const days = ((Date.now() - Date.parse(d.since)) / 86400000).toFixed(1);
    say(`      ${d.path}  red at least ${days} days`);
    say(`        reports: ${d.reports}`);
    say(`        now:     ${d.red_because}`);
    say(`        tracked: ${d.tracked_by}`);
  }
  say(`\n    scheduled and healthy             : ${healthy.length}`);
  say(`    no schedule: block, not judged     : ${noCron.length}`);
  say(`    DECLARES A CRON, NEVER FIRED       : ${neverFired.length}`);
  for (const w of neverFired) {
    const age = ((Date.now() - Date.parse(w.created_at)) / 86400000).toFixed(1);
    say(`      ${w.path}   cron ${cronOf(w.path) || '?'}   added ${String(w.created_at).slice(0, 10)} (${age}d ago)`);
  }
  if (neverFired.length) {
    say(`      NOT automatically a fault: a monthly cron added after its day-of-month,`);
    say(`      or a workflow added today, has legitimately not reached a slot. The`);
    say(`      cron and the age are printed so that is decidable here rather than`);
    say(`      inferred from a count. NEVER_FIRED_GRACE_DAYS=${GRACE} bounds it.`);
  }
  say(`    FAILING ${STREAK} CONSECUTIVE RUNS  : ${dead.length}`);
  for (const d of dead)
    say(`      ${d.path}\n        red since at least ${d.since}, latest ${d.latest}\n        ${d.url}`);

  // COVERAGE STATES THE DENOMINATOR, NOT THE NUMERATOR. Rule 91 asks a probe to
  // say what it checked; this file's old line did, truthfully, and was still
  // read as a claim about the repo — because `100 workflow(s)` names what was
  // fetched and says nothing about the 50 that were not. Three watches were
  // examined on 2026-09-16 and all three had correct logic on the wrong
  // population; all three printed a coverage line true of the code and wrong
  // about what a reader would infer. What was missing every time is what was
  // LEFT OUT.
  const judged = healthy.length + dead.length + detectors.length;
  say(`\n    COVERAGE: ${workflows.length} workflows on the repo, ${active.length} active,`);
  say(`    ${judged} JUDGED (they have >= ${STREAK} completed scheduled runs).`);
  say(`    NOT judged: ${noCron.length} with no schedule: block — their failures surface`);
  say(`    on the commit that caused them — and ${neverFired.length} that declare a cron but`);
  say(`    have never produced a run, reported above by name rather than as a count.`);
  say(`    A workflow is judged on its last ${STREAK} scheduled runs whenever they happened;`);
  say(`    there is no time window here, so a firing delay cannot skew it.`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(`outbox/silently-dead-crons-${stamp}.log`, log.join('\n') + '\n');

  // Written BEFORE either exit, so the day the watch fails is not the day its
  // artifact is missing — the same ordering defect the pairing watch shipped
  // and had to have restructured (M28).
  let failed = false;
  if (dead.length) {
    failed = true;
    console.error(`\nFAIL: ${dead.length} scheduled workflow(s) have failed their last ${STREAK} runs.`);
    console.error(`      A cron that dies at its first guard leaves no artifact and no diff.`);
  }
  const overdue = overdueNeverFired(neverFired, GRACE);
  if (overdue.length) {
    failed = true;
    console.error(`\nFAIL: ${overdue.length} workflow(s) declare a cron and have NEVER fired,`);
    console.error(`      more than ${GRACE} days after being added:`);
    for (const w of overdue) console.error(`      ${w.path}  cron ${cronOf(w.path)}  added ${String(w.created_at).slice(0, 10)}`);
    console.error(`      GitHub disables scheduled workflows in inactive repos and drops`);
    console.error(`      schedules it cannot parse. A cron that has never run is not a cron.`);
  }
  if (failed) process.exit(1);
  console.log(`\nOK: no scheduled workflow is failing ${STREAK} runs in a row, and every`);
  console.log(`declared cron has either fired or is inside its ${GRACE}-day grace.`);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
