#!/usr/bin/env node
// Locks layer 2g — CC-CMD-2026-08-22-brief-sport-contamination, defect 3.
//
// "Spurs' 3 shots this match trail Brentford's 37 goals this season" passed every
// quality dimension the relay measures. Dim 8 forbids a BARE number and both
// numbers carry a window, so Dim 8 was satisfied. The falsehood lives only in the
// comparison: a per-match count cannot be ranked against a per-season count.
//
// Negative tests carry the weight here. A detector that fires on ordinary prose
// naming two time periods would be worse than none, so every "must NOT fire" case
// below is a sentence a real brief could legitimately contain.
//
// Run: node scripts/cross-window-check.mjs
import { crossWindowComparisons, PROSE_STYLE_RULES, proseStyleFor } from '../src/journalism-quality.js';

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { console.log(`PASS  ${label}`); pass++; }
  else { console.error(`FAIL  ${label}${detail ? ' — ' + detail : ''}`); fail++; }
};

const FIRE = [
  // the measured defect, verbatim from the 2026-08-22 desk
  "Spurs' 3 shots this match trail Brentford's 37 goals this season.",
  "Judge's 2 hits tonight trail his 41 home runs this season.",
  "Carolina's 2 goals tonight are fewer than Vegas' 31 goals this season.",
  "His 12 points in the first half are more than his 9 points this week.",
  "Everton's 1 goal this match is behind Palace's 44 goals this season.",
];
const QUIET = [
  // two windows, only one figure — ordinary prose
  "Everton have won three straight this season and lead the table tonight.",
  // one window, one figure
  "Haaland's 22 goals this season lead the league.",
  "Wembanyama's 28.2 PPG this postseason is the headline.",
  // a scoreline is not a cross-window comparison
  "Brentford lead 3-0 in the 58th minute.",
  "Mexico drew 1-1; the USA won 2-0 this week.",
  // same window on both sides — a legitimate comparison
  "Everton's 3 shots this match trail Palace's 11 shots this match.",
  // FIELD-voice exemplar prose must stay silent
  "Aho, an 80-point center, is the reason Carolina is here.",
  "Three of tonight's four starters are carrying ERAs north of 4.50.",
];

for (const s of FIRE) ok(`fires: ${s.slice(0, 58)}`, crossWindowComparisons(s).length === 1);
for (const s of QUIET) ok(`silent: ${s.slice(0, 58)}`, crossWindowComparisons(s).length === 0,
  JSON.stringify(crossWindowComparisons(s)[0]?.windows));

// the violation must name both windows, so the retry prompt can quote them
const d = crossWindowComparisons(FIRE[0])[0];
ok('violation reports both windows', d.windows.includes('this match') && d.windows.includes('this season'),
  JSON.stringify(d.windows));
ok('violation quotes the sentence verbatim', d.sentence === FIRE[0]);

// multi-sentence input reports only the offending sentence
const mixed = `${QUIET[1]} ${FIRE[0]} ${QUIET[3]}`;
ok('only the offending sentence is reported',
  crossWindowComparisons(mixed).length === 1 && crossWindowComparisons(mixed)[0].sentence === FIRE[0]);

// the style rule reaches every sport, not just the one that exposed the defect
const RULE = '- ONE WINDOW PER COMPARISON';
ok('style rule exists exactly once', PROSE_STYLE_RULES.filter(r => r.startsWith(RULE)).length === 1);
for (const sport of ['EPL', 'NBA', 'NHL', 'MLB', 'NFL', 'MLS', null]) {
  ok(`ONE WINDOW PER COMPARISON reaches ${sport ?? 'the mixed slate'}`,
    proseStyleFor(sport).includes(RULE));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
