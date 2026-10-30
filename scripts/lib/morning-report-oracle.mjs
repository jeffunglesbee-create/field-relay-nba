// The oracle for the Morning Report: a second statement of what the relay may print about a game.
//
// Written separately from src/morning-report.js on purpose, and it imports nothing from src/. The sentence
// the relay writes about a game has to be true of the row, and nothing in the module can vouch for itself:
// if the check and the module read the same table, a wrong threshold would agree with itself. So this holds
// its own table of sports, its own thresholds and its own number words, and its own text for every phrasing.
// A sentence is accepted only if it matches the text this file has for the kind THIS FILE says the row is,
// and every number, unit and overtime noun in it is then read back and compared with the row.
//
// Two users: scripts/check-morning-report-cite.mjs (against the module, over grids and random slates) and
// scripts/lib/morning-report-verify.mjs (against a stored morning, row by row). Moved out of the check on
// 2026-10-30 so the second user does not have to read the first one's source, and so a check with a CLI body
// is never imported (see scripts/lib/allowed-tables.cjs for the incident that taught that).
// A second statement of the spec, written out separately from the module on purpose. The sentence
// the relay writes about a game has to be true of the row, and nothing in the module can vouch for
// itself: if both read the same table, a wrong threshold would agree with itself. So this holds
// its own table of sports, its own thresholds and its own number words, and its own text for every
// phrasing; a phrasing is accepted only if it matches the text the oracle has for the kind THE
// ORACLE says the row is, and every number, unit and overtime noun in it is then read back and
// compared with the row.
export const SPEC = {
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
export const SPEC_NONE = ['AFL', 'IPL', 'PGA Tour', 'golf'];
export const REP = { hockey: 'NHL', soccer: 'EPL', basketball: 'NBA', baseball: 'MLB', gridiron: 'NFL' };

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
export function specKind(fam, hi, lo, ot) {
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
export const SPEC_TEXT = {
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
export function verifySentence(fam, hi, lo, ot, sentence, variant) {
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

// ── reading a ROW the way the spec does ───────────────────────────────────────

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// The family a sport label belongs to by the spec's table. 'none' for the labels that take a fact line and
// no sentence, null for a label the spec does not name. Case and surrounding space do not matter.
export function specFamily(label) {
  const l = String(label ?? '').trim().toLowerCase();
  for (const [fam, t] of Object.entries(SPEC)) if (t.labels.some((x) => x.toLowerCase() === l)) return fam;
  return SPEC_NONE.some((x) => x.toLowerCase() === l) ? 'none' : null;
}

// What the spec says about a ROW's result: its family, the high and low score, whether the row says play
// went past regulation (1 or true, nothing else), and the kind. null when the spec writes no sentence for
// the row: no two-sided score, a score that is not a whole number or is negative, a sport that takes a fact
// line only, or a sport the spec does not name.
export function specRow(row) {
  if (!row || !finite(row.home_score) || !finite(row.away_score)) return null;
  const fam = specFamily(row.sport);
  if (!fam || fam === 'none') return null;
  const hi = Math.max(row.home_score, row.away_score), lo = Math.min(row.home_score, row.away_score);
  if (!Number.isInteger(hi) || !Number.isInteger(lo) || lo < 0) return null;
  const ot = row.went_to_ot === 1 || row.went_to_ot === true;
  return { fam, hi, lo, ot, kind: specKind(fam, hi, lo, ot) };
}

const TERMINAL = /[.!?…]["'”’)]*$/;
const trimmed = (s) => (typeof s === 'string' ? s.trim() : '');

// The fact line the spec prints for a row, with its closing full stop. A two-sided score is "Winner n,
// Loser n." (the away side first on a tie); a row with no two-sided score is an event update, "Event
// (round): note"; a row with neither is null.
export function specFact(row) {
  if (!row) return null;
  const home = trimmed(row.home), away = trimmed(row.away);
  let fact;
  if (finite(row.home_score) && finite(row.away_score)) {
    if (!home || !away) return null;
    fact = row.home_score > row.away_score ? `${home} ${row.home_score}, ${away} ${row.away_score}` : `${away} ${row.away_score}, ${home} ${row.home_score}`;
  } else {
    const note = trimmed(row.note);
    if (!note) return null;
    const label = home ? (away ? `${home} (${away})` : home) : '';
    fact = label ? `${label}: ${note}` : note;
  }
  return TERMINAL.test(fact) ? fact : `${fact}.`;
}
