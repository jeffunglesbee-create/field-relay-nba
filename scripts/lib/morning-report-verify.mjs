// Checks a stored Morning Report against the games it was written from.
//
// The relay writes everything about a game in the report: the score line from the row and one sentence about
// the result (src/morning-report.js). The model writes only the open and close lines. So a stored morning can
// be checked game by game against the day's rows, by the oracle in scripts/lib/morning-report-oracle.mjs, with
// no judgement of prose: for each game the report cites, the text must hold exactly the fact line and exactly
// the sentence the spec has for that row, and the lines left over (before the first game, after the last) must
// be the headline, an open line and a close line that follow the form.
//
// Pure: it takes the row's value, its brief_text, the day's rows and the headline, and returns the findings.
// scripts/verify-morning-report.mjs is the command that fetches them.
//
// A difference is not always a defect in the relay: a row finalised after the 09:00Z cron (went_to_ot filled in
// later, a score corrected) differs from the one the cron read. The findings say which game and which text, so
// the row's finalized_at can be read next to them.
import { SPEC_TEXT, specRow, specFact, verifySentence } from './morning-report-oracle.mjs';

const TERMINAL = /[.!?…]["'”’)]*$/;
const MAX_LINE_WORDS = 60;
const words = (s) => s.split(/\s+/).filter(Boolean).length;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Why an open or close line is outside the form, or null.
function lineFault(label, text, slateNames) {
  if (/\p{N}/u.test(text)) return `${label} line has a digit: "${text}"`;
  const name = slateNames.find((n) => new RegExp(`(?<![A-Za-z])${escapeRe(n)}(?![A-Za-z])`).test(text));
  if (name) return `${label} line names "${name}", which is on the night's slate: "${text}"`;
  if (words(text) > MAX_LINE_WORDS) return `${label} line is ${words(text)} words, over ${MAX_LINE_WORDS}`;
  if (!TERMINAL.test(text)) return `${label} line has no closing full stop: "${text}"`;
  return null;
}

/**
 * @param {object}   a
 * @param {object}   a.value      the morning_report row's value
 * @param {string}   a.briefText  the row's brief_text
 * @param {object[]} a.rows       the day's games (context games.regular and games.postseason)
 * @param {?string}  a.headline   Phase 3's headline (truth_is value.headline), printed first
 * @param {string[]} a.slateNames team and event names an open or close line must not carry
 * @returns {{status: 'verified'|'defects'|'not-composed', reason?: string, problems: string[],
 *            picks: {id: string, fact: ?string, sentence: ?string, kind: ?string, phrasing: ?number}[],
 *            open: ?string, close: ?string}}
 */
export function verifyMorning({ value, briefText, rows, headline = null, slateNames = [] }) {
  const v = value && typeof value === 'object' ? value : {};
  const none = { problems: [], picks: [], open: null, close: null };
  if (v.degraded === true) return { status: 'not-composed', reason: `degraded: ${v.degraded_reason ?? 'no reason recorded'}`, ...none };
  if (v.degraded === false && v.no_games === true) return { status: 'not-composed', reason: 'no_games: no completed game to cite', ...none };
  if (v.degraded !== false || !Array.isArray(v.cited) || v.cited.length === 0) {
    return { status: 'not-composed', reason: 'the row does not record a composed morning (it needs degraded:false and a cited list)', ...none };
  }

  const problems = [];
  const text = String(briefText ?? '');
  const byId = new Map((rows || []).map((g) => [g.id, g]));

  // What the spec says each cited game prints, in the order the row cites them. The phrasing a sentence takes
  // depends on how many games of its kind came before it in the report, so it is counted for every cited game,
  // found in the text or not.
  const used = {};
  const plan = [];
  const seen = new Set();
  for (const id of v.cited) {
    if (seen.has(id)) { problems.push(`${id}: cited twice`); continue; }
    seen.add(id);
    const row = byId.get(id);
    if (!row) { problems.push(`${id}: cited, but there is no such game in the day's rows`); continue; }
    const fact = specFact(row);
    if (fact === null) { problems.push(`${id}: the row has nothing the spec prints as a fact line`); continue; }
    const sr = specRow(row);
    const phrasing = sr ? (used[sr.kind] = (used[sr.kind] ?? -1) + 1) : null;
    plan.push({ id, row, fact, sr, phrasing });
  }

  // Find each fact line, in order.
  let cursor = 0;
  for (const p of plan) {
    const at = text.indexOf(p.fact, cursor);
    if (at < 0) { problems.push(`${p.id}: its fact line "${p.fact}" is not in the text after the previous game`); p.at = null; continue; }
    p.at = at;
    p.end = at + p.fact.length;
    cursor = p.end;
  }
  const found = plan.filter((p) => p.at !== null);

  // Before the first game: the headline, then the open line.
  const first = found[0];
  const before = first ? text.slice(0, first.at) : text;
  const wantHead = typeof headline === 'string' && headline.trim() ? (TERMINAL.test(headline.trim()) ? headline.trim() : `${headline.trim()}.`) : null;
  let open = before;
  if (wantHead) {
    if (!before.startsWith(wantHead)) problems.push(`the text does not begin with Phase 3's headline "${wantHead}"`);
    else open = before.slice(wantHead.length);
  }
  if (before && !before.endsWith(' ')) problems.push('the text before the first game does not end with a space');
  open = open.trim() || null;
  if (open) { const f = lineFault('open', open, slateNames); if (f) problems.push(f); }

  // Each game's sentence, and what follows the last one.
  const picks = [];
  let close = null;
  found.forEach((p, i) => {
    const next = found[i + 1];
    const rec = { id: p.id, fact: p.fact, sentence: null, kind: p.sr?.kind ?? null, phrasing: p.phrasing };
    picks.push(rec);
    if (next) {
      const region = text.slice(p.end, next.at);
      if (!/^ \S.* $|^ $/.test(region)) { problems.push(`${p.id}: the text between "${p.fact}" and the next game's fact line is not set off by single spaces: "${region}"`); return; }
      const between = region.trim();
      if (!p.sr) {
        if (between) problems.push(`${p.id} ${p.fact} the spec writes no sentence for this row, but "${between}" follows it`);
        return;
      }
      rec.sentence = between;
      if (!between) { problems.push(`${p.id} ${p.fact} no sentence follows it; the spec has: ${SPEC_TEXT[p.sr.kind][p.phrasing % 3]}`); return; }
      const why = verifySentence(p.sr.fam, p.sr.hi, p.sr.lo, p.sr.ot, between, p.phrasing);
      if (why) problems.push(`${p.id} ${p.fact} ${why}`);
      return;
    }
    // The last game: the text after it is its sentence (when the spec has one) and then the close line.
    const tail = text.slice(p.end);
    if (!p.sr) { close = tail.trim() || null; return; }
    if (!tail.startsWith(' ')) { problems.push(`${p.id} ${p.fact} no sentence follows it; the spec has: ${SPEC_TEXT[p.sr.kind][p.phrasing % 3]}`); return; }
    const rest = tail.slice(1);
    let sentence = null;
    for (let k = 0; k < rest.length; k++) {
      if (rest[k] === '.' && (k + 1 === rest.length || rest[k + 1] === ' ')) {
        const cand = rest.slice(0, k + 1);
        if (verifySentence(p.sr.fam, p.sr.hi, p.sr.lo, p.sr.ot, cand, p.phrasing) === null) { sentence = cand; close = rest.slice(k + 1).trim() || null; break; }
      }
    }
    if (sentence === null) {
      problems.push(`${p.id} ${p.fact} the text after it does not begin with the spec's sentence (${p.sr.kind}, phrasing ${p.phrasing % 3}: ${SPEC_TEXT[p.sr.kind][p.phrasing % 3]}): "${rest.slice(0, 90)}"`);
      close = null;
    } else rec.sentence = sentence;
  });
  if (close) { const f = lineFault('close', close, slateNames); if (f) problems.push(f); }

  if (typeof v.word_count === 'number' && v.word_count !== words(text)) problems.push(`value.word_count is ${v.word_count}, the text has ${words(text)} words`);

  return { status: problems.length ? 'defects' : 'verified', problems, picks, open, close };
}
