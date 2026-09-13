#!/usr/bin/env node
// Rule 90. The first mutation restores `.catch(() => {})` — the defect exactly
// as it shipped. A test for a handler that cannot detect the handler's absence
// is worth nothing, and this one was written after the fix.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const SRC = 'src/ambient-do.js';
const sh = (c, a, timeout) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...(timeout ? { timeout } : {}) });
const dirty = sh('git', ['status', '--porcelain', '--', SRC]).trim();
if (dirty) { console.error(`FAIL — ${SRC} is dirty; refusing to mutate.\n${dirty}`); process.exit(1); }

const MUTATIONS = [
  { name: 'A1  the handler reverts to .catch(() => {}) — the defect as it shipped',
    anchor: '        this.ctx.storage.setAlarm(Date.now() + delayMs).catch(e => {',
    replace: '        this.ctx.storage.setAlarm(Date.now() + delayMs).catch(() => {}); if (false) (e => {',
    expect: 'the rejection is logged, not swallowed' },
  { name: 'A2  the retry guard is dropped — it would loop forever',
    anchor: '            if (_isRetry) {',
    replace: '            if (false) {',
    expect: 'retries EXACTLY once' },
  { name: 'A3  the retry is removed — one attempt, then silence',
    anchor: '            this._scheduleAlarm(delayMs, true);',
    replace: '            /* no retry */',
    expect: 'retries EXACTLY once' },
  { name: 'A4  the delay is dropped from the log',
    anchor: 'console.error(`[AmbientDO] setAlarm failed id=${id} delayMs=${delayMs}: ${msg} — retrying once`);',
    replace: 'console.error(`[AmbientDO] setAlarm failed id=${id}: ${msg} — retrying once`);',
    expect: 'FIRST-failure log names the delay' },
];

let bad = 0;
for (const m of MUTATIONS) {
  const before = fs.readFileSync(SRC, 'utf8');
  const hits = before.split(m.anchor).length - 1;
  if (hits !== 1) {
    bad++; console.error(`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s), expected 1. NOTHING WAS MUTATED — harness defect, not a result.`);
    continue;
  }
  fs.writeFileSync(SRC, before.replace(m.anchor, m.replace));
  if (!fs.readFileSync(SRC, 'utf8').includes(m.replace)) {
    bad++; console.error(`  NOTAPPLIED  ${m.name}`); sh('git', ['checkout', '--', SRC]); continue;
  }

  // A timeout, because a mutation can make the CHECK hang rather than fail:
  // removing the _isRetry guard sent the retry into infinite recursion, the
  // harness stuck, and the mutated file stayed on disk. A hang is a caught
  // mutation — the check certainly did not pass — but it is reported as HUNG
  // rather than folded into "caught", because a stuck job in CI is its own
  // problem and must be visible as one.
  let out = '', code = 0, hung = false;
  try { out = sh('node', ['scripts/check-ambient-alarm-failure.mjs'], 20000); }
  catch (e) {
    code = e.status ?? 1;
    out = `${e.stdout || ''}${e.stderr || ''}`;
    if (e.killed || e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT') { hung = true; code = code || 1; }
  }
  sh('git', ['checkout', '--', SRC]);

  if (hung) { console.log(`  caught  ${m.name}\n          the check HUNG (mutation made it non-terminating) — restored`); continue; }

  if (code === 0) { bad++; console.error(`  NOT CAUGHT  ${m.name}\n          the check still passed.`); }
  else if (!out.includes(m.expect)) {
    bad++; console.error(`  WRONG REASON  ${m.name}\n          failed, but nothing mentioned "${m.expect}". Output:\n${out}`);
  } else {
    console.log(`  caught  ${m.name}\n          by "${m.expect}"`);
  }
}

const post = sh('git', ['status', '--porcelain', '--', SRC]).trim();
if (post) { console.error(`FAIL — ${SRC} not restored:\n${post}`); process.exit(1); }
console.log(`\nran ${MUTATIONS.length} mutation(s) against scripts/check-ambient-alarm-failure.mjs; each asserted `
          + `its anchor unique and its effect present before the verdict; ${SRC} restored clean`);
if (bad) { console.error(`FAIL — ${bad} mutation(s) not caught or not applied.`); process.exit(1); }
console.log('PASS');
