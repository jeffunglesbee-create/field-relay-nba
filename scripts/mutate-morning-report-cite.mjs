#!/usr/bin/env node
// Rule 90: scripts/check-morning-report-cite.mjs has to fail when the contract in
// src/morning-report.js is broken. Each mutation below breaks one claim, runs the check,
// requires it to go red for the stated reason, then restores the file.
//
// The anchor of every mutation must occur exactly once, or NOTHING is mutated and the run
// fails: a "not caught" with no mutation applied would be worse than no test (Rule 90,
// the corollary for the harness).
//
// The mutations fall in groups: the facts the relay prints (M1-M10), the prompt (M11-M20), the
// parser (M21-M44), the paragraph (M45-M56), and the sentence the relay writes about a game
// (S1-S53: which kind a row is, the sport table and its thresholds, the overtime rule, the number
// words, the wording of each phrasing, and the rule that no model word reaches a game line).
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FILE = 'src/morning-report.js';
const CHECK = 'scripts/check-morning-report-cite.mjs';

const GRID = 'oracle, every margin from 0 to 144 in each family';
const GRID2 = 'oracle, every label x scores x overtime flags';
const ORDER = 'the order of the kinds';
const WORDS_AND_ARTICLES = 'number words and articles';
const NO_SENTENCE = 'no sentence for an event update, a golf or cricket or Australian-rules row';
const TURN = 'two games of the same kind in one report do not get the same sentence';
const PRINTED = 'headline, open, then each fact and the relay\'s sentence about it';
const NOT_TOLD = 'the prompt says what the model is not told';
const WHO_WRITES = 'the prompt says who writes the facts and what the model may not write';
const NO_DESCRIBE = 'the prompt does not let the model describe a game';
const DECIDED = 'every declared sport label has a decision';

const MUTATIONS = [
  // ── the facts the relay prints ────────────────────────────────────────────
  { name: 'M1  a team is printed beside the other team\'s score',
    anchor: '? `${home} ${g.home_score}, ${away} ${g.away_score}`',
    replace: '? `${home} ${g.away_score}, ${away} ${g.home_score}`',
    expect: '2026-07-02: each team is printed beside its own score' },

  { name: 'M2  a tie is printed as a win for the home side',
    anchor: 'return g.home_score > g.away_score',
    replace: 'return g.home_score >= g.away_score',
    expect: 'a fact is printed winner first from the row, a tie away first' },

  { name: 'M3  a scored row with a missing team name is still printed',
    anchor: 'if (!home || !away) return null;',
    replace: '',
    expect: 'a fact is printed winner first from the row' },

  { name: 'M4  an event row loses its round',
    anchor: "const label = home ? (away ? `${home} (${away})` : home) : '';",
    replace: 'const label = home;',
    expect: 'a fact is printed winner first from the row' },

  { name: 'M5  a row with no score and no note is printed anyway',
    anchor: 'if (!note) return null;',
    replace: '',
    expect: 'a fact is printed winner first from the row' },

  { name: 'M6  the descriptor names the home team',
    anchor: '`${sport} | final ${hi}-${lo}, margin ${hi - lo}, total ${hi + lo}${ot}`',
    replace: '`${sport} | ${g.home} final ${hi}-${lo}, margin ${hi - lo}, total ${hi + lo}${ot}`',
    expect: 'the prompt contains no team name, event name, note or game id' },

  { name: 'M7  the descriptor drops the overtime flag',
    anchor: "const ot = wentToOt(g) ? ', went to overtime' : '';",
    replace: "const ot = '';",
    expect: 'the descriptor says the sport and the shape of the result' },

  { name: 'M8  the descriptor reports the wrong margin',
    anchor: 'margin ${hi - lo}, total ${hi + lo}${ot}`',
    replace: 'margin ${hi + lo}, total ${hi + lo}${ot}`',
    expect: 'the descriptor says the sport and the shape of the result' },

  { name: 'M9  the game Phase 3 already printed stays in the list',
    anchor: 'if (excludeGameId && g.id === excludeGameId) continue;',
    replace: '',
    expect: 'the game Phase 3 already printed is left out' },

  { name: 'M10 ids keep the recap position instead of closing up',
    anchor: 'out.push({ id: `g${out.length + 1}`,',
    replace: 'out.push({ id: `g${recapGames.indexOf(g) + 1}`,',
    expect: 'ids run g1, g2, ... in recap order' },

  // ── the prompt ────────────────────────────────────────────────────────────
  { name: 'M11 the prompt carries the truth headline',
    anchor: "const truthGloss = TRUTH_GLOSS[truthIs?.type] || 'not available tonight';",
    replace: "const truthGloss = truthIs?.headline || 'not available tonight';",
    expect: 'the prompt carries the truth as words and never its headline' },

  { name: 'M12 the prompt stops saying who writes the facts',
    anchor: 'You choose and you frame; the relay writes every fact. ',
    replace: 'You choose and you frame; the model writes every fact. ',
    expect: WHO_WRITES },

  { name: 'M13 the prompt stops forbidding digits',
    anchor: '- Never write a digit. Spell every number out as a word.\\n',
    replace: '',
    expect: WHO_WRITES },

  { name: 'M14 the prompt stops forbidding names',
    anchor: '- Never write a team name, a city, a player name or a league name.\\n',
    replace: '',
    expect: WHO_WRITES },

  { name: 'M15 the form asks for a sentence about each game again',
    anchor: '`pick: <the ids of the 3 or 4 games that matter most, most important first, separated by commas>\\n`',
    replace: '`g1: <one sentence about that game>\\n`',
    expect: 'the form asks for a pick line, an open line and a close line, and no sentence about any game' },

  { name: 'M16 the prompt lets the model describe a game and say how it went',
    anchor: 'Do not name, number, rank or describe any single game, and do not say how any game went: the relay ',
    replace: 'the relay ',
    expect: NO_DESCRIBE },

  { name: 'M17 the prompt lets the model call a result expected or a surprise',
    anchor: 'and nothing about whether a result was expected or a surprise, except what THE TRUTH IS ',
    replace: '',
    expect: NO_DESCRIBE },

  { name: 'M18 the prompt stops saying what the model is not told',
    anchor: 'You are told only the sports and the final ',
    replace: 'You are told everything about the sports and the final ',
    expect: NOT_TOLD },

  { name: 'M19 the prompt stops forbidding sides, comebacks and late drama',
    anchor: 'home or away sides, comebacks, late drama, ',
    replace: '',
    expect: NOT_TOLD },

  { name: 'M20 the prompt offers "the visitors" as wording again (2026-10-30 replay)',
    anchor: '- Speak of the night as a whole, in your own words.\\n',
    replace: '- Speak of the night as a whole, as "the visitors" and "the home side" would.\\n',
    expect: 'the prompt offers no wording the model cannot back' },

  // ── the parser: the open and close lines ──────────────────────────────────
  { name: 'M21 a digit no longer drops a line',
    anchor: "if (/\\p{N}/u.test(body)) return 'digit';",
    replace: '',
    expect: 'a digit drops an open or close line' },

  { name: 'M22 only ASCII digits drop a line',
    anchor: "if (/\\p{N}/u.test(body)) return 'digit';",
    replace: "if (/[0-9]/.test(body)) return 'digit';",
    expect: 'a digit drops an open or close line: "A ３ goal margin."' },

  { name: 'M23 a slate name no longer drops a line',
    anchor: "if (matchers.some(re => re.test(body))) return 'team-name';",
    replace: '',
    expect: '2026-07-15: "Chicago Fire" is dropped' },

  { name: 'M24 a slate name matches inside a longer word',
    anchor: '(?<![A-Za-z])${escapeRe(n)}(?![A-Za-z])',
    replace: '${escapeRe(n)}',
    expect: 'a name only counts as a whole, capitalised word' },

  { name: 'M25 a slate name matches in any case',
    anchor: 'new RegExp(`(?<![A-Za-z])${escapeRe(n)}(?![A-Za-z])`)',
    replace: "new RegExp(`(?<![A-Za-z])${escapeRe(n)}(?![A-Za-z])`, 'i')",
    expect: 'a name only counts as a whole, capitalised word' },

  { name: 'M26 only the first game\'s names are on the slate list',
    anchor: '.flatMap(g => [g.home, g.away])',
    replace: '.slice(0, 1).flatMap(g => [g.home, g.away])',
    expect: '2026-07-15: "Chicago Fire" is dropped' },

  { name: 'M27 the length rule is dropped',
    anchor: "if (body.split(/\\s+/).length > MR_MAX_LINE_WORDS) return 'too-long';",
    replace: '',
    expect: 'a line is at most 60 words' },

  { name: 'M28 a line with no full stop is printed',
    anchor: "if (!TERMINAL.test(body)) return 'unterminated';",
    replace: '',
    expect: 'a line without a full stop' },

  { name: 'M29 the open line skips the rules',
    anchor: 'else if (problem) drop(word, problem);\n            else out[word] = body;',
    replace: 'else out[word] = body;',
    expect: 'a name in the open line drops the open line and leaves the close line' },

  { name: 'M30 a repeated open line replaces the first',
    anchor: 'if (out[word] !== null) drop(word, `duplicate-${word}`);',
    replace: 'if (false) drop(word, `duplicate-${word}`);',
    expect: 'a repeated open or close line keeps the first' },

  { name: 'M31 a line that does not follow the form vanishes without a record',
    anchor: "if (!m) { drop(null, 'unrecognized-line'); continue; }",
    replace: 'if (!m) { continue; }',
    expect: 'a line that does not follow the form is dropped without disturbing the rest' },

  { name: 'M32 the dropped list is not capped',
    anchor: 'const MAX_DROPPED = 12;',
    replace: 'const MAX_DROPPED = 1000;',
    expect: 'the dropped list is capped at twelve records' },

  { name: 'M33 a dropped line is recorded with its text',
    anchor: 'out.dropped.push({ key, reason });',
    replace: "out.dropped.push({ key, reason, text: String(text || '') });",
    expect: 'a dropped line is recorded by key and reason only' },

  // ── the parser: the pick line ─────────────────────────────────────────────
  { name: 'M34 an unknown id is taken for the first game',
    anchor: 'const entry = byId.get(key);',
    replace: 'const entry = byId.get(key) || citable[0];',
    expect: '2026-07-03: an id that is not in the list is dropped' },

  { name: 'M35 a repeated id is printed twice',
    anchor: "else if (seen.has(key)) drop(key, 'duplicate-id');",
    replace: "else if (false) drop(key, 'duplicate-id');",
    expect: 'a repeated id keeps the first and drops the rest' },

  { name: 'M36 the limit on games is lifted',
    anchor: "else if (out.picks.length >= MR_MAX_PICKS) drop(key, 'over-limit');",
    replace: "else if (false) drop(key, 'over-limit');",
    expect: 'at most five games are kept' },

  { name: 'M37 the limit on games is six',
    anchor: 'export const MR_MAX_PICKS = 5;',
    replace: 'export const MR_MAX_PICKS = 6;',
    expect: 'at most five games are kept' },

  { name: 'M38 the limit on games is off by one',
    anchor: 'out.picks.length >= MR_MAX_PICKS',
    replace: 'out.picks.length > MR_MAX_PICKS',
    expect: 'at most five games are kept' },

  { name: 'M39 ids keep their leading zeros',
    anchor: '`g${Number(t[1])}`',
    replace: '`g${t[1]}`',
    expect: 'leading zeros do not matter' },

  { name: 'M40 ids are case-sensitive',
    anchor: 'const GAME_ID = /^g([0-9]{1,3})$/i;',
    replace: 'const GAME_ID = /^g([0-9]{1,3})$/;',
    expect: 'keys are case-insensitive' },

  { name: 'M41 ids must be separated by commas',
    anchor: 'split(/[\\s,;]+/)',
    replace: 'split(/,\\s*/)',
    expect: 'ids may be separated by commas, semicolons or spaces' },

  { name: 'M42 a closing full stop on the pick line spoils the last id',
    anchor: "body.replace(/\\.+$/, '')",
    replace: 'body',
    expect: 'a plural key and a closing full stop on the pick line are not a break of the form' },

  { name: 'M43 the key must be singular',
    anchor: 'const LINE = /^\\s*(open|close|picks?)\\s*:',
    replace: 'const LINE = /^\\s*(open|close|pick)\\s*:',
    expect: 'a plural key and a closing full stop on the pick line are not a break of the form' },

  { name: 'M44 a word on the pick line that is not an id is dropped without a record',
    anchor: 'if (!t) { stray = true; continue; }',
    replace: 'if (!t) { continue; }',
    expect: 'a word on the pick line that is not an id is dropped, once for the line' },

  { name: 'M45 a word on the pick line that is not an id is recorded once per word',
    anchor: 'if (!t) { stray = true; continue; }',
    replace: "if (!t) { stray = true; drop('pick', 'unrecognized-pick'); continue; }",
    expect: 'a word on the pick line that is not an id is dropped, once for the line' },

  { name: 'M46 a second pick line is added to the first',
    anchor: "if (sawPick) { drop('pick', 'duplicate-pick'); continue; }",
    replace: '',
    expect: 'a second pick line is dropped whole; the first stands' },

  { name: 'M47 the retired per-game line is a line of the form again',
    anchor: 'const LINE = /^\\s*(open|close|picks?)\\s*:',
    replace: 'const LINE = /^\\s*(open|close|picks?|g[0-9]+)\\s*:',
    expect: 'the old form (a sentence for each game) is no longer the form' },

  { name: 'M48 a pick keeps the model\'s own words',
    anchor: 'out.picks.push({ entry });',
    replace: 'out.picks.push({ entry, note: body });',
    expect: 'a pick carries nothing of the model\'s but its id' },

  // ── the paragraph ─────────────────────────────────────────────────────────
  { name: 'M49 the headline is invented when there is none',
    anchor: 'const h = clean(headline);',
    replace: "const h = clean(headline) || 'A quiet night.';",
    expect: 'nothing is invented to stand in for it' },

  { name: 'M50 the open line comes before the headline',
    anchor: 'if (h) parts.push(end(h));\n    if (parsed.open) parts.push(parsed.open);',
    replace: 'if (parsed.open) parts.push(parsed.open);\n    if (h) parts.push(end(h));',
    expect: PRINTED },

  { name: 'M51 a fact is joined to its sentence without a full stop',
    anchor: 'const fact = end(p.entry.fact);',
    replace: 'const fact = p.entry.fact;',
    expect: PRINTED },

  { name: 'M52 an open and a close with no pick make a report',
    anchor: 'if (!parsed.picks.length) return null;',
    replace: '',
    expect: 'an open and a close with no pick is not a report' },

  { name: 'M53 `cited` is empty',
    anchor: 'cited: parsed.picks.map(p => p.entry.gameId).filter(Boolean)',
    replace: 'cited: []',
    expect: '`cited` lists the real game ids' },

  { name: 'M54 a headline without a full stop is printed as it is',
    anchor: 'if (h) parts.push(end(h));',
    replace: 'if (h) parts.push(h);',
    expect: 'a headline without a full stop gets one' },

  { name: 'M55 the close line is never printed',
    anchor: 'if (parsed.close) parts.push(parsed.close);',
    replace: '',
    expect: PRINTED },

  { name: 'M56 `games` forgets the sentence',
    anchor: 'games.push({ id: p.entry.id, gameId: p.entry.gameId, fact, sentence });',
    replace: 'games.push({ id: p.entry.id, gameId: p.entry.gameId, fact, sentence: null });',
    expect: '`games` lists what was printed for each pick' },

  { name: 'M57 the recap keeps seventeen games',
    anchor: '.slice(0, 16);',
    replace: '.slice(0, 17);',
    expect: 'selectRecapGames keeps the first sixteen' },

  { name: 'M58 the recap lists the postseason first',
    anchor: '? [...(ctx.games?.regular || []), ...(ctx.games?.postseason || [])]\n        : [];',
    replace: '? [...(ctx.games?.postseason || []), ...(ctx.games?.regular || [])]\n        : [];',
    expect: 'selectRecapGames keeps the first sixteen, regular season before postseason' },

  { name: 'M59 the recap keeps a game with only one score',
    anchor: "typeof g.home_score === 'number' && typeof g.away_score === 'number'",
    replace: "typeof g.home_score === 'number' || typeof g.away_score === 'number'",
    expect: 'selectRecapGames keeps a game with two numeric scores or a note' },

  { name: 'M60 prepare forgets to leave the truth game out',
    anchor: 'citableGames(recapGames, { excludeGameId: truthIs?.game_id })',
    replace: 'citableGames(recapGames)',
    expect: 'prepare: the recap is built from the context and the truth game is left out' },

  { name: 'M61 finish composes without the headline',
    anchor: 'composeMorningReport({ headline: truthIs?.headline, parsed })',
    replace: 'composeMorningReport({ headline: null, parsed })',
    expect: 'finish: the headline is first' },

  { name: 'M62 finish parses without the slate names',
    anchor: 'parseMorningReportLines(text, prepared.citable, prepared.slateNames)',
    replace: 'parseMorningReportLines(text, prepared.citable, [])',
    expect: 'finish: the headline is first, the games follow, and a slate name from the context drops the close line' },

  { name: 'M63 the token allowance changes',
    anchor: 'export const MR_MAX_TOKENS = 320;',
    replace: 'export const MR_MAX_TOKENS = 250;',
    expect: 'the answer is allowed 320 tokens' },

  // ── the sentence about a game: which kind of result a row is ─────────────
  { name: 'S1  a shutout that went to overtime is called a shutout',
    anchor: "        : ot ? 'win-ot'\n        : lo === 0 ? 'shutout'",
    replace: "        : lo === 0 ? 'shutout'\n        : ot ? 'win-ot'",
    expect: ORDER },

  { name: 'S2  a shutout by a wide margin is called lopsided',
    anchor: "        : lo === 0 ? 'shutout'\n        : margin >= fam.wide ? 'wide'",
    replace: "        : margin >= fam.wide ? 'wide'\n        : lo === 0 ? 'shutout'",
    expect: ORDER },

  { name: 'S3  a 0-0 game that went to extra time is called level after it',
    anchor: "? (hi === 0 ? 'scoreless' : ot ? 'level-ot' : 'level')",
    replace: "? (ot ? 'level-ot' : hi === 0 ? 'scoreless' : 'level')",
    expect: ORDER },

  { name: 'S4  a game the losers scored one in is called a shutout',
    anchor: "lo === 0 ? 'shutout'",
    replace: "lo <= 1 ? 'shutout'",
    expect: GRID2 },

  { name: 'S5  a margin equal to the lopsided threshold is not lopsided',
    anchor: "margin >= fam.wide ? 'wide'",
    replace: "margin > fam.wide ? 'wide'",
    expect: GRID },

  { name: 'S6  a margin equal to the narrow threshold is not narrow',
    anchor: "margin <= fam.narrow ? 'narrow'",
    replace: "margin < fam.narrow ? 'narrow'",
    expect: GRID },

  { name: 'S7  a level game is called a win',
    anchor: "(hi === 0 ? 'scoreless' : ot ? 'level-ot' : 'level')",
    replace: "(hi === 0 ? 'scoreless' : ot ? 'level-ot' : 'win')",
    expect: GRID2 },

  // ── the overtime rule ─────────────────────────────────────────────────────
  { name: 'S8  any truthy flag says the game went to overtime',
    anchor: 'const wentToOt = (g) => g.went_to_ot === 1 || g.went_to_ot === true;',
    replace: 'const wentToOt = (g) => Boolean(g.went_to_ot);',
    expect: 'overtime is printed only when the row says 1 or true' },

  { name: 'S9  a true flag does not say the game went to overtime',
    anchor: 'const wentToOt = (g) => g.went_to_ot === 1 || g.went_to_ot === true;',
    replace: 'const wentToOt = (g) => g.went_to_ot === 1;',
    expect: 'overtime is printed only when the row says 1 or true' },

  { name: 'S10 the game never went to overtime',
    anchor: 'const wentToOt = (g) => g.went_to_ot === 1 || g.went_to_ot === true;',
    replace: 'const wentToOt = (g) => false;',
    expect: 'overtime is printed only when the row says 1 or true' },

  { name: 'S11 an unknown period (null) is taken for overtime',
    anchor: 'const wentToOt = (g) => g.went_to_ot === 1 || g.went_to_ot === true;',
    replace: 'const wentToOt = (g) => g.went_to_ot !== 0 && g.went_to_ot !== false;',
    expect: 'overtime is printed only when the row says 1 or true' },

  { name: 'S12 the descriptor says overtime on any truthy flag',
    anchor: "const ot = wentToOt(g) ? ', went to overtime' : '';",
    replace: "const ot = g.went_to_ot ? ', went to overtime' : '';",
    expect: 'the descriptor says overtime under the same rule as the sentence' },

  // ── the sport table: units, thresholds, labels ────────────────────────────
  { name: 'S13 hockey calls a two-goal margin narrow',
    anchor: 'narrow: 1, wide: 4,',
    replace: 'narrow: 2, wide: 4,',
    expect: GRID },

  { name: 'S14 hockey calls a three-goal margin lopsided',
    anchor: 'narrow: 1, wide: 4,',
    replace: 'narrow: 1, wide: 3,',
    expect: GRID },

  { name: 'S15 soccer calls a two-goal margin narrow',
    anchor: 'narrow: 1, wide: 3,  labels: [',
    replace: 'narrow: 2, wide: 3,  labels: [',
    expect: GRID },

  { name: 'S16 soccer needs four goals to be lopsided',
    anchor: 'narrow: 1, wide: 3,  labels: [',
    replace: 'narrow: 1, wide: 4,  labels: [',
    expect: GRID },

  { name: 'S17 basketball calls a four-point margin narrow',
    anchor: 'narrow: 3, wide: 20, labels: [',
    replace: 'narrow: 4, wide: 20, labels: [',
    expect: GRID },

  { name: 'S18 basketball needs twenty-one points to be lopsided',
    anchor: 'narrow: 3, wide: 20, labels: [',
    replace: 'narrow: 3, wide: 21, labels: [',
    expect: GRID },

  { name: 'S19 baseball calls a two-run margin narrow',
    anchor: 'narrow: 1, wide: 6,  labels: [',
    replace: 'narrow: 2, wide: 6,  labels: [',
    expect: GRID },

  { name: 'S20 baseball calls a five-run margin lopsided',
    anchor: 'narrow: 1, wide: 6,  labels: [',
    replace: 'narrow: 1, wide: 5,  labels: [',
    expect: GRID },

  { name: 'S21 football calls a two-point margin narrow',
    anchor: 'narrow: 3, wide: 21, labels: [',
    replace: 'narrow: 2, wide: 21, labels: [',
    expect: GRID },

  { name: 'S22 football calls a twenty-point margin lopsided',
    anchor: 'narrow: 3, wide: 21, labels: [',
    replace: 'narrow: 3, wide: 20, labels: [',
    expect: GRID },

  { name: 'S23 baseball scores goals',
    anchor: "baseball:   { unit: 'run',",
    replace: "baseball:   { unit: 'goal',",
    expect: GRID },

  { name: 'S24 football scores goals',
    anchor: "gridiron:   { unit: 'point',",
    replace: "gridiron:   { unit: 'goal',",
    expect: GRID },

  { name: 'S25 soccer calls extra time overtime',
    anchor: "over: 'extra time',",
    replace: "over: 'overtime',",
    expect: GRID },

  { name: 'S26 baseball calls extra innings overtime',
    anchor: "over: 'extra innings',",
    replace: "over: 'overtime',",
    expect: GRID },

  { name: 'S27 hockey says the game went to a shootout',
    anchor: "hockey:     { unit: 'goal',  over: 'overtime',",
    replace: "hockey:     { unit: 'goal',  over: 'a shootout',",
    expect: GRID },

  { name: 'S28 MLB is in no family',
    anchor: "labels: ['MLB'] }",
    replace: 'labels: [] }',
    expect: DECIDED },

  { name: 'S29 a label is compared in the case it was written',
    anchor: 'const k = clean(label).toLowerCase();',
    replace: 'const k = clean(label);',
    expect: 'a label is compared trimmed and in lower case' },

  { name: 'S30 golf is in no family',
    anchor: "export const NO_SENTENCE_LABELS = ['AFL', 'IPL', 'PGA Tour', 'golf'];",
    replace: "export const NO_SENTENCE_LABELS = ['AFL', 'IPL', 'PGA Tour'];",
    expect: DECIDED },

  { name: 'S31 a label is misspelt in the table',
    anchor: "'EFL League Two'",
    replace: "'EFL League Too'",
    expect: DECIDED },

  { name: 'S32 a sport nobody decided on gets hockey\'s sentences',
    anchor: 'Object.hasOwn(FAMILIES, family) ? FAMILIES[family] : null;',
    replace: 'Object.hasOwn(FAMILIES, family) ? FAMILIES[family] : FAMILIES.hockey;',
    expect: NO_SENTENCE },

  { name: 'S33 a fractional score gets a sentence',
    anchor: 'if (!Number.isInteger(hi) || !Number.isInteger(lo) || lo < 0) return null;',
    replace: 'if (lo < 0) return null;',
    expect: NO_SENTENCE },

  { name: 'S34 a score below zero gets a sentence',
    anchor: 'if (!Number.isInteger(hi) || !Number.isInteger(lo) || lo < 0) return null;',
    replace: 'if (!Number.isInteger(hi) || !Number.isInteger(lo)) return null;',
    expect: NO_SENTENCE },

  // ── the number words, the article, the plural ─────────────────────────────
  { name: 'S35 sixty and seventy trade places',
    anchor: "'fifty', 'sixty', 'seventy',",
    replace: "'fifty', 'seventy', 'sixty',",
    expect: GRID },

  { name: 'S36 fifteen is spelt "fiveteen"',
    anchor: "'fifteen', 'sixteen'",
    replace: "'fiveteen', 'sixteen'",
    expect: GRID },

  { name: 'S37 a tens-and-ones number has no hyphen',
    anchor: '(n % 10 ? `-${ONES[n % 10]}` : \'\')',
    replace: '(n % 10 ? ONES[n % 10] : \'\')',
    expect: GRID },

  { name: 'S38 a number from one hundred is spelt as a word',
    anchor: 'return String(n);',
    replace: "return 'many';",
    expect: GRID },

  { name: 'S39 the article is always "A"',
    anchor: "A: /^e/.test(w) ? 'An' : 'A',",
    replace: "A: 'A',",
    expect: WORDS_AND_ARTICLES },

  { name: 'S40 "one" takes "an"',
    anchor: "A: /^e/.test(w) ? 'An' : 'A',",
    replace: "A: /^[eo]/.test(w) ? 'An' : 'A',",
    expect: WORDS_AND_ARTICLES },

  { name: 'S41 one point is "points"',
    anchor: 'units: shape.n === 1 ? shape.unit : `${shape.unit}s`,',
    replace: 'units: `${shape.unit}s`,',
    expect: 'one point is singular, two are plural' },

  { name: 'S42 two points are "point"',
    anchor: 'units: shape.n === 1 ? shape.unit : `${shape.unit}s`,',
    replace: 'units: shape.unit,',
    expect: 'one point is singular, two are plural' },

  { name: 'S43 a phrasing that opens on the number is not capitalised',
    anchor: 'const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);',
    replace: 'const cap = (s) => s;',
    expect: 'a phrasing that opens on the number capitalises it' },

  // ── the wording of each phrasing: a wrong claim put into each kind ────────
  { name: 'S44 a plain win is called a loss',
    anchor: '(s) => `${s.A} ${s.w}-${s.unit} win.`,',
    replace: '(s) => `${s.A} ${s.w}-${s.unit} loss.`,',
    expect: GRID2 },

  { name: 'S45 a lopsided win is called comfortable (a word the spec does not define)',
    anchor: '`A lopsided ${s.w}-${s.unit} win.`',
    replace: '`A comfortable ${s.w}-${s.unit} win.`',
    expect: GRID2 },

  { name: 'S46 a narrow win is called comfortable',
    anchor: '`Won narrowly, by ${s.w} ${s.units}.`',
    replace: '`Won comfortably, by ${s.w} ${s.units}.`',
    expect: GRID2 },

  { name: 'S47 a shutout says the losers scored one',
    anchor: "() => 'The losing side was held scoreless.',",
    replace: "() => 'The losing side was held to one.',",
    expect: GRID2 },

  { name: 'S48 a level game says one side finished ahead',
    anchor: "() => 'Neither side finished ahead.'",
    replace: "() => 'The home side finished ahead.'",
    expect: GRID2 },

  { name: 'S49 a 0-0 game says both sides scored',
    anchor: "() => 'Neither side scored.',",
    replace: "() => 'Both sides scored.',",
    expect: GRID2 },

  { name: 'S50 an overtime win does not say it went to overtime',
    anchor: '`${s.A} ${s.w}-${s.unit} win after ${s.over}.`',
    replace: '`${s.A} ${s.w}-${s.unit} win.`',
    expect: GRID2 },

  { name: 'S51 a level game after overtime says it was level after regulation',
    anchor: '(s) => `Level after ${s.over}.`,',
    replace: '(s) => `Level after regulation.`,',
    expect: GRID2 },

  { name: 'S52 a narrow win says how the game went ("all night")',
    anchor: '`Just ${s.w} ${s.units} between the sides at the end.`',
    replace: '`Just ${s.w} ${s.units} between the sides all night.`',
    expect: GRID2 },

  { name: 'S53 a plain win reports the wrong number',
    anchor: '`Won by ${s.w} ${s.units}.`',
    replace: '`Won by ${numberWord(s.n + 1)} ${s.units}.`',
    expect: GRID2 },

  { name: 'S54 a plain win names its unit in the singular',
    anchor: '`${cap(s.w)} ${s.units} separated the sides.`',
    replace: '`${cap(s.w)} ${s.unit} separated the sides.`',
    expect: GRID2 },

  { name: 'S55 a shutout says "a" before eight',
    anchor: '`${s.A} ${s.w}-${s.unit} shutout.`',
    replace: '`A ${s.w}-${s.unit} shutout.`',
    expect: WORDS_AND_ARTICLES },

  { name: 'S56 an overtime win says "a" before eleven',
    anchor: '`${s.A} ${s.w}-${s.unit} win after ${s.over}.`',
    replace: '`A ${s.w}-${s.unit} win after ${s.over}.`',
    expect: WORDS_AND_ARTICLES },

  // ── a kind that is not a phrasing, a variant that is not a number ────────
  { name: 'S57 a kind that is only inherited ("toString") is a phrasing',
    anchor: 'Object.hasOwn(FRAMES, shape.kind) ? FRAMES[shape.kind] : null;',
    replace: 'shape.kind in FRAMES ? FRAMES[shape.kind] : null;',
    expect: 'no shape, or a kind the relay has no phrasing for, writes no sentence' },

  { name: 'S58 a variant that is not a number is not tolerated',
    anchor: 'const i = Number.isFinite(variant) ? Math.trunc(variant) : 0;',
    replace: 'const i = Math.trunc(variant);',
    expect: 'a variant that is negative, fractional, missing or not a number' },

  { name: 'S59 a negative variant is not wrapped',
    anchor: 'const v = ((i % frames.length) + frames.length) % frames.length;',
    replace: 'const v = i % frames.length;',
    expect: 'a variant that is negative, fractional, missing or not a number' },

  // ── the phrasings are handed out in turn ──────────────────────────────────
  { name: 'S60 every game gets the first phrasing of its kind',
    anchor: 'resultSentence(shape, used[shape.kind] = (used[shape.kind] ?? -1) + 1)',
    replace: 'resultSentence(shape, 0)',
    expect: TURN },

  { name: 'S61 one turn counter is shared by every kind',
    anchor: 'resultSentence(shape, used[shape.kind] = (used[shape.kind] ?? -1) + 1)',
    replace: 'resultSentence(shape, used.n = (used.n ?? -1) + 1)',
    expect: 'the turn is taken per kind' },

  { name: 'S62 the sentence comes before the fact',
    anchor: 'parts.push(sentence ? `${fact} ${sentence}` : fact);',
    replace: 'parts.push(sentence ? `${sentence} ${fact}` : fact);',
    expect: PRINTED },

  { name: 'S63 the sentence is never printed',
    anchor: 'parts.push(sentence ? `${fact} ${sentence}` : fact);',
    replace: 'parts.push(fact);',
    expect: PRINTED },

  { name: 'S64 the open line is printed after every game',
    anchor: 'parts.push(sentence ? `${fact} ${sentence}` : fact);',
    replace: 'parts.push(sentence ? `${fact} ${sentence} ${parsed.open ?? \'\'}` : fact);',
    expect: PRINTED },
];

let bad = 0;
for (const m of MUTATIONS) {
  const BAK = `${FILE}.mutbak`;
  const before = readFileSync(FILE, 'utf8');
  const hits = before.split(m.anchor).length - 1;
  if (hits !== 1) {
    bad++;
    console.error(`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s), expected 1. NOTHING WAS MUTATED.`);
    continue;
  }
  const after = before.replace(m.anchor, () => m.replace);
  if (after === before) { bad++; console.error(`  NO EFFECT  ${m.name}`); continue; }
  copyFileSync(FILE, BAK);
  writeFileSync(FILE, after);
  let out = '', code = 0;
  try { out = execFileSync('node', [CHECK], { encoding: 'utf8' }); }
  catch (e) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`; }
  finally { copyFileSync(BAK, FILE); unlinkSync(BAK); }
  const red = out.split('\n').filter(l => l.startsWith('FAIL'));
  if (code === 0) { bad++; console.error(`  NOT CAUGHT  ${m.name}`); }
  else if (!red.some(l => l.includes(m.expect))) {
    bad++;
    console.error(`  WRONG REASON  ${m.name}\n          no FAIL line mentioned "${m.expect}".\n${red.join('\n') || out.split('\n').slice(0, 6).join('\n')}`);
  } else console.log(`  caught  ${m.name}\n          by "${m.expect}" (${red.length} red)`);
}

execFileSync('node', ['--check', FILE]);
console.log(`\nran ${MUTATIONS.length} mutation(s) against ${CHECK}; ${FILE} restored and parsing`);
process.exit(bad ? 1 : 0);
