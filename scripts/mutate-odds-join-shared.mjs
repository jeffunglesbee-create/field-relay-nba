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
    const mutant = path.join(tmp, path.basename(file));
    fs.writeFileSync(mutant, src.replace(anchor, repl));
    if (!fs.readFileSync(mutant, 'utf8').includes(repl)) { console.log(`NOTAPPLIED  ${name}`); continue; }
    const r = spawnSync(process.execPath, [CHECK], { encoding: 'utf8', env: { ...process.env, INDEX_SRC: mutant } });
    const red = (r.stdout.match(/^FAIL  \S+/gm) || []).map((l) => l.slice(6));
    if (r.status === 0) console.log(`NOT CAUGHT  ${name}`);
    else if (!red.includes(expect)) console.log(`HARNESS ERROR ${name}: red ${JSON.stringify(red)}, wanted ${expect}\n${(r.stderr || '').slice(0, 300)}`);
    else { caught++; console.log(`CAUGHT      ${name} by ${expect}${red.length > 1 ? ` (also ${red.filter((x) => x !== expect).join(', ')})` : ''}`); }
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`\n${caught} of ${M.length} mutations caught.`);
console.log('COVERAGE: the after-kickoff refusal and the start_time it needs, in snapshotCronOdds and');
console.log('runOddsBackfillForDate (src/index.js). Mutants are copies; the tree is not modified.');
process.exit(caught === M.length ? 0 : 1);
