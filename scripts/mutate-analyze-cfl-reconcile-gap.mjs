#!/usr/bin/env node
// Rule 90 for scripts/analyze-cfl-reconcile-gap.mjs: each mutation breaks one clause of the arithmetic that the CC-CMD's P5 conclusion rests on, and the self-test must go red.
// Each asserts its anchor is unique and applied before reporting a result. Mutates in place and restores; needs the file's changes staged or committed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const FILE = 'scripts/analyze-cfl-reconcile-gap.mjs';
if (spawnSync('git', ['diff', '--quiet', '--', FILE]).status !== 0) { console.log(`FAIL — ${FILE} has unstaged changes; restoring would lose them.`); process.exit(1); }
if (spawnSync('node', [FILE, '--self-test'], { stdio: 'ignore' }).status !== 0) { console.log(`FAIL — ${FILE} --self-test is already red on clean source.`); process.exit(1); }
console.log(`baseline: ${FILE} --self-test passes on clean source\n`);

const M = [
  ['A1 kept sums every site, not this one', "const kept = sumBy(rec, (r) => r.credits_kept);", "const kept = sumBy(s.reconcile || [], (r) => r.credits_kept);", 'another site\'s kept credits are subtracted from CFL\'s by_site'],
  ['A2 hit counts every row', "const hit = sumBy(rec.filter((r) => r.cache === 'HIT'), (r) => r.n);", "const hit = sumBy(rec, (r) => r.n);", 'the gap is said to move with cache hits because every call is a hit'],
  ['A3 the gap is by_site + kept', "gap: by - kept,", "gap: by + kept,", 'sign'],
  ['A4 a sample AT t is still bounded by the next one', "hi: before && before.at === t ? lo : (after ? after.gap : lo)", "hi: after ? after.gap : lo", 'the window bounds widen by a whole sample when a reading coincides with one'],
  ['A5 the window across midnight drops the rest of day 1', "return { lo: Math.max(0, fin - a.hi) + b.lo, hi: Math.max(0, fin - a.lo) + b.hi };", "return { lo: b.lo, hi: b.hi };", 'a window that spans UTC midnight loses the evening burst'],
  ['A6 the residual has the wrong sign', "residual: vendor - ledger - ci", "residual: ledger - vendor - ci", 'negative would mean under-recorded'],
  ['A7 CI that cannot be read is zero', "return m ? Number(m[1]) : null;", "return m ? Number(m[1]) : 0;", 'a window with unreadable CI spend reads as measured (the old watch defect)'],
  ['A8 pearson of a constant column is 0', "return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);", "return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);", 'an undefined correlation reads as \"no correlation\"'],
  ['A9 pearson accepts two points', "if (n < 3) return null;", "if (n < 2) return null;", 'two points always give r = +-1'],
];
let caught = 0;
for (const [name, anchor, replace, why] of M) {
  const src = fs.readFileSync(FILE, 'utf8');
  const hits = src.split(anchor).length - 1;
  if (hits !== 1) { console.log(`FAIL       ${name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`); continue; }
  if (anchor === replace) { console.log(`FAIL       ${name}\n            replacement equals the anchor — NOTHING MUTATED.`); continue; }
  fs.writeFileSync(FILE, src.replace(anchor, () => replace));
  const run = spawnSync('node', [FILE, '--self-test'], { encoding: 'utf8', timeout: 60000 });
  const fails = String(run.stdout ?? '').split('\n').filter((l) => l.includes('FAIL'));
  const red = run.status !== 0 && fails.length > 0;   // a crash, a syntax error or a timeout is BROKE, not CAUGHT: an assertion must have fired
  fs.writeFileSync(FILE, src);
  console.log(`${red ? 'CAUGHT    ' : run.status !== 0 ? 'BROKE     ' : 'NOT CAUGHT'} ${name}\n            (${why})${red ? `\n            <- ${fails[0].trim().slice(0, 120)}` : ''}`);
  if (red) caught++;
}
console.log(`\n${caught} of ${M.length} mutations caught.`);
process.exit(caught === M.length ? 0 : 1);
