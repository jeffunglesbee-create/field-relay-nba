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

// A COMMENT ABOUT THE PATTERN IS NOT THE PATTERN, and this check learned that
// the expensive way. On 2026-10-11 a comment explaining the finality guard
// wrote the words `extractOddsForGame(og)` in prose — describing which caller
// omits the third argument — and this scan counted it as a fourth call site
// that omits `capturedAt`. Two assertions went red and the deploy failed on a
// line of documentation.
//
// The sibling checks in this repo already carry self-tests for exactly this
// shape (`check-doc-citations` refuses a path that quotes itself,
// `check-empty-catches` refuses a comment mentioning `.catch(()=>{})`), so the
// fix is the one they use: read code, not prose. Line comments and block
// comments are blanked before the scan; a `//` inside a string literal is not
// a comment, so quotes are tracked too.
const codeOnly = (() => {
  let out = '', i = 0, quote = null, blk = false, line = false;
  while (i < SRC.length) {
    const c = SRC[i], n = SRC[i + 1];
    if (blk) { if (c === '*' && n === '/') { out += '  '; i += 2; blk = false; continue } out += c === '\n' ? '\n' : ' '; i++; continue }
    if (line) { if (c === '\n') { out += '\n'; i++; line = false; continue } out += ' '; i++; continue }
    if (quote) {
      if (c === '\\') { out += '  '; i += 2; continue }
      if (c === quote) { out += c; i++; quote = null; continue }
      out += c === '\n' ? '\n' : c; i++; continue
    }
    if (c === '/' && n === '/') { out += '  '; i += 2; line = true; continue }
    if (c === '/' && n === '*') { out += '  '; i += 2; blk = true; continue }
    if (c === '"' || c === "'" || c === '`') { out += c; i++; quote = c; continue }
    out += c; i++;
  }
  return out.split('\n');
})();

// Every call site, with the line it is on. Indexed against the code-only view
// so the reported line number still matches the real file.
const calls = [];
codeOnly.forEach((l, i) => {
  if (/extractOddsForGame\s*\(/.test(l) && !/^function |^\s*function /.test(l)) calls.push({ line: i + 1, text: l.trim() });
});

// The self-test for the blanking, run every time rather than behind a flag:
// three assertions that cost nothing and would have caught the comment.
ok(() => codeOnly.length === lines.length,
  'the code-only view keeps one entry per source line');
{
  const probe = (src) => {
    let out = '', i = 0, blk = false, line = false, quote = null;
    while (i < src.length) {
      const c = src[i], n = src[i + 1];
      if (blk) { if (c === '*' && n === '/') { out += '  '; i += 2; blk = false; continue } out += ' '; i++; continue }
      if (line) { if (c === '\n') { out += '\n'; i++; line = false; continue } out += ' '; i++; continue }
      if (quote) { if (c === '\\') { out += '  '; i += 2; continue } if (c === quote) { out += c; i++; quote = null; continue } out += c; i++; continue }
      if (c === '/' && n === '/') { out += '  '; i += 2; line = true; continue }
      if (c === '/' && n === '*') { out += '  '; i += 2; blk = true; continue }
      if (c === '"' || c === "'" || c === '`') { out += c; i++; quote = c; continue }
      out += c; i++;
    }
    return out;
  };
  ok(() => !probe('// calls extractOddsForGame(og) with no third argument').includes('extractOddsForGame'),
    'a LINE comment naming the call is not counted');
  ok(() => !probe('/* passes snapshotAt to extractOddsForGame(og, b, t) */').includes('extractOddsForGame'),
    'a BLOCK comment naming the call is not counted');
  ok(() => probe('const o = extractOddsForGame(og);').includes('extractOddsForGame'),
    'a real call still is');
}

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
