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
const log = [];
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

(async () => {
  say(`=== silently dead crons  repo=${REPO}  streak=${STREAK}  utc=${new Date().toISOString()} ===`);

  const { workflows = [] } = await gh(`/repos/${REPO}/actions/workflows?per_page=100`);
  const active = workflows.filter(w => w.state === 'active');
  say(`\n    ${workflows.length} workflow(s), ${active.length} active`);

  // A DETECTOR'S RED IS ITS OUTPUT. brief-label-migration.yml and
  // rule90-staleness-monitor.yml both exit non-zero while the condition they
  // report holds — verified by reading their exit paths, not inferred from the
  // fact that they are red. Listing them as dead every day would make this
  // watch the noise it exists to prevent.
  const declared = JSON.parse(readFileSync('docs/declared-detectors.json', 'utf8')).detectors || {};

  const dead = [], healthy = [], unscheduled = [], detectors = [];
  for (const w of active) {
    const { workflow_runs = [] } = await gh(
      `/repos/${REPO}/actions/workflows/${w.id}/runs?event=schedule&per_page=${STREAK}&status=completed`);
    if (!workflow_runs.length) { unscheduled.push(w.name); continue; }
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
  say(`\n    scheduled and healthy            : ${healthy.length}`);
  say(`    never run on a schedule           : ${unscheduled.length}  (not judged)`);
  say(`    FAILING ${STREAK} CONSECUTIVE RUNS : ${dead.length}`);
  for (const d of dead)
    say(`      ${d.path}\n        red since at least ${d.since}, latest ${d.latest}\n        ${d.url}`);

  say(`\n    COVERAGE: every ACTIVE workflow with at least ${STREAK} completed scheduled`);
  say(`    runs. Workflows that only run on push or dispatch are counted as`);
  say(`    "never run on a schedule" and deliberately not judged — their failures`);
  say(`    surface on the commit that caused them.`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(`outbox/silently-dead-crons-${stamp}.log`, log.join('\n') + '\n');

  if (dead.length) {
    console.error(`\nFAIL: ${dead.length} scheduled workflow(s) have failed their last ${STREAK} runs.`);
    console.error(`      A cron that dies at its first guard leaves no artifact and no diff.`);
    process.exit(1);
  }
  console.log(`\nOK: no scheduled workflow is failing ${STREAK} runs in a row.`);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
