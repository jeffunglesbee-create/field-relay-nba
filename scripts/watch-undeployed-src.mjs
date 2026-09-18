#!/usr/bin/env node
// Is code that was committed actually RUNNING?
//
// MEASURED ON 2026-09-18, AND NOTHING CAUGHT IT BUT A HUMAN READING A NUMBER.
//
//   a1096c1  touched src/budget-helpers.js  -> deploy ran -> FAILED at step 71
//   27f2344  fixed the failure, docs-only   -> deploy.yml filters on src/**,
//                                              wrangler.toml, workers/** ...
//                                              so NO deploy fired
//
// The gate did its job, the fix was correct, and the code still was not live.
// Every dashboard was calm: the newest deploy run was a failure nobody was
// looking at, the newest commit was green because it ran no workflows at all,
// and `git log` showed the fix landed. The one question nobody asks after a red
// deploy is "did the NEXT commit happen to re-trigger it?" — and when the fix
// is docs, prose, or a workflow file, the answer is no.
//
// THE SAME SHAPE AS odds-backfill's FIFTEEN DAYS: a failure with no artifact and
// no diff, visible only as a red dot on a page no session opens. That one cost
// two weeks of dead cron. This one costs however long until someone notices a
// feature behaving like the old build.
//
// THE PREDICATE IS GIT, NOT THE WORKER. The relay stamps no build SHA, so
// "what is deployed" cannot be read from the running worker. What CAN be read
// is the head_sha of the last SUCCESSFUL deploy run — and whether any commit
// since then touched a path that deploy.yml watches. That is exact, needs no
// worker change, and cannot be fooled by a caching layer.
//
// READ-ONLY: git log and the GitHub API, GET only.
// --self-test exercises the predicates against enumerated inputs, no network.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const TOKEN = process.env.GITHUB_TOKEN;
const REPO  = process.env.GITHUB_REPOSITORY || 'jeffunglesbee-create/field-relay-nba';

// Read from deploy.yml rather than restated here — a second copy of this list
// is a list that will disagree with the workflow the day someone adds a path.
export function deployPathsFrom(workflowYaml) {
  const on = String(workflowYaml || '').split(/^permissions:/m)[0];
  const paths = on.split(/^\s*paths:\s*$/m)[1];
  if (!paths) return [];
  const out = [];
  for (const line of paths.split('\n')) {
    const m = line.match(/^\s+-\s+'([^']+)'\s*$/) || line.match(/^\s+-\s+"([^"]+)"\s*$/);
    if (m) { out.push(m[1]); continue; }
    if (/^\s*$/.test(line)) continue;
    if (/^\s+-\s/.test(line)) continue;
    break;   // out of the paths block
  }
  return out;
}

/** The verdict. `commits` are those touching a deploy path since the last
 *  green deploy, newest first. `state` is one of:
 *    deployed    nothing deploy-triggering has landed since the last success
 *    in_flight   a deploy is running right now — not a finding, just not yet
 *    undeployed  code is committed that no successful deploy has ever built
 *    unknown     there is no successful deploy to compare against */
export function undeployedVerdict(lastGreenSha, commits, deployRunning) {
  if (!lastGreenSha) return { state: 'unknown', commits: [] };
  if (!commits || commits.length === 0) return { state: 'deployed', commits: [] };
  // IN-FLIGHT IS CHECKED AFTER THE COMMIT LIST, NOT BEFORE. A running deploy
  // with nothing to build is still `deployed`; only a running deploy that has
  // something to build earns the benefit of the doubt.
  if (deployRunning) return { state: 'in_flight', commits };
  return { state: 'undeployed', commits };
}

/** Hours since the oldest undeployed commit — how long the drift has lasted.
 *  The OLDEST, not the newest: the newest tells you when someone last pushed,
 *  the oldest tells you how long something has been live-but-not-running. */
export function driftHours(commits, now = Date.now()) {
  if (!commits || !commits.length) return 0;
  const oldest = commits.reduce((a, c) => Math.min(a, Date.parse(c.at)), Infinity);
  if (!Number.isFinite(oldest)) return null;
  return Math.round(((now - oldest) / 3600000) * 10) / 10;
}

if (process.argv.includes('--self-test')) {
  let bad = 0;
  const one = (label, got, want, why) => got === want
    ? console.log(`  PASS  ${label} -> ${JSON.stringify(got)}  (${why})`)
    : (bad++, console.log(`  FAIL  ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`));

  const YAML = `on:
  push:
    branches: [main]
    paths:
      - 'src/**'
      - 'wrangler.toml'
      - 'workers/**'
  workflow_dispatch:

permissions:
  contents: write
`;
  one('the paths are read from the workflow', deployPathsFrom(YAML).join(','), 'src/**,wrangler.toml,workers/**',
      'a second copy of this list would disagree the day someone adds a path');
  one('a workflow with no paths filter',
      deployPathsFrom('on:\n  push:\n    branches: [main]\npermissions:\n').length, 0,
      'nothing to compare against — the live run treats that as fatal rather than passing');
  one('paths block length', deployPathsFrom(YAML).length, 3, 'exactly the three deploy.yml declares');

  const C = (sha, at) => ({ sha, at, subject: 'x' });
  const A = C('aaa', '2026-09-18T00:00:00Z');
  one('nothing since the last green', undeployedVerdict('g', [], false).state, 'deployed', 'the normal case');
  one('THE 2026-09-18 CASE', undeployedVerdict('g', [A], false).state, 'undeployed',
      'a1096c1 touched src, its deploy failed, and the docs-only fix re-triggered nothing');
  one('a deploy is running', undeployedVerdict('g', [A], true).state, 'in_flight',
      'not a finding — it has something to build and is building it');
  one('running with nothing to build', undeployedVerdict('g', [], true).state, 'deployed',
      'in-flight is checked AFTER the commit list, so an idle rebuild is not a reprieve');
  one('no green deploy at all', undeployedVerdict(null, [A], false).state, 'unknown',
      'nothing to compare against; absent is not "deployed" (Rule 99)');

  const NOW = Date.parse('2026-09-18T12:00:00Z');
  one('drift from the OLDEST commit',
      driftHours([C('a', '2026-09-18T00:00:00Z'), C('b', '2026-09-18T10:00:00Z')], NOW), 12,
      'the newest says when someone last pushed; the oldest says how long this has been unbuilt');
  one('no commits is zero drift', driftHours([], NOW), 0, 'not null — there genuinely is none');
  one('an unparseable date is unknown', driftHours([C('a', 'not-a-date')], NOW), null,
      'Number/Date coercion here would invent a drift of 56 years');

  console.log(bad ? `\n${bad} FAILED` : `\nself-test: 11/11`);
  console.log(`COVERAGE: three pure predicates. It does NOT reach git or the API, and it`);
  console.log(`cannot tell whether the deployed BUILD matches the SHA — only whether a`);
  console.log(`deploy-triggering commit exists that no successful run has ever built.`);
  process.exit(bad ? 1 : 0);
}

// Every line printed is also kept, because a red run's log scrolls away — that
// is the exact failure mode this watch exists to report. The outbox log is the
// artifact (Rule 90): it survives the run and is diffable.
const LOG = [];
const say = (l = '') => { LOG.push(l); console.log(l); };
const err = (l = '') => { LOG.push(l); console.error(l); };
function flush() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  try { writeFileSync(`outbox/undeployed-src-${stamp}.log`, LOG.join('\n') + '\n'); }
  catch (e) { console.error(`could not write the outbox log: ${e.message}`); }
}
const die = (code) => { flush(); process.exit(code); };

async function gh(path) {
  if (!TOKEN) throw new Error('GITHUB_TOKEN is not set');
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json',
               'User-Agent': 'field-relay-undeployed-src-watch' },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

(async () => {
  say(`=== undeployed src  repo=${REPO}  utc=${new Date().toISOString()} ===\n`);

  const paths = deployPathsFrom(execFileSync('cat', ['.github/workflows/deploy.yml'], { encoding: 'utf8' }));
  if (!paths.length) {
    err('FAIL: could not read the deploy paths from .github/workflows/deploy.yml.');
    err('      Without them this watch would compare against nothing and pass.');
    die(1);
  }
  say(`  deploy triggers on : ${paths.join(', ')}   (read from deploy.yml)`);

  const runs = (await gh(`/repos/${REPO}/actions/workflows/deploy.yml/runs?per_page=30`)).workflow_runs || [];
  const green = runs.find(r => r.conclusion === 'success');
  const running = runs.some(r => r.status === 'in_progress' || r.status === 'queued');
  const lastGreenSha = green ? green.head_sha : null;

  say(`  last GREEN deploy  : ${lastGreenSha ? `${lastGreenSha.slice(0, 7)}  ${green.run_started_at}` : 'NONE in the last 30 runs'}`);
  say(`  a deploy running   : ${running}`);

  let commits = [];
  if (lastGreenSha) {
    let raw = '';
    try {
      raw = git(['log', `${lastGreenSha}..HEAD`, '--format=%H%x00%aI%x00%s', '--', ...paths]);
    } catch (e) {
      err(`FAIL: git log against ${lastGreenSha.slice(0, 7)} failed (${e.message}).`);
      err(`      A shallow clone cannot see it — fetch-depth: 0 is required.`);
      die(1);
    }
    commits = raw ? raw.split('\n').map(l => {
      const [sha, at, subject] = l.split('\x00');
      return { sha, at, subject };
    }) : [];
  }

  const v = undeployedVerdict(lastGreenSha, commits, running);
  const hours = driftHours(commits);

  say(`\n  verdict            : ${v.state}`);
  say(`  commits unbuilt    : ${v.commits.length}${hours === null ? '' : `   oldest ${hours}h ago`}`);
  for (const c of v.commits) say(`      ${c.sha.slice(0, 7)}  ${c.at}  ${c.subject}`);

  say(`\nCOVERAGE: compares HEAD against the last SUCCESSFUL deploy run's head_sha`);
  say(`over ${paths.length} declared path(s), reading those paths from deploy.yml rather`);
  say(`than restating them. It does NOT verify the running worker matches that SHA —`);
  say(`no build stamp exists to check — only that every deploy-triggering commit has`);
  say(`been through a successful run.`);

  if (v.state === 'undeployed') {
    err(`\nFAIL: ${v.commits.length} commit(s) touch a deploy path and no successful deploy has built them.`);
    err(`      Oldest is ${hours}h old. A red deploy followed by a docs-only fix leaves`);
    err(`      exactly this state and nothing else reports it: the failed run scrolls`);
    err(`      away, the fix commit runs no workflows, and git log looks finished.`);
    err(`      Re-run deploy.yml at HEAD (it accepts workflow_dispatch).`);
    die(1);
  }
  if (v.state === 'unknown') {
    err(`\nFAIL: no successful deploy in the last 30 runs. Nothing to compare against,`);
    err(`      which is not the same as "everything is deployed".`);
    die(1);
  }
  say(v.state === 'in_flight'
    ? `\nOK: ${v.commits.length} commit(s) pending, and a deploy is running now.`
    : `\nOK: every deploy-triggering commit has been through a successful deploy.`);
  flush();
})().catch(e => { err(`FAIL: ${e.message}`); die(1); });
