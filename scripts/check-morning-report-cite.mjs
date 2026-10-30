#!/usr/bin/env node
// The Morning Report: the model chooses and frames; the relay writes every fact.
//
// src/morning-report.js is the contract. The model is shown games under ids (g1, g2, ...)
// without their team names and answers three labelled lines: `pick:` the ids of the games to
// feature, `open:` one sentence, `close:` one sentence. The relay prints the headline, then for
// each pick the score line from the row and ONE SENTENCE ABOUT THE RESULT, chosen from fixed
// phrasings by the numbers in that row. This pins what that guarantees, on the real functions,
// with no model in the loop:
//   - the prompt never contains a team name, an event name, a note or the headline;
//   - a score is printed beside its own team, from the row;
//   - every sentence the relay writes about a game is true of its row. An ORACLE checks it: it
//     holds its own copy of the sport table, the thresholds, the number words and the wording of
//     every phrasing, so a change to any of them in the module disagrees with it and fails here.
//     The oracle runs over a grid of scores x overtime flags x sports and over 400 random slates;
//   - no byte of the model's reaches a game line: a pick line is read as a list of known ids and
//     nothing else, and the model's open and close lines stand apart from the games;
//   - an open or close line that carries a digit, a slate name, too many words or no full stop is
//     dropped; an unknown, repeated or surplus id is dropped; each drop is recorded by key and
//     reason (never by text);
//   - every sport label the archive declares has a decision (a sentence family, or none);
//   - the two real slates on which the old team-name guard threw accurate prose away
//     (2026-10-27 and 2026-10-29) compose cleanly, game by game.
// The three incidents that put a guard on the prose (2026-07-02, 07-03, 07-15) are each
// replayed as a case.
//
// docs/CC-CMD-2026-10-30-morning-report-degraded-reason.md, Task 3 option 4 and Task 4.
// Rule 90: mutation-tested by scripts/mutate-morning-report-cite.mjs.
import { readFileSync } from 'node:fs';
import {
  selectRecapGames, citableGames, buildMorningReportPrompt, parseMorningReportLines, composeMorningReport,
  slateNamesOf, prepareMorningReport, finishMorningReport, resultShape, resultSentence, sportFamily,
  MR_MAX_PICKS, MR_MAX_LINE_WORDS, MR_MAX_TOKENS, NO_SENTENCE_LABELS,
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

// ══ THE ORACLE ═══════════════════════════════════════════════════════════════
// A second statement of the spec, written out separately from the module on purpose. The sentence
// the relay writes about a game has to be true of the row, and nothing in the module can vouch for
// itself: if both read the same table, a wrong threshold would agree with itself. So this holds
// its own table of sports, its own thresholds and its own number words, and its own text for every
// phrasing; a phrasing is accepted only if it matches the text the oracle has for the kind THE
// ORACLE says the row is, and every number, unit and overtime noun in it is then read back and
// compared with the row.
const SPEC = {
  hockey:     { unit: 'goal',  over: 'overtime',      narrow: 1, wide: 4,  labels: ['NHL'] },
  soccer:     { unit: 'goal',  over: 'extra time',    narrow: 1, wide: 3,  labels: [
    'EPL', 'MLS', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'FIFA World Cup',
    'UEFA Champions League', 'UEFA Europa League', 'UEFA Europa Conference League',
    'UEFA Champions League Qualifying', 'UEFA Europa League Qualifying', 'UEFA Europa Conference League Qualifying',
    'EFL Championship', 'EFL League One', 'EFL League Two', 'EFL Cup', 'EFL Trophy'] },
  basketball: { unit: 'point', over: 'overtime',      narrow: 3, wide: 20, labels: ['NBA', 'WNBA', 'wnba'] },
  baseball:   { unit: 'run',   over: 'extra innings', narrow: 1, wide: 6,  labels: ['MLB'] },
  gridiron:   { unit: 'point', over: 'overtime',      narrow: 3, wide: 21, labels: ['NFL', 'CFB', 'CFL', 'UFL'] },
};
const SPEC_NONE = ['AFL', 'IPL', 'PGA Tour', 'golf'];
const REP = { hockey: 'NHL', soccer: 'EPL', basketball: 'NBA', baseball: 'MLB', gridiron: 'NFL' };

const SPEC_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const SPEC_TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function wordToNum(w) {
  if (/^[0-9]+$/.test(w)) return Number(w);
  if (SPEC_ONES.includes(w)) return SPEC_ONES.indexOf(w);
  const m = /^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:-(one|two|three|four|five|six|seven|eight|nine))?$/.exec(w);
  return m ? SPEC_TENS[m[1]] + (m[2] ? SPEC_ONES.indexOf(m[2]) : 0) : NaN;
}

// What kind of result a row is, by the spec's own rules, in the spec's own order.
function specKind(fam, hi, lo, ot) {
  const margin = hi - lo, t = SPEC[fam];
  if (margin === 0) return hi === 0 ? 'scoreless' : ot ? 'level-ot' : 'level';
  if (ot) return 'win-ot';
  if (lo === 0) return 'shutout';
  if (margin >= t.wide) return 'wide';
  if (margin <= t.narrow) return 'narrow';
  return 'win';
}

// The wording of every phrasing, three per kind, in the order they are handed out.
//   {N} number word  {NC} number word, capitalised  {U} unit  {US} unit, plural unless the number is one
//   {OV} the sport's word for play past regulation  {OVC} the same, capitalised  {AN} "A" or "An"
const SPEC_TEXT = {
  'scoreless': ['Neither side scored.', 'A scoreless finish.', 'Not a score on the board for either side.'],
  'level-ot':  ['Level after {OV}.', '{OVC} could not separate the sides.', 'All square after {OV}.'],
  'level':     ['Finished level.', 'All square at the end.', 'Neither side finished ahead.'],
  'win-ot':    ['{AN} {N}-{U} win after {OV}.', 'Won by {N} {US} after {OV}.', 'It went to {OV}, and {N} {US} separated the sides.'],
  'shutout':   ['{AN} {N}-{U} shutout.', 'The losing side was held scoreless.', '{NC} {US} to nothing.'],
  'wide':      ['A lopsided {N}-{U} win.', 'Won by a wide margin of {N} {US}.', '{NC} {US} clear at the end.'],
  'narrow':    ['A narrow {N}-{U} win.', 'Won narrowly, by {N} {US}.', 'Just {N} {US} between the sides at the end.'],
  'win':       ['{AN} {N}-{U} win.', 'Won by {N} {US}.', '{NC} {US} separated the sides.'],
};
const NUMBER_RE = `(?:${[...SPEC_ONES, ...Object.keys(SPEC_TENS).map(t => `${t}(?:-(?:one|two|three|four|five|six|seven|eight|nine))?`)].join('|')}|[0-9]+)`;
const SLOT_RE = {
  N: `(?<N>${NUMBER_RE})`, NC: '(?<NC>[A-Z][a-z]+(?:-[a-z]+)?|[0-9]+)',
  U: '(?<U>goal|point|run)', US: '(?<US>goals?|points?|runs?)',
  OV: '(?<OV>overtime|extra time|extra innings)', OVC: '(?<OVC>Overtime|Extra time|Extra innings)', AN: '(?<AN>An?)',
};
const REGEX_OF = new Map();   // one compiled regex per phrasing: the grids below ask about a hundred thousand sentences
const specRegex = (tpl) => {
  if (!REGEX_OF.has(tpl)) REGEX_OF.set(tpl, new RegExp('^' + tpl.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_, k) => SLOT_RE[k]) + '$'));
  return REGEX_OF.get(tpl);
};

// null when `sentence` is exactly what the spec writes for this row as phrasing number `variant`
// (0, 1, 2, then round again); otherwise the reason it is not.
function verifySentence(fam, hi, lo, ot, sentence, variant) {
  const kind = specKind(fam, hi, lo, ot);
  const tpl = SPEC_TEXT[kind][variant % 3];
  const m = specRegex(tpl).exec(sentence);
  if (!m) return `${kind} phrasing ${variant % 3} should read "${tpl}", got "${sentence}"`;
  const g = m.groups || {}, t = SPEC[fam], margin = hi - lo;
  if ('N' in g && wordToNum(g.N) !== margin) return `says ${g.N}, margin is ${margin}`;
  if ('NC' in g && (wordToNum(g.NC.toLowerCase()) !== margin || g.NC[0] !== g.NC[0].toUpperCase())) return `says ${g.NC}, margin is ${margin}`;
  if ('U' in g && g.U !== t.unit) return `unit ${g.U}, sport scores ${t.unit}s`;
  if ('US' in g && g.US !== (margin === 1 ? t.unit : `${t.unit}s`)) return `unit ${g.US}, margin ${margin} of ${t.unit}s`;
  if ('OV' in g && g.OV !== t.over) return `says ${g.OV}, the sport says ${t.over}`;
  if ('OVC' in g && g.OVC !== t.over[0].toUpperCase() + t.over.slice(1)) return `says ${g.OVC}, the sport says ${t.over}`;
  if ('AN' in g) {
    const word = (m.groups.N);
    const wantAn = /^(?:eight|eleven|eighteen|eighty)/.test(word);
    if (g.AN !== (wantAn ? 'An' : 'A')) return `"${g.AN} ${word}" is the wrong article`;
  }
  return null;
}

// ── the oracle against the module: every label, then a big grid ────────────
const OT_FLAGS = [null, undefined, 0, false, 1, true, '1', '0', 2];
const isOtFlag = (f) => f === 1 || f === true;
{
  let bad = null, count = 0;
  const label = (l, hi, lo, f) => game({ sport: l, home: 'A', away: 'B', home_score: hi, away_score: lo, went_to_ot: f });
  // Every label of every family, on a small grid.
  for (const [fam, t] of Object.entries(SPEC)) {
    for (const l of t.labels) {
      for (const hi of [0, 1, 2, 3, 4, 5, 6, 7, 20, 21, 22, 30, 138]) {
        for (let lo = 0; lo <= Math.min(hi, 9); lo++) {
          for (const f of OT_FLAGS) {
            // The score can be given either way round: the sentence is about the margin.
            for (const [hs, as] of [[hi, lo], [lo, hi]]) {
              const g = { ...label(l, hs, as, f) };
              const s = resultShape(g);
              count++;
              if (!s) { bad ??= `${l} ${hs}-${as}: no shape`; continue; }
              if (s.kind !== specKind(fam, hi, lo, isOtFlag(f))) bad ??= `${l} ${hs}-${as} ot=${String(f)}: kind ${s.kind}, spec ${specKind(fam, hi, lo, isOtFlag(f))}`;
              for (let v = 0; v < 3; v++) {
                const why = verifySentence(fam, hi, lo, isOtFlag(f), resultSentence(s, v), v);
                if (why) bad ??= `${l} ${hs}-${as} ot=${String(f)} variant ${v}: ${why}`;
              }
            }
          }
        }
      }
    }
  }
  ok(() => bad === null, `oracle, every label x scores x overtime flags (${count} rows): each sentence is the spec's, for the spec's kind (${bad})`);
}
{
  let bad = null, count = 0;
  const his = [...Array.from({ length: 46 }, (_, i) => i), 52, 53, 64, 77, 99, 100, 101, 105, 138, 144];
  for (const [fam] of Object.entries(SPEC)) {
    for (const hi of his) {
      for (let lo = 0; lo <= hi; lo++) {
        for (const f of [null, 0, 1]) {
          const g = game({ sport: REP[fam], home: 'A', away: 'B', home_score: hi, away_score: lo, went_to_ot: f });
          const s = resultShape(g);
          count++;
          if (!s) { bad ??= `${REP[fam]} ${hi}-${lo}: no shape`; continue; }
          for (let v = 0; v < 3; v++) {
            const why = verifySentence(fam, hi, lo, f === 1, resultSentence(s, v), v);
            if (why) bad ??= `${REP[fam]} ${hi}-${lo} ot=${f} variant ${v}: ${why}`;
          }
        }
      }
    }
  }
  ok(() => bad === null, `oracle, every margin from 0 to 144 in each family (${count} rows): each sentence is the spec's (${bad})`);
}
ok(() => Object.entries(SPEC).every(([fam, t]) => [t.narrow, t.narrow + 1, t.wide - 1, t.wide].every((margin) => {
  // The edges of both classes, in every family: the first margin that is narrow, the first that is not, and the same for lopsided.
  const g = game({ sport: REP[fam], home: 'A', away: 'B', home_score: 40 + margin, away_score: 40 });
  return resultShape(g).kind === specKind(fam, 40 + margin, 40, false);
})), 'oracle, class edges: the margin just under and at each narrow / lopsided threshold, in every family');
ok(() => ['hockey', 'soccer', 'basketball', 'baseball', 'gridiron'].every(fam => {
  const t = SPEC[fam];
  const at = (m, lo = 5) => resultShape(game({ sport: REP[fam], home: 'A', away: 'B', home_score: lo + m, away_score: lo })).kind;
  return at(t.narrow) === 'narrow' && at(t.narrow + 1) === (t.narrow + 1 >= t.wide ? 'wide' : 'win')
    && at(t.wide) === 'wide' && at(t.wide - 1) === (t.wide - 1 <= t.narrow ? 'narrow' : 'win');
}), 'thresholds: narrow is at or under the family\'s narrow margin, lopsided at or over its wide margin');
ok(() => {
  const k = (sport, hs, as, f = 0) => resultShape(game({ sport, home: 'A', away: 'B', home_score: hs, away_score: as, went_to_ot: f })).kind;
  return k('NHL', 4, 0, 1) === 'win-ot' && k('NHL', 4, 0, 0) === 'shutout' && k('NHL', 9, 0, 0) === 'shutout' && k('NBA', 100, 0, 0) === 'shutout'
    && k('NHL', 3, 3, 1) === 'level-ot' && k('EPL', 0, 0, 1) === 'scoreless' && k('EPL', 0, 0, 0) === 'scoreless' && k('EPL', 2, 2, 0) === 'level'
    && k('NHL', 5, 4, 1) === 'win-ot' && k('NHL', 9, 1, 1) === 'win-ot';
}, 'the order of the kinds: overtime before shutout before lopsided before narrow; 0-0 is scoreless whether or not it went past regulation');

// ── what the row must say before the word "overtime" is printed ─────────────
ok(() => [1, true].every(f => resultSentence(resultShape(game({ sport: 'NHL', home: 'A', away: 'B', home_score: 3, away_score: 2, went_to_ot: f })), 0) === 'A one-goal win after overtime.')
  && [0, null, undefined, false, '1', '0', 2, 'true'].every(f => resultSentence(resultShape(game({ sport: 'NHL', home: 'A', away: 'B', home_score: 3, away_score: 2, went_to_ot: f })), 0) === 'A narrow one-goal win.'),
  'overtime is printed only when the row says 1 or true; 0, null, missing and anything else say nothing about it');
ok(() => ['MLB', 'EPL', 'NBA', 'NFL'].map(s => resultSentence(resultShape(game({ sport: s, home: 'A', away: 'B', home_score: s === 'NFL' ? 30 : 5, away_score: s === 'NFL' ? 27 : 2, went_to_ot: 1 })), 0))
  .join('|') === 'A three-run win after extra innings.|A three-goal win after extra time.|A three-point win after overtime.|A three-point win after overtime.',
  'the sport names play past regulation its own way: extra innings, extra time, overtime');

// ── rows the relay writes no sentence for ───────────────────────────────────
ok(() => [
  game({ sport: 'golf', home: 'Open', away: 'R4', home_score: -16, away_score: null, note: 'Leader -16' }),
  game({ sport: 'PGA Tour', home: 'A', away: 'B', home_score: -16, away_score: -15 }),
  game({ sport: 'IPL', home: 'A', away: 'B', home_score: 180, away_score: 177 }),
  game({ sport: 'AFL', home: 'A', away: 'B', home_score: 98, away_score: 85 }),
  game({ sport: 'Quidditch', home: 'A', away: 'B', home_score: 150, away_score: 90 }),
  game({ sport: '', home: 'A', away: 'B', home_score: 5, away_score: 2 }),
  game({ sport: null, home: 'A', away: 'B', home_score: 5, away_score: 2 }),
  game({ sport: 'NHL', home: 'A', away: 'B', home_score: 5.5, away_score: 2 }),
  game({ sport: 'NHL', home: 'A', away: 'B', home_score: 5, away_score: -2 }),
  game({ sport: 'NHL', home: 'A', away: 'B', home_score: NaN, away_score: 2 }),
  game({ sport: 'NHL', home: 'A', away: 'B', home_score: Infinity, away_score: 2 }),
  game({ sport: 'NHL', home: 'A', away: 'B', home_score: '5', away_score: 2 }),
  game({ sport: 'NHL', home: 'A', away: 'B', home_score: 5, away_score: null }),
].every(g => resultShape(g) === null),
  'no sentence for an event update, a golf or cricket or Australian-rules row, an unknown sport, or a score that is not a plain count');
ok(() => resultSentence(null) === null && resultSentence(undefined) === null && resultSentence({ kind: 'bogus', n: 1, unit: 'goal', over: 'overtime' }) === null
  && resultSentence({ kind: 'toString', n: 1, unit: 'goal', over: 'overtime' }) === null,
  'no shape, or a kind the relay has no phrasing for, writes no sentence');

// ── the phrasings: handed out in turn ───────────────────────────────────────
{
  const sh = resultShape(game({ sport: 'NHL', home: 'A', away: 'B', home_score: 3, away_score: 2 }));
  const s = [0, 1, 2, 3, 4, 5, 6].map(v => resultSentence(sh, v));
  ok(() => new Set(s.slice(0, 3)).size === 3 && s[3] === s[0] && s[4] === s[1] && s[5] === s[2] && s[6] === s[0],
    'a kind has three phrasings, handed out in turn and then round again');
  ok(() => resultSentence(sh, -1) === s[2] && resultSentence(sh, 1.9) === s[1] && resultSentence(sh) === s[0] && resultSentence(sh, NaN) === s[0],
    'a variant that is negative, fractional, missing or not a number still picks one of the three');
  ok(() => s.join('|') === 'A narrow one-goal win.|Won narrowly, by one goal.|Just one goal between the sides at the end.|A narrow one-goal win.|Won narrowly, by one goal.|Just one goal between the sides at the end.|A narrow one-goal win.',
    'the narrow phrasings, exactly');
}
{
  // The number words and the article, at the numbers where they are easiest to get wrong.
  const w = (m, sport = 'NBA') => resultSentence(resultShape(game({ sport, home: 'A', away: 'B', home_score: 50 + m, away_score: 50 })), 0);
  const want = { 3: 'A narrow three-point win.', 8: 'An eight-point win.', 10: 'A ten-point win.', 11: 'An eleven-point win.', 12: 'A twelve-point win.', 13: 'A thirteen-point win.',
    18: 'An eighteen-point win.', 19: 'A nineteen-point win.', 21: 'A lopsided twenty-one-point win.', 30: 'A lopsided thirty-point win.',
    53: 'A lopsided fifty-three-point win.', 80: 'A lopsided eighty-point win.', 81: 'A lopsided eighty-one-point win.', 99: 'A lopsided ninety-nine-point win.',
    100: 'A lopsided 100-point win.' };
  // The same numbers where the article comes straight before the number: an overtime win (any margin) and a shutout (the losers on 0).
  const ot = (m) => resultSentence(resultShape(game({ sport: 'NBA', home: 'A', away: 'B', home_score: 50 + m, away_score: 50, went_to_ot: 1 })), 0);
  const nil = (m, sport = 'NHL') => resultSentence(resultShape(game({ sport, home: 'A', away: 'B', home_score: m, away_score: 0 })), 0);
  ok(() => Object.entries(want).every(([m, s]) => w(Number(m)) === s)
    && ot(1) === 'A one-point win after overtime.' && ot(8) === 'An eight-point win after overtime.' && ot(11) === 'An eleven-point win after overtime.'
    && ot(18) === 'An eighteen-point win after overtime.' && ot(80) === 'An eighty-point win after overtime.' && ot(12) === 'A twelve-point win after overtime.'
    && nil(1) === 'A one-goal shutout.' && nil(8) === 'An eight-goal shutout.' && nil(11, 'MLB') === 'An eleven-run shutout.' && nil(3) === 'A three-goal shutout.',
    'number words and articles: an eight-, eleven-, eighteen- and eighty-, a one- and a twelve-, hyphenated tens, digits from one hundred');
  ok(() => resultSentence(resultShape(game({ sport: 'NBA', home: 'A', away: 'B', home_score: 51, away_score: 50 })), 0) === 'A narrow one-point win.'
    && resultSentence(resultShape(game({ sport: 'NBA', home: 'A', away: 'B', home_score: 51, away_score: 50 })), 1) === 'Won narrowly, by one point.'
    && resultSentence(resultShape(game({ sport: 'NBA', home: 'A', away: 'B', home_score: 52, away_score: 50 })), 1) === 'Won narrowly, by two points.',
    'one point is singular, two are plural');
  ok(() => resultSentence(resultShape(game({ sport: 'MLB', home: 'A', away: 'B', home_score: 7, away_score: 0 })), 2) === 'Seven runs to nothing.'
    && resultSentence(resultShape(game({ sport: 'MLB', home: 'A', away: 'B', home_score: 1, away_score: 0 })), 2) === 'One run to nothing.',
    'a phrasing that opens on the number capitalises it, and the unit follows the number');
}

// ── sport labels: every one the archive declares has a decision ─────────────
{
  const idx = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const grab = (a, z) => {
    const i = idx.indexOf(a);
    if (i < 0) throw new Error(`marker not found in src/index.js: ${a}`);
    const j = idx.indexOf(z, i);
    if (j < 0) throw new Error(`end marker not found after: ${a}`);
    return idx.slice(i, j + z.length);
  };
  // EVALUATED, NOT PATTERN-MATCHED (the way scripts/check-sport-canonicaliser.mjs reads the same constants).
  const declared = new Function(`${grab('const SOCCER_LEAGUE_LABELS = {', '\n};')}\n${grab('const NON_SOCCER_SPORT_LABELS = [', '\n];')}
    return [...Object.values(SOCCER_LEAGUE_LABELS), ...NON_SOCCER_SPORT_LABELS];`)();
  ok(() => declared.length >= 25 && declared.includes('NHL') && declared.includes('EFL Trophy') && declared.includes('wnba') && declared.includes('golf'),
    'the sport labels the archive declares could be read from src/index.js');
  const missing = declared.filter(l => sportFamily(l) === null);
  ok(() => missing.length === 0, `every declared sport label has a decision, a sentence family or none (missing: ${missing.join(', ')})`);
  const decided = [...Object.values(SPEC).flatMap(t => t.labels), ...SPEC_NONE];
  const dead = decided.filter(l => !declared.includes(l));
  ok(() => dead.length === 0, `every label the spec decides is one the archive declares, spelt as declared (not declared: ${dead.join(', ')})`);
  ok(() => decided.every(l => sportFamily(l) === (SPEC_NONE.includes(l) ? 'none' : Object.entries(SPEC).find(([, t]) => t.labels.includes(l))[0])),
    'every label belongs to the family the spec gives it');
  ok(() => [...NO_SENTENCE_LABELS].sort().join() === [...SPEC_NONE].sort().join(), 'the labels the relay writes no sentence for are AFL, IPL, PGA Tour and golf');
  ok(() => sportFamily('Quidditch') === null && sportFamily('') === null && sportFamily(null) === null && sportFamily(undefined) === null
    && sportFamily(' nhl ') === 'hockey' && sportFamily('WNBA') === 'basketball' && sportFamily('wnba') === 'basketball' && sportFamily('Golf') === 'none',
    'a label is compared trimmed and in lower case; one nobody decided on has no family');
  for (const date of ['2026-10-27', '2026-10-29']) {
    const fx = JSON.parse(readFileSync(new URL(`./fixtures/morning-report-slate-${date}.json`, import.meta.url), 'utf8'));
    const labels = [...new Set([...fx.ctx.games.regular, ...fx.ctx.games.postseason].map(g => g.sport))];
    ok(() => labels.every(l => sportFamily(l) !== null), `${date}: every sport on the real slate has a decision (${labels.join(', ')})`);
  }
}

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
// What the relay says about each, as the first phrasing: worked out by hand from the rows above.
const SAYS = ['A narrow one-point win.', 'A two-goal win.', 'A lopsided four-goal win.', 'Finished level.', null,
  'A twenty-seven-point win after overtime.', 'A narrow three-point win.'];
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
ok(() => base.map(c => (c.shape ? resultSentence(c.shape, 0) : null)).join('|') === SAYS.join('|'),
  'each citable game carries the shape its sentence is written from (none for an event update)');
ok(() => [1, true].every(f => citableGames([game({ sport: 'NHL', away: 'A', home: 'B', away_score: 1, home_score: 2, went_to_ot: f })])[0].descriptor.endsWith(', went to overtime'))
  && [0, null, undefined, false, '1', '0', 2].every(f => !citableGames([game({ sport: 'NHL', away: 'A', home: 'B', away_score: 1, home_score: 2, went_to_ot: f })])[0].descriptor.includes('overtime')),
  'the descriptor says overtime under the same rule as the sentence: only a 1 or true');
ok(() => citableGames(ROWS, { excludeGameId: ROWS[1].id }).map(c => c.fact).join('|') === FACTS.filter((_, i) => i !== 1).join('|')
  && citableGames(ROWS, { excludeGameId: ROWS[1].id })[1].id === 'g2',
  'the game Phase 3 already printed is left out and the ids close up');
ok(() => citableGames(null).length === 0 && citableGames([]).length === 0, 'no recap games, nothing to cite');
// 2026-07-02: "Congo DR at England 2-1" was read as Congo DR 2, England 1 (real: England 2, Congo DR 1).
ok(() => citableGames([game({ sport: 'WC', away: 'Congo DR', home: 'England', away_score: 1, home_score: 2 })])[0].fact === 'England 2, Congo DR 1'
  && citableGames([game({ sport: 'WC', away: 'Congo DR', home: 'England', away_score: 2, home_score: 1 })])[0].fact === 'Congo DR 2, England 1',
  '2026-07-02: each team is printed beside its own score, whichever side won');
ok(() => citableGames([game({ sport: 'WC', away: 'Congo DR', home: 'England', away_score: 1, home_score: 2 })])[0].shape === null,
  'a sport nobody decided on is still printed (names and score) and has no sentence');

// ── the prompt: the model is never given a name ─────────────────────────────
const STARS = { stars: 3, totalGames: 28, dramaGames: 2, closeGames: 5, walkoffs: 0 };
const P = buildMorningReportPrompt('2026-10-30', { stars: STARS, truthIs: { type: 'upset', headline: 'Zorb beat Quill 9-8 as a +300 underdog.' }, citable: base });
ok(() => base.every(c => P.includes(`${c.id} | ${c.descriptor}`)), 'the prompt lists every citable game under its id');
ok(() => !ROWS.flatMap(g => [g.home, g.away, g.note, g.id]).filter(s => s && s.length >= 3).some(s => P.includes(s)),
  'the prompt contains no team name, event name, note or game id');
ok(() => !P.includes('Zorb') && !P.includes('+300') && P.includes('a big underdog won'),
  'the prompt carries the truth as words and never its headline');
ok(() => P.includes('pick: <') && P.includes('open: <') && P.includes('close: <') && P.includes('three labelled lines')
  && !P.includes('<one sentence about that game>') && !/\bg\d+: </.test(P),
  'the form asks for a pick line, an open line and a close line, and no sentence about any game');
ok(() => P.includes('the relay writes every fact') && P.includes('Never write a digit') && P.includes('Never write a team name'),
  'the prompt says who writes the facts and what the model may not write');
ok(() => P.includes('Do not name, number, rank or describe any single game, and do not say how any game went')
  && P.includes('nothing about whether a result was expected or a surprise, except what THE TRUTH IS says below'),
  'the prompt does not let the model describe a game, say how it went, or call a result expected or a surprise');
ok(() => P.includes('You are told only the sports and the final results') && P.includes('home or away sides, comebacks, late drama'),
  'the prompt says what the model is not told, so it does not claim it');
ok(() => !P.includes('"the visitors"') && !P.includes('"the home side"') && !P.includes('closest game of the night') && !P.includes('Say "the winners"'),
  'the prompt offers no wording the model cannot back (2026-10-30 replay: "the home side", "closest of the night")');
ok(() => buildMorningReportPrompt('d', { stars: null, truthIs: null, citable: [] }).includes('(no completed games)')
  && buildMorningReportPrompt('d', { stars: null, truthIs: null, citable: [] }).includes('not available tonight')
  && buildMorningReportPrompt('d', { stars: null, truthIs: null, citable: [] }).includes('unrated'),
  'a missing star rating, a missing truth and no games are said plainly');

// ── parseMorningReportLines: one rule per case ──────────────────────────────
const names = slateNamesOf({ games: { regular: ROWS, postseason: [] } });
const O = 'Some nights remind us how much can change in a single possession.';
const C = 'Tomorrow brings another slate and another chance to be surprised.';
const A = (lines, citable = base) => parseMorningReportLines(lines.join('\n'), citable, names);
const why = (r) => r.dropped.map(d => `${d.key ?? ''}:${d.reason}`).join(',');
{
  const r = A([`open: ${O}`, 'pick: g2, g1, g3', `close: ${C}`]);
  ok(() => r.open === O && r.close === C && r.picks.map(p => p.entry.id).join() === 'g2,g1,g3' && r.dropped.length === 0 && r.recognized === 3
    && r.picks.every(p => Object.keys(p).join() === 'entry'),
    'a compliant answer is kept whole, games in the model\'s order, and a pick carries nothing of the model\'s but its id');
}
{
  const r = A([`Open: ${O}`, 'PICK:G03, g01 ;g2', `CLOSE:${C}`]);
  ok(() => r.open === O && r.close === C && r.picks.map(p => p.entry.id).join() === 'g3,g1,g2' && r.dropped.length === 0,
    'keys are case-insensitive; ids may be separated by commas, semicolons or spaces, and leading zeros do not matter');
}
ok(() => A(['picks: g1, g2']).picks.map(p => p.entry.id).join() === 'g1,g2' && A(['pick: g1, g2.']).picks.length === 2 && why(A(['pick: g1, g2.'])) === '',
  'a plural key and a closing full stop on the pick line are not a break of the form');
ok(() => why(A(['pick: g99, g0, g8'])) === 'g99:unknown-id,g0:unknown-id,g8:unknown-id',
  '2026-07-03: an id that is not in the list is dropped, so a game cannot be invented');
{
  const r = A(['pick: g1, g1, G01']);
  ok(() => r.picks.length === 1 && why(r) === 'g1:duplicate-id,g1:duplicate-id', 'a repeated id keeps the first and drops the rest');
}
{
  const r = A(['pick: g1, g2 and g3, a thrilling overtime game, g4']);
  ok(() => r.picks.map(p => p.entry.id).join() === 'g1,g2,g3,g4' && why(r) === 'pick:unrecognized-pick',
    'a word on the pick line that is not an id is dropped, once for the line, and the ids around it are kept');
}
{
  const r = A(['pick: g1', 'pick: g2, g3', `close: ${C}`]);
  ok(() => r.picks.map(p => p.entry.id).join() === 'g1' && why(r) === 'pick:duplicate-pick' && r.close === C,
    'a second pick line is dropped whole; the first stands');
}
{
  const r = A(['g1: A narrow one-point finish that stayed tense.', 'g2: Another one.', `open: ${O}`]);
  ok(() => r.picks.length === 0 && why(r) === ':unrecognized-line,:unrecognized-line' && r.open === O && r.recognized === 1,
    'the old form (a sentence for each game) is no longer the form: those lines are dropped and nothing of theirs is kept');
}
{
  const more = citableGames(Array.from({ length: 8 }, (_, i) => game({ sport: 'NHL', away: `Away${i}`, home: `Home${i}`, away_score: i, home_score: i + 1 })));
  const r = parseMorningReportLines('pick: g1, g2, g3, g4, g5, g6, g7, g8', more, []);
  ok(() => MR_MAX_PICKS === 5 && r.picks.length === 5 && why(r) === 'g6:over-limit,g7:over-limit,g8:over-limit',
    'at most five games are kept; the rest are dropped as over-limit');
}
for (const bad of ['A 6-4 win for the visitors.', 'Won by 3.', 'Game 7 energy all night.', 'A ３ goal margin.', 'Squared² and then some.', 'The 1st of many.']) {
  ok(() => why(A([`open: ${bad}`])) === 'open:digit' && why(A([`close: ${bad}`])) === 'close:digit', `a digit drops an open or close line: "${bad}"`);
}
// 2026-07-15: a bare mascot ("Fire") was expanded into the wrong team ("Chicago Fire").
ok(() => why(A(['close: Chicago Fire pushed the home side to the limit.'])) === 'close:team-name',
  '2026-07-15: "Chicago Fire" is dropped, because Fire is on tonight\'s slate');
ok(() => why(A(['open: The Celtics were great again.'])) === 'open:team-name', 'a slate name is dropped wherever it appears');
ok(() => why(A(['close: Baycurrent Classic fans had a long day.'])) === 'close:team-name', 'an event name from the slate is dropped too');
ok(() => why(A([`open: The Spurs set the tone tonight.`, `close: ${C}`])) === 'open:team-name' && A([`open: The Spurs set the tone tonight.`, `close: ${C}`]).close === C,
  'a name in the open line drops the open line and leaves the close line');
ok(() => why(A([`open: ${O.replace('possession', 'fire')}`])) === '' && why(A(['open: Sunday was kind to the visitors.'])) === ''
  && why(A(['close: A firefly of a night, bright and brief.'])) === '',
  'a name only counts as a whole, capitalised word (fire, Sunday and firefly pass)');
ok(() => why(A([`open: ${Array(MR_MAX_LINE_WORDS).fill('word').join(' ')}.`])) === ''
  && why(A([`open: ${Array(MR_MAX_LINE_WORDS + 1).fill('word').join(' ')}.`])) === 'open:too-long',
  `a line is at most ${MR_MAX_LINE_WORDS} words`);
ok(() => why(A(['close: A night that was cut off mid sen'])) === 'close:unterminated'
  && why(A([`open: He called it "a night to remember."`])) === '' && why(A(['open: Was it ever in doubt?'])) === '',
  'a line without a full stop (what a cut-off answer ends in) is dropped; a closing quote after one is fine');
{
  const r = A(['Here is the report:', '**open:** Wonder.', '- pick: g1', 'pick - g1', '', 'pick: g1']);
  ok(() => why(r) === ':unrecognized-line,:unrecognized-line,:unrecognized-line,:unrecognized-line' && r.picks.length === 1 && r.recognized === 1,
    'a line that does not follow the form is dropped without disturbing the rest');
}
{
  const r = A(Array.from({ length: 30 }, () => 'nonsense'));
  ok(() => r.dropped.length === 12, 'the dropped list is capped at twelve records');
}
{
  const r = A([`open: ${O}`, `open: ${C}`, `close: ${C}`, `close: ${O}`, 'pick: g1']);
  ok(() => r.open === O && r.close === C && why(r) === 'open:duplicate-open,close:duplicate-close', 'a repeated open or close line keeps the first');
}
{
  const r = A(['pick: g1, g99, tease', 'open: A 6-4 win for the Celtics, sealed late in the final period of play.', 'close: Chicago Fire']);
  ok(() => !JSON.stringify(r.dropped).match(/Celtics|Chicago|6-4|win|tease/) && r.dropped.every(d => Object.keys(d).sort().join() === 'key,reason'),
    'a dropped line is recorded by key and reason only, never by text (the row is served publicly)');
}
ok(() => parseMorningReportLines(null, base, names).picks.length === 0 && parseMorningReportLines('', base, names).dropped.length === 0,
  'no answer parses to nothing');
ok(() => { const r = parseMorningReportLines(`open: ${O}\r\npick: g2\r\nclose: ${C}\r\n`, base, names); return r.open === O && r.close === C && r.picks.length === 1; },
  'Windows line endings parse');

// ── composeMorningReport: the paragraph the relay writes ────────────────────
{
  const parsed = A([`open: ${O}`, 'pick: g2, g1', `close: ${C}`]);
  const c = composeMorningReport({ headline: 'Zorb beat Quill 9-8.', parsed });
  ok(() => c.text === `Zorb beat Quill 9-8. ${O} Lightning 6, Jets 4. A two-goal win. Celtics 125, Nets 124. A narrow one-point win. ${C}`,
    'headline, open, then each fact and the relay\'s sentence about it in the model\'s order, then close');
  ok(() => c.cited.join() === [ROWS[1].id, ROWS[0].id].join(), '`cited` lists the real game ids in the order printed');
  ok(() => JSON.stringify(c.games) === JSON.stringify([
    { id: 'g2', gameId: ROWS[1].id, fact: 'Lightning 6, Jets 4.', sentence: 'A two-goal win.' },
    { id: 'g1', gameId: ROWS[0].id, fact: 'Celtics 125, Nets 124.', sentence: 'A narrow one-point win.' }]),
    '`games` lists what was printed for each pick: id, game id, fact and sentence');
  ok(() => composeMorningReport({ headline: 'No stop', parsed }).text.startsWith('No stop. '), 'a headline without a full stop gets one');
}
{
  const printed = (from, to) => FACTS.slice(from, to).map((f, i) => `${f}.${SAYS[from + i] ? ` ${SAYS[from + i]}` : ''}`).join(' ');
  ok(() => composeMorningReport({ headline: null, parsed: A(['pick: g1, g2, g3, g4, g5']) }).text === printed(0, 5)
    && composeMorningReport({ headline: null, parsed: A(['pick: g6, g7']) }).text === printed(5, 7),
    'seven games, each with its own sentence worked out by hand, and an event update with none');
}
{
  // Four narrow one-goal NHL wins: the phrasings are handed out in turn, then round again.
  const four = citableGames(Array.from({ length: 4 }, (_, i) => game({ sport: 'NHL', away: `Away${i}`, home: `Home${i}`, away_score: 2, home_score: 3 })));
  const c = composeMorningReport({ headline: null, parsed: parseMorningReportLines('pick: g1, g2, g3, g4', four, []) });
  ok(() => c.games.map(g => g.sentence).join('|') === 'A narrow one-goal win.|Won narrowly, by one goal.|Just one goal between the sides at the end.|A narrow one-goal win.',
    'two games of the same kind in one report do not get the same sentence: the phrasings are handed out in turn');
  const mix = citableGames([game({ sport: 'NHL', away: 'A1', home: 'H1', away_score: 2, home_score: 3 }), game({ sport: 'NHL', away: 'A2', home: 'H2', away_score: 1, home_score: 5 }),
    game({ sport: 'NHL', away: 'A3', home: 'H3', away_score: 2, home_score: 3 })]);
  const cm = composeMorningReport({ headline: null, parsed: parseMorningReportLines('pick: g1, g2, g3', mix, []) });
  ok(() => cm.games.map(g => g.sentence).join('|') === 'A narrow one-goal win.|A lopsided four-goal win.|Won narrowly, by one goal.',
    'the turn is taken per kind: a lopsided game between two narrow ones does not use up a narrow phrasing');
}
ok(() => composeMorningReport({ headline: 'H.', parsed: A([`open: ${O}`, `close: ${C}`]) }) === null,
  'an open and a close with no pick is not a report');
for (const h of [null, undefined, '', '   ']) {
  ok(() => composeMorningReport({ headline: h, parsed: A([`open: ${O}`, 'pick: g2']) }).text === `${O} Lightning 6, Jets 4. A two-goal win.`,
    `with no headline (${JSON.stringify(h)}) nothing is invented to stand in for it`);
}
{
  const withStop = citableGames([game({ sport: 'golf', away: 'R4', home: 'Open', away_score: null, home_score: -3, note: 'Won it all.' })]);
  const c = composeMorningReport({ headline: null, parsed: parseMorningReportLines('pick: g1', withStop, []) });
  ok(() => c.text === 'Open (R4): Won it all.' && c.games[0].sentence === null,
    'an event update is printed as its fact alone, and a fact that already ends in a full stop does not get a second');
}
{
  // Nothing the model writes can reach a game line: stray words on the pick line, and the
  // retired per-game lines, are tagged and must not be in the paragraph.
  const parsed = A(['pick: g1 PICKCAN, g2', 'g1: OLDCAN a narrow finish.', `open: ${O}`, `close: ${C}`, 'FREECAN']);
  const c = composeMorningReport({ headline: 'H.', parsed });
  ok(() => !/PICKCAN|OLDCAN|FREECAN/.test(c.text) && c.text === `H. ${O} Celtics 125, Nets 124. A narrow one-point win. Lightning 6, Jets 4. A two-goal win. ${C}`,
    'no word of the model\'s on the pick line, in a retired game line or outside the form reaches the paragraph');
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
  const done = finishMorningReport(`open: ${O}\npick: g1, g2, g3\nclose: The Celtics again.`, prep, truth);
  ok(() => done.composed.text.startsWith(`Zorb beat Quill 9-8. ${O} Celtics 125, Nets 124. A narrow one-point win. `)
    && done.parsed.picks.length === 3 && done.parsed.dropped.length === 1 && done.parsed.dropped[0].reason === 'team-name'
    && !done.composed.text.includes('The Celtics again'),
    'finish: the headline is first, the games follow, and a slate name from the context drops the close line');
  ok(() => finishMorningReport('', prep, truth).composed === null && finishMorningReport(null, prep, truth).composed === null,
    'finish: no answer composes nothing');
  ok(() => MR_MAX_TOKENS === 320, 'the answer is allowed 320 tokens (three labelled lines)');
}

// ── the property: whatever the model answers, the game lines are the relay's ─
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const WORDS = ['Zorbax', 'Quillfeather', 'Marrowind', 'Tessellate', 'Vantablack', 'Ombrelune', 'Crestfallen', 'Dunmarrow', 'Halcyonic', 'Ironbark',
  'Jubilant Otters', 'Knotweed Rovers', 'Lanternfish', 'Moonrakers', 'Nightjar', 'Oxbow Union', 'Pennywhistle', 'Quartermaster', 'Rookery', 'Sandpiper'];
const SENT = ['A night that stayed tense until the last minute.', 'The widest margin of the night.', 'A calm, steady evening for the visitors.',
  'The home side found its rhythm early and never let go.', 'A level evening that nobody could separate.', 'Overtime again, and nobody minded.'];
const endWith = (s) => (/[.!?…]["'”’)]*$/.test(s) ? s : `${s}.`);
let propFails = 0;
for (let seed = 1; seed <= 400; seed++) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const nGames = 3 + Math.floor(r() * 14);
  const pool = [...WORDS].sort(() => r() - 0.5);
  const sports = ['NBA', 'NHL', 'EPL', 'MLB', 'NFL', 'WNBA', 'Serie A', 'CFB', 'Quidditch'];
  const rows = Array.from({ length: nGames }, (_, i) => {
    const golf = r() < 0.1;
    const sport = pick(sports);
    const small = ['NHL', 'EPL', 'MLB', 'Serie A'].includes(sport);
    const hs = Math.floor(r() * (small ? 9 : 140)), as = r() < 0.15 ? hs : Math.floor(r() * (small ? 9 : 140));
    return golf
      ? game({ id: `row${i}`, sport: 'golf', away: 'R3', home: `${pool[(2 * i) % 20]} Classic`, away_score: null, home_score: -10, note: `${pool[(2 * i + 1) % 20]} -10` })
      : game({ id: `row${i}`, sport, away: pool[(2 * i) % 20], home: pool[(2 * i + 1) % 20], away_score: as, home_score: hs, went_to_ot: pick([null, 0, 0, 1, true]) });
  });
  const ctx = { games: { regular: rows, postseason: [] } };
  const recap = selectRecapGames(ctx);
  const truth = { type: pick(['upset', 'blowout', 'none', 'convergence']), game_id: r() < 0.5 ? pick(rows).id : null };
  const headline = `${pick(WORDS)} beat ${pick(WORDS)} ${Math.floor(r() * 9)}-${Math.floor(r() * 9)}.`;
  const citable = citableGames(recap, { excludeGameId: truth.game_id });
  const slate = slateNamesOf(ctx);
  const prompt = buildMorningReportPrompt('2026-10-30', { stars: STARS, truthIs: truth, citable });
  // An answer made of everything that can go wrong, in random order.
  const ids = () => Array.from({ length: 1 + Math.floor(r() * 8) }, () => (citable.length ? pick(citable).id : 'g1')).join(pick([', ', ',', ' ', '; ']));
  const nm = () => pick(slate.length ? slate : ['Nobody']);
  const lines = [];
  const count = 2 + Math.floor(r() * 12);
  for (let k = 0; k < count; k++) {
    const id = citable.length ? pick(citable).id : 'g1';
    lines.push(pick([
      () => `pick: ${ids()}`, () => `pick: ${ids()}`, () => `pick: ${ids()}.`, () => `picks: g${50 + Math.floor(r() * 40)}, ${ids()}`,
      () => `pick: ${ids()}, PICKCAN and ${nm()}`, () => `${id}: ${pick(SENT).slice(0, -1)} OLDCAN.`, () => `${id}: ${nm()} ${pick(SENT)}`,
      () => `open: ${pick(SENT).slice(0, -1)} OPENCAN.`, () => `open: ${pick(SENT)}`, () => `open: ${nm()} lead the way.`,
      () => `close: ${pick(SENT).slice(0, -1)} CLOSECAN.`, () => `close: ${pick(SENT)} It ended ${Math.floor(r() * 9)} to ${Math.floor(r() * 9)}.`,
      () => `close: ${pick(SENT)}`.slice(0, -1), () => `Here is the report, ${nm()}: FREECAN`, () => `${id}: ${pick(SENT)} ${Math.floor(r() * 99)}-${Math.floor(r() * 99)}.`,
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
  if (parsed.picks.some(p => Object.keys(p).join() !== 'entry')) bad = 'a pick carries something besides the game it names';
  if (parsed.picks.length === 0 && composed !== null) bad = 'a report with no game';
  if (parsed.picks.length > 0 && composed === null) bad = 'no report from valid picks';
  if (parsed.dropped.some(d => Object.keys(d).sort().join() !== 'key,reason' || !(d.key === null || /^(?:g[0-9]{1,3}|open|close|pick)$/.test(d.key)))) bad = 'a dropped record that is not a key and a reason';
  if (composed) {
    const t = composed.text;
    if (/PICKCAN|OLDCAN|FREECAN/.test(t)) bad = 'a word of the model\'s from outside the open and close lines reached the paragraph';
    if ((/OPENCAN/.test(t)) !== Boolean(parsed.open && /OPENCAN/.test(parsed.open)) || (/CLOSECAN/.test(t)) !== Boolean(parsed.close && /CLOSECAN/.test(parsed.close))) bad = 'the open or close line is not what the parser kept';
    if (composed.games.length !== parsed.picks.length || composed.cited.length > parsed.picks.length) bad = 'games or cited is not the printed picks';
    // The paragraph is exactly: headline, kept open, each pick's fact and sentence, kept close.
    const parts = [endWith(headline)];
    if (parsed.open) parts.push(parsed.open);
    const seen = {};
    parsed.picks.forEach((p, i) => {
      const row = recap.find(g => g.id === p.entry.gameId);
      const fam = sportFamily(row.sport);
      const g = composed.games[i];
      const scored = typeof row.home_score === 'number' && typeof row.away_score === 'number';
      const sayable = SPEC[fam] && scored && row.home_score >= 0 && row.away_score >= 0;
      let sentence = null;
      if (sayable) {
        const hi = Math.max(row.home_score, row.away_score), lo = Math.min(row.home_score, row.away_score);
        const kind = specKind(fam, hi, lo, isOtFlag(row.went_to_ot));
        const v = seen[kind] = (seen[kind] ?? -1) + 1;
        const problem = verifySentence(fam, hi, lo, isOtFlag(row.went_to_ot), g.sentence, v);
        if (problem) bad = `game ${p.entry.id} (${row.sport} ${row.home_score}-${row.away_score}): ${problem}`;
        sentence = g.sentence;
      } else if (g.sentence !== null) bad = `game ${p.entry.id} (${row.sport}) has a sentence and should have none`;
      if (g.fact !== endWith(p.entry.fact) || g.id !== p.entry.id || g.gameId !== p.entry.gameId) bad = `game ${p.entry.id}: fact, id or game id changed`;
      parts.push(sentence ? `${g.fact} ${sentence}` : g.fact);
    });
    if (parsed.close) parts.push(parsed.close);
    if (t !== parts.join(' ')) bad = 'the paragraph is not headline + open + each fact and sentence + close';
    // Take away everything the relay wrote; whatever is left is the model's, and has no digit and no name.
    let rest = t.replace(endWith(headline), ' ');
    for (const g of composed.games) rest = rest.replace(g.fact, ' ').replace(g.sentence ?? '', ' ');
    if (/\p{N}/u.test(rest)) bad = 'a digit of the model\'s reached the paragraph';
    if (slate.some(nm => new RegExp(`(?<![A-Za-z])${nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`).test(rest))) bad = 'a slate name of the model\'s reached the paragraph';
    if (!composed.cited.every(id => recap.some(g => g.id === id))) bad = 'cited is not a list of real games';
    if (!t.startsWith(endWith(headline))) bad = 'the headline is not first';
  }
  if (bad) { propFails++; if (propFails <= 3) console.log(`FAIL  property, seed ${seed}: ${bad}`); }
}
ok(() => propFails === 0, `400 random slates and answers: every game line is the relay's fact and a sentence the oracle accepts, and no word of the model's reaches one (${propFails} failing seed(s))`);

// ── the two real slates the old guard threw accurate prose away on ─────────
// What the relay says about each game the old guard confused, worked out by hand from the rows:
//   10-27  Celtics 125, Nets 124 went to overtime (row: 1), so it is a one-point win after overtime;
//          Devils 5, Stars 1 and Panthers 5, Jets 1 are four-goal wins (hockey: lopsided from four),
//          the second of them in the second phrasing; Sabres 2, Sharks 0 is a shutout.
//   10-29  Dream 80, Valkyries 69 is 11 points (an eleven); Lightning 6, Jets 4 is two goals and is
//          the second plain win in the report; Grizzlies 124, Trail Blazers 103 is 21 points
//          (basketball: lopsided from twenty); Blues 4, Bruins 1 is three goals, the third plain win.
const REAL = {
  '2026-10-27': [['Celtics 125, Nets 124', 'A one-point win after overtime.'], ['Devils 5, Stars 1', 'A lopsided four-goal win.'],
    ['Panthers 5, Jets 1', 'Won by a wide margin of four goals.'], ['Sabres 2, Sharks 0', 'A two-goal shutout.']],
  '2026-10-29': [['Dream 80, Valkyries 69', 'An eleven-point win.'], ['Lightning 6, Jets 4', 'Won by two goals.'],
    ['Grizzlies 124, Trail Blazers 103', 'A lopsided twenty-one-point win.'], ['Blues 4, Bruins 1', 'Three goals separated the sides.']],
};
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
  const wanted = REAL[date];
  const ids = wanted.map(([fact]) => idOf(fact));
  ok(() => ids.every(Boolean), `${date}: the four games the old guard confused are citable (${wanted.map(w => w[0]).join('; ')})`);
  const parsed = parseMorningReportLines([`open: ${O}`, `pick: ${ids.join(', ')}`, `close: ${C}`].join('\n'), cit, slate);
  const c = composeMorningReport({ headline: fx.truth.headline, parsed });
  ok(() => parsed.dropped.length === 0 && parsed.picks.length === 4 && wanted.every(([fact, says]) => c.text.includes(`${fact}. ${says}`)),
    `${date}: an answer picking them is kept whole, each score is printed beside its own teams, and each sentence is the one worked out by hand`);
  ok(() => c.text.startsWith(fx.truth.headline) && (c.text.match(/Devils 5, Stars 1|Panthers 5, Jets 1/g) || []).length === (date === '2026-10-27' ? 2 : 0),
    `${date}: the repeated score line is printed once per game cited (a score is never matched across games)`);
  // Every one of the fifteen or sixteen games on the night: its sentence is the oracle's.
  let bad = null;
  const all = parseMorningReportLines(`pick: ${cit.slice(0, 5).map(x => x.id).join(', ')}`, cit, slate);
  composeMorningReport({ headline: null, parsed: all }).games.forEach((g, i) => {
    const row = recap.find(r => r.id === g.gameId);
    const fam = sportFamily(row.sport);
    if (!SPEC[fam]) { if (g.sentence !== null) bad = `${row.sport} has a sentence`; return; }
    const hi = Math.max(row.home_score, row.away_score), lo = Math.min(row.home_score, row.away_score);
    const problem = verifySentence(fam, hi, lo, isOtFlag(row.went_to_ot), g.sentence, 0);
    if (problem && i === 0) bad = problem;
  });
  ok(() => bad === null, `${date}: the first five games of the real slate are each described as the oracle says (${bad})`);
}
{
  const fx = JSON.parse(readFileSync(new URL('./fixtures/morning-report-slate-2026-10-27.json', import.meta.url), 'utf8'));
  const cit = citableGames(selectRecapGames(fx.ctx), { excludeGameId: fx.truth.game_id });
  ok(() => !cit.some(c => c.fact === 'Canadiens 2, Blues 0') && cit.some(c => c.fact === 'Sabres 2, Sharks 0'),
    '2026-10-27: the truth game (Canadiens 2, Blues 0) is out of the list, the other 2-0 is in');
}

console.log(`${n - fails}/${n} assertions pass`);
process.exit(fails ? 1 : 0);
