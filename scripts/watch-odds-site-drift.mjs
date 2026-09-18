#!/usr/bin/env node
// WHY by_site_sum EXCEEDS used, measured INSIDE a running day.
//
// On 2026-09-17 the attribution watch read a closed day: used 3799,
// by_site_sum 4196, gap -397 against a tolerance of 190. One closed-day
// reading gives a number and no mechanism — it cannot say WHEN in the day the
// two counters parted, and a cause guessed from a total is a cause guessed.
//
// FOUR CANDIDATES, AND READING THE SOURCE KILLED TWO OF THEM:
//
//   midnight skew      REFUTED. _dailyKey and _siteKey both key on
//                      new Date().toISOString().slice(0,10) — the same UTC day.
//   ceiling saturation REFUTED. checkAndIncrementDailyOdds returns false BEFORE
//                      both writes, so a saturated day freezes the daily key and
//                      the site keys together. Saturation cannot open a gap.
//   a lost site write  WRONG SIGN. _bumpSite swallows its own failure, which
//                      makes by_site_sum SMALLER than used, not larger.
//   clamp asymmetry    SURVIVES, and this probe exists to refute it.
//
// TWO SURVIVORS, NOT ONE. The second was found on 2026-09-18 while writing the
// "few lines" that were going to fix the first, and it is the better of the two.
//
// LOST UPDATES ON THE HOTTEST KEY. Every counter here is get-then-put on KV,
// non-atomic, which reconcileOddsCredit's own comment already says out loud.
// Concurrent isolates therefore lose updates — and they do not lose them
// evenly. odds:daily:<date> is written on EVERY permitted call. Each of the ten
// odds:site:* keys is written on the fraction of calls that names it, and one
// consumer takes 62-88% of traffic, so the remaining nine are colder still. The
// hot key loses proportionally more writes than the sum of the cold ones, and
// the daily total drifts BELOW by_site_sum — which is the sign observed, and
// 3799 against 4196 is a 9.5% shortfall on the busiest key in the system. The
// magnitude is UNMEASURED; only the direction follows from the code.
//
// The two are told apart by whether the gap grows on refunds or on volume, and
// the verdicts below already separate exactly that. `gap-grows-while-spending`
// is the lost-update signature, NOT an unexplained result.
//
// THE FIRST SURVIVOR, STATED SO IT CAN BE KILLED. reconcileOddsCredit refunds an
// over-estimate by adding a NEGATIVE delta in two different shapes:
//
//   _bumpSite        Math.max(0, cur + units)   clamped PER SITE
//   the daily loop   Math.max(0, cur + delta)   clamped on the TOTAL
//
// A refund aimed at a site already sitting at 0 is clamped away and the site
// keeps 0; the same refund reaches the daily total, which is nowhere near 0 and
// takes it in full. The day's sites then hold more than the day's total. Five
// of the ten sites read 0 on 2026-09-17, and the pairing watch measured the
// ledger moving BACKWARDS by 76 in the same interval — consistent, which is
// not the same as proven.
//
// THE DISCRIMINATING OBSERVATION, which no total can show: an interval where
// `used` FALLS while the gap GROWS, with the named sites that were pinned at 0
// through it. That is the clamp, caught in the act. If the series accumulates
// gap in intervals where `used` only ever rises, the clamp is NOT the cause and
// this file's surviving candidate is dead too.
//
// READ-ONLY. One GET of /budget/odds per run. No credits: the route reads KV
// counters and never reaches the vendor.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const RELAY  = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SERIES = 'outbox/odds-site-drift-series.json';
const KEEP   = 60;

/** by_site_sum - used, or null when the sum is unknown.
 *  NOT 0 when the sum is null: an unreadable site makes the gap UNKNOWN, and
 *  Number(null) === 0 would report perfect agreement (Rule 99). */
export function gapOf(s) {
  if (!s || s.by_site_sum === null || s.by_site_sum === undefined) return null;
  if (typeof s.used !== 'number') return null;
  return s.by_site_sum - s.used;
}

/** Movement between two samples OF THE SAME UTC DAY.
 *  Refuses across days: odds:daily:* and odds:site:* are per-day keys, so a
 *  pair spanning midnight compares two populations and every delta is noise.
 *  That mistake has already been made once in this repo, on this same watch
 *  family, which is why it is a hard refusal and not a caveat. */
export function deltas(prev, curr) {
  if (!prev || !curr) return null;
  if (prev.date !== curr.date) return { crossDay: true, from: prev.date, to: curr.date };
  const a = prev.by_site || {}, b = curr.by_site || {};
  const siteDeltas = {}, pinnedAtZero = [];
  for (const k of Object.keys(b)) {
    const pv = a[k], cv = b[k];
    if (typeof pv !== 'number' || typeof cv !== 'number') { siteDeltas[k] = null; continue; }
    siteDeltas[k] = cv - pv;
    if (pv === 0 && cv === 0) pinnedAtZero.push(k);
  }
  const g0 = gapOf(prev), g1 = gapOf(curr);
  return {
    crossDay: false,
    usedDelta: curr.used - prev.used,
    gapDelta: (g0 === null || g1 === null) ? null : g1 - g0,
    siteDeltas,
    pinnedAtZero,
  };
}

/** The clamp caught in the act, or not caught.
 *  Fires only on the exact shape the hypothesis predicts: the daily total took
 *  a refund (usedDelta < 0) while the gap grew (gapDelta > 0). Anything else —
 *  a gap that grows while spend rises — is NOT this mechanism and says so. */
export function clampWitness(d) {
  if (!d || d.crossDay) return { verdict: 'no-comparison' };
  if (d.gapDelta === null) return { verdict: 'gap-unknown' };
  if (d.gapDelta <= 0) return { verdict: 'gap-did-not-grow' };
  if (d.usedDelta < 0) {
    return { verdict: 'clamp-witnessed', refund: d.usedDelta, grew: d.gapDelta, suspects: d.pinnedAtZero };
  }
  return { verdict: 'gap-grew-while-spending', grew: d.gapDelta, usedDelta: d.usedDelta };
}

/** What the whole series says, which is the only thing worth reporting.
 *  `inconclusive` is a real answer here and is never dressed up as health: a
 *  series with no growing-gap interval has not exonerated the clamp, it has
 *  only failed to catch it yet. */
export function driftVerdict(pairs) {
  const usable = pairs.filter(p => p && !p.crossDay);
  if (!usable.length) return { state: 'no-data', intervals: 0 };
  const w = usable.map(clampWitness);
  const clamp = w.filter(x => x.verdict === 'clamp-witnessed');
  const spend = w.filter(x => x.verdict === 'gap-grew-while-spending');
  if (clamp.length) return { state: 'clamp-witnessed', intervals: usable.length, hits: clamp.length, other: spend.length };
  if (spend.length) return { state: 'gap-grows-while-spending', intervals: usable.length, hits: spend.length };
  return { state: 'inconclusive', intervals: usable.length };
}

/** The sample, or the reason there isn't one.
 *  /budget/odds WRAPS the counters in a `daily` block — reading the route's
 *  top level yields a sample of undefineds. The first live run of this watch
 *  did exactly that, recorded it, and exited OK: `no-data` is a legitimate
 *  verdict for a day's first reading, so a garbage sample was indistinguishable
 *  from a quiet one. A read that did not produce numbers is now FATAL, because
 *  a series quietly filling with undefined is worse than a series with a hole.
 *  (The working consumer, watch-odds-attribution-gap.mjs:152, reads body.daily
 *  — this was in the repo the whole time and was not looked at.) */
export function sampleFrom(body, at = new Date().toISOString()) {
  const d = body && body.daily;
  if (!d || typeof d !== 'object') return { ok: false, why: 'no `daily` block in the response' };
  if (typeof d.date !== 'string') return { ok: false, why: `daily.date is ${JSON.stringify(d.date)}, not a string` };
  if (typeof d.used !== 'number') return { ok: false, why: `daily.used is ${JSON.stringify(d.used)}, not a number` };
  if (!d.by_site || typeof d.by_site !== 'object') return { ok: false, why: 'daily.by_site is missing' };
  return { ok: true, sample: {
    at, date: d.date, used: d.used, by_site: d.by_site, by_site_sum: d.by_site_sum,
    unreadable_sites: d.unreadable_sites, degraded_open: d.degraded_open,
  } };
}

if (process.argv.includes('--self-test')) {
  let bad = 0;
  const one = (label, got, want, why) => JSON.stringify(got) === JSON.stringify(want)
    ? console.log(`  PASS  ${label} -> ${JSON.stringify(got)}  (${why})`)
    : (bad++, console.log(`  FAIL  ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`));

  const S = (date, used, sites) => ({ date, used, by_site: sites, by_site_sum: Object.values(sites).reduce((a, v) => a + v, 0) });

  one('the gap is sum minus used', gapOf(S('d', 3799, { a: 4196 })), 397, 'the 2026-09-17 shape, sign included');
  one('an unreadable sum is UNKNOWN', gapOf({ date: 'd', used: 10, by_site_sum: null }), null,
      'Number(null) would be 0 and report perfect agreement (Rule 99)');
  one('a missing used is UNKNOWN', gapOf({ date: 'd', by_site_sum: 10 }), null, 'same reason, other operand');
  // THE SIGN IS THE WHOLE DIAGNOSIS, so it needs a fixture on each side. With
  // only the positive case above, Math.abs() passes every assertion while
  // merging two defects that have opposite causes and opposite fixes.
  one('a gap the other way', gapOf(S('d', 100, { a: 60 })), -40,
      'sites UNDER the total is a lost site write; sites OVER it is the clamp — never the same finding');

  one('two days never compare', deltas(S('2026-09-17', 10, { a: 10 }), S('2026-09-18', 1, { a: 1 })).crossDay, true,
      'per-day keys — a midnight pair compares two populations and invents a delta');

  const p = S('d', 100, { alpha: 100, beta: 0 });
  const c = S('d', 60,  { alpha: 100, beta: 0 });   // refund hit the total, sites pinned
  const d = deltas(p, c);
  one('a refund that missed the sites', [d.usedDelta, d.gapDelta, d.pinnedAtZero], [-40, 40, ['beta']],
      'the daily key took -40 and the sites did not follow it down');
  one('THE DISCRIMINATING CASE', clampWitness(d).verdict, 'clamp-witnessed',
      'used fell while the gap grew — the only shape the clamp hypothesis predicts');

  // A site that STARTS at 0 and then spends is not pinned, and saying it is
  // would name it a clamp suspect on the one interval where it demonstrably
  // moved. Without gamma here, dropping the second half of the condition
  // changes nothing observable.
  const moved = deltas(S('d', 100, { alpha: 100, beta: 0, gamma: 0 }),
                       S('d', 60,  { alpha: 100, beta: 0, gamma: 5 }));
  one('a site that started spending is not pinned', moved.pinnedAtZero, ['beta'],
      'gamma went 0 -> 5 in this very interval; only beta never moved');

  const rise = deltas(S('d', 100, { alpha: 100, beta: 0 }), S('d', 150, { alpha: 200, beta: 0 }));
  one('a gap that grew on RISING spend', clampWitness(rise).verdict, 'gap-grew-while-spending',
      'refutes the clamp for this interval rather than counting as evidence for it');

  const flat = deltas(S('d', 100, { alpha: 100 }), S('d', 150, { alpha: 150 }));
  one('counters moving together', clampWitness(flat).verdict, 'gap-did-not-grow', 'the healthy interval');

  one('no intervals is no data', driftVerdict([]).state, 'no-data', 'absent is not clean (Rule 99)');
  one('a quiet series is INCONCLUSIVE', driftVerdict([flat, flat]).state, 'inconclusive',
      'failing to catch the clamp is not exonerating it, and must not read as green');
  one('one hit names the series', driftVerdict([flat, d, rise]).state, 'clamp-witnessed',
      'a single witnessed interval settles the mechanism; the rest is volume');

  const ENV = { daily: { date: '2026-09-18', used: 10, by_site: { a: 10 }, by_site_sum: 10 } };
  one('the counters live under `daily`', sampleFrom(ENV, 't').sample.used, 10,
      'the route wraps them; reading the top level gave a sample of undefineds on the first live run');
  one('a top-level read is REFUSED', sampleFrom({ date: 'd', used: 10, by_site: {} }).ok, false,
      'the exact 2026-09-18 15:48 defect — it recorded undefined and exited OK');
  one('undefined used is not a sample', sampleFrom({ daily: { date: 'd', by_site: {} } }).ok, false,
      'a series filling with undefined is worse than a series with a hole');
  one('a missing by_site is not a sample', sampleFrom({ daily: { date: 'd', used: 1 } }).ok, false,
      'every interval would then compare nothing to nothing and read as quiet');

  console.log(bad ? `\n${bad} FAILED` : `\nself-test: 18/18`);
  console.log(`COVERAGE: five pure predicates over ENUMERATED samples. It does NOT reach`);
  console.log(`/budget/odds, and it cannot see a refund that landed between two samples`);
  console.log(`and was undone before the next one — the sampling interval is the floor on`);
  console.log(`what is observable.`);
  process.exit(bad ? 1 : 0);
}

const out = [];
const say = (l = '') => { out.push(l); console.log(l); };
const err = (l = '') => { out.push(l); console.error(l); };

say(`=== odds site drift  utc=${new Date().toISOString()} ===\n`);

const res = await fetch(`${RELAY}/budget/odds`, { headers: { Accept: 'application/json' } });
if (!res.ok) { err(`FAIL: /budget/odds returned HTTP ${res.status}`); process.exit(1); }
const parsed = sampleFrom(await res.json());
if (!parsed.ok) {
  err(`FAIL: /budget/odds did not yield a sample — ${parsed.why}.`);
  err(`      Recording it anyway is how a garbage reading passes as a quiet one.`);
  process.exit(1);
}
const sample = parsed.sample;

let series = [];
if (existsSync(SERIES)) { try { series = JSON.parse(readFileSync(SERIES, 'utf8')); } catch (_) { series = []; } }
// The 15:48 run committed one sample of undefineds before the shape was fixed.
// Dropping it on load beats a migration: any entry that is not a usable reading
// cannot take part in an interval anyway, and leaving it in the artifact makes
// a reader count samples that were never measurements.
const junk = series.length;
series = series.filter(x => x && typeof x.date === 'string' && typeof x.used === 'number');
if (junk !== series.length) say(`  dropped ${junk - series.length} unusable sample(s) already on file\n`);
series.push(sample);
series = series.slice(-KEEP);
writeFileSync(SERIES, JSON.stringify(series, null, 2) + '\n');

say(`  this reading   : ${sample.date}  used ${sample.used}  by_site_sum ${sample.by_site_sum}  gap ${gapOf(sample)}`);
say(`  unreadable     : ${(sample.unreadable_sites || []).join(', ') || 'none'}`);
say(`  samples on file: ${series.length}  (keeping the last ${KEEP})\n`);

const sameDay = series.filter(s => s.date === sample.date);
const pairs = [];
for (let i = 1; i < sameDay.length; i++) pairs.push(deltas(sameDay[i - 1], sameDay[i]));

if (!pairs.length) {
  say(`  only ${sameDay.length} sample(s) for ${sample.date} — an interval needs two.`);
} else {
  say(`  INTERVALS for ${sample.date}`);
  say(`  from      to        usedD    gapD   verdict`);
  for (let i = 0; i < pairs.length; i++) {
    const w = clampWitness(pairs[i]);
    const a = sameDay[i].at.slice(11, 16), b = sameDay[i + 1].at.slice(11, 16);
    say(`  ${a}     ${b}   ${String(pairs[i].usedDelta).padStart(6)}  ${String(pairs[i].gapDelta).padStart(6)}   ${w.verdict}`
      + (w.suspects ? `  pinned: ${w.suspects.join(', ')}` : ''));
  }
}

const v = driftVerdict(pairs);
say(`\n  verdict: ${v.state}  over ${v.intervals} interval(s) of ${sameDay.length} same-day sample(s)`);

say(`\nCOVERAGE: ${sameDay.length} sample(s) of the ${sample.date} UTC day, ${pairs.length} interval(s).`);
say(`Cross-midnight pairs are REFUSED, not merged, so a day's first reading yields no`);
say(`interval. A refund that lands and is undone between two samples is invisible —`);
say(`the sampling interval is the floor on what this can see.`);

writeFileSync(`outbox/odds-site-drift-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}.log`, out.join('\n') + '\n');

if (v.state === 'clamp-witnessed') {
  err(`\nFAIL: ${v.hits} interval(s) show the daily total taking a refund while the gap GREW.`);
  err(`      That is the per-site clamp in _bumpSite discarding a refund aimed at a site`);
  err(`      already at 0, while the same refund reaches odds:daily:* in full.`);
  err(`      The fix is in budget-helpers.js, not in this watch's tolerance.`);
  process.exit(1);
}
if (v.state === 'gap-grows-while-spending') {
  err(`\nFAIL: ${v.hits} interval(s) grew the gap while spend ROSE. That is NOT the clamp.`);
  err(`      It is the lost-update signature: odds:daily:* is get-then-put on KV and is`);
  err(`      written on every permitted call, while each odds:site:* key is written on a`);
  err(`      fraction of them, so concurrent isolates drop more writes on the hot key.`);
  err(`      The fix is an atomic counter for the daily total, not a tolerance and not`);
  err(`      the per-site clamp.`);
  process.exit(1);
}
say(`\nOK: ${v.state} — no interval has caught the counters parting yet.`);
