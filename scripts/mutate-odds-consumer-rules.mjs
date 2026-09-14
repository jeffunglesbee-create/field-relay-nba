#!/usr/bin/env node
// Rule 90 harness for scripts/check-odds-consumer-rules.mjs.
//
// Each mutation is a way the selection rule could be wrong while reading
// correctly. The dangerous direction is the loose one: a rule that quietly
// takes the in-play price again puts a manufactured upset back into published
// prose, and every assertion would still pass if it were only testing that a
// number came back.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SRC = 'src/odds-consumer-rules.js';
const CHECK = 'scripts/check-odds-consumer-rules.mjs';
const BAK = `${SRC}.mutbak`;

const MUTATIONS = [
  // THE FALSE DONE. The rule degrades to the behaviour it replaced, and every
  // late blob is read as a closing line again.
  { name: 'M1  the post-kickoff skip is removed',
    anchor: "        if (requirePreKickoff && knownPostKickoff(odds)) { skipped.push(source); continue; }",
    replace: "        if (false) { skipped.push(source); continue; }",
    expect: 'a blob marked post-kickoff is skipped' },

  // The opposite failure: unmarked blobs treated as guilty would blank nearly
  // every opening_odds in the archive.
  { name: 'M2  an unmarked blob counts as post-kickoff',
    anchor: "    return odds?._kickoff?.verified === false;",
    replace: "    return odds?._kickoff?.verified !== true;",
    expect: 'an unmarked opening is still used' },

  // Truthiness instead of an explicit false: `verified: 0` or a missing mark
  // would both read as late.
  { name: 'M3  the mark is read for truthiness',
    anchor: "    return odds?._kickoff?.verified === false;",
    replace: "    return !odds?._kickoff?.verified;",
    expect: 'an unmarked blob is not KNOWN post-kickoff' },

  // Order reversed: opening would win even when a verified closing line exists,
  // throwing away the better price on every correct row.
  { name: 'M4  opening is preferred over closing',
    anchor: "    for (const source of ['closing', 'opening']) {",
    replace: "    for (const source of ['opening', 'closing']) {",
    expect: 'a verified closing line is taken' },

  // No fallback at all: a late closing line would leave the row priceless
  // rather than falling back to the opening one.
  { name: 'M5  the fallback to opening is removed',
    anchor: "    for (const source of ['closing', 'opening']) {",
    replace: "    for (const source of ['closing']) {",
    expect: 'a blob marked post-kickoff is skipped' },

  // Confidence inflated: prose that demands `verified` would print an unproven
  // number as a closing line.
  { name: 'M6  every blob reports verified',
    anchor: "        const confidence = odds?._kickoff?.verified === true ? 'verified' : 'unknown';",
    replace: "        const confidence = 'verified';",
    expect: 'confidence is unknown without a mark' },

  // The winner side stops depending on who won.
  { name: 'M7  the winning side is always home',
    anchor: "    const winnerPrice = hWon ? (ml.home ?? ml.h ?? ml[0]) : (ml.away ?? ml.a ?? ml[1]);",
    replace: "    const winnerPrice = ml.home ?? ml.h ?? ml[0];",
    expect: 'the winner price comes off the away side when away won' },

  // Both consumers stop honouring the selection and read closing directly.
  { name: 'M8  the spread bypasses the selection rule',
    anchor: "export function lineSpread(game, opts) {\n    const { odds } = selectLineOdds(game, opts);",
    replace: "export function lineSpread(game, opts) {\n    const odds = parseOddsJSON(game?.closing_odds) || parseOddsJSON(game?.opening_odds);",
    expect: 'the spread ignores a late closing blob' },

  { name: 'M9  the moneyline bypasses the selection rule',
    anchor: "export function winnerMoneylinePrice(game, opts) {\n    const { odds } = selectLineOdds(game, opts);",
    replace: "export function winnerMoneylinePrice(game, opts) {\n    const odds = parseOddsJSON(game?.closing_odds) || parseOddsJSON(game?.opening_odds);",
    expect: 'winner ML follows the selection rule' },

  // A parse failure that throws instead of yielding null would take the whole
  // analytics phase down rather than falling through.
  { name: 'M10  an unparseable blob stops being tolerated',
    anchor: "    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return null; }",
    replace: "    return typeof raw === 'string' ? JSON.parse(raw) : raw;",
    expect: 'an unparseable blob yields no odds' },

  // late_minutes acquiring a value where there is no mark would make the probe
  // print "0 min late" for rows that were never measured (Rule 99).
  { name: 'M11  late_minutes defaults to zero',
    anchor: "    const n = odds?._kickoff?.late_minutes;\n    return Number.isFinite(n) ? n : null;",
    replace: "    const n = odds?._kickoff?.late_minutes;\n    return Number.isFinite(n) ? n : 0;",
    expect: 'late_minutes is null without a mark' },

  // The skipped list is what tells a caller WHY a price is missing.
  { name: 'M12  the skipped blob stops being named',
    anchor: "{ skipped.push(source); continue; }",
    replace: "{ continue; }",
    expect: 'the skipped blob is named' },
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
