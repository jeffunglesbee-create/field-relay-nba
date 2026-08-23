#!/usr/bin/env node
// Locks layer 2h and the banned-phrase list.
//
// MEASURED 2026-08-23: a live brief through /journalism/generate opened
// "Hull City stunned Manchester United 2-0". Two independent gaps let it
// through, and either alone would have been enough:
//
//   1. The relay's BANNED_PHRASES carried none of the seven words
//      jubilant-bassoon's CLAUDE.md bans outright. hasCliche() returned []
//      on that sentence.
//   2. runQualityChain never called hasCliche(). index.js imported it as
//      jqHasCliche on line 70 and that import was its only occurrence in the
//      file — a detector wired to nothing.
//
// Run: node scripts/banned-phrase-check.mjs
import { BANNED_PHRASES, SPARINGLY_PHRASES, hasCliche, runQualityChain } from '../src/journalism-quality.js';

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${label}`); pass++; }
  else { console.error(`FAIL  ${label}${detail ? ' — ' + detail : ''}`); fail++; }
};

// The seven, quoted from jubilant-bassoon CLAUDE.md "Banned Journalism Phrases".
const CLAUDE_MD_BANNED = ['stunned', 'shocked', 'thriller', 'instant classic',
  'for the ages', 'must-watch', "can't-miss"];
for (const p of CLAUDE_MD_BANNED) {
  ok(`CLAUDE.md's "${p}" is in BANNED_PHRASES`, BANNED_PHRASES.includes(p));
  ok(`the detector fires on "${p}"`, hasCliche(`A ${p} night at the ground.`).includes(p));
}
// A phrase cannot be banned outright and allowed once per brief.
ok('no banned phrase also appears in SPARINGLY_PHRASES',
  !BANNED_PHRASES.some(p => SPARINGLY_PHRASES.includes(p)),
  BANNED_PHRASES.filter(p => SPARINGLY_PHRASES.includes(p)).join(', '));

// The observed sentence, verbatim.
ok('the measured brief is caught',
  hasCliche('Hull City stunned Manchester United 2-0.').includes('stunned'));
// Ordinary prose must not trip it.
ok('a clean brief is not flagged',
  hasCliche('Hull City beat Manchester United 2-0 at the MKM, Ajayi and Mendy scoring.').length === 0);

// The layer, end to end: it must fire, and the retry must actually clean it.
let sawRetry = false;
const proxy = async (p) => {
  if (!p.includes('BANNED PHRASE')) return null;
  sawRetry = true;
  return 'Hull City beat Manchester United 2-0 at the MKM, Ajayi and Mendy scoring.';
};
const r = await runQualityChain('Game data: Hull 2 Man United 0',
  'Hull City stunned Manchester United 2-0.', proxy, { sport: 'EPL' });
ok('2h fires inside runQualityChain', r.layers_fired.includes('2h'), r.layers_fired.join(','));
ok('the retry prompt names the banned phrase', sawRetry);
ok('the rewritten text is clean', hasCliche(r.text).length === 0, r.text);

// A chain that fires nothing must not invent a retry.
const clean = await runQualityChain('Game data: x',
  'Hull City beat Manchester United 2-0 at the MKM.', async () => null, { sport: 'EPL' });
ok('a clean draft does not trigger 2h', !clean.layers_fired.includes('2h'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
