// src/fpl-events.js
// Ground EPL briefs in what actually happened, and in the table.
//
// CC-CMD-2026-08-21-fpl-event-grounding-epl, plus defect 2 of
// CC-CMD-2026-08-22-brief-sport-contamination (the "0-0-0 stalemate" line).
// One module because they are one prompt block: an EPL brief needs the events
// when there are events, and the TABLE — not a won-drawn-lost record — when it
// falls back to season context.
//
// Everything here is read from the real payload, probed 2026-08-23 and recorded
// in outbox/fpl-event-shape-2026-08-23T03-29-*.json. Three findings shaped it:
//
//   1. /fpl/event/{gw}/live/ returns EVERY player — 604 elements, 186 with
//      minutes, 418 with none. Naming scorers is a filter, not a lookup.
//   2. Per-fixture stats live in `explain[]`, not in the top-level `stats`.
//      `stats` is the gameweek TOTAL, so in a double gameweek it over-attributes
//      to whichever match you are writing about. Everything below reads explain.
//   3. There is NO minute-of-goal anywhere in this feed. Not in `stats`, not in
//      `explain`, not in `fixtures[].stats`. The CC-CMD's own example sentence,
//      "Saka scored in the 34th", is NOT obtainable here and nothing in this
//      module will produce it. Goalscorers, assists, cards, saves and clean
//      sheets are obtainable; the minute is not, and inventing one would be a
//      Rule 1 violation dressed as a feature.

export const FPL_BASE = 'https://fantasy.premierleague.com/api';
const FPL_HEADERS = {
    'Accept': 'application/json',
    'User-Agent': 'FIELD-Global-Sports-Intelligence/1.0 (jeffunglesbee-create/jubilant-bassoon)',
};
const TTL_BOOTSTRAP = 3600;
const TTL_LIVE = 30;

// ── The bridge ──────────────────────────────────────────────────────────────
// FPL and ESPN share no numeric id, so the join is name-to-name. This map was
// DERIVED, not written from memory: the probe read every EPL team name from
// /context/date on 2026-08-22 and diffed it against bootstrap-static's team
// list. Five matched verbatim (Everton, Sunderland, Leeds, Brentford, Spurs)
// and these five did not.
//
// Guessing team names is the golf incident's failure mode with no compiler to
// catch it, so unresolved names are reported rather than approximated. There is
// deliberately NO fuzzy matcher: Rule 76 caps fallback chains, and a
// normaliser is exactly where two clubs quietly become one.
export const EPL_ALIASES = {
    'Hull':         'Hull City',
    'Man United':   'Man Utd',
    'C Palace':     'Crystal Palace',
    'Ipswich':      'Ipswich Town',
    'Nottm Forest': "Nott'm Forest",
};

/// ESPN name -> FPL team record, or null. Null is a real answer: it means this
/// club has not been observed yet and the map needs a line, which the caller
/// reports rather than papering over.
export function resolveFplTeam(espnName, teamsByName) {
    if (!espnName) return null;
    const raw = String(espnName).trim();
    return teamsByName.get(raw) || teamsByName.get(EPL_ALIASES[raw] || '') || null;
}

// ── Per-fixture events ──────────────────────────────────────────────────────
/// Pull one stat for one player in ONE fixture out of `explain`.
const explained = (el, fixtureId, identifier) => {
    for (const block of el.explain || []) {
        if (block.fixture !== fixtureId) continue;
        for (const s of block.stats || []) if (s.identifier === identifier) return s.value || 0;
    }
    return 0;
};

/// Everything nameable that happened in one fixture.
export function matchEvents(fixtureId, liveElements, elementsById) {
    const nameOf = id => elementsById.get(id)?.web_name || null;
    const collect = (identifier) => liveElements
        .map(el => ({ name: nameOf(el.id), n: explained(el, fixtureId, identifier) }))
        .filter(x => x.name && x.n > 0)
        .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    return {
        goals:   collect('goals_scored'),
        assists: collect('assists'),
        reds:    collect('red_cards'),
        yellows: collect('yellow_cards'),
        saves:   collect('saves').filter(x => x.n >= 4),
        ownGoals: collect('own_goals'),
    };
}

// ── Table context (defect 2) ────────────────────────────────────────────────
/// What a European league table actually says about a side. bootstrap-static's
/// team records carry position/points/played/form directly, so this needs no
/// second source.
///
/// A won-drawn-lost record is NOT used as the headline. On an opening weekend
/// every side is 0-0-0, which is how a live 3-0 came to be described as a
/// "0-0-0 stalemate" — the stat was both wrong for the competition and vacuous
/// for the date. Position and points separate sides from the first matchday.
export function tableLine(team) {
    if (!team) return null;
    const pos = team.position, pts = team.points, pl = team.played;
    if (pos == null || pts == null) return null;
    // 11th/12th/13th are the whole reason this is not `['th','st','nd','rd'][n%10]`.
    const ord = n => {
        const teens = n % 100;
        if (teens >= 11 && teens <= 13) return `${n}th`;
        return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
    };
    return pl === 0
        ? `${team.name}: ${ord(pos)} in the table, no matches played yet`
        : `${team.name}: ${ord(pos)} in the table, ${pts} point${pts === 1 ? '' : 's'} from ${pl} match${pl === 1 ? '' : 'es'}`;
}

// ── The prompt block ────────────────────────────────────────────────────────
/// Prose-ready lines, or null when there is nothing grounded to say. Null is
/// the honest output for a fixture with no events and no table — the caller
/// omits the block rather than emitting an empty heading for the model to fill.
export function buildFplBlock({ events, homeTable, awayTable, fixtureFinished }) {
    const lines = [];
    const list = xs => xs.map(x => x.n > 1 ? `${x.name} (${x.n})` : x.name).join(', ');
    if (events) {
        if (events.goals.length)    lines.push(`[EPL GOALSCORERS] ${list(events.goals)}`);
        if (events.ownGoals.length) lines.push(`[EPL OWN GOALS] ${list(events.ownGoals)}`);
        if (events.assists.length)  lines.push(`[EPL ASSISTS] ${list(events.assists)}`);
        if (events.reds.length)     lines.push(`[EPL RED CARDS] ${list(events.reds)}`);
        if (events.saves.length)    lines.push(`[EPL GOALKEEPER SAVES] ${list(events.saves)}`);
    }
    const table = [homeTable, awayTable].filter(Boolean);
    if (table.length) lines.push(`[EPL TABLE] ${table.join(' | ')}`);
    if (!lines.length) return null;
    // The model is told what it does NOT have, because the alternative is that
    // it supplies a minute itself. This feed carries no timestamps at all.
    // Two absences, both stated. The minute one was designed in; the SCORE one
    // was found by running the verification early, 2026-08-23:
    //
    //   "Hull City and Manchester United opened their accounts with a 2-1 result
    //    that leaves both sides hunting for their first points of the campaign."
    //
    // There is no 2-1 in this block and no scoreline anywhere in the feed. The
    // model had two goalscorers, one per side, and produced a scoreline from
    // them — then contradicted it in the same sentence, because the table says
    // neither side has played. In the cron path ESPN's `Game data:` line sits
    // directly above this block and supplies the real score, so production was
    // never exposed; the harness prompt omitted it, which is what made the
    // tendency visible. A block that lists goals without saying it carries no
    // score is one missing line away from doing this in production too.
    lines.push('[EPL EVENT NOTE] These are the players involved, from the official '
        + 'Premier League feed. It carries NO minute for any goal or card, and NO scoreline '
        + '— do not state when anything happened, and never infer the score from the number '
        + 'of goalscorers listed here. Use only a score given elsewhere in this prompt. '
        + 'Name who did what'
        + (fixtureFinished ? '.' : ', and treat it as the state so far, not a final account.'));
    return lines.join('\n');
}

// ── Network ─────────────────────────────────────────────────────────────────
// Plain fetch with cf:{cacheEverything}, not relayFetch. cache-helpers.js keys
// on the URL specifically because Cloudflare will not cache a request carrying
// an Authorization header — its own comment cites the Kali audit for that. FPL
// is unauthenticated, so that caveat does not apply and the documented
// cacheTtl/cacheEverything pattern is the right one (Rule 78).
const getJson = async (path, ttl) => {
    const r = await fetch(`${FPL_BASE}${path}`, {
        headers: FPL_HEADERS,
        cf: { cacheTtl: ttl, cacheEverything: true },
    });
    if (!r.ok) throw new Error(`FPL ${path} HTTP ${r.status}`);
    return r.json();
};

/// One gameweek's worth of everything, fetched once per cycle.
export async function fetchFplData() {
    const boot = await getJson('/bootstrap-static/', TTL_BOOTSTRAP);
    const cur = (boot.events || []).find(e => e.is_current) || (boot.events || []).find(e => e.is_next);
    if (!cur) return null;
    const [live, fixtures] = await Promise.all([
        getJson(`/event/${cur.id}/live/`, TTL_LIVE),
        getJson(`/fixtures/?event=${cur.id}`, TTL_LIVE),
    ]);
    return {
        gameweek: cur.id,
        teamsByName: new Map((boot.teams || []).map(t => [t.name, t])),
        teamsById: new Map((boot.teams || []).map(t => [t.id, t])),
        elementsById: new Map((boot.elements || []).map(e => [e.id, e])),
        liveElements: live.elements || [],
        fixtures: fixtures || [],
    };
}

/// The block for one match, plus why it is null when it is. `unresolved` names
/// the club the alias map is missing, so a silent miss becomes a visible one.
export function fplContextFor(homeName, awayName, data) {
    if (!data) return { block: null, reason: 'no-fpl-data' };
    const home = resolveFplTeam(homeName, data.teamsByName);
    const away = resolveFplTeam(awayName, data.teamsByName);
    if (!home || !away) {
        return { block: null, reason: 'unresolved-team',
                 unresolved: [!home && homeName, !away && awayName].filter(Boolean) };
    }
    const fixture = data.fixtures.find(f => f.team_h === home.id && f.team_a === away.id);
    const events = fixture ? matchEvents(fixture.id, data.liveElements, data.elementsById) : null;
    const block = buildFplBlock({
        events,
        homeTable: tableLine(home),
        awayTable: tableLine(away),
        fixtureFinished: !!fixture?.finished,
    });
    return { block, reason: block ? 'ok' : 'nothing-grounded', gameweek: data.gameweek,
             fixtureId: fixture?.id ?? null };
}
