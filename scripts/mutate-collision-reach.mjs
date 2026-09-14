#!/usr/bin/env node
// Rule 90 harness for scripts/check-collision-reach.mjs.
//
// Each mutation is a way this condition could be wrong while looking right:
// silently closing on a live hazard, or staying open on an inert one. The
// first kind is the dangerous one — every mutation below that closes the
// condition is a false DONE.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SRC = 'src/collision-reach.js';
const CHECK = 'scripts/check-collision-reach.mjs';
const BAK = `${SRC}.mutbak`;

const MUTATIONS = [
  // THE FALSE DONE. Presence is the form this condition had until 2026-09-14;
  // its failure is the opposite direction (never closing), but pinning the
  // shape stops a later session restoring it by hand.
  { name: 'R1  disagreement degrades back to presence',
    anchor: "    return (x?.opening_odds_digest ?? null) !== (y?.opening_odds_digest ?? null)\n        || (x?.closing_odds_digest ?? null) !== (y?.closing_odds_digest ?? null);",
    replace: "    return !!(x?.opening_odds_digest || y?.opening_odds_digest);",
    expect: 'the same line on both rows is agreement' },

  // Reading one column only. A pair disagreeing on the closing line alone
  // becomes invisible — half the hazard, silently.
  { name: 'R2  only the opening line is compared',
    anchor: "        || (x?.closing_odds_digest ?? null) !== (y?.closing_odds_digest ?? null);",
    replace: "        || false;",
    expect: 'a closing-only disagreement still counts' },

  // THE RULE 99 MUTATION. Collapsing a failed read to "nothing reachable" is
  // the exact substitution Rule 99 names, and it closes the condition on data
  // that was never read.
  { name: 'R3  a failed detail read stops forcing every collision open',
    anchor: "    if (detailError) return collisions.slice();",
    replace: "    if (detailError) return [];",
    expect: 'a failed detail read makes EVERY collision reachable' },

  // A doubleheader is two real games. Counting it forever is the escalation by
  // proxy this narrowing exists to end.
  { name: 'R4  doubleheaders stop being excluded',
    anchor: "    return collisions.filter(c => !twoRealGames(c) && oddsDisagree(c));",
    replace: "    return collisions.filter(c => oddsDisagree(c));",
    expect: 'and it is the half-truth pair, not the doubleheader' },

  // ONE ID PRESENT AND ONE ABSENT IS NOT TWO GAMES. Dropping the presence test
  // makes every half-truth pair look like a doubleheader, which would exclude
  // all 32 from the condition — a false DONE covering the entire population.
  { name: 'R5  a doubleheader is decided by inequality alone',
    anchor: "    return !!(x?.espn_event_id && y?.espn_event_id\n              && x.espn_event_id !== y.espn_event_id);",
    replace: "    return x?.espn_event_id !== y?.espn_event_id;",
    expect: 'one id and one absent is NOT a doubleheader' },

  // A digest that ignores its input makes every pair agree.
  { name: 'R6  the digest stops depending on the value',
    anchor: "        h ^= str.charCodeAt(i);",
    replace: "        h ^= 0;",
    expect: 'different values digest differently' },

  // null in, SOMETHING out: an absent column would acquire a digest, and the
  // 82 pairs that carry no odds at all would read as agreeing on a hash of
  // nothing — true today by luck, false the moment one side gets a line.
  { name: 'R7  a null column acquires a digest',
    anchor: "    if (v == null) return null;",
    replace: "    if (v == null) v = '';",
    expect: 'a null column has no digest' },

  // An object arriving from D1 must not digest differently from its own JSON.
  { name: 'R8  objects stop being serialised',
    anchor: "    const str = typeof v === 'string' ? v : JSON.stringify(v);",
    replace: "    const str = String(v);",
    expect: 'an object digests as its JSON' },
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
