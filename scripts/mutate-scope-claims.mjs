#!/usr/bin/env node
// Rule 90 for check-scope-claims.mjs. The dangerous failure here is not a miss
// — it is a check that passes because its escape hatch is too easy. SCOPE and
// SCOPE-EXCLUDES exist so an omission has to be WRITTEN DOWN; if a wildcard or
// an absent declaration also satisfies it, the check launders the claim it was
// built to expose.
//
// Anchor discipline: exactly-one-match asserted, replacement confirmed on disk,
// `git checkout --` to restore. NOT CAUGHT with nothing mutated is worse than
// no test.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const CHECK   = 'scripts/check-scope-claims.mjs';
const SELF    = [CHECK, '--self-test'];
const GUARDED = 'scripts/check-odds-calls-guarded.mjs';
const BACKFILL = '.github/scripts/odds-backfill.js';
const sh = (c, a) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

for (const f of [CHECK, GUARDED, BACKFILL]) {
  if (spawnSync('git', ['diff', '--quiet', '--', f]).status !== 0) {
    console.error(`FAIL — ${f} has unstaged changes; restore would lose them.`); process.exit(1);
  }
  if (!sh('git', ['ls-files', '--', f]).trim()) {
    console.error(`FAIL — ${f} is untracked; \`git add\` it first.`); process.exit(1);
  }
}
for (const c of [SELF, [CHECK]]) {
  if (spawnSync('node', c, { stdio: 'ignore' }).status !== 0) {
    console.error(`FAIL — ${c.join(' ')} is already red on clean source.`); process.exit(1);
  }
}
console.log(`baseline: ${CHECK} passes on itself and on the repo\n`);

const MUTATIONS = [
  { file: GUARDED, check: [CHECK], name: 'S1  the SCOPE declaration is removed',
    anchor: '// SCOPE: api\\.the-odds-api\\.com|ODDS_API_BASE|ODDS_BASE',
    replace: '// (scope removed)',
    catches: 'a reach claim over a hardcoded list with no declared population' },

  { file: GUARDED, check: [CHECK], name: 'S2  an omission is dropped from SCOPE-EXCLUDES',
    anchor: 'scripts/targeted-odds-fill.mjs ',
    replace: '',
    catches: 'a live-write script silently outside a claim that says "every"' },

  { file: BACKFILL, check: [CHECK], name: 'S3  the corrected constant comment claims reach again',
    anchor: "const DAILY_CEILING    = 2700;           // per-run, in-process, NOT the worker's ledger",
    replace: 'const DAILY_CEILING    = 2700;           // global shared across all FIELD odds usage',
    catches: 'a local constant advertising itself as shared' },

  { file: CHECK, check: SELF, name: 'S4  a reach claim no longer needs a SCOPE at all',
    anchor: "  if (!SCOPE_DECL.test(src)) {",
    replace: '  if (false) {',
    catches: 'the rule stops requiring the thing it exists to require' },

  { file: CHECK, check: SELF, name: 'S5  the shared-constant rule ignores whether it is exported',
    anchor: '    if (exported) continue;',
    replace: '    if (true) continue;',
    catches: 'every shared claim passes, true or not' },

  { file: CHECK, check: SELF, name: 'S6  the comment match spans newlines again',
    anchor: '  const re = /^(export\\s+)?const\\s+([A-Z][A-Z0-9_]{2,})\\s*=\\s*[^;\\n]+;[ \\t]*\\/\\/(.*)$/gm;',
    replace: '  const re = /^(export\\s+)?const\\s+([A-Z][A-Z0-9_]{2,})\\s*=\\s*[^;]+;\\s*(?:\\/\\/(.*))?$/gm;',
    catches: 'prose two paragraphs below a const is attributed to it — 3 of 5 first-run hits' },
];

let caught = 0;
for (const mut of MUTATIONS) {
  const original = fs.readFileSync(mut.file, 'utf8');
  const hits = original.split(mut.anchor).length - 1;
  if (hits !== 1) {
    console.log(`FAIL       ${mut.name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`);
    continue;
  }
  fs.writeFileSync(mut.file, original.replace(mut.anchor, mut.replace));
  if (fs.readFileSync(mut.file, 'utf8') === original) {
    console.log(`FAIL       ${mut.name}\n            file unchanged — NOTHING MUTATED.`);
    sh('git', ['checkout', '--', mut.file]); continue;
  }
  const red = spawnSync('node', mut.check, { encoding: 'utf8' }).status !== 0;
  sh('git', ['checkout', '--', mut.file]);
  console.log(`${red ? 'CAUGHT    ' : 'NOT CAUGHT'} ${mut.name}\n            (${mut.catches})`);
  if (red) caught++;
}

console.log(`\n${caught} of ${MUTATIONS.length} mutations caught.`);
console.log(`COVERAGE: the two rules and the exclusion mechanism. It does NOT verify`);
console.log(`that a declared SCOPE regex is the RIGHT population — only that whatever`);
console.log(`is declared is covered or excluded by name. A wrong glob still passes.`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
