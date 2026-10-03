// Rule 90 for dailyVsMonthly. It reports an IMPOSSIBILITY — daily spend
// exceeding the monthly counter that the same function increments — so every
// way of not being one has to stay distinguishable from one that is.
import { createRequire } from 'node:module';
const MOD = process.env.DVM_MODULE || './lib/daily-vs-monthly.cjs';
const { dailyVsMonthly, containedDays, dayStartMs, monotoneSuffix, perDayDeltas } = createRequire(import.meta.url)(MOD);

let bad = 0, n = 0;
const eq = (label, got, want) => { n++;
  if (JSON.stringify(got) === JSON.stringify(want)) console.log(`ok    ${label}`);
  else { bad++; console.log(`FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); } };

const r = (at, day, day_used, ledger_month_used) => ({ at, day, day_used, ledger_month_used });

// The live shape, from outbox/odds-daily-vs-vendor-series.json.
const LIVE = [
  r('2026-09-19T02:22:39.263Z', '2026-09-18', 3799, 55911),
  r('2026-09-20T04:48:32.731Z', '2026-09-19', 3800, 59465),
  r('2026-09-21T04:49:02.145Z', '2026-09-20', 3800, 60802),
  r('2026-09-22T04:47:39.530Z', '2026-09-21', 3799, 60948),
];

eq('THE MEASURED CONTRADICTION: daily outruns the counter it is charged alongside',
  (({ verdict, dailySum, monthlyDelta, excess }) => ({ verdict, dailySum, monthlyDelta, excess }))(dailyVsMonthly(LIVE)),
  { verdict: 'daily-exceeds-monthly', dailySum: 7599, monthlyDelta: 5037, excess: 2562 });

// EDGE DAYS ARE EXCLUDED, NOT PRORATED. 2026-09-18 opens before the first
// reading and 2026-09-22 has not closed — counting either would put a number
// in the sum that the window does not cover, which is the exact substitution
// this module exists to avoid.
eq('a day that opens before the first reading is not counted',
  dailyVsMonthly(LIVE).days.map(d => d.day), ['2026-09-20', '2026-09-21']);
eq('containedDays agrees, given the same span',
  containedDays(LIVE, Date.parse('2026-09-19T02:22:39.263Z'), Date.parse('2026-09-22T04:47:39.530Z')).map(x => x.day),
  ['2026-09-20', '2026-09-21']);
eq('a day whose midnight exactly meets the reading IS contained',
  containedDays([r('x', '2026-09-20', 1, 1)],
    Date.parse('2026-09-20T00:00:00.000Z'), Date.parse('2026-09-21T00:00:00.000Z')).map(x => x.day),
  ['2026-09-20']);
eq('...and one second short of the close is NOT',
  containedDays([r('x', '2026-09-20', 1, 1)],
    Date.parse('2026-09-20T00:00:00.000Z'), Date.parse('2026-09-20T23:59:59.000Z')).map(x => x.day),
  []);

// ONE-SIDED. monthly > daily is expected: the monthly delta holds the partial
// edge hours the contained days leave out. Reporting that as a defect would
// make the check red on every healthy run.
eq('a monthly delta LARGER than the daily sum is consistent, not a finding',
  dailyVsMonthly([
    r('2026-09-19T00:00:00.000Z', '2026-09-18', 100, 1000),
    r('2026-09-21T00:00:00.000Z', '2026-09-20', 100, 9000),
  ]).verdict, 'consistent');
eq('an exact match is consistent',
  dailyVsMonthly([
    r('2026-09-19T00:00:00.000Z', '2026-09-18', 100, 1000),
    r('2026-09-21T00:00:00.000Z', '2026-09-20', 100, 1100),
  ]).verdict, 'consistent');
// Only 2026-09-20 is contained in these spans, so its day_used is the entire
// daily sum and the excess is exactly day_used - monthlyDelta. The first
// version of this pair got that wrong — it paired 140 against a zero delta and
// called the resulting 140 "inside the floor of 50". The check was right and
// the fixture was wrong, which is the cheaper of the two.
eq('an excess inside the floor is not yet a finding',
  dailyVsMonthly([
    r('2026-09-19T00:00:00.000Z', '2026-09-18', 100, 1000),
    r('2026-09-21T00:00:00.000Z', '2026-09-20', 140, 1100),   // excess 40
  ]).verdict, 'consistent');
eq('...and one just past it is',
  dailyVsMonthly([
    r('2026-09-19T00:00:00.000Z', '2026-09-18', 100, 1000),
    r('2026-09-21T00:00:00.000Z', '2026-09-20', 160, 1100),   // excess 60
  ]).verdict, 'daily-exceeds-monthly');

// The refusals, each named rather than collapsed into a green (Rule 99).
eq('one reading cannot make a delta', dailyVsMonthly([LIVE[0]]).verdict, 'not-enough-readings');
eq('no readings at all is a refusal, never consistent', dailyVsMonthly([]).verdict, 'not-enough-readings');
eq('a non-array is a refusal too', dailyVsMonthly(null).verdict, 'not-enough-readings');
eq('an absent monthly figure is unreadable, NOT zero',
  dailyVsMonthly([
    r('2026-09-19T00:00:00.000Z', '2026-09-18', 100, null),
    r('2026-09-21T00:00:00.000Z', '2026-09-20', 100, 1100),
  ]).verdict, 'unreadable');
eq('a backwards monthly counter is a month boundary, not a huge excess',
  dailyVsMonthly([
    r('2026-09-30T00:00:00.000Z', '2026-09-29', 3800, 60000),
    r('2026-10-02T00:00:00.000Z', '2026-10-01', 3800, 400),
  ]).verdict, 'month-boundary');
eq('a span holding no whole day says so rather than summing nothing to zero',
  dailyVsMonthly([
    r('2026-09-20T06:00:00.000Z', '2026-09-19', 100, 1000),
    r('2026-09-20T18:00:00.000Z', '2026-09-19', 100, 1100),
  ]).verdict, 'no-contained-day');
eq('out-of-order readings are unreadable',
  dailyVsMonthly([
    r('2026-09-22T00:00:00.000Z', '2026-09-21', 100, 1100),
    r('2026-09-19T00:00:00.000Z', '2026-09-18', 100, 1000),
  ]).verdict, 'unreadable');
eq('an unparseable day yields no contained day rather than NaN arithmetic',
  dayStartMs('not-a-day'), null);

// ── THE LATCH, which is why the segment exists ──────────────────────────────
//
// Measured 2026-10-03: a reset at reading 12 of 15 made the file-wide delta
// -54,461 and the watch returned `month-boundary` on four consecutive runs
// while the monthly counter climbed in plain view. The shape is reproduced
// here at the size the real series had it, not as a two-row toy, because the
// defect was specifically that the reset STAYS in the file behind newer
// readings that are perfectly comparable.
const LATCH = [
  r('2026-09-29T05:00:00.000Z', '2026-09-28', 244, 76008),
  r('2026-09-30T05:00:00.000Z', '2026-09-29', 3799, 79831),
  r('2026-10-01T05:00:00.000Z', '2026-09-30', 1996, 162),    // the reset
  r('2026-10-02T05:00:00.000Z', '2026-10-01', 357, 474),
  r('2026-10-03T05:00:00.000Z', '2026-10-02', 890, 1450),
];
eq('A RESET BEHIND NEWER READINGS DOES NOT LATCH THE REFUSAL',
  dailyVsMonthly(LATCH).verdict, 'consistent');
eq('the segment is the post-reset readings only',
  dailyVsMonthly(LATCH).readingsInSegment, 3);
eq('and it says how many it dropped, where the result is read (Rule 91)',
  dailyVsMonthly(LATCH).droppedBeforeReset, 2);
eq('the dropped readings are named by the reset timestamp, not merely counted',
  dailyVsMonthly(LATCH).resetAt, '2026-10-01T05:00:00.000Z');
// THE INVERSE OF THE OLD BUG, and the one that would be worse. 2026-09-29's
// 3,799 must not be summed against a delta that starts after the reset.
eq('a pre-reset day is NOT summed against a post-reset delta',
  dailyVsMonthly(LATCH).dailySum, 890);
eq('...and the monthly delta is the post-reset one',
  dailyVsMonthly(LATCH).monthlyDelta, 1288);

// A reset between the two NEWEST readings is a real refusal: there is no span
// inside one month yet. Distinguished from the latch by the segment length.
const FRESH_RESET = [
  r('2026-09-30T05:00:00.000Z', '2026-09-29', 3799, 79831),
  r('2026-10-01T05:00:00.000Z', '2026-09-30', 1996, 162),
];
eq('a reset at the newest reading still refuses',
  dailyVsMonthly(FRESH_RESET).verdict, 'month-boundary');
eq('and the refusal states that the segment holds one reading',
  dailyVsMonthly(FRESH_RESET).readingsInSegment, 1);

// ── monotoneSuffix: three stop reasons, three facts (Rule 99) ──────────────
eq('a wholly monotone file stops at the start of the series',
  monotoneSuffix(LATCH.slice(3)).stopReason, 'start-of-series');
eq('a falling step stops as a reset', monotoneSuffix(LATCH).stopReason, 'reset');
eq('an absent monthly figure stops as unreadable, NOT as a reset',
  monotoneSuffix([
    r('2026-10-01T05:00:00.000Z', '2026-09-30', 100, null),
    r('2026-10-02T05:00:00.000Z', '2026-10-01', 100, 474),
  ]).stopReason, 'unreadable');
eq('an unreadable neighbour yields `unreadable`, never `month-boundary`',
  dailyVsMonthly([
    r('2026-10-01T05:00:00.000Z', '2026-09-30', 100, null),
    r('2026-10-02T05:00:00.000Z', '2026-10-01', 100, 474),
  ]).verdict, 'unreadable');
// An EQUAL step is not a reset. A day on which nothing was spent leaves the
// monthly counter where it was, and treating that as a reset would drop every
// reading before a quiet day.
eq('an unchanged monthly figure is not a reset',
  monotoneSuffix([
    r('2026-10-02T05:00:00.000Z', '2026-10-01', 0, 474),
    r('2026-10-03T05:00:00.000Z', '2026-10-02', 0, 474),
  ]).stopReason, 'start-of-series');

// ── perDayDeltas: the table, and it is diagnostic, not a verdict ───────────
const PD = perDayDeltas(LATCH);
eq('one row per adjacent pair', PD.length, 4);
eq('the reset row carries a null monthly delta, not -79,669',
  PD[1].monthlyDelta, null);
eq('...and a null excess rather than a fabricated one', PD[1].excess, null);
eq('the reset row says a reset sits between the pair', PD[1].resetBetween, true);
eq('a normal row computes day_used minus the monthly movement',
  PD[3].excess, 890 - 976);
eq('span hours are carried so a reader can see which pairs are near 24h',
  PD[3].spanHours, 24);
eq('a missing day_used yields a null excess, never zero',
  perDayDeltas([
    r('2026-10-02T05:00:00.000Z', '2026-10-01', 357, 474),
    r('2026-10-03T05:00:00.000Z', '2026-10-02', null, 1450),
  ])[0].excess, null);
eq('a consistent verdict carries the per-day table',
  Array.isArray(dailyVsMonthly(LATCH).perDay), true);

console.log(`\n${n - bad} of ${n} passed.`);
console.log('COVERAGE: dailyVsMonthly, containedDays, monotoneSuffix and perDayDeltas');
console.log('— 1 file. The per-day table is DIAGNOSTIC: its pairs span ~23.7h offset');
console.log('from the UTC day, so a single row is not a verdict. It does NOT check');
console.log('that the relay serves these fields, nor which of the two counters is the');
console.log('WRONG one: the excess says they disagree, never who is right.');
process.exit(bad ? 1 : 0);
