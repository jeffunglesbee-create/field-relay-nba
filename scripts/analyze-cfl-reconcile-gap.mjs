#!/usr/bin/env node
// P5 of docs/CC-CMD-2026-10-13-vendor-residual-window.md, Task 2: how much of the ledger's over-record is the gap between what handleCFLOddsProbs holds in
// odds_site_daily (`by_site`, net of the refunds that landed) and what its reconcile tally says it kept (`credits_kept`), and does that gap move with cache-hit calls?
//
// Reads two COMMITTED series (no network, no credits):
//   outbox/odds-site-drift-series.json       the drift sampler's rows: { at, date, by_site{site:n}, reconcile[{site,state,cache,n,credits_kept}], degraded_open }
//   outbox/odds-daily-vs-vendor-series.json  the vendor watch's rows: { at, day, vendor_month_used, ledger_month_used }, and the log beside each, for `known CI spend`
// Usage: node scripts/analyze-cfl-reconcile-gap.mjs [--self-test]        writes outbox/cfl-reconcile-gap.json and prints the tables.
//
// WHAT THE GAP IS, from budget-helpers.js (the reconcile function): a charge of 6 is made before the fetch. After it, a cache HIT is corrected by -6 in one D1 batch
// (day, site, month), THEN the tally row is written. So by_site is net of landed corrections and credits_kept is the INTENT. by_site - kept is therefore 6 for every call
// whose charge stayed although the tally says it was refunded (or was never reached), and for every kept call whose tally row is missing. It does not say which.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';

export const SITE = 'handleCFLOddsProbs';
export const CALL = 6; // oddsCreditCost of the CFL URL: markets=h2h,spreads,totals x regions=us,eu

const sumBy = (rows, f) => rows.reduce((t, r) => t + (f(r) || 0), 0);

/** One drift sample -> the CFL line of it. `kept` is Σ credits_kept of THIS site's reconcile rows only. */
export function cflSample(s, site = SITE) {
  const rec = (s.reconcile || []).filter((r) => r.site === site);
  const by = (s.by_site && s.by_site[site]) || 0;
  const kept = sumBy(rec, (r) => r.credits_kept);
  const n = sumBy(rec, (r) => r.n);
  const hit = sumBy(rec.filter((r) => r.cache === 'HIT'), (r) => r.n);
  return { at: s.at, date: s.date, by_site: by, kept, gap: by - kept, calls: (by - kept) / CALL, n, hit, non_hit: n - hit, degraded_open: s.degraded_open ? s.degraded_open.events : null };
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
  const vendor = curr.vendor_month_used - prev.vendor_month_used, ledger = curr.ledger_month_used - prev.ledger_month_used;
  return { vendor, ledger, ci, residual: vendor - ledger - ci };
}

export function knownCiFromLog(text) {
  const m = /known CI spend\s*:\s*(\d+)/.exec(text || '');
  return m ? Number(m[1]) : null;
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
  one('a sample with no CFL rows at all has gap = by_site, not NaN', cflSample({ at: '2026-10-24T20:00:00Z', date: '2026-10-24', by_site: { [SITE]: 12 }, reconcile: [] }).gap, 12);
  const rows = [['2026-10-24T02:00:00Z', 0], ['2026-10-24T08:00:00Z', 0], ['2026-10-24T14:00:00Z', 30], ['2026-10-24T23:00:00Z', 90], ['2026-10-25T03:00:00Z', 12], ['2026-10-25T09:00:00Z', 12]]
    .map(([at, g]) => cflSample(S(at, g, [{ site: SITE, state: 'cache-hit', cache: 'HIT', n: 1, credits_kept: 0 }])));
  one('gapAt gives the last sample at or before t and the first after, on the same day', gapAt(rows, '2026-10-24T10:00:00Z'), { lo: 0, hi: 30, day: '2026-10-24' });
  one('...and 0 before the day\'s first sample', gapAt(rows, '2026-10-24T01:00:00Z').lo, 0);
  one('windowGap inside one UTC day', windowGap(rows, '2026-10-24T08:00:00Z', '2026-10-24T23:00:00Z'), { lo: 90, hi: 90 });
  one('windowGap across midnight adds the rest of day 1 and the start of day 2', windowGap(rows, '2026-10-24T14:00:00Z', '2026-10-25T04:00:00Z'), { lo: 72, hi: 72 });
  one('windowResidual is vendor delta - ledger delta - CI (10-30 -> 10-31 real pair: 445, 691, 160 -> -406)', windowResidual({ vendor_month_used: 100, ledger_month_used: 100 }, { vendor_month_used: 545, ledger_month_used: 791 }, 160).residual, -406);
  one('known CI is read from the log line; a log without it is null, not 0', [knownCiFromLog('  known CI spend         : 140   (1 run(s), 0 undated)'), knownCiFromLog('nothing here')], [140, null]);
  one('pearson of a perfect line is 1; of a constant column is null; of two points is null', [Math.round(pearson([1, 2, 3, 4], [2, 4, 6, 8]) * 1e6) / 1e6, pearson([1, 1, 1], [1, 2, 3]), pearson([1, 2], [1, 2])], [1, null, null]);
  console.log(bad ? `\n${bad} FAILED` : `\nself-test: ${total}/${total}`);
  console.log('COVERAGE: the arithmetic over hand-built rows. It says nothing about the relay; the data it will be run on is in outbox/.');
  process.exit(bad ? 1 : 0);
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
writeFileSync('outbox/cfl-reconcile-gap.json', JSON.stringify(out, null, 1) + '\n');
console.log('\nwrote outbox/cfl-reconcile-gap.json');
