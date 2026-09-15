#!/usr/bin/env node
// `extractOddsForGame(oddsGame, preferredBook, capturedAt = null)` stamps
// `capturedAt || new Date()`. Which of those is correct depends entirely on
// where the payload came from, and the two cases are not interchangeable:
//
//   LIVE fetch      — the worker's clock IS the capture moment. Omitting
//                     capturedAt is right, and passing a fixed time would be
//                     the bug.
//   HISTORICAL fetch — the payload is anchored to a fixed snapshot. The
//                     worker's clock records when the row was written, not
//                     when the market data is from.
//
// MEASURED 2026-09-15: 22 archived closing lines carry a DraftKings
// American-odds blob with no total and a millisecond captured_at — the shape
// this function emits with capturedAt omitted. All 22 predate a1937eb
// (2026-08-22T21:11:07Z, "captured_at said 'now' for data that was a fixed
// noon-UTC snapshot") by hours to days. The defect is fixed; these rows are its
// residue, and change_log never named the writer because that route's first
// change_log entry is 2026-08-23.
//
// THE INVARIANT, stated where it can fail: a call whose result is written to
// closing_odds passes an explicit capturedAt. A closing line is a claim about a
// moment, and the worker's clock is not that moment.
//
// Rule 90: mutation-tested by scripts/mutate-captured-at-explicit.mjs.
import { readFileSync } from 'node:fs';

let fails = 0, n = 0;
const ok = (f, why) => {
  n++;
  let pass = false;
  try { pass = (typeof f === 'function' ? f() : f) === true; }
  catch (e) { console.log(`FAIL  ${why} — threw ${e.message}`); fails++; return; }
  if (!pass) { fails++; console.log(`FAIL  ${why}`); }
};

const SRC = readFileSync('src/index.js', 'utf8');
const lines = SRC.split('\n');

// Every call site, with the line it is on.
const calls = [];
lines.forEach((l, i) => {
  if (/extractOddsForGame\s*\(/.test(l) && !/^function |^\s*function /.test(l)) calls.push({ line: i + 1, text: l.trim() });
});

ok(() => calls.length >= 1, 'extractOddsForGame is still called somewhere');

// A call is "explicit" when it passes a third argument.
const explicit = calls.filter(c => /extractOddsForGame\([^)]*,[^)]*,[^)]*\)/.test(c.text));
const implicit = calls.filter(c => !explicit.includes(c));

// Which of them feed closing_odds? The write is within a few lines of the call
// in every current site; widen the window rather than assume adjacency.
const feedsClosing = (c) => lines.slice(c.line - 1, c.line + 40).join('\n').includes('closing_odds');

const implicitClosing = implicit.filter(feedsClosing);
ok(() => implicitClosing.length === 0,
   `no call feeding closing_odds omits capturedAt (offenders: ${implicitClosing.map(c => c.line).join(', ') || 'none'})`);

// The live-opening call is ALLOWED to omit it, and the check says so rather
// than banning the shape outright — a ban would push a wrong fixed time into
// the one place the clock is the right answer.
ok(() => implicit.length <= 1,
   `at most one call omits capturedAt, the live fetch (omitting: ${implicit.map(c => c.line).join(', ')})`);
ok(() => implicit.every(c => lines.slice(c.line - 1, c.line + 10).join('\n').includes('opening_odds')),
   'the call that omits capturedAt writes opening_odds, not closing');

// The parameter and its fallback must both still exist, or every assertion
// above is about a function that no longer behaves this way.
ok(() => /function extractOddsForGame\(oddsGame, preferredBook = ODDS_PREFERRED_BOOK, capturedAt = null\)/.test(SRC),
   'the capturedAt parameter is still there');
ok(() => /captured_at: capturedAt \|\| new Date\(\)\.toISOString\(\)/.test(SRC),
   'the fallback is still capturedAt || now, which is what makes the rule necessary');

// The historical fetch must keep handing a snapshot time back, or the explicit
// call sites pass undefined and fall through to the clock anyway.
ok(() => /return \{ games, quotaRemaining, ok: true, snapshotAt: servedAt \|\| snapshot \};/.test(SRC),
   'the historical fetch returns a snapshotAt on its success path');

console.log(`${n - fails}/${n} assertions pass   (${calls.length} call site(s): ${calls.map(c => c.line).join(', ')})`);
process.exit(fails ? 1 : 0);
