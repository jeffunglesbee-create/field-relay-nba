#!/usr/bin/env node
/**
 * Task 2 of CC-CMD-2026-09-18, rewritten 2026-10-28 for Task 3 of
 * CC-CMD-2026-09-16 (per-site caps). Invariants on the atomic guard, all of them
 * about the SQL's SHAPE rather than its result, because the shape is the
 * correctness argument and it is invisible from any single statement.
 * scripts/check-odds-site-caps.mjs is the other half: it RUNS the real chargeOdds
 * against a reference model. This file reads; that one executes.
 *
 * THE DESIGN, in one paragraph. One statement, `gate`, decides: it writes this
 * call's random token into a one-row table only if the day, the month AND the
 * site all have room over their PRE-charge totals. The three charges
 * (siteCharge, monthCharge, charge) apply only when the gate row holds the
 * token. So a call is charged to all three or to none. The earlier shape copied
 * the day's predicate onto each statement and ordered them (site first, charge
 * last, the month in between); with a third predicate the later statements read
 * totals the earlier ones had moved, and 973 of 2,000 random sequences agreed
 * with the model, where the gate agrees on 2,000 of 2,000.
 *
 * WHAT THIS FILE HOLDS TO:
 *   - nine statements, `snapshot` then `gate` BEFORE every charge, `charge`
 *     last (chargedFromBatch reads the last statement as the day's verdict);
 *   - `refusal` after the gate and before the charges, writing only while the gate
 *     holds NO token for this call, so a refusal and its record are one transaction
 *     (fix 3 E: the KV stamps are written after the batch and can fail alone);
 *   - the gate carries all three predicates, with the month's HARD limit and the
 *     site's cap as binds, not literals;
 *   - each charge carries the gate predicate and nothing else decides it;
 *   - a correction (refund or top-up) carries no ceiling: refusing a refund
 *     because the day is capped would leave the ledger permanently above the bill.
 *
 * HISTORY: WHAT THIS FILE HELD UNTIL 2026-10-28, kept because it is still the
 * reasoning.
 *
 * THE SPEC WAS SELF-CONTRADICTORY AND THIS RECORDED THE RESOLUTION. Task 2 of
 * CC-CMD-2026-09-18 said "All three in one env.DB.batch([...])" AND "Statement 3
 * runs only if statement 2 returned a row." Both cannot hold: a batch is
 * submitted as a unit, so nothing can read statement 2's result and then decide
 * whether to include statement 3. Obeying the second sentence means two round
 * trips and no transaction, which removes the only reason for the change.
 *
 * The resolution was the ORDER. Bump the site FIRST, reading the PRE-charge
 * total, then charge the day. Both carried the same ceiling predicate over the
 * same pre-charge value, so in one transaction they either both applied or
 * neither did. If a later edit reordered them -- charge first, then bump -- the
 * site statement would read the POST-charge total and the two would disagree by
 * `units` on every call at the boundary: a one-line change with no visible
 * symptom until a ceiling day, which is what B1 exists to catch.
 *
 * THE MONTH JOINED THE BATCH ON 2026-10-18
 * (docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md): five statements,
 * seed -> monthSeed -> site -> monthCharge -> charge. The same resolution applied,
 * for the same reason: monthCharge carried the DAY's predicate beside its own hard
 * limit and ran before charge, so it read the same PRE-charge day total as the
 * site did, and the month moved exactly when the day did. A bare `<= ?` could not
 * tell the day's predicate from the month's limit, so the month statement was
 * checked for both by text.
 *
 * What replaced it: the gate holds all three predicates in one statement, so there
 * is no longer a chain of statements that each copy the day's predicate and have
 * to be ordered against one another. The order that remains is gate before
 * charges. Each of B1-B9 below has its counterpart in this file's cases.
 *
 * READ-ONLY. Parses source text; runs no SQL and touches no database.
 */
import { readFileSync } from 'node:fs';

const SRC = process.env.BUDGET_HELPERS_SRC || 'src/budget-helpers.js';

/** The statements, in the order the batch submits them. */
export function batchOrder(src) {
  const m = src.match(/db\.batch\(\[([\s\S]*?)\]\)/);
  if (!m) return [];
  return [...m[1].matchAll(/ODDS_BUDGET_SQL\.(\w+)/g)].map(x => x[1]);
}

const norm = (sql) => String(sql || '').replace(/\s+/g, ' ').trim();

/** The snapshot and the gate run before every charge. A charge that ran first
 *  would change the totals the gate reads. */
export function decidesBeforeCharging(order) {
  const at = (k) => order.indexOf(k);
  const charges = ['siteCharge', 'monthCharge', 'charge'].map(at);
  if (charges.includes(-1) || at('snapshot') === -1 || at('gate') === -1) return false;
  return at('snapshot') < at('gate') && at('gate') < Math.min(...charges);
}

export const DAY_PREDICATE = '(SELECT used FROM odds_budget WHERE day = ?) + ? <= ?';
export const MONTH_PREDICATE = '(SELECT used FROM odds_budget_month WHERE month = ?) + ? <= ?';
export const SITE_PREDICATE = '(SELECT used FROM odds_budget_site WHERE day = ? AND site = ?) + ? <= ?';
export const GATE_PREDICATE = 'EXISTS (SELECT 1 FROM odds_budget_gate WHERE token = ?)';

/** The gate holds all three limits, each over a pre-charge total, and replaces the
 *  one gate row (an INSERT OR IGNORE would leave the first token there forever and
 *  every later call would be refused). */
export function gateCarriesAllThree(gateSql) {
  const g = norm(gateSql);
  return /^INSERT OR REPLACE INTO odds_budget_gate \(id, token\) SELECT 1, \? WHERE /.test(g)
      && g.includes(DAY_PREDICATE) && g.includes(MONTH_PREDICATE) && g.includes(SITE_PREDICATE);
}

/** Each of the three charges applies only on the gate's token. */
export function chargesObeyGate(...sqls) {
  return sqls.length === 3 && sqls.every((s) => norm(s).includes(GATE_PREDICATE));
}

/** None of the charges decides anything of its own: a limit comparison in a charge
 *  would be read over a total an earlier charge has already moved. */
export function chargesCarryNoLimit(...sqls) {
  return sqls.every((s) => !/<=\s*\?/.test(s));
}

/** A correction is not a charge: none of the three fix statements may carry a
 *  limit. A statement that could not be FOUND ('') is a failure, not a pass: an
 *  empty string has no ceiling, which is how this answered true for fixDay for
 *  its first day (its constant is single-quoted and the reader took only the
 *  backtick group). A literal limit counts as well as a bound one. */
export function correctionsUnguarded(fixDay, fixSite, fixMonth) {
  const stmts = [fixDay, fixSite, fixMonth];
  if (stmts.some((x) => typeof x !== 'string' || x.trim() === '')) return false;
  return stmts.every((x) => !/[<>]=?\s*[?\d]/.test(x));
}

/** The text of `const <k> = ...` from a source, whichever quote style it uses
 *  (the day's fix is single-quoted, the gate is a template literal), or '' when
 *  it is not there. */
export function pickSql(src, k) {
  const m = src.match(new RegExp(`${k}\\s*=\\s*\`([\\s\\S]*?)\`|${k}\\s*=\\s*'([^']*)'`));
  return m ? (m[1] ?? m[2] ?? '') : '';
}

/** The record is written after the gate has decided and before any charge. After
 *  a charge it would still be correct, but a position nobody asserted is a
 *  position the next edit moves it from; before the gate it would read no token. */
export function refusalAfterGate(order) {
  const at = (k) => order.indexOf(k);
  const charges = ['siteCharge', 'monthCharge', 'charge'].map(at);
  if (charges.includes(-1) || at('gate') === -1 || at('refusal') === -1) return false;
  return at('gate') < at('refusal') && at('refusal') < Math.min(...charges);
}

/** The record is one conditional upsert: it files a row only while the gate holds
 *  no token for THIS call, counts repeats, reads the scope back, and judges the
 *  day and the month by the gate's own comparison turned round. A record written
 *  unconditionally would file every admitted call as a refusal. */
export function refusalShape(sql) {
  const r = norm(sql);
  return /^INSERT INTO odds_budget_refusal \(day, scope, site, first_at, n\) SELECT /.test(r)
      && r.includes('WHERE NOT EXISTS (SELECT 1 FROM odds_budget_gate WHERE token = ?)')
      && r.includes('ON CONFLICT(day, scope, site) DO UPDATE SET n = n + 1')
      && /RETURNING scope$/.test(r)
      && r.includes("(SELECT used FROM odds_budget WHERE day = ?) + ? > ? THEN 'day'")
      && r.includes("(SELECT used FROM odds_budget_month WHERE month = ?) + ? > ? THEN 'month'")
      && r.indexOf("THEN 'day'") < r.indexOf("THEN 'month'") && r.indexOf("THEN 'month'") < r.indexOf("ELSE 'site'")
      && !/<=\s*\?/.test(r);
}

export const EXPECTED_ORDER = ['seed', 'monthSeed', 'siteSeed', 'snapshot', 'gate', 'refusal', 'siteCharge', 'monthCharge', 'charge'];

export function verdict(order, decides, gate3, obey, noLimit, corrections, recordAfter, recordShape) {
  if (order.length === 0)  return 'no-batch-found';
  if (order.length !== EXPECTED_ORDER.length) return `batch-has-${order.length}-statements`;
  if (!decides)            return 'a-charge-runs-before-the-gate';
  if (!recordAfter)        return 'the-refusal-is-not-between-the-gate-and-the-charges';
  if (!recordShape)        return 'the-refusal-record-is-not-conditional-on-the-gate';
  if (order.at(-1) !== 'charge') return 'charge-is-not-last';
  if (!gate3)              return 'the-gate-misses-a-limit';
  if (!obey)               return 'a-charge-ignores-the-gate';
  if (!noLimit)            return 'a-charge-decides-for-itself';
  if (!corrections)        return 'a-correction-carries-the-ceiling';
  return 'ok';
}

if (process.argv.includes('--self-test')) {
  let bad = 0, ran = 0;
  const one = (l, got, want, why) => { ran++;
    if (JSON.stringify(got) === JSON.stringify(want)) console.log(`  PASS  ${l} -> ${JSON.stringify(got)}  (${why})`);
    else { bad++; console.log(`  FAIL  ${l}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`); }
  };
  const OK = `db.batch([
      db.prepare(ODDS_BUDGET_SQL.seed).bind(a),
      db.prepare(ODDS_BUDGET_SQL.monthSeed).bind(b),
      db.prepare(ODDS_BUDGET_SQL.siteSeed).bind(c),
      db.prepare(ODDS_BUDGET_SQL.snapshot).bind(c),
      db.prepare(ODDS_BUDGET_SQL.gate).bind(c),
      db.prepare(ODDS_BUDGET_SQL.refusal).bind(c),
      db.prepare(ODDS_BUDGET_SQL.siteCharge).bind(c),
      db.prepare(ODDS_BUDGET_SQL.monthCharge).bind(d),
      db.prepare(ODDS_BUDGET_SQL.charge).bind(e),
  ])`;
  const E = EXPECTED_ORDER;
  one('the order is read from the batch', batchOrder(OK), E, 'from the call, not from a comment claiming it');
  one('snapshot, then gate, then the charges', decidesBeforeCharging(E), true, 'the shipped order');
  one('B1 A CHARGE BEFORE THE GATE IS CAUGHT',
      decidesBeforeCharging(['seed','monthSeed','siteSeed','snapshot','siteCharge','gate','monthCharge','charge']), false,
      'the gate would read the POST-charge site total: the site is charged on a call the gate then refuses');
  one('the snapshot after the gate is caught',
      decidesBeforeCharging(['seed','monthSeed','siteSeed','gate','snapshot','siteCharge','monthCharge','charge']), false,
      'the snapshot would name the veto from totals the gate had not yet seen change');
  one('a batch with no gate is caught', decidesBeforeCharging(['seed','monthSeed','siteSeed','snapshot','siteCharge','monthCharge','charge']), false,
      'nothing would decide');
  one('no batch at all is a failure', verdict([], true, true, true, true, true, true, true), 'no-batch-found',
      'a renamed helper must not read as clean (an empty result is a failure)');
  one('a five-statement batch is caught', verdict(['seed','monthSeed','site','monthCharge','charge'], true, true, true, true, true, true, true), 'batch-has-5-statements',
      'the pre-gate shape back: a veto by one limit would charge the others');
  one('a three-statement batch is caught', verdict(['seed','site','charge'], true, true, true, true, true, true, true), 'batch-has-3-statements',
      'the split shape: the month in a second batch that a stop can separate from the first');

  const GATE = `INSERT OR REPLACE INTO odds_budget_gate (id, token)
           SELECT 1, ?
            WHERE (SELECT used FROM odds_budget WHERE day = ?) + ? <= ?
              AND (SELECT used FROM odds_budget_month WHERE month = ?) + ? <= ?
              AND (SELECT used FROM odds_budget_site WHERE day = ? AND site = ?) + ? <= ?`;
  one('the gate carries the day, the month and the site', gateCarriesAllThree(GATE), true, 'the shipped form');
  one('B2 A GATE WITHOUT THE SITE IS CAUGHT', gateCarriesAllThree(GATE.replace(SITE_PREDICATE, '1 = 1')), false,
      'the per-site cap would never bind');
  one('B3 A GATE WITHOUT THE MONTH IS CAUGHT', gateCarriesAllThree(GATE.replace(MONTH_PREDICATE, '1 = 1')), false,
      'the 85,000 hard limit would stop binding');
  one('B4 A GATE WITHOUT THE DAY IS CAUGHT', gateCarriesAllThree(GATE.replace(DAY_PREDICATE, '1 = 1')), false,
      'the 3,800 ceiling would stop binding');
  one('B5 A GATE THAT IGNORES A DUPLICATE TOKEN IS CAUGHT', gateCarriesAllThree(GATE.replace('OR REPLACE', 'OR IGNORE')), false,
      'the first token would stay in the row and every later call would be refused');

  // THE REFUSAL RECORD (fix 3 E).
  one('the refusal sits after the gate and before every charge', refusalAfterGate(E), true, 'the shipped order');
  one('R1 A REFUSAL BEFORE THE GATE IS CAUGHT',
      refusalAfterGate(['seed','monthSeed','siteSeed','snapshot','refusal','gate','siteCharge','monthCharge','charge']), false,
      'it would read the PREVIOUS call\'s token and file this call as a refusal or not at random');
  one('R2 A REFUSAL AFTER A CHARGE IS CAUGHT',
      refusalAfterGate(['seed','monthSeed','siteSeed','snapshot','gate','siteCharge','refusal','monthCharge','charge']), false,
      'a position nobody asserted is a position the next edit moves it from');
  one('a batch with no refusal statement is caught',
      refusalAfterGate(['seed','monthSeed','siteSeed','snapshot','gate','siteCharge','monthCharge','charge']), false,
      'a refusal would be decided and not recorded: fix 3 E back');
  const REFUSAL = `INSERT INTO odds_budget_refusal (day, scope, site, first_at, n)
           SELECT ?, CASE WHEN (SELECT used FROM odds_budget WHERE day = ?) + ? > ? THEN 'day'
                          WHEN (SELECT used FROM odds_budget_month WHERE month = ?) + ? > ? THEN 'month'
                          ELSE 'site' END,
                  ?, ?, 1
            WHERE NOT EXISTS (SELECT 1 FROM odds_budget_gate WHERE token = ?)
           ON CONFLICT(day, scope, site) DO UPDATE SET n = n + 1
           RETURNING scope`;
  one('the refusal record is one conditional upsert', refusalShape(REFUSAL), true, 'the shipped form');
  one('R3 A RECORD WRITTEN ON EVERY CALL IS CAUGHT', refusalShape(REFUSAL.replace('WHERE NOT EXISTS', 'WHERE EXISTS')), false,
      'every admitted call would be filed as a refusal');
  one('R4 A RECORD WITH NO CONDITION IS CAUGHT',
      refusalShape(REFUSAL.replace('WHERE NOT EXISTS (SELECT 1 FROM odds_budget_gate WHERE token = ?)', 'WHERE 1 = 1')), false,
      'the same, and the token bind would be one short');
  one('R5 A RECORD THAT DOES NOT COUNT REPEATS IS CAUGHT', refusalShape(REFUSAL.replace('n = n + 1', 'n = 1')), false,
      'a caller retried 40 times would read as refused once');
  one('R6 A RECORD THAT DOES NOT READ ITS SCOPE BACK IS CAUGHT', refusalShape(REFUSAL.replace(/\s+RETURNING scope/, '')), false,
      'chargeOdds could not compare the record with the reason, and the second refusal of a day would return nothing');
  const DAY_WHEN = "WHEN (SELECT used FROM odds_budget WHERE day = ?) + ? > ? THEN 'day'";
  const MONTH_WHEN = "WHEN (SELECT used FROM odds_budget_month WHERE month = ?) + ? > ? THEN 'month'";
  one('R7 A MONTH ASKED BEFORE THE DAY IS CAUGHT',
      refusalShape(REFUSAL.replace(DAY_WHEN, '@@').replace(MONTH_WHEN, DAY_WHEN).replace('@@', MONTH_WHEN)), false,
      'a day veto would be filed as a month veto');
  one('...and swapping the labels alone is caught too', refusalShape(REFUSAL.replace("THEN 'day'", "THEN 'TMP'").replace("THEN 'month'", "THEN 'day'").replace("THEN 'TMP'", "THEN 'month'")), false,
      'the day predicate would file under the month');
  one('R8 A RECORD THAT USES THE GATE\'S COMPARISON IS CAUGHT', refusalShape(REFUSAL.replace('+ ? > ? THEN \'day\'', '+ ? <= ? THEN \'day\'')), false,
      'it would file a day veto for a call the day had room for');

  const SITE_CHARGE = `UPDATE odds_budget_site SET used = used + ? WHERE day = ? AND site = ? AND ${GATE_PREDICATE}`;
  const MONTH_CHARGE = `UPDATE odds_budget_month SET used = used + ? WHERE month = ? AND ${GATE_PREDICATE} RETURNING used`;
  const CHARGE = `UPDATE odds_budget SET used = used + ? WHERE day = ? AND ${GATE_PREDICATE} RETURNING used`;
  one('each charge obeys the gate', chargesObeyGate(SITE_CHARGE, MONTH_CHARGE, CHARGE), true, 'the shipped form');
  one('B6 A SITE CHARGE THAT IGNORES THE GATE IS CAUGHT',
      chargesObeyGate(SITE_CHARGE.replace(GATE_PREDICATE, '? IS NOT NULL'), MONTH_CHARGE, CHARGE), false,
      'a refused call would still move the site');
  one('B7 A MONTH CHARGE THAT IGNORES THE GATE IS CAUGHT',
      chargesObeyGate(SITE_CHARGE, MONTH_CHARGE.replace(GATE_PREDICATE, '? IS NOT NULL'), CHARGE), false,
      'a refused call would still move the month');
  one('B8 A DAY CHARGE THAT IGNORES THE GATE IS CAUGHT',
      chargesObeyGate(SITE_CHARGE, MONTH_CHARGE, CHARGE.replace(GATE_PREDICATE, '? IS NOT NULL')), false,
      'a refused call would still move the day, and RETURNING would call it charged');
  one('a charge with its own limit is caught', chargesCarryNoLimit(SITE_CHARGE, MONTH_CHARGE, CHARGE + ' AND used + ? <= ?'), false,
      'it would compare a total an earlier charge has already moved');
  one('charges with no limit of their own pass', chargesCarryNoLimit(SITE_CHARGE, MONTH_CHARGE, CHARGE), true, 'the shipped form');

  const FD = 'UPDATE odds_budget SET used = MAX(0, used + ?) WHERE day = ?';
  const FS = 'INSERT INTO odds_budget_site (day, site, used) VALUES (?, ?, MAX(0, ?)) ON CONFLICT(day, site) DO UPDATE SET used = MAX(0, used + ?)';
  const FM = 'UPDATE odds_budget_month SET used = MAX(0, used + ?) WHERE month = ?';
  one('corrections carry no ceiling', correctionsUnguarded(FD, FS, FM), true,
      'a refund must land on a capped day or the ledger stays above the bill');
  one('B9 A CEILING ON THE DAY CORRECTION IS CAUGHT', correctionsUnguarded(FD + ' AND used + ? <= ?', FS, FM), false,
      'refusing a refund because the day is capped leaves the ledger permanently high');
  one('A CEILING ON THE SITE CORRECTION IS CAUGHT', correctionsUnguarded(FD, FS + ' WHERE used + ? <= ?', FM), false, 'the same, for the site');
  one('A CEILING ON THE MONTH CORRECTION IS CAUGHT', correctionsUnguarded(FD, FS, FM + ' AND used + ? <= 85000'), false,
      'it had no assertion at all');
  one('A LITERAL CEILING IS CAUGHT TOO', correctionsUnguarded(FD + ' AND used + 3 <= 3800', FS, FM), false, 'a bound placeholder is not the only spelling');
  one('A CORRECTION THAT IS NOT FOUND IS A FAILURE', correctionsUnguarded('', FS, FM), false,
      "'' has no ceiling in it: the day's correction was never read at all and the check said true");
  one('...for the month too', correctionsUnguarded(FD, FS, ''), false, 'the same');
  const SRCX = "const A_BACKTICK = `SELECT 1 WHERE x = ?`;\nconst B_QUOTED = 'UPDATE t SET used = MAX(0, used + ?)';";
  one('pickSql reads a template literal', pickSql(SRCX, 'A_BACKTICK'), 'SELECT 1 WHERE x = ?', 'the gate form');
  one('pickSql reads a single-quoted constant', pickSql(SRCX, 'B_QUOTED'), 'UPDATE t SET used = MAX(0, used + ?)', "the day's fix form, which the old reader returned '' for");
  one('pickSql returns nothing for a constant that is not there', pickSql(SRCX, 'C_MISSING'), '', 'so the callers above can tell');

  // THE LINES ABOVE TEST THE PREDICATES, NOT THE BRANCHES THAT USE THEM.
  // A predicate nobody consults is the same as no predicate, so verdict() is asked
  // what it does with each one.
  one('verdict ACTS on a charge before the gate', verdict(E, false, true, true, true, true, true, true), 'a-charge-runs-before-the-gate', 'the branch, not the predicate');
  one('verdict ACTS on a charge that is not last', verdict(['seed','monthSeed','siteSeed','snapshot','gate','refusal','siteCharge','charge','monthCharge'], true, true, true, true, true, true, true),
      'charge-is-not-last', 'chargedFromBatch reads the LAST statement as the verdict');
  one('verdict ACTS on a refusal outside the gate-to-charges window', verdict(E, true, true, true, true, true, false, true), 'the-refusal-is-not-between-the-gate-and-the-charges', 'the branch, not the predicate');
  one('verdict ACTS on an unconditional refusal record', verdict(E, true, true, true, true, true, true, false), 'the-refusal-record-is-not-conditional-on-the-gate', 'the branch, not the predicate');
  one('verdict ACTS on a gate that misses a limit', verdict(E, true, false, true, true, true, true, true), 'the-gate-misses-a-limit', 'the branch, not the predicate');
  one('verdict ACTS on a charge that ignores the gate', verdict(E, true, true, false, true, true, true, true), 'a-charge-ignores-the-gate', 'the branch, not the predicate');
  one('verdict ACTS on a charge that decides for itself', verdict(E, true, true, true, false, true, true, true), 'a-charge-decides-for-itself', 'the branch, not the predicate');
  one('verdict ACTS on a ceilinged correction', verdict(E, true, true, true, true, false, true, true), 'a-correction-carries-the-ceiling', 'the branch, not the predicate');
  one('all of them together pass', verdict(E, true, true, true, true, true, true, true), 'ok', 'the shipped state');

  // COUNTED, not written down: a literal here is a denominator that goes
  // quietly wrong the first time an assertion is added (Rule 91).
  console.log(bad ? `\n${bad} FAILED of ${ran}` : `\nself-test: ${ran}/${ran}`);
  console.log('COVERAGE: pure predicates over the SQL and the batch order. It');
  console.log('does NOT execute SQL, reach D1, or verify that the statements are');
  console.log('atomic. scripts/check-odds-site-caps.mjs runs the real chargeOdds');
  console.log("against a reference model; batch() transactionality is Cloudflare's.");
  process.exit(bad ? 1 : 0);
}

const whole = readFileSync(SRC, 'utf8');

// SCOPED TO THE CHARGER'S BODY. batchOrder takes the FIRST db.batch([...]) it
// finds, and on 2026-09-23 chargeMonthlyOdds added a second one ABOVE the daily
// guard in this file. The gate then read the month's two-statement batch and
// reported `batch-has-2-statements` about a function that still had three.
//
// STRUCTURAL, NOT BY NAME: is there exactly ONE batch in the slice?
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
const pick = (k) => pickSql(src, k);
const order = batchOrder(guardBody);
const decides = decidesBeforeCharging(order);
const gate3 = gateCarriesAllThree(pick('SQL_GATE'));
const obey = chargesObeyGate(pick('SQL_SITE_CHARGE'), pick('SQL_MONTH_CHARGE'), pick('SQL_CHARGE'));
const noLimit = chargesCarryNoLimit(pick('SQL_SITE_CHARGE'), pick('SQL_MONTH_CHARGE'), pick('SQL_CHARGE'));
const corrections = correctionsUnguarded(pick('SQL_FIX_DAY'), pick('SQL_FIX_SITE'), pick('SQL_FIX_MONTH'));
const recordAfter = refusalAfterGate(order);
const recordShape = refusalShape(pick('SQL_REFUSAL'));
const v = verdict(order, decides, gate3, obey, noLimit, corrections, recordAfter, recordShape);

console.log('=== the odds budget batch ===\n');
console.log(`  batch order              : ${order.join(' -> ') || '(no batch found)'}`);
console.log(`  decides before charging  : ${decides}`);
console.log(`  charge is last           : ${order.at(-1) === 'charge'}`);
console.log(`  refusal after the gate   : ${recordAfter}`);
console.log(`  refusal is conditional   : ${recordShape}`);
console.log(`  the gate holds 3 limits  : ${gate3}`);
console.log(`  charges obey the gate    : ${obey}`);
console.log(`  charges decide nothing   : ${noLimit}`);
console.log(`  corrections unceilinged  : ${corrections}`);
console.log(`\n  verdict: ${v}`);
console.log(`\nCOVERAGE: the batch in ${SRC} — its order and the shape of its statements.`);
console.log('It does NOT execute SQL or reach D1; check-odds-site-caps.mjs does the first,');
console.log("and whether batch() is one transaction is Cloudflare's guarantee.");

if (v !== 'ok') {
  console.log(`\nFAIL: ${v}`);
  if (v === 'a-charge-runs-before-the-gate')
    console.log('      The gate decides over the PRE-charge totals. A charge that runs first\n      changes what the gate reads, and a refused call would still move a counter.');
  process.exit(1);
}
console.log('\nOK: seed -> monthSeed -> siteSeed -> snapshot -> gate -> refusal -> siteCharge -> monthCharge -> charge; the gate holds the day, the month and the site, the refusal is filed only without the gate\'s token, the charges obey it, corrections do not.');
