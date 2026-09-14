#!/usr/bin/env node
// Assertions for src/odds-consumer-rules.js.
//
// The rule these guard is one sentence -- skip a price KNOWN to have been taken
// after kickoff -- and the two ways it can be wrong are opposite:
//   * too loose: an in-play price is read as a closing line, and an upset, a
//     tight line, or a printed "closed home +X" is manufactured from it;
//   * too tight: an unmarked blob is treated as guilty, which would blank
//     almost every opening_odds in the archive, since two of the three writers
//     never stamped that column.
// Every assertion below sits on one side or the other.
//
// Rule 90: each is mutation-tested by scripts/mutate-odds-consumer-rules.mjs.
import { selectLineOdds, winnerMoneylinePrice, lineSpread,
         parseOddsJSON, knownPostKickoff, lateMinutes } from '../src/odds-consumer-rules.js';

let fails = 0, n = 0;
// A thunk, not a value: a mutation that makes the subject THROW must still be
// reported as a FAIL line, not kill the run before the reason is printed.
// M10 did exactly that on the first pass of the Rule 90 harness.
const ok = (f, why) => {
  n++;
  let pass = false;
  try { pass = (typeof f === 'function' ? f() : f) === true; }
  catch (e) { console.log(`FAIL  ${why} — threw ${e.message}`); fails++; return; }
  if (!pass) { fails++; console.log(`FAIL  ${why}`); }
};

const LEGACY = { requirePreKickoff: false };
const RULE   = { requirePreKickoff: true };

const mark = (verified, late = null) => ({ at: '2026-07-25T23:30Z', verified, late_minutes: late });
const blob = (ml, kick, spread) => JSON.stringify({
  source: 'test', captured_at: '2026-07-25T23:55:28Z',
  moneyline: ml, ...(spread ? { spread } : {}), ...(kick ? { _kickoff: kick } : {}),
});

// --- parsing
ok(() => parseOddsJSON(null) === null, 'a null column has no odds');
ok(() => parseOddsJSON('{"a":1}')?.a === 1, 'a string blob parses');
ok(() => parseOddsJSON({ a: 1 })?.a === 1, 'an object blob passes through');
ok(() => parseOddsJSON('{not json') === null, 'an unparseable blob yields no odds');

// --- the mark
ok(() => knownPostKickoff({ _kickoff: mark(false, 26) }) === true, 'verified false is known post-kickoff');
ok(() => knownPostKickoff({ _kickoff: mark(true) }) === false, 'verified true is not post-kickoff');
ok(() => knownPostKickoff({}) === false, 'an unmarked blob is not KNOWN post-kickoff');
ok(() => lateMinutes({ _kickoff: mark(false, 26) }) === 26, 'late_minutes reads the mark');
ok(() => lateMinutes({}) === null, 'late_minutes is null without a mark');

// --- selection
const lateClose = {
  closing_odds: blob({ home: 250, away: -400 }, mark(false, 26), { home: 5.5 }),
  opening_odds: blob({ home: -180, away: 150 }, null, { home: -2.5 }),
  home_score: 3, away_score: 1,
};
ok(() => selectLineOdds(lateClose, LEGACY).source === 'closing',
   'the old behaviour takes the closing line even when it is late');
ok(() => selectLineOdds(lateClose, RULE).source === 'opening',
   'a blob marked post-kickoff is skipped');
ok(() => selectLineOdds(lateClose, RULE).skipped.includes('closing'),
   'the skipped blob is named');
ok(() => selectLineOdds(lateClose, LEGACY).source !== selectLineOdds(lateClose, RULE).source,
   'the two modes differ on a late closing line');
ok(() => selectLineOdds(lateClose, RULE).confidence === 'unknown',
   'confidence is unknown without a mark');

const goodClose = {
  closing_odds: blob({ home: -180, away: 150 }, mark(true), { home: -2.5 }),
  opening_odds: blob({ home: -150, away: 130 }, null, { home: -2.0 }),
  home_score: 3, away_score: 1,
};
ok(() => selectLineOdds(goodClose, RULE).source === 'closing', 'a verified closing line is taken');
ok(() => selectLineOdds(goodClose, RULE).confidence === 'verified',
   'confidence is verified only on an explicit true');
ok(() => selectLineOdds({ opening_odds: blob({ home: 120, away: -140 }, null) }, RULE).source === 'opening',
   'an unmarked opening is still used');
ok(() => selectLineOdds({ closing_odds: blob({ home: 1 }, mark(false, 9)) }, RULE).odds === null,
   'a lone late blob leaves no price');
ok(() => selectLineOdds({}, RULE).confidence === 'none', 'no columns yields no price');
ok(() => selectLineOdds({ closing_odds: '{bad', opening_odds: blob({ home: 5 }, null) }, RULE).source === 'opening',
   'an unparseable closing falls through to opening');

// --- winner moneyline, as detectAnomalies uses it
ok(() => winnerMoneylinePrice(lateClose, LEGACY) === 250, 'the winner price comes off the home side when home won');
ok(() => winnerMoneylinePrice(lateClose, RULE) === -180, 'winner ML follows the selection rule');
ok(() => (winnerMoneylinePrice(lateClose, LEGACY) >= 200) !== (winnerMoneylinePrice(lateClose, RULE) >= 200),
   'the upset threshold flips between the two modes');
ok(() => winnerMoneylinePrice({ ...lateClose, home_score: 1, away_score: 3 }, LEGACY) === -400,
   'the winner price comes off the away side when away won');
ok(() => winnerMoneylinePrice({ closing_odds: JSON.stringify({ h2h: { home: 300, away: -500 } }),
                          home_score: 2, away_score: 1 }, RULE) === 300,
   'h2h is accepted as a moneyline alias');
ok(() => winnerMoneylinePrice({ closing_odds: JSON.stringify({ total: { over: 8 } }),
                          home_score: 2, away_score: 1 }, RULE) === null,
   'a blob with no moneyline yields no winner price');

// --- spread, as scoreGame uses it
ok(() => lineSpread(lateClose, LEGACY) === 5.5, 'the spread comes off the chosen blob');
ok(() => lineSpread(lateClose, RULE) === -2.5, 'the spread ignores a late closing blob');
ok(() => (Math.abs(lineSpread(lateClose, LEGACY)) < 3) !== (Math.abs(lineSpread(lateClose, RULE)) < 3),
   'the tight-line test flips between the two modes');
ok(() => lineSpread({ closing_odds: JSON.stringify({ line: -1.5 }) }, RULE) === -1.5,
   'a bare line field is accepted as a spread');
ok(() => lineSpread({ closing_odds: JSON.stringify({ spread: { away: 4 } }) }, RULE) === 4,
   'the away side is accepted when home is absent');
ok(() => lineSpread({ closing_odds: JSON.stringify({ moneyline: { home: 1 } }) }, RULE) === null,
   'a blob with no spread yields none');

console.log(`${n - fails}/${n} assertions pass`);
process.exit(fails ? 1 : 0);
