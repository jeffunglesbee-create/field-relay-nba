#!/usr/bin/env node
/**
 * Task 2 of CC-CMD-2026-09-18. Invariants on the atomic guard, most of them
 * about the SQL's SHAPE rather than its result, because the shape is the
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
 * THE MONTH JOINED THE BATCH ON 2026-10-18
 * (docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md): five
 * statements, seed -> monthSeed -> site -> monthCharge -> charge. The same
 * resolution applies to it, for the same reason. monthCharge carries the DAY's
 * predicate as well as its own hard limit, and must run before charge, so it
 * reads the same PRE-charge day total as the site does; then the month moves
 * exactly when the day does. A bare `<= ?` cannot tell the day's predicate from
 * the month's limit, so the month statement is checked for both by text.
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

/** Does the month statement read the day total BEFORE the charge is applied? */
export function monthReadsPreCharge(order) {
  const m = order.indexOf('monthCharge'), c = order.indexOf('charge');
  return m !== -1 && c !== -1 && m < c;
}

/** Both writes must carry the ceiling, or a veto writes one of them. */
export function bothGuardByCeiling(siteSql, chargeSql) {
  const guarded = (sql) => /<=\s*\?/.test(sql);
  return guarded(siteSql) && guarded(chargeSql);
}

/** The DAY's predicate, as SQL_SITE carries it. */
export const DAY_PREDICATE = '(SELECT used FROM odds_budget WHERE day = ?) + ? <= ?';
const norm = (sql) => String(sql || '').replace(/\s+/g, ' ').trim();

/** The month statement carries the day's predicate — the same text the site
 *  statement carries — AND its own hard limit. Either one alone is a bare
 *  `<= ?`, which is why a pattern on that cannot tell them apart. */
export function monthCarriesDayCeiling(monthSql, siteSql) {
  const m = norm(monthSql), s = norm(siteSql);
  return s.includes(DAY_PREDICATE) && m.includes(DAY_PREDICATE)
      && m.replace(DAY_PREDICATE, '').includes('used + ? <= ?');
}

/** A correction is not a charge: neither fix statement may carry the ceiling. */
export function correctionsUnguarded(fixDay, fixSite) {
  return !/<=\s*\?/.test(fixDay) && !/<=\s*\?/.test(fixSite);
}

export function verdict(order, pre, guarded, corrections, monthPre, monthDay) {
  if (order.length === 0)  return 'no-batch-found';
  if (order.length !== 5)  return `batch-has-${order.length}-statements`;
  if (!pre)                return 'site-reads-post-charge';
  if (!monthPre)           return 'month-reads-post-charge';
  if (order.at(-1) !== 'charge') return 'charge-is-not-last';
  if (!guarded)            return 'a-write-escapes-the-ceiling';
  if (!monthDay)           return 'the-month-escapes-the-day-ceiling';
  if (!corrections)        return 'a-correction-carries-the-ceiling';
  return 'ok';
}

if (process.argv.includes('--self-test')) {
  let bad = 0, ran = 0;
  const one = (l, got, want, why) => { ran++;
    if (JSON.stringify(got) === JSON.stringify(want)) console.log(`  PASS  ${l} -> ${JSON.stringify(got)}  (${why})`);
    else { bad++; console.log(`  FAIL  ${l}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`); }
  };
  const FIVE = ['seed','monthSeed','site','monthCharge','charge'];
  const OK = `db.batch([
      db.prepare(ODDS_BUDGET_SQL.seed).bind(a),
      db.prepare(ODDS_BUDGET_SQL.monthSeed).bind(b),
      db.prepare(ODDS_BUDGET_SQL.site).bind(c),
      db.prepare(ODDS_BUDGET_SQL.monthCharge).bind(d),
      db.prepare(ODDS_BUDGET_SQL.charge).bind(e),
  ])`;
  one('the order is read from the batch', batchOrder(OK), FIVE, 'from the call, not from a comment claiming it');
  one('site before charge is pre-charge', siteReadsPreCharge(FIVE), true, 'the resolution to the spec contradiction');
  one('B1 CHARGE BEFORE SITE IS CAUGHT', siteReadsPreCharge(['seed','charge','site']), false,
      'the site would read the POST-charge total and the two counters would differ by `units` at the boundary');
  one('monthCharge before charge is pre-charge', monthReadsPreCharge(FIVE), true, 'the same resolution, for the month');
  one('MONTH CHARGE AFTER CHARGE IS CAUGHT', monthReadsPreCharge(['seed','monthSeed','site','charge','monthCharge']), false,
      'the month would read the POST-charge day total and refuse at the boundary while the day charged — the month short again');
  one('no batch at all is a failure', verdict([], true, true, true, true, true), 'no-batch-found',
      'a renamed helper must not read as clean (an empty result is a failure)');
  one('a two-statement batch is caught', verdict(['seed','charge'], true, true, true, true, true), 'batch-has-2-statements',
      'dropping the site write is how the split silently stops being written');
  one('a three-statement batch is caught', verdict(['seed','site','charge'], true, true, true, true, true), 'batch-has-3-statements',
      'the day alone, the split shape: the month back in a second batch that a stop can separate from the first');

  one('both writes carrying the ceiling', bothGuardByCeiling('WHERE x + ? <= ?', 'WHERE y + ? <= ?'), true, 'the shipped form');
  one('B2 AN UNGUARDED SITE WRITE IS CAUGHT', bothGuardByCeiling('VALUES (?,?,?)', 'WHERE y + ? <= ?'), false,
      'a vetoed call would bump the split and not the total — the positive gap, manufactured');

  const SITE = `INSERT INTO odds_budget_site (day, site, used) SELECT ?, ?, ?
       WHERE (SELECT used FROM odds_budget WHERE day = ?) + ? <= ?
       ON CONFLICT(day, site) DO UPDATE SET used = used + excluded.used`;
  const MONTH = `UPDATE odds_budget_month SET used = used + ?
       WHERE month = ? AND used + ? <= ?
         AND (SELECT used FROM odds_budget WHERE day = ?) + ? <= ?
       RETURNING used`;
  one('the month carries the day predicate and its own limit', monthCarriesDayCeiling(MONTH, SITE), true, 'the shipped form');
  one('A MONTH WITHOUT THE DAY PREDICATE IS CAUGHT',
      monthCarriesDayCeiling('UPDATE odds_budget_month SET used = used + ? WHERE month = ? AND used + ? <= ? RETURNING used', SITE), false,
      'a day-vetoed call would charge the month — the month ahead of the day, the opposite gap');
  one('A MONTH WITHOUT ITS OWN LIMIT IS CAUGHT',
      monthCarriesDayCeiling('UPDATE odds_budget_month SET used = used + ? WHERE month = ? AND (SELECT used FROM odds_budget WHERE day = ?) + ? <= ? RETURNING used', SITE), false,
      'the 85,000 hard limit stops binding; the day predicate alone is still a `<= ?`, which is why the text is checked');
  one('a site statement that lost the predicate is not a reference', monthCarriesDayCeiling(MONTH, 'INSERT INTO odds_budget_site VALUES (?, ?, ?)'), false,
      'the predicate is taken from the site statement; with nothing to take, nothing is confirmed');

  one('corrections carry no ceiling', correctionsUnguarded('SET used = MAX(0, used + ?)', 'DO UPDATE SET used = MAX(0, used + ?)'), true,
      'a refund must land on a capped day or the ledger stays above the bill');
  one('B3 A CEILING ON A CORRECTION IS CAUGHT', correctionsUnguarded('SET used = used + ? WHERE used + ? <= ?', 'x'), false,
      'refusing a refund because the day is capped leaves the ledger permanently high');
  // THE LINES ABOVE TEST THE PREDICATES, NOT THE BRANCHES THAT USE THEM.
  // Mutations B4 and B5 replaced `if (!guarded)` and `if (!corrections)` with
  // `if (false)` and this suite stayed green: bothGuardByCeiling and
  // correctionsUnguarded still returned the right answers, and nothing asked
  // verdict() what it did with them. A predicate nobody consults is the same as
  // no predicate.
  one('B4: verdict ACTS on an unguarded write', verdict(FIVE, true, false, true, true, true),
      'a-write-escapes-the-ceiling', 'the branch, not the predicate');
  one('B5: verdict ACTS on a ceilinged correction', verdict(FIVE, true, true, false, true, true),
      'a-correction-carries-the-ceiling', 'the branch, not the predicate');
  one('verdict ACTS on a month that reads post-charge', verdict(FIVE, true, true, true, false, true),
      'month-reads-post-charge', 'the branch, not the predicate');
  one('verdict ACTS on a month without the day predicate', verdict(FIVE, true, true, true, true, false),
      'the-month-escapes-the-day-ceiling', 'the branch, not the predicate');
  one('verdict ACTS on a charge that is not last', verdict(['seed','site','monthCharge','charge','monthSeed'], true, true, true, true, true),
      'charge-is-not-last', 'chargedFromBatch reads the LAST statement as the verdict');
  one('all of them together pass', verdict(FIVE, true, true, true, true, true), 'ok', 'the shipped state');

  // COUNTED, not written down: a literal here is a denominator that goes
  // quietly wrong the first time an assertion is added (Rule 91).
  console.log(bad ? `\n${bad} FAILED of ${ran}` : `\nself-test: ${ran}/${ran}`);
  console.log('COVERAGE: pure predicates over the SQL and the batch order. It');
  console.log('does NOT execute SQL, reach D1, or verify that the statements are');
  console.log('atomic — batch() transactionality is Cloudflare\'s, asserted live by');
  console.log('the odds_budget_charging staged verifier, not here.');
  process.exit(bad ? 1 : 0);
}

const whole = readFileSync(SRC, 'utf8');

// SCOPED TO THE CHARGER'S BODY. batchOrder takes the FIRST db.batch([...]) it
// finds, and on 2026-09-23 chargeMonthlyOdds added a second one ABOVE the daily
// guard in this file. The gate then read the month's two-statement batch and
// reported `batch-has-2-statements` about a function that still had three.
//
// STRUCTURAL, NOT BY NAME. The widening guard used to refuse a slice that
// mentioned the monthly guard; since 2026-10-18 the month code legitimately
// lives in this function, so the guard asks the question it was standing in
// for: is there exactly ONE batch in the slice?
const _i = whole.indexOf('async function chargeOdds');
const _j = whole.indexOf('\n}\n', _i);
if (_i < 0 || _j < 0) {
  console.log('FAIL: chargeOdds was not found — nothing below ran.');
  process.exit(1);
}
const guardBody = whole.slice(_i, _j);
const batches = guardBody.split('db.batch([').length - 1;
if (batches !== 1) {
  console.log(`FAIL: the chargeOdds slice holds ${batches} db.batch([ calls, expected 1 — the batch below`);
  console.log('      could be a different one, or the charge has split again. Narrow it before trusting it.');
  process.exit(1);
}

// The SQL constants are module-level, so they are picked from the whole file;
// only the BATCH has to come from the guard.
const src = whole;
const pick = (k) => (src.match(new RegExp(`${k}\\s*=\\s*\`([\\s\\S]*?)\`|${k}\\s*=\\s*'([^']*)'`)) || [,''])[1] || '';
const order = batchOrder(guardBody);
const pre = siteReadsPreCharge(order);
const monthPre = monthReadsPreCharge(order);
const guarded = bothGuardByCeiling(pick('SQL_SITE'), pick('SQL_CHARGE'));
const monthDay = monthCarriesDayCeiling(pick('SQL_MONTH_CHARGE'), pick('SQL_SITE'));
const corrections = correctionsUnguarded(pick('SQL_FIX_DAY'), pick('SQL_FIX_SITE'));
const v = verdict(order, pre, guarded, corrections, monthPre, monthDay);

console.log('=== the odds budget batch ===\n');
console.log(`  batch order              : ${order.join(' -> ') || '(no batch found)'}`);
console.log(`  site reads pre-charge    : ${pre}`);
console.log(`  month reads pre-charge   : ${monthPre}`);
console.log(`  charge is last           : ${order.at(-1) === 'charge'}`);
console.log(`  both writes ceilinged    : ${guarded}`);
console.log(`  month carries day + limit: ${monthDay}`);
console.log(`  corrections unceilinged  : ${corrections}`);
console.log(`\n  verdict: ${v}`);
console.log(`\nCOVERAGE: the batch in ${SRC} — its order and five statements' shape.`);
console.log('It does NOT execute SQL or reach D1. Whether batch() is one transaction');
console.log('is Cloudflare\'s guarantee and is asserted live by odds_budget_charging.');

if (v !== 'ok') {
  console.log(`\nFAIL: ${v}`);
  if (v === 'site-reads-post-charge')
    console.log('      Charging before bumping makes the site statement read the POST-charge\n      total. The two counters then differ by `units` on every boundary call.');
  if (v === 'month-reads-post-charge')
    console.log('      Charging the day before the month makes the month read the POST-charge\n      day total. At the boundary the day charges and the month refuses.');
  process.exit(1);
}
console.log('\nOK: seed -> monthSeed -> site -> monthCharge -> charge, every write ceilinged, the month on the day\'s predicate too, corrections not.');
