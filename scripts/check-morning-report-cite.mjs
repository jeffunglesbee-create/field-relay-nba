#!/usr/bin/env node
// The Morning Report cites games by id; the relay writes every team name and score.
//
// src/morning-report.js is the contract: the model is shown games under ids (g1, g2, ...)
// without their team names, answers with labelled lines of commentary, and the relay prints
// the headline, the score lines and the model's sentences. This pins what that guarantees,
// on the real functions, with no model in the loop:
//   - the prompt never contains a team name, an event name, a note or the headline;
//   - a score is printed beside its own team, from the row;
//   - a line that carries a digit, a slate name, an unknown or repeated id, or no full
//     stop is dropped, and the drop is recorded by key and reason (never by text);
//   - whatever the model answers, every digit and every slate name in the paragraph came
//     from the relay (a seeded property test over 400 random slates and answers);
//   - the two real slates on which the old team-name guard threw accurate prose away
//     (2026-10-27 and 2026-10-29) compose cleanly, including the pairs it confused.
// The three incidents that put a guard on the prose (2026-07-02, 07-03, 07-15) are each
// replayed as a case.
//
// docs/CC-CMD-2026-10-30-morning-report-degraded-reason.md, Task 3 option 4.
// Rule 90: mutation-tested by scripts/mutate-morning-report-cite.mjs.
import { readFileSync } from 'node:fs';
import {
  selectRecapGames, citableGames, buildMorningReportPrompt, parseMorningReportLines, composeMorningReport,
  slateNamesOf, prepareMorningReport, finishMorningReport, MR_MAX_PICKS, MR_MAX_LINE_WORDS, MR_MAX_TOKENS,
} from '../src/morning-report.js';

process.on('uncaughtException', (e) => { console.log(`FAIL  the check crashed — ${e.message}`); process.exit(1); });

let fails = 0, n = 0;
const ok = (f, why) => {
  n++;
  let pass = false;
  try { pass = (typeof f === 'function' ? f() : f) === true; }
  catch (e) { console.log(`FAIL  ${why} — threw ${e.message}`); fails++; return; }
  if (!pass) { fails++; console.log(`FAIL  ${why}`); }
};

const game = (o) => ({ id: `${o.sport}:${o.away}@${o.home}`, sport: 'NBA', note: null, went_to_ot: null, ...o });

// ── selectRecapGames: which games are in the recap ──────────────────────────
{
  const mk = (i, o = {}) => game({ id: `r${i}`, away: `A${i}`, home: `H${i}`, away_score: i, home_score: i + 1, ...o });
  const regular = Array.from({ length: 14 }, (_, i) => mk(i));
  const post = Array.from({ length: 6 }, (_, i) => mk(100 + i));
  const sel = selectRecapGames({ games: { regular, postseason: post } });
  ok(() => sel.length === 16 && sel[13].id === 'r13' && sel[14].id === 'r100' && sel[15].id === 'r101',
    'selectRecapGames keeps the first sixteen, regular season before postseason');
  const mixed = selectRecapGames({ games: { regular: [
    mk(1), mk(2, { home_score: null }), mk(3, { away_score: undefined }), mk(4, { home_score: null, away_score: null, note: 'a note' }), mk(5, { home_score: '9' }),
  ], postseason: [] } });
  ok(() => mixed.map(g => g.id).join() === 'r1,r4',
    'selectRecapGames keeps a game with two numeric scores or a note, and skips one with only one score');
  ok(() => selectRecapGames(null).length === 0 && selectRecapGames({}).length === 0 && selectRecapGames({ games: {} }).length === 0,
    'selectRecapGames of no context is empty');
}

// ── citableGames: what the relay prints, from the row ────────────────────────
const ROWS = [
  game({ sport: 'NBA',  away: 'Nets',    home: 'Celtics',  away_score: 124, home_score: 125 }),
  game({ sport: 'NHL',  away: 'Jets',    home: 'Lightning', away_score: 4,   home_score: 6 }),
  game({ sport: 'NHL',  away: 'Devils',  home: 'Stars',    away_score: 5,   home_score: 1 }),
  game({ sport: 'EPL',  away: 'Arsenal', home: 'Fleetwood', away_score: 1,  home_score: 1 }),
  game({ sport: 'golf', away: 'R4',      home: 'Baycurrent Classic', away_score: null, home_score: -16, note: 'Michael Brennan -16' }),
  game({ sport: 'NBA',  away: '',        home: 'Ghosts',   away_score: 90,  home_score: 80 }),
  game({ sport: 'MLS',  away: 'Rapids',  home: 'Quakes',   away_score: null, home_score: null }),
  game({ sport: 'NBA',  away: 'Kings',   home: 'Spurs',    away_score: 103, home_score: 130, went_to_ot: 1 }),
  game({ sport: 'WNBA', away: 'Fire',    home: 'Sun',      away_score: 87,  home_score: 90 }),
];
const base = citableGames(ROWS);
const FACTS = ['Celtics 125, Nets 124', 'Lightning 6, Jets 4', 'Devils 5, Stars 1', 'Arsenal 1, Fleetwood 1',
  'Baycurrent Classic (R4): Michael Brennan -16', 'Spurs 130, Kings 103', 'Sun 90, Fire 87'];
ok(() => base.length === 7 && base.map(c => c.fact).join('|') === FACTS.join('|'),
  'a fact is printed winner first from the row, a tie away first, an event row as its label and note');
ok(() => base.map(c => c.id).join() === 'g1,g2,g3,g4,g5,g6,g7',
  'ids run g1, g2, ... in recap order, with no gap where a row cannot be rendered');
ok(() => base[0].gameId === ROWS[0].id && base[5].gameId === ROWS[7].id,
  'each id maps to the real game id of its row');
ok(() => base[0].descriptor === 'NBA | final 125-124, margin 1, total 249'
  && base[3].descriptor === 'EPL | ended level 1-1, total 2'
  && base[4].descriptor === 'golf | event update, no score'
  && base[5].descriptor === 'NBA | final 130-103, margin 27, total 233, went to overtime',
  'the descriptor says the sport and the shape of the result, and names no team');
ok(() => citableGames(ROWS, { excludeGameId: ROWS[1].id }).map(c => c.fact).join('|') === FACTS.filter((_, i) => i !== 1).join('|')
  && citableGames(ROWS, { excludeGameId: ROWS[1].id })[1].id === 'g2',
  'the game Phase 3 already printed is left out and the ids close up');
ok(() => citableGames(null).length === 0 && citableGames([]).length === 0, 'no recap games, nothing to cite');
// 2026-07-02: "Congo DR at England 2-1" was read as Congo DR 2, England 1 (real: England 2, Congo DR 1).
ok(() => citableGames([game({ sport: 'WC', away: 'Congo DR', home: 'England', away_score: 1, home_score: 2 })])[0].fact === 'England 2, Congo DR 1'
  && citableGames([game({ sport: 'WC', away: 'Congo DR', home: 'England', away_score: 2, home_score: 1 })])[0].fact === 'Congo DR 2, England 1',
  '2026-07-02: each team is printed beside its own score, whichever side won');

// ── the prompt: the model is never given a name ─────────────────────────────
const STARS = { stars: 3, totalGames: 28, dramaGames: 2, closeGames: 5, walkoffs: 0 };
const P = buildMorningReportPrompt('2026-10-30', { stars: STARS, truthIs: { type: 'upset', headline: 'Zorb beat Quill 9-8 as a +300 underdog.' }, citable: base });
ok(() => base.every(c => P.includes(`${c.id} | ${c.descriptor}`)), 'the prompt lists every citable game under its id');
ok(() => !ROWS.flatMap(g => [g.home, g.away, g.note, g.id]).filter(s => s && s.length >= 3).some(s => P.includes(s)),
  'the prompt contains no team name, event name, note or game id');
ok(() => !P.includes('Zorb') && !P.includes('+300') && P.includes('a big underdog won'),
  'the prompt carries the truth as words and never its headline');
ok(() => P.includes('g1: <one sentence about that game>') && P.includes('g2: <one sentence about that game>') && !P.includes('g3: <'),
  'the form shows the first two real ids');
ok(() => P.includes('The relay prints every team name') && P.includes('Never write a digit') && P.includes('open:') && P.includes('close:'),
  'the prompt says who writes the facts and what the answer looks like');
ok(() => P.includes('Do not repeat the score, the margin or the total')
  && P.includes('You are not told which side was at home')
  && P.includes('Never compare one game with another'),
  'the prompt does not let the model restate a score, say who was at home, or compare games');
ok(() => P.includes('never describe how a game went') && P.includes('Do not call a game an exhibition'),
  'the prompt does not let the model describe how a game went (it is given no play-by-play)');
ok(() => !P.includes('"the visitors"') && !P.includes('"the home side"') && !P.includes('closest game of the night'),
  'the prompt offers no wording the model cannot back (2026-10-30 replay: "the home side", "closest of the night")');
ok(() => buildMorningReportPrompt('d', { stars: null, truthIs: null, citable: [] }).includes('(no completed games)')
  && buildMorningReportPrompt('d', { stars: null, truthIs: null, citable: [] }).includes('not available tonight')
  && buildMorningReportPrompt('d', { stars: null, truthIs: null, citable: [] }).includes('unrated'),
  'a missing star rating, a missing truth and no games are said plainly');

// ── parseMorningReportLines: one rule per case ──────────────────────────────
const names = slateNamesOf({ games: { regular: ROWS, postseason: [] } });
const O = 'Some nights remind us how much can change in a single possession.';
const C = 'Tomorrow brings another slate and another chance to be surprised.';
const S1 = 'A one-point finish that stayed tense until the final possession.';
const S2 = 'The widest margin of the night, settled long before the final whistle.';
const S3 = 'A quiet update that asks only for patience.';
const A = (lines, citable = base) => parseMorningReportLines(lines.join('\n'), citable, names);
const why = (r) => r.dropped.map(d => `${d.key ?? ''}:${d.reason}`).join(',');
{
  const r = A([`open: ${O}`, `g2: ${S1}`, `g1: ${S2}`, `g3: ${S3}`, `close: ${C}`]);
  ok(() => r.open === O && r.close === C && r.picks.map(p => p.entry.id).join() === 'g2,g1,g3'
    && r.picks[0].angle === S1 && r.dropped.length === 0 && r.recognized === 5,
    'a compliant answer is kept whole, game lines in the model\'s order');
}
{
  const r = A([`Open: ${O}`, `G03: ${S3}`, `g01 : ${S2}`, `CLOSE:${C}`]);
  ok(() => r.open === O && r.close === C && r.picks.map(p => p.entry.id).join() === 'g3,g1' && r.dropped.length === 0,
    'keys are case-insensitive, leading zeros and spacing do not matter');
}
ok(() => why(A([`g99: ${S1}`, `g0: ${S1}`, `g8: ${S1}`])) === 'g99:unknown-id,g0:unknown-id,g8:unknown-id',
  '2026-07-03: an id that is not in the list is dropped, so a game cannot be invented');
{
  const r = A([`g1: ${S1}`, `g1: ${S2}`]);
  ok(() => r.picks.length === 1 && r.picks[0].angle === S1 && why(r) === 'g1:duplicate-id', 'a repeated id keeps the first line and drops the rest');
}
for (const bad of ['A 6-4 win for the visitors.', 'Won by 3.', 'Game 7 energy all night.', 'A ３ goal margin.', 'Squared² and then some.', 'The 1st of many.']) {
  ok(() => why(A([`g1: ${bad}`])) === 'g1:digit', `a digit drops the line: "${bad}"`);
}
// 2026-07-15: a bare mascot ("Fire") was expanded into the wrong team ("Chicago Fire").
ok(() => why(A(['g7: Chicago Fire pushed the home side to the limit.'])) === 'g7:team-name',
  '2026-07-15: "Chicago Fire" is dropped, because Fire is on tonight\'s slate');
ok(() => why(A(['g2: The Celtics were great again.'])) === 'g2:team-name', 'a slate name is dropped wherever it appears');
ok(() => why(A(['g2: Baycurrent Classic fans had a long day.'])) === 'g2:team-name', 'an event name from the slate is dropped too');
ok(() => why(A([`open: The Spurs set the tone tonight.`, `close: ${C}`])) === 'open:team-name', 'a name in the open line drops the open line');
ok(() => why(A([`g2: ${S1.replace('finish', 'fire')}`])) === '' && why(A(['g2: Sunday was kind to the visitors.'])) === ''
  && why(A(['g2: A firefly of a comeback, bright and brief.'])) === '',
  'a name only counts as a whole, capitalised word (fire, Sunday and firefly pass)');
ok(() => why(A([`g1: ${Array(MR_MAX_LINE_WORDS).fill('word').join(' ')}.`])) === ''
  && why(A([`g1: ${Array(MR_MAX_LINE_WORDS + 1).fill('word').join(' ')}.`])) === 'g1:too-long',
  `a line is at most ${MR_MAX_LINE_WORDS} words`);
ok(() => why(A(['g1: A game that was cut off mid sen'])) === 'g1:unterminated'
  && why(A([`g1: He called it "a night to remember."`])) === '' && why(A(['g1: Was it ever in doubt?'])) === '',
  'a line without a full stop (what a cut-off answer ends in) is dropped; a closing quote after one is fine');
{
  const r = A(['Here is the report:', '**open:** Wonder.', '- g1: bullet.', 'g1 - dash.', '', `g1: ${S1}`]);
  ok(() => why(r) === ':unrecognized-line,:unrecognized-line,:unrecognized-line,:unrecognized-line' && r.picks.length === 1 && r.recognized === 1,
    'a line that does not follow the form is dropped without disturbing the rest');
}
{
  const more = citableGames(Array.from({ length: 8 }, (_, i) => game({ sport: 'NHL', away: `Away${i}`, home: `Home${i}`, away_score: i, home_score: i + 1 })));
  const r = parseMorningReportLines(more.map(c => `${c.id}: ${S1}`).join('\n'), more, []);
  ok(() => MR_MAX_PICKS === 5 && r.picks.length === 5 && why(r) === 'g6:over-limit,g7:over-limit,g8:over-limit',
    'at most five game lines are kept; the rest are dropped as over-limit');
}
{
  const r = A(Array.from({ length: 30 }, () => 'nonsense'));
  ok(() => r.dropped.length === 12, 'the dropped list is capped at twelve records');
}
{
  const r = A([`open: ${O}`, `open: ${S1}`, `close: ${C}`, `close: ${S2}`, `g1: ${S1}`]);
  ok(() => r.open === O && r.close === C && why(r) === 'open:duplicate-open,close:duplicate-close', 'a repeated open or close line keeps the first');
}
{
  const r = A(['g1: A 6-4 win for the Celtics, sealed late in the final period of play.', 'g2: Chicago Fire'].concat([`g3: ${S3}`]));
  ok(() => !JSON.stringify(r.dropped).match(/Celtics|Chicago|6-4|win/) && Object.keys(r.dropped[0]).sort().join() === 'key,reason',
    'a dropped line is recorded by key and reason only, never by text (the row is served publicly)');
}
ok(() => parseMorningReportLines(null, base, names).picks.length === 0 && parseMorningReportLines('', base, names).dropped.length === 0,
  'no answer parses to nothing');
ok(() => { const r = parseMorningReportLines(`open: ${O}\r\ng2: ${S1}\r\nclose: ${C}\r\n`, base, names); return r.open === O && r.close === C && r.picks.length === 1; },
  'Windows line endings parse');

// ── composeMorningReport: the paragraph the relay writes ────────────────────
{
  const parsed = A([`open: ${O}`, `g2: ${S1}`, `g1: ${S2}`, `close: ${C}`]);
  const c = composeMorningReport({ headline: 'Zorb beat Quill 9-8.', parsed });
  ok(() => c.text === `Zorb beat Quill 9-8. ${O} Lightning 6, Jets 4. ${S1} Celtics 125, Nets 124. ${S2} ${C}`,
    'headline, open, then each fact and its sentence in the model\'s order, then close');
  ok(() => c.cited.join() === [ROWS[1].id, ROWS[0].id].join(), '`cited` lists the real game ids in the order printed');
  ok(() => composeMorningReport({ headline: 'No stop', parsed }).text.startsWith('No stop. '), 'a headline without a full stop gets one');
}
ok(() => composeMorningReport({ headline: 'H.', parsed: A([`open: ${O}`, `close: ${C}`]) }) === null,
  'an open and a close with no game line is not a report');
for (const h of [null, undefined, '', '   ']) {
  ok(() => composeMorningReport({ headline: h, parsed: A([`open: ${O}`, `g2: ${S1}`]) }).text === `${O} Lightning 6, Jets 4. ${S1}`,
    `with no headline (${JSON.stringify(h)}) nothing is invented to stand in for it`);
}
{
  const withStop = citableGames([game({ sport: 'golf', away: 'R4', home: 'Open', away_score: null, home_score: -3, note: 'Won it all.' })]);
  const c = composeMorningReport({ headline: null, parsed: parseMorningReportLines(`g1: ${S3}`, withStop, []) });
  ok(() => c.text === `Open (R4): Won it all. ${S3}`, 'a fact that already ends in a full stop does not get a second');
}

// ── prepare / finish: the two halves Phase 5 and the replay probe both run ──
{
  const ctx = { games: { regular: ROWS.slice(0, 5), postseason: [ROWS[7]] } };
  const truth = { type: 'upset', game_id: ROWS[1].id, headline: 'Zorb beat Quill 9-8.' };
  const prep = prepareMorningReport('2026-10-30', { stars: STARS, truthIs: truth, ctx });
  ok(() => prep.recapGames.length === 6 && prep.citable.length === 5 && !prep.citable.some(c => c.fact === 'Lightning 6, Jets 4'),
    'prepare: the recap is built from the context and the truth game is left out of what can be cited');
  ok(() => prep.prompt === buildMorningReportPrompt('2026-10-30', { stars: STARS, truthIs: truth, citable: prep.citable }),
    'prepare: the prompt is the prompt of the citable games');
  ok(() => ['Celtics', 'Nets', 'Jets', 'Baycurrent Classic', 'Spurs'].every(nm => prep.slateNames.includes(nm)),
    'prepare: the slate names cover every game in the context');
  const done = finishMorningReport(`open: ${O}\ng1: ${S1}\ng2: The Celtics again.\ng3: ${S2}`, prep, truth);
  ok(() => done.composed.text.startsWith('Zorb beat Quill 9-8. ') && done.parsed.picks.length === 2
    && done.parsed.dropped.length === 1 && done.parsed.dropped[0].reason === 'team-name',
    'finish: the headline is first and a slate name from the context is dropped');
  ok(() => finishMorningReport('', prep, truth).composed === null && finishMorningReport(null, prep, truth).composed === null,
    'finish: no answer composes nothing');
  ok(() => MR_MAX_TOKENS === 320, 'the answer is allowed 320 tokens (five labelled lines)');
}

// ── the property: whatever the model answers, the facts are the relay's ─────
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const WORDS = ['Zorbax', 'Quillfeather', 'Marrowind', 'Tessellate', 'Vantablack', 'Ombrelune', 'Crestfallen', 'Dunmarrow', 'Halcyonic', 'Ironbark',
  'Jubilant Otters', 'Knotweed Rovers', 'Lanternfish', 'Moonrakers', 'Nightjar', 'Oxbow Union', 'Pennywhistle', 'Quartermaster', 'Rookery', 'Sandpiper'];
const SENT = ['A finish that stayed tense until the last minute.', 'The widest margin of the night.', 'A calm, steady win for the visitors.',
  'The home side found its rhythm early and never let go.', 'A level game that nobody could separate.', 'Overtime again, and nobody minded.'];
let propFails = 0;
for (let seed = 1; seed <= 400; seed++) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const nGames = 3 + Math.floor(r() * 14);
  const pool = [...WORDS].sort(() => r() - 0.5);
  const rows = Array.from({ length: nGames }, (_, i) => {
    const golf = r() < 0.1;
    const hs = Math.floor(r() * 140), as = r() < 0.15 ? hs : Math.floor(r() * 140);
    return golf
      ? game({ id: `row${i}`, sport: 'golf', away: 'R3', home: `${pool[(2 * i) % 20]} Classic`, away_score: null, home_score: -10, note: `${pool[(2 * i + 1) % 20]} -10` })
      : game({ id: `row${i}`, sport: pick(['NBA', 'NHL', 'EPL']), away: pool[(2 * i) % 20], home: pool[(2 * i + 1) % 20], away_score: as, home_score: hs, went_to_ot: r() < 0.2 ? 1 : 0 });
  });
  const ctx = { games: { regular: rows, postseason: [] } };
  const recap = selectRecapGames(ctx);
  const truth = { type: pick(['upset', 'blowout', 'none', 'convergence']), game_id: r() < 0.5 ? pick(rows).id : null };
  const headline = `${pick(WORDS)} beat ${pick(WORDS)} ${Math.floor(r() * 9)}-${Math.floor(r() * 9)}.`;
  const citable = citableGames(recap, { excludeGameId: truth.game_id });
  const slate = slateNamesOf(ctx);
  const prompt = buildMorningReportPrompt('2026-10-30', { stars: STARS, truthIs: truth, citable });
  // An answer made of everything that can go wrong, in random order.
  const lines = [];
  const count = 2 + Math.floor(r() * 12);
  for (let k = 0; k < count; k++) {
    const id = citable.length ? pick(citable).id : 'g1';
    const nm = pick(slate.length ? slate : ['Nobody']);
    lines.push(pick([
      () => `${id}: ${pick(SENT)}`, () => `${id}: ${pick(SENT)}`, () => `${id}: ${pick(SENT)}`,
      () => `${id}: ${nm} ${pick(SENT)}`, () => `${id}: ${pick(SENT)} ${Math.floor(r() * 99)}-${Math.floor(r() * 99)}.`,
      () => `g${50 + Math.floor(r() * 40)}: ${pick(SENT)}`, () => `open: ${pick(SENT)}`, () => `open: ${nm} lead the way.`,
      () => `close: ${pick(SENT)}`, () => `close: ${pick(SENT)} It ended ${Math.floor(r() * 9)} to ${Math.floor(r() * 9)}`,
      () => `${id}: ${pick(SENT)}`.slice(0, -1), () => `Here is the report, ${nm}:`, () => `${id}: ${pick(SENT).repeat(1 + Math.floor(r() * 9))}`,
    ])());
  }
  const parsed = parseMorningReportLines(lines.join('\n'), citable, slate);
  const composed = composeMorningReport({ headline, parsed });
  let bad = null;
  // The prompt never carries a name, a note, an id or the headline.
  const secrets = recap.flatMap(g => [g.home, g.away, g.note, g.id]).filter(s => s && s.length >= 3);
  if (secrets.some(s => prompt.includes(s)) || prompt.includes(headline)) bad = 'prompt leaks a name, note, id or the headline';
  if (parsed.picks.length > MR_MAX_PICKS) bad = 'more than five picks';
  if (new Set(parsed.picks.map(p => p.entry.id)).size !== parsed.picks.length) bad = 'a repeated pick';
  if (parsed.picks.some(p => !citable.includes(p.entry))) bad = 'a pick that is not citable';
  if (parsed.picks.length === 0 && composed !== null) bad = 'a report with no game line';
  if (parsed.picks.length > 0 && composed === null) bad = 'no report from valid game lines';
  if (composed) {
    // Take away everything the relay wrote; whatever is left is the model's, and has no digit and no name.
    let rest = composed.text.replace(headline, ' ');
    for (const p of parsed.picks) rest = rest.replace(p.entry.fact, ' ');
    if (/\p{N}/u.test(rest)) bad = 'a digit of the model\'s reached the paragraph';
    if (slate.some(nm => new RegExp(`(?<![A-Za-z])${nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`).test(rest))) bad = 'a slate name of the model\'s reached the paragraph';
    if (composed.cited.length !== parsed.picks.length || !composed.cited.every(id => recap.some(g => g.id === id))) bad = 'cited is not the printed games';
    if (!composed.text.startsWith(headline)) bad = 'the headline is not first';
  }
  if (bad) { propFails++; if (propFails <= 3) console.log(`FAIL  property, seed ${seed}: ${bad}`); }
}
ok(() => propFails === 0, `400 random slates and answers: every digit and slate name in the paragraph is the relay's (${propFails} failing seed(s))`);

// ── the two real slates the old guard threw accurate prose away on ─────────
for (const date of ['2026-10-27', '2026-10-29']) {
  const fx = JSON.parse(readFileSync(new URL(`./fixtures/morning-report-slate-${date}.json`, import.meta.url), 'utf8'));
  const recap = selectRecapGames(fx.ctx);
  const cit = citableGames(recap, { excludeGameId: fx.truth.game_id });
  const slate = slateNamesOf(fx.ctx);
  const p = buildMorningReportPrompt(date, { stars: fx.stars, truthIs: fx.truth, citable: cit });
  const idOf = (fact) => cit.find(c => c.fact === fact)?.id;
  ok(() => recap.length === 16 && cit.length === (fx.truth.game_id ? 15 : 16), `${date}: the real recap has sixteen games${fx.truth.game_id ? ', fifteen once the truth game is out' : ''}`);
  ok(() => !fx.ctx.games.regular.flatMap(g => [g.home, g.away, g.note, g.id]).filter(s => s && s.length >= 3).some(s => p.includes(s)) && !p.includes(fx.truth.headline),
    `${date}: the real prompt carries no team name, note, game id or headline`);
  const wanted = date === '2026-10-27'
    ? ['Celtics 125, Nets 124', 'Devils 5, Stars 1', 'Panthers 5, Jets 1', 'Sabres 2, Sharks 0']
    : ['Dream 80, Valkyries 69', 'Lightning 6, Jets 4', 'Grizzlies 124, Trail Blazers 103', 'Blues 4, Bruins 1'];
  const ids = wanted.map(idOf);
  ok(() => ids.every(Boolean), `${date}: the four games the old guard confused are citable (${wanted.join('; ')})`);
  const parsed = parseMorningReportLines(['open: ' + O, ...ids.map(id => `${id}: ${S1}`), 'close: ' + C].join('\n'), cit, slate);
  const c = composeMorningReport({ headline: fx.truth.headline, parsed });
  ok(() => parsed.dropped.length === 0 && parsed.picks.length === 4 && wanted.every(f => c.text.includes(`${f}. ${S1}`)),
    `${date}: an answer citing them is kept whole, and each score is printed beside its own teams`);
  ok(() => c.text.startsWith(fx.truth.headline) && (c.text.match(/Devils 5, Stars 1|Panthers 5, Jets 1/g) || []).length === (date === '2026-10-27' ? 2 : 0),
    `${date}: the repeated score line is printed once per game cited (a score is never matched across games)`);
}
{
  const fx = JSON.parse(readFileSync(new URL('./fixtures/morning-report-slate-2026-10-27.json', import.meta.url), 'utf8'));
  const cit = citableGames(selectRecapGames(fx.ctx), { excludeGameId: fx.truth.game_id });
  ok(() => !cit.some(c => c.fact === 'Canadiens 2, Blues 0') && cit.some(c => c.fact === 'Sabres 2, Sharks 0'),
    '2026-10-27: the truth game (Canadiens 2, Blues 0) is out of the list, the other 2-0 is in');
}

console.log(`${n - fails}/${n} assertions pass`);
process.exit(fails ? 1 : 0);
