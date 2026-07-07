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

// ── ESPN summary endpoint (keep in sync with index.js) ─────────────────────
const ESPN_SUMMARY_BASE    = 'https://site.web.api.espn.com/apis/site/v2';
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

// ── Odds API (keep in sync with index.js) ──────────────────────────────────
const ODDS_BASE             = 'https://api.the-odds-api.com';
const ODDS_API_KEY_FALLBACK = 'de44fdf870b3a4b5ee9d46993b2e1038';
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
    const key = env.ODDS_API_KEY || ODDS_API_KEY_FALLBACK;
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

// ── Public export ───────────────────────────────────────────────────────────

// Per-sport best-effort resolver. Returns { probability, source, label } or null.
// Routes each sport to its confirmed data source; never invents; never throws.
export async function resolveWinProbability(sport, { gameId, predictedWinner }, env) {
    if (!sport || !predictedWinner) return null;
    const s = String(sport).toLowerCase().trim();
    // Relay game IDs use "espn:XXXXXXX" prefix; ESPN's API needs the numeric part only.
    const espnId = gameId ? String(gameId).replace(/^espn:/, '') : gameId;
    try {
        // ── ESPN native winprobability[] — NBA, WNBA, MLB ──────────────────
        if (s === 'nba' || s === 'wnba' || s === 'mlb') {
            const espnPath = s === 'mlb'  ? 'baseball/mlb'
                           : s === 'wnba' ? 'basketball/wnba'
                           :                'basketball/nba';
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
            return null;
        }

        // ── Squiggle AFL tips ───────────────────────────────────────────────
        if (s === 'afl') {
            const year = new Date().getUTCFullYear();
            const r = await fetch(
                `${SQUIGGLE_BASE}/?q=tips;team=${encodeURIComponent(predictedWinner)};year=${year}`,
                { headers: SQUIGGLE_HEADERS, signal: AbortSignal.timeout(5000) }
            );
            if (r.ok) {
                const d    = await r.json();
                const tips = (d.tips || []).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
                if (tips.length) {
                    const tip  = tips[0];
                    const conf = parseFloat(tip.hconfidence) || 50;
                    const prob = teamNameMatch(predictedWinner, tip.hteam || '')
                        ? conf / 100
                        : (100 - conf) / 100;
                    return { probability: Math.round(prob * 1000) / 1000, source: 'squiggle', label: 'Statistical probability' };
                }
            }
            return null;
        }

        // ── Soccer: ESPN WC summary winprobability[] ────────────────────────
        if (s === 'soccer') {
            if (!espnId) return null;
            const r = await fetch(
                `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${espnId}`,
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
