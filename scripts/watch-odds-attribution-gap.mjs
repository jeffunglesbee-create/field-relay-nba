#!/usr/bin/env node
// Does /budget/odds still decompose into the sites that spent it?
//
// WHY THIS IS A DAILY WATCH AND NOT A ONE-OFF CHECK. On 2026-09-16 by_site
// shipped and the split looked plausible on its first reading: used 322,
// by_site_sum 113, unaccounted 209 — which reads as "attribution started late
// today". Thirteen minutes later: used 768, by_site_sum 662, unaccounted 106.
// The sum had grown FASTER than the total it decomposes, which residue cannot
// do. reconcileOddsCredit was correcting odds:daily:* and odds:credits:* by the
// provider's real receipt and leaving odds:site:* holding the estimate, so
// `unaccounted` was the net refund wearing the name of a gap, on its way
// negative. One reading could not show that. Two could, and nothing was
// scheduled to take the second.
//
// THE GAP IS SIGNED AND BOTH SIGNS MEAN SOMETHING DIFFERENT:
//   unaccounted > 0   a site spent and did not name itself (or a KV write lost)
//   unaccounted < 0   a correction reached the sites but not the total, or a
//                     site counter was double-bumped
// Neither is benign, so the check is on the ABSOLUTE value.
//
// READ-ONLY. One GET against a public route, no credits spent, no D1.
// --self-test runs the predicate against enumerated synthetic readings and
// needs no network.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';

// 5% of the day's spend, but never less than FLOOR: at 09:00 UTC `used` can be
// in the tens, where 5% is 2 and a single lost KV write trips the alarm. The
// floor is what keeps this from crying wolf on a quiet morning; the percentage
// is what keeps it meaningful on a busy evening.
export const TOLERANCE_PCT = 0.05;
export const FLOOR = 25;

/** Returns { state, detail, gap, allowed }. `state` is one of:
 *  ok | unreadable-sites | unknown-sum | no-spend | gap-too-wide | malformed */
export function attributionVerdict(daily) {
  if (!daily || typeof daily !== 'object') {
    return { state: 'malformed', detail: 'no daily block in the response', gap: null, allowed: null };
  }
  // A corrupt counter is a finding about the ledger, not a zero to sum around.
  if (Array.isArray(daily.unreadable_sites) && daily.unreadable_sites.length) {
    return { state: 'unreadable-sites', gap: null, allowed: null,
             detail: `unreadable: ${daily.unreadable_sites.join(', ')}` };
  }
  // `used` and `by_site_sum` must both BE numbers. `Number(null)` is 0 and a
  // zero gap computed from two unknowns is the most convincing wrong answer
  // this file could print (Rule 99).
  const used = daily.used, sum = daily.by_site_sum;
  if (typeof used !== 'number' || !Number.isFinite(used)) {
    return { state: 'malformed', detail: `daily.used is ${JSON.stringify(used)}, not a number`, gap: null, allowed: null };
  }
  if (typeof sum !== 'number' || !Number.isFinite(sum)) {
    return { state: 'unknown-sum', detail: `by_site_sum is ${JSON.stringify(sum)} — the split is not computable`, gap: null, allowed: null };
  }
  // A zero denominator is not a pass. Run this near the end of the UTC day and
  // a day with no odds spend at all means a guard, a cron or the binding died.
  if (used === 0) {
    return { state: 'no-spend', detail: 'daily.used is 0 — nothing spent all day, which is not health', gap: 0, allowed: null };
  }
  const gap = used - sum;
  const allowed = Math.max(FLOOR, Math.round(used * TOLERANCE_PCT));
  return Math.abs(gap) <= allowed
    ? { state: 'ok', detail: `|${gap}| within ${allowed}`, gap, allowed }
    : { state: 'gap-too-wide', detail: `|${gap}| exceeds ${allowed} (${Math.round(100 * Math.abs(gap) / used)}% of ${used})`, gap, allowed };
}

if (process.argv.includes('--self-test')) {
  let bad = 0;
  const one = (label, got, want, why) => got === want
    ? console.log(`  PASS  ${label} -> ${got}  (${why})`)
    : (bad++, console.log(`  FAIL  ${label}: got ${got} want ${want}  (${why})`));
  const v = (d) => attributionVerdict(d).state;

  one('an exact split',        v({ used: 1000, by_site_sum: 1000 }), 'ok', 'gap 0');
  one('a 2% gap',              v({ used: 1000, by_site_sum: 980 }),  'ok', '20 within max(25, 50)');
  one('a 20% gap',             v({ used: 1000, by_site_sum: 800 }),  'gap-too-wide', '200 over 50');
  one('a NEGATIVE 20% gap',    v({ used: 1000, by_site_sum: 1200 }), 'gap-too-wide',
      'the sign that shipped — the sum outgrew the total it decomposes');
  one('a small morning gap',   v({ used: 60, by_site_sum: 45 }),     'ok', '15 under the floor of 25');
  one('a small gap OVER the floor', v({ used: 60, by_site_sum: 20 }), 'gap-too-wide', '40 over the floor');
  one('a null sum',            v({ used: 500, by_site_sum: null }),  'unknown-sum',
      'Number(null) is 0 and would have printed a 500 gap as if it were measured');
  one('a null used',           v({ used: null, by_site_sum: 0 }),    'malformed', 'no denominator');
  one('an unreadable site',    v({ used: 500, by_site_sum: 400, unreadable_sites: ['wpResolver'] }), 'unreadable-sites',
      'a corrupt counter is reported, not summed around');
  one('a silent day',          v({ used: 0, by_site_sum: 0 }),       'no-spend',
      'a zero denominator is not a clean bill of health (Rule 99)');
  one('no daily block',        v(null),                              'malformed', 'the route changed shape');

  console.log(bad ? `\n${bad} FAILED` : `\nself-test: 11/11`);
  console.log(`COVERAGE: the verdict predicate only. It does not fetch, and it cannot`);
  console.log(`tell a site that spent-and-did-not-name-itself from a lost KV write —`);
  console.log(`both land in the same positive gap. check-odds-attribution.mjs covers`);
  console.log(`the source side: that every call site names itself, and that the guard`);
  console.log(`and the reconcile name the SAME nine consumers.`);
  process.exit(bad ? 1 : 0);
}

console.log(`=== odds attribution gap ===\n`);

let body = null;
try {
  const r = await fetch(`${RELAY}/budget/odds`, { headers: { Accept: 'application/json' } });
  body = await r.json();
} catch (e) {
  console.log(`FAIL: /budget/odds unreachable (${e.message}).`);
  console.log(`The split cannot be read, which is not the same as the split being fine.`);
  process.exit(1);
}

const daily = body && body.daily;
const verdict = attributionVerdict(daily);

console.log(`  date            : ${daily?.date ?? 'unreadable'}`);
console.log(`  used            : ${daily?.used ?? 'unreadable'}`);
console.log(`  by_site_sum     : ${daily?.by_site_sum ?? 'unreadable'}`);
console.log(`  unaccounted     : ${daily?.unaccounted ?? 'unreadable'}`);
console.log(`  unreadable_sites: ${daily?.unreadable_sites ? daily.unreadable_sites.join(', ') : 'none'}`);
console.log(`\n  by site:`);
for (const [site, n] of Object.entries(daily?.by_site || {})) {
  console.log(`    ${site.padEnd(28)} ${n === null ? 'UNREADABLE' : n}`);
}

console.log(`\n  verdict         : ${verdict.state}`);
console.log(`  detail          : ${verdict.detail}`);
console.log(`\nCOVERAGE: ONE reading, of ONE UTC day's live counters. It is not a series`);
console.log(`and it cannot see yesterday. What it can see is the whole of today, which`);
console.log(`is why it runs at 23:30 UTC rather than beside the other watches at 11:00.`);

if (verdict.state !== 'ok') {
  console.log(`\nFAIL: ${verdict.state} — ${verdict.detail}`);
  console.log(`A positive gap means a site spent without naming itself, or a KV write was`);
  console.log(`lost. A negative gap means a correction reached odds:site:* but not`);
  console.log(`odds:daily:*, which is the 2026-09-16 defect returning from the other side.`);
  console.log(`Raising TOLERANCE_PCT to turn this green is the thing that ends the watch.`);
  process.exit(1);
}
console.log(`\nthe day's spend decomposes into the sites that spent it`);
