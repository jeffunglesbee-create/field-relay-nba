// HOW MANY PLACES CHARGE THE MONTHLY ODDS COUNTER, AND HOW.
//
// THE ASYMMETRY THIS RECORDS. Since 2026-09-19 the DAILY counter is one D1
// transaction (`checkAndIncrementDailyOdds`): seed, site and charge in a single
// `batch()`, so every charge lands and the daily and per-site figures cannot
// diverge. The MONTHLY counter never moved. It is still a plain KV
// read-modify-write — `get`, `parseInt`, `put` — and it has THREE independent
// implementations plus reconcile's correction loop, all on the same key
// `odds:credits:YYYY-MM`.
//
// From concurrent isolates that loses updates by construction: two isolates
// read the same value, both add their units, the second write erases the
// first. Daily keeps both charges; monthly keeps one.
//
// FIXED 2026-09-23. The three charging copies are now one D1 transaction,
// chargeMonthlyOdds, with the ceiling inside the UPDATE's WHERE. What follows
// is kept as the record of why, and the baseline is now 1.
//
// SO THE TWO COUNTERS MUST DIVERGE, AND IN THE DIRECTION MEASURED. Over the two
// fully-contained days of 2026-09-20 and 09-21 the daily counter summed 7599
// while the monthly counter moved 5037 — an excess of 2562 against an
// inequality that cannot legitimately be violated, because one function charges
// both the same units (scripts/lib/daily-vs-monthly.cjs).
//
// WHAT THIS CHECK IS AND IS NOT. It is a RATCHET on the count, not a fix and
// not a claim about magnitude. Lost updates explain the DIRECTION of the
// excess; they do not establish that they explain all 2562 of it, and nothing
// here says they do. What it prevents is a fourth charging implementation
// arriving quietly — the duplication is the root problem, and it has grown
// before (docs/IMPACT-2026-09-16-odds-ceilings.md recorded three where a
// previous session had claimed one).
import { readFileSync } from 'node:fs';

const FILES = (process.env.MONTHLY_WRITER_FILES
  || 'src/index.js,src/wp-resolver.js,src/ambient-do.js,src/budget-helpers.js').split(',');
// 4 -> 1 on 2026-09-23: the three charging copies became one D1 transaction
// (chargeMonthlyOdds). The remaining writer is reconcile's KV mirror, kept so
// days before the cutover still resolve through the KV fallback in
// peekMonthlyOdds. Lowered deliberately — a ratchet that is not tightened after
// a real gain leaves the gain available to lose.
const BASELINE = Number(process.env.MONTHLY_WRITER_BASELINE || 1);

/** Non-atomic `put` of a computed total back onto a KV key. */
export function rmwWrites(src) {
  return [...String(src).matchAll(
    /FIELD_JOURNALISM\.put\(\s*key\s*,\s*String\((?:used \+ units|next)\)/g)].length;
}

/** Does this file charge the monthly odds key at all? */
export function touchesMonthlyKey(src) {
  return /odds:credits:\$\{/.test(String(src));
}

if (process.argv.includes('--self-test')) {
  let bad = 0, n = 0;
  const eq = (l, g, w) => { n++;
    if (JSON.stringify(g) === JSON.stringify(w)) console.log(`ok    ${l}`);
    else { bad++; console.log(`FAIL  ${l}\n        got ${JSON.stringify(g)} want ${JSON.stringify(w)}`); } };

  eq('a get-then-put on a computed total is a read-modify-write',
    rmwWrites("const used = 1; await env.FIELD_JOURNALISM.put(key, String(used + units), {});"), 1);
  eq('the `next` spelling counts too — two files use it, one does not',
    rmwWrites("await env.FIELD_JOURNALISM.put(key, String(next), {});"), 1);
  // THE BINDING IS PART OF THE PATTERN. The first version of this fixture wrote
  // a bare `put(...)` and expected 2; the regex requires FIELD_JOURNALISM.put,
  // so it counted 0. The check was right and the fixture was wrong — matching a
  // bare `put` would count every KV and D1 write in the tree.
  eq('two in one file are two',
    rmwWrites("env.FIELD_JOURNALISM.put(key, String(used + units), {})\n"
            + "env.FIELD_JOURNALISM.put(key, String(next), {})"), 2);
  eq('a put on a different binding is not counted',
    rmwWrites("env.PUSH_SUBS.put(key, String(next), {})"), 0);
  eq('a put of something else is not one',
    rmwWrites("await env.FIELD_JOURNALISM.put(warnedKey, '1', {});"), 0);
  eq('a file with no puts has none', rmwWrites('const x = 1;'), 0);
  eq('the monthly key is recognised', touchesMonthlyKey('`odds:credits:${y}-${m}`'), true);
  eq('an unrelated key is not', touchesMonthlyKey('`odds:daily:${date}`'), false);

  console.log(`\n${n - bad} of ${n} passed.`);
  console.log('COVERAGE: two pure parsers over source text. It does NOT run the worker and');
  console.log('cannot observe a lost update — only that the shape which permits one is there.');
  process.exit(bad ? 1 : 0);
}

let total = 0;
const rows = [];
for (const f of FILES) {
  let src;
  try { src = readFileSync(f.trim(), 'utf8'); } catch (_e) {
    console.log(`NOT RUN — ${f} is unreadable. Not a pass (Rule 99).`);
    process.exit(1);
  }
  const n = rmwWrites(src);
  total += n;
  rows.push({ file: f.trim(), writes: n, monthly: touchesMonthlyKey(src) });
}

console.log('=== monthly odds counter: non-atomic writers ===\n');
for (const r of rows) {
  console.log(`  ${String(r.writes).padStart(2)}  ${r.file.padEnd(26)} ${r.monthly ? 'charges odds:credits:*' : ''}`);
}
console.log(`\n  total non-atomic read-modify-writes : ${total}   (baseline ${BASELINE})`);
console.log('  the DAILY counter, by contrast, is ONE D1 transaction since 2026-09-19.');
console.log('\nCOVERAGE: source text in 4 files. It counts the SHAPE that permits a lost');
console.log('update; it does not observe one, and it is not a claim that lost updates');
console.log('explain the whole 2562 excess — only its direction.');

if (total > BASELINE) {
  console.log(`\nFAIL: ${total} non-atomic writers, up from ${BASELINE}. A fourth copy of one`);
  console.log('      rule is how this reached three in the first place. Add it to the');
  console.log('      baseline only with the reason written down, or make it atomic.');
  process.exit(1);
}
if (total < BASELINE) {
  console.log(`\nRATCHET: ${total} writers, DOWN from ${BASELINE}. Lower the baseline in this`);
  console.log('      file so the gain is locked in rather than available to lose again.');
  process.exit(1);
}
console.log(`\nOK: ${total} non-atomic writers, unchanged. This is not good news — it is`);
console.log('    the absence of new bad news.');
