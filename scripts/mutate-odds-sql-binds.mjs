#!/usr/bin/env node
/**
 * Rule 90 for scripts/check-odds-sql-binds.mjs.
 *
 * Each mutant breaks one reference to an odds budget statement in a COPY of the
 * source, written beside the original, and the check is pointed at the copy. A
 * mutant counts as caught only when the check printed a FAIL line and exited 1;
 * a crash proves nothing about what the check asserts. Anchors are asserted to
 * occur exactly once, so a mutation that applied nothing cannot pass for a catch.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';

const T = { helpers: 'src/budget-helpers.js', index: 'src/index.js' };
const originals = Object.fromEntries(Object.entries(T).map(([k, p]) => [k, readFileSync(p, 'utf8')]));
const born = [];
const place = (target, text, tag) => {
  const p = join(dirname(T[target]), `.mutant-${tag}-${Math.random().toString(36).slice(2, 8)}.js`);
  writeFileSync(p, text); born.push(p); return resolve(p);
};
process.on('exit', () => { for (const p of born) rmSync(p, { force: true }); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

// 'pass' | 'red' | 'error'
function run(helpers, files) {
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, ['scripts/check-odds-sql-binds.mjs', ...files],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BUDGET_HELPERS_SRC: helpers } });
  } catch (e) { out = String(e.stdout || ''); code = e.status ?? 1; }
  if (code === 0) return /^OK: /m.test(out) ? 'pass' : 'error';
  return code === 1 && /^FAIL  /m.test(out) ? 'red' : 'error';
}

const base = resolve(T.helpers);
if (run(base, [T.helpers, T.index]) !== 'pass') { console.log('FAIL — the check is already red on clean source.'); process.exit(1); }
const ch = place('helpers', originals.helpers, 'control'), ci = place('index', originals.index, 'control');
if (run(ch, [ch, ci]) !== 'pass') { console.log('FAIL — unmutated copies at the mutant location are red, so no verdict below would mean anything.'); process.exit(1); }
console.log('baseline: the check passes on current source and on unmutated copies at the mutant location\n');

const MUTANTS = [
  ['S1 a gate bind is dropped from chargeOdds', 'helpers',
   'ODDS_HARD_LIMIT, date, site, units, siteCeiling),', 'ODDS_HARD_LIMIT, date, site, units),'],
  ['S2 a bind is added to the day charge in chargeOdds', 'helpers',
   'db.prepare(ODDS_BUDGET_SQL.charge).bind(units, date, token),', 'db.prepare(ODDS_BUDGET_SQL.charge).bind(units, date, token, units),'],
  ['S3 a statement is removed from the shared object', 'helpers',
   'snapshot: SQL_SNAPSHOT,', ''],
  ['S4 a statement gains a placeholder the binds do not know', 'helpers',
   "const SQL_FIX_MONTH    = 'UPDATE odds_budget_month SET used = MAX(0, used + ?) WHERE month = ?';",
   "const SQL_FIX_MONTH    = 'UPDATE odds_budget_month SET used = MAX(0, used + ?) WHERE month = ? AND ? IS NOT NULL';"],
  ['S5 the debug route prepares a statement that no longer exists', 'index',
   'db.prepare(ODDS_BUDGET_SQL.siteSeed).bind(DAY, PROBE_SITE),', 'db.prepare(ODDS_BUDGET_SQL.site).bind(DAY, PROBE_SITE),'],
  ['S6 the debug route binds the old five-statement list', 'index',
   'db.prepare(ODDS_BUDGET_SQL.monthCharge).bind(1, MON, token),', 'db.prepare(ODDS_BUDGET_SQL.monthCharge).bind(1, MON, 1, MONTH_LIMIT, DAY, 1, CEILING),'],
  ['S7 reconcile\'s month correction is bound without its month', 'helpers',
   'db.prepare(ODDS_BUDGET_SQL.fixMonth).bind(out.delta, month.slice(\'odds:credits:\'.length)),', 'db.prepare(ODDS_BUDGET_SQL.fixMonth).bind(out.delta),'],
  ['S8 a statement is prepared and never bound', 'helpers',
   'db.prepare(ODDS_BUDGET_SQL.seed).bind(date, carried),', 'db.prepare(ODDS_BUDGET_SQL.seed),'],
];

let caught = 0, bad = 0;
for (const [name, target, anchor, repl] of MUTANTS) {
  const orig = originals[target];
  const hits = orig.split(anchor).length - 1;
  if (hits !== 1) { bad++; console.log(`NOTHING MUTATED  ${name}\n        the anchor occurs ${hits} times in ${T[target]}, not once`); continue; }
  const text = orig.replace(anchor, () => repl);
  if (text === orig) { bad++; console.log(`NOTHING MUTATED  ${name}`); continue; }
  const copy = place(target, text, name.slice(0, 2));
  // The mutated copy replaces its original in the scan; the other file is the control copy.
  const v = target === 'helpers' ? run(copy, [copy, ci]) : run(ch, [ch, copy]);
  console.log(`${v === 'red' ? 'CAUGHT    ' : v === 'pass' ? 'NOT CAUGHT' : 'HARNESS ERROR'}  ${name}`);
  if (v === 'red') caught++; else bad++;
}
console.log(`\n${caught} of ${MUTANTS.length} mutations caught.`);
console.log('COVERAGE: eight single-reference mutations of copies of src/budget-helpers.js and src/index.js; the');
console.log('check reads both. It does not mutate src/ambient-do.js or workers/, which hold no reference today.');
process.exit(bad ? 1 : 0);
