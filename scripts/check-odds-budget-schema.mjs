#!/usr/bin/env node
/**
 * Two invariants on the Task 1 schema, both from defects Task 0b found by
 * reading the route rather than assuming it.
 *
 * 1. THE TABLES ARE ON ARCHIVE_DB. The CC-CMD specified `DB` (field-d1).
 *    wrangler.toml gives `DB` and `WC2026_DB` the same database_id, so `DB` IS
 *    the World Cup database; `env.DB` has four references in the whole worker,
 *    all Whoop OAuth tokens; every other runtime CREATE TABLE is on ARCHIVE_DB;
 *    and odds_history and odds_backfill_progress already live there. A later
 *    session reading the CC-CMD rather than the code would move them back.
 *
 * 2. THE TABLES ARE READABLE FROM CI. /d1/execute rejects any table outside
 *    ALLOWED_TABLES with a 403 — and a 403 reads identically to a D1 failure
 *    from outside, so a probe against an unlisted table reports a database
 *    property it never measured. That is not hypothetical: it is why Task 0b
 *    could not run as written.
 *
 * Both are read from source, from the two places that would actually diverge.
 * READ-ONLY.
 */
import { readFileSync } from 'node:fs';

const HELPERS = 'src/budget-helpers.js';
const INDEX   = 'src/index.js';

/** Table names the schema function creates, read from its DDL. */
export function declaredTables(src) {
  const fn = src.slice(src.indexOf('async function ensureOddsBudgetTables'));
  if (!fn) return [];
  const body = fn.slice(0, fn.indexOf('\n}'));
  return [...body.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)].map(m => m[1]);
}

/** The binding the schema function prepares against. */
export function bindingUsed(src) {
  const i = src.indexOf('async function ensureOddsBudgetTables');
  if (i < 0) return null;
  const body = src.slice(i, i + src.slice(i).indexOf('\n}'));
  const hits = [...new Set([...body.matchAll(/env\.([A-Z_0-9]+)\s*\.\s*(?:prepare|batch)/g)].map(m => m[1]))];
  return hits.length === 1 ? hits[0] : (hits.length === 0 ? null : `AMBIGUOUS:${hits.join('+')}`);
}

/** The /d1/execute allow-list. */
export function allowedTables(src) {
  const m = src.match(/const ALLOWED_TABLES = \[([^\]]*)\]/);
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : [];
}

export function verdict(declared, binding, allowed) {
  if (!declared.length)          return 'no-schema-found';
  if (!binding)                  return 'no-binding-found';
  if (binding.startsWith('AMB')) return 'ambiguous-binding';
  if (binding !== 'ARCHIVE_DB')  return 'wrong-binding';
  const missing = declared.filter(t => !allowed.includes(t));
  if (missing.length)            return 'not-readable-from-ci';
  return 'ok';
}

if (process.argv.includes('--self-test')) {
  let bad = 0;
  const one = (l, got, want, why) => {
    if (JSON.stringify(got) === JSON.stringify(want)) console.log(`  PASS  ${l} -> ${JSON.stringify(got)}  (${why})`);
    else { bad++; console.log(`  FAIL  ${l}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`); }
  };
  const SRC = `async function ensureOddsBudgetTables(env) {
    await env.ARCHIVE_DB.batch([
        env.ARCHIVE_DB.prepare(\`CREATE TABLE IF NOT EXISTS odds_budget (day TEXT)\`),
        env.ARCHIVE_DB.prepare(\`CREATE TABLE IF NOT EXISTS odds_budget_site (day TEXT)\`),
    ]);
}`;
  one('both tables are found', declaredTables(SRC), ['odds_budget', 'odds_budget_site'], 'read from the DDL, not from a second hardcoded list');
  one('the binding is read', bindingUsed(SRC), 'ARCHIVE_DB', 'from the prepare/batch call, not from a comment');
  // THE FIXTURE ABOVE DECLARES THE TWO REAL NAMES, so a parser that ignored the
  // source and returned a hardcoded ['odds_budget','odds_budget_site'] would
  // satisfy it. Mutation S6 did exactly that and the suite stayed green. This
  // fixture uses names that appear nowhere in the product, so only a parser
  // actually reading the DDL can answer it.
  const OTHER = SRC.replace(/odds_budget_site/g, 'zzz_second').replace(/odds_budget/g, 'zzz_first');
  one('THE TABLES ARE READ FROM THE DDL, NOT REMEMBERED',
      declaredTables(OTHER), ['zzz_first', 'zzz_second'],
      'S6: a hardcoded list would return the product names here and be wrong');

  const WRONG = SRC.replace(/ARCHIVE_DB/g, 'DB');
  one('DB IS CAUGHT', verdict(declaredTables(WRONG), bindingUsed(WRONG), ['odds_budget','odds_budget_site']), 'wrong-binding',
      'the CC-CMD specified DB; DB and WC2026_DB share a database_id, so that is the World Cup database');

  const MIXED = SRC.replace('env.ARCHIVE_DB.prepare(`CREATE TABLE IF NOT EXISTS odds_budget_site', 'env.DB.prepare(`CREATE TABLE IF NOT EXISTS odds_budget_site');
  one('a SPLIT across two databases is caught', bindingUsed(MIXED).startsWith('AMBIGUOUS'), true,
      'one table in each database is worse than both in the wrong one — the batch would not be a transaction');

  one('a table missing from the allow-list fails',
      verdict(['odds_budget','odds_budget_site'], 'ARCHIVE_DB', ['odds_budget']), 'not-readable-from-ci',
      'a 403 from /d1/execute reads like a D1 failure, which is how Task 0b was blocked');
  one('...and it must be BOTH, not either',
      verdict(['odds_budget','odds_budget_site'], 'ARCHIVE_DB', ['odds_budget_site']), 'not-readable-from-ci',
      'checking only the first table would pass with the second unlisted');
  one('all present passes', verdict(['odds_budget','odds_budget_site'], 'ARCHIVE_DB', ['x','odds_budget','odds_budget_site']), 'ok',
      'extra entries in the allow-list are none of this check\'s business');

  one('NO SCHEMA IS A FAILURE, NOT A PASS', verdict([], 'ARCHIVE_DB', []), 'no-schema-found',
      'if the function is renamed or deleted, an empty result must not read as clean');
  one('no binding is its own state', verdict(['odds_budget'], null, ['odds_budget']), 'no-binding-found', 'skipped and verified are different words');

  one('the allow-list parser reads a real-shaped array',
      allowedTables("const ALLOWED_TABLES = ['a', 'b', 'c'];"), ['a','b','c'], 'the shape in src/index.js');
  one('...and an absent array yields nothing, which fails above',
      allowedTables('const OTHER = [1,2];'), [], 'an unparsable allow-list must not look like a permissive one');

  console.log(bad ? `\n${bad} FAILED` : '\nself-test: 12/12');
  console.log('COVERAGE: four pure parsers over source text. It does NOT connect to D1,');
  console.log('and it cannot tell whether the tables actually exist in the database.');
  process.exit(bad ? 1 : 0);
}

const helpers = readFileSync(HELPERS, 'utf8');
const index   = readFileSync(INDEX, 'utf8');
const declared = declaredTables(helpers);
const binding  = bindingUsed(helpers);
const allowed  = allowedTables(index);
const v = verdict(declared, binding, allowed);

console.log('=== odds budget schema ===\n');
console.log(`  declared tables : ${declared.join(', ') || '(none)'}`);
console.log(`  binding         : ${binding || '(none)'}`);
console.log(`  in ALLOWED_TABLES: ${declared.filter(t => allowed.includes(t)).length} of ${declared.length}`);
console.log(`\n  verdict: ${v}`);
console.log(`\nCOVERAGE: source text in ${HELPERS} and ${INDEX}. It asserts the schema is on`);
console.log('ARCHIVE_DB and readable through /d1/execute. It does NOT connect to D1 and');
console.log('cannot say whether the tables exist yet — they are created lazily on first use.');

if (v !== 'ok') {
  console.log(`\nFAIL: ${v}`);
  if (v === 'wrong-binding') {
    console.log('      The CC-CMD says `DB (field-d1)`. That is wrong: wrangler.toml gives DB');
    console.log('      and WC2026_DB the same database_id, env.DB has 4 references (all Whoop');
    console.log('      OAuth tokens), and every other runtime CREATE TABLE is on ARCHIVE_DB.');
  }
  if (v === 'not-readable-from-ci') {
    console.log(`      Missing from ALLOWED_TABLES: ${declared.filter(t => !allowed.includes(t)).join(', ')}`);
    console.log('      /d1/execute returns 403 for these, which reads like a D1 failure.');
  }
  process.exit(1);
}
console.log(`\nOK: ${declared.length} table(s) on ARCHIVE_DB, all readable from CI.`);
