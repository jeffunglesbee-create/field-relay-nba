#!/usr/bin/env node
/**
 * Task 2 of CC-CMD-2026-09-18. Four invariants on the atomic guard, three of
 * them about the SQL's SHAPE rather than its result, because the shape is the
 * correctness argument and it is invisible from any single statement.
 *
 * THE SPEC WAS SELF-CONTRADICTORY AND THIS RECORDS THE RESOLUTION. Task 2 said
 * "All three in one env.DB.batch([...])" AND "Statement 3 runs only if statement
 * 2 returned a row." Both cannot hold: a batch is submitted as a unit, so
 * nothing can read statement 2's result and then decide whether to include
 * statement 3. Obeying the second sentence means two round trips and no
 * transaction, which removes the only reason for the change.
 *
 * The resolution is the ORDER. Bump the site FIRST, reading the PRE-charge
 * total, then charge the day. Both statements carry the same ceiling predicate
 * over the same pre-charge value, so in one transaction they either both apply
 * or neither does. The daily UPDATE's RETURNING still gives the verdict because
 * it is last.
 *
 * If a later edit reorders them — charge first, then bump — the site statement
 * would read the POST-charge total and the two would disagree by `units` on
 * every call at the boundary. That is a one-line change with no visible symptom
 * until a ceiling day, which is what B1 exists to catch.
 *
 * READ-ONLY. Parses source text; runs no SQL and touches no database.
 */
import { readFileSync } from 'node:fs';

const SRC = 'src/budget-helpers.js';

/** The statements, in the order the batch submits them. */
export function batchOrder(src) {
  const m = src.match(/db\.batch\(\[([\s\S]*?)\]\)/);
  if (!m) return [];
  return [...m[1].matchAll(/ODDS_BUDGET_SQL\.(\w+)/g)].map(x => x[1]);
}

/** Does the site statement read the total BEFORE the charge is applied? */
export function siteReadsPreCharge(order) {
  const s = order.indexOf('site'), c = order.indexOf('charge');
  return s !== -1 && c !== -1 && s < c;
}

/** Both writes must carry the ceiling, or a veto writes one of them. */
export function bothGuardByCeiling(siteSql, chargeSql) {
  const guarded = (sql) => /<=\s*\?/.test(sql);
  return guarded(siteSql) && guarded(chargeSql);
}

/** A correction is not a charge: neither fix statement may carry the ceiling. */
export function correctionsUnguarded(fixDay, fixSite) {
  return !/<=\s*\?/.test(fixDay) && !/<=\s*\?/.test(fixSite);
}

export function verdict(order, pre, guarded, corrections) {
  if (order.length === 0)  return 'no-batch-found';
  if (order.length !== 3)  return `batch-has-${order.length}-statements`;
  if (!pre)                return 'site-reads-post-charge';
  if (!guarded)            return 'a-write-escapes-the-ceiling';
  if (!corrections)        return 'a-correction-carries-the-ceiling';
  return 'ok';
}

if (process.argv.includes('--self-test')) {
  let bad = 0;
  const one = (l, got, want, why) => {
    if (JSON.stringify(got) === JSON.stringify(want)) console.log(`  PASS  ${l} -> ${JSON.stringify(got)}  (${why})`);
    else { bad++; console.log(`  FAIL  ${l}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`); }
  };
  const OK = `db.batch([
      db.prepare(ODDS_BUDGET_SQL.seed).bind(a),
      db.prepare(ODDS_BUDGET_SQL.site).bind(b),
      db.prepare(ODDS_BUDGET_SQL.charge).bind(c),
  ])`;
  one('the order is read from the batch', batchOrder(OK), ['seed','site','charge'], 'from the call, not from a comment claiming it');
  one('site before charge is pre-charge', siteReadsPreCharge(['seed','site','charge']), true, 'the resolution to the spec contradiction');
  one('B1 CHARGE BEFORE SITE IS CAUGHT', siteReadsPreCharge(['seed','charge','site']), false,
      'the site would read the POST-charge total and the two counters would differ by `units` at the boundary');
  one('no batch at all is a failure', verdict([], true, true, true), 'no-batch-found',
      'a renamed helper must not read as clean (an empty result is a failure)');
  one('a two-statement batch is caught', verdict(['seed','charge'], true, true, true), 'batch-has-2-statements',
      'dropping the site write is how the split silently stops being written');

  one('both writes carrying the ceiling', bothGuardByCeiling('WHERE x + ? <= ?', 'WHERE y + ? <= ?'), true, 'the shipped form');
  one('B2 AN UNGUARDED SITE WRITE IS CAUGHT', bothGuardByCeiling('VALUES (?,?,?)', 'WHERE y + ? <= ?'), false,
      'a vetoed call would bump the split and not the total — the positive gap, manufactured');
  one('corrections carry no ceiling', correctionsUnguarded('SET used = MAX(0, used + ?)', 'DO UPDATE SET used = MAX(0, used + ?)'), true,
      'a refund must land on a capped day or the ledger stays above the bill');
  one('B3 A CEILING ON A CORRECTION IS CAUGHT', correctionsUnguarded('SET used = used + ? WHERE used + ? <= ?', 'x'), false,
      'refusing a refund because the day is capped leaves the ledger permanently high');
  // THE TWO LINES ABOVE TEST THE PREDICATES, NOT THE BRANCHES THAT USE THEM.
  // Mutations B4 and B5 replaced `if (!guarded)` and `if (!corrections)` with
  // `if (false)` and this suite stayed green: bothGuardByCeiling and
  // correctionsUnguarded still returned the right answers, and nothing asked
  // verdict() what it did with them. A predicate nobody consults is the same as
  // no predicate.
  one('B4: verdict ACTS on an unguarded write', verdict(['seed','site','charge'], true, false, true),
      'a-write-escapes-the-ceiling', 'the branch, not the predicate');
  one('B5: verdict ACTS on a ceilinged correction', verdict(['seed','site','charge'], true, true, false),
      'a-correction-carries-the-ceiling', 'the branch, not the predicate');
  one('all four together pass', verdict(['seed','site','charge'], true, true, true), 'ok', 'the shipped state');

  console.log(bad ? `\n${bad} FAILED` : '\nself-test: 12/12');
  console.log('COVERAGE: four pure predicates over the SQL and the batch order. It');
  console.log('does NOT execute SQL, reach D1, or verify that the statements are');
  console.log('atomic — batch() transactionality is Cloudflare\'s, asserted live by');
  console.log('the odds_budget_charging staged verifier, not here.');
  process.exit(bad ? 1 : 0);
}

const whole = readFileSync(SRC, 'utf8');

// SCOPED TO THE DAILY GUARD'S BODY. batchOrder takes the FIRST db.batch([...])
// it finds, and on 2026-09-23 chargeMonthlyOdds added a second one ABOVE
// checkAndIncrementDailyOdds in this file. The gate then read the month's
// two-statement batch and reported `batch-has-2-statements` about a function
// that still has three — the second whole-file reader in one commit to end up
// describing the wrong function (check-ceiling-reached.mjs was the first).
//
// The pure functions are untouched, so their self-test fixtures still exercise
// them directly; only what is handed to them here is narrowed.
const _i = whole.indexOf('async function checkAndIncrementDailyOdds');
const _j = whole.indexOf('\n}\n', _i);
if (_i < 0 || _j < 0) {
  console.log('FAIL: checkAndIncrementDailyOdds was not found — nothing below ran.');
  process.exit(1);
}
const guardBody = whole.slice(_i, _j);
if (/chargeMonthlyOdds|odds-month-guard/.test(guardBody)) {
  console.log('FAIL: the slice has widened past checkAndIncrementDailyOdds, so the batch');
  console.log('      below could be a different function\'s. Narrow it before trusting it.');
  process.exit(1);
}

// The SQL constants are module-level, so they are picked from the whole file;
// only the BATCH has to come from the guard.
const src = whole;
const pick = (k) => (src.match(new RegExp(`${k}\\s*=\\s*\`([\\s\\S]*?)\`|${k}\\s*=\\s*'([^']*)'`)) || [,''])[1] || '';
const order = batchOrder(guardBody);
const pre = siteReadsPreCharge(order);
const guarded = bothGuardByCeiling(pick('SQL_SITE'), pick('SQL_CHARGE'));
const corrections = correctionsUnguarded(pick('SQL_FIX_DAY'), pick('SQL_FIX_SITE'));
const v = verdict(order, pre, guarded, corrections);

console.log('=== the odds budget batch ===\n');
console.log(`  batch order            : ${order.join(' -> ') || '(no batch found)'}`);
console.log(`  site reads pre-charge  : ${pre}`);
console.log(`  both writes ceilinged  : ${guarded}`);
console.log(`  corrections unceilinged: ${corrections}`);
console.log(`\n  verdict: ${v}`);
console.log(`\nCOVERAGE: the batch in ${SRC} — its order and its four statements' shape.`);
console.log('It does NOT execute SQL or reach D1. Whether batch() is one transaction');
console.log('is Cloudflare\'s guarantee and is asserted live by odds_budget_charging.');

if (v !== 'ok') {
  console.log(`\nFAIL: ${v}`);
  if (v === 'site-reads-post-charge')
    console.log('      Charging before bumping makes the site statement read the POST-charge\n      total. The two counters then differ by `units` on every boundary call.');
  process.exit(1);
}
console.log('\nOK: seed -> site -> charge, both writes ceilinged, corrections not.');
