#!/usr/bin/env node
// Rule 90 for the D1-overload half of the pairing watch.
//
// Every mutation here is a way for a database that is failing the odds guard to
// read as healthy. P1 and P2 are the two that already happened once, on
// 2026-10-11, in a probe rather than a watch: `?? 0` turned an unreadable
// counter into "0 events", and reading one level above the field turned
// NOT-REPORTED into the same zero. P4 is the quiet one — counting only the
// daily path reports half the overloads and still looks like a working check.
//
// Each asserts its anchor is unique and applied before reporting; NOT CAUGHT
// with nothing mutated is worse than no test.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const WATCH = 'scripts/watch-odds-pairing-rate.mjs';
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
  { name: 'P1 a field missing from the response reads as zero',
    anchor: "  if (block === undefined) return { state: 'not-reported', overloads: null };",
    replace: "  if (block === undefined) return { state: 'none', overloads: 0 };",
    catches: 'the wrong-nesting failure of 2026-10-11, inside the watch: the field is not where we look, and that reads as a clean day' },

  { name: 'P2 an unreadable counter reads as zero (the ?? 0 defect)',
    anchor: "    return { state: 'unreadable', overloads: null };\n  }\n  const events = Number(block.events);",
    replace: "    return { state: 'none', overloads: 0 };\n  }\n  const events = Number(block.events);",
    catches: 'the route returns null when the KV read failed; treating it as zero is exactly the coercion that hid the counter once' },

  { name: 'P3 events with no reasons read as zero overloads',
    anchor: "    return { state: 'unattributed', overloads: null, events };",
    replace: "    return { state: 'none', overloads: 0, events };",
    catches: 'every sample before 2026-10-09T00:44Z looked like this — reading it as zero manufactures a 22-day clean baseline' },

  { name: 'P4 only the daily path is counted',
    anchor: "    if (k.includes(D1_OVERLOAD_MARK)) overloads += n;",
    replace: "    if (k.startsWith('daily:') && k.includes(D1_OVERLOAD_MARK)) overloads += n;",
    catches: 'reports 77 of 155 on 2026-10-11 — half the failures, from a check that still looks like it works' },

  { name: 'P5 the budget becomes inclusive',
    anchor: "  return { state: overloads > budget ? 'over' : 'within', ...base };",
    replace: "  return { state: overloads >= budget ? 'over' : 'within', ...base };",
    catches: 'the day the budget was set on would fail its own calibration' },

  { name: 'P6 the overflow bucket is dropped',
    anchor: "    if (k === DEGRADE_OTHER_KEY) overflow += n;",
    replace: "",
    catches: 'overloads past the 8-reason cap land in the overflow bucket and would vanish' },

  { name: 'P7 a null events field reads as zero',
    anchor: "  if (block.events === null || block.events === undefined || !Number.isFinite(events)) {",
    replace: "  if (!Number.isFinite(events)) {",
    catches: 'Number(null) is 0, so a block with events:null would read as a real, read, empty day' },
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
console.log(`COVERAGE: d1OverloadVerdict only — the predicate the D1-overload FAIL rests on.`);
console.log(`It does NOT exercise the closed-day fetch, ?date= handling, or the other six`);
console.log(`predicates in this watch; the fetch is verified by dispatching the workflow.`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
