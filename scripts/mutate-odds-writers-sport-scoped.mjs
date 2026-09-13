#!/usr/bin/env node
// Rule 90 for scripts/check-odds-writers-sport-scoped.mjs.
//
// Each mutation is a plausible fourth-writer mistake, applied to the real
// src/index.js. Every one asserts its anchor is unique and its effect present
// BEFORE any verdict is printed — NOT CAUGHT with nothing mutated is worse than
// no test, and this harness has produced exactly that failure before.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SRC = 'src/index.js';
const CHECK = 'scripts/check-odds-writers-sport-scoped.mjs';
const BAK = `${SRC}.mutbak`;

const MUTATIONS = [
  { name: 'M1  snapshotCronOdds stops filtering its SELECT on sport',
    // Anchored on two lines, not one. The single-line form is a SUBSTRING of
    // the /identity/mismatches copy, which is indented deeper — the harness
    // reported ANCHOR occurs 2 times and mutated nothing, which is the whole
    // reason it asserts uniqueness before printing a verdict.
    anchor: 'SELECT id, home, away FROM ${table}\n          WHERE date = ? AND sport = ? AND opening_odds IS NULL`',
    replace: 'SELECT id, home, away FROM ${table}\n          WHERE date = ? AND opening_odds IS NULL`',
    expect: 'snapshotCronOdds selects only rows of the sport it just fetched' },

  { name: 'M2  the backfill hardcodes one sport instead of dispatching per bucket',
    anchor: "await fetchSportOddsHistorical(env, sportKey, isoDate)",
    replace: "await fetchSportOddsHistorical(env, 'soccer_usa_mls', isoDate)",
    expect: 'fetches by variable, not a hardcoded sport' },

  { name: 'M3  /archive/game derives its sport key from something other than the game',
    anchor: 'const oddsSportKey = archiveSportToOddsKey(sport);',
    replace: "const oddsSportKey = ODDS_PREFERRED_BOOK;",
    expect: "derives `oddsSportKey` from the row's own sport" },

  { name: 'M4  buckets stop being keyed by sport',
    anchor: '    const sk = archiveSportToOddsKey(sport);',
    replace: '    const sk = sport;',
    expect: 'bucketOf keys its buckets by archiveSportToOddsKey' },

  { name: 'M5  a fourth join site appears with no scoping at all',
    anchor: '            const gapsOut = {};',
    replace: '            const _unscoped = findOddsForRow({ byPair: new Map(), vendorKeys: new Set() }, "a", "b");\n            const gapsOut = {};',
    expect: 'three join sites, the census reach probe excluded by its call shape' },

  { name: 'M6  the census probe is rewritten into the shape the exclusion matches',
    anchor: 'const joins = findOddsForRow(present, name, REACH_CONTROL_B) != null;',
    replace: 'const joins = findOddsForRow(present, name, REACH_CONTROL_B, 0) != null;',
    expect: 'the census reach probe is present and is the excluded one' },
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
  if (after === before) {
    bad++;
    console.error(`  NO EFFECT  ${m.name}\n          replacement left the file unchanged. NOTHING WAS MUTATED.`);
    continue;
  }
  copyFileSync(SRC, BAK);
  writeFileSync(SRC, after);
  let out = '', code = 0;
  try {
    out = execFileSync('node', [CHECK], { encoding: 'utf8' });
  } catch (e) {
    code = e.status ?? 1;
    out = `${e.stdout || ''}${e.stderr || ''}`;
  } finally {
    copyFileSync(BAK, SRC);
    unlinkSync(BAK);
  }
  const redLines = out.split('\n').filter(l => l.startsWith('FAIL'));
  if (code === 0) {
    bad++;
    console.error(`  NOT CAUGHT  ${m.name}\n          check still passed with the mutation applied`);
  } else if (!redLines.some(l => l.includes(m.expect))) {
    bad++;
    console.error(`  WRONG REASON  ${m.name}\n          went red, but no FAIL line mentioned "${m.expect}".\n${redLines.join('\n') || out.slice(0, 600)}`);
  } else {
    console.log(`  caught  ${m.name}\n          by "${m.expect}" (${redLines.length} assertion(s) red)`);
  }
}

// The harness restored what it borrowed, or nothing above can be believed.
execFileSync('node', ['--check', SRC]);
console.log(`\nran ${MUTATIONS.length} mutation(s) against ${CHECK}; ${SRC} restored and parsing`);
process.exit(bad ? 1 : 0);
