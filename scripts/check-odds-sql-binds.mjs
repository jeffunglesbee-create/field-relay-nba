#!/usr/bin/env node
/**
 * EVERY REFERENCE TO AN ODDS BUDGET STATEMENT NAMES A STATEMENT THAT EXISTS, AND
 * BINDS EXACTLY AS MANY VALUES AS THE STATEMENT HAS PLACEHOLDERS.
 *
 * Found by the review of Task 3 (docs/CC-CMD-2026-09-16-odds-spend-attribution.md),
 * not by any gate: POST /debug/odds-budget-latency still prepared
 * ODDS_BUDGET_SQL.site, which that change had removed, with the five-statement
 * batch's bind lists. `undefined` is not an error until the route runs, the route
 * is dispatch-only, and none of the twenty odds checks executes it, so it would
 * have shipped answering 500. Every consumer of the shared statement object is
 * exposed to the same thing whenever a statement is renamed, split or re-bound.
 *
 * WHAT IT READS. The keys of `export const ODDS_BUDGET_SQL = { ... }` in
 * src/budget-helpers.js and the text of each SQL constant they name. Then every
 * `ODDS_BUDGET_SQL.<key>` in the files it is given (default: every .js file under
 * src/ and workers/). A key that is not in the object fails. A
 * `.prepare(ODDS_BUDGET_SQL.<key>).bind(...)` whose argument count differs from the
 * statement's `?` count fails; so does a statement with placeholders that is
 * prepared and never bound.
 *
 * WHAT IT CANNOT SEE. A bind list built in a variable (`.bind(...args)`), a
 * statement fetched from the object by a computed key, and whether the VALUES are
 * the right ones: scripts/check-odds-site-caps.mjs runs chargeOdds for that.
 * Rule 91: the run prints how many references it read in how many files.
 *
 * Mutations: scripts/mutate-odds-sql-binds.mjs (Rule 90).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const HELPERS = process.env.BUDGET_HELPERS_SRC || 'src/budget-helpers.js';

/** The keys of the ODDS_BUDGET_SQL object, each with the constant it points at. */
export function statementKeys(helpersSrc) {
  const m = helpersSrc.match(/export const ODDS_BUDGET_SQL\s*=\s*\{([\s\S]*?)\};/);
  if (!m) return null;
  const out = {};
  for (const e of m[1].matchAll(/(\w+)\s*:\s*(SQL_\w+)/g)) out[e[1]] = e[2];
  return out;
}

/** The text of `const NAME = ...` whichever quote style it uses, or null. */
export function constantText(src, name) {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*(?:\`([\\s\\S]*?)\`|'([^']*)')`));
  return m ? (m[1] ?? m[2] ?? '') : null;
}

/** Split call arguments at top-level commas: parentheses, brackets, braces and
 *  quotes nest. Returns the arguments, [] for an empty list. */
export function splitArgs(text) {
  const args = [];
  let depth = 0, cur = '', quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      cur += c;
      if (c === '\\') { cur += text[++i] ?? ''; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') args.push(cur.trim());
  return args;
}

/** The text between the parentheses opened at `open` (index of '('), or null. */
function balanced(text, open) {
  let depth = 0, quote = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(') depth++;
    if (c === ')' && --depth === 0) return { inner: text.slice(open + 1, i), end: i };
  }
  return null;
}

/** The source with its comments blanked and its line structure kept. A comment may
 *  name a statement that no longer exists (src/budget-helpers.js records the ones
 *  Task 3 replaced, on purpose); only code is a reference. Strings are walked, so a
 *  `//` inside 'https://...' does not start a comment. */
export function stripComments(text) {
  let out = '', quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += text[++i] ?? ''; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { if (text[i] === '\n') out += '\n'; i++; }
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

/** Every `ODDS_BUDGET_SQL.<key>` in a source, each with its bind count: the number
 *  of arguments of an immediately following `.bind(...)`, 0 when it is not bound
 *  there, and null when the bind list cannot be counted (a spread). */
export function references(source) {
  const text = stripComments(source);
  const out = [];
  for (const m of text.matchAll(/ODDS_BUDGET_SQL\.(\w+)/g)) {
    const key = m[1];
    let binds = 0;
    // `.prepare(ODDS_BUDGET_SQL.key)` closes with ')' and `.bind(` follows it.
    const rest = text.slice(m.index + m[0].length);
    const call = rest.match(/^\s*\)\s*\.bind\s*\(/);
    if (call) {
      const open = m.index + m[0].length + call[0].length - 1;
      const b = balanced(text, open);
      const args = b ? splitArgs(b.inner) : null;
      binds = args === null || args.some((a) => a.startsWith('...')) ? null : args.length;
    }
    out.push({ key, binds, line: text.slice(0, m.index).split('\n').length });
  }
  return out;
}

/** Problems: a missing key, or an arity that differs from the placeholder count. */
export function problems(refs, keys, helpersSrc) {
  const out = [];
  for (const r of refs) {
    if (!(r.key in keys)) { out.push(`line ${r.line}: ODDS_BUDGET_SQL.${r.key} is not a key of the object (it resolves to undefined)`); continue; }
    const sql = constantText(helpersSrc, keys[r.key]);
    if (sql === null) { out.push(`line ${r.line}: ${keys[r.key]} (ODDS_BUDGET_SQL.${r.key}) was not found in ${HELPERS}`); continue; }
    const want = (sql.match(/\?/g) || []).length;
    if (r.binds === null) continue;                    // a spread: not countable here
    if (r.binds !== want) out.push(`line ${r.line}: ODDS_BUDGET_SQL.${r.key} has ${want} placeholder(s) and is bound with ${r.binds}`);
  }
  return out;
}

function filesUnder(dir) {
  let out = [];
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n.startsWith('.')) continue;                    // the mutation harness's .mutant-* copies
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) out = out.concat(filesUnder(p));
    else if (/\.(js|mjs)$/.test(n)) out.push(p);
  }
  return out;
}

if (process.argv.includes('--self-test')) {
  let bad = 0, n = 0;
  const one = (label, got, want, why) => {
    n++;
    if (JSON.stringify(got) === JSON.stringify(want)) console.log(`  PASS  ${label}  (${why})`);
    else { bad++; console.log(`  FAIL  ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}  (${why})`); }
  };
  const H = "const SQL_A = 'SELECT 1 WHERE x = ? AND y = ?';\nconst SQL_B = `UPDATE t SET a = ?`;\nconst SQL_C = 'SELECT 1';\n"
          + 'export const ODDS_BUDGET_SQL = { a: SQL_A, b: SQL_B,\n                                 c: SQL_C };';
  const keys = statementKeys(H);
  one('the object keys are read, across lines', keys, { a: 'SQL_A', b: 'SQL_B', c: 'SQL_C' }, 'a key on the second line of the literal is still a key');
  one('both quote styles are read', [constantText(H, 'SQL_A'), constantText(H, 'SQL_B')], ['SELECT 1 WHERE x = ? AND y = ?', 'UPDATE t SET a = ?'],
      "the day's fix is single-quoted and the gate is a template literal");
  one('a constant that is not there is null', constantText(H, 'SQL_Z'), null, 'so a key pointing at nothing is reported');
  one('top-level commas only', splitArgs("day.slice('a,b'.length), site, [1, 2], {a: 1, b: 2}, f(x, y)"),
      ["day.slice('a,b'.length)", 'site', '[1, 2]', '{a: 1, b: 2}', 'f(x, y)'], 'nested calls, strings, arrays and objects do not split');
  one('an empty list is no arguments', splitArgs(''), [], 'bind() binds nothing');

  const P = (src) => problems(references(src), keys, H);
  one('a correct bind passes', P('db.prepare(ODDS_BUDGET_SQL.a).bind(x, y)'), [], 'two placeholders, two values');
  one('a nested-call bind is counted whole', P("db.prepare(ODDS_BUDGET_SQL.a).bind(day.slice('odds:daily:'.length), f(1, 2))"), [], 'the commas inside the calls are not argument separators');
  one('a bind that spans lines is counted', P('db.prepare(ODDS_BUDGET_SQL.a).bind(\n  x,\n  y,\n)'), [], 'a trailing comma is not an argument');
  one('A MISSING KEY IS CAUGHT', P('db.prepare(ODDS_BUDGET_SQL.site).bind(x, y)').length, 1,
      'the debug route used ODDS_BUDGET_SQL.site after the change removed it');
  one('TOO MANY BINDS ARE CAUGHT', P('db.prepare(ODDS_BUDGET_SQL.a).bind(x, y, z)').length, 1, 'the five-statement bind lists on the eight-statement SQL');
  one('TOO FEW BINDS ARE CAUGHT', P('db.prepare(ODDS_BUDGET_SQL.a).bind(x)').length, 1, 'a missing bind is NULL in a ceiling predicate, which reads as a veto');
  one('A STATEMENT WITH PLACEHOLDERS THAT IS NEVER BOUND IS CAUGHT', P('db.prepare(ODDS_BUDGET_SQL.b)').length, 1, 'one placeholder, no bind');
  one('a statement with no placeholder and no bind passes', P('db.prepare(ODDS_BUDGET_SQL.c)'), [], 'nothing to bind');
  one('a spread bind is not counted, and is not an error', P('db.prepare(ODDS_BUDGET_SQL.a).bind(...args)'), [], 'a limit of this check, stated in its header');
  one('a key whose constant is gone is caught',
      problems(references('db.prepare(ODDS_BUDGET_SQL.z).bind()'), { z: 'SQL_GONE' }, H).length, 1, 'the object names a constant that does not exist');
  one('a reference in a comment is not a reference', P('// ODDS_BUDGET_SQL.site, replaced\n/* and ODDS_BUDGET_SQL.old\n  too */\ndb.prepare(ODDS_BUDGET_SQL.a).bind(x, y)'), [],
      'the history block in budget-helpers.js names the removed key on purpose');
  one('a // inside a string does not start a comment', P("fetch('https://x.test/y'); db.prepare(ODDS_BUDGET_SQL.nope).bind(1)").length, 1,
      'a URL on the same line must not hide the reference after it');
  one('lines are kept when comments are blanked', references('// c\n/* a\nb */\nODDS_BUDGET_SQL.a').map((r) => r.line), [4], 'the line is what a failure prints');
  one('every reference in a source is read, with its line',
      references('x\nODDS_BUDGET_SQL.a\ny ODDS_BUDGET_SQL.c').map((r) => [r.key, r.line]), [['a', 2], ['c', 3]], 'the line is what a failure prints');

  console.log(bad ? `\n${bad} FAILED of ${n}` : `\nself-test: ${n}/${n}`);
  console.log('COVERAGE: the parsers on synthetic sources. It does not read src/ (the live run does).');
  process.exit(bad ? 1 : 0);
}

const helpersSrc = readFileSync(HELPERS, 'utf8');
const keys = statementKeys(helpersSrc);
if (!keys || Object.keys(keys).length === 0) {
  console.log(`FAIL: no ODDS_BUDGET_SQL object found in ${HELPERS} — nothing below was checked.`);
  process.exit(1);
}
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = args.length ? args : [...filesUnder('src'), ...filesUnder('workers')];
let total = 0, filesWith = 0, failed = 0;
for (const f of files) {
  const text = f === HELPERS ? helpersSrc : readFileSync(f, 'utf8');
  const refs = references(text);
  if (refs.length === 0) continue;
  filesWith++; total += refs.length;
  for (const p of problems(refs, keys, helpersSrc)) { failed++; console.log(`FAIL  ${f}: ${p}`); }
}
console.log(`ODDS_BUDGET_SQL keys: ${Object.keys(keys).join(', ')}`);
console.log(`\nCOVERAGE: ${total} reference(s) to ODDS_BUDGET_SQL read in ${filesWith} of ${files.length} file(s); a spread bind list is not counted; comments are not read.`);
if (total === 0) { console.log('FAIL: no references found at all — the pattern no longer matches how the code is written.'); process.exit(1); }
if (failed) { console.log(`\nFAIL: ${failed} reference(s) do not match the statements.`); process.exit(1); }
console.log('\nOK: every reference names a statement that exists and binds as many values as it has placeholders.');
