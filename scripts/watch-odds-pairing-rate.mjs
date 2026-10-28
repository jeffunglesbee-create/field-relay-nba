#!/usr/bin/env node
// A backfill run that pays for events and pairs NONE of them is the defect this
// watcher exists for, because it is invisible everywhere else.
//
// WHAT IT IS WATCHING FOR, concretely. Until 2026-09-16 the cron's matcher
// compared team names for equality, and the vendor appends a mascot to every
// college name, so CFB scored 0 of 80 — not poorly, zero. The workflow went
// green every day. `silently-dead-crons.yml` could not see it: the cron was not
// dead, it ran, spent credits and wrote a progress row saying games_processed 0.
// A zero whose denominator is invisible reads as health (Rule 99).
//
// THE SIGNATURE IS UNAMBIGUOUS: credits_used > 0 AND games_processed = 0. The
// run fetched a payload, was billed for it, and paired nothing out of it. There
// is no benign reading — a date with no mappable games spends no credits, and a
// date whose vendor has no data spends credits but is reported separately below
// so the two are never conflated.
//
// THE WINDOW IS OVER BACKFILLED DATES, NOT RUN DATES, and that distinction was
// wrong in this file's own comments until 2026-09-16. odds-backfill.js walks
// "oldest-first from 2026-06-11 -> yesterday" and keys odds_backfill_progress by
// the date it FILLED. So there is never a row for today, and a run that
// succeeds today writes yesterday's row. A --days=1 dispatch at 21:53Z returned
// one row dated 2026-09-15 and none for 09-16, on a day the cron had succeeded.
//
// READ-ONLY. The d1 helper refuses any statement that is not a SELECT.
// --self-test runs the predicate against enumerated synthetic rows and needs no
// network, so the gate can run in CI where D1 is not reachable.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE  = process.env.RELAY_SHARED_SECRET;   // no default: an unset secret must 401, not look set
const SINCE = process.argv.find(a => a.startsWith('--since='))?.split('=')[1] || null;
const DAYS  = Number(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] || 14);
const SELF  = process.argv.includes('--self-test');
const fs    = await import('node:fs').then(m => m.default);
// `Number(x || 0)` inside a sum is what turned 48 unknowns into a confident
// zero on 2026-08-22. total() sums only values that ARE numbers and reports how
// many were not, so an absent credits_used can never arrive here as a 0.
const { total } = await import('./lib/summary-invariants.mjs');

/** The whole judgement, in one place, so the self-test and the live run cannot
 *  diverge. Returns the rows that are the defect. */
export function burnedWithoutPairing(rows) {
  return (rows || []).filter(r => Number(r.credits_used) > 0 && Number(r.games_processed) === 0);
}

/**
 * TWO QUESTIONS, TWO VERDICTS, BECAUSE THE OLD ONE ANSWERED NEITHER.
 *
 * `daySpendVerdict` compared the PROVIDER's cumulative counter delta against
 * OUR ledger's daily ceiling, prorated over the interval. Both halves of that
 * were wrong, and the run on 2026-09-16T21:52Z proved it in one line:
 *
 *   FAIL: the provider billed 1377 where 1232 was allowed
 *   ...a day above the ceiling is the signature of a guard that stopped guarding
 *
 * while the day's actual counter read 1598 of 3800 — 42% of the ceiling — and
 * our own ledger recorded 1467 over that same interval, ninety credits MORE
 * than the provider billed. Nothing had escaped any guard.
 *
 *   (a) TWO POPULATIONS. provider_used counts everything the vendor billed the
 *       account. odds:daily:* counts what this relay charged itself. They stood
 *       19,582 apart on 2026-09-16 and that gap is a known open question — so
 *       subtracting one from the other's ceiling measures the gap, not a guard.
 *
 *   (b) A DAILY CEILING IS NOT A RATE. Spend here is bursty: the closing-odds
 *       capture concentrates in the evening. Prorating 3800/day across a 7.8h
 *       evening window yields 1232 and calls an ordinary evening a breach. The
 *       guard itself never prorates — it compares a running daily total to 3800
 *       and stops. A watch that models the guard differently from the guard is
 *       reporting on a system that does not exist.
 *
 * So: ledgerIntegrityVerdict asks the guard question by comparing the two
 * counters to EACH OTHER over the same interval, and ceilingVerdict asks the
 * ceiling question of the counter the ceiling actually governs, with no
 * arithmetic at all.
 */

// Slack for reading skew: the two counters are fetched in one response but the
// provider figure is cached 60s relay-side, and both are read-modify-write
// counters under concurrent isolates. Below this, a difference is noise.
export const ESCAPE_FLOOR = 50;
// Below this, a counter going backwards is a reconcile refund, not a month
// roll. The two are three orders of magnitude apart: refunds are single- to
// low-triple-digit, a roll drops the whole month (46,341 on 2026-09-16).
export const RESET_FLOOR = 1000;
export const ESCAPE_PCT = 0.05;

/** How much of an escape a fallen-open guard accounts for.
 *
 *  Returns { state, credits } where state is one of:
 *    unreadable   the counter could not be read — NOT the same as none
 *    none         the guard did not degrade in this window
 *    partial      degradation happened but is smaller than the escape
 *    explains     degradation covers the escape
 *
 *  A CUMULATIVE DAILY COUNTER READ AS A LEVEL, WHICH IS WHY prev IS REQUIRED.
 *  odds:degraded:<date> only grows within a day, so the figure relevant to an
 *  interval is the DELTA. Across a date boundary the counter restarts and the
 *  delta would go negative; that is reported as unreadable rather than clamped,
 *  because a clamp would quietly claim "no degradation" on exactly the reading
 *  that spans midnight. */
/*  THE SIGN WAS NEVER THE DATE. docs/CC-CMD-2026-10-12-pairing-degrade-cross-day.md.
 *  The watch runs once a day, so consecutive readings almost always sit on two
 *  different UTC dates, and the `delta < 0` test above only caught the half of
 *  those that came out negative. The other half printed a verdict from one
 *  day's counter minus the previous day's: `explains — 1468` on 2026-10-10 and
 *  `explains — 3297` on 10-11 were exactly that, and measured nothing.
 *
 *  `span` carries both readings' UTC dates and, when they are one day apart,
 *  the PREVIOUS day's closing count from /budget/odds?date=. Across one
 *  midnight the interval's degrades are then exact:
 *      (yesterday's close - yesterday at the last reading) + today so far.
 *  Without that close, or across more than one midnight, the state is
 *  `cross-day` and no number is offered. Two more states:
 *    cross-day    the interval spans midnight and cannot be reconstructed
 *    no-escape    degrades happened, but nothing escaped the ledger for them to
 *                 explain (escaped <= 0) — `explains` there would be a verdict
 *                 about a gap that does not exist */
const nextUtcDate = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

export function degradeVerdict(prevDegraded, currDegraded, escaped, span = {}) {
  const n = (d) => (d && Number.isFinite(Number(d.credits)) ? Number(d.credits) : null);
  const now = n(currDegraded);
  if (now === null) return { state: 'unreadable', credits: null };
  const was = prevDegraded === undefined ? 0 : n(prevDegraded);
  if (was === null) return { state: 'unreadable', credits: null };
  const { prevDate, currDate } = span;
  if (!currDate || (prevDegraded !== undefined && !prevDate)) return { state: 'unreadable', credits: null };
  let delta, parts = null;
  if (prevDegraded === undefined || prevDate === currDate) {
    delta = now - was;
    if (delta < 0) return { state: 'unreadable', credits: null };
  } else if (nextUtcDate(prevDate) === currDate) {
    const close = n(span.prevDayClose);
    if (close === null) return { state: 'cross-day', credits: null, why: 'no-close' };
    if (close < was) return { state: 'unreadable', credits: null };
    delta = (close - was) + now;
    parts = { close, was, now };
  } else {
    return { state: 'cross-day', credits: null, why: 'multi-day' };
  }
  if (delta === 0) return { state: 'none', credits: 0, parts };
  if (!(escaped > 0)) return { state: 'no-escape', credits: delta, parts };
  return { state: delta >= escaped ? 'explains' : 'partial', credits: delta, parts };
}

/** D1 OVERLOAD ON A CLOSED DAY — docs/CC-CMD-2026-10-11-d1-overload-degrades.md,
 *  Task 3. Its own predicate, not a branch of degradeVerdict above: that one asks
 *  whether degrades EXPLAIN a ledger gap; this asks whether the database the odds
 *  guard writes to is failing it.
 *
 *  WHY IT MATTERS IN MONEY. Both guards degrade OPEN on a throw. A daily-path
 *  overload therefore lets a call spend at the vendor with the daily counter
 *  unmoved — and AFTER the ceiling it turns a veto into a spend, because the
 *  vetoed attempt still runs its D1 batch and the throw returns true. Each one is
 *  a vendor call the ceiling did not see.
 *
 *  THE RECORD THIS IS CALIBRATED ON, and it is thin, said plainly: the reasons
 *  map only exists from 2026-10-09T00:44Z. Every sample before that has NO
 *  reasons key, so "0 overloads" there is an absent field, not a zero — reading
 *  it as zero would have manufactured a 22-day clean baseline. The real record
 *  is three closed days: 2026-10-09 0, 2026-10-10 13, 2026-10-11 155.
 *
 *  THE BUDGET IS A RATCHET at 13: the first day overloads appeared, and the day
 *  before the 12x jump. A 10-11-shaped day fails; a 10-10-shaped day passes and
 *  says so. Lower it when a measured week runs lower; raise it only with a
 *  written reason in the same commit.
 *
 *  THE UNIT CHANGED ON 2026-10-18, AND THE NUMBER DID NOT. Until then a charge
 *  was two D1 batches, the day's and the month's, and an overloaded call could
 *  throw in both: the daily catch degraded open, then the month batch ran and
 *  could throw again. 13 was set on 2026-10-12 at the 2026-10-10 level, daily
 *  6 + month 7, i.e. in events, two possible per call. From the cutover
 *  (docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md) the day, the
 *  site and the month are ONE batch, which throws at most once, so the unit is
 *  one event per call, keyed `charge:`. Counted raw, the same D1 pressure would
 *  read up to half what it did and 13 would tolerate twice as many overloaded
 *  calls. So 13 stays in its own unit, PATH EVENTS: a legacy `daily:` or
 *  `month:` overload blinded one ceiling, and a one-batch overload blinds the
 *  day AND the month, so it counts as two. No re-ratchet and no new
 *  measurement: the budget's unit is kept, not changed. The weight is keyed on
 *  the frozen legacy prefixes, so a renamed prefix counts double (fail-closed)
 *  rather than quietly halving.
 *
 *  FIVE STATES, and four of them are not "fine" (Rule 99):
 *    not-reported  the field is absent at daily.degraded_open — the wrong-nesting
 *                  failure that cost three probe revisions on 2026-10-11
 *    unreadable    null (the route's own "could not be read") or not an object
 *    unattributed  events > 0 but no reasons map: degrades happened and their
 *                  causes are invisible — the instrument regressed
 *    none / within / over   read, attributed, and counted against the budget
 *
 *  An absent KV key comes back as {events:0, credits:0, last:null} — a real zero,
 *  read and empty, and the one case where no reasons map is correct. */
export const D1_OVERLOAD_BUDGET = 13;
export const D1_OVERLOAD_MARK   = 'D1 DB is overloaded';
// COUNT-AGNOSTIC since 2026-10-18. It matched only the old month batch's
// `returned 2 result(s), expected 3`; a shape mismatch in the five-statement
// batch reads `returned N result(s), expected 5 (...)` and would have counted 0
// here for good — this column passing vacuously on exactly the 10-09 incident
// class it exists to see.
export const MONTH_BATCH_MARK   = /odds budget batch returned \d+ result\(s\), expected \d+/;
// The overflow bucket's NAME comes from the writer, not a copy of it: if
// budget-helpers.js renames it, a copied string here would silently stop
// matching and an overflowed overload would read as none.
const { DEGRADE_OTHER_KEY, chargedFromBatch, ODDS_CHARGE_ORDER } = await import('../src/budget-helpers.js');
export { DEGRADE_OTHER_KEY };

export function d1OverloadVerdict(block, budget = D1_OVERLOAD_BUDGET) {
  if (block === undefined) return { state: 'not-reported', overloads: null };
  if (block === null || typeof block !== 'object' || Array.isArray(block)) {
    return { state: 'unreadable', overloads: null };
  }
  const events = Number(block.events);
  if (block.events === null || block.events === undefined || !Number.isFinite(events)) {
    return { state: 'unreadable', overloads: null };
  }
  if (events === 0) return { state: 'none', overloads: 0, events: 0, monthBatch: 0, overflow: 0 };
  const reasons = block.reasons;
  if (!reasons || typeof reasons !== 'object' || Array.isArray(reasons)) {
    return { state: 'unattributed', overloads: null, events };
  }
  let overloads = 0, pathBlind = 0, monthBatch = 0, overflow = 0;
  for (const [k, v] of Object.entries(reasons)) {
    const n = Number(v) || 0;
    if (k.includes(D1_OVERLOAD_MARK)) overloads += n;
    if (k.includes(D1_OVERLOAD_MARK)) pathBlind += (k.startsWith('daily:') || k.startsWith('month:')) ? n : 2 * n;
    if (MONTH_BATCH_MARK.test(k)) monthBatch += n;
    if (k === DEGRADE_OTHER_KEY) overflow += n;
  }
  const base = { overloads, pathBlind, events, monthBatch, overflow, budget };
  if (overloads === 0) return { state: 'none', ...base };
  return { state: pathBlind > budget ? 'over' : 'within', ...base };
}

/** CI SPENDS AT THE VENDOR WITHOUT TOUCHING OUR LEDGER, BY CONSTRUCTION.
 *  odds-backfill.js runs in GitHub Actions and calls the Odds API directly;
 *  consumeOddsCredit lives in the worker and never sees it. So a positive
 *  `escaped` is not automatically leakage — part of it is CI doing its job.
 *
 *  Measured 2026-09-17: escaped 427 over 17.5h, while the backfill spends at
 *  most 80 on a day (2026-09-16: 80 credits, 8 games paired). Subtracting the
 *  known part is the difference between "427 unexplained" and "347", and only
 *  the second number is worth anyone's afternoon.
 *
 *  THE JOIN IS completed_at, NOT date. odds_backfill_progress is keyed by the
 *  date BACKFILLED — a run today writes yesterday's row — so `date` says
 *  nothing about when the credits were spent. completed_at is
 *  `datetime('now')` at write time, which is the run clock and the right one.
 *
 *  SQLite writes `YYYY-MM-DD HH:MM:SS` with no zone marker. It is UTC, and the
 *  T/Z are added here rather than assuming Date.parse guesses right — a naive
 *  string parsed as local time would shift the window by hours and silently
 *  include or drop a run. */
export { asUtc } from './lib/utc.mjs';
const { asUtc: _asUtc } = await import('./lib/utc.mjs');

/** Credits the backfill spent INSIDE [fromISO, toISO]. A LOWER BOUND on what
 *  is legitimately outside the ledger: the backfill is the only CI spender
 *  that records itself, so probes and one-off fills are not in this number. */
// Moved to ./lib/ci-spend.mjs so the daily-vs-vendor watch subtracts the SAME
// number the same way. Re-exported here because this file's callers and its
// self-test both name it.
export { ciSpendInInterval } from './lib/ci-spend.mjs';
const { ciSpendInInterval } = await import('./lib/ci-spend.mjs');

const _num = (v) => (v === null || v === undefined || String(v).trim() === ''
  ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

/**
 * Did spend reach the provider without reaching our ledger?
 * `escaped` = providerDelta - ledgerDelta over the same interval. Positive
 * means the vendor billed for calls our counters never saw, which IS the
 * degraded-open signature. Negative means our ledger charged more than the
 * vendor billed, which is the reconcile direction and is not a fault.
 */
export function ledgerIntegrityVerdict(prev, curr, outsideLedger = 0) {
  const pNow = _num(curr?.provider_used), lNow = _num(curr?.ledger_month_used);
  if (pNow === null || lNow === null) return { state: 'unreadable', over: false };
  if (!prev) return { state: 'no_baseline', over: false };
  const pWas = _num(prev.provider_used), lWas = _num(prev.ledger_month_used);
  if (pWas === null || lWas === null) return { state: 'unreadable', over: false };

  const elapsedH = (Date.parse(curr.at) - Date.parse(prev.at)) / 3600000;
  if (!Number.isFinite(elapsedH) || elapsedH <= 0) return { state: 'unreadable', over: false };

  const providerDelta = pNow - pWas;
  const ledgerDelta   = lNow - lWas;
  // A MONTH ROLL DROPS A COUNTER BY TENS OF THOUSANDS. A RECONCILE REFUND DROPS
  // IT BY TWO. The first version tested `< 0` on either counter and, thirteen
  // minutes after shipping, called 52075 -> 52073 a monthly reset: an ordinary
  // refund landing between two closely-spaced readings. reconcileOddsCredit
  // subtracts from odds:credits:* whenever the vendor billed less than the
  // estimate, so a small negative ledger delta is the system working.
  //
  // RESET_FLOOR separates them by MAGNITUDE rather than by sign. Anything
  // smaller is arithmetic and stays in the subtraction, where a refund makes
  // `escaped` slightly larger — which is the honest direction, since those
  // credits did reach the vendor.
  if (providerDelta < -RESET_FLOOR || ledgerDelta < -RESET_FLOOR) {
    return { state: 'counter_reset', over: false, providerDelta, ledgerDelta, elapsedH };
  }
  const escaped = providerDelta - ledgerDelta;
  // The verdict is on what is UNEXPLAINED, not on the raw escape. CI spends at
  // the vendor without touching our counters by construction, so charging that
  // to "a guard stopped guarding" is the two-populations error again, one layer
  // in. outsideLedger is a LOWER bound (only the backfill records itself), so
  // `unexplained` is an UPPER bound on real leakage — the safe direction.
  const unexplained = escaped - Math.max(0, Number(outsideLedger) || 0);
  const tolerance = Math.max(ESCAPE_FLOOR, Math.round(ESCAPE_PCT * providerDelta));
  return {
    state: unexplained > tolerance ? 'spend_escaped_the_ledger' : 'ledger_captured_all',
    over: unexplained > tolerance,
    providerDelta, ledgerDelta, escaped, outsideLedger, unexplained, tolerance,
    elapsedH: Math.round(elapsedH * 10) / 10,
  };
}

/**
 * Was the daily ceiling breached? Asked of odds:daily:* directly, because that
 * is the counter chargeOdds compares against. No interval, no
 * proration — the guard does not prorate, so neither does this.
 */
export function ceilingVerdict(daily) {
  const used = _num(daily?.used), ceiling = _num(daily?.ceiling);
  if (used === null || ceiling === null || ceiling <= 0) return { state: 'unreadable', over: false };
  return {
    state: used > ceiling ? 'over_ceiling' : 'within_ceiling',
    over: used > ceiling,
    used, ceiling, pct: Math.round(100 * used / ceiling),
  };
}

/**
 * Did the guard refuse a call on the closed day? chargeOdds refuses on two
 * limits and nothing else, and stamps each the first time it refuses: the daily
 * ceiling as odds:daily:<date>:warned, served by /budget/odds?date= as
 * ceiling_reached_at, and the monthly limit as odds:credits:<month>:warned:limit,
 * served as month_limit_reached_at for the month of the date asked about. Since
 * 2026-10-28 a third refuses: a PER-SITE cap, stamped per site as
 * odds:daily:<date>:warned:site:<site> and served as site_ceiling_reached_at, an
 * object of {site: ISO | true | null} over the capped sites (Task 3 of
 * docs/CC-CMD-2026-09-16-odds-spend-attribution.md). No
 * caller reads a refusal (none checks `guarded`), so this is the one place it
 * can show (docs/CC-CMD-2026-10-23-odds-ceiling-prerequisites.md, fix 3).
 * ceilingVerdict above asks a different question: whether the guard LET a call
 * through past the ceiling.
 *
 * A stamp says when the guard FIRST refused. It does not say every later call
 * was refused: the check is per call, and refunds lower the counter.
 *
 * Until 2026-10-23 the month was read as the current month's headroom, which on
 * the 1st is the new month's, and the day stamp lived 24 hours, so a morning
 * ceiling was gone by the next afternoon's read. Both stamps are now served for
 * the day itself.
 *
 * A missing field is not a clean day (Rule 99): `not-reported`. Nor is a stamp
 * whose read failed: the route names it in stamps_unreadable (fix 3 D), and its
 * null then means unknown. A stamp that was read and shows a refusal still
 * counts, whatever else failed.
 */
export function refusalVerdict(day) {
  const has = (k) => !!day && Object.prototype.hasOwnProperty.call(day, k);
  if (!has('ceiling_reached_at') || !has('month_limit_reached_at') || typeof day.date !== 'string') return { state: 'not-reported' };
  if (day.ceiling_reached_at) return { state: 'day-ceiling', at: day.ceiling_reached_at };
  const m = day.month_limit_reached_at;
  // `true` is a stamp without an hour: reached, when unknown, so it counts.
  if (m === true) return { state: 'month-limit', at: null };
  // An hour after the closed day means the limit was reached later, not on it.
  if (typeof m === 'string' && m.slice(0, 10) <= day.date) return { state: 'month-limit', at: m };
  // A SITE'S CAP. The day and the month had room, and one consumer was turned
  // away. The field is an object over the capped sites; anything else (absent,
  // null, an array) is a relay that does not report it, which is not a clean day.
  const sites = day.site_ceiling_reached_at;
  if (!sites || typeof sites !== 'object' || Array.isArray(sites)) return { state: 'not-reported', missing: 'site_ceiling_reached_at' };
  const hit = Object.entries(sites).filter(([, v]) => v);
  if (hit.length) {
    const hours = hit.map(([, v]) => v).filter((v) => typeof v === 'string').sort();
    // Each site with ITS OWN hour (null = reached, hour unknown), so a report can
    // pair them; `at` is the earliest of them.
    const named = hit.map(([k, v]) => ({ site: k, at: typeof v === 'string' ? v : null })).sort((a, b) => a.site < b.site ? -1 : 1);
    return { state: 'site-ceiling', at: hours.length ? hours[0] : null, sites: named };
  }
  if (Array.isArray(day.stamps_unreadable) && day.stamps_unreadable.length) return { state: 'not-reported', unreadable: day.stamps_unreadable };
  return { state: 'none' };
}

if (SELF) {
  const CASES = [
    [{ date: 'a', credits_used: 20, games_processed: 0 },  true,  'paid and paired nothing — the 0-of-80 signature'],
    [{ date: 'b', credits_used: 20, games_processed: 1 },  false, 'paid and paired one — working, however thinly'],
    [{ date: 'c', credits_used: 0,  games_processed: 0 },  false, 'spent nothing, so there was nothing to pair'],
    [{ date: 'd', credits_used: 0,  games_processed: 5 },  false, 'paired without spending — a cached or resumed run'],
    [{ date: 'e', credits_used: '20', games_processed: '0' }, true, 'D1 returns strings; the predicate must still fire'],
    [{ date: 'f', credits_used: 20, games_processed: null }, true, 'a null pairing count is zero pairings, not unknown'],
  ];
  let bad = 0;
  for (const [row, want, why] of CASES) {
    const got = burnedWithoutPairing([row]).length === 1;
    got === want ? console.log(`  PASS  ${row.date}: flagged=${got}  (${why})`)
                 : (bad++, console.log(`  FAIL  ${row.date}: flagged=${got} want ${want}  (${why})`));
  }

  const D = (h) => new Date(Date.parse('2026-09-16T11:00:00Z') + h * 3600000).toISOString();
  const R = (h, provider, ledger) => ({ at: D(h), provider_used: provider, ledger_month_used: ledger });

  // THE FIRST CASE IS THE RUN THAT EXPOSED THE OLD VERDICT, to the credit.
  const INTEGRITY = [
    [R(0, 64546, 44874), R(7.78, 65923, 46341), 'ledger_captured_all',
     'the real 2026-09-16 evening: provider +1377, ledger +1467 — the old check called this a breach'],
    [null, R(0, 100, 100), 'no_baseline', 'the first reading has nothing to subtract from'],
    [R(0, 1000, 1000), R(24, 4000, 4000), 'ledger_captured_all', 'both counters moved together'],
    [R(0, 1000, 1000), R(24, 4000, 1200), 'spend_escaped_the_ledger',
     'the vendor billed 3000 and our counters saw 200 — the degraded-open signature'],
    [R(0, 1000, 1000), R(24, 4000, 3960), 'ledger_captured_all',
     '40 apart on a 3000 delta is inside the floor, not a finding'],
    [R(0, 1000, 1000), R(24, 4000, 2800), 'spend_escaped_the_ledger',
     '200 apart on 3000 is over the 150 tolerance'],
    // NUMBERS UPDATED 2026-09-17. This case used a 100-credit drop to stand for
    // a month roll-over, which RESET_FLOOR now correctly calls a refund. A real
    // roll drops the whole month — 46,341 on 2026-09-16 — so the case says so.
    [R(0, 61000, 46000), R(24, 900, 40), 'counter_reset', 'the month rolled over; not an error'],
    [R(0, 1000, 1000), R(24, '4000', '4000'), 'ledger_captured_all', 'the provider sends a STRING; it must still subtract'],
    [R(0, 1000, 1000), R(24, null, 4000), 'unreadable', 'an absent provider reading is not a zero-spend day'],
    [R(0, 1000, 1000), R(24, 4000, null), 'unreadable', 'an absent LEDGER reading is not a zero either'],
    [R(0, 1000, 1000), R(0, 4000, 4000), 'unreadable', 'a zero-length interval cannot be divided'],
  ];
  for (const [prev, curr, want, why] of INTEGRITY) {
    const got = ledgerIntegrityVerdict(prev, curr).state;
    got === want ? console.log(`  PASS  integrity: ${want.padEnd(25)} (${why})`)
                 : (bad++, console.log(`  FAIL  integrity: got ${got} want ${want}  (${why})`));
  }

  const CEILING = [
    [{ used: 1598, ceiling: 3800 }, 'within_ceiling', 'the real 2026-09-16 day — 42% of the cap, which the old check failed'],
    [{ used: 3800, ceiling: 3800 }, 'within_ceiling', 'exactly at the cap is not over it; the guard blocks the call that would exceed'],
    [{ used: 3801, ceiling: 3800 }, 'over_ceiling', 'one credit past the cap means the guard let something through'],
    [{ used: 0, ceiling: 3800 }, 'within_ceiling', 'a quiet day is not a ceiling problem — the gap watch owns that question'],
    [{ used: null, ceiling: 3800 }, 'unreadable', 'Number(null) is 0 and would read as a perfectly clean day'],
    [{ used: 100, ceiling: 0 }, 'unreadable', 'a zero ceiling is a missing ceiling, not a cap of nothing'],
  ];
  // ── CI spend, subtracted from the escape so the alarm is on the residual ──
  // This file had no scalar assertion helper — the loops above count `bad`
  // inline. One is defined here rather than reshaping them (Rule 69).
  let ones = 0;
  const one = (label, got, want, why) => (ones++, got === want)
    ? console.log(`  PASS  ${label} -> ${got}  (${why})`)
    : (bad++, console.log(`  FAIL  ${label}: got ${got} want ${want}  (${why})`));
  const PR = (completed_at, credits_used) => ({ date: 'x', completed_at, credits_used });
  const FROM = '2026-09-16T21:53:00Z', TO = '2026-09-17T15:24:00Z';
  const ciw = (rows) => ciSpendInInterval(rows, FROM, TO);

  // THIS CASE SPAWNS A CHILD WITH A NON-UTC TZ ON PURPOSE. Run in-process it
  // proves nothing: GitHub runners and this sandbox are both UTC, so a bare
  // `Date.parse('2026-09-17 06:00:00')` — which V8 reads as LOCAL time —
  // returns the identical value and the mutation that removes the Z is
  // equivalent. Mutation M38 came back NOT CAUGHT for exactly that reason. The
  // hazard is real on any other runner, so the case forces the condition
  // rather than the property being dropped for being untestable here.
  {
    const { spawnSync } = await import('node:child_process');
    // IMPORTS THE REAL MODULE. An inline copy of the logic here is what made
    // M38 uncatchable the first time — the child was testing a duplicate.
    const code = `const { asUtc } = await import('./scripts/lib/utc.mjs');` +
      `process.stdout.write(String(asUtc('2026-09-17 06:00:00')));`;
    const run = (tz) => spawnSync(process.execPath, ['--input-type=module', '-e', code],
      { env: { ...process.env, TZ: tz }, encoding: 'utf8' }).stdout;
    one('a SQLite timestamp is UTC even on a non-UTC runner',
        run('America/New_York'), String(Date.parse('2026-09-17T06:00:00Z')),
        'the child runs at UTC-4; a local parse would be 4 hours out and move runs across the window edge');
    one('and is unchanged on a UTC runner', run('UTC'), String(Date.parse('2026-09-17T06:00:00Z')),
        'the control — this is the one that passes either way, which is why it cannot stand alone');
  }
  one('the in-process helper agrees', _asUtc('2026-09-17 06:00:00'), Date.parse('2026-09-17T06:00:00Z'),
      'the real exported function, on this runner');
  one('an ISO timestamp still works', _asUtc('2026-09-17T06:00:00Z'), Date.parse('2026-09-17T06:00:00Z'), 'both shapes');
  one('a run inside the window',  ciw([PR('2026-09-17 06:00:00', 80)]).credits, 80, 'counted');
  one('a run before the window',  ciw([PR('2026-09-16 10:00:00', 80)]).credits, 0,  'yesterday, already in the last reading');
  one('a run after the window',   ciw([PR('2026-09-17 20:00:00', 80)]).credits, 0,  'has not happened yet as far as this reading knows');
  one('two runs inside',          ciw([PR('2026-09-17 06:00:00', 80), PR('2026-09-17 07:00:00', 20)]).credits, 100, 'summed');
  one('an undated row is not subtracted', ciw([PR(null, 80)]).credits, 0,
      'a row that cannot be placed must not inflate the subtraction and shrink the residual on no evidence');
  one('an undated row is COUNTED',        ciw([PR(null, 80)]).undated, 1, 'reported, not swallowed');
  one('a non-numeric credit is undated',  ciw([PR('2026-09-17 06:00:00', 'oops')]).undated, 1, 'same rule');

  // The real 2026-09-17 numbers: the escape was 427 and the backfill spent 80.
  const IV = (outside) => ledgerIntegrityVerdict(
    { at: FROM, provider_used: 66079, ledger_month_used: 46341 },
    { at: TO,   provider_used: 68472, ledger_month_used: 48307 }, outside);
  // The 2026-09-17T20:19Z run: ledger 52075 -> 52073, a 2-credit refund that the
  // first version of this predicate announced as a monthly reset.
  const RS = (pLedger, cLedger) => ledgerIntegrityVerdict(
    { at: '2026-09-17T20:13:00Z', provider_used: 72312, ledger_month_used: pLedger },
    { at: '2026-09-17T20:19:00Z', provider_used: 72312, ledger_month_used: cLedger }, 0);
  one('a 2-credit refund is NOT a reset', RS(52075, 52073).state, 'ledger_captured_all',
      'the real reading that exposed this — reconcile refunds run constantly');
  one('a refund makes the escape slightly larger', RS(52075, 52073).escaped, 2,
      'honest direction: those credits did reach the vendor');
  // A KNOWN LIMITATION, PINNED RATHER THAN HIDDEN. A refund corrects a charge
  // made in an EARLIER interval, so inside this one it makes ledgerDelta
  // negative and `escaped` grows by the refund. Below RESET_FLOOR it is
  // correctly not a reset — but a large refund with no provider movement does
  // read as escape. Two cumulative counters compared over a short window cannot
  // tell a correction from a leak; over a day the refunds wash out. The case
  // asserts the real behaviour so nobody rediscovers it as a bug.
  one('a 999-credit refund is not a reset', RS(52075, 52075 - 999).state !== 'counter_reset', true,
      'inside the floor — it is arithmetic, not a roll');
  one('but a large refund DOES inflate the escape', RS(52075, 52075 - 999).escaped, 999,
      'the limitation: a correction to an earlier interval reads as escape inside this one');
  one('a month roll IS a reset', RS(52075, 40).state, 'counter_reset', 'the whole month drops, not two credits');
  one('a provider roll is a reset too', ledgerIntegrityVerdict(
      { at: '2026-09-17T20:13:00Z', provider_used: 72312, ledger_month_used: 100 },
      { at: '2026-09-17T20:19:00Z', provider_used: 120, ledger_month_used: 100 }, 0).state,
      'counter_reset', 'the vendor counter rolls on its own clock');

  one('the real escape, nothing subtracted', IV(0).unexplained, 427, 'what the watch reported before this change');
  one('the real escape, backfill subtracted', IV(80).unexplained, 347, 'the number actually worth an afternoon');
  one('subtracting does not flip the verdict here', IV(80).state, 'spend_escaped_the_ledger',
      '347 still exceeds the 120 tolerance — the residual is real, just smaller');
  one('a fully explained escape', IV(427).state, 'ledger_captured_all', 'all of it was CI; nothing leaked');
  one('a negative outsideLedger cannot inflate', IV(-500).unexplained, 427,
      'clamped at 0, so a bad input can never manufacture leakage');

  // ── did a guard fall open? the last surviving candidate for the 347 ──────
  const DG = (credits) => ({ events: 1, credits, last: 'x' });
  const SAME = { prevDate: '2026-10-10', currDate: '2026-10-10' };
  one('no degradation',        degradeVerdict(DG(0), DG(0), 347, SAME).state, 'none', 'the counter did not move');
  one('none is reported as 0', degradeVerdict(DG(0), DG(0), 347, SAME).credits, 0, 'a real zero, distinguishable from unreadable');
  one('degradation explains it',  degradeVerdict(DG(0), DG(400), 347, SAME).state, 'explains', '400 covers a 347 escape');
  one('degradation covers exactly', degradeVerdict(DG(0), DG(347), 347, SAME).state, 'explains', 'equal counts as covered');
  one('degradation is partial',   degradeVerdict(DG(100), DG(200), 347, SAME).state, 'partial', '100 of 347 — real, but not the whole story');
  one('the DELTA is used, not the level', degradeVerdict(DG(1000), DG(1100), 347, SAME).credits, 100,
      'the counter is cumulative per day; a level would claim 1100 on an interval that saw 100');
  one('an unreadable counter is not zero', degradeVerdict(DG(0), null, 347, SAME).state, 'unreadable',
      'Number(null) is 0 and would print "no guard degraded" on no evidence — Rule 99, in the instrument');
  one('an unreadable BASELINE is not zero', degradeVerdict(null, DG(50), 347, SAME).state, 'unreadable',
      'the older readings predate this field; a missing baseline cannot be subtracted from');
  one('a first reading treats absence as 0', degradeVerdict(undefined, DG(50), 347, SAME).credits, 50,
      'undefined means there was no prior reading at all, which is different from one that could not be read');
  one('a same-day decrease is unreadable', degradeVerdict(DG(900), DG(20), 347, SAME).state, 'unreadable',
      'the counter only grows within a day; going backwards is a bad read, and clamping would claim "no degradation"');
  one('a call with no dates is unreadable', degradeVerdict(DG(0), DG(400), 347).state, 'unreadable',
      'the old three-argument call: without dates there is no knowing whether the counter restarted');

  // CROSS-DAY. docs/CC-CMD-2026-10-12-pairing-degrade-cross-day.md. The real
  // pairs from outbox/odds-provider-usage-series.json first.
  const R1010 = { credits: 2552 }, R1011 = { credits: 5849 }, R1012 = { credits: 0 };
  const X = (prevDate, currDate, prevDayClose) => ({ prevDate, currDate, prevDayClose });
  one('real 10-10 -> 10-11 without the close is cross-day', degradeVerdict(R1010, R1011, 347, X('2026-10-10', '2026-10-11')).state, 'cross-day',
      'printed "explains — 3297" on 2026-10-11: one day\'s counter minus the previous day\'s');
  one('real 10-10 -> 10-11 offers no number', degradeVerdict(R1010, R1011, 347, X('2026-10-10', '2026-10-11')).credits, null,
      'a cross-day difference is not a quantity of anything');
  one('real 10-11 -> 10-12 with the close is exact', degradeVerdict(R1011, R1012, -322, X('2026-10-11', '2026-10-12', { credits: 5995 })).credits, 146,
      '10-11 closed at 5995 (closed-day read, 2026-10-12): 5995 - 5849 + 0');
  one('real 10-11 -> 10-12 has nothing to explain', degradeVerdict(R1011, R1012, -322, X('2026-10-11', '2026-10-12', { credits: 5995 })).state, 'no-escape',
      'UNEXPLAINED was -322: the ledger charged MORE than the vendor billed, so "explains" would be about a gap that is not there');
  one('across midnight, enough covers it', degradeVerdict(DG(100), DG(50), 200, X('2026-10-11', '2026-10-12', DG(300))).state, 'explains',
      '(300 - 100) + 50 = 250 covers a 200 escape');
  one('across midnight, the sum is used', degradeVerdict(DG(100), DG(50), 400, X('2026-10-11', '2026-10-12', DG(300))).credits, 250,
      'the close minus the last reading, plus today so far');
  one('across midnight, too little is partial', degradeVerdict(DG(100), DG(50), 400, X('2026-10-11', '2026-10-12', DG(300))).state, 'partial',
      '250 of 400');
  one('two midnights is cross-day', degradeVerdict(DG(100), DG(50), 200, X('2026-10-10', '2026-10-12', DG(300))).state, 'cross-day',
      'one close cannot bridge two days');
  one('a close below the last reading is unreadable', degradeVerdict(DG(400), DG(50), 200, X('2026-10-11', '2026-10-12', DG(300))).state, 'unreadable',
      'a day cannot close lower than it already was');
  one('a missing previous date is unreadable', degradeVerdict(DG(100), DG(50), 200, { currDate: '2026-10-12' }).state, 'unreadable',
      'without the previous date there is no way to know whether the counter restarted');
  one('a month boundary is one midnight', degradeVerdict(DG(10), DG(5), 100, X('2026-09-30', '2026-10-01', DG(40))).credits, 35,
      'date arithmetic, not string arithmetic: 09-30 + 1 day is 10-01');

  // D1 OVERLOAD ON A CLOSED DAY. The three real days first, verbatim from
  // outbox/odds-site-drift-series.json, so the calibration is the record.
  const OVL = 'daily: D1_ERROR: D1 DB is overloaded. Requests queued for too long.';
  const OVM = 'month: D1_ERROR: D1 DB is overloaded. Requests queued for too long.';
  const MB  = 'month: odds budget batch returned 2 result(s), expected 3';
  const day09 = { events: 801, credits: 2997, reasons: { [MB]: 801 }, last: '2026-10-09T21:00:54Z' };
  const day10 = { events: 925, credits: 4431, reasons: { [MB]: 912, [OVL]: 6, [OVM]: 7 } };
  const day11 = { events: 1230, credits: 5995, reasons: { [MB]: 1075, [OVL]: 77, [OVM]: 78 } };
  one('real 2026-10-09: reasons present, no overload', d1OverloadVerdict(day09).state, 'none',
      'a read, attributed zero — the only clean day on record');
  one('real 2026-10-10: 13 overloads sits AT the budget', d1OverloadVerdict(day10).state, 'within',
      'the budget is 13, set on this day');
  one('real 2026-10-10: both paths are summed', d1OverloadVerdict(day10).overloads, 13,
      'daily 6 + month 7 — counting one path would report half the failures');
  one('real 2026-10-11 FAILS', d1OverloadVerdict(day11).state, 'over',
      'the 12x day; a watch that passed it would be the reason this document exists');
  one('the month-batch reason is reported beside it', d1OverloadVerdict(day11).monthBatch, 1075,
      'a free daily runtime check on the batch-shape fix: post-fix this must read 0');

  // FROM THE 2026-10-18 CUTOVER: one batch, one catch, one prefix. Both keys are
  // built from what the worker would write, not typed out: the shape error is
  // the message chargedFromBatch really throws for the five-statement batch.
  let SHAPE5 = null;
  try { chargedFromBatch([{ results: [] }, { results: [] }, { results: [] }], ODDS_CHARGE_ORDER); }
  catch (e) { SHAPE5 = `charge: ${e.message}`; }
  const OVC = 'charge: D1_ERROR: D1 DB is overloaded. Requests queued for too long.';
  const dayCut = { events: 9, credits: 27, reasons: { [OVC]: 5, [SHAPE5]: 4 } };
  one('a five-statement shape error is counted as a batch-shape reason', d1OverloadVerdict(dayCut).monthBatch, 4,
      `the real message is ${JSON.stringify(SHAPE5)}; a mark fixed to "2 ... expected 3" reads it as 0 for good`);
  one('a single-path overload, keyed charge:, is counted', d1OverloadVerdict(dayCut).overloads, 5,
      'after the cutover an overload is one event per call under charge: — a count keyed to daily:/month: sees none');
  one('six one-batch overloaded calls read 12 path events, within', d1OverloadVerdict({ events: 6, reasons: { [OVC]: 6 } }).state, 'within', '6 x 2 = 12');
  one('seven one-batch overloaded calls FAIL, as seven both-path calls did pre-cutover', d1OverloadVerdict({ events: 7, reasons: { [OVC]: 7 } }).state, 'over', '7 x 2 = 14 > 13');
  one('real 2026-10-10 keeps its calibration: 13 legacy path events, within', d1OverloadVerdict(day10).state, 'within', 'the day the budget was set on');
  one('a renamed prefix counts double, not once (fail-closed)', d1OverloadVerdict({ events: 7, reasons: { ['batch: D1_ERROR: D1 DB is overloaded. Requests queued for too long.']: 7 } }).state, 'over', '7 x 2 = 14 > 13');

  // RULE 99, and both lessons from the three probe revisions on 2026-10-11.
  one('undefined is not-reported, not zero', d1OverloadVerdict(undefined).state, 'not-reported',
      'the field missing at daily.degraded_open — the wrong-nesting failure');
  one('null is unreadable, not zero', d1OverloadVerdict(null).state, 'unreadable',
      'the route returns null when the KV read failed; ?? 0 here is the original defect');
  one('a non-object is unreadable', d1OverloadVerdict([]).state, 'unreadable');
  one('events missing is unreadable, not zero', d1OverloadVerdict({ credits: 0 }).state, 'unreadable',
      'Number(undefined) is NaN — caught by the finiteness test alone');
  // The case the line above does NOT cover, found by mutation P7 surviving: the
  // explicit null guard existed and nothing proved it. Number(null) is 0, which
  // is finite, so without the guard this reads as a real, read, empty day.
  one('events NULL is unreadable, not zero', d1OverloadVerdict({ events: null, credits: 0 }).state, 'unreadable',
      'Number(null) is 0 and finite — only the explicit null check stops it reading as a clean day');
  one('an absent KV key is a REAL zero', d1OverloadVerdict({ events: 0, credits: 0, last: null }).state, 'none',
      'the one shape where no reasons map is correct');
  one('events without reasons is UNATTRIBUTED', d1OverloadVerdict({ events: 245, credits: 1263 }).state, 'unattributed',
      'every sample before 2026-10-09T00:44Z looked like this; reading it as zero manufactures a clean baseline');
  one('the overflow bucket is surfaced, not dropped',
      d1OverloadVerdict({ events: 9, reasons: { [DEGRADE_OTHER_KEY]: 9 } }).overflow, 9,
      'overloads past the 8-reason cap land here and would otherwise read as none');
  one('an explicit budget is honoured', d1OverloadVerdict(day10, 12).state, 'over');

  for (const [daily, want, why] of CEILING) {
    const got = ceilingVerdict(daily).state;
    got === want ? console.log(`  PASS  ceiling: ${want.padEnd(27)} (${why})`)
                 : (bad++, console.log(`  FAIL  ceiling: got ${got} want ${want}  (${why})`));
  }

  const RD = '2026-10-31';
  // The capped sites as /budget/odds serves them: every one read, none refused.
  const NS = { ambientCaptureClosingOdds: null, fetchSportOddsLive: null, fetchSportOddsHistorical: null, getWCPregameLambdas: null };
  const REFUSAL = [
    [{ site_ceiling_reached_at: NS, date: RD, ceiling_reached_at: '2026-10-31T20:00:00.000Z', month_limit_reached_at: null }, 'day-ceiling', 'a stamped day: the ceiling first refused a call then (synthetic instant)'],
    [{ site_ceiling_reached_at: NS, date: '2026-10-22', ceiling_reached_at: null, month_limit_reached_at: null }, 'none', 'the real 2026-10-22 close: neither stamp'],
    [{ site_ceiling_reached_at: NS, date: RD, used: 1521, month_limit_reached_at: null }, 'not-reported', 'no ceiling_reached_at field at all is not a clean day (Rule 99)'],
    [{ site_ceiling_reached_at: NS, date: RD, ceiling_reached_at: null }, 'not-reported', 'no month_limit_reached_at field (a relay before fix 3 B) is not a clean day'],
    [{ site_ceiling_reached_at: NS, ceiling_reached_at: null, month_limit_reached_at: null }, 'not-reported', 'no date: the month stamp cannot be judged against the day'],
    [{ site_ceiling_reached_at: NS, date: RD, ceiling_reached_at: null, month_limit_reached_at: '2026-10-31T22:00:00.000Z' }, 'month-limit', 'the month limit first refused on the closed day itself (synthetic instant)'],
    [{ site_ceiling_reached_at: NS, date: RD, ceiling_reached_at: null, month_limit_reached_at: '2026-10-29T09:00:00.000Z' }, 'month-limit', 'reached two days before: it was still in force'],
    [{ site_ceiling_reached_at: NS, date: '2026-10-28', ceiling_reached_at: null, month_limit_reached_at: '2026-10-29T09:00:00.000Z' }, 'none', 'reached the day after: the closed day had no month refusal'],
    [{ site_ceiling_reached_at: NS, date: RD, ceiling_reached_at: null, month_limit_reached_at: true }, 'month-limit', 'a stamp with no hour is reached, hour unknown'],
    [{ site_ceiling_reached_at: NS, date: RD, ceiling_reached_at: null, month_limit_reached_at: null, stamps_unreadable: ['month_limit_reached_at'] }, 'not-reported', 'the month stamp could not be read: its null is unknown, not clean (Rule 99)'],
    [{ site_ceiling_reached_at: NS, date: RD, ceiling_reached_at: '2026-10-31T20:00:00.000Z', month_limit_reached_at: null, stamps_unreadable: ['month_limit_reached_at'] }, 'day-ceiling', 'a stamp that was read and shows a refusal counts, whatever else failed'],
    [{ site_ceiling_reached_at: NS, date: RD, ceiling_reached_at: null, month_limit_reached_at: null, stamps_unreadable: null }, 'none', 'both stamps read, neither set'],
    [{ site_ceiling_reached_at: NS, date: RD, ceiling_reached_at: null, month_limit_reached_at: '2026-11-01T09:00:00.000Z', stamps_unreadable: ['ceiling_reached_at'] }, 'not-reported', 'the day stamp is unread and the month limit came after the day: unknown, not clean'],
    [{ site_ceiling_reached_at: NS, date: RD, ceiling_reached_at: null, month_limit_reached_at: '2026-10-29T09:00:00.000Z', stamps_unreadable: ['ceiling_reached_at'] }, 'month-limit', 'the day stamp is unread, but a month refusal that was read is in force'],
    [{ date: RD, ceiling_reached_at: null, month_limit_reached_at: null, site_ceiling_reached_at: { ...NS, ambientCaptureClosingOdds: '2026-10-31T20:00:00.000Z' } }, 'site-ceiling', 'a capped consumer was turned away while the day and the month had room (synthetic instant)'],
    [{ date: RD, ceiling_reached_at: null, month_limit_reached_at: null, site_ceiling_reached_at: { ...NS, fetchSportOddsLive: true } }, 'site-ceiling', 'a site stamp with no hour is reached, hour unknown'],
    [{ date: RD, ceiling_reached_at: null, month_limit_reached_at: null }, 'not-reported', 'no site_ceiling_reached_at field (a relay before the per-site caps) is not a clean day'],
    [{ date: RD, ceiling_reached_at: null, month_limit_reached_at: null, site_ceiling_reached_at: null }, 'not-reported', 'a null site field is not an object of stamps'],
    [{ date: RD, ceiling_reached_at: null, month_limit_reached_at: null, site_ceiling_reached_at: [] }, 'not-reported', 'an array is not an object of stamps'],
    [{ date: RD, ceiling_reached_at: null, month_limit_reached_at: null, site_ceiling_reached_at: NS, stamps_unreadable: ['site_ceiling_reached_at'] }, 'not-reported', 'the site stamps could not be read: their nulls are unknown, not clean (Rule 99)'],
    [{ date: RD, ceiling_reached_at: null, month_limit_reached_at: null, site_ceiling_reached_at: { ...NS, getWCPregameLambdas: '2026-10-31T09:00:00.000Z' }, stamps_unreadable: ['site_ceiling_reached_at'] }, 'site-ceiling', 'a site stamp that was read and shows a refusal counts, although another could not be read'],
    [{ date: RD, ceiling_reached_at: '2026-10-31T20:00:00.000Z', month_limit_reached_at: null, site_ceiling_reached_at: { ...NS, getWCPregameLambdas: '2026-10-31T09:00:00.000Z' } }, 'day-ceiling', 'the day stamp is named first when both refused'],
    [{ date: RD, ceiling_reached_at: null, month_limit_reached_at: '2026-10-29T09:00:00.000Z', site_ceiling_reached_at: { ...NS, getWCPregameLambdas: '2026-10-31T09:00:00.000Z' } }, 'month-limit', 'the month limit is named before a site cap'],
    [{ date: '2026-10-28', ceiling_reached_at: null, month_limit_reached_at: '2026-10-29T09:00:00.000Z', site_ceiling_reached_at: { ...NS, ambientCaptureClosingOdds: '2026-10-28T20:00:00.000Z' } }, 'site-ceiling', 'a month stamp from after the closed day does not hide a site refusal on it'],
  ];
  for (const [day, want, why] of REFUSAL) {
    const got = refusalVerdict(day).state;
    got === want ? console.log(`  PASS  refusal: ${want.padEnd(27)} (${why})`)
                 : (bad++, console.log(`  FAIL  refusal: got ${got} want ${want}  (${why})`));
  }
  // WHAT THE REPORT PRINTS, not only which state it is in: the earliest hour, and
  // each site beside its OWN hour. The state loop above cannot see either, and a
  // report that names the wrong time or the wrong site is read as true.
  const SITE_DETAIL = [
    [{ ambientCaptureClosingOdds: '2026-10-31T20:00:00.000Z' }, '2026-10-31T20:00:00.000Z', [{ site: 'ambientCaptureClosingOdds', at: '2026-10-31T20:00:00.000Z' }], 'one site, one hour'],
    [{ getWCPregameLambdas: '2026-10-31T21:00:00.000Z', ambientCaptureClosingOdds: '2026-10-31T09:00:00.000Z' }, '2026-10-31T09:00:00.000Z',
     [{ site: 'ambientCaptureClosingOdds', at: '2026-10-31T09:00:00.000Z' }, { site: 'getWCPregameLambdas', at: '2026-10-31T21:00:00.000Z' }], 'two sites: the earliest hour is `at`, and each site keeps its own'],
    [{ fetchSportOddsLive: true, getWCPregameLambdas: '2026-10-31T21:00:00.000Z' }, '2026-10-31T21:00:00.000Z',
     [{ site: 'fetchSportOddsLive', at: null }, { site: 'getWCPregameLambdas', at: '2026-10-31T21:00:00.000Z' }], 'a site with no hour is listed with null and does not hide the other'],
    [{ fetchSportOddsLive: true }, null, [{ site: 'fetchSportOddsLive', at: null }], 'only an hour-less stamp: `at` is null, not a made-up time'],
    [{ ...NS, fetchSportOddsHistorical: '2026-10-31T05:00:00.000Z' }, '2026-10-31T05:00:00.000Z', [{ site: 'fetchSportOddsHistorical', at: '2026-10-31T05:00:00.000Z' }], 'the sites that did not refuse are not listed'],
  ];
  for (const [stamps, wantAt, wantSites, why] of SITE_DETAIL) {
    const v = refusalVerdict({ date: RD, ceiling_reached_at: null, month_limit_reached_at: null, site_ceiling_reached_at: stamps });
    const okd = v.state === 'site-ceiling' && v.at === wantAt && JSON.stringify(v.sites) === JSON.stringify(wantSites);
    okd ? console.log(`  PASS  site refusal detail: ${why}`)
        : (bad++, console.log(`  FAIL  site refusal detail: ${why}\n        got ${JSON.stringify(v)}\n        want at ${JSON.stringify(wantAt)}, sites ${JSON.stringify(wantSites)}`));
  }

  // COUNTED, NOT WRITTEN DOWN. This was `+ 32`, the number of one() calls on the
  // day it was typed, and adding an assertion without editing it would have
  // printed a denominator that was quietly wrong — the Rule 91 failure, inside
  // the self-test that exists to prevent it.
  const _n = CASES.length + INTEGRITY.length + CEILING.length + REFUSAL.length + SITE_DETAIL.length + ones;
  console.log(bad ? `\n${bad} FAILED` : `\nself-test: ${_n}/${_n}`);
  console.log(`COVERAGE: eight predicates on synthetic readings. None exercises D1, the`);
  console.log(`provider, or the cron. Two cases replay real 2026-09-16 numbers, three the real`);
  console.log(`2026-10-09/10/11 degrade counters.`);
  process.exit(bad ? 1 : 0);
}

async function d1(sql, params = []) {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error(`refusing non-SELECT: ${sql.slice(0, 60)}`);
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!res.ok || body.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  const r = body.results || body.result || [];
  return Array.isArray(r) ? (r[0]?.results || r) : (r.results || []);
}

const since = SINCE || new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
console.log(`=== odds backfill pairing rate  utc=${new Date().toISOString()} ===`);
console.log(`window: progress rows dated >= ${since}\n`);

const rows = await d1(
  `SELECT date, games_processed, credits_used, completed_at
     FROM odds_backfill_progress
    WHERE date >= ?
    ORDER BY date DESC`, [since]);

// An empty result is NOT a pass. It means the cron has not recorded a run in
// the window, which is its own failure and must not read as "nothing wrong".
if (!rows.length) {
  console.log(`FAIL: no progress row at all since ${since}.`);
  console.log(`The backfill has not recorded a run in ${DAYS} day(s). That is not a`);
  console.log(`clean bill of health — it is an absent denominator.`);
  process.exit(1);
}

const spent  = rows.filter(r => Number(r.credits_used) > 0);
const burned = burnedWithoutPairing(rows);
const paired = spent.length - burned.length;

console.log(`  progress rows in window        : ${rows.length}`);
console.log(`  of those, rows that spent      : ${spent.length}`);
console.log(`  spent AND paired at least one  : ${paired}`);
console.log(`  spent AND paired ZERO          : ${burned.length}`);
const creditsTotal = total(rows, 'credits_used');
const gamesTotal   = total(rows, 'games_processed');
// The denominator travels with the sum (Rule 91): a total over 9 of 14 rows is
// a different claim from a total over 14, and they are indistinguishable once
// printed as a bare number.
const shown = (t) => t.skipped
  ? `${t.sum}  (from ${t.n} of ${rows.length} rows; ${t.skipped} non-numeric — NOT zero)`
  : `${t.sum}`;
console.log(`  total credits in window        : ${shown(creditsTotal)}`);
console.log(`  total games paired in window   : ${shown(gamesTotal)}`);

let failed = false;

if (burned.length) {
  failed = true;
  console.log(`\nFAIL: ${burned.length} date(s) were billed and paired nothing:`);
  for (const r of burned.slice(0, 20)) console.log(`      ${r.date}  credits ${r.credits_used}  games 0`);
  if (burned.length > 20) console.log(`      … ${burned.length - 20} more`);
  console.log(`\nThis is the shape the equality matcher produced on every CFB date before`);
  console.log(`2026-09-16. Investigate the matcher before the budget (Rule 77).`);
}

// ── the provider series: what was actually BILLED, day over day ─────────────
//
// The ledger above is what our guards think they spent. This is what the
// provider charged. Two readings 11 days apart on 2026-09-16 showed the two
// disagreeing by ~19,700 cumulative, so "what did today cost" is a question
// only the provider can answer — and it could not be answered at all, because
// nothing was recording the number. A series of one is not a series.
const SERIES = 'outbox/odds-provider-usage-series.json';
let series = [];
try { series = JSON.parse(fs.readFileSync(SERIES, 'utf8')); } catch (_) { series = []; }
if (!Array.isArray(series)) series = [];

let budget = null;
try {
  const r = await fetch(`${RELAY}/budget/odds`, { headers: { Accept: 'application/json' } });
  budget = await r.json();
} catch (e) {
  console.log(`\nFAIL: /budget/odds unreachable (${e.message}).`);
  console.log(`Today's spend cannot be recorded, so tomorrow's delta will have no baseline.`);
  process.exit(1);
}

const reading = {
  at: new Date().toISOString(),
  provider_used: budget?.provider?.requests_used ?? null,
  provider_remaining: budget?.provider?.requests_remaining ?? null,
  ledger_month_used: budget?.monthly?.used ?? null,
  daily_used: budget?.daily?.used ?? null,
  daily_ceiling: budget?.daily?.ceiling ?? null,
  // Carried on every reading so the NEXT one can take a delta. Absent on the
  // older readings, which degradeVerdict reports as unreadable rather than 0.
  degraded_open: budget?.daily?.degraded_open ?? null,
  // The date the counter above belongs to, from the relay rather than the
  // runner clock. Older readings lack it; degradeVerdict then uses `at`.
  daily_date: budget?.daily?.date ?? null,
  // A partial sum published as a total is the defect this field would carry
  // forward into every future delta. If any row's count was unreadable, the
  // window total is unknown and is stored as such.
  games_paired_in_window: gamesTotal.skipped ? null : gamesTotal.sum,
  games_paired_rows_counted: gamesTotal.n,
  games_paired_rows_skipped: gamesTotal.skipped,
};
// ── THE CLOSED DAY, READ ONCE ───────────────────────────────────────────────
// Two consumers: the interval's degrade line (yesterday's CLOSE is what makes a
// cross-midnight interval computable) and the D1 overload section below.
// ?date= reads a closed day, which makes both immune to the 104-405 minute
// runner delay measured here, and the 2-day TTL covers yesterday.
const OVL_DAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
let closedDay = null, ovlWhy = '';
try {
  const rr = await fetch(`${RELAY}/budget/odds?date=${OVL_DAY}`, { headers: { Accept: 'application/json' } });
  if (!rr.ok) {
    ovlWhy = `/budget/odds?date=${OVL_DAY} returned HTTP ${rr.status}`;
  } else {
    const bj = await rr.json();
    const d = bj && bj.daily;
    if (!d || d.date !== OVL_DAY) {
      ovlWhy = `asked for ${OVL_DAY}, got ${JSON.stringify(d && d.date)} — ?date= was not honoured`;
    } else if (d.is_today === true) {
      ovlWhy = `${OVL_DAY} is still running; a day must be CLOSED before its total means anything`;
    } else {
      closedDay = d;
    }
  }
} catch (e) { ovlWhy = `the closed-day read threw: ${e.message}`; }

const prev = series.length ? series[series.length - 1] : null;
const ceiling = Number(reading.daily_ceiling) || 3800;
const ci = prev ? ciSpendInInterval(rows, prev.at, reading.at) : { credits: 0, runs: 0, undated: 0 };
const integrity = ledgerIntegrityVerdict(prev, reading, ci.credits);
const prevDate = prev ? (prev.daily_date ?? String(prev.at).slice(0, 10)) : undefined;
const degrade = degradeVerdict(prev?.degraded_open, reading.degraded_open, integrity.unexplained ?? 0, {
  prevDate,
  currDate: reading.daily_date ?? reading.at.slice(0, 10),
  // Only the close of the day the previous reading belongs to will do.
  prevDayClose: closedDay && prevDate === OVL_DAY ? closedDay.degraded_open : undefined,
});
const cap = ceilingVerdict({ used: reading.daily_used, ceiling: reading.daily_ceiling });

console.log(`\n  provider billed this month     : ${reading.provider_used ?? 'unreadable'}`);
console.log(`  our ledger says                : ${reading.ledger_month_used ?? 'unreadable'}`);
console.log(`  today's daily counter          : ${reading.daily_used ?? 'unreadable'} / ${ceiling}`);
console.log(`  readings on file               : ${series.length}`);

console.log(`  daily ceiling verdict          : ${cap.state}${cap.state === 'unreadable' ? '' : `  (${cap.used}/${cap.ceiling}, ${cap.pct}%)`}`);

if (integrity.state === 'no_baseline') {
  console.log(`\n  FIRST READING — no delta yet. The next run is the first that can`);
  console.log(`  answer "did spend reach the vendor without reaching our ledger".`);
} else if (integrity.state === 'unreadable') {
  console.log(`\n  one of the two counters is absent, which is NOT a zero-spend interval.`);
} else if (integrity.state === 'counter_reset') {
  console.log(`\n  a counter went backwards — monthly reset, not an error.`);
} else {
  console.log(`\n  since the last reading (${integrity.elapsedH}h):`);
  console.log(`      provider billed   : ${integrity.providerDelta}`);
  console.log(`      our ledger charged: ${integrity.ledgerDelta}`);
  console.log(`      escaped the ledger: ${integrity.escaped}`);
  console.log(`      known CI spend    : ${integrity.outsideLedger}   (${ci.runs} backfill run(s) in window${ci.undated ? `, ${ci.undated} undated row(s) NOT subtracted` : ''})`);
  console.log(`      UNEXPLAINED       : ${integrity.unexplained}   (tolerance ${integrity.tolerance})`);
  console.log(`      guard fell open   : ${degrade.state}${degrade.credits === null ? '' : ` — ${degrade.credits} credit(s)`}${
    degrade.state === 'cross-day' ? (degrade.why === 'multi-day'
      ? ` — ${prevDate} to ${reading.daily_date ?? reading.at.slice(0, 10)} spans more than one midnight; one day's close cannot bridge it`
      : ` — the interval spans midnight from ${prevDate}, and that day's close was not readable`)
    : degrade.state === 'no-escape' ? ' — but nothing escaped the ledger for them to explain' : ''}`);
  // Across one midnight the number is reconstructed, so its inputs are printed
  // beside it: the line can be checked against the closed-day block and the
  // series without re-running anything.
  if (degrade.parts) {
    console.log(`                          = ${prevDate} close ${degrade.parts.close} - ${degrade.parts.was} at the last reading + ${degrade.parts.now} today`);
  }
  // WHAT THREW, added 2026-10-08. `state` and `credits` say how often and how
  // much; both degrade-open catches were `catch (_)` until today, so the cause
  // was not recorded anywhere and this line had nothing to print. 245 events
  // and 1263 credits on 2026-10-07 with no attributable cause.
  //
  // Absent is not empty: a reading from before the histogram existed carries no
  // `reasons` at all, and saying "no reason recorded" over that would read as
  // "it threw for no reason".
  {
    const rs = reading.degraded_open && reading.degraded_open.reasons;
    if (degrade.state === 'none') { /* nothing fell open; no cause to name */ }
    else if (!rs || typeof rs !== 'object') {
      console.log(`      what threw        : NOT RECORDED — this reading predates the reason histogram`);
    } else {
      const pairs = Object.entries(rs).sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0));
      if (!pairs.length) console.log(`      what threw        : the histogram is present and empty`);
      else for (const [why, n] of pairs.slice(0, 5)) {
        console.log(`      what threw        : ${String(n).padStart(5)} x  ${String(why).slice(0, 110)}`);
      }
      if (pairs.length > 5) console.log(`      ... and ${pairs.length - 5} more distinct reason(s)`);
    }
  }
  if (degrade.state === 'none' && integrity.unexplained > integrity.tolerance) {
    console.log(`      no guard degraded, so the unexplained credits are NOT a`);
    console.log(`      degrade-open. That eliminates the last named candidate.`);
  }
  console.log(`      ${integrity.escaped < 0
    ? 'negative — our ledger charged MORE than the vendor billed, which is the reconcile direction'
    : 'positive — the vendor billed for calls our counters did not see'}`);
  // `?? 0` here would undo the null the seed was careful to store: the older
  // readings predate the pairing counter, so the baseline is UNKNOWN and the
  // difference is not computable. Third instance of null-as-zero in this one
  // feature — the predicate, the reading, and now the line that prints it.
  //
  // AND THE DENOMINATORS MUST MATCH. `--days=1` and `--days=14` both write
  // games_paired_in_window, over 1 row and over 14. Subtracting one from the
  // other printed "-16" on 2026-09-16 and meant nothing. The window size is
  // recorded on every reading precisely so this comparison can refuse.
  const basePaired = prev.games_paired_in_window;
  const nowPaired  = reading.games_paired_in_window;
  const baseRows   = prev.games_paired_rows_counted;
  const nowRows    = reading.games_paired_rows_counted;
  console.log(`      games paired since: ${
    basePaired === null || basePaired === undefined
      ? `unknown (that reading predates the pairing counter; now ${nowPaired ?? 'unreadable'})`
      : nowPaired === null
        ? `unknown (${gamesTotal.skipped} row(s) in this window carry no numeric count)`
        : (baseRows === undefined || nowRows === undefined)
          ? `unknown (a reading predates the window-size field; now ${nowPaired} over ${rows.length} rows)`
          : baseRows !== nowRows
            ? `not comparable (that reading covered ${baseRows} rows, this one ${nowRows})`
            : nowPaired - basePaired}`);
}

// ── D1 OVERLOAD, ON THE CLOSED DAY ──────────────────────────────────────────
// A SEPARATE READ, because the one above is the RUNNING day at ~11:00Z and the
// overloads arrive in the afternoon peak: on 2026-10-11 the count was 0 at
// 09:21Z and 111 by 16:29Z. A running-day read at this hour would pass that day.
// ?date= reads a closed day, which makes the verdict immune to the 104-405
// minute runner delay measured here, and the 2-day TTL covers yesterday.
// The closed-day read itself happens once, above, before the interval line.
let ovl = { state: 'unreadable', overloads: null };
if (closedDay) {
  // hasOwnProperty, not `d.degraded_open ?? ...`: whether the key is THERE
  // is the answer to "is the field reported", and defaulting it away is the
  // coercion that hid it once already.
  ovl = d1OverloadVerdict(Object.prototype.hasOwnProperty.call(closedDay, 'degraded_open') ? closedDay.degraded_open : undefined);
}

console.log(`\n  ── D1 overload, closed day ${OVL_DAY} (budget ${D1_OVERLOAD_BUDGET}) ──`);
if (ovlWhy) {
  console.log(`  NOT READ: ${ovlWhy}`);
} else {
  console.log(`  degraded_open        : ${ovl.state}`);
  if (ovl.overloads !== null) console.log(`  D1 overloads         : ${ovl.overloads}   (daily + month paths; one per call from 2026-10-18)`);
  if (ovl.pathBlind !== undefined) console.log(`  path events          : ${ovl.pathBlind}   (the budget's unit: a one-batch overload blinds the day AND the month, so counts 2)`);
  if (ovl.events !== undefined) console.log(`  all degrade events   : ${ovl.events}`);
  if (ovl.monthBatch !== undefined) console.log(`  month-batch reason   : ${ovl.monthBatch}   (the batch-shape fix of 2026-10-11 should hold this at 0)`);
  if (ovl.overflow) console.log(`  overflow bucket      : ${ovl.overflow}   (reasons past the cap — overloads could be hiding here)`);
}
if (ovlWhy || ['over', 'unattributed', 'not-reported', 'unreadable'].includes(ovl.state)) {
  failed = true;
  if (ovlWhy) {
    console.log(`\nFAIL: the closed-day degrade counter for ${OVL_DAY} could not be read (${ovlWhy}).`);
    console.log(`      A watch that cannot see the thing it watches does not get to pass.`);
  } else if (ovl.state === 'over') {
    console.log(`\nFAIL: ${ovl.pathBlind} D1-overload path events (${ovl.overloads} overloads) on ${OVL_DAY}, over the budget of ${ovl.budget}.`);
    console.log(`      Each is a degrade-OPEN: a vendor call the counter did not see, and after`);
    console.log(`      the daily ceiling a veto turned into a spend. The odds guard REPORTS this;`);
    console.log(`      it is the only D1 caller that counts its failures, which makes it the`);
    console.log(`      witness, not necessarily the cause. docs/CC-CMD-2026-10-11-d1-overload-degrades.md.`);
  } else if (ovl.state === 'unattributed') {
    console.log(`\nFAIL: ${ovl.events} degrade events on ${OVL_DAY} and NO reasons map. Degrades`);
    console.log(`      happened and their causes are invisible — the instrument regressed.`);
  } else {
    console.log(`\nFAIL: daily.degraded_open on ${OVL_DAY} is ${ovl.state}. That is not a zero (Rule 99).`);
  }
}

series.push(reading);
fs.writeFileSync(SERIES, JSON.stringify(series.slice(-120), null, 2) + '\n');
console.log(`\n  wrote ${SERIES} (${Math.min(series.length, 120)} reading(s) kept)`);

if (integrity.over) {
  failed = true;
  console.log(`\nFAIL: the vendor billed ${integrity.providerDelta}, our ledger charged ${integrity.ledgerDelta},`);
  console.log(`and ${integrity.outsideLedger} of the difference is known CI spend. ${integrity.unexplained} credits are UNEXPLAINED —`);
  console.log(`they reached the provider without reaching a counter. Both guards`);
  console.log(`degrade OPEN — consumeOddsCredit returns true when FIELD_JOURNALISM is unbound,`);
  console.log(`chargeOdds returns true on any KV error — so spend that the`);
  console.log(`vendor saw and we did not is the signature of a guard that stopped guarding.`);
  console.log(`This compares the two counters to EACH OTHER, so it is not the standing`);
  console.log(`cumulative gap (19,582 on 2026-09-16); it is new divergence in this interval.`);
}

// A refusal on the closed day. An unreadable closed day already failed above.
if (closedDay) {
  const refusal = refusalVerdict(closedDay);
  const when = refusal.at ? ` — first refused a call at ${refusal.at}` : (refusal.state === 'month-limit' || refusal.state === 'site-ceiling') ? ' — first refused a call, hour unknown' : '';
  console.log(`\n  refusals, closed day ${OVL_DAY}  : ${refusal.state}${when}`);
  if (refusal.state !== 'none') {
    failed = true;
    if (refusal.state === 'day-ceiling') {
      console.log(`\nFAIL: the daily ceiling first refused an odds call on ${OVL_DAY} at ${refusal.at}.`);
      console.log(`      Calls that did not fit after that were refused too, and no caller says so:`);
      console.log(`      closing captures, opening lines and CFL/WC probabilities may have gone`);
      console.log(`      unbought. Read /budget/odds?date=${OVL_DAY} by_site for who spent the day.`);
    } else if (refusal.state === 'site-ceiling') {
      console.log(`\nFAIL: a per-site cap first refused an odds call on ${OVL_DAY}: ${refusal.sites.map((x) => `${x.site} ${x.at ? `at ${x.at}` : 'at an unknown hour'}`).join('; ')}.`);
      console.log(`      The day and the month had room; only that consumer was turned away, and no`);
      console.log(`      caller says so. Read /budget/odds?date=${OVL_DAY} by_site and site_ceilings for what it spent.`);
    } else if (refusal.state === 'month-limit') {
      console.log(`\nFAIL: the monthly odds limit first refused a call ${refusal.at ? `at ${refusal.at}` : 'at an unknown hour'}, on or before`);
      console.log(`      ${OVL_DAY}. Calls that did not fit were refused from then on, and no caller says so.`);
    } else {
      console.log(`\nFAIL: refusals on ${OVL_DAY} are ${refusal.state}: ${refusal.unreadable
        ? `the relay could not read ${refusal.unreadable.join(' and ')}`
        : `${refusal.missing || 'ceiling_reached_at, month_limit_reached_at, site_ceiling_reached_at or date'} is missing from /budget/odds?date=`}.`);
      console.log(`      Unknown is not a clean day (Rule 99).`);
    }
  }
}

if (cap.over) {
  failed = true;
  console.log(`\nFAIL: odds:daily is ${cap.used} against a ceiling of ${cap.ceiling}.`);
  console.log(`chargeOdds compares this exact counter to this exact number`);
  console.log(`and refuses the call that would exceed it, so a total above it means the`);
  console.log(`guard returned true when it should not have. Investigate the guard (Rule 77).`);
}

if (!failed) console.log(`\nPASS: every date that spent credits paired at least one game, our ledger`);
if (!failed) console.log(`captured everything the vendor billed, the daily counter is under its cap, and`);
if (!failed) console.log(`yesterday's D1 overloads were read, attributed, and at or under ${D1_OVERLOAD_BUDGET}.`);

console.log(`\nCOVERAGE: ${rows.length} progress rows since ${since}, ${series.length} provider reading(s).`);
console.log(`odds_backfill_progress is keyed by DATE, so a date mixing a paired sport with an`);
console.log(`unpaired one reads as paired — this catches total failure per date, not per sport.`);
console.log(`KNOWN CI SPEND IS A LOWER BOUND: only odds-backfill records its own credits, so`);
console.log(`probes and one-off fills are NOT subtracted and UNEXPLAINED is an upper bound on`);
console.log(`real leakage. Joined on completed_at (the run clock), never on date (the day`);
console.log(`being backfilled) — a run today writes yesterday's row.`);
process.exit(failed ? 1 : 0);
