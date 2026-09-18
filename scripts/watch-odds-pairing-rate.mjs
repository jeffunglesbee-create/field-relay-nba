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
export function degradeVerdict(prevDegraded, currDegraded, escaped) {
  const n = (d) => (d && Number.isFinite(Number(d.credits)) ? Number(d.credits) : null);
  const now = n(currDegraded);
  if (now === null) return { state: 'unreadable', credits: null };
  const was = prevDegraded === undefined ? 0 : n(prevDegraded);
  if (was === null) return { state: 'unreadable', credits: null };
  const delta = now - was;
  if (delta < 0) return { state: 'unreadable', credits: null };
  if (delta === 0) return { state: 'none', credits: 0 };
  return { state: delta >= escaped ? 'explains' : 'partial', credits: delta };
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
export function ciSpendInInterval(rows, fromISO, toISO) {
  const from = Date.parse(fromISO), to = Date.parse(toISO);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return { credits: 0, runs: 0, undated: 0 };
  let credits = 0, runs = 0, undated = 0;
  for (const r of rows || []) {
    const at = _asUtc(r.completed_at);
    // A row with no usable timestamp cannot be placed in or out of the window.
    // It is COUNTED SEPARATELY, never silently treated as outside it — that
    // would inflate the subtraction and shrink the residual on no evidence.
    if (!Number.isFinite(at)) { undated++; continue; }
    if (at < from || at > to) continue;
    const c = Number(r.credits_used);
    if (!Number.isFinite(c)) { undated++; continue; }
    credits += c; runs++;
  }
  return { credits, runs, undated };
}

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
 * is the counter checkAndIncrementDailyOdds compares against. No interval, no
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
  const one = (label, got, want, why) => got === want
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
  one('no degradation',        degradeVerdict(DG(0), DG(0), 347).state, 'none', 'the counter did not move');
  one('none is reported as 0', degradeVerdict(DG(0), DG(0), 347).credits, 0, 'a real zero, distinguishable from unreadable');
  one('degradation explains it',  degradeVerdict(DG(0), DG(400), 347).state, 'explains', '400 covers a 347 escape');
  one('degradation covers exactly', degradeVerdict(DG(0), DG(347), 347).state, 'explains', 'equal counts as covered');
  one('degradation is partial',   degradeVerdict(DG(100), DG(200), 347).state, 'partial', '100 of 347 — real, but not the whole story');
  one('the DELTA is used, not the level', degradeVerdict(DG(1000), DG(1100), 347).credits, 100,
      'the counter is cumulative per day; a level would claim 1100 on an interval that saw 100');
  one('an unreadable counter is not zero', degradeVerdict(DG(0), null, 347).state, 'unreadable',
      'Number(null) is 0 and would print "no guard degraded" on no evidence — Rule 99, in the instrument');
  one('an unreadable BASELINE is not zero', degradeVerdict(null, DG(50), 347).state, 'unreadable',
      'the older readings predate this field; a missing baseline cannot be subtracted from');
  one('a first reading treats absence as 0', degradeVerdict(undefined, DG(50), 347).credits, 50,
      'undefined means there was no prior reading at all, which is different from one that could not be read');
  one('a midnight rollover is unreadable', degradeVerdict(DG(900), DG(20), 347).state, 'unreadable',
      'the daily counter restarted; clamping would claim "no degradation" on exactly that reading');

  for (const [daily, want, why] of CEILING) {
    const got = ceilingVerdict(daily).state;
    got === want ? console.log(`  PASS  ceiling: ${want.padEnd(27)} (${why})`)
                 : (bad++, console.log(`  FAIL  ceiling: got ${got} want ${want}  (${why})`));
  }

  const _n = CASES.length + INTEGRITY.length + CEILING.length + 32;
  console.log(bad ? `\n${bad} FAILED` : `\nself-test: ${_n}/${_n}`);
  console.log(`COVERAGE: six predicates on synthetic readings. None exercises D1, the`);
  console.log(`provider, or the cron. Two cases replay real 2026-09-16 numbers.`);
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
  // A partial sum published as a total is the defect this field would carry
  // forward into every future delta. If any row's count was unreadable, the
  // window total is unknown and is stored as such.
  games_paired_in_window: gamesTotal.skipped ? null : gamesTotal.sum,
  games_paired_rows_counted: gamesTotal.n,
  games_paired_rows_skipped: gamesTotal.skipped,
};
const prev = series.length ? series[series.length - 1] : null;
const ceiling = Number(reading.daily_ceiling) || 3800;
const ci = prev ? ciSpendInInterval(rows, prev.at, reading.at) : { credits: 0, runs: 0, undated: 0 };
const integrity = ledgerIntegrityVerdict(prev, reading, ci.credits);
const degrade = degradeVerdict(prev?.degraded_open, reading.degraded_open, integrity.unexplained ?? 0);
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
  console.log(`      guard fell open   : ${degrade.state}${degrade.credits === null ? '' : ` — ${degrade.credits} credit(s)`}`);
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

series.push(reading);
fs.writeFileSync(SERIES, JSON.stringify(series.slice(-120), null, 2) + '\n');
console.log(`\n  wrote ${SERIES} (${Math.min(series.length, 120)} reading(s) kept)`);

if (integrity.over) {
  failed = true;
  console.log(`\nFAIL: the vendor billed ${integrity.providerDelta}, our ledger charged ${integrity.ledgerDelta},`);
  console.log(`and ${integrity.outsideLedger} of the difference is known CI spend. ${integrity.unexplained} credits are UNEXPLAINED —`);
  console.log(`they reached the provider without reaching a counter. Both guards`);
  console.log(`degrade OPEN — consumeOddsCredit returns true when FIELD_JOURNALISM is unbound,`);
  console.log(`checkAndIncrementDailyOdds returns true on any KV error — so spend that the`);
  console.log(`vendor saw and we did not is the signature of a guard that stopped guarding.`);
  console.log(`This compares the two counters to EACH OTHER, so it is not the standing`);
  console.log(`cumulative gap (19,582 on 2026-09-16); it is new divergence in this interval.`);
}

if (cap.over) {
  failed = true;
  console.log(`\nFAIL: odds:daily is ${cap.used} against a ceiling of ${cap.ceiling}.`);
  console.log(`checkAndIncrementDailyOdds compares this exact counter to this exact number`);
  console.log(`and refuses the call that would exceed it, so a total above it means the`);
  console.log(`guard returned true when it should not have. Investigate the guard (Rule 77).`);
}

if (!failed) console.log(`\nPASS: every date that spent credits paired at least one game, our ledger`);
if (!failed) console.log(`captured everything the vendor billed, and the daily counter is under its cap.`);

console.log(`\nCOVERAGE: ${rows.length} progress rows since ${since}, ${series.length} provider reading(s).`);
console.log(`odds_backfill_progress is keyed by DATE, so a date mixing a paired sport with an`);
console.log(`unpaired one reads as paired — this catches total failure per date, not per sport.`);
console.log(`KNOWN CI SPEND IS A LOWER BOUND: only odds-backfill records its own credits, so`);
console.log(`probes and one-off fills are NOT subtracted and UNEXPLAINED is an upper bound on`);
console.log(`real leakage. Joined on completed_at (the run clock), never on date (the day`);
console.log(`being backfilled) — a run today writes yesterday's row.`);
process.exit(failed ? 1 : 0);
