#!/usr/bin/env node
// Every guarded odds call must name itself, or the daily total goes back to
// being one opaque number.
//
// Measured 2026-09-16: the provider billed 3,557/day and the split could only
// be obtained because the BACKFILL happens to record its own credits in D1 —
// 1.1% backfill, 98.9% everything else. AmbientDO's polling, its closing
// capture and the WP resolver were indistinguishable. A per-consumer ceiling
// cannot be specced against a number nobody can decompose.
//
// SCOPE: (consumeOddsCredit|_consumeAmbientOddsCredit)\(
// check-odds-calls-guarded.mjs NAMES the guards in its own predicates and
// mutate-odds-attribution.mjs quotes call sites as anchors; neither makes a
// guarded call. Excluded by name rather than by the list quietly being
// shorter than the population.
// SCOPE-EXCLUDES: scripts/check-odds-calls-guarded.mjs scripts/mutate-odds-attribution.mjs
// The three guard wrappers live in these three files and nowhere else; a fourth
// would be a new implementation, which check-odds-calls-guarded.mjs governs.
const FILES = ['src/index.js', 'src/ambient-do.js', 'src/wp-resolver.js'];

import { readFileSync } from 'node:fs';

const SELF = process.argv.includes('--self-test');

// A REGEX CANNOT DO THIS, and the first version proved it: it matched the guard
// DEFINITIONS as if they were calls, and `buildUrl('')` broke its lazy match, so
// it reported two false unnamed sites and two of its own cases failed. Scan
// paren depth instead — deterministic, and nesting is exactly what it handles.
const GUARDS = ['consumeOddsCredit', '_consumeAmbientOddsCredit'];

/** Top-level arguments of each guard CALL (definitions excluded). */
export function guardCalls(src) {
  const out = [];
  for (const g of GUARDS) {
    let i = -1;
    while ((i = src.indexOf(g + '(', i + 1)) !== -1) {
      const before = src.slice(Math.max(0, i - 24), i);
      // A `function` test used to sit here to skip the guard DEFINITIONS. The
      // await requirement below subsumes it — a definition is never preceded by
      // `await ` — so it became dead the moment await was required, and its
      // mutation could not be made to fail. Removed rather than kept as
      // defensive code with an uncatchable test (Rule 90's corollary).
      // MUST BE AWAITED, which also excludes the three prose mentions that the
      // previous version reported as unnamed call sites. Not merely a filter: an
      // un-awaited guard returns a PROMISE, which is truthy, so `if (!(await…))`
      // written without the await never blocks and the ceiling stops existing.
      if (!/await\s+$/.test(before)) continue;
      let depth = 0, j = i + g.length, args = [], cur = '';
      for (; j < src.length; j++) {
        const c = src[j];
        if (c === '(') { depth++; if (depth === 1) continue; }
        else if (c === ')') { depth--; if (depth === 0) { args.push(cur); break; } }
        else if (c === ',' && depth === 1) { args.push(cur); cur = ''; continue; }
        cur += c;
      }
      out.push({ guard: g, args: args.map(a => a.trim()) });
    }
  }
  return out;
}

export function unnamedCalls(name, src) {
  return guardCalls(src)
    .filter(c => !/^'[a-zA-Z][a-zA-Z0-9_]*'$/.test(c.args[2] || ''))
    .map(c => `${name}: ${c.guard}(${(c.args[2] ?? '<missing>')}) — third argument is not a site literal`);
}

/** The names a call site uses must be declared, or by_site silently grows keys
 *  that /budget/odds never reports and the sum quietly stops matching. */
export function undeclaredSites(callSrc, helperSrc) {
  const declared = new Set(
    [...(helperSrc.match(/const KNOWN_SITES = \[([\s\S]*?)\]/)?.[1] || '')
      .matchAll(/'([^']+)'/g)].map(m => m[1]));
  const used = guardCalls(callSrc)
    .map(c => (c.args[2] || '').match(/^'([a-zA-Z][a-zA-Z0-9_]*)'$/)?.[1])
    .filter(Boolean);
  return [...new Set(used)].filter(s => !declared.has(s))
    .map(s => `'${s}' is passed but not in KNOWN_SITES`);
}

if (SELF) {
  let bad = 0;
  const one = (label, got, want, why) => got === want
    ? console.log(`  PASS  ${label} = ${got}  (${why})`)
    : (bad++, console.log(`  FAIL  ${label}: got ${got} want ${want}  (${why})`));

  one('a named call', unnamedCalls('t', "await consumeOddsCredit(env, oddsCreditCost(u), 'siteA')").length, 0, 'has a literal');
  one('an unnamed call', unnamedCalls('t', "await consumeOddsCredit(env, oddsCreditCost(u))").length, 1, 'the shape before 2026-09-16');
  one('a this.env call', unnamedCalls('t', "await _consumeAmbientOddsCredit(this.env, oddsCreditCost(u))").length, 1, 'AmbientDO uses this.env');
  one('a VARIABLE site', unnamedCalls('t', "await consumeOddsCredit(env, cost, siteVar)").length, 1,
      'a variable writes an unpredictable key — absence in a different costume');
  one('a prose mention', unnamedCalls('t', "// consumeOddsCredit() shares the KV key").length, 0,
      'a comment is not a call — three of these were reported as defects');
  one('an un-awaited call', unnamedCalls('t', "consumeOddsCredit(env, cost, 'siteA')").length, 0,
      'not counted here: it is not a guarded call at all until it is awaited');
  one('declared site', undeclaredSites("await consumeOddsCredit(env, c, 'siteA')", "const KNOWN_SITES = ['siteA']").length, 0, 'in the list');
  one('undeclared site', undeclaredSites("await consumeOddsCredit(env, c, 'siteZ')", "const KNOWN_SITES = ['siteA']").length, 1,
      'by_site would grow a key /budget/odds never reports');

  console.log(bad ? `\n${bad} FAILED` : `\nself-test: 8/8`);
  console.log(`COVERAGE: the two predicates. Does not read the repo.`);
  process.exit(bad ? 1 : 0);
}

const helper = readFileSync('src/budget-helpers.js', 'utf8');
let problems = [], named = 0;
console.log(`=== odds spend attribution ===\n`);
for (const f of FILES) {
  const src = readFileSync(f, 'utf8');
  const bad = unnamedCalls(f, src);
  const n = guardCalls(src).length - bad.length;
  named += n;
  problems.push(...bad, ...undeclaredSites(src, helper).map(x => `${f}: ${x}`));
  console.log(`  ${f.padEnd(22)} ${n} named, ${bad.length} unnamed`);
}
console.log(`\n  guarded call sites naming themselves : ${named}`);
console.log(`  problems                             : ${problems.length}`);
for (const p of problems) console.log(`  FAIL  ${p}`);

console.log(`\nCOVERAGE: ${FILES.length} files, the only three holding a guard wrapper.`);
console.log(`It checks that a call NAMES itself — not that the name is the right one,`);
console.log(`and not that the KV write succeeded. /budget/odds reports by_site_sum and`);
console.log(`unaccounted separately so a divergence is visible rather than inferred.`);
console.log(problems.length ? `\n${problems.length} FAILED` : `\nevery guarded odds call names itself`);
process.exit(problems.length ? 1 : 0);
