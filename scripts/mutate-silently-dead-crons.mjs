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
if (spawnSync('node', SELF, { stdio: 'ignore' }).status !== 0) {
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
    anchor: "export const REPOS = (process.env.DEAD_CRON_REPOS || [",
    replace: "export const REPOS = (process.env.DEAD_CRON_REPOS || [ 'jeffunglesbee-create/field-relay-nba' ].concat([",
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
    anchor: "    resolved:   [...base ].filter(k => !found.has(k)).sort(),",
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
    catches: 'the EPA probe, skipped on 66 of 66 scheduled runs, is green again and unreported' },

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
];

let caught = 0;
for (const mut of MUTATIONS) {
  const original = fs.readFileSync(WATCH, 'utf8');
  const hits = original.split(mut.anchor).length - 1;
  if (hits !== 1) {
    console.log(`FAIL       ${mut.name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`);
    continue;
  }
  fs.writeFileSync(WATCH, original.replace(mut.anchor, mut.replace));
  if (fs.readFileSync(WATCH, 'utf8') === original) {
    console.log(`FAIL       ${mut.name}\n            file unchanged — NOTHING MUTATED.`);
    continue;
  }
  const red = spawnSync('node', SELF, { stdio: 'ignore' }).status !== 0;
  fs.writeFileSync(WATCH, original);
  console.log(`${red ? 'CAUGHT    ' : 'NOT CAUGHT'} ${mut.name}\n            (${mut.catches})`);
  if (red) caught++;
}

console.log(`\n${caught} of ${MUTATIONS.length} mutations caught.`);
console.log(`COVERAGE: the PURE predicates — page loop, short-read assertion, grace,`);
console.log(`the repo list, detector-key qualification, cron extraction and the RATCHET`);
console.log(`(new decay, a fix never failing, count-vs-key, review_by expiry), plus the`);
console.log(`dead-window definition and the per-repo survey run against a fake of the API`);
console.log(`(E1-E15). It does NOT exercise the real GitHub API, the report loop or the`);
console.log(`exit path: the sandbox token is a proxy placeholder and RELAY_GH_PAT exists`);
console.log(`only in CI, so those are verified by dispatching the workflow and reading`);
console.log(`its committed log.`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
