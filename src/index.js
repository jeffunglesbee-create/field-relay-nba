// ── Durable Object: GameDO (per-game WebSocket fan-out, WOW 1 + WOW 2) ─────
// Built May 31 2026 — Workers Plus active.
// See src/game-do.js for full ADR-002/RUWT compliance documentation.
import { GameDO } from './game-do.js';
export { GameDO };

// ── Journalism Quality Gate (WOW 6 — May 31 2026) ──────────────────────────
// Ports browser-side JQ chain (Layers 1, 2, 2b, 2c, 2d, 2e, 3, 3b) to the
// relay so live journalism flows through structural quality enforcement.
// See src/journalism-quality.js for full documentation.
import {
  FIELD_PROSE_STYLE as JQ_STYLE,
  runQualityChain,
  scoreProse as jqScoreProse,
  hasCliche as jqHasCliche,
  hasCrossSportHallucination as jqHasCrossSport,
} from './journalism-quality.js';

// ── R2 Finals Narrative Context (PM-23 / B1 + TIER 1B salvage — June 3 2026) ─
// Pre-loaded historical narrative depth for the 2026 Finals (SAS vs NYK,
// CAR vs VGK). Injected into the cron slate brief journalism prompt when
// either Finals matchup is on tonight's slate. Phase 1 inline; Phase 2
// R2 migration deferred to WC2026 build week.
// See src/finals-context.js for full documentation and source citations.
import { buildFinalsContextBlock } from './finals-context.js';
import { buildWCTeamContextBlock, slateHasWorldCup } from './wc-team-context.js';
import {
  computeLiveWP,
  computeAdvancementProb,
  oddsToLambda,
  lambdaFromTotalsAndH2H,
  winProbsFromLambda,
} from './soccer-wp.js';

// ── MCP OAuth 2.1 + PKCE + DCR (Tier 1 Phase 2 — June 2 2026 PM-14) ────────
// Adds OAuth surface required for claude.ai's custom-connector MCP discovery.
// /mcp keeps FIELD_MCP_SECRET bearer for CI probes; additionally accepts
// OAuth access tokens minted by /oauth/token (validated via validateBearer).
// See src/mcp-oauth.js for full documentation.
import {
  authServerMetadata as oauthAuthServerMetadata,
  protectedResourceMetadata as oauthProtectedResourceMetadata,
  register as oauthRegister,
  authorizeGet as oauthAuthorizeGet,
  authorizePost as oauthAuthorizePost,
  token as oauthToken,
  revoke as oauthRevoke,
  validateBearer as oauthValidateBearer,
  debugRecentRequests as oauthDebugRecentRequests,
  logRequest as oauthLogRequest,
} from './mcp-oauth.js';

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

// ── stats.nba.com (NBA Stats API) ──────────────────────────────────────────
// Source: stats.nba.com/stats — NBA's public stats site API (officially
//   undocumented but stable; widely used by nba_api, basketball-reference, etc.)
// Auth: none required server-side. Probe-verified June 1 2026: plain curl
//   from a cloud host returns 200 with Access-Control-Allow-Origin: *.
//   The relay still sends browser-like headers (UA + Referer + Origin) as a
//   stability hedge against future upstream tightening / bot heuristics.
// Rule 45 source-clearance: ADR-003 records Jeff's explicit accept-the-risk
//   decision on June 1 2026 (Drive 1XUPoayJUTh2Ki_DYXgw8uOAYZoGtpDt2c7510vGq64w).
//   nba.com/termsofuse restricts NBA Statistics to "legitimate news reporting
//   or private, non-commercial purposes" AND requires "prominent attribution
//   to NBA.com" wherever the data is displayed. App-side consumer MUST surface
//   the attribution. USPTO commercial transition is a re-evaluation trigger.
// Initial scope: /leagueLeaders only. Adding any other endpoint requires
//   a new Rule 45 review (do NOT broaden NBA_STATS_ALLOWED_PATHS without one).
const NBA_STATS_BASE      = 'https://stats.nba.com/stats';
const NBA_STATS_CACHE_TTL = 900; // 15 min — matches NHL playoff leaders cadence
const NBA_STATS_HEADERS = {
    'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer':         'https://www.nba.com/stats/',
    'Origin':          'https://www.nba.com',
    'Accept':          'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control':   'no-cache',
    'Pragma':          'no-cache',
};
const NBA_STATS_ALLOWED_PATHS = [
    '/leagueLeaders',
];
function nbaStatsAllowed(path) {
    // Strip query string before matching; only the path is whitelisted,
    // query-string params (Season, SeasonType, StatCategory, etc.) pass through.
    const cleanPath = path.split('?')[0];
    return NBA_STATS_ALLOWED_PATHS.includes(cleanPath);
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
    'nba':               'v2.nba.api-sports.io',        // dedicated NBA Pro plan — separate quota from basketball
    'basketball':        'v1.basketball.api-sports.io', // WNBA-only after NBA routed to nba host
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
    '/predictions',      // ?fixture= (football/soccer only)
    '/games',            // basketball/hockey/afl/nfl ?live=all
    '/games/',           // /games/statistics/teams?id=  /games/statistics/players?id=
    '/teams',            // ?id= team info + /teams/statistics (season-level)
    '/leagues',          // ?id= (fixture ID lookup utility)
    '/seasons',          // utility — cached 24hr
    '/races',            // F1 /races?season=
    '/rounds',           // F1 /rounds?season=&current=true
    '/events',           // MMA /events
    '/players',          // ?id= player info
    '/players/',         // /players/statistics
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
// Source: site.web.api.espn.com — returns data.plays[] (substitutions) + data.boxscore
// site.api.espn.com only returns WP; site.web.api.espn.com returns full game data
// CORS: locked to espn.com origin — server-side relay required
// Cache: 25s — aligns with FIELD's 30s poll; winprobability[] array is live-updated
// Route: /espn-summary/* → site.web.api.espn.com/apis/site/v2/*
// Usage: /espn-summary/sports/basketball/nba/summary?event={gameId}
const ESPN_SUMMARY_BASE    = 'https://site.web.api.espn.com/apis/site/v2';
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
// CORRECT API STRUCTURE (discovered via Swagger UI May 27 2026):
//   /api/v1/sports/{sport}/leagues/{league}/events/live  — live events
//   /api/v1/sports/{sport}/leagues/{league}/events/{id}/boxscore
//   /api/v1/sports/{sport}/leagues/{league}/teams
//   /api/v1/sports/{sport}/leagues/{league}/athletes
// Route: /realtimesports/* → www.realtimesportsapi.com/api/v1/*
const REALTIMESPORTS_BASE = 'https://www.realtimesportsapi.com/api/v1';
const REALTIMESPORTS_ALLOWED_PREFIXES = [
    '/sports',
];
function realtimeSportsAllowed(path) {
    // Allow any path under /sports/ — broad but gated by auth key
    return path === '/sports' || path.startsWith('/sports/');
}
function realtimeSportsTtl(path) {
    if (path.includes('/events/live'))   return 30;   // live game state
    if (path.includes('/boxscore'))      return 30;   // live box score
    if (path.includes('/plays'))         return 30;   // play-by-play
    if (path.includes('/events'))        return 120;  // schedule/results
    if (path.includes('/athletes'))      return 3600; // roster reference
    if (path.includes('/teams'))         return 3600; // team reference
    return 300;
}

// ── nflverse output files — EPA table + analytics JSON served from repo ──────
// Source: raw.githubusercontent.com/jubilant-bassoon/main/outbox/nfl/{file}
// Files committed by GitHub Actions build pipelines (build-epa-table.yml etc.)
// Route: /nflverse/{file.json} → raw.githubusercontent.com
const NFLVERSE_OUT_ALLOWED = [
    'epa_table.json',
    'team_epa.json',
    'qb_metrics.json',
    'receiver_metrics.json',
    'defense_metrics.json',
    'schedule_refs.json',
    'team_tendencies.json',
    'bdb_route_entropy.json',
    'bdb_xblock_pass_rush.json',
    'bdb_tendency_fingerprint.json',
    'bdb_separation.json',
];
const NFLVERSE_RAW_BASE = 'https://raw.githubusercontent.com/jeffunglesbee-create/jubilant-bassoon/main/outbox/nfl';

// ── SportRadar UFL API — Official real-time play-by-play + full season data ──
// Source: api.sportradar.com/ufl — OFFICIAL data provider (not ESPN proxy)
// Key: env.SPORTRADAR_UFL_KEY (GitHub secret → CF Worker secret via deploy.yml)
// Trial: 30-day trial key MV2ms... expires ~Jun 26 2026. 1 req/sec rate limit.
// Play schema: start_situation.{down, yfd, yardline} + home_points + away_points
//   + play_type + play_action + run_pass_option + fake_punt = ALL EPA fields.
// Route: /sportradar-ufl/{path} → api.sportradar.com/ufl/trial/v7/en/{path}
// Endpoint reference: developer.sportradar.com/football/reference/ufl-overview
const SPORTRADAR_UFL_BASE = 'https://api.sportradar.com/ufl/trial/v7/en';
const SPORTRADAR_UFL_ALLOWED_PREFIXES = [
    '/games',
    '/seasons',
    '/league',
    '/teams',
];
function sportradarUflAllowed(path) {
    return SPORTRADAR_UFL_ALLOWED_PREFIXES.some(p => path === p || path.startsWith(p + '/'));
}
function sportradarUflTtl(path) {
    if (path.includes('/pbp'))       return 30;   // live play-by-play
    if (path.includes('/boxscore'))  return 30;   // live box score
    if (path.includes('/schedule'))  return 300;  // schedule updates
    if (path.includes('/summary'))   return 60;   // game summary
    if (path.includes('/statistics'))return 300;  // stats update each drive
    return 3600; // teams, league hierarchy, rosters
}

// PGA Tour GraphQL relay REMOVED 2026-05-29 (ToS compliance) — pgatour.com ToU bars automated copying/downloading; data is licensed/proprietary. Do not re-add without a licensed feed or counsel sign-off. See jubilant-bassoon docs/data-sourcing-legitimacy-2026-05-29.md
// ── Shared CORS headers ────────────────────────────────────────────────────
const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Expose-Headers': 'X-JQ-Score, X-JQ-Retries, X-JQ-Layers, X-FIELD-Proxy',
};

// ── Umpire ABS scraper helpers ────────────────────────────────────────────────

// Parse umpire data from Next.js __NEXT_DATA__ array format
function _parseUmpireArray(arr) {
    if (!Array.isArray(arr)) return null;
    const out = {};
    for (const item of arr) {
        const name = item?.entity_name || item?.name || item?.umpire_name || '';
        const challenged  = Number(item?.n_challenges   || item?.challenged  || 0);
        const overturned  = Number(item?.n_overturns    || item?.overturned  || 0);
        const rate        = Number(item?.rate_overturns || item?.rate        || 0);
        if (!name || challenged < 3) continue;
        const parts = name.trim().split(/\s+/);
        const last  = parts[parts.length - 1].toLowerCase().replace(/[.']/g, '');
        if (last.length < 2) continue;
        out[last] = { challenged, overturned, rate: Math.round(rate * 1000) / 1000,
                      pitchesCalled: Number(item?.pitches_called || 0),
                      weakness: null, displayName: name };
    }
    return Object.keys(out).length ? out : null;
}

// Parse umpire data from raw HTML via regex (no DOM available in CF Workers)
function _parseUmpireHTML(html) {
    const out = {};
    // Match all <tr> blocks
    const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    for (const [, rowHtml] of rows) {
        // Extract cell text, strip all tags
        const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
            .map(([, inner]) => inner.replace(/<[^>]+>/g, '').replace(/&amp;/g,'&')
                                     .replace(/&#?\w+;/g,'').trim());
        if (cells.length < 4) continue;
        // Find the name cell: not purely numeric, contains a space, length > 4
        let name = '', ni = -1;
        for (let i = 0; i < Math.min(cells.length, 4); i++) {
            if (cells[i] && !/^\d+\.?\d*%?$/.test(cells[i]) && cells[i].includes(' ') && cells[i].length > 4) {
                name = cells[i]; ni = i; break;
            }
        }
        if (!name || ni < 0) continue;
        // Remaining cells should contain: challenged, overturned, rate%, pitches_called
        const nums = cells.slice(ni + 1).map(c => {
            const v = parseFloat(c.replace('%','').trim());
            return isNaN(v) ? null : v;
        });
        // challenged: small integer 3-100
        const challenged = nums.find(n => n !== null && n >= 3 && n <= 200);
        // rate: value that could be 0-1 or 0-100
        const rateRaw = nums.find(n => n !== null && n > 0 && n <= 100);
        if (!challenged || challenged < 3) continue;
        const rate = rateRaw > 1 ? rateRaw / 100 : rateRaw;
        const overturned = Math.round(challenged * rate);
        const parts = name.trim().split(/\s+/);
        const last  = parts[parts.length - 1].toLowerCase().replace(/[.']/g,'');
        if (last.length < 2 || /^\d+$/.test(last)) continue;
        out[last] = { challenged: Math.round(challenged), overturned,
                      rate: Math.round(rate * 1000) / 1000,
                      pitchesCalled: 0, weakness: null, displayName: name };
    }
    return Object.keys(out).length >= 3 ? out : null;
}

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

// Cron handler (ADR-002 Component 3 — independent push checker).
// Sends FACTS only ("score changed"); the client (sw.js computePushDrama +
// Drama Dial) evaluates excitement. Per ADR-002 Rule A/B the relay computes
// NO drama score and NO classification server-side; per Rule D it fires on a
// minimal standalone boolean over raw game state (late phase AND close margin),
// ═══════════════════════════════════════════════════════════════════════════
// V2 NORMALIZED ROUTES — FieldGame schema (Phase 0, May 2026)
// ESPN paths remain live in parallel. This layer is additive only.
// All /v2/* routes disabled on client until FIELD_V2_SOURCES flag is set.
// Spec: docs/espn-pivot-phase0-1-2026-05-29.md
// ADR-002: relay stays a dumb relay — no classification, no interest values.
// ═══════════════════════════════════════════════════════════════════════════

// League IDs for api-sports.io queries, keyed by FIELD sport identifier
// ── WC 2026 pre-game lambda cache ─────────────────────────────────────────────
// Fetches Odds API h2h market once per ~5 min, converts to Poisson lambdas via
// oddsToLambda(), and stores in a module-level Map for use in the WP loop.
// This wires pregameLh/pregameLa into computeLiveWP → source: 'odds-blended'.
let _wcLambdaCache = null;      // Map: 'home|away' → { lh, la }
let _wcLambdaCacheTs  = 0;
const WC_LAMBDA_CACHE_TTL_MS = 5 * 60 * 1000;

async function getWCPregameLambdas(env) {
    if (_wcLambdaCache && (Date.now() - _wcLambdaCacheTs) < WC_LAMBDA_CACHE_TTL_MS) {
        return _wcLambdaCache;
    }
    const key = env.ODDS_API_KEY || ODDS_API_KEY_FALLBACK;
    if (!key) return null;
    try {
        const r = await fetch(
            `https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds?apiKey=${key}&markets=h2h,totals&regions=us,eu&oddsFormat=decimal`,
            { cf: { cacheTtl: 300, cacheEverything: true } }
        );
        if (!r.ok) return null;
        const games = await r.json();
        const cache = new Map();
        for (const game of (Array.isArray(games) ? games : [])) {
            const h2h = { home: 0, draw: 0, away: 0, n: 0 };
            const tot = { line: 0, n: 0 };
            for (const bm of (game.bookmakers || [])) {
                const h2hMkt = (bm.markets || []).find(m => m.key === 'h2h');
                const totMkt = (bm.markets || []).find(m => m.key === 'totals');
                if (h2hMkt) {
                    const hO = h2hMkt.outcomes.find(o => o.name === game.home_team);
                    const aO = h2hMkt.outcomes.find(o => o.name === game.away_team);
                    const dO = h2hMkt.outcomes.find(o => o.name === 'Draw');
                    if (hO && aO && dO) {
                        h2h.home += 1 / hO.price;
                        h2h.draw += 1 / dO.price;
                        h2h.away += 1 / aO.price;
                        h2h.n++;
                    }
                }
                if (totMkt) {
                    const overO = totMkt.outcomes.find(o => o.name === 'Over' && o.point != null);
                    if (overO) { tot.line += overO.point; tot.n++; }
                }
            }
            if (h2h.n === 0) continue;
            const rH = h2h.home / h2h.n, rD = h2h.draw / h2h.n, rA = h2h.away / h2h.n;
            const vigSum = rH + rD + rA;
            if (vigSum <= 0) continue;
            const pH = rH / vigSum, pD = rD / vigSum;
            // Use totals market lambda when available (direct O/U read), else h2h inversion
            const lams = tot.n > 0
                ? lambdaFromTotalsAndH2H(tot.line / tot.n, pH, pD)
                : oddsToLambda(pH, pD, 1 - pH - pD);
            cache.set(`${game.home_team}|${game.away_team}`, lams);
        }
        _wcLambdaCache = cache;
        _wcLambdaCacheTs = Date.now();
        return cache;
    } catch (e) { return null; }
}

// Fuzzy team-name match for lambda lookup (Odds API vs API-Sports name formats).
// Confirmed alias pairs from live /wc/odds-probs probe (June 4 2026).
function wcTeamNameMatch(oddsName, fieldName) {
    if (!oddsName || !fieldName) return false;
    // Normalize: lowercase, NFD decompose (removes diacritics), alphanum+space only
    const norm = s => s.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const a = norm(oddsName), b = norm(fieldName);
    if (a === b) return true;
    // Bidirectional alias table (Odds API ↔ wc26Raw names)
    const ALIASES = {
        'usa':            'united states',
        'united states':  'usa',
        'turkey':         'turkiye',
        'turkiye':        'turkey',
        'czech republic': 'czechia',
        'czechia':        'czech republic',
        'dr congo':       'congo dr',
        'congo dr':       'dr congo',
        'ivory coast':    'cote d ivoire',
        'cote d ivoire':  'ivory coast',
    };
    const aa = ALIASES[a] || a, bb = ALIASES[b] || b;
    if (aa === bb || aa === b || a === bb) return true;
    // 5-char prefix overlap (catches remaining edge cases like short names)
    const pfx = 5;
    if (a.length >= pfx && b.length >= pfx) {
        if (b.includes(a.slice(0, pfx)) || a.includes(b.slice(0, pfx))) return true;
    }
    return false;
}

const V2_LEAGUES = {
    'nba':          { sport: 'nba',        leagueId: null, season: '2025-2026' }, // routes to v2.nba.api-sports.io
    'nhl':          { sport: 'hockey',     leagueId: 57,  season: '2025'      }, // VERIFIED: hockey API requires integer season (2025 = 2025-26 season)
    'mlb':          { sport: 'baseball',   leagueId: 1,   season: '2026'      },
    'wnba':         { sport: 'basketball', leagueId: 13,  season: '2026'      }, // [VERIFY leagueId]
    'epl':          { sport: 'football',   leagueId: 39,  season: '2025'      },
    'mls':          { sport: 'football',   leagueId: 253, season: '2026'      },
    'ucl':          { sport: 'football',   leagueId: 2,   season: '2025'      },
    'europa':       { sport: 'football',   leagueId: 3,   season: '2025'      }, // UEFA Europa League
    'conference':   { sport: 'football',   leagueId: 848, season: '2025'      }, // UEFA Conference League
    'eflchamp':     { sport: 'football',   leagueId: 40,  season: '2025'      }, // EFL Championship
    'eflone':       { sport: 'football',   leagueId: 41,  season: '2025'      }, // EFL League One
    'efltwo':       { sport: 'football',   leagueId: 42,  season: '2025'      }, // EFL League Two
    'laliga':       { sport: 'football',   leagueId: 140, season: '2025'      },
    'seriea':       { sport: 'football',   leagueId: 135, season: '2025'      },
    'bundesliga':   { sport: 'football',   leagueId: 78,  season: '2025'      },
    'ligue1':       { sport: 'football',   leagueId: 61,  season: '2025'      },
    'wc26':         { sport: 'football',   leagueId: 1,   season: '2026'      },
};

// Map api-sports.io status.short → FieldGame state ('pre'|'live'|'final')
// Some upstreams (notably API-NBA) return numeric status codes instead of
// strings — coerce to String() defensively so .toUpperCase() never throws.
function v2State(sport, statusShort) {
    const s = String(statusShort ?? '').toUpperCase();
    if (sport === 'football') {
        if (['1H','2H','HT','ET','P','BT','LIVE'].includes(s)) return 'live';
        if (['FT','AET','PEN','AWD'].includes(s))              return 'final';
        return 'pre';
    }
    // API-NBA integer codes (v2.nba.api-sports.io):
    //   1 = NS, 2-5 = Q1-Q4, 6 = OT, 7 = HT, 8 = FT  [UNVERIFIED — probe before adapter]
    if (sport === 'basketball') {
        // String form (API-BASKETBALL) — original behavior
        if (['Q1','Q2','Q3','Q4','OT','BT','HT'].includes(s)) return 'live';
        if (['FT','AOT','ABD'].includes(s))                    return 'final';
        // Numeric form (API-NBA) — guarded by Rule 8 [UNVERIFIED] marker
        if (['2','3','4','5','6','7'].includes(s)) return 'live';
        if (s === '8')                              return 'final';
        return 'pre';
    }
    if (sport === 'hockey') {
        if (['P1','P2','P3','OT','SO','BT'].includes(s)) return 'live';
        if (['FT','AOT','APN','ABD'].includes(s))        return 'final';
        return 'pre';
    }
    if (sport === 'baseball') {
        if (['FT','FT_IN','POST','PPD','ABD'].includes(s)) return 'final';
        if (['NS','TBD','PST'].includes(s))                return 'pre';
        return 'live'; // BT1-BT9, T1-T9, M1-M9 (top/bot/mid inning)
    }
    return 'pre';
}

// Map raw game + status → { periodNum, periodLabel }
function v2Period(sport, status, game) {
    const s = (status?.short || '').toUpperCase();
    if (sport === 'basketball') {
        const map = { 'Q1':1,'Q2':2,'Q3':3,'Q4':4,'OT':5,'BT':game?.periods?.current||0 };
        const num = map[s] ?? (game?.periods?.current || 0);
        const lbl = { 1:'Q1',2:'Q2',3:'Q3',4:'Q4',5:'OT' }[num] || (num > 4 ? `OT${num-4}` : '');
        return { periodNum: num, periodLabel: lbl };
    }
    if (sport === 'hockey') {
        const map = { 'P1':1,'P2':2,'P3':3,'OT':4,'SO':5 };
        const num = map[s] ?? (game?.periods?.current || 0);
        const lbl = { 1:'1st',2:'2nd',3:'3rd',4:'OT',5:'SO' }[num] || '';
        return { periodNum: num, periodLabel: lbl };
    }
    if (sport === 'baseball') {
        const inn = game?.innings?.current || 0;
        const half = s.startsWith('T') ? 'Top' : s.startsWith('B') ? 'Bot' : s.startsWith('M') ? 'Mid' : '';
        return { periodNum: inn, periodLabel: half ? `${half} ${inn}` : (inn ? `Inn ${inn}` : '') };
    }
    if (sport === 'football') {
        const el = status?.elapsed;
        const clock = el != null ? `${el}'` : '';
        if (s === '1H') return { periodNum: 1, periodLabel: clock || '1st Half' };
        if (s === '2H') return { periodNum: 2, periodLabel: clock || '2nd Half' };
        if (s === 'HT') return { periodNum: 1, periodLabel: 'HT' };
        if (s === 'ET') return { periodNum: 3, periodLabel: clock || 'ET' };
        if (s === 'P')  return { periodNum: 4, periodLabel: 'Pen' };
        return { periodNum: 0, periodLabel: '' };
    }
    return { periodNum: 0, periodLabel: '' };
}

function v2Clock(sport, status) {
    if (!status) return '';
    if (sport === 'football') return status.elapsed != null ? `${status.elapsed}'` : '';
    if (status.timer != null) return String(status.timer);
    return '';
}

// ── Per-sport adapters: raw api-sports.io → FieldGame ───────────────────
// Shape normalization ONLY. No classification, no interest values (ADR-002).
// Field paths marked [VERIFY] should be confirmed against a live response
// before Phase 1 cutover.

function adaptBasketball(g) {
    const sport = 'basketball', state = v2State(sport, g?.status?.short);
    const { periodNum, periodLabel } = v2Period(sport, g?.status, g);
    // Per-quarter scores — VERIFIED 2026-05-30: field is scores.home.quarter_1..4 (not arena.name)
    const qs = ['quarter_1','quarter_2','quarter_3','quarter_4'];
    const homeLS = qs.map(q => g?.scores?.home?.[q]).filter(v => v !== null && v !== undefined);
    const awayLS = qs.map(q => g?.scores?.away?.[q]).filter(v => v !== null && v !== undefined);
    return {
        id:          `bball:${g.id}`,
        sport:       'nba',
        league:      g?.league?.name || 'NBA',
        state,
        start:       g.date || '',
        home:        { name: g?.teams?.home?.name || '', abbr: '', score: g?.scores?.home?.total ?? null, teamId: g?.teams?.home?.id ?? null },
        away:        { name: g?.teams?.away?.name || '', abbr: '', score: g?.scores?.away?.total ?? null, teamId: g?.teams?.away?.id ?? null },
        periodNum,
        periodLabel,
        clock:       v2Clock(sport, g?.status),
        venue:       g?.venue || '',                          // VERIFIED: top-level string, not arena.name
        linescores:  { home: homeLS, away: awayLS },          // VERIFIED: quarter_1..4 present
    };
}

// API-NBA (v2.nba.api-sports.io) — different shape than API-BASKETBALL.
// VERIFIED against live response 2026-05-31:
//   - status.short is INTEGER (3 = Finished, others unmapped — probe required)
//   - status.long is STRING ("Finished", presumably "Not Started"/"Live" etc)
//   - teams.visitors instead of teams.away
//   - scores.home.points instead of scores.home.total
//   - scores.home.linescore[] (array) instead of quarter_1..4 fields
//   - arena.name instead of top-level venue
//   - date.start (object) instead of top-level date string
//   - league is bare string ("standard") not object — hardcode "NBA"
// State mapping uses status.long primary, with .short fallback.
function adaptApiNba(g) {
    // Use status.long (reliable string) as primary state signal.
    const longRaw = String(g?.status?.long ?? '').toLowerCase();
    let state = 'pre';
    if (longRaw === 'finished')                                     state = 'final';
    else if (longRaw.includes('quarter') || longRaw.includes('half')
          || longRaw.includes('overtime') || longRaw === 'live')    state = 'live';
    else                                                            state = 'pre';

    const periodNum = g?.periods?.current || 0;
    const periodLabel = state === 'final' ? '' :
        (periodNum >= 1 && periodNum <= 4) ? `Q${periodNum}` :
        (periodNum > 4) ? `OT${periodNum - 4}` : '';

    const homeLS = Array.isArray(g?.scores?.home?.linescore)
        ? g.scores.home.linescore.map(n => parseInt(n) || 0) : [];
    const awayLS = Array.isArray(g?.scores?.visitors?.linescore)
        ? g.scores.visitors.linescore.map(n => parseInt(n) || 0) : [];

    return {
        id:          `nba:${g.id}`,
        sport:       'nba',
        league:      'NBA',
        state,
        start:       g?.date?.start || '',
        home:        {
            name:   g?.teams?.home?.name || '',
            abbr:   g?.teams?.home?.code || '',
            score:  g?.scores?.home?.points ?? null,
            teamId: g?.teams?.home?.id ?? null,
        },
        away:        {
            name:   g?.teams?.visitors?.name || '',
            abbr:   g?.teams?.visitors?.code || '',
            score:  g?.scores?.visitors?.points ?? null,
            teamId: g?.teams?.visitors?.id ?? null,
        },
        periodNum,
        periodLabel,
        clock:       g?.status?.clock || '',
        venue:       g?.arena?.name || '',
        linescores:  { home: homeLS, away: awayLS },
    };
}

function adaptHockey(g) {
    const sport = 'hockey', state = v2State(sport, g?.status?.short);
    const { periodNum, periodLabel } = v2Period(sport, g?.status, g);
    // api-sports.io sometimes returns null for scores.home.total on finished games.
    // Fallback: sum period scores (periods array) when total is null.
    const sumPeriods = (side) => {
        const periods = g?.scores?.[side]?.periods;
        if (!periods || typeof periods !== 'object') return null;
        const vals = Object.values(periods).map(v => parseInt(v) || 0);
        return vals.length ? vals.reduce((a,b) => a+b, 0) : null;
    };
    const homeScore = g?.scores?.home?.total ?? sumPeriods('home');
    const awayScore = g?.scores?.away?.total ?? sumPeriods('away');
    return {
        id:          g?.id || null,
        sport:       'nhl',
        league:      g?.league?.name || 'NHL',
        state,
        start:       g.date || '',
        home:        { name: g?.teams?.home?.name || '', abbr: '', score: homeScore },
        away:        { name: g?.teams?.away?.name || '', abbr: '', score: awayScore },
        periodNum,
        periodLabel,
        clock:       v2Clock(sport, g?.status),
        venue:       g?.venue || '',
    };
}

function adaptBaseball(g) {
    const sport = 'baseball', state = v2State(sport, g?.status?.short);
    const { periodNum, periodLabel } = v2Period(sport, g?.status, g);
    // VERIFIED 2026-05-30: innings.current does NOT exist. Current inning is encoded in
    // status.short: "T3" = top 3rd, "B5" = bottom 5th, "FT" = finished, "NS" = not started.
    const s = (g?.status?.short || '').toUpperCase();
    const inningNum = (s.startsWith('T') || s.startsWith('B')) ? parseInt(s.slice(1)) || null : null;
    // Per-inning runs: VERIFIED as object keyed "1".."9" + "extra" — not an array
    const homeInnings = g?.scores?.home?.innings || {};
    const awayInnings = g?.scores?.away?.innings || {};
    const inningKeys  = ['1','2','3','4','5','6','7','8','9'];
    const homeLS = inningKeys.map(k => homeInnings[k]).filter(v => v !== null && v !== undefined);
    const awayLS = inningKeys.map(k => awayInnings[k]).filter(v => v !== null && v !== undefined);
    const situation = state === 'live' ? {
        inning:  inningNum,                                     // VERIFIED: parsed from status.short
        isTop:   s.startsWith('T'),
        outs:    null,                                          // not in /games — needs StatsAPI
    } : null;
    return {
        id:          `baseball:${g.id}`,
        sport:       'mlb',
        league:      g?.league?.name || 'MLB',
        state,
        start:       g.date || '',
        home:        { name: g?.teams?.home?.name || '', abbr: '', score: g?.scores?.home?.total ?? null },
        away:        { name: g?.teams?.away?.name || '', abbr: '', score: g?.scores?.away?.total ?? null },
        periodNum,
        periodLabel,
        clock:       '',
        venue:       '',                                        // VERIFIED: not present in baseball response
        situation,
        linescores:  { home: homeLS, away: awayLS },            // per-inning runs (innings 1-9)
    };
}

// ── Football statistics parser (Gap 1) ──────────────────────────────────────
// Parses API-Sports /fixtures/statistics response into a flat stats object.
// Used to populate the situation object in adaptFootball for live games.
function parseFootballStats(statsResponse) {
  const teams = statsResponse?.response || [];
  if (teams.length < 2) return null;

  function getStat(teamStats, type) {
    const found = (teamStats || []).find(s => s.type === type);
    const v = found?.value;
    if (v === null || v === undefined) return 0;
    if (typeof v === 'string') {
      // Handle "62%" possession format
      const n = parseInt(v);
      return isNaN(n) ? 0 : n;
    }
    return typeof v === 'number' ? v : 0;
  }

  const home = teams[0]?.statistics || [];
  const away = teams[1]?.statistics || [];

  return {
    homeSOT:        getStat(home, 'Shots on Goal'),
    awaySOT:        getStat(away, 'Shots on Goal'),
    homeShots:      getStat(home, 'Total Shots'),
    awayShots:      getStat(away, 'Total Shots'),
    homeRedCards:   getStat(home, 'Red Cards'),
    awayRedCards:   getStat(away, 'Red Cards'),
    homeYellows:    getStat(home, 'Yellow Cards'),
    awayYellows:    getStat(away, 'Yellow Cards'),
    homeCorners:    getStat(home, 'Corner Kicks'),
    awayCorners:    getStat(away, 'Corner Kicks'),
    homePossession: getStat(home, 'Ball Possession'),  // parsed as int (e.g. 62 for "62%")
    awayPossession: getStat(away, 'Ball Possession'),
  };
}

// Derive which team has the man advantage from red card counts
// Returns 'home' | 'away' | null
function deriveManAdvantage(stats) {
  if (!stats) return null;
  const hRC = stats.homeRedCards || 0;
  const aRC = stats.awayRedCards || 0;
  if (hRC > aRC) return 'away'; // home has MORE red cards → AWAY has advantage
  if (aRC > hRC) return 'home';
  return null;
}


// v3.football.api-sports.io: response shape differs from v1 — data nested under .fixture
// Gap 1: accepts optional statsData (from /fixtures/statistics) for live games
// Gap 2: returns situation object with WP-relevant fields (mirrors baseball {inning,isTop,outs})
function adaptFootball(item, sportKey, statsData) {
    const fix = item?.fixture || {};
    const status = fix.status || {};
    const sport = 'football', state = v2State(sport, status?.short);
    const { periodNum, periodLabel } = v2Period(sport, status, {});
    const el = status?.elapsed;

    // Build situation object for live games (Gap 2)
    // isStoppage: API reports elapsed=90 but time remains — Gap 5 correction in soccer-wp.js
    const isLive = state === 'live';
    const shortStatus = (status?.short || '').toUpperCase();
    const situation = isLive ? {
        elapsed:        el || 0,
        isStoppage:     el != null && el >= 90,
        isShootout:     shortStatus === 'P' || periodNum === 5,
        manAdvantage:   deriveManAdvantage(statsData),   // 'home' | 'away' | null
        homeSOT:        statsData?.homeSOT        || 0,
        awaySOT:        statsData?.awaySOT        || 0,
        homeShots:      statsData?.homeShots      || 0,
        awayShots:      statsData?.awayShots      || 0,
        homeRedCards:   statsData?.homeRedCards   || 0,
        awayRedCards:   statsData?.awayRedCards   || 0,
        homeCorners:    statsData?.homeCorners    || 0,
        awayCorners:    statsData?.awayCorners    || 0,
        homePossession: statsData?.homePossession || null,
        hasStats:       statsData != null,
    } : null;

    return {
        id:          `football:${fix.id}`,
        sport:       sportKey || 'football',
        league:      item?.league?.name || '',
        state,
        start:       fix.date || '',
        home:        { name: item?.teams?.home?.name || '', abbr: '', score: item?.goals?.home ?? null },
        away:        { name: item?.teams?.away?.name || '', abbr: '', score: item?.goals?.away ?? null },
        periodNum,
        periodLabel,
        clock:       el != null ? `${el}'` : '',
        venue:       fix.venue?.name || '',
        round:       item?.league?.round || '', // WC group detection: "Group Stage - Group A"
        situation,
    };
}

// ── WC D1 helpers ────────────────────────────────────────────────────────
// Relay-is-dumb: these write arithmetic facts (scores/standings) to D1 only.
// No editorial intelligence, no interest levels. Pure score bookkeeping.

// Extract group letter from API-Sports round string:
// "Group Stage - Group A" → 'A'  |  "Group A" → 'A'  |  "Round of 32" → null
function extractWCGroup(round) {
    const m = (round || '').match(/Group\s+([A-L])\b/i);
    return m ? m[1].toUpperCase() : null;
}

// Recompute wc_group standings for one group from wc_results (idempotent)
async function recomputeGroupStandings(db, groupId) {
    await db.prepare('DELETE FROM wc_group WHERE group_id = ?').bind(groupId).run();
    await db.prepare(`
      INSERT INTO wc_group (group_id, team, played, won, drawn, lost, gf, ga, gd, points)
      SELECT group_id, team,
             SUM(played) AS played,
             SUM(won)    AS won,
             SUM(drawn)  AS drawn,
             SUM(lost)   AS lost,
             SUM(gf)     AS gf,
             SUM(ga)     AS ga,
             SUM(gf) - SUM(ga)      AS gd,
             SUM(won)*3 + SUM(drawn) AS points
      FROM (
        SELECT group_id, home AS team, 1 AS played,
               CASE WHEN home_score > away_score THEN 1 ELSE 0 END AS won,
               CASE WHEN home_score = away_score THEN 1 ELSE 0 END AS drawn,
               CASE WHEN home_score < away_score THEN 1 ELSE 0 END AS lost,
               home_score AS gf, away_score AS ga
        FROM wc_results WHERE group_id = ?
        UNION ALL
        SELECT group_id, away AS team, 1 AS played,
               CASE WHEN away_score > home_score THEN 1 ELSE 0 END AS won,
               CASE WHEN away_score = home_score THEN 1 ELSE 0 END AS drawn,
               CASE WHEN away_score < home_score THEN 1 ELSE 0 END AS lost,
               away_score AS gf, home_score AS ga
        FROM wc_results WHERE group_id = ?
      ) r
      GROUP BY group_id, team
    `).bind(groupId, groupId).run();
}

// Write a final WC group-stage result to D1 (INSERT OR IGNORE = idempotent)
async function writeWCResult(db, game) {
    const groupId = extractWCGroup(game.round);
    if (!groupId) return; // knockout stage or no round info — skip
    const matchDate = (game.start || '').slice(0, 10);
    const homeScore = game.home?.score ?? 0;
    const awayScore = game.away?.score ?? 0;
    await db.prepare(`
      INSERT OR IGNORE INTO wc_results
        (game_id, group_id, home, away, home_score, away_score, phase, match_date)
      VALUES (?, ?, ?, ?, ?, ?, 'group', ?)
    `).bind(game.id, groupId, game.home?.name || '', game.away?.name || '',
            homeScore, awayScore, matchDate).run();
    await recomputeGroupStandings(db, groupId);
}

// GET /wc/standings[?group=A]  — return D1 standings as JSON
async function handleWCStandings(url, env) {
    if (!env.WC2026_DB)
        return new Response(JSON.stringify({ error: 'WC2026_DB not bound' }),
            { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const filterGroup = (url.searchParams.get('group') || '').toUpperCase() || null;
    const sql = filterGroup
        ? 'SELECT * FROM wc_group WHERE group_id = ? ORDER BY points DESC, gd DESC, gf DESC'
        : 'SELECT * FROM wc_group ORDER BY group_id ASC, points DESC, gd DESC, gf DESC';
    const { results } = filterGroup
        ? await env.WC2026_DB.prepare(sql).bind(filterGroup).all()
        : await env.WC2026_DB.prepare(sql).all();
    // Group by group_id for client convenience
    const grouped = {};
    for (const row of results) {
        if (!grouped[row.group_id]) grouped[row.group_id] = [];
        grouped[row.group_id].push(row);
    }
    return new Response(JSON.stringify({ groups: grouped, ts: Date.now() }),
        { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' } });
}

// GET /wc/results[?group=A] — per-match scores from wc_results D1 table.
// Enables browser-side H2H tiebreaker computation (FIFA tiebreakers 4-6).
// Returns [] before tournament starts (table is empty).
async function handleWCResults(url, env) {
    if (!env.WC2026_DB)
        return new Response(JSON.stringify({ error: 'WC2026_DB not bound' }),
            { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const filterGroup = (url.searchParams.get('group') || '').toUpperCase() || null;
    const sql = filterGroup
        ? 'SELECT * FROM wc_results WHERE group_id = ? ORDER BY match_date ASC'
        : 'SELECT * FROM wc_results ORDER BY group_id ASC, match_date ASC';
    const { results } = filterGroup
        ? await env.WC2026_DB.prepare(sql).bind(filterGroup).all()
        : await env.WC2026_DB.prepare(sql).all();
    return new Response(JSON.stringify({ results, ts: Date.now() }),
        { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=30' } });
}

// GET /wc/third-place — return third-place standings cross-group
async function handleWCThirdPlace(env) {
    if (!env.WC2026_DB)
        return new Response(JSON.stringify({ error: 'WC2026_DB not bound' }),
            { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const { results } = await env.WC2026_DB.prepare(
        'SELECT * FROM wc_third_place_standings'
    ).all();
    return new Response(JSON.stringify({ third_place: results, ts: Date.now() }),
        { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' } });
}

// GET /wc/odds-probs — no-vig match probabilities + Poisson lambdas from Odds API.
// Fetches h2h + totals markets. Totals O/U line gives λ_total directly;
// binary-search lambdaFromTotalsAndH2H resolves λ_home/λ_away without iteration.
// Budget: 2 credits per call (markets=h2h,totals). CF edge-cached 5 min.
async function handleWCOddsProbs(env) {
    const key = env.ODDS_API_KEY || ODDS_API_KEY_FALLBACK;
    if (!key) {
        return new Response(JSON.stringify({ ok: false, probs: [], error: 'ODDS_API_KEY not configured' }),
            { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    try {
        const resp = await fetch(
            `https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds?apiKey=${key}&markets=h2h,totals&regions=us,eu&oddsFormat=decimal`,
            { cf: { cacheTtl: 300, cacheEverything: true } }
        );
        if (!resp.ok) {
            return new Response(JSON.stringify({ ok: false, probs: [], error: `Odds API ${resp.status}` }),
                { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        const games = await resp.json();
        const probs = [];
        for (const game of (Array.isArray(games) ? games : [])) {
            // ── h2h: no-vig implied probs across bookmakers ──────────────────
            const h2h = { home: 0, draw: 0, away: 0, n: 0 };
            const tot = { over: 0, line: 0, n: 0 };  // totals accumulator
            for (const bm of (game.bookmakers || [])) {
                const h2hMkt  = (bm.markets || []).find(m => m.key === 'h2h');
                const totMkt  = (bm.markets || []).find(m => m.key === 'totals');
                if (h2hMkt) {
                    const hO = h2hMkt.outcomes.find(o => o.name === game.home_team);
                    const aO = h2hMkt.outcomes.find(o => o.name === game.away_team);
                    const dO = h2hMkt.outcomes.find(o => o.name === 'Draw');
                    if (hO && aO && dO) {
                        h2h.home += 1 / hO.price;
                        h2h.draw += 1 / dO.price;
                        h2h.away += 1 / aO.price;
                        h2h.n++;
                    }
                }
                if (totMkt) {
                    const overO = totMkt.outcomes.find(o => o.name === 'Over' && o.point != null);
                    if (overO) { tot.over += 1 / overO.price; tot.line += overO.point; tot.n++; }
                }
            }
            if (h2h.n === 0) continue;
            const rH = h2h.home / h2h.n, rD = h2h.draw / h2h.n, rA = h2h.away / h2h.n;
            const vigSum = rH + rD + rA;
            if (vigSum <= 0) continue;
            const pH = rH / vigSum, pD = rD / vigSum, pA = rA / vigSum;
            // ── λ computation: prefer totals market, fall back to oddsToLambda ──
            let lh, la, lambdaSource;
            if (tot.n > 0) {
                const lambdaTotal = tot.line / tot.n;  // average O/U line
                const lams = lambdaFromTotalsAndH2H(lambdaTotal, pH, pD);
                lh = lams.lh; la = lams.la;
                lambdaSource = 'totals';
            } else {
                const lams = oddsToLambda(pH, pD, pA);
                lh = lams.lh; la = lams.la;
                lambdaSource = 'h2h-inversion';
            }
            probs.push({
                home_team:    game.home_team,
                away_team:    game.away_team,
                commence:     game.commence_time,
                pHome:        parseFloat(pH.toFixed(4)),
                pDraw:        parseFloat(pD.toFixed(4)),
                pAway:        parseFloat(pA.toFixed(4)),
                lambdaHome:   parseFloat(lh.toFixed(3)),
                lambdaAway:   parseFloat(la.toFixed(3)),
                lambdaTotal:  parseFloat((lh + la).toFixed(3)),
                lambdaSource,
                bookmakers:   h2h.n,
            });
        }
        return new Response(JSON.stringify({
            ok: true,
            probs,
            remaining: resp.headers.get('x-requests-remaining') || 'unknown',
            ts: Date.now(),
        }), { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' } });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, probs: [], error: e.message }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
}


// GET /cfl/odds-probs — no-vig win probabilities for CFL games from Odds API.
// CFL has no draw market — h2h is home/away only. Includes spread + total lines.
// Budget: 2 credits per call (markets=h2h,spreads,totals). CF edge-cached 2 min.
async function handleCFLOddsProbs(env) {
    const key = env.ODDS_API_KEY || ODDS_API_KEY_FALLBACK;
    if (!key) {
        return new Response(JSON.stringify({ ok: false, probs: [], error: 'ODDS_API_KEY not configured' }),
            { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    try {
        const resp = await fetch(
            `https://api.the-odds-api.com/v4/sports/americanfootball_cfl/odds?apiKey=${key}&markets=h2h,spreads,totals&regions=us,eu&oddsFormat=decimal`,
            { cf: { cacheTtl: 120, cacheEverything: true } }
        );
        if (!resp.ok) {
            return new Response(JSON.stringify({ ok: false, probs: [], error: `Odds API ${resp.status}` }),
                { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        const games = await resp.json();
        const probs = [];
        for (const game of (Array.isArray(games) ? games : [])) {
            // CFL: no draw — h2h has home/away only
            const h2h    = { home: 0, away: 0, n: 0 };
            const spread = { line: 0, n: 0 };
            const tot    = { line: 0, n: 0 };
            for (const bm of (game.bookmakers || [])) {
                const h2hMkt = (bm.markets || []).find(m => m.key === 'h2h');
                const spMkt  = (bm.markets || []).find(m => m.key === 'spreads');
                const totMkt = (bm.markets || []).find(m => m.key === 'totals');
                if (h2hMkt) {
                    const hO = h2hMkt.outcomes.find(o => o.name === game.home_team);
                    const aO = h2hMkt.outcomes.find(o => o.name === game.away_team);
                    if (hO && aO) { h2h.home += 1 / hO.price; h2h.away += 1 / aO.price; h2h.n++; }
                }
                if (spMkt) {
                    const hO = spMkt.outcomes.find(o => o.name === game.home_team && o.point != null);
                    if (hO) { spread.line += hO.point; spread.n++; }
                }
                if (totMkt) {
                    const ov = totMkt.outcomes.find(o => o.name === 'Over' && o.point != null);
                    if (ov) { tot.line += ov.point; tot.n++; }
                }
            }
            if (h2h.n === 0) continue;
            const vigSum = (h2h.home + h2h.away) / h2h.n;
            if (vigSum <= 0) continue;
            const pH = (h2h.home / h2h.n) / vigSum;
            const pA = (h2h.away / h2h.n) / vigSum;
            probs.push({
                home_team:  game.home_team,
                away_team:  game.away_team,
                commence:   game.commence_time,
                pHome:      parseFloat(pH.toFixed(4)),
                pAway:      parseFloat(pA.toFixed(4)),
                spread:     spread.n > 0 ? parseFloat((spread.line / spread.n).toFixed(1)) : null,
                total:      tot.n    > 0 ? parseFloat((tot.line    / tot.n   ).toFixed(1)) : null,
                bookmakers: h2h.n,
            });
        }
        return new Response(JSON.stringify({
            ok: true,
            probs,
            remaining: resp.headers.get('x-requests-remaining') || 'unknown',
            ts: Date.now(),
        }), { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=120' } });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, probs: [], error: e.message }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
}

// GET /wc/wp/verify — Gap 4: verify Odds API covers soccer_fifa_world_cup
// Tests that the WC sport key exists and returns active markets.
// Safe to call any time — read-only, no writes.
async function handleWCWPVerify(env) {
    const key = env.ODDS_API_KEY || ODDS_API_KEY_FALLBACK;
    try {
        const resp = await fetch(
            `https://api.the-odds-api.com/v4/sports?apiKey=${key}`,
            { cf: { cacheTtl: 3600, cacheEverything: true } }
        );
        if (!resp.ok) {
            return new Response(JSON.stringify({ ok: false, error: `Odds API ${resp.status}` }),
                { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        const sports = await resp.json();
        const wc = Array.isArray(sports)
            ? sports.find(s => s.key === 'soccer_fifa_world_cup')
            : null;
        return new Response(JSON.stringify({
            ok:        !!wc,
            wcSport:   wc || null,
            message:   wc ? `soccer_fifa_world_cup confirmed active=${wc.active}` : 'soccer_fifa_world_cup NOT FOUND',
            remaining: resp.headers.get('x-requests-remaining') || 'unknown',
            ts:        Date.now(),
        }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
}


// Body: { game_id, group_id, home, away, home_score, away_score, match_date }
// Gated by FIELD_MCP_SECRET (same as other admin endpoints)
async function handleWCAdminSeed(request, env) {
    const auth = (request.headers.get('Authorization') || '').replace('Bearer ', '');
    if (auth !== env.FIELD_MCP_SECRET)
        return new Response('Unauthorized', { status: 401, headers: CORS });
    if (!env.WC2026_DB)
        return new Response('WC2026_DB not bound', { status: 503, headers: CORS });
    let body;
    try { body = await request.json(); } catch { return new Response('Invalid JSON', { status: 400, headers: CORS }); }
    const { game_id, group_id, home, away, home_score, away_score, match_date } = body || {};
    if (!game_id || !group_id || !home || !away)
        return new Response('Missing required fields: game_id, group_id, home, away', { status: 400, headers: CORS });
    await env.WC2026_DB.prepare(`
      INSERT OR REPLACE INTO wc_results
        (game_id, group_id, home, away, home_score, away_score, phase, match_date)
      VALUES (?, ?, ?, ?, ?, ?, 'group', ?)
    `).bind(game_id, group_id.toUpperCase(), home, away,
            parseInt(home_score)||0, parseInt(away_score)||0,
            match_date || new Date().toISOString().slice(0,10)).run();
    await recomputeGroupStandings(env.WC2026_DB, group_id.toUpperCase());
    const { results } = await env.WC2026_DB.prepare(
        'SELECT * FROM wc_group WHERE group_id = ? ORDER BY points DESC, gd DESC, gf DESC'
    ).bind(group_id.toUpperCase()).all();
    return new Response(JSON.stringify({ ok: true, group: group_id.toUpperCase(), standings: results }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// ── /v2/games route handler ──────────────────────────────────────────────
// GET /v2/games?sport=nba|nhl|mlb|epl|mls[&date=YYYY-MM-DD]
// Returns: { sport, date, games: FieldGame[], count, source, ts }
async function handleV2Games(url, env) {
    const sport = (url.searchParams.get('sport') || '').toLowerCase();
    const date  = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const cfg   = V2_LEAGUES[sport];
    if (!cfg)
        return new Response(JSON.stringify({ error: `Unknown sport: ${sport}`, supported: Object.keys(V2_LEAGUES) }),
            { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const key = env.APISPORTS_KEY;
    if (!key)
        return new Response(JSON.stringify({ error: 'APISPORTS_KEY not configured' }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const host = APISPORTS_HOSTS[cfg.sport];
    let targetUrl, adapt;
    if (cfg.sport === 'nba') {
        // API-NBA: dedicated Pro plan at v2.nba.api-sports.io — no league/season params, date only.
        // Separate quota from API-BASKETBALL (WNBA uses basketball + league=13).
        // Response shape differs from API-BASKETBALL — use adaptApiNba (verified 2026-05-31).
        targetUrl = `https://${host}/games?date=${date}`;
        adapt = items => items.map(adaptApiNba);
    } else if (cfg.sport === 'football') {
        targetUrl = `https://${host}/fixtures?league=${cfg.leagueId}&season=${cfg.season}&date=${date}`;
        // adapt set to null — football handled separately below with stats enrichment
        adapt = null;
    } else {
        targetUrl = `https://${host}/games?league=${cfg.leagueId}&season=${cfg.season}&date=${date}`;
        if (cfg.sport === 'basketball') adapt = items => items.map(adaptBasketball);
        else if (cfg.sport === 'hockey')  adapt = items => items.map(adaptHockey);
        else if (cfg.sport === 'baseball') adapt = items => items.map(adaptBaseball);
        else adapt = x => x;
    }
    try {
        const resp = await fetch(targetUrl, {
            headers: { 'x-apisports-key': key, 'Accept': 'application/json' },
            cf: { cacheTtl: 30, cacheEverything: false },
        });
        if (!resp.ok)
            return new Response(JSON.stringify({ error: `Upstream ${resp.status}`, sport, date }),
                { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
        const data  = await resp.json();
        const raw   = data?.response || [];

        // RUWT debug mode: ?debug=1 returns the raw response shape without adapting.
        // Used to verify field paths against actual upstream data before writing
        // adapter logic. Safe to leave in: only fires when ?debug=1 is explicitly passed.
        if (url.searchParams.get('debug') === '1') {
            return new Response(JSON.stringify({
                sport, date,
                upstream_status: resp.status,
                upstream_results: data?.results ?? null,
                first_game_raw: raw[0] || null,
                game_count: raw.length,
                ts: Date.now(),
            }, null, 2), { headers: { ...CORS, 'Content-Type': 'application/json' } });
        }

        // ── Football: stats fetch + WP computation (Gaps 1-3, 5-6) ─────────────
        // For football sport types, adapt with optional live statistics.
        // For all other sports, use the adapt() function set above.
        let games;
        if (cfg.sport === 'football') {
            // Gap 1: identify live fixtures; fetch /fixtures/statistics in parallel
            const LIVE_STATUS = new Set(['1H','HT','2H','ET','BT','P','LIVE']);
            const liveFixIds = raw
                .filter(f => LIVE_STATUS.has((f?.fixture?.status?.short || '').toUpperCase()))
                .map(f => f?.fixture?.id)
                .filter(Boolean);

            // Fetch stats for each live fixture in parallel (non-blocking failures tolerated)
            const statsMap = {};
            if (liveFixIds.length > 0) {
                const statsPromises = liveFixIds.map(async fId => {
                    try {
                        const sr = await fetch(
                            `https://${host}/fixtures/statistics?fixture=${fId}`,
                            { headers: { 'x-apisports-key': key, 'Accept': 'application/json' },
                              cf: { cacheTtl: 30, cacheEverything: false } }
                        );
                        if (!sr.ok) return { fId, stats: null };
                        return { fId, stats: parseFootballStats(await sr.json()) };
                    } catch (_) { return { fId, stats: null }; }
                });
                const settled = await Promise.allSettled(statsPromises);
                for (const r of settled) {
                    if (r.status === 'fulfilled' && r.value?.stats) {
                        statsMap[r.value.fId] = r.value.stats;
                    }
                }
            }

            // Adapt all fixtures — live ones with stats attached (Gap 1+2)
            games = raw.map(f => adaptFootball(f, sport, statsMap[f?.fixture?.id] || null));

            // Pre-fetch WC pre-game lambdas once (non-blocking; degrades gracefully if unavailable)
            const wcLambdas = sport === 'wc26' ? await getWCPregameLambdas(env) : null;

            // Gap 3+5+6: WP computation for live games
            for (const g of games) {
                if (g.state !== 'live' || !g.situation) continue;
                const { situation: sit } = g;
                const hGoals = g.home.score ?? 0;
                const aGoals = g.away.score ?? 0;

                // v1.3.2.1: resolve pre-game λ from Odds API cache for odds-blended source
                let pregameLh = null, pregameLa = null;
                if (wcLambdas) {
                    // Try direct match first, then fuzzy cross-match
                    const directKey = `${g.home.name}|${g.away.name}`;
                    if (wcLambdas.has(directKey)) {
                        const lams = wcLambdas.get(directKey);
                        pregameLh = lams.lh; pregameLa = lams.la;
                    } else {
                        // Iterate for fuzzy match
                        for (const [k, lams] of wcLambdas) {
                            const [oddsHome, oddsAway] = k.split('|');
                            if (wcTeamNameMatch(oddsHome, g.home.name) && wcTeamNameMatch(oddsAway, g.away.name)) {
                                pregameLh = lams.lh; pregameLa = lams.la; break;
                            }
                            if (wcTeamNameMatch(oddsHome, g.away.name) && wcTeamNameMatch(oddsAway, g.home.name)) {
                                pregameLh = lams.la; pregameLa = lams.lh; break; // reversed
                            }
                        }
                    }
                }

                // Gap 2+5: compute live win probability with stoppage correction + pre-game λ
                const wp = computeLiveWP({
                    homeGoals:    hGoals,
                    awayGoals:    aGoals,
                    homeSOT:      sit.homeSOT,
                    awaySOT:      sit.awaySOT,
                    elapsedMin:   sit.elapsed,
                    isStoppage:   sit.isStoppage,
                    manAdvantage: sit.manAdvantage,
                    isShootout:   sit.isShootout,
                    pregameLh,    // null when odds unavailable → shots-proxy fallback
                    pregameLa,
                });
                g.winProb = wp;

                // Gap 3: advancement probability for WC group stage games
                if (sport === 'wc26' && env.WC2026_DB) {
                    const gLetter = extractWCGroup(g.round);
                    if (gLetter) {
                        try {
                            const [standingsRes, thirdRes] = await Promise.allSettled([
                                env.WC2026_DB.prepare(
                                    'SELECT * FROM wc_group WHERE group_id = ? ORDER BY points DESC, gd DESC, gf DESC'
                                ).bind(gLetter).all(),
                                env.WC2026_DB.prepare(
                                    'SELECT * FROM wc_third_place_standings'
                                ).all(),
                            ]);
                            const standings = standingsRes.status === 'fulfilled'
                                ? standingsRes.value?.results : [];
                            const thirdPlace = thirdRes.status === 'fulfilled'
                                ? thirdRes.value?.results : null;
                            if (standings?.length) {
                                g.advancementProb = computeAdvancementProb(
                                    standings, g.home.name, g.away.name, wp, thirdPlace
                                );
                            }
                        } catch (_) {} // non-blocking
                    }
                }

                // Gap 6: named soccer CRUNCH conditions + GameDO broadcast
                // Relay-is-dumb: classifying factual game state (binary conditions)
                // Drama assessment stays client-side. Only factual states here.
                const scoreDiff = Math.abs(hGoals - aGoals);
                let crunchCondition = null;
                if      (sit.isShootout)                          crunchCondition = 'penalty_shootout';
                else if (sit.manAdvantage && scoreDiff <= 1)      crunchCondition = 'man_advantage';
                else if (sit.isStoppage   && scoreDiff <= 1)      crunchCondition = 'added_time';
                else if (sit.elapsed > 60 && scoreDiff > 0) {
                    // WP < 15% for trailing team late in game → near-decided
                    const loserWP = hGoals > aGoals ? wp.awayWin : wp.homeWin;
                    if (loserWP < 0.15)                           crunchCondition = 'late_deficit';
                }
                if (crunchCondition) {
                    g._crunch = crunchCondition;
                    // Fire CRUNCH signal to GameDO for fan-out to connected clients
                    if (env.GAME_DO) {
                        try {
                            const doId   = env.GAME_DO.idFromName(g.id);
                            const doStub = env.GAME_DO.get(doId);
                            // Internal fetch — non-blocking, fire-and-forget
                            doStub.fetch(new Request('https://field/crunch', {
                                method:  'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body:    JSON.stringify({ condition: crunchCondition, gameId: g.id, ts: Date.now() }),
                            })).catch(() => {}); // swallow — CRUNCH failure must not fail main response
                        } catch (_) {}
                    }
                }
            }

            // ── GameDO WP state updates (parallel across all live games) ────────────
            // Writes openingWP + lastWP + wpHistory to each game's DO instance.
            // Returns wpDelta + openingWP + recentHistory for attachment to game object.
            // Parallel to minimise added latency (typically 1-2ms per DO round-trip).
            if (env.GAME_DO) {
                const liveWithWP = games.filter(g => g.state === 'live' && g.winProb);
                if (liveWithWP.length > 0) {
                    const wpResults = await Promise.allSettled(
                        liveWithWP.map(async g => {
                            const doStub = env.GAME_DO.get(env.GAME_DO.idFromName(g.id));
                            const resp = await doStub.fetch(new Request('https://field/wp', {
                                method:  'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body:    JSON.stringify({
                                    wp:          g.winProb,
                                    elapsed:     g.situation?.elapsed ?? null,
                                    advanceProb: g.advancementProb ?? null,
                                    ts:          Date.now(),
                                }),
                            }));
                            if (!resp.ok) return null;
                            return { g, state: await resp.json() };
                        })
                    );
                    for (const result of wpResults) {
                        if (result.status !== 'fulfilled' || !result.value?.state?.ok) continue;
                        const { g, state } = result.value;
                        g.openingWP          = state.openingWP          ?? null;
                        g.wpDelta            = state.wpDelta            ?? null;
                        g.recentWPHistory    = state.recentHistory      ?? [];
                        g.openingAdvanceProb = state.openingAdvanceProb ?? null;
                    }
                }
            }
        } else {
            games = adapt(raw);
        }


        // WC D1 auto-write (wc26 only) — idempotent INSERT OR IGNORE
        // Relay-is-dumb: writes scores only, no interest-level computation.
        if (sport === 'wc26' && env.WC2026_DB) {
            const finals = games.filter(g => g.state === 'final');
            if (finals.length > 0) {
                await Promise.allSettled(finals.map(g => writeWCResult(env.WC2026_DB, g)));
            }
        }

        return new Response(
            JSON.stringify({ sport, date, games, count: games.length, source: 'apisports', ts: Date.now() }),
            { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' } }
        );
    } catch(e) {
        return new Response(JSON.stringify({ error: e.message, sport, date }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
}

// ── /v2/standings route handler ──────────────────────────────────────────
// GET /v2/standings?sport=nba|nhl|mlb|epl|mls
// Returns raw api-sports.io standings response wrapped with metadata
async function handleV2Standings(url, env) {
    const sport = (url.searchParams.get('sport') || '').toLowerCase();
    const cfg   = V2_LEAGUES[sport];
    if (!cfg)
        return new Response(JSON.stringify({ error: `Unknown sport: ${sport}` }),
            { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const key = env.APISPORTS_KEY;
    if (!key)
        return new Response(JSON.stringify({ error: 'APISPORTS_KEY not configured' }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const host = APISPORTS_HOSTS[cfg.sport];
    const targetUrl = `https://${host}/standings?league=${cfg.leagueId}&season=${cfg.season}`;
    try {
        const resp = await fetch(targetUrl, {
            headers: { 'x-apisports-key': key, 'Accept': 'application/json' },
            cf: { cacheTtl: 3600, cacheEverything: false },
        });
        if (!resp.ok)
            return new Response(JSON.stringify({ error: `Upstream ${resp.status}` }),
                { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
        const data = await resp.json();
        return new Response(
            JSON.stringify({ sport, standings: data?.response || [], source: 'apisports', ts: Date.now() }),
            { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } }
        );
    } catch(e) {
        return new Response(JSON.stringify({ error: e.message }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
}

// never on an aggregated value crossing a threshold. Conforms code to the
// documented architecture only — legal sufficiency is counsel's call
// (ADR-002 PROPOSED; Numerical Usage Policy v2 bright line: never push on a
// composite-value threshold).

async function handleCron(env) {
    if (!env.PUSH_SUBS) return; // KV not configured
    const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';

    // ── Multi-sport ESPN polling ──────────────────────────────────
    // minPeriod/maxMargin are per-dimension FACTUAL gates over raw game
    // state (late phase, close margin). They are separate logical gates,
    // never summed into a score. No dramaBase — no composite exists.
    const SPORT_CONFIG = [
        {sport:'NBA', path:'basketball/nba',  minPeriod:3, maxMargin:10},
        {sport:'NHL', path:'hockey/nhl',      minPeriod:3, maxMargin:3 },
        {sport:'MLB', path:'baseball/mlb',    minPeriod:7, maxMargin:4 },
        {sport:'NFL', path:'football/nfl',    minPeriod:3, maxMargin:10},
        {sport:'MLS', path:'soccer/usa.1',    minPeriod:2, maxMargin:2 },
        {sport:'EPL', path:'soccer/eng.1',    minPeriod:2, maxMargin:2 },
    ];

    const live = [];
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
                const [home, away] = comp.competitors || [];
                const hScore = parseInt(home?.score||'0');
                const aScore = parseInt(away?.score||'0');
                const margin = Math.abs(hScore - aScore);

                // STANDALONE BOOLEAN (ADR-002 Rule D): late phase AND close
                // margin — two raw-data dimensional gates, logically ANDed.
                // No score, no sum, no aggregated-value threshold.
                const latePhase = period >= cfg.minPeriod;
                const closeGame = margin <= cfg.maxMargin;
                if (!(latePhase && closeGame)) continue;

                const broadcast = comp.broadcasts?.[0]?.names?.[0] || cfg.sport;
                live.push({
                    type: 'SCORE_CHANGE',          // facts only — client evaluates excitement
                    gameId: ev.id,
                    sport: cfg.sport,
                    home: home?.team?.shortDisplayName || home?.team?.name || '',
                    away: away?.team?.shortDisplayName || away?.team?.name || '',
                    homeScore: hScore, awayScore: aScore,
                    period: comp.status?.type?.shortDetail || detail || `Period ${period}`,
                    clock: comp.status?.displayClock || '',
                    broadcast,
                    watchUrl: null,
                });
            }
        } catch(_) { /* sport unavailable — skip */ }
    }

    if (!live.length) return;

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
        // Factual opt-in only. No interest-value threshold here — the client
        // applies the user's Drama Dial. drama_min is intentionally removed
        // (it thresholded a server-side composite). If the subscriber has a
        // sport allowlist, honor it as a factual filter.
        const sportAllow = Array.isArray(prefs.sports) ? prefs.sports : null;

        for (const game of live) {
            if (sportAllow && !sportAllow.includes(game.sport)) continue;
            // Dedup on the SCORE STATE so a genuine score change re-notifies
            // (matches the SCORE_CHANGE contract), rather than once-per-game.
            const firedKey = `${key.name}:${game.gameId}:${game.homeScore}-${game.awayScore}`;
            const alreadyFired = await env.PUSH_SUBS.get(firedKey);
            if (alreadyFired) continue;
            try {
                const res = await sendWebPush(sub, game, env);
                if (res.ok || res.status === 201) {
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
//
// Journalism Quality Layers (all three now active in relay):
//   Layer 1: full FIELD_PROSE_STYLE + BANNED_PHRASES + lead sentence rule
//   Layer 2: post-generation cliché detection + one retry before KV store
//   Layer 3: prose score gate — re-prompt if score < 55 (specificity/variety/density)
// Fix 5: richer ESPN context — series records, scoring leaders, game situation

const JOURNALISM_CLAUDE_PROXY = 'https://field-claude-proxy.jeffunglesbee.workers.dev';
const JOURNALISM_TTL_SECS = 900; // 15 min — matches cron frequency

// ── Layer 1: banned phrases (mirrors index.html BANNED_PHRASES) ───────────────
const RELAY_BANNED = [
  'punch their ticket','the stage is set','make a statement',
  'facing a must-win','looking to bounce back','all eyes on',
  'put the league on notice','a tale of two halves','rise to the occasion',
  'backs against the wall','do-or-die','prove the doubters wrong',
  'send a message','weather the storm','turn the page',
  'take care of business','control their own destiny','gut check',
  'step up when it matters','battle-tested','high-octane',
  'in the driver\'s seat','cement their legacy','the chess match continues',
  'must-win situation','pivotal matchup','will look to',
  // P0.2 additions (June 4 2026): clunky wire-copy patterns observed in Morning Report
  'secured a victory','secured a win','secured the win','secured the victory',
  'capitalized on scoring opportunities','capitalize on scoring',
  'finalize a','finalize the',
  'overcome the','to overcome','managed to overcome',
  'result moved','result moves',                   // "this result moves X into..."
  'continued their','extended their','maintained their momentum',
];

function relayHasCliche(text) {
  const lower = text.toLowerCase();
  return RELAY_BANNED.filter(p => lower.includes(p));
}

// ── Layer 3: prose score (no Datamuse in worker — specificity+variety+density) ─
function relayScoreProse(text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const unique = new Set(words.map(w => w.toLowerCase()));
  const specifics = words.filter(w => /^[A-Z][a-z]/.test(w) || /\d/.test(w));
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 3);
  const nSent = Math.max(1, sentences.length);
  const specificity = specifics.length / words.length;
  const variety     = unique.size    / words.length;
  const density     = specifics.length / nSent;

  // Base 3 dimensions scaled to 130pts (no Datamuse on relay — weight redistributed)
  const base = Math.min(130, Math.round(specificity * 58 + variety * 45 + Math.min(density, 4) * 6.75));

  // Narrative Arc (0-40) — same syntactic rules as browser scorer
  const first = sentences[0] || '';
  const last  = sentences[sentences.length-1] || '';
  const sentStarts = new Set(sentences.map(s => s.split(/\s+/)[0]));
  const stakes = /\b\d-\d\b/.test(first) ||
    /\b(finals|championship|eliminated|advance|clinch|series|title|cup|playoffs)\b/i.test(first) ||
    /\b(first since|since \d{4}|\d+ years?)\b/i.test(first);
  const tension = sentences.some(s => {
    const sw = s.split(/\s+/);
    const hasPlayer = sw.some(w => /^[A-Z][a-z]{2,}/.test(w) && !sentStarts.has(w) && w.length > 3);
    const hasStat   = /\d/.test(s) && (/\d+\.\d/.test(s) || /\d+%/.test(s) ||
      /\b(pts?|points?|rebounds?|assists?|goals?|ppg|apg|rpg|saves?)\b/i.test(s));
    return hasPlayer && hasStat;
  });
  const resolution = /\b(watch|look for|decide|force|need|must|whether|tonight|will|could)\b/i.test(last) ||
    /\bif\b/i.test(last) || /\?/.test(last);
  const arcScore = (stakes?10:0) + (tension?10:0) + (resolution?10:0) + (stakes&&tension&&resolution?10:0);

  // Context Anchoring: N/A for relay slate briefs (no single game object)
  // Total ceiling: 170 (130 base + 40 arc, no context for slate briefs)
  return Math.min(170, base + arcScore);
}

// ── Layer 1: full style block for relay prompt ────────────────────────────────
const RELAY_STYLE_RULES = [
  '- STYLE: specificity over metaphor. "48 minutes from their first Finals since 1999" not "looking to punch their ticket."',
  '- STYLE: numbers over adjectives. "Brunson\'s 29.0 PPG this series" not "Brunson has been dominant."',
  '- STYLE: active voice. "Wembanyama blocked 3 shots" not "3 shots were blocked."',
  '- STYLE: concrete over abstract. "Game 4 starts at 8pm on ESPN" not "the stage is set for a pivotal matchup."',
  '- STYLE: one metaphor max per brief — if you use one, make it original.',
  '- STYLE: write like a well-prepared friend who watched every game, not like a press release. Short sentences. One thought per sentence.',
  '- STYLE: if a sentence would work in any game recap for any sport, it is too generic — rewrite with details specific to THIS game.',
  '- LEAD SENTENCE: never start a brief, paragraph, or sentence with "The [Team]..." — lead with the specific situation. "Wembanyama scored 34" not "The Spurs got a big performance." "Two years without a Finals appearance ends tonight" not "The Celtics are looking to make a statement."',
  '- VOICE: third person only. Never use "you" or address the reader directly.',
  '- BANNED PHRASES (never use): ' + RELAY_BANNED.join(', ') + '.',
].join('\n');

// ── Fix 5: richer game context from ESPN scoreboard ───────────────────────────
function buildGameLine(ev, league) {
  const comp = ev.competitions?.[0];
  if (!comp) return null;
  const teams = comp.competitors || [];
  const home = teams.find(t => t.homeAway === 'home') || teams[0];
  const away = teams.find(t => t.homeAway === 'away') || teams[1];
  if (!home || !away) return null;

  const homeName = home.team?.shortDisplayName || home.team?.abbreviation || '';
  const awayName = away.team?.shortDisplayName || away.team?.abbreviation || '';
  const homeScore = home.score ?? '';
  const awayScore = away.score ?? '';
  const status = comp.status?.type?.description || '';
  const broadcast = comp.broadcasts?.[0]?.names?.[0] || league.toUpperCase();

  // Team records (overall W-L) — context for the model: standings position
  const homeRec = (home.records || []).find(r => r.type === 'total')?.summary || '';
  const awayRec = (away.records || []).find(r => r.type === 'total')?.summary || '';

  // Venue (with indoor flag) — relevant for weather context and atmosphere
  const venueName = comp.venue?.fullName || '';
  const indoorFlag = comp.venue?.indoor ? ' [indoor]' : '';

  // Series record (playoffs) — include round name to prevent AI series confusion
  const seriesSummary = comp.series?.summary || comp.series?.type?.text || '';
  const roundName = comp.type?.text || comp.notes?.[0]?.headline || '';
  const series = [roundName, seriesSummary].filter(Boolean).join(' — ') || seriesSummary;

  // Extended leader extraction: top 3 categories per team (was top 1).
  // For MLB: BA, HR, RBI. For NBA/WNBA: PPG, RPG, APG. For NHL: G, A, PTS.
  // Voice diversity in the brief depends on the model having multiple stat
  // types to draw from — single-category extraction was forcing batting-average
  // monotony across nine MLB games.
  const leaders = [];
  for (const team of [home, away]) {
    const teamAbbr = team.team?.abbreviation || '';
    const teamLeaders = [];
    const leaderCategories = team.leaders || [];
    for (const lg of leaderCategories.slice(0, 3)) {
      const top = lg.leaders?.[0];
      if (top?.displayValue && top?.athlete?.displayName) {
        const cat = lg.shortDisplayName || lg.abbreviation || '';
        const nameStat = `${top.athlete.displayName} ${top.displayValue}${cat ? ' '+cat : ''}`.trim();
        teamLeaders.push(nameStat);
      }
    }
    if (teamLeaders.length) leaders.push(`${teamAbbr}: ${teamLeaders.join(', ')}`);
  }

  // Probable starting pitchers (MLB only — empty for other sports, populated
  // inconsistently within MLB depending on ESPN's data lag). Provides a hook
  // for the model to lead per-game writing with pitching matchup context.
  const probables = [];
  for (const team of [home, away]) {
    const prob = team.probables?.[0];
    const ath = prob?.athlete;
    if (!ath?.displayName) continue;
    const stats = prob.statistics || [];
    const wins = stats.find(s => s.abbreviation === 'W')?.displayValue;
    const losses = stats.find(s => s.abbreviation === 'L')?.displayValue;
    const era = stats.find(s => s.abbreviation === 'ERA')?.displayValue;
    const teamAbbr = team.team?.abbreviation || '';
    const recStr = (wins !== undefined && losses !== undefined && era !== undefined)
      ? `${wins}-${losses}, ${era} ERA`
      : era ? `${era} ERA` : '';
    probables.push(recStr ? `${ath.displayName} (${teamAbbr}, ${recStr})` : `${ath.displayName} (${teamAbbr})`);
  }

  // Situation context (live games: period + clock)
  const situation = comp.status?.type?.state === 'in'
    ? (comp.status?.displayClock ? `(${comp.status.displayClock} ${comp.status?.period ? 'P'+comp.status.period : ''})` : '')
    : '';

  // Format: team (record) score @ team (record) score · status · venue · broadcast · series · leaders · probables
  const awayLabel = `${awayName}${awayRec ? ` (${awayRec})` : ''} ${awayScore}`.trim();
  const homeLabel = `${homeName}${homeRec ? ` (${homeRec})` : ''} ${homeScore}`.trim();
  let line = `${awayLabel} @ ${homeLabel} · ${status}${situation ? ' '+situation : ''}`;
  if (venueName) line += ` · ${venueName}${indoorFlag}`;
  line += ` · ${broadcast}`;
  if (series) line += ` · ${series}`;
  if (leaders.length) line += ` · ${leaders.join(' · ')}`;
  if (probables.length) line += ` · Probables: ${probables.join(', ')}`;
  return line;
}

// ── PF-1: Markdown header/bold stripper (June 1 2026) ───────────────────────
// LLMs occasionally wrap output in '#' headers or '**bold**' even when not
// asked. The bottom sheet renders plain text, so any markdown leaks through
// as raw characters. Shared by /journalism/generate (sync path) and the
// queue consumer (WOW 8 async path) so both surfaces stay clean.
function stripMarkdown(s) {
  if (!s) return s;
  return s
    .replace(/^#{1,6}\s+/gm, '')          // # ## ### headers
    .replace(/\*\*(.+?)\*\*/g, '$1')      // **bold**
    .replace(/__(.+?)__/g, '$1')          // __bold__
    .replace(/`(.+?)`/g, '$1')            // `inline code`
    .replace(/^[-*+]\s+/gm, '')           // bullet list markers
    .replace(/\n{3,}/g, '\n\n')           // collapse triple newlines
    .trim();
}

async function handleJournalismCycle(env) {
  if (!env.FIELD_JOURNALISM) return {ok:false, reason:'KV not configured'};
  const now = Date.now();
  const dateKey = new Date().toISOString().slice(0, 10);
  // ESPN scoreboard endpoint accepts ?dates=YYYYMMDD to return ONLY events for
  // that calendar date. Without it, ESPN serves the most recent matchday when
  // the league has no current fixture — which for off-season leagues (EPL
  // post-May 24 2026) means stale Final Day games leak into TONIGHT'S GAMES
  // and the model writes about them as if they happened tonight. Fixed
  // June 1 2026 after the EPL phantom incident.
  const espnDate = dateKey.replace(/-/g, ''); // YYYY-MM-DD → YYYYMMDD
  const hour = new Date().getUTCHours();
  const isLiveHours = hour >= 10 || hour <= 2;
  if (!isLiveHours) return {ok:false, reason:`not live hours (UTC ${hour})`};

  try {
    // 1. Fetch ESPN scoreboard — richer context (Fix 5)
    // O(1) Newspaper coverage — added EPL May 31 2026.
    // Each league here is iterated TWICE per cron cycle: once for the slate
    // brief context (gameLines), once for per-game brief generation. Adding
    // a league to this array immediately expands cache coverage for the
    // 97% LLM-cost-reduction path.
    const LEAGUES = [
      {sport:'basketball',league:'nba',label:'NBA'},
      {sport:'hockey',    league:'nhl',label:'NHL'},
      {sport:'baseball',  league:'mlb',label:'MLB'},
      {sport:'basketball',league:'wnba',label:'WNBA'},
      {sport:'soccer',    league:'eng.1',label:'EPL'},
    ];
    const gameLines = [];
    for (const {sport,league,label} of LEAGUES) {
      try {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${espnDate}`);
        if (!r.ok) continue;
        const d = await r.json();
        const events = d?.events || [];
        for (const ev of events) {
          const line = buildGameLine(ev, label);
          if (line) gameLines.push(line);
        }
      } catch(_) {}
    }

    if (!gameLines.length) return {ok:false, reason:'no game lines from ESPN'};

    // 2. Context hash — skip if unchanged
    const contextHash = gameLines.join('|').split('').reduce((h,c)=>(Math.imul(31,h)+c.charCodeAt(0))|0,0).toString(16);
    const existingRaw = await env.FIELD_JOURNALISM.get(`journalism:${dateKey}`);
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw);
        if (existing.contextHash === contextHash) return {ok:false, reason:'context unchanged (already cached)'};
      } catch(_) {}
    }

    // 3. Layer 1: full style prompt
    // WC2026 team context — async (queries D1 for live standings)
    const wcTeamContext = slateHasWorldCup(gameLines)
      ? await buildWCTeamContextBlock(gameLines, env.WC2026_DB)
      : '';

    const buildPrompt = () => [
      'Write a FIELD Brief for tonight\'s sports slate.',
      '',
      'TONIGHT\'S GAMES:',
      ...gameLines.map(l => `- ${l}`),
      buildFinalsContextBlock(gameLines),
      wcTeamContext,  // WC2026 team narrative (D1 + static)
      '',
      'RULES:',
      '- 100-120 words. 2 short paragraphs. No headers. No bullet points.',
      '- Lead with the most important story — the SPECIFIC situation, not the template.',
      '- CORRECTNESS: write only from the data above. Never invent scores, stats, or facts not listed.',
      '- SLATE BOUNDARY (mandatory): every league or sport you reference must appear in TONIGHT\'S GAMES above. If the Premier League, La Liga, Serie A, Ligue 1, Bundesliga, MLS, or any other league has no game in tonight\'s slate, DO NOT mention it, recap it, or include any result from it. Saying "In England, Man United routed Brighton 3-0" is FABRICATION when no EPL game is in the slate. The brief covers ONLY what is on tonight\'s slate.',
      '- SERIES ACCURACY: A Conference Finals game is NEVER "the NBA Finals" or "the Championship." A Stanley Cup Final game is NEVER a "first-round matchup." Use only the round/series description in the game data. If the series context is unclear, describe it as "a playoff series" — never upgrade it to a championship.',
      JQ_STYLE,  // WOW 6: unified style block (includes LEAGUE BOUNDARIES, SPARINGLY, [CHAMPION], [FEATURED STAT], etc.)
      '- Plain prose only. Every sentence complete.',
    ].join('\n');

    let _lastProxyStatus = '';
    const callProxy = async (promptText) => {
      const resp = await fetch(JOURNALISM_CLAUDE_PROXY, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Server-to-server auth: proxy bypasses Origin check for the relay cron.
          'X-FIELD-Relay': 'field-relay-cron-2026',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          messages: [{role: 'user', content: promptText}],
        }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(()=>'');
        _lastProxyStatus = `HTTP ${resp.status} ${body.slice(0,200)}`;
        return null;
      }
      const data = await resp.json();
      return (data.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('').trim() || null;
    };

    let prose = await callProxy(buildPrompt());
    if (!prose || prose.length < 50) return {ok:false, reason:`proxy no prose (len ${prose?prose.length:0})`, proxyStatus:_lastProxyStatus};

    // ── WOW 6: full quality chain (Layers 2, 2b, 2c, 2d, 2e, 3b) ───────────
    // Replaces the previous cron-path Layer 2 + degraded Layer 3 with the
    // unified chain that the live path also uses. Both paths now apply
    // identical quality enforcement.
    const qualityResult = await runQualityChain(buildPrompt(), prose, callProxy, {
      sport: null, // slate brief covers multiple sports
      scoreThreshold: 130,
      maxRetries: 6,
    });
    prose = qualityResult.text;
    const finalScore   = qualityResult.score;
    const finalCliches = jqHasCliche(prose).length;

    // ── WOW 7: write to Analytics Engine ──────────────────────────────────
    // One row per cron slate-brief generation. Distinguished from live path
    // by briefType='cron-slate'. Same dataset → unified queries can group
    // both paths or filter to one.
    try {
      if (env.JQ_ANALYTICS) {
        env.JQ_ANALYTICS.writeDataPoint({
          indexes: ['cron-slate', 'multi'],
          blobs:   [qualityResult.layers_fired.join(',') || 'none'],
          doubles: [
            finalScore,
            qualityResult.retries,
            qualityResult.ms,
            jqHasCliche(qualityResult.text).length === finalCliches ? 0 : finalCliches, // initialCliches approx (we don't have pre-chain text here)
            finalCliches,
            0, // cron doesn't track initial cross-sport (would require rescan)
            jqHasCrossSport(prose).length,
            buildPrompt().length,
            prose.length,
          ],
        });
      }
    } catch(_aeErr) { /* analytics failures must not affect cron */ }

    // 6. Store J3 brief in KV
    const cycleId = crypto.randomUUID();
    await env.FIELD_JOURNALISM.put(
      `journalism:${dateKey}`,
      JSON.stringify({
        brief: prose,
        generatedAt: now,
        contextHash,
        gameCount: gameLines.length,
        cycleId,
        proseScore: finalScore,
        clicheCount: finalCliches,  // was finalCliches.length — but finalCliches is now a number (length of array)
      }),
      { expirationTtl: 86400 }
    );

    // 7. Pre-generate per-game card briefs and store in KV
    // These replace browser-side MLB/WNBA/Stakes/EPL brief calls — zero runtime AI calls
    // Key: brief:game:{espnEventId}  TTL: 3600s (1hr — games change hourly)
    const gameBriefResults = [];
    for (const {sport, league, label} of LEAGUES) {
      try {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${espnDate}`);
        if (!r.ok) continue;
        const d = await r.json();
        for (const ev of (d?.events || [])) {
          const comp = ev.competitions?.[0];
          if (!comp) continue;
          const eventId = ev.id;
          if (!eventId) continue;

          // Skip if already cached and context unchanged
          const gameHash = (ev.id + (comp.status?.type?.description||'') + (comp.competitors?.map(c=>c.score).join('|')||'')).split('').reduce((h,c)=>(Math.imul(31,h)+c.charCodeAt(0))|0,0).toString(16);
          const existingGame = await env.FIELD_JOURNALISM.get(`brief:game:${eventId}`).catch(()=>null);
          if (existingGame) {
            try {
              const eg = JSON.parse(existingGame);
              if (eg.contextHash === gameHash) continue; // unchanged — skip
            } catch(_) {}
          }

          const gameLine = buildGameLine(ev, label);
          if (!gameLine) continue;

          // Build sport-specific brief prompt
          const teams = comp.competitors || [];
          const home = teams.find(t => t.homeAway === 'home') || teams[0];
          const away = teams.find(t => t.homeAway === 'away') || teams[1];
          const homeName = home?.team?.shortDisplayName || home?.team?.displayName || '';
          const awayName = away?.team?.shortDisplayName || away?.team?.displayName || '';
          const series = comp.series?.summary || '';
          const state = comp.status?.type?.state || 'pre';
          const broadcast = comp.broadcasts?.[0]?.names?.[0] || label.toUpperCase();

          const isPlayoff = !!(series || /playoff|final|series/i.test(ev.name||''));
          const gamePrompt = [
            `Write a FIELD Game Brief for this ${label} game.`,
            `${awayName} @ ${homeName}.`,
            series ? `Series: ${series}.` : '',
            `Status: ${comp.status?.type?.description || 'Scheduled'}. Broadcast: ${broadcast}.`,
            `Game data: ${gameLine}`,
            '',
            isPlayoff
              ? 'Rules: 50-70 words. Lead with the series stakes. Tactical focus — what decides this game.'
              : `Rules: 40-60 words. Lead with the most interesting fact about ${label === 'MLB' ? 'the pitching matchup or park conditions' : label === 'WNBA' ? 'the standings context' : 'the matchup'}. One complete thought.`,
            JQ_STYLE,  // WOW 6: unified style block
            'Write only from data above. No invented stats.',
          ].filter(Boolean).join('\n');

          const brief = await callProxy(gamePrompt);
          if (!brief || brief.length < 30) continue;

          // Quality check — cliché retry
          let finalBrief = brief;
          const cliches = relayHasCliche(brief);
          if (cliches.length) {
            await new Promise(r => setTimeout(r, 2000)); // RPM guard
            const retried = await callProxy(gamePrompt + `\n\nREWRITE: Remove banned phrases: ${cliches.join(', ')}. Use a specific fact instead.`);
            if (retried && retried.length > 30) finalBrief = retried;
          }

          await env.FIELD_JOURNALISM.put(
            `brief:game:${eventId}`,
            JSON.stringify({
              brief: finalBrief,
              generatedAt: now,
              contextHash: gameHash,
              sport: label,
              home: homeName,
              away: awayName,
              cycleId,
            }),
            { expirationTtl: 3600 }
          );
          gameBriefResults.push(eventId);
          await new Promise(r => setTimeout(r, 1500)); // RPM guard between games
        }
      } catch(e) {
        console.warn(`[journalism-cycle] game briefs ${label} error:`, e.message);
      }
    }

    return {ok:true, reason:'written', score:finalScore, gameCount:gameLines.length, briefLen:prose.length, gameBriefs:gameBriefResults.length};
  } catch(e) {
    console.error('[journalism-cycle] error:', e.message);
    return {ok:false, reason:'exception: '+(e&&e.message||String(e))};
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

        // CORS preflight handler — must be FIRST, before any route logic.
        // Browsers issue OPTIONS preflight automatically for CORS-complex
        // requests (e.g. POST with Content-Type: application/json).
        // Without this, the method gate at the route-level returns 405 and
        // preflight fails → all complex POSTs blocked.
        // Reference: WOW 6 /journalism/generate CORS bug, May 31 2026.
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin':  '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
                    'Access-Control-Max-Age':       '86400',
                },
            });
        }

        // ── MCP OAuth surface (Tier 1 Phase 2 — June 2 2026 PM-14) ──────────
        // Log every /.well-known, /oauth, /mcp, /debug/recent-requests request
        // to MCP_OAUTH KV (1h TTL) for diagnostic. ctx.waitUntil so the log
        // write doesn't block the response.
        if (env.MCP_OAUTH && (
            pathname.startsWith('/.well-known/') ||
            pathname.startsWith('/oauth/') ||
            pathname === '/mcp' ||
            pathname === '/debug/recent-requests'
        )) {
            ctx.waitUntil(oauthLogRequest(env, request, 'route'));
        }

        // /.well-known/oauth-authorization-server (RFC 8414)
        if (pathname === '/.well-known/oauth-authorization-server' && request.method === 'GET') {
            return oauthAuthServerMetadata(url.origin);
        }
        // /.well-known/oauth-protected-resource (RFC 9728)
        if (pathname === '/.well-known/oauth-protected-resource' && request.method === 'GET') {
            return oauthProtectedResourceMetadata(url.origin);
        }
        // POST /oauth/register — Dynamic Client Registration (RFC 7591)
        if (pathname === '/oauth/register' && request.method === 'POST') {
            if (!env.MCP_OAUTH) return new Response('MCP_OAUTH KV not bound', { status: 503, headers: CORS });
            return oauthRegister(request, env);
        }
        // GET /oauth/authorize — render password form (PKCE-bound)
        if (pathname === '/oauth/authorize' && request.method === 'GET') {
            if (!env.MCP_OAUTH) return new Response('MCP_OAUTH KV not bound', { status: 503, headers: CORS });
            return oauthAuthorizeGet(url, env);
        }
        // POST /oauth/authorize — verify password, mint code, 302 to redirect_uri
        if (pathname === '/oauth/authorize' && request.method === 'POST') {
            if (!env.MCP_OAUTH) return new Response('MCP_OAUTH KV not bound', { status: 503, headers: CORS });
            return oauthAuthorizePost(request, env);
        }
        // POST /oauth/token — authorization_code or refresh_token grant
        if (pathname === '/oauth/token' && request.method === 'POST') {
            if (!env.MCP_OAUTH) return new Response('MCP_OAUTH KV not bound', { status: 503, headers: CORS });
            return oauthToken(request, env);
        }
        // POST /oauth/revoke — token revocation (RFC 7009)
        if (pathname === '/oauth/revoke' && request.method === 'POST') {
            if (!env.MCP_OAUTH) return new Response('MCP_OAUTH KV not bound', { status: 503, headers: CORS });
            return oauthRevoke(request, env);
        }
        // GET /debug/recent-requests — read OAuth/MCP request log (FIELD_MCP_SECRET-gated)
        if (pathname === '/debug/recent-requests' && request.method === 'GET') {
            if (!env.MCP_OAUTH) return new Response('MCP_OAUTH KV not bound', { status: 503, headers: CORS });
            return oauthDebugRecentRequests(request, env);
        }

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

        // ── WOW 1: WebSocket connection to per-game DurableObject ────────
        // Path: /ws/game/:sport/:gameId
        // Browser connects here; we forward the upgrade to the game's DO.
        // ADR-002: DO ships raw facts only, no intelligence computation.
        if (pathname.startsWith('/ws/game/') && request.headers.get('Upgrade') === 'websocket') {
            if (!env.GAME_DO) return new Response('GAME_DO binding not configured', { status: 503 });
            const parts = pathname.split('/').filter(Boolean); // ['ws','game',sport,gameId]
            if (parts.length < 4) return new Response('Missing sport or gameId', { status: 400 });
            const sport  = parts[2];
            const gameId = parts[3];
            // Stable DO id keyed by sport+gameId — same DO per game across all users.
            const id   = env.GAME_DO.idFromName(`${sport}:${gameId}`);
            const stub = env.GAME_DO.get(id);
            // Pass identity via query params so DO can persist on first connect.
            const forward = new URL('https://do.internal/ws');
            forward.searchParams.set('sport',  sport);
            forward.searchParams.set('gameId', gameId);
            // Make sendWebPush available to the DO without circular import.
            // The DO reads env._sendWebPush when fanning out CRUNCH notifications.
            const enrichedEnv = Object.assign(Object.create(env), { _sendWebPush: sendWebPush });
            // Forward the upgrade — DO returns the 101 response with the WebSocket.
            return stub.fetch(forward.toString(), { headers: request.headers });
        }

        // ── WOW 2: HTTP signal endpoint (SW/page CRUNCH TIME emitter) ────
        // POST /signal/crunch/:sport/:gameId
        // The SW (or page) computes CRUNCH TIME locally as a named binary
        // condition and signals the DO. The DO fans out Web Push to pinned
        // subscribers. The DO never computes the condition itself.
        // RUWT compliance: client makes the determination; server delivers.
        if (pathname.startsWith('/signal/crunch/') && request.method === 'POST') {
            if (!env.GAME_DO) return new Response('GAME_DO binding not configured', { status: 503 });
            const parts = pathname.split('/').filter(Boolean); // ['signal','crunch',sport,gameId]
            if (parts.length < 4) return new Response('Missing sport or gameId', { status: 400 });
            const sport  = parts[2];
            const gameId = parts[3];
            const id     = env.GAME_DO.idFromName(`${sport}:${gameId}`);
            const stub   = env.GAME_DO.get(id);
            const enrichedEnv = Object.assign(Object.create(env), { _sendWebPush: sendWebPush });
            // Forward to the DO's /signal/crunch route. The DO dedup-checks and fans out.
            const body = await request.text();
            return stub.fetch('https://do.internal/signal/crunch', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
            });
        }

        // ── WOW 2: HTTP pin/unpin endpoints (alternative to WS pin message) ──
        if (pathname.startsWith('/pin/game/') && request.method === 'POST') {
            if (!env.GAME_DO) return new Response('GAME_DO binding not configured', { status: 503 });
            const parts = pathname.split('/').filter(Boolean); // ['pin','game',sport,gameId]
            if (parts.length < 4) return new Response('Missing sport or gameId', { status: 400 });
            const sport  = parts[2];
            const gameId = parts[3];
            const id     = env.GAME_DO.idFromName(`${sport}:${gameId}`);
            const stub   = env.GAME_DO.get(id);
            const body = await request.text();
            return stub.fetch('https://do.internal/pin', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
            });
        }
        if (pathname.startsWith('/unpin/game/') && request.method === 'POST') {
            if (!env.GAME_DO) return new Response('GAME_DO binding not configured', { status: 503 });
            const parts = pathname.split('/').filter(Boolean);
            if (parts.length < 4) return new Response('Missing sport or gameId', { status: 400 });
            const sport  = parts[2];
            const gameId = parts[3];
            const id     = env.GAME_DO.idFromName(`${sport}:${gameId}`);
            const stub   = env.GAME_DO.get(id);
            const body = await request.text();
            return stub.fetch('https://do.internal/unpin', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
            });
        }

        if (pathname === '/health') {
            return new Response('RELAY OK — nba + nhl + fpl + fd + odds + apisports + squiggle + atp + bdl + espn-gambit + espn-summary + dropbox + field-data + v2 + ws-game-do + jq-gate + jq-analytics + wc-d1 + wc-team-context + soccer-wp + cfl-odds', {
                status: 200,
                headers: { 'Content-Type': 'text/plain', ...CORS, 'X-FIELD-Proxy': 'relay-multi' }
            });
        }

        // /wc/* — World Cup D1 standings (WC D1, June 4 2026)
        if (pathname.startsWith('/wc/')) {
            if (pathname === '/wc/standings')   return handleWCStandings(url, env);
            if (pathname === '/wc/results')     return handleWCResults(url, env);
            if (pathname === '/wc/odds-probs')  return handleWCOddsProbs(env);
            if (pathname === '/wc/third-place') return handleWCThirdPlace(env);
            if (pathname === '/wc/wp/verify')   return handleWCWPVerify(env);
            if (pathname === '/wc/admin/seed' && request.method === 'POST')
                return handleWCAdminSeed(request, env);
            return new Response('WC endpoint not found', { status: 404, headers: CORS });
        }

        // /cfl/* — CFL odds from The Odds API
        if (pathname === '/cfl/odds-probs') return handleCFLOddsProbs(env);

        // /v2/* — FieldGame normalized routes (Phase 0, ESPN parallel — additive only)
        if (pathname.startsWith('/v2/')) {
            if (pathname === '/v2/games')     return handleV2Games(url, env);
            if (pathname === '/v2/standings') return handleV2Standings(url, env);
            return new Response('V2 endpoint not found', { status: 404, headers: CORS });
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

        if (request.method !== 'GET'
            && !(pathname === '/journalism/run' && request.method === 'POST')
            && !(pathname === '/journalism/generate' && request.method === 'POST')
            && !(pathname === '/journalism/enqueue' && request.method === 'POST')
            && !(pathname === '/mcp' && request.method === 'POST'))
            return new Response('Method not allowed', { status: 405, headers: CORS });

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
        // 401 handling: free-tier key returns 401 on /season_averages and other GOAT-gated routes.
        // Rather than propagating the 401 (which spams browser console), return 200 with empty
        // data + tier_required marker. Browser code already checks data.length and falls through
        // gracefully. Upgrade to BDL GOAT plan ($9.99/mo) to enable these endpoints.
        if (pathname.startsWith('/bdl')) {
            const cleanPath = pathname.replace(/^\/bdl/, '') || '/';
            if (!bdlAllowed(cleanPath))
                return new Response('BDL path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'bdl-path-not-whitelisted', ...CORS } });
            const bdlKey = env?.BDL_API_KEY || '4c881f4b-3845-4542-841f-a0e685c9f10e';
            const targetUrl = `${BDL_BASE}${cleanPath}${url.search || ''}`;
            const bdlResp = await relayFetch(targetUrl, { 'Authorization': bdlKey, 'Accept': 'application/json' }, bdlCacheTtl(cleanPath), 'bdl', ctx);
            // Special-case 401: free-tier subscription doesn't cover this endpoint.
            // Return empty data so browser doesn't error in console + skips this data source.
            if (bdlResp.status === 401) {
                return new Response(JSON.stringify({
                    data: [],
                    meta: {
                        tier_required: 'GOAT',
                        upstream_status: 401,
                        note: 'BDL subscription tier required for this endpoint',
                    },
                }), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-RELAY-Tier-Gated': '1',
                        ...CORS,
                    },
                });
            }
            return bdlResp;
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
            // Analytics JSON files (pre-generated by mlb-weekly-update.yml)
            // Must be checked FIRST — they're not valid MLB Stats API paths
            // and would otherwise 403 in the API path check below.
            const MLB_ANALYTICS_FILES = ['team_abs.json','expected_stats.json','sprint_speed.json',
                                          'pitch_tempo.json','pitch_arsenals.json','umpire_abs.json'];
            const analyticsFile = cleanPath.replace(/^\//, '');
            if (MLB_ANALYTICS_FILES.includes(analyticsFile)) {
                const rawBase = 'https://raw.githubusercontent.com/jeffunglesbee-create/jubilant-bassoon/main/outbox/mlb';
                return relayFetch(`${rawBase}/${analyticsFile}`, { 'Accept': 'application/json' }, 43200, 'mlb-analytics', ctx);
            }
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
        // Manual journalism cycle trigger — runs the same logic as the */15 cron.
        // Lets us populate KV on demand (e.g. after KV creation) without waiting
        // for the next cron tick. Idempotent: skips if context hash unchanged.
        if (pathname === '/journalism/run' && request.method === 'POST') {
          const result = await handleJournalismCycle(env);
          return new Response(JSON.stringify({triggered:'journalism-cycle', result}),
            {headers:{...CORS,'Content-Type':'application/json'}});
        }

        // ── /journalism/generate — WOW 6 Quality Gate (live-path) ─────────────
        // Browser sends: { prompt, sport?, briefType?, max_tokens? }
        // Relay calls field-claude-proxy → runs all 6 quality layers →
        // returns: { text, score, retries, layers_fired, ms, status }
        //
        // This is the architectural patent point: journalism quality is
        // enforced structurally on the relay before reaching the user.
        // Per ADR-002, this is rule enforcement (banned phrases, sport vocab,
        // lead pattern, stat presence, cross-sport facts, prose score) —
        // NOT editorial interest determination.
        //
        // Token cost: same as direct proxy call (1 generation + up to 6 retries
        // only when needed). Identical to browser-side chain that runs today.
        //
        // RUWT: no interest level computation. No threshold against composite
        // value. The "score < 130" check is on prose QUALITY (specificity +
        // variety + density + statDepth), not on interest. Pure editorial
        // rule. ✅ CLEAN.
        if (pathname === '/journalism/generate' && request.method === 'POST') {
          try {
            const body = await request.json().catch(()=>null);
            if (!body || typeof body.prompt !== 'string' || body.prompt.length < 10) {
              return new Response(JSON.stringify({error:'missing or invalid prompt'}),
                {status:400, headers:{...CORS,'Content-Type':'application/json'}});
            }
            const sport       = body.sport || null;
            const briefType   = body.briefType || 'generic';
            const max_tokens  = Math.min(Math.max(body.max_tokens || 1500, 200), 5000);
            const scoreFloor  = body.scoreThreshold || 130;

            // callProxy closure: same shape used by handleJournalismCycle cron
            // DIAGNOSTIC: capture real failure mode (vs silent try/catch swallow)
            let _lastProxyDiag = 'none';
            const callProxy = async (promptText) => {
              try {
                const resp = await fetch('https://field-claude-proxy.jeffunglesbee.workers.dev', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    // Proxy whitelist requires 'field-relay-cron-2026' to bypass origin check.
                    // The previous value 'field-relay-jq-2026' was rejected with 403 "Origin not allowed".
                    // Use same value cron does — proxy is path-agnostic, only checks header value.
                    'X-FIELD-Relay': 'field-relay-cron-2026',
                  },
                  body: JSON.stringify({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens,
                    messages: [{role:'user', content: promptText}],
                  }),
                });
                if (!resp.ok) {
                  const body = await resp.text().catch(()=>'(unreadable)');
                  _lastProxyDiag = `HTTP_${resp.status}: ${body.slice(0,150)}`;
                  return null;
                }
                const data = await resp.json();
                const text = (data.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('').trim();
                if (!text) {
                  _lastProxyDiag = `parsed_empty: keys=${Object.keys(data).join(',')} content_len=${(data.content||[]).length}`;
                }
                return text || null;
              } catch(e) {
                _lastProxyDiag = `exception: ${e.message || String(e).slice(0,150)}`;
                return null;
              }
            };

            // First call: generate the initial prose
            const initial = await callProxy(body.prompt);
            if (!initial || initial.length < 30) {
              return new Response(JSON.stringify({
                error: 'proxy returned no prose',
                proxy_text_length: initial ? initial.length : 0,
                proxy_diagnostic: _lastProxyDiag,
              }), {status:502, headers:{...CORS,'Content-Type':'application/json'}});
            }

            // Run full quality chain
            const result = await runQualityChain(body.prompt, initial, callProxy, {
              sport,
              scoreThreshold: scoreFloor,
              maxRetries: 6,
            });

            // ── PF-1: Strip markdown bleed (May 31 2026) ──────────────────
            // LLMs sometimes wrap output in markdown headers ("# FIELD Brief")
            // or bold ("**X**") even when not asked. The bottom sheet renders
            // plain text, so any markdown leaks through as raw '#' / '**'.
            // Strip at relay so cron-generated KV briefs benefit too.
            // stripMarkdown helper is hoisted to module scope (see PF-1 above).
            result.text = stripMarkdown(result.text);

            // Compute audit values once (used both for response + analytics)
            const _initialCliches    = jqHasCliche(initial).length;
            const _finalCliches      = jqHasCliche(result.text).length;
            const _initialCrossSport = jqHasCrossSport(initial).length;
            const _finalCrossSport   = jqHasCrossSport(result.text).length;

            // ── WOW 7: write to Analytics Engine ──────────────────────────
            // One row per /journalism/generate call. Fire-and-forget, non-blocking.
            // RUWT/ADR-002 compliance: records OUTCOMES of quality enforcement
            // (Boolean rule application: did Layer X fire? did the score pass?)
            // — NOT editorial decisions about interest level. The score field
            // is prose-quality (specificity+variety+density+statDepth), not
            // user-facing interest. Pure editorial-quality observability.
            try {
              if (env.JQ_ANALYTICS) {
                env.JQ_ANALYTICS.writeDataPoint({
                  indexes: [briefType, sport || 'none'],
                  blobs:   [result.layers_fired.join(',') || 'none'],
                  doubles: [
                    result.score,
                    result.retries,
                    result.ms,
                    _initialCliches,
                    _finalCliches,
                    _initialCrossSport,
                    _finalCrossSport,
                    body.prompt.length,
                    result.text.length,
                  ],
                });
              }
            } catch(_aeErr) {
              // Analytics write failures must not affect the response.
              // Worst case: this row is lost. The brief still ships clean.
            }

            return new Response(JSON.stringify({
              status: 'ok',
              briefType,
              text: result.text,
              score: result.score,
              retries: result.retries,
              layers_fired: result.layers_fired,
              ms: result.ms,
              // Audit fields — written to Analytics Engine above + returned
              // here for browser-side debug panel display
              initial_cliches: _initialCliches,
              final_cliches:   _finalCliches,
              initial_cross_sport: _initialCrossSport,
              final_cross_sport:   _finalCrossSport,
            }), {
              status: 200,
              headers: {
                ...CORS,
                'Content-Type': 'application/json',
                'X-JQ-Score': String(result.score),
                'X-JQ-Retries': String(result.retries),
                'X-JQ-Layers': result.layers_fired.join(',') || 'none',
              },
            });
          } catch(e) {
            return new Response(JSON.stringify({
              error: 'journalism gate failure',
              detail: e.message,
            }), {status:500, headers:{...CORS,'Content-Type':'application/json'}});
          }
        }

        // ── /journalism/enqueue — WOW 8 async pipeline producer ────────────────
        // Browser sends: { prompt, sport?, briefType?, max_tokens?, scoreThreshold? }
        // Worker enqueues to JOURNALISM_QUEUE, returns { jobId } immediately (202).
        // Consumer (queue handler below) drains at upstream-permitted rate with
        // 429-aware retry. Replaces the 400/700/1000ms synchronous stagger.
        // Result lands in FIELD_JOURNALISM KV under jobs:{jobId} — fetch via
        // GET /journalism/result/:jobId.
        if (pathname === '/journalism/enqueue' && request.method === 'POST') {
          if (!env.JOURNALISM_QUEUE) {
            return new Response(JSON.stringify({error:'queue not configured'}),
              {status:503, headers:{...CORS,'Content-Type':'application/json'}});
          }
          try {
            const body = await request.json();
            if (!body.prompt || typeof body.prompt !== 'string') {
              return new Response(JSON.stringify({error:'prompt required'}),
                {status:400, headers:{...CORS,'Content-Type':'application/json'}});
            }
            const jobId = crypto.randomUUID();
            await env.JOURNALISM_QUEUE.send({
              jobId,
              prompt: body.prompt,
              sport: body.sport || null,
              briefType: body.briefType || 'queued',
              max_tokens: body.max_tokens || 1000,
              scoreThreshold: body.scoreThreshold || null,
              enqueuedAt: Date.now(),
            });
            // Seed status row in KV so result endpoint can report "queued" before processing.
            if (env.FIELD_JOURNALISM) {
              await env.FIELD_JOURNALISM.put(`jobs:${jobId}`,
                JSON.stringify({status:'queued', enqueuedAt: Date.now()}),
                {expirationTtl: 86400});
            }
            return new Response(JSON.stringify({jobId, status:'queued'}),
              {status:202, headers:{...CORS,'Content-Type':'application/json'}});
          } catch(e) {
            return new Response(JSON.stringify({error:'enqueue failure', detail:e.message}),
              {status:500, headers:{...CORS,'Content-Type':'application/json'}});
          }
        }

        // ── /journalism/result/:jobId — WOW 8 result polling endpoint ──────────
        // Browser polls this after /journalism/enqueue to retrieve completed prose.
        // Returns: 200 { status:'done', text, score, retries, layers_fired, ms }
        //   or:   200 { status:'queued' | 'processing' | 'failed', ... }
        //   or:   404 if jobId unknown / expired (24h KV TTL).
        if (pathname.startsWith('/journalism/result/') && request.method === 'GET') {
          if (!env.FIELD_JOURNALISM) {
            return new Response(JSON.stringify({error:'storage not configured'}),
              {status:503, headers:{...CORS,'Content-Type':'application/json'}});
          }
          const jobId = pathname.slice('/journalism/result/'.length);
          if (!jobId || !/^[0-9a-f-]{8,}$/i.test(jobId)) {
            return new Response(JSON.stringify({error:'invalid jobId'}),
              {status:400, headers:{...CORS,'Content-Type':'application/json'}});
          }
          const raw = await env.FIELD_JOURNALISM.get(`jobs:${jobId}`);
          if (!raw) {
            return new Response(JSON.stringify({status:'unknown', jobId}),
              {status:404, headers:{...CORS,'Content-Type':'application/json'}});
          }
          return new Response(raw,
            {status:200, headers:{...CORS,'Content-Type':'application/json'}});
        }

        // RSS proxy — routes first-party league RSS feeds to bypass browser CORS
  if (pathname === '/rss-proxy') {
    const feedUrl = url.searchParams.get('url');
    if (!feedUrl) return new Response('Missing url param', {status:400, headers:corsHeaders});
    const allowed = ['nba.com','nhl.com','mlb.com','nfl.com'];
    const urlHost = new URL(feedUrl).hostname;
    if (!allowed.some(d => urlHost.endsWith(d)))
      return new Response('Domain not allowed', {status:403, headers:corsHeaders});
    try {
      const r = await fetch(feedUrl, {headers:{'User-Agent':'FIELD/1.0'}});
      const text = await r.text();
      return new Response(text, {
        status: r.status,
        headers: {...corsHeaders, 'Content-Type': r.headers.get('Content-Type') || 'application/rss+xml'},
      });
    } catch(e) {
      return new Response('RSS fetch failed', {status:502, headers:corsHeaders});
    }
  }

  if (pathname === '/journalism/tonight' || pathname === '/journalism/brief') {
            if (!env.FIELD_JOURNALISM) return new Response(JSON.stringify({error:'not configured'}),{status:503,headers:{...CORS,'Content-Type':'application/json'}});
            const dateKey = new Date().toISOString().slice(0,10);
            const raw = await env.FIELD_JOURNALISM.get(`journalism:${dateKey}`);
            if (!raw) return new Response(JSON.stringify({brief:null,generatedAt:null}),{status:200,headers:{...CORS,'Content-Type':'application/json','Cache-Control':'public,max-age=60'}});
            const data = JSON.parse(raw);
            const age = Math.round((Date.now() - (data.generatedAt||0)) / 1000);
            return new Response(raw, {status:200, headers:{...CORS,'Content-Type':'application/json','Cache-Control':`public,max-age=${Math.max(0,JOURNALISM_TTL_SECS-age)}`,'X-Journalism-Age':`${age}s`,'X-Journalism-Cycle':data.cycleId||''}});
        }

        // /journalism/game/{eventId} — serve pre-generated per-game brief from KV
        // Generated by handleJournalismCycle every 15min. TTL 1hr.
        // Browser card renderers check this before calling the proxy directly.
        if (pathname.startsWith('/journalism/game/')) {
            if (!env.FIELD_JOURNALISM) return new Response(JSON.stringify({brief:null}),{status:200,headers:{...CORS,'Content-Type':'application/json'}});
            const eventId = pathname.replace('/journalism/game/', '').replace(/[^a-zA-Z0-9_-]/g,'');
            if (!eventId) return new Response(JSON.stringify({brief:null}),{status:200,headers:{...CORS,'Content-Type':'application/json'}});
            const raw = await env.FIELD_JOURNALISM.get(`brief:game:${eventId}`);
            if (!raw) return new Response(JSON.stringify({brief:null}),{status:200,headers:{...CORS,'Content-Type':'application/json','Cache-Control':'public,max-age=60'}});
            const data = JSON.parse(raw);
            const age = Math.round((Date.now() - (data.generatedAt||0)) / 1000);
            return new Response(raw, {status:200, headers:{...CORS,'Content-Type':'application/json','Cache-Control':`public,max-age=${Math.max(0,3600-age)}`,'X-Journalism-Age':`${age}s`,'X-Journalism-Sport':data.sport||''}});
        }

// ── /nflverse/{file} → raw.githubusercontent.com/jubilant-bassoon/outbox/nfl ─
        // Serves pre-computed analytics JSON committed by GitHub Action pipelines.
        // Primary: epa_table.json (EPA lookup, 16KB) — built by build-epa-table.yml
        if (pathname.startsWith('/nflverse/')) {
            const file = pathname.replace(/^\/nflverse\//, '');
            if (!NFLVERSE_OUT_ALLOWED.includes(file))
                return new Response('nflverse file not allowed', { status: 403, headers: { 'X-RELAY-Error': 'nflverse-not-whitelisted', ...CORS } });
            const targetUrl = `${NFLVERSE_RAW_BASE}/${file}`;
            return relayFetch(targetUrl, { 'Accept': 'application/json' }, 86400, 'nflverse', ctx);
            // TTL: 86400 (1 day) — files only change when pipelines run
        }

        // ── /mlb-stats/{file} → raw.githubusercontent.com/jubilant-bassoon/outbox/mlb ─
        // Serves weekly-updated MLB analytics JSON from mlb-weekly-update.yml pipeline.
        // Files: team_abs.json, expected_stats.json, sprint_speed.json,
        //        pitch_tempo.json, pitch_arsenals.json
        // TTL: 43200 (12h) — updated Monday, FIELD refreshes mid-week on reload
        const MLB_STATS_RAW_BASE = 'https://raw.githubusercontent.com/jeffunglesbee-create/jubilant-bassoon/main/outbox/mlb';
        const MLB_STATS_ALLOWED  = ['team_abs.json','expected_stats.json','sprint_speed.json',
                                     'pitch_tempo.json','pitch_arsenals.json','umpire_abs.json'];
        if (pathname.startsWith('/mlb-stats/')) {
            const file = pathname.replace(/^\/mlb-stats\//, '');
            if (!MLB_STATS_ALLOWED.includes(file))
                return new Response('mlb-stats file not allowed', { status: 403, headers: { 'X-RELAY-Error': 'mlb-stats-not-whitelisted', ...CORS } });
            const targetUrl = `${MLB_STATS_RAW_BASE}/${file}`;
            return relayFetch(targetUrl, { 'Accept': 'application/json' }, 43200, 'mlb-stats', ctx);
        }

        // ── /mlb-umpire-scrape → Savant hp_umpire page scrape ────────────────────
        // Reason this exists: Savant's csv=true crashes server-side for hp_umpire
        // (TypeError: Cannot read properties of undefined (reading 'strikeout')).
        // GitHub Actions IPs are bot-blocked by Savant. CF IPs are not.
        // This Worker fetches the umpire leaderboard HTML from Savant and returns
        // parsed JSON — keyed by last name to match UMPIRE_ABS_RATINGS in FIELD.
        // Cache TTL: 14400s (4h) — data changes weekly, 4h is more than fresh enough.
        if (pathname === '/mlb-umpire-scrape') {
            const cacheKey = new Request('https://field-relay-cache/mlb-umpire-scrape-2026', request);
            const cache = caches.default;
            const hit = await cache.match(cacheKey);
            if (hit) return new Response(hit.body, { ...hit, headers: { ...Object.fromEntries(hit.headers), 'X-Cache': 'HIT', ...CORS } });

            const SAVANT_UMP = 'https://baseballsavant.mlb.com/leaderboard/abs-challenges' +
                '?gameType=regular&groupBy=is_strike_calc&year=2026' +
                '&challengeType=hp_umpire&level=mlb&minChal=3';
            let html = '', status = 0;
            try {
                const r = await fetch(SAVANT_UMP, { headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,*/*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': 'https://baseballsavant.mlb.com/',
                }});
                status = r.status;
                if (r.ok) html = await r.text();
            } catch(e) {
                return new Response(JSON.stringify({ error: `Savant fetch failed: ${e.message}` }),
                    { status: 502, headers: { 'Content-Type': 'application/json', ...CORS } });
            }

            if (!html) return new Response(JSON.stringify({ error: `Savant returned HTTP ${status}` }),
                { status: 502, headers: { 'Content-Type': 'application/json', ...CORS } });

            // ── Parse strategy 1: __NEXT_DATA__ JSON blob ──────────────────────
            // Next.js bakes SSR props into <script id="__NEXT_DATA__"> on every page.
            // If the umpire table data is in there, this is the cleanest extraction.
            let umpires = null;
            const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
            if (ndMatch) {
                try {
                    const nd = JSON.parse(ndMatch[1]);
                    // Walk common Next.js prop structures to find umpire rows
                    const candidates = [
                        nd?.props?.pageProps?.data,
                        nd?.props?.pageProps?.leaderboard,
                        nd?.props?.pageProps?.umpires,
                        nd?.props?.pageProps?.results,
                    ].filter(Boolean);
                    for (const c of candidates) {
                        const parsed = _parseUmpireArray(Array.isArray(c) ? c : Object.values(c));
                        if (parsed && Object.keys(parsed).length >= 5) { umpires = parsed; break; }
                    }
                } catch(e) {}
            }

            // ── Parse strategy 2: HTML table regex ─────────────────────────────
            // Extract <tr> rows, strip tags, find rows with umpire name + numbers.
            if (!umpires) {
                umpires = _parseUmpireHTML(html);
            }

            if (!umpires || Object.keys(umpires).length < 3) {
                // Return debug info so the pipeline can diagnose
                const snippet = html.slice(0, 500);
                return new Response(JSON.stringify({
                    error: 'Could not parse umpire table',
                    htmlLength: html.length,
                    snippet,
                    hint: 'Check if Savant changed challengeType=hp_umpire page structure'
                }), { status: 502, headers: { 'Content-Type': 'application/json', ...CORS } });
            }

            const result = JSON.stringify({
                updated: new Date().toISOString(),
                source: 'Savant via CF Worker',
                data: umpires,
            });
            const resp = new Response(result, {
                headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=14400', ...CORS }
            });
            ctx.waitUntil(cache.put(cacheKey, resp.clone()));
            return resp;
        }
        // Official UFL data provider. Key appended server-side from env.SPORTRADAR_UFL_KEY.
        // Play-by-play: /games/{id}/pbp.json — all EPA fields confirmed May 27 2026.
        // Trial key expires ~Jun 26 2026. All 40 2026 UFL games available.
        if (pathname.startsWith('/sportradar-ufl')) {
            const cleanPath = pathname.replace(/^\/sportradar-ufl/, '') || '/';
            if (!sportradarUflAllowed(cleanPath))
                return new Response('sportradar-ufl path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'sr-ufl-not-whitelisted', ...CORS } });
            const srKey = env.SPORTRADAR_UFL_KEY;
            if (!srKey)
                return new Response('SPORTRADAR_UFL_KEY not configured', { status: 503, headers: { 'X-RELAY-Error': 'sr-ufl-no-key', ...CORS } });
            const sep      = cleanPath.includes('?') ? '&' : '?';
            const targetUrl = `${SPORTRADAR_UFL_BASE}${cleanPath}${sep}api_key=${srKey}`;
            return relayFetch(targetUrl, { 'Accept': 'application/json' }, sportradarUflTtl(cleanPath), 'sportradar-ufl', ctx);
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


        // ── /mcp — MCP Streamable HTTP server ────────────────────────────────────
        // Spec: Model Context Protocol 2025-03-26 (Streamable HTTP transport)
        // Transport: single POST endpoint per spec (replaces SSE from 2024-11-05)
        // Protocol: JSON-RPC 2.0 — verified field names from spec May 30 2026
        // Tools exposed: get_ci_status, get_smoke_count, get_deploy_status,
        //                get_live_scores, get_drama_score, get_espn_game
        // Auth: FIELD_MCP_SECRET header OR OAuth Bearer (Tier 1 Phase 2)
        // VERIFIED: protocolVersion "2025-03-26", capabilities.tools {}, serverInfo

        // GET /mcp — discovery-only response. Some MCP clients probe with GET
        // before POSTing tools/list. Return 401 with WWW-Authenticate so the
        // client can discover the OAuth metadata URL and start the flow.
        if (pathname === '/mcp' && request.method === 'GET') {
            const wwwAuth = `Bearer realm="MCP", resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`;
            return new Response(JSON.stringify({
                error: 'unauthorized',
                error_description: 'MCP endpoint requires OAuth Bearer token. See WWW-Authenticate header for discovery.',
            }), {
                status: 401,
                headers: {
                    ...CORS,
                    'Content-Type': 'application/json',
                    'WWW-Authenticate': wwwAuth,
                },
            });
        }

        if (pathname === '/mcp' && request.method === 'POST') {
            // Auth gate — accepts THREE credentials, any one suffices:
            //   1. OAuth Bearer access token (claude.ai custom connector path)
            //      → validateBearer reads MCP_OAUTH KV (Tier 1 Phase 2)
            //   2. FIELD_MCP_SECRET in Authorization / X-FIELD-MCP-Secret / ?token=
            //      → CI probes (post-probe.yml), Artifact callers
            // Hardened June 2 2026: previous "if (mcpSecret)" let unconfigured worker
            // expose all tools wide open. Now: no secret on worker → 503 Misconfigured.
            // 401 carries WWW-Authenticate per RFC 6750 + MCP spec, advertising
            // OAuth metadata so MCP clients can complete discovery.
            const mcpSecret = env.FIELD_MCP_SECRET;
            if (!mcpSecret) {
                return new Response(JSON.stringify({error:'Server misconfigured: FIELD_MCP_SECRET not set on worker'}), {status:503, headers:{...CORS,'Content-Type':'application/json'}});
            }

            const authHeader = request.headers.get('Authorization');
            const xSecret    = request.headers.get('X-FIELD-MCP-Secret');
            const qToken     = url.searchParams.get('token');

            // 1. Try OAuth bearer token (Tier 1 Phase 2 path)
            const oauthCheck = await oauthValidateBearer(authHeader, env);
            const oauthOK = oauthCheck.valid;

            // 2. Fall back to FIELD_MCP_SECRET match (legacy/CI path)
            const incomingLegacy = xSecret || authHeader || qToken;
            const legacyOK = incomingLegacy && incomingLegacy.includes(mcpSecret);

            if (!oauthOK && !legacyOK) {
                const wwwAuth = `Bearer realm="MCP", resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`;
                return new Response(JSON.stringify({error:'Unauthorized'}), {
                    status: 401,
                    headers: {
                        ...CORS,
                        'Content-Type': 'application/json',
                        'WWW-Authenticate': wwwAuth,
                    },
                });
            }

            let body;
            try { body = await request.json(); } catch(e) {
                return new Response(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}),
                    {status:400, headers:{...CORS,'Content-Type':'application/json'}});
            }

            const { jsonrpc, id, method, params } = body;
            const jsonrpc2 = (result) => JSON.stringify({jsonrpc:'2.0', id, result});
            const jsonrpc2err = (code, message) => JSON.stringify({jsonrpc:'2.0', id, error:{code, message}});
            const respond = (data, status=200) => new Response(data, {status, headers:{...CORS,'Content-Type':'application/json'}});

            // ── initialize ──────────────────────────────────────────────────────
            // VERIFIED: protocolVersion, capabilities.tools, serverInfo fields
            if (method === 'initialize') {
                return respond(jsonrpc2({
                    protocolVersion: '2025-03-26',
                    capabilities: { tools: {} },
                    serverInfo: { name: 'field-relay', version: '1.0.0' },
                }));
            }

            // ── notifications/initialized ───────────────────────────────────────
            // Client sends this after initialize — no response needed per spec
            if (method === 'notifications/initialized') {
                return respond(JSON.stringify({jsonrpc:'2.0',id:null}));
            }

            // ── tools/list ──────────────────────────────────────────────────────
            // VERIFIED: tools array, each tool has name + description + inputSchema
            if (method === 'tools/list') {
                return respond(jsonrpc2({ tools: [
                    {
                        name: 'get_ci_status',
                        description: 'Get the latest GitHub Actions CI run status for jubilant-bassoon. Returns workflow name, conclusion (success/failure/in_progress), and HEAD commit.',
                        inputSchema: { type: 'object', properties: {}, required: [] },
                    },
                    {
                        name: 'get_smoke_count',
                        description: 'Get the current smoke assertion count from the latest index.html in the jubilant-bassoon repo.',
                        inputSchema: { type: 'object', properties: {}, required: [] },
                    },
                    {
                        name: 'get_deploy_status',
                        description: 'Get the last 3 GitHub Actions workflow runs for jubilant-bassoon with their status and conclusions.',
                        inputSchema: {
                            type: 'object',
                            properties: { limit: { type: 'number', description: 'Number of runs to return (default 3, max 5)' } },
                            required: [],
                        },
                    },
                    {
                        name: 'get_live_scores',
                        description: 'Get live NBA scoreboard from the NBA CDN relay.',
                        inputSchema: { type: 'object', properties: {}, required: [] },
                    },
                    {
                        name: 'get_espn_game',
                        description: 'Get ESPN game summary for a specific game ID.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                sport: { type: 'string', description: 'Sport slug (basketball, hockey, baseball, football, soccer)' },
                                league: { type: 'string', description: 'League slug (nba, nhl, mlb, nfl, eng.1 etc.)' },
                                game_id: { type: 'string', description: 'ESPN game ID' },
                            },
                            required: ['sport', 'league', 'game_id'],
                        },
                    },
                    {
                        name: 'read_handoff',
                        description: 'Read the current HANDOFF.md from the jubilant-bassoon FIELD repo. Returns content and SHA as JSON in text field.',
                        inputSchema: { type: 'object', properties: {}, required: [] },
                    },
                    {
                        name: 'write_handoff',
                        description: 'Replace HANDOFF.md in jubilant-bassoon with new content and commit on main. Commit message is prefixed with [skip ci] automatically (HANDOFF.md is paths-ignored anyway; this is belt-and-suspenders).',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                content: { type: 'string', description: 'Full new content of HANDOFF.md (UTF-8 text)' },
                                commit_message: { type: 'string', description: 'Commit message body (will be prefixed with [skip ci])' },
                            },
                            required: ['content', 'commit_message'],
                        },
                    },
                    {
                        name: 'get_head_sha',
                        description: 'Get the current HEAD SHA of jubilant-bassoon main branch. Useful for memory anchor updates after write_handoff.',
                        inputSchema: { type: 'object', properties: {}, required: [] },
                    },
                    {
                        name: 'probe_relay_route',
                        description: 'GET an allow-listed relay route (self-fetch on the same worker) and return its status, content-type, and body. Bypasses the *.workers.dev sandbox block for deployed-route verification. Allow-list is hardcoded relay-side; non-allow-listed routes return an error and are never fetched.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                route: { type: 'string', description: 'Relay path starting with "/", e.g. "/wc/wp/verify". Query string allowed.' },
                            },
                            required: ['route'],
                        },
                    },
                ]}));
            }

            // ── tools/call ──────────────────────────────────────────────────────
            // VERIFIED: content array, each item has type:"text" and text:string
            if (method === 'tools/call') {
                const toolName = params?.name;
                const toolArgs = params?.arguments || {};

                if (toolName === 'get_ci_status' || toolName === 'get_deploy_status') {
                    const limit = Math.min(toolArgs.limit || 3, 5);
                    const ghToken = env.GITHUB_PAT;
                    if (!ghToken) return respond(jsonrpc2({content:[{type:'text',text:'GITHUB_PAT not configured in relay env'}]}));
                    const r = await fetch(
                        `https://api.github.com/repos/jeffunglesbee-create/jubilant-bassoon/actions/runs?per_page=${limit}`,
                        { headers:{ 'Authorization':`Bearer ${ghToken}`, 'User-Agent':'field-relay-mcp', 'Accept':'application/vnd.github+json' } }
                    );
                    if (!r.ok) return respond(jsonrpc2({content:[{type:'text',text:`GitHub API error: ${r.status}`}]}));
                    const data = await r.json();
                    const runs = (data.workflow_runs||[]).slice(0, limit).map(run => (
                        `${run.name} | ${run.conclusion || run.status} | ${run.head_sha?.slice(0,7)} | ${run.updated_at}`
                    )).join('\n');
                    return respond(jsonrpc2({content:[{type:'text',text:runs||'No runs found'}]}));
                }

                if (toolName === 'get_smoke_count') {
                    const ghToken = env.GITHUB_PAT;
                    if (!ghToken) return respond(jsonrpc2({content:[{type:'text',text:'GITHUB_PAT not configured'}]}));
                    const r = await fetch(
                        'https://api.github.com/repos/jeffunglesbee-create/jubilant-bassoon/contents/smoke.js',
                        { headers:{ 'Authorization':`Bearer ${ghToken}`, 'User-Agent':'field-relay-mcp', 'Accept':'application/vnd.github+json' } }
                    );
                    if (!r.ok) return respond(jsonrpc2({content:[{type:'text',text:`GitHub API error: ${r.status}`}]}));
                    const data = await r.json();
                    const smokeJs = atob(data.content);
                    const assertions = (smokeJs.match(/^\s*assert\(/gm) || []).length;
                    return respond(jsonrpc2({content:[{type:'text',text:`Smoke assertions: ${assertions}`}]}));
                }

                if (toolName === 'get_live_scores') {
                    const r = await relayFetch(
                        `${NBA_CDN_BASE}/liveData/scoreboard/todaysScoreboard_00.json`,
                        NBA_HEADERS, NBA_CACHE_TTL, 'nba-mcp', ctx
                    );
                    const text = await r.text();
                    // Return condensed scores only — not full CDN payload
                    try {
                        const d = JSON.parse(text);
                        const games = (d.scoreboard?.games || []).map(g =>
                            `${g.awayTeam?.teamTricode} ${g.awayTeam?.score} @ ${g.homeTeam?.teamTricode} ${g.homeTeam?.score} (${g.gameStatusText})`
                        ).join('\n');
                        return respond(jsonrpc2({content:[{type:'text',text:games||'No games today'}]}));
                    } catch(e) {
                        return respond(jsonrpc2({content:[{type:'text',text:'Score parse error'}]}));
                    }
                }

                if (toolName === 'get_espn_game') {
                    const { sport, league, game_id } = toolArgs;
                    if (!sport || !league || !game_id) {
                        return respond(jsonrpc2({content:[{type:'text',text:'Required: sport, league, game_id'}]}));
                    }
                    const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${game_id}`;
                    const r = await fetch(espnUrl, { headers:{ 'User-Agent':'FIELD-Sports-Intelligence/1.0' }});
                    if (!r.ok) return respond(jsonrpc2({content:[{type:'text',text:`ESPN error: ${r.status}`}]}));
                    const data = await r.json();
                    const comp = data.header?.competitions?.[0];
                    if (!comp) return respond(jsonrpc2({content:[{type:'text',text:'No competition data'}]}));
                    const teams = (comp.competitors||[]).map(c => `${c.team?.abbreviation} ${c.score}`).join(' vs ');
                    const status = comp.status?.type?.description || '';
                    return respond(jsonrpc2({content:[{type:'text',text:`${teams} | ${status}`}]}));
                }

                // ── HANDOFF tools (Tier 1 MCP handoff write-channel, June 2 2026) ──
                // PAT scope = repo (sufficient for read + write Contents API on
                // jubilant-bassoon). Tools deliberately hard-code repo + path —
                // no path/repo input accepted from the caller, so a tool call
                // cannot target index.html or any other repo/file.
                const HANDOFF_API_BASE = 'https://api.github.com/repos/jeffunglesbee-create/jubilant-bassoon';
                const ghHeaders = (token) => ({
                    'Authorization': `Bearer ${token}`,
                    'User-Agent': 'field-relay-mcp',
                    'Accept': 'application/vnd.github+json',
                });

                if (toolName === 'read_handoff') {
                    const ghToken = env.GITHUB_PAT;
                    if (!ghToken) return respond(jsonrpc2({content:[{type:'text',text:'GITHUB_PAT not configured on worker'}], isError:true}));
                    const r = await fetch(`${HANDOFF_API_BASE}/contents/HANDOFF.md`, { headers: ghHeaders(ghToken) });
                    if (!r.ok) {
                        const txt = await r.text();
                        return respond(jsonrpc2({content:[{type:'text',text:`GitHub read failed: ${r.status} ${txt}`}], isError:true}));
                    }
                    const data = await r.json();
                    // GitHub returns base64 with embedded newlines; strip, decode, UTF-8-safe
                    const bytes = atob(data.content.replace(/\n/g, ''));
                    const content = decodeURIComponent(escape(bytes));
                    return respond(jsonrpc2({content:[{type:'text',text:JSON.stringify({content, sha:data.sha})}]}));
                }

                if (toolName === 'write_handoff') {
                    const ghToken = env.GITHUB_PAT;
                    if (!ghToken) return respond(jsonrpc2({content:[{type:'text',text:'GITHUB_PAT not configured on worker'}], isError:true}));
                    const { content, commit_message } = toolArgs;
                    if (typeof content !== 'string' || typeof commit_message !== 'string') {
                        return respond(jsonrpc2({content:[{type:'text',text:'Required: content (string), commit_message (string)'}], isError:true}));
                    }
                    // Fetch current SHA (required by GitHub Contents PUT to prevent blind overwrite)
                    const curR = await fetch(`${HANDOFF_API_BASE}/contents/HANDOFF.md`, { headers: ghHeaders(ghToken) });
                    if (!curR.ok) {
                        const txt = await curR.text();
                        return respond(jsonrpc2({content:[{type:'text',text:`GitHub SHA read failed: ${curR.status} ${txt}`}], isError:true}));
                    }
                    const cur = await curR.json();
                    // UTF-8-safe base64 encode of new content
                    const utf8 = unescape(encodeURIComponent(content));
                    const b64 = btoa(utf8);
                    const msg = commit_message.includes('[skip ci]') ? commit_message : `${commit_message} [skip ci]`;
                    const putR = await fetch(`${HANDOFF_API_BASE}/contents/HANDOFF.md`, {
                        method: 'PUT',
                        headers: { ...ghHeaders(ghToken), 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: msg, content: b64, sha: cur.sha, branch: 'main' }),
                    });
                    if (!putR.ok) {
                        const txt = await putR.text();
                        return respond(jsonrpc2({content:[{type:'text',text:`GitHub write failed: ${putR.status} ${txt}`}], isError:true}));
                    }
                    const putData = await putR.json();
                    return respond(jsonrpc2({content:[{type:'text',text:JSON.stringify({commit: putData.commit.sha, message: msg})}]}));
                }

                if (toolName === 'get_head_sha') {
                    const ghToken = env.GITHUB_PAT;
                    if (!ghToken) return respond(jsonrpc2({content:[{type:'text',text:'GITHUB_PAT not configured on worker'}], isError:true}));
                    const r = await fetch(`${HANDOFF_API_BASE}/git/refs/heads/main`, { headers: ghHeaders(ghToken) });
                    if (!r.ok) {
                        const txt = await r.text();
                        return respond(jsonrpc2({content:[{type:'text',text:`GitHub ref read failed: ${r.status} ${txt}`}], isError:true}));
                    }
                    const data = await r.json();
                    return respond(jsonrpc2({content:[{type:'text',text:JSON.stringify({sha: data.object.sha, branch: 'main'})}]}));
                }

                // ── probe_relay_route ────────────────────────────────────────────
                // Self-fetch an allow-listed relay route via the worker's own
                // public origin, so an MCP client (e.g. Claude in a sandboxed
                // environment that cannot reach *.workers.dev directly) can
                // verify deployed route behaviour without an outbox/.trigger-*
                // CI bounce. GET-only. Allow-list is hardcoded below; routes
                // outside it are rejected without a fetch attempt. Response
                // body is truncated to 12 KB to fit the MCP tool-result budget.
                if (toolName === 'probe_relay_route') {
                    const route = toolArgs.route;
                    if (typeof route !== 'string' || !route.startsWith('/')) {
                        return respond(jsonrpc2({content:[{type:'text',text:'Required: route (string starting with "/")'}], isError:true}));
                    }
                    // Reject anything that looks like an MCP/auth/OAuth path —
                    // probing those would either loop or expose secrets.
                    const FORBIDDEN_PREFIX = ['/mcp', '/oauth', '/.well-known', '/debug', '/push'];
                    if (FORBIDDEN_PREFIX.some(p => route === p || route.startsWith(p + '/') || route.startsWith(p + '?'))) {
                        return respond(jsonrpc2({content:[{type:'text',text:`Route in forbidden-prefix list: ${FORBIDDEN_PREFIX.join(', ')}`}], isError:true}));
                    }
                    // Positive allow-list — extend deliberately, not speculatively.
                    // Each entry is either an exact path or a prefix tested
                    // against the route's pathname (query string is allowed).
                    const ALLOWED_EXACT = new Set([
                        '/health',
                        '/wc/wp/verify',
                        '/wc/standings',
                        '/wc/results',
                        '/wc/odds-probs',
                        '/cfl/odds-probs',
                        '/wc/third-place',
                        '/v2/games',
                        '/v2/standings',
                        // P0 carry-forward (2026-06-05): first step to diagnose
                        // fetchNBAScoreboard()/_nbaGameIdMap path. NYK@SAS Finals
                        // G2 is the first live exposure tonight.
                        '/nba/liveData/scoreboard/todaysScoreboard_00.json',
                        // STAT Worker diagnostic routes (bypasses *.workers.dev sandbox block)
                        '/stat/logs',
                        '/stat/status',
                        '/stat/platform/workday/status',
                        '/stat/platform/greenhouse/status',
                        '/stat/platform/lever/status',
                        '/stat/learning',
                    ]);
                    const ALLOWED_PREFIX = ['/squiggle'];
                    // Split off query string before allow-list comparison.
                    const qIdx = route.indexOf('?');
                    const routePath = qIdx === -1 ? route : route.slice(0, qIdx);
                    const allowed = ALLOWED_EXACT.has(routePath)
                                 || ALLOWED_PREFIX.some(p => routePath === p || routePath.startsWith(p + '/'));
                    if (!allowed) {
                        const allowedList = [...ALLOWED_EXACT, ...ALLOWED_PREFIX.map(p => `${p}/*`)].join(', ');
                        return respond(jsonrpc2({content:[{type:'text',text:`Route not in allow-list. Allowed: ${allowedList}`}], isError:true}));
                    }
                    const target = `${url.origin}${route}`;
                    let r;
                    try {
                        r = await fetch(target, { method: 'GET', headers: { 'User-Agent': 'field-relay-probe', 'Accept': 'application/json, text/plain, */*' }, redirect: 'manual' });
                    } catch (e) {
                        return respond(jsonrpc2({content:[{type:'text',text:`Probe fetch error: ${e.message}`}], isError:true}));
                    }
                    const bodyText = await r.text();
                    const MAX_BODY = 12000;
                    const truncated = bodyText.length > MAX_BODY
                        ? bodyText.slice(0, MAX_BODY) + `\n…[truncated ${bodyText.length - MAX_BODY} bytes]`
                        : bodyText;
                    return respond(jsonrpc2({content:[{type:'text',text:JSON.stringify({
                        target,
                        status: r.status,
                        contentType: r.headers.get('content-type') || '',
                        bodyBytes: bodyText.length,
                        body: truncated,
                    }, null, 2)}]}));
                }

                return respond(jsonrpc2err(-32601, `Unknown tool: ${toolName}`));
            }

            return respond(jsonrpc2err(-32601, `Unknown method: ${method}`));
        }

        // ── /stat/* → STAT Job Watcher Worker ──────────────────────────────────
        // Proxies Claude sandbox-accessible GET requests to the STAT Worker.
        // No caching — STAT endpoints return live DO state.
        // Allows probe_relay_route to read /stat/logs, /stat/status, etc.
        // without the *.workers.dev sandbox block.
        if (pathname.startsWith('/stat/')) {
            const statPath = pathname.replace(/^\/stat/, '');
            const statBase = 'https://stat-job-watcher.jeffunglesbee.workers.dev';
            const statUrl  = `${statBase}${statPath}${url.search || ''}`;
            const statRes  = await fetch(statUrl, {
                method: 'GET',
                headers: { 'User-Agent': 'field-relay-stat-probe', 'Accept': 'application/json, */*' },
            });
            const body = await statRes.text();
            return new Response(body, {
                status: statRes.status,
                headers: {
                    'Content-Type': statRes.headers.get('content-type') || 'application/json',
                    ...CORS,
                },
            });
        }

        // ── /nba-stats/* → stats.nba.com/stats (ADR-003 accept-the-risk)
        // Must be tested BEFORE /nba/* below — otherwise the /nba/* catch-all
        // strips the leading /nba and the remaining "-stats/..." path falls
        // through nbaAllowed() and returns 403.
        if (pathname.startsWith('/nba-stats')) {
            const nbaStatsPath = pathname.replace(/^\/nba-stats/, '') || '/';
            if (!nbaStatsAllowed(nbaStatsPath)) {
                return new Response('Path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'path-not-whitelisted', ...CORS } });
            }
            const upstream = `${NBA_STATS_BASE}${nbaStatsPath}${url.search || ''}`;
            return relayFetch(upstream, NBA_STATS_HEADERS, NBA_STATS_CACHE_TTL, 'nba-stats', ctx);
        }

        // ── /nba/* → NBA CDN
        const nbaPath = pathname.replace(/^\/nba/, '');
        if (!nbaAllowed(nbaPath)) return new Response('Path not allowed', { status: 403, headers: { 'X-RELAY-Error': 'path-not-whitelisted', ...CORS } });
        const nbaTtl = nbaPath.startsWith('/liveData/standings') ? NBA_STANDINGS_TTL : NBA_CACHE_TTL;
        return relayFetch(`${NBA_CDN_BASE}${nbaPath}`, NBA_HEADERS, nbaTtl, 'nba', ctx);
    },

    // ── Queue consumer (WOW 8 — June 1 2026) ─────────────────────────────────
    // Drains field-journalism-queue at upstream-permitted rate.
    // For each job: runs full quality chain identical to /journalism/generate,
    // persists result to FIELD_JOURNALISM KV under jobs:{jobId} for 24h.
    // On 429 from upstream, throws to trigger CF Queues automatic retry/backoff
    // (max_retries=3 from wrangler.toml). On final failure, writes a 'failed'
    // status row so the polling endpoint can report it.
    async queue(batch, env, ctx) {
      const PROXY_URL = env.CLAUDE_PROXY_URL || 'https://field-claude-proxy.jeffunglesbee.workers.dev';
      for (const msg of batch.messages) {
        const job = msg.body || {};
        const jobId = job.jobId;
        if (!jobId || !env.FIELD_JOURNALISM) {
          msg.ack();
          continue;
        }
        try {
          // Mark processing.
          await env.FIELD_JOURNALISM.put(`jobs:${jobId}`,
            JSON.stringify({status:'processing', enqueuedAt: job.enqueuedAt, startedAt: Date.now()}),
            {expirationTtl: 86400});
          // First proxy call to seed the chain.
          const callProxy = async (promptText) => {
            const r = await fetch(PROXY_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-FIELD-Relay': 'field-relay-cron-2026',
              },
              body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: job.max_tokens || 1000,
                messages: [{role: 'user', content: promptText}],
              }),
            });
            if (r.status === 429) {
              // 429 → throw so CF Queues retries this message with backoff.
              throw new Error('upstream 429 rate-limited');
            }
            if (!r.ok) return null;
            const data = await r.json().catch(() => null);
            if (!data) return null;
            return (data.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('').trim() || null;
          };
          const initial = await callProxy(job.prompt);
          if (!initial) throw new Error('proxy returned no prose');
          const result = await runQualityChain(job.prompt, initial, callProxy, {
            sport: job.sport,
            scoreThreshold: job.scoreThreshold || undefined,
            maxRetries: 6,
          });
          // PF-1 parity: strip markdown headers/bold before persisting, so the
          // queue consumer's KV output matches the sync /journalism/generate path.
          const cleanText = stripMarkdown(result.text);
          // Persist completed result.
          await env.FIELD_JOURNALISM.put(`jobs:${jobId}`,
            JSON.stringify({
              status: 'done',
              text: cleanText,
              score: result.score,
              retries: result.retries,
              layers_fired: result.layers_fired,
              ms: result.ms,
              completedAt: Date.now(),
            }),
            {expirationTtl: 86400});
          msg.ack();
        } catch (e) {
          // Let CF Queues retry up to max_retries. If we've already retried max,
          // CF will move on; record a 'failed' marker so the polling endpoint reports it.
          if (msg.attempts && msg.attempts >= 3) {
            await env.FIELD_JOURNALISM.put(`jobs:${jobId}`,
              JSON.stringify({status:'failed', error:e.message, failedAt: Date.now()}),
              {expirationTtl: 86400}).catch(() => {});
            msg.ack();
          } else {
            msg.retry();
          }
        }
      }
    },
};


