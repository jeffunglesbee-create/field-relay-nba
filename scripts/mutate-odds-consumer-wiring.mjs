#!/usr/bin/env node
// Rule 90 harness for scripts/check-odds-consumer-wiring.mjs.
//
// Every mutation here is a plausible future edit: restoring a local helper that
// "looks the same", dropping a guard while reformatting a template literal,
// reverting one of two identical prose sites and leaving the other. Each one
// puts an in-play price back into a published claim.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const CHECK = 'scripts/check-odds-consumer-wiring.mjs';

const MUTATIONS = [
  { file: 'src/analytics-engine.js',
    name: 'W1  the local winnerMoneylinePrice comes back',
    anchor: "import { winnerMoneylinePrice, lineSpread } from './odds-consumer-rules.js';",
    replace: "function winnerMoneylinePrice(game) { return null; }\nimport { lineSpread } from './odds-consumer-rules.js';",
    expect: 'analytics-engine defines no local winnerMoneylinePrice' },

  { file: 'src/analytics-engine.js',
    name: 'W2  the spread read reverts to closing || opening',
    anchor: "    const spread = lineSpread(game);",
    replace: "    const _o = parseOddsJSON(game.closing_odds) || parseOddsJSON(game.opening_odds);\n    const spread = _o && (_o.spread?.home ?? null);",
    expect: 'the tight-line score still reads a spread' },

  { file: 'src/analytics-engine.js',
    name: 'W3  the rule module import is dropped entirely',
    anchor: "import { winnerMoneylinePrice, lineSpread } from './odds-consumer-rules.js';",
    replace: "",
    expect: 'analytics-engine imports winnerMoneylinePrice from the rule module' },

  { file: 'src/index.js',
    name: 'W4  one prose site loses the guard, the other keeps it',
    anchor: "      const closeStr = (c && c.moneyline && !knownPostKickoff(c))\n        ? `, closed home",
    replace: "      const closeStr = (c && c.moneyline)\n        ? `, closed home",
    expect: 'neither prose site prints a post-kickoff price as "closed"' },

  { file: 'src/index.js',
    name: 'W5  the cron debrief path loses the guard',
    anchor: "      const closeStr = (c && c.moneyline && !knownPostKickoff(c)) ? `, closed home",
    replace: "      const closeStr = (c && c.moneyline) ? `, closed home",
    expect: 'neither prose site prints a post-kickoff price as "closed"' },

  { file: 'src/index.js',
    name: 'W6  the debug route drifts from the prompt',
    anchor: "                        const story = (hasOpening && hasClosing && !lateClose)",
    replace: "                        const story = (hasOpening && hasClosing)",
    expect: 'the /odds-story route applies the same guard as the prompt' },

  { file: 'src/context-assembler.js',
    name: 'W7  the narrative stops skipping a late close',
    anchor: "                if (knownPostKickoff(parseOddsJSON(row.closing_odds))) continue;\n",
    replace: "",
    expect: 'buildOddsStoryContext skips a late close before narrating movement' },

  { file: 'src/context-assembler.js',
    name: 'W8  the mark reader import is dropped',
    anchor: "import { knownPostKickoff, parseOddsJSON } from './odds-consumer-rules.js';",
    replace: "",
    expect: 'context-assembler imports the mark reader' },
];

let bad = 0;
for (const m of MUTATIONS) {
  const SRC = m.file, BAK = `${m.file}.mutbak`;
  const before = readFileSync(SRC, 'utf8');
  const hits = before.split(m.anchor).length - 1;
  if (hits !== 1) {
    bad++;
    console.error(`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s), expected 1. NOTHING WAS MUTATED.`);
    continue;
  }
  const after = before.replace(m.anchor, m.replace);
  if (after === before) { bad++; console.error(`  NO EFFECT  ${m.name}`); continue; }
  copyFileSync(SRC, BAK);
  writeFileSync(SRC, after);
  let out = '', code = 0;
  try { out = execFileSync('node', [CHECK], { encoding: 'utf8' }); }
  catch (e) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`; }
  finally { copyFileSync(BAK, SRC); unlinkSync(BAK); }
  const red = out.split('\n').filter(l => l.startsWith('FAIL'));
  if (code === 0) { bad++; console.error(`  NOT CAUGHT  ${m.name}`); }
  else if (!red.some(l => l.includes(m.expect))) {
    bad++;
    console.error(`  WRONG REASON  ${m.name}\n          no FAIL line mentioned "${m.expect}".\n${red.join('\n')}`);
  } else console.log(`  caught  ${m.name}\n          by "${m.expect}" (${red.length} red)`);
}

for (const f of ['src/analytics-engine.js', 'src/index.js', 'src/context-assembler.js'])
  execFileSync('node', ['--check', f]);
console.log(`\nran ${MUTATIONS.length} mutation(s) against ${CHECK}; all three sources restored and parsing`);
process.exit(bad ? 1 : 0);
