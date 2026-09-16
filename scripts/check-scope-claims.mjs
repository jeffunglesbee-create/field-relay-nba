#!/usr/bin/env node
// A claim wider than its scope is the defect class this session kept finding.
//
// Two real liars, both passing green today:
//
//   check-odds-calls-guarded.mjs prints "every odds call is charged to the
//   monthly ledger" and reads exactly three files under src/. Every CI script
//   that spends real money is outside its denominator.
//
//   .github/scripts/odds-backfill.js says
//   `const DAILY_CEILING = 2700;  // global shared across all FIELD odds usage`
//   It is a module-local constant decremented in-process and reset every run.
//   Not global, not shared, not persistent.
//
// Neither is a bug in what the code DOES. Both are a bug in what it SAYS about
// its own reach, which is the only kind of defect that survives a passing test:
// the check is correct, the sentence is not, and only the sentence is read.
//
// TWO RULES, both mechanical:
//
//   R1  a script that claims "every X" while reading a hardcoded file list must
//       declare the population that list is drawn from, as `// SCOPE: <glob>`,
//       and either cover it or name each omission in `// SCOPE-EXCLUDES:`.
//
//   R2  a constant whose comment claims to be shared or global must actually be
//       exported. A "global shared" value nothing can import is a local.
//
// --self-test runs both rules against synthetic sources and needs no repo.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SELF = process.argv.includes('--self-test');

// A claim about reach. Deliberately NOT every use of the word "every" — "every
// one of them sends us" is prose about a third party, not a scope claim.
const CLAIM = /\b(every|all)\s+[a-z][a-z0-9 -]{2,40}\b(?=[^.\n]*\b(is|are|must|charged|checked|scanned|covered|accounted|reconciled)\b)/i;
const FILE_LIST = /^const\s+(FILES|TARGETS|SOURCES|PATHS)\s*=\s*\[([^\]]*)\]/m;
const SCOPE_DECL = /^\/\/\s*SCOPE:\s*(.+)$/m;
const SCOPE_EXCL = /^\/\/\s*SCOPE-EXCLUDES:\s*(.+)$/m;

/** R1. Returns a list of problems for one source file. */
export function scopeProblems(name, src) {
  const out = [];
  const list = FILE_LIST.exec(src);
  if (!list) return out;                       // no hardcoded list, rule N/A
  if (!CLAIM.test(src)) return out;            // no reach claim, rule N/A
  if (!SCOPE_DECL.test(src)) {
    out.push(`${name}: claims a scope over a hardcoded ${list[1]} list but declares no // SCOPE:`);
  }
  return out;
}

/** R2. A comment claiming shared/global reach on a constant that is not exported. */
export function sharedConstProblems(name, src) {
  const out = [];
  // SAME LINE ONLY. [^;]+ spans newlines, so a multi-line const swallowed the
  // prose after it and three of five hits on the first live run were comments
  // that belonged to nothing — check-imports-resolve's SRC "matched" a sentence
  // about globals two paragraphs down. A check that cries wolf gets ignored,
  // which is how odds-backfill went fifteen days unnoticed.
  const re = /^(export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*=\s*[^;\n]+;[ \t]*\/\/(.*)$/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, exported, ident, comment = ''] = m;
    if (!/\b(global|shared|across all|every consumer|repo-wide)\b/i.test(comment)) continue;
    if (exported) continue;
    out.push(`${name}: ${ident} claims "${comment.trim()}" but is not exported — nothing can share it`);
  }
  return out;
}

if (SELF) {
  let bad = 0;
  const ok = (m) => console.log(`  PASS  ${m}`);
  const no = (m) => { bad++; console.log(`  FAIL  ${m}`); };
  const one = (label, got, want, why) =>
    (got === want ? ok(`${label} = ${got}  (${why})`) : no(`${label}: got ${got} want ${want}  (${why})`));

  // ── R1 ────────────────────────────────────────────────────────────────────
  const listed = "const FILES = ['a.js', 'b.js'];\n";
  one('R1 claim + list, no SCOPE', scopeProblems('t', listed + 'console.log("every odds call is charged");').length, 1,
      'the shape of check-odds-calls-guarded today');
  one('R1 claim + list + SCOPE', scopeProblems('t', '// SCOPE: src/**/*.js\n' + listed + 'console.log("every odds call is charged");').length, 0,
      'a declared population satisfies it');
  one('R1 list, no claim', scopeProblems('t', listed + 'console.log("checked the three files");').length, 0,
      'no reach claim, rule does not apply');
  one('R1 claim, no list', scopeProblems('t', 'console.log("every odds call is charged");').length, 0,
      'a globbed script has no hardcoded denominator to declare');
  one('R1 prose "every"', scopeProblems('t', listed + 'console.log("every one of them sends us a header");').length, 0,
      'prose about a third party is not a scope claim');

  // ── R2 ────────────────────────────────────────────────────────────────────
  one('R2 local const claiming shared',
      sharedConstProblems('t', 'const DAILY_CEILING = 2700; // global shared across all FIELD odds usage').length, 1,
      'odds-backfill.js today');
  one('R2 exported const claiming shared',
      sharedConstProblems('t', 'export const DAILY_CEILING = 2700; // global shared across all usage').length, 0,
      'exported, so the claim is true');
  one('R2 local const, no claim',
      sharedConstProblems('t', 'const PER_CALL_COST = 20; // 10 cr x 2 markets').length, 0,
      'no reach claim, rule does not apply');
  one('R2 lowercase identifier',
      sharedConstProblems('t', 'const delay = 100; // shared').length, 0,
      'only SCREAMING_CASE constants are treated as declared config');
  one('R2 comment two lines below a multi-line const',
      sharedConstProblems('t', 'const SRC = [\n  "a.js",\n];\n// a global is not checked here\n').length, 0,
      'the first live run produced three of these — prose attached to nothing');
  one('R2 claim on the const ABOVE, not this one',
      sharedConstProblems('t', 'const CAP = 1; // shared across all\nconst OTHER = 2;\n').length, 1,
      'the claim belongs to A alone');

  console.log(bad ? `\n${bad} FAILED` : `\nself-test: 11/11`);
  console.log(`COVERAGE: both predicates against synthetic sources. Does not read the repo.`);
  process.exit(bad ? 1 : 0);
}

// ── live ────────────────────────────────────────────────────────────────────
const SKIP = new Set(['.git', 'node_modules', '.wrangler', 'dist', 'build', 'outbox']);
function walk(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue;
    const p = `${dir}/${n}`;
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(mjs|js)$/.test(n)) acc.push(p.replace(/^\.\//, ''));
  }
  return acc;
}

const files = walk('.');
const problems = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  problems.push(...scopeProblems(f, src), ...sharedConstProblems(f, src));
}

console.log(`=== scope claims  utc=${new Date().toISOString()} ===\n`);
console.log(`  files scanned                     : ${files.length}`);
console.log(`  claims wider than declared scope  : ${problems.length}\n`);
for (const p of problems) console.log(`  FAIL  ${p}`);

// The declared population is only useful if it is CHECKED, not merely present.
// For each script that declares one, glob it and report what the hardcoded list
// omits — the omission is the finding, and it must be named or absorbed.
let omissions = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const decl = SCOPE_DECL.exec(src);
  const list = FILE_LIST.exec(src);
  if (!decl || !list) continue;
  const declared = decl[1].trim();
  const listed = [...list[2].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]);
  const excluded = (SCOPE_EXCL.exec(src)?.[1] || '').split(/[,\s]+/).filter(Boolean);
  let population = [];
  try {
    population = execFileSync('bash', ['-lc', `git grep -lE ${JSON.stringify(declared)} -- '*.js' '*.mjs' || true`],
      { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch (_) { population = []; }
  const missing = population.filter(p => !listed.includes(p) && !excluded.includes(p) && p !== f);
  console.log(`\n  ${f}`);
  console.log(`      SCOPE            : ${declared}`);
  console.log(`      population       : ${population.length}`);
  console.log(`      in the list      : ${listed.length}`);
  console.log(`      declared excluded: ${excluded.length}`);
  if (missing.length) {
    omissions += missing.length;
    console.log(`      FAIL — in the population, in neither list:`);
    for (const m of missing) console.log(`          ${m}`);
  } else {
    console.log(`      every file in the population is listed or excluded by name`);
  }
}

const failed = problems.length + omissions;
console.log(`\nCOVERAGE: ${files.length} .js/.mjs files outside ${[...SKIP].join(', ')}.`);
console.log(`R1 fires only on a script that BOTH claims reach and hardcodes a list;`);
console.log(`a script that globs its own population is out of scope and unchecked here.`);
console.log(failed ? `\n${failed} FAILED` : `\nall scope claims match their declared population`);
process.exit(failed ? 1 : 0);
