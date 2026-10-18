#!/usr/bin/env node
// Rule 90 for the D1-overload half of the pairing watch, and (P8-P11) for the
// interval degrade line's cross-day handling.
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

  // 2026-10-18: one batch, one catch, one `charge:` prefix. P12 and P13 are the
  // two ways the watch could keep reading the old shape and go quietly blind.
  { name: 'P12 the batch-shape mark goes back to the old two-of-three message',
    anchor: "export const MONTH_BATCH_MARK   = /odds budget batch returned \\d+ result\\(s\\), expected \\d+/;",
    replace: "export const MONTH_BATCH_MARK   = /odds budget batch returned 2 result\\(s\\), expected 3/;",
    catches: 'a shape mismatch in the five-statement batch reads 0 for good — the 10-09 incident class, unseen' },

  { name: 'P13 only the old per-batch prefixes are counted',
    anchor: "    if (k.includes(D1_OVERLOAD_MARK)) overloads += n;",
    replace: "    if ((k.startsWith('daily:') || k.startsWith('month:')) && k.includes(D1_OVERLOAD_MARK)) overloads += n;",
    catches: 'every overload after the cutover is keyed charge:, so the watch would report none while D1 failed' },

  { name: 'P5 the budget becomes inclusive',
    anchor: "  return { state: pathBlind > budget ? 'over' : 'within', ...base };",
    replace: "  return { state: pathBlind >= budget ? 'over' : 'within', ...base };",
    catches: 'the day the budget was set on would fail its own calibration' },

  { name: 'P14 a one-batch overload counts once against a two-path budget',
    anchor: "(k.startsWith('daily:') || k.startsWith('month:')) ? n : 2 * n;",
    replace: "n;",
    catches: 'the budget silently doubles in calls at the cutover' },

  { name: 'P6 the overflow bucket is dropped',
    anchor: "    if (k === DEGRADE_OTHER_KEY) overflow += n;",
    replace: "",
    catches: 'overloads past the 8-reason cap land in the overflow bucket and would vanish' },

  { name: 'P7 a null events field reads as zero',
    anchor: "  if (block.events === null || block.events === undefined || !Number.isFinite(events)) {",
    replace: "  if (!Number.isFinite(events)) {",
    catches: 'Number(null) is 0, so a block with events:null would read as a real, read, empty day' },

  // degradeVerdict — docs/CC-CMD-2026-10-12-pairing-degrade-cross-day.md. P8 is
  // the defect itself: the sign-only check that printed "explains — 3297" from
  // one day's counter minus the previous day's.
  { name: 'P8 the date check reverts to the sign',
    anchor: "  if (prevDegraded === undefined || prevDate === currDate) {",
    replace: "  if (true) {",
    catches: 'the real 10-10 -> 10-11 pair would read explains again, from a cross-day subtraction' },

  { name: 'P9 a negative escape reads as explained',
    anchor: "  if (!(escaped > 0)) return { state: 'no-escape', credits: delta, parts };",
    replace: "",
    catches: 'every degrade "explains" a ledger that charged MORE than the vendor billed' },

  { name: 'P10 the previous day\'s close is ignored',
    anchor: "    delta = (close - was) + now;",
    replace: "    delta = now;",
    catches: 'the interval loses everything between the last reading and midnight: 146 on 10-11 -> 10-12 reads 0' },

  { name: 'P11 two midnights are bridged with one close',
    anchor: "  } else if (nextUtcDate(prevDate) === currDate) {",
    replace: "  } else if (prevDate < currDate) {",
    catches: 'a missed day would be reconstructed from the wrong close' },
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
console.log(`COVERAGE: d1OverloadVerdict (P1-P7, P12, P13) and degradeVerdict (P8-P11) only.`);
console.log(`It does NOT exercise the closed-day fetch, ?date= handling, or the other five`);
console.log(`predicates in this watch; the fetch is verified by a scheduled run.`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
