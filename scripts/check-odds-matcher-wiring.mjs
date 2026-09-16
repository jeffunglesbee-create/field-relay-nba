#!/usr/bin/env node
// The structural half: every odds writer imports src/odds-name-match.js and
// none of them keeps a private matcher or price reader.
//
// check-odds-matcher.mjs proves the module is CORRECT. It cannot prove anyone
// USES it — the fourth sport-key registry (deleted 2026-09-15) sat beside a
// correct shared lookup for 73 days. This is the check that would have caught
// that one, aimed at the matcher instead.

import fs from 'node:fs';

const CONSUMERS = [
  '.github/scripts/odds-backfill.js',
  'scripts/targeted-odds-fill.mjs',
];

// Each pattern is a way a private copy comes back. The message says what the
// copy would BE, because "regex matched" is not a finding.
const BANNED = [
  [/function\s+normTeam\s*\(/,                        'a private normTeam() is back'],
  [/norm\w*\(\s*e\.home_team\s*\)\s*===/,             'whole-string equality on home_team — the matcher that scored 0 of 80'],
  [/events\.find\(\s*e\s*=>/,                         'a local events.find() matcher instead of findVendorEvent'],
  [/outcomes[\s\S]{0,40}?\.find\(\s*o\s*=>[\s\S]{0,80}?home_team/, 'a local h2h price lookup instead of h2hPrices'],
];

let failed = 0;
console.log('=== odds matcher wiring ===\n');

for (const f of CONSUMERS) {
  const src = fs.readFileSync(f, 'utf8');
  const imports = /import\s*\{[^}]*\bfindVendorEvent\b[^}]*\}\s*from\s*'[^']*odds-name-match\.js'/.test(src);
  imports ? console.log(`  PASS  ${f} imports findVendorEvent from the shared module`)
          : (failed++, console.log(`  FAIL  ${f} does not import findVendorEvent`));

  const prices = /\bh2hPrices\s*\(/.test(src);
  prices ? console.log(`  PASS  ${f} reads prices through h2hPrices`)
         : (failed++, console.log(`  FAIL  ${f} does not call h2hPrices`));

  for (const [re, what] of BANNED) {
    re.test(src) ? (failed++, console.log(`  FAIL  ${f}: ${what}`))
                 : console.log(`  PASS  ${f}: no ${what.replace(/ is back$| — .*$/, '')}`);
  }
}

console.log(`\nCOVERAGE: ${CONSUMERS.length} consumers, ${BANNED.length} banned shapes each.`);
console.log(`Structural only — that a call site imports the module does not prove it`);
console.log(`uses the result correctly. check-odds-matcher.mjs covers the module itself.`);
console.log(failed ? `\n${failed} FAILED` : `\nall checks passed`);
process.exit(failed ? 1 : 0);
