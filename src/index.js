const NBA_CDN_BASE = 'https://cdn.nba.com/static/json';
const CACHE_TTL = 30;

const UPSTREAM_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer':    'https://www.nba.com/',
    'Origin':     'https://www.nba.com',
    'Accept':     'application/json',
};

const ALLOWED_PATHS = [
    '/liveData/scoreboard/todaysScoreboard_00.json',
    '/liveData/standings/standings_v2.json',
    '/staticData/scheduleLeagueV2.json',
];

const ALLOWED_PREFIXES = [
    '/liveData/boxscore/boxscore_',
    '/liveData/playbyplay/playbyplay_',
    '/liveData/odds_todaysGames',
    '/liveData/channels_',
];

function isAllowed(path) {
    if (ALLOWED_PATHS.includes(path)) return true;
    return ALLOWED_PREFIXES.some(p => path.startsWith(p));
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname === '/health') {
            return new Response('RELAY OK', {
                status: 200,
                headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*', 'X-FIELD-Proxy': 'relay-nba' }
            });
        }
        if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
        const nbaPath = url.pathname.replace(/^\/nba/, '');
        if (!isAllowed(nbaPath)) {
            return new Response('Path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'path-not-whitelisted' } });
        }
        const targetUrl = `${NBA_CDN_BASE}${nbaPath}`;
        const cacheKey  = new Request(targetUrl, request);
        const cache     = caches.default;
        let response    = await cache.match(cacheKey);
        if (!response) {
            let upstream;
            try {
                upstream = await fetch(targetUrl, { headers: UPSTREAM_HEADERS, cf: { cacheTtl: CACHE_TTL, cacheEverything: true } });
            } catch (err) {
                return new Response(`RELAY network error: ${err.message}`, { status: 502, headers: { 'X-RELAY-Error': 'network-failure' } });
            }
            if (!upstream.ok) return new Response(`NBA CDN returned ${upstream.status}`, { status: upstream.status, headers: { 'X-RELAY-Error': `nba-cdn-${upstream.status}` } });
            response = new Response(upstream.body, {
                status: upstream.status,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Cache-Control': `public, max-age=${CACHE_TTL}`, 'X-FIELD-Proxy': 'relay-nba', 'X-RELAY-Source': 'nba-cdn-live' }
            });
            ctx.waitUntil(cache.put(cacheKey, response.clone()));
        }
        return response;
    },
};