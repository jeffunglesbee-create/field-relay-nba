#!/usr/bin/env node
// scripts/check-no-fabricated-values.mjs — no hand-entered market value reaches
// a response. Blocking in deploy.yml.
//
// THE CASE THIS EXISTS FOR. From 2026-06-12 to 2026-09-05, /wc/odds-probs pushed
// a hand-entered Germany v Ecuador row into its response whenever the Odds API
// did not list that fixture -- pHome 0.56, pDraw 0.25, pAway 0.19, lambdas from
// a screenshot. It was a defensible two-week bridge and its own commit named the
// exit: skipped "once Odds API lists Germany vs Ecuador (June 25)".
//
// The match was played on June 25. The Odds API lists upcoming and live events,
// never completed ones, so the condition it relied on to expire itself became
// unreachable at kickoff. It ran 72 more days, and by 2026-09-05 it was not one
// row among 71 -- it was the ONLY row, measured: probs:1 with the provider
// reporting a cost of 0, meaning zero WC events listed.
//
// Nothing caught it because nothing was looking. Every consumer read it as
// market data; none filters on lambdaSource, and the tag 'market-consensus-
// injected' was written and never read by anything.
//
// WHAT IT CHECKS. A numeric literal in a field a market is supposed to fill.
// Probabilities, Poisson lambdas, spreads, totals, prices, odds. Those come from
// a provider or from a model that names its inputs; typing one in is fabrication
// however well-sourced the screenshot was.

import { readFileSync, readdirSync } from 'node:fs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `\n         → ${detail}`}`);
  if (!ok) failed++;
};

// Fields a market fills. A literal assigned to one of these is the finding.
const MARKET_FIELD = /\b(pHome|pDraw|pAway|pWin|prob|probability|lambdaHome|lambdaAway|lambdaTotal|impliedProb|spread|total|price|moneyline|ml)\s*:\s*(-?\d+\.\d+|-?\d{2,})\s*[,}]/;

// Exempt by construction. These are not claims about a market:
//  - test fixtures, which exist to feed known numbers in
//  - BASE_LAMBDA-style model constants, which are declared parameters
//  - anything on a line marked as a bound, cap, floor, ceiling or default
const EXEMPT_FILE = /^(scripts\/|test|.*\.test\.|.*-test\.)/;
const EXEMPT_LINE = /\b(BASE_LAMBDA|DEFAULT|FALLBACK|MIN_|MAX_|CAP|FLOOR|CEILING|THRESHOLD|WEIGHT|PRIOR_WEIGHT|EPSILON|clamp|Math\.(min|max))\b/i;

const files = readdirSync('src').filter(f => f.endsWith('.js')).map(f => `src/${f}`);
const findings = [];
for (const file of files) {
  if (EXEMPT_FILE.test(file)) continue;
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const t = line.trimStart();
    if (t.startsWith('//') || t.startsWith('*')) return;      // a comment is not a value
    if (EXEMPT_LINE.test(line)) return;
    const m = line.match(MARKET_FIELD);
    if (m) findings.push({ file, line: i + 1, field: m[1], value: m[2], text: t.slice(0, 90) });
  });
}

for (const f of findings) console.log(`    ${f.file}:${f.line}  ${f.field}: ${f.value}   ${f.text}`);
check('no hand-entered market value in any response', findings.length === 0,
  `${findings.length} literal(s) where a provider or a model should be. If one is genuinely a model constant, name it so (BASE_, DEFAULT_, MIN_, MAX_) rather than widening this check.`);

// The specific row, by name, so a revert cannot land quietly.
const all = files.map(f => readFileSync(f, 'utf8')).join('\n');
check('the Germany v Ecuador row has not come back',
  !/market-consensus-injected/.test(all) && !/home_team:\s*'Germany'/.test(all),
  'the injected fixture is back in the source');

// A provenance tag nobody reads is decoration. The lambdaSource on every row of
// /wc/odds-probs said 'market-consensus-injected' for 72 days and no consumer
// looked, which is why the label did not save anyone.
const sources = [...all.matchAll(/lambdaSource:\s*'([^']+)'/g)].map(m => m[1]);
const DERIVED = new Set(['totals', 'h2h-inversion']);
check('every lambdaSource is derived from market data',
  sources.every(s => DERIVED.has(s)),
  `not derived: ${sources.filter(s => !DERIVED.has(s)).join(', ')}`);

// Self-tests, both directions.
const cases = [
  ['an injected probability is caught',   `            pHome:        0.5600,`,                 true],
  ['an injected lambda is caught',        `            lambdaAway:   0.35,`,                    true],
  ['a computed field is not',             `            pHome: parseFloat(pH.toFixed(4)),`,      false],
  ['a declared model constant is not',    `const BASE_LAMBDA = 1.35;`,                          false],
  ['a named default is not',              `            price: DEFAULT_PRICE,`,                  false],
  ['a commented-out literal is not',      `            // pHome: 0.5600,`,                      false],
];
let p = 0, f2 = 0;
for (const [name, line, want] of cases) {
  const t = line.trimStart();
  const got = !(t.startsWith('//') || EXEMPT_LINE.test(line)) && MARKET_FIELD.test(line);
  if (got === want) p++; else { f2++; console.error(`  SELFTEST FAIL: ${name} — expected ${want}, got ${got}`); }
}
check(`self-tests (${p}/${cases.length})`, f2 === 0);

console.log(failed === 0 ? '  PASS — every market value comes from a market' : `  FAIL — ${failed}`);
process.exit(failed === 0 ? 0 : 1);
