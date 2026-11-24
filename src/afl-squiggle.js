// Squiggle's round and its Aggregate tip for ONE AFL game, found by the game's two clubs and its kickoff DAY, never by a round number.
// docs/CC-CMD-2026-11-24-afl-finals-round-and-journalism-club-match.md, Part C.
//
// WHY THE ROUND CANNOT COME FROM ESPN FOR A FINAL. ESPN restarts its week at 1 for the postseason (Wildcard Finals 1, Qualifying and Elimination
// Finals 2, Semi Finals 3, Preliminary Finals 4, Grand Final 5) and marks each such EVENT `season.type` 3 / `season.slug` 'post-season' (20 of 20
// finals events read: 11 in 2026, 9 in 2025; the league-level season in the same bodies stays type 2, so it is not the discriminator). Squiggle numbers the finals on from the regular season: 2026 round 25 is the Wildcard Finals ... round 29 the
// Grand Final. So ESPN's week 2 is Squiggle's round 26, and Squiggle's round 2 is a March regular-season round: asked for round 2, Squiggle answers
// with the March game of the same two clubs (a September Adelaide v Western Bulldogs final was served the March tip, which favours the OTHER club).
// The offset (24 in both 2025 and 2026) is the last regular round and is not a constant of the sport (Squiggle's docs say the season starts at
// round 1 from 2027), and ESPN's stage names and Squiggle's roundnames differ by year, so neither is a key.
//
// WHAT IS A KEY. One Squiggle request, `?q=tips;year=Y;team=T;source=8` (about 9 KB: the team's season), returns every Aggregate tip of club T with
// its `round`, `gameid`, `date`, `hteamid`/`ateamid` and `hconfidence`. The game is the row whose two club ids are the game's and whose `date`
// falls on the game's kickoff day. Squiggle's `date` is Australia/Melbourne wall-clock (date + tz = unixtime on 4 of 4 games read), so the kickoff
// instant is formatted in that zone; ESPN's event time equals Squiggle's unixtime exactly (18 of 18 games read), the DAY is used so that a game
// moved within its day still joins. A pair of clubs meets once on a day. Club ids are Squiggle's own (?q=teams, 18 of 18 read 2026-11-24), reached
// through the AFL identity key, never by a name or a prefix.
//
// A game that cannot be found is null and SAID: the caller serves no tip rather than a tip through some other round.
import { resolveAFLTeamKey } from './identity-resolver.js';

const SQUIGGLE_BASE = 'https://api.squiggle.com.au';

// Squiggle's team id by AFL identity key (resolveAFLTeamKey). ?q=teams read 2026-11-24: Adelaide 1, Brisbane Lions 2, Carlton 3, Collingwood 4,
// Essendon 5, Fremantle 6, Geelong 7, Gold Coast 8, Greater Western Sydney 9, Hawthorn 10, Melbourne 11, North Melbourne 12, Port Adelaide 13,
// Richmond 14, St Kilda 15, Sydney 16, West Coast 17, Western Bulldogs 18.
export const SQUIGGLE_TEAM_IDS = Object.freeze({
    adelai: 1, brisba: 2, carlto: 3, collin: 4, essend: 5, freman: 6, geelon: 7, goldco: 8, greate: 9,
    hawtho: 10, melbou: 11, northm: 12, portad: 13, richmo: 14, stkild: 15, sydney: 16, westco: 17, wester: 18,
});

export function squiggleTeamId(name) {
    const key = resolveAFLTeamKey(name);
    return key && Object.prototype.hasOwnProperty.call(SQUIGGLE_TEAM_IDS, key) ? SQUIGGLE_TEAM_IDS[key] : null;
}

// 'YYYY-MM-DD' of an instant on the Melbourne wall clock, which is the zone of Squiggle's `date`. The formatter is built on first use, inside a try, never at
// module load: a runtime without the zone would otherwise take the whole Worker down at startup for a lookup only finals need. Without it the answer is null
// (the caller warns and serves no tip), not a guess.
let melbourneFormat;
export function melbourneDay(instantMs) {
    if (!Number.isFinite(instantMs)) return null;
    try {
        melbourneFormat ??= new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' });
        return melbourneFormat.format(new Date(instantMs));
    } catch (e) {
        console.warn(`[AFL-SQUIGGLE] no Melbourne time zone in this runtime: ${e && e.message}`);
        return null;
    }
}

// The percentage Squiggle gives `clubName` in a tip row: hconfidence is the HOME club's, so the away club's is the rest.
export function squiggleConfidenceFor(tip, clubName) {
    const id = squiggleTeamId(clubName);
    const h = Number(tip && tip.hconfidence);
    if (id === null || !Number.isFinite(h)) return null;
    return id === tip.hteamid ? h : id === tip.ateamid ? 100 - h : null;
}

// { year, kickoff (an ISO instant, ESPN's event.date), home, away (the game's club names, any spelling the AFL identity knows) }
//   -> the Squiggle Aggregate tip row of THAT game ({ round, gameid, date, hteam, hteamid, ateam, ateamid, hconfidence, ... }) or null.
// `headers` and `signal` go to the request as given. The reads are edge-cached for an hour (the tips TTL index.js uses), one entry per club and year.
export async function squiggleTipForGame({ year, kickoff, home, away }, { headers, signal } = {}) {
    const homeId = squiggleTeamId(home), awayId = squiggleTeamId(away);
    if (homeId === null || awayId === null || homeId === awayId) {
        console.warn(`[AFL-SQUIGGLE] no Squiggle team id for ${JSON.stringify(home)} v ${JSON.stringify(away)}`);
        return null;
    }
    const day = melbourneDay(Date.parse(kickoff));
    if (!Number.isInteger(year) || day === null) {
        console.warn(`[AFL-SQUIGGLE] no year or kickoff for ${home} v ${away} (year ${year}, kickoff ${JSON.stringify(kickoff)})`);
        return null;
    }
    const url = `${SQUIGGLE_BASE}/?q=tips;year=${year};team=${homeId};source=8`;
    let rows;
    try {
        const r = await fetch(url, {
            headers, ...(signal ? { signal } : {}),
            cf: { cacheTtl: 3600, cacheEverything: true, cacheKey: `squiggle:tips:${year}:team:${homeId}:aggregate` },
        });
        if (!r.ok) { console.warn(`[AFL-SQUIGGLE] Squiggle answered ${r.status} for ${url}`); return null; }
        const j = await r.json();
        rows = Array.isArray(j && j.tips) ? j.tips : null;
    } catch (e) {
        console.warn(`[AFL-SQUIGGLE] Squiggle read failed for ${url}: ${e && e.message}`);
        return null;
    }
    if (rows === null) { console.warn(`[AFL-SQUIGGLE] Squiggle answered no tips array for ${url}`); return null; }
    const found = rows.filter(t => t && t.source === 'Aggregate' && Number.isInteger(t.round)
        && ((t.hteamid === homeId && t.ateamid === awayId) || (t.hteamid === awayId && t.ateamid === homeId))
        && typeof t.date === 'string' && t.date.slice(0, 10) === day);
    if (found.length !== 1) {
        console.warn(`[AFL-SQUIGGLE] ${found.length ? 'ambiguous' : 'no'} Squiggle tip for ${home} v ${away} on ${day} (year ${year}): ${found.length} row(s)`);
        return null;
    }
    return found[0];
}
