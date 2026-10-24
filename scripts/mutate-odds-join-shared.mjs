#!/usr/bin/env node
// Rule 90 for scripts/check-odds-join-shared.mjs. Each mutation restores a
// state the check exists to end, in a COPY of the source (the tree is never
// touched), asserts its anchor is unique and the replacement is in the copy,
// and counts as caught only when the scenario it names prints FAIL. A crash or
// a different scenario going red is reported, not counted.
//
//   node scripts/mutate-odds-join-shared.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(ROOT, 'scripts/check-odds-join-shared.mjs');
const INDEX = path.join(ROOT, 'src/index.js');
const JOIN = path.join(ROOT, 'src/odds-join.js');

const M = [
  ['X6 the cron forgets the row\'s kickoff', INDEX,
   '        if (kickoffMark(odds.captured_at, row.start_time).late_minutes !== null\n            || kickoffMark(odds.captured_at, og.commence_time).late_minutes !== null) continue;',
   '        if (false\n            || kickoffMark(odds.captured_at, og.commence_time).late_minutes !== null) continue;', 'R1'],
  ['X7 the cron forgets the vendor\'s commence', INDEX,
   '            || kickoffMark(odds.captured_at, og.commence_time).late_minutes !== null) continue;',
   '            || false) continue;', 'R2'],
  ['X8 the cron stops selecting start_time', INDEX,
   '        `SELECT id, home, away, start_time FROM ${table}',
   '        `SELECT id, home, away FROM ${table}', 'R1'],
  ['B1 the backfill forgets the row\'s kickoff', INDEX,
   '        if (kickoffMark(odds.captured_at, row.start_time).late_minutes !== null\n            || kickoffMark(odds.captured_at, og.commence_time).late_minutes !== null) { oddsSkipped++; continue; }',
   '        if (false\n            || kickoffMark(odds.captured_at, og.commence_time).late_minutes !== null) { oddsSkipped++; continue; }', 'R3'],
  ['B2 the backfill forgets the vendor\'s commence', INDEX,
   '            || kickoffMark(odds.captured_at, og.commence_time).late_minutes !== null) { oddsSkipped++; continue; }',
   '            || false) { oddsSkipped++; continue; }', 'R4'],
  ['B3 the backfill stops selecting start_time for regular-season rows', INDEX,
   '    `SELECT id, sport, league, home, away, start_time FROM regular_season_games',
   '    `SELECT id, sport, league, home, away FROM regular_season_games', 'R3'],
  ['B4 the backfill stops selecting start_time for postseason rows', INDEX,
   '    `SELECT id, sport, league, home, away, start_time FROM postseason_games',
   '    `SELECT id, sport, league, home, away FROM postseason_games', 'R5'],
  // THE JOIN (src/odds-join.js) and the kickoff each caller hands it.
  ['X1 the join goes back to whole-pair keys (the miss restored)', JOIN,
   '  return hits.length === 1 ? hits[0] : undefined;',
   '  return index.events.find(e => keyed(home, e.home_team) && keyed(away, e.away_team));', 'J1'],
  ['X2 the kickoff window is dropped', JOIN,
   '    return gap !== null && Math.abs(gap) <= CONTESTED_KICKOFF_MINUTES;',
   '    return true;', 'J4'],
  ['X2b the window is one-sided', JOIN,
   '    return gap !== null && Math.abs(gap) <= CONTESTED_KICKOFF_MINUTES;',
   '    return gap !== null && gap <= CONTESTED_KICKOFF_MINUTES;', 'J4b'],
  ['X3 reversed listings are accepted again', JOIN,
   '  const hits = near.filter(e => same(home, e.home_team) && same(away, e.away_team));',
   '  const hits = near.filter(e => (same(home, e.home_team) && same(away, e.away_team)) || (same(away, e.home_team) && same(home, e.away_team)));', 'J12'],
  ['X4 several candidates take the first', JOIN,
   '  return hits.length === 1 ? hits[0] : undefined;',
   '  return hits[0];', 'J10b'],
  ['X13 name tokens are used without a kickoff', JOIN,
   '  const same = judged ? (a, v) => keyed(a, v) || nameMatches(a, v) : keyed;',
   '  const same = (a, v) => keyed(a, v) || nameMatches(a, v);', 'A3'],
  ['X14 name tokens are never used', JOIN,
   '  const same = judged ? (a, v) => keyed(a, v) || nameMatches(a, v) : keyed;',
   '  const same = keyed;', 'J1'],
  // The refusal at the kickoff instant itself (late_minutes 0), not only after.
  ['X15 the cron refuses only strictly after kickoff', INDEX,
   '        if (kickoffMark(odds.captured_at, row.start_time).late_minutes !== null\n            || kickoffMark(odds.captured_at, og.commence_time).late_minutes !== null) continue;',
   '        if (kickoffMark(odds.captured_at, row.start_time).late_minutes > 0\n            || kickoffMark(odds.captured_at, og.commence_time).late_minutes > 0) continue;', 'R1'],
  ['X16 the backfill refuses only strictly after kickoff', INDEX,
   '        if (kickoffMark(odds.captured_at, row.start_time).late_minutes !== null\n            || kickoffMark(odds.captured_at, og.commence_time).late_minutes !== null) { oddsSkipped++; continue; }',
   '        if (kickoffMark(odds.captured_at, row.start_time).late_minutes > 0\n            || kickoffMark(odds.captured_at, og.commence_time).late_minutes > 0) { oddsSkipped++; continue; }', 'R3'],
  // The harness supplies imports; index.js must too.
  ['X17 index.js stops importing kickoffMark', INDEX,
   "import { stampKickoff, kickoffMark } from './odds-kickoff.js';",
   "import { stampKickoff } from './odds-kickoff.js';", 'I0'],
  // A blob with one team's price twice must not pass as right.
  ['X18 the away price is read from the home team', INDEX,
   '    const a = h2h.outcomes.find(o => o.name === away);',
   '    const a = h2h.outcomes.find(o => o.name === home);', 'J1'],
  ['X9 the closing write does not hand the join its kickoff', INDEX,
   'indexOddsByPair(games), home, away, start_time);',
   'indexOddsByPair(games), home, away);', 'J8'],
  ['X11 the backfill does not hand the join its kickoff', INDEX,
   '        const og = findOddsForRow(oddsIndex, row.home, row.away, row.start_time);\n        if (!og) { oddsSkipped++; continue; }',
   '        const og = findOddsForRow(oddsIndex, row.home, row.away);\n        if (!og) { oddsSkipped++; continue; }', 'J7'],
  ['X12 the cron does not hand the join its kickoff', INDEX,
   '        const og = findOddsForRow(oddsIndex, row.home, row.away, row.start_time);\n        if (!og) continue;',
   '        const og = findOddsForRow(oddsIndex, row.home, row.away);\n        if (!og) continue;', 'J1'],
];

const base = spawnSync(process.execPath, [CHECK], { encoding: 'utf8' });
if (base.status !== 0) { console.log(`BASELINE RED: the check fails on clean source; nothing run.\n${base.stdout}${base.stderr}`); process.exit(1); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutate-odds-join-shared-'));
let caught = 0;
try {
  for (const [name, file, anchor, repl, expect] of M) {
    const src = fs.readFileSync(file, 'utf8');
    const n = src.split(anchor).length - 1;
    if (n !== 1) { console.log(`ANCHOR      ${name}: occurs ${n} times — NOTHING MUTATED`); continue; }
    // The join is imported, so its copy sits beside it in src/ where its own
    // relative imports resolve (ignored by git, .mutant-*), and is removed.
    const isJoin = file === JOIN;
    const mutant = isJoin ? path.join(ROOT, 'src', `.mutant-${process.pid}-odds-join.js`) : path.join(tmp, path.basename(file));
    fs.writeFileSync(mutant, src.replace(anchor, repl));
    let r;
    try {
      if (!fs.readFileSync(mutant, 'utf8').includes(repl)) { console.log(`NOTAPPLIED  ${name}`); continue; }
      r = spawnSync(process.execPath, [CHECK], { encoding: 'utf8',
        env: { ...process.env, ...(isJoin ? { JOIN_SRC: mutant } : { INDEX_SRC: mutant }) } });
    } finally { if (isJoin) fs.rmSync(mutant, { force: true }); }
    const red = (r.stdout.match(/^FAIL  \S+/gm) || []).map((l) => l.slice(6));
    if (r.status === 0) console.log(`NOT CAUGHT  ${name}`);
    else if (!red.includes(expect)) console.log(`HARNESS ERROR ${name}: red ${JSON.stringify(red)}, wanted ${expect}\n${(r.stderr || '').slice(0, 300)}`);
    else { caught++; console.log(`CAUGHT      ${name} by ${expect}${red.length > 1 ? ` (also ${red.filter((x) => x !== expect).join(', ')})` : ''}`); }
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`\n${caught} of ${M.length} mutations caught.`);
console.log('COVERAGE: the after-kickoff refusal and the start_time it needs (snapshotCronOdds and');
console.log('runOddsBackfillForDate), the per-team join (src/odds-join.js), and the kickoff each of the three');
console.log('callers hands it. Mutants are copies; no tracked file is modified.');
process.exit(caught === M.length ? 0 : 1);
