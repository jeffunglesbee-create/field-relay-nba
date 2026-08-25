// ── Win-Probability Resolver ────────────────────────────────────────────────
// Extracted from src/index.js so both the main worker and UserDO can call
// resolveWinProbability without a circular import.
//
// Constants below are kept in sync with src/index.js by convention — they are
// not exported from index.js because that would create a circular dependency
// (index.js imports UserDO from user-do.js, which imports this module).
// If a constant changes in index.js, update it here too.

import { resolveTeamKey } from './identity-resolver.js';
import { checkAndIncrementDailyOdds } from './budget-helpers.js';
import { relayFetchKV } from './cache-helpers.js';

// ── ESPN summary endpoint (keep in sync with index.js) ─────────────────────
const ESPN_SUMMARY_BASE    = 'https://site.web.api.espn.com/apis/site/v2';
// ESPN scoreboard base. Was site.api.espn.com until 2026-08-08
// (CC-CMD-2026-08-08-espn-site-api-403-p0): Akamai began 403ing Cloudflare
// Worker egress IPs on that host, breaking every ESPN read from the relay.
// site.web.api serves the same payload and returns 200 from the Worker IP.
// Mirrors index.js's ESPN_API_BASE -- keep the two in sync (this module
// cannot import it; the duplication is pre-existing and deliberate).
const ESPN_SCOREBOARD_BASE = 'https://site.web.api.espn.com/apis/site/v2';
const ESPN_SUMMARY_HEADERS = {
    'Origin':  'https://www.espn.com',
    'Referer': 'https://www.espn.com/',
    'Accept':  'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

// ── Squiggle (AFL) (keep in sync with index.js) ────────────────────────────
const SQUIGGLE_BASE    = 'https://api.squiggle.com.au';
const SQUIGGLE_HEADERS = {
    'Accept':     'application/json',
    'User-Agent': 'FIELD-Global-Sports-Intelligence/1.0 (jeffunglesbee-create/jubilant-bassoon)',
};

// ── Kali AFL Stats (keep in sync with index.js) ────────────────────────────
const KALI_BASE = 'https://kaliaflstats.com/api/afl/v1';

// ── Odds API (keep in sync with index.js) ──────────────────────────────────
const ODDS_BASE             = 'https://api.the-odds-api.com';
// The hard-coded key was REMOVED 2026-08-25 -- see src/index.js's
// `_oddsPrimaryKey` for the reasoning and the /budget/odds measurement that
// showed it was never reached. A missing key is its own state here too.
const ODDS_HARD_LIMIT       = 85000;
const ODDS_THRESHOLDS       = [
    { pct: 50, label: '50%' },
    { pct: 75, label: '75%' },
    { pct: 90, label: '90%' },
];
const ODDS_PREFERRED_BOOK   = 'draftkings';

const ARCHIVE_SPORT_TO_ODDS_KEY = {
    nba:         'basketball_nba',
    wnba:        'basketball_wnba',
    nhl:         'icehockey_nhl',
    mlb:         'baseball_mlb',
    epl:         'soccer_epl',
    mls:         'soccer_usa_mls',
    'la liga':   'soccer_spain_la_liga',
    'ligue 1':   'soccer_france_ligue_one',
    bundesliga:  'soccer_germany_bundesliga',
    'serie a':   'soccer_italy_serie_a',
    cfl:         'americanfootball_cfl',
    cfb:         'americanfootball_ncaaf',
    nfl:         'americanfootball_nfl',
    ufl:         'americanfootball_ufl',
    afl:         'aussierules_afl',
    ipl:         'cricket_ipl',
};

// ── Helpers (keep in sync with index.js) ───────────────────────────────────

function teamNameMatch(oddsName, fieldName) {
    if (!oddsName || !fieldName) return false;
    const a = resolveTeamKey(oddsName);
    const b = resolveTeamKey(fieldName);
    if (!a || !b) return false;
    if (a === b) return true;
    const pfx = 5;
    if (a.length >= pfx && b.length >= pfx) {
        if (b.includes(a.slice(0, pfx)) || a.includes(b.slice(0, pfx))) return true;
    }
    return false;
}

// Maps the client's display-label sport values (e.g. "Baseball (MLB)", "NBA Playoffs",
// "Premier League") to the bare codes this function's branches expect.
// The client's sec.sport is never guaranteed to be a bare code — it's the section label
// surfaced in the UI.
//
// SPORT_LABEL_MAP is grounded in the real, exhaustive set of section labels found in
// jeffunglesbee-create/jubilant-bassoon/index.html (probed 2026-07-08 at commit 6a699a0):
// every `sections.push({sport:"..."})` / `allSections.push({sport:section,...})` literal,
// plus the ESPN_SPORTS and bootstrap-fetch section labels ("NBA", "WNBA", "NHL",
// "NCAA Football", "NCAA Basketball", "Formula 1", etc). Not inferred — enumerated.
// Values that are `null` are sports the client genuinely sends that this function has
// no real data source for (Golf, Tennis, Rugby, UEFA club competitions, EFL playoffs,
// NCAA hoops/football, Formula 1, WWE) — correctly unsupported, not a gap.
const SPORT_LABEL_MAP = {
    // ── ESPN-native (MLB / NBA / WNBA) ──────────────────────────────────
    'baseball (mlb)':               'mlb',
    'baseball':                     'mlb',
    'mlb':                          'mlb',
    'nba playoffs':                 'nba',
    'nba':                          'nba',
    'basketball':                   'nba', // bare "basketball" is ambiguous (NBA vs WNBA);
                                            // WNBA always sends its own distinct "wnba"/"WNBA" label
    'wnba':                         'wnba',

    // ── Soccer: ESPN WC summary branch ──────────────────────────────────
    'fifa world cup 2026':          'soccer',
    'soccer':                       'soccer',

    // ── Odds-API branch — soccer domestic leagues ───────────────────────
    'premier league':               'epl',
    'epl':                          'epl',
    'la liga':                      'la liga',
    'ligue 1':                      'ligue 1',
    'bundesliga':                   'bundesliga',
    'serie a':                      'serie a',
    'mls soccer':                   'mls',
    'mls':                          'mls',

    // ── Odds-API branch — hockey ─────────────────────────────────────────
    'nhl playoffs':                 'nhl',
    'nhl':                          'nhl',
    'hockey':                       'nhl',
    'ice hockey':                   'nhl',

    // ── Odds-API branch — American / Australian / Canadian football ─────
    'american football (nfl)':      'nfl',
    'nfl':                          'nfl',
    'canadian football (cfl)':      'cfl',
    'cfl':                          'cfl',
    'ncaa football':                'cfb',
    'cfb':                          'cfb',
    'ufl — united football league': 'ufl',
    'ufl - united football league': 'ufl', // hyphen variant, defensive
    'ufl':                          'ufl',
    'australian football (afl)':    'afl',
    'australian rules football':    'afl',
    'afl':                          'afl',

    // ── Odds-API branch — cricket ─────────────────────────────────────────
    'ipl':                          'ipl',
    'cricket':                      'ipl',

    // ── Confirmed real client labels with no data source in this function ──
    'efl championship playoffs':    null,
    'efl league one playoffs':      null,
    'efl league two playoffs':      null,
    'uefa champions league':        null,
    'uefa europa league':           null,
    'uefa conference league':       null,
    'golf':                         null,
    'tennis':                       null,
    'rugby':                        null,
    'wwe/pro wrestling':            null,
    'ncaa basketball':              null,
    'formula 1':                    null,
    'f1':                           null,
    'racing':                       null,
    'unknown':                      null,
};

export function normalizeSportCode(sport) {
    if (!sport) return null;
    const raw = String(sport).toLowerCase().trim();

    if (Object.prototype.hasOwnProperty.call(SPORT_LABEL_MAP, raw)) {
        return SPORT_LABEL_MAP[raw];
    }

    // Fallback for labels not yet seen in the real client (defense-in-depth only —
    // every label confirmed in the client today is covered by the exact map above).
    // resolveWinProbability logs every null resolution with the raw sport string via
    // _recordWpResolutionFailure, so a genuinely new client label surfaces in the
    // wp-resolution-failures codex rather than failing silently forever.
    const parenMatch = raw.match(/\(([^)]+)\)/);
    if (parenMatch && Object.prototype.hasOwnProperty.call(SPORT_LABEL_MAP, parenMatch[1].trim())) {
        return SPORT_LABEL_MAP[parenMatch[1].trim()];
    }
    if (raw.includes('baseball')) return 'mlb';
    if (raw.includes('wnba')) return 'wnba';
    if (raw.includes('nba') || raw.includes('basketball')) return 'nba';
    if (raw.includes('hockey') || raw.includes('nhl')) return 'nhl';
    if (raw.includes('premier league')) return 'epl';
    if (raw.includes('la liga') || raw.includes('laliga')) return 'la liga';
    if (raw.includes('ligue')) return 'ligue 1';
    if (raw.includes('bundesliga')) return 'bundesliga';
    if (raw.includes('serie a')) return 'serie a';
    if (raw.includes('mls') || raw.includes('major league soccer')) return 'mls';
    if (raw.includes('canadian football') || raw.includes('cfl')) return 'cfl';
    if (raw.includes('ncaa football') || raw.includes('college football') || raw.includes('cfb')) return 'cfb';
    if (raw.includes('nfl')) return 'nfl';
    if (raw.includes('ufl')) return 'ufl';
    if (raw.includes('afl') || raw.includes('australian')) return 'afl';
    if (raw.includes('ipl') || raw.includes('cricket')) return 'ipl';
    if (raw.includes('soccer')) return 'soccer';

    return null;
}

// Returns true only when `sport` is a real, known client label that
// SPORT_LABEL_MAP explicitly maps to null — i.e. a sport with genuinely
// no win-probability data source (Golf, Tennis, etc.), confirmed
// correct-and-expected behavior, not a bug.
//
// Deliberately does NOT reuse normalizeSportCode()'s fallback substring
// matching: every fallback branch in that function returns a real
// supported code, never null, so an exact-match-only check here is
// sufficient and avoids re-implementing that logic. A label that matches
// nothing at all (genuinely new/unrecognized) correctly returns false
// here, so it still surfaces as a failure rather than being silently
// swallowed — preserving normalizeSportCode's own stated purpose for
// that fallthrough case.
export function isWpUnsupportedSport(sport) {
    if (!sport) return false;
    const raw = String(sport).toLowerCase().trim();
    return Object.prototype.hasOwnProperty.call(SPORT_LABEL_MAP, raw)
        && SPORT_LABEL_MAP[raw] === null;
}

function _oddsCreditMonthKey() {
    const d = new Date();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `odds:credits:${d.getUTCFullYear()}-${m}`;
}

async function consumeOddsCredit(env, units) {
    if (!env.FIELD_JOURNALISM) return true;
    if (!(await checkAndIncrementDailyOdds(env, units))) return false;
    try {
        const key  = _oddsCreditMonthKey();
        const raw  = await env.FIELD_JOURNALISM.get(key);
        const used = raw ? parseInt(raw, 10) || 0 : 0;
        if (used + units > ODDS_HARD_LIMIT) {
            const warnedKey = `${key}:warned:limit`;
            const already   = await env.FIELD_JOURNALISM.get(warnedKey);
            if (!already) {
                console.warn(`[odds-guard/wp] HARD LIMIT — used=${used} + ${units} > ${ODDS_HARD_LIMIT}`);
                await env.FIELD_JOURNALISM.put(warnedKey, '1', { expirationTtl: 60 * 86400 });
            }
            return false;
        }
        const next = used + units;
        await env.FIELD_JOURNALISM.put(key, String(next), { expirationTtl: 60 * 86400 });
        for (const t of ODDS_THRESHOLDS) {
            const cutoff = Math.floor(ODDS_HARD_LIMIT * (t.pct / 100));
            if (used < cutoff && next >= cutoff) {
                const warnedKey = `${key}:warned:${t.pct}`;
                const already   = await env.FIELD_JOURNALISM.get(warnedKey);
                if (!already) {
                    console.warn(`[odds-guard/wp] ${t.label} of monthly limit reached — used=${next}/${ODDS_HARD_LIMIT}`);
                    await env.FIELD_JOURNALISM.put(warnedKey, '1', { expirationTtl: 60 * 86400 });
                }
            }
        }
        return true;
    } catch (_) {
        return true;
    }
}

async function fetchSportOddsLive(env, sportKey) {
    const key = env.ODDS_API_KEY || env.ODDS_API_KEY_FALLBACK || null;
    if (!key) console.error('[wp-resolver] ODDS_API_KEY is not set — this is a missing credential, not an API outage');
    if (!key) return { games: [], quotaRemaining: 0, ok: false };
    if (!(await consumeOddsCredit(env, 3))) {
        return { games: [], quotaRemaining: 0, ok: false, guarded: true };
    }
    const r = await fetch(
        `${ODDS_BASE}/v4/sports/${sportKey}/odds?apiKey=${key}&markets=h2h,spreads,totals&regions=us&oddsFormat=american`,
        { cf: { cacheTtl: 900, cacheEverything: true } }
    );
    const quotaRemaining = parseInt(r.headers.get('x-requests-remaining') || '0', 10) || 0;
    if (!r.ok) return { games: [], quotaRemaining, ok: false };
    let games = [];
    try { games = await r.json(); } catch (_) { games = []; }
    return { games: Array.isArray(games) ? games : [], quotaRemaining, ok: true };
}

// Fetch ESPN scoreboard for a given sport/league path, match predictedWinner by team name,
// then fetch the summary for the matched event to get winprobability[].
// Checks both today and yesterday (picks may resolve the morning after a game).
async function fetchESPNNativeWP(espnPath, espnId, predictedWinner) {
    // Fast path: if gameId is a real ESPN numeric ID (e.g. stripped from "espn:401871790"),
    // try the summary directly first. Client g-prefixed IDs fail this test cleanly.
    const isRealEspnId = espnId && /^\d{6,}$/.test(String(espnId));
    if (isRealEspnId) {
        try {
            const r = await fetch(
                `${ESPN_SUMMARY_BASE}/sports/${espnPath}/summary?event=${espnId}`,
                { headers: ESPN_SUMMARY_HEADERS, signal: AbortSignal.timeout(5000) }
            );
            if (r.ok) {
                const d   = await r.json();
                const wps = d.winprobability || [];
                if (wps.length) {
                    const last = wps[wps.length - 1];
                    const pct  = typeof last.homeWinPercentage === 'number' ? last.homeWinPercentage : null;
                    if (pct !== null) {
                        const competitors = d.header?.competitions?.[0]?.competitors || [];
                        const homeComp    = competitors.find(c => c.homeAway === 'home');
                        const homeName    = homeComp?.team?.displayName || homeComp?.team?.shortDisplayName || '';
                        const isHome      = teamNameMatch(predictedWinner, homeName);
                        const prob        = isHome ? pct : 1 - pct;
                        return { probability: Math.round(prob * 1000) / 1000, source: 'espn-native', label: 'Statistical probability' };
                    }
                }
            }
        } catch (_) { /* fall through to scoreboard lookup */ }
    }

    // Scoreboard lookup by team name — handles g-prefixed session IDs and real-ID misses.
    // Same pattern as the odds-api branch: fetch all games for the sport, match by name.
    // Check today and yesterday since resolution may fire the morning after a game ends.
    const now = new Date();
    const toDateStr = d => d.toISOString().slice(0, 10).replace(/-/g, '');
    const yesterday = new Date(now.getTime() - 86400000);
    const datesToCheck = [toDateStr(now), toDateStr(yesterday)];

    let espnEventId = null;
    let isHomeTeam  = null;

    for (const dateStr of datesToCheck) {
        if (espnEventId) break;
        const sbUrl = `${ESPN_SCOREBOARD_BASE}/sports/${espnPath}/scoreboard?dates=${dateStr}`;
        try {
            const sbR = await fetch(sbUrl, { headers: ESPN_SUMMARY_HEADERS, signal: AbortSignal.timeout(5000) });
            if (!sbR.ok) continue;
            const sbD = await sbR.json();
            for (const ev of (sbD.events || [])) {
                const comp      = ev.competitions?.[0] || {};
                const statusTyp = comp.status?.type || {};
                // Skip pre-game events — winprobability[] is only available for live/final games
                const completed = statusTyp.completed === true;
                const live      = statusTyp.state === 'in';
                if (!completed && !live) continue;
                const teams = comp.competitors || [];
                const home  = teams.find(t => t.homeAway === 'home');
                const away  = teams.find(t => t.homeAway === 'away');
                const homeN = home?.team?.displayName || home?.team?.shortDisplayName || '';
                const awayN = away?.team?.displayName || away?.team?.shortDisplayName || '';
                if (teamNameMatch(predictedWinner, homeN)) { espnEventId = ev.id; isHomeTeam = true;  break; }
                if (teamNameMatch(predictedWinner, awayN)) { espnEventId = ev.id; isHomeTeam = false; break; }
            }
        } catch (_) { /* continue to next date */ }
    }

    if (!espnEventId) return null;

    // Fetch the summary for the matched event to get winprobability[]
    try {
        const r = await fetch(
            `${ESPN_SUMMARY_BASE}/sports/${espnPath}/summary?event=${espnEventId}`,
            { headers: ESPN_SUMMARY_HEADERS, signal: AbortSignal.timeout(5000) }
        );
        if (!r.ok) return null;
        const d   = await r.json();
        const wps = d.winprobability || [];
        if (!wps.length) return null;
        const last = wps[wps.length - 1];
        const pct  = typeof last.homeWinPercentage === 'number' ? last.homeWinPercentage : null;
        if (pct === null) return null;
        const prob = isHomeTeam ? pct : 1 - pct;
        return { probability: Math.round(prob * 1000) / 1000, source: 'espn-native', label: 'Statistical probability' };
    } catch (_) {
        return null;
    }
}

// _discoverAFLRound: AFL is ESPN-native for scores (adaptESPNBasketball
// reuses the WNBA adapter — quarters map naturally), but resolveWinProbability
// has no round/year context yet at this point, unlike buildAFLJournalismContext
// which receives it from the already-fetched games array.
//
// Does NOT mirror fetchESPNNativeWP's today/yesterday window — confirmed live
// that it doesn't work for AFL: fetchESPNNativeWP's window exists for
// resolving picks on games that already happened (daily sports), but AFL
// plays one round per week and a pick can legitimately be made on a game
// still days away. Live-tested 2026-07-08: the only AFL fixture (Fremantle
// v Sydney Swans, round 18) was on 2026-07-09 — a next-day game invisible to
// a backward-only window, confirmed via a direct today+yesterday query
// returning zero events both days.
//
// Single date-RANGE request (-3d/+6d, comfortably spans a round's Thu-Mon
// scheduling variance) instead of looping individual dates. Reads round from
// each EVENT's own `week.number`, not the top-level `d.week.number` --
// confirmed live these disagree for a multi-day range (top-level reflects a
// single ambient "current week" concept; a range spanning two rounds' worth
// of games returned top-level week=17 while the round-18 games inside that
// same response each correctly carried their own week.number=18).
async function _discoverAFLRound(predictedWinner) {
    const now = new Date();
    const toDateStr = d => d.toISOString().slice(0, 10).replace(/-/g, '');
    const rangeStart = new Date(now.getTime() - 3 * 86400000);
    const rangeEnd   = new Date(now.getTime() + 6 * 86400000);
    try {
        const r = await fetch(
            `${ESPN_SCOREBOARD_BASE}/sports/australian-football/afl/scoreboard?dates=${toDateStr(rangeStart)}-${toDateStr(rangeEnd)}`,
            { headers: ESPN_SUMMARY_HEADERS, signal: AbortSignal.timeout(5000) }
        );
        if (!r.ok) return null;
        const d = await r.json();
        for (const ev of (d.events || [])) {
            const round = ev.week?.number ?? null;
            if (!round) continue;
            const comp = ev.competitions?.[0] || {};
            const teams = comp.competitors || [];
            const home = teams.find(t => t.homeAway === 'home');
            const away = teams.find(t => t.homeAway === 'away');
            const homeN = home?.team?.displayName || home?.team?.shortDisplayName || '';
            const awayN = away?.team?.displayName || away?.team?.shortDisplayName || '';
            if (teamNameMatch(predictedWinner, homeN) || teamNameMatch(predictedWinner, awayN)) {
                return { round, year: now.getUTCFullYear() };
            }
        }
    } catch (_) { /* return null below */ }
    return null;
}

// ── Public export ───────────────────────────────────────────────────────────

// Per-sport best-effort resolver. Returns { probability, source, label } or null.
// Routes each sport to its confirmed data source; never invents; never throws.
export async function resolveWinProbability(sport, { gameId, predictedWinner }, env) {
    if (!sport || !predictedWinner) return null;
    // Normalize the client's display-label sport value to the bare code each branch expects.
    // Real client sport values are display labels (e.g. "Baseball (MLB)", "NBA Playoffs",
    // "Premier League") — never reliably bare codes. Returns null for unrecognized sports.
    const s = normalizeSportCode(sport);
    if (!s) return null;
    // Relay game IDs use "espn:XXXXXXX" prefix; ESPN's API needs the numeric part only.
    // Client session IDs ("g28") are not stripped — they're caught by isRealEspnId below.
    const espnId = gameId ? String(gameId).replace(/^espn:/, '') : gameId;
    try {
        // ── ESPN native winprobability[] — NBA, WNBA, MLB ──────────────────
        // Migrated from direct ?event= lookup (broken for client g-prefixed IDs)
        // to scoreboard name-matching (same pattern as the odds-api branch below).
        if (s === 'nba' || s === 'wnba' || s === 'mlb') {
            const espnPath = s === 'mlb'  ? 'baseball/mlb'
                           : s === 'wnba' ? 'basketball/wnba'
                           :                'basketball/nba';
            return await fetchESPNNativeWP(espnPath, espnId, predictedWinner);
        }

        // ── AFL: Kali (richer, already incorporates Squiggle consensus + h2h/
        // form/stats/venue/scoring) first, Squiggle Aggregate as fallback —
        // same source priority buildAFLJournalismContext (src/index.js) already
        // proved correct. Ported from that function's real matching logic
        // (year+round only, zero team param — Squiggle's `team=` filter is
        // documented as a numeric Team ID, never a name; the previous branch
        // passed predictedWinner directly into it and never worked for any
        // AFL pick), not reinvented.
        if (s === 'afl') {
            const discovered = await _discoverAFLRound(predictedWinner);
            if (!discovered) return null;
            const { round, year } = discovered;
            const kaliKey = env.KALI_AFL_TOKEN;
            const _norm = str => String(str || '').toLowerCase()
                .replace(/\b(lions|swans|eagles|hawks|magpies|bombers|cats|blues|tigers|bulldogs|kangaroos|power|crows|demons|dockers|suns|giants|saints|roos)\b/g, '')
                .replace(/[^a-z]/g, '').slice(0, 6);
            const isMatch = name => teamNameMatch(predictedWinner, name) ||
                (_norm(predictedWinner) && _norm(predictedWinner) === _norm(name));

            if (kaliKey) {
                try {
                    // relayFetchKV (not fetch()'s cf:{} shorthand, not relayFetch's
                    // caches.default) -- this request carries an Authorization header,
                    // which Cloudflare does not cache via cacheEverything (confirmed
                    // live, CC-CMD-2026-07-08-afl-kali-cache-audit: CF-Cache-Status was
                    // BYPASS on every request). caches.default was tried next
                    // (relayFetchAwaited) but confirmed live via wrangler tail
                    // (CC-CMD-2026-07-08-afl-kali-relayfetch-fix follow-up) to silently
                    // no-op on this Worker -- it has no custom domain, only
                    // *.workers.dev, and Cloudflare documents the Cache API as
                    // functional only on custom domains. KV isn't zone-scoped and needs
                    // no ExecutionContext (UserDO has none -- confirmed live,
                    // constructor(state, env) only), sidestepping both restrictions.
                    const r = await relayFetchKV(
                        `${KALI_BASE}/predictions?year=${year}&round=${round}`,
                        { 'Authorization': `Bearer ${kaliKey}`, 'Accept': 'application/json' },
                        3600, 'kali-pick-resolution', env.KALI_CACHE, 5000,
                    );
                    if (r.ok) {
                        const kd = await r.json();
                        for (const pred of (kd.data || [])) {
                            const isHome = isMatch(pred.homeTeam);
                            const isAway = isMatch(pred.awayTeam);
                            if (!isHome && !isAway) continue;
                            const rawProb = isHome ? pred.homeProbability : pred.awayProbability;
                            if (typeof rawProb !== 'number') continue;
                            // Kali's API returns a 0-100 percentage (confirmed live: a real
                            // response returned 57.9, not a 0-1 fraction), unlike every other
                            // source in this file. Normalize to the same 0-1 scale as the
                            // ESPN-native/odds-api/Squiggle branches before returning.
                            const prob = rawProb / 100;
                            return { probability: Math.round(prob * 1000) / 1000, source: 'kali', label: 'Statistical probability' };
                        }
                    }
                } catch (_) { /* fall through to Squiggle */ }
            }

            try {
                const r = await fetch(`${SQUIGGLE_BASE}/?q=tips;year=${year};round=${round}`, {
                    headers: SQUIGGLE_HEADERS, signal: AbortSignal.timeout(5000),
                });
                if (r.ok) {
                    const sd = await r.json();
                    const aggTip = (sd.tips || []).find(t => t.source === 'Aggregate' &&
                        (isMatch(t.hteam) || isMatch(t.ateam)));
                    if (aggTip) {
                        const isHome = isMatch(aggTip.hteam);
                        const conf = parseFloat(aggTip.hconfidence);
                        if (!isNaN(conf)) {
                            const prob = isHome ? conf / 100 : (100 - conf) / 100;
                            return { probability: Math.round(prob * 1000) / 1000, source: 'squiggle', label: 'Statistical probability' };
                        }
                    }
                }
            } catch (_) { /* both sources exhausted */ }

            return null;
        }

        // ── Soccer: ESPN WC summary winprobability[] ────────────────────────
        if (s === 'soccer') {
            if (!espnId) return null;
            const r = await fetch(
                `${ESPN_SUMMARY_BASE}/sports/soccer/fifa.world/summary?event=${espnId}`,
                { signal: AbortSignal.timeout(5000) }
            );
            if (r.ok) {
                const d   = await r.json();
                const wps = d.winprobability || [];
                if (wps.length) {
                    const last = wps[wps.length - 1];
                    const pct  = typeof last.homeWinPercentage === 'number' ? last.homeWinPercentage : null;
                    if (pct !== null) {
                        const competitors = d.header?.competitions?.[0]?.competitors || [];
                        const homeComp    = competitors.find(c => c.homeAway === 'home');
                        const homeName    = homeComp?.team?.displayName || homeComp?.team?.shortDisplayName || '';
                        const isHome      = teamNameMatch(predictedWinner, homeName);
                        const prob        = isHome ? pct : 1 - pct;
                        return { probability: Math.round(prob * 1000) / 1000, source: 'espn-soccer', label: 'Statistical probability' };
                    }
                }
            }
            return null;
        }

        // ── Odds API — NHL, MLS, EPL, NFL, CFL, CFB, etc. ──────────────────
        const sportKey = ARCHIVE_SPORT_TO_ODDS_KEY[s];
        if (sportKey) {
            const { games, ok } = await fetchSportOddsLive(env, sportKey);
            if (!ok || !games.length) return null;
            for (const g of games) {
                const homeMatch = teamNameMatch(predictedWinner, g.home_team);
                const awayMatch = teamNameMatch(predictedWinner, g.away_team);
                if (!homeMatch && !awayMatch) continue;
                const books = g.bookmakers || [];
                const bk    = books.find(b => b.key === ODDS_PREFERRED_BOOK) || books[0];
                if (!bk) continue;
                const h2h = (bk.markets || []).find(m => m.key === 'h2h');
                if (!h2h) continue;
                const hO = h2h.outcomes.find(o => o.name === g.home_team);
                const aO = h2h.outcomes.find(o => o.name === g.away_team);
                if (!hO || !aO) continue;
                const implH = hO.price > 0 ? 100 / (hO.price + 100) : Math.abs(hO.price) / (Math.abs(hO.price) + 100);
                const implA = aO.price > 0 ? 100 / (aO.price + 100) : Math.abs(aO.price) / (Math.abs(aO.price) + 100);
                const vigSum = implH + implA;
                if (vigSum <= 0) continue;
                const prob = homeMatch ? implH / vigSum : implA / vigSum;
                return { probability: Math.round(prob * 1000) / 1000, source: 'odds-api', label: 'Market estimate' };
            }
        }

        return null;
    } catch (_) {
        return null;
    }
}
