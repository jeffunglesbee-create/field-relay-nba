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
  ['B2 aborted calls are made on a cache that was not confirmed warm', "if (c.status !== 200 || !c.body || c.body.cached !== 'HIT') return stop('cache-not-warm');", "if (c.status !== 200 || !c.body) return stop('cache-not-warm');", 'each aborted call is then a cold call: 6 credits at the vendor apiece'],
  ['B3 a failed warm-up does not stop the run', "if (warm.status !== 200 || !warm.body || warm.body.ok !== true) return stop('warm-up-failed');", "", 'the run goes on to spend against a relay that is failing'],
  ['B4 a moving ledger is not inconclusive', "if (!quiet) return", "if (false) return", 'real traffic is read as lost refunds'],
  ['B5 too few cut calls still read as "loses nothing"', "if (effective < MIN_EFFECTIVE) return", "if (false) return", 'calls that completed are counted as aborted'],
  ['B18 the schedule is cut from the cold call, not from the confirmed HITs', "abortMs = abortMs || schedule(art.latency_ms);", "abortMs = abortMs || schedule(art.warm_ms);", 'a slow cold call puts every abort after the response'],
  ['B19 the schedule is cut from the first HIT sample, not the median', "art.latency_ms = median(samples);", "art.latency_ms = samples[0];", 'one slow first call sets the schedule for all five aborts'],
  ['B20 a loss needs no cut call to be believed (more lost than cut is allowed)', "if (lostRefunds > effective || missingTallies > effective) return", "if (false) return", 'something else writing to the ledger reads as the cancelled continuation'],
  ['B21 the fractions reach the end of the response again', "export const ABORT_FRACTIONS = [0.2, 0.3, 0.4, 0.5, 0.6];", "export const ABORT_FRACTIONS = [0.35, 0.5, 0.65, 0.8, 0.95];", 'a call a little faster than the sample finishes before its abort'],
  ['B22 the latency samples are not required to be HITs', "if (c.status !== 200 || !c.body || c.body.cached !== 'HIT') return stop('cache-not-warm');", "if (c.status !== 200 || !c.body) return stop('cache-not-warm');", 'same clause as B2 at the sampling loop'],
  ['B6 a moving control phase is not inconclusive', "if (controlDelta.by_site !== 0 || controlDelta.kept !== 0) return", "if (false) return", 'something else writing to the ledger is read as the abort'],
  ['B7 kept moving in the aborted phase is allowed', " || abortDelta.kept !== 0 || missingTallies < 0) return { verdict: 'inconclusive:unexpected-delta'", " || missingTallies < 0) return { verdict: 'inconclusive:unexpected-delta'", 'a cold call inside the aborted phase is read as a lost refund'],
  ['B23 more tallies than calls is allowed', " || abortDelta.kept !== 0 || missingTallies < 0) return { verdict: 'inconclusive:unexpected-delta'", " || abortDelta.kept !== 0) return { verdict: 'inconclusive:unexpected-delta'", 'a phase that tallied more than it called reads as nothing lost'],
  ['B8 a negative delta is allowed', "!Number.isInteger(lostRefunds) || lostRefunds < 0", "!Number.isInteger(lostRefunds)", 'a refund landing late reads as no loss'],
  ['B9 missing tallies are not counted', "const missingTallies = k - abortDelta.hit;", "const missingTallies = 0;", 'the cancelled-continuation signature is lost'],
  ['B10 a missing CFL line reads as zero', "if (typeof by !== 'number') throw", "if (false) throw", 'a body that lost the site reads as a ledger of 0'],
  ['B11 a missing reconcile block reads as empty', "if (!Array.isArray(d.reconcile)) throw", "if (false) throw", 'kept and n read as 0'],
  ['B12 the over-record left is not stated', "art.ledger_overrecord_left_credits = abortDelta.by_site > 0 ? abortDelta.by_site : 0;", "art.ledger_overrecord_left_credits = 0;", 'the vendor watch\'s residual for that window cannot be corrected by hand'],
  ['B13 the aborted phase is measured from before the warm-up', "const abortDelta = diff(art.ledgers.start, art.ledgers.after_aborts);", "const abortDelta = diff(art.ledgers.before_b, art.ledgers.after_aborts);", 'the warm-up\'s own cold-call charge is read as a lost refund'],
  ['B15 the abort schedule is not calibrated to the latency', "abortMs = abortMs || schedule(art.latency_ms);", "abortMs = abortMs || [3, 10, 25, 50, 100];", 'aborts at 3 ms can land before the request reaches the Worker, which reads like a cut call'],
  ['B16 the schedule floor is removed', "Math.max(ABORT_FLOOR_MS, Math.round(f * latencyMs))", "Math.round(f * latencyMs)", 'a fast relay gets aborts at 0 ms'],
  ['B17 a row with a missing n is summed as zero', "if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`daily.reconcile has a", "if (false) throw new Error(`daily.reconcile has a", 'a ledger that lost a field reads as a quiet one'],
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
