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
//
// THIS FILE ALSO SCANS reconcileOddsCredit as of 2026-09-16, and its population
// is the same three files by construction: the equality it asserts is between
// the guard and the reconcile IN THE SAME FILE, so a reconcile living where no
// guard does is out of its reach. check-odds-reconciled.mjs owns that direction
// — every charging function must also reconcile — and declares reconcile as its
// own SCOPE. Two checks, one boundary each, neither restating the other.
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
// reconcileOddsCredit runs AFTER the fetch and corrects the pre-charge by the
// provider's real receipt. It takes the site as its FOURTH argument where the
// guard takes it third, which is the whole reason this scanner is parameterised
// rather than copied: a second copy is how the two name sets diverged.
const RECONCILE = ['reconcileOddsCredit'];
const SITE_ARG = { guard: 2, reconcile: 3 };

/** Top-level arguments of each CALL to one of `names` (definitions excluded). */
export function callsOf(src, names) {
  const out = [];
  for (const g of names) {
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

export const guardCalls     = (src) => callsOf(src, GUARDS);
export const reconcileCalls = (src) => callsOf(src, RECONCILE);

const isSiteLiteral = (a) => /^'[a-zA-Z][a-zA-Z0-9_]*'$/.test(a || '');
const siteNames = (calls, idx) => [...new Set(
  calls.map(c => (c.args[idx] || '').match(/^'([a-zA-Z][a-zA-Z0-9_]*)'$/)?.[1]).filter(Boolean))];

export function unnamedCalls(name, src) {
  const i = SITE_ARG.guard;
  return guardCalls(src)
    .filter(c => !isSiteLiteral(c.args[i]))
    .map(c => `${name}: ${c.guard}(${(c.args[i] ?? '<missing>')}) — third argument is not a site literal`);
}

/** A reconcile call that does not name itself writes its correction to
 *  odds:site:unattributed:* while the guard charged a named site — the split
 *  then drifts in BOTH directions at once. */
export function unnamedReconciles(name, src) {
  const i = SITE_ARG.reconcile;
  return reconcileCalls(src)
    .filter(c => !isSiteLiteral(c.args[i]))
    .map(c => `${name}: reconcileOddsCredit(${(c.args[i] ?? '<missing>')}) — fourth argument is not a site literal`);
}

/** THE DEFECT THIS FILE EXISTS FOR AS OF 2026-09-16. The guard and the
 *  reconcile in the same file must name the same set of consumers. Four of nine
 *  did not — 'ambientFetchLiveOdds' vs '_fetchLiveOdds' and three more — so the
 *  correction could never be applied to the counter it was correcting. */
export function vocabularyMismatch(name, src) {
  const g = siteNames(guardCalls(src), SITE_ARG.guard).sort();
  const r = siteNames(reconcileCalls(src), SITE_ARG.reconcile).sort();
  const only = (a, b, which) => a.filter(x => !b.includes(x))
    .map(x => `${name}: '${x}' is named by the ${which} but not by the other half`);
  return [...only(g, r, 'guard'), ...only(r, g, 'reconcile')];
}

/** The names a call site uses must be declared, or by_site silently grows keys
 *  that /budget/odds never reports and the sum quietly stops matching. */
export function undeclaredSites(callSrc, helperSrc) {
  const declared = new Set(
    [...(helperSrc.match(/export const ODDS_SITES = \[([\s\S]*?)\]/)?.[1] || '')
      .matchAll(/'([^']+)'/g)].map(m => m[1]));
  const used = [
    ...siteNames(guardCalls(callSrc), SITE_ARG.guard),
    ...siteNames(reconcileCalls(callSrc), SITE_ARG.reconcile),
  ];
  return [...new Set(used)].filter(s => !declared.has(s))
    .map(s => `'${s}' is passed but not in ODDS_SITES`);
}

/** reconcile must actually WRITE the site counter. Renaming the literals so the
 *  two halves agree changes nothing on its own if the correction still only
 *  reaches odds:daily:* and odds:credits:*. Structural, in the helper. */
export function reconcileSkipsSiteKey(helperSrc) {
  const body = helperSrc.slice(helperSrc.indexOf('export async function reconcileOddsCredit'));
  // LINE-ANCHORED, NOT A SUBSTRING. The first version tested the whole body with
  // a regex and passed on `// await _bumpSite(env, site, out.delta);` — mutation
  // A11 commented the call out and the check did not notice, which is the exact
  // failure Rule 90 exists to surface: an assertion that had only ever passed.
  const live = body.split('\n')
    .map(l => l.trim())
    .some(l => l.startsWith('await _bumpSite(env, site, out.delta)'));
  return live
    ? []
    : ['src/budget-helpers.js: reconcileOddsCredit does not apply its delta to the site counter'];
}

/** The site counter takes a NEGATIVE delta now, so its write must clamp. An
 *  unclamped read-modify-write that loses a race publishes a site total lower
 *  than what that site actually spent — spend erased rather than merely
 *  unattributed, which is the worse of the two. */
export function siteCounterUnclamped(helperSrc) {
  const body = helperSrc.slice(helperSrc.indexOf('async function _bumpSite'));
  const put = body.split('\n').find(l => l.includes('FIELD_JOURNALISM.put(')) || '';
  return /String\(Math\.max\(0, cur \+ units\)\)/.test(put)
    ? []
    : ['src/budget-helpers.js: _bumpSite writes a site counter without clamping at zero'];
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
  one('declared site', undeclaredSites("await consumeOddsCredit(env, c, 'siteA')", "export const ODDS_SITES = ['siteA']").length, 0, 'in the list');
  one('undeclared site', undeclaredSites("await consumeOddsCredit(env, c, 'siteZ')", "export const ODDS_SITES = ['siteA']").length, 1,
      'by_site would grow a key /budget/odds never reports');
  one('undeclared RECONCILE site', undeclaredSites("await reconcileOddsCredit(env, c, r, 'siteZ')", "export const ODDS_SITES = ['siteA']").length, 1,
      'the correction would land on a key nothing reads');

  // The four-of-nine defect, as cases.
  const PAIRED = "await consumeOddsCredit(env, c, 'siteA'); await reconcileOddsCredit(env, c, r, 'siteA')";
  const SPLIT  = "await consumeOddsCredit(env, c, 'siteA'); await reconcileOddsCredit(env, c, r, 'siteB')";
  one('matched vocabulary', vocabularyMismatch('t', PAIRED).length, 0, 'one name for one consumer');
  one('split vocabulary', vocabularyMismatch('t', SPLIT).length, 2,
      'two valid names for one consumer — named by each half, reported from both sides');
  // THREE OF THE FOUR REAL DIVERGENCES were not merely different names, they
  // were names this file does not accept as literals at all: '_fetchLiveOdds',
  // '_captureClosingOdds', 'odds-proxy', 'wp-resolver:fetchSportOddsLive'. Those
  // fall to unnamedReconciles rather than to the mismatch predicate, and the
  // distinction matters because only the second one can be read as intentional.
  one('a leading-underscore reconcile name', unnamedReconciles('t', "await reconcileOddsCredit(env, c, r, '_fetchLiveOdds')").length, 1,
      'the literal that shipped in ambient-do.js');
  one('a hyphenated reconcile name', unnamedReconciles('t', "await reconcileOddsCredit(env, c, r, 'odds-proxy')").length, 1,
      'the literal that shipped in index.js — _siteKey() keeps the hyphen, so it named a key no reader lists');
  one('a reconcile with no literal', unnamedReconciles('t', "await reconcileOddsCredit(env, c, r, siteVar)").length, 1,
      'a variable writes an unpredictable key');
  one('a named reconcile', unnamedReconciles('t', "await reconcileOddsCredit(env, c, r, 'siteA')").length, 0, 'has a literal');
  one('reconcile wired to the site key', reconcileSkipsSiteKey(
      "export async function reconcileOddsCredit(env, e, r, site) {\n  await _bumpSite(env, site, out.delta);\n}").length, 0,
      'a bare statement on its own line — the shape the source has, and what the anchor requires');
  one('reconcile skipping the site key', reconcileSkipsSiteKey(
      "export async function reconcileOddsCredit(env, e, r, site) { for (const key of [day, month]) {} }").length, 1,
      'the shape before 2026-09-16: correction reaches daily and monthly only');
  one('reconcile with the call COMMENTED OUT', reconcileSkipsSiteKey(
      "export async function reconcileOddsCredit(env, e, r, site) {\n  // await _bumpSite(env, site, out.delta);\n}").length, 1,
      'mutation A11 — the substring version passed on this and proved nothing');
  one('a clamped site write', siteCounterUnclamped(
      "async function _bumpSite(env, site, units) {\n  await env.FIELD_JOURNALISM.put(key, String(Math.max(0, cur + units)), {});\n}").length, 0, 'clamped');
  one('an unclamped site write', siteCounterUnclamped(
      "async function _bumpSite(env, site, units) {\n  await env.FIELD_JOURNALISM.put(key, String(cur + units), {});\n}").length, 1,
      'a negative delta could drive the counter below zero and erase real spend');

  console.log(bad ? `\n${bad} FAILED` : `\nself-test: 20/20`);
  console.log(`COVERAGE: 6 predicates on synthetic sources. Does not read the repo.`);
  process.exit(bad ? 1 : 0);
}

const helper = readFileSync('src/budget-helpers.js', 'utf8');
let problems = [], named = 0;
console.log(`=== odds spend attribution ===\n`);
let reconciled = 0;
for (const f of FILES) {
  const src = readFileSync(f, 'utf8');
  const bad = unnamedCalls(f, src);
  const badR = unnamedReconciles(f, src);
  const n  = guardCalls(src).length - bad.length;
  const nr = reconcileCalls(src).length - badR.length;
  named += n; reconciled += nr;
  problems.push(...bad, ...badR,
    ...vocabularyMismatch(f, src),
    ...undeclaredSites(src, helper).map(x => `${f}: ${x}`));
  console.log(`  ${f.padEnd(22)} guard ${n} named / ${bad.length} unnamed   reconcile ${nr} named / ${badR.length} unnamed`);
}
problems.push(...reconcileSkipsSiteKey(helper), ...siteCounterUnclamped(helper));
console.log(`\n  guarded call sites naming themselves : ${named}`);
console.log(`  reconcile sites naming themselves    : ${reconciled}`);
console.log(`  problems                             : ${problems.length}`);
for (const p of problems) console.log(`  FAIL  ${p}`);

console.log(`\nCOVERAGE: ${FILES.length} files, the only three holding a guard wrapper.`);
console.log(`It checks that both halves NAME themselves and name the SAME consumers —`);
console.log(`not that a name is the right one, and not that the KV write succeeded.`);
console.log(`/budget/odds reports by_site_sum and unaccounted separately so a`);
console.log(`divergence stays visible rather than inferred, and`);
console.log(`watch-odds-attribution-gap.mjs reads that gap daily.`);
console.log(problems.length ? `\n${problems.length} FAILED` : `\nevery guarded odds call names itself`);
process.exit(problems.length ? 1 : 0);
