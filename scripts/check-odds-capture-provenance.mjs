#!/usr/bin/env node
// Assertions for src/odds-capture-provenance.js.
//
// The two ways this can be wrong are opposite and both are silent:
//   too eager — marks a blob whose captured_at IS a measurement, so a real
//               snapshot time starts reading as a run clock;
//   too timid — leaves a run-clock stamp unmarked, which is the state that
//               produced 58 rows nobody could attribute.
// And one that is neither: touching `_kickoff`, which 1383 rows carry.
//
// Rule 90: mutation-tested by scripts/mutate-odds-capture-provenance.mjs.
import { captureMark, markCapture, hasCaptureMark, replayedRunClockSql,
         isRunClockStamp, kickoffDecidable, windowEndFor } from '../src/odds-capture-provenance.js';
import { readFileSync } from 'node:fs';

let fails = 0, n = 0;
const ok = (f, why) => {
  n++;
  let pass = false;
  try { pass = (typeof f === 'function' ? f() : f) === true; }
  catch (e) { console.log(`FAIL  ${why} — threw ${e.message}`); fails++; return; }
  if (!pass) { fails++; console.log(`FAIL  ${why}`); }
};

// --- which stamps are run clocks
ok(() => isRunClockStamp('2026-08-22T10:00:52.499Z') === true,
   'a millisecond stamp is a run clock');
ok(() => isRunClockStamp('2026-08-22T23:54:46Z') === false,
   "the vendor's whole-second form is not a run clock");
ok(() => isRunClockStamp('2026-08-22T12:00:00Z') === false,
   'the noon anchor is not a run clock');
ok(() => isRunClockStamp(null) === false, 'an absent stamp is not a run clock');
ok(() => isRunClockStamp('2026-08-22T10:00:52.4Z') === false,
   'a one-digit fraction is not the toISOString shape');
ok(() => isRunClockStamp('2026-08-22T10:00:52.499Z extra') === false,
   'a stamp with trailing text is not matched');

// --- the window
ok(() => windowEndFor('2026-08-22') === '2026-08-22T12:00:00Z', 'the window ends at noon UTC');
ok(() => windowEndFor(null) === null, 'no date yields no window');
ok(() => windowEndFor('22-08-2026') === null, 'a non-ISO date yields no window');

// --- decidability, which is the field this module exists for
ok(() => kickoffDecidable('2026-08-22T12:00:00Z', '2026-08-22T23:55Z') === true,
   'a kickoff after the window closes is decidable');
ok(() => kickoffDecidable('2026-08-22T12:00:00Z', '2026-08-22T11:30Z') === false,
   'a kickoff INSIDE the window is not decidable');
ok(() => kickoffDecidable('2026-08-22T12:00:00Z', '2026-08-22T12:00:00Z') === false,
   'a kickoff exactly at the window edge is not decidable');
ok(() => kickoffDecidable('2026-08-22T12:00:00Z', null) === false,
   'no kickoff means not decidable');
ok(() => kickoffDecidable(null, '2026-08-22T23:55Z') === false,
   'no window means not decidable');

// --- the mark
const runClock = { captured_at: '2026-08-22T10:00:52.499Z', source: 'draftkings',
                   _kickoff: { at: '2026-08-22T23:55Z', verified: true, late_minutes: null } };
const vendor   = { captured_at: '2026-08-22T23:54:46Z', source: 'betrivers' };

ok(() => captureMark(vendor, '2026-08-22', '2026-08-22T23:55Z') === null,
   'a measured stamp gets no mark');
ok(() => captureMark(null, '2026-08-22', 'x') === null, 'no blob, no mark');
const m = captureMark(runClock, '2026-08-22', '2026-08-22T23:55Z');
ok(() => m.measured === false, 'the mark says the stamp is not a measurement');
ok(() => m.stored_is === 'run-clock', 'the mark says what the stamp actually is');
ok(() => m.window_end === '2026-08-22T12:00:00Z', 'the mark carries the window end');
ok(() => m.kickoff_decidable === true, 'a late kickoff is decidable');
const undec = captureMark(runClock, '2026-08-22', '2026-08-22T11:30Z');
ok(() => undec.kickoff_decidable === false,
   'the EPL case — kickoff inside the window — is marked undecidable');

// --- applying it
const out = markCapture(runClock, '2026-08-22', '2026-08-22T23:55Z');
ok(() => out !== runClock, 'marking returns a new object rather than mutating');
ok(() => JSON.stringify(out._kickoff) === JSON.stringify(runClock._kickoff),
   '_kickoff is carried through untouched');
ok(() => !('_capture' in runClock), 'the input blob is not mutated');
ok(() => out.captured_at === runClock.captured_at,
   'captured_at is NOT repaired — a window is not a measurement');
ok(() => markCapture(vendor, '2026-08-22', 'x') === vendor,
   'a blob needing no mark comes back unchanged, so a re-run writes nothing');

// --- idempotence
ok(() => hasCaptureMark(out) === true, 'a marked blob reports itself marked');
ok(() => hasCaptureMark(runClock) === false, 'an unmarked blob reports itself unmarked');
ok(() => hasCaptureMark({ _capture: { measured: true } }) === false,
   'a mark asserting measurement is not this mark');

// --- the shared predicate, and that both consumers actually use it
const sql = replayedRunClockSql('closing_odds');
ok(() => sql.includes("json_extract(closing_odds,'$.captured_at')"),
   'the predicate reads captured_at from the named column');
ok(() => sql.includes("GLOB '*.[0-9][0-9][0-9]Z'"),
   'the predicate matches the millisecond form');
ok(() => sql.includes("json_extract(closing_odds,'$._oddsProof') IS NOT NULL"),
   'the predicate requires _oddsProof — a live capture is out of scope');
// BOTH halves must follow the column, not just the one the first version
// checked — a mutation hardcoding only the captured_at half passed it.
ok(() => {
  const other = replayedRunClockSql('opening_odds');
  return other.includes("json_extract(opening_odds,'$._oddsProof')")
      && other.includes("json_extract(opening_odds,'$.captured_at')")
      && !other.includes('closing_odds');
}, 'the column name is honoured rather than hardcoded');

const EXEC = readFileSync('scripts/run-capture-provenance-mark.mjs', 'utf8');
const WATCH = readFileSync('scripts/watch-run-clock-closing-stamps.mjs', 'utf8');
ok(() => /replayedRunClockSql\('closing_odds'\)/.test(EXEC),
   'the executor selects with the shared predicate');
ok(() => /replayedRunClockSql\('closing_odds'\)/.test(WATCH),
   'the watch gates on the shared predicate');
ok(() => !/source'\)\s*=\s*'draftkings'/.test(EXEC),
   'the executor no longer selects by bookmaker');

console.log(`${n - fails}/${n} assertions pass`);
process.exit(fails ? 1 : 0);
