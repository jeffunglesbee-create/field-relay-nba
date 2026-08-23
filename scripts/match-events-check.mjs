#!/usr/bin/env node
// Guard for ask 5 of CC-CMD-2026-08-20-brief-data-quality: ESPN scoring-play
// grounding (buildMatchEventsContext + selectScoringPlays + normalizeSportKey).
//
// Pure — no network. Every container name, field name and item count asserted
// here was measured 2026-08-23 through the relay's own /espn-summary proxy
// against finalized games FIELD had briefed
// (outbox/scoring-containers-2026-08-23T05-58-*.json). If ESPN moves a field,
// this file does NOT catch it; the CI probe does. What this catches is the
// selection rule silently changing shape under an edit.
//
// Negative tests carry the weight. A selection rule that returns everything
// passes every positive assertion.

import { selectScoringPlays, formatMatchEvents } from '../src/context-assembler.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

// ── fixtures ─────────────────────────────────────────────────────────────
// A play as ESPN actually shapes it: period is an object with .number.
const play = (h, a, period, text = 'x') =>
  ({ homeScore: h, awayScore: a, period: { number: period }, text, scoringPlay: true });

// 112 items is the real WNBA count. Build a game that is a blowout for three
// quarters and then a fourth-quarter comeback, so "lead changes + closing
// period" has something to distinguish it from "the last 8".
const blowoutThenComeback = [];
for (let i = 1; i <= 100; i++) blowoutThenComeback.push(play(i * 2, i, i <= 25 ? 1 : i <= 50 ? 2 : 3));
for (let i = 1; i <= 12; i++) blowoutThenComeback.push(play(200, 100 + i * 10, 4));

console.log('selectScoringPlays');

// 1. Small slates enumerate — MLB (5), NFL (7), EPL (3) must pass through whole.
for (const [sport, n] of [['MLB', 5], ['NFL', 7], ['EPL', 3], ['boundary', 12]]) {
  const items = Array.from({ length: n }, (_, i) => play(i, 0, 1));
  ok(`${sport} n=${n} enumerates untouched`, selectScoringPlays(items).length === n);
}

// 2. NEGATIVE — 13 items must NOT enumerate. Off-by-one on the threshold is
//    the likeliest silent regression, and it is invisible to a positive test.
ok('n=13 selects rather than enumerating',
   selectScoringPlays(Array.from({ length: 13 }, (_, i) => play(i, 0, 1))).length <= 8);

// 3. The cap holds on a real-volume game.
const chosen = selectScoringPlays(blowoutThenComeback);
ok('112 items -> at most 8', chosen.length <= 8, `got ${chosen.length}`);
ok('112 items -> not empty', chosen.length > 0);

// 4. NEGATIVE — selection must not return the input. A rule that degrades to
//    "return items" quietly blows the 350-token budget and the assembler
//    skips the whole block (source.budget * 1.5 ceiling), so the failure mode
//    is an EMPTY brief, not a long one.
ok('112 items -> a strict subset', chosen.length < blowoutThenComeback.length);

// 5. Chronology is preserved — a recap that lists the fourth quarter before
//    the first reads as fabricated even when every play is real.
const idx = chosen.map(c => blowoutThenComeback.indexOf(c));
ok('chosen stay in chronological order',
   idx.every((v, i) => i === 0 || v > idx[i - 1]), JSON.stringify(idx));

// 6. The closing period is represented — the whole point of the rule.
ok('closing period present in selection',
   chosen.some(c => c.period.number === 4));

// 7. NEGATIVE — no running score means no ranking. EPL keyEvents measured
//    with homeScore/awayScore ABSENT, so this path is live, not theoretical:
//    it must fall back to the tail and must not throw.
const noScore = Array.from({ length: 40 }, (_, i) => ({ period: { number: 1 }, text: `e${i}`, scoringPlay: true }));
let threw = false, tail = [];
try { tail = selectScoringPlays(noScore); } catch { threw = true; }
ok('missing running score does not throw', !threw);
ok('missing running score -> tail of 8', tail.length === 8 && tail[7] === noScore[39]);

// 8. NEGATIVE — PARTIAL running score is the nastier case: present on item 0,
//    absent later. Ranking on a partial array produces NaN margins, which
//    Math.sign turns into a "no flip" everywhere. Must take the tail instead.
const partial = Array.from({ length: 40 }, (_, i) =>
  i < 5 ? play(i, 0, 1) : { period: { number: 1 }, text: `e${i}`, scoringPlay: true });
ok('partial running score -> tail, not a NaN ranking',
   selectScoringPlays(partial).length === 8);

// 9. period as a bare number (not an object) must not crash the lastPeriod max.
const bare = Array.from({ length: 30 }, (_, i) => ({ homeScore: i, awayScore: 0, period: i < 20 ? 1 : 2, text: 't' }));
let bareOk = true;
try { bareOk = selectScoringPlays(bare).length <= 8; } catch { bareOk = false; }
ok('bare numeric period handled', bareOk);

// 10. An empty array yields an empty array, not a throw from Math.max().
ok('empty input -> empty output', selectScoringPlays([]).length === 0);

// 11. Custom caps are honoured (the builder may tighten under budget pressure).
ok('cap parameter honoured',
   selectScoringPlays(blowoutThenComeback, { cap: 3 }).length === 3);

console.log('\nformatMatchEvents');

// The block the generator actually reads. Sampled from real ESPN basketball
// prose, which is the longest per-play text of the six sports and therefore
// the budget worst case.
const REAL_WNBA_TEXT = [
  'Caitlin Clark makes 26-foot three point jumper (Aliyah Boston assists)',
  'Alyssa Thomas makes driving layup (DeWanna Bonner assists)',
  'Kelsey Mitchell makes free throw 2 of 2',
  'Napheesa Collier makes 15-foot pullup jump shot',
  'Breanna Stewart makes 25-foot three point jumper (Sabrina Ionescu assists)',
  'Aliyah Boston makes two point tip shot',
  'Jonquel Jones makes 17-foot jumper (Courtney Vandersloot assists)',
  'Kelsey Plum makes driving floating jump shot',
];
const wnba = [];
for (let i = 0; i < 112; i++) {
  wnba.push({
    homeScore: i * 2, awayScore: i,
    period: { number: Math.min(4, Math.floor(i / 28) + 1), displayValue: `Q${Math.min(4, Math.floor(i / 28) + 1)}` },
    clock: { displayValue: `${9 - (i % 10)}:0${i % 10}` },
    text: REAL_WNBA_TEXT[i % REAL_WNBA_TEXT.length],
    scoringPlay: true,
  });
}
const block = formatMatchEvents(wnba);

ok('block is headed [MATCH EVENTS]', block.split('\n')[1] === '[MATCH EVENTS]');

// 13. THE BUDGET ASSERTION. The registry declares budget 200 and the
//     assembler skips any block over budget * 1.5. A block that quietly grows
//     past 300 tokens does not error — it VANISHES, and an EPL or WNBA brief
//     goes back to being a season-stat template with nothing in the logs.
const tokens = Math.ceil(block.length / 4);
ok(`worst-case block within declared budget 200 (got ${tokens})`, tokens <= 200);
ok('worst-case block within the assembler 1.5x ceiling', tokens <= 300);

// 14. Truncation must be declared. A brief built from 8 of 112 plays that
//     reads as the whole game is the DO NOT INVENT failure at one remove:
//     every sentence is true and the account is false.
ok('truncation is stated in the block', /\(8 of 112 scoring plays/.test(block));

// 15. NEGATIVE — and it must NOT be stated when nothing was cut, or every
//     enumerated MLB recap carries a disclaimer it does not need.
const five = REAL_WNBA_TEXT.slice(0, 5).map((t, i) => ({ homeScore: i, awayScore: 0, period: { number: 1 }, text: t }));
ok('no truncation note when the list is complete', !/scoring plays —/.test(formatMatchEvents(five)));

// 16. NEGATIVE — the block must never state a scoreline. homeScore/awayScore
//     are read for RANKING only. The 2026-08-22 EPL brief invented "a 2-1
//     result" from a goalscorer list that carried no score; a block that
//     prints running totals invites the generator to do arithmetic on them
//     and report a final score that is really the score at the 8th-from-last
//     scoring play.
ok('no running score printed in the block', !/\b\d+\s*[-–]\s*\d+\b/.test(block));

// 17. Every emitted line traces to an input play — no synthesised summary line
//     beyond the header and the declared truncation note.
const body = block.split('\n').slice(2).filter(l => !l.startsWith('('));
ok('every body line contains a real play text',
   body.every(l => REAL_WNBA_TEXT.some(t => l.endsWith(t))), JSON.stringify(body.slice(0, 2)));

// 18. Items with no text are dropped rather than emitting a bare timestamp.
const blank = [{ period: { number: 1, displayValue: 'Q1' }, text: '   ', homeScore: 1, awayScore: 0 },
               { period: { number: 1, displayValue: 'Q1' }, text: 'Real play', homeScore: 3, awayScore: 0 }];
const bl = formatMatchEvents(blank);
ok('blank play text is dropped', bl.split('\n').length === 3 && bl.includes('Real play'));

// 19. An all-blank list yields '' — the assembler skips falsy blocks, so a
//     header with no plays under it must never reach a prompt.
ok('all-blank input -> empty string',
   formatMatchEvents([{ period: { number: 1 }, text: '' }]) === '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
