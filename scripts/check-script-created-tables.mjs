// EVERY TABLE A SCRIPT CREATES MUST BE ON THE /d1/execute ALLOW-LIST.
//
// WHY THIS EXISTS, measured 2026-09-23.
//
// scripts/targeted-odds-fill.mjs was given a `CREATE TABLE IF NOT EXISTS
// odds_fill_dead_pairs`. Its first dry run died at the first statement:
//
//   Error: d1 HTTP 403: {"ok":false,"error":"table not allowed",
//                        "table":"odds_fill_dead_pairs"}
//
// The guard was right. The table was not on ALLOWED_TABLES in src/index.js, and
// nothing said so until a runner tried it.
//
// check-odds-budget-schema.mjs already exists for exactly this failure — its own
// header says "a 403 reads identically to a D1 failure from outside, so a probe
// against an unlisted table reports a database property it never measured". But
// it reads the DDL out of `ensureOddsBudgetTables` in src/budget-helpers.js, so
// its denominator is the tables the WORKER creates. A table created by a SCRIPT
// is outside it, and that is the one that failed.
//
// Same shape as sync-adhd-skill.mjs holding two siblings while the drift check
// watched three: a gate whose denominator is narrower than the thing it guards.
// This closes the other half rather than widening that gate, whose scope is
// documented and whose self-test is about the budget schema specifically.
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const { allowedTables } = createRequire(import.meta.url)('./lib/allowed-tables.cjs');

const INDEX = process.env.INDEX_SRC || 'src/index.js';
const DIR = process.env.SCRIPTS_DIR || 'scripts';

// FILES WHOSE DDL IS A TEST FIXTURE, NOT A TABLE. An entry here is not an
// excuse — the reason is written down, the same rule declared-detectors.json
// carries — and the self-test asserts the set is actually honoured.
//
// Both were found by the first live run, which reported seven tables that do
// not exist: foo, a, b, Mixed, t1, t2, ignored (this file's own fixtures) and
// t (d1-write-sites.mjs:139, the string `CREATE TABLE IF NOT EXISTS t (a)` fed
// to its isWrite() assertion). A scanner reading its own test data is the
// source-versus-copy substitution, in the scanner.
export const FIXTURE_FILES = new Set([
  'check-script-created-tables.mjs',  // this file's own self-test fixtures
  'd1-write-sites.mjs',               // line 139: a DDL literal passed to isWrite()
]);

/** Every `CREATE TABLE IF NOT EXISTS <name>` in a source string. */
export function createdTables(src) {
  return [...String(src).matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)].map(m => m[1]);
}

/** {table -> [files]} across every script that creates one. */
export function scanScripts(dir, readdir, readfile) {
  const found = new Map();
  // THIS FILE IS EXCLUDED FROM ITS OWN SCAN. Its self-test fixtures are DDL
  // string literals, so the first live run reported foo, a, b, Mixed, t1, t2
  // and ignored as unlisted tables — seven findings manufactured by the
  // scanner reading itself.
  for (const f of readdir(dir).filter(n => /\.(mjs|cjs|js)$/.test(n) && !FIXTURE_FILES.has(n))) {
    let src;
    try { src = readfile(`${dir}/${f}`); } catch (_e) { continue; }
    for (const t of createdTables(src)) {
      if (!found.has(t)) found.set(t, []);
      if (!found.get(t).includes(f)) found.get(t).push(f);
    }
  }
  return found;
}

/** null when nothing is missing — never [], which reads as "checked, none". */
export function missingFrom(found, allowed) {
  if (!(found instanceof Map) || !Array.isArray(allowed)) return null;
  const miss = [...found.keys()].filter(t => !allowed.includes(t));
  return miss.length ? miss : [];
}

if (process.argv.includes('--self-test')) {
  let bad = 0;
  const eq = (l, g, w) => {
    if (JSON.stringify(g) === JSON.stringify(w)) console.log(`ok    ${l}`);
    else { bad++; console.log(`FAIL  ${l}\n        got  ${JSON.stringify(g)}\n        want ${JSON.stringify(w)}`); }
  };
  eq('a DDL string yields its table', createdTables('CREATE TABLE IF NOT EXISTS foo (a INT)'), ['foo']);
  eq('several in one file all count',
    createdTables('CREATE TABLE IF NOT EXISTS a (x)\n...\nCREATE TABLE IF NOT EXISTS b (y)'), ['a', 'b']);
  eq('case does not hide one', createdTables('create table if not exists Mixed (x)'), ['Mixed']);
  eq('a file with no DDL yields nothing', createdTables('const x = 1;'), []);
  // A plain CREATE TABLE without IF NOT EXISTS is deliberately NOT matched: the
  // allow-list regex in src/index.js has the same shape, so matching more here
  // than the guard does would report a table the guard never rejects.
  eq('a bare CREATE TABLE is not claimed', createdTables('CREATE TABLE foo (a INT)'), []);

  const rd = () => ['a.mjs', 'b.mjs', 'notes.md'];
  const rf = (p) => p.endsWith('a.mjs') ? 'CREATE TABLE IF NOT EXISTS t1 (x)'
                  : p.endsWith('b.mjs') ? 'CREATE TABLE IF NOT EXISTS t1 (x)\nCREATE TABLE IF NOT EXISTS t2 (y)'
                  : 'CREATE TABLE IF NOT EXISTS ignored (z)';
  const found = scanScripts('d', rd, rf);
  eq('one table found in two files is reported once, with both',
    found.get('t1'), ['a.mjs', 'b.mjs']);
  eq('a non-script file is not scanned', found.has('ignored'), false);
  eq('THE FAILURE THIS EXISTS FOR: an unlisted table is named',
    missingFrom(found, ['t1']), ['t2']);
  eq('everything listed yields an empty miss list', missingFrom(found, ['t1', 't2']), []);
  eq('an unreadable allow-list yields null, not a clean bill',
    missingFrom(found, null), null);

  // THE FIXTURE SET IS HONOURED, asserted rather than assumed. Listing a file
  // and then not skipping it would report tables that do not exist, which is
  // how this scanner's first run produced seven of them.
  eq('a fixture file is not scanned',
    scanScripts('d', () => ['d1-write-sites.mjs', 'real.mjs'],
      (p) => p.endsWith('real.mjs') ? 'CREATE TABLE IF NOT EXISTS kept (x)'
                                    : 'CREATE TABLE IF NOT EXISTS t (a)').has('t'), false);
  eq('...while a real one still is',
    scanScripts('d', () => ['d1-write-sites.mjs', 'real.mjs'],
      (p) => p.endsWith('real.mjs') ? 'CREATE TABLE IF NOT EXISTS kept (x)'
                                    : 'CREATE TABLE IF NOT EXISTS t (a)').has('kept'), true);

  // THE APOSTROPHE REGRESSION. A comment inside the array containing `403'd`
  // opened a quote that closed on the next apostrophe, so the real fourteenth
  // table was never parsed and a prose fragment took its place — while the
  // gate reading it printed OK.
  eq('a comment inside the allow-list cannot inject a table name',
    allowedTables("const ALLOWED_TABLES = ['a', 'b',\n  // it 403'd here — the guard working\n  'c'];"),
    ['a', 'b', 'c']);
  eq('...and a block comment cannot either',
    allowedTables("const ALLOWED_TABLES = ['a', /* don't parse 'this' */ 'b'];"), ['a', 'b']);
  console.log(`\n${bad ? `${bad} FAILED` : 'self-test: 14/14'}`);
  console.log('COVERAGE: two pure parsers over source text. It does NOT connect to D1 and');
  console.log('cannot say whether a listed table actually exists.');
  process.exit(bad ? 1 : 0);
}

const allowed = allowedTables(readFileSync(INDEX, 'utf8'));
const found = scanScripts(DIR, (d) => readdirSync(d), (p) => readFileSync(p, 'utf8'));
const missing = missingFrom(found, allowed);

console.log('=== tables created by scripts ===\n');
for (const [t, files] of [...found.entries()].sort()) {
  console.log(`  ${allowed.includes(t) ? 'listed  ' : 'MISSING '} ${t.padEnd(26)} ${files.join(', ')}`);
}
console.log(`\nCOVERAGE: ${found.size} table(s) created across ${DIR}/, checked against the`);
console.log(`${allowed.length}-entry ALLOWED_TABLES in ${INDEX}. It does NOT connect to D1.`);

if (missing === null) {
  console.log('\nNOT RUN — the allow-list could not be read. Not a pass (Rule 99).');
  process.exit(1);
}
if (missing.length) {
  console.log(`\nFAIL: ${missing.length} table(s) missing from ALLOWED_TABLES: ${missing.join(', ')}`);
  console.log('      /d1/execute returns 403 for these, which from outside reads exactly');
  console.log('      like a D1 failure — the script dies on its first statement.');
  process.exit(1);
}
console.log(`\nOK: all ${found.size} script-created table(s) are on the allow-list.`);
