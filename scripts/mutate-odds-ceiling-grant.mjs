#!/usr/bin/env node
// Rule 90 for scripts/check-odds-ceiling-grant.mjs.
//
// R1 is the whole point: it does what a hurried session would do — raise the
// standing constant instead of granting a day — and the check must refuse it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const CHECK = 'scripts/check-odds-ceiling-grant.mjs';
const SRC = 'src/budget-helpers.js';
const sh = (c, a, t = 60000) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: t });

const dirty = sh('git', ['status', '--porcelain', '--', SRC]).trim();
if (dirty) { console.error(`FAIL — ${SRC} is dirty; refusing to mutate.\n${dirty}`); process.exit(1); }

const MUTATIONS = [
  { name: 'R1  the standing ceiling is raised instead of a day being granted',
    anchor: 'const ODDS_DAILY_CEILING = 3800;',
    replace: 'const ODDS_DAILY_CEILING = 6300;',
    expect: 'the standing ceiling is still 3800' },
  { name: 'R2  the grant loses its date and applies every day',
    anchor: "    { date: '2026-09-13', extra: 2500, why: 'tranche 2 archive backfill, owner-approved' },",
    replace: "    { date: '*', extra: 2500, why: 'tranche 2 archive backfill, owner-approved' },",
    expect: 'granted day carries the extra' },
  { name: 'R3  the readout drifts from the guard again',
    anchor: '        const ceiling = _dailyCeiling(date);',
    replace: '        const ceiling = ODDS_DAILY_CEILING;',
    expect: 'peekDailyOdds computes the ceiling from the grant table' },
  { name: 'R4  the guard checks the standing ceiling, ignoring the grant',
    anchor: '        const ceiling = _dailyCeiling();',
    replace: '        const ceiling = ODDS_DAILY_CEILING;',
    expect: 'the guard compares against the granted ceiling' },
  { name: 'R5  a grant arrives with no stated reason',
    anchor: "why: 'tranche 2 archive backfill, owner-approved' }",
    replace: "why: '' }",
    expect: 'every grant says why it exists' },
  { name: 'R6  an unbounded grant',
    anchor: 'extra: 2500,',
    replace: 'extra: 500000,',
    expect: 'every grant is bounded' },
];

let bad = 0;
for (const m of MUTATIONS) {
  const before = fs.readFileSync(SRC, 'utf8');
  const hits = before.split(m.anchor).length - 1;
  if (hits !== 1) {
    bad++; console.error(`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s), expected 1. NOTHING WAS MUTATED.`);
    continue;
  }
  fs.writeFileSync(SRC, before.replace(m.anchor, m.replace));
  if (!fs.readFileSync(SRC, 'utf8').includes(m.replace)) {
    bad++; console.error(`  NOTAPPLIED  ${m.name}`); sh('git', ['checkout', '--', SRC]); continue;
  }
  let out = '', code = 0;
  try { out = sh('node', [CHECK]); }
  catch (e) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`; }
  sh('git', ['checkout', '--', SRC]);

  if (code === 0) { bad++; console.error(`  NOT CAUGHT  ${m.name}\n          the check still passed.`); }
  else if (!(out.match(/^FAIL {2}.*$/gm) || []).some(l => l.includes(m.expect))) {
    bad++; console.error(`  WRONG REASON  ${m.name}\n          failed, but no FAIL line mentioned "${m.expect}".\n${out.slice(0, 600)}`);
  } else {
    console.log(`  caught  ${m.name}\n          by "${m.expect}"`);
  }
}

const post = sh('git', ['status', '--porcelain', '--', SRC]).trim();
if (post) { console.error(`FAIL — ${SRC} not restored:\n${post}`); process.exit(1); }
console.log(`\nran ${MUTATIONS.length} mutation(s) against ${CHECK}; ${SRC} restored clean`);
if (bad) { console.error(`FAIL — ${bad} mutation(s) not caught.`); process.exit(1); }
console.log('PASS');
