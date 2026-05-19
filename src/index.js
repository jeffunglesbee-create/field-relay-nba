// ── NBA CDN ────────────────────────────────────────────────────────────────
const NBA_CDN_BASE  = 'https://cdn.nba.com/static/json';
const NBA_CACHE_TTL = 30;
const NBA_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer':    'https://www.nba.com/',
    'Origin':     'https://www.nba.com',
    'Accept':     'application/json',
};
const NBA_ALLOWED_PATHS = [
    '/liveData/scoreboard/todaysScoreboard_00.json',
    '/liveData/standings/standings_v2.json',
    '/staticData/scheduleLeagueV2.json',
];
const NBA_ALLOWED_PREFIXES = [
    '/liveData/boxscore/boxscore_',
    '/liveData/playbyplay/playbyplay_',
    '/liveData/odds_todaysGames',
    '/liveData/channels_',
];
function nbaAllowed(path) {
    if (NBA_ALLOWED_PATHS.includes(path)) return true;
    return NBA_ALLOWED_PREFIXES.some(p => path.startsWith(p));
}

// ── NHL Web API ────────────────────────────────────────────────────────────
// Source: api-web.nhle.com — same API the NHL website uses, undocumented but
// well-documented by community (github.com/Zmalski/NHL-API-Reference)
// CORS: blocks browser origins — relay required for production use
// Auth: no key needed
// Migrated from old statsapi.web.nhl.com in 2023/2024
const NHL_BASE = 'https://api-web.nhle.com';
const NHL_CACHE_TTL_LIVE     = 30;    // scoreboard + gamecenter — live match data
const NHL_CACHE_TTL_SCHEDULE = 300;   // schedule — changes infrequently
const NHL_CACHE_TTL_STANDINGS= 3600;  // standings — once per day at most
const NHL_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer':    'https://www.nhl.com/',
    'Origin':     'https://www.nhl.com',
    'Accept':     'application/json',
};
const NHL_ALLOWED_EXACT = [
    '/v1/scoreboard/now',
    '/v1/standings/now',
];
const NHL_ALLOWED_PREFIXES = [
    '/v1/schedule/',        // /v1/schedule/2026-05-20
    '/v1/standings/',       // /v1/standings/2026-05-20
    '/v1/gamecenter/',      // /v1/gamecenter/{id}/boxscore|landing|play-by-play|right-rail
    '/v1/score/',           // /v1/score/{date}
];
function nhlAllowed(path) {
    if (NHL_ALLOWED_EXACT.includes(path)) return true;
    return NHL_ALLOWED_PREFIXES.some(p => path.startsWith(p));
}
function nhlCacheTtl(path) {
    if (path.startsWith('/v1/standings')) return NHL_CACHE_TTL_STANDINGS;
    if (path.startsWith('/v1/schedule')) return NHL_CACHE_TTL_SCHEDULE;
    return NHL_CACHE_TTL_LIVE; // scoreboard/now, gamecenter, score
}

// ── FPL (Fantasy Premier League) ───────────────────────────────────────────
const FPL_BASE = 'https://fantasy.premierleague.com/api';
const FPL_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer':    'https://fantasy.premierleague.com/',
    'Origin':     'https://fantasy.premierleague.com',
    'Accept':     'application/json',
};
const FPL_TTL_BOOTSTRAP = 3600;
const FPL_TTL_LIVE      = 30;
const FPL_ALLOWED_EXACT    = ['/bootstrap-static', '/fixtures'];
const FPL_ALLOWED_PREFIXES_FPL = ['/fixtures?', '/event/'];
function fplAllowed(path) {
    if (FPL_ALLOWED_EXACT.includes(path) || FPL_ALLOWED_EXACT.includes(path.replace(/\/$/, ''))) return true;
    return FPL_ALLOWED_PREFIXES_FPL.some(p => path.startsWith(p));
}
function fplCacheTtl(path) {
    return path.startsWith('/bootstrap') ? FPL_TTL_BOOTSTRAP : FPL_TTL_LIVE;
}

// ── Football-Data.org (FD) ─────────────────────────────────────────────────
// ── Squiggle AFL API — free, no key, CORS-open BUT blocked from claude.ai Artifact iframe
// Relay provides: CORS bypass for Artifact testing + shared edge cache (good citizen)
// User-Agent identifies FIELD traffic to Squiggle's author
const SQUIGGLE_BASE         = 'https://api.squiggle.com.au';
const SQUIGGLE_TTL_LIVE     = 30;    // incomplete games — update frequently
const SQUIGGLE_TTL_STANDING = 120;   // standings — stable within a round
const SQUIGGLE_TTL_TIPS     = 3600;  // tips/power — once per round
const SQUIGGLE_HEADERS = {
    'Accept':     'application/json',
    'User-Agent': 'FIELD-Global-Sports-Intelligence/1.0 (jeffunglesbee-create/jubilant-bassoon)',
};
function squiggleTtl(search) {
    if (search.includes('complete=0'))                                 return SQUIGGLE_TTL_LIVE;
    if (search.includes('q=standings') || search.includes('q=ladder')) return SQUIGGLE_TTL_STANDING;
    if (search.includes('q=tips')      || search.includes('q=power'))  return SQUIGGLE_TTL_TIPS;
    return SQUIGGLE_TTL_LIVE;
}

// ── ATP Tour Live Scores ────────────────────────────────────────────────────
// Proxies app.atptour.com — bypasses CORS block in browser iframes.
// No auth needed; 15s edge cache matches FIELD's live polling interval.
const ATP_BASE = 'https://app.atptour.com/api/v2/gateway';
const ATP_TTL  = 15;

function atpAllowed(path) {
    return path === '/livematches/website' || path.startsWith('/livematches/');
}

const FD_BASE       = 'https://api.football-data.org/v4';
const FD_AUTH_TOKEN = '21559ed667044b94a8b7cb0bbe303112';
const FD_HEADERS = {
    'X-Auth-Token': FD_AUTH_TOKEN,
    'Accept':       'application/json',
};
const FD_ALLOWED_EXACT    = ['/matches', '/competitions'];
const FD_ALLOWED_PREFIXES_FD = ['/matches?', '/competitions/', '/matches/'];
function fdAllowed(path) {
    if (FD_ALLOWED_EXACT.includes(path)) return true;
    return FD_ALLOWED_PREFIXES_FD.some(p => path.startsWith(p));
}
function fdCacheTtl(path) {
    if (path.includes('/head2head'))        return 86400;
    if (path.includes('/standings'))        return 3600;
    if (path.startsWith('/matches'))        return 60;
    if (path.startsWith('/competitions/'))  return 120;
    return 120;
}

// ── The Odds API ───────────────────────────────────────────────────────────
// Source: api.the-odds-api.com — free tier 500 req/month
// Auth: apiKey query param (server-side only — never exposed to browser)
// Cache: 300s for odds (changes slowly), 3600s for sports list
// Quota tracking: X-Requests-Remaining / X-Requests-Used response headers
// FIELD uses: drama_bb preGameScore · pre-game EMBER · BNI divergence ·
//             J5 upset detection · totals pace · line movement · series odds
const ODDS_BASE    = 'https://api.the-odds-api.com';
const ODDS_API_KEY = 'bab102f4d22fb4398c4f237a9e992af2';
const ODDS_TTL_ODDS   = 300;   // odds — update every 5 min
const ODDS_TTL_SPORTS = 3600;  // sports list — stable within a season
const ODDS_ALLOWED_EXACT    = ['/v4/sports', '/v4/usage'];
const ODDS_ALLOWED_PREFIXES = ['/v4/sports/', '/v4/events/'];
function oddsAllowed(path) {
    if (ODDS_ALLOWED_EXACT.includes(path)) return true;
    return ODDS_ALLOWED_PREFIXES.some(p => path.startsWith(p));
}
function oddsCacheTtl(path) {
    return path === '/v4/sports' ? ODDS_TTL_SPORTS : ODDS_TTL_ODDS;
}
// Inject apiKey as query param (server-side only)
function oddsUrl(cleanPath, search) {
    const qs  = search ? search + `&apiKey=${ODDS_API_KEY}` : `?apiKey=${ODDS_API_KEY}`;
    return `${ODDS_BASE}${cleanPath}${qs}`;
}

// ── API-Sports (api-sports.io) ─────────────────────────────────────────────
// Multi-sport: Football, AFL, Baseball, Basketball, F1, Hockey, NFL, MMA + more
// Auth: x-apisports-key header (server-side only — never exposed to browser)
// Key: env.APISPORTS_KEY (set in Cloudflare dashboard → field-relay-nba secrets)
// Free tier: 100 req/day PER SPORT — independent budgets, not shared
// Rate: 1 req/sec max
// FIELD uses: live fixture stats · fixture events · live in-play odds ·
//             pre-match predictions · dangerous_attacks delta · set piece events
//
// Route: /apisports/{sport}/{endpoint}?{params}
// Examples:
//   /apisports/football/fixtures?live=all&league=39        EPL live games
//   /apisports/football/fixtures/statistics?fixture=12345  live stats
//   /apisports/football/fixtures/events?fixture=12345      goals/cards/subs
//   /apisports/football/odds/live?fixture=12345            in-play odds
//   /apisports/football/predictions?fixture=12345          pre-match win prob
//   /apisports/basketball/games?live=all                   NBA/FIBA live
//   /apisports/hockey/games?live=all                       NHL/intl live
//   /apisports/afl/games?live=all                          AFL live
//   /apisports/american-football/games?live=all            NFL live

const APISPORTS_HOSTS = {
    'football':          'v3.football.api-sports.io',
    'basketball':        'v1.basketball.api-sports.io',
    'hockey':            'v1.hockey.api-sports.io',
    'baseball':          'v1.baseball.api-sports.io',
    'afl':               'v1.afl.api-sports.io',
    'american-football': 'v1.american-football.api-sports.io',
    'formula-1':         'v1.formula-1.api-sports.io',
    'mma':               'v1.mma.api-sports.io',
};

// Whitelist: only endpoints FIELD actually needs
const APISPORTS_ALLOWED = [
    '/fixtures',         // ?live=all, ?id=, ?league=&season=
    '/fixtures/',        // /fixtures/statistics, /fixtures/events, /fixtures/lineups
    '/standings',        // ?league=&season=
    '/odds',             // ?fixture= (pre-match)
    '/odds/',            // /odds/live?fixture=
    '/predictions',      // ?fixture=
    '/games',            // basketball/hockey/afl/nfl ?live=all
    '/games/',           // /games/statistics?id=
    '/leagues',          // ?id= (fixture ID lookup utility)
    '/seasons',          // utility — cached 24hr
    '/races',            // F1 /races?season=
    '/rounds',           // F1 /rounds?season=&current=true
    '/events',           // MMA /events
];

function apiSportsAllowed(path) {
    return APISPORTS_ALLOWED.some(p =>
        path === p || path.startsWith(p + '?') || path.startsWith(p + '/')
    );
}

function apiSportsTtl(path) {
    // Live data: 30s
    if (path.startsWith('/fixtures?live') || path.startsWith('/games?live'))   return 30;
    if (path.startsWith('/fixtures/statistics') || path.startsWith('/fixtures/events')) return 30;
    if (path.startsWith('/games/statistics'))                                   return 30;
    if (path.startsWith('/odds/live'))                                          return 30;
    // Pre-match / stable: 1hr+
    if (path.startsWith('/predictions'))  return 3600;   // stable until kickoff
    if (path.startsWith('/standings'))    return 3600;   // daily at most
    if (path.startsWith('/odds'))         return 300;    // pre-match odds: 5 min
    if (path.startsWith('/leagues'))      return 86400;  // rarely changes
    if (path.startsWith('/seasons'))      return 86400;
    if (path.startsWith('/races'))        return 3600;
    if (path.startsWith('/rounds'))       return 3600;
    return 60; // default: 1 min for fixture queries
}

// ── Shared CORS headers ────────────────────────────────────────────────────
const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET',
};

// ── Shared relay fetch helper ──────────────────────────────────────────────
async function relayFetch(targetUrl, headers, ttl, source, ctx) {
    const cache    = caches.default;
    const cacheKey = new Request(targetUrl, { method: 'GET' });
    let   response = await cache.match(cacheKey);
    if (response) return response;
    let upstream;
    try {
        upstream = await fetch(targetUrl, { headers, cf: { cacheTtl: ttl, cacheEverything: true } });
    } catch (err) {
        return new Response(`${source} network error: ${err.message}`, { status: 502, headers: { 'X-RELAY-Error': `${source}-network`, ...CORS } });
    }
    if (!upstream.ok) {
        return new Response(`${source} returned ${upstream.status}`, { status: upstream.status, headers: { 'X-RELAY-Error': `${source}-${upstream.status}`, ...CORS } });
    }
    response = new Response(upstream.body, {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS, 'Cache-Control': `public, max-age=${ttl}`, 'X-FIELD-Proxy': `relay-${source}`, 'X-Cache-TTL': String(ttl) }
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
}

// ── Worker ─────────────────────────────────────────────────────────────────
export default {
    async fetch(request, env, ctx) {
        const url      = new URL(request.url);
        const pathname = url.pathname;

        if (pathname === '/health') {
            return new Response('RELAY OK — nba + nhl + fpl + fd + odds + apisports + squiggle + atp', {
                status: 200,
                headers: { 'Content-Type': 'text/plain', ...CORS, 'X-FIELD-Proxy': 'relay-multi' }
            });
        }
        if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS });

        // /squiggle → api.squiggle.com.au (CORS bypass + shared edge cache)
        // Free, no key. All data via ?q= query params. Validate q= present.
        if (pathname.startsWith('/squiggle')) {
            if (!url.search || !url.search.includes('q='))
                return new Response('Squiggle ?q= param required', { status: 400, headers: { 'X-RELAY-Error': 'squiggle-missing-q', ...CORS } });
            return relayFetch(`${SQUIGGLE_BASE}/${url.search}`, SQUIGGLE_HEADERS, squiggleTtl(url.search), 'squiggle', ctx);
        }

        // /apisports/{sport}/* → api-sports.io (x-apisports-key injected server-side)
        if (pathname.startsWith('/apisports/')) {
            const parts     = pathname.replace(/^\/apisports\//, '').split('/');
            const sport     = parts[0];
            const cleanPath = '/' + parts.slice(1).join('/');
            const host      = APISPORTS_HOSTS[sport];
            if (!host)
                return new Response(`Unknown sport: ${sport}`, { status: 404, headers: { 'X-RELAY-Error': 'apisports-unknown-sport', ...CORS } });
            if (!apiSportsAllowed(cleanPath))
                return new Response('API-Sports path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'apisports-path-not-whitelisted', ...CORS } });
            const apiKey = env.APISPORTS_KEY;
            if (!apiKey)
                return new Response('APISPORTS_KEY not configured', { status: 500, headers: { 'X-RELAY-Error': 'apisports-no-key', ...CORS } });
            const targetUrl = `https://${host}${cleanPath}${url.search || ''}`;
            return relayFetch(targetUrl, { 'x-apisports-key': apiKey, 'Accept': 'application/json' }, apiSportsTtl(cleanPath), 'apisports', ctx);
        }

        // /odds/* → api.the-odds-api.com (apiKey injected server-side)
        if (pathname.startsWith('/odds')) {
            const cleanPath = pathname.replace(/^\/odds/, '') || '/';
            if (!oddsAllowed(cleanPath)) return new Response('Odds path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'odds-path-not-whitelisted', ...CORS } });
            const targetUrl = oddsUrl(cleanPath, url.search);
            return relayFetch(targetUrl, { 'Accept': 'application/json' }, oddsCacheTtl(cleanPath), 'odds', ctx);
        }

        // /nhl/* → api-web.nhle.com
        if (pathname.startsWith('/nhl')) {
            const cleanPath = pathname.replace(/^\/nhl/, '') || '/';
            const nhlPath   = cleanPath + (url.search || '');
            if (!nhlAllowed(cleanPath)) return new Response('NHL path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'nhl-path-not-whitelisted', ...CORS } });
            return relayFetch(`${NHL_BASE}${nhlPath}`, NHL_HEADERS, nhlCacheTtl(cleanPath), 'nhl', ctx);
        }

        // /fd/* → api.football-data.org/v4
        if (pathname.startsWith('/fd')) {
            const cleanPath = pathname.replace(/^\/fd/, '') || '/';
            const fdPath    = cleanPath + (url.search || '');
            if (!fdAllowed(cleanPath)) return new Response('FD path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'fd-path-not-whitelisted', ...CORS } });
            return relayFetch(`${FD_BASE}${fdPath}`, FD_HEADERS, fdCacheTtl(cleanPath), 'fd', ctx);
        }

        // /fpl/* → fantasy.premierleague.com/api
        if (pathname.startsWith('/fpl')) {
            const cleanPath = pathname.replace(/^\/fpl/, '');
            const fplPath   = cleanPath + (url.search || '');
            if (!fplAllowed(cleanPath)) return new Response('FPL path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'fpl-path-not-whitelisted', ...CORS } });
            return relayFetch(`${FPL_BASE}${fplPath}`, FPL_HEADERS, fplCacheTtl(cleanPath), 'fpl', ctx);
        }

        // /atp/* → app.atptour.com/api/v2/gateway (no auth, 15s cache — CORS bypass)
        if (pathname.startsWith('/atp')) {
            const cleanPath = pathname.replace(/^\/atp/, '') || '/livematches/website';
            if (!atpAllowed(cleanPath))
                return new Response('ATP path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'atp-path-not-whitelisted', ...CORS } });
            const targetUrl = `${ATP_BASE}${cleanPath}${url.search || '?scoringTournamentLevel=tour'}`;
            return relayFetch(targetUrl, { 'Accept': 'application/json', 'Origin': 'https://www.atptour.com', 'Referer': 'https://www.atptour.com/' }, ATP_TTL, 'atp', ctx);
        }

        // /nba/* → NBA CDN
        const nbaPath = pathname.replace(/^\/nba/, '');
        if (!nbaAllowed(nbaPath)) return new Response('Path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'path-not-whitelisted', ...CORS } });
        return relayFetch(`${NBA_CDN_BASE}${nbaPath}`, NBA_HEADERS, NBA_CACHE_TTL, 'nba', ctx);
    },
};
