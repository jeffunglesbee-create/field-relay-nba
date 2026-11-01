#!/usr/bin/env node
// Rule 90 for scripts/cfl-abort-experiment.mjs: each mutation breaks one clause of the arithmetic that the CC-CMD's P5 conclusion rests on, and the self-test must go red.
// Each asserts its anchor is unique and applied before reporting a result. Mutates in place and restores; needs the file's changes staged or committed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const FILE = 'scripts/cfl-abort-experiment.mjs';
if (spawnSync('git', ['diff', '--quiet', '--', FILE]).status !== 0) { console.log(`FAIL — ${FILE} has unstaged changes; restoring would lose them.`); process.exit(1); }
if (spawnSync('node', [FILE, '--self-test'], { stdio: 'ignore' }).status !== 0) { console.log(`FAIL — ${FILE} --self-test is already red on clean source.`); process.exit(1); }
console.log(`baseline: ${FILE} --self-test passes on clean source\n`);

const M = [
  ['B1 the approval gate is removed', "if (process.env.APPROVAL !== APPROVAL_TEXT) {", "if (false) {", 'a run with no approval sends GET /cfl/odds-probs, which charges credits'],
  ['B2 aborted calls are made on a cache that was not confirmed warm', "if (confirm.status !== 200 || !confirm.body || confirm.body.cached !== 'HIT') return stop('cache-not-warm');", "if (confirm.status !== 200 || !confirm.body) return stop('cache-not-warm');", 'each aborted call is then a cold call: 6 credits at the vendor apiece'],
  ['B3 a failed warm-up does not stop the run', "if (warm.status !== 200 || !warm.body || warm.body.ok !== true) return stop('warm-up-failed');", "", 'the run goes on to spend against a relay that is failing'],
  ['B4 a moving ledger is not inconclusive', "if (!quiet) return", "if (false) return", 'real traffic is read as lost refunds'],
  ['B5 an abort that did not take effect is not inconclusive', "if (effective < k) return", "if (false) return", 'calls that completed are counted as aborted'],
  ['B6 a moving control phase is not inconclusive', "if (controlDelta.by_site !== 0 || controlDelta.kept !== 0) return", "if (false) return", 'something else writing to the ledger is read as the abort'],
  ['B7 kept moving in the aborted phase is allowed', " || abortDelta.kept !== 0) return { verdict: 'inconclusive:unexpected-delta'", ") return { verdict: 'inconclusive:unexpected-delta'", 'a cold call inside the aborted phase is read as a lost refund'],
  ['B8 a negative delta is allowed', "!Number.isInteger(lostRefunds) || lostRefunds < 0", "!Number.isInteger(lostRefunds)", 'a refund landing late reads as no loss'],
  ['B9 missing tallies are not counted', "const missingTallies = k - abortDelta.hit;", "const missingTallies = 0;", 'the cancelled-continuation signature is lost'],
  ['B10 a missing CFL line reads as zero', "if (typeof by !== 'number') throw", "if (false) throw", 'a body that lost the site reads as a ledger of 0'],
  ['B11 a missing reconcile block reads as empty', "if (!Array.isArray(d.reconcile)) throw", "if (false) throw", 'kept and n read as 0'],
  ['B12 the over-record left is not stated', "art.ledger_overrecord_left_credits = abortDelta.by_site > 0 ? abortDelta.by_site : 0;", "art.ledger_overrecord_left_credits = 0;", 'the vendor watch\'s residual for that window cannot be corrected by hand'],
  ['B13 the aborted phase is measured from before the warm-up', "const abortDelta = diff(art.ledgers.start, art.ledgers.after_aborts);", "const abortDelta = diff(art.ledgers.before_b, art.ledgers.after_aborts);", 'the warm-up\'s own cold-call charge is read as a lost refund'],
  ['B14 an unquiet comparison is always quiet', "const quiet = JSON.stringify(art.ledgers.before_a) === JSON.stringify(art.ledgers.before_b);", "const quiet = true;", 'same as B4, at the source'],
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
