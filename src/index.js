// ── NBA CDN ────────────────────────────────────────────────────────────────
const NBA_CDN_BASE = 'https://cdn.nba.com/static/json';
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

// ── FPL (Fantasy Premier League) ───────────────────────────────────────────
// Source: fantasy.premierleague.com/api/ — open server-side, CORS-blocked browser-side
// Legal: Official PL product, public API, used by thousands of FPL apps
const FPL_BASE = 'https://fantasy.premierleague.com/api';

const FPL_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer':    'https://fantasy.premierleague.com/',
    'Origin':     'https://fantasy.premierleague.com',
    'Accept':     'application/json',
};

const FPL_TTL_BOOTSTRAP = 3600;
const FPL_TTL_LIVE      = 30;

const FPL_ALLOWED_EXACT = ['/bootstrap-static', '/fixtures'];
const FPL_ALLOWED_PREFIXES = ['/fixtures?', '/event/'];
function fplAllowed(path) {
    if (FPL_ALLOWED_EXACT.includes(path) || FPL_ALLOWED_EXACT.includes(path.replace(/\/$/, ''))) return true;
    return FPL_ALLOWED_PREFIXES.some(p => path.startsWith(p));
}
function fplCacheTtl(path) {
    return path.startsWith('/bootstrap') ? FPL_TTL_BOOTSTRAP : FPL_TTL_LIVE;
}

// ── Football-Data.org (FD) ─────────────────────────────────────────────────
// Source: api.football-data.org/v4 — CORS restricted to localhost only
// Solution: relay adds X-Auth-Token server-side; key never exposed in browser JS
// Free tier: 10 req/min — relay-level caching keeps this well within limits
// All users share the cache — quota is consumed once per TTL window, not per user
//
// TTL strategy (smart by path type):
//   /matches* batch    →  60s   (live matches update frequently)
//   /standings*        →  3600s (league table changes ~once per day)
//   /matches/*/head2h* →  86400s (historical H2H, very stable)
//   /competitions*     →  300s  (competition metadata)
//
// FIELD batch call: /fd/matches?competitions=PL,PD,SA,BL1,FL1,CL,EL,ECL&dateFrom=X&dateTo=X
// Replaces 9 sequential individual competition calls (63s) with 1 call

const FD_BASE = 'https://api.football-data.org/v4';
// Auth token stored server-side — never exposed in FIELD browser JS
const FD_AUTH_TOKEN = '21559ed667044b94a8b7cb0bbe303112';

const FD_HEADERS = {
    'X-Auth-Token': FD_AUTH_TOKEN,
    'Accept':       'application/json',
};

// Allowed FD paths (strip /fd prefix before checking)
const FD_ALLOWED_EXACT = ['/matches', '/competitions'];
const FD_ALLOWED_PREFIXES = [
    '/matches?',                   // batch: /matches?competitions=PL,PD&dateFrom=X
    '/competitions/',              // /competitions/PL/matches, /competitions/PL/standings
    '/matches/',                   // /matches/{id}/head2head
];
function fdAllowed(path) {
    if (FD_ALLOWED_EXACT.includes(path)) return true;
    return FD_ALLOWED_PREFIXES.some(p => path.startsWith(p));
}
function fdCacheTtl(path) {
    if (path.includes('/head2head'))          return 86400; // H2H historical — very stable
    if (path.includes('/standings'))          return 3600;  // standings — once per day
    if (path.startsWith('/matches'))          return 60;    // live/batch matches — frequent
    if (path.startsWith('/competitions/'))    return 120;   // competition matches
    return 120;
}

// ── Shared CORS headers ────────────────────────────────────────────────────
const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET',
};

// ── Shared relay handler (DRY) ─────────────────────────────────────────────
async function relayFetch(targetUrl, headers, ttl, source, ctx) {
    const cache    = caches.default;
    const cacheKey = new Request(targetUrl, { method: 'GET' });
    let response   = await cache.match(cacheKey);
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
        headers: {
            'Content-Type': 'application/json',
            ...CORS,
            'Cache-Control': `public, max-age=${ttl}`,
            'X-FIELD-Proxy': `relay-${source}`,
            'X-Cache-TTL':   String(ttl),
        }
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
}

// ── Worker ─────────────────────────────────────────────────────────────────
export default {
    async fetch(request, env, ctx) {
        const url      = new URL(request.url);
        const pathname = url.pathname;

        // Health — reports all three upstreams
        if (pathname === '/health') {
            return new Response('RELAY OK — nba + fpl + fd', {
                status: 200,
                headers: { 'Content-Type': 'text/plain', ...CORS, 'X-FIELD-Proxy': 'relay-multi' }
            });
        }

        if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

        // ── Route: /fd/* → api.football-data.org/v4 ───────────────────────
        if (pathname.startsWith('/fd')) {
            const fdPath    = pathname.replace(/^\/fd/, '') + (url.search || '');
            const cleanPath = pathname.replace(/^\/fd/, '') || '/';

            if (!fdAllowed(cleanPath)) {
                return new Response('FD path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'fd-path-not-whitelisted' } });
            }

            const ttl       = fdCacheTtl(cleanPath);
            const targetUrl = `${FD_BASE}${fdPath}`;
            return relayFetch(targetUrl, FD_HEADERS, ttl, 'fd', ctx);
        }

        // ── Route: /fpl/* → fantasy.premierleague.com/api ─────────────────
        if (pathname.startsWith('/fpl')) {
            const fplPath   = pathname.replace(/^\/fpl/, '') + (url.search || '');
            const cleanPath = pathname.replace(/^\/fpl/, '');

            if (!fplAllowed(cleanPath)) {
                return new Response('FPL path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'fpl-path-not-whitelisted' } });
            }

            const ttl       = fplCacheTtl(cleanPath);
            const targetUrl = `${FPL_BASE}${fplPath}`;
            return relayFetch(targetUrl, FPL_HEADERS, ttl, 'fpl', ctx);
        }

        // ── Route: /nba/* → NBA CDN ────────────────────────────────────────
        const nbaPath = pathname.replace(/^\/nba/, '');
        if (!nbaAllowed(nbaPath)) {
            return new Response('Path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'path-not-whitelisted' } });
        }
        const targetUrl = `${NBA_CDN_BASE}${nbaPath}`;
        return relayFetch(targetUrl, NBA_HEADERS, NBA_CACHE_TTL, 'nba', ctx);
    },
};

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

// ── FPL (Fantasy Premier League) ───────────────────────────────────────────
// Source: fantasy.premierleague.com/api/ — open server-side, CORS-blocked browser-side
// Legal: Official PL product, public API, used by thousands of FPL apps
const FPL_BASE = 'https://fantasy.premierleague.com/api';

const FPL_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer':    'https://fantasy.premierleague.com/',
    'Origin':     'https://fantasy.premierleague.com',
    'Accept':     'application/json',
};

// Cache TTLs: bootstrap is stable (1hr), fixtures+live update every ~30s during matches
const FPL_TTL_BOOTSTRAP = 3600;  // team/player lookup — changes at most once/day
const FPL_TTL_LIVE      = 30;    // fixtures scores + player live stats during matches

// Allowed FPL paths (strip /fpl prefix before checking)
const FPL_ALLOWED_EXACT = [
    '/bootstrap-static',
    '/fixtures',
];
const FPL_ALLOWED_PREFIXES = [
    '/fixtures?',      // /fixtures?event=37
    '/event/',         // /event/37/live/
];
function fplAllowed(path) {
    if (FPL_ALLOWED_EXACT.includes(path) || FPL_ALLOWED_EXACT.includes(path.replace(/\/$/, ''))) return true;
    return FPL_ALLOWED_PREFIXES.some(p => path.startsWith(p));
}
function fplCacheTtl(path) {
    return path.startsWith('/bootstrap') ? FPL_TTL_BOOTSTRAP : FPL_TTL_LIVE;
}

// ── Shared CORS headers ────────────────────────────────────────────────────
const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET',
};

// ── Worker ─────────────────────────────────────────────────────────────────
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const pathname = url.pathname;

        // Health check — reports both upstreams
        if (pathname === '/health') {
            return new Response('RELAY OK — nba + fpl', {
                status: 200,
                headers: { 'Content-Type': 'text/plain', ...CORS, 'X-FIELD-Proxy': 'relay-nba-fpl' }
            });
        }

        if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

        // ── Route: /fpl/* → fantasy.premierleague.com/api ─────────────────
        if (pathname.startsWith('/fpl')) {
            const fplPath = pathname.replace(/^\/fpl/, '') + (url.search || '');
            const cleanPath = pathname.replace(/^\/fpl/, '');

            if (!fplAllowed(cleanPath)) {
                return new Response('FPL path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'fpl-path-not-whitelisted' } });
            }

            const targetUrl = `${FPL_BASE}${fplPath}`;
            const ttl = fplCacheTtl(cleanPath);
            const cacheKey = new Request(targetUrl, { method: 'GET' });
            const cache = caches.default;
            let response = await cache.match(cacheKey);

            if (!response) {
                let upstream;
                try {
                    upstream = await fetch(targetUrl, { headers: FPL_HEADERS, cf: { cacheTtl: ttl, cacheEverything: true } });
                } catch (err) {
                    return new Response(`FPL network error: ${err.message}`, { status: 502, headers: { 'X-RELAY-Error': 'fpl-network-failure' } });
                }
                if (!upstream.ok) {
                    return new Response(`FPL returned ${upstream.status}`, { status: upstream.status, headers: { 'X-RELAY-Error': `fpl-${upstream.status}` } });
                }
                response = new Response(upstream.body, {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        ...CORS,
                        'Cache-Control': `public, max-age=${ttl}`,
                        'X-FIELD-Proxy': 'relay-fpl',
                        'X-RELAY-Source': 'fpl-api',
                        'X-Cache-TTL': String(ttl),
                    }
                });
                ctx.waitUntil(cache.put(cacheKey, response.clone()));
            }
            return response;
        }

        // ── Route: /nba/* → NBA CDN ────────────────────────────────────────
        const nbaPath = pathname.replace(/^\/nba/, '');
        if (!nbaAllowed(nbaPath)) {
            return new Response('Path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'path-not-whitelisted' } });
        }
        const targetUrl = `${NBA_CDN_BASE}${nbaPath}`;
        const cacheKey  = new Request(targetUrl, request);
        const cache     = caches.default;
        let response    = await cache.match(cacheKey);
        if (!response) {
            let upstream;
            try {
                upstream = await fetch(targetUrl, { headers: NBA_HEADERS, cf: { cacheTtl: NBA_CACHE_TTL, cacheEverything: true } });
            } catch (err) {
                return new Response(`RELAY network error: ${err.message}`, { status: 502, headers: { 'X-RELAY-Error': 'network-failure' } });
            }
            if (!upstream.ok) return new Response(`NBA CDN returned ${upstream.status}`, { status: upstream.status, headers: { 'X-RELAY-Error': `nba-cdn-${upstream.status}` } });
            response = new Response(upstream.body, {
                status: upstream.status,
                headers: { 'Content-Type': 'application/json', ...CORS, 'Cache-Control': `public, max-age=${NBA_CACHE_TTL}`, 'X-FIELD-Proxy': 'relay-nba', 'X-RELAY-Source': 'nba-cdn-live' }
            });
            ctx.waitUntil(cache.put(cacheKey, response.clone()));
        }
        return response;
    },
};