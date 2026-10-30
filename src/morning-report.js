// Morning Report contract (Phase 5): the model cites games by id; the relay writes every
// team name and every score. docs/CC-CMD-2026-10-30-morning-report-degraded-reason.md,
// Task 3, option 4. Pure functions, no I/O, so scripts/check-morning-report-cite.mjs
// runs THIS code and scripts/mutate-morning-report-cite.mjs can break it.
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
// Here the prose never carries a fact. The model is shown games under short ids (g1, g2, ...)
// WITHOUT their team names, and writes one sentence of commentary for each game it picks.
// The relay prints "Winner 134, Loser 99." from the data in front of that sentence, and
// prints the night's truth headline (already relay-written by Phase 3) at the top. So:
//   - a score cannot be bound to the wrong team: the relay binds it;
//   - a game cannot be invented: an id that is not in the list is dropped;
//   - a name cannot be expanded: the model is never given one, and a line that contains a
//     team or event name from tonight's slate is dropped.
// Nothing in this file looks for a score in prose, and nothing decides whether prose is
// "true". A line that breaks the contract is dropped and counted; the row says which.

export const MR_MAX_PICKS = 5;        // game lines kept; the prompt asks for 3 or 4
export const MR_MAX_LINE_WORDS = 60;  // the prompt asks for 10 to 25
export const MR_MAX_TOKENS = 320;     // the answer is five labelled lines; 250 was sized for one paragraph
const MAX_DROPPED = 12;               // dropped-line records kept on the row

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clean = (s) => (typeof s === 'string' ? s.trim() : '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        const ot = g.went_to_ot ? ', went to overtime' : '';
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

// The games the model may cite, under ids g1, g2, ... in recap order. `excludeGameId` is
// Phase 3's game: its headline is already printed, so citing it again would repeat it.
export function citableGames(recapGames, { excludeGameId = null } = {}) {
    const out = [];
    for (const g of recapGames || []) {
        if (excludeGameId && g.id === excludeGameId) continue;
        const fact = renderFact(g);
        if (!fact) continue;
        out.push({ id: `g${out.length + 1}`, gameId: g.id ?? null, fact, descriptor: renderDescriptor(g) });
    }
    return out;
}

export function buildMorningReportPrompt(date, { stars, truthIs, citable }) {
    const starLine = stars
        ? `${stars.stars}/5 (${stars.totalGames} games, ${stars.dramaGames} drama, ${stars.closeGames} close, ${stars.walkoffs} walkoffs)`
        : 'unrated';
    const truthGloss = TRUTH_GLOSS[truthIs?.type] || 'not available tonight';
    const games = citable.length ? citable.map(c => `${c.id} | ${c.descriptor}`).join('\n') : '(no completed games)';
    const shown = citable.slice(0, 2).map(c => `${c.id}: <one sentence about that game>`).join('\n');
    return (
        `Write FIELD's Morning Report for ${date}. V4 voice: warm, wise, uplifting.\n\n` +
        `HOW THIS WORKS. You write the commentary and nothing else. The relay prints every team name, ` +
        `every player name and every score itself, straight from the data, so none of them can be wrong. ` +
        `Your answer is a short list of labelled lines, and the relay sets each of your sentences next to ` +
        `the game it is about.\n\n` +
        `RULES FOR YOUR SENTENCES\n` +
        `- The reader sees each game's teams and score, printed by the relay just before your sentence. ` +
        `Do not repeat the score, the margin or the total. Say what kind of game it was, in fresh words: ` +
        `a one-score finish, a rout, a level draw, an escape in overtime.\n` +
        `- Never write a team name, a city, a player name or a league name. Say "the winners", "the losers", ` +
        `"hockey" or "basketball".\n` +
        `- Never write a digit. Spell every number out as a word.\n` +
        `- You are told only the sport, the margin, the total and whether it went to overtime. You are not told ` +
        `which side was at home, who scored or how the game unfolded, so never say home, away, visitors, hosts, ` +
        `comeback or late drama, and never describe how a game went: not tense, tight, close throughout, pulling away, ` +
        `trading goals, early, late or until the final buzzer. Do not call a game an exhibition or a classic. ` +
        `Never compare one game with another ("closest", "biggest", "best", "only"). ` +
        `Do not invent streaks, records, injuries, series, players or storylines.\n` +
        `- Vary your wording from line to line. Avoid stock phrases such as "rhythm of", "tapestry", "marvel", ` +
        `"lessons", "hard-fought", "brand new day", "quiet hours", "spark" and "secured".\n` +
        `- Every line is one complete sentence of 10 to 25 words and ends with a full stop.\n\n` +
        `NIGHT STARS: ${starLine}\n` +
        `THE TRUTH IS (the relay prints it above your text; do not repeat it): ${truthGloss}\n\n` +
        `GAMES (id | sport | what happened):\n${games}\n\n` +
        `ANSWER IN EXACTLY THIS FORM, one line each, with nothing before or after. ` +
        `Pick the 3 or 4 games that matter most, most important first.\n` +
        `open: <one sentence of warm wonder about the night's truth>\n` +
        `${shown}\n` +
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

// Why a line of the model's cannot be printed, or null. Order matters only for which reason
// a line with two problems is filed under.
function lineProblem(body, matchers) {
    if (/\p{N}/u.test(body)) return 'digit';
    if (matchers.some(re => re.test(body))) return 'team-name';
    if (body.split(/\s+/).length > MR_MAX_LINE_WORDS) return 'too-long';
    if (!TERMINAL.test(body)) return 'unterminated';   // also what a cut-off answer ends in
    return null;
}

const LINE = /^\s*(open|close|g([0-9]{1,3}))\s*:\s*(\S.*?)\s*$/i;

// The model's answer -> { open, close, picks: [{ entry, angle }], dropped, recognized }.
// Only lines that follow the form and break no rule are kept. A dropped line is recorded by
// key and reason, never by text: the record lands on a publicly served row.
export function parseMorningReportLines(text, citable, slateNames = []) {
    const byId = new Map(citable.map(c => [c.id, c]));
    const matchers = nameMatchers(slateNames);
    const out = { open: null, close: null, picks: [], dropped: [], recognized: 0 };
    const seen = new Set();
    const drop = (key, reason) => { if (out.dropped.length < MAX_DROPPED) out.dropped.push({ key, reason }); };

    for (const raw of String(text || '').split(/\r?\n/)) {
        if (!raw.trim()) continue;
        const m = LINE.exec(raw);
        if (!m) { drop(null, 'unrecognized-line'); continue; }
        out.recognized++;
        const key = m[1].toLowerCase() === 'open' || m[1].toLowerCase() === 'close'
            ? m[1].toLowerCase()
            : `g${Number(m[2])}`;
        const body = m[3];
        const problem = lineProblem(body, matchers);

        if (key === 'open' || key === 'close') {
            if (out[key] !== null) drop(key, `duplicate-${key}`);
            else if (problem) drop(key, problem);
            else out[key] = body;
            continue;
        }
        const entry = byId.get(key);
        if (!entry) drop(key, 'unknown-id');
        else if (seen.has(key)) drop(key, 'duplicate-id');
        else if (problem) drop(key, problem);
        else if (out.picks.length >= MR_MAX_PICKS) drop(key, 'over-limit');
        else { seen.add(key); out.picks.push({ entry, angle: body }); }
    }
    return out;
}

// The paragraph, or null when no game line survived. The headline, every fact and every
// digit in it come from the relay; the model's words are the sentences between them.
export function composeMorningReport({ headline, parsed }) {
    if (!parsed.picks.length) return null;
    const end = (s) => (TERMINAL.test(s) ? s : `${s}.`);
    const parts = [];
    const h = clean(headline);
    if (h) parts.push(end(h));
    if (parsed.open) parts.push(parsed.open);
    for (const p of parsed.picks) parts.push(`${end(p.entry.fact)} ${p.angle}`);
    if (parsed.close) parts.push(parsed.close);
    return { text: parts.join(' '), cited: parsed.picks.map(p => p.entry.gameId).filter(Boolean) };
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
