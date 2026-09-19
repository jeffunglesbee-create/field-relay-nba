#!/usr/bin/env node
// Rule 90 for the daily-vs-vendor watch.
//
// This one guards a claim about MONEY, so its mutations are aimed at the ways a
// breach could be made to read as health. V5 is the one to keep: swapping the
// tolerance denominator makes the allowance shrink exactly as the counter
// under-reports, so the worse the defect the easier the check passes — a
// failure mode that looks like a stricter check.
//
// Each asserts its anchor is unique and applied before reporting; NOT CAUGHT
// with nothing mutated is worse than no test.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const WATCH = 'scripts/watch-odds-daily-vs-vendor.mjs';
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
  { name: 'V1 the month boundary is treated as spend',
    anchor: "  if (pm !== cm) return { state: 'month-boundary', from: pm, to: cm };",
    replace: '  if (false) return { state: 0 };',
    catches: 'the vendor reset reads as a huge negative day and the month rolls in as a finding' },

  { name: 'V2 a reset off the 1st slips through',
    anchor: "  if (delta < -RESET_FLOOR) return { state: 'counter-reset', delta };",
    replace: "  if (delta < -1e12) return { state: 'counter-reset', delta };",
    catches: 'a billing cycle that does not land on the 1st is differenced as if it were spend' },

  { name: 'V3 no baseline becomes a zero-spend day',
    anchor: "  if (!prev) return { state: 'no-data' };",
    replace: "  if (!prev) return { state: 'ok', vendorDay: 0 };",
    catches: 'the first ever run reports the vendor billed nothing (Rule 99)' },

  { name: 'V4 known CI spend stops being subtracted',
    anchor: '  const residual = vendorDayCredits - ourDay - (Number(knownCI) || 0);',
    replace: '  const residual = vendorDayCredits - ourDay;',
    catches: 'every backfill day reports a breach, and a real one becomes indistinguishable' },

  { name: 'V5 the tolerance follows OUR number instead of the vendor',
    anchor: '  const tol = toleranceFor(vendorDayCredits);',
    replace: '  const tol = toleranceFor(ourDay);',
    catches: 'the allowance shrinks as our counter under-reports, so the worse the defect the easier it passes' },

  { name: 'V6 over-charging is reported as under-counting',
    anchor: "  return { state: 'we-overcharge-ourselves', residual, tol };",
    replace: "  return { state: 'counter-under-counts', residual, tol };",
    catches: 'wasted headroom and a budget breach are opposite defects with opposite fixes' },

  { name: 'V7 ?date= being ignored stops mattering',
    anchor: "  if (d.date !== wantDay) return { ok: false, why: `asked for ${wantDay}, got ${JSON.stringify(d.date)} — ?date= was not honoured` };",
    replace: '  if (false) return { ok: false, why: 0 };',
    catches: "today's partial total is compared against yesterday's vendor delta — the whole measurement, wrong" },

  { name: 'V8 a still-running day is accepted',
    anchor: "  if (d.is_today === true) return { ok: false, why: `${wantDay} is still running; a day must be CLOSED before its total means anything` };",
    replace: '  if (false) return { ok: false, why: 0 };',
    catches: 'a partial day against a full vendor delta manufactures a shortfall every single run' },

  { name: 'V9 an unreadable vendor figure reads as zero',
    anchor: "  if (typeof v !== 'number') return { ok: false, why: `provider.requests_used is ${JSON.stringify(v)} — null is NOT zero (Rule 99)` };",
    replace: '  if (false) return { ok: false, why: 0 };',
    catches: 'a day the vendor did not report reads as a day the vendor billed nothing' },

  { name: 'V10 a drifted window is differenced anyway',
    anchor: "  if (hours < 22 || hours > 26) return { state: 'window-drift', hours: Math.round(hours * 10) / 10 };",
    replace: '  if (false) return { state: 0 };',
    catches: 'the measured 104-405 minute runner drift books itself as a shortfall on most days' },
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
console.log(`COVERAGE: the three pure predicates. It does NOT exercise /budget/odds, the`);
console.log(`D1 read, or the series file — sandbox egress to the relay is blocked (403 at`);
console.log(`the proxy), so those are verified by dispatching the workflow.`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
