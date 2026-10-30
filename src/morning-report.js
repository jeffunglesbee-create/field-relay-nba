// Morning Report contract (Phase 5): the model chooses and frames; the relay writes every fact.
// docs/CC-CMD-2026-10-30-morning-report-degraded-reason.md, Task 3 (option 4) and Task 4.
// Pure functions, no I/O, so scripts/check-morning-report-cite.mjs runs THIS code and
// scripts/mutate-morning-report-cite.mjs can break it.
//
// WHY. Three real incidents put a team-name guard on the model's prose:
//   2026-07-02  a score was read against the wrong team ("Congo DR at England 2-1");
//   2026-07-03  a game was invented for a sport with no data (an AFL result);
//   2026-07-15  a bare mascot was expanded into the wrong team ("Fire" became "Chicago Fire").
// The guard that grew from them judged the model's prose by finding scores and names in it.
// On 2026-10-30 a replay showed it throwing away accurate prose on 2 of 4 days, because it
// found "5-1" inside "125-124" (outbox/morning-report-guard-replay-latest.json). A check that
// reads prose can be wrong in both directions, and 53 of the 107 mornings since the guard
// landed were the template.
//
// Task 3 took names and scores out of the model's hands. Three replays of the production
// model on the same 11 days then showed the sentence it still wrote about each game moving
// from side claims, to how the game went, to a false overtime (11 observations cannot show a
// rate has reached zero). Task 4 takes that sentence too.
//
// WHAT THE MODEL DOES. It is shown the night's games under short ids (g1, g2, ...) WITHOUT
// their team names, and answers three lines: `pick:` the ids of the games to feature, `open:`
// one sentence to begin and `close:` one sentence to end. Nothing else it writes is printed.
// WHAT THE RELAY DOES. It prints Phase 3's headline, then for each picked game the line
// "Winner 134, Loser 99." and one sentence about the result, chosen from a small set of fixed
// phrasings by resultShape / resultSentence below, from the row the score came from:
//   - how many goals, points or runs separated the sides;
//   - "after overtime" ONLY when the row says the game went to overtime;
//   - "finished level" when the scores are equal;
//   - "shutout" / "to nothing" when the losers scored none.
// So:
//   - a score cannot be bound to the wrong team: the relay binds it;
//   - a game cannot be invented: an id that is not in the list is dropped;
//   - a name cannot be expanded: the model is never given one, and its open or close line is
//     dropped if it contains a team or event name from tonight's slate;
//   - a sentence about a game cannot be false: no byte of the model's reaches a game line, and
//     each phrase is defined by the numbers it is written from.
// Left to the model, and not checked for truth: the open and close lines, held only to the form
// rules (no digit, no slate name, at most 60 words, a full stop). Nothing in this file looks for
// a score in prose, and nothing decides whether prose is "true". A line that breaks the form is
// dropped and counted; the row says which.

export const MR_MAX_PICKS = 5;        // games printed; the prompt asks for 3 or 4
export const MR_MAX_LINE_WORDS = 60;  // the prompt asks for 10 to 25
export const MR_MAX_TOKENS = 320;     // the answer is three labelled lines
const MAX_DROPPED = 12;               // dropped-line records kept on the row

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clean = (s) => (typeof s === 'string' ? s.trim() : '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const TERMINAL = /[.!?…]["'”’)]*$/;

// What the model is told about Phase 3's finding. Words only: the headline itself carries
// names and a score, so it is printed by the relay and never shown to the model.
const TRUTH_GLOSS = {
    upset: 'a big underdog won',
    blowout: 'one side won by a very wide margin',
    rare_event: 'something rare happened, such as a shutout, a hat trick, a walk-off or a no-hitter',
    convergence: 'several unusual results landed on the same night',
    none: 'nothing unusual happened; it was a quiet night',
};

// ── sport families: which games the relay can write a sentence for ──────────
// Keyed by the archive's own sport label (compared lower-cased: the games tables carry both
// 'WNBA' and 'wnba'). src/index.js ARCHIVE_SPORT_LABELS declares every label the tables may
// hold, and scripts/check-morning-report-cite.mjs fails when a declared label is in neither
// list below, so a new sport cannot arrive with no decision made about it.
//
// `unit` is what is scored; `over` is what the sport calls play past regulation (the phrase
// is printed only when the row says the game went there); `narrow` and `wide` are the margins
// (in `unit`s) at or under / at or over which a result is called narrow / lopsided. The
// thresholds are wording, never a fact: every class word is defined by its threshold, and a
// different threshold changes which phrase a row gets, not what any phrase claims. Calibrated
// on the 901 completed games with two named teams in the 22 saved days 2026-10-08..29 (margin,
// 10th to 90th percentile: hockey 1-4 goals, soccer 0-3, NBA/WNBA 2-27 points, MLB 1-4 runs,
// NFL/CFB/CFL 3-31 points). Share of games called narrow / lopsided on that data: hockey 19% /
// 14%, basketball 9% / 22%, football 23% / 21%, soccer 23% / 9%; the rest are plain wins,
// shutouts, overtime wins and level results.
const FAMILIES = {
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
// Declared labels the relay writes no sentence for, and why. Their games are still printed
// (names and score), with no sentence after them.
//   AFL        scores are points but made of goals and behinds; no thresholds were measured.
//   IPL        a cricket result is runs against wickets, not a margin in one unit.
//   PGA Tour   a golf row is a to-par score (negative) or an event update, not a two-sided score.
//   golf       same.
export const NO_SENTENCE_LABELS = ['AFL', 'IPL', 'PGA Tour', 'golf'];

const FAMILY_OF = new Map(Object.entries(FAMILIES).flatMap(([f, d]) => d.labels.map(l => [l.toLowerCase(), f])));
const NO_SENTENCE = new Set(NO_SENTENCE_LABELS.map(l => l.toLowerCase()));

// The family a label belongs to, 'none' for a label the relay deliberately writes no sentence
// for, and null for a label it has made no decision about.
export function sportFamily(label) {
    const k = clean(label).toLowerCase();
    if (FAMILY_OF.has(k)) return FAMILY_OF.get(k);
    return NO_SENTENCE.has(k) ? 'none' : null;
}

// Only a 1 (or true) is the row saying the game went past regulation. 0 means it did not, and
// null means ESPN's period was unknown (computeWentToOT returns null for every league but NBA,
// NHL, MLB, WNBA, EPL, MLS and the World Cup). Neither 0 nor null says anything about overtime.
const wentToOt = (g) => g.went_to_ot === 1 || g.went_to_ot === true;

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function numberWord(n) {
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
    return String(n);
}

// What the row says about the result, as a kind and the numbers its phrases are written from;
// null when the relay writes no sentence for this row (an event update, a sport it has no
// phrasing for, or a score that is not a plain count: fractional or below zero).
//   scoreless  0-0
//   level-ot   level, and the row says it went past regulation
//   level      level
//   win-ot     decided, and the row says it went past regulation
//   shutout    decided, and the losers scored none
//   wide       decided by `wide` or more
//   narrow     decided by `narrow` or less
//   win        decided
// The first line that fits wins, so a shutout that went to overtime is a win-ot.
export function resultShape(g) {
    const family = sportFamily(g.sport);
    const fam = family && Object.hasOwn(FAMILIES, family) ? FAMILIES[family] : null;
    if (!fam || !isNum(g.home_score) || !isNum(g.away_score)) return null;
    const hi = Math.max(g.home_score, g.away_score);
    const lo = Math.min(g.home_score, g.away_score);
    if (!Number.isInteger(hi) || !Number.isInteger(lo) || lo < 0) return null;
    const margin = hi - lo;
    const ot = wentToOt(g);
    const kind = margin === 0
        ? (hi === 0 ? 'scoreless' : ot ? 'level-ot' : 'level')
        : ot ? 'win-ot'
        : lo === 0 ? 'shutout'
        : margin >= fam.wide ? 'wide'
        : margin <= fam.narrow ? 'narrow'
        : 'win';
    return { kind, n: margin, unit: fam.unit, over: fam.over };
}

// Three phrasings per kind. Every one is true of every row of its kind, from the numbers in
// the shape alone; they differ so that a report with two narrow wins does not say the same
// thing twice. composeMorningReport hands out the next unused phrasing of a kind.
const FRAMES = {
    'scoreless': [
        () => 'Neither side scored.',
        () => 'A scoreless finish.',
        () => 'Not a score on the board for either side.'],
    'level-ot': [
        (s) => `Level after ${s.over}.`,
        (s) => `${cap(s.over)} could not separate the sides.`,
        (s) => `All square after ${s.over}.`],
    'level': [
        () => 'Finished level.',
        () => 'All square at the end.',
        () => 'Neither side finished ahead.'],
    'win-ot': [
        (s) => `${s.A} ${s.w}-${s.unit} win after ${s.over}.`,
        (s) => `Won by ${s.w} ${s.units} after ${s.over}.`,
        (s) => `It went to ${s.over}, and ${s.w} ${s.units} separated the sides.`],
    'shutout': [
        (s) => `${s.A} ${s.w}-${s.unit} shutout.`,
        () => 'The losing side was held scoreless.',
        (s) => `${cap(s.w)} ${s.units} to nothing.`],
    'wide': [
        (s) => `A lopsided ${s.w}-${s.unit} win.`,
        (s) => `Won by a wide margin of ${s.w} ${s.units}.`,
        (s) => `${cap(s.w)} ${s.units} clear at the end.`],
    'narrow': [
        (s) => `A narrow ${s.w}-${s.unit} win.`,
        (s) => `Won narrowly, by ${s.w} ${s.units}.`,
        (s) => `Just ${s.w} ${s.units} between the sides at the end.`],
    'win': [
        (s) => `${s.A} ${s.w}-${s.unit} win.`,
        (s) => `Won by ${s.w} ${s.units}.`,
        (s) => `${cap(s.w)} ${s.units} separated the sides.`],
};

// The sentence for a shape. `variant` picks the phrasing (0, 1, 2, then round again).
export function resultSentence(shape, variant = 0) {
    // Own properties only: a kind of "toString" is not a phrasing.
    const frames = shape && Object.hasOwn(FRAMES, shape.kind) ? FRAMES[shape.kind] : null;
    if (!frames) return null;
    const i = Number.isFinite(variant) ? Math.trunc(variant) : 0;
    const v = ((i % frames.length) + frames.length) % frames.length;
    const w = numberWord(shape.n);
    return frames[v]({
        w,
        A: /^e/.test(w) ? 'An' : 'A',   // an eight-, eleven-, eighteen- or eighty-... but a one-
        unit: shape.unit,
        units: shape.n === 1 ? shape.unit : `${shape.unit}s`,
        over: shape.over,
    });
}

// The fact the relay prints for one game: names and scores from the row and nothing else.
// null when the row cannot be rendered (a scored row missing a team name, or no score and
// no note).
function renderFact(g) {
    const home = clean(g.home);
    const away = clean(g.away);
    if (isNum(g.home_score) && isNum(g.away_score)) {
        if (!home || !away) return null;
        // Winner first. A tie is not a win for either side, so it falls to the second branch: away first.
        return g.home_score > g.away_score
            ? `${home} ${g.home_score}, ${away} ${g.away_score}`
            : `${away} ${g.away_score}, ${home} ${g.home_score}`;
    }
    // A row with a note and no two-sided score is an event update. Golf is the only sport
    // seen (2026-10-08..29): home is the event, away the round, the note the leader.
    const note = clean(g.note);
    if (!note) return null;
    const label = home ? (away ? `${home} (${away})` : home) : '';
    return label ? `${label}: ${note}` : note;
}

// What the model is told about the same game: the sport and the shape of the result, with
// no team names. The scores are digits in the PROMPT only; a digit in the model's answer
// drops that line.
function renderDescriptor(g) {
    const sport = clean(g.sport) || 'game';
    if (isNum(g.home_score) && isNum(g.away_score)) {
        const hi = Math.max(g.home_score, g.away_score);
        const lo = Math.min(g.home_score, g.away_score);
        const ot = wentToOt(g) ? ', went to overtime' : '';
        return hi === lo
            ? `${sport} | ended level ${hi}-${lo}, total ${hi + lo}${ot}`
            : `${sport} | final ${hi}-${lo}, margin ${hi - lo}, total ${hi + lo}${ot}`;
    }
    return `${sport} | event update, no score`;
}

// The recap: the first sixteen games that have a score or a note, regular season then
// postseason. (Moved here from analytics-engine.js unchanged, 2026-10-30.) Keep the prompt
// short: a model given more tends to list them all.
export function selectRecapGames(ctx) {
    const games = ctx
        ? [...(ctx.games?.regular || []), ...(ctx.games?.postseason || [])]
        : [];
    return games
        .filter(g => g.note || (typeof g.home_score === 'number' && typeof g.away_score === 'number'))
        .slice(0, 16);
}

// The games the model may pick, under ids g1, g2, ... in recap order. `excludeGameId` is
// Phase 3's game: its headline is already printed, so picking it again would repeat it.
// `shape` is what the relay's sentence is written from (null: no sentence for this row).
export function citableGames(recapGames, { excludeGameId = null } = {}) {
    const out = [];
    for (const g of recapGames || []) {
        if (excludeGameId && g.id === excludeGameId) continue;
        const fact = renderFact(g);
        if (!fact) continue;
        out.push({ id: `g${out.length + 1}`, gameId: g.id ?? null, fact, descriptor: renderDescriptor(g), shape: resultShape(g) });
    }
    return out;
}

export function buildMorningReportPrompt(date, { stars, truthIs, citable }) {
    const starLine = stars
        ? `${stars.stars}/5 (${stars.totalGames} games, ${stars.dramaGames} drama, ${stars.closeGames} close, ${stars.walkoffs} walkoffs)`
        : 'unrated';
    const truthGloss = TRUTH_GLOSS[truthIs?.type] || 'not available tonight';
    const games = citable.length ? citable.map(c => `${c.id} | ${c.descriptor}`).join('\n') : '(no completed games)';
    return (
        `Write FIELD's Morning Report for ${date}. V4 voice: warm, wise, uplifting.\n\n` +
        `HOW THIS WORKS. You choose and you frame; the relay writes every fact. It prints each game you pick ` +
        `(both teams, the score and one line about the result) straight from the data, so none of it can be wrong. ` +
        `Your answer is three labelled lines: which games to feature, one sentence to open the report and one ` +
        `sentence to close it.\n\n` +
        `RULES FOR YOUR TWO SENTENCES\n` +
        `- Never write a team name, a city, a player name or a league name.\n` +
        `- Never write a digit. Spell every number out as a word.\n` +
        `- Do not name, number, rank or describe any single game, and do not say how any game went: the relay ` +
        `prints what is known about each game right after you pick it. You are told only the sports and the final ` +
        `results, so say nothing about home or away sides, comebacks, late drama, streaks, records, injuries, ` +
        `series or players, and nothing about whether a result was expected or a surprise, except what THE TRUTH IS ` +
        `says below.\n` +
        `- Speak of the night as a whole, in your own words.\n` +
        `- Vary your wording. Avoid stock phrases such as "rhythm of", "tapestry", "marvel", "lessons", ` +
        `"hard-fought", "brand new day", "quiet hours", "spark" and "secured".\n` +
        `- Each sentence is 10 to 25 words and ends with a full stop.\n\n` +
        `NIGHT STARS: ${starLine}\n` +
        `THE TRUTH IS (the relay prints it above your text; do not repeat it): ${truthGloss}\n\n` +
        `GAMES (id | sport | what happened):\n${games}\n\n` +
        `ANSWER IN EXACTLY THIS FORM, three lines, with nothing before or after.\n` +
        `pick: <the ids of the 3 or 4 games that matter most, most important first, separated by commas>\n` +
        `open: <one sentence of warm wonder about the night's truth>\n` +
        `close: <one sentence of quiet anticipation for tomorrow; name no game and no team>`
    );
}

// Every team and event name the relay knows for the night, not just the recap's sixteen.
export function slateNamesOf(ctx) {
    const games = ctx ? [...(ctx.games?.regular || []), ...(ctx.games?.postseason || [])] : [];
    return [...new Set(games.flatMap(g => [g.home, g.away]).map(clean).filter(n => n.length >= 3))];
}

// Case-sensitive, whole-word: "Fire" matches "Chicago Fire" and not "fire" or "Firefly".
const nameMatchers = (names) =>
    (names || []).map(n => new RegExp(`(?<![A-Za-z])${escapeRe(n)}(?![A-Za-z])`));

// Why an open or close line of the model's cannot be printed, or null. Order matters only
// for which reason a line with two problems is filed under.
function lineProblem(body, matchers) {
    if (/\p{N}/u.test(body)) return 'digit';
    if (matchers.some(re => re.test(body))) return 'team-name';
    if (body.split(/\s+/).length > MR_MAX_LINE_WORDS) return 'too-long';
    if (!TERMINAL.test(body)) return 'unterminated';   // also what a cut-off answer ends in
    return null;
}

const LINE = /^\s*(open|close|picks?)\s*:\s*(\S.*?)\s*$/i;
const GAME_ID = /^g([0-9]{1,3})$/i;

// The model's answer -> { open, close, picks: [{ entry }], dropped, recognized }.
// Only what follows the form and breaks no rule is kept. The open and close lines are text, so
// they are held to the rules; the pick line is read as a list of ids and nothing else: a token
// that is not a known id is dropped, so no word of the model's can reach a game line through
// it. A drop is recorded by key and reason, never by text: the record lands on a publicly
// served row.
export function parseMorningReportLines(text, citable, slateNames = []) {
    const byId = new Map(citable.map(c => [c.id, c]));
    const matchers = nameMatchers(slateNames);
    const out = { open: null, close: null, picks: [], dropped: [], recognized: 0 };
    const seen = new Set();
    let sawPick = false;
    const drop = (key, reason) => { if (out.dropped.length < MAX_DROPPED) out.dropped.push({ key, reason }); };

    for (const raw of String(text || '').split(/\r?\n/)) {
        if (!raw.trim()) continue;
        const m = LINE.exec(raw);
        if (!m) { drop(null, 'unrecognized-line'); continue; }
        out.recognized++;
        const word = m[1].toLowerCase();
        const body = m[2];

        if (word === 'open' || word === 'close') {
            const problem = lineProblem(body, matchers);
            if (out[word] !== null) drop(word, `duplicate-${word}`);
            else if (problem) drop(word, problem);
            else out[word] = body;
            continue;
        }
        if (sawPick) { drop('pick', 'duplicate-pick'); continue; }
        sawPick = true;
        let stray = false;
        for (const token of body.replace(/\.+$/, '').split(/[\s,;]+/).filter(Boolean)) {
            const t = GAME_ID.exec(token);
            if (!t) { stray = true; continue; }
            const key = `g${Number(t[1])}`;
            const entry = byId.get(key);
            if (!entry) drop(key, 'unknown-id');
            else if (seen.has(key)) drop(key, 'duplicate-id');
            else if (out.picks.length >= MR_MAX_PICKS) drop(key, 'over-limit');
            else { seen.add(key); out.picks.push({ entry }); }
        }
        if (stray) drop('pick', 'unrecognized-pick');
    }
    return out;
}

// The paragraph, or null when no game was picked. The headline, every fact, every sentence
// about a game and every digit in it come from the relay; the model's words are the open and
// close lines. `games` lists what was printed for each pick.
export function composeMorningReport({ headline, parsed }) {
    if (!parsed.picks.length) return null;
    const end = (s) => (TERMINAL.test(s) ? s : `${s}.`);
    const parts = [];
    const h = clean(headline);
    if (h) parts.push(end(h));
    if (parsed.open) parts.push(parsed.open);
    const used = {};
    const games = [];
    for (const p of parsed.picks) {
        const shape = p.entry.shape;
        const sentence = shape ? resultSentence(shape, used[shape.kind] = (used[shape.kind] ?? -1) + 1) : null;
        const fact = end(p.entry.fact);
        games.push({ id: p.entry.id, gameId: p.entry.gameId, fact, sentence });
        parts.push(sentence ? `${fact} ${sentence}` : fact);
    }
    if (parsed.close) parts.push(parsed.close);
    return { text: parts.join(' '), cited: parsed.picks.map(p => p.entry.gameId).filter(Boolean), games };
}

// Everything Phase 5 does before and after the one model call, as two pure functions, so
// the replay probe (scripts/probe-morning-report-cite-replay.mjs) runs the same code the
// cron does and not a copy of it.
export function prepareMorningReport(date, { stars, truthIs, ctx }) {
    const recapGames = selectRecapGames(ctx);
    const citable = citableGames(recapGames, { excludeGameId: truthIs?.game_id });
    return {
        recapGames,
        citable,
        slateNames: slateNamesOf(ctx),
        prompt: buildMorningReportPrompt(date, { stars, truthIs, citable }),
    };
}

export function finishMorningReport(text, prepared, truthIs) {
    const parsed = parseMorningReportLines(text, prepared.citable, prepared.slateNames);
    return { parsed, composed: composeMorningReport({ headline: truthIs?.headline, parsed }) };
}
