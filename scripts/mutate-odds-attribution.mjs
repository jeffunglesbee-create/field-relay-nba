#!/usr/bin/env node
// Rule 90 for the attribution layer. The failure that matters is silent: a call
// that stops naming itself, or a name that stops being reported, leaves the
// daily total intact and only the SPLIT wrong — which is exactly the state the
// whole task exists to leave behind.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const CHECK  = 'scripts/check-odds-attribution.mjs';
const SELF   = [CHECK, '--self-test'];
const HELPER = 'src/budget-helpers.js';
const INDEX  = 'src/index.js';
const AMBIENT = 'src/ambient-do.js';
const sh = (c, a) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

for (const f of [CHECK, HELPER, INDEX, AMBIENT]) {
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
  { file: INDEX, check: [CHECK], name: 'A1  the public /odds proxy stops naming itself',
    anchor: "oddsCreditCost(targetUrl), 'oddsProxyRoute')",
    replace: 'oddsCreditCost(targetUrl))',
    catches: 'the ninth call site — the one I missed by grep and the check found' },

  { file: AMBIENT, check: [CHECK], name: 'A2  the closing capture stops naming itself',
    anchor: "oddsCreditCost(url), 'ambientCaptureClosingOdds')",
    replace: 'oddsCreditCost(url))',
    catches: 'a live consumer drops into the unattributed bucket' },

  { file: INDEX, check: [CHECK], name: 'A3  a site is passed that nothing declares',
    anchor: "oddsCreditCost(_liveUrl), 'fetchSportOddsLive')",
    replace: "oddsCreditCost(_liveUrl), 'somethingElse')",
    catches: 'by_site grows a key /budget/odds never reports and the sum stops matching' },

  { file: HELPER, check: [CHECK], name: 'A4  a declared site is removed from KNOWN_SITES',
    anchor: "    'fetchSportOddsLive', 'fetchSportOddsHistorical', 'wpResolver',",
    replace: "    'fetchSportOddsHistorical', 'wpResolver',",
    catches: 'a real consumer spends into a bucket the readout omits' },

  { file: CHECK, check: SELF, name: 'A5  the await requirement is dropped',
    anchor: "      if (!/await\\s+$/.test(before)) continue;",
    replace: '      if (false) continue;',
    catches: 'prose mentions count as call sites again — three false defects last time' },

  { file: CHECK, check: SELF, name: 'A6  a variable site passes as a name',
    anchor: "    .filter(c => !/^'[a-zA-Z][a-zA-Z0-9_]*'$/.test(c.args[2] || ''))",
    replace: '    .filter(c => !(c.args[2] || ""))',
    catches: 'a variable writes an unpredictable KV key — absence in a different costume' },

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
console.log(`COVERAGE: the naming requirement and the declared-site list. It does NOT`);
console.log(`verify the KV write happens, nor that a name describes the right consumer.`);
console.log(`/budget/odds reports by_site_sum and unaccounted for the first of those.`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
