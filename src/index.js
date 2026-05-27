// ── NBA CDN ────────────────────────────────────────────────────────────────
const NBA_CDN_BASE  = 'https://cdn.nba.com/static/json';
const NBA_CACHE_TTL = 30;
const NBA_HEADERS = {
    'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer':         'https://www.nba.com/standings',
    'Origin':          'https://www.nba.com',
    'Accept':          'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control':   'no-cache',
    'Pragma':          'no-cache',
};
// NBA standings use a separate TTL — refresh hourly (standings don't
// change more than once per day; 30s for live scoreboard is fine)
const NBA_STANDINGS_TTL = 3600;
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

// ── MLS Stats API ──────────────────────────────────────────────────────────
// Source: stats-api.mlssoccer.com — official MLS stats API powering mlssoccer.com
// Auth: none required (plain GET; User-Agent recommended)
// CORS: blocked for browser origins — relay required
// ── MLB Stats API (Item 6 — journalism depth) ─────────────────────────────
// Free, no auth, no key. Provides: boxscore, pitcher stats, team batting avg.
// Used to inject "Cole: 7.0 IP, 9K, 2.14 ERA" into journalism prompts.
// gamePk = game.sourceId stored on allData MLB game objects.
const MLB_STATS_API_BASE = 'https://statsapi.mlb.com/api/v1';
const MLB_STATS_API_ALLOWED_PREFIXES = [
    '/game/',       // /game/{gamePk}/boxscore + /game/{gamePk}/feed/live
    '/people/',     // /people/{playerId}/stats — career/season stats
];
function mlbStatsApiAllowed(path) {
    return MLB_STATS_API_ALLOWED_PREFIXES.some(p => path.startsWith(p));
}
const MLB_STATS_API_TTL = 60; // live game data — 60s cache
const MLB_STATS_API_HEADERS = { 'User-Agent': 'FIELD-Sports-Intelligence/1.0' };

// ── MLS Stats API ──────────────────────────────────────────────────────────
const MLS_STATS_HEADERS = {
    'User-Agent': 'FIELD-Sports-Intelligence/1.0',
    'Accept':     'application/json',
};
const MLS_STATS_TTL_LIVE      = 30;    // /v1/matches — live match state
const MLS_STATS_TTL_GOALS     = 60;    // /v1/goals — goalscorer events
const MLS_STATS_TTL_SCHEDULE  = 300;   // /matches/seasons/* — schedule
const MLS_STATS_TTL_STANDINGS = 3600;  // /competitions/*/standings
const MLS_STATS_ALLOWED_PREFIXES = [
    '/v1/matches',       // today's scores + match details
    '/v1/goals',         // goalscorer events
    '/v1/commentaries',  // full event stream
    '/matches/seasons/', // schedule by season
    '/competitions/',    // standings + season list
];
function mlsStatsAllowed(path) {
    return MLS_STATS_ALLOWED_PREFIXES.some(p => path.startsWith(p));
}
function mlsStatsTtl(path) {
    if (path.startsWith('/competitions/')) return MLS_STATS_TTL_STANDINGS;
    if (path.startsWith('/matches/seasons/')) return MLS_STATS_TTL_SCHEDULE;
    if (path.startsWith('/v1/goals') || path.startsWith('/v1/commentaries')) return MLS_STATS_TTL_GOALS;
    return MLS_STATS_TTL_LIVE; // /v1/matches
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
// ODDS API key — rotate via Cloudflare dashboard (Workers > field-relay-nba > Settings > Variables)
// Set: ODDS_API_KEY = <new key from api.the-odds-api.com>
// Fallback to old key until secret is set (old key is exhausted — set secret ASAP)
const ODDS_API_KEY_FALLBACK = 'de44fdf870b3a4b5ee9d46993b2e1038'; 
const ODDS_TTL_ODDS   = 3600;  // odds — 1hr edge cache (was 5min, burned quota fast)
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
function oddsUrl(cleanPath, search, envKey) {
    const apiKey = envKey || ODDS_API_KEY_FALLBACK;
    const qs  = search ? search + `&apiKey=${apiKey}` : `?apiKey=${apiKey}`;
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

// ── ESPN Gambit Partner API — Win Probability for Gamecast ────────────────
// Source: gambit-api-partner.fantasy.espn.com — powers ESPN Gamecast WP display
// CORS: locked to https://www.espn.com — server-side relay required
// Auth: none (public endpoint, origin lock only)
// Cache: 25s — shorter than Polling-Interval: 30 to avoid stale WP
// Route: /espn-gambit/* → gambit-api-partner.fantasy.espn.com/*
const ESPN_GAMBIT_BASE = 'https://gambit-api-partner.fantasy.espn.com';
const ESPN_GAMBIT_TTL  = 25;
const ESPN_GAMBIT_HEADERS = {
    'Origin':  'https://www.espn.com',
    'Referer': 'https://www.espn.com/',
    'Accept':  'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};
// Only allow the one scoreboard endpoint FIELD uses
function espnGambitAllowed(path) {
    return path.startsWith('/apis/v1/challenges/');
}

// ── ESPN Site API — Summary endpoint (Win Probability, play-by-play, scores) ───
// Source: site.api.espn.com — public REST endpoint, no auth required
// CORS: locked to espn.com origin — server-side relay required
// Cache: 25s — aligns with FIELD's 30s poll; winprobability[] array is live-updated
// Route: /espn-summary/* → site.api.espn.com/apis/site/v2/*
// Usage: /espn-summary/sports/basketball/nba/summary?event={gameId}
const ESPN_SUMMARY_BASE    = 'https://site.api.espn.com/apis/site/v2';
const ESPN_SUMMARY_TTL     = 25;
const ESPN_SUMMARY_HEADERS = {
    'Origin':  'https://www.espn.com',
    'Referer': 'https://www.espn.com/',
    'Accept':  'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};
// Allow only the summary endpoint — no other site.api paths
function espnSummaryAllowed(path) {
    return /^\/sports\/[a-z]+\/[a-z]+\/summary$/.test(path.split('?')[0]);
}

// ── BallDontLie (BDL) — NBA/WNBA/NFL player stats, standings, season averages ──
// Auth: Authorization header (API key stored as env.BDL_API_KEY)
// Free tier: 1M rows/month — generous for FIELD's playoff slate use
const BDL_BASE = 'https://api.balldontlie.io';
const BDL_ALLOWED_PREFIXES = [
    '/nba/v1/players',          // player lookup by name
    '/nba/v1/season_averages',  // season stats for milestone detection
    '/nba/v1/standings',        // standings — tertiary source after ESPN
    '/nba/v1/stats',            // per-game stats
    '/nba/v1/games',            // schedule/results
];
function bdlAllowed(path) {
    return BDL_ALLOWED_PREFIXES.some(p => path.startsWith(p));
}
function bdlCacheTtl(path) {
    if (path.startsWith('/nba/v1/standings'))      return 3600;   // hourly
    if (path.startsWith('/nba/v1/season_averages')) return 3600;  // changes each game
    if (path.startsWith('/nba/v1/players'))         return 86400; // stable reference
    return 60; // stats/games: 1 min (near-live)
}


// ── RealtimeSports API — Live NFL play-by-play, scores, odds, teams ──────────
// Source: realtimesportsapi.com — JWT Bearer auth (server-side only)
// Key: env.REALTIMESPORTS_KEY (set in CF dashboard → field-relay-nba secrets)
// Free tier: 125 calls/month. Starter: $12/mo, 10k calls + WebSocket.
// IMPORTANT: Two separate API paths exist:
//   /api/v1/* — generic sports catalog (no NFL data)
//   /api/*    — production frontend API (has NFL via ?league=nfl param)
// Route: /realtimesports/* → www.realtimesportsapi.com/api/*
// Discovered from Network tab May 27 2026: correct path is /api/schedule?league=nfl
const REALTIMESPORTS_BASE = 'https://www.realtimesportsapi.com/api';
const REALTIMESPORTS_ALLOWED_PREFIXES = [
    '/schedule',
    '/events',
    '/plays',
    '/teams',
    '/statistics',
    '/odds',
    '/athletes',
    '/leagues',
    '/live',
    '/sports',
];
function realtimeSportsAllowed(path) {
    return REALTIMESPORTS_ALLOWED_PREFIXES.some(p => path === p || path.startsWith(p + '?') || path.startsWith(p + '/'));
}
function realtimeSportsTtl(path) {
    if (path.startsWith('/live'))        return 30;   // live game state
    if (path.startsWith('/plays'))       return 30;   // near-live play-by-play
    if (path.startsWith('/statistics'))  return 60;   // updates each drive
    if (path.startsWith('/odds'))        return 120;  // odds move slowly
    if (path.startsWith('/schedule'))    return 120;  // schedule + scores
    if (path.startsWith('/events'))      return 120;  // event data
    return 3600; // teams, sports, reference data
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
        headers: {
            'Content-Type':               'application/json',
            ...CORS,
            'Cache-Control':              `public, max-age=${ttl}`,
            'X-FIELD-Proxy':              `relay-${source}`,
            'X-Cache-TTL':                String(ttl),
            // Forward quota headers from upstream where present
            ...(upstream.headers.get('x-requests-remaining') !== null
                ? {'X-Requests-Remaining': upstream.headers.get('x-requests-remaining')}
                : {}),
            ...(upstream.headers.get('x-requests-used') !== null
                ? {'X-Requests-Used': upstream.headers.get('x-requests-used')}
                : {}),
        }
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
}

// ── Worker ─────────────────────────────────────────────────────────────────

// ── PUSH B: VAPID signing + Web Push delivery ─────────────────────────────────
// PUSH B (May 24 2026). Cloudflare-native crypto — no npm dependencies.
// VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY set as Worker secrets (never in code).
// Called by: /push/subscribe (store), /push/unsubscribe (remove), cron (send).

// Base64url helpers (CF Workers have no Buffer)
function b64uDecode(s) {
    const pad = s.replace(/-/g,'+').replace(/_/g,'/').padEnd(s.length+(4-s.length%4)%4,'=');
    const bin = atob(pad);
    const arr = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    return arr;
}
function b64uEncode(buf) {
    let bin='';
    const arr = new Uint8Array(buf);
    for(const b of arr) bin+=String.fromCharCode(b);
    return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

// Build VAPID JWT header.payload (unsigned) for ES256
function vapidUnsigned(audience, sub, exp) {
    const header = b64uEncode(new TextEncoder().encode(JSON.stringify({typ:'JWT',alg:'ES256'})));
    const claims = b64uEncode(new TextEncoder().encode(JSON.stringify({aud:audience,exp,sub})));
    return `${header}.${claims}`;
}

// Sign VAPID JWT with ECDSA P-256 (ES256) using the private key JWK from env
async function signVapidJwt(unsigned, privateKeyJwk) {
    const key = await crypto.subtle.importKey(
        'jwk', privateKeyJwk,
        {name:'ECDSA', namedCurve:'P-256'},
        false, ['sign']
    );
    const data = new TextEncoder().encode(unsigned);
    const sig = await crypto.subtle.sign({name:'ECDSA', hash:'SHA-256'}, key, data);
    return `${unsigned}.${b64uEncode(sig)}`;
}

// Derive content encryption key + nonce using HKDF (Web Push encryption)
async function hkdf(salt, ikm, info, len) {
    const key = await crypto.subtle.importKey('raw', ikm, {name:'HKDF'}, false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        {name:'HKDF', hash:'SHA-256', salt, info: new TextEncoder().encode(info)}, key, len*8);
    return new Uint8Array(bits);
}

// Encrypt push payload using ECDH + HKDF + AES-128-GCM (RFC 8291)
async function encryptPayload(plaintext, sub) {
    const {p256dh, auth} = sub.keys;
    const receiverPub = b64uDecode(p256dh);
    const authSecret  = b64uDecode(auth);

    // Generate sender ephemeral key pair
    const senderKP = await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
    const senderPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', senderKP.publicKey));

    // Import receiver public key
    const receiverKey = await crypto.subtle.importKey('raw', receiverPub,
        {name:'ECDH',namedCurve:'P-256'}, false, []);

    // ECDH shared secret
    const sharedBits = await crypto.subtle.deriveBits({name:'ECDH',public:receiverKey},
        senderKP.privateKey, 256);
    const ikm = new Uint8Array(sharedBits);

    // Pseudo-random key
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const prk  = await hkdf(authSecret, ikm, 'Content-Encoding: auth\0', 32);

    // CEK and nonce
    const keyInfo   = new Uint8Array([...new TextEncoder().encode('Content-Encoding: aesgcm\0'),
                       ...receiverPub, ...senderPubRaw]);
    const nonceInfo = new Uint8Array([...new TextEncoder().encode('Content-Encoding: nonce\0'),
                       ...receiverPub, ...senderPubRaw]);
    const cek   = await hkdf(salt, prk, new TextDecoder().decode(keyInfo), 16);
    const nonce = await hkdf(salt, prk, new TextDecoder().decode(nonceInfo), 12);

    // Encrypt
    const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
    const padded = new Uint8Array([0, 0, ...new TextEncoder().encode(plaintext)]);
    const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM', iv:nonce}, aesKey, padded);

    return { ciphertext: new Uint8Array(ciphertext), salt, senderPub: senderPubRaw };
}

// Send Web Push notification to a single subscriber
async function sendWebPush(sub, payload, env) {
    if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) {
        throw new Error('VAPID keys not configured in Worker secrets');
    }
    const endpoint = sub.endpoint;
    const origin   = new URL(endpoint).origin;
    const exp      = Math.floor(Date.now()/1000) + 12*3600;
    const sub_email = 'mailto:jeff@field.app';

    // Parse private key (stored as base64url-encoded raw 32-byte P-256 key → convert to JWK)
    const dBytes = b64uDecode(env.VAPID_PRIVATE_KEY);
    const xBytes = b64uDecode(env.VAPID_PUBLIC_KEY).slice(1, 33); // skip 0x04 prefix
    const yBytes = b64uDecode(env.VAPID_PUBLIC_KEY).slice(33, 65);
    const privateKeyJwk = {
        kty:'EC', crv:'P-256',
        d: b64uEncode(dBytes),
        x: b64uEncode(xBytes),
        y: b64uEncode(yBytes),
    };

    const unsigned = vapidUnsigned(origin, sub_email, exp);
    const jwt = await signVapidJwt(unsigned, privateKeyJwk);
    const vapidHeader = `vapid t=${jwt},k=${env.VAPID_PUBLIC_KEY}`;

    const {ciphertext, salt, senderPub} = await encryptPayload(JSON.stringify(payload), sub);

    const headers = {
        'Authorization':    vapidHeader,
        'Content-Type':     'application/octet-stream',
        'Content-Encoding': 'aesgcm',
        'Encryption':       `salt=${b64uEncode(salt)}`,
        'Crypto-Key':       `dh=${b64uEncode(senderPub)};p256ecdsa=${env.VAPID_PUBLIC_KEY}`,
        'TTL':              '86400',
    };

    const res = await fetch(endpoint, {method:'POST', headers, body:ciphertext});
    return res;
}

// Cron handler: poll ESPN scores, compute drama, push to subscribers
async function handleCron(env) {
    if (!env.PUSH_SUBS) return; // KV not configured
    const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';

    // ── Multi-sport ESPN polling ──────────────────────────────────
    const SPORT_CONFIG = [
        {sport:'NBA', path:'basketball/nba',  minPeriod:3, maxMargin:10, dramaBase:80},
        {sport:'NHL', path:'hockey/nhl',      minPeriod:3, maxMargin:3,  dramaBase:78},
        {sport:'MLB', path:'baseball/mlb',    minPeriod:7, maxMargin:4,  dramaBase:75},
        {sport:'NFL', path:'football/nfl',    minPeriod:3, maxMargin:10, dramaBase:80},
        {sport:'MLS', path:'soccer/usa.1',    minPeriod:2, maxMargin:2,  dramaBase:82},
        {sport:'EPL', path:'soccer/eng.1',    minPeriod:2, maxMargin:2,  dramaBase:82},
    ];

    const dramatic = [];
    for (const cfg of SPORT_CONFIG) {
        try {
            const r = await fetch(`${RELAY}/espn-gambit/apis/site/v2/sports/${cfg.path}/scoreboard`);
            if (!r.ok) continue;
            const d = await r.json();
            const games = d?.events || [];

            for (const ev of games) {
                const comp = ev.competitions?.[0];
                if (!comp) continue;
                const status = comp.status?.type;
                if (status?.completed) continue;
                const detail = comp.status?.detail || '';
                // Must be live (has period/time indicator)
                if (!detail.includes('Q') && !detail.includes('P') && !detail.includes('H') &&
                    !detail.includes("'") && !detail.includes('Inn') && !detail.includes('Top') &&
                    !detail.includes('Bot') && !detail.includes('End')) continue;
                const period = comp.status?.period || 0;
                if (period < cfg.minPeriod) continue;
                const [home, away] = comp.competitors || [];
                const hScore = parseInt(home?.score||'0');
                const aScore = parseInt(away?.score||'0');
                const margin = Math.abs(hScore - aScore);
                if (margin > cfg.maxMargin) continue;
                // Drama heuristic: sport-specific base + period bonus + closeness bonus
                const periodBonus = (period - cfg.minPeriod) * 5;
                const closenessBonus = Math.max(0, cfg.maxMargin - margin) * 3;
                const drama = Math.max(0, Math.min(100, cfg.dramaBase + periodBonus + closenessBonus));
                if (drama < 85) continue;
                const broadcast = comp.broadcasts?.[0]?.names?.[0] || cfg.sport;
                dramatic.push({
                    gameId: ev.id,
                    sport: cfg.sport,
                    home: home?.team?.shortDisplayName || home?.team?.name || '',
                    away: away?.team?.shortDisplayName || away?.team?.name || '',
                    homeScore: hScore, awayScore: aScore,
                    periodLabel: detail || `Period ${period}`,
                    broadcast, drama: Math.round(drama),
                    watchUrl: null,
                    type: 'DRAMA_THRESHOLD',
                });
            }
        } catch(_) { /* sport unavailable — skip */ }
    }

    if (!dramatic.length) return;

    // Get all subscribers from KV
    const list = await env.PUSH_SUBS.list();
    for (const key of list.keys) {
        const raw = await env.PUSH_SUBS.get(key.name);
        if (!raw) continue;
        let subData;
        try { subData = JSON.parse(raw); } catch(_) { continue; }
        const sub = subData.subscription;
        if (!sub?.endpoint) continue;
        const prefs = subData.prefs || {};
        const minDrama = prefs.drama_min || 85;

        for (const game of dramatic) {
            if (game.drama < minDrama) continue;
            const firedKey = `${key.name}:${game.gameId}:DRAMA`;
            const alreadyFired = await env.PUSH_SUBS.get(firedKey);
            if (alreadyFired) continue; // already notified for this game
            try {
                const res = await sendWebPush(sub, game, env);
                if (res.ok || res.status === 201) {
                    // Mark as fired for this session (TTL: 8 hours)
                    await env.PUSH_SUBS.put(firedKey, '1', {expirationTtl: 28800});
                }
            } catch(e) {
                if (typeof captureFieldError === 'function')
                    captureFieldError('push-send', e.message);
            }
        }
    }
}

// ── O(1) Newspaper: Journalism Cycle (Layer 2 — May 25 2026) ─────────────────
// ADR-002 Rule A: generates PROSE ONLY. No game classification server-side.
// No interest level values. No drama scores. Just cached journalism text.
// Runs every */15 min via cron. Fetches ESPN, calls Claude proxy once per
// sport section, stores prose in FIELD_JOURNALISM KV. All users read from KV.
// Client makes ZERO AI calls when relay has fresh content.
// Layer 3 delta: hashes game context before each AI call — skips if unchanged.

const JOURNALISM_CLAUDE_PROXY = 'https://field-claude-proxy.jeffunglesbee.workers.dev';
const JOURNALISM_TTL_SECS = 900; // 15 min — matches cron frequency

async function handleJournalismCycle(env) {
  if (!env.FIELD_JOURNALISM) return; // KV not configured yet
  const now = Date.now();
  const dateKey = new Date().toISOString().slice(0, 10); // "2026-05-25"
  const hour = new Date().getUTCHours();
  // Only run during live hours: 10am-2am UTC (covers US primetime)
  const isLiveHours = hour >= 10 || hour <= 2;
  if (!isLiveHours) return;

  try {
    // 1. Fetch ESPN scoreboard for major leagues (prose only — no classification)
    const LEAGUES = [
      {sport:'basketball',league:'nba'},
      {sport:'hockey',league:'nhl'},
      {sport:'baseball',league:'mlb'},
    ];
    const gameLines = [];
    for (const {sport,league} of LEAGUES) {
      try {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`);
        if (!r.ok) continue;
        const d = await r.json();
        const events = d?.events || [];
        for (const ev of events) {
          const comp = ev.competitions?.[0];
          if (!comp) continue;
          const [home, away] = comp.competitors || [];
          const status = comp.status?.type?.description || '';
          const score = home && away
            ? `${away?.team?.shortDisplayName||''} ${away?.score||0} @ ${home?.team?.shortDisplayName||''} ${home?.score||0}`
            : '';
          const broadcast = comp.broadcasts?.[0]?.names?.[0] || league.toUpperCase();
          if (score) gameLines.push(`${score} · ${status} · ${broadcast}`);
        }
      } catch(_) {}
    }

    if (!gameLines.length) return; // nothing to write about

    // 2. Layer 3: delta hash — skip AI if game context unchanged
    const contextHash = gameLines.join('|').split('').reduce((h,c)=>(Math.imul(31,h)+c.charCodeAt(0))|0,0).toString(16);
    const existingRaw = await env.FIELD_JOURNALISM.get(`journalism:${dateKey}`);
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw);
        if (existing.contextHash === contextHash) return; // no change, skip AI call
      } catch(_) {}
    }

    // 3. Call Claude proxy ONCE — prose only, no classification (ADR-002 Rule A)
    const prompt = [
      'Write a FIELD Brief for tonight\'s sports slate.',
      '',
      'TONIGHT\'S GAMES:',
      ...gameLines.map(l => `- ${l}`),
      '',
      'RULES:',
      '- 100-120 words. 2 short paragraphs. No headers.',
      '- Lead with the most important story.',
      '- CORRECTNESS: write only from the data above. Never invent scores or stats.',
      '- STYLE: specificity over metaphor. Numbers over adjectives. Active voice.',
      '- VOICE: third person only. Write like a columnist, not a chatbot.',
      '- Plain prose only. Complete sentences.',
    ].join('\n');

    const proxyResp = await fetch(JOURNALISM_CLAUDE_PROXY, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{role: 'user', content: prompt}],
      }),
    });

    if (!proxyResp.ok) return;
    const data = await proxyResp.json();
    const prose = (data.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('').trim();
    if (!prose || prose.length < 50) return;

    // 4. Store prose + metadata in KV (ADR-002: prose ONLY, no scores)
    await env.FIELD_JOURNALISM.put(
      `journalism:${dateKey}`,
      JSON.stringify({
        brief: prose,
        generatedAt: now,
        contextHash,
        gameCount: gameLines.length,
        cycleId: crypto.randomUUID(),
      }),
      { expirationTtl: 86400 }
    );
  } catch(e) {
    // Silent fail — client falls back to direct AI call
    console.error('[journalism-cycle] error:', e.message);
  }
}

export default {
    // Cron triggers:
    //   */5  * * * * → push notification heartbeat (drama threshold)
    //   */15 * * * * → journalism cycle (O(1) Newspaper — Layer 2)
    async scheduled(event, env, ctx) {
        ctx.waitUntil(handleCron(env));
        ctx.waitUntil(handleJournalismCycle(env));
    },

    async fetch(request, env, ctx) {
        const url      = new URL(request.url);
        const pathname = url.pathname;

        // /push/subscribe — store push subscription in KV
        if (pathname === '/push/subscribe' && request.method === 'POST') {
            if (!env.PUSH_SUBS) return new Response('KV not configured', {status:503, headers:CORS});
            try {
                const body = await request.json();
                const {subscription, prefs} = body;
                if (!subscription?.endpoint) return new Response('Missing subscription', {status:400, headers:CORS});
                // Key by endpoint hash (first 32 chars, URL-safe)
                const key = 'sub:' + btoa(subscription.endpoint).slice(0,32).replace(/[^a-zA-Z0-9]/g,'');
                await env.PUSH_SUBS.put(key, JSON.stringify({subscription, prefs}), {expirationTtl: 365*86400});
                return new Response(JSON.stringify({ok:true}), {headers:{...CORS,'Content-Type':'application/json'}});
            } catch(e) {
                return new Response(JSON.stringify({ok:false,error:e.message}), {status:500,headers:{...CORS,'Content-Type':'application/json'}});
            }
        }

        // /push/unsubscribe — remove subscription from KV
        if (pathname === '/push/unsubscribe' && request.method === 'POST') {
            if (!env.PUSH_SUBS) return new Response('KV not configured', {status:503, headers:CORS});
            try {
                const {endpoint} = await request.json();
                const key = 'sub:' + btoa(endpoint).slice(0,32).replace(/[^a-zA-Z0-9]/g,'');
                await env.PUSH_SUBS.delete(key);
                return new Response(JSON.stringify({ok:true}), {headers:{...CORS,'Content-Type':'application/json'}});
            } catch(e) {
                return new Response(JSON.stringify({ok:false}), {status:500,headers:{...CORS,'Content-Type':'application/json'}});
            }
        }

        if (pathname === '/health') {
            return new Response('RELAY OK — nba + nhl + fpl + fd + odds + apisports + squiggle + atp + bdl + espn-gambit + espn-summary + dropbox + field-data', {
                status: 200,
                headers: { 'Content-Type': 'text/plain', ...CORS, 'X-FIELD-Proxy': 'relay-multi' }
            });
        }
        // POST /dropbox/upload — Dropbox file upload (FIELD storage)
        if (pathname === '/dropbox/upload' && request.method === 'POST') {
            const filename = url.searchParams.get('filename') || 'upload.html';
            const token = env.DROPBOX_TOKEN;
            if (!token) return new Response('DROPBOX_TOKEN not configured', { status: 500, headers: { ...CORS, 'X-RELAY-Error': 'dropbox-no-token' } });
            const body = await request.arrayBuffer();
            const dbRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Dropbox-API-Arg': JSON.stringify({
                        path: `/${filename}`,
                        mode: 'overwrite',
                        autorename: false,
                        mute: false,
                    }),
                    'Content-Type': 'application/octet-stream',
                },
                body,
            });
            const result = await dbRes.text();
            return new Response(result, {
                status: dbRes.status,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': 'https://jubilant-bassoon.jeffunglesbee.workers.dev',
                    'Access-Control-Allow-Methods': 'POST',
                    'X-FIELD-Proxy': 'relay-dropbox',
                },
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
            const targetUrl = oddsUrl(cleanPath, url.search, env?.ODDS_API_KEY);
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

        // /bdl/* → BallDontLie (player stats, season averages, standings)
        // apiKey injected via Authorization header — env.BDL_API_KEY secret takes priority
        // Falls back to registered key if secret not configured (key already public in FIELD client)
        if (pathname.startsWith('/bdl')) {
            const cleanPath = pathname.replace(/^\/bdl/, '') || '/';
            if (!bdlAllowed(cleanPath))
                return new Response('BDL path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'bdl-path-not-whitelisted', ...CORS } });
            const bdlKey = env?.BDL_API_KEY || '4c881f4b-3845-4542-841f-a0e685c9f10e';
            const targetUrl = `${BDL_BASE}${cleanPath}${url.search || ''}`;
            return relayFetch(targetUrl, { 'Authorization': bdlKey, 'Accept': 'application/json' }, bdlCacheTtl(cleanPath), 'bdl', ctx);
        }


        // /espn-gambit/* → gambit-api-partner.fantasy.espn.com (ESPN WP — CORS bypass)
        // No auth required. ESPN origin headers injected server-side.
        // TTL 25s — shorter than ESPN's Polling-Interval: 30 to avoid serving stale WP.
        if (pathname.startsWith('/espn-gambit')) {
            const cleanPath = pathname.replace(/^\/espn-gambit/, '') || '/';
            if (!espnGambitAllowed(cleanPath))
                return new Response('ESPN Gambit path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'espn-gambit-path-not-whitelisted', ...CORS } });
            const targetUrl = `${ESPN_GAMBIT_BASE}${cleanPath}${url.search || ''}`;
            return relayFetch(targetUrl, ESPN_GAMBIT_HEADERS, ESPN_GAMBIT_TTL, 'espn-gambit', ctx);
        }

        // /espn-summary/* → site.api.espn.com/apis/site/v2 (ESPN WP via summary endpoint)
        // Public REST API; no auth. Origin headers injected server-side.
        // winprobability[].homeWinPercentage — 0-100 scale (e.g. 77.1)
        if (pathname.startsWith('/espn-summary')) {
            const cleanPath = pathname.replace(/^\/espn-summary/, '') || '/';
            if (!espnSummaryAllowed(cleanPath))
                return new Response('ESPN Summary path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'espn-summary-path-not-whitelisted', ...CORS } });
            const targetUrl = `${ESPN_SUMMARY_BASE}${cleanPath}${url.search || ''}`;
            return relayFetch(targetUrl, ESPN_SUMMARY_HEADERS, ESPN_SUMMARY_TTL, 'espn-summary', ctx);
        }

        // /field/data/today — FIELD overlay data layer (matchupNotes, series records, MLB overrides)
        // Source: jubilant-bassoon/outbox/field-data-today.json (raw GitHub, no auth required)
        // Data layer: push that JSON file (with [skip ci]) to update editorial data in ≤5 min.
        // No SW bump, no session, no CI pipeline needed for data-only changes.
        if (pathname === '/field/data/today') {
            const dataUrl = 'https://raw.githubusercontent.com/jeffunglesbee-create/jubilant-bassoon/main/outbox/field-data-today.json';
            return relayFetch(dataUrl, { 'Accept': 'application/json', 'Cache-Control': 'no-cache' }, 300, 'field-data', ctx);
        }

        // /mls/stats/* → stats-api.mlssoccer.com (official MLS stats + live data)
        // Auth-free, CORS-restricted. Provides: match state, scores, goals, schedule, standings.
        // Canonical opta_id team IDs eliminate name-string key collisions in FIELD.
        // ── /mlb-stats/* → MLB Stats API (Item 6 — boxscore + pitcher stats) ──
        // Free, no auth. gamePk from game.sourceId. Provides pitcher IP/K/ERA,
        // team batting avg, box score leaders for journalism depth.
        if (pathname.startsWith('/mlb-stats')) {
            const cleanPath = pathname.replace(/^\/mlb-stats/, '') || '/';
            if (!mlbStatsApiAllowed(cleanPath))
                return new Response('MLB Stats path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'mlb-stats-path-not-whitelisted', ...CORS } });
            const targetUrl = `${MLB_STATS_API_BASE}${cleanPath}${url.search || ''}`;
            return relayFetch(targetUrl, MLB_STATS_API_HEADERS, MLB_STATS_API_TTL, 'mlb-stats', ctx);
        }

        if (pathname.startsWith('/mls/stats')) {
            const cleanPath = pathname.replace(/^\/mls\/stats/, '') || '/';
            if (!mlsStatsAllowed(cleanPath))
                return new Response('MLS Stats path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'mls-stats-path-not-whitelisted', ...CORS } });
            const targetUrl = `${MLS_STATS_BASE}${cleanPath}${url.search || ''}`;
            return relayFetch(targetUrl, MLS_STATS_HEADERS, mlsStatsTtl(cleanPath), 'mls-stats', ctx);
        }

        // ── /journalism/* — O(1) Newspaper: pre-rendered prose from KV ──────────
        // ADR-002: KV stores PROSE ONLY. No classification. No interest values.
        // Client reads this instead of calling AI. Falls back gracefully if empty.
        if (pathname === '/journalism/tonight' || pathname === '/journalism/brief') {
            if (!env.FIELD_JOURNALISM) return new Response(JSON.stringify({error:'not configured'}),{status:503,headers:{...CORS,'Content-Type':'application/json'}});
            const dateKey = new Date().toISOString().slice(0,10);
            const raw = await env.FIELD_JOURNALISM.get(`journalism:${dateKey}`);
            if (!raw) return new Response(JSON.stringify({brief:null,generatedAt:null}),{status:200,headers:{...CORS,'Content-Type':'application/json','Cache-Control':'public,max-age=60'}});
            const data = JSON.parse(raw);
            const age = Math.round((Date.now() - (data.generatedAt||0)) / 1000);
            return new Response(raw, {status:200, headers:{...CORS,'Content-Type':'application/json','Cache-Control':`public,max-age=${Math.max(0,JOURNALISM_TTL_SECS-age)}`,'X-Journalism-Age':`${age}s`,'X-Journalism-Cycle':data.cycleId||''}});
        }

        // ── /realtimesports/* → realtimesportsapi.com/api/v1 ──────────────────
        // JWT Bearer auth injected server-side from env.REALTIMESPORTS_KEY secret.
        // Primary use: NFL live play-by-play schema evaluation + live EPA input.
        // Secret must be set in CF dashboard → field-relay-nba → Settings → Variables.
        if (pathname.startsWith('/realtimesports')) {
            const cleanPath = pathname.replace(/^\/realtimesports/, '') || '/';
            if (!realtimeSportsAllowed(cleanPath))
                return new Response('RealtimeSports path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'realtimesports-not-whitelisted', ...CORS } });
            const rtKey = env.REALTIMESPORTS_KEY;
            if (!rtKey)
                return new Response('REALTIMESPORTS_KEY not configured', { status: 503, headers: { 'X-RELAY-Error': 'realtimesports-no-key', ...CORS } });
            const targetUrl = `${REALTIMESPORTS_BASE}${cleanPath}${url.search || ''}`;
            return relayFetch(targetUrl, { 'Authorization': `Bearer ${rtKey}`, 'Accept': 'application/json' }, realtimeSportsTtl(cleanPath), 'realtimesports', ctx);
        }

        // ── /nba/* → NBA CDN
        const nbaPath = pathname.replace(/^\/nba/, '');
        if (!nbaAllowed(nbaPath)) return new Response('Path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'path-not-whitelisted', ...CORS } });
        const nbaTtl = nbaPath.startsWith('/liveData/standings') ? NBA_STANDINGS_TTL : NBA_CACHE_TTL;
        return relayFetch(`${NBA_CDN_BASE}${nbaPath}`, NBA_HEADERS, nbaTtl, 'nba', ctx);
    },
};
