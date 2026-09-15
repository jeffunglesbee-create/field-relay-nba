#!/usr/bin/env node
// Rule 90 harness for scripts/check-odds-capture-provenance.mjs.
//
// The dangerous mutations are the quiet ones: a mark that claims decidability
// it does not have, and a marker that silently rewrites captured_at or drops
// _kickoff. Each would replace one unprovable claim with another while every
// row still looked marked.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SRC = 'src/odds-capture-provenance.js';
const CHECK = 'scripts/check-odds-capture-provenance.mjs';
const BAK = `${SRC}.mutbak`;

const MUTATIONS = [
  // THE CLAIM THIS MODULE EXISTS TO AVOID. Every row becomes decidable and the
  // EPL case silently reacquires a verdict nothing supports.
  { name: 'P1  decidability is asserted rather than derived',
    anchor: "    return w < k;",
    replace: "    return true;",
    expect: 'a kickoff INSIDE the window is not decidable' },

  // Off-by-one at the boundary: a kickoff exactly at noon is not after the
  // window, and <= would call it decidable.
  { name: 'P2  the window edge counts as decided',
    anchor: "    return w < k;",
    replace: "    return w <= k;",
    expect: 'a kickoff exactly at the window edge is not decidable' },

  // Rule 99: an unreadable input becomes a positive answer.
  { name: 'P3  a missing kickoff reads as decidable',
    anchor: "    if (!Number.isFinite(w) || !Number.isFinite(k)) return false;",
    replace: "    if (!Number.isFinite(w) || !Number.isFinite(k)) return true;",
    expect: 'no kickoff means not decidable' },

  // TOO EAGER. The vendor's own snapshot time starts reading as a run clock,
  // and honest rows acquire a mark saying they are not measurements.
  { name: 'P4  any stamp counts as a run clock',
    anchor: "    return /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/.test(String(capturedAt || ''));",
    replace: "    return !!capturedAt;",
    expect: "the vendor's whole-second form is not a run clock" },

  // Unanchored regex: a stamp with trailing text matches.
  { name: 'P5  the run-clock test loses its anchors',
    anchor: "    return /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/.test(String(capturedAt || ''));",
    replace: "    return /\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z/.test(String(capturedAt || ''));",
    expect: 'a stamp with trailing text is not matched' },

  // TOO TIMID. Nothing is ever marked, which is the state that produced 58
  // unattributable rows.
  { name: 'P6  nothing is ever marked',
    anchor: "    if (!isRunClockStamp(odds.captured_at)) return null;   // nothing to say",
    replace: "    return null;",
    expect: 'the mark says the stamp is not a measurement' },

  // THE SILENT REPAIR. captured_at is overwritten with the window, which is
  // exactly the move the verification refused.
  { name: 'P7  the marker repairs captured_at after all',
    anchor: "    return { ...odds, _capture: mark };",
    replace: "    return { ...odds, captured_at: mark.window_end, _capture: mark };",
    expect: 'captured_at is NOT repaired' },

  // _kickoff dropped by a spread that rebuilds rather than copies.
  { name: 'P8  _kickoff is dropped while marking',
    anchor: "    return { ...odds, _capture: mark };",
    replace: "    const { _kickoff, ...rest } = odds; return { ...rest, _capture: mark };",
    expect: '_kickoff is carried through untouched' },

  // In-place mutation: the caller's object changes under it.
  { name: 'P9  the blob is mutated in place',
    anchor: "    return { ...odds, _capture: mark };",
    replace: "    odds._capture = mark; return odds;",
    expect: 'the input blob is not mutated' },

  // A non-ISO date yields a window anyway, so the mark carries a nonsense
  // boundary that decidability is then computed from.
  { name: 'P10  any date yields a window',
    anchor: "    return /^\\d{4}-\\d{2}-\\d{2}$/.test(String(date || '')) ? `${date}T12:00:00Z` : null;",
    replace: "    return date ? `${date}T12:00:00Z` : null;",
    expect: 'a non-ISO date yields no window' },

  // Idempotence broken: a re-run rewrites every row it already marked.
  { name: 'P11  a marked blob stops reporting itself marked',
    anchor: "    return !!(odds && typeof odds === 'object' && odds._capture\n              && odds._capture.measured === false);",
    replace: "    return false;",
    expect: 'a marked blob reports itself marked' },

  // A mark asserting the opposite is accepted as this one.
  { name: 'P12  any _capture counts as this mark',
    anchor: "              && odds._capture.measured === false);",
    replace: "              );",
    expect: 'a mark asserting measurement is not this mark' },
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
