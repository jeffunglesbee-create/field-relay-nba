#!/usr/bin/env node
// Is the ENFORCING counter right? The only odds question with money attached.
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
// over ONE closed UTC day against that day's own counter.
//
// WHY A NEW SCHEDULE RATHER THAN THE EXISTING SERIES. The pairing watch's
// readings land wherever the runner fires, and the measured scheduled-run delay
// here is 104-405 minutes, so no two of them bound a UTC day. This runs once at
// 00:10 and reads YESTERDAY by explicit date — the same delay-immunity the
// attribution watch already carries.
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
  return { ok: true, reading: {
    at, day: wantDay, day_used: d.used, ceiling: d.ceiling ?? null,
    vendor_month_used: v, ledger_month_used: body?.monthly?.used ?? null,
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
  // THE TWO SIDES MUST MEASURE THE SAME WINDOW. `ourDay` is a clean 24h UTC
  // calendar day read by explicit date. The vendor side is a difference between
  // two READING timestamps, and scheduled runs in this repo drift 104-405
  // minutes. A run at 00:10 followed by one at 04:30 differences 28.3 hours of
  // vendor spend against 24 hours of ours, and the extra 4.3 hours lands in the
  // residual as a shortfall that is not one.
  //
  // Refused rather than corrected, because correcting it needs a model of when
  // spend happens and no such model is measured. A skipped day with a stated
  // reason beats a day with a wrong number in it.
  const hours = (Date.parse(curr.at) - Date.parse(prev.at)) / 3600000;
  if (!Number.isFinite(hours)) return { state: 'unreadable' };
  if (hours < 22 || hours > 26) return { state: 'window-drift', hours: Math.round(hours * 10) / 10 };
  return { state: 'ok', vendorDay: delta, hours: Math.round(hours * 10) / 10 };
}

/** What the day says about the enforcing counter.
 *  residual = vendorDay - ourDay - knownCI, and it is an UPPER bound: only
 *  odds-backfill records its own credits, so any other direct-vendor script
 *  (targeted-odds-fill, confirmed) is not subtracted. */
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

if (process.argv.includes('--self-test')) {
  let bad = 0;
  const one = (label, got, want, why) => JSON.stringify(got) === JSON.stringify(want)
    ? console.log(`  PASS  ${label} -> ${JSON.stringify(got)}  (${why})`)
    : (bad++, console.log(`  FAIL  ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`));

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

  console.log(bad ? `\n${bad} FAILED` : `\nself-test: 20/20`);
  console.log(`COVERAGE: three pure predicates over ENUMERATED inputs. It does NOT reach`);
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
const parsed = readingFrom(await res.json(), YESTERDAY, NOW);
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
say(`  vendor cumulative now  : ${reading.vendor_month_used}`);
say(`  previous reading       : ${prev ? `${prev.at}  vendor ${prev.vendor_month_used}` : 'none — this is the baseline'}`);

const vd = vendorDay(prev, reading);
let ci = { credits: 0, runs: 0, undated: 0 };
if (vd.state === 'ok') {
  try {
    const r = await fetch(`${RELAY}/d1/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE },
      body: JSON.stringify({ sql: `SELECT completed_at, credits_used FROM odds_backfill_progress WHERE completed_at >= ?`, params: [prev.at.slice(0, 10)] }),
    });
    const b = await r.json();
    const rows = (b.results || b.result || []);
    ci = ciSpendInInterval(Array.isArray(rows) ? (rows[0]?.results || rows) : (rows.results || []), prev.at, reading.at);
  } catch (e) { err(`  (CI rows unreadable: ${e.message} — knownCI treated as 0, which makes the residual LARGER, not smaller)`); }
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

const v = residualVerdict(vd.vendorDay, reading.day_used, ci.credits);
say(`\n  vendor billed that day : ${vd.vendorDay}`);
say(`  our daily counter      : ${reading.day_used}`);
say(`  known CI spend         : ${ci.credits}   (${ci.runs} run(s), ${ci.undated} undated)`);
say(`  residual               : ${v.residual}   tolerance ${v.tol}`);
say(`\n  verdict: ${v.state}`);

say(`\nCOVERAGE: ONE closed day (${YESTERDAY}), ${series.length} reading(s) on file. knownCI is a`);
say(`LOWER bound — only odds-backfill records its own credits, and targeted-odds-fill`);
say(`calls the vendor directly with no counter at all — so the residual above is an`);
say(`UPPER bound on the enforcing counter's shortfall, not a measurement of it.`);

if (v.state === 'counter-under-counts') {
  err(`\nFAIL: the vendor billed ${vd.vendorDay} where odds:daily:${YESTERDAY} recorded ${reading.day_used},`);
  err(`      and ${ci.credits} of the difference is known CI spend. ${v.residual} credits reached the`);
  err(`      vendor without reaching the counter the CEILING reads.`);
  err(`      If this holds across three days, every day that "closed at 3800/3800" spent`);
  err(`      more than 3800 and the ceiling has been guarding a number below the truth.`);
  die(1);
}
if (v.state === 'we-overcharge-ourselves') {
  err(`\nFAIL: our counter recorded ${Math.abs(v.residual)} MORE than the vendor billed. That is not a`);
  err(`      breach — it is headroom thrown away, most likely reconcile not refunding an`);
  err(`      over-estimate. A different defect, and it must not be read as the other one.`);
  die(1);
}
say(`\nOK: ${v.state} — residual ${v.residual} within ${v.tol}.`);
flush();
