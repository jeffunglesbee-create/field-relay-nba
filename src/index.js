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
        return new Response(`${source} network error: ${err.message}`, { status: 502, headers: { 'X-RELAY-Error': `${source}-network` } });
    }
    if (!upstream.ok) {
        return new Response(`${source} returned ${upstream.status}`, { status: upstream.status, headers: { 'X-RELAY-Error': `${source}-${upstream.status}` } });
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
            return new Response('RELAY OK — nba + nhl + fpl + fd + odds', {
                status: 200,
                headers: { 'Content-Type': 'text/plain', ...CORS, 'X-FIELD-Proxy': 'relay-multi' }
            });
        }
        if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

        // /odds/* → api.the-odds-api.com (apiKey injected server-side)
        if (pathname.startsWith('/odds')) {
            const cleanPath = pathname.replace(/^\/odds/, '') || '/';
            if (!oddsAllowed(cleanPath)) return new Response('Odds path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'odds-path-not-whitelisted' } });
            const targetUrl = oddsUrl(cleanPath, url.search);
            return relayFetch(targetUrl, { 'Accept': 'application/json' }, oddsCacheTtl(cleanPath), 'odds', ctx);
        }

        // /nhl/* → api-web.nhle.com
        if (pathname.startsWith('/nhl')) {
            const cleanPath = pathname.replace(/^\/nhl/, '') || '/';
            const nhlPath   = cleanPath + (url.search || '');
            if (!nhlAllowed(cleanPath)) return new Response('NHL path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'nhl-path-not-whitelisted' } });
            return relayFetch(`${NHL_BASE}${nhlPath}`, NHL_HEADERS, nhlCacheTtl(cleanPath), 'nhl', ctx);
        }

        // /fd/* → api.football-data.org/v4
        if (pathname.startsWith('/fd')) {
            const cleanPath = pathname.replace(/^\/fd/, '') || '/';
            const fdPath    = cleanPath + (url.search || '');
            if (!fdAllowed(cleanPath)) return new Response('FD path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'fd-path-not-whitelisted' } });
            return relayFetch(`${FD_BASE}${fdPath}`, FD_HEADERS, fdCacheTtl(cleanPath), 'fd', ctx);
        }

        // /fpl/* → fantasy.premierleague.com/api
        if (pathname.startsWith('/fpl')) {
            const cleanPath = pathname.replace(/^\/fpl/, '');
            const fplPath   = cleanPath + (url.search || '');
            if (!fplAllowed(cleanPath)) return new Response('FPL path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'fpl-path-not-whitelisted' } });
            return relayFetch(`${FPL_BASE}${fplPath}`, FPL_HEADERS, fplCacheTtl(cleanPath), 'fpl', ctx);
        }

        // /nba/* → NBA CDN
        const nbaPath = pathname.replace(/^\/nba/, '');
        if (!nbaAllowed(nbaPath)) return new Response('Path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'path-not-whitelisted' } });
        return relayFetch(`${NBA_CDN_BASE}${nbaPath}`, NBA_HEADERS, NBA_CACHE_TTL, 'nba', ctx);
    },
};
