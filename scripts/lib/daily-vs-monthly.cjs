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
//
// THE SPAN IS THE CURRENT MONTH'S SEGMENT, NOT THE WHOLE SERIES
//
// This anchored `m0`/`m1` on `readings[0]` and `readings[length-1]` — the ends
// of the FILE — and refused with `month-boundary` whenever that delta came out
// negative. The monthly key resets on the 1st, so one reset anywhere in the
// series makes the file-wide delta negative FOREVER.
//
// Measured 2026-10-03: the September reset is at reading 12 of 15. The series
// opens at 55,911 and ends at 1,450, so `monthlyDelta` read -54,461 and the
// watch returned `month-boundary` on four consecutive runs — 10-01, 10-02,
// 10-03 and counting — while the monthly counter was climbing 162 -> 474 ->
// 1,450 in plain view. The verdict it was suppressing is `consistent`.
//
// A refusal that cannot expire is worse than a failure: nothing was red, the
// log said "Not a pass and not a failure" every day, and the comparison this
// module exists for had silently stopped happening.
//
// So the span is the TRAILING RUN of readings whose monthly figure never
// decreases. A reset drops the readings before it and nothing else. The
// contained days are taken from that same segment — summing a pre-reset day
// against a post-reset delta would be the window substitution inverted.
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
 * The trailing run of readings whose `ledger_month_used` never decreases — the
 * current month's segment.
 *
 * `stopReason` is carried because the three ways of stopping are three
 * different facts and the caller's verdict differs for each (Rule 99):
 *   `reset`         the monthly counter fell between two readings
 *   `unreadable`    a reading's monthly figure is absent, so no step can be judged
 *   `start-of-series` the whole file is one monotone run
 *
 * THE RESET TEST LIVES HERE AND NOWHERE ELSE. It used to be a second test on
 * the computed delta downstream; with the segment chosen correctly that test
 * can never fire, and a branch that cannot fire is dead code carrying a dead
 * mutation (Rule 63).
 */
function monotoneSuffix(readings) {
  let start = readings.length - 1;
  let stopReason = 'start-of-series';
  while (start > 0) {
    const a = readings[start - 1] && readings[start - 1].ledger_month_used;
    const b = readings[start] && readings[start].ledger_month_used;
    if (typeof a !== 'number' || typeof b !== 'number') { stopReason = 'unreadable'; break; }
    if (b < a) { stopReason = 'reset'; break; }
    start--;
  }
  return {
    readings: readings.slice(start),
    dropped: start,
    stopReason,
    resetAt: stopReason === 'reset' ? (readings[start] && readings[start].at) || null : null,
  };
}

/**
 * One row per adjacent pair of readings: the closed day's own counter against
 * how far the monthly counter moved over the same pair.
 *
 * DIAGNOSTIC, NEVER A VERDICT. The readings land around 05:00Z, so each pair
 * spans a day offset from the UTC day by about five hours — the very
 * substitution `dailyVsMonthly` refuses to make. `spanHours` is on every row so
 * a reader can see which pairs are near 24h and which are not. The verdict
 * stays the window-free inequality over the whole segment; this table exists
 * because a cumulative total hides a fix that landed on one day, and that is
 * exactly what it did: the per-day excess fell from +3,418 on 2026-09-22 to
 * -24 on 2026-09-29 while the series total still read like a standing defect.
 *
 * `null`, never 0, wherever a figure is missing or a reset sits between the
 * pair. A reset row must not render as a -79,669 excess.
 */
function perDayDeltas(readings) {
  if (!Array.isArray(readings)) return [];
  const rows = [];
  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1] || {}, cur = readings[i] || {};
    const m0 = prev.ledger_month_used, m1 = cur.ledger_month_used;
    const monthlyDelta = (typeof m0 === 'number' && typeof m1 === 'number' && m1 >= m0)
      ? m1 - m0 : null;
    const dayUsed = typeof cur.day_used === 'number' ? cur.day_used : null;
    const t0 = Date.parse(prev.at), t1 = Date.parse(cur.at);
    rows.push({
      day: cur.day || null,
      dayUsed,
      monthlyDelta,
      excess: (dayUsed !== null && monthlyDelta !== null) ? dayUsed - monthlyDelta : null,
      spanHours: (Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0)
        ? Number(((t1 - t0) / 3600000).toFixed(1)) : null,
      resetBetween: monthlyDelta === null && typeof m0 === 'number' && typeof m1 === 'number',
    });
  }
  return rows;
}

/**
 * @param {{at:string, day:string, day_used:number, ledger_month_used:number}[]} readings
 *        oldest first, as the series file stores them.
 * @returns {{verdict:string, ...}} never null — the verdict names its own refusal.
 */
function dailyVsMonthly(readings) {
  if (!Array.isArray(readings) || readings.length < 2)
    return { verdict: 'not-enough-readings', have: Array.isArray(readings) ? readings.length : 0, need: 2 };

  // ORDER IS CHECKED ON THE WHOLE FILE, BEFORE the segment is chosen. A
  // reversed series also has a falling monthly figure, so the segment walk
  // would call it a reset and refuse with the wrong reason.
  const fromAll = Date.parse(readings[0] && readings[0].at);
  const toAll = Date.parse(readings[readings.length - 1] && readings[readings.length - 1].at);
  if (!Number.isFinite(fromAll) || !Number.isFinite(toAll) || toAll <= fromAll)
    return { verdict: 'unreadable', why: 'reading timestamps are absent, unparseable or out of order' };

  const seg = monotoneSuffix(readings);
  const coverage = { readingsOnFile: readings.length, readingsInSegment: seg.readings.length,
                     droppedBeforeReset: seg.dropped, resetAt: seg.resetAt };
  if (seg.readings.length < 2) {
    if (seg.stopReason === 'reset')
      return { verdict: 'month-boundary', ...coverage,
               why: 'the monthly counter reset between the two newest readings — there is no span inside one month yet' };
    return { verdict: 'unreadable', ...coverage,
             why: 'ledger_month_used absent on a reading adjacent to the newest one' };
  }

  const first = seg.readings[0], last = seg.readings[seg.readings.length - 1];
  const fromMs = Date.parse(first && first.at), toMs = Date.parse(last && last.at);

  // NO SECOND typeof CHECK HERE, and the absence is deliberate. A segment of
  // two or more readings has had every adjacent pair's monthly figure tested by
  // `monotoneSuffix`, so both endpoints are numbers by construction. The check
  // that used to sit here was unreachable, and the mutation aimed at it was
  // DEAD — it removed a branch no input could enter (Rule 63). The Rule 99
  // hazard it was written for is real and now lives in the suffix walk: without
  // the typeof guard there, `null < 100` is false in JS, so a missing figure
  // would pass for "not a reset", reach this line as null, and make
  // `monthlyDelta` NaN — which fails `excess > FLOOR` and returns a GREEN built
  // out of an absent input. That is what mutation M4 now breaks.
  const m0 = first.ledger_month_used, m1 = last.ledger_month_used;
  const monthlyDelta = m1 - m0;

  // THE SPAN IS WHAT EXCLUDES THE PRE-RESET DAYS, not this slice. Every day
  // before the reset closes before `fromMs`, so `containedDays` drops it either
  // way — passing the segment is agreement with the span, not a second guard.
  // Written down because a mutation aimed at this argument was DEAD: swapping
  // `seg.readings` for `readings` changed no output on any input, and a reader
  // would otherwise take the slice for the thing keeping a 3,799-credit day out
  // of a 1,288-credit delta (Rule 63).
  const days = containedDays(seg.readings, fromMs, toMs).filter(r => typeof r.day_used === 'number');
  if (!days.length)
    return { verdict: 'no-contained-day', from: first.at, to: last.at, ...coverage,
             why: 'no closed UTC day lies entirely inside the reading span' };

  const dailySum = days.reduce((a, r) => a + r.day_used, 0);
  const excess = dailySum - monthlyDelta;
  const base = {
    from: first.at, to: last.at, ...coverage,
    perDay: perDayDeltas(seg.readings),
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

module.exports = { dailyVsMonthly, containedDays, dayStartMs, monotoneSuffix, perDayDeltas, FLOOR, DAY_MS };
