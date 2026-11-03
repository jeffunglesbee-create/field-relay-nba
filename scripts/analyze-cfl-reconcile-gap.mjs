#!/usr/bin/env node
// P5 of docs/CC-CMD-2026-10-13-vendor-residual-window.md, Task 2: how much of the ledger's over-record is the gap between what handleCFLOddsProbs holds in
// odds_site_daily (`by_site`, net of the refunds that landed) and what its reconcile tally says it kept (`credits_kept`), and does that gap move with cache-hit calls?
//
// Reads two COMMITTED series (no network, no credits):
//   outbox/odds-site-drift-series.json       the drift sampler's rows: { at, date, by_site{site:n}, reconcile[{site,state,cache,n,credits_kept}], degraded_open }
//   outbox/odds-daily-vs-vendor-series.json  the vendor watch's rows: { at, day, vendor_month_used, ledger_month_used }, and the log beside each, for `known CI spend`
// Usage: node scripts/analyze-cfl-reconcile-gap.mjs [--self-test]        writes outbox/cfl-reconcile-gap.json (the committed 2026-11-01 record: pass --out to keep it) and prints the tables.
//        node scripts/analyze-cfl-reconcile-gap.mjs --out PATH            the same, written to PATH; the drift series is a rolling 60 samples, so a later run cannot reproduce an earlier one's windows.
//        node scripts/analyze-cfl-reconcile-gap.mjs --day YYYY-MM-DD      done condition 5's read of one UTC day; writes outbox/cfl-stranded-day-<day>.json and nothing else.
//
// WHAT THE GAP IS, from budget-helpers.js (the reconcile function): a charge of 6 is made before the fetch. After it, a cache HIT is corrected by -6 in one D1 batch
// (day, site, month), THEN the tally row is written. So by_site is net of landed corrections and credits_kept is the INTENT. by_site - kept is therefore 6 for every call
// whose charge stayed although the tally says it was refunded (or was never reached), and for every kept call whose tally row is missing. It does not say which.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';

export const SITE = 'handleCFLOddsProbs';
export const CALL = 6; // oddsCreditCost of the CFL URL: markets=h2h,spreads,totals x regions=us,eu

// A row with no numeric value where a sum needs one THROWS: a missing field coerced to zero inside a sum is indistinguishable from a real zero (absence is not zero).
const sumBy = (rows, f) => rows.reduce((t, r) => { const v = f(r); if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`a reconcile row has no numeric value where a sum needs one: ${JSON.stringify(r).slice(0, 120)}`); return t + v; }, 0);

/** One drift sample -> the CFL line of it. `kept` is Σ credits_kept of THIS site's reconcile rows only. */
export function cflSample(s, site = SITE) {
  // ABSENCE IS NOT ZERO. A sample that lost its reconcile array, its by_site object, or that lists the site as unreadable is not a sample of "no calls" and "no spend": it throws.
  // The relay lists a site in by_site once it has spend that day, so a present by_site without the site key IS a day with none, and says so (`by_site_absent`) for the count printed below.
  if (!Array.isArray(s.reconcile)) throw new Error(`sample ${s.at} has no reconcile array (absence is not "no calls")`);
  if (!s.by_site || typeof s.by_site !== 'object') throw new Error(`sample ${s.at} has no by_site object (absence is not "no spend")`);
  if (Array.isArray(s.unreadable_sites) && s.unreadable_sites.includes(site)) throw new Error(`sample ${s.at}: ${site} is listed in unreadable_sites, so its by_site is not a reading`);
  const present = Object.prototype.hasOwnProperty.call(s.by_site, site);
  if (present && (typeof s.by_site[site] !== 'number' || !Number.isFinite(s.by_site[site]))) throw new Error(`sample ${s.at}: by_site.${site} is ${JSON.stringify(s.by_site[site])}, not a number`);
  const rec = s.reconcile.filter((r) => r.site === site);
  // A row with no `state` cannot be classed as an error row or not, and `stranded` below depends on that: it throws (618 of 618 rows in the committed series carry one, read 2026-11-02).
  for (const r of rec) if (typeof r.state !== 'string') throw new Error(`sample ${s.at}: a reconcile row of ${site} has no state (absence is not "not an error row"): ${JSON.stringify(r).slice(0, 120)}`);
  const by = present ? s.by_site[site] : 0;
  const kept = sumBy(rec, (r) => r.credits_kept);
  // An `error` row is a reconcile that threw AFTER its refund landed (measured for CFL on 2026-11-01: by_site rose by exactly the billed calls while an error call added kept +6), so its
  // `kept` is an intent with no standing charge behind it. by_site - kept therefore UNDER-reads the charges that stayed by exactly that amount; `stranded` takes it back out.
  const kept_error = sumBy(rec.filter((r) => r.state === 'error'), (r) => r.credits_kept);
  const n = sumBy(rec, (r) => r.n);
  const hit = sumBy(rec.filter((r) => r.cache === 'HIT'), (r) => r.n);
  return { at: s.at, date: s.date, by_site: by, by_site_absent: !present, kept, kept_error, gap: by - kept, calls: (by - kept) / CALL, stranded: by - (kept - kept_error), n, hit, non_hit: n - hit, degraded_open: s.degraded_open ? s.degraded_open.events : null };
}

// Done condition 5 of docs/CC-CMD-2026-10-13-vendor-residual-window.md (criterion fixed 2026-11-01, moved from `gap` to `stranded` 2026-11-02): on a UTC day with at least DC5_MIN_HIT cache-HIT calls tallied,
// the charges that stayed are at most DC5_MAX_STRANDED credits (8 calls). Fewer HIT calls is inconclusive. DC5_MIN_LAST_SAMPLE_HOUR is a design choice of THIS read, not a measured boundary. What the committed series
// (60 samples, 2026-10-20 to 11-02, read 2026-11-02) does show: on 10 of its 14 days the day's last sample still added CFL spend over its own interval (10-26 +48 at 21:58Z, 10-28 +114 at 21:56Z, 10-29 +258
// at 22:05Z), so the unread tail after a day's last sample is not known to be empty, and a day whose last sample is earlier than this hour cannot pass.
export const DC5_MAX_STRANDED = 48, DC5_MIN_HIT = 100, DC5_MIN_LAST_SAMPLE_HOUR = 21;

/** The done-condition-5 read of one UTC day from cflSample rows: the day's LAST sample (the figures are cumulative within the day), both figures, the hours that are not in the series, and a verdict. */
export function dayRead(rows, day) {
  const today = rows.filter((r) => r.date === day).sort((a, b) => a.at.localeCompare(b.at));
  if (!today.length) return { day, samples: 0, verdict: 'no-data', reason: `no drift sample is dated ${day} (absence is not "no spend")` };
  const l = today[today.length - 1];
  const lastHour = Number(l.at.slice(11, 13)) + Number(l.at.slice(14, 16)) / 60;
  const base = { day, samples: today.length, sample_times: today.map((r) => r.at.slice(11, 16) + 'Z'), last_sample_at: l.at, unread_hours_after_last_sample: Math.round((24 - lastHour) * 10) / 10, by_site: l.by_site, kept: l.kept, kept_error: l.kept_error, gap: l.gap, stranded: l.stranded, stranded_calls: l.stranded / CALL, n: l.n, hit: l.hit };
  const side = (v) => v <= DC5_MAX_STRANDED;
  const figures_disagree = side(l.gap) !== side(l.stranded);
  const fin = (verdict, reason) => ({ ...base, figures_disagree, verdict, reason });
  if (l.stranded < 0 || l.stranded % CALL !== 0) return fin('inconclusive:figure-not-a-count-of-calls', `stranded ${l.stranded} is not a non-negative whole number of ${CALL}-credit calls (it was in 59 of 59 CFL samples when this read was written, 2026-11-02); the model of the figure has changed, so no verdict`);
  if (l.hit < DC5_MIN_HIT) return fin('inconclusive:few-hit-calls', `${l.hit} cache-HIT calls tallied, fewer than ${DC5_MIN_HIT}`);
  if (l.stranded > DC5_MAX_STRANDED) return fin('fail', `stranded ${l.stranded} credits (${l.stranded / CALL} calls) exceeds ${DC5_MAX_STRANDED} on a day with ${l.hit} HIT calls`);
  if (lastHour < DC5_MIN_LAST_SAMPLE_HOUR) return fin('inconclusive:partial-day', `the day's last sample is at ${l.at.slice(11, 16)}Z, earlier than ${DC5_MIN_LAST_SAMPLE_HOUR}:00Z; spend after it is not in the series`);
  return fin('pass', `stranded ${l.stranded} credits (${l.stranded / CALL} calls) is at most ${DC5_MAX_STRANDED} on a day with ${l.hit} HIT calls, read through ${l.at.slice(11, 16)}Z`);
}

/** The gap is cumulative within a UTC day. [lo, hi] at instant t: the last sample at or before t and the first after it (same day), 0 at the day's start. */
export function gapAt(rows, t) {
  const day = new Date(t).toISOString().slice(0, 10);
  const today = rows.filter((r) => r.date === day).sort((a, b) => a.at.localeCompare(b.at));
  const before = today.filter((r) => r.at <= t).pop();
  const after = today.find((r) => r.at > t);
  const lo = before ? before.gap : 0;
  // A sample taken AT t is the value at t; only between samples is the value bounded by the next one.
  return { lo, hi: before && before.at === t ? lo : (after ? after.gap : lo), day };
}

/** The gap added inside [t0, t1] as bounds. Across a UTC midnight: what day(t0) added after t0 (to its last sample) plus what day(t1) had by t1. */
export function windowGap(rows, t0, t1) {
  const a = gapAt(rows, t0), b = gapAt(rows, t1);
  if (a.day === b.day) return { lo: Math.max(0, b.lo - a.hi), hi: Math.max(0, b.hi - a.lo) };
  const dayRows = rows.filter((r) => r.date === a.day).sort((x, y) => x.at.localeCompare(y.at));
  const fin = dayRows.length ? dayRows[dayRows.length - 1].gap : a.hi;
  return { lo: Math.max(0, fin - a.hi) + b.lo, hi: Math.max(0, fin - a.lo) + b.hi };
}

/** Task 1's formula over two consecutive vendor-series rows: vendor window delta - ledger window delta - known CI. Negative = the ledger recorded more than was billed. */
export function windowResidual(prev, curr, ci) {
  // A reading that is not a number (a null ledger, which the watch now writes when D1 was unreadable) is an unmeasured window, not a zero: null, as for unreadable CI spend.
  if (![prev.vendor_month_used, curr.vendor_month_used, prev.ledger_month_used, curr.ledger_month_used, ci].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const vendor = curr.vendor_month_used - prev.vendor_month_used, ledger = curr.ledger_month_used - prev.ledger_month_used;
  return { vendor, ledger, ci, residual: vendor - ledger - ci };
}

export function knownCiFromLog(text) {
  const m = /known CI spend\s*:\s*(\d+)/.exec(text || '');
  return m ? Number(m[1]) : null;
}

/** P2 of docs/CC-CMD-2026-10-13-vendor-residual-window.md: is the known CI spend (spent straight at the vendor, not through the relay) absent from the ledger? The residual subtracts it and the CFL gap is
 *  added back. If CI is NOT in the ledger, residual + gap sits near 0; if it IS, the formula has subtracted it twice and residual + gap sits near -CI. Which is nearer, for one window; null when the window
 *  is unmeasured (a residual or CI that is not a number is not a zero). */
export function ciSide(w) {
  if (typeof w.residual !== 'number' || typeof w.ci !== 'number') return null;
  const g = (w.cfl_gap_lo + w.cfl_gap_hi) / 2;
  const a = Math.abs(w.residual + g), b = Math.abs(w.residual + g + w.ci);
  return a < b ? 'not-in-ledger' : b < a ? 'in-ledger' : 'tie';
}

/** Where the full run writes. The default is the committed record, so a bare run overwrites it; a run that must keep it passes --out. A flag with no path throws rather than falling back to the default. */
export function outPath(argv) {
  const i = argv.indexOf('--out');
  if (i === -1) return 'outbox/cfl-reconcile-gap.json';
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) throw new Error('--out needs a file path');
  return v;
}

/** Pearson r; null when it is undefined (fewer than 3 points or a constant column) rather than a number that looks like a result. */
export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

if (process.argv.includes('--self-test')) {
  let bad = 0, total = 0;
  const one = (label, got, want) => { total++; const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`); };
  const S = (at, by, rec, extra = {}) => ({ at, date: at.slice(0, 10), by_site: { [SITE]: by, other: 999 }, reconcile: rec, degraded_open: { events: 0 }, ...extra });
  const rec = [
    { site: SITE, state: 'reconciled', cache: 'EXPIRED', n: 3, credits_kept: 18 },
    { site: SITE, state: 'cache-hit', cache: 'HIT', n: 10, credits_kept: 0 },
    { site: 'other', state: 'reconciled', cache: 'MISS', n: 5, credits_kept: 30 },
  ];
  const c = cflSample(S('2026-10-24T20:00:00Z', 60, rec));
  one('gap = by_site - this site\'s kept only (another site\'s kept rows are not subtracted)', [c.by_site, c.kept, c.gap, c.calls], [60, 18, 42, 7]);
  one('n counts the site\'s rows; hit counts only cache HIT', [c.n, c.hit, c.non_hit], [13, 10, 3]);
  let threw = null; try { cflSample({ at: 't', date: 'd', by_site: { [SITE]: 6 }, reconcile: [{ site: SITE, state: 'cache-hit', cache: 'HIT', credits_kept: 0 }] }); } catch (e) { threw = String(e.message); }
  one('a CFL row with no numeric n THROWS rather than being summed as zero (absence is not zero)', /no numeric value where a sum needs one/.test(threw || ''), true);
  one('a sample with no CFL rows at all has gap = by_site, not NaN', cflSample({ at: '2026-10-24T20:00:00Z', date: '2026-10-24', by_site: { [SITE]: 12 }, reconcile: [] }).gap, 12);
  const tr = (smp) => { try { cflSample(smp); return null; } catch (e) { return String(e.message); } };
  one('a sample with no reconcile array THROWS (absence is not "no calls")', /no reconcile array/.test(tr({ at: 't', date: 'd', by_site: { [SITE]: 6 } }) || ''), true);
  one('a sample with no by_site object THROWS (absence is not "no spend")', /no by_site object/.test(tr({ at: 't', date: 'd', reconcile: [] }) || ''), true);
  one('a site listed in unreadable_sites THROWS: its by_site is not a reading', /unreadable_sites/.test(tr({ at: 't', date: 'd', by_site: { [SITE]: 6 }, reconcile: [], unreadable_sites: [SITE] }) || ''), true);
  one('a by_site that is present but not a number THROWS', /not a number/.test(tr({ at: 't', date: 'd', by_site: { [SITE]: null }, reconcile: [] }) || ''), true);
  one('a by_site object without the site key is a day with no spend, and says so', (({ by_site, by_site_absent }) => [by_site, by_site_absent])(cflSample({ at: 't', date: 'd', by_site: { other: 9 }, reconcile: [] })), [0, true]);
  one('a window whose ledger reading is null is unmeasured (null), not a coerced zero', [windowResidual({ vendor_month_used: 100, ledger_month_used: null }, { vendor_month_used: 200, ledger_month_used: 150 }, 0), windowResidual({ vendor_month_used: 100, ledger_month_used: 90 }, { vendor_month_used: 200, ledger_month_used: undefined }, 0)], [null, null]);
  // `stranded`: an error row's kept is an intent with no standing charge, so by_site - kept under-reads the charges that stayed by exactly that amount.
  const recErr = [{ site: SITE, state: 'reconciled', cache: 'EXPIRED', n: 3, credits_kept: 18 }, { site: SITE, state: 'error', cache: 'EXPIRED', n: 1, credits_kept: 6 }, { site: SITE, state: 'cache-hit', cache: 'HIT', n: 10, credits_kept: 0 }];
  const ce = cflSample(S('2026-11-01T21:00:00Z', 42, recErr));
  one('stranded adds back the kept of state=error rows only (gap 18, stranded 24)', [ce.kept, ce.kept_error, ce.gap, ce.stranded], [24, 6, 18, 24]);
  one('with no error rows stranded equals the gap', [c.kept_error, c.stranded === c.gap], [0, true]);
  one('another site\'s error row is not this site\'s kept_error', cflSample(S('t', 60, [...rec, { site: 'other', state: 'error', cache: 'MISS', n: 1, credits_kept: 6 }])).kept_error, 0);
  one('a reconcile row with no state THROWS (it cannot be classed as an error row or not)', /has no state/.test(tr({ at: 't', date: 'd', by_site: { [SITE]: 6 }, reconcile: [{ site: SITE, cache: 'HIT', n: 1, credits_kept: 0 }] }) || ''), true);
  // dayRead: done condition 5. 11 samples is not the point; the LAST sample of the day is, and which figure the verdict reads.
  const day = (d, spec) => spec.map(([hhmm, by, recs]) => cflSample({ at: `${d}T${hhmm}:00Z`, date: d, by_site: { [SITE]: by }, reconcile: recs, degraded_open: { events: 0 } }));
  const hits = (n) => [{ site: SITE, state: 'cache-hit', cache: 'HIT', n, credits_kept: 0 }];
  const withKept = (n, kept, errKept = 0) => [...hits(n), ...(kept ? [{ site: SITE, state: 'reconciled', cache: 'EXPIRED', n: kept / CALL, credits_kept: kept }] : []), ...(errKept ? [{ site: SITE, state: 'error', cache: 'EXPIRED', n: errKept / CALL, credits_kept: errKept }] : [])];
  const R = (verdictOf) => verdictOf.verdict;
  one('dayRead passes at stranded 48 with 100 HIT calls and a 21:30Z last sample (both thresholds are inclusive)', R(dayRead(day('2026-11-07', [['08:00', 6, withKept(40, 6)], ['21:30', 48, withKept(100, 0)]]), '2026-11-07')), 'pass');
  one('dayRead fails at stranded 54', R(dayRead(day('2026-11-07', [['21:30', 54, withKept(150, 0)]]), '2026-11-07')), 'fail');
  one('dayRead is inconclusive with 99 HIT calls even at stranded 0', R(dayRead(day('2026-11-07', [['21:30', 0, withKept(99, 0)]]), '2026-11-07')), 'inconclusive:few-hit-calls');
  one('dayRead is inconclusive when the last sample is 20:59Z (spend after it is unread)', R(dayRead(day('2026-11-07', [['20:59', 12, withKept(150, 0)]]), '2026-11-07')), 'inconclusive:partial-day');
  one('...but a fail is still a fail on a partial day (stranded only grows through the day)', R(dayRead(day('2026-11-07', [['17:41', 60, withKept(150, 0)]]), '2026-11-07')), 'fail');
  one('dayRead with no sample of that day is no-data, not a pass', R(dayRead(day('2026-11-06', [['21:30', 0, withKept(150, 0)]]), '2026-11-07')), 'no-data');
  one('dayRead reads the day\'s LAST sample, not the largest (by_site 90 then 12)', dayRead(day('2026-11-07', [['08:00', 90, withKept(10, 0)], ['21:30', 12, withKept(150, 0)]]), '2026-11-07').stranded, 12);
  const GSV = ({ verdict, gap, stranded, figures_disagree }) => [verdict, gap, stranded, figures_disagree];
  one('dayRead sorts: samples handed over newest first still read the latest (by_site 12, not 90)', dayRead(day('2026-11-07', [['21:30', 12, withKept(150, 0)], ['08:00', 90, withKept(10, 0)]]), '2026-11-07').stranded, 12);
  one('dayRead decides on stranded, not on the gap (gap 42 is under 48, stranded 54 is over: fail, figures_disagree true)', GSV(dayRead(day('2026-11-07', [['21:30', 60, withKept(150, 6, 12)]]), '2026-11-07')), ['fail', 42, 54, true]);
  one('dayRead: both figures on the same side of the line is not flagged (gap 24, stranded 36: pass)', GSV(dayRead(day('2026-11-07', [['21:30', 60, withKept(150, 24, 12)]]), '2026-11-07')), ['pass', 24, 36, false]);
  one('dayRead refuses a stranded figure that is not a whole number of calls', R(dayRead(day('2026-11-07', [['21:30', 50, withKept(150, 0)]]), '2026-11-07')), 'inconclusive:figure-not-a-count-of-calls');
  one('dayRead refuses a negative stranded figure', R(dayRead(day('2026-11-07', [['21:30', 0, withKept(150, 12)]]), '2026-11-07')), 'inconclusive:figure-not-a-count-of-calls');
  one('dayRead prints how many hours after the last sample are not in the series', dayRead(day('2026-11-07', [['21:30', 0, withKept(150, 0)]]), '2026-11-07').unread_hours_after_last_sample, 2.5);
  const rows = [['2026-10-24T02:00:00Z', 0], ['2026-10-24T08:00:00Z', 0], ['2026-10-24T14:00:00Z', 30], ['2026-10-24T23:00:00Z', 90], ['2026-10-25T03:00:00Z', 12], ['2026-10-25T09:00:00Z', 12]]
    .map(([at, g]) => cflSample(S(at, g, [{ site: SITE, state: 'cache-hit', cache: 'HIT', n: 1, credits_kept: 0 }])));
  one('gapAt gives the last sample at or before t and the first after, on the same day', gapAt(rows, '2026-10-24T10:00:00Z'), { lo: 0, hi: 30, day: '2026-10-24' });
  one('...and 0 before the day\'s first sample', gapAt(rows, '2026-10-24T01:00:00Z').lo, 0);
  one('windowGap inside one UTC day', windowGap(rows, '2026-10-24T08:00:00Z', '2026-10-24T23:00:00Z'), { lo: 90, hi: 90 });
  one('windowGap across midnight adds the rest of day 1 and the start of day 2', windowGap(rows, '2026-10-24T14:00:00Z', '2026-10-25T04:00:00Z'), { lo: 72, hi: 72 });
  one('windowResidual is vendor delta - ledger delta - CI (10-30 -> 10-31 real pair: 445, 691, 160 -> -406)', windowResidual({ vendor_month_used: 100, ledger_month_used: 100 }, { vendor_month_used: 545, ledger_month_used: 791 }, 160).residual, -406);
  one('known CI is read from the log line; a log without it is null, not 0', [knownCiFromLog('  known CI spend         : 140   (1 run(s), 0 undated)'), knownCiFromLog('nothing here')], [140, null]);
  const W = (residual, ci, lo = 0, hi = 0) => ({ residual, ci, cfl_gap_lo: lo, cfl_gap_hi: hi });
  one('ciSide: residual + gap at 0 while CI is 100 means CI is not in the ledger', ciSide(W(0, 100)), 'not-in-ledger');
  one('ciSide: residual + gap at -CI means the CI spend was subtracted twice, so it is in the ledger', ciSide(W(-100, 100)), 'in-ledger');
  one('ciSide adds the CFL gap back before it compares (residual -413, gap midpoint 462, CI 200)', ciSide(W(-413, 200, 450, 474)), 'not-in-ledger');
  one('ciSide: equidistant is a tie, not a side', ciSide(W(-50, 100)), 'tie');
  one('ciSide: an unmeasured window (null residual, or null CI) is null, not a side', [ciSide(W(null, 100)), ciSide(W(-10, null)), ciSide(W(undefined, 100))], [null, null, null]);
  one('outPath: no flag is the committed record; --out gives the path given', [outPath(['node', 'x']), outPath(['node', 'x', '--out', 'outbox/y.json'])], ['outbox/cfl-reconcile-gap.json', 'outbox/y.json']);
  one('outPath: --out with no path, or followed by another flag, throws instead of using the default', [(() => { try { outPath(['--out']); return 'no throw'; } catch (e) { return /needs a file path/.test(e.message); } })(), (() => { try { outPath(['--out', '--day']); return 'no throw'; } catch (e) { return /needs a file path/.test(e.message); } })()], [true, true]);
  one('pearson of a perfect line is 1; of a constant column is null; of two points is null', [Math.round(pearson([1, 2, 3, 4], [2, 4, 6, 8]) * 1e6) / 1e6, pearson([1, 1, 1], [1, 2, 3]), pearson([1, 2], [1, 2])], [1, null, null]);
  console.log(bad ? `\n${bad} FAILED` : `\nself-test: ${total}/${total}`);
  console.log('COVERAGE: the arithmetic over hand-built rows. It says nothing about the relay; the data it will be run on is in outbox/.');
  process.exit(bad ? 1 : 0);
}

if (process.argv.includes('--day')) {
  // node scripts/analyze-cfl-reconcile-gap.mjs --day 2026-11-07   the done-condition-5 read of one UTC day; writes outbox/cfl-stranded-day-<day>.json (dated, so it never overwrites the 11-01 record
  // in outbox/cfl-reconcile-gap.json) and exits 0 whatever the verdict: the verdict is the output. Only that day's samples are parsed, so a bad sample of another day cannot block the read.
  const day = process.argv[process.argv.indexOf('--day') + 1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) { console.error('usage: node scripts/analyze-cfl-reconcile-gap.mjs --day YYYY-MM-DD'); process.exit(2); }
  const series = JSON.parse(readFileSync('outbox/odds-site-drift-series.json', 'utf8'));
  const dayRows = series.filter((s) => s.date === day).map((s) => cflSample(s));
  const d = dayRead(dayRows, day);
  console.log(`CFL charges that stayed, UTC day ${day} (${series.length} drift samples in the series, ${d.samples} dated that day${d.sample_times ? `: ${d.sample_times.join(' ')}` : ''})`);
  if (d.verdict === 'no-data') console.log(`  verdict: ${d.verdict}\n  ${d.reason}`);
  else {
    console.log(`  last sample         : ${d.last_sample_at.slice(11, 16)}Z   (the ${d.unread_hours_after_last_sample} h after it are NOT in the series)`);
    console.log(`  by_site / kept      : ${d.by_site} / ${d.kept}   (kept of state=error rows: ${d.kept_error})`);
    console.log(`  gap      by_site - kept                    : ${d.gap}  (${d.gap / CALL} calls)`);
    console.log(`  stranded by_site - kept of non-error rows  : ${d.stranded}  (${d.stranded_calls} calls)   <- the figure the criterion reads`);
    console.log(`  calls tallied / cache HIT                  : ${d.n} / ${d.hit}`);
    console.log(`  criterion: stranded <= ${DC5_MAX_STRANDED} on a day with >= ${DC5_MIN_HIT} HIT calls, last sample at or after ${DC5_MIN_LAST_SAMPLE_HOUR}:00Z`);
    if (d.figures_disagree) console.log(`  NOTE: gap and stranded fall on different sides of ${DC5_MAX_STRANDED}; the verdict reads stranded.`);
    console.log(`  verdict: ${d.verdict}\n  ${d.reason}`);
  }
  const file = `outbox/cfl-stranded-day-${day}.json`;
  writeFileSync(file, JSON.stringify({ read_of: 'done condition 5, docs/CC-CMD-2026-10-13-vendor-residual-window.md', series_samples: series.length, series_last: series[series.length - 1].at, criterion: { max_stranded: DC5_MAX_STRANDED, min_hit: DC5_MIN_HIT, min_last_sample_hour_utc: DC5_MIN_LAST_SAMPLE_HOUR }, ...d }, null, 1) + '\n');
  console.log(`wrote ${file}`);
  process.exit(0);
}

const drift = JSON.parse(readFileSync('outbox/odds-site-drift-series.json', 'utf8'));
const vendor = JSON.parse(readFileSync('outbox/odds-daily-vs-vendor-series.json', 'utf8'));
const rows = drift.map((s) => cflSample(s)).filter((r) => r.by_site || r.n);
const sites = new Set(); drift.forEach((s) => Object.keys(s.by_site || {}).forEach((k) => sites.add(k)));
const other = {};
for (const site of sites) if (site !== SITE) {
  const rs = drift.map((s) => cflSample(s, site)).filter((r) => r.by_site || r.n);
  const gaps = rs.map((r) => r.gap);
  if (rs.length) other[site] = { samples: rs.length, nonzero_gap_samples: gaps.filter((g) => g !== 0).length, max_gap: Math.max(...gaps), min_gap: Math.min(...gaps), calls_total: rs.reduce((t, r) => Math.max(t, r.n), 0) };
}
const out = { generated_from: { drift_samples: drift.length, drift_first: drift[0].at, drift_last: drift[drift.length - 1].at, vendor_rows: vendor.length, site: SITE, call_credits: CALL }, samples: rows, other_sites: other };

console.log(`CFL by_site absent (read as no spend that day) in ${drift.map((x) => cflSample(x)).filter((r) => r.by_site_absent).length} of ${drift.length} samples`);
console.log(`drift samples ${drift.length} (${drift[0].at.slice(0, 16)}Z .. ${drift[drift.length - 1].at.slice(0, 16)}Z), CFL samples ${rows.length}, vendor-series rows ${vendor.length}\n`);
console.log('every CFL sample:  at          by_site kept  gap  calls  n   HIT nonHIT degrade-open');
for (const r of rows) console.log(`                   ${r.at.slice(5, 16)}Z ${String(r.by_site).padStart(6)} ${String(r.kept).padStart(4)} ${String(r.gap).padStart(4)} ${String(r.calls).padStart(5)} ${String(r.n).padStart(4)} ${String(r.hit).padStart(4)} ${String(r.non_hit).padStart(5)} ${r.degraded_open}`);
const multiples = rows.filter((r) => r.gap % CALL === 0).length;
console.log(`\ngap is a whole number of ${CALL}-credit calls in ${multiples} of ${rows.length} samples; gap is 0 in ${rows.filter((r) => r.gap === 0).length}, negative in ${rows.filter((r) => r.gap < 0).length}`);
const hot = rows.filter((r) => r.hit >= 40), quiet = rows.filter((r) => r.hit < 40);
console.log(`samples with HIT >= 40: ${hot.length}, gap > 0 in ${hot.filter((r) => r.gap > 0).length}; samples with HIT < 40: ${quiet.length}, gap > 0 in ${quiet.filter((r) => r.gap > 0).length}`);
console.log(`degraded-open events: ${rows.filter((r) => r.degraded_open > 0).length} samples with > 0 (of ${rows.filter((r) => r.degraded_open !== null).length} that report it); gap in those: ${rows.filter((r) => r.degraded_open > 0).map((r) => r.gap).join(', ') || 'n/a'}`);
console.log('\nother sites (same arithmetic):');
for (const [k, v] of Object.entries(other)) console.log(`  ${k.padEnd(28)} samples ${String(v.samples).padStart(2)}  non-zero gap in ${String(v.nonzero_gap_samples).padStart(2)}  gap range ${v.min_gap}..${v.max_gap}  max calls tallied ${v.calls_total}`);

// Window-aligned: for each vendor-series pair, the residual (Task 1's formula) beside the gap CFL added inside the SAME two instants.
const win = [];
const sorted = [...vendor].sort((a, b) => a.at.localeCompare(b.at));
for (let i = 1; i < sorted.length; i++) {
  const prev = sorted[i - 1], curr = sorted[i];
  const logName = readdirSync('outbox').filter((f) => f.startsWith(`odds-daily-vs-vendor-${curr.at.slice(0, 10)}T`) && f.endsWith('.log')).sort().pop();
  const ci = logName ? knownCiFromLog(readFileSync(`outbox/${logName}`, 'utf8')) : null;
  const t0 = prev.at, t1 = curr.at;
  if (t0 < drift[0].at) continue;
  const r = ci === null ? null : windowResidual(prev, curr, ci);
  const g = windowGap(rows, t0, t1);
  win.push({ window: `${t0.slice(5, 16)}Z .. ${t1.slice(5, 16)}Z`, closes: curr.day || null, hours: Math.round((Date.parse(t1) - Date.parse(t0)) / 36e5 * 10) / 10, vendor: r && r.vendor, ledger: r && r.ledger, ci, residual: r && r.residual, cfl_gap_lo: g.lo, cfl_gap_hi: g.hi });
}
out.windows = win;
console.log('\nwindow-aligned (vendor delta - ledger delta - known CI) beside the CFL gap added inside the same instants:');
console.log('  window                          hours  vendor ledger   CI  residual   CFL gap [lo,hi]   residual + gap');
for (const w of win) console.log(`  ${w.window.padEnd(30)} ${String(w.hours).padStart(5)} ${String(w.vendor ?? '?').padStart(6)} ${String(w.ledger ?? '?').padStart(6)} ${String(w.ci ?? '?').padStart(4)} ${String(w.residual ?? 'unmeasured').padStart(9)}   [${w.cfl_gap_lo},${w.cfl_gap_hi}]`.padEnd(95) + (w.residual === null ? '' : `[${w.residual + w.cfl_gap_lo}, ${w.residual + w.cfl_gap_hi}]`));
const m = win.filter((w) => w.residual !== null);
const mid = m.map((w) => (w.cfl_gap_lo + w.cfl_gap_hi) / 2);
const r = pearson(mid, m.map((w) => -w.residual));
console.log(`\nwindows measured: ${m.length} of ${win.length}; Pearson r between CFL gap (midpoint) and -residual: ${r === null ? 'undefined' : r.toFixed(3)}`);
console.log(`sum of residuals ${m.reduce((t, w) => t + w.residual, 0)}; sum of CFL gap midpoints ${mid.reduce((t, v) => t + v, 0)}; windows where |residual + gap| <= 60 anywhere in [lo,hi]: ${m.filter((w) => Math.min(Math.abs(w.residual + w.cfl_gap_lo), Math.abs(w.residual + w.cfl_gap_hi)) <= 60 || (w.residual + w.cfl_gap_lo) * (w.residual + w.cfl_gap_hi) <= 0).length}`);
out.correlation = { windows_measured: m.length, windows: win.length, pearson_gap_vs_neg_residual: r };
const sides = win.map(ciSide);
const count = (v) => sides.filter((x) => x === v).length;
out.p2 = { windows: win.length, windows_measured: sides.filter((x) => x !== null).length, nearer_ci_not_in_ledger: count('not-in-ledger'), nearer_ci_in_ledger: count('in-ledger'), tie: count('tie'), per_window: win.map((w, i) => ({ window: w.window, ci: w.ci, residual: w.residual, nearer: sides[i] })) };
console.log(`P2 (known CI spend is not in the ledger): of ${out.p2.windows_measured} measured windows (${win.length} in all), residual + gap is nearer 0 than -CI in ${out.p2.nearer_ci_not_in_ledger}, nearer -CI in ${out.p2.nearer_ci_in_ledger}, tied in ${out.p2.tie}`);
const outFile = outPath(process.argv);
writeFileSync(outFile, JSON.stringify(out, null, 1) + '\n');
console.log(`\nwrote ${outFile}`);
