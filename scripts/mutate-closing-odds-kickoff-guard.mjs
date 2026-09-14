#!/usr/bin/env node
// Rule 90 harness for scripts/check-closing-odds-kickoff-guard.mjs.
// Each mutation is a way a writer could go back to stamping a post-kickoff
// price as the close, or to losing the record of having done so.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const CHECK = 'scripts/check-closing-odds-kickoff-guard.mjs';

const MUTATIONS = [
  { file: 'src/index.js',
    name: 'K1  the relay stops gating the write on the kickoff comparison',
    anchor: 'if (odds && _preKickoff) {',
    replace: 'if (odds) {',
    expect: 'and the write is gated on it' },

  // THE DEFECT THAT SHIPPED IN THE PROBE THAT FOUND THIS ONE. As text, 'Z'
  // (0x5A) sorts above ':' (0x3A), so `...20:05:30.000Z` < `...20:05Z` and a
  // capture thirty seconds after a minute-precision kickoff reads as before it.
  { file: 'src/index.js',
    name: 'K2  the comparison goes back to comparing text',
    anchor: 'const _capMs = Date.parse(odds?.captured_at ?? \'\');',
    replace: 'const _capMs = odds?.captured_at ?? \'\';',
    expect: 'on parsed instants, not on strings' },

  // NaN fails every comparison. Without the finite check the guard would pass
  // an unreadable date straight through as "not after kickoff".
  { file: 'src/index.js',
    name: 'K3  an unreadable date stops refusing the write',
    anchor: '                                        const _preKickoff = Number.isFinite(_capMs)\n                                                         && Number.isFinite(_kickMs)\n                                                         && _capMs < _kickMs;',
    replace: '                                        const _preKickoff = !(_capMs >= _kickMs);',
    expect: 'and an unreadable date refuses the write rather than allowing it' },

  { file: '.github/scripts/odds-backfill.js',
    name: 'K4  the backfill writes closing_odds from an invented captured_at again',
    anchor: "    const fields = (isPast && measuredCapture)\n      ? ['opening_odds', 'closing_odds'] : ['opening_odds'];",
    replace: "    const fields = isPast ? ['opening_odds', 'closing_odds'] : ['opening_odds'];",
    expect: 'and writes closing_odds only when the snapshot time was measured' },

  { file: '.github/scripts/odds-backfill.js',
    name: 'K5  the measured/fabricated distinction is collapsed',
    anchor: '    const measuredCapture = row.snapshot_time || null;',
    replace: '    const measuredCapture = row.snapshot_time || new Date().toISOString();',
    expect: 'the backfill distinguishes a measured snapshot time from a fabricated one' },

  // Removing the fallback entirely would silently drop opening_odds coverage
  // for every row with no snapshot time. The gate pins it in place.
  { file: '.github/scripts/odds-backfill.js',
    name: 'K6  opening_odds loses its fallback and its coverage with it',
    anchor: '      captured_at: measuredCapture || new Date().toISOString(),',
    replace: '      captured_at: measuredCapture,',
    expect: 'while opening_odds keeps its fallback' },

  { file: '.github/scripts/odds-backfill.js',
    name: 'K7  the change_log failure goes back to being swallowed',
    anchor: '          ).catch(e => {',
    replace: '          ).catch(() => {}); if (0) (e => {',
    expect: 'a failed change_log insert is reported, not swallowed' },
];

let bad = 0;
for (const m of MUTATIONS) {
  const before = readFileSync(m.file, 'utf8');
  const hits = before.split(m.anchor).length - 1;
  if (hits !== 1) {
    bad++;
    console.error(`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s) in ${m.file}, expected 1. NOTHING WAS MUTATED.`);
    continue;
  }
  const after = before.replace(m.anchor, m.replace);
  if (after === before) { bad++; console.error(`  NO EFFECT  ${m.name}`); continue; }
  const bak = `${m.file}.mutbak`;
  copyFileSync(m.file, bak);
  writeFileSync(m.file, after);
  let out = '', code = 0;
  try { out = execFileSync('node', [CHECK], { encoding: 'utf8' }); }
  catch (e) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`; }
  finally { copyFileSync(bak, m.file); unlinkSync(bak); }
  const red = out.split('\n').filter(l => l.startsWith('FAIL'));
  if (code === 0) { bad++; console.error(`  NOT CAUGHT  ${m.name}`); }
  else if (!red.some(l => l.includes(m.expect))) {
    bad++;
    console.error(`  WRONG REASON  ${m.name}\n          no FAIL line mentioned "${m.expect}".\n${red.join('\n')}`);
  } else console.log(`  caught  ${m.name}\n          by "${m.expect}" (${red.length} red)`);
}

for (const f of ['src/index.js', '.github/scripts/odds-backfill.js'])
  execFileSync('node', ['--check', f]);
console.log(`\nran ${MUTATIONS.length} mutation(s) against ${CHECK}; both writers restored and parsing`);
process.exit(bad ? 1 : 0);
