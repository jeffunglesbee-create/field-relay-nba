#!/usr/bin/env node
// Rule 90 for the undeployed-src watch.
//
// Every mutation restores a way this watch could go green while code sits
// unbuilt — which is the one state it exists to refuse. Each asserts its anchor
// is unique and applied before reporting; NOT CAUGHT with nothing mutated is
// worse than no test.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const WATCH = 'scripts/watch-undeployed-src.mjs';
const SELF  = [WATCH, '--self-test'];

if (spawnSync('git', ['diff', '--quiet', '--', WATCH]).status !== 0) {
  console.log(`FAIL — ${WATCH} has unstaged changes; restore would lose them.`);
  process.exit(1);
}
if (spawnSync('node', SELF, { stdio: 'ignore' }).status !== 0) {
  console.log(`FAIL — ${WATCH} --self-test is already red on clean source.`);
  process.exit(1);
}
console.log(`baseline: ${WATCH} --self-test passes on clean source\n`);

const MUTATIONS = [
  { name: 'U1 undeployed commits stop being a finding',
    anchor: "  return { state: 'undeployed', commits };",
    replace: "  return { state: 'deployed', commits };",
    catches: 'the exact 2026-09-18 state — a red deploy plus a docs-only fix — passes silently' },

  { name: 'U2 a running deploy excuses everything',
    anchor: "  if (!commits || commits.length === 0) return { state: 'deployed', commits: [] };",
    replace: "  if (deployRunning) return { state: 'in_flight', commits: commits || [] };",
    catches: 'ordering flipped so any in-flight run is a reprieve, even one building nothing' },

  { name: 'U3 no successful deploy reads as deployed',
    anchor: "  if (!lastGreenSha) return { state: 'unknown', commits: [] };",
    replace: "  if (!lastGreenSha) return { state: 'deployed', commits: [] };",
    catches: 'absence read as health — a repo that has never deployed reports as fully deployed' },

  { name: 'U4 drift is measured from the NEWEST commit',
    anchor: '  const oldest = commits.reduce((a, c) => Math.min(a, Date.parse(c.at)), Infinity);',
    replace: '  const oldest = commits.reduce((a, c) => Math.max(a, Date.parse(c.at)), -Infinity);',
    catches: 'reports when someone last pushed instead of how long code has been unbuilt' },

  { name: 'U5 an unparseable date becomes a number',
    anchor: '  if (!Number.isFinite(oldest)) return null;',
    replace: '  if (false) return null;',
    catches: 'NaN arithmetic invents a drift figure from a date nobody could read' },

  { name: 'U6 the deploy paths are guessed instead of read',
    anchor: '  const paths = on.split(/^\\s*paths:\\s*$/m)[1];\n  if (!paths) return [];',
    replace: "  const paths = null;\n  if (!paths) return ['src/**'];",
    catches: 'a second copy of the path list, which disagrees the day deploy.yml gains one' },
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
console.log(`COVERAGE: the three pure predicates. It does NOT exercise git, the Actions`);
console.log(`API, or the fatal path when deploy.yml has no paths block — the sandbox token`);
console.log(`is a proxy placeholder, so those are verified by dispatching the workflow.`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
