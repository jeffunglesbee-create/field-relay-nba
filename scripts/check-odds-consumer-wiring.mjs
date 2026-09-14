#!/usr/bin/env node
// The rule in src/odds-consumer-rules.js is only worth anything where it is
// actually called. This checks the five read sites it was written for, by
// source text, because each failure mode is a line that quietly goes back to
// reading `closing_odds` by name:
//
//   analytics-engine.js  winnerMoneylinePrice  upset finding at >= +200
//   analytics-engine.js  scoreGame             tight line at |spread| < 3
//   index.js 5637        buildGameCompletePrompt   prints "closed home X"
//   index.js 9259        the cron debrief path     prints "closed home X"
//   context-assembler.js buildOddsStoryContext     narrates the movement
//
// The sixth site, index.js's /odds-story debug route, carries the same guard so
// the view cannot disagree with the prompt it exists to explain.
//
// Rule 90: mutation-tested by scripts/mutate-odds-consumer-wiring.mjs.
import { readFileSync } from 'node:fs';

let fails = 0, n = 0;
const ok = (f, why) => {
  n++;
  let pass = false;
  try { pass = (typeof f === 'function' ? f() : f) === true; }
  catch (e) { console.log(`FAIL  ${why} — threw ${e.message}`); fails++; return; }
  if (!pass) { fails++; console.log(`FAIL  ${why}`); }
};

const AE = readFileSync('src/analytics-engine.js', 'utf8');
const IX = readFileSync('src/index.js', 'utf8');
const CA = readFileSync('src/context-assembler.js', 'utf8');

// --- analytics-engine reads the shared rule, and holds no copy of it
ok(() => /import\s*\{[^}]*winnerMoneylinePrice[^}]*\}\s*from\s*'\.\/odds-consumer-rules\.js'/.test(AE),
   'analytics-engine imports winnerMoneylinePrice from the rule module');
ok(() => /import\s*\{[^}]*lineSpread[^}]*\}\s*from\s*'\.\/odds-consumer-rules\.js'/.test(AE),
   'analytics-engine imports lineSpread from the rule module');
ok(() => !/function\s+winnerMoneylinePrice/.test(AE),
   'analytics-engine defines no local winnerMoneylinePrice');
ok(() => !/function\s+parseOddsJSON/.test(AE),
   'analytics-engine defines no local parseOddsJSON');
ok(() => !/closing_odds\s*\)\s*\|\|\s*parseOddsJSON/.test(AE),
   'analytics-engine no longer prefers closing_odds by name');
ok(() => /const ml = winnerMoneylinePrice\(g\);/.test(AE),
   'the upset finding still reads a winner moneyline');
ok(() => /const spread = lineSpread\(game\);/.test(AE),
   'the tight-line score still reads a spread');

// --- the two prose sites
const closeStr = IX.match(/const closeStr = [^\n]*/g) || [];
ok(() => closeStr.length === 2, 'both debrief prose sites are present');
ok(() => closeStr.every(l => l.includes('!knownPostKickoff(c)')),
   'neither prose site prints a post-kickoff price as "closed"');
ok(() => /import\s*\{[^}]*knownPostKickoff[^}]*\}\s*from\s*'\.\/odds-consumer-rules\.js'/.test(IX),
   'index.js imports the mark reader');

// --- the narrative site
ok(() => /if \(knownPostKickoff\(parseOddsJSON\(row\.closing_odds\)\)\) continue;[\s\S]{0,120}computeOddsStory\(/.test(CA),
   'buildOddsStoryContext skips a late close before narrating movement');
ok(() => /import\s*\{[^}]*knownPostKickoff[^}]*\}\s*from\s*'\.\/odds-consumer-rules\.js'/.test(CA),
   'context-assembler imports the mark reader');

// --- the debug route agrees with the prompt
ok(() => /const story = \(hasOpening && hasClosing && !lateClose\)/.test(IX),
   'the /odds-story route applies the same guard as the prompt');

// --- nothing else in the three files still reaches for the column by name
const strays = [];
for (const [name, src] of [['analytics-engine.js', AE], ['context-assembler.js', CA]]) {
  for (const line of src.split('\n')) {
    if (/parseOddsJSON\(\s*(game|row)\.closing_odds\s*\)\s*\|\|/.test(line)) strays.push(`${name}: ${line.trim()}`);
  }
}
ok(() => strays.length === 0, `no site still falls back closing || opening (${strays.join(' | ')})`);

console.log(`${n - fails}/${n} assertions pass`);
process.exit(fails ? 1 : 0);
