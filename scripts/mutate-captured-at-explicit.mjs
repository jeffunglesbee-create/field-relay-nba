#!/usr/bin/env node
// Rule 90 harness for scripts/check-captured-at-explicit.mjs.
//
// The mutations restore the exact shape that produced 22 archived closing lines
// stamped with the worker's clock instead of the snapshot's time, plus the ways
// the check could be aimed at a function that no longer behaves as it assumes.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SRC = 'src/index.js';
const CHECK = 'scripts/check-captured-at-explicit.mjs';
const BAK = `${SRC}.mutbak`;

const MUTATIONS = [
  // THE ORIGINAL DEFECT. The closing-odds route drops the snapshot time and
  // stamps the clock — exactly a1937eb, reverted.
  { name: 'C1  the closing-odds call drops capturedAt',
    anchor: "const odds = extractOddsForGame(matched, ODDS_PREFERRED_BOOK, snapshotAt);",
    replace: "const odds = extractOddsForGame(matched);",
    expect: 'no call feeding closing_odds omits capturedAt' },

  // A second implicit call, which is how the one permitted exception becomes
  // two and then a habit.
  { name: 'C2  the historical opening backfill drops it too',
    anchor: "const odds = extractOddsForGame(og, ODDS_PREFERRED_BOOK, snapshotAt);",
    replace: "const odds = extractOddsForGame(og);",
    expect: 'at most one call omits capturedAt, the live fetch' },

  // The parameter removed: every explicit call site silently passes an argument
  // the function ignores.
  { name: 'C3  the capturedAt parameter is removed',
    anchor: "function extractOddsForGame(oddsGame, preferredBook = ODDS_PREFERRED_BOOK, capturedAt = null) {",
    replace: "function extractOddsForGame(oddsGame, preferredBook = ODDS_PREFERRED_BOOK) {",
    expect: 'the capturedAt parameter is still there' },

  // The fallback removed. Harmless-looking, and it would make captured_at
  // undefined rather than wrong — a different failure the rule must still see.
  { name: 'C4  the fallback stops defaulting to now',
    anchor: "    captured_at: capturedAt || new Date().toISOString(),",
    replace: "    captured_at: capturedAt,",
    expect: 'the fallback is still capturedAt || now' },

  // The historical fetch stops returning a snapshot time: the explicit call
  // sites then pass undefined and fall through to the clock, with every
  // call-shape assertion still green.
  { name: 'C5  the historical fetch stops returning snapshotAt',
    anchor: "return { games, quotaRemaining, ok: true, snapshotAt: servedAt || snapshot };",
    replace: "return { games, quotaRemaining, ok: true };",
    expect: 'the historical fetch returns a snapshotAt on its success path' },
];

let bad = 0;
for (const m of MUTATIONS) {
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

execFileSync('node', ['--check', SRC]);
console.log(`\nran ${MUTATIONS.length} mutation(s) against ${CHECK}; ${SRC} restored and parsing`);
process.exit(bad ? 1 : 0);
