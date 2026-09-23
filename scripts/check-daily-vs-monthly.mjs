// Rule 90 for dailyVsMonthly. It reports an IMPOSSIBILITY — daily spend
// exceeding the monthly counter that the same function increments — so every
// way of not being one has to stay distinguishable from one that is.
import { createRequire } from 'node:module';
const MOD = process.env.DVM_MODULE || './lib/daily-vs-monthly.cjs';
const { dailyVsMonthly, containedDays, dayStartMs } = createRequire(import.meta.url)(MOD);

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

console.log(`\n${n - bad} of ${n} passed.`);
console.log('COVERAGE: dailyVsMonthly and containedDays — 1 file. It does NOT check');
console.log('that the relay serves these fields, nor which of the two counters is the');
console.log('WRONG one: the excess says they disagree, never who is right.');
process.exit(bad ? 1 : 0);
