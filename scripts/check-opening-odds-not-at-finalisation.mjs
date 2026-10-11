#!/usr/bin/env node
// An opening line written at completion is not an opening line.
//
// docs/CC-CMD-2026-08-25-misjoined-opening-odds.md step 4. That document asked
// for a guard and named the right one: a total-range check would have caught
// ONE of 156 rows, and the test with teeth has no threshold to argue about —
// refuse to write `opening_odds` onto a row that already has a `finalized_at`.
//
// WHAT IT GUARDS. snapshotCronOdds runs from handleJournalismCycle AFTER the
// archive catch-up finalises games in the same tick, and selected purely on
// `opening_odds IS NULL`. Measured over 2026-06-23 → 07-11 (run 38145700814):
// 180 of 315 archive rows, and 155 of 179 census-eligible rows — 86.6% — carry
// an `opening_odds` captured within a minute of `finalized_at`.
//
// WHAT IT DELIBERATELY DOES NOT GUARD. runOddsBackfillForDate fills the same
// column on the same `IS NULL` condition, and must keep doing so: it passes
// `snapshotAt` to extractOddsForGame and stamps the historical snapshot's own
// time, so backfilling a past date is SUPPOSED to touch finalised rows. A guard
// that could not tell those apart would break the backfill to fix the cron.
// This file asserts that difference rather than assuming it holds.

import { readFileSync } from 'node:fs';

const SRC = 'src/index.js';
const SELF_TEST = process.argv.includes('--self-test');

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log(`      → ${detail}`); failed++; }
};

/** The body of a named `async function`, by brace balance. */
export function bodyOf(src, name) {
  const head = `async function ${name}(`;
  const at = src.indexOf(head);
  if (at < 0) return null;
  if (src.indexOf(head, at + 1) >= 0) return null;   // two definitions: refuse
  let depth = 0, i = src.indexOf('{', at);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return depth === 0 ? src.slice(at, i + 1) : null;
}

/**
 * Every `opening_odds IS NULL` selection in a function body, and whether each
 * one also constrains finality.
 *
 * Counted rather than tested with a single regex: snapshotCronOdds carries
 * THREE such selections — two sport-discovery queries and one row query — and a
 * check that passed on any one of them would have missed the two that trigger
 * the vendor fetch.
 */
export function finalityState(body) {
  if (!body) return { found: 0, guarded: 0 };
  const sels = [...body.matchAll(/opening_odds IS NULL([\s\S]{0,120}?)`/g)];
  let guarded = 0;
  for (const m of sels) if (/finalized_at IS NULL/.test(m[1])) guarded++;
  return { found: sels.length, guarded };
}

/** Which stamp a function hands extractOddsForGame: the run clock or a snapshot. */
export function stampStyle(body) {
  if (!body) return 'no-body';
  const calls = [...body.matchAll(/extractOddsForGame\(([^)]*)\)/g)].map(m => m[1].trim());
  if (!calls.length) return 'no-call';
  // One argument = the run clock. Three = an explicit capture time.
  return calls.every(a => a.split(',').length >= 3) ? 'explicit-capture-time' : 'run-clock';
}

if (SELF_TEST) {
  const good = readFileSync(SRC, 'utf8');

  const cron = bodyOf(good, 'snapshotCronOdds');
  const back = bodyOf(good, 'runOddsBackfillForDate');
  check('both functions are found exactly once', !!cron && !!back,
    `snapshotCronOdds=${!!cron} runOddsBackfillForDate=${!!back}`);

  const cs = finalityState(cron);
  check('the real source guards every selection in the cron',
    cs.found > 0 && cs.found === cs.guarded, JSON.stringify(cs));

  // Each selection removed on its own must be detected. A check that only
  // noticed all three missing at once would pass a half-applied fix, which is
  // the realistic way this breaks.
  for (let i = 0; i < cs.found; i++) {
    let seen = -1;
    const broken = cron.replace(/opening_odds IS NULL([\s\S]{0,120}?)`/g, (m, tail) => {
      seen++;
      return seen === i ? m.replace(/\s*AND finalized_at IS NULL/, '') : m;
    });
    const b = finalityState(broken);
    check(`removing the finality condition from selection ${i + 1} is detected`,
      b.guarded === cs.guarded - 1, `guarded went ${cs.guarded} -> ${b.guarded}`);
  }

  // The discrimination the guard rests on.
  check('the cron stamps the run clock', stampStyle(cron) === 'run-clock', stampStyle(cron));
  check('the backfill stamps an explicit capture time',
    stampStyle(back) === 'explicit-capture-time', stampStyle(back));
  check('a body with no extractOddsForGame call is its own state',
    stampStyle('async function f() { return 1 }') === 'no-call', stampStyle('async function f() { return 1 }'));
  check('two definitions of the same name are refused',
    bodyOf('async function f(a) {}\nasync function f(b) {}', 'f') === null,
    'a duplicated definition returned a body');

  console.log(`\nself-test: ${failed === 0 ? 'all pass' : failed + ' FAILED'}`);
  console.log('COVERAGE: the two functions above, from the real source. It does NOT');
  console.log('read the archive — outbox/opening-odds-at-finalisation-latest.json does.');
  process.exit(failed === 0 ? 0 : 1);
}

const src = readFileSync(SRC, 'utf8');
const cron = bodyOf(src, 'snapshotCronOdds');
const back = bodyOf(src, 'runOddsBackfillForDate');

check('snapshotCronOdds is present exactly once', !!cron,
  'not found, or defined more than once — the guard below would read nothing');
if (!cron) process.exit(1);

const cs = finalityState(cron);
check('every opening_odds selection in the cron also requires finalized_at IS NULL',
  cs.found > 0 && cs.found === cs.guarded,
  `${cs.guarded} of ${cs.found} selections guarded — an unguarded one lets the ` +
  'journalism cron write a settled price into opening_odds seconds after the ' +
  'catch-up finalises the game, which is 86.6% of the census-eligible rows in ' +
  'the 2026-06-23 → 07-11 window');

check('the cron still stamps the run clock, which is why it needs the guard',
  stampStyle(cron) === 'run-clock',
  `stamp is '${stampStyle(cron)}' — if this function now passes an explicit ` +
  'capture time, re-read whether the finality condition is still the right fix');

check('the backfill is NOT guarded, and still stamps a snapshot time',
  !!back && finalityState(back).guarded === 0 && stampStyle(back) === 'explicit-capture-time',
  `guarded=${back ? finalityState(back).guarded : '—'} stamp=${stampStyle(back)} — ` +
  'backfilling a past date is supposed to touch finalised rows; guarding it ' +
  'would break the backfill to fix the cron');

console.log(`\ncron: ${cs.guarded}/${cs.found} selections guarded, stamp '${stampStyle(cron)}'`);
console.log(`backfill: ${back ? finalityState(back).found : 0} selection(s), unguarded by design, stamp '${stampStyle(back)}'`);
process.exit(failed === 0 ? 0 : 1);
