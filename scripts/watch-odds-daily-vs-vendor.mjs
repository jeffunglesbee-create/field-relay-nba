#!/usr/bin/env node
// Is our record of spend right? The only odds question with money attached.
//
// Three watches already compare our counters to EACH OTHER —
// odds-attribution-gap and odds-site-drift (odds:daily:* vs the sum of
// odds:site:*) and odds-pairing-rate (the monthly ledger vs the vendor, over
// irregular intervals). None of them establishes which counter is RIGHT, and on
// 2026-09-19 the site-vs-daily gap was measured going BOTH ways (+397, +324,
// then -16), so at least one of them is wrong some of the time. by_site, which
// two of those watches cover, has no code consumer in either repo and cannot
// overspend anything.
//
// The vendor's bill is the only authority. The open claim this exists to settle:
//
//   If odds:daily:* under-counts, real spend exceeded 3800 on every day that
//   "closed at the cap" — and 2026-09-15 and 09-16 both read exactly 3800/3800.
//
// NOT THE STANDING OFFSET. The ~19,700 provider-vs-ledger cumulative difference
// is a level across an unknown history and explains nothing. This is a DELTA
// over ONE vendor window (between two readings of this watch) against our
// monthly ledger over the same window, with the closed UTC day's counter printed
// beside it as a diagnostic.
//
// WHY A NEW SCHEDULE RATHER THAN THE EXISTING SERIES. The pairing watch's
// readings land wherever the runner fires, and the measured scheduled-run delay
// here is 104-405 minutes, so no two of them bound a UTC day. This runs once at
// 00:10 and reads YESTERDAY by explicit date — the same delay-immunity the
// attribution watch already carries.
//
// THE VERDICT IS THE WINDOW-ALIGNED RESIDUAL (docs/CC-CMD-2026-10-13-vendor-residual-window.md,
// Task 1). The vendor side is a difference between two READING instants, and the
// UTC day's counter covers a different 24 hours: on 2026-10-12 the vendor window
// ran 05:48Z to 06:42Z the next day, and about 510 of that day's 3,799 credits
// landed before it opened. So the verdict differences the vendor over the window
// against `monthly.used` (the ledger) over the SAME two readings, which every
// series row already carries, and the UTC-day counter stays as a labelled
// diagnostic. "Same two readings" is exact to about a minute: the vendor figure is
// the header of a response the relay's edge may have cached for up to 60 s, while
// the ledger is read live in the same request, and that is far inside the tolerance.
// The ledger is not the counter the CEILING reads (odds:daily:*); scripts/watch-odds-daily-vs-monthly.mjs
// is the watch that says whether those two agree. On the committed series, 2026-10-23 read `counter-under-counts`
// (+75) against the UTC day and exactly 0 against the window: that "breach" was
// the offset.
//
// READ-ONLY AND FREE: /budget/odds returns a CACHED vendor response header; it
// issues no vendor call. One D1 SELECT for CI rows. No credits.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { ciSpendInInterval } from './lib/ci-spend.mjs';

const RELAY  = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE   = process.env.RELAY_SHARED_SECRET;
const SERIES = 'outbox/odds-daily-vs-vendor-series.json';

export const TOLERANCE_FLOOR = 50;
export const TOLERANCE_PCT   = 0.05;
export const RESET_FLOOR     = 1000;

/** max(50, 5% of the vendor's day). Matches the pairing watch rather than
 *  inventing a second standard for the same kind of judgement. */
export function toleranceFor(vendorDay) {
  return Math.max(TOLERANCE_FLOOR, Math.round(TOLERANCE_PCT * Math.abs(Number(vendorDay) || 0)));
}

/** The reading, or the reason there isn't one.
 *  Task 0a of the CC-CMD, made permanent: the three numbers live at
 *  budget.provider.requests_used, budget.monthly.used and budget.daily.used,
 *  and `day` must be the date we ASKED for. A route that silently ignored
 *  ?date= would otherwise hand back today and be compared against yesterday. */
function _vendorNum(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function readingFrom(body, wantDay, at) {
  const d = body && body.daily;
  if (!d || typeof d !== 'object') return { ok: false, why: 'no `daily` block in the response' };
  if (d.date !== wantDay) return { ok: false, why: `asked for ${wantDay}, got ${JSON.stringify(d.date)} — ?date= was not honoured` };
  if (d.is_today === true) return { ok: false, why: `${wantDay} is still running; a day must be CLOSED before its total means anything` };
  if (typeof d.used !== 'number') return { ok: false, why: `daily.used is ${JSON.stringify(d.used)}, not a number` };
  // THE VENDOR SENDS A STRING. Measured 2026-09-19, live: "76945". The pairing
  // watch already carries a case for it — "the provider sends a STRING; it must
  // still subtract" — and that file was read the same day this one was written
  // without the fact being applied. A typeof check rejected the only shape the
  // route actually returns and the first live run failed on real data.
  //
  // So: a numeric string IS a number. null, undefined and '' are not, and they
  // are still refused rather than coerced — Number(null) is 0 and would report
  // a day the vendor never told us about as a day it billed nothing (Rule 99).
  const v = _vendorNum(body?.provider?.requests_used);
  if (v === null) return { ok: false, why: `provider.requests_used is ${JSON.stringify(body?.provider?.requests_used)} — absent or unparseable; null is NOT zero (Rule 99)` };
  // THE LEDGER IS A LEDGER ONLY WHEN THE ROUTE READ D1. peekMonthlyOdds serves
  // `source: 'kv-d1-unreadable'` with the KV counter when its D1 read throws, and
  // since the D1 cutover that KV value is a small correction counter, far below
  // the real month total. Stored as the baseline it would corrupt this window's
  // verdict AND the next one. So anything but a finite number from source 'd1' is
  // stored as null (unreadable) and the source is kept beside it as evidence.
  const m = body && body.monthly;
  const ledgerOk = !!m && typeof m === 'object' && m.source === 'd1' && typeof m.used === 'number' && Number.isFinite(m.used);
  return { ok: true, reading: {
    at, day: wantDay, day_used: d.used, ceiling: d.ceiling ?? null,
    vendor_month_used: v, ledger_month_used: ledgerOk ? m.used : null,
    ledger_source: m && typeof m === 'object' && typeof m.source === 'string' ? m.source : null,
  } };
}

/** The vendor's spend for the day between two readings.
 *  Refuses rather than smooths, in three cases that all look like a number:
 *   - no baseline        -> no-data, never 0 (Rule 99)
 *   - a month boundary   -> the vendor counter resets, so the delta is negative
 *                           and is not spend. Caught two ways, because either
 *                           signal alone can miss: a differing UTC month, and a
 *                           large negative delta (a billing cycle need not land
 *                           on the 1st).
 *   - an unreadable side -> unknown */
export function vendorDay(prev, curr) {
  if (!prev) return { state: 'no-data' };
  const p = prev.vendor_month_used, c = curr.vendor_month_used;
  if (typeof p !== 'number' || typeof c !== 'number') return { state: 'unreadable' };
  const pm = String(prev.at).slice(0, 7), cm = String(curr.at).slice(0, 7);
  if (pm !== cm) return { state: 'month-boundary', from: pm, to: cm };
  const delta = c - p;
  if (delta < -RESET_FLOOR) return { state: 'counter-reset', delta };
  // THE TWO SIDES MUST MEASURE THE SAME WINDOW. This refusal was written when
  // `ourDay` was a clean 24h UTC calendar day read by explicit date, against a
  // vendor side that is a difference between two READING timestamps; scheduled
  // runs in this repo drift 104-405 minutes, so a run at 00:10 followed by one
  // at 04:30 differenced 28.3 hours of vendor spend against 24 hours of ours,
  // and the extra 4.3 hours landed in the residual as a shortfall that is not
  // one.
  //
  // Since Task 1 of docs/CC-CMD-2026-10-13-vendor-residual-window.md the verdict's
  // ledger side is taken at the SAME two readings (ledgerWindow), so a long window
  // no longer manufactures a shortfall in the verdict. The refusal is KEPT, unchanged:
  // the UTC-day diagnostic and the tolerance (5% of one day's vendor spend) still
  // assume about a day, and relaxing it would turn skipped days into judged ones,
  // which is a separate decision.
  //
  // Refused rather than corrected, because correcting it needs a model of when
  // spend happens and no such model is measured. A skipped day with a stated
  // reason beats a day with a wrong number in it.
  const hours = (Date.parse(curr.at) - Date.parse(prev.at)) / 3600000;
  if (!Number.isFinite(hours)) return { state: 'unreadable' };
  if (hours < 22 || hours > 26) return { state: 'window-drift', hours: Math.round(hours * 10) / 10 };
  return { state: 'ok', vendorDay: delta, hours: Math.round(hours * 10) / 10 };
}

/** What a window says about our counter.
 *  residual = vendorDay - ourSpend - knownCI, and it is an UPPER bound: only
 *  odds-backfill records its own credits, so any other direct-vendor script
 *  (targeted-odds-fill, confirmed) is not subtracted. `ourSpend` is the ledger
 *  over the vendor's window for the verdict (judgeDay) and the closed UTC day's
 *  counter for the diagnostic. */
/**
 * The part of an overcharge that is already named, so the residual stops
 * carrying it silently (Rule 91).
 *
 * `no-header` is reconcile's state for a call whose response had no
 * x-requests-last to settle the estimate against, so the estimate stood. On
 * 2026-10-11 the only site ever in it was `ambientFetchLiveOdds`, calling
 * `/v4/sports/{sport}/odds-live` — a path the vendor 404s (run 38186065943).
 * A 404 is billed nothing and carries no usage header, so every one of those
 * credits was ours alone: 2074 on 2026-10-10 against a residual of -1967.
 *
 * NULL, NOT ZERO, when the tally cannot be read. "Nothing was unreconciled"
 * and "we could not find out" are different answers and only one of them
 * explains a residual.
 */
export function noHeaderCredits(reconcileRows) {
  if (!Array.isArray(reconcileRows)) return null;
  let credits = 0, calls = 0;
  const sites = new Set();
  for (const r of reconcileRows) {
    if (!r || r.state !== 'no-header') continue;
    credits += Number(r.credits_kept) || 0;
    calls += Number(r.n) || 0;
    if (r.site) sites.add(r.site);
  }
  return { credits, calls, sites: [...sites].sort() };
}

export function residualVerdict(vendorDayCredits, ourDay, knownCI) {
  if (typeof vendorDayCredits !== 'number' || typeof ourDay !== 'number') {
    return { state: 'unreadable', residual: null };
  }
  const residual = vendorDayCredits - ourDay - (Number(knownCI) || 0);
  // The tolerance is a fraction of the VENDOR's day, never of ours. Using ours
  // makes the allowance shrink exactly as our counter under-reports, so the
  // worse the defect the easier the check is to pass.
  const tol = toleranceFor(vendorDayCredits);
  if (Math.abs(residual) <= tol) return { state: 'tracks-the-bill', residual, tol };
  if (residual > 0) return { state: 'counter-under-counts', residual, tol };
  return { state: 'we-overcharge-ourselves', residual, tol };
}

/** The CI rows out of the /d1/execute answer, or the reason there are none.
 *  The route's contract (src/index.js, POST /d1/execute): success is
 *  `{ success: true, results: [row, ...], meta }`, FLAT; failure is HTTP 401 with
 *  the text `unauthorized`, or 400/403/500 with `{ ok: false, error }`. Anything
 *  that is not exactly the success shape is unreadable. It must not become an
 *  empty list: known CI spend is SUBTRACTED, so reading "no CI rows" for "could
 *  not read the CI rows" shifts the residual by up to a whole day's backfill and,
 *  now that the residual is small, can turn a finding green (a 500 on the
 *  10-12 pair read tracks-the-bill with a residual of 10). */
export function ciRowsFrom(status, body) {
  if (!(Number.isInteger(status) && status >= 200 && status < 300)) return { ok: false, why: `HTTP ${status}` };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, why: 'the answer is not a JSON object' };
  if (body.success !== true) return { ok: false, why: `success is ${JSON.stringify(body.success)}${body.error ? ` (${String(body.error).slice(0, 80)})` : ''}` };
  if (!Array.isArray(body.results)) return { ok: false, why: 'results is not an array' };
  return { ok: true, rows: body.results };
}

/** Our monthly ledger's spend between the SAME two readings the vendor delta
 *  uses. Taken at the reading instants, so it covers the vendor's window rather
 *  than a UTC day. Refuses, never defaults:
 *   - a missing or non-numeric side -> ledger-unreadable. `Number(null)` is 0
 *     and would read an unmeasured window as a window we recorded nothing in
 *     (Rule 99), and a numeric STRING is refused too: the route sends the ledger
 *     as a number and a string means the shape changed.
 *   - a negative delta -> ledger-went-backwards. vendorDay has already refused a
 *     month change, so inside one month the ledger only grows; a fall is a
 *     defect in a reading, not a refund. */
export function ledgerWindow(prev, curr) {
  const p = prev && prev.ledger_month_used, c = curr && curr.ledger_month_used;
  if (typeof p !== 'number' || typeof c !== 'number' || !Number.isFinite(p) || !Number.isFinite(c)) {
    return { state: 'ledger-unreadable' };
  }
  const delta = c - p;
  if (delta < 0) return { state: 'ledger-went-backwards', delta };
  return { state: 'ok', ledgerWindow: delta };
}

/** The day, judged. One function for the run and for the self-test, so what the
 *  self-test pins on the real pairs is the code that runs and not a copy of it.
 *
 *  `state` is the vendor refusal (no-data, month-boundary, counter-reset,
 *  window-drift, unreadable), a failure to measure (ledger-unreadable,
 *  ledger-went-backwards, ci-unreadable), or the verdict. The verdict, `window`, is the vendor
 *  window against the ledger over that window. `utcDay` is the same arithmetic
 *  against the closed UTC day's counter and is a DIAGNOSTIC: it measures a
 *  different 24 hours, so it never sets `state`. */
export function judgeDay(prev, curr, knownCI) {
  const vd = vendorDay(prev, curr);
  if (vd.state !== 'ok') return { state: vd.state, vd };
  const lw = ledgerWindow(prev, curr);
  if (lw.state !== 'ok') return { state: lw.state, vd, lw };
  // Known CI spend is subtracted, so it has to be KNOWN: null means the read failed,
  // and a defaulted 0 would put an unmeasured quantity into the verdict (Rule 99).
  if (typeof knownCI !== 'number' || !Number.isFinite(knownCI)) return { state: 'ci-unreadable', vd, lw };
  const window = residualVerdict(vd.vendorDay, lw.ledgerWindow, knownCI);
  const utcDay = residualVerdict(vd.vendorDay, curr.day_used, knownCI);
  return { state: window.state, vd, lw, window, utcDay };
}

/** The numbers of a judged day as log lines, both figures, each labelled for
 *  what it is. A pure function so the self-test can pin the labels: a reader of
 *  the log must be able to tell which residual is the verdict. */
export function judgementLines(j, curr, ci) {
  const L = [];
  L.push(`  vendor billed in the window : ${j.vd.vendorDay}   (${j.vd.hours} h between the two readings)`);
  L.push(`  our ledger, same window     : ${j.lw.ledgerWindow}   (monthly.used at those two readings)`);
  L.push(`  known CI spend              : ${ci.credits}   (${ci.runs} run(s), ${ci.undated} undated)`);
  L.push(`  residual (window-aligned)   : ${j.window.residual}   tolerance ${j.window.tol}   <- the verdict`);
  L.push(`  diagnostic, NOT the verdict : the UTC day's counter covers a different 24 hours than the window`);
  L.push(`  our daily counter (UTC day) : ${curr.day_used}`);
  L.push(`  residual against that       : ${j.utcDay.residual}   tolerance ${j.utcDay.tol}`);
  return L;
}

if (process.argv.includes('--self-test')) {
  let bad = 0, total = 0;
  const one = (label, got, want, why) => { total++; return JSON.stringify(got) === JSON.stringify(want)
    ? console.log(`  PASS  ${label} -> ${JSON.stringify(got)}  (${why})`)
    : (bad++, console.log(`  FAIL  ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`)); };

  const B = (day, used, vendor, today = false) => ({
    daily: { date: day, used, is_today: today, ceiling: 3800 },
    provider: { requests_used: vendor }, monthly: { used: 1 },
  });

  one('the three numbers, one endpoint', readingFrom(B('2026-09-18', 1646, 70000), '2026-09-18', 't').reading.day_used, 1646,
      'budget.daily.used and budget.provider.requests_used, read together');
  one('a route that ignored ?date=', readingFrom(B('2026-09-19', 10, 7), '2026-09-18', 't').ok, false,
      'today silently compared against yesterday is the whole measurement, wrong');
  one('a day still running is refused', readingFrom(B('2026-09-18', 10, 7, true), '2026-09-18', 't').ok, false,
      'a partial total against a full vendor delta manufactures a shortfall');
  one('an unreadable vendor figure', readingFrom({ daily: { date: 'd', used: 1, is_today: false }, provider: {} }, 'd', 't').ok, false,
      'Number(null) is 0 and the day would read as free (Rule 99)');
  // The live shape, and the one the first run died on. The vendor returns the
  // header value as a STRING; rejecting it rejects every real reading.
  one('THE VENDOR SENDS A STRING',
      readingFrom({ daily: { date: 'd', used: 1, is_today: false }, provider: { requests_used: '76945' } }, 'd', 't').reading.vendor_month_used,
      76945, 'measured live 2026-09-19 — a typeof check refused the only shape the route returns');
  one('an empty string is still absent',
      readingFrom({ daily: { date: 'd', used: 1, is_today: false }, provider: { requests_used: '' } }, 'd', 't').ok, false,
      "Number('') is 0, which is the same collapse wearing a different type");
  one('a non-numeric string is absent',
      readingFrom({ daily: { date: 'd', used: 1, is_today: false }, provider: { requests_used: 'n/a' } }, 'd', 't').ok, false,
      'NaN must not become a vendor delta');

  const R = (at, vendor) => ({ at, vendor_month_used: vendor });
  one('no baseline is no-data', vendorDay(null, R('2026-09-19T00:10:00Z', 100)).state, 'no-data',
      'absent is not a zero-spend day');
  one('an ordinary day', vendorDay(R('2026-09-18T00:10:00Z', 68000), R('2026-09-19T00:10:00Z', 70000)).vendorDay, 2000,
      'the vendor cumulative differenced over one UTC day');
  one('THE MONTH BOUNDARY', vendorDay(R('2026-09-30T00:10:00Z', 70000), R('2026-10-01T00:10:00Z', 900)).state, 'month-boundary',
      'the vendor counter resets; the negative delta is not a refund and not spend');
  one('a reset off the 1st', vendorDay(R('2026-09-04T00:10:00Z', 70000), R('2026-09-05T00:10:00Z', 120)).state, 'counter-reset',
      'a billing cycle need not land on the 1st, so magnitude catches what the month check misses');
  // The runner drifts 104-405 minutes here, so this is the common case, not an
  // edge one. Without it a late run silently differences a longer vendor window
  // against a fixed 24h day and books the difference as a shortfall.
  one('A LATE RUN IS REFUSED', vendorDay(R('2026-09-18T00:10:00Z', 68000), R('2026-09-19T04:30:00Z', 70000)).state, 'window-drift',
      '28.3h of vendor spend against 24h of ours — the extra 4.3h is not a finding');
  one('an early run too', vendorDay(R('2026-09-18T04:30:00Z', 68000), R('2026-09-19T00:10:00Z', 70000)).state, 'window-drift',
      '19.7h, the same error with the sign flipped');
  one('the window is reported when it passes', vendorDay(R('2026-09-18T00:10:00Z', 68000), R('2026-09-19T01:00:00Z', 70000)).hours, 24.8,
      'inside the band, and the reader sees how far inside rather than inferring it');

  one('the counter tracks the bill', residualVerdict(2000, 1900, 80).state, 'tracks-the-bill', 'residual 20, inside max(50, 100)');
  one('THE BREACH SHAPE', residualVerdict(3000, 1900, 80).state, 'counter-under-counts',
      'the vendor billed 3000 where our day recorded 1900 and CI explains 80');
  one('the other direction', residualVerdict(1000, 1900, 0).state, 'we-overcharge-ourselves',
      'wasted headroom, not a breach — a different finding and it must not read as one');
  one('CI is subtracted, not ignored', residualVerdict(2000, 1000, 1000).state, 'tracks-the-bill',
      'a backfill day would otherwise report a breach every time it runs');
  one('the tolerance follows the VENDOR', residualVerdict(10000, 5000, 0).tol, 500,
      '5% of ours would be 250 and would shrink exactly as our counter under-reports');
  one('an unreadable side', residualVerdict(null, 1, 0).state, 'unreadable', 'never a number derived from a missing one');

  // The named part of an overcharge. Rule 99 on the null, because "nothing was
  // unreconciled" and "we could not read the tally" do not explain a residual
  // the same way.
  const NH = (rows) => noHeaderCredits(rows);
  const row = (site, state, n, kept) => ({ site, state, cache: 'EXPIRED', n, credits_kept: kept });
  one('an absent tally is null, not zero', NH(undefined), null, 'a missing tally explains nothing');
  one('a non-array is null too', NH({ site: 'x' }), null);
  one('an empty tally is a real zero', NH([]).credits, 0, 'read and empty is an answer');
  one('only no-header rows count',
      NH([row('a', 'no-header', 10, 20), row('b', 'reconciled', 99, 300)]).credits, 20,
      'a reconciled row has already been settled and is not part of the overcharge');
  one('calls are summed beside credits', NH([row('a', 'no-header', 10, 20), row('a', 'no-header', 5, 10)]).calls, 15);
  one('the sites are named', NH([row('b', 'no-header', 1, 2), row('a', 'no-header', 1, 2)]).sites.join(','), 'a,b',
      'the reader needs which site, not only how much');
  one('a cache-hit row is not an overcharge', NH([row('a', 'cache-hit', 9, 0)]).credits, 0,
      'reconcile already refunded those in full');

  // THE LEDGER ON THE VENDOR'S WINDOW. Pairs below are rows of
  // outbox/odds-daily-vs-vendor-series.json, verbatim, with the known CI spend
  // that day's log printed (200, 100, 160). They are READINGS, observed on the
  // relay; the arithmetic on them is the code under test.
  const S = (at, vendor, ledger, day) => ({ at, vendor_month_used: vendor, ledger_month_used: ledger, day_used: day });
  const lw = (p, c) => ledgerWindow(p, c);
  one('the ledger over a window', lw(S('2026-10-30T05:38:37.872Z', 35587, 47298, 1184), S('2026-10-31T05:29:25.893Z', 36032, 47989, 916)).ledgerWindow, 691,
      'a DIFFERENCE of two readings, not the later one');
  one('a ledger that did not move is a real zero', lw(S('a', 1, 500, 0), S('b', 1, 500, 0)).ledgerWindow, 0, 'read and unchanged is an answer');
  one('an absent ledger is unreadable, not zero', lw(S('a', 1, null, 0), S('b', 1, 500, 0)).state, 'ledger-unreadable', 'Number(null) is 0 (Rule 99)');
  one('so is an absent ledger on the later side', lw(S('a', 1, 500, 0), { at: 'b', vendor_month_used: 1 }).state, 'ledger-unreadable', 'a field that is not there');
  one('a numeric string is not a ledger', lw(S('a', 1, '500', 0), S('b', 1, 600, 0)).state, 'ledger-unreadable',
      'the route sends a number; a string means the shape changed');
  one('no baseline is unreadable too', lw(null, S('b', 1, 600, 0)).state, 'ledger-unreadable', 'nothing to difference');
  one('a ledger that fell inside a month is refused', lw(S('a', 1, 600, 0), S('b', 1, 500, 0)).state, 'ledger-went-backwards',
      'a fall is a bad reading, not a refund, and not negative spend');

  // THE REAL PAIRS. 2026-10-12 is the one the CC-CMD names: window residual
  // 3383 - 3373 - 200 = -190, and NOT the -616 the UTC-day counter gave.
  const P1012 = [S('2026-10-12T05:48:55.608Z', 11690, 21635, 3800), S('2026-10-13T06:42:50.011Z', 15073, 25008, 3799), 200];
  const P1023 = [S('2026-10-23T04:40:34.671Z', 29224, 40742, 1521), S('2026-10-24T04:28:56.763Z', 30035, 41453, 636), 100];
  const P1030 = [S('2026-10-30T05:38:37.872Z', 35587, 47298, 1184), S('2026-10-31T05:29:25.893Z', 36032, 47989, 916), 160];
  const J = ([p, c, ci]) => judgeDay(p, c, ci);
  one('THE 10-12 PAIR: window residual is -190', J(P1012).window.residual, -190, 'vendor 3383 - ledger 3373 - CI 200, the CC-CMD\'s figure');
  one('...and NOT -616', J(P1012).window.residual === -616, false, '-616 is the UTC-day counter (3383 - 3799 - 200) and is a different 24 hours');
  one('...the UTC-day diagnostic still reads -616', J(P1012).utcDay.residual, -616, 'kept, labelled, never the verdict');
  one('10-12 verdict', J(P1012).state, 'we-overcharge-ourselves', '|-190| is above max(50, 5% of 3383) = 169');
  one('THE 10-23 PAIR reads 0 against the window', J(P1023).window.residual, 0, 'vendor 811 - ledger 711 - CI 100');
  one('...so its verdict is health, not the breach', J(P1023).state, 'tracks-the-bill',
      'the UTC-day counter said counter-under-counts (+75) on this day; that was the offset');
  one('...and the UTC-day diagnostic would have said breach', J(P1023).utcDay.state, 'counter-under-counts',
      'the old verdict, now only a diagnostic');
  one('THE 10-30 PAIR window residual', J(P1030).window.residual, -406, 'vendor 445 - ledger 691 - CI 160');
  one('...against the UTC day it read', J(P1030).utcDay.residual, -631, '445 - 916 - 160');
  one('a window breach is still a breach', judgeDay(S('2026-09-18T00:10:00Z', 100, 100, 0), S('2026-09-19T00:10:00Z', 3100, 2000, 1900), 80).state, 'counter-under-counts',
      'vendor 3000, ledger 1900, CI 80: the ledger under-counted the window');
  one('the tolerance follows the VENDOR on the window path', J(P1012).window.tol, 169, '5% of 3383, not of our 3373 or 3799');

  // The refusals pass through judgeDay unchanged: the window path must not be
  // a way round them.
  const BOUNDARY = [S('2026-10-31T05:29:25.893Z', 36032, 47989, 916), S('2026-11-01T05:54:31.202Z', 171, 189, 1018), 0];
  one('THE REAL MONTH BOUNDARY (2026-11-01) is still refused', J(BOUNDARY).state, 'month-boundary',
      'vendor 36032 -> 171; the ledger reset too, and a negative window is not spend');
  one('a drifted window is still refused', judgeDay(S('2026-09-18T00:10:00Z', 1, 1, 0), S('2026-09-19T04:30:00Z', 9, 9, 0), 0).state, 'window-drift', '28.3 h');
  one('no baseline is still no-data', judgeDay(null, S('2026-09-19T00:10:00Z', 9, 9, 0), 0).state, 'no-data', 'a first reading');
  one('an unreadable ledger is its own state, with no residual',
      JSON.stringify([judgeDay(S('2026-09-18T00:10:00Z', 100, null, 0), S('2026-09-19T00:10:00Z', 900, 800, 700), 0).state,
                      'window' in judgeDay(S('2026-09-18T00:10:00Z', 100, null, 0), S('2026-09-19T00:10:00Z', 900, 800, 700), 0)]),
      JSON.stringify(['ledger-unreadable', false]), 'never a verdict computed from a defaulted zero');
  one('a ledger that fell is its own state',
      judgeDay(S('2026-09-18T00:10:00Z', 100, 900, 0), S('2026-09-19T00:10:00Z', 900, 800, 700), 0).state, 'ledger-went-backwards', 'inside one month');

  // The log must show both figures and say which is the verdict.
  const lines = judgementLines(J(P1012), P1012[1], { credits: 200, runs: 1, undated: 0 });
  one('THE LOG: the window residual is labelled as the verdict',
      lines.find((l) => l.includes('residual (window-aligned)')), '  residual (window-aligned)   : -190   tolerance 169   <- the verdict', 'the line a reader acts on');
  one('THE LOG: the UTC-day figure is present and labelled a diagnostic',
      [lines.find((l) => l.includes('NOT the verdict')), lines.find((l) => l.includes('residual against that'))],
      ['  diagnostic, NOT the verdict : the UTC day\'s counter covers a different 24 hours than the window', '  residual against that       : -616   tolerance 169'],
      'both numbers, so the change is visible without reading the code');
  one('THE LOG: the ledger window and its source are named',
      lines.find((l) => l.includes('our ledger, same window')), '  our ledger, same window     : 3373   (monthly.used at those two readings)', 'what the verdict differences against');

  // THE LEDGER IS READ ONLY FROM D1. A reading whose monthly.source is not 'd1' (the route falls back to a KV correction counter,
  // far below the real month total, when its D1 read throws) stores no ledger at all, so it cannot become a baseline.
  const MB = (monthly) => ({ daily: { date: 'd', used: 1, is_today: false }, provider: { requests_used: '5' }, monthly });
  one('the ledger counts when the route read D1', readingFrom(MB({ used: 47298, source: 'd1' }), 'd', 't').reading.ledger_month_used, 47298, 'the live shape');
  one('...and not when it fell back to KV', readingFrom(MB({ used: 61, source: 'kv-d1-unreadable', kv_used: 61 }), 'd', 't').reading.ledger_month_used, null,
      'a 61 stored as the baseline would corrupt this window and the next');
  one('...the source is kept as evidence', readingFrom(MB({ used: 61, source: 'kv-d1-unreadable' }), 'd', 't').reading.ledger_source, 'kv-d1-unreadable', 'a null with no reason is a mystery');
  one('a ledger with no source is not trusted', readingFrom(MB({ used: 47298 }), 'd', 't').reading.ledger_month_used, null, 'strict: the route always says');
  one('a string ledger is not a number', readingFrom(MB({ used: '47298', source: 'd1' }), 'd', 't').reading.ledger_month_used, null, 'the shape changed');
  one('no monthly block at all', readingFrom({ daily: { date: 'd', used: 1, is_today: false }, provider: { requests_used: '5' } }, 'd', 't').reading.ledger_month_used, null, 'absent is null, not 0');

  // THE CI ROWS ARE A READING TOO. The route's real success is FLAT: { success: true, results: [rows], meta }.
  const CIR = (status, body) => ciRowsFrom(status, body);
  one('the real flat success', CIR(200, { success: true, results: [{ completed_at: 'x', credits_used: 5 }], meta: {} }).rows.length, 1, 'src/index.js, POST /d1/execute');
  one('HTTP 500 {ok:false,error} is unreadable', CIR(500, { ok: false, error: 'boom' }).ok, false, 'not an empty list');
  one('HTTP 401 unauthorized is unreadable', CIR(401, null).why, 'HTTP 401', 'a missing or wrong secret');
  one('a 200 that says success:false is unreadable and says why', CIR(200, { success: false, error: 'table not allowed' }).why, 'success is false (table not allowed)', 'the reason is kept');
  one('a 200 whose results is not an array is unreadable', CIR(200, { success: true, results: 'x' }).ok, false, 'never read as no rows');
  one('the nested shape the old stub invented is NOT accepted', CIR(200, { results: [{ results: [{ completed_at: 'x', credits_used: 5 }] }] }).ok, false,
      'the real route never sends it, and two shapes were a fallback');
  one('no status is unreadable', CIR(undefined, { success: true, results: [] }).ok, false, 'a thrown fetch');
  one('an empty result is a real zero rows', CIR(200, { success: true, results: [] }).rows.length, 0, 'read and empty is an answer');

  const P1012b = [S('2026-10-12T05:48:55.608Z', 11690, 21635, 3800), S('2026-10-13T06:42:50.011Z', 15073, 25008, 3799)];
  one('UNREAD CI is a state of its own, with no residual', JSON.stringify([judgeDay(...P1012b, null).state, 'window' in judgeDay(...P1012b, null)]), JSON.stringify(['ci-unreadable', false]),
      'the 10-12 pair with CI defaulted to 0 reads tracks-the-bill (residual 10) and that is wrong');
  one('...so is NaN and undefined', JSON.stringify([judgeDay(...P1012b, NaN).state, judgeDay(...P1012b, undefined).state]), JSON.stringify(['ci-unreadable', 'ci-unreadable']), 'never coerced');
  one('...while a real 0 is a number', judgeDay(...P1012b, 0).state, 'tracks-the-bill', 'read and zero: 3383 - 3373 - 0 = 10');
  one('a vendor refusal still comes before the CI check', judgeDay(null, P1012b[1], null).state, 'no-data', 'the order of the refusals is unchanged');

  // Boundaries the earlier cases did not reach.
  one('a ledger that fell by 1 is refused', lw(S('a', 1, 501, 0), S('b', 1, 500, 0)).state, 'ledger-went-backwards', 'not a rounding allowance');
  one('an infinite ledger is unreadable', lw(S('a', 1, 500, 0), S('b', 1, Infinity, 0)).state, 'ledger-unreadable', 'a delta of Infinity is not spend');
  one('a NaN ledger is unreadable', lw(S('a', 1, NaN, 0), S('b', 1, 600, 0)).state, 'ledger-unreadable', 'NaN comparisons are all false');
  one('THE WINDOW TOLERANCE FOLLOWS THE VENDOR, with a pair where the two differ',
      judgeDay(S('2026-09-18T00:10:00Z', 0, 0, 0), S('2026-09-19T00:10:00Z', 10000, 6000, 0), 0).window.tol, 500,
      '5% of the vendor 10000, not of the ledger 6000 (300): the allowance must not shrink as the ledger under-reports');

  // The operand lines, so the log can be checked by hand against the series.
  const L2 = judgementLines(J(P1012), P1012[1], { credits: 200, runs: 1, undated: 0 });
  one('THE LOG: the vendor window line', L2.find((l) => l.includes('vendor billed in the window')), '  vendor billed in the window : 3383   (24.9 h between the two readings)', 'the first operand');
  one('THE LOG: the known CI line', L2.find((l) => l.includes('known CI spend')), '  known CI spend              : 200   (1 run(s), 0 undated)', 'the subtracted operand');
  one('THE LOG: the daily counter line', L2.find((l) => l.includes('our daily counter (UTC day)')), '  our daily counter (UTC day) : 3799', 'the diagnostic operand');

  console.log(bad ? `\n${bad} FAILED` : `\nself-test: ${total}/${total}`);
  console.log(`COVERAGE: EIGHT pure functions over ENUMERATED inputs, the window-aligned verdict on THREE real series pairs. It does NOT reach`);
  console.log(`/budget/odds, D1, or the vendor, and it cannot see spend by any script that`);
  console.log(`does not record itself — so the residual is an UPPER bound, never a level.`);
  process.exit(bad ? 1 : 0);
}

const LOG = [];
const say = (l = '') => { LOG.push(l); console.log(l); };
const err = (l = '') => { LOG.push(l); console.error(l); };
function flush() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  try { writeFileSync(`outbox/odds-daily-vs-vendor-${stamp}.log`, LOG.join('\n') + '\n'); }
  catch (e) { console.error(`could not write the outbox log: ${e.message}`); }
}
const die = (code) => { flush(); process.exit(code); };

const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const NOW = new Date().toISOString();
say(`=== odds daily vs vendor  day=${YESTERDAY}  utc=${NOW} ===\n`);

const res = await fetch(`${RELAY}/budget/odds?date=${YESTERDAY}`, { headers: { Accept: 'application/json' } });
if (!res.ok) { err(`FAIL: /budget/odds?date=${YESTERDAY} returned HTTP ${res.status}`); die(1); }
const rawBudget = await res.json();
const parsed = readingFrom(rawBudget, YESTERDAY, NOW);
if (!parsed.ok) {
  err(`FAIL: no usable reading — ${parsed.why}.`);
  err(`      Recording it anyway is how a garbage reading passes as a quiet one.`);
  die(1);
}
const reading = parsed.reading;

let series = [];
if (existsSync(SERIES)) { try { series = JSON.parse(readFileSync(SERIES, 'utf8')); } catch (_) { series = []; } }
series = series.filter(x => x && typeof x.vendor_month_used === 'number' && typeof x.day_used === 'number');
const prev = series.length ? series[series.length - 1] : null;

say(`  ${YESTERDAY} our counter : ${reading.day_used} / ${reading.ceiling}`);
say(`  our monthly ledger now : ${reading.ledger_month_used}`);
say(`  vendor cumulative now  : ${reading.vendor_month_used}`);
say(`  previous reading       : ${prev ? `${prev.at}  vendor ${prev.vendor_month_used}` : 'none — this is the baseline'}`);

const vd = vendorDay(prev, reading);
// null = the CI rows were not read. NOT zero: judgeDay turns it into a failure, because known CI spend is
// subtracted and an unread quantity defaulted to 0 shifts the verdict by up to a day's backfill.
let ci = null;
let ciWhy = null;
if (vd.state === 'ok') {
  try {
    const r = await fetch(`${RELAY}/d1/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE },
      body: JSON.stringify({ sql: `SELECT completed_at, credits_used FROM odds_backfill_progress WHERE completed_at >= ?`, params: [prev.at.slice(0, 10)] }),
    });
    let b = null;
    try { b = await r.json(); } catch (_) { /* not JSON: ciRowsFrom says so */ }
    const c = ciRowsFrom(r.status, b);
    if (c.ok) ci = ciSpendInInterval(c.rows, prev.at, reading.at);
    else ciWhy = c.why;
  } catch (e) { ciWhy = e.message; }
  if (ci === null) err(`  (CI rows unreadable: ${ciWhy})`);
}

series.push(reading);
writeFileSync(SERIES, JSON.stringify(series.slice(-90), null, 2) + '\n');

if (vd.state !== 'ok') {
  say(`\n  verdict: ${vd.state}${vd.from ? `  ${vd.from} -> ${vd.to}` : ''}`);
  say(`\nCOVERAGE: 1 reading recorded for ${YESTERDAY}; ${series.length} on file. No comparison`);
  say(`this run — ${vd.state === 'no-data' ? 'a first reading has no baseline' : 'the vendor counter did not run continuously across the window'}.`);
  say(`\nOK: reading stored. A verdict needs two readings inside one vendor billing month.`);
  flush();
  process.exit(0);
}

// THE VERDICT IS THE WINDOW. The vendor delta and the ledger delta are taken at
// the same two readings; the UTC-day counter is printed beside them as a
// diagnostic and never decides. A window that cannot be measured (no readable
// ledger on one of its two readings, a ledger that fell, CI rows that could not
// be read) is a FAILURE, not a refusal: no verdict is computed from a defaulted
// zero, and quietly falling back to the UTC-day figure would put the offset back
// into the verdict. It is a defect in a reading, so it clears when two
// consecutive readings are good (the bad one is the next run's baseline).
const j = judgeDay(prev, reading, ci === null ? null : ci.credits);
if (j.state === 'ledger-unreadable' || j.state === 'ledger-went-backwards' || j.state === 'ci-unreadable') {
  say(`\n  verdict: ${j.state}`);
  if (j.state === 'ci-unreadable') {
    err(`\nFAIL: the vendor window (${vd.vendorDay} credits over ${vd.hours} h) cannot be judged: the CI rows could not be read (${ciWhy}).`);
    err(`      Known CI spend is subtracted from the vendor's figure, so it has to be known; it is NOT treated as 0.`);
  } else {
    err(`\nFAIL: the vendor window (${vd.vendorDay} credits over ${vd.hours} h) has no usable ledger delta: ` +
        (j.state === 'ledger-unreadable'
          ? `monthly.used is missing, not a number, or not read from D1 on one of the two readings (previous ${JSON.stringify(prev.ledger_month_used)} [source ${JSON.stringify(prev.ledger_source ?? null)}], now ${JSON.stringify(reading.ledger_month_used)} [source ${JSON.stringify(reading.ledger_source)}]).`
          : `monthly.used fell by ${-j.lw.delta} inside one month (previous ${prev.ledger_month_used}, now ${reading.ledger_month_used}).`));
    err(`      No verdict is computed from a defaulted zero and the UTC-day counter is NOT substituted.`);
  }
  die(1);
}
for (const l of judgementLines(j, reading, ci)) say(l);
const v = j.window;

// THE KNOWN PART OF THE OVERCHARGE, NAMED. It is reported beside the residual
// and deliberately NOT folded into it: netting it out would silently reclassify
// days, and the verdict's three states are what every other watch and document
// quotes. Rule 91 asks for the denominator to be visible, not for the
// arithmetic to be rewritten.
const nh = noHeaderCredits(rawBudget?.daily?.reconcile);
if (nh === null) {
  say(`  unreconciled estimate  : UNREADABLE — daily.reconcile is not an array, so none of`);
  say(`                           the UTC-day residual above can be attributed to a kept estimate`);
} else if (nh.credits === 0) {
  say(`  unreconciled estimate  : 0 — no call kept an estimate for want of a receipt`);
} else {
  // The tally is a tally of the closed UTC DAY, so it is netted against the
  // UTC-day diagnostic, not against the window-aligned verdict.
  const after = j.utcDay.residual + nh.credits;
  say(`  unreconciled estimate  : ${nh.credits} over ${nh.calls} call(s) in state no-header`);
  say(`                           from ${nh.sites.join(', ')}`);
  say(`  UTC-day residual after it : ${after}   (the part no named cause accounts for; a UTC-day figure)`);
}

say(`\n  verdict: ${v.state}`);

say(`\nCOVERAGE: ONE closed day (${YESTERDAY}), ${series.length} reading(s) on file. knownCI is a`);
say(`LOWER bound — only odds-backfill records its own credits, and targeted-odds-fill`);
say(`calls the vendor directly with no counter at all — so the residual above is an`);
say(`UPPER bound on the ledger's shortfall over the window, not a measurement of it.`);

if (v.state === 'counter-under-counts') {
  err(`\nFAIL: the vendor billed ${vd.vendorDay} in the window where our monthly ledger recorded ${j.lw.ledgerWindow},`);
  err(`      and ${ci.credits} of the difference is known CI spend. ${v.residual} credits reached the`);
  err(`      vendor without reaching the ledger.`);
  err(`      The CEILING reads odds:daily:*, not the ledger: its UTC-day figure is the diagnostic above`);
  err(`      (${reading.day_used} for ${YESTERDAY}, residual ${j.utcDay.residual}). Whether the two counters agree is the question`);
  err(`      of scripts/watch-odds-daily-vs-monthly.mjs; read it beside this. If the ledger under-counts across`);
  err(`      three days AND the daily counter agrees with the ledger, the ceiling has been guarding a number`);
  err(`      below the truth.`);
  die(1);
}
if (v.state === 'we-overcharge-ourselves') {
  err(`\nFAIL: our ledger recorded ${Math.abs(v.residual)} MORE than the vendor billed in the window. That is not a`);
  err(`      breach — it is headroom thrown away, most likely reconcile not refunding an`);
  err(`      over-estimate. A different defect, and it must not be read as the other one.`);
  die(1);
}
say(`\nOK: ${v.state} — residual ${v.residual} within ${v.tol}.`);
flush();
