#!/usr/bin/env node
// Rule 90 for the site-drift watch.
//
// This watch exists to tell ONE mechanism apart from another, so its mutations
// are not "does it notice a gap" — they are "can it still be fooled into
// naming the wrong cause". Two of them (D5, D6) break the watch's ability to
// REFUTE its own hypothesis, which is the failure that would matter most:
// a probe that can only ever confirm what it was built to look for.
//
// Each asserts its anchor is unique and applied before reporting; NOT CAUGHT
// with nothing mutated is worse than no test.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const WATCH = 'scripts/watch-odds-site-drift.mjs';
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
  { name: 'D1 the gap loses its sign',
    anchor: '  return s.by_site_sum - s.used;',
    replace: '  return Math.abs(s.by_site_sum - s.used);',
    catches: 'sites-over-total and total-over-sites are DIFFERENT defects; an absolute gap merges them' },

  { name: 'D2 an unreadable sum reads as agreement',
    anchor: '  if (!s || s.by_site_sum === null || s.by_site_sum === undefined) return null;',
    replace: '  if (!s) return null;',
    catches: 'Number(null) is 0, so a day nobody could read reports a perfect gap of 0 (Rule 99)' },

  { name: 'D3 midnight pairs are compared anyway',
    anchor: "  if (prev.date !== curr.date) return { crossDay: true, from: prev.date, to: curr.date };",
    replace: "  if (false) return { crossDay: true, from: prev.date, to: curr.date };",
    catches: 'per-day keys, so a midnight pair subtracts two populations and invents the whole delta' },

  { name: 'D4 a site that MOVED still counts as pinned',
    anchor: '    if (pv === 0 && cv === 0) pinnedAtZero.push(k);',
    replace: '    if (pv === 0) pinnedAtZero.push(k);',
    catches: 'names a site as a clamp suspect on the interval where it started spending' },

  { name: 'D5 rising spend counts as clamp evidence',
    anchor: "  return { verdict: 'gap-grew-while-spending', grew: d.gapDelta, usedDelta: d.usedDelta };",
    replace: "  return { verdict: 'clamp-witnessed', grew: d.gapDelta, usedDelta: d.usedDelta, suspects: d.pinnedAtZero };",
    catches: 'the probe can then only ever confirm its own hypothesis — every gap becomes the clamp' },

  { name: 'D6 inconclusive is dressed up as healthy',
    anchor: "  return { state: 'inconclusive', intervals: usable.length };",
    replace: "  return { state: 'gap-did-not-grow', intervals: usable.length };",
    catches: 'not catching the clamp becomes a claim it is absent — the exact substitution this watch is for' },

  { name: 'D7 no samples reads as clean',
    anchor: "  if (!usable.length) return { state: 'no-data', intervals: 0 };",
    replace: "  if (!usable.length) return { state: 'inconclusive', intervals: 0 };",
    catches: 'a run that collected nothing reports the same as a run that watched all day (Rule 99)' },

  { name: 'D8 a refund with no gap growth is a hit',
    anchor: "  if (d.gapDelta <= 0) return { verdict: 'gap-did-not-grow' };",
    replace: "  if (d.gapDelta < -1e9) return { verdict: 'gap-did-not-grow' };",
    catches: 'every ordinary refund interval becomes a clamp sighting, and the signal is gone' },

  { name: 'D9 the route is read at the top level again',
    anchor: '  const d = body && body.daily;',
    replace: '  const d = body;',
    catches: 'the exact 2026-09-18 15:48 defect — a sample of undefineds, recorded, exit 0' },

  { name: 'D10 a shapeless read is recorded anyway',
    anchor: "  if (typeof d.used !== 'number') return { ok: false, why: `daily.used is ${JSON.stringify(d.used)}, not a number` };",
    replace: '  if (false) return { ok: false, why: 0 };',
    catches: 'undefined enters the series, every interval reads quiet, and the watch stays green' },
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
console.log(`COVERAGE: the five pure predicates. It does NOT exercise the /budget/odds`);
console.log(`fetch, the series file, or the cross-midnight branch of the live loop — those`);
console.log(`are verified by dispatching the workflow, since sandbox egress to the relay`);
console.log(`is blocked (403 at the proxy).`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
