#!/usr/bin/env node
/**
 * Rule 90 for check-odds-budget-schema.mjs.
 *
 * S1 and S4 are the ones to keep. S1 lets the CC-CMD's own (wrong) `DB`
 * instruction back in; S4 lets an empty parse read as clean, which is how a
 * renamed function would silently disarm the whole check.
 *
 * Each mutation asserts its anchor is unique and applied before reporting.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const F = 'scripts/check-odds-budget-schema.mjs';
const green = () => { try { execFileSync(process.execPath, [F, '--self-test'], { stdio: 'pipe' }); return true; } catch { return false; } };

try { execFileSync('git', ['diff', '--quiet', '--', F], { stdio: 'pipe' }); }
catch { console.log(`FAIL — ${F} has unstaged changes.`); process.exit(1); }
if (!green()) { console.log(`FAIL — ${F} --self-test already red on clean source.`); process.exit(1); }
console.log(`baseline: ${F} --self-test passes on clean source\n`);

const MUTATIONS = [
  ['S1 any binding is accepted',
   "  if (binding !== 'ARCHIVE_DB')  return 'wrong-binding';",
   "  if (!binding)  return 'wrong-binding';",
   'THE CC-CMD SAYS `DB`. With this, a session following the document rather than the code puts the odds budget in the World Cup database and the check agrees'],

  ['S2 the allow-list is not checked',
   "  const missing = declared.filter(t => !allowed.includes(t));\n  if (missing.length)            return 'not-readable-from-ci';",
   "  const missing = [];\n  if (missing.length)            return 'not-readable-from-ci';",
   'the tables become invisible to CI again — a 403 that reads like a D1 failure, which is exactly how Task 0b was blocked'],

  ['S3 one table listed is enough',
   "  const missing = declared.filter(t => !allowed.includes(t));",
   "  const missing = declared.some(t => allowed.includes(t)) ? [] : declared;",
   'odds_budget listed and odds_budget_site not would pass, so half the schema stays unreadable'],

  ['S4 an empty parse reads as clean',
   "  if (!declared.length)          return 'no-schema-found';",
   "  if (!declared.length)          return 'ok';",
   'rename or delete ensureOddsBudgetTables and the check goes green on nothing (an empty result is a failure, not a pass)'],

  ['S5 a split across two databases passes',
   "  return hits.length === 1 ? hits[0] : (hits.length === 0 ? null : `AMBIGUOUS:${hits.join('+')}`);",
   "  return hits[0] || null;",
   'one table in each database reports the first binding and passes — and that batch would not be a transaction, which is the entire point of Task 2'],

  ['S6 the DDL is not where tables are read from',
   "  return [...body.matchAll(/CREATE TABLE IF NOT EXISTS\\s+(\\w+)/g)].map(m => m[1]);",
   "  return ['odds_budget', 'odds_budget_site'];",
   'the check compares a hardcoded list to itself and stops seeing the source'],
];

const original = readFileSync(F, 'utf8');
let caught = 0;
for (const [name, anchor, repl, why] of MUTATIONS) {
  const hits = original.split(anchor).length - 1;
  if (hits !== 1) { console.log(`FAIL       ${name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`); continue; }
  writeFileSync(F, original.replace(anchor, repl));
  const red = !green();
  writeFileSync(F, original);
  console.log(`${red ? 'CAUGHT    ' : 'NOT CAUGHT'} ${name}\n            (${why})`);
  if (red) caught++;
}
console.log(`\n${caught} of ${MUTATIONS.length} mutations caught.`);
console.log('COVERAGE: the four parsers and the verdict, via --self-test. It does NOT');
console.log('re-run the live scan of src/budget-helpers.js or src/index.js.');
process.exit(caught === MUTATIONS.length ? 0 : 1);
