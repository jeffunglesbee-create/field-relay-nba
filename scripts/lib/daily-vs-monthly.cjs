// TWO OF OUR OWN COUNTERS, COMPARED WITHOUT A WINDOW.
//
// WHY THIS EXISTS
//
// `consumeOddsCredit` (src/index.js:6535) charges the IDENTICAL `units` to the
// daily counter and then to the monthly one, in that order, in one function.
// Within a UTC day the two cannot legitimately diverge. Measured on the four
// readings in outbox/odds-daily-vs-vendor-series.json:
//
//   day         vendorD   our monthlyD   our dailyD
//   2026-09-19     4323           3554         3800
//   2026-09-20     1543           1337         3800
//   2026-09-21      704            146         3799
//
// The monthly counter tracks the vendor within a few hundred every day. The
// daily counter tracks nothing: the vendor's spend varied SIX-FOLD while the
// daily figure varied by one. No watch has ever compared these two, and it is
// the cheapest discriminating comparison available — both numbers arrive in a
// single /budget/odds read, with no vendor call and no external referent.
//
// THE WINDOW PROBLEM, AND WHY THIS AVOIDS IT
//
// `daily.used` is a CLOSED UTC DAY. `monthly.used` is a running total, so the
// obvious comparison differences it between two readings — and the readings
// land at ~04:48Z, so that window is offset from the UTC day by almost five
// hours. Differencing them would rebuild the same two-window substitution that
// odds-daily-vs-vendor already carries and that cost this project ten days on
// an unrelated defect.
//
// So this does not difference against a matching window. It uses an INEQUALITY
// that holds for any window:
//
//   The monthly delta over [first.at, last.at] counts every day FULLY CONTAINED
//   in that span, PLUS whatever was spent in the partial hours at each edge.
//   Therefore:  monthlyDelta >= sum(day_used for fully-contained days).
//
// Daily exceeding monthly is not a tolerance question. It is impossible, and
// the size of the excess is a floor on the error, never an estimate of it.
'use strict';

const DAY_MS = 86400000;
const FLOOR = 50;

/** UTC midnight opening `day` (YYYY-MM-DD), as ms. */
function dayStartMs(day) {
  const t = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(t) ? t : null;
}

/**
 * Days fully inside [fromMs, toMs] — both midnights within the span.
 * A day only partly covered is EXCLUDED rather than prorated: prorating would
 * invent a number, and the whole point here is an inequality that needs none.
 */
function containedDays(readings, fromMs, toMs) {
  return readings.filter(r => {
    const s = dayStartMs(r && r.day);
    return s !== null && s >= fromMs && s + DAY_MS <= toMs;
  });
}

/**
 * @param {{at:string, day:string, day_used:number, ledger_month_used:number}[]} readings
 *        oldest first, as the series file stores them.
 * @returns {{verdict:string, ...}} never null — the verdict names its own refusal.
 */
function dailyVsMonthly(readings) {
  if (!Array.isArray(readings) || readings.length < 2)
    return { verdict: 'not-enough-readings', have: Array.isArray(readings) ? readings.length : 0, need: 2 };

  const first = readings[0], last = readings[readings.length - 1];
  const fromMs = Date.parse(first && first.at), toMs = Date.parse(last && last.at);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs)
    return { verdict: 'unreadable', why: 'reading timestamps are absent, unparseable or out of order' };

  // null is not zero (Rule 99): a reading whose monthly figure never arrived
  // cannot anchor a delta, and Number(null) would silently make it 0.
  const m0 = first.ledger_month_used, m1 = last.ledger_month_used;
  if (typeof m0 !== 'number' || typeof m1 !== 'number')
    return { verdict: 'unreadable', why: 'ledger_month_used absent on an endpoint reading' };

  const monthlyDelta = m1 - m0;
  // The monthly key is per calendar month, so it resets. A negative delta is a
  // reset, not a refund of the whole month.
  if (monthlyDelta < 0)
    return { verdict: 'month-boundary', monthlyDelta, why: 'the monthly counter went backwards — a reset, not spend' };

  const days = containedDays(readings, fromMs, toMs).filter(r => typeof r.day_used === 'number');
  if (!days.length)
    return { verdict: 'no-contained-day', from: first.at, to: last.at,
             why: 'no closed UTC day lies entirely inside the reading span' };

  const dailySum = days.reduce((a, r) => a + r.day_used, 0);
  const excess = dailySum - monthlyDelta;
  const base = {
    from: first.at, to: last.at,
    days: days.map(r => ({ day: r.day, used: r.day_used })),
    dailySum, monthlyDelta, excess,
    ratio: monthlyDelta > 0 ? Number((dailySum / monthlyDelta).toFixed(2)) : null,
  };
  // ONE-SIDED ON PURPOSE. monthlyDelta > dailySum is expected — it holds the
  // partial edge hours the contained days exclude. Only the other direction is
  // a contradiction, so only the other direction is reported as one.
  if (excess > FLOOR) return { ...base, verdict: 'daily-exceeds-monthly' };
  return { ...base, verdict: 'consistent' };
}

module.exports = { dailyVsMonthly, containedDays, dayStartMs, FLOOR, DAY_MS };
