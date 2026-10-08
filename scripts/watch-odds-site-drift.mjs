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
import { total } from './lib/summary-invariants.mjs';

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
  // A MIXED INTERVAL IS REFUSED, NOT MERGED, for the same reason a cross-day one
  // is: the two ends measure different mechanisms. Before Task 2 the counters
  // were two racing KV keys; after it they are one D1 transaction. An interval
  // straddling the cutover compares a KV gap to a D1 gap and the difference
  // between them is the deploy, not the system.
  if ((prev.source || 'kv') !== (curr.source || 'kv')) {
    return { mixedStore: true, from: prev.source || 'kv', to: curr.source || 'kv' };
  }
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
/** WHAT A GREEN MEANS, and it is not what it meant when this file was written.
 *
 *  Built 2026-09-18 to answer: do odds:daily:* and the sum of odds:site:* drift
 *  apart? Two KV keys, written by different code paths at different frequencies,
 *  read-modify-write and non-atomic. A green meant "they happen to agree."
 *
 *  Task 2 (2026-09-19) made both of them one transaction over one row set. They
 *  now agree BY CONSTRUCTION, so a green can no longer mean what it meant — it
 *  is not evidence about the counters, it is a restatement of the schema.
 *
 *  THE PROBE IS NOT RETIRED, BECAUSE ITS GREEN NOW ANSWERS A DIFFERENT QUESTION
 *  AND IT IS ONE NOTHING ELSE HERE CAN ANSWER. Divergence in D1 means the batch
 *  was not one transaction — which is Cloudflare's guarantee, taken on trust,
 *  and the single unverified premise under Task 2. The local mutations run
 *  against node:sqlite are sequential and prove the statements correct GIVEN a
 *  transaction; they say nothing about whether D1 supplies one under concurrent
 *  isolates. This probe is the only instrument that can catch that.
 *
 *  So the output states which claim it is making, rather than leaving the reader
 *  to infer a 2026-09-18 meaning from a 2026-09-20 run. */
export function claimOf(source) {
  return source === 'd1'
    ? 'batch() is one transaction — the counters cannot disagree unless it is not'
    : 'the two KV counters happen to agree — the pre-Task-2 question';
}

export function driftVerdict(pairs) {
  // mixedStore joins crossDay as a REFUSAL, not a datum. Adding the field
  // without adding it here would have left a straddling interval counted, and
  // its gap difference is the deploy rather than the system.
  const usable = pairs.filter(p => p && !p.crossDay && !p.mixedStore);
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
    // WHICH STORE ANSWERED. Added 2026-09-19 when Task 2 moved the guard into a
    // D1 transaction. The probe's QUESTION did not change and neither did its
    // arithmetic, but what a green MEANS did — see `claimOf` below. Older
    // samples predate the field and read as 'kv', which is what they were.
    source: typeof d.source === 'string' ? d.source : 'kv',
    // WHEN THE GUARD STARTED REFUSING, not whether the budget is spent. Added
    // 2026-09-23. This watch samples every ~3h, so it is the only instrument
    // that can say how LONG a capped day stayed capped — on 2026-09-19 `used`
    // was 3800 at 19:39 and still 3800 at 22:32, and nothing recorded that
    // those hours were refusals rather than a quiet evening.
    //
    // Three states preserved from the route (Rule 99): an ISO string, `true`
    // (vetoed, hour unknown), or null. Older samples predate the field and read
    // as undefined, which is a fourth thing — never measured — and is left
    // undefined rather than coerced to null.
    ceiling_reached_at: d.ceiling_reached_at,
    // WHAT RECONCILE DECIDED TODAY, added 2026-10-08. An array of
    // (site, state, cache, n, credits_kept) cells, or null when the tally could
    // not be read — never [] on a failure, which the route already guarantees
    // and this preserves rather than normalising away. Older samples predate
    // the field and read as undefined: never measured, a fourth state.
    reconcile: d.reconcile,
  } };
}

/** The ceiling line's words, as a pure function of the veto marker and the
 *  day's samples, so the self-test can hold it to what it claims.
 *
 *  `odds:daily:<date>:warned` is written on the FIRST vetoed charge of a day
 *  and never again (budget-helpers.js ~343, one warn per day per isolate), so
 *  it dates ONE refusal. It does not mean the rest of the day was refused: a
 *  charge small enough to still fit under the cap lands after it.
 *
 *  This line used to read "every odds fetch since then was refused", and on
 *  2026-10-07 that was false in the direction that makes an incident sound
 *  worse than it is — a veto was recorded at 01:16:29Z while this watch's own
 *  series read used 3712 at 02:53 and 3799 at 18:00, so 87 credits landed
 *  after it. The refutation was in the table printed four lines below the
 *  claim.
 *
 *  Post-veto spend is a LOWER BOUND and is labelled as one: it sums only the
 *  intervals with BOTH ends after the veto. The stretch between the veto and
 *  the first sample after it is unobserved, and on 2026-10-07 that stretch is
 *  97 minutes — the veto landed at 01:16 and the day's first sample is 02:53.
 *  Differencing against the latest `used` instead would need a sample at or
 *  before the veto, which a day whose sampling starts later simply does not
 *  have; with no qualifying interval this says UNKNOWN rather than zero,
 *  because nothing to difference is not a measurement of no spend (Rule 99).
 *
 *  This shape was itself a correction: the first version differenced the
 *  latest `used` against the last sample at or before the veto, and on the
 *  real 2026-10-07 series that returned UNKNOWN for a day with 87 observable
 *  post-veto credits. The self-test caught it by disagreeing with the fixture
 *  taken from the committed series. */
export function ceilingLine(ceilingReachedAt, sameDay, latestUsed) {
  const c = ceilingReachedAt;
  if (c === undefined) return 'NOT REPORTED — this build predates /budget/odds carrying it';
  if (c === null) return 'no veto recorded today';
  if (c === true) return 'REACHED, hour unknown (a key written before the field existed)';
  const usable = (sameDay || []).filter((x) => x && typeof x.at === 'string'
                                                && typeof x.used === 'number');
  let since = null;
  for (let i = 1; i < usable.length; i++) {
    if (usable[i - 1].at > c) since = (since ?? 0) + (usable[i].used - usable[i - 1].used);
  }
  return `REACHED at ${c} — one charge refused then; ` + (
    since === null ? 'spend since is UNOBSERVED (no interval on file lies wholly after it)'
    : since > 0 ? `at least ${since} credit(s) landed after it, so smaller charges still fit`
    : since < 0 ? `the total has FALLEN by ${-since} over the intervals after it — a refund, not a refusal`
    : 'no interval after it shows any spend');
}

if (process.argv.includes('--self-test')) {
  let bad = 0, ran = 0;
  const one = (label, got, want, why) => { ran++; return JSON.stringify(got) === JSON.stringify(want)
    ? console.log(`  PASS  ${label} -> ${JSON.stringify(got)}  (${why})`)
    : (bad++, console.log(`  FAIL  ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`)); };

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

  // Added 2026-09-19 with the Task 2 cutover. A mixed interval compares a KV gap
  // to a D1 gap; the difference between them is the deploy.
  const withSrc = (s, d, u, sites) => ({ ...S(d, u, sites), source: s });
  one('A MIXED-STORE INTERVAL IS REFUSED',
      deltas(withSrc('kv', '2026-09-19', 10, { a: 10 }), withSrc('d1', '2026-09-19', 20, { a: 20 })).mixedStore, true,
      'the two ends measure different mechanisms, so their difference is the deploy');
  one('...and it is excluded from the verdict, not merely flagged',
      driftVerdict([deltas(withSrc('kv', '2026-09-19', 10, { a: 10 }), withSrc('d1', '2026-09-19', 20, { a: 20 }))]).intervals, 0,
      'a refusal that still counts is not a refusal');
  one('same store still compares', deltas(withSrc('d1', '2026-09-19', 10, { a: 10 }), withSrc('d1', '2026-09-19', 20, { a: 20 })).mixedStore, undefined,
      'the refusal must not swallow every interval');
  one('a green on D1 claims transaction integrity', claimOf('d1').includes('transaction'), true,
      'what a green means changed when Task 2 made both counters one write');
  one('a green on KV claims the OLD thing', claimOf('kv').includes('KV counters'), true,
      'an old sample must not be read as evidence about the batch');
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

  // THE CEILING FIELD, FOUR STATES. undefined is not null here: a sample from a
  // build that predates the route field was never measured, while null means
  // the route looked and found no veto. Collapsing them would turn every old
  // sample into evidence that nothing was refused that day.
  {
    const B = (extra) => ({ daily: { date: 'd', used: 1, by_site: {}, by_site_sum: 0, ...extra } });
    const c = (extra) => sampleFrom(B(extra), 'T').sample.ceiling_reached_at;
    one('an ISO veto time is carried through', c({ ceiling_reached_at: '2026-09-19T18:42:00.000Z' }),
        '2026-09-19T18:42:00.000Z', 'the hour refusals began is the whole point of the field');
    one('true is carried through as true', c({ ceiling_reached_at: true }), true,
        'vetoed with the hour unknown — a key written before the field existed');
    one('null stays null', c({ ceiling_reached_at: null }), null, 'the route looked and found no veto');
    one('a build that never reported it stays undefined', c({}), undefined,
        'never measured is not the same as measured-and-clean (Rule 99)');
  }

  // THE RECONCILE TALLY, added 2026-10-08. Four states, and three of them are
  // not each other: never measured, unreadable, and no decisions. Collapsing
  // any pair of those is how a blank table would read as a clean one.
  {
    // Its own B: the one above is block-scoped, and borrowing it threw a
    // ReferenceError that crashed the suite where a named FAIL belonged.
    const B2 = (extra) => ({ daily: { date: 'd', used: 1, by_site: {}, by_site_sum: 0, ...extra } });
    const rec = (extra) => sampleFrom(B2(extra), 'T').sample.reconcile;
    one('an array of cells is carried through',
        rec({ reconcile: [{ site: 's', state: 'no-header', cache: 'none', n: 2, credits_kept: 8 }] }).length, 1,
        'the cells are what name a kept estimate');
    one('null stays null', rec({ reconcile: null }), null,
        'the tally could not be read, which is not "no decisions" (Rule 99)');
    one('an empty array stays empty, not null', rec({ reconcile: [] }), [],
        'no decisions today is a reading, and must not be coerced to unreadable');
    one('a build that never reported it stays undefined', rec({}), undefined,
        'never measured is a fourth state');
  }

  // THE CEILING LINE'S WORDS. It said "every odds fetch since then was refused"
  // for any veto marker, and the marker is written once per day on the FIRST
  // refusal, so the sentence was an assertion the field cannot support. These
  // fixtures are the 2026-10-07 shape and its three neighbours.
  {
    const day = (at, used) => ({ date: '2026-10-07', at, used });
    const oct7 = [day('2026-10-07T02:53:00.000Z', 3712), day('2026-10-07T09:25:00.000Z', 3796),
                  day('2026-10-07T18:00:00.000Z', 3799)];
    one('spend after the veto is MEASURED, and labelled a lower bound',
        ceilingLine('2026-10-07T01:16:29.508Z', oct7, 3799),
        'REACHED at 2026-10-07T01:16:29.508Z — one charge refused then; at least 87 credit(s) landed after it, so smaller charges still fit',
        'the real 2026-10-07 series: the old line called this a total refusal for the whole day');
    one('a veto after every sample is UNOBSERVED, never "nothing"',
        ceilingLine('2026-10-07T23:58:00.000Z', oct7, 3799),
        'REACHED at 2026-10-07T23:58:00.000Z — one charge refused then; spend since is UNOBSERVED (no interval on file lies wholly after it)',
        'a 23:58 veto cannot be followed by an interval, and silence is not a zero (Rule 99)');
    one('one sample after the veto is still no interval',
        ceilingLine('2026-10-07T01:16:29.508Z', [day('2026-10-07T02:53:00.000Z', 3712)], 3712),
        'REACHED at 2026-10-07T01:16:29.508Z — one charge refused then; spend since is UNOBSERVED (no interval on file lies wholly after it)',
        'an interval needs two ends here exactly as it does in the table below');
    one('a total that FELL after the veto is named a refund',
        ceilingLine('2026-10-07T01:16:29.508Z',
          [day('2026-10-07T02:53:00.000Z', 3712), day('2026-10-07T09:25:00.000Z', 3700)], 3700),
        'REACHED at 2026-10-07T01:16:29.508Z — one charge refused then; the total has FALLEN by 12 over the intervals after it — a refund, not a refusal',
        'this watch exists to catch refunds; the line must not read one as spend');
    one('an interval straddling the veto is not counted',
        ceilingLine('2026-10-07T03:00:00.000Z',
          [day('2026-10-07T02:53:00.000Z', 3712), day('2026-10-07T09:25:00.000Z', 3796)], 3796),
        'REACHED at 2026-10-07T03:00:00.000Z — one charge refused then; spend since is UNOBSERVED (no interval on file lies wholly after it)',
        'its left end precedes the veto, so its spend is partly pre-veto and cannot be attributed');
    one('no veto still reads as no veto', ceilingLine(null, oct7, 3799), 'no veto recorded today',
        'the three non-ISO states are unchanged by this');
  }

  // Derived. It read `27/27` after assertions were added to it, which is the
  // same defect twice over in this repo: a count that cannot move is not a
  // count. `one()` is the only thing that asserts here, so it is the only
  // thing that may say how many.
  console.log(bad ? `\n${bad} FAILED of ${ran}` : `\nself-test: ${ran}/${ran}`);
  console.log(`COVERAGE: ${ran} assertion(s) over six pure predicates and ENUMERATED samples,`);
  console.log(`the ceiling line among them. It does NOT reach`);
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
// THE CEILING LINE. `used === ceiling` says the budget is spent; this says the
// guard turned ONE charge away, and when — the marker is written once a day.
// A day that lands on the cap at 23:58 refused nothing; 2026-09-19 was already
// at 3800 by 19:39 and still 3800 at 22:32, which the post-veto delta now
// states as a measurement instead of the line asserting it. See ceilingLine.
const sameDay = series.filter(s => s.date === sample.date);
say(`  ceiling        : ${ceilingLine(sample.ceiling_reached_at, sameDay, sample.used)}`);
say(`  unreadable     : ${(sample.unreadable_sites || []).join(', ') || 'none'}`);
// WHAT RECONCILE KEPT. This is the half of the spend question `used` cannot
// answer: `used` is what the counter charged, and credits_kept is how much of
// that the provider never asked for and reconcile did not hand back. On
// 2026-10-07 by_site getWCPregameLambdas read 2536 against a provider that
// billed 514 and nothing recorded which reconcile branch had fired.
//
// REPORTED, NOT JUDGED. There is no threshold here yet — the first days of this
// table are the baseline, and a gate written before its own baseline is a
// number invented to be met.
{
  const r = sample.reconcile;
  if (r === undefined) say(`  reconcile      : NOT REPORTED — this build predates /budget/odds carrying it`);
  else if (r === null) say(`  reconcile      : UNREADABLE — the tally could not be read, which is not "no decisions"`);
  else if (!r.length) say(`  reconcile      : no decisions recorded for ${sample.date}`);
  else {
    // total(), not `reduce(a + (Number(x) || 0))`. The second form turns a
    // missing field into a confident zero, and check-aggregate-launders-unknowns
    // caught exactly that in these two lines before they ever ran against real
    // rows — the same coercion that once published briefs_counted: 0 over 48
    // nulls. total() sums only numbers and says how many it skipped.
    const kept = total(r, 'credits_kept');
    const calls = total(r, 'n');
    say(`  reconcile      : ${calls.sum} call(s) over ${r.length} cell(s), credits_kept`
      + ` ${kept.sum} of used ${sample.used}`
      + (kept.skipped || calls.skipped
          ? `   NOT SUMMED: ${kept.skipped} kept and ${calls.skipped} n were non-numeric`
          : ''));
    say(`    site                        state         cache        n   kept`);
    for (const x of r.slice(0, 8)) {
      say(`    ${String(x.site).slice(0, 26).padEnd(28)}${String(x.state).padEnd(14)}`
        + `${String(x.cache).padEnd(11)}${String(x.n).padStart(5)}${String(x.credits_kept).padStart(7)}`);
    }
    if (r.length > 8) say(`    ... and ${r.length - 8} more cell(s), ranked by kept`);
  }
}
say(`  samples on file: ${series.length}  (keeping the last ${KEEP})\n`);

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

// WHAT THIS VERDICT CLAIMS, printed where the verdict is read rather than left
// to a reader inferring the 2026-09-18 meaning from a later run (Rule 91).
{
  const stores = [...new Set(sameDay.map(s => s.source || 'kv'))];
  const mixed = pairs.filter(p => p && p.mixedStore).length;
  say(`\n  store    : ${stores.join(' + ')}`);
  say(`  a green here means: ${stores.length === 1 ? claimOf(stores[0]) : 'NOTHING SINGLE — this day straddles the Task 2 cutover'}`);
  if (mixed) say(`  refused  : ${mixed} interval(s) straddling the KV -> D1 cutover, not merged`);
}

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
