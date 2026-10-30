#!/usr/bin/env node
// Rule 90: scripts/check-morning-report-cite.mjs has to fail when the contract in
// src/morning-report.js is broken. Each mutation below breaks one claim, runs the check,
// requires it to go red for the stated reason, then restores the file.
//
// The anchor of every mutation must occur exactly once, or NOTHING is mutated and the run
// fails: a "not caught" with no mutation applied would be worse than no test (Rule 90,
// the corollary for the harness).
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FILE = 'src/morning-report.js';
const CHECK = 'scripts/check-morning-report-cite.mjs';

const MUTATIONS = [
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
    anchor: "const ot = g.went_to_ot ? ', went to overtime' : '';",
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

  { name: 'M11 the prompt carries the truth headline',
    anchor: "const truthGloss = TRUTH_GLOSS[truthIs?.type] || 'not available tonight';",
    replace: "const truthGloss = truthIs?.headline || 'not available tonight';",
    expect: 'the prompt carries the truth as words and never its headline' },

  { name: 'M12 the prompt stops saying who writes the facts',
    anchor: 'The relay prints every team name, ',
    replace: 'The model prints every team name, ',
    expect: 'the prompt says who writes the facts' },

  { name: 'M13 the prompt stops forbidding digits',
    anchor: '- Never write a digit. Spell every number out as a word.\\n',
    replace: '',
    expect: 'the prompt says who writes the facts' },

  { name: 'M14 the form shows three ids',
    anchor: 'citable.slice(0, 2).map(c => `${c.id}: <one sentence about that game>`)',
    replace: 'citable.slice(0, 3).map(c => `${c.id}: <one sentence about that game>`)',
    expect: 'the form shows the first two real ids' },

  { name: 'M15 a digit no longer drops a line',
    anchor: "if (/\\p{N}/u.test(body)) return 'digit';",
    replace: '',
    expect: 'a digit drops the line' },

  { name: 'M16 only ASCII digits drop a line',
    anchor: "if (/\\p{N}/u.test(body)) return 'digit';",
    replace: "if (/[0-9]/.test(body)) return 'digit';",
    expect: 'a digit drops the line: "A ３ goal margin."' },

  { name: 'M17 a slate name no longer drops a line',
    anchor: "if (matchers.some(re => re.test(body))) return 'team-name';",
    replace: '',
    expect: '2026-07-15: "Chicago Fire" is dropped' },

  { name: 'M18 a slate name matches inside a longer word',
    anchor: '(?<![A-Za-z])${escapeRe(n)}(?![A-Za-z])',
    replace: '${escapeRe(n)}',
    expect: 'a name only counts as a whole, capitalised word' },

  { name: 'M19 a slate name matches in any case',
    anchor: 'new RegExp(`(?<![A-Za-z])${escapeRe(n)}(?![A-Za-z])`)',
    replace: "new RegExp(`(?<![A-Za-z])${escapeRe(n)}(?![A-Za-z])`, 'i')",
    expect: 'a name only counts as a whole, capitalised word' },

  { name: 'M20 only the first game\'s names are on the slate list',
    anchor: '.flatMap(g => [g.home, g.away])',
    replace: '.slice(0, 1).flatMap(g => [g.home, g.away])',
    expect: '2026-07-15: "Chicago Fire" is dropped' },

  { name: 'M21 the length rule is dropped',
    anchor: "if (body.split(/\\s+/).length > MR_MAX_LINE_WORDS) return 'too-long';",
    replace: '',
    expect: 'a line is at most 60 words' },

  { name: 'M22 a line with no full stop is printed',
    anchor: "if (!TERMINAL.test(body)) return 'unterminated';",
    replace: '',
    expect: 'a line without a full stop' },

  { name: 'M23 an unknown id is taken for the first game',
    anchor: 'const entry = byId.get(key);',
    replace: 'const entry = byId.get(key) || citable[0];',
    expect: '2026-07-03: an id that is not in the list is dropped' },

  { name: 'M24 a repeated id is printed twice',
    anchor: "else if (seen.has(key)) drop(key, 'duplicate-id');",
    replace: "else if (false) drop(key, 'duplicate-id');",
    expect: 'a repeated id keeps the first line' },

  { name: 'M25 the limit on game lines is lifted',
    anchor: "else if (out.picks.length >= MR_MAX_PICKS) drop(key, 'over-limit');",
    replace: "else if (false) drop(key, 'over-limit');",
    expect: 'at most five game lines are kept' },

  { name: 'M26 the limit on game lines is six',
    anchor: 'export const MR_MAX_PICKS = 5;',
    replace: 'export const MR_MAX_PICKS = 6;',
    expect: 'at most five game lines are kept' },

  { name: 'M27 the open line skips the rules',
    anchor: 'else if (problem) drop(key, problem);\n            else out[key] = body;',
    replace: 'else out[key] = body;',
    expect: 'a name in the open line drops the open line' },

  { name: 'M28 a repeated open line replaces the first',
    anchor: 'if (out[key] !== null) drop(key, `duplicate-${key}`);',
    replace: 'if (false) drop(key, `duplicate-${key}`);',
    expect: 'a repeated open or close line keeps the first' },

  { name: 'M29 a line that does not follow the form vanishes without a record',
    anchor: "if (!m) { drop(null, 'unrecognized-line'); continue; }",
    replace: 'if (!m) { continue; }',
    expect: 'a line that does not follow the form is dropped' },

  { name: 'M30 keys keep their leading zeros',
    anchor: '`g${Number(m[2])}`',
    replace: '`g${m[2]}`',
    expect: 'keys are case-insensitive, leading zeros and spacing do not matter' },

  { name: 'M31 the dropped list is not capped',
    anchor: 'const MAX_DROPPED = 12;',
    replace: 'const MAX_DROPPED = 1000;',
    expect: 'the dropped list is capped at twelve records' },

  { name: 'M32 a dropped line is recorded with its text',
    anchor: 'out.dropped.push({ key, reason });',
    replace: "out.dropped.push({ key, reason, text: String(text || '') });",
    expect: 'a dropped line is recorded by key and reason only' },

  { name: 'M33 the headline is invented when there is none',
    anchor: 'const h = clean(headline);',
    replace: "const h = clean(headline) || 'A quiet night.';",
    expect: 'nothing is invented to stand in for it' },

  { name: 'M34 the open line comes before the headline',
    anchor: 'if (h) parts.push(end(h));\n    if (parsed.open) parts.push(parsed.open);',
    replace: 'if (parsed.open) parts.push(parsed.open);\n    if (h) parts.push(end(h));',
    expect: 'headline, open, then each fact and its sentence' },

  { name: 'M35 a fact is joined to its sentence without a full stop',
    anchor: 'parts.push(`${end(p.entry.fact)} ${p.angle}`);',
    replace: 'parts.push(`${p.entry.fact} ${p.angle}`);',
    expect: 'headline, open, then each fact and its sentence' },

  { name: 'M36 an open and a close with no game line make a report',
    anchor: 'if (!parsed.picks.length) return null;',
    replace: '',
    expect: 'an open and a close with no game line is not a report' },

  { name: 'M37 `cited` is empty',
    anchor: 'cited: parsed.picks.map(p => p.entry.gameId).filter(Boolean)',
    replace: 'cited: []',
    expect: '`cited` lists the real game ids' },

  { name: 'M38 a headline without a full stop is printed as it is',
    anchor: 'if (h) parts.push(end(h));',
    replace: 'if (h) parts.push(h);',
    expect: 'a headline without a full stop gets one' },

  { name: 'M39 the recap keeps seventeen games',
    anchor: '.slice(0, 16);',
    replace: '.slice(0, 17);',
    expect: 'selectRecapGames keeps the first sixteen' },

  { name: 'M40 the recap lists the postseason first',
    anchor: '? [...(ctx.games?.regular || []), ...(ctx.games?.postseason || [])]\n        : [];',
    replace: '? [...(ctx.games?.postseason || []), ...(ctx.games?.regular || [])]\n        : [];',
    expect: 'selectRecapGames keeps the first sixteen, regular season before postseason' },

  { name: 'M41 the recap keeps a game with only one score',
    anchor: "typeof g.home_score === 'number' && typeof g.away_score === 'number'",
    replace: "typeof g.home_score === 'number' || typeof g.away_score === 'number'",
    expect: 'selectRecapGames keeps a game with two numeric scores or a note' },

  { name: 'M42 prepare forgets to leave the truth game out',
    anchor: 'citableGames(recapGames, { excludeGameId: truthIs?.game_id })',
    replace: 'citableGames(recapGames)',
    expect: 'prepare: the recap is built from the context and the truth game is left out' },

  { name: 'M43 finish composes without the headline',
    anchor: 'composeMorningReport({ headline: truthIs?.headline, parsed })',
    replace: 'composeMorningReport({ headline: null, parsed })',
    expect: 'finish: the headline is first' },

  { name: 'M44 finish parses without the slate names',
    anchor: 'parseMorningReportLines(text, prepared.citable, prepared.slateNames)',
    replace: 'parseMorningReportLines(text, prepared.citable, [])',
    expect: 'finish: the headline is first and a slate name from the context is dropped' },

  { name: 'M45 the token allowance changes',
    anchor: 'export const MR_MAX_TOKENS = 320;',
    replace: 'export const MR_MAX_TOKENS = 250;',
    expect: 'the answer is allowed 320 tokens' },
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
