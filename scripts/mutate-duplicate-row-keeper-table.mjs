#!/usr/bin/env node
// Rule 90 harness for scripts/check-duplicate-row-keeper-table.mjs.
//
// Every mutation is a mistake that would produce a WRONG DELETE — the output of
// this classifier feeds a destructive action, so "the check passed" is not
// enough; each rule has to be shown to be load-bearing.
//
// Asserts its anchor is unique and its effect present before any verdict.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SRC = 'scripts/duplicate-row-keeper-table.mjs';
const CHECK = 'scripts/check-duplicate-row-keeper-table.mjs';
const BAK = `${SRC}.mutbak`;

const MUTATIONS = [
  { name: 'K1  a 0-0 result read as no result',
    anchor: 'const scored = r => r.home_score != null || r.away_score != null;',
    replace: 'const scored = r => !!r.home_score || !!r.away_score;',
    expect: 'a 0-0 result is a result, not an absence' },

  { name: 'K2  disagreeing scores resolved instead of escalated',
    anchor: '  if (scored(a) && scored(b) && !sameScore(a, b))\n    return { verdict: \'HUMAN\', keeper: null, stale: null,',
    replace: '  if (scored(a) && scored(b) && !sameScore(a, b))\n    return { verdict: \'KEEP_SCORED\', keeper: a.id, stale: b.id,',
    expect: 'disagreeing scores are never auto-resolved' },

  { name: 'K3  the rule assumes the keeper is the first row',
    anchor: '    const k = scored(a) ? a : b, s = scored(a) ? b : a;',
    replace: '    const k = a, s = b;',
    expect: 'order does not decide it' },

  { name: 'K4  join safety stops blocking a delete',
    anchor: '    const blocked = !!(staleRow && staleRow.briefs_referencing > 0);',
    replace: '    const blocked = false;',
    expect: 'but it is not deletable' },

  { name: 'K5  a HUMAN verdict becomes deletable',
    anchor: '      deletable: !!(dec.stale && !blocked),',
    replace: '      deletable: !blocked,',
    expect: 'a HUMAN verdict is never deletable' },

  { name: 'K6  two ESPN anchors silently pick the first',
    anchor: "    if (withEspn.length === 1)\n      return { verdict: 'KEEP_ESPN', keeper: withEspn[0].id,",
    replace: "    if (withEspn.length >= 1)\n      return { verdict: 'KEEP_ESPN', keeper: withEspn[0].id,",
    expect: 'two ESPN anchors distinguish nothing' },
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
  try { out = execFileSync('node', [CHECK], { encoding: 'utf8' }); }
  catch (e) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`; }
  finally { copyFileSync(BAK, SRC); unlinkSync(BAK); }
  const red = out.split('\n').filter(l => l.startsWith('FAIL'));
  if (code === 0) {
    bad++;
    console.error(`  NOT CAUGHT  ${m.name}\n          check still passed with the mutation applied`);
  } else if (!red.some(l => l.includes(m.expect))) {
    bad++;
    console.error(`  WRONG REASON  ${m.name}\n          went red, but no FAIL line mentioned "${m.expect}".\n${red.join('\n') || out.slice(0, 600)}`);
  } else {
    console.log(`  caught  ${m.name}\n          by "${m.expect}" (${red.length} assertion(s) red)`);
  }
}

execFileSync('node', ['--check', SRC]);
console.log(`\nran ${MUTATIONS.length} mutation(s) against ${CHECK}; ${SRC} restored and parsing`);
process.exit(bad ? 1 : 0);
