#!/usr/bin/env node
// Rule 90: scripts/check-truth-is-ties.mjs has to fail when the thing it guards is broken. Each
// mutation below breaks the tie rule in detectAnomalies (src/analytics-engine.js) one way, runs
// the check, requires it to go red for the stated reason, then restores the file.
//
// The anchor of every mutation must occur exactly once, or NOTHING is mutated and the run fails:
// a "not caught" with no mutation applied would be worse than no test (Rule 90, the corollary for
// the harness).
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FILE = 'src/analytics-engine.js';
const CHECK = 'scripts/check-truth-is-ties.mjs';
const SKIP = '        if (g.home_score === g.away_score) continue;\n';

const MUTATIONS = [
  { name: 'T1 the tie rule is removed (a draw goes to the away side again)',
    anchor: SKIP, replace: '',
    expect: 'a drawn game is not a finding' },

  { name: 'T2 only a goalless draw is skipped',
    anchor: SKIP, replace: '        if (g.home_score === 0 && g.away_score === 0) continue;\n',
    expect: 'a drawn game is not a finding' },

  { name: 'T3 the rule skips every home win as well',
    anchor: SKIP, replace: '        if (g.home_score >= g.away_score) continue;\n',
    expect: 'a decisive upset is untouched: a home winner' },

  { name: 'T4 the rule skips every away win as well',
    anchor: SKIP, replace: '        if (g.home_score <= g.away_score) continue;\n',
    expect: 'a decisive upset is untouched: an away winner' },

  { name: 'T5 a goalless draw is let through',
    anchor: SKIP, replace: '        if (g.home_score === g.away_score && g.home_score > 0) continue;\n',
    expect: 'a goalless draw is not a shutout and not an upset' },

  { name: 'T6 a draw with recap text is let through',
    anchor: SKIP, replace: '        if (g.home_score === g.away_score && !g.note) continue;\n',
    expect: 'over 400 random slates' },
];

let bad = 0;
for (const m of MUTATIONS) {
  const BAK = `${FILE}.mutbak`;
  const before = readFileSync(FILE, 'utf8');
  const hits = before.split(m.anchor).length - 1;
  if (hits !== 1) {
    bad++;
    console.error(`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s), expected 1. NOTHING WAS MUTATED.`);
    continue;
  }
  const after = before.replace(m.anchor, () => m.replace);
  if (after === before) { bad++; console.error(`  NO EFFECT  ${m.name}`); continue; }
  copyFileSync(FILE, BAK);
  writeFileSync(FILE, after);
  let out = '', code = 0;
  try { out = execFileSync('node', [CHECK], { encoding: 'utf8' }); }
  catch (e) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`; }
  finally { copyFileSync(BAK, FILE); unlinkSync(BAK); }
  const red = out.split('\n').filter(l => l.startsWith('FAIL'));
  if (code === 0) { bad++; console.error(`  NOT CAUGHT  ${m.name}`); }
  else if (!red.some(l => l.includes(m.expect))) {
    bad++;
    console.error(`  WRONG REASON  ${m.name}\n          no FAIL line mentioned "${m.expect}".\n${red.join('\n') || out.split('\n').slice(0, 6).join('\n')}`);
  } else console.log(`  caught  ${m.name}\n          by "${m.expect}" (${red.length} red)`);
}

execFileSync('node', ['--check', FILE]);
console.log(`\nran ${MUTATIONS.length} mutation(s) against ${CHECK}; ${FILE} restored and parsing`);
process.exit(bad ? 1 : 0);
