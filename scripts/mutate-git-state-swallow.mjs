#!/usr/bin/env node
// Rule 90 for scripts/check-git-state-swallow.mjs. A ratchet that cannot detect
// a new offender is a list, not a gate.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const CHECK = 'scripts/check-git-state-swallow.mjs';
// A real workflow, mutated and restored — not a fixture. The check reads the
// directory, so a fixture elsewhere would prove nothing about what it scans.
const VICTIM = '.github/workflows/deploy.yml';
const BAK = `${VICTIM}.mutbak`;

const MUTATIONS = [
  { name: 'G1  a ninth workflow starts swallowing a failed pull',
    file: VICTIM,
    // Anchored on the job key, not on `uses: actions/checkout@v4` — that line
    // appears twice in this file and the harness reported ANCHOR occurs 2 times
    // rather than mutating one of them at random.
    anchor: 'jobs:\n  deploy:',
    replace: 'jobs:\n  deploy:\n    run: git pull --rebase --autostash origin main || true',
    expect: 'no NEW workflow swallows a mutating git failure' },

  { name: 'G2  the recover-then-swallow form is NOT flagged (it recovers)',
    file: VICTIM,
    anchor: 'jobs:\n  deploy:',
    replace: 'jobs:\n  deploy:\n    run: git pull --rebase --autostash origin main || git rebase --abort || true',
    expect: null },   // must stay green

  { name: 'G3  a swallow inside a comment is not code',
    file: VICTIM,
    anchor: 'jobs:\n  deploy:',
    replace: 'jobs:\n  deploy:\n    # git pull --rebase --autostash origin main || true',
    expect: null },   // must stay green
];

let bad = 0;
for (const m of MUTATIONS) {
  const before = readFileSync(m.file, 'utf8');
  const hits = before.split(m.anchor).length - 1;
  if (hits !== 1) {
    bad++;
    console.error(`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s), expected 1. NOTHING WAS MUTATED.`);
    continue;
  }
  copyFileSync(m.file, BAK);
  writeFileSync(m.file, before.replace(m.anchor, m.replace));
  let out = '', code = 0;
  try { out = execFileSync('node', [CHECK], { encoding: 'utf8' }); }
  catch (e) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`; }
  finally { copyFileSync(BAK, m.file); unlinkSync(BAK); }
  const red = out.split('\n').filter(l => l.startsWith('FAIL'));
  if (m.expect === null) {
    if (code !== 0) { bad++; console.error(`  FALSE POSITIVE  ${m.name}\n${red.join('\n')}`); }
    else console.log(`  stayed green  ${m.name}`);
    continue;
  }
  if (code === 0) { bad++; console.error(`  NOT CAUGHT  ${m.name}`); }
  else if (!red.some(l => l.includes(m.expect))) {
    bad++; console.error(`  WRONG REASON  ${m.name}\n${red.join('\n')}`);
  } else console.log(`  caught  ${m.name}\n          by "${m.expect}" (${red.length} red)`);
}

execFileSync('node', ['-e', `require('fs').readFileSync('${VICTIM}','utf8')`]);
console.log(`\nran ${MUTATIONS.length} mutation(s) against ${CHECK}; ${VICTIM} restored`);
process.exit(bad ? 1 : 0);
