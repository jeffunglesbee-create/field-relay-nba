#!/usr/bin/env node
/**
 * Rule 90 for scripts/check-opening-odds-late.mjs.
 *
 * Each mutation changes ONE thing in a copy of src/odds-consumer-rules.js, src/odds-story.js or src/index.js and aims the
 * check at the copy through RULES_SRC / STORY_SRC / INDEX_SRC. For a rules mutant the story copy is pointed at the mutated
 * rules too. The check must go red for every one. A mutant counts as CAUGHT only when an assertion failed ("N of M passed."
 * with N < M and a FAIL line): a crash proves nothing about what the check asserts and is a harness error.
 *
 * THE HARNESS'S OWN ANCHORS ARE ASSERTED. A mutation whose anchor is missing or not unique applies NOTHING, and a check
 * that is green on unmutated source would then print a pass for it.
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const FILES = { rules: 'src/odds-consumer-rules.js', story: 'src/odds-story.js', index: 'src/index.js' };
const text = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, readFileSync(f, 'utf8')]));
const born = [];
const put = (src, tag) => {
  const p = join('src', `.mutant-${tag}-${Math.random().toString(36).slice(2, 8)}.js`);
  writeFileSync(p, src); born.push(p); return resolve(p);
};
process.on('exit', () => { for (const p of born) rmSync(p, { force: true }); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

const STORY_IMPORT = "from './odds-consumer-rules.js';";
const run = ({ rules = null, story = null, index = null }) => {
  let out = '', code = 0;
  const env = { ...process.env };
  if (rules) env.RULES_SRC = rules;
  if (story) env.STORY_SRC = story;
  if (index) env.INDEX_SRC = index;
  try { out = execFileSync(process.execPath, ['scripts/check-opening-odds-late.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env }); }
  catch (e) { out = String(e.stdout || ''); code = e.status ?? 1; }
  const m = /^(\d+) of (\d+) passed\.$/m.exec(out);
  if (code === 0) return m && m[1] === m[2] ? 'pass' : 'error';
  return m && Number(m[1]) < Number(m[2]) && /^FAIL  /m.test(out) ? 'red' : 'error';
};

if (run({}) !== 'pass') { console.log('FAIL: the check is already red on the real files.'); process.exit(1); }
{
  const r = put(text.rules, 'rules-control');
  const s = put(text.story.replace(STORY_IMPORT, `from './${r.split(/[\\/]/).pop()}';`), 'story-control');
  const i = put(text.index, 'index-control');
  if (run({ rules: r, story: s, index: i }) !== 'pass') { console.log('FAIL: UNMUTATED copies at the mutant locations are red, so no verdict below would mean anything.'); process.exit(1); }
}
console.log('baseline: the check passes on the real files and on unmutated copies at the mutant locations\n');

const SPREAD = "parts.push(`opened ${odds.spread.home > 0 ? '+' : ''}${odds.spread.home}`);";
const MUTANTS = [
  // [name, file, anchor, replacement]
  // THE PREDICATE.
  ['R1 the predicate is verified:false, the closing readers\' (an unreadable kickoff then reads as late)', 'rules', 'return lateMinutes(odds) !== null;', 'return odds?._kickoff?.verified === false;'],
  ['R2 nothing is ever known late', 'rules', 'return lateMinutes(odds) !== null;', 'return false;'],
  ['R3 captured AT kickoff (0 minutes) is not late', 'rules', 'return lateMinutes(odds) !== null;', 'return lateMinutes(odds) !== null && lateMinutes(odds) > 0;'],
  // THE DEBRIEF LINE.
  ['R4 the debrief line prints an opening captured after kickoff', 'rules', 'if (!opening || knownLateOpening(opening)) return null;', 'if (!opening) return null;'],
  ['R5 the debrief line prints an in-play price as the close', 'rules', 'const closeStr = (closing && closing.moneyline && !knownPostKickoff(closing))', 'const closeStr = (closing && closing.moneyline)'],
  ['R6 the debrief line drops the plus sign', 'rules', "const signed = (n) => `${n > 0 ? '+' : ''}${n}`;", 'const signed = (n) => `${n}`;'],
  ['R7 the debrief line forgets the overtime', 'rules', "${wentToOT ? ' Went to OT.' : ''}", "${wentToOT ? '' : ''}"],
  // THE FRAGMENTS.
  ['R8 the annotation fragments are built for an opening captured after kickoff', 'rules', 'if (!odds || knownLateOpening(odds)) return [];', 'if (!odds) return [];'],
  ['R9 the spread fragment loses its plus sign', 'rules', SPREAD, "parts.push(`opened ${odds.spread.home}`);"],
  ['R10 the moneyline fragment is dropped', 'rules', 'if (odds.moneyline) parts.push(`ML ${odds.moneyline.home}/${odds.moneyline.away}`);', ''],
  // THE STORY.
  ['T1 the odds story narrates movement from an opening captured after kickoff', 'story', "if (knownLateOpening(open)) return '';", ''],
  ['T2 the odds story checks the closing instead of the opening', 'story', "if (knownLateOpening(open)) return '';", "if (knownLateOpening(close)) return '';"],
  // THE SITES.
  ['I1 the prompt builder passes the closing where the opening goes', 'index', 'debriefOddsLine(debriefCtx.opening_odds_parsed, debriefCtx.closing_odds_parsed, debriefCtx.went_to_ot)', 'debriefOddsLine(debriefCtx.closing_odds_parsed, debriefCtx.opening_odds_parsed, debriefCtx.went_to_ot)'],
  ['I2 the cron passes the closing where the opening goes', 'index', 'debriefOddsLine(_dc.opening_odds_parsed, _dc.closing_odds_parsed, _dc.went_to_ot)', 'debriefOddsLine(_dc.closing_odds_parsed, _dc.opening_odds_parsed, _dc.went_to_ot)'],
  ['I3 the prompt builder never says the game went to overtime', 'index', 'debriefCtx.closing_odds_parsed, debriefCtx.went_to_ot)', 'debriefCtx.closing_odds_parsed, false)'],
  ['I4 the cron never says the game went to overtime', 'index', '_dc.closing_odds_parsed, _dc.went_to_ot)', '_dc.closing_odds_parsed, false)'],
  ['I5 the prompt builder stops using the helper', 'index', 'const oddsLine = debriefOddsLine(debriefCtx.opening_odds_parsed, debriefCtx.closing_odds_parsed, debriefCtx.went_to_ot);', 'const oddsLine = null;'],
  ['I6 the cron stops using the helper', 'index', 'const _oddsLine = debriefOddsLine(_dc.opening_odds_parsed, _dc.closing_odds_parsed, _dc.went_to_ot);', 'const _oddsLine = null;'],
  ['I7 the backfill prompt formats the opening itself, with no late rule', 'index', 'const oddsParts = openingOddsParts(o);', 'const oddsParts = o.moneyline ? [`ML ${o.moneyline.home}/${o.moneyline.away}`] : [];'],
  ['I8 the slate annotation formats the opening itself, with no late rule', 'index', 'const parts = openingOddsParts(odds);', 'const parts = odds.moneyline ? [`ML ${odds.moneyline.home}/${odds.moneyline.away}`] : [];'],
  ['I9 lineMovement reports a "spreadOpen" from an opening captured after kickoff', 'index', ' && !knownLateOpening(openingOdds)', ''],
  ['I10 index.js stops importing one of the helpers', 'index', 'debriefOddsLine, openingOddsParts, knownLateOpening }', 'debriefOddsLine, openingOddsParts }'],
  ['I11 a new inline "opened" sentence appears in the backfill prompt', 'index', 'parts.push(`odds: ${oddsParts.join(\', \')}`);', 'parts.push(`odds: opened ${oddsParts.join(\', \')}`);'],
];

let missed = 0, nothing = 0, errored = 0;
for (const [name, file, anchor, repl] of MUTANTS) {
  const src = text[file];
  const count = src.split(anchor).length - 1;
  if (count !== 1) { nothing++; console.log(`NOTHING MUTATED  ${name}\n        the anchor occurs ${count} times in ${FILES[file]}, not once`); continue; }
  const mutated = src.replace(anchor, () => repl);
  const tag = name.slice(0, 3).trim();
  let verdict;
  if (file === 'rules') {
    const r = put(mutated, tag);
    const s = put(text.story.replace(STORY_IMPORT, `from './${r.split(/[\\/]/).pop()}';`), `${tag}s`);
    verdict = run({ rules: r, story: s });
  } else if (file === 'story') verdict = run({ story: put(mutated, tag) });
  else verdict = run({ index: put(mutated, tag) });
  const label = verdict === 'red' ? 'CAUGHT    ' : verdict === 'pass' ? 'NOT CAUGHT' : 'HARNESS ERROR (no assertion failed; a crash is not a catch)';
  console.log(`${label}  ${name}`);
  if (verdict === 'pass') missed++;
  if (verdict === 'error') errored++;
}
const caughtN = MUTANTS.length - missed - nothing - errored;
console.log(`\nmutations: ${caughtN} of ${MUTANTS.length} caught${missed ? `, ${missed} SURVIVED` : ''}${errored ? `, ${errored} harness error(s)` : ''}${nothing ? `, ${nothing} not applied` : ''}`);
console.log('COVERAGE: the predicate, both formatters, the story, and each of the six sites (arguments, helper use, imports, a stray inline sentence).');
console.log('NOT mutated: the surrounding functions of the executed statements, and src/context-assembler.js (its one call is counted by the wiring check).');
process.exit(missed || nothing || errored ? 1 : 0);
