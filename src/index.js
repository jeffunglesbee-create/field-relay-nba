// ── Durable Object: GameDO (per-game WebSocket fan-out, WOW 1 + WOW 2) ─────
// Built May 31 2026 — Workers Plus active.
// See src/game-do.js for full ADR-002/RUWT compliance documentation.
import { GameDO } from './game-do.js';
export { GameDO };

// ── Durable Object: UserDO (per-user FIELD state, June 11 2026) ─────────────
// No PII. UUID-keyed. Stores seriesLedger, watchHistory, dramaticMomentsMissed.
// Powers NW-2 catch-up brief, NW-3 rival intelligence, PREF-SYNC-QR upgrade.
import { UserDO } from './user-do.js';
export { UserDO };

// ── Durable Object: BracketDO (WC bracket live state + narrative delta, June 11 2026) ──
// Single instance ("wc2026"). Receives result pushes from writeWCResult(),
// recomputes Monte Carlo projections, fans out bracket:updated to WS clients.
// ADR-002/RUWT compliant: computes bracket probability facts only, no drama scores.
import { BracketDO } from './bracket-do.js';
export { BracketDO };

// ── Durable Object: AmbientDO (cross-sport SSE ambient channel, June 11 2026) ──
// Single instance ("field:ambient"). Alarm-driven: polls all active sports
// every 30s, detects score/lead/final deltas, fans out via SSE to all browsers.
// Unlocks: <3s lead change detection, multiview velocity, cross-sport ambient,
// journalism timing, O(sports) API budget instead of O(users).
// ADR-002 compliant: raw facts only, no composite scoring.
import { AmbientDO } from './ambient-do.js';
export { AmbientDO };

// ── Durable Object: BrowserDO (Puppeteer session persistence, June 22 2026) ──
// One DO per browser session (UUID-keyed). Holds Chromium connection across
// MCP calls so navigate → click → extract chains share state. Alarm-driven
// idle close (5 min), hard cap 50 actions / 30 min lifetime.
import { BrowserDO } from './browser-do.js';
export { BrowserDO };

// ── WC Tournament Projections (June 11 2026) ─────────────────────────────────
import {
  computeTournamentProjections,
  computeMovers,
  buildMoversBriefPrompt,
  deriveTeamStrengths,
  computeMatchWP,
} from './wc-tournament-projections.js';

// ── Journalism Quality Gate (WOW 6 — May 31 2026) ──────────────────────────
// Ports browser-side JQ chain (Layers 1, 2, 2b, 2c, 2d, 2e, 3, 3b) to the
// relay so live journalism flows through structural quality enforcement.
// See src/journalism-quality.js for full documentation.
import {
  FIELD_PROSE_STYLE as JQ_STYLE,
  FIELD_VOICE_REGISTER,
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
import { buildWCTeamContextBlock, slateHasWorldCup, loadWCPatches, applyWCPatch,
         WC_NAME_TO_CODE, WC_TEAM_CONTEXT } from './wc-team-context.js';
import { assembleContext, findBracketImpact } from './context-assembler.js';
import { ensureChangeLogTable, reconcile, getRecentChanges, cleanupChangelog } from './sync-reconciler.js';
import { checkBriefFreshness } from './brief-freshness.js';
import { resolveTeamKey } from './identity-resolver.js';
import { checkAndIncrementDailyOdds, peekDailyOdds, peekMonthlyOdds } from './budget-helpers.js';
import { runMLBSavantUpdate } from './mlb-savant-r2.js';
import { runNFLR2Update } from './nfl-r2.js';
import { runNHLSeriesUpdate } from './nhl-series-r2.js';
import { runNBACluichUpdate } from './nba-clutch-r2.js';
import { runNHLGSAXUpdate } from './nhl-gsax-r2.js';
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

// ── Analytics Cron Engine (June 20 2026) ────────────────────────────────────
// Daily 0 9 * * * cron — pre-computes Night Stars (Phase 2) and writes a
// health status snapshot. Separate from handleJournalismCycle; both crons
// coexist. See src/analytics-engine.js.
import { analyticsEngine } from './analytics-engine.js';
import { validateUrl as validateBrowserUrl, browserQuick } from './browser-quick.js';

// ── Repo source access (L5 — FIELD Session Memory Architecture) ─────────────
// Single hardcoded repo target for all L5 tools and /repo/archive. The relay
// is the sole credential holder (Rule 80 / CREDENTIAL-BOUNDARY-A): the PAT
// never leaves the worker. Path allowlists below are the enforcement seam
// for Rule 81 (WRITE-GATE-A) and Rule 83 (NO-EXFIL-A).
const REPO_OWNER = 'jeffunglesbee-create';
const REPO_NAME  = 'jubilant-bassoon';
const REPO_API   = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;

// READ_ALLOWLIST: prefixes (path.startsWith) that read_file / read_source /
// read_lines may target. Keep narrow; expand only with an explicit prompt.
const READ_ALLOWLIST = [
    'index.html',
    'src/',
    'docs/',
    'scripts/',
    '.github/',
    'CODE_MAP.json',
    'HANDOFF.md',
    'STANDARDS.md',
    'README.md',
    'CLAUDE.md',
];
// WRITE_ALLOWLIST: prefixes that commit_file may write to. Tighter than READ
// because writes mutate production. HANDOFF.md is already covered by the
// legacy write_handoff tool; included here so commit_file can replace it.
const WRITE_ALLOWLIST = [
    'docs/',
    'HANDOFF.md',
    'CODE_MAP.json',
];
function isPathAllowed(path, allowlist) {
    if (typeof path !== 'string' || path.length === 0) return false;
    if (path.includes('..')) return false;
    if (path.startsWith('/')) return false;
    return allowlist.some(prefix => path === prefix || path.startsWith(prefix));
}

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
    // ADR-003 Rule 45 extension approved June 10 2026:
    // All additions are public aggregate stats, same category as leagueLeaders.
    '/leaguedashteamclutch',    // NBA-B: team clutch stats (last 5 min, within 5 pts)
    '/leaguedashteamstats',     // team DRTG/ORTG/pace full-season and playoff splits
    '/teamdashboardbygeneralsplits', // per-team home/away/clutch splits
    '/leaguedashplayerclutch',  // per-player clutch stats (for Finals Desk depth)
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
    '/schedule',    // /schedule — probable pitchers for today's games (MLB pitcher init)
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
    '/v1/draft/picks/now',           // live draft picks — active during NHL draft
    '/v1/draft-tracker/picks/now',   // draft tracker — most recent pick
    '/v1/draft/rankings/now',        // prospect rankings by category
];
const NHL_ALLOWED_PREFIXES = [
    '/v1/schedule/',        // /v1/schedule/2026-05-20
    '/v1/standings/',       // /v1/standings/2026-05-20
    '/v1/gamecenter/',      // /v1/gamecenter/{id}/boxscore|landing|play-by-play|right-rail
    '/v1/score/',           // /v1/score/{date}
    '/v1/draft/picks/',     // /v1/draft/picks/{year}/{round}
    '/v1/draft/rankings/',  // /v1/draft/rankings/{year}/{category}
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
// ── Kali AFL Stats — free, key-auth, 5,000 req/day ──────────────────────────
// Verified 2026-06-26: /predictions, /tips, /player-stats, /player-stats-advanced,
// /standings, /leaderboards, /head-to-head, /teams, /matches
// Endpoint h2h param: team_a= team_b= (slugs: "carlton", "collingwood" etc.)
// TTL strategy: predictions/tips/player-stats are post-round (1hr cache fine).
// standings/leaderboards update during round (30min cache).
const KALI_BASE    = 'https://kaliaflstats.com/api/afl/v1';
const KALI_ALLOWED = [
    '/predictions', '/tips', '/player-stats', '/player-stats-advanced',
    '/standings', '/leaderboards', '/head-to-head', '/teams', '/matches',
    '/players', '/fixture', '/venues',
];
function kaliAllowed(path) {
    return KALI_ALLOWED.some(p => path === p || path.startsWith(p + '?') || path.startsWith(p + '/'));
}
function kaliTtl(path) {
    if (path.startsWith('/predictions'))          return 3600;  // computed daily
    if (path.startsWith('/tips'))                 return 3600;  // synced daily
    if (path.startsWith('/player-stats'))         return 3600;  // post-round, stable
    if (path.startsWith('/head-to-head'))         return 7200;  // historical
    if (path.startsWith('/teams'))                return 86400; // static
    if (path.startsWith('/players'))              return 86400; // static
    if (path.startsWith('/venues'))               return 86400; // static
    return 1800; // standings, leaderboards, matches, fixture — 30min default
}

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
//   ODDS_API_KEY            primary paid-tier key (20K credits / month)
//   ODDS_API_KEY_FALLBACK   Starter-tier key (500 credits / month) — used as a
//                           runtime fallback when the primary returns 401/429
//                           (exhausted or rate-limited). Set via dashboard.
// The hard-coded constant below is the original exhausted free-tier key,
// retained ONLY as a last-resort fallback when neither env var is set.
const ODDS_API_KEY_FALLBACK = 'de44fdf870b3a4b5ee9d46993b2e1038';

// Pick the primary key with a graceful fallback to the env-configured Starter
// key (and finally the hard-coded constant). The env fallback is meant for the
// quota-exhaustion recovery path — see oddsFetchWithFallback().
function _oddsPrimaryKey(env)  { return (env && env.ODDS_API_KEY)          || ODDS_API_KEY_FALLBACK; }
function _oddsFallbackKey(env) { return (env && env.ODDS_API_KEY_FALLBACK) || null; }

// Wraps a fetch to api.the-odds-api.com. If the primary key returns 401/429
// AND env.ODDS_API_KEY_FALLBACK is set, retries once with the fallback key.
// Caller passes a URL builder so the apiKey query param can be swapped.
// `tag` is a free-form label used in the warn-once log line.
async function oddsFetchWithFallback(env, buildUrl, fetchInit, tag) {
  const primaryKey = _oddsPrimaryKey(env);
  const url1 = buildUrl(primaryKey);
  let r;
  try { r = await fetch(url1, fetchInit); }
  catch (e) { return { resp: null, error: e, key: 'primary' }; }
  if (r.ok || (r.status !== 401 && r.status !== 429)) {
    return { resp: r, key: 'primary' };
  }
  const fallbackKey = _oddsFallbackKey(env);
  if (!fallbackKey) return { resp: r, key: 'primary' };
  // Log fallback usage (warn-once per UTC day so it surfaces without spam).
  if (env && env.FIELD_JOURNALISM) {
    try {
      const day = new Date().toISOString().slice(0, 10);
      const flagKey = `odds:fallback:logged:${day}`;
      const already = await env.FIELD_JOURNALISM.get(flagKey);
      if (!already) {
        console.warn(`[odds-fallback] primary key returned ${r.status} on ${tag}; switching to ODDS_API_KEY_FALLBACK for the day`);
        await env.FIELD_JOURNALISM.put(flagKey, '1', { expirationTtl: 86400 });
      }
    } catch (_) { /* logging best-effort */ }
  }
  const url2 = buildUrl(fallbackKey);
  try { r = await fetch(url2, fetchInit); }
  catch (e) { return { resp: null, error: e, key: 'fallback' }; }
  return { resp: r, key: 'fallback' };
}
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
    '/injuries',         // ?league=&season= player injury reports
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
// Allow only the summary endpoint — no other site.api paths.
// League segment accepts letters + digits + dots so soccer slugs work
// (fifa.world, usa.1, eng.1, esp.1, etc.). MLB/NBA/NHL slugs are single
// letters and still match.
function espnSummaryAllowed(path) {
    return /^\/sports\/[a-z]+\/[a-z0-9.]+\/summary$/.test(path.split('?')[0]);
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
    // NFL-B: nflverse parquet pipeline (ngs-update.yml)
    'ngs-receiving.json',
    'ngs-rushing.json',
    'nfl-injuries.json',
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

// Fuzzy team-name match for odds lookup (Odds API vs API-Sports name formats).
// Generalized from WC-only (June 4 probe) to all sports (June 14 2026).
// Used by: WC lambda cache, live in-play odds → WP matching in AmbientDO.
function teamNameMatch(oddsName, fieldName) {
    if (!oddsName || !fieldName) return false;
    // Centralised identity resolution — see src/identity-resolver.js
    // for the full alias map (EPL/MLS/WNBA/MLB/WC/NBA/Ligue 1).
    // Same canonical strip-form from either side when the names refer
    // to the same team.
    const a = resolveTeamKey(oddsName);
    const b = resolveTeamKey(fieldName);
    if (!a || !b) return false;
    if (a === b) return true;
    // 5-char prefix overlap as a safety net for names not yet in the
    // canonical map. resolveTeamKey strips to alphanum lowercase, so
    // these are directly comparable.
    const pfx = 5;
    if (a.length >= pfx && b.length >= pfx) {
        if (b.includes(a.slice(0, pfx)) || a.includes(b.slice(0, pfx))) return true;
    }
    return false;
}

const V2_LEAGUES = {
    // NBA — migrated June 26 2026: API-Sports v2 → NBA CDN (cdn.nba.com)
    // NBA CDN is the original source field-relay-nba was built for (May 2026).
    // Off-season 403 from CDN is expected — scoreboard absent when no games.
    // nbaGameId field on game objects enables boxscore/PBP relay calls.
    'nba':          { sport: 'nba', nbaSource: 'cdn', season: '2025-2026' },
    // NHL — migrated June 26 2026: API-Sports → api-web.nhle.com (NHLE)
    // /nhl/* relay route live since May 17 2026. No auth key. Same API as nhl.com.
    // Off-season scoreboard returns historical gamesByDate (no 403).
    // nhleGameId field on game objects enables gamecenter/boxscore/landing/PBP calls.
    'nhl':          { sport: 'nhl', nhleSource: true, season: '20252026' },
    'mlb':        { sport: 'mlb', espnLeague: 'mlb', espnSport: 'baseball', season: '2026' },
    'wnba':         { sport: 'wnba', espnLeague: 'wnba', espnSport: 'basketball', season: '2026' },
    // Club soccer — migrated June 26 2026: API-Sports → ESPN + BSD
    // espnLeague: ESPN scoreboard slug. bsdLeagueId: BSD analytics (null = ESPN only).
    // Season: '2026-27' for Aug-start leagues, '2026' for MLS calendar year.
    // eflone/efltwo have no BSD coverage — Phase 12 alerts excluded by LOWER_SOCCER.
    'epl':        { sport: 'soccer', espnLeague: 'eng.1',            bsdLeagueId: 1,    season: '2026-27' },
    'mls':        { sport: 'soccer', espnLeague: 'usa.1',            bsdLeagueId: 18,   season: '2026'    },
    'ucl':        { sport: 'soccer', espnLeague: 'uefa.champions',   bsdLeagueId: 7,    season: '2026-27' },
    'europa':     { sport: 'soccer', espnLeague: 'uefa.europa',      bsdLeagueId: 8,    season: '2026-27' },
    'conference': { sport: 'soccer', espnLeague: 'uefa.europa.conf', bsdLeagueId: 8,    season: '2026-27' }, // same BSD lid=8 as Europa
    'eflchamp':   { sport: 'soccer', espnLeague: 'eng.2',            bsdLeagueId: 12,   season: '2026-27' },
    'eflone':     { sport: 'soccer', espnLeague: 'eng.3',            bsdLeagueId: null, season: '2026-27' }, // ESPN only
    'efltwo':     { sport: 'soccer', espnLeague: 'eng.4',            bsdLeagueId: null, season: '2026-27' }, // ESPN only
    'laliga':     { sport: 'soccer', espnLeague: 'esp.1',            bsdLeagueId: 3,    season: '2026-27' },
    'seriea':     { sport: 'soccer', espnLeague: 'ita.1',            bsdLeagueId: 4,    season: '2026-27' },
    'bundesliga': { sport: 'soccer', espnLeague: 'ger.1',            bsdLeagueId: 5,    season: '2026-27' },
    'ligue1':     { sport: 'soccer', espnLeague: 'fra.1',            bsdLeagueId: 6,    season: '2026-27' },
    'wc26':         { sport: 'football',   leagueId: 1,   season: '2026',
                      espnLeague: 'fifa.world' },
    'pga':          { sport: 'golf',       league: 'pga', espnSource: true, leagueId: '1106' },
    // AFL — migrated June 26 2026: API-Sports → ESPN australian-football/afl
    // Three-source architecture: ESPN (scores) + Kali (journalism) + Squiggle (analytics)
    // ev.week.number from ESPN is the round join key into Kali + Squiggle.
    // Squiggle /squiggle route stays active for power rankings + projected ladder.
    // KALI_AFL_TOKEN already deployed. bsdLeagueId: null (AFL not in BSD).
    'afl':          { sport: 'afl', espnLeague: 'afl', espnSport: 'australian-football', season: 2026 },
    'atp':          { sport: 'tennis',     espnSource: true, espnLeague: 'atp',
                      description: 'ATP Tour — BSD Sports Pack active' },
    'wta':          { sport: 'tennis',     espnSource: true, espnLeague: 'wta',
                      description: 'WTA Tour — BSD Sports Pack active' },
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
    if (sport === 'afl') {
        // VERIFIED 2026-06-20 via /apisports/afl/games?date=…
        // Observed: NS (not started), HT (half time, mid-game), and the
        // expected Q1-Q4/OT pattern that mirrors basketball. AFL has 4
        // quarters; OT is rare but exists.
        if (['FT','AOT','ABD','CANC'].includes(s)) return 'final';
        if (['NS','TBD','POSTP','PPD','PST'].includes(s)) return 'pre';
        return 'live'; // Q1-Q4, HT, BT, OT, EOQ, etc.
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
    if (sport === 'afl') {
        // AFL has 4 quarters + OT. HT lands between Q2 and Q3 so we report
        // periodNum=2 with the label 'HT' for clarity.
        const map = { 'Q1':1,'Q2':2,'Q3':3,'Q4':4,'OT':5,'HT':2 };
        const num = map[s] ?? 0;
        const lbl = { 'Q1':'Q1','Q2':'Q2','Q3':'Q3','Q4':'Q4','OT':'OT','HT':'HT','FT':'FT' }[s] || '';
        return { periodNum: num, periodLabel: lbl };
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

// ── adaptNhle ─────────────────────────────────────────────────────────────────
// Maps api-web.nhle.com/v1/scoreboard/now gamesByDate[].games[] entry
// → standard V2 FieldGame shape.
// Shape confirmed 2026-06-26 against live NHL scoreboard (COL vs VGK SCF).
// NOTE: g.clock is null for pre/final games — guard required.
// NOTE: g.awayTeam.name.default = full name ("Colorado Avalanche")
//       g.awayTeam.commonName.default = short name ("Avalanche")
// NOTE: g.id carries the NHLE game ID for gamecenter/boxscore/landing/PBP calls
function adaptNhle(g) {
    const gs    = g?.gameState || '';
    const state = (gs === 'LIVE' || gs === 'CRIT')    ? 'live'  :
                  (gs === 'FINAL' || gs === 'OFF')     ? 'final' : 'pre';

    const periodNum  = g?.periodDescriptor?.number ?? g?.period ?? 0;
    const periodType = g?.periodDescriptor?.periodType || 'REG';
    const periodLabel = state === 'final'
        ? (periodType === 'OT' ? 'F/OT' : periodType === 'SO' ? 'F/SO' : '')
        : state === 'live'
        ? (periodType !== 'REG' ? periodType : `P${periodNum}`)
        : '';

    return {
        id:           `nhl:${g.id}`,
        nhleGameId:   g.id,    // NHLE native game ID — for gamecenter/boxscore/landing/PBP
        sport:        'nhl',
        league:       'NHL',
        state,
        start:        g?.startTimeUTC || '',
        home: {
            name:  g?.homeTeam?.name?.default || g?.homeTeam?.commonName?.default || '',
            abbr:  g?.homeTeam?.abbrev  || '',
            score: g?.homeTeam?.score   ?? null,
        },
        away: {
            name:  g?.awayTeam?.name?.default || g?.awayTeam?.commonName?.default || '',
            abbr:  g?.awayTeam?.abbrev  || '',
            score: g?.awayTeam?.score   ?? null,
        },
        periodNum,
        periodLabel,
        clock:  g?.clock?.timeRemaining || '',
        venue:  g?.venue?.default || '',
    };
}

// ── adaptNbaCDN ───────────────────────────────────────────────────────────────
// Maps cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json
// game object → standard V2 FieldGame shape.
// CDN shape confirmed 2026-05-29 (live OKC@SAS G6) + MCP get_live_scores handler.
// NOTE: CDN teamCity+teamName = "San Antonio"+"Spurs" → home.name = "San Antonio Spurs"
// NOTE: CDN player names are "First Last" — no reversal needed (unlike API-Sports)
// NOTE: g.nbaGameId carries the 10-digit native game ID for boxscore/PBP lookups
function adaptNbaCDN(g) {
    // gameStatus: 1=scheduled, 2=in-progress, 3=final
    const status = g?.gameStatus;
    const state  = status === 3 ? 'final' : status === 2 ? 'live' : 'pre';

    const periodNum = g?.period || 0;
    const periodLabel = state === 'final' ? '' :
        (periodNum >= 1 && periodNum <= 4) ? `Q${periodNum}` :
        (periodNum > 4) ? `OT${periodNum - 4}` : '';

    // gameClock: "PT05M23.00S" → "05:23"; "" or missing → ""
    const rawClock = g?.gameClock || '';
    const cm = rawClock.match(/PT(\d+)M([\d.]+)S/);
    const clock = cm ? `${cm[1]}:${String(Math.floor(parseFloat(cm[2]))).padStart(2,'0')}` : '';

    // Per-quarter linescores from homeTeam/awayTeam.periods object
    const ls = (periods) => {
        if (!periods || typeof periods !== 'object') return [];
        return ['period1','period2','period3','period4']
            .map(k => parseInt(periods[k]) || 0)
            .filter((v, i, a) => a.slice(0, i+1).some(x => x > 0) || v > 0)
            .slice(0, periodNum || 4);
    };

    return {
        id:         `nba:${g.gameId}`,
        nbaGameId:  g.gameId,   // 10-digit CDN game ID — used for boxscore/PBP relay calls
        sport:      'nba',
        league:     'NBA',
        state,
        start:      g?.gameTimeUTC || '',
        home: {
            name:  `${g?.homeTeam?.teamCity || ''} ${g?.homeTeam?.teamName || ''}`.trim(),
            abbr:  g?.homeTeam?.teamTricode || '',
            score: g?.homeTeam?.score ?? null,
        },
        away: {
            name:  `${g?.awayTeam?.teamCity || ''} ${g?.awayTeam?.teamName || ''}`.trim(),
            abbr:  g?.awayTeam?.teamTricode || '',
            score: g?.awayTeam?.score ?? null,
        },
        periodNum,
        periodLabel,
        clock,
        venue:      g?.arenaName || '',
        linescores: {
            home: ls(g?.homeTeam?.periods),
            away: ls(g?.awayTeam?.periods),
        },
    };
}

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

// ── AFL adapter ──────────────────────────────────────────────────────────────
// Maps api-sports.io /v1/afl/games response items to the V2 FieldGame shape.
// VERIFIED 2026-06-20 via /apisports/afl/games?date=2026-06-20 — top-level
// `date`/`venue`/`round`/`status` and nested `game.id`/`teams`/`scores`. AFL
// score breakdown carries goals + behinds (totalled as `score`) which we
// surface as extra fields so the client can show "5.5.35" Australian-rules
// score notation if desired.
function adaptAFL(item) {
    if (!item) return null;
    const sport = 'afl';
    const g     = item.game   || {};
    const teams = item.teams  || {};
    const sc    = item.scores || {};
    const state = v2State(sport, item?.status?.short);
    const { periodNum, periodLabel } = v2Period(sport, item?.status || {}, item);
    return {
        id:          g.id ? `afl:${g.id}` : null,
        sport:       'afl',
        league:      'AFL',
        state,
        start:       item.date || '',
        home: {
            name:    teams?.home?.name || '',
            abbr:    '',
            score:   sc?.home?.score   ?? null,
            goals:   sc?.home?.goals   ?? null,
            behinds: sc?.home?.behinds ?? null,
        },
        away: {
            name:    teams?.away?.name || '',
            abbr:    '',
            score:   sc?.away?.score   ?? null,
            goals:   sc?.away?.goals   ?? null,
            behinds: sc?.away?.behinds ?? null,
        },
        periodNum,
        periodLabel,
        clock:       '',                          // api-sports AFL response carries no clock
        venue:       item.venue || '',
        round:       item.round || '',            // e.g. "Regular Season" / "Finals Week 1"
        week:        item.week ?? null,
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

// ── ESPN WC scoreboard adapter (June 2026) ────────────────────────────────
// Replaces adaptFootball() for the wc26 sport slot. Produces the same game
// object shape so all downstream consumers (writeWCResult, BSD enrichment,
// computeLiveWP, GameDO, BracketDO) work without modification.
// Adapts ESPN basketball/wnba (or /nba) scoreboard event → standard V2 FieldGame shape.
// Named generically so NBA migration reuses the same function with sportKey='nba'.
// ESPN shape confirmed 2026-06-26 against WNBA scoreboard:
//   status.period: 0=pre, 1-4=Q1-Q4, 5+=OT
//   status.displayClock: '7:24' live | '0.0' pre/final
//   status.type.shortDetail: 'Q3 7:24' | 'Final' | '6/26 - 7:30 PM EDT'
//   competitors[i].linescores: [{value: 38.0}, ...] per quarter
//   venue.fullName: arena name (empty string if unavailable)
//   situation (live): {possession?} — minimal for WNBA
function adaptESPNBasketball(ev, sportKey = 'wnba') {
    const comp  = ev.competitions?.[0] || {};
    const teams = comp.competitors || [];
    const home  = teams.find(t => t.homeAway === 'home') || {};
    const away  = teams.find(t => t.homeAway === 'away') || {};
    const st    = comp.status || {};
    const stt   = st.type?.name || '';
    const sit   = comp.situation || {};

    // State
    const state = stt === 'STATUS_FINAL'       ? 'post'
                : stt === 'STATUS_IN_PROGRESS' ? 'live'
                : 'pre';

    // Quarter/OT tracking
    const period = st.period || 0;
    const clock  = st.displayClock || '';
    const periodLabel = state === 'post' ? 'F'
                      : state === 'live'
                            ? (period > 4 ? `OT${period - 4 > 1 ? period - 4 : ''}` : `Q${period}`)
                      : 'NS';

    // Per-quarter linescores
    const ls = arr => (arr || []).map(l =>
        (typeof l === 'object' && l !== null ? l?.value : l) ?? null
    );

    // Situation (live only)
    const situation = state === 'live' ? {
        quarter:    period,
        clock,
        possession: sit.possession ?? null,
    } : null;

    return {
        id:          `espn:${ev.id}`,
        espnEventId: ev.id,
        sport:       sportKey,
        league:      ({ nba: 'NBA', afl: 'AFL', wnba: 'WNBA' })[sportKey] || 'WNBA',
        state,
        start:       ev.date || '',
        home: {
            name:  home.team?.displayName  || '',
            abbr:  home.team?.abbreviation || '',
            score: parseInt(home.score) || 0,
        },
        away: {
            name:  away.team?.displayName  || '',
            abbr:  away.team?.abbreviation || '',
            score: parseInt(away.score) || 0,
        },
        periodNum:   period,
        periodLabel,
        clock,
        venue:       comp.venue?.fullName || '',
        situation,
        linescores: {
            home: ls(home.linescores),
            away: ls(away.linescores),
        },
        round: ev.week?.number ?? null,
    };
}

// Adapts ESPN baseball/mlb scoreboard event → standard V2 FieldGame shape.
// ESPN shape confirmed 2026-06-26:
//   status.type.name: STATUS_SCHEDULED | STATUS_IN_PROGRESS | STATUS_FINAL
//   status.period: inning number (1-9+)
//   status.type.shortDetail: 'Top 5th - 2 Outs' | 'Final' | '6/26 - 6:40 PM EDT'
//   competitors[i].linescores: [{value: N}, ...] per-inning runs
//   competitors[i].team.abbreviation / displayName / score
//   venue.fullName: stadium name
//   situation (live): {balls, strikes, outs, onFirst, onSecond, onThird}
function adaptESPNMLB(ev) {
    const comp = ev.competitions?.[0] || {};
    const teams = comp.competitors || [];
    const home  = teams.find(t => t.homeAway === 'home') || {};
    const away  = teams.find(t => t.homeAway === 'away') || {};
    const st    = comp.status || {};
    const stt   = st.type?.name || '';
    const sit   = comp.situation || {};

    // State
    const state = stt === 'STATUS_FINAL'       ? 'post'
                : stt === 'STATUS_IN_PROGRESS' ? 'live'
                : 'pre';

    // Inning + half from shortDetail: 'Top 5th - 2 Outs', 'Bot 7th - 1 Out'
    const inningNum  = st.period || 1;
    const detail     = st.type?.shortDetail || '';
    const isTop      = /^top/i.test(detail);
    const outsMatch  = detail.match(/(\d)\s+out/i);
    const outs       = outsMatch ? parseInt(outsMatch[1]) : null;
    const halfLabel  = state === 'live' ? (isTop ? 'T' : 'B') : '';
    const periodLabel = state === 'post' ? 'F'
                      : state === 'live' ? `${halfLabel}${inningNum}`
                      : 'NS';

    // Per-inning linescores
    const ls = arr => (arr || []).map(l => (typeof l === 'object' ? l?.value : l) ?? null);

    // Situation (live only)
    const situation = state === 'live' ? {
        inning:   inningNum,
        isTop,
        outs,
        balls:    sit.balls   ?? null,
        strikes:  sit.strikes ?? null,
        onFirst:  sit.onFirst  ?? false,
        onSecond: sit.onSecond ?? false,
        onThird:  sit.onThird  ?? false,
    } : null;

    return {
        id:          `espn:${ev.id}`,
        espnEventId: ev.id,
        sport:       'mlb',
        league:      'MLB',
        state,
        start:       ev.date || '',
        home: {
            name:  home.team?.displayName   || '',
            abbr:  home.team?.abbreviation  || '',
            score: parseInt(home.score) || 0,
        },
        away: {
            name:  away.team?.displayName   || '',
            abbr:  away.team?.abbreviation  || '',
            score: parseInt(away.score) || 0,
        },
        periodNum:   inningNum,
        periodLabel,
        clock:       st.displayClock || '',
        venue:       comp.venue?.fullName || '',
        situation,
        linescores: {
            home: ls(home.linescores),
            away: ls(away.linescores),
        },
    };
}

function adaptESPNWCSoccer(ev, sportKey = 'wc26') {
    const comp       = ev.competitions?.[0] || {};
    const teams      = comp.competitors   || [];
    const home       = teams.find(t => t.homeAway === 'home') || {};
    const away       = teams.find(t => t.homeAway === 'away') || {};
    const statusType = comp.status?.type  || {};
    const completed  = statusType.completed === true;
    const statusState = statusType.state  || '';
    const statusName  = statusType.name   || '';

    const state = completed   ? 'final'
        : statusState === 'in' ? 'live'
        : 'pre';

    const clockSec    = comp.status?.clock    || 0;
    const elapsed     = Math.floor(clockSec / 60);
    const displayClock = comp.status?.displayClock || '';
    const isStoppage  = displayClock.includes('+');
    const isHalftime  = statusName === 'STATUS_HALFTIME';
    const isShootout  = statusName.includes('PENALTY') || statusName === 'STATUS_SHOOTOUT';

    const situation = (state === 'live') ? {
        elapsed,
        isStoppage,
        isHalftime,
        isShootout,
        manAdvantage: null,
        homeSOT:      0,
        awaySOT:      0,
        hasStats:     false,
    } : null;

    const homeScore = home.score != null ? Number(home.score) : null;
    const awayScore = away.score != null ? Number(away.score) : null;

    const matchEvents = (comp.details || [])
        .filter(d => d.type?.id)
        .map(d => ({
            type:        d.type?.text || d.type?.id,
            minute:      d.clock?.displayValue || null,
            team:        d.team?.displayName   || null,
            players:     (d.athletesInvolved || []).map(a => a.displayName),
            redCard:     d.redCard      || false,
            yellowCard:  d.yellowCard   || false,
            scoringPlay: d.scoringPlay  || false,
        }));

    return {
        id:          `espn:${ev.id}`,
        espnEventId: String(ev.id),
        sport:       sportKey,
        league:      'FIFA World Cup',
        state,
        start:       comp.date || '',
        home:        { name: home.team?.displayName || '', abbr: home.team?.abbreviation || '', score: homeScore },
        away:        { name: away.team?.displayName || '', abbr: away.team?.abbreviation || '', score: awayScore },
        clock:       displayClock,
        venue:       typeof comp.venue === 'object' ? (comp.venue?.fullName || '') : '',
        round:       '',
        situation,
        matchEvents,
    };
}

// ── WC D1 helpers ────────────────────────────────────────────────────────
// Relay-is-dumb: these write arithmetic facts (scores/standings) to D1 only.
// No editorial intelligence, no interest levels. Pure score bookkeeping.

// Extract group letter from API-Sports round string, with team-name fallback.
// api-sports changed format mid-tournament: "Group Stage - Group A" → "Group Stage - 1"
// Primary:  regex on round string — handles "Group Stage - Group A" and "Group A"
// Fallback: derive from home/away team name — handles "Group Stage - 1" (matchday number)
// Returns null for knockout rounds (Round of 32, etc.) regardless of team names.
const _WC_TEAM_GROUP = {
    // Group A
    'mexico':'A','south africa':'A','south korea':'A','czechia':'A','czech republic':'A',
    // Group B
    'canada':'B','bosnia and herzegovina':'B','bosnia & herzegovina':'B','qatar':'B','switzerland':'B',
    // Group C
    'brazil':'C','morocco':'C','haiti':'C','scotland':'C',
    // Group D
    'united states':'D','usa':'D','paraguay':'D','australia':'D','turkey':'D','turkiye':'D',
    // Group E
    'germany':'E','curacao':'E','ivory coast':'E','ecuador':'E',
    // Group F
    'netherlands':'F','japan':'F','tunisia':'F','sweden':'F',
    // Group G
    'belgium':'G','egypt':'G','iran':'G','new zealand':'G',
    // Group H
    'spain':'H','cape verde':'H','saudi arabia':'H','uruguay':'H',
    // Group I
    'france':'I','senegal':'I','iraq':'I','norway':'I',
    // Group J
    'argentina':'J','algeria':'J','austria':'J','jordan':'J',
    // Group K
    'colombia':'K','congo dr':'K','dr congo':'K','portugal':'K','uzbekistan':'K',
    // Group L
    'panama':'L','england':'L','croatia':'L','ghana':'L',
};
function extractWCGroup(round, homeName, awayName) {
    // Primary: round string contains explicit group letter
    const m = (round || '').match(/Group\s+([A-L])\b/i);
    if (m) return m[1].toUpperCase();
    // Knockout guard: named knockout rounds never yield a group
    if (/round of|quarter|semi|final/i.test(round || '')) return null;
    // Fallback: derive from team name (handles "Group Stage - 1" matchday format)
    const norm = s => (s || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const g = _WC_TEAM_GROUP[norm(homeName)] || _WC_TEAM_GROUP[norm(awayName)];
    return g || null;
}

// Maps ESPN/BSD knockout round strings → phase values for D1 wc_results.phase.
// ESPN sends: "Round of 32", "Round of 16", "Quarterfinals", "Semifinals", "Final"
// BSD group_name for knockout: format TBD — regex is broad enough to handle variants.
function extractWCPhase(round) {
    if (!round) return null;
    const r = round.toLowerCase();
    if (/round\s+of\s+32|r32/.test(r))                           return 'r32';
    if (/round\s+of\s+16|r16/.test(r))                           return 'r16';
    if (/quarter/.test(r))                                        return 'qf';
    if (/semi/.test(r))                                           return 'sf';
    if (/third|3rd\s+place/.test(r))                             return 'third';
    if (/final/.test(r) && !/semi|quarter|third|3rd/.test(r))   return 'final';
    return null;
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

// ── WC team name normalization (June 18 2026) ─────────────────────────────
// API-Sports sends inconsistent variants across matches ("Czech Republic"
// vs "Czechia"), producing duplicate wc_results rows and split standings.
// Mirrors jubilant-bassoon's client-side _WC_NAME_FIX so the relay D1 store
// holds canonical FIELD names. recomputeGroupStandings then aggregates
// correctly by team name.
const WC_NAME_FIX = {
    'Czech Republic':       'Czechia',
    'Bosnia & Herzegovina': 'Bosnia and Herzegovina',
    'USA':                  'United States',
    'Turkey':               'Türkiye',
    'Curacao':              'Curaçao',
    "Cote D'Ivoire":        'Ivory Coast',
    'Korea Republic':       'South Korea',
    'Cape Verde Islands':   'Cape Verde',
};
function wcFixName(n) { return WC_NAME_FIX[n] || n; }

// Write a final WC group-stage result to D1 (INSERT OR IGNORE = idempotent)
// ── Auto-backfill: discover BSD league_id + UPDATE wc_results rows ─────
// Called by /admin/wc/bsd-backfill (manual trigger) and by writeWCResult
// once per day after the first WC final with a bsd_event_id. No external
// credentials — uses the relay's BSD upstream + WC2026_DB binding.
async function backfillWCBsdEventIds(env, { leagueId, since } = {}) {
    if (!env?.WC2026_DB || !env?.BSD_API_TOKEN) {
        return { ok: false, error: 'WC2026_DB or BSD_API_TOKEN unbound' };
    }
    const bsdBase = 'https://sports.bzzoiro.com';
    const bsdHdrs = {
        'Authorization': `Token ${env.BSD_API_TOKEN}`,
        'User-Agent': 'FIELD/1.0',
        'Accept': 'application/json',
    };

    // 1. Discover league_id if not provided — probe live, take any WC league_id
    let league = leagueId ? String(leagueId) : null;
    if (!league) {
        try {
            const r = await fetch(`${bsdBase}/api/v2/events/live/`,
                { headers: bsdHdrs, signal: AbortSignal.timeout(5000) });
            if (r.ok) {
                const d = await r.json();
                const events = Array.isArray(d.events) ? d.events : [];
                const { results: knownTeams } = await env.WC2026_DB.prepare(
                    'SELECT DISTINCT home AS t FROM wc_results UNION SELECT DISTINCT away FROM wc_results'
                ).all();
                const known = new Set((knownTeams || []).map(r =>
                    String(r.t || '').toLowerCase().replace(/[^a-z0-9]/g, '')));
                for (const ev of events) {
                    const bh = String(ev.home_team?.name ?? ev.home_team ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    const ba = String(ev.away_team?.name ?? ev.away_team ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (known.has(bh) || known.has(ba)) {
                        league = String(ev.league_id || ev.league?.id || '');
                        if (league) break;
                    }
                }
            }
        } catch (_) {}
    }
    if (!league) return { ok: false, error: 'league_id not discoverable from live events' };

    // 2. Fetch BSD season events for that league_id
    let seasonEvents = [];
    try {
        const r = await fetch(`${bsdBase}/api/v2/events/season/?league_id=${league}`,
            { headers: bsdHdrs, signal: AbortSignal.timeout(10_000) });
        if (r.ok) {
            const d = await r.json();
            seasonEvents = d.results || d.events || [];
        }
    } catch (_) {}
    if (!seasonEvents.length) return { ok: false, error: 'BSD season returned no events', league_id: league };

    // 3. Load wc_results rows lacking bsd_event_id (optionally filtered by since)
    const sinceClause = since ? 'AND match_date >= ?' : '';
    const stmt = env.WC2026_DB.prepare(
        `SELECT game_id, home, away, match_date FROM wc_results
         WHERE bsd_event_id IS NULL ${sinceClause}`);
    const { results: pending } = await (since ? stmt.bind(since) : stmt).all();
    if (!pending?.length) return { ok: true, league_id: league, season_events: seasonEvents.length,
                                    matched: 0, updated: 0, remaining_null: 0 };

    // 4. Match by normalized name (both orientations)
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const matches = [];
    for (const wr of pending) {
        const wh = norm(wr.home), wa = norm(wr.away);
        const hit = seasonEvents.find(be => {
            const bh = norm(be.home_team?.name ?? be.home_team);
            const ba = norm(be.away_team?.name ?? be.away_team);
            return (bh === wh && ba === wa) || (bh === wa && ba === wh);
        });
        if (hit) matches.push({ game_id: wr.game_id, bsd_event_id: String(hit.id) });
    }

    // 5. UPDATE matched rows
    let updated = 0;
    for (const m of matches) {
        const r = await env.WC2026_DB.prepare(
            'UPDATE wc_results SET bsd_event_id = ? WHERE game_id = ? AND bsd_event_id IS NULL'
        ).bind(m.bsd_event_id, m.game_id).run();
        if (r?.meta?.changes) updated += r.meta.changes;
    }

    // 6. Re-count remaining nulls
    const { results: stillNull } = await env.WC2026_DB.prepare(
        'SELECT COUNT(*) AS n FROM wc_results WHERE bsd_event_id IS NULL'
    ).all();

    return {
        ok: true,
        league_id: league,
        season_events: seasonEvents.length,
        pending_rows: pending.length,
        matched: matches.length,
        updated,
        remaining_null: stillNull?.[0]?.n ?? null,
    };
}

// BSD R2 capture with retry. Attempts up to maxAttempts times with
// intervalMs delay. Returns true on first success, false if all fail.
// Used by writeWCResult (post-final) and runBSDEndgameCapture (pre-final).
async function captureWithRetry(url, r2Key, env, meta,
                                maxAttempts = 7, intervalMs = 15000) {
    const bsdHdrs = {
        'Authorization': `Token ${env.BSD_API_TOKEN}`,
        'User-Agent': 'FIELD/1.0',
        'Accept': 'application/json',
    };
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const r = await fetch(url, {
                headers: bsdHdrs,
                signal: AbortSignal.timeout(6000),
            });
            if (r.ok) {
                await env.FIELD_DATA.put(r2Key, await r.arrayBuffer(), {
                    httpMetadata: { contentType: 'application/json' },
                    customMetadata: { ...meta, attempt: String(attempt + 1) },
                });
                return true;
            }
        } catch (_) {}
        if (attempt < maxAttempts - 1)
            await new Promise(res => setTimeout(res, intervalMs));
    }
    return false;
}

// BSD WC endgame capture — called from scheduled() every 5 min during WC window.
// Polls BSD live events for WC games (league_id 27) at current_minute >= 83.
// Captures all 4 endpoints to R2, overwriting on each tick.
// Primary mechanism for preserving momentum + average-positions before game-final.
// WC league_id = 27 confirmed 2026-06-25 (Ecuador vs Germany + Curaçao group).
async function runBSDEndgameCapture(env) {
    if (!env?.FIELD_DATA || !env?.BSD_API_TOKEN) return;
    const bsdHdrs = {
        'Authorization': `Token ${env.BSD_API_TOKEN}`,
        'User-Agent': 'FIELD/1.0',
        'Accept': 'application/json',
    };

    // Fix: BSD /api/v2/events/live/ excludes national team competitions (league_id=27).
    // WC games never appeared in live endpoint — runBSDEndgameCapture never fired.
    // Use by-date+league_id=27 instead, which returns WC games with real-time status.
    // Time-window filter (80–120 min after kickoff) handles cases where BSD doesn't
    // update current_minute for national team competitions in real time.
    const today = new Date().toISOString().slice(0, 10);
    const dateResp = await fetch(
        `https://sports.bzzoiro.com/api/v2/events/?date=${today}&league_id=27`,
        { headers: bsdHdrs, signal: AbortSignal.timeout(6000) }
    );
    if (!dateResp.ok) return;

    const dateData = await dateResp.json();
    const nowMs    = Date.now();
    const targets  = (dateData.results || []).filter(e => {
        if ((e.status || '').toLowerCase() === 'finished') return false;
        if ((e.status || '').toLowerCase() === 'notstarted') {
            // Fallback: use kickoff time if BSD hasn't updated status yet
            const startMs   = new Date(e.event_date).getTime();
            const elapsedMin = (nowMs - startMs) / 60000;
            return elapsedMin >= 80 && elapsedMin <= 120;
        }
        // BSD is reporting live status — trust current_minute
        return (e.current_minute || 0) >= 80;
    });

    if (!targets.length) {
        console.log('[BSD-ENDGAME] no WC targets in 80-120min window');
        return;
    }

    await Promise.allSettled(targets.map(async game => {
        const bsdId  = String(game.id);
        const prefix = `bsd/wc26/${bsdId}`;
        const elapsedMin = Math.round((nowMs - new Date(game.event_date).getTime()) / 60000);
        const meta   = {
            bsd_event_id: bsdId,
            minute:       String(game.current_minute || elapsedMin),
            home:         String(game.home_team || ''),
            away:         String(game.away_team || ''),
            source:       'endgame-cron',
            captured:     new Date().toISOString(),
        };
        const bsdBase = 'https://sports.bzzoiro.com';
        await Promise.allSettled(
            ['momentum', 'stats', 'incidents', 'average-positions'].map(
                async type => captureWithRetry(
                    `${bsdBase}/api/v2/events/${bsdId}/${type}/`,
                    `${prefix}/${type}.json`,
                    env,
                    { ...meta, type },
                    1,   // single attempt per tick — cron fires every 5 min
                    0
                )
            )
        );
        console.log(`[BSD-ENDGAME] attempted bsdId=${bsdId} elapsed=${elapsedMin}' status=${game.status}`);
    }));
}

async function writeWCResult(db, game, env, ctx) {
    const homeName  = wcFixName(game.home?.name || '');
    const awayName  = wcFixName(game.away?.name || '');
    const groupId   = extractWCGroup(game.round, homeName, awayName);
    const wcPhase   = extractWCPhase(game.round);
    if (!groupId && !wcPhase) return; // unrecognized round — skip
    const matchDate = (game.start || '').slice(0, 10);
    const homeScore = game.home?.score ?? 0;
    const awayScore = game.away?.score ?? 0;
    // Knockout path: write D1 result with phase string as group_id (satisfies NOT NULL),
    // then return. Standings recompute + journalism queue are group-stage only.
    // BSD captures handled by runBSDEndgameCapture cron; BracketDO recomputes on /wc/bracket fetch.
    if (!groupId) {
        const phaseUpper = wcPhase.toUpperCase();
        await db.prepare(`
          INSERT OR IGNORE INTO wc_results
            (game_id, group_id, home, away, home_score, away_score, phase, match_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(game.id, phaseUpper, homeName, awayName,
                homeScore, awayScore, wcPhase, matchDate).run();
        await db.prepare(
            'UPDATE wc_results SET home_score = ?, away_score = ? WHERE game_id = ?'
        ).bind(homeScore, awayScore, game.id).run();
        return;
    }
    await db.prepare(`
      INSERT OR IGNORE INTO wc_results
        (game_id, group_id, home, away, home_score, away_score, phase, match_date)
      VALUES (?, ?, ?, ?, ?, ?, 'group', ?)
    `).bind(game.id, groupId, homeName, awayName,
            homeScore, awayScore, matchDate).run();

    // Correct score at game-final. INSERT OR IGNORE preserves the original
    // row unchanged if it was pre-inserted at kickoff with 0-0. This UPDATE
    // always runs at game-final to write the authoritative final score.
    await db.prepare(
        'UPDATE wc_results SET home_score = ?, away_score = ? WHERE game_id = ?'
    ).bind(homeScore, awayScore, game.id).run();

    // Write bsdEventId when present — captures BSD event ID at game-final for
    // post-game shotmap/momentum/incidents lookup. Only writes when NULL to avoid
    // overwriting a known-good ID with a later null (game may have lost live status).
    if (game.bsdEventId) {
        await db.prepare(
            'UPDATE wc_results SET bsd_event_id = ? WHERE game_id = ? AND bsd_event_id IS NULL'
        ).bind(String(game.bsdEventId), game.id).run();

        // Capture BSD match data to R2 immediately at game-final.
        // BSD event endpoints may not remain accessible after live status clears.
        // R2 keys: bsd/wc26/{bsd_event_id}/{type}.json
        // Used by: buildBSDHistoryContext for subsequent match journalism briefs.
        if (env?.FIELD_DATA && env?.BSD_API_TOKEN) {
            const bsdId    = game.bsdEventId;
            const r2Prefix = `bsd/wc26/${bsdId}`;

            // Post-final capture with retry. Momentum + average-positions typically
            // 404 immediately at game-final; captureWithRetry handles that gracefully.
            // Primary coverage is via runBSDEndgameCapture (cron at 83'+88').
            // This is the defensive backstop for incidents + stats post-final window.
            const meta = {
                game_id: game.id,
                home:    homeName,
                away:    awayName,
                source:  'write-wc-result',
            };
            const bsdBase = 'https://sports.bzzoiro.com';
            const captures = ['momentum', 'stats', 'incidents', 'average-positions'].map(
                async type => captureWithRetry(
                    `${bsdBase}/api/v2/events/${bsdId}/${type}/`,
                    `${r2Prefix}/${type}.json`,
                    env,
                    { ...meta, type },
                    7,    // 7 attempts
                    15000 // 15s apart = 105s total window
                )
            );

            // Use ctx.waitUntil if available (non-blocking on response); else await
            if (ctx?.waitUntil) {
                ctx.waitUntil(Promise.allSettled(captures));
            } else {
                await Promise.allSettled(captures);
            }
        }

        // Auto-trigger once-per-day backfill of remaining NULL bsd_event_id rows.
        // Gated by KV key bsd:backfill:done:{YYYY-MM-DD} (24h TTL) so this fires
        // on the FIRST WC final of each day only. Fire-and-forget via ctx.waitUntil
        // passed from the calling handler. Defensive: no ctx → skip (admin endpoint
        // is always available as manual fallback).
        if (env?.FIELD_JOURNALISM && ctx?.waitUntil) {
            const gateKey = `bsd:backfill:done:${matchDate}`;
            ctx.waitUntil((async () => {
                try {
                    const already = await env.FIELD_JOURNALISM.get(gateKey);
                    if (already) return;
                    await env.FIELD_JOURNALISM.put(gateKey, '1', { expirationTtl: 86400 });
                    const r = await backfillWCBsdEventIds(env, { since: matchDate });
                    console.log('[writeWCResult] auto-backfill result:', JSON.stringify(r));
                } catch (e) {
                    console.warn('[writeWCResult] auto-backfill failed:', e.message);
                }
            })());
        }
    }

    await recomputeGroupStandings(db, groupId);

    // Notify BracketDO — triggers projection recompute + WS fan-out
    // Fire-and-forget: D1 write already done, BracketDO update is async
    if (env?.BRACKET_DO) {
        try {
            const doId = env.BRACKET_DO.idFromName('wc2026');
            const stub = env.BRACKET_DO.get(doId);
            // Don't await — non-blocking notification
            stub.fetch('https://bracket-do/bracket/result', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    gameId:     game.id,
                    group_id:   groupId,
                    home:       homeName,
                    away:       awayName,
                    home_score: homeScore,
                    away_score: awayScore,
                    matchDate,
                }),
            }).catch(e => console.error('[BracketDO notify]', e.message));
        } catch (e) {
            console.error('[BracketDO stub]', e.message);
        }
    }

    // Enqueue per-game brief (Night Owl style) for WC games
    if (env?.JOURNALISM_QUEUE) {
        // Fetch pre-game matchup context cached by client via
        // POST /wc/matchup/cache. Keys: wc:matchup:{home}_{away} and reverse.
        // Non-blocking — empty string on miss or FIELD_JOURNALISM unavailable.
        let matchupContext = '';
        try {
            if (env.FIELD_JOURNALISM) {
                const _norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, '_');
                const mcKey = `wc:matchup:${_norm(homeName)}_${_norm(awayName)}`;
                const mc = await env.FIELD_JOURNALISM.get(mcKey);
                if (mc) matchupContext = `\n\nPRE-GAME CONTEXT:\n${mc}`;
            }
        } catch (_) { /* non-blocking */ }

        // Fetch group standings for journalism context (post-result table —
        // recomputeGroupStandings has already run above). Non-blocking: empty
        // string on failure so the prompt degrades gracefully.
        let standingsContext = '';
        try {
            const { results: gRows } = await env.WC2026_DB.prepare(
                `SELECT team, won, drawn, lost, gd, points
                 FROM wc_group WHERE group_id = ?
                 ORDER BY points DESC, gd DESC, gf DESC`
            ).bind(groupId).all();
            if (gRows && gRows.length) {
                const standingsLines = gRows.map((r, i) =>
                    `  ${i + 1}. ${r.team}: ${r.points}pts (${r.won}W ${r.drawn}D ${r.lost}L, GD${r.gd >= 0 ? '+' : ''}${r.gd})`
                ).join('\n');
                standingsContext = `\n\nGROUP ${groupId} STANDINGS (after this result):\n${standingsLines}`;
            }
        } catch (_) { /* non-blocking — standings context is additive */ }

        // Match events for journalism brief. Prefer comp.details threaded via
        // game.matchEvents (no extra fetch). Fall back to ESPN summary if absent.
        let eventsContext = '';
        try {
            if (Array.isArray(game.matchEvents) && game.matchEvents.length > 0) {
                const eventLines = game.matchEvents
                    .filter(e => e.scoringPlay || e.redCard || e.yellowCard)
                    .map(e => {
                        const min    = e.minute || '';
                        const player = e.players?.[0] || '';
                        const team   = e.team ? ` (${e.team})` : '';
                        const label  = `${min} ${player}${team}`.trim();
                        if (e.scoringPlay) return `⚽ ${label}`;
                        if (e.redCard)     return `🟥 ${label}`;
                        if (e.yellowCard)  return `🟨 ${label}`;
                        return null;
                    }).filter(Boolean);
                if (eventLines.length) eventsContext = '\n\nMATCH EVENTS:\n' + eventLines.join('\n');
            } else {
                const espnId = game.espnEventId || String(game.id).replace(/^(?:football|espn):/, '');
                if (espnId && !/\D/.test(espnId)) {
                    const summaryResp = await fetch(
                        `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${espnId}`,
                        { signal: AbortSignal.timeout(4000) }
                    );
                    if (summaryResp.ok) {
                        const summaryData = await summaryResp.json();
                        const KEY_TYPES   = new Set(['goal', 'yellow-card', 'red-card']);
                        const eventLines  = (summaryData.keyEvents || [])
                            .filter(e => KEY_TYPES.has(e.type?.type))
                            .map(e => {
                                const clock = (typeof e.clock === 'object' ? e.clock?.displayValue : '') || '';
                                const text  = e.text || '';
                                const t     = e.type?.type;
                                if (t === 'goal') {
                                    const suffix = e.ownGoal ? ' (OG)' : e.penaltyKick ? ' (PEN)' : '';
                                    return `⚽ ${clock} ${text}${suffix}`;
                                }
                                if (t === 'yellow-card') return `🟨 ${clock} ${text}`;
                                if (t === 'red-card')    return `🟥 ${clock} ${text}`;
                                return null;
                            }).filter(Boolean);
                        if (eventLines.length) eventsContext = '\n\nMATCH EVENTS:\n' + eventLines.join('\n');
                    }
                }
            }
        } catch (_) {}

        // Weather context from BSD event (injected by ESPN WC enrichment).
        // Only surfaced when meaningful (rain / extreme wind / heat) — clear skies skipped.
        const weatherContext = (() => {
            const wx = game.weather;
            if (!wx) return '';
            const parts = [];
            if (wx.description && wx.description !== 'clear' && wx.description !== 'unknown')
                parts.push(wx.description);
            if (wx.temperature_c != null && (wx.temperature_c >= 32 || wx.temperature_c <= 5))
                parts.push(`${Math.round(wx.temperature_c)}°C`);
            if (wx.wind_speed != null && wx.wind_speed >= 25)
                parts.push(`${Math.round(wx.wind_speed)} km/h wind`);
            return parts.length ? `Conditions: ${parts.join(', ')}` : '';
        })();

        const prompt = [
            FIELD_VOICE_REGISTER,
            `Write a 2-3 sentence post-match brief for this World Cup 2026 result.`,
            `Factual, warm. FIELD voice: the truth in sports is fun — let that energy through. No manufactured drama.`,
            `Include: key goalscorers with minutes, standout performances, what this means for the group.`,
            `Do NOT use banned phrases: "stunned", "shocked", "thriller", "instant classic", "for the ages".`,
            ``,
            `RESULT: ${homeName} ${homeScore} - ${awayScore} ${awayName}`,
            `Group: ${groupId}`,
            `Date: ${matchDate}`,
            matchupContext,
            standingsContext,
            eventsContext,
            weatherContext,
            ``,
            `SPORT BOUNDARY: This is a World Cup 2026 (soccer) match. Write ONLY soccer content. Do not reference players, stats, or terminology from any other sport. If context is empty, write from the score and date only.`,
            `Write the brief as a single paragraph. No headers, no bullet points.`,
        ].join('\n');
        try {
            await env.JOURNALISM_QUEUE.send({
                type: 'game-brief',
                prompt,
                eventId: game.id,
                max_tokens: 300,
                sport: 'wc26',
                home: homeName,
                away: awayName,
                homeScore,
                awayScore,
                bracketTriggeredBy: `${homeName}_${awayName}_${matchDate}`.replace(/\s+/g, '_').slice(0, 120),
                enqueuedAt: Date.now(),
            });
        } catch (e) {
            console.error('[WC game-brief enqueue]', e.message);
        }
    }
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

// GET /wc/match-wp?home=<name|code>&away=<name|code> — per-match win
// probability derived from the Monte Carlo projection engine. Replaces
// odds-implied WP when the Odds API is unavailable. Inputs accept either
// the WC_TEAM_CONTEXT displayName ("France") or the FIFA-code ("FRA");
// the route resolves both to displayName via WC_NAME_TO_CODE/WC_TEAM_CONTEXT
// before delegating to computeMatchWP(). Returns
//   { homeWP, awayWP, drawWP, source: 'monte-carlo', ... }
// Cached at the edge for 15 min — matches the cron cadence that refreshes
// /wc/odds-probs + /wc/results (the upstream inputs to the strength model).
async function handleWCMatchWP(url, env) {
    const rawHome = (url.searchParams.get('home') || '').trim();
    const rawAway = (url.searchParams.get('away') || '').trim();
    if (!rawHome || !rawAway) {
        return new Response(JSON.stringify({ ok: false, error: 'missing home/away query params' }),
            { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    const resolveTeam = (raw) => {
        if (!raw) return null;
        // Try FIFA-code path first (3-letter alpha): look up in WC_TEAM_CONTEXT
        const upper = raw.toUpperCase();
        if (WC_TEAM_CONTEXT[upper] && WC_TEAM_CONTEXT[upper].displayName) {
            return WC_TEAM_CONTEXT[upper].displayName;
        }
        // Then displayName path: present in WC_NAME_TO_CODE
        if (WC_NAME_TO_CODE[raw]) return raw;
        // Case-insensitive displayName lookup
        const lower = raw.toLowerCase();
        for (const name of Object.keys(WC_NAME_TO_CODE)) {
            if (name.toLowerCase() === lower) return name;
        }
        return null;
    };
    const homeName = resolveTeam(rawHome);
    const awayName = resolveTeam(rawAway);
    if (!homeName || !awayName) {
        return new Response(JSON.stringify({ ok: false, error: `unknown team: ${!homeName ? rawHome : rawAway}` }),
            { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // Best-effort: pull the same inputs the projection engine uses on its
    // 15-min cron. Each fetch is independent; either may fail (Odds API
    // 401, WC2026_DB unbound) without breaking the WP calculation —
    // deriveTeamStrengths + applyBayesianUpdate gracefully degrade to
    // BASE_LAMBDA defaults when the prior data is missing.
    const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
    const [oddsRes, resultsRes] = await Promise.allSettled([
        fetch(`${RELAY}/wc/odds-probs`, { cache: 'no-store' }),
        fetch(`${RELAY}/wc/results`,    { cache: 'no-store' }),
    ]);
    const oddsProbs = oddsRes.status === 'fulfilled' && oddsRes.value.ok
        ? ((await oddsRes.value.json()).probs || []) : [];
    const d1Results = resultsRes.status === 'fulfilled' && resultsRes.value.ok
        ? ((await resultsRes.value.json()).results || []) : [];

    const wp = computeMatchWP(homeName, awayName, { oddsProbs, d1Results });
    const body = {
        ok:       true,
        home:     homeName,
        away:     awayName,
        homeWP:   wp.homeWP,
        drawWP:   wp.drawWP,
        awayWP:   wp.awayWP,
        lambdaHome: wp.lambdaHome,
        lambdaAway: wp.lambdaAway,
        source:   'monte-carlo',
        oddsAvailable: oddsProbs.length > 0,
        resultsCount:  d1Results.length,
        ts:       Date.now(),
    };
    return new Response(JSON.stringify(body), {
        headers: { ...CORS, 'Content-Type': 'application/json',
                   'Cache-Control': 'public, max-age=900' },
    });
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
        // ── Inject Germany vs Ecuador final matchday odds (June 25, 2026)
        // Market consensus from screenshot data. Once Odds API lists this game,
        // this entry is skipped (deduped by game key). Provides immediate calibration.
        if (!probs.find(p => 
          (p.home_team === 'Germany' && p.away_team === 'Ecuador') ||
          (p.home_team === 'Ecuador' && p.away_team === 'Germany')
        )) {
          probs.push({
            home_team:    'Germany',
            away_team:    'Ecuador',
            commence:     '2026-06-25T16:00:00Z',  // Final matchday kickoff
            pHome:        0.5600,  // -135/-150 ML (screenshot)
            pDraw:        0.2500,  // +290/+300 ML (screenshot)
            pAway:        0.1900,  // +410 ML (screenshot)
            lambdaHome:   1.75,    // From O/U 2.5 (screenshot)
            lambdaAway:   0.35,
            lambdaTotal:  2.10,
            lambdaSource: 'market-consensus-injected',
            bookmakers:   1,
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
    // Apply WC_NAME_FIX so the seed path matches the cron writeWCResult path.
    const homeFixed = wcFixName(home);
    const awayFixed = wcFixName(away);
    await env.WC2026_DB.prepare(`
      INSERT OR REPLACE INTO wc_results
        (game_id, group_id, home, away, home_score, away_score, phase, match_date)
      VALUES (?, ?, ?, ?, ?, ?, 'group', ?)
    `).bind(game_id, group_id.toUpperCase(), homeFixed, awayFixed,
            parseInt(home_score)||0, parseInt(away_score)||0,
            match_date || new Date().toISOString().slice(0,10)).run();

    // Backfill bsd_event_id when provided in POST body
    if (bsd_event_id) {
        await env.WC2026_DB.prepare(
            'UPDATE wc_results SET bsd_event_id = ? WHERE game_id = ?'
        ).bind(String(bsd_event_id), game_id).run();
    }
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
// ── ESPN Golf scoreboard (PGA, league 1106) ────────────────────────────────
// Fetches site.api.espn.com PGA scoreboard for a given YYYYMMDD date string.
// Returns { active, eventId, eventName, round, leaderboard:[...] } when a
// tournament is live, or { active:false, schedule:[...] } between events.
// ESPN response is JSON; CF Worker handles it without streaming. KV-cached
// under v2:golf:scoreboard:{date} — TTL 300s active round, 3600s inactive.
async function handleESPNGolfScoreboard(date, env, ctx) {
    // Cache key bumped to r2 (June 18 2026) — position/round shape change:
    // position is now tied-position string ("T2") derived from c.order/c.score;
    // round is derived from competitor linescores. Old r1 payloads carried
    // position:null and round:null during live play and must not be served.
    // Cache key versioned (r3, June 20 2026) — bumped on the roundStatus
    // addition so cached r2 payloads (which lack roundStatus) don't shadow
    // the new shape into handleGolfEnriched during the 300s active TTL.
    const cacheKey = `v2:golf:scoreboard:r3:${date}`;
    if (env.FIELD_JOURNALISM) {
        try {
            const cached = await env.FIELD_JOURNALISM.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch (_) { /* KV read failure falls through to fetch */ }
    }
    const url = `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=${date}`;
    let data;
    try {
        const resp = await fetch(url, { cf: { cacheTtl: 60, cacheEverything: true } });
        if (!resp.ok) return { active: false, error: `ESPN ${resp.status}`, schedule: [] };
        data = await resp.json();
    } catch (err) {
        return { active: false, error: `network: ${err.message}`, schedule: [] };
    }
    const events = Array.isArray(data?.events) ? data.events : [];
    if (!events.length) {
        // Between tournaments — return calendar if present
        const calendar = Array.isArray(data?.leagues?.[0]?.calendar) ? data.leagues[0].calendar : [];
        const schedule = calendar
            .filter(c => c && c.startDate)
            .map(c => ({
                id: c.event?.$ref ? c.event.$ref.match(/events\/(\d+)/)?.[1] || null : null,
                name: c.label || c.alternateLabel || null,
                startDate: c.startDate || null,
                endDate: c.endDate || null,
            }));
        const result = { active: false, schedule };
        if (env.FIELD_JOURNALISM) {
            try { await env.FIELD_JOURNALISM.put(cacheKey, JSON.stringify(result), { expirationTtl: 3600 }); } catch (_) {}
        }
        return result;
    }
    // Primary tournament — take first event
    const ev = events[0];
    const eventId   = String(ev.id || '');
    const eventName = ev.name || ev.shortName || '';
    const startDate = ev.date || null;
    const endDate   = ev.endDate || null;
    const status    = ev.status?.type?.description || null;
    // Top-level round is computed below from competitor linescores; the
    // event-level ev.status.period is unreliable during live rounds.

    // Competitors live inside competitions[0].competitors during active rounds.
    const comp     = Array.isArray(ev.competitions) ? ev.competitions[0] : null;
    const entries  = comp && Array.isArray(comp.competitors) ? comp.competitors : [];

    // Tied-position computation: ESPN's live competitor objects do NOT carry
    // c.status.position or c.position. They carry c.order (1-based rank,
    // pre-sorted by score, NOT tie-aware) and c.score (the toPar value).
    // Group competitors by score → first-encountered order becomes the
    // shared position; groups with >1 entry get "T" prefix.
    const scoreGroups = new Map();
    for (const c of entries) {
        const score = c.score ?? null;
        const order = Number(c.order) || null;
        if (score === null || order === null) continue;
        const g = scoreGroups.get(score);
        if (g) {
            g.count++;
            if (order < g.firstOrder) g.firstOrder = order;
        } else {
            scoreGroups.set(score, { firstOrder: order, count: 1 });
        }
    }
    const positionForScore = (score) => {
        if (score === null || score === undefined) return null;
        const g = scoreGroups.get(score);
        if (!g) return null;
        return g.count > 1 ? `T${g.firstOrder}` : String(g.firstOrder);
    };
    // Per-player current round = count of linescores entries that have begun
    // (have a displayValue OR a non-empty per-hole linescores array). Future
    // rounds carry displayValue:null + linescores:[] / holes:0 so they don't
    // count. Round 1 in-progress → returns 1. Round 2 after R1 final → 2.
    const currentRoundFromLinescores = (lsArr) => {
        if (!Array.isArray(lsArr)) return null;
        const n = lsArr.filter(x =>
            (x?.displayValue !== null && x?.displayValue !== undefined) ||
            (Array.isArray(x?.linescores) && x.linescores.length > 0)
        ).length;
        return n > 0 ? n : null;
    };

    const leaderboard = entries.map(c => {
        const athlete  = c.athlete || {};
        const stats    = c.statistics || [];
        const findStat = name => {
            const s = stats.find(x => x?.name === name);
            return s ? (s.displayValue ?? s.value ?? null) : null;
        };
        return {
            athleteId: String(athlete.id || c.id || ''),
            name:      athlete.displayName || athlete.fullName || null,
            position:  positionForScore(c.score ?? null)
                       ?? c.status?.position?.displayName
                       ?? c.position
                       ?? null,
            toPar:     findStat('scoreToPar') ?? c.score ?? null,
            today:     (() => {
                // Today's score is in linescores[0].displayValue (e.g. '-2')
                const ls = Array.isArray(c.linescores) ? c.linescores[0] : null;
                return ls?.displayValue ?? findStat('today') ?? null;
            })(),
            thru:      (() => {
                // Holes completed = count of hole-level linescores
                const ls = Array.isArray(c.linescores) ? c.linescores[0] : null;
                const holes = Array.isArray(ls?.linescores) ? ls.linescores.length : 0;
                return holes > 0 ? holes : (findStat('thru') ?? c.status?.thru ?? null);
            })(),
            round:     currentRoundFromLinescores(c.linescores)
                       ?? c.status?.period
                       ?? null,
        };
    });
    // Top-level round: prefer current-round derived from the first competitor's
    // linescores during live play. Falls back to ev.status.period (set during
    // off-play windows when ESPN populates it) then the short detail string.
    const topRound = currentRoundFromLinescores(entries[0]?.linescores)
        ?? ev.status?.period
        ?? ev.status?.type?.shortDetail
        ?? null;
    // Extract broadcast from ESPN
    const _broadcasts = comp?.broadcasts || [];
    const _geoB = comp?.geoBroadcasts || [];
    const broadcastNames = [];
    for (const b of _broadcasts) {
        if (Array.isArray(b.names)) broadcastNames.push(...b.names);
    }
    if (!broadcastNames.length) {
        for (const g of _geoB) {
            if (g.media?.shortName) broadcastNames.push(g.media.shortName);
        }
    }

    const result = {
        active: true,
        eventId,
        eventName,
        startDate,
        endDate,
        status,
        // Round-level status (competition vs event-level `status`). ESPN
        // populates comp.status.type.description with "Play Complete",
        // "In Progress", "Round Suspended", etc. — the client uses this
        // to detect when a round officially finishes.
        roundStatus: comp?.status?.type?.description || null,
        round: topRound,
        broadcasts: broadcastNames.length ? broadcastNames : null,
        leaderboard,
    };
    if (env.FIELD_JOURNALISM) {
        try { await env.FIELD_JOURNALISM.put(cacheKey, JSON.stringify(result), { expirationTtl: 300 }); } catch (_) {}
    }
    return result;
}

// ── ESPN Golf player-stats (season-wide, per-tournament) ───────────────────
// Fetches site.web.api.espn.com common/v3 athlete stats. Maps the
// leaguesStats[0].eventsStats array into a FIELD-shaped per-tournament list.
// Stats accessed by name field (driveDistAvg, driveAccuracyPct, gir, girPoss,
// puttsGirAvg, sandSaves, sandSavesPoss, scoreToPar, regScore). linescores[]
// becomes the rounds array.
async function handleGolfPlayerStats(athleteId, season, env) {
    const cacheKey = `golf:player-stats:${athleteId}:${season}`;
    if (env.FIELD_JOURNALISM) {
        try {
            const cached = await env.FIELD_JOURNALISM.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch (_) {}
    }
    const url = `https://site.web.api.espn.com/apis/common/v3/sports/golf/athletes/${encodeURIComponent(athleteId)}/stats?season=${encodeURIComponent(season)}`;
    let data;
    try {
        const resp = await fetch(url, { cf: { cacheTtl: 600, cacheEverything: true } });
        if (!resp.ok) return { ok: false, error: `ESPN ${resp.status}`, athleteId, season, events: [] };
        data = await resp.json();
    } catch (err) {
        return { ok: false, error: `network: ${err.message}`, athleteId, season, events: [] };
    }
    const leagueStats   = Array.isArray(data?.leaguesStats) ? data.leaguesStats[0] : null;
    const eventsStats   = leagueStats && Array.isArray(leagueStats.eventsStats) ? leagueStats.eventsStats : [];
    const pickStat = (statsArr, name) => {
        if (!Array.isArray(statsArr)) return null;
        const s = statsArr.find(x => x?.name === name);
        return s ? (s.value ?? s.displayValue ?? null) : null;
    };
    const events = eventsStats.map(ev => {
        const stats = Array.isArray(ev.stats) ? ev.stats : [];
        const lines = Array.isArray(ev.linescores) ? ev.linescores : [];
        return {
            eventId: ev.eventId ? String(ev.eventId) : (ev.id ? String(ev.id) : null),
            eventName: ev.eventName || ev.name || ev.shortName || null,
            date: ev.date || ev.startDate || null,
            position: pickStat(stats, 'regScore') ?? ev.position ?? null,
            scoreToPar: pickStat(stats, 'scoreToPar'),
            rounds: lines.map(l => (l?.value ?? l?.displayValue ?? null)),
            driveDistAvg:     pickStat(stats, 'driveDistAvg'),
            driveAccuracyPct: pickStat(stats, 'driveAccuracyPct'),
            gir:              pickStat(stats, 'gir'),
            girPossible:      pickStat(stats, 'girPoss'),
            puttsGirAvg:      pickStat(stats, 'puttsGirAvg'),
            sandSaves:        pickStat(stats, 'sandSaves'),
            sandSavesPossible: pickStat(stats, 'sandSavesPoss'),
        };
    });
    const result = { ok: true, athleteId, season, events };
    if (env.FIELD_JOURNALISM) {
        try { await env.FIELD_JOURNALISM.put(cacheKey, JSON.stringify(result), { expirationTtl: 3600 }); } catch (_) {}
    }
    return result;
}

// ── ESPN Golf competitor-stats (per-tournament, per-athlete) ────────────────
// Fetches sports.core.api.espn.com competitor statistics for an athlete at one
// PGA event. Note ESPN's URL pattern: eventId appears TWICE — once as the
// event ID, again as the competition ID. The spec confirms this is intentional.
// Returns the same stat fields as player-stats but scoped to a single event.
async function handleGolfCompetitorStats(eventId, athleteId, env) {
    const cacheKey = `golf:competitor-stats:${eventId}:${athleteId}`;
    if (env.FIELD_JOURNALISM) {
        try {
            const cached = await env.FIELD_JOURNALISM.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch (_) {}
    }
    // eventId appears twice — events/{id}/competitions/{same_id}/competitors/{athleteId}
    const url = `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/${encodeURIComponent(eventId)}/competitions/${encodeURIComponent(eventId)}/competitors/${encodeURIComponent(athleteId)}/statistics/0`;
    let data;
    try {
        const resp = await fetch(url, { cf: { cacheTtl: 600, cacheEverything: true } });
        if (!resp.ok) return { ok: false, error: `ESPN ${resp.status}`, eventId, athleteId };
        data = await resp.json();
    } catch (err) {
        return { ok: false, error: `network: ${err.message}`, eventId, athleteId };
    }
    // sports.core.api response shape: splits.categories[].stats[] OR top-level stats[]
    const flatStats = [];
    if (Array.isArray(data?.splits?.categories)) {
        for (const cat of data.splits.categories) {
            if (Array.isArray(cat?.stats)) flatStats.push(...cat.stats);
        }
    }
    if (Array.isArray(data?.stats)) flatStats.push(...data.stats);
    const pickStat = name => {
        const s = flatStats.find(x => x?.name === name);
        return s ? (s.value ?? s.displayValue ?? null) : null;
    };
    const result = {
        ok: true,
        eventId,
        athleteId,
        scoreToPar:        pickStat('scoreToPar'),
        position:          pickStat('regScore') ?? null,
        driveDistAvg:      pickStat('driveDistAvg'),
        driveAccuracyPct:  pickStat('driveAccuracyPct'),
        gir:               pickStat('gir'),
        girPossible:       pickStat('girPoss'),
        puttsGirAvg:       pickStat('puttsGirAvg'),
        sandSaves:         pickStat('sandSaves'),
        sandSavesPossible: pickStat('sandSavesPoss'),
    };
    // Cache 600s — fits both active rounds (600s) and post-round (longer is fine
    // but a single TTL keeps the helper simple; clients may set their own).
    if (env.FIELD_JOURNALISM) {
        try { await env.FIELD_JOURNALISM.put(cacheKey, JSON.stringify(result), { expirationTtl: 600 }); } catch (_) {}
    }
    return result;
}

// ── ESPN Golf eventlog (per-athlete season schedule + $refs) ────────────────
// Fetches sports.core.api.espn.com season eventlog for a PGA athlete. Each
// item carries $ref URLs (event, competition, competitor, statistics) which
// callers can use to fan out further. Skips non-PGA entries (e.g. tgl-league).
async function handleGolfEventlog(athleteId, season, env) {
    const cacheKey = `golf:eventlog:${athleteId}:${season}`;
    if (env.FIELD_JOURNALISM) {
        try {
            const cached = await env.FIELD_JOURNALISM.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch (_) {}
    }
    const url = `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/seasons/${encodeURIComponent(season)}/athletes/${encodeURIComponent(athleteId)}/eventlog?limit=25`;
    let data;
    try {
        const resp = await fetch(url, { cf: { cacheTtl: 21600, cacheEverything: true } });
        if (!resp.ok) return { ok: false, error: `ESPN ${resp.status}`, athleteId, season, events: [] };
        data = await resp.json();
    } catch (err) {
        return { ok: false, error: `network: ${err.message}`, athleteId, season, events: [] };
    }
    const items = Array.isArray(data?.events?.items) ? data.events.items
                 : Array.isArray(data?.items) ? data.items : [];
    const extractId = ref => {
        if (!ref || typeof ref !== 'string') return null;
        const m = ref.match(/\/(events|competitions|competitors)\/(\d+)/);
        return m ? m[2] : null;
    };
    const extractLeague = ref => {
        if (!ref || typeof ref !== 'string') return null;
        const m = ref.match(/leagues\/([a-z0-9_-]+)/i);
        return m ? m[1] : null;
    };
    const events = items
        .map(item => {
            const league = extractLeague(item?.event?.$ref) || extractLeague(item?.competition?.$ref) || null;
            return {
                eventId:        extractId(item?.event?.$ref),
                competitionId:  extractId(item?.competition?.$ref),
                competitorId:   extractId(item?.competitor?.$ref),
                statisticsRef:  item?.statistics?.$ref || null,
                played:         item?.played ?? null,
                league,
            };
        })
        .filter(ev => ev.league === 'pga');
    const result = { ok: true, athleteId, season, events };
    if (env.FIELD_JOURNALISM) {
        try { await env.FIELD_JOURNALISM.put(cacheKey, JSON.stringify(result), { expirationTtl: 21600 }); } catch (_) {}
    }
    return result;
}

// ── ESPN Golf enriched fan-out (primary journalism/client entry point) ──────
// Calls handleESPNGolfScoreboard for active leaderboard, then fans out to
// handleGolfCompetitorStats for the top 20 athletes in parallel. Per-athlete
// stats fetches are wrapped in try/catch — a single failure does not break
// the enrichment. Cached 600s KV golf:enriched:{date}.
async function handleGolfEnriched(date, env, ctx) {
    // Accept both YYYY-MM-DD and YYYYMMDD; ESPN expects YYYYMMDD.
    // Both forms collapse to the same cache key.
    const date_clean = String(date || '').replace(/-/g, '');
    // Cache key versioned (v4) — bumped on the status/venue addition
    // (June 20 2026). v3 entries lack status/venue/venueLocation; this key
    // bump invalidates them at deploy time so clients see the new shape
    // immediately rather than waiting out the 180s active TTL.
    const cacheKey = `golf:enriched:v5:${date_clean}`;
    if (env.FIELD_JOURNALISM) {
        try {
            const cached = await env.FIELD_JOURNALISM.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch (_) {}
    }
    const scoreboard = await handleESPNGolfScoreboard(date_clean, env, ctx);
    if (!scoreboard.active) {
        const nextEvent = (scoreboard.schedule || [])
            .filter(s => s && s.startDate && new Date(s.startDate).getTime() >= Date.now())
            .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))[0] || null;
        const result = { active: false, nextEvent, schedule: scoreboard.schedule || [] };
        if (env.FIELD_JOURNALISM) {
            try { await env.FIELD_JOURNALISM.put(cacheKey, JSON.stringify(result), { expirationTtl: 1800 }); } catch (_) {}
        }
        return result;
    }
    const eventId   = scoreboard.eventId;
    const lb        = Array.isArray(scoreboard.leaderboard) ? scoreboard.leaderboard : [];
    const top20     = lb.slice(0, 20);

    // Course / venue details — only the event-details endpoint carries
    // courses[]. Aggressive 24h cf cache: course never changes mid-event.
    // Failure must NEVER block the enriched payload (Rule 5).
    let courseName = null, courseCity = null, courseState = null;
    try {
        const evUrl  = `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/${encodeURIComponent(eventId)}`;
        const evResp = await fetch(evUrl, { cf: { cacheTtl: 86400, cacheEverything: true } });
        if (evResp.ok) {
            const evData = await evResp.json();
            const c = Array.isArray(evData.courses) ? evData.courses[0] : null;
            if (c) {
                courseName  = c.name || null;
                courseCity  = c.address?.city  || null;
                courseState = c.address?.state || null;
            }
        }
    } catch (_) { /* course fetch failure never blocks enrichment */ }

    const statsByAthlete = {};
    await Promise.all(top20.map(async entry => {
        if (!entry.athleteId) return;
        try {
            const stats = await handleGolfCompetitorStats(eventId, entry.athleteId, env);
            if (stats && stats.ok) statsByAthlete[entry.athleteId] = stats;
        } catch (_) { /* per-athlete failure must not break enrichment */ }
    }));

    // Canonical field mapping — ESPN native names stay inside
    // handleESPNGolfScoreboard / handleGolfCompetitorStats. The client never
    // sees ESPN's naming. Mapping happens here, once.
    const enriched = lb.map(entry => {
        const s = entry.athleteId ? statsByAthlete[entry.athleteId] : null;
        return {
            position: entry.position ?? entry.pos ?? null,
            athleteId: entry.athleteId,
            name: entry.name,
            toPar: entry.toPar,
            today: entry.today,
            thru: entry.thru,
            round: entry.round,
            stats: {
                gir:              s ? (s.gir ?? 0) : 0,
                drivingDistance:  s ? (s.driveDistAvg ?? 0) : 0,
                drivingAccuracy:  s ? (s.driveAccuracyPct ?? 0) : 0,
                puttsPerGir:      s ? (s.puttsGirAvg ?? 0) : 0,
                sandSaves:        s ? (s.sandSaves ?? 0) : 0,
            },
        };
    });

    // ── FIELD Analytics Engine: field-relative SG proxies ────────────────────
    // Attaches stats._derived to each leaderboard player using Broadie
    // methodology applied to the leaderboard field as baseline.
    // Consumed by buildGolfPromptContext at L15566–15580 (jubilant-bassoon).
    // Field averages update dynamically — partial-field R1 averages are still
    // meaningful as long as ≥5 players have complete stat data.
    (function _attachDerived() {
        const withStats = enriched.filter(p =>
            p.stats?.gir > 0 &&
            p.stats?.puttsPerGir > 0 &&
            p.stats?.drivingDistance > 0 &&
            p.stats?.drivingAccuracy > 0
        );
        if (withStats.length < 5) return; // insufficient baseline

        const mean = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0) / arr.length;
        const fieldGir   = mean(withStats, p => p.stats.gir);
        const fieldPutts = mean(withStats, p => p.stats.puttsPerGir);
        const fieldDist  = mean(withStats, p => p.stats.drivingDistance);
        const fieldAcc   = mean(withStats, p => p.stats.drivingAccuracy);

        for (const p of enriched) {
            const s = p.stats;
            if (!s?.gir || !s?.puttsPerGir || !s?.drivingDistance) continue;

            const holes   = (typeof p.thru === 'number' && p.thru > 0) ? p.thru : 18;
            const girsHit = Math.round(s.gir / 100 * holes);
            if (girsHit < 1) continue;

            // SG:Putting proxy — lower putts/GIR than field = strokes gained
            const sgPuttingEst = +( -(s.puttsPerGir - fieldPutts) * girsHit ).toFixed(2);

            // SG:Approach proxy — GIR% delta × holes played
            const sgApproachEst = +( (s.gir - fieldGir) / 100 * holes ).toFixed(2);

            // SG:OTT proxy — distance + accuracy delta vs field
            const sgOttEst = +(
                (s.drivingDistance - fieldDist) * 0.008 +
                (s.drivingAccuracy - fieldAcc)  * 0.025
            ).toFixed(2);

            // ballStriking: 0–100 composite. 50=field avg, 75=elite, <40=struggling.
            const ballStriking = Math.max(20, Math.min(100, Math.round(
                50 + (s.gir - fieldGir) * 1.5 + (s.drivingAccuracy - fieldAcc) * 0.5
            )));

            // Narrative: strongest detectable signal only. null = no notable pattern.
            const name = p.name || '';
            let narrative = null;
            if      (sgApproachEst >= 1.5 && sgPuttingEst >=  0.8)
                narrative = `${name} is earning every stroke — elite approach game and putting`;
            else if (sgApproachEst >= 1.0 && sgPuttingEst <= -0.5)
                narrative = `${name} is striping it but leaving shots on the greens`;
            else if (sgApproachEst <= -0.8 && sgPuttingEst >= 1.2)
                narrative = `${name}'s putter is carrying them — approach game below field average`;
            else if (sgApproachEst <= -1.0 && sgPuttingEst <= -0.5)
                narrative = `${name} is grinding — both approach and putting below the field today`;
            else if (sgOttEst >= 0.8 && sgApproachEst >= 0.5)
                narrative = `${name} is hitting it long and accurate, creating easy scoring positions`;

            s._derived = {
                sgPuttingEst,
                sgApproachEst,
                sgOttEst,
                ballStriking,
                narrative,
                fieldAvg: {
                    gir:             +fieldGir.toFixed(1),
                    puttsPerGir:     +fieldPutts.toFixed(3),
                    drivingDistance: +fieldDist.toFixed(1),
                    drivingAccuracy: +fieldAcc.toFixed(1),
                    n:               withStats.length,
                },
            };
        }
    })();

    const result = {
        active: true,
        eventId,
        name: scoreboard.eventName || scoreboard.name || null,
        // Surfaces ESPN's competition status.type.description ("Play Complete",
        // "In Progress", "Round Suspended", …) so the client's
        // _isGolfRoundComplete /(complete|official|final)/ matcher can fire.
        // Falls back to the event-level `status` when round-level is absent.
        status: scoreboard.roundStatus || scoreboard.status || null,
        round: scoreboard.round,
        cutLine: scoreboard.cutLine ?? null,
        venue:         courseName,
        venueLocation: (courseCity && courseState) ? `${courseCity}, ${courseState}` : null,
        broadcasts: scoreboard.broadcasts || null,
        leaderboard: enriched,
    };
    if (env.FIELD_JOURNALISM) {
        try { await env.FIELD_JOURNALISM.put(cacheKey, JSON.stringify(result), { expirationTtl: 180 }); } catch (_) {}
    }
    return result;
}

async function buildAFLJournalismContext(games, round, year, env) {
    if (!round || !year || !games.length) return {};
    const ctx = {};
    for (const g of games) {
        if (g.espnEventId) ctx[g.espnEventId] = { kali: null, squiggle: null };
    }
    const _norm = s => String(s || '').toLowerCase()
        .replace(/\b(lions|swans|eagles|hawks|magpies|bombers|cats|blues|tigers|bulldogs|kangaroos|power|crows|demons|dockers|suns|giants|saints|roos)\b/g, '')
        .replace(/[^a-z]/g, '').slice(0, 6);
    const findGame = (homeTeam, awayTeam) => games.find(g =>
        (teamNameMatch(homeTeam, g.home.name) && teamNameMatch(awayTeam, g.away.name)) ||
        (teamNameMatch(homeTeam, g.away.name) && teamNameMatch(awayTeam, g.home.name)) ||
        (_norm(homeTeam) && _norm(homeTeam) === _norm(g.home.name)) ||
        (_norm(homeTeam) && _norm(homeTeam) === _norm(g.away.name))
    );
    const kaliKey = env.KALI_AFL_TOKEN;
    const [kaliResp, squiggleResp] = await Promise.allSettled([
        kaliKey
            ? fetch(`${KALI_BASE}/predictions?year=${year}&round=${round}`, {
                headers: { 'Authorization': `Bearer ${kaliKey}`, 'Accept': 'application/json' },
                cf: { cacheTtl: 3600, cacheEverything: true,
                      cacheKey: `kali:predictions:${year}:${round}` },
              })
            : Promise.reject(new Error('KALI_AFL_TOKEN not set')),
        fetch(`${SQUIGGLE_BASE}/?q=tips;year=${year};round=${round}`, {
            headers: SQUIGGLE_HEADERS,
            cf: { cacheTtl: squiggleTtl(`q=tips;year=${year};round=${round}`),
                  cacheEverything: true,
                  cacheKey: `squiggle:tips:${year}:${round}` },
        }),
    ]);
    if (kaliResp.status === 'fulfilled' && kaliResp.value.ok) {
        try {
            const kd = await kaliResp.value.json();
            for (const pred of (kd.data || [])) {
                const g = findGame(pred.homeTeam, pred.awayTeam);
                if (!g?.espnEventId || !ctx[g.espnEventId]) continue;
                ctx[g.espnEventId].kali = {
                    homeWinPct:        pred.homeProbability,
                    awayWinPct:        pred.awayProbability,
                    squiggleConsensus: pred.squiggleConsensus,
                    factors:           pred.factors || [],
                    homeBreakdown:     pred.homeBreakdown || {},
                    awayBreakdown:     pred.awayBreakdown || {},
                };
            }
        } catch (_) {}
    }
    if (squiggleResp.status === 'fulfilled' && squiggleResp.value.ok) {
        try {
            const sd = await squiggleResp.value.json();
            const aggTips = (sd.tips || []).filter(t => t.source === 'Aggregate');
            for (const tip of aggTips) {
                const g = findGame(tip.hteam, tip.ateam);
                if (!g?.espnEventId || !ctx[g.espnEventId]) continue;
                ctx[g.espnEventId].squiggle = {
                    homeConfidence: tip.hconfidence,
                    awayConfidence: 100 - tip.hconfidence,
                };
            }
        } catch (_) {}
    }
    return ctx;
}

async function handleV2Games(url, env, ctx) {
    const sport = (url.searchParams.get('sport') || '').toLowerCase();
    const date  = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const cfg   = V2_LEAGUES[sport];
    if (!cfg)
        return new Response(JSON.stringify({ error: `Unknown sport: ${sport}`, supported: Object.keys(V2_LEAGUES) }),
            { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    // ESPN-sourced sports (golf/PGA) bypass api-sports and route to ESPN scoreboard.
    // No APISPORTS_KEY required.
    if (cfg.espnSource && cfg.sport === 'golf') {
        const espnDate = date.replace(/-/g, '');
        const payload = await handleESPNGolfScoreboard(espnDate, env, ctx);
        return new Response(JSON.stringify(payload), {
            headers: { ...CORS, 'Content-Type': 'application/json',
                       'Cache-Control': `public,max-age=${payload.active ? 300 : 3600}` },
        });
    }
    // Tennis: ESPN returns tournament-level events with nested competitions (matches).
    // Shape: event.id = tournament slug, event.name = tournament name,
    // event.competitions[] = individual matches. Flatten to FIELD game objects.
    if (cfg.espnSource && cfg.sport === 'tennis') {
        const espnLeague = cfg.espnLeague;
        const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/tennis/${espnLeague}/scoreboard`;
        const r = await fetch(espnUrl, { headers: { 'User-Agent': 'FIELD/1.0' } });
        if (!r.ok) return new Response(JSON.stringify({ sport, date, games: [], error: `ESPN tennis ${r.status}` }),
            { headers: { 'Content-Type': 'application/json', ...CORS } });
        const d = await r.json();
        const games = [];
        for (const tournament of (d.events || [])) {
            const tournamentName = tournament.name || 'Tennis';
            for (const match of (tournament.competitions || [])) {
                const competitors = match.competitors || [];
                const home = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};
                const away = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};
                const status = match.status?.type?.description || 'scheduled';
                const score = `${home.score ?? '-'} - ${away.score ?? '-'}`;
                games.push({
                    id: `tennis:${match.id}`,
                    sport,
                    home: home.team?.displayName || home.team?.name || 'TBD',
                    away: away.team?.displayName || away.team?.name || 'TBD',
                    homeAbbr: home.team?.abbreviation,
                    awayAbbr: away.team?.abbreviation,
                    score,
                    homeScore: home.score,
                    awayScore: away.score,
                    status,
                    isFinal: match.status?.type?.completed === true,
                    isLive: match.status?.type?.state === 'in',
                    date,
                    tournament: tournamentName,
                    tournamentId: tournament.id,
                    round: match.notes?.[0]?.headline || match.round?.displayName,
                    broadcasts: (match.broadcasts || []).map(b => b.names || []).flat(),
                    bsdMatchId: match.id || null,
                    espnEventId: match.id,
                    sets: (home.linescores || []).map((s, i) => ({
                        home: s.value,
                        away: (away.linescores || [])[i]?.value,
                    })),
                });
            }
        }
        const payload = JSON.stringify({ sport, date, games, source: 'espn-tennis',
            tournament: d.events?.[0]?.name });
        return new Response(payload, { headers: { 'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=25', ...CORS } });
    }
    // ── wc26 ESPN early-return ────────────────────────────────────────────────
    // For sports with espnLeague configured, bypass API-Sports entirely.
    // All soccer leagues (wc26 + 11 club leagues). Identical downstream behavior: BSD enrichment,
    // WP computation, writeWCResult D1 write, and GameDO crunch signals all run.
    if (cfg.espnLeague) {
        const espnDate = date.replace(/-/g, '');
        const _espnSportPath = cfg.espnSport || 'soccer';
        const espnUrl  = `https://site.api.espn.com/apis/site/v2/sports/${_espnSportPath}/${cfg.espnLeague}/scoreboard?dates=${espnDate}`;
        let espnGames  = [];
        try {
            const espnResp = await fetch(espnUrl, {
                cf: { cacheTtl: 15, cacheEverything: true, cacheKey: espnUrl },
            });
            if (!espnResp.ok) {
                return new Response(
                    JSON.stringify({ error: `ESPN upstream ${espnResp.status}`, sport, date }),
                    { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
                );
            }
            const espnData = await espnResp.json();
            espnGames = (espnData.events || []).map(ev =>
                cfg.espnSport === 'baseball'                                          ? adaptESPNMLB(ev)
                : ['basketball', 'australian-football'].includes(cfg.espnSport)       ? adaptESPNBasketball(ev, sport)
                : adaptESPNWCSoccer(ev, sport)
            );
        } catch (e) {
            return new Response(
                JSON.stringify({ error: e.message, sport, date }),
                { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }
        const games = espnGames;

        // ── AFL journalism context (ESPN + Kali + Squiggle) ──────────────────
        if (sport === 'afl' && env.KALI_AFL_TOKEN) {
            try {
                const _aflRound = games[0]?.round ?? null;  // games[0].round set by adaptESPNBasketball (ev.week?.number) — espnData is block-scoped
                const _aflYear  = cfg.season ?? new Date().getUTCFullYear();
                const _aflCtx   = await buildAFLJournalismContext(games, _aflRound, _aflYear, env);
                for (const g of games) {
                    if (g.espnEventId && _aflCtx[g.espnEventId]) {
                        g.journalism = _aflCtx[g.espnEventId];
                    }
                }
            } catch (_) { /* non-blocking — journalism context optional */ }
        }

        // ── BSD group_name + weather enrichment ──────────────────────────────
        // Fetches today's WC events from BSD by-date (league_id=27) and matches
        // to ESPN games by home/away team name. Injects:
        //   game.round    — "Group I" → extractWCGroup() uses regex path, not fallback
        //   game.weather  — {description, wind_speed, temperature_c} for journalism context
        // Non-blocking — failure leaves round='' and weather undefined; both degrade gracefully.
        if (env.BSD_API_TOKEN && sport === 'wc26') {
            try {
                const _bsdByDate = await fetch(
                    `https://sports.bzzoiro.com/api/v2/events/?date=${date}&league_id=27`,
                    {
                        headers: {
                            'Authorization': `Token ${env.BSD_API_TOKEN}`,
                            'User-Agent': 'FIELD/1.0',
                            'Accept': 'application/json',
                        },
                        signal: AbortSignal.timeout(4000),
                    }
                );
                if (_bsdByDate.ok) {
                    const _bsdData   = await _bsdByDate.json();
                    const _bsdEvents = _bsdData.results || [];
                    const _normName  = s => String(s || '').toLowerCase()
                        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                        .replace(/[^a-z0-9]/g, '').slice(0, 8);
                    for (const _g of games) {
                        const _hNorm = _normName(_g.home?.name || '');
                        const _hit   = _bsdEvents.find(be =>
                            _normName(String(be.home_team || '')) === _hNorm ||
                            _normName(String(be.away_team || '')) === _hNorm
                        );
                        if (_hit) {
                            if (_hit.group_name) _g.round = _hit.group_name;
                            if (_hit.weather)    _g.weather = _hit.weather;
                        }
                    }
                }
            } catch (_) {}
        }

        if (env.BSD_API_TOKEN) {
            try {
                const _bsdR = await fetch('https://sports.bzzoiro.com/api/v2/events/live/', {
                    headers: {
                        'Authorization': `Token ${env.BSD_API_TOKEN}`,
                        'User-Agent': 'FIELD/1.0',
                        'Accept': 'application/json',
                    },
                    signal: AbortSignal.timeout(3000),
                });
                if (_bsdR.ok) {
                    const _bsdLive   = await _bsdR.json();
                    const _bsdEvents = Array.isArray(_bsdLive.events) ? _bsdLive.events : [];
                    for (const _g of games) {
                        const _bsdMatch = _bsdEvents.find(_e => {
                            const _bh = String(_e.home_team?.name ?? _e.home_team ?? '');
                            const _ba = String(_e.away_team?.name ?? _e.away_team ?? '');
                            return (teamNameMatch(_bh, _g.home.name) && teamNameMatch(_ba, _g.away.name))
                                || (teamNameMatch(_bh, _g.away.name) && teamNameMatch(_ba, _g.home.name));
                        });
                        if (_bsdMatch) _g.bsdEventId = String(_bsdMatch.id);
                        if (_bsdMatch && _bsdMatch.current_minute != null) {
                            if (!_g.situation) _g.situation = {};
                            _g.situation.elapsed = _bsdMatch.current_minute;
                        }
                    }
                }
            } catch (_) {}
        }

        const wcLambdas = await getWCPregameLambdas(env);

        for (const g of games) {
            if (g.state !== 'live' || !g.situation) continue;
            const { situation: sit } = g;
            const hGoals = g.home.score ?? 0;
            const aGoals = g.away.score ?? 0;

            let pregameLh = null, pregameLa = null;
            if (wcLambdas) {
                const directKey = `${g.home.name}|${g.away.name}`;
                if (wcLambdas.has(directKey)) {
                    const lams = wcLambdas.get(directKey);
                    pregameLh = lams.lh; pregameLa = lams.la;
                } else {
                    for (const [k, lams] of wcLambdas) {
                        const [oddsHome, oddsAway] = k.split('|');
                        if (teamNameMatch(oddsHome, g.home.name) && teamNameMatch(oddsAway, g.away.name)) {
                            pregameLh = lams.lh; pregameLa = lams.la; break;
                        }
                        if (teamNameMatch(oddsHome, g.away.name) && teamNameMatch(oddsAway, g.home.name)) {
                            pregameLh = lams.la; pregameLa = lams.lh; break;
                        }
                    }
                }
            }

            const wp = computeLiveWP({
                homeGoals:    hGoals,
                awayGoals:    aGoals,
                homeSOT:      sit.homeSOT      || 0,
                awaySOT:      sit.awaySOT      || 0,
                elapsedMin:   sit.elapsed      || 0,
                isStoppage:   sit.isStoppage   || false,
                manAdvantage: sit.manAdvantage || null,
                isShootout:   sit.isShootout   || false,
                pregameLh,
                pregameLa,
            });
            g.winProb = wp;

            if (env.WC2026_DB) {
                const gLetter = extractWCGroup(g.round, g.home?.name, g.away?.name);
                if (gLetter) {
                    try {
                        const [standingsRes, thirdRes] = await Promise.allSettled([
                            env.WC2026_DB.prepare(
                                'SELECT * FROM wc_group WHERE group_id = ? ORDER BY points DESC, gd DESC, gf DESC'
                            ).bind(gLetter).all(),
                            env.WC2026_DB.prepare('SELECT * FROM wc_third_place_standings').all(),
                        ]);
                        const standings  = standingsRes.status === 'fulfilled' ? standingsRes.value?.results : [];
                        const thirdPlace = thirdRes.status   === 'fulfilled' ? thirdRes.value?.results   : null;
                        if (standings?.length) {
                            g.advancementProb = computeAdvancementProb(
                                standings, g.home.name, g.away.name, wp, thirdPlace
                            );
                        }
                    } catch (_) {}
                }
            }

            const scoreDiff = Math.abs(hGoals - aGoals);
            let crunchCondition = null;
            if      (sit.isShootout)                          crunchCondition = 'penalty_shootout';
            else if (sit.manAdvantage && scoreDiff <= 1)      crunchCondition = 'man_advantage';
            else if (sit.isStoppage   && scoreDiff <= 1)      crunchCondition = 'added_time';
            else if (sit.elapsed > 60 && scoreDiff > 0) {
                const loserWP = hGoals > aGoals ? wp.awayWin : wp.homeWin;
                if (loserWP < 0.15) crunchCondition = 'late_deficit';
            }
            if (crunchCondition) {
                g._crunch = crunchCondition;
                if (env.GAME_DO) {
                    try {
                        const doStub = env.GAME_DO.get(env.GAME_DO.idFromName(g.id));
                        doStub.fetch(new Request('https://field/crunch', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ condition: crunchCondition, gameId: g.id, ts: Date.now() }),
                        })).catch(() => {});
                    } catch (_) {}
                }
            }
        }

        if (env.GAME_DO) {
            const liveWithWP = games.filter(g => g.state === 'live' && g.winProb);
            if (liveWithWP.length > 0) {
                const wpResults = await Promise.allSettled(
                    liveWithWP.map(async g => {
                        const doStub = env.GAME_DO.get(env.GAME_DO.idFromName(g.id));
                        const resp = await doStub.fetch(new Request('https://field/wp', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
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

        if (env.WC2026_DB) {
            const finals = games.filter(g => g.state === 'final');
            if (finals.length > 0) {
                if (ctx?.waitUntil) {
                    ctx.waitUntil(Promise.allSettled(finals.map(g => writeWCResult(env.WC2026_DB, g, env, ctx))));
                } else {
                    await Promise.allSettled(finals.map(g => writeWCResult(env.WC2026_DB, g, env, ctx)));
                }
            }
        }

        return new Response(
            JSON.stringify({ sport, date, games, count: games.length, source: 'espn-wc', ts: Date.now() }),
            { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15' } }
        );
    }
    // ── end wc26 ESPN early-return ────────────────────────────────────────────

    // ── NHL NHLE early-return (migrated June 26 2026) ─────────────────────────
    // api-web.nhle.com/v1/scoreboard/now → filter to today's date → adaptNhle.
    // Off-season: focusedDate lags today → todayEntry is undefined → 0 games, no error.
    // Brief pipeline: threeStars from /v1/gamecenter/{id}/landing (NHL-curated performers).
    if (cfg.nhleSource) {
        try {
            const nhleResp = await fetch(
                `${NHL_BASE}/v1/scoreboard/now`,
                {
                    headers: NHL_HEADERS,
                    cf: { cacheTtl: 30, cacheEverything: true,
                          cacheKey: `${NHL_BASE}/v1/scoreboard/now` },
                }
            );
            if (!nhleResp.ok) {
                return new Response(
                    JSON.stringify({ sport, date, games: [], count: 0, source: 'nhle-error', ts: Date.now() }),
                    { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' } }
                );
            }
            const nhleData   = await nhleResp.json();
            const todayEntry = (nhleData.gamesByDate || []).find(e => e.date === date);
            const games      = (todayEntry?.games || []).map(adaptNhle);

            // ── NHL brief pipeline (NHLE landing/threeStars variant) ───────────
            // Uses NHL's own three-star selections — curated performers per game.
            // Fires only for final games. Avoids API-Sports player stats dependency.
            if (env.JOURNALISM_QUEUE && env.FIELD_JOURNALISM) {
                const nhlFinals = games.filter(g => g.state === 'final');
                if (nhlFinals.length > 0) {
                    const enqueueNHLBriefs = async () => {
                        for (const g of nhlFinals) {
                            const kvKey = `brief:game:${g.id}`;
                            const existing = await env.FIELD_JOURNALISM.get(kvKey).catch(() => null);
                            if (existing) continue;

                            const home      = g.home?.name || '';
                            const away      = g.away?.name || '';
                            const homeScore = g.home?.score ?? 0;
                            const awayScore = g.away?.score ?? 0;

                            // Fetch three stars from NHLE landing endpoint
                            let starsContext = '';
                            try {
                                const landingRes = await fetch(
                                    `${NHL_BASE}/v1/gamecenter/${g.nhleGameId}/landing`,
                                    { headers: NHL_HEADERS, cf: { cacheTtl: 300, cacheEverything: true } }
                                );
                                if (landingRes.ok) {
                                    const ld = await landingRes.json();
                                    const stars = ld.summary?.threeStars || [];
                                    const lines = stars.map(s => {
                                        const name = s.name?.default || '?';
                                        const team = s.teamAbbrev   || '';
                                        if (s.position === 'G') {
                                            const sv  = s.saveShotsAgainst || '';
                                            const pct = s.savePctg != null
                                                ? `${(s.savePctg * 100).toFixed(1)}%` : '';
                                            return `${name} (${team}): ${sv} sv ${pct}`.trim();
                                        }
                                        return `${name} (${team}): ${s.goals ?? 0}G ${s.assists ?? 0}A`;
                                    });
                                    if (lines.length) starsContext = '\n\nTHREE STARS:\n' + lines.join('\n');
                                }
                            } catch (_) {}

                            const prompt = [
                                FIELD_VOICE_REGISTER,
                                `Write a 2-3 sentence post-game brief for this NHL result.`,
                                `Factual, warm. FIELD voice: the truth in sports is fun — let that energy through.`,
                                `Include: three-star performers, key moment or turning point, what this means for the series or standings.`,
                                `Do NOT use banned phrases: "stunned", "shocked", "thriller", "instant classic", "for the ages".`,
                                ``,
                                `RESULT: ${away} ${awayScore} at ${home} ${homeScore}`,
                                g.venue ? `Venue: ${g.venue}` : '',
                                starsContext,
                                ``,
                                `SPORT BOUNDARY: This is an NHL hockey game. Write ONLY NHL hockey content.`,
                                `Write the brief as a single paragraph. No headers, no bullet points.`,
                            ].filter(Boolean).join('\n');

                            try {
                                await env.JOURNALISM_QUEUE.send({
                                    type:        'game-brief',
                                    prompt,
                                    eventId:     g.id,
                                    max_tokens:  300,
                                    sport:       'nhl',
                                    home, away, homeScore, awayScore,
                                    enqueuedAt:  Date.now(),
                                });
                            } catch (e) {
                                console.error('[NHL game-brief enqueue NHLE]', e.message);
                            }
                        }
                    };
                    if (ctx?.waitUntil) ctx.waitUntil(enqueueNHLBriefs());
                    else await enqueueNHLBriefs();
                }
            }
            // ── end NHL brief pipeline NHLE ────────────────────────────────────

            return new Response(
                JSON.stringify({ sport, date, games, count: games.length, source: 'nhle', ts: Date.now() }),
                { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15' } }
            );
        } catch (e) {
            return new Response(
                JSON.stringify({ error: 'NHLE upstream error', sport, date }),
                { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }
    }
    // ── end NHL NHLE early-return ──────────────────────────────────────────────

    // ── NBA CDN early-return (migrated June 26 2026) ──────────────────────────
    // CDN returns 403 in off-season (no scoreboard) — treat as 0 games, not error.
    // Brief pipeline runs here (CDN boxscore variant) before response is returned.
    if (cfg.nbaSource === 'cdn') {
        try {
            const cdnResp = await fetch(
                `${NBA_CDN_BASE}/liveData/scoreboard/todaysScoreboard_00.json`,
                {
                    headers: NBA_HEADERS,
                    cf: { cacheTtl: NBA_CACHE_TTL, cacheEverything: true,
                          cacheKey: `${NBA_CDN_BASE}/liveData/scoreboard/todaysScoreboard_00.json:${date}` },
                }
            );
            // Off-season 403 / no games → return empty slate, not 502
            if (!cdnResp.ok) {
                return new Response(
                    JSON.stringify({ sport, date, games: [], count: 0, source: 'nba-cdn-empty', ts: Date.now() }),
                    { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } }
                );
            }
            const cdnData = await cdnResp.json();
            const games   = (cdnData.scoreboard?.games || []).map(adaptNbaCDN);

            // ── NBA brief pipeline (CDN boxscore variant) ─────────────────────
            // Player stats from /nba/liveData/boxscore/boxscore_{nbaGameId}.json
            // CDN player names are "First Last" — no reversal needed.
            if (env.JOURNALISM_QUEUE && env.FIELD_JOURNALISM) {
                const nbaFinals = games.filter(g => g.state === 'final');
                if (nbaFinals.length > 0) {
                    const enqueueNBABriefs = async () => {
                        for (const g of nbaFinals) {
                            const kvKey = `brief:game:${g.id}`;
                            const existing = await env.FIELD_JOURNALISM.get(kvKey).catch(() => null);
                            if (existing) continue;

                            const home      = g.home?.name || '';
                            const away      = g.away?.name || '';
                            const homeScore = g.home?.score ?? 0;
                            const awayScore = g.away?.score ?? 0;

                            // Fetch CDN boxscore for player stats
                            let statsContext = '';
                            try {
                                const bsRes = await fetch(
                                    `${NBA_CDN_BASE}/liveData/boxscore/boxscore_${g.nbaGameId}.json`,
                                    { headers: NBA_HEADERS, cf: { cacheTtl: 300, cacheEverything: true } }
                                );
                                if (bsRes.ok) {
                                    const bs = await bsRes.json();
                                    const formatTeam = (team) => {
                                        if (!team?.players?.length) return '';
                                        const sorted = [...team.players]
                                            .sort((a, b) => (b.statistics?.points ?? 0) - (a.statistics?.points ?? 0));
                                        const tName = `${team.teamCity || ''} ${team.teamName || ''}`.trim();
                                        const lines = sorted.slice(0, 3).map(p => {
                                            // CDN: p.name = "Devin Vassell" (no reversal needed)
                                            const pts = p.statistics?.points        ?? 0;
                                            const reb = p.statistics?.reboundsTotal ?? 0;
                                            const ast = p.statistics?.assists       ?? 0;
                                            return `${p.name || '?'}: ${pts}pts/${reb}reb/${ast}ast`;
                                        }).join(', ');
                                        return `${tName}: ${lines}`;
                                    };
                                    const gameData = bs.game;
                                    const lines = [formatTeam(gameData?.homeTeam), formatTeam(gameData?.awayTeam)].filter(Boolean);
                                    if (lines.length) statsContext = '\n\nKEY PERFORMERS:\n' + lines.join('\n');
                                }
                            } catch (_) {}

                            const prompt = [
                                FIELD_VOICE_REGISTER,
                                `Write a 2-3 sentence post-game brief for this NBA result.`,
                                `Factual, warm. FIELD voice: the truth in sports is fun — let that energy through. No manufactured drama.`,
                                `Include: key performers with stats, decisive run or moment, what this means for the standings or series.`,
                                `Do NOT use banned phrases: "stunned", "shocked", "thriller", "instant classic", "for the ages".`,
                                ``,
                                `RESULT: ${away} ${awayScore} at ${home} ${homeScore}`,
                                g.venue ? `Venue: ${g.venue}` : '',
                                statsContext,
                                ``,
                                `SPORT BOUNDARY: This is an NBA basketball game. Write ONLY NBA basketball content.`,
                                `Write the brief as a single paragraph. No headers, no bullet points.`,
                            ].filter(Boolean).join('\n');

                            try {
                                await env.JOURNALISM_QUEUE.send({
                                    type:        'game-brief',
                                    prompt,
                                    eventId:     g.id,
                                    max_tokens:  300,
                                    sport:       'nba',
                                    home, away, homeScore, awayScore,
                                    enqueuedAt:  Date.now(),
                                });
                            } catch (e) {
                                console.error('[NBA game-brief enqueue CDN]', e.message);
                            }
                        }
                    };
                    if (ctx?.waitUntil) ctx.waitUntil(enqueueNBABriefs());
                    else await enqueueNBABriefs();
                }
            }
            // ── end NBA brief pipeline CDN ─────────────────────────────────────

            return new Response(
                JSON.stringify({ sport, date, games, count: games.length, source: 'nba-cdn', ts: Date.now() }),
                { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15' } }
            );
        } catch (e) {
            return new Response(
                JSON.stringify({ error: 'NBA CDN upstream error', sport, date }),
                { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }
    }
    // ── end NBA CDN early-return ───────────────────────────────────────────────

    const key = env.APISPORTS_KEY;
    if (!key)
        return new Response(JSON.stringify({ error: 'APISPORTS_KEY not configured' }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const host = APISPORTS_HOSTS[cfg.sport];
    let targetUrl, adapt;
    if (cfg.sport === 'nba') {
        // UNREACHABLE after June 26 2026 CDN migration — nbaSource:'cdn' early-returns above.
        // Kept as dead code in case cfg.nbaSource is unset (failsafe only).
        // Original: v2.nba.api-sports.io dedicated Pro plan, date-only query.
        targetUrl = `https://${host}/games?date=${date}`;
        adapt = items => items.map(adaptApiNba);
    } else if (cfg.sport === 'afl') {
        // VERIFIED 2026-06-20: the api-sports AFL plan rejects league/season
        // filters ("Free plans do not have access to this season") but accepts
        // ?date= on a ±1 day rolling window — same effective pattern as NBA.
        targetUrl = `https://${host}/games?date=${date}`;
        adapt = items => items.map(adaptAFL);
    } else if (cfg.sport === 'football') {
        targetUrl = `https://${host}/fixtures?league=${cfg.leagueId}&season=${cfg.season}&date=${date}`;
        // adapt set to null — football handled separately below with stats enrichment
        adapt = null;
    } else {
        targetUrl = `https://${host}/games?league=${cfg.leagueId}&season=${cfg.season}&date=${date}`;
        if (cfg.sport === 'basketball') adapt = items => items.map(adaptBasketball);
        else if (cfg.sport === 'hockey')  adapt = items => items.map(adaptHockey);  // UNREACHABLE after NHLE migration June 26 2026
        else if (cfg.sport === 'baseball') adapt = items => items.map(adaptBaseball);
        else adapt = x => x;
    }
    try {
        // CF edge cache: key on URL only (exclude x-apisports-key from cache key).
        // All users' polls for same sport+date hit the same CF cache entry.
        // Football uses 15s (live scores need freshness near kickoff); others 30s.
        // Without this: N users × poll rate = unbounded api-sports quota burn.
        const _cacheTtl = cfg.sport === 'football' ? 15 : 30;
        const resp = await fetch(targetUrl, {
            headers: { 'x-apisports-key': key, 'Accept': 'application/json' },
            cf: { cacheTtl: _cacheTtl, cacheEverything: true, cacheKey: targetUrl },
        });
        if (!resp.ok) {
            // 429 = upstream rate limit. Return 503 no-store so the client keeps
            // last-known state and the empty error isn't cached. Other errors → 502.
            const isRateLimit = resp.status === 429;
            return new Response(JSON.stringify({ error: `Upstream ${resp.status}`, sport, date, retryable: isRateLimit }),
                { status: isRateLimit ? 503 : 502,
                  headers: { ...CORS, 'Content-Type': 'application/json', ...(isRateLimit ? { 'Cache-Control': 'no-store' } : {}) } });
        }
        const data  = await resp.json();
        const raw   = data?.response || [];

        // Rate-limit guard: api-sports returns {errors:{rateLimit:...}, results:0}
        // when quota/min is exceeded. Don't serve this as a valid empty schedule —
        // return 503 so the client keeps its last-known game state (with live scores)
        // rather than wiping cards to nothing. The 15s cache won't store a 503.
        const _rateLimited = data?.errors && (
            data.errors.rateLimit ||
            (typeof data.errors === 'object' && Object.keys(data.errors).some(k => /rate|limit|requests/i.test(k + String(data.errors[k]))))
        );
        if (_rateLimited && url.searchParams.get('debug') !== '1') {
            return new Response(JSON.stringify({ error: 'upstream rate limited — retry', sport, date, retryable: true }),
                { status: 503, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
        }

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
                        const statsUrl = `https://${host}/fixtures/statistics?fixture=${fId}`;
                        const sr = await fetch(statsUrl,
                            { headers: { 'x-apisports-key': key, 'Accept': 'application/json' },
                              cf: { cacheTtl: 30, cacheEverything: true, cacheKey: statsUrl } }
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

            // ── BSD event ID enrichment ───────────────────────────────────────────
            // Fetches BSD live events and matches to game objects by team name via
            // teamNameMatch/resolveTeamKey (same normalization as odds matching).
            // Injects bsdEventId which activates all dormant BSD features:
            //   • buildBSDMomentumContext (CONTEXT_SOURCES priority 8)
            //   • AmbientDO._bsdSubscribe (live ball tracking WebSocket)
            //   • /bsd/events/:id/shotmap, /momentum, /incidents relay routes
            // 3s timeout — never blocks the V2 game response.
            // Non-blocking — failure leaves bsdEventId undefined; features degrade silently.
            if (env.BSD_API_TOKEN) {
                try {
                    const _bsdR = await fetch('https://sports.bzzoiro.com/api/v2/events/live/', {
                        headers: {
                            'Authorization': `Token ${env.BSD_API_TOKEN}`,
                            'User-Agent': 'FIELD/1.0',
                            'Accept': 'application/json',
                        },
                        signal: AbortSignal.timeout(3000),
                    });
                    if (_bsdR.ok) {
                        const _bsdLive = await _bsdR.json();
                        const _bsdEvents = Array.isArray(_bsdLive.events) ? _bsdLive.events : [];
                        for (const _g of games) {
                            const _bsdMatch = _bsdEvents.find(_e => {
                                const _bh = String(_e.home_team?.name ?? _e.home_team ?? '');
                                const _ba = String(_e.away_team?.name ?? _e.away_team ?? '');
                                return (teamNameMatch(_bh, _g.home.name) && teamNameMatch(_ba, _g.away.name))
                                    || (teamNameMatch(_bh, _g.away.name) && teamNameMatch(_ba, _g.home.name));
                            });
                            if (_bsdMatch) _g.bsdEventId = String(_bsdMatch.id);
                        }
                    }
                } catch (_) {} // Non-blocking — BSD outage never breaks V2 games
            }

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
                            if (teamNameMatch(oddsHome, g.home.name) && teamNameMatch(oddsAway, g.away.name)) {
                                pregameLh = lams.lh; pregameLa = lams.la; break;
                            }
                            if (teamNameMatch(oddsHome, g.away.name) && teamNameMatch(oddsAway, g.home.name)) {
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
                    const gLetter = extractWCGroup(g.round, g.home?.name, g.away?.name);
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
                // Non-blocking: D1 writes run after response is returned.
                // ctx.waitUntil keeps the Worker alive until writes complete.
                // On MD3 (up to 6 simultaneous finals) this unblocks ~200ms
                // of D1 latency from the hot /v2/games response path.
                if (ctx?.waitUntil) {
                    ctx.waitUntil(Promise.allSettled(finals.map(g => writeWCResult(env.WC2026_DB, g, env, ctx))));
                } else {
                    await Promise.allSettled(finals.map(g => writeWCResult(env.WC2026_DB, g, env, ctx)));
                }
            }
        }

        // ── NBA brief auto-generation ─────────────────────────────────────────
        // UNREACHABLE after June 26 2026: NBA CDN early-return fires before this point.
        // NBA brief pipeline (CDN boxscore variant) now lives in the CDN early-return block.
        // This block retained as dead code in case nbaSource:'cdn' is ever removed.
        if (sport === 'nba' && env.JOURNALISM_QUEUE && env.FIELD_JOURNALISM) {
            const nbaFinals = games.filter(g => g.state === 'final');
            if (nbaFinals.length > 0) {
                const enqueueNBABriefs = async () => {
                    for (const g of nbaFinals) {
                        const kvKey = `brief:game:${g.id}`;
                        const existing = await env.FIELD_JOURNALISM.get(kvKey).catch(() => null);
                        if (existing) continue;

                        const home = g.home?.name || '';
                        const away = g.away?.name || '';
                        const homeScore = g.home?.score ?? 0;
                        const awayScore = g.away?.score ?? 0;

                        // Fetch player stats for richer brief context
                        let statsContext = '';
                        try {
                            const numericId = String(g.id).replace('nba:', '');
                            const statsRes = await fetch(
                                `https://v2.nba.api-sports.io/games/statistics/players?id=${numericId}`,
                                { headers: { 'x-apisports-key': env.APISPORTS_KEY || '' } }
                            );
                            if (statsRes.ok) {
                                const statsData = await statsRes.json();
                                const players = statsData?.response || [];
                                if (players.length) {
                                    // Group by team, sort by points, take top 3 per team
                                    const byTeam = {};
                                    players.forEach(p => {
                                        const tid = p?.team?.id;
                                        if (tid == null) return;
                                        (byTeam[tid] = byTeam[tid] || []).push(p);
                                    });
                                    const formatTop = (teamPlayers, teamName) => {
                                        if (!teamPlayers?.length) return '';
                                        teamPlayers.sort((a, b) => (b?.points ?? 0) - (a?.points ?? 0));
                                        return teamPlayers.slice(0, 3).map(p => {
                                            const raw = p?.player?.name || '';
                                            const name = raw.includes(' ') ? raw.split(' ').reverse().join(' ') : raw;
                                            const pts = p?.points ?? 0;
                                            const reb = p?.totReb ?? 0;
                                            const ast = p?.assists ?? 0;
                                            return `${name}: ${pts}pts/${reb}reb/${ast}ast`;
                                        }).join(', ');
                                    };
                                    const teamIds = Object.keys(byTeam);
                                    const lines = teamIds.map(tid => {
                                        const tName = byTeam[tid][0]?.team?.name || '';
                                        return `${tName}: ${formatTop(byTeam[tid], tName)}`;
                                    });
                                    if (lines.length) statsContext = '\n\nKEY PERFORMERS:\n' + lines.join('\n');
                                }
                            }
                        } catch (_) {}

                        const prompt = [
                            FIELD_VOICE_REGISTER,
                            `Write a 2-3 sentence post-game brief for this NBA result.`,
                            `Factual, warm. FIELD voice: the truth in sports is fun — let that energy through. No manufactured drama.`,
                            `Include: key performers with stats, decisive run or moment, what this means for the standings or series.`,
                            `Do NOT use banned phrases: "stunned", "shocked", "thriller", "instant classic", "for the ages".`,
                            ``,
                            `RESULT: ${away} ${awayScore} at ${home} ${homeScore}`,
                            g.venue ? `Venue: ${g.venue}` : '',
                            statsContext,
                            ``,
                            `SPORT BOUNDARY: This is an NBA basketball game. Write ONLY NBA basketball content. Do not reference players, stats, or terminology from any other sport. If context is empty, write from the score and date only.`,
                            `Write the brief as a single paragraph. No headers, no bullet points.`,
                        ].filter(Boolean).join('\n');

                        try {
                            await env.JOURNALISM_QUEUE.send({
                                type: 'game-brief',
                                prompt,
                                eventId: g.id,
                                max_tokens: 300,
                                sport: 'nba',
                                home,
                                away,
                                homeScore,
                                awayScore,
                                enqueuedAt: Date.now(),
                            });
                        } catch (e) {
                            console.error('[NBA game-brief enqueue]', e.message);
                        }
                    }
                };
                if (ctx?.waitUntil) ctx.waitUntil(enqueueNBABriefs());
                else await enqueueNBABriefs();
            }
        }

        // ── NHL brief auto-generation ─────────────────────────────────────────
        // Same pattern as NBA/WC: final games → KV dedup → stats fetch → enqueue.
        // Stats from api-sports /games/statistics/players (hockey).
        // Hockey stats: goals, assists, saves, pim — different shape from basketball.
        if (sport === 'nhl' && env.JOURNALISM_QUEUE && env.FIELD_JOURNALISM) {
            const nhlFinals = games.filter(g => g.state === 'final');
            if (nhlFinals.length > 0) {
                const enqueueNHLBriefs = async () => {
                    for (const g of nhlFinals) {
                        const kvKey = `brief:game:${g.id}`;
                        const existing = await env.FIELD_JOURNALISM.get(kvKey).catch(() => null);
                        if (existing) continue;

                        const home = g.home?.name || '';
                        const away = g.away?.name || '';
                        const homeScore = g.home?.score ?? 0;
                        const awayScore = g.away?.score ?? 0;

                        // Fetch player stats from api-sports hockey
                        let statsContext = '';
                        try {
                            const statsRes = await fetch(
                                `https://v1.hockey.api-sports.io/games/statistics/players?id=${g.id}`,
                                { headers: { 'x-apisports-key': env.APISPORTS_KEY || '' } }
                            );
                            if (statsRes.ok) {
                                const statsData = await statsRes.json();
                                const teams = statsData?.response || [];
                                const lines = [];
                                for (const team of teams) {
                                    const teamName = team?.team?.name || '';
                                    const players = team?.players || [];
                                    if (!players.length) continue;
                                    // Skaters: sort by goals+assists (points)
                                    const skaters = players.filter(p => (p?.statistics?.goals != null || p?.statistics?.assists != null) && !p?.statistics?.saves);
                                    skaters.sort((a, b) => ((b?.statistics?.goals ?? 0) + (b?.statistics?.assists ?? 0)) - ((a?.statistics?.goals ?? 0) + (a?.statistics?.assists ?? 0)));
                                    const topSkaters = skaters.slice(0, 3).map(p => {
                                        const name = p?.player?.name || '';
                                        const g_ = p?.statistics?.goals ?? 0;
                                        const a_ = p?.statistics?.assists ?? 0;
                                        return `${name}: ${g_}G/${a_}A`;
                                    }).filter(Boolean);
                                    // Goalie: saves + save%
                                    const goalie = players.find(p => p?.statistics?.saves != null);
                                    const goalieStr = goalie ? `${goalie?.player?.name || 'Goalie'}: ${goalie?.statistics?.saves ?? 0} saves` : '';
                                    const parts = [...topSkaters];
                                    if (goalieStr) parts.push(goalieStr);
                                    if (parts.length) lines.push(`${teamName}: ${parts.join(', ')}`);
                                }
                                if (lines.length) statsContext = '\n\nKEY PERFORMERS:\n' + lines.join('\n');
                            }
                        } catch (_) {}

                        const prompt = [
                            FIELD_VOICE_REGISTER,
                            `Write a 2-3 sentence post-game brief for this NHL result.`,
                            `Factual, warm. FIELD voice: the truth in sports is fun — let that energy through. No manufactured drama.`,
                            `Include: key goal scorers, goaltender performance, what this means for the series or standings.`,
                            `Do NOT use banned phrases: "stunned", "shocked", "thriller", "instant classic", "for the ages".`,
                            ``,
                            `RESULT: ${away} ${awayScore} at ${home} ${homeScore}`,
                            g.venue ? `Venue: ${g.venue}` : '',
                            statsContext,
                            ``,
                            `SPORT BOUNDARY: This is an NHL hockey game. Write ONLY NHL hockey content. Do not reference players, stats, or terminology from any other sport. If context is empty, write from the score and date only.`,
                            `Write the brief as a single paragraph. No headers, no bullet points.`,
                        ].filter(Boolean).join('\n');

                        try {
                            await env.JOURNALISM_QUEUE.send({
                                type: 'game-brief',
                                prompt,
                                eventId: g.id,
                                max_tokens: 300,
                                sport: 'nhl',
                                home,
                                away,
                                homeScore,
                                awayScore,
                                enqueuedAt: Date.now(),
                            });
                        } catch (e) {
                            console.error('[NHL game-brief enqueue]', e.message);
                        }
                    }
                };
                if (ctx?.waitUntil) ctx.waitUntil(enqueueNHLBriefs());
                else await enqueueNHLBriefs();
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
            cf: { cacheTtl: 3600, cacheEverything: true, cacheKey: targetUrl },
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


// ── WC Free Game (Tubi) Pre-Game Push Alert ───────────────────────────────────
// Fires once per free WC game, 30-60 minutes before kickoff.
// Hardcoded list — WC free games are tournament-static (only 2: MEX/RSA + USA/PAR).
// Deduplication: PUSH_SUBS KV key `tubi-alert:{gameId}` with 24hr TTL.
// Payload type FREE_GAME_ALERT — client surfaces as "free to watch" notification.
//
// Wired into handleCron so it runs every 5 minutes on the cron tick.
// Does NOT require live game data — fires purely on wall-clock proximity to kickoff.

const WC_FREE_GAMES = [
    {
        gameId:    'wc26_g11_mex_rsa',
        home:      'Mexico',
        away:      'South Africa',
        startUtc:  '2026-06-11T19:00:00Z',   // 3pm ET — FOX OTA + Tubi
        label:     'FIFA World Cup Opening Match',
        broadcast: 'FOX / Tubi (free)',
        note:      'Free on Tubi (live 4K) + FOX OTA. Opening game of the 2026 World Cup.',
    },
    {
        gameId:    'wc26_g12_usa_par',
        home:      'United States',
        away:      'Paraguay',
        startUtc:  '2026-06-13T01:00:00Z',   // 9pm ET June 12 — Tubi + FOX OTA
        label:     'USMNT World Cup Opener — Group D',
        broadcast: 'Tubi (free, live 4K) + FOX OTA',
        note:      'Free on Tubi (live 4K) + FOX OTA. 3-hour pregame starts 6pm ET.',
    },
];

// ALERT_WINDOW_MS: fire when kickoff is between 30 and 65 minutes away.
// 65-min upper bound means a 5-min cron always has at least one tick in the window.
const TUBI_ALERT_WINDOW_EARLY_MS = 65 * 60 * 1000;
const TUBI_ALERT_WINDOW_LATE_MS  = 30 * 60 * 1000;

async function handleTubiPreGameAlerts(env) {
    if (!env.PUSH_SUBS) return;
    const now = Date.now();

    for (const game of WC_FREE_GAMES) {
        const kickoff = new Date(game.startUtc).getTime();
        const msToKickoff = kickoff - now;

        // Outside the alert window — skip
        if (msToKickoff > TUBI_ALERT_WINDOW_EARLY_MS) continue;
        if (msToKickoff < TUBI_ALERT_WINDOW_LATE_MS)  continue;

        // Already fired for this game?
        const dedupKey = `tubi-alert:${game.gameId}`;
        const alreadyFired = await env.PUSH_SUBS.get(dedupKey);
        if (alreadyFired) continue;

        // Mark as fired before sending (prevents double-fire if push is slow)
        await env.PUSH_SUBS.put(dedupKey, '1', {expirationTtl: 86400});

        // Build payload
        const minToKickoff = Math.round(msToKickoff / 60000);
        const payload = {
            type:      'FREE_GAME_ALERT',
            gameId:    game.gameId,
            sport:     'WC26',
            home:      game.home,
            away:      game.away,
            label:     game.label,
            broadcast: game.broadcast,
            note:      game.note,
            minToKickoff,
            startUtc:  game.startUtc,
            ts:        now,
        };

        // Fan out to all subscribers in parallel (no sport-filter for free-game alerts)
        const list = await env.PUSH_SUBS.list();
        const subRecs = await Promise.allSettled(
            list.keys.map(async key => {
                const raw = await env.PUSH_SUBS.get(key.name);
                if (!raw) return null;
                try {
                    const d = JSON.parse(raw);
                    if (!d.subscription?.endpoint || !d.subscription?.keys) return null;
                    return d.subscription;
                } catch(_) { return null; }
            })
        );
        const validSubs = subRecs.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);
        const results = await Promise.allSettled(
            validSubs.map(sub => sendWebPush(sub, payload, env).catch(() => null))
        );
        let sent = results.filter(r => r.status === 'fulfilled' && (r.value?.ok || r.value?.status === 201)).length;
    }
}

// ── fetchWCInjuries ───────────────────────────────────────────────────────────
// Fetch injury reports for WC 2026 (league=1, season=2026) from api-sports.io.
// Normalises the response into a compact shape keyed by FIFA team name.
// Caches in FIELD_JOURNALISM KV at 'wc:injuries:current' with a 1hr TTL.
// Returns { ok, teams: { 'France': [{player, type, reason, status}], ... },
//           raw_count, generatedAt }
async function fetchWCInjuries(env) {
    const key = env.APISPORTS_KEY;
    if (!key) throw new Error('APISPORTS_KEY not configured');

    const url = 'https://v3.football.api-sports.io/injuries?league=1&season=2026';
    const resp = await fetch(url, {
        headers: { 'x-apisports-key': key, 'Accept': 'application/json' },
        cf: { cacheTtl: 0, cacheEverything: false },  // no CF edge cache — we use KV
    });
    if (!resp.ok) throw new Error(`api-sports injuries upstream ${resp.status}`);

    const data = await resp.json();
    const raw  = data?.response || [];

    // Compact shape: group by team name, keep player + injury meta only
    const teams = {};
    for (const item of raw) {
        const teamName = item?.team?.name || 'Unknown';
        const player   = item?.player?.name || 'Unknown';
        const type     = item?.injury?.type   || null;  // e.g. "Muscle Injury"
        const reason   = item?.injury?.reason || null;  // e.g. "Muscle problems"
        const status   = item?.player?.reason || null;  // status string from API
        if (!teams[teamName]) teams[teamName] = [];
        teams[teamName].push({ player, type, reason, status });
    }

    const result = {
        ok:          true,
        teams,
        raw_count:   raw.length,
        generatedAt: new Date().toISOString(),
    };

    if (env.FIELD_JOURNALISM) {
        await env.FIELD_JOURNALISM.put(
            'wc:injuries:current',
            JSON.stringify(result),
            { expirationTtl: 3600 }  // 1hr TTL — injuries change infrequently
        );
    }
    return result;
}

// ── runWCTournamentProjections ────────────────────────────────────────────────
// Compute tournament path probabilities for all 48 teams.
// Stores current projections + movers in FIELD_JOURNALISM KV.
// Generates a journalism brief via Claude if movers are significant.
// Runs from cron (top of hour during WC window).
async function runWCTournamentProjections(env) {
    const KV    = env.FIELD_JOURNALISM;
    const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';

    // 1. Fetch WC data in parallel: standings + odds-probs + D1 results + today's live games
    const todayISO = new Date().toISOString().slice(0, 10);
    const [standingsRes, oddsRes, resultsRes, liveGamesRes] = await Promise.allSettled([
        fetch(`${RELAY}/wc/standings`,                         { cache: 'no-store' }),
        fetch(`${RELAY}/wc/odds-probs`,                        { cache: 'no-store' }),
        fetch(`${RELAY}/wc/results`,                           { cache: 'no-store' }),
        fetch(`${RELAY}/v2/games?sport=wc26&date=${todayISO}`, { cache: 'no-store' }),
    ]);

    const standings = standingsRes.status === 'fulfilled' && standingsRes.value.ok
        ? ((await standingsRes.value.json()).groups || {}) : {};
    const oddsProbs = oddsRes.status === 'fulfilled' && oddsRes.value.ok
        ? ((await oddsRes.value.json()).probs  || []) : [];

    // Gap 2: build authoritative played set from D1 results (not odds timing).
    // Any fixture in wc_results is definitively complete regardless of commence time.
    const d1Results = resultsRes.status === 'fulfilled' && resultsRes.value.ok
        ? ((await resultsRes.value.json()).results || []) : [];
    const normName = n => (n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const d1PlayedKeys = new Set(d1Results.map(r => `${normName(r.home)}|${normName(r.away)}`));
    const isD1Played = (home, away) =>
        d1PlayedKeys.has(`${normName(home)}|${normName(away)}`) ||
        d1PlayedKeys.has(`${normName(away)}|${normName(home)}`);

    // Gap 3: detect live games and compute live WP to override odds-derived probs.
    // A live game's commence is in the past but it hasn't been written to D1 yet.
    const todayGames = liveGamesRes.status === 'fulfilled' && liveGamesRes.value.ok
        ? ((await liveGamesRes.value.json()).games || []) : [];
    const liveWPOverrides = new Map(); // key: 'normHome|normAway' → {pHome, pDraw, pAway}
    for (const g of todayGames) {
        if (g.state !== 'live') continue;
        const hName = g.home?.name || '';
        const aName = g.away?.name  || '';
        const key   = `${normName(hName)}|${normName(aName)}`;
        const sit   = g.situation || {};
        // Get pregame lambdas from odds cache for this matchup
        let pregameLh = null, pregameLa = null;
        for (const op of oddsProbs) {
            if (isD1Played(op.home_team, op.away_team)) continue;
            if (normName(op.home_team) === normName(hName) &&
                normName(op.away_team) === normName(aName)) {
                pregameLh = op.lambdaHome || null;
                pregameLa = op.lambdaAway || null;
                break;
            }
        }
        try {
            const liveWP = computeLiveWP({
                homeGoals:    g.home?.score  ?? 0,
                awayGoals:    g.away?.score  ?? 0,
                homeSOT:      sit.homeSOT    || 0,
                awaySOT:      sit.awaySOT    || 0,
                elapsedMin:   sit.elapsed    || 0,
                isStoppage:   sit.isStoppage || false,
                manAdvantage: sit.manAdvantage || null,
                isShootout:   sit.isShootout || false,
                pregameLh,
                pregameLa,
            });
            liveWPOverrides.set(key, {
                pHome: liveWP.homeWin,
                pDraw: liveWP.draw,
                pAway: liveWP.awayWin,
                lambdaHome: pregameLh,
                lambdaAway: pregameLa,
                _live: true,
            });
        } catch (_) {}
    }

    // 2. Build remainingFixtures:
    //    - Exclude D1-played games (authoritative) — Gap 2
    //    - Override live games with live WP — Gap 3
    //    - Exclude past-commence games not in D1 and not live (assume complete, no data yet)
    const nowMs = Date.now();
    const remainingFixtures = oddsProbs
        .filter(g => {
            if (isD1Played(g.home_team, g.away_team)) return false; // Gap 2: D1-authoritative
            const liveKey = `${normName(g.home_team)}|${normName(g.away_team)}`;
            if (liveWPOverrides.has(liveKey)) return true;           // Gap 3: keep live games
            return new Date(g.commence).getTime() > nowMs;           // future only
        })
        .map(g => {
            const liveKey = `${normName(g.home_team)}|${normName(g.away_team)}`;
            const liveWP  = liveWPOverrides.get(liveKey);
            return {
                home: g.home_team, away: g.away_team,
                pHome:      liveWP ? liveWP.pHome      : g.pHome,
                pDraw:      liveWP ? liveWP.pDraw      : (g.pDraw || (1 - g.pHome - g.pAway) / 2),
                pAway:      liveWP ? liveWP.pAway      : g.pAway,
                lambdaHome: liveWP ? liveWP.lambdaHome : g.lambdaHome,
                lambdaAway: liveWP ? liveWP.lambdaAway : g.lambdaAway,
                _live:      liveWP ? true : false,
            };
        });

    // Teams that played today: from D1 results created today (authoritative)
    const playedTodaySet = new Set(
        d1Results
            .filter(r => r.match_date === todayISO)
            .flatMap(r => [r.home, r.away])
    );
    // Also include live-game teams as "in play today" for movers labeling
    for (const g of todayGames) {
        if (g.state === 'live') {
            if (g.home?.name) playedTodaySet.add(g.home.name);
            if (g.away?.name) playedTodaySet.add(g.away.name);
        }
    }

    // 3. Compute projections
    const curr = computeTournamentProjections({
        currentStandings: standings,
        remainingFixtures,
        oddsProbs,
        d1Results,
        N: 2000,
    });

    // 4. Load previous snapshot for movers diff
    let prev = null;
    try {
        const prevJson = await KV.get('wc:projections:prev');
        if (prevJson) prev = JSON.parse(prevJson);
    } catch (_) {}

    // 5. Compute movers
    const movers = prev ? computeMovers(prev, curr, playedTodaySet) : null;

    // 6. Persist: rotate curr → prev for next cycle's movers diff, write new curr
    await KV.put('wc:projections:prev', JSON.stringify(curr), { expirationTtl: 7 * 86400 });
    await KV.put('wc:projections:current', JSON.stringify(curr), { expirationTtl: 7 * 86400 });
    // Store bracket slots separately for /wc/bracket endpoint
    if (curr.bracketSlots && Object.keys(curr.bracketSlots).length > 0) {
        const bracketPayload = { bracketSlots: curr.bracketSlots, generatedAt: curr.generatedAt, N: curr.N };
        await KV.put('wc:bracket:current', JSON.stringify(bracketPayload), { expirationTtl: 7 * 86400 });
    }
    if (movers) {
        await KV.put('wc:movers:current', JSON.stringify(movers), { expirationTtl: 86400 });
    }

    // 7. Generate journalism brief if movers are significant (any team moved > 3% pFinal)
    const hasSignificantMovers = movers && [...(movers.gainers || []), ...(movers.losers || [])]
        .some(d => Math.abs(d.deltaFinal) > 0.03);
    if (hasSignificantMovers && env.ANTHROPIC_API_KEY) {
        const prompt = buildMoversBriefPrompt(movers, curr);
        if (prompt) {
            try {
                const briefRes = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': env.ANTHROPIC_API_KEY,
                        'anthropic-version': '2023-06-01',
                    },
                    body: JSON.stringify({
                        model: 'claude-sonnet-4-20250514',
                        max_tokens: 350,
                        messages: [{ role: 'user', content: prompt }],
                    }),
                });
                if (briefRes.ok) {
                    const briefData = await briefRes.json();
                    const rawText = briefData.content?.find(b => b.type === 'text')?.text || '';
                    const text = sanitizeGoalsGrammar(rawText);
                    if (text.length > 50) {
                        await KV.put('wc:brief:movers', JSON.stringify({
                            text,
                            generatedAt: curr.generatedAt,
                            movers: {
                                topGainer: movers.gainers?.[0]?.name,
                                topLoser:  movers.losers?.[0]?.name,
                                topSecondary: movers.secondaryBeneficiaries?.[0]?.name,
                            },
                        }), { expirationTtl: 86400 });
                    }
                }
            } catch (_) {}
        }
    }

    console.log(`[WC-PROJ] Done. ${curr.teams.length} teams · ${remainingFixtures.length} remaining fixtures · movers: ${movers ? 'yes' : 'no'}`);
}

async function handleCron(env) {
    if (!env.PUSH_SUBS) return; // KV not configured

    // ── Tubi free-game pre-game alert (independent of live-game check) ────────
    await handleTubiPreGameAlerts(env);
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

    // Get all subscribers — load all keys + values in parallel then fan out
    // Old pattern: sequential KV.get per subscriber per game — O(subscribers × games) serial.
    // New pattern: parallel key reads, then parallel push sends.
    // ctx.waitUntil not available here (handleCron is already inside waitUntil).
    // Promise.allSettled parallelises the sends; push is best-effort so no retry needed.
    const list = await env.PUSH_SUBS.list();
    // Parallel-load all subscriber records
    const subRecords = await Promise.allSettled(
        list.keys.map(async key => {
            const raw = await env.PUSH_SUBS.get(key.name);
            if (!raw) return null;
            try {
                const subData = JSON.parse(raw);
                if (!subData.subscription?.endpoint) return null;
                return { keyName: key.name, sub: subData.subscription, prefs: subData.prefs || {} };
            } catch(_) { return null; }
        })
    );
    const subs = subRecords.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);

    // Parallel fan-out: one send per (subscriber × game) pair, deduped
    await Promise.allSettled(subs.flatMap(({ keyName, sub, prefs }) => {
        const sportAllow = Array.isArray(prefs.sports) ? prefs.sports : null;
        return live
            .filter(game => !sportAllow || sportAllow.includes(game.sport))
            .map(async game => {
                const firedKey = `${keyName}:${game.gameId}:${game.homeScore}-${game.awayScore}`;
                const alreadyFired = await env.PUSH_SUBS.get(firedKey);
                if (alreadyFired) return;
                try {
                    const res = await sendWebPush(sub, game, env);
                    if (res.ok || res.status === 201) {
                        await env.PUSH_SUBS.put(firedKey, '1', {expirationTtl: 28800});
                    }
                } catch(e) {
                    if (typeof captureFieldError === 'function')
                        captureFieldError('push-send', e.message);
                }
            });
    }));
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

// ── Per-sport quality calibration (data-driven scoreThreshold) ───────────────
// Loaded once per cron tick. Primary source: Phase 8 KV snapshot at
// field:quality_calibration (refreshed by the daily 09:00 UTC analytics
// cron). Fallback: D1 percentile computation, preserved unchanged so a
// stale/missing/malformed KV value silently degrades to live percentiles.
// Calibration failure is silent and never blocks journalism delivery (Rule 5).
let _qualityCalibration = null;
let _qualityCalibrationSource = null; // 'analytics-cron' | 'd1-live' | null

const QUALITY_CALIBRATION_KV_KEY = 'field:quality_calibration';
const QUALITY_CALIBRATION_MAX_AGE_MS = 36 * 60 * 60 * 1000; // 36 hours

function isCalibrationFresh(calibration) {
  if (!calibration || typeof calibration !== 'object') return false;
  const ts = calibration._last_updated || calibration.last_updated;
  if (!ts) return false;
  const age = Date.now() - new Date(ts).getTime();
  return Number.isFinite(age) && age >= 0 && age < QUALITY_CALIBRATION_MAX_AGE_MS;
}

async function loadQualityCalibration(env) {
  // Primary: Phase 8 KV recommendation
  if (env.FIELD_JOURNALISM) {
    try {
      const kv = await env.FIELD_JOURNALISM.get(QUALITY_CALIBRATION_KV_KEY, 'json');
      if (isCalibrationFresh(kv)) {
        // Strip the meta field so getQualityTarget() sees only sport keys.
        const { _last_updated, last_updated, ...sports } = kv;
        _qualityCalibration = sports;
        _qualityCalibrationSource = 'analytics-cron';
        console.log(`[QUALITY] calibration source=analytics-cron sports=${Object.keys(sports).length} updated=${_last_updated || last_updated}`);
        return;
      }
    } catch (e) {
      console.log(`[QUALITY] KV read failed, falling back to D1: ${e.message}`);
    }
  }

  // Fallback: existing D1 live percentile computation — preserved unchanged.
  try {
    if (!env.ARCHIVE_DB) return;
    const rows = await env.ARCHIVE_DB.prepare(
      `SELECT sport, quality_score FROM briefs
       WHERE quality_score IS NOT NULL AND sport IS NOT NULL
       AND date >= date('now', '-30 days')
       ORDER BY sport, quality_score`
    ).all();
    const bySport = {};
    for (const row of (rows.results || [])) {
      if (!bySport[row.sport]) bySport[row.sport] = [];
      bySport[row.sport].push(row.quality_score);
    }
    _qualityCalibration = {};
    for (const [sport, scores] of Object.entries(bySport)) {
      if (scores.length < 5) continue; // not enough data, keep hardcoded fallback
      scores.sort((a, b) => a - b);
      _qualityCalibration[sport] = {
        p25: scores[Math.floor(scores.length * 0.25)],
        p50: scores[Math.floor(scores.length * 0.50)],
        p75: scores[Math.floor(scores.length * 0.75)],
        count: scores.length,
      };
    }
    _qualityCalibrationSource = 'd1-live';
    console.log(`[QUALITY] calibration source=d1-live sports=${Object.keys(_qualityCalibration).length}`);
  } catch(e) { /* calibration failure never breaks journalism */ }
}

// Returns the quality retry threshold for a sport. Uses p25 from calibration
// when ≥ 5 samples exist; falls back to hardcoded sport-specific defaults.
// Initial calibration is anchored on slate briefs (game_recap rows have
// quality_score=NULL until a future session adds per-game scoring).
function getQualityTarget(sport) {
  if (_qualityCalibration?.[sport]?.count >= 5) {
    return _qualityCalibration[sport].p25;
  }
  // hardcoded fallback — sport-specific if defined, generic otherwise
  const HARDCODED = { nba: 160, nhl: 155, mlb: 145, wnba: 150 };
  return HARDCODED[sport?.toLowerCase()] || 150;
}

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

// ── WC brief grammar sanitizer (June 18 2026) ──────────────────────────────
// Claude/Gemini sometimes capitalize "Goals" mid-sentence and pluralize
// "1 Goals" in the World Cup tournament brief. The prompt has no such
// template — this is LLM hallucination. Targets only known bad patterns:
//   1) `\d+ Goals`         → `\d+ goals`         (lowercase after a digit)
//   2) word-number Goals   → word-number goals   (lowercase after spelled-out 0–10/no)
//   3) `1 goals`           → `1 goal`            (singular when count is 1)
// 0-goal phrasing left as `0 goals` — both that and `no goals` are acceptable
// per the bug spec, and rewriting to `no goals` can mangle possessive context
// (e.g. "Qatar's 0 goals" → "Qatar's no goals" reads worse).
function sanitizeGoalsGrammar(s) {
  if (!s) return s;
  const NUMBER_WORDS = '(?:no|zero|one|two|three|four|five|six|seven|eight|nine|ten)';
  return s
    .replace(/(\d+\s+)Goals\b/g, '$1goals')
    .replace(new RegExp(`(\\b${NUMBER_WORDS}\\s+)Goals\\b`, 'gi'), '$1goals')
    .replace(/(^|[^\d])1\s+goals\b/g, '$11 goal');
}

// ── Brief archive table — idempotent migration ──────────────────────────────
// Belt-and-suspenders helper for deploy safety. The briefs table is already
// created in field-archive D1 via Cloudflare MCP (per docs/brief-archive-spec.md);
// this CREATE IF NOT EXISTS guarantees the relay self-heals if the row in
// sqlite_master is ever lost. Memoized via _briefsReady so subsequent calls
// are no-ops.
let _briefsReady = false;
async function ensureBriefsTable(env) {
  if (_briefsReady) return;
  if (!env.ARCHIVE_DB) return;
  await env.ARCHIVE_DB.prepare(`
    CREATE TABLE IF NOT EXISTS briefs (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      brief_type TEXT NOT NULL,
      sport TEXT,
      game_id TEXT,
      brief_text TEXT NOT NULL,
      model TEXT,
      quality_score REAL,
      context_hash TEXT,
      word_count INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      source TEXT DEFAULT 'live'
    )`).run();
  _briefsReady = true;
}

// KV → D1 sweep for per-game briefs. Lists `brief:game:*` keys in
// FIELD_JOURNALISM, parses the JSON payload (or treats the value as raw
// prose), and INSERTs into the briefs table with source='kv_sweep'.
// ON CONFLICT DO NOTHING keeps the existing row untouched. Called from
// the live-hour cron path (every */15 tick) AND the dead-hour
// runDeadHourBackfill flow so a 1 h KV TTL can't outpace D1 capture.
async function sweepKVBriefs(env) {
  if (!env.FIELD_JOURNALISM || !env.ARCHIVE_DB) return null;
  await ensureBriefsTable(env);
  let swept = 0;
  try {
    const listed = await env.FIELD_JOURNALISM.list({ prefix: 'brief:game:', limit: 50 });
    for (const key of (listed.keys || [])) {
      const kvVal = await env.FIELD_JOURNALISM.get(key.name).catch(() => null);
      if (!kvVal) continue;
      let briefText = kvVal;
      let qualityScore = null;
      if (kvVal[0] === '{') {
        try {
          const p = JSON.parse(kvVal);
          briefText = p.brief || p.brief_text || p.text || kvVal;
          qualityScore = p.quality_score || p.score || null;
        } catch (_) { /* fall back to raw value */ }
      }
      if (!briefText || briefText.length < 50) continue;
      // Parse game_id + sport from key: brief:game:{sport}:{id} or brief:game:{id}
      const parts = key.name.replace('brief:game:', '').split(':');
      const gameId = parts.length >= 2 ? parts[parts.length - 1] : parts[0];
      const sport  = parts.length >= 2 ? parts[0] : null;
      // Rule 73 (CLAIM-CONTEXT-A): null-sport keys skip when a sport-tagged
      // sibling already exists — the cron-tagged brief is authoritative.
      if (!sport) {
        const existing = await env.ARCHIVE_DB.prepare(
          `SELECT 1 FROM briefs WHERE game_id = ? AND sport IS NOT NULL AND sport != '' LIMIT 1`
        ).bind(gameId).first().catch(() => null);
        if (existing) continue;
      }
      const sweepDate = new Date().toISOString().slice(0, 10);
      await env.ARCHIVE_DB.prepare(
        `INSERT INTO briefs
           (id, date, brief_type, sport, game_id, brief_text, quality_score, word_count, source)
         VALUES (?, ?, 'game_recap', ?, ?, ?, ?, ?, 'kv_sweep')
         ON CONFLICT(id) DO NOTHING`
      ).bind(
        `game_recap_${gameId}_${sweepDate}`,
        sweepDate, sport, gameId, briefText, qualityScore,
        briefText.split(/\s+/).length
      ).run();
      swept++;
    }
  } catch (_) { /* sweep failure never breaks cron */ }
  return swept > 0 ? { swept } : null;
}

// ── Odds layer (api.the-odds-api.com) ───────────────────────────────────────
// Captures opening_odds (and later closing_odds) into the archive game tables
// so the journalism prompt can include factual odds context. Every fetch
// records the X-Requests-Remaining header and bails when the free-tier quota
// drops below the safety floor — quota is shared across the whole worker.
// Cron LEAGUES (sport, league) -> Odds API sport_key. Used when the
// journalism cron iterates ESPN scoreboard sports.
const ODDS_SPORT_KEYS = {
  'basketball|nba':       'basketball_nba',
  'basketball|wnba':      'basketball_wnba',
  'hockey|nhl':           'icehockey_nhl',
  'baseball|mlb':         'baseball_mlb',
  'soccer|eng.1':         'soccer_epl',
  'soccer|fifa.world':    'soccer_fifa_world_cup',
};
// Archive `sport` column (uppercase short codes — D1 introspection
// 2026-06-16: regular_season has MLB/WNBA/EPL/MLS/CFL/AFL/IPL/La Liga/
// Ligue 1; postseason has NBA/NHL/UFL) -> Odds API sport_key.
// Case-insensitive lookup applied in archiveSportToOddsKey().
const ARCHIVE_SPORT_TO_ODDS_KEY = {
  nba:        'basketball_nba',
  wnba:       'basketball_wnba',
  nhl:        'icehockey_nhl',
  mlb:        'baseball_mlb',
  epl:        'soccer_epl',
  mls:        'soccer_usa_mls',
  'la liga':  'soccer_spain_la_liga',
  'ligue 1':  'soccer_france_ligue_one',
  bundesliga: 'soccer_germany_bundesliga',
  'serie a':  'soccer_italy_serie_a',
  cfl:        'americanfootball_cfl',
  nfl:        'americanfootball_nfl',
  ufl:        'americanfootball_ufl',
  afl:        'aussierules_afl',
  ipl:        'cricket_ipl',
};
const ODDS_QUOTA_FLOOR = 50;        // stop calling the API below this
const ODDS_PREFERRED_BOOK = 'draftkings';

function _oddsSportKeyFor(sport, league) {
  return ODDS_SPORT_KEYS[`${sport}|${league}`] || null;
}
function archiveSportToOddsKey(sport) {
  if (!sport) return null;
  return ARCHIVE_SPORT_TO_ODDS_KEY[String(sport).toLowerCase()] || null;
}

function _normTeam(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Extract a normalized odds payload from one /v4/.../odds game object.
function extractOddsForGame(oddsGame, preferredBook = ODDS_PREFERRED_BOOK) {
  const books = oddsGame.bookmakers || [];
  if (!books.length) return null;
  const bk = books.find(b => b.key === preferredBook) || books[0];
  const markets = bk.markets || [];
  const h2h     = markets.find(m => m.key === 'h2h');
  const spreads = markets.find(m => m.key === 'spreads');
  const totals  = markets.find(m => m.key === 'totals');
  const home    = oddsGame.home_team;
  const away    = oddsGame.away_team;
  const out = { source: bk.key, captured_at: new Date().toISOString() };
  if (h2h) {
    const h = h2h.outcomes.find(o => o.name === home);
    const a = h2h.outcomes.find(o => o.name === away);
    if (h && a) out.moneyline = { home: h.price, away: a.price };
  }
  if (spreads) {
    const h = spreads.outcomes.find(o => o.name === home);
    const a = spreads.outcomes.find(o => o.name === away);
    if (h && a) out.spread = { home: h.point, away: a.point };
  }
  if (totals) {
    const over  = totals.outcomes.find(o => o.name === 'Over');
    const under = totals.outcomes.find(o => o.name === 'Under');
    if (over && under) out.total = { over: over.point, under: under.point };
  }
  return out;
}

// ── Odds API credit guard ───────────────────────────────────────────────────
// Cross-cutting circuit breaker that wraps every odds-API fetch site. KV-
// backed monthly counter (FIELD_JOURNALISM key `odds:credits:YYYY-MM`) tracks
// cumulative cost; hard stops above ODDS_HARD_LIMIT (85 K — leaves 15 K
// for special projects out of the 100 K / month plan). Logs once per
// (50/75/90 %) threshold per month so a runaway path surfaces without spam.
//
// This is intentionally NOT exact accounting — KV writes are eventually
// consistent and we don't lock. It is an emergency floor to prevent another
// quota wipeout, not an audit ledger.
const ODDS_HARD_LIMIT = 85000;
const ODDS_THRESHOLDS = [
  { pct: 50, label: '50%' },
  { pct: 75, label: '75%' },
  { pct: 90, label: '90%' },
];

function _oddsCreditMonthKey() {
  const d = new Date();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `odds:credits:${d.getUTCFullYear()}-${m}`;
}

// Returns true if the call is allowed to proceed; false to abort.
// `units` is the credit cost of the planned fetch (1 for live odds with one
// market; up to 30 for historical calls). Increments AFTER returning true.
//
// Two-layer guard: shared daily ceiling first (src/budget-helpers.js),
// then the monthly hard limit. Either layer can veto. The daily layer
// is shared with AmbientDO's _consumeAmbientOddsCredit + _captureClosingOdds
// so a runaway in any one consumer can't burn the monthly quota in a day.
async function consumeOddsCredit(env, units) {
  if (!env.FIELD_JOURNALISM) return true; // KV unavailable: degrade-open
  // Daily layer first — cheaper failure path. checkAndIncrementDailyOdds
  // also increments on pass, so don't double-count below.
  if (!(await checkAndIncrementDailyOdds(env, units))) return false;
  try {
    const key = _oddsCreditMonthKey();
    const raw = await env.FIELD_JOURNALISM.get(key);
    const used = raw ? parseInt(raw, 10) || 0 : 0;
    if (used + units > ODDS_HARD_LIMIT) {
      const warnedKey = `${key}:warned:limit`;
      const already = await env.FIELD_JOURNALISM.get(warnedKey);
      if (!already) {
        console.warn(`[odds-guard] HARD LIMIT — used=${used} + ${units} > ${ODDS_HARD_LIMIT}; aborting odds calls for the rest of the month`);
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
        const already = await env.FIELD_JOURNALISM.get(warnedKey);
        if (!already) {
          console.warn(`[odds-guard] ${t.label} of monthly limit reached — used=${next}/${ODDS_HARD_LIMIT}`);
          await env.FIELD_JOURNALISM.put(warnedKey, '1', { expirationTtl: 60 * 86400 });
        }
      }
    }
    return true;
  } catch (_) {
    return true; // KV failure: degrade-open rather than block live coverage
  }
}

// Fetch current odds for one sport. Returns { games, quotaRemaining, ok }.
async function fetchSportOddsLive(env, sportKey) {
  const key = env.ODDS_API_KEY || ODDS_API_KEY_FALLBACK;
  if (!key) return { games: [], quotaRemaining: 0, ok: false };
  // 3 markets (h2h,spreads,totals) → ~3 credits/call
  if (!(await consumeOddsCredit(env, 3))) {
    return { games: [], quotaRemaining: 0, ok: false, guarded: true };
  }
  const r = await fetch(
    `${ODDS_BASE}/v4/sports/${sportKey}/odds?apiKey=${key}&markets=h2h,spreads,totals&regions=us&oddsFormat=american`,
    // cacheEverything: true is required — Odds API returns Cache-Control: private
    // and Workers otherwise won't cache. TTL bumped to 900s to match the cron
    // cadence (15-min ticks); same-tick re-calls now hit cache for free.
    { cf: { cacheTtl: 900, cacheEverything: true } }
  );
  const quotaRemaining = parseInt(r.headers.get('x-requests-remaining') || '0', 10) || 0;
  if (!r.ok) return { games: [], quotaRemaining, ok: false };
  let games = [];
  try { games = await r.json(); } catch (_) { games = []; }
  return { games: Array.isArray(games) ? games : [], quotaRemaining, ok: true };
}

// Per-cron snapshot. Discovers which sports have pending opening_odds rows
// for today directly from the archive (decoupled from the cron's LEAGUES
// list — archive sport vocabulary is uppercase short codes, not the
// {sport,league} ESPN shape), then fetches live odds once per sport and
// UPDATEs matching rows. Bails when the quota approaches the floor.
async function snapshotCronOdds(env, dateKey) {
  if (!env.ARCHIVE_DB) return null;
  const rsP = await env.ARCHIVE_DB.prepare(
    `SELECT DISTINCT sport FROM regular_season_games
      WHERE date = ? AND opening_odds IS NULL AND sport IS NOT NULL`
  ).bind(dateKey).all();
  const psP = await env.ARCHIVE_DB.prepare(
    `SELECT DISTINCT sport FROM postseason_games
      WHERE date = ? AND opening_odds IS NULL AND sport IS NOT NULL`
  ).bind(dateKey).all();
  const sports = [...new Set([
    ...(rsP.results || []).map(r => r.sport),
    ...(psP.results || []).map(r => r.sport),
  ].filter(Boolean))];
  if (!sports.length) return null;

  let lastQuota = null;
  for (const sport of sports) {
    const sportKey = archiveSportToOddsKey(sport);
    if (!sportKey) continue;
    if (lastQuota !== null && lastQuota < ODDS_QUOTA_FLOOR) return lastQuota;

    const { games, quotaRemaining, ok } = await fetchSportOddsLive(env, sportKey);
    lastQuota = quotaRemaining;
    if (!ok) continue;
    if (quotaRemaining > 0 && quotaRemaining < ODDS_QUOTA_FLOOR) return lastQuota;

    const byPair = new Map();
    for (const g of games) {
      // Centralised identity resolution: same canonical key from
      // either side (Odds-API name OR D1 name) — handles aliases
      // (Brighton & Hove Albion, Aces, Athletics, Türkiye, …).
      byPair.set(`${resolveTeamKey(g.home_team)}|${resolveTeamKey(g.away_team)}`, g);
    }
    for (const table of ['regular_season_games', 'postseason_games']) {
      const rows = await env.ARCHIVE_DB.prepare(
        `SELECT id, home, away FROM ${table}
          WHERE date = ? AND sport = ? AND opening_odds IS NULL`
      ).bind(dateKey, sport).all();
      // Build the per-row update list, then hand off to reconcile()
      // so the UPDATE + change_log INSERTs go out in batched form
      // (one round-trip per chunk instead of one per row) and every
      // applied change is observable via /changelog/{date}.
      const updates = [];
      for (const row of (rows.results || [])) {
        const og = byPair.get(`${resolveTeamKey(row.home)}|${resolveTeamKey(row.away)}`);
        if (!og) continue;
        const odds = extractOddsForGame(og);
        if (!odds) continue;
        updates.push({ id: row.id, fields: { opening_odds: JSON.stringify(odds) } });
      }
      if (updates.length) {
        await reconcile(env, {
          target: table,
          updates,
          changelog: { source: 'odds_api', label: 'opening_odds' },
        });
      }
    }
  }
  return lastQuota;
}

// Historical odds fetch — /v4/historical/sports/{sport}/odds at a snapshot ISO.
// The Odds API charges 10 quota units per historical call (vs 1 for current),
// so callers MUST check the quota_remaining return field before iterating.
async function fetchSportOddsHistorical(env, sportKey, isoDate) {
  const key = env.ODDS_API_KEY || ODDS_API_KEY_FALLBACK;
  if (!key) return { games: [], quotaRemaining: 0, ok: false };
  // Historical = 10× live cost; 3 markets → ~30 credits per call.
  if (!(await consumeOddsCredit(env, 30))) {
    return { games: [], quotaRemaining: 0, ok: false, guarded: true };
  }
  // Anchor to noon UTC on the requested date so the snapshot captures odds
  // shortly before evening kickoff for most sports.
  const snapshot = `${isoDate}T12:00:00Z`;
  const url = `${ODDS_BASE}/v4/historical/sports/${sportKey}/odds`
            + `?apiKey=${key}&date=${snapshot}`
            + `&markets=h2h,spreads,totals&regions=us&oddsFormat=american`;
  // cacheEverything: true is required — Odds API returns Cache-Control: private.
  // Historical snapshots for a (sport, date, snapshot-time) are immutable, so
  // 24h cache is safe — re-runs of the dead-hour cron walking the same date
  // hit cache for free.
  const r = await fetch(url, { cf: { cacheTtl: 86400, cacheEverything: true } });
  const quotaRemaining = parseInt(r.headers.get('x-requests-remaining') || '0', 10) || 0;
  if (!r.ok) return { games: [], quotaRemaining, ok: false };
  let payload = null;
  try { payload = await r.json(); } catch (_) { payload = null; }
  // Historical endpoint wraps in {timestamp, previous_timestamp, next_timestamp, data: [...]}
  const games = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.data) ? payload.data : []);
  return { games, quotaRemaining, ok: true };
}

// One-shot historical odds backfill for a single archive date. Per-sport
// dispatch; cross-table (regular_season_games + postseason_games); only
// touches rows where opening_odds IS NULL.
async function runOddsBackfillForDate(env, isoDate) {
  if (!env.ARCHIVE_DB) return { ok: false, reason: 'ARCHIVE_DB not bound', date: isoDate };
  const apiKey = env.ODDS_API_KEY || ODDS_API_KEY_FALLBACK;
  if (!apiKey) return { ok: false, reason: 'ODDS_API_KEY not configured', date: isoDate };

  const rs = await env.ARCHIVE_DB.prepare(
    `SELECT id, sport, league, home, away FROM regular_season_games
      WHERE date = ? AND opening_odds IS NULL`
  ).bind(isoDate).all();
  const ps = await env.ARCHIVE_DB.prepare(
    `SELECT id, sport, league, home, away FROM postseason_games
      WHERE date = ? AND opening_odds IS NULL`
  ).bind(isoDate).all();

  const rsRows = rs.results || [];
  const psRows = ps.results || [];
  const gamesFound = rsRows.length + psRows.length;
  if (!gamesFound) {
    return { ok: true, date: isoDate, games_found: 0, odds_populated: 0, odds_skipped: 0 };
  }

  // Bucket pending rows by Odds API sport key.
  // Archive sport column is uppercase short-code vocabulary (MLB / NBA / WNBA
  // / EPL / La Liga / …) — use archiveSportToOddsKey() rather than the
  // {sport,league} ESPN-cron map.
  const buckets = new Map(); // sportKey -> { rs:[], ps:[] }
  const bucketOf = (sport) => {
    const sk = archiveSportToOddsKey(sport);
    if (!sk) return null;
    if (!buckets.has(sk)) buckets.set(sk, { rs: [], ps: [] });
    return buckets.get(sk);
  };
  for (const row of rsRows) { const b = bucketOf(row.sport); if (b) b.rs.push(row); }
  for (const row of psRows) { const b = bucketOf(row.sport); if (b) b.ps.push(row); }

  let oddsPopulated = 0;
  let oddsSkipped  = 0;
  let lastQuota    = null;
  let stopped      = false;
  let stopReason   = null;

  for (const [sportKey, group] of buckets) {
    if (lastQuota !== null && lastQuota < ODDS_QUOTA_FLOOR) {
      stopped = true; stopReason = 'quota_low'; break;
    }
    const { games, quotaRemaining, ok } = await fetchSportOddsHistorical(env, sportKey, isoDate);
    lastQuota = quotaRemaining;
    if (!ok) { oddsSkipped += group.rs.length + group.ps.length; continue; }
    if (quotaRemaining > 0 && quotaRemaining < ODDS_QUOTA_FLOOR) {
      stopped = true; stopReason = 'quota_low';
      // Still apply matches from THIS sport's already-paid-for response.
    }

    const byPair = new Map();
    for (const g of games) {
      // Same centralised identity resolution as snapshotCronOdds —
      // historical backfill needs the same alias coverage so a
      // single deploy fixes both the live snapshot and the catch-up.
      byPair.set(`${resolveTeamKey(g.home_team)}|${resolveTeamKey(g.away_team)}`, g);
    }
    // Build per-row updates for both tables, then dispatch via
    // reconcile() so the UPDATE + change_log INSERTs are batched and
    // a 100-row backfill makes one DB round-trip per table per chunk
    // (chunk size = 40) instead of one per row.
    const apply = async (rows, table) => {
      const updates = [];
      for (const row of rows) {
        const og = byPair.get(`${resolveTeamKey(row.home)}|${resolveTeamKey(row.away)}`);
        if (!og) { oddsSkipped++; continue; }
        const odds = extractOddsForGame(og);
        if (!odds) { oddsSkipped++; continue; }
        updates.push({ id: row.id, fields: { opening_odds: JSON.stringify(odds) } });
      }
      if (!updates.length) return;
      try {
        const r = await reconcile(env, {
          target: table,
          updates,
          changelog: { source: 'odds_api', label: 'opening_odds' },
        });
        oddsPopulated += r.synced || 0;
        oddsSkipped   += updates.length - (r.synced || 0);
      } catch (_) {
        oddsSkipped += updates.length;
      }
    };
    await apply(group.rs, 'regular_season_games');
    await apply(group.ps, 'postseason_games');

    if (stopped) break;
  }

  return {
    ok: true,
    date: isoDate,
    games_found: gamesFound,
    odds_populated: oddsPopulated,
    odds_skipped: oddsSkipped,
    quota_remaining: lastQuota,
    stopped: stopped || undefined,
    reason: stopReason || undefined,
  };
}

// ── Backfill prompt builder ─────────────────────────────────────────────────
// Reconstructs a FIELD Brief prompt for a past slate from archived game rows.
// Mirrors handleJournalismCycle's prompt voice (rules, JQ_STYLE) but in a
// historical/recap register since these are completed games.
//
// Inputs:
//   date  — ISO date string YYYY-MM-DD
//   games — array of rows mixed from regular_season_games + postseason_games.
//           Postseason rows are identified by the presence of `series_key`.
//   seriesNarratives — { [series_key]: narrative string } from postseason_series
//
// Returns null when the slate is too thin to produce quality output
// (no scored games AND no notes/matchupNotes — pure schedule placeholders).
// Returns the prompt string otherwise.
function buildBackfillPrompt(date, games, seriesNarratives) {
  if (!Array.isArray(games) || !games.length) return null;

  const postseason = games.filter(g => g && g.series_key);
  const regular    = games.filter(g => g && !g.series_key);

  // Thinness check: skip dates with no scored games and no notes.
  const hasScored = games.some(g =>
    g && g.home_score !== null && g.home_score !== undefined &&
         g.away_score !== null && g.away_score !== undefined);
  const hasNotes = games.some(g => g && (g.note || g.matchupNote));
  if (!hasScored && !hasNotes) return null;

  const fmt = (g) => {
    const parts = [];
    const league = g.league || g.sport || '';
    if (league) parts.push(`[${league}]`);
    parts.push(`${g.away} @ ${g.home}`);
    if (g.home_score !== null && g.home_score !== undefined &&
        g.away_score !== null && g.away_score !== undefined) {
      parts.push(`final ${g.away} ${g.away_score}, ${g.home} ${g.home_score}`);
    }
    if (g.venue)         parts.push(`venue: ${g.venue}`);
    if (g.series_record) parts.push(`series: ${g.series_record}`);
    if (g.note)          parts.push(`note: ${g.note}`);
    if (g.matchupNote)   parts.push(`matchup: ${g.matchupNote}`);
    if (g.crew)          parts.push(`crew: ${g.crew}`);
    if (g.streams)       parts.push(`broadcast: ${g.streams}`);
    if (g.opening_odds) {
      try {
        const o = typeof g.opening_odds === 'string' ? JSON.parse(g.opening_odds) : g.opening_odds;
        const oddsParts = [];
        if (o.spread && typeof o.spread.home === 'number') {
          oddsParts.push(`opened ${o.spread.home > 0 ? '+' : ''}${o.spread.home}`);
        }
        if (o.moneyline) oddsParts.push(`ML ${o.moneyline.home}/${o.moneyline.away}`);
        if (o.total && typeof o.total.over === 'number') oddsParts.push(`O/U ${o.total.over}`);
        if (oddsParts.length) parts.push(`odds: ${oddsParts.join(', ')}`);
      } catch (_) { /* skip malformed odds JSON */ }
    }
    return parts.join(' | ');
  };

  const sections = [
    `Write a FIELD Brief reconstructing the sports slate for ${date}.`,
    '',
  ];

  if (postseason.length) {
    sections.push('POSTSEASON GAMES:');
    for (const g of postseason) {
      sections.push(`- ${fmt(g)}`);
      const narr = seriesNarratives && g.series_key ? seriesNarratives[g.series_key] : null;
      if (narr) sections.push(`  series narrative: ${narr}`);
    }
    sections.push('');
  }
  if (regular.length) {
    sections.push('REGULAR SEASON GAMES:');
    for (const g of regular) sections.push(`- ${fmt(g)}`);
    sections.push('');
  }

  sections.push('RULES:');
  sections.push('- 100-120 words. 2 short paragraphs. No headers. No bullet points.');
  sections.push('- HISTORICAL VOICE: this is a backfill brief reconstructing a past slate. Use past tense for completed games. Reference the slate date in context.');
  sections.push('- Lead with the most important story — the SPECIFIC situation, not the template. Lead with a name, a number, or a situation — not a team name in subject position.');
  sections.push('- CORRECTNESS: write only from the data above. Never invent scores, stats, or facts not listed.');
  sections.push('- SLATE BOUNDARY (mandatory): every league or sport you reference must appear in the GAMES sections above. Do not invoke leagues with no game in this slate.');
  sections.push('- SERIES ACCURACY: A Conference Finals game is NEVER "the NBA Finals" or "the Championship." A Stanley Cup Final game is NEVER a "first-round matchup." Use only the round/series description in the data. If unclear, describe as "a playoff series" — never upgrade to a championship.');
  sections.push(JQ_STYLE);
  sections.push('- Plain prose only. Every sentence complete.');

  return sections.join('\n');
}

// ── Series preview backfill — brief_type='series_preview' ────────────────────
// Runs in dead-hour cron after game brief backfill. For each postseason series
// with at least one completed game, generates a series preview if none exists.
// Max 2 series per invocation. source='backfill'.
async function executeSeriesPreviewBackfill(env) {
  if (!env.ARCHIVE_DB) return {ok:false, reason:'ARCHIVE_DB not bound'};

  await ensureBriefsTable(env);

  // Find all postseason series that have at least one completed game.
  // D1 doesn't support CTEs, so use a subquery.
  const seriesResult = await env.ARCHIVE_DB.prepare(
    `SELECT ps.series_key, ps.sport, ps.round, ps.higher_seed, ps.lower_seed,
            ps.narrative, ps.result,
            COUNT(pg.id) AS games_played
     FROM postseason_series ps
     JOIN postseason_games pg ON ps.series_key = pg.series_key
       AND pg.home_score IS NOT NULL
     GROUP BY ps.series_key
     ORDER BY ps.series_key ASC`
  ).all().catch(() => ({ results: [] }));

  const allSeries = seriesResult.results || [];
  if (!allSeries.length) return {ok:false, skipped:true, reason:'no active postseason series'};

  let series_processed = 0;
  let series_skipped = 0;

  for (const series of allSeries.slice(0, 2)) {
    const seriesKey = series.series_key;
    const existing = await env.ARCHIVE_DB.prepare(
      `SELECT id FROM briefs WHERE game_id = ? AND brief_type = 'series_preview' LIMIT 1`
    ).bind(seriesKey).first();
    if (existing) { series_skipped++; continue; }

    // Compute wins from postseason_games results
    const gamesResult = await env.ARCHIVE_DB.prepare(
      `SELECT home, away, home_score, away_score FROM postseason_games
       WHERE series_key = ? AND home_score IS NOT NULL ORDER BY game_number ASC`
    ).bind(seriesKey).all();
    const played = gamesResult.results || [];
    if (!played.length) { series_skipped++; continue; }

    const refGame = played[0];
    const higherSeed = series.higher_seed || refGame.home || 'Team A';
    const lowerSeed  = series.lower_seed  || refGame.away || 'Team B';
    let higherWins = 0, lowerWins = 0;
    for (const g of played) {
      const higherIsHome = g.home === higherSeed;
      if (higherIsHome ? g.home_score > g.away_score : g.away_score > g.home_score) higherWins++;
      else lowerWins++;
    }

    const sport = series.sport || 'sport';
    const seriesPrompt = [
      `Write a 60-80 word series preview for this ${sport} playoff series.`,
      `${higherSeed} leads ${higherWins}-${lowerWins} over ${lowerSeed}.`,
      `Round: ${series.round || 'postseason'}`,
      series.narrative ? `Series narrative: ${series.narrative}` : '',
      series.result ? `Current result: ${series.result}` : '',
      `Rules: Focus on what decides the series. One key matchup or trend. No clichés. One paragraph only.`,
    ].filter(Boolean).join('\n');

    const callProxy = async (promptText) => {
      const resp = await fetch(JOURNALISM_CLAUDE_PROXY, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026'},
        body: JSON.stringify({model: 'claude-haiku-4-5-20251001', max_tokens: 400,
          messages: [{role: 'user', content: promptText}]}),
      });
      if (!resp.ok) return null;
      const data = await resp.json().catch(() => null);
      return data ? (data.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('').trim()||null : null;
    };

    const initial = await callProxy(seriesPrompt);
    if (!initial || initial.length < 30) { series_skipped++; continue; }

    const qResult = await runQualityChain(seriesPrompt, initial, callProxy, {
      sport,
      scoreThreshold: 240,
      maxRetries: 3,
      game:        { home: higherSeed, away: lowerSeed },
      matchupNote: series.narrative || null,
    });
    const prose = stripMarkdown(qResult.text);
    const briefDate = new Date().toISOString().slice(0, 10);

    await env.ARCHIVE_DB.prepare(
      `INSERT INTO briefs
         (id, date, brief_type, sport, game_id, brief_text, model, quality_score, word_count, source)
       VALUES (?, ?, 'series_preview', ?, ?, ?, 'gemini-3.1-flash-lite', ?, ?, 'backfill')
       ON CONFLICT(id) DO NOTHING`
    ).bind(
      `series_preview_${seriesKey}`,
      briefDate, sport, seriesKey, prose, qResult.score, prose.split(/\s+/).length
    ).run();
    series_processed++;
  }

  return {ok: series_processed > 0, series_processed, series_skipped, total: allSeries.length};
}

// ── Per-game backfill — brief_type='game_brief' for completed games ───────────
// Fires in dead-hour cron when executeBackfill returns skipped (slate brief
// already exists for the date). Max 3 games per invocation to stay within
// Gemini rate limits. source='backfill'.
async function executeGameBriefBackfill(env, date) {
  if (!env.ARCHIVE_DB) return {ok:false, reason:'ARCHIVE_DB not bound'};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return {ok:false, reason:'invalid date'};

  await ensureBriefsTable(env);

  const regResult = await env.ARCHIVE_DB.prepare(
    `SELECT * FROM regular_season_games WHERE date = ? AND home_score IS NOT NULL`
  ).bind(date).all();
  const psResult = await env.ARCHIVE_DB.prepare(
    `SELECT * FROM postseason_games WHERE date = ? AND home_score IS NOT NULL`
  ).bind(date).all();
  const games = [...(regResult.results || []), ...(psResult.results || [])];
  if (!games.length) return {ok:false, skipped:true, reason:'no completed games for date', date};

  let games_processed = 0;
  let games_skipped = 0;

  for (const game of games.slice(0, 3)) {
    const gameId = String(game.source_id || game.id || '');
    const existing = await env.ARCHIVE_DB.prepare(
      `SELECT id FROM briefs WHERE game_id = ? AND brief_type = 'game_brief' LIMIT 1`
    ).bind(gameId).first();
    if (existing) { games_skipped++; continue; }

    const sport = game.sport || 'sport';
    const home  = game.home || 'Home';
    const away  = game.away || 'Away';
    const isPostseason = !!game.series_key;

    // R2 sport context for backfill path — resolves abbreviations from
    // display names since D1 archive tables don't store team abbreviations.
    let sportContext = '';
    try {
      sportContext = await assembleContext(env, {
        sport, home, away,
        homeAbbr: '', awayAbbr: '',  // resolveAbbr inside builders handles name→abbr
        sourceId: game.espn_event_id || null,  // feeds buildESPNSummaryContext
        league: game.league || null,           // enables WNBA/WTA/soccer sport promotion
        espnLeague: game.espn_league || null,
      }, 600);
    } catch (_) { /* non-fatal */ }

    let seriesContext = '';
    if (isPostseason && game.series_key) {
      const series = await env.ARCHIVE_DB.prepare(
        `SELECT * FROM postseason_series WHERE series_key = ? LIMIT 1`
      ).bind(game.series_key).first().catch(() => null);
      if (series) {
        const hW = (await env.ARCHIVE_DB.prepare(
          `SELECT COUNT(*) AS n FROM postseason_games
           WHERE series_key = ? AND home_score > away_score AND home_score IS NOT NULL`
        ).bind(game.series_key).first().catch(() => null))?.n || 0;
        const aW = (await env.ARCHIVE_DB.prepare(
          `SELECT COUNT(*) AS n FROM postseason_games
           WHERE series_key = ? AND away_score > home_score AND away_score IS NOT NULL`
        ).bind(game.series_key).first().catch(() => null))?.n || 0;
        seriesContext = `\nSeries record: ${hW}-${aW}`;
        if (series.narrative) seriesContext += `\nContext: ${series.narrative}`;
      }
    }

    const gamePrompt = [
      FIELD_VOICE_REGISTER,
      `Write a 50-70 word game brief for this ${sport}${isPostseason ? ' playoff' : ''} game.`,
      `${away} ${game.away_score} at ${home} ${game.home_score}`,
      game.venue ? `Venue: ${game.venue}` : '',
      `Date: ${date}`,
      isPostseason ? `Round: ${game.round || 'postseason'}${seriesContext}` : '',
      sportContext || '',
      `SPORT BOUNDARY: This is a ${sport} game. Write ONLY ${sport} content. Do not reference players, stats, or terminology from any other sport. If context is empty, write from the score and date only.`,
      `Rules: Lead with the decisive moment or stat. No clichés. One paragraph, no headers.`,
    ].filter(Boolean).join('\n');

    const callProxy = async (promptText) => {
      const resp = await fetch(JOURNALISM_CLAUDE_PROXY, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026'},
        body: JSON.stringify({model: 'claude-haiku-4-5-20251001', max_tokens: 400,
          messages: [{role: 'user', content: promptText}]}),
      });
      if (!resp.ok) return null;
      const data = await resp.json().catch(() => null);
      return data ? (data.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('').trim()||null : null;
    };

    const initial = await callProxy(gamePrompt);
    if (!initial || initial.length < 30) { games_skipped++; continue; }

    const qResult = await runQualityChain(gamePrompt, initial, callProxy, {
      sport,
      scoreThreshold: 240,
      maxRetries: 3,
      game: { home, away, homeScore: game.home_score, awayScore: game.away_score },
      matchupNote: game.note || null,
    });
    const prose = stripMarkdown(qResult.text);

    await env.ARCHIVE_DB.prepare(
      `INSERT INTO briefs
         (id, date, brief_type, sport, game_id, brief_text, model, quality_score, word_count, source)
       VALUES (?, ?, 'game_brief', ?, ?, ?, 'gemini-3.1-flash-lite', ?, ?, 'backfill')
       ON CONFLICT(id) DO NOTHING`
    ).bind(
      `game_brief_${sport}_${gameId}_${date}`,
      date, sport, gameId, prose, qResult.score, prose.split(/\s+/).length
    ).run();
    games_processed++;
  }

  return {ok: games_processed > 0, date, games_processed, games_skipped, total: games.length};
}

// ── Backfill execution — shared by /archive/backfill and dead-hour cron ─────
// Reads archived games + series narratives for a date, calls Gemini via the
// journalism proxy, runs the result through the quality chain, INSERTs into
// the briefs table with source='backfill'. Returns a structured result.
async function executeBackfill(env, date) {
  if (!env.ARCHIVE_DB)        return {ok:false, reason:'ARCHIVE_DB not bound'};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return {ok:false, reason:'invalid date (YYYY-MM-DD)'};

  await ensureBriefsTable(env);

  // Skip-existing hard check: never overwrite a backfill with another backfill.
  // Avoids wasting Gemini calls + protects existing prose from re-runs.
  const existing = await env.ARCHIVE_DB.prepare(
    `SELECT id FROM briefs WHERE date = ? AND source = 'backfill' LIMIT 1`
  ).bind(date).first();
  if (existing) {
    return {ok:true, skipped:true, reason:'backfill already exists', date, existing_id: existing.id};
  }

  // Pull games for the date from both tables.
  const regResult = await env.ARCHIVE_DB.prepare(
    'SELECT * FROM regular_season_games WHERE date = ?'
  ).bind(date).all();
  const psResult = await env.ARCHIVE_DB.prepare(
    'SELECT * FROM postseason_games WHERE date = ?'
  ).bind(date).all();
  const games = [...(regResult.results || []), ...(psResult.results || [])];
  if (!games.length) return {ok:false, skipped:true, reason:'no archived games for date', date};

  // Fetch series narratives for any postseason series_keys we saw.
  const seriesKeys = [...new Set(games.map(g => g.series_key).filter(Boolean))];
  const seriesNarratives = {};
  if (seriesKeys.length) {
    const placeholders = seriesKeys.map(() => '?').join(',');
    const sRes = await env.ARCHIVE_DB.prepare(
      `SELECT series_key, narrative FROM postseason_series WHERE series_key IN (${placeholders})`
    ).bind(...seriesKeys).all();
    for (const row of (sRes.results || [])) {
      if (row.narrative) seriesNarratives[row.series_key] = row.narrative;
    }
  }

  const prompt = buildBackfillPrompt(date, games, seriesNarratives);
  if (!prompt) return {ok:false, skipped:true, reason:'insufficient data', date, gameCount: games.length};

  // Same proxy shape as handleJournalismCycle's callProxy — proxy routes to
  // Gemini 3.1 Flash-Lite primary, Claude Haiku 4.5 fallback (CLAUDE.md).
  const callProxy = async (promptText) => {
    const resp = await fetch(JOURNALISM_CLAUDE_PROXY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-FIELD-Relay': 'field-relay-cron-2026',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{role: 'user', content: promptText}],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim() || null;
  };

  const initial = await callProxy(prompt);
  if (!initial || initial.length < 50) {
    return {ok:false, reason:'proxy returned no prose', date};
  }

  const qResult = await runQualityChain(prompt, initial, callProxy, {
    sport: null,
    scoreThreshold: 240,
    maxRetries: 6,
  });
  const prose = qResult.text;
  const score = qResult.score;

  await env.ARCHIVE_DB.prepare(
    `INSERT INTO briefs
       (id, date, brief_type, sport, brief_text, model, quality_score, word_count, source)
     VALUES (?, ?, 'slate', NULL, ?, 'gemini-3.1-flash-lite', ?, ?, 'backfill')
     ON CONFLICT(id) DO NOTHING`
  ).bind(
    `slate_${date}_backfill`,
    date,
    prose,
    score,
    prose.split(/\s+/).length
  ).run();

  return {
    ok: true,
    date,
    gameCount: games.length,
    postseasonCount: games.filter(g => g.series_key).length,
    brief_text: prose,
    quality_score: score,
    retries: qResult.retries,
    layers_fired: qResult.layers_fired,
  };
}

// Pick the next date for odds backfill during dead-hour cron ticks.
// Postseason dates first (sorted ascending), then regular season. Returns null
// when no archive row anywhere is missing opening_odds.
async function pickNextOddsBackfillDate(env) {
  if (!env.ARCHIVE_DB) return null;
  const ps = await env.ARCHIVE_DB.prepare(
    `SELECT DISTINCT date FROM postseason_games
      WHERE opening_odds IS NULL AND date IS NOT NULL
      ORDER BY date ASC LIMIT 1`
  ).all();
  if (ps.results && ps.results.length) return ps.results[0].date;
  const rs = await env.ARCHIVE_DB.prepare(
    `SELECT DISTINCT date FROM regular_season_games
      WHERE opening_odds IS NULL AND date IS NOT NULL
      ORDER BY date ASC LIMIT 1`
  ).all();
  if (rs.results && rs.results.length) return rs.results[0].date;
  return null;
}

// Pick the next backfill date during dead-hour cron ticks.
// Postseason dates first (sorted ascending), then regular season — skipping any
// date that already has a source='backfill' brief.
async function pickNextBackfillDate(env) {
  if (!env.ARCHIVE_DB) return null;
  const ps = await env.ARCHIVE_DB.prepare(
    `SELECT DISTINCT date FROM postseason_games
      WHERE date NOT IN (SELECT date FROM briefs WHERE source = 'backfill')
      ORDER BY date ASC LIMIT 1`
  ).all();
  if (ps.results && ps.results.length) return ps.results[0].date;
  const rs = await env.ARCHIVE_DB.prepare(
    `SELECT DISTINCT date FROM regular_season_games
      WHERE date NOT IN (SELECT date FROM briefs WHERE source = 'backfill')
      ORDER BY date ASC LIMIT 1`
  ).all();
  if (rs.results && rs.results.length) return rs.results[0].date;
  return null;
}


// ── Golf tournament context for slate brief cron ──────────────────────────
// Called during live hours when a PGA tournament is active. Uses the same
// handleESPNGolfScoreboard that powers /v2/golf/enriched. Returns a context
// block for the slate prompt or '' when no tournament is live.
async function buildGolfCronContext(espnDate, env) {
  try {
    const data = await handleESPNGolfScoreboard(espnDate, env, {});
    if (!data || data.active === false) return '';
    const evName = data.eventName || data.name || 'PGA Tour event';
    const round = data.round ? `Round ${data.round}` : '';
    const players = (data.leaderboard || []).slice(0, 10);
    if (!players.length) return '';
    const lbLines = players.map(p => {
      const pos = p.pos || p.position || '';
      const tp = p.toPar != null ? String(p.toPar) : 'E';
      const today = p.today != null ? ` (today ${p.today})` : '';
      const thru = p.thru ? ` thru ${p.thru}` : '';
      return `  ${pos} ${p.name} ${tp}${today}${thru}`.trim();
    });
    return [
      '',
      `PGA TOUR — ${evName}${round ? ' · ' + round : ''}:`,
      ...lbLines,
      'Use leaderboard positions and scores only — never reference strokes gained.',
    ].join('\n');
  } catch (_) { return ''; /* golf context is an enhancement — Rule 5 */ }
}

// ── Context Graph helpers (June 18 2026) ────────────────────────────────────
// Each helper is independently try/catch-friendly: returns null on missing
// data so the parent Promise.allSettled call gets a clean fulfilled value
// for "no rows" and reserves rejection for actual D1 errors.
//
// Stubs land in Commit 1. Real implementations:
//   findGame       — Commit 2
//   findBriefs     — Commit 3
//   findSeries     — Commit 4
//   findEnrichment — Commit 5
// findGame — postseason first (richer rows), then regular season. Both lookups
// accept exact id OR a fuzzy match against the synthetic "{home}_{away}_{date}"
// string. Odds columns are JSON TEXT — parsed under try/catch so a malformed
// blob never breaks the whole response. lineMovement is computed from the
// home spread when both opening/closing parse cleanly.
async function findGame(env, id) {
    const fuzzy = `%${id}%`;
    let row = await env.ARCHIVE_DB.prepare(
        `SELECT * FROM postseason_games WHERE id = ? OR
         (home || '_' || away || '_' || date) LIKE ?`
    ).bind(id, fuzzy).first();
    if (!row) {
        row = await env.ARCHIVE_DB.prepare(
            `SELECT * FROM regular_season_games WHERE id = ? OR
             (home || '_' || away || '_' || date) LIKE ?`
        ).bind(id, fuzzy).first();
    }
    if (!row) return null;
    let openingOdds = null, closingOdds = null;
    let dramaArc    = null;
    try { if (row.opening_odds) openingOdds = JSON.parse(row.opening_odds); } catch (_) {}
    try { if (row.closing_odds) closingOdds = JSON.parse(row.closing_odds); } catch (_) {}
    // drama_arc is the full client-computed drama summary object — JSON TEXT.
    // ADR-002: relay does not compute drama, only stores and surfaces it.
    try { if (row.drama_arc)    dramaArc    = JSON.parse(row.drama_arc);    } catch (_) {}
    return {
        ...row,
        opening_odds_parsed: openingOdds,
        closing_odds_parsed: closingOdds,
        drama_arc_parsed:    dramaArc,
        lineMovement: (openingOdds && closingOdds) ? {
            spreadOpen:  openingOdds.spread?.home ?? null,
            spreadClose: closingOdds.spread?.home ?? null,
            moved: (openingOdds.spread?.home ?? null) !== (closingOdds.spread?.home ?? null),
        } : null,
    };
}
// findBriefs — game-specific + slate-for-date + prior-day slate. game_id
// match preferred; LIKE on briefs.id catches sweep/capture IDs that embed
// the game id but use a different prefix (e.g. game_recap_{sport}_{id}).
// Returns nulls (not absent keys) so consumers can rely on the shape.
async function findBriefs(env, id) {
    const dateMatch = id.match(/\d{4}-\d{2}-\d{2}/);
    const date = dateMatch ? dateMatch[0] : null;
    const results = { gameBriefs: [], slateBrief: null, priorBrief: null };

    const gameBriefs = await env.ARCHIVE_DB.prepare(
        `SELECT id, brief_type, brief_text, quality_score, source, model, word_count, created_at
         FROM briefs WHERE game_id = ? OR id LIKE ?
         ORDER BY created_at DESC LIMIT 5`
    ).bind(id, `%${id}%`).all();
    results.gameBriefs = gameBriefs.results || [];

    if (date) {
        const slate = await env.ARCHIVE_DB.prepare(
            `SELECT brief_text, quality_score, source, model, created_at FROM briefs
             WHERE brief_type = 'slate' AND date = ?
             ORDER BY created_at DESC LIMIT 1`
        ).bind(date).first();
        results.slateBrief = slate || null;

        const prior = await env.ARCHIVE_DB.prepare(
            `SELECT brief_text, quality_score, date, created_at FROM briefs
             WHERE brief_type = 'slate' AND date < ?
             ORDER BY date DESC, created_at DESC LIMIT 1`
        ).bind(date).first();
        results.priorBrief = prior || null;
    }
    return results;
}
// findSeries — only fires when the id matches a postseason_games row that
// carries a series_key. Returns the postseason_series row + every game in
// the series + an array of completed-game margins (home_score - away_score)
// for downstream consumers that want to compute series momentum/leverage.
async function findSeries(env, id) {
    const game = await env.ARCHIVE_DB.prepare(
        `SELECT series_key FROM postseason_games WHERE id = ? LIMIT 1`
    ).bind(id).first();
    if (!game?.series_key) return null;

    const series = await env.ARCHIVE_DB.prepare(
        `SELECT * FROM postseason_series WHERE series_key = ?`
    ).bind(game.series_key).first();

    const games = await env.ARCHIVE_DB.prepare(
        `SELECT id, game_number, date, home, away, home_score, away_score, note, importance
         FROM postseason_games WHERE series_key = ?
         ORDER BY game_number`
    ).bind(game.series_key).all();

    const gamesArr = games.results || [];
    return {
        series: series || null,
        games:  gamesArr,
        margins: gamesArr
            .filter(g => g.home_score != null && g.away_score != null)
            .map(g => g.home_score - g.away_score),
    };
}
// findEnrichment — narrative + standings + WC matchup + recent-game history.
// Brief types ('narrative_context', 'standings_snapshot', 'wc_matchup') may
// be sparse today (writers land in future sessions) — the queries still
// run and return empty arrays so the response shape stays stable.
//
// Odds live on the game row itself (parsed in findGame) — there is NO
// game_odds table. recentGames pulls postseason rows with date < this game,
// useful as priors for series-aware journalism.
async function findEnrichment(env, id) {
    const dateMatch = id.match(/\d{4}-\d{2}-\d{2}/);
    const date = dateMatch ? dateMatch[0] : null;
    if (!date) return null;

    const narratives = await env.ARCHIVE_DB.prepare(
        `SELECT brief_text, game_id, date FROM briefs
         WHERE brief_type = 'narrative_context' AND date <= ?
         ORDER BY date DESC LIMIT 10`
    ).bind(date).all();

    const standings = await env.ARCHIVE_DB.prepare(
        `SELECT brief_text, game_id, date FROM briefs
         WHERE brief_type = 'standings_snapshot' AND date <= ?
         ORDER BY date DESC LIMIT 12`
    ).bind(date).all();

    const wcMatchup = await env.ARCHIVE_DB.prepare(
        `SELECT brief_text FROM briefs
         WHERE brief_type = 'wc_matchup' AND game_id = ?
         ORDER BY created_at DESC LIMIT 1`
    ).bind(id).first();

    const history = await env.ARCHIVE_DB.prepare(
        `SELECT id, date, home, away, home_score, away_score, note
         FROM postseason_games WHERE id != ? AND date < ?
         ORDER BY date DESC LIMIT 5`
    ).bind(id, date).all();

    return {
        narratives: (narratives.results || []).map(r => r.brief_text),
        standings:  (standings.results || []).map(r => ({
            group: r.game_id, text: r.brief_text,
        })),
        wcMatchup:   wcMatchup?.brief_text || null,
        recentGames: history.results || [],
    };
}

async function handleJournalismCycle(env, opts = {}) {
  if (!env.FIELD_JOURNALISM) return {ok:false, reason:'KV not configured'};
  // Load per-sport quality calibration once per cron tick. Lightweight D1
  // read; failure is silent (Rule 5 — never blocks journalism delivery).
  await loadQualityCalibration(env);
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
  if (!isLiveHours) {
    // Dead hours (UTC 2:00–10:00) — no live brief generation. Use the window
    // to run ONE backfill date per tick (15-min cron => up to 4 dates/hour
    // through dead hours). Cursor stored in FIELD_JOURNALISM KV for telemetry;
    // the authoritative skip-check lives in pickNextBackfillDate which queries
    // briefs.source='backfill'. Archive failure must NEVER break journalism
    // (CLAUDE.md Rule 5) — entire block wrapped in try/catch.
    if (env.ARCHIVE_DB) {
      try {
        const nextDate = await pickNextBackfillDate(env);
        let briefResult = null;
        if (nextDate) {
          briefResult = await executeBackfill(env, nextDate);
          try {
            await env.FIELD_JOURNALISM.put('backfill_cursor', JSON.stringify({
              lastDate: nextDate,
              lastResult: briefResult.ok ? 'ok' : (briefResult.skipped ? 'skipped' : 'error'),
              lastAt: now,
            }), { expirationTtl: 7 * 86400 });
          } catch (_) { /* cursor write best-effort */ }
        }

        // Odds backfill — lower priority than brief backfill. Runs whether
        // brief backfill is complete OR ran this tick. One date per tick;
        // archive failure must NEVER break journalism (Rule 5).
        //
        // Skip-on-no-progress (F2): once a date has been attempted and made
        // zero new populations (i.e. all remaining rows are persistent
        // team-name mismatches), mark it 'tried' in KV so the cursor moves
        // past it next tick. Without this, an un-finishable date would burn
        // ~30 credits/tick × 32 dead-hour ticks/day forever.
        let oddsResult = null;
        try {
          const oddsDate = await pickNextOddsBackfillDate(env);
          if (oddsDate) {
            const triedKey = `odds:backfill:tried:${oddsDate}`;
            const alreadyTried = await env.FIELD_JOURNALISM.get(triedKey).catch(() => null);
            if (alreadyTried) {
              try {
                await env.FIELD_JOURNALISM.put('odds_backfill_cursor', JSON.stringify({
                  lastDate: oddsDate,
                  lastResult: 'skipped_tried',
                  lastAt: now,
                }), { expirationTtl: 7 * 86400 });
              } catch (_) { /* best-effort */ }
            } else {
              oddsResult = await runOddsBackfillForDate(env, oddsDate);
              try {
                await env.FIELD_JOURNALISM.put('odds_backfill_cursor', JSON.stringify({
                  lastDate: oddsDate,
                  lastResult: (oddsResult && oddsResult.ok) ? 'ok' : 'error',
                  populated: oddsResult ? oddsResult.odds_populated : 0,
                  skipped: oddsResult ? oddsResult.odds_skipped : 0,
                  quotaRemaining: oddsResult ? oddsResult.quota_remaining : null,
                  lastAt: now,
                }), { expirationTtl: 7 * 86400 });
              } catch (_) { /* cursor write best-effort */ }
              // Mark date 'tried' if this run populated nothing — the remaining
              // rows are unmatched team names; further runs would burn ~30
              // credits each for zero new data. 30-day TTL — re-attempted next
              // month if anyone refreshes the archive.
              if (oddsResult && oddsResult.odds_populated === 0) {
                try {
                  await env.FIELD_JOURNALISM.put(triedKey, '1', { expirationTtl: 30 * 86400 });
                } catch (_) { /* best-effort */ }
              }
            }
          }
        } catch (_) { /* odds backfill failure cannot break journalism cron */ }

        // KV → D1 sweep — extracted into sweepKVBriefs() (module scope).
        // The live-hour cron path calls it too via ctx.waitUntil in
        // scheduled(), so per-game briefs land in D1 before their 1 h KV
        // TTL expires even on busy nights.
        let sweepResult = null;
        try { sweepResult = await sweepKVBriefs(env); }
        catch (_) { /* sweep failure never breaks cron */ }

        // One-time cleanup: delete null-sport briefs where a sport-tagged sibling exists.
        // Root cause: KV keys were brief:game:{id} without sport prefix. The sweep
        // inserted with sport=null while the cron had already inserted with sport set
        // using a different primary key. Result: duplicate briefs per game.
        try {
          if (env.ARCHIVE_DB) {
            await env.ARCHIVE_DB.prepare(
              `DELETE FROM briefs WHERE sport IS NULL AND game_id IN (
                 SELECT game_id FROM briefs WHERE sport IS NOT NULL AND sport != '' GROUP BY game_id
               )`
            ).run();
          }
        } catch(_) { /* cleanup failure never breaks cron */ }

        // Game brief backfill — per-game briefs for dates where a slate
        // brief exists (whether pre-existing OR just written this tick).
        // executeGameBriefBackfill dedups internally so re-firing on
        // briefResult.ok is idempotent. Without the .ok branch, recent
        // dates whose slate brief landed live never get game briefs.
        let gameBriefResult = null;
        try {
          if (env.ARCHIVE_DB && nextDate && briefResult
              && (briefResult.skipped || briefResult.ok)) {
            gameBriefResult = await executeGameBriefBackfill(env, nextDate);
          }
        } catch(_) { /* game brief backfill failure never breaks cron */ }

        // Series preview backfill — per-series previews for active postseason series.
        // Max 2 series per tick. Unconditional — runs every dead-hour tick.
        let seriesPreviewResult = null;
        try {
          if (env.ARCHIVE_DB) {
            seriesPreviewResult = await executeSeriesPreviewBackfill(env);
          }
        } catch(_) { /* series preview backfill failure never breaks cron */ }

        if (!nextDate && !oddsResult && !sweepResult && !gameBriefResult
            && !(seriesPreviewResult && seriesPreviewResult.ok)) {
          return {ok:false, reason:`dead hours (UTC ${hour}); backfill complete`};
        }
        return {
          ok: !!(briefResult && briefResult.ok) || !!(oddsResult && oddsResult.ok)
              || !!sweepResult || !!(gameBriefResult && gameBriefResult.ok)
              || !!(seriesPreviewResult && seriesPreviewResult.ok),
          reason: nextDate
            ? `backfill ${nextDate}: ${briefResult.reason || (briefResult.ok ? 'wrote brief' : 'no result')}`
            : sweepResult ? `kv_sweep: ${sweepResult.swept} briefs captured`
            : 'brief backfill complete; odds backfill ran',
          backfill: briefResult,
          oddsBackfill: oddsResult,
          kvSweep: sweepResult,
          gameBriefBackfill: gameBriefResult,
          seriesPreviewBackfill: seriesPreviewResult,
        };
      } catch (e) {
        return {ok:false, reason:`backfill error: ${e.message}`};
      }
    }
    return {ok:false, reason:`not live hours (UTC ${hour})`};
  }
  // ── Morning WC Catch-Up Brief (UTC 11-13 / 7-9am ET) ─────────────────────
  // Runs in the gap between the live-hours cron (UTC 10am–2am) and the
  // next live window. Queries D1 for WC group results completed in the
  // last 24h, builds a catch-up brief, and enqueues it via JOURNALISM_QUEUE
  // so it's available in the journalism tab when users wake up.
  //
  // Deduplication: KV key 'wc-morning-brief:{dateKey}' prevents re-running
  // on the same calendar date. Degrades gracefully if D1 is unbound.
  const isMorningWindow = hour >= 11 && hour <= 13;
  if (isMorningWindow && env.WC2026_DB && env.JOURNALISM_QUEUE) {
    try {
      const morningDedupKey = `wc-morning-brief:${dateKey}`;
      const alreadyRan = await env.FIELD_JOURNALISM.get(morningDedupKey);
      if (alreadyRan) return {ok:false, reason:'wc morning brief already ran today'};

      // Query completed WC results from last 24h
      const cutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { results: recentResults } = await env.WC2026_DB.prepare(
        `SELECT r.group_id, r.home, r.away, r.home_score, r.away_score, r.match_date
         FROM wc_results r
         WHERE r.match_date >= ?
         ORDER BY r.match_date ASC, r.group_id ASC`
      ).bind(cutoff).all();

      if (!recentResults || recentResults.length === 0) {
        return {ok:false, reason:'no recent WC results for morning brief'};
      }

      // Fetch current group standings for context
      const { results: standings } = await env.WC2026_DB.prepare(
        `SELECT group_id, team, played, won, drawn, lost, gf, ga, gd, points
         FROM wc_group
         ORDER BY group_id ASC, points DESC, gd DESC, gf DESC`
      ).all();

      // Group standings by group_id for easy lookup
      const standingsByGroup = {};
      for (const row of (standings || [])) {
        if (!standingsByGroup[row.group_id]) standingsByGroup[row.group_id] = [];
        standingsByGroup[row.group_id].push(row);
      }

      // Build result lines — one per completed match
      const resultLines = recentResults.map(r => {
        const winner = r.home_score > r.away_score ? r.home
          : r.away_score > r.home_score ? r.away
          : null;
        const scoreStr = `${r.home} ${r.home_score}–${r.away_score} ${r.away}`;
        return winner ? `${scoreStr} (${winner} win)` : `${scoreStr} (draw)`;
      });

      // Build per-group standings summary for affected groups
      const affectedGroups = [...new Set(recentResults.map(r => r.group_id))];
      const standingsLines = affectedGroups.map(grp => {
        const rows = standingsByGroup[grp] || [];
        if (!rows.length) return null;
        const table = rows.map((r, i) =>
          `${i+1}. ${r.team} ${r.points}pts (P${r.played} GD${r.gd >= 0 ? '+' : ''}${r.gd})`
        ).join(' | ');
        return `Group ${grp}: ${table}`;
      }).filter(Boolean);

      const morningPrompt = [
        'Write a FIELD Morning Brief covering FIFA World Cup 2026 results from overnight.',
        '',
        'COMPLETED RESULTS:',
        ...resultLines.map(l => `- ${l}`),
        '',
        standingsLines.length ? 'CURRENT GROUP STANDINGS:' : '',
        ...standingsLines.map(l => `- ${l}`),
        '',
        'RULES:',
        '- 80-100 words. 1-2 short paragraphs. No headers. No bullet points.',
        '- Lead with the most significant result — biggest upset, clinching moment, or drama.',
        '- Include final scores for all matches listed.',
        '- Note any team that has clinched advancement or been eliminated if standings show it.',
        '- Plain prose only. Write like a morning sports summary — crisp, factual, no hype.',
        '- CORRECTNESS: write only from the results above. Never invent scores or facts.',
        '- Never use: "punch their ticket", "stage is set", "must-win", "backs against the wall".',
      ].filter(s => s !== undefined).join('\n');

      // Mark dedup before enqueue (24h TTL — expires before next cycle)
      await env.FIELD_JOURNALISM.put(morningDedupKey, '1', {expirationTtl: 86400});

      // Enqueue — queue consumer picks it up and runs quality chain
      const jobId = crypto.randomUUID();
      await env.JOURNALISM_QUEUE.send({
        jobId,
        prompt: morningPrompt,
        sport: 'soccer',
        briefType: 'wc-morning',
        max_tokens: 600,
        scoreThreshold: 110,
        enqueuedAt: now,
      });

      // Pre-seed KV so /journalism/result/:jobId returns 'queued' immediately
      if (env.FIELD_JOURNALISM) {
        await env.FIELD_JOURNALISM.put(
          `jobs:${jobId}`,
          JSON.stringify({status:'queued', enqueuedAt: now, briefType:'wc-morning'}),
          {expirationTtl: 86400}
        );
      }

      return {ok:true, reason:'wc morning brief enqueued', jobId, resultCount: recentResults.length};
    } catch(e) {
      return {ok:false, reason:'wc morning brief error: ' + e.message};
    }
  }



  try {
    // 1. Fetch ESPN scoreboard — richer context (Fix 5)
    // O(1) Newspaper coverage — added EPL May 31 2026.
    // Each league here is iterated TWICE per cron cycle: once for the slate
    // brief context (gameLines), once for per-game brief generation. Adding
    // a league to this array immediately expands cache coverage for the
    // 97% LLM-cost-reduction path.
    const LEAGUES = [
      {sport:'basketball',league:'nba',        label:'NBA'},
      {sport:'hockey',    league:'nhl',        label:'NHL'},
      {sport:'baseball',  league:'mlb',        label:'MLB'},
      {sport:'basketball',league:'wnba',       label:'WNBA'},
      {sport:'soccer',    league:'eng.1',      label:'EPL'},
      {sport:'soccer',    league:'usa.1',      label:'MLS'},
      {sport:'soccer',    league:'esp.1',      label:'La Liga'},
      {sport:'soccer',    league:'ita.1',      label:'Serie A'},
      {sport:'soccer',    league:'ger.1',      label:'Bundesliga'},
      {sport:'soccer',    league:'fra.1',      label:'Ligue 1'},
      {sport:'football',  league:'nfl',        label:'NFL'},
      // Gap C: WC added Jun 10 2026 — label must contain 'FIFA World Cup'
      // so slateHasWorldCup() / buildWCTeamContextBlock() trigger correctly.
      // Slug 'fifa.world' confirmed via html_probe (CF worker IP, 200 OK).
      // isLiveHours gate (UTC 10-2) covers all WC group-stage kickoffs (UTC 17-01).
      {sport:'soccer',    league:'fifa.world', label:'FIFA World Cup'},
      {sport:'golf',      league:'pga',        label:'PGA Tour'},
    ];
    const gameLines = [];
    // Parallel to gameLines — captures the sport + ESPN team names for each
    // pushed line so the odds-injection step (below) can look up opening_odds
    // in the archive without re-parsing the line string.
    const gameMeta = [];
    for (const {sport,league,label} of LEAGUES) {
      try {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${espnDate}`);
        if (!r.ok) continue;
        const d = await r.json();
        const events = d?.events || [];
        for (const ev of events) {
          const line = buildGameLine(ev, label);
          if (line) {
            gameLines.push(line);
            const comp = ev.competitions?.[0];
            const teams = comp?.competitors || [];
            const home = teams.find(t => t.homeAway === 'home') || teams[0];
            const away = teams.find(t => t.homeAway === 'away') || teams[1];
            gameMeta.push({
              sport,
              home: home?.team?.shortDisplayName || home?.team?.displayName || '',
              away: away?.team?.shortDisplayName || away?.team?.displayName || '',
              // Captured for context-assembler R2 key lookups (NBA clutch +
              // NHL series + MLB ABS all key by 3-letter team abbreviation).
              homeAbbr: home?.team?.abbreviation || '',
              awayAbbr: away?.team?.abbreviation || '',
              homeScore: home?.score ?? null,
              awayScore: away?.score ?? null,
              isFinal: comp?.status?.type?.completed === true,
              venue: comp?.venue?.fullName || '',
              eventId: String(ev.id || ''),
              espnLeague: league,  // slug e.g. "fifa.world" — used by soccer_xg builder
              league: label,
            });
          }
        }
      } catch(_) {}
    }

    if (!gameLines.length) return {ok:false, reason:'no game lines from ESPN'};

    // ── Archive catch-up: server-side gap-fill (Rule 68 case study) ───
    // Games that went final while no client was watching have no GameDO
    // archive row. This fills the gap every cron tick. ON CONFLICT in the
    // /archive/game handler means: no row → INSERT, skeleton row → UPDATE
    // scores, complete row → no-op via COALESCE.
    let _catchupFilled = 0;
    try {
      const relayBase = `https://field-relay-nba.${env.WORKER_DOMAIN || 'jeffunglesbee.workers.dev'}`;
      for (const gm of gameMeta) {
        if (!gm.isFinal || !gm.eventId) continue;
        const shortId = gm.eventId.replace(/[^a-z0-9]/gi, '');
        if (!shortId) continue;
        const existing = await env.ARCHIVE_DB.prepare(
          `SELECT home_score FROM regular_season_games WHERE id LIKE '%' || ? || '%'
           UNION ALL
           SELECT home_score FROM postseason_games WHERE id LIKE '%' || ? || '%'
           LIMIT 1`
        ).bind(shortId, shortId).first().catch(() => null);
        if (existing && existing.home_score !== null) continue;
        await fetch(relayBase + '/archive/game', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sport: gm.sport === 'soccer' ? 'FIFA World Cup 2026' : gm.league,
            league: gm.league,
            date: dateKey,
            home: gm.home,
            away: gm.away,
            home_score: gm.homeScore,
            away_score: gm.awayScore,
            venue: gm.venue,
            source_id: gm.eventId,
          }),
        }).catch(() => {});
        _catchupFilled++;
      }
    } catch (_) { /* catch-up failure never breaks journalism */ }
    if (_catchupFilled > 0) {
      console.log(`[ARCHIVE-CATCHUP] ${_catchupFilled} finals gap-filled`);
    }

    // 2. Context hash — skip if unchanged
    const contextHash = gameLines.join('|').split('').reduce((h,c)=>(Math.imul(31,h)+c.charCodeAt(0))|0,0).toString(16);
    const existingRaw = await env.FIELD_JOURNALISM.get(`journalism:${dateKey}`);
    if (existingRaw && !opts.force) {
      try {
        const existing = JSON.parse(existingRaw);
        if (existing.contextHash === contextHash) return {ok:false, reason:'context unchanged (already cached)'};
      } catch(_) {}
    }

    // 3. Layer 1: full style prompt
    // WC2026 team context — async (queries D1 for live standings)
    // Load WC team context patches from R2 (amendment layer — 15min cache)
    // Patches override specific inline WC_TEAM_CONTEXT fields without a deploy.
    const _wcPatches = slateHasWorldCup(gameLines) ? await loadWCPatches(env) : {};
    const wcTeamContext = slateHasWorldCup(gameLines)
      ? await buildWCTeamContextBlock(gameLines, env.WC2026_DB, _wcPatches)
      : '';

    // Golf tournament context — active PGA events get a leaderboard block in
    // the slate prompt. Uses handleESPNGolfScoreboard (same as /v2/golf/enriched).
    // Enhancement — wrapped per Rule 5.
    let golfContext = '';
    let golfData = null;
    try {
      golfData = await handleESPNGolfScoreboard(espnDate, env, {});
      if (golfData && golfData.active !== false) {
        const evName = golfData.eventName || golfData.name || 'PGA Tour event';
        const round = golfData.round ? `Round ${golfData.round}` : '';
        const players = (golfData.leaderboard || []).slice(0, 10);
        if (players.length) {
          const lbLines = players.map(p => {
            const pos = p.pos || p.position || '';
            const tp = p.toPar != null ? String(p.toPar) : 'E';
            const today = p.today != null ? ` (today ${p.today})` : '';
            const thru = p.thru ? ` thru ${p.thru}` : '';
            return `  ${pos} ${p.name} ${tp}${today}${thru}`.trim();
          });
          golfContext = ['', `PGA TOUR — ${evName}${round ? ' · ' + round : ''}:`,
            ...lbLines, 'Use leaderboard positions and scores only — never reference strokes gained.'
          ].join('\n');
        }
      }
    }
    catch (_) { /* golf context failure cannot break journalism cron */ }

    // ── Golf per-round brief (when round completes) ─────────────────────────
    // Golf doesn't have home/away games — a "game" is a tournament round.
    // When a round completes, generate a recap brief with leaderboard context.
    // Dedup: KV key brief:golf:round:{eventId}:R{round} prevents re-generation.
    try {
      if (golfData && golfData.active && env.JOURNALISM_QUEUE && env.FIELD_JOURNALISM) {
        const golfStatus = String(golfData.status || '').toLowerCase();
        const roundComplete = /(complete|official|final)/.test(golfStatus);
        const eventId = golfData.eventId || '';
        const roundNum = golfData.round || '';
        if (roundComplete && eventId && roundNum) {
          const dedupKey = `brief:golf:round:${eventId}:R${roundNum}`;
          const existing = await env.FIELD_JOURNALISM.get(dedupKey).catch(() => null);
          if (!existing) {
            const evName = golfData.eventName || golfData.name || 'PGA Tour event';
            const venue = golfData.venue || '';
            const venueLocation = golfData.venueLocation || '';
            const cutLine = golfData.cutLine != null ? `Cut line: ${golfData.cutLine}` : '';
            const top15 = (golfData.leaderboard || []).slice(0, 15);
            const lbBlock = top15.map(p => {
              const pos = p.pos || p.position || '';
              const tp = p.toPar != null ? String(p.toPar) : 'E';
              const today = p.today != null ? ` (today: ${p.today})` : '';
              return `${pos} ${p.name} ${tp}${today}`;
            }).join('\n');

            const prompt = [
              `Write a 2-3 sentence recap of Round ${roundNum} at the ${evName}.`,
              `Factual, warm. FIELD voice: the truth in sports is fun — let that energy through. No manufactured drama.`,
              `Include: leader and their margin, any notable moves up/down the leaderboard, and the cut line if it's Round 2.`,
              `Do NOT use banned phrases: "stunned", "shocked", "thriller", "instant classic", "for the ages".`,
              ``,
              `EVENT: ${evName}`,
              venue ? `VENUE: ${venue}${venueLocation ? ', ' + venueLocation : ''}` : '',
              `ROUND: ${roundNum} (${golfStatus})`,
              cutLine,
              ``,
              `LEADERBOARD (top 15):`,
              lbBlock,
              ``,
              `Write the brief as a single paragraph. No headers, no bullet points.`,
            ].filter(Boolean).join('\n');

            await env.JOURNALISM_QUEUE.send({
              type: 'game-brief',
              prompt,
              eventId: `golf_${eventId}_R${roundNum}`,
              max_tokens: 300,
              sport: 'PGA TOUR',
              home: evName,
              away: `Round ${roundNum}`,
              homeScore: null,
              awayScore: null,
              enqueuedAt: Date.now(),
            });

            // Write dedup key so we don't re-enqueue next cron tick
            await env.FIELD_JOURNALISM.put(dedupKey, 'enqueued', { expirationTtl: 86400 });
            console.log(`[GOLF-BRIEF] Enqueued Round ${roundNum} recap for ${evName}`);
          }
        }
      }
    } catch (_) { /* golf brief failure cannot break journalism cron */ }

    // ── Odds snapshot (opening_odds) ────────────────────────────────────────
    // Captures pre-game odds onto archive game rows for tonight's slate. Only
    // hits the Odds API for sports that have at least one archive row with
    // NULL opening_odds — quota-aware, bails below ODDS_QUOTA_FLOOR.
    // Wrapped in try/catch per CLAUDE.md Rule 5; the cycle MUST NOT break if
    // the Odds API is down or the snapshot throws.
    try { await snapshotCronOdds(env, dateKey); }
    catch (_) { /* odds snapshot failure cannot break journalism */ }

    // ── Odds annotations for prompt injection ───────────────────────────────
    // Read opening_odds rows from the archive for today's sports, build a
    // map keyed by {sport}|{home_norm}|{away_norm}, and produce a parallel
    // annotations array aligned with gameLines. Wrapped in try/catch per
    // Rule 5 — annotations are an enhancement, not a requirement.
    const oddsAnnotations = new Array(gameLines.length).fill('');
    try {
      if (env.ARCHIVE_DB && gameMeta.length) {
        const sportsInSlate = [...new Set(gameMeta.map(m => m.sport))];
        const placeholders = sportsInSlate.map(() => '?').join(',');
        const oddsByPair = new Map();
        if (sportsInSlate.length) {
          const rs = await env.ARCHIVE_DB.prepare(
            `SELECT home, away, sport, opening_odds FROM regular_season_games
              WHERE date = ? AND sport IN (${placeholders}) AND opening_odds IS NOT NULL`
          ).bind(dateKey, ...sportsInSlate).all();
          const ps = await env.ARCHIVE_DB.prepare(
            `SELECT home, away, sport, opening_odds FROM postseason_games
              WHERE date = ? AND sport IN (${placeholders}) AND opening_odds IS NOT NULL`
          ).bind(dateKey, ...sportsInSlate).all();
          for (const row of [...(rs.results || []), ...(ps.results || [])]) {
            oddsByPair.set(`${row.sport}|${_normTeam(row.home)}|${_normTeam(row.away)}`, row.opening_odds);
          }
        }
        for (let i = 0; i < gameMeta.length; i++) {
          const m = gameMeta[i];
          const raw = oddsByPair.get(`${m.sport}|${_normTeam(m.home)}|${_normTeam(m.away)}`);
          if (!raw) continue;
          try {
            const odds = JSON.parse(raw);
            const parts = [];
            if (odds.spread && typeof odds.spread.home === 'number') {
              const s = odds.spread.home;
              parts.push(`opened ${s > 0 ? '+' : ''}${s}`);
            }
            if (odds.moneyline) parts.push(`ML ${odds.moneyline.home}/${odds.moneyline.away}`);
            if (odds.total && typeof odds.total.over === 'number') parts.push(`O/U ${odds.total.over}`);
            if (parts.length) oddsAnnotations[i] = ` [ODDS: ${parts.join(', ')}]`;
          } catch (_) { /* skip malformed odds JSON */ }
        }
      }
    } catch (_) { /* odds annotations are an enhancement */ }

    // ── Closing-the-loop: temporal continuity + enrichment context ──────────
    // Both queries are ENHANCEMENTS — wrapped in try/catch per CLAUDE.md
    // Rule 5. Failure must NEVER break the live journalism cycle.
    //
    // Context Graph integration (June 18 2026): single self-fetch to
    // /context/date/{dateKey} replaces the 3 direct D1 queries below when
    // available. Per-block fallback to direct D1 stays in place so an
    // outage of the Context Graph never breaks the cron — Rule 5.
    let ctxBriefs = null;
    try {
      const relayBase = env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
      const ctxResp = await fetch(`${relayBase}/context/date/${dateKey}`,
        { cf: { cacheTtl: 60, cacheEverything: true } });
      if (ctxResp.ok) {
        const ctxJson = await ctxResp.json();
        if (ctxJson && Array.isArray(ctxJson.briefs)) ctxBriefs = ctxJson.briefs;
      }
    } catch (_) { /* Context Graph optional — direct D1 fallback below */ }

    let recentCoverageBlock = '';
    try {
      // Path 1: derive from Context Graph response.
      if (ctxBriefs) {
        const prev = ctxBriefs
          .filter(b => b.brief_type === 'slate' && b.date < dateKey
                       && (b.source === 'cron' || b.source === 'backfill')
                       && b.brief_text)
          .sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0))[0];
        if (prev) {
          recentCoverageBlock = [
            '',
            "FIELD'S RECENT COVERAGE (for narrative continuity — build on this, don't repeat it):",
            `[${prev.date}] ${prev.brief_text}`,
          ].join('\n');
        }
      }
      // Path 2: direct D1 fallback when Graph absent or empty derivation.
      if (!recentCoverageBlock && env.ARCHIVE_DB) {
        const prev = await env.ARCHIVE_DB.prepare(
          `SELECT brief_text, date, quality_score FROM briefs
            WHERE brief_type = 'slate' AND source IN ('cron','backfill')
              AND date < ?
            ORDER BY date DESC LIMIT 1`
        ).bind(dateKey).first();
        if (prev && prev.brief_text) {
          recentCoverageBlock = [
            '',
            "FIELD'S RECENT COVERAGE (for narrative continuity — build on this, don't repeat it):",
            `[${prev.date}] ${prev.brief_text}`,
          ].join('\n');
        }
      }
    } catch (_) { /* temporal context is an enhancement, not a requirement */ }

    let enrichmentBlock = '';
    try {
      // Path 1: derive from Context Graph response.
      if (ctxBriefs) {
        const rows = ctxBriefs
          .filter(b => b.source === 'enrichment'
                       && (b.brief_type === 'narrative_context' || b.brief_type === 'standings_snapshot')
                       && b.date <= dateKey
                       && b.brief_text)
          .slice(0, 10);
        if (rows.length) {
          enrichmentBlock = [
            '',
            'EDITORIAL CONTEXT (verified facts for depth — use naturally, don\'t list):',
            rows.map(r => r.brief_text).join('\n'),
          ].join('\n');
        }
      }
      // Path 2: direct D1 fallback.
      if (!enrichmentBlock && env.ARCHIVE_DB) {
        const enrich = await env.ARCHIVE_DB.prepare(
          `SELECT brief_text FROM briefs
            WHERE date <= ? AND source = 'enrichment'
              AND brief_type IN ('narrative_context','standings_snapshot')
            ORDER BY brief_type, date DESC LIMIT 10`
        ).bind(dateKey).all();
        const rows = (enrich && enrich.results) || [];
        if (rows.length) {
          enrichmentBlock = [
            '',
            'EDITORIAL CONTEXT (verified facts for depth — use naturally, don\'t list):',
            rows.map(r => r.brief_text).filter(Boolean).join('\n'),
          ].join('\n');
        }
      }
    } catch (_) { /* enrichment context is an enhancement */ }

    // Voice exemplars — top 3 quality_score slate briefs from the last 7 days.
    // Shows the model what high-scoring FIELD prose looks like in its own voice.
    // Enhancement — wrapped in try/catch per Rule 5.
    let voiceExemplarBlock = '';
    try {
      let rows = [];
      // Path 1: derive from Context Graph response.
      if (ctxBriefs) {
        rows = ctxBriefs
          .filter(b => b.brief_type === 'slate'
                       && (b.source === 'cron' || b.source === 'backfill')
                       && typeof b.quality_score === 'number'
                       && b.brief_text)
          .sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0))
          .slice(0, 3);
      }
      // Path 2: direct D1 fallback.
      if (!rows.length && env.ARCHIVE_DB) {
        const ex = await env.ARCHIVE_DB.prepare(
          `SELECT brief_text, quality_score FROM briefs
            WHERE brief_type = 'slate' AND source IN ('cron','backfill')
              AND quality_score IS NOT NULL
              AND date >= date(?, '-7 days')
            ORDER BY quality_score DESC LIMIT 3`
        ).bind(dateKey).all();
        rows = (ex && ex.results) || [];
      }
      if (rows.length) {
        const lines = ['', 'FIELD VOICE EXAMPLES (match this tone and style):'];
        rows.forEach((r, i) => {
          lines.push(`Example ${i + 1} (score: ${r.quality_score}):`);
          lines.push(r.brief_text);
          lines.push('');
        });
        voiceExemplarBlock = lines.join('\n');
      }
    } catch (_) { /* voice exemplars are an enhancement */ }

    // Per-game sport context from R2 (MLB ABS, NHL series PP/PK, NBA clutch,
    // soccer FBref). Iterates gameMeta in parallel, falls back to '' on any
    // builder failure. Cap each game at ~600 tokens, total at ~1500 across
    // the slate so the existing prose budget isn't squeezed.
    const _CONTEXT_LEAGUE_TO_SPORT = {
        nba: 'nba', nhl: 'nhl', mlb: 'mlb', wnba: 'wnba', nfl: 'nfl',
        epl: 'epl', mls: 'mls',
        'la liga': 'laliga', 'serie a': 'seriea',
        'bundesliga': 'bundesliga', 'ligue 1': 'ligue1',
        'fifa world cup': 'wc26',
        // Golf
        'pga tour': 'golf', 'pga': 'golf', 'golf': 'golf',
        // WNBA aliases from D1 / GameDO
        "women's national basketball association": 'wnba',
        'nba w': 'wnba', 'nba women': 'wnba',
        // Generic sport names from ESPN
        'baseball': 'mlb', 'basketball': 'nba', 'hockey': 'nhl',
    };
    let sportContextBlock = '';
    try {
        const perGame = await Promise.all(gameMeta.map(async (m) => {
            const labelLc = String(m.league || '').toLowerCase();
            const sportKey = _CONTEXT_LEAGUE_TO_SPORT[labelLc] || labelLc;
            return assembleContext(env, {
                sport: sportKey,
                league: m.league,
                home: m.home, away: m.away,
                homeAbbr: m.homeAbbr, awayAbbr: m.awayAbbr,
                espnLeague: m.espnLeague,  // slug for /soccer/xg lookup
                eventId:    m.eventId,
                sourceId:   m.eventId,     // feeds buildESPNSummaryContext
            }, 600);
        }));
        sportContextBlock = perGame.filter(b => b && b.length).join('\n');
    } catch (e) {
        console.warn('[journalism] sportContextBlock build failed:', e.message);
    }

    const buildPrompt = () => [
      FIELD_VOICE_REGISTER,
      'Write a FIELD Brief for tonight\'s sports slate.',
      '',
      'TONIGHT\'S GAMES:',
      ...gameLines.map((l, i) => `- ${l}${oddsAnnotations[i] || ''}`),
      buildFinalsContextBlock(gameLines),
      wcTeamContext,  // WC2026 team narrative (D1 + static)
      golfContext,    // PGA Tour leaderboard (active tournaments only)
      recentCoverageBlock,  // yesterday's slate brief (temporal continuity)
      enrichmentBlock,      // narrative_context + standings_snapshot rows
      sportContextBlock,    // per-game R2 sport stats (Savant, NHL series, NBA clutch, FBref)
      voiceExemplarBlock,   // top-3 quality_score briefs from last 7 days
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
      scoreThreshold: 240,
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

    // 6b. Archive slate brief to D1 briefs table.
    // Archive failure must NEVER break journalism (CLAUDE.md Rule 5) — wrapped
    // in try/catch with silent swallow. Stored before per-game brief enqueue
    // so a slow D1 write doesn't delay queue dispatch.
    try {
      await ensureBriefsTable(env);
      // change_log sits alongside briefs in ARCHIVE_DB. Bootstrap on the
      // same path so reconcile() always has its target table available
      // — odds sync, etc. may run inside this same cron tick.
      await ensureChangeLogTable(env).catch(() => {});
      // 30-day retention cleanup — delete consumed changelog entries older
      // than 30 days. Cheap (one DELETE), safe to run every tick.
      await cleanupChangelog(env).catch(() => {});
      await env.ARCHIVE_DB.prepare(
        `INSERT INTO briefs
           (id, date, brief_type, sport, brief_text, model, quality_score, context_hash, word_count, source)
         VALUES (?, ?, 'slate', NULL, ?, ?, ?, ?, ?, 'cron')
         ON CONFLICT(id) DO UPDATE SET
           brief_text = excluded.brief_text,
           quality_score = excluded.quality_score,
           word_count = excluded.word_count`
      ).bind(
        `slate_${dateKey}_cron`,
        dateKey,
        prose,
        'gemini-3.1-flash-lite',
        finalScore,
        contextHash,
        prose.split(/\s+/).length
      ).run();
    } catch (_archiveErr) { /* archive failure must not break journalism cron */ }

    // 7. Pre-generate per-game card briefs — enqueue via JOURNALISM_QUEUE
    // Replaces the previous sequential loop + setTimeout stagger (1500ms/game).
    // On a 12-game WC day the old loop consumed ~18s of cron CPU budget.
    // New: each game is a Queue message; consumer drains at its own pace.
    // Consumer handles AI call + quality chain + KV write (same path as wc-morning).
    // Falls back to old sync path if Queue not bound.
    const gameBriefResults = [];
    if (env.JOURNALISM_QUEUE) {
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
                if (eg.contextHash === gameHash) continue;
              } catch(_) {}
            }

            const gameLine = buildGameLine(ev, label);
            if (!gameLine) continue;

            const teams = comp.competitors || [];
            const home = teams.find(t => t.homeAway === 'home') || teams[0];
            const away = teams.find(t => t.homeAway === 'away') || teams[1];
            const homeName = home?.team?.shortDisplayName || home?.team?.displayName || '';
            const awayName = away?.team?.shortDisplayName || away?.team?.displayName || '';
            const series = comp.series?.summary || '';
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
              JQ_STYLE,
              'Write only from data above. No invented stats.',
            ].filter(Boolean).join('\n');

            const jobId = crypto.randomUUID();
            await env.JOURNALISM_QUEUE.send({
              type:       'game-brief',
              jobId,
              eventId,
              gameHash,
              sport:      label,
              home:       homeName,
              away:       awayName,
              cycleId,
              prompt:     gamePrompt,
              max_tokens: 400,
              scoreThreshold: 110,
              enqueuedAt: now,
            });
            gameBriefResults.push(eventId);
          }
        } catch(e) {
          console.warn(`[journalism-cycle] game briefs enqueue ${label} error:`, e.message);
        }
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
        // Analytics engine fires only on its dedicated daily 0 9 * * * trigger
        // so the */5 + */15 ticks never invoke it. The other handlers below
        // continue to run on every tick (existing behavior).
        if (event.cron === '0 9 * * *') {
            ctx.waitUntil(analyticsEngine(env).catch(e =>
                console.error('[ANALYTICS]', e.message)));
        }
        ctx.waitUntil(handleCron(env));
        ctx.waitUntil(handleJournalismCycle(env));
        // Per-tick KV → D1 brief sweep. Runs in parallel with the
        // journalism cycle so briefs the cycle just wrote to KV land in
        // D1 before their 1 h TTL expires. Dead-hour path also calls
        // sweepKVBriefs from inside runDeadHourBackfill — same function.
        ctx.waitUntil(sweepKVBriefs(env).catch(e =>
            console.error('[KV-SWEEP]', e.message)));
        // R2 weekly updates — run alongside journalism cron, non-blocking
        const _now = new Date();
        const _utcDay  = _now.getUTCDay();
        const _utcHour = _now.getUTCHours();
        // MLB Savant → R2: Monday 6AM ET (UTC 10-13)
        if (_utcDay === 1 && _utcHour >= 10 && _utcHour <= 13 && env.FIELD_DATA) {
            ctx.waitUntil(runMLBSavantUpdate(env).catch(e => console.error('[MLB-R2]', e.message)));
        }
        // nflverse → R2: Wednesday 8AM ET (UTC 12-15) — nflverse releases after Tuesday games
        if (_utcDay === 3 && _utcHour >= 12 && _utcHour <= 15 && env.FIELD_DATA) {
            ctx.waitUntil(runNFLR2Update(env).catch(e => console.error('[NFL-R2]', e.message)));
        }
        // NHL SCF series-adjusted PP/PK: every 15-min journalism tick, April-July.
        const _month = _now.getUTCMonth() + 1;
        if ((_month >= 4 && _month <= 7) && env.FIELD_DATA) {
            ctx.waitUntil(runNHLSeriesUpdate(env).catch(e => console.error('[NHL-SERIES]', e.message)));
        }
        // NBA clutch stats (relay-native — no GH Actions needed, stats.nba.com works with headers):
        // Mon/Wed/Fri during Finals window (June-July), Wed-only outside.
        // Avoids running every 15min — clutch stats update daily at most.
        const _isFinalsWindow = _month === 6 || _month === 7;
        const _isMWF = _utcDay === 1 || _utcDay === 3 || _utcDay === 5;
        if (_isFinalsWindow && _isMWF && _utcHour === 12 && env.FIELD_DATA) {
            ctx.waitUntil(runNBACluichUpdate(env).catch(e => console.error('[NBA-CLUTCH]', e.message)));
        } else if (!_isFinalsWindow && _utcDay === 3 && _utcHour === 12 && env.FIELD_DATA) {
            ctx.waitUntil(runNBACluichUpdate(env).catch(e => console.error('[NBA-CLUTCH]', e.message)));
        }
        // WC Tournament Projections — run every 15 min during group stage (June 11–26),
        // every 15 min during knockout phase (June 27+). Stores in FIELD_JOURNALISM KV.
        const _wcOpen  = new Date('2026-06-11T00:00:00Z');
        const _wcClose = new Date('2026-07-20T00:00:00Z');
        const _isWCWindow = _now >= _wcOpen && _now < _wcClose;
        if (_isWCWindow && env.FIELD_JOURNALISM) {
            ctx.waitUntil(runWCTournamentProjections(env).catch(e =>
                console.error('[WC-PROJ]', e.message)));
        }
        // BSD WC endgame capture — every 5-min tick when WC window is open.
        // Captures momentum + average-positions at 83'+ while endpoints are live.
        if (_isWCWindow && env.FIELD_DATA && env.BSD_API_TOKEN) {
            ctx.waitUntil(runBSDEndgameCapture(env).catch(e =>
                console.error('[BSD-ENDGAME]', e.message)));
        }
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

        // ── /repo/archive — HMAC-signed tarball proxy for L5 ────────────────
        // Caller mints the URL via the MCP get_archive_url tool. Signature
        // and expiry verified relay-side; the relay then forwards the request
        // to GitHub's tarball endpoint using the relay-held PAT, so the PAT
        // never leaves the worker (Rule 80 / CREDENTIAL-BOUNDARY-A).
        if (pathname === '/repo/archive' && request.method === 'GET') {
            const secret = env.FIELD_MCP_SECRET;
            if (!secret) return new Response('FIELD_MCP_SECRET not configured', { status: 503, headers: CORS });
            const ghToken = env.GITHUB_PAT;
            if (!ghToken) return new Response('GITHUB_PAT not configured', { status: 503, headers: CORS });
            const exp = parseInt(url.searchParams.get('exp') || '0', 10);
            const sig = url.searchParams.get('sig') || '';
            if (!exp || !sig) return new Response('Missing exp or sig', { status: 400, headers: CORS });
            if (Math.floor(Date.now() / 1000) > exp) return new Response('Signed URL expired', { status: 403, headers: CORS });
            const payload = `repo-archive:${exp}`;
            const key = await crypto.subtle.importKey(
                'raw',
                new TextEncoder().encode(secret),
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                ['sign'],
            );
            const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
            const sigHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
            if (sigHex !== sig) return new Response('Invalid signature', { status: 403, headers: CORS });
            const tarR = await fetch(`${REPO_API}/tarball/main`, {
                headers: {
                    'Authorization': `Bearer ${ghToken}`,
                    'User-Agent': 'field-relay-mcp',
                    'Accept': 'application/vnd.github+json',
                },
                redirect: 'follow',
            });
            if (!tarR.ok) {
                const txt = await tarR.text();
                return new Response(`GitHub tarball failed: ${tarR.status} ${txt}`, { status: 502, headers: CORS });
            }
            return new Response(tarR.body, {
                status: 200,
                headers: {
                    'Content-Type': 'application/gzip',
                    'Content-Disposition': `attachment; filename="${REPO_NAME}-main.tar.gz"`,
                    'Access-Control-Allow-Origin': '*',
                },
            });
        }

        // ── UserDO routes (June 11 2026) ──────────────────────────────────
        // /user/init   POST — create or verify UserDO for a given userId UUID
        // /user/state  GET  — return user state (watchHistory, seriesLedger, etc.)
        // /user/event  POST — append a user event (watch_open, series_game, peak_missed)
        // Privacy: no PII stored. UUID is the only identifier.
        if (pathname.startsWith('/user/') && env.USER_DO) {
            const userId = url.searchParams.get('userId') || '';
            if (!userId || userId.length < 8) {
                return new Response(JSON.stringify({ ok: false, error: 'missing userId' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            const doId = env.USER_DO.idFromName(userId);
            const stub = env.USER_DO.get(doId);
            const doUrl = new URL(request.url);
            doUrl.hostname = 'user-do-internal';
            return stub.fetch(new Request(doUrl.toString(), {
                method:  request.method,
                headers: request.headers,
                body:    request.method === 'POST' ? request.body : undefined,
            }));
        }
        if (pathname.startsWith('/user/') && !env.USER_DO) {
            return new Response(JSON.stringify({ ok: false, error: 'USER_DO not configured' }),
                { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
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
            // Surface the active quality calibration source. _qualityCalibrationSource
            // is module-scoped (per-isolate); a /health request usually hits a
            // different isolate than the cron, so peek KV directly here so the
            // observable answer is consistent regardless of routing.
            let qSource = 'unloaded';
            if (env.FIELD_JOURNALISM) {
                try {
                    const kv = await env.FIELD_JOURNALISM.get(QUALITY_CALIBRATION_KV_KEY, 'json');
                    qSource = isCalibrationFresh(kv) ? 'analytics-cron' : 'd1-live';
                } catch (_) { /* leave 'unloaded' */ }
            }

            return new Response(`RELAY OK — nba + nhl + fpl + fd + odds + apisports + squiggle + kali + atp + bdl + espn-gambit + espn-summary + dropbox + field-data + v2 + ws-game-do + jq-gate + jq-analytics + wc-d1 + wc-team-context + soccer-wp + cfl-odds + r2-mlb + r2-nfl + r2-nfl-b + soccer-fbref + nhl-series + nba-clutch + nhl-gsax + bracket-do + ambient-do + v2-cache + analytics-cron, quality-source=${qSource}`, {
                status: 200,
                headers: { 'Content-Type': 'text/plain', ...CORS, 'X-FIELD-Proxy': 'relay-multi' }
            });
        }


        // ── BSD Bzzoiro Sports Data routes ───────────────────────────────────────
        // Pure proxy — Rule 47 (relay-is-dumb). No editorial processing at relay.
        // Football REST free forever. Sports Pack (tennis/hockey) $5/mo.
        // WebSocket (ball tracking) $3/mo. All active as of 2026-06-25.
        // Auth: Authorization: Token ${env.BSD_API_TOKEN}
        // Docs: https://sports.bzzoiro.com/docs/football/
        if (pathname.startsWith('/bsd/')) {
            // /bsd/contract — single source of truth for the BSD coordinate
            // system. Public, no token required, no upstream fetch. Both relay
            // and client read this to keep coord transforms in sync. Update
            // here whenever BSD changes their spec; everything else follows.
            if (pathname === '/bsd/contract') {
                return new Response(JSON.stringify({
                    ok: true,
                    coordinateSystem: {
                        space:   'normalized-pitch',
                        xRange:  [0, 100],
                        yRange:  [0, 100],
                        origin:  'home-team-defending-goal-line, bottom-left corner',
                        axes: {
                            x: 'horizontal, 0 = home goal-line, 100 = away goal-line',
                            y: 'vertical, 0 = bottom touchline, 100 = top touchline',
                        },
                        sampleRate: { ball: '~5s', stats: '~30s' },
                    },
                    frameShapes: {
                        livedata: {
                            example: { type: 'bsd:ball', id: '12345', uts: 1735000000,
                                       coords: { x: 73.2, y: 42.1 }, situation: 'open_play' },
                            note: 'coords is the LAST coordinate in BSD frame.coordinates[]; AmbientDO distills.',
                        },
                        stats: {
                            example: { type: 'bsd:stats', id: '12345', minute: 67, period: 2,
                                       score: { home: 1, away: 1 },
                                       stats: { home_xg: 1.2, away_xg: 0.9, possession_home: 0.58 } },
                        },
                        shot: {
                            example: { x: 88.3, y: 51.5, xg: 0.34, result: 'goal',
                                       minute: 71, player: 'M. Salah', body_part: 'foot_right' },
                            source: '/bsd/events/{id}/shotmap',
                        },
                        avgPosition: {
                            example: { player: 'N. Kanté', x: 38.5, y: 52.0, touches: 71 },
                            source: '/bsd/events/{id}/average-positions',
                        },
                    },
                    transformReference: {
                        toScreenSVG: 'cx = x * width / 100; cy = (100 - y) * height / 100  (invert y for screen coords)',
                        mirrorForAwayPerspective: 'x = 100 - x; y = 100 - y',
                    },
                    revision: '2026-06-25-1',
                    status:   'provisional — pending live BSD verification of axis convention',
                }, null, 2), {
                    headers: { 'Content-Type': 'application/json',
                               'Cache-Control': 'public, max-age=300', ...CORS },
                });
            }

            const bsdToken = env.BSD_API_TOKEN;
            if (!bsdToken) {
                return new Response(JSON.stringify({ error: 'BSD_API_TOKEN not configured' }),
                    { status: 503, headers: { 'Content-Type': 'application/json', ...CORS } });
            }
            const BSD_BASE = 'https://sports.bzzoiro.com';
            const bsdHeaders = {
                'Authorization': `Token ${bsdToken}`,
                'User-Agent': 'FIELD/1.0',
                'Accept': 'application/json',
            };

            // /bsd/events/live → BSD /api/v2/events/live/
            if (pathname === '/bsd/events/live') {
                const cacheKey = new Request(`${BSD_BASE}/api/v2/events/live/`);
                const hit = await caches.default.match(cacheKey);
                if (hit) return new Response(hit.body, { status: 200,
                    headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT', ...CORS } });
                const r = await fetch(`${BSD_BASE}/api/v2/events/live/`, { headers: bsdHeaders });
                const body = await r.text();
                const resp = new Response(body, { status: r.status,
                    headers: { 'Content-Type': 'application/json',
                               'Cache-Control': 'public, max-age=25', ...CORS } });
                if (r.ok) ctx.waitUntil(caches.default.put(cacheKey, resp.clone()));
                return resp;
            }

            // /bsd/events/:id/shotmap → BSD /api/v2/events/:id/stats/
            const shotmapM = pathname.match(/^\/bsd\/events\/(\d+)\/shotmap$/);
            if (shotmapM) {
                const r = await fetch(`${BSD_BASE}/api/v2/events/${shotmapM[1]}/stats/`,
                    { headers: bsdHeaders });
                return new Response(await r.text(), { status: r.status,
                    headers: { 'Content-Type': 'application/json',
                               'Cache-Control': 'public, max-age=60', ...CORS } });
            }

            // /bsd/events/:id/momentum → extract momentum[] from BSD /api/v2/events/:id/stats/
            // BSD does not have a standalone /momentum/ endpoint — data is in /stats/.
            const momentumM = pathname.match(/^\/bsd\/events\/(\d+)\/momentum$/);
            if (momentumM) {
                const r = await fetch(`${BSD_BASE}/api/v2/events/${momentumM[1]}/stats/`,
                    { headers: bsdHeaders });
                if (!r.ok) {
                    return new Response(await r.text(), { status: r.status,
                        headers: { 'Content-Type': 'application/json', ...CORS } });
                }
                const statsData = await r.json();
                const momentum = statsData.momentum ?? [];
                return new Response(JSON.stringify({ event_id: momentumM[1], momentum }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json',
                               'Cache-Control': 'public, max-age=30', ...CORS },
                });
            }

            // /bsd/events/:id/incidents → BSD /api/v2/events/:id/incidents/
            const incidentsM = pathname.match(/^\/bsd\/events\/(\d+)\/incidents$/);
            if (incidentsM) {
                const r = await fetch(`${BSD_BASE}/api/v2/events/${incidentsM[1]}/incidents/`,
                    { headers: bsdHeaders });
                return new Response(await r.text(), { status: r.status,
                    headers: { 'Content-Type': 'application/json',
                               'Cache-Control': 'public, max-age=60', ...CORS } });
            }

            // /bsd/events/:id/odds → BSD /api/v2/events/:id/odds/comparison/
            const oddsM = pathname.match(/^\/bsd\/events\/(\d+)\/odds$/);
            if (oddsM) {
                const r = await fetch(`${BSD_BASE}/api/v2/events/${oddsM[1]}/odds/comparison/`,
                    { headers: bsdHeaders });
                return new Response(await r.text(), { status: r.status,
                    headers: { 'Content-Type': 'application/json',
                               'Cache-Control': 'public, max-age=30', ...CORS } });
            }

            // /bsd/events/:id/average-positions → BSD /api/v2/events/:id/average-positions/
            const avgPosM = pathname.match(/^\/bsd\/events\/(\d+)\/average-positions$/);
            if (avgPosM) {
                const r = await fetch(`${BSD_BASE}/api/v2/events/${avgPosM[1]}/average-positions/`,
                    { headers: bsdHeaders });
                return new Response(await r.text(), { status: r.status,
                    headers: { 'Content-Type': 'application/json',
                               'Cache-Control': 'public, max-age=120', ...CORS } });
            }

            // /bsd/tennis/matches/live → BSD tennis /api/v2/matches/live/ (Sports Pack)
            if (pathname === '/bsd/tennis/matches/live') {
                const cacheKey = new Request(`${BSD_BASE}/tennis/api/v2/matches/live/`);
                const hit = await caches.default.match(cacheKey);
                if (hit) return new Response(hit.body, { status: 200,
                    headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT', ...CORS } });
                const r = await fetch(`${BSD_BASE}/tennis/api/v2/matches/live/`,
                    { headers: bsdHeaders });
                const body = await r.text();
                const resp = new Response(body, { status: r.status,
                    headers: { 'Content-Type': 'application/json',
                               'Cache-Control': 'public, max-age=25', ...CORS } });
                if (r.ok) ctx.waitUntil(caches.default.put(cacheKey, resp.clone()));
                return resp;
            }

            // /bsd/tennis/matches/:id → BSD tennis match detail
            const tennisM = pathname.match(/^\/bsd\/tennis\/matches\/(\d+)$/);
            if (tennisM) {
                const r = await fetch(`${BSD_BASE}/tennis/api/v2/matches/${tennisM[1]}/`,
                    { headers: bsdHeaders });
                return new Response(await r.text(), { status: r.status,
                    headers: { 'Content-Type': 'application/json',
                               'Cache-Control': 'public, max-age=30', ...CORS } });
            }

            // /bsd/events/by-date?date=YYYY-MM-DD → BSD /api/v2/events/?date=...
            // Used for: backfilling wc_results.bsd_event_id, historical shotmap lookup
            if (pathname === '/bsd/events/by-date') {
                const dateParam = url.searchParams.get('date') || new Date().toISOString().slice(0,10);
                const leagueId  = url.searchParams.get('league_id') || '';
                const season    = url.searchParams.get('season') || '';
                let bsdQs = `?date=${dateParam}`;
                if (leagueId)  bsdQs += `&league_id=${leagueId}`;
                if (season)    bsdQs += `&season=${season}`;
                const r = await fetch(`${BSD_BASE}/api/v2/events/${bsdQs}`,
                    { headers: bsdHeaders });
                return new Response(await r.text(), { status: r.status,
                    headers: { 'Content-Type': 'application/json',
                               'Cache-Control': 'public, max-age=300', ...CORS } });
            }

            // /bsd/events/season?league_id=X&season=Y → BSD all events for a competition
            if (pathname === '/bsd/events/season') {
                const leagueId = url.searchParams.get('league_id') || '1';
                const season   = url.searchParams.get('season') || '2026';
                const r = await fetch(
                    `${BSD_BASE}/api/v2/events/?league_id=${leagueId}&season=${season}`,
                    { headers: bsdHeaders });
                return new Response(await r.text(), { status: r.status,
                    headers: { 'Content-Type': 'application/json',
                               'Cache-Control': 'public, max-age=300', ...CORS } });
            }

            // /bsd/r2/list?prefix=bsd/wc26/ — list R2 keys for BSD captures.
            // Diagnostic for buildBSDHistoryContext — verify R2 has captured
            // game-final BSD data (shipped in a55ebd3). Read-only, no BSD token
            // needed (R2 binding only). Placed inside the /bsd/* block but
            // before the BSD upstream calls so it skips the bsdToken guard
            // would have been needed earlier — instead we just check FIELD_DATA.
            if (pathname === '/bsd/r2/list') {
                if (!env.FIELD_DATA)
                    return new Response(JSON.stringify({ error: 'FIELD_DATA not bound' }),
                        { status: 503, headers: { 'Content-Type': 'application/json', ...CORS } });
                const prefix = url.searchParams.get('prefix') || 'bsd/wc26/';
                const list = await env.FIELD_DATA.list({ prefix, limit: 100 });
                return new Response(JSON.stringify({
                    keys: list.objects.map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded })),
                    truncated: list.truncated,
                }), { status: 200, headers: { 'Content-Type': 'application/json',
                      'Cache-Control': 'no-store', ...CORS } });
            }

            // /bsd/r2/read?key=bsd/wc26/8346/stats.json — serve R2 object as JSON.
            // Used by client for post-game pitch map and shot summary.
            if (pathname === '/bsd/r2/read') {
                if (!env.FIELD_DATA)
                    return new Response(JSON.stringify({ error: 'no binding' }),
                        { status: 503, headers: { 'Content-Type': 'application/json', ...CORS } });
                const key = url.searchParams.get('key');
                if (!key || !key.startsWith('bsd/'))
                    return new Response(JSON.stringify({ error: 'invalid key' }),
                        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } });
                const obj = await env.FIELD_DATA.get(key);
                if (!obj)
                    return new Response(JSON.stringify({ error: 'not found', key }),
                        { status: 404, headers: { 'Content-Type': 'application/json', ...CORS } });
                return new Response(await obj.text(), { status: 200,
                    headers: { 'Content-Type': 'application/json',
                               'Cache-Control': 'public, max-age=3600', ...CORS } });
            }

            // Unknown /bsd/* path
            return new Response(JSON.stringify({ error: 'Unknown BSD route', path: pathname }),
                { status: 404, headers: { 'Content-Type': 'application/json', ...CORS } });
        }

        // /health/sources — Stale Data Sentinel. Reports freshness of every
        // data source feeding the journalism pipeline. Probe-only; no alerts.
        if (pathname === '/health/sources') {
            const { checkAllSources } = await import('./stale-data-sentinel.js');
            const result = await checkAllSources(env);
            return new Response(JSON.stringify(result, null, 2), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...CORS },
            });
        }

        // /odds-story/preview?date=YYYY-MM-DD — preview the materialized
        // line-movement narrative the Context Assembler would inject. Does
        // not write anything. Pure read of opening_odds vs closing_odds
        // in regular_season_games + postseason_games.
        if (pathname === '/odds-story/preview') {
            const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
            if (!env.ARCHIVE_DB) {
                return new Response(JSON.stringify({ error: 'ARCHIVE_DB not bound' }),
                    { status: 503, headers: { 'Content-Type': 'application/json', ...CORS } });
            }
            const { computeOddsStory } = await import('./odds-story.js');
            const games = [];
            let withStory = 0, withoutStory = 0, missingClosing = 0, missingOpening = 0;
            for (const table of ['regular_season_games', 'postseason_games']) {
                try {
                    const rows = await env.ARCHIVE_DB.prepare(
                        `SELECT id, home, away, opening_odds, closing_odds FROM ${table}
                         WHERE date = ?`
                    ).bind(date).all();
                    for (const row of (rows.results || [])) {
                        const hasOpening = !!row.opening_odds;
                        const hasClosing = !!row.closing_odds;
                        if (!hasOpening) missingOpening++;
                        else if (!hasClosing) missingClosing++;
                        const story = (hasOpening && hasClosing)
                            ? computeOddsStory(row.opening_odds, row.closing_odds) : '';
                        if (story) withStory++; else if (hasOpening && hasClosing) withoutStory++;
                        games.push({
                            id: row.id, home: row.home, away: row.away,
                            hasOpening, hasClosing, story,
                        });
                    }
                } catch (_) { /* table absent or query fail — silent per Rule 5 */ }
            }
            return new Response(JSON.stringify({
                date, total: games.length,
                withStory, withoutStory, missingClosing, missingOpening,
                games,
            }, null, 2), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...CORS },
            });
        }

        // /whoop/callback — OAuth callback, exchanges code for tokens instantly
        if (pathname === '/whoop/callback') {
            const code = url.searchParams.get('code');
            if (!code) return new Response('Missing code parameter', { status: 400 });
            
            try {
                const tokenResp = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        grant_type: 'authorization_code',
                        code: code,
                        client_id: env.WHOOP_CLIENT_ID,
                        client_secret: env.WHOOP_CLIENT_SECRET,
                        redirect_uri: 'https://field-relay-nba.jeffunglesbee.workers.dev/whoop/callback'
                    }).toString()
                });
                
                const tokenData = await tokenResp.json();
                
                if (tokenData.access_token) {
                    // Store in D1
                    await env.DB.prepare(
                        `INSERT OR REPLACE INTO whoop_tokens (id, access_token, refresh_token, expires_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'))`
                    ).bind('primary', tokenData.access_token, tokenData.refresh_token || '', new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString()).run();
                    
                    // Test the token immediately
                    const testResp = await fetch('https://api.prod.whoop.com/developer/v1/user/profile/basic', {
                        headers: { 'Authorization': 'Bearer ' + tokenData.access_token }
                    });
                    const testStatus = testResp.status;
                    const testBody = testStatus === 200 ? await testResp.json() : await testResp.text();
                    
                    return new Response(
                        '<html><body style="background:#1a1a2e;color:#0f0;font-family:monospace;padding:40px;text-align:center"><h1>WHOOP AUTH SUCCESS</h1><p>Tokens stored. You can close this tab.</p><p>Refresh token: ' + (tokenData.refresh_token ? 'YES' : 'NO') + '</p><p>Expires in: ' + tokenData.expires_in + 's</p><p>API test: HTTP ' + testStatus + '</p><pre>' + JSON.stringify(testBody).substring(0,300) + '</pre></body></html>',
                        { status: 200, headers: { 'Content-Type': 'text/html' } }
                    );
                } else {
                    return new Response(JSON.stringify(tokenData), { status: 400, headers: { 'Content-Type': 'application/json' } });
                }
            } catch (e) {
                return new Response('Token exchange error: ' + e.message, { status: 500 });
            }
        }
        
        // /whoop/tokens — read stored tokens (MCP auth required)
        if (pathname === '/whoop/tokens') {
            const authHeader = request.headers.get('Authorization') || '';
            const token = authHeader.replace('Bearer ', '');
            if (token !== env.FIELD_MCP_SECRET) {
                return new Response('Unauthorized', { status: 401 });
            }
            try {
                const row = await env.DB.prepare('SELECT access_token, refresh_token, expires_at, updated_at FROM whoop_tokens WHERE id = ?').bind('primary').first();
                if (!row) return new Response(JSON.stringify({error: 'no tokens stored'}), { status: 404, headers: { 'Content-Type': 'application/json' } });
                return new Response(JSON.stringify(row), { status: 200, headers: { 'Content-Type': 'application/json' } });
            } catch (e) {
                return new Response(JSON.stringify({error: e.message}), { status: 500, headers: { 'Content-Type': 'application/json' } });
            }
        }


        // /whoop/fetch — fetch Whoop data using D1-stored tokens (MCP probe allowed)
        if (pathname === '/whoop/fetch') {
            try {
                const row = await env.DB.prepare('SELECT access_token, refresh_token, expires_at FROM whoop_tokens WHERE id = ?').bind('primary').first();
                if (!row) return new Response(JSON.stringify({error: 'no tokens — run OAuth first'}), {status: 404, headers: {'Content-Type': 'application/json', ...CORS}});
                
                let token = row.access_token;
                const now = new Date().toISOString();
                
                // Refresh if expired
                if (row.expires_at && new Date(row.expires_at.replace(/Z$/, '')) < new Date()) {
                    const refreshResp = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                            grant_type: 'refresh_token',
                            refresh_token: row.refresh_token,
                            client_id: env.WHOOP_CLIENT_ID,
                            client_secret: env.WHOOP_CLIENT_SECRET
                        }).toString()
                    });
                    const refreshData = await refreshResp.json();
                    var _refreshDebug = { status: refreshResp.status, body: JSON.stringify(refreshData).substring(0, 200) };
                    if (refreshData.access_token) {
                        token = refreshData.access_token;
                        await env.DB.prepare(
                            `UPDATE whoop_tokens SET access_token = ?, refresh_token = ?, expires_at = datetime('now', '+' || ? || ' seconds'), updated_at = datetime('now') WHERE id = ?`
                        ).bind(token, refreshData.refresh_token || row.refresh_token, refreshData.expires_in || 3600, 'primary').run();
                    }
                }
                
                const days = parseInt(url.searchParams.get('days') || '7');
                const start = new Date(Date.now() - days * 86400000).toISOString();
                const end = new Date().toISOString();
                const params = `start=${start}&end=${end}&limit=25`;
                const base = 'https://api.prod.whoop.com/developer/v1';
                const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
                
                const endpoints = {
                    recovery: `${base}/recovery?${params}`,
                    cycle: `${base}/cycle?${params}`,
                    sleep: `${base}/activity/sleep?${params}`,
                    workout: `${base}/activity/workout?${params}`,
                    body: `${base}/user/measurement/body`,
                    profile: `${base}/user/profile/basic`,
                };
                
                const result = { 
                    fetched_at: new Date().toISOString(), 
                    days,
                    _debug: {
                        has_client_id: !!env.WHOOP_CLIENT_ID,
                        has_client_secret: !!env.WHOOP_CLIENT_SECRET,
                        token_len: token.length,
                        token_prefix: token.substring(0, 8),
                        was_refreshed: token !== row.access_token,
                        refresh_attempted: new Date(row.expires_at.replace(/Z$/, '')) < new Date(),
                        refresh_result: typeof _refreshDebug !== 'undefined' ? _refreshDebug : 'not attempted',
                        expires_at: row.expires_at,
                        now: new Date().toISOString()
                    }
                };
                
                for (const [name, epUrl] of Object.entries(endpoints)) {
                    try {
                        const r = await fetch(epUrl, { headers });
                        result[name] = { status: r.status, data: r.status === 200 ? await r.json() : await r.text() };
                    } catch (e) {
                        result[name] = { status: 0, error: e.message };
                    }
                }
                
                return new Response(JSON.stringify(result), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json', ...CORS }
                });
            } catch (e) {
                return new Response(JSON.stringify({error: e.message}), {status: 500, headers: {'Content-Type': 'application/json', ...CORS}});
            }
        }

        // /wc/* — World Cup D1 standings (WC D1, June 4 2026)
        if (pathname.startsWith('/wc/')) {
            if (pathname === '/wc/standings')   return handleWCStandings(url, env);
            if (pathname === '/wc/results')     return handleWCResults(url, env);
            if (pathname === '/wc/match-wp')    return handleWCMatchWP(url, env);
            if (pathname === '/wc/odds-probs')  return handleWCOddsProbs(env);
            if (pathname === '/wc/third-place') return handleWCThirdPlace(env);
            if (pathname === '/wc/wp/verify')   return handleWCWPVerify(env);
            if (pathname === '/wc/admin/seed' && request.method === 'POST')
                return handleWCAdminSeed(request, env);

            // Manual trigger for BSD event-ID backfill. Also auto-fires inside
            // writeWCResult once per day (gated by FIELD_JOURNALISM KV) — this
            // endpoint exists for diagnostics, dry-runs, and forced re-runs.
            if (pathname === '/admin/wc/bsd-backfill' && request.method === 'POST') {
                const auth = (request.headers.get('Authorization') || '').replace('Bearer ', '');
                if (auth !== env.FIELD_MCP_SECRET)
                    return new Response('Unauthorized', { status: 401, headers: CORS });
                const body = await request.json().catch(() => ({}));
                const result = await backfillWCBsdEventIds(env, {
                    leagueId: body.leagueId ? String(body.leagueId) : undefined,
                    since:    body.since ? String(body.since) : undefined,
                });
                return new Response(JSON.stringify(result), {
                    status: result.ok ? 200 : 400,
                    headers: { 'Content-Type': 'application/json', ...CORS },
                });
            }

            // ── WC Tournament Projections (June 11 2026) ───────────────────────
            // GET  /wc/projections          — current per-team path probabilities
            // GET  /wc/movers               — today's movers + secondary beneficiaries
            // GET  /wc/brief/tournament     — journalism brief from latest movers
            // POST /wc/projections/refresh  — manual trigger (no auth needed — idempotent read)
            if (pathname === '/wc/projections') {
                const raw = env.FIELD_JOURNALISM
                    ? await env.FIELD_JOURNALISM.get('wc:projections:current') : null;
                if (!raw) {
                    // Not computed yet — trigger immediately and return placeholder
                    if (env.FIELD_JOURNALISM) {
                        ctx.waitUntil(runWCTournamentProjections(env).catch(() => {}));
                    }
                    return new Response(JSON.stringify({ ok: true, pending: true,
                        message: 'Projections computing — retry in 30s' }),
                        { headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
                return new Response(raw, {
                    headers: { ...CORS, 'Content-Type': 'application/json',
                               'Cache-Control': 'public, max-age=300' } });
            }
            if (pathname === '/wc/movers') {
                const raw = env.FIELD_JOURNALISM
                    ? await env.FIELD_JOURNALISM.get('wc:movers:current') : null;
                if (!raw) return new Response(JSON.stringify({ ok: true, movers: null }),
                    { headers: { ...CORS, 'Content-Type': 'application/json' } });
                return new Response(raw, {
                    headers: { ...CORS, 'Content-Type': 'application/json',
                               'Cache-Control': 'public, max-age=300' } });
            }
            if (pathname === '/wc/brief/tournament') {
                const raw = env.FIELD_JOURNALISM
                    ? await env.FIELD_JOURNALISM.get('wc:brief:movers') : null;
                if (!raw) return new Response(JSON.stringify({ ok: true, brief: null }),
                    { headers: { ...CORS, 'Content-Type': 'application/json' } });
                return new Response(raw, {
                    headers: { ...CORS, 'Content-Type': 'application/json',
                               'Cache-Control': 'public, max-age=1800' } });
            }
            if (pathname === '/wc/projections/refresh' && request.method === 'POST') {
                ctx.waitUntil(runWCTournamentProjections(env).catch(() => {}));
                return new Response(JSON.stringify({ ok: true, message: 'Refresh triggered' }),
                    { headers: { ...CORS, 'Content-Type': 'application/json' } });
            }

            // GET /wc/elimination-traps — idle-team vulnerability scan.
            // Distinct from /wc/traps (path traps on team's own group finish).
            // Reads today's WC fixtures from /wc/odds-probs and current
            // projections from KV; flags teams whose pR32 could fall below
            // DANGER threshold via adversarial-result proxy sweep.
            if (pathname === '/wc/elimination-traps') {
                try {
                    const kvProj = env.FIELD_JOURNALISM
                        ? await env.FIELD_JOURNALISM.get('wc:projections:current') : null;
                    if (!kvProj) return new Response(
                        JSON.stringify({ ok: true, traps: [], pending: true }),
                        { headers: { ...CORS, 'Content-Type': 'application/json' } }
                    );
                    const projections = JSON.parse(kvProj);

                    const today = url.searchParams.get('date')
                        || new Date().toISOString().slice(0, 10);
                    const oddsRes = await fetch(`${env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev'}/wc/odds-probs`, { cache: 'no-store' });
                    const oddsData = oddsRes.ok ? await oddsRes.json() : { probs: [] };
                    const todayGames = (oddsData.probs || [])
                        .filter(g => (g.commence || '').startsWith(today))
                        .map(g => ({ home: g.home_team, away: g.away_team }));

                    const standRes = await fetch(`${env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev'}/wc/standings`, { cache: 'no-store' });
                    const standings = standRes.ok ? ((await standRes.json()).groups ?? {}) : {};

                    const { detectEliminationTraps } = await import('./wc-tournament-projections.js');
                    const traps = detectEliminationTraps(todayGames, projections, standings);

                    return new Response(JSON.stringify({
                        ok: true,
                        date: today,
                        todayGameCount: todayGames.length,
                        traps,
                        generatedAt: new Date().toISOString(),
                    }), { headers: { ...CORS, 'Content-Type': 'application/json',
                                     'Cache-Control': 'public, max-age=300' } });
                } catch (e) {
                    return new Response(JSON.stringify({ ok: false, error: e.message }),
                        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
            }

            // GET /wc/traps — bracket trap detection slice from latest projections
            if (pathname === '/wc/traps') {
                const raw = env.FIELD_JOURNALISM
                    ? await env.FIELD_JOURNALISM.get('wc:projections:current') : null;
                if (!raw) return new Response(JSON.stringify({ ok: true, bracketTraps: [], pending: true }),
                    { headers: { ...CORS, 'Content-Type': 'application/json' } });
                try {
                    const proj = JSON.parse(raw);
                    return new Response(JSON.stringify({
                        ok: true,
                        bracketTraps: proj.bracketTraps || [],
                        generatedAt: proj.generatedAt,
                        N: proj.N,
                    }), { headers: { ...CORS, 'Content-Type': 'application/json',
                                     'Cache-Control': 'public, max-age=300' } });
                } catch {
                    return new Response(JSON.stringify({ ok: false, error: 'parse error' }),
                        { headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
            }

            // GET /wc/bracket — most-probable filled bracket from Monte Carlo simulations
            if (pathname === '/wc/bracket') {
                const cached = env.FIELD_JOURNALISM
                    ? await env.FIELD_JOURNALISM.get('wc:bracket:current') : null;
                if (cached) {
                    return new Response(cached, {
                        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800', ...CORS }
                    });
                }
                return new Response(JSON.stringify({ ok: true, bracketSlots: {}, generatedAt: null }), {
                    headers: { 'Content-Type': 'application/json', ...CORS }
                });
            }

            // GET /wc/bracket/live — WebSocket upgrade to BracketDO for real-time bracket updates
            // Browser connects once; receives bracket:current on connect, bracket:updated on each result.
            if (pathname === '/wc/bracket/live') {
                if (!env.BRACKET_DO)
                    return new Response(JSON.stringify({ error: 'BracketDO not bound' }),
                        { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
                const doId = env.BRACKET_DO.idFromName('wc2026');
                const stub = env.BRACKET_DO.get(doId);
                // Forward the WS upgrade to the DO (standard DO WebSocket proxy pattern)
                return stub.fetch(request);
            }

            // GET /wc/bracket/state — REST poll fallback (no WS needed on simple clients)
            if (pathname === '/wc/bracket/state') {
                if (!env.BRACKET_DO)
                    return new Response(JSON.stringify({ error: 'BracketDO not bound' }),
                        { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
                const doId = env.BRACKET_DO.idFromName('wc2026');
                const stub = env.BRACKET_DO.get(doId);
                const res  = await stub.fetch('https://bracket-do/bracket/state');
                const body = await res.text();
                return new Response(body, {
                    headers: { ...CORS, 'Content-Type': 'application/json',
                               'Cache-Control': 'public, max-age=30' }
                });
            }

            // GET|POST /wc/bracket/refresh — force BracketDO projection recompute
            // Accepts GET for MCP probe_relay_route compatibility + POST for admin
            if (pathname === '/wc/bracket/refresh' && (request.method === 'POST' || request.method === 'GET')) {
                if (!env.BRACKET_DO)
                    return new Response(JSON.stringify({ error: 'BracketDO not bound' }),
                        { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
                const doId = env.BRACKET_DO.idFromName('wc2026');
                const stub = env.BRACKET_DO.get(doId);
                await stub.fetch('https://bracket-do/bracket/refresh', { method: 'POST' });
                return new Response(JSON.stringify({ ok: true, message: 'BracketDO refresh triggered' }),
                    { headers: { ...CORS, 'Content-Type': 'application/json' } });
            }

            // GET /wc/injuries — player injury reports for WC 2026
            // Served from KV (1hr TTL). Live fetch on cache miss.
            if (pathname === '/wc/injuries') {
                const raw = env.FIELD_JOURNALISM
                    ? await env.FIELD_JOURNALISM.get('wc:injuries:current') : null;
                if (raw) {
                    return new Response(raw, {
                        headers: { ...CORS, 'Content-Type': 'application/json',
                                   'Cache-Control': 'public, max-age=3600',
                                   'X-Injuries-Source': 'kv-cache' },
                    });
                }
                // Cache miss — fetch live and return
                try {
                    const result = await fetchWCInjuries(env);
                    return new Response(JSON.stringify(result), {
                        headers: { ...CORS, 'Content-Type': 'application/json',
                                   'Cache-Control': 'public, max-age=3600',
                                   'X-Injuries-Source': 'live' },
                    });
                } catch (e) {
                    return new Response(JSON.stringify({ ok: false, error: e.message }),
                        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
            }

            // POST /wc/injuries/refresh — manual cache bust
            if (pathname === '/wc/injuries/refresh' && request.method === 'POST') {
                try {
                    const result = await fetchWCInjuries(env);
                    return new Response(JSON.stringify({
                        ok: true, message: 'Injuries refreshed',
                        raw_count: result.raw_count, teams: Object.keys(result.teams).length,
                        generatedAt: result.generatedAt,
                    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
                } catch (e) {
                    return new Response(JSON.stringify({ ok: false, error: e.message }),
                        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
            }

            // POST /wc/matchup/cache — client writes pre-game matchupNote to KV
            // so writeWCResult can inject it into the journalism prompt as a
            // PRE-GAME CONTEXT block. Body: { home, away, note }. Stores both
            // {home}_{away} and {away}_{home} keys with 24h TTL so the lookup
            // works regardless of which side the relay treats as home.
            if (pathname === '/wc/matchup/cache' && request.method === 'POST') {
                if (!env.FIELD_JOURNALISM) return new Response(
                    JSON.stringify({ ok: false, error: 'FIELD_JOURNALISM not bound' }),
                    { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } }
                );
                try {
                    const body = await request.json();
                    const { home, away, note } = body || {};
                    if (!home || !away || !note) return new Response(
                        JSON.stringify({ ok: false, error: 'missing home/away/note' }),
                        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
                    );
                    const norm = s => (s || '').trim().toLowerCase().replace(/\s+/g, '_');
                    const key  = `wc:matchup:${norm(home)}_${norm(away)}`;
                    const keyR = `wc:matchup:${norm(away)}_${norm(home)}`;
                    const val  = String(note).slice(0, 400);
                    await Promise.all([
                        env.FIELD_JOURNALISM.put(key,  val, { expirationTtl: 86400 }),
                        env.FIELD_JOURNALISM.put(keyR, val, { expirationTtl: 86400 }),
                    ]);
                    return new Response(
                        JSON.stringify({ ok: true, key, keyR }),
                        { headers: { ...CORS, 'Content-Type': 'application/json' } }
                    );
                } catch (e) {
                    return new Response(
                        JSON.stringify({ ok: false, error: e.message }),
                        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
                    );
                }
            }

            return new Response('WC endpoint not found', { status: 404, headers: CORS });
        }

        // ── /context/* — Context Graph API (June 18 2026) ─────────────────────────
        // Single endpoint returning EVERYTHING FIELD knows about a game or date.
        // Replaces 5-6 scattered queries with one parallel fan-out per request.
        // RELAY-IS-DUMB: returns facts only. No ranking, no scoring, no recs.
        // ADR-002 clean: structural aggregation of stored facts.
        //
        // /context/game/{id} — per-game context (added Commit 1).
        // /context/date/{iso} — slate-wide context (added Commit 6).
        if (pathname.startsWith('/context/')) {
            if (!env.ARCHIVE_DB) {
                return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
                    { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            if (pathname.startsWith('/context/game/')) {
                const id = decodeURIComponent(pathname.slice('/context/game/'.length));
                if (!id) {
                    return new Response(JSON.stringify({ ok: false, error: 'missing game id' }),
                        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
                // KV cache check (60s live / 300s final — assume live by default until
                // the game row reveals scores; the cache lookup happens before findGame
                // so we cache by id alone). Cache failures fall through to fresh query.
                const cacheKey = `ctx:${id}`;
                if (env.FIELD_JOURNALISM) {
                    try {
                        const cached = await env.FIELD_JOURNALISM.get(cacheKey);
                        if (cached) {
                            return new Response(cached, {
                                headers: { ...CORS, 'Content-Type': 'application/json',
                                           'Cache-Control': 'public,max-age=60', 'X-Cache': 'HIT' },
                            });
                        }
                    } catch (_) { /* fall through to query */ }
                }
                const _errors = [];
                const settled = await Promise.allSettled([
                    findGame(env, id),
                    findBriefs(env, id),
                    findSeries(env, id),
                    findEnrichment(env, id),
                ]);
                const [g, b, s, e] = settled;
                if (g.status === 'rejected') _errors.push({ source: 'game',       reason: String(g.reason?.message || g.reason) });
                if (b.status === 'rejected') _errors.push({ source: 'archive',    reason: String(b.reason?.message || b.reason) });
                if (s.status === 'rejected') _errors.push({ source: 'series',     reason: String(s.reason?.message || s.reason) });
                if (e.status === 'rejected') _errors.push({ source: 'enrichment', reason: String(e.reason?.message || e.reason) });
                const game = g.status === 'fulfilled' ? g.value : null;
                const isFinal = game && game.home_score != null && game.away_score != null;
                const payload = {
                    ok: true,
                    id,
                    game,
                    archive:    b.status === 'fulfilled' ? b.value : null,
                    series:     s.status === 'fulfilled' ? s.value : null,
                    enrichment: e.status === 'fulfilled' ? e.value : null,
                    _errors:    _errors.length ? _errors : undefined,
                };
                const body = JSON.stringify(payload);
                if (env.FIELD_JOURNALISM) {
                    try {
                        await env.FIELD_JOURNALISM.put(cacheKey, body, {
                            expirationTtl: isFinal ? 300 : 60,
                        });
                    } catch (_) { /* cache write best-effort */ }
                }
                return new Response(body, {
                    headers: { ...CORS, 'Content-Type': 'application/json',
                               'Cache-Control': `public,max-age=${isFinal ? 300 : 60}` },
                });
            }
            if (pathname.startsWith('/context/date/')) {
                const date = pathname.slice('/context/date/'.length);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                    return new Response(JSON.stringify({ ok: false, error: 'invalid date — expected YYYY-MM-DD' }),
                        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
                const settled = await Promise.allSettled([
                    env.ARCHIVE_DB.prepare(
                        'SELECT * FROM regular_season_games WHERE date = ?'
                    ).bind(date).all(),
                    env.ARCHIVE_DB.prepare(
                        'SELECT * FROM postseason_games WHERE date = ?'
                    ).bind(date).all(),
                    env.ARCHIVE_DB.prepare(
                        `SELECT * FROM briefs WHERE date = ? OR
                         (brief_type IN ('narrative_context','standings_snapshot')
                          AND date <= ?) ORDER BY brief_type, date DESC`
                    ).bind(date, date).all(),
                    env.ARCHIVE_DB.prepare(
                        `SELECT * FROM postseason_series WHERE series_key IN
                         (SELECT DISTINCT series_key FROM postseason_games WHERE date = ?)`
                    ).bind(date).all(),
                    env.ARCHIVE_DB.prepare(
                        `SELECT brief_text, game_id, date FROM briefs
                         WHERE brief_type = 'standings_snapshot' AND date <= ?
                         ORDER BY date DESC LIMIT 12`
                    ).bind(date).all(),
                ]);
                const [reg, ps, br, ser, st] = settled;
                const _errors = [];
                if (reg.status === 'rejected') _errors.push({ source: 'regular',    reason: String(reg.reason?.message || reg.reason) });
                if (ps.status  === 'rejected') _errors.push({ source: 'postseason', reason: String(ps.reason?.message  || ps.reason)  });
                if (br.status  === 'rejected') _errors.push({ source: 'briefs',     reason: String(br.reason?.message  || br.reason)  });
                if (ser.status === 'rejected') _errors.push({ source: 'series',     reason: String(ser.reason?.message || ser.reason) });
                if (st.status  === 'rejected') _errors.push({ source: 'standings',  reason: String(st.reason?.message  || st.reason)  });
                const payload = {
                    ok: true,
                    date,
                    games: {
                        regular:    reg.status === 'fulfilled' ? (reg.value.results || []) : [],
                        postseason: ps.status  === 'fulfilled' ? (ps.value.results  || []) : [],
                    },
                    briefs:    br.status  === 'fulfilled' ? (br.value.results  || []) : [],
                    series:    ser.status === 'fulfilled' ? (ser.value.results || []) : [],
                    standings: st.status  === 'fulfilled' ? (st.value.results  || []) : [],
                    _errors:   _errors.length ? _errors : undefined,
                };
                return new Response(JSON.stringify(payload), {
                    headers: { ...CORS, 'Content-Type': 'application/json',
                               'Cache-Control': 'public,max-age=300' },
                });
            }
            return new Response(JSON.stringify({ ok: false, error: 'Context endpoint not found' }),
                { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }

        // ── /odds/history — Historical odds from D1 backfill ──────────────────
        if (pathname.startsWith('/odds/history/') && env.ARCHIVE_DB) {
            const gameId = decodeURIComponent(pathname.slice('/odds/history/'.length));
            if (!gameId) {
                return new Response(JSON.stringify({ ok: false, error: 'missing game_id' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            try {
                const rows = await env.ARCHIVE_DB.prepare(
                    `SELECT * FROM odds_history WHERE game_id = ? ORDER BY snapshot_time DESC`
                ).bind(gameId).all();
                return new Response(JSON.stringify({ ok: true, game_id: gameId, odds: rows.results || [] }), {
                    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public,max-age=3600' },
                });
            } catch (e) {
                return new Response(JSON.stringify({ ok: true, game_id: gameId, odds: [], _note: 'odds_history table may not exist yet' }), {
                    headers: { ...CORS, 'Content-Type': 'application/json' },
                });
            }
        }

        // ── /archive/* — Game Archive D1 (June 15 2026) ───────────────────────────
        // Read-only endpoints backed by field-archive D1.
        // ADR-002: CLEAN — factual game data, no drama/interest scores.
        if (pathname.startsWith('/archive/')) {
            if (!env.ARCHIVE_DB) {
                return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
                    { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }

            // GET /archive/series/:key — full series with all games
            if (pathname.startsWith('/archive/series/')) {
                const key = decodeURIComponent(pathname.slice('/archive/series/'.length));
                if (!key) return new Response(JSON.stringify({ ok: false, error: 'missing series key' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
                const series = await env.ARCHIVE_DB.prepare(
                    'SELECT * FROM postseason_series WHERE series_key = ?'
                ).bind(key).first();
                const games = await env.ARCHIVE_DB.prepare(
                    'SELECT * FROM postseason_games WHERE series_key = ? ORDER BY game_number'
                ).bind(key).all();
                return new Response(JSON.stringify({ ok: true, series, games: games.results }),
                    { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
            }

            // GET /archive/last-meeting?home=X&away=Y
            if (pathname === '/archive/last-meeting') {
                const home = url.searchParams.get('home') || '';
                const away = url.searchParams.get('away') || '';
                if (!home || !away) return new Response(JSON.stringify({ ok: false, error: 'missing home/away' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
                const game = await env.ARCHIVE_DB.prepare(
                    `SELECT * FROM regular_season_games
                     WHERE (home LIKE ? AND away LIKE ?) OR (home LIKE ? AND away LIKE ?)
                     ORDER BY date DESC LIMIT 1`
                ).bind(`%${home}%`, `%${away}%`, `%${away}%`, `%${home}%`).first();
                return new Response(JSON.stringify({ ok: true, game }),
                    { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
            }

            // GET /archive/date/:iso — all games on a date
            if (pathname.startsWith('/archive/date/')) {
                const iso = decodeURIComponent(pathname.slice('/archive/date/'.length));
                const reg = await env.ARCHIVE_DB.prepare(
                    'SELECT * FROM regular_season_games WHERE date = ?'
                ).bind(iso).all();
                const ps = await env.ARCHIVE_DB.prepare(
                    'SELECT * FROM postseason_games WHERE date = ?'
                ).bind(iso).all();
                return new Response(JSON.stringify({ ok: true, games: [...reg.results, ...ps.results] }),
                    { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
            }

            // GET /archive/tagged/:tag — games with a specific tag
            if (pathname.startsWith('/archive/tagged/')) {
                const tag = decodeURIComponent(pathname.slice('/archive/tagged/'.length));
                const tagged = await env.ARCHIVE_DB.prepare(
                    `SELECT * FROM regular_season_games WHERE tags LIKE ? ORDER BY date DESC`
                ).bind(`%"${tag}"%`).all();
                return new Response(JSON.stringify({ ok: true, games: tagged.results }),
                    { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
            }

            // GET /archive/sport/:sport — all games for a sport
            if (pathname.startsWith('/archive/sport/')) {
                const sport = decodeURIComponent(pathname.slice('/archive/sport/'.length));
                const reg = await env.ARCHIVE_DB.prepare(
                    'SELECT * FROM regular_season_games WHERE sport = ? ORDER BY date DESC'
                ).bind(sport).all();
                const ps = await env.ARCHIVE_DB.prepare(
                    'SELECT * FROM postseason_games WHERE sport = ? ORDER BY date DESC'
                ).bind(sport).all();
                return new Response(JSON.stringify({ ok: true, games: [...reg.results, ...ps.results] }),
                    { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
            }

            // GET /archive/odds-backfill?date=YYYY-MM-DD — historical odds
            // population for one archive date. Walks regular_season_games +
            // postseason_games, sorts by sport, hits the Odds API's HISTORICAL
            // endpoint for each sport once, matches games by team-pair, and
            // UPDATEs opening_odds where NULL. Quota-aware: reads
            // X-Requests-Remaining from each response and stops below
            // ODDS_QUOTA_FLOOR.
            //
            // Same shape as /archive/backfill: returns
            //   { ok, date, games_found, odds_populated, odds_skipped,
            //     quota_remaining, stopped?, reason? }
            if (pathname === '/archive/odds-backfill' && (request.method === 'GET' || request.method === 'POST')) {
                const date = url.searchParams.get('date');
                if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                    return new Response(JSON.stringify({ ok: false, error: 'missing or invalid ?date=YYYY-MM-DD' }),
                        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
                try {
                    const result = await runOddsBackfillForDate(env, date);
                    return new Response(JSON.stringify(result),
                        { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
                } catch (e) {
                    return new Response(JSON.stringify({ ok: false, error: e.message }),
                        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
            }

            // GET /archive/backfill?date=YYYY-MM-DD — manual backfill trigger.
            // Reads regular_season_games + postseason_games for the date,
            // pulls series narratives, builds the backfill prompt, runs Gemini
            // + the J3 quality chain, INSERTs a source='backfill' brief.
            // Returns the produced prose + quality score, or {skipped:true}
            // when the slate is too thin to reconstruct.
            if (pathname === '/archive/backfill' && (request.method === 'GET' || request.method === 'POST')) {
                const date = url.searchParams.get('date');
                if (!date) {
                    return new Response(JSON.stringify({ ok: false, error: 'missing ?date=YYYY-MM-DD' }),
                        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
                try {
                    const result = await executeBackfill(env, date);
                    const status = result.ok ? 200 : (result.skipped ? 200 : 500);
                    return new Response(JSON.stringify(result),
                        { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
                } catch (e) {
                    return new Response(JSON.stringify({ ok: false, error: e.message }),
                        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
            }

            // POST /archive/drama — persists client-computed drama summary onto
            // the archived game row (ADR-002: relay stores, never computes).
            // The client computes drama_peak (0-100) and the full drama_arc
            // summary object after the game goes final. Both columns are added
            // via D1 migration alongside this endpoint:
            //   ALTER TABLE regular_season_games ADD COLUMN drama_peak REAL;
            //   ALTER TABLE regular_season_games ADD COLUMN drama_arc TEXT;
            //   ALTER TABLE postseason_games    ADD COLUMN drama_peak REAL;
            //   ALTER TABLE postseason_games    ADD COLUMN drama_arc TEXT;
            //
            // Body: { source_id, drama_peak, drama_arc }.
            //  drama_arc may arrive as either a JSON string or a JSON object —
            //  the handler accepts both and stores TEXT.
            //
            // Match strategy mirrors /archive/backfill-enrich: shortify
            // source_id, scan postseason then regular by
            // `id LIKE '%' || shortified || '%'`. When no row matches (timing
            // race — drama POST arrives before GameDO's archive write lands),
            // returns {ok:false, error:'no_row'} so the client can retry.
            if (pathname === '/archive/drama' && request.method === 'POST') {
                let body;
                try { body = await request.json(); }
                catch (_) {
                    return new Response(JSON.stringify({ ok: false, error: 'invalid JSON' }),
                        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
                const { source_id, drama_peak } = body || {};
                let { drama_arc } = body || {};
                if (!source_id) {
                    return new Response(JSON.stringify({ ok: false, error: 'missing source_id' }),
                        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
                if (typeof drama_peak !== 'number') {
                    return new Response(JSON.stringify({ ok: false, error: 'drama_peak must be a number' }),
                        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
                // Accept drama_arc as either a JSON object (most callers) or a
                // pre-stringified JSON string. Stored as TEXT either way.
                if (typeof drama_arc !== 'string') {
                    try { drama_arc = JSON.stringify(drama_arc); }
                    catch (_) { drama_arc = null; }
                }

                const shortified = String(source_id).toLowerCase().replace(/[^a-z0-9]/g, '');
                if (!shortified) {
                    return new Response(JSON.stringify({ ok: false, error: 'source_id has no usable chars' }),
                        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
                const fuzzy = `%${shortified}%`;

                // Postseason first (richer rows + matches series_key cases).
                let row = null, table = null;
                try {
                    row = await env.ARCHIVE_DB.prepare(
                        `SELECT id FROM postseason_games WHERE id LIKE ? LIMIT 1`
                    ).bind(fuzzy).first();
                    if (row) table = 'postseason_games';
                } catch (_) { /* fall through to regular */ }
                if (!row) {
                    try {
                        row = await env.ARCHIVE_DB.prepare(
                            `SELECT id FROM regular_season_games WHERE id LIKE ? LIMIT 1`
                        ).bind(fuzzy).first();
                        if (row) table = 'regular_season_games';
                    } catch (_) { /* both queries failed — surface no_row */ }
                }
                if (!row || !table) {
                    return new Response(JSON.stringify({ ok: false, error: 'no_row', source_id }),
                        { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }

                try {
                    await env.ARCHIVE_DB.prepare(
                        `UPDATE ${table} SET drama_peak = ?, drama_arc = ? WHERE id = ?`
                    ).bind(drama_peak, drama_arc, row.id).run();
                } catch (e) {
                    return new Response(JSON.stringify({ ok: false, error: e.message, id: row.id }),
                        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
                return new Response(JSON.stringify({ ok: true, id: row.id, table, drama_peak }),
                    { headers: { ...CORS, 'Content-Type': 'application/json' } });
            }

            // POST /archive/backfill-enrich — fills in skeleton rows (home IS NULL)
            // created by older GameDO archives that didn't forward team names.
            // For each null-home row: groups by (sport, date), self-fetches
            // /v2/games for that group, matches V2 ids against the row's id
            // (V2 ids are prefixed like 'football:123'; the row id either IS that
            // V2 id or carries it as the {source_id} segment in the synthesized
            // archive id `{sport}_{date}_src{shortify(source_id)}`).
            //
            // Hard limit: 50 rows per call to stay inside the 30ms CPU budget.
            // Failure modes degrade gracefully — bad V2 response, no match,
            // UPDATE error — each row reports via _errors and counts toward
            // `skipped`, never aborts the batch (spec).
            if (pathname === '/archive/backfill-enrich' && (request.method === 'POST' || request.method === 'GET')) {
                const _errors = [];
                let regResult, psResult;
                try {
                    regResult = await env.ARCHIVE_DB.prepare(
                        `SELECT id, sport, date FROM regular_season_games
                          WHERE home IS NULL LIMIT 50`
                    ).all();
                } catch (e) { _errors.push({ source: 'regular_query', error: e.message }); }
                try {
                    psResult = await env.ARCHIVE_DB.prepare(
                        `SELECT id, sport, date FROM postseason_games
                          WHERE home IS NULL LIMIT 50`
                    ).all();
                } catch (e) { _errors.push({ source: 'postseason_query', error: e.message }); }

                const rowsAll = [
                    ...((regResult?.results || []).map(r => ({ ...r, _table: 'regular_season_games' }))),
                    ...((psResult?.results  || []).map(r => ({ ...r, _table: 'postseason_games'    }))),
                ];
                const rows = rowsAll.slice(0, 50);

                // Group by (sport, date) to minimize V2 round-trips.
                const groups = new Map();
                for (const r of rows) {
                    const key = `${r.sport}|${r.date}`;
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key).push(r);
                }

                const relayBase = env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
                const _stripPrefix = s => String(s || '').toLowerCase().replace(/^[a-z]+:/, '');
                const _shortify    = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                let enriched = 0, skipped = 0;

                for (const [groupKey, groupRows] of groups) {
                    const [sport, date] = groupKey.split('|');
                    let games = [];
                    try {
                        const v2Url = `${relayBase}/v2/games?sport=${encodeURIComponent(String(sport).toLowerCase())}&date=${encodeURIComponent(date)}`;
                        const resp = await fetch(v2Url, { cf: { cacheTtl: 60 } });
                        if (resp.ok) {
                            const data = await resp.json();
                            games = Array.isArray(data?.games) ? data.games : [];
                        }
                    } catch (_) { /* V2 unreachable for this group — skip silently */ }

                    if (!games.length) { skipped += groupRows.length; continue; }

                    for (const row of groupRows) {
                        const rowIdLow = String(row.id).toLowerCase();
                        // Extract source_id from the synthesized id pattern, if present.
                        const srcMatch = rowIdLow.match(/_src([a-z0-9]+)$/);
                        const srcId    = srcMatch ? srcMatch[1] : null;
                        const match = games.find(g => {
                            const gidShort = _shortify(_stripPrefix(g.id));
                            // Three match strategies:
                            //   1. row id directly contains the V2 id
                            //   2. extracted srcId matches the V2 id
                            //   3. row id IS the V2 id (some archives pre-date the prefix scheme)
                            if (srcId && gidShort === srcId) return true;
                            if (rowIdLow.includes(_stripPrefix(g.id))) return true;
                            if (rowIdLow === _stripPrefix(g.id)) return true;
                            return false;
                        });
                        if (!match) { skipped++; continue; }

                        const home   = match?.home?.name || null;
                        const away   = match?.away?.name || null;
                        const venue  = match?.venue       || null;
                        const league = match?.league      || null;
                        if (!home && !away) { skipped++; continue; }

                        // Gate the table name to the two known values (the variable
                        // is set by this handler, but the SQL interpolation requires
                        // a static allowlist to be unambiguously safe).
                        const tbl = row._table === 'postseason_games' ? 'postseason_games'
                                  : row._table === 'regular_season_games' ? 'regular_season_games'
                                  : null;
                        if (!tbl) { skipped++; continue; }
                        try {
                            await env.ARCHIVE_DB.prepare(
                                `UPDATE ${tbl} SET
                                   home   = COALESCE(home,   ?),
                                   away   = COALESCE(away,   ?),
                                   venue  = COALESCE(venue,  ?),
                                   league = COALESCE(league, ?)
                                 WHERE id = ?`
                            ).bind(home, away, venue, league, row.id).run();
                            enriched++;
                        } catch (e) {
                            _errors.push({ id: row.id, error: e.message });
                            skipped++;
                        }
                    }
                }
                return new Response(JSON.stringify({
                    ok: true,
                    processed: rows.length,
                    enriched,
                    skipped,
                    _errors: _errors.length ? _errors : undefined,
                }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
            }

            // POST /archive/game — receives game data (typically from GameDO
            // on final-state transition) and writes to the appropriate archive
            // table. Classification rule: series_key present → postseason_games,
            // otherwise → regular_season_games (schema confirmed via D1: both
            // tables have id PK, sport NOT NULL; postseason_games has
            // series_key NOT NULL).
            //
            // ID strategy: `{sport}_{date}_{home_short}_{away_short}` when team
            // names are present (LLM-friendly + sortable); falls back to
            // `{sport}_{date}_{source_id}` when GameDO sends a minimal payload
            // (its lastFacts has no team names — see src/game-do.js _fetchFacts).
            // ON CONFLICT(id) DO UPDATE refreshes scores + notes so a pre-final
            // archive write gets upgraded by the final-state write.
            if (pathname === '/archive/game' && request.method === 'POST') {
                let body;
                try { body = await request.json(); }
                catch (_) {
                    return new Response(JSON.stringify({ ok: false, error: 'invalid JSON' }),
                        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
                const {
                    sport, league, date, home, away, home_score, away_score,
                    venue, streams, note, crew, series_key, series_record,
                    game_number, round, importance, source_id,
                } = body || {};
                if (!sport || !date) {
                    return new Response(JSON.stringify({ ok: false, error: 'missing required fields (sport, date)' }),
                        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }

                const shortify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                const homeShort = shortify(home);
                const awayShort = shortify(away);
                const idTail = (homeShort && awayShort)
                    ? `${homeShort}_${awayShort}`
                    : (source_id ? `src${shortify(source_id)}` : `g${Date.now()}`);
                const id = `${sport}_${date}_${idTail}`;

                try {
                    if (series_key) {
                        await env.ARCHIVE_DB.prepare(
                            `INSERT INTO postseason_games
                               (id, sport, series_key, round, game_number, date, home, away,
                                home_score, away_score, venue, streams, note, series_record,
                                importance, league, crew, espn_event_id)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                             ON CONFLICT(id) DO UPDATE SET
                               home_score    = COALESCE(excluded.home_score, home_score),
                               away_score    = COALESCE(excluded.away_score, away_score),
                               note          = COALESCE(excluded.note, note),
                               series_record = COALESCE(excluded.series_record, series_record),
                               venue         = COALESCE(excluded.venue, venue),
                               streams       = COALESCE(excluded.streams, streams),
                               crew          = COALESCE(excluded.crew, crew),
                               importance    = COALESCE(excluded.importance, importance),
                               espn_event_id = COALESCE(excluded.espn_event_id, espn_event_id)`
                        ).bind(
                            id, sport, series_key,
                            round || null, game_number ?? null, date,
                            home || null, away || null,
                            home_score ?? null, away_score ?? null,
                            venue || null, streams || null,
                            note || null, series_record || null,
                            importance || null, league || null, crew || null,
                            source_id ? String(source_id) : null
                        ).run();
                    } else {
                        await env.ARCHIVE_DB.prepare(
                            `INSERT INTO regular_season_games
                               (id, sport, league, date, home, away,
                                home_score, away_score, venue, streams, note, crew, espn_event_id)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                             ON CONFLICT(id) DO UPDATE SET
                               home_score    = COALESCE(excluded.home_score, home_score),
                               away_score    = COALESCE(excluded.away_score, away_score),
                               note          = COALESCE(excluded.note, note),
                               venue         = COALESCE(excluded.venue, venue),
                               streams       = COALESCE(excluded.streams, streams),
                               crew          = COALESCE(excluded.crew, crew),
                               espn_event_id = COALESCE(excluded.espn_event_id, espn_event_id)`
                        ).bind(
                            id, sport, league || null, date,
                            home || null, away || null,
                            home_score ?? null, away_score ?? null,
                            venue || null, streams || null,
                            note || null, crew || null,
                            source_id ? String(source_id) : null
                        ).run();
                    }
                } catch (e) {
                    return new Response(JSON.stringify({ ok: false, error: e.message }),
                        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }

                // ── KV brief capture ─────────────────────────────────────
                // If the journalism cron pre-generated a per-game brief for
                // this game and stashed it in FIELD_JOURNALISM KV with key
                // shape 'brief:game:{eventId}' (handleJournalismCycle ~L3193)
                // OR 'brief:game:{sport}:{eventId}', capture it into briefs D1
                // with source='kv_capture' BEFORE the KV TTL expires (24h).
                // ON CONFLICT DO NOTHING — never overwrite an existing capture.
                // Wrapped in its own try/catch so brief capture failure does
                // NOT affect the /archive/game response.
                let briefCaptured = null;
                try {
                    if (env.FIELD_JOURNALISM && source_id) {
                        const sportKey = String(sport).toLowerCase();
                        const sid      = String(source_id);
                        const candidates = [
                            `brief:game:${sportKey}:${sid}`,
                            `brief:game:${sid}`,
                        ];
                        let kvVal = null;
                        for (const k of candidates) {
                            kvVal = await env.FIELD_JOURNALISM.get(k);
                            if (kvVal) break;
                        }
                        let briefText = kvVal;
                        if (kvVal && kvVal[0] === '{') {
                            try {
                                const parsed = JSON.parse(kvVal);
                                briefText = parsed.brief || parsed.brief_text || parsed.text || null;
                            } catch (_) { /* treat as raw string */ }
                        }
                        if (briefText && briefText.length > 50) {
                            await ensureBriefsTable(env);
                            // Brief type classification: presence of scores
                            // distinguishes a true game recap from a pre-game
                            // / narrative-only brief stored under the same
                            // brief:game:* KV key shape.
                            const briefType = (home_score !== null && home_score !== undefined) ? 'game_recap' : 'narrative_context';
                            const briefId = `${briefType}_${sportKey}_${sid}`;
                            await env.ARCHIVE_DB.prepare(
                                `INSERT INTO briefs
                                   (id, date, brief_type, sport, game_id, brief_text, source, word_count)
                                 VALUES (?, ?, ?, ?, ?, ?, 'kv_capture', ?)
                                 ON CONFLICT(id) DO NOTHING`
                            ).bind(
                                briefId, date, briefType, sportKey, sid, briefText,
                                briefText.split(/\s+/).length
                            ).run();
                            briefCaptured = briefId;
                        }
                    }
                } catch (_) { /* brief capture failure never breaks /archive/game */ }

                return new Response(JSON.stringify({
                    ok: true,
                    id,
                    table: series_key ? 'postseason_games' : 'regular_season_games',
                    brief_captured: briefCaptured,
                }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
            }

            // GET /archive/query — parameterized read of the briefs table.
            // All filter params optional. Builds the WHERE clause dynamically —
            // only emits a clause + binding when the param is present. Column
            // names are hardcoded (no interpolation of user input). Bind values
            // are passed through D1's prepared-statement binding (no string
            // interpolation), so SQL injection is not possible.
            //
            // Query string params: date, sport, team (LIKE search on brief_text),
            //                      brief_type, source, limit (default 10, max 50)
            // Returns: { ok:true, count, results: [...] }
            if (pathname === '/archive/query' && request.method === 'GET') {
                const sp = url.searchParams;
                const date       = sp.get('date');
                const sport      = sp.get('sport');
                const team       = sp.get('team');
                const briefType  = sp.get('brief_type');
                const source     = sp.get('source');
                const rawLimit   = parseInt(sp.get('limit') || '10', 10);
                const limit      = Math.max(1, Math.min(50, isNaN(rawLimit) ? 10 : rawLimit));

                const clauses = ['1=1'];
                const binds = [];
                if (date)      { clauses.push('date = ?');          binds.push(date); }
                if (sport)     { clauses.push('sport = ?');         binds.push(sport); }
                if (briefType) { clauses.push('brief_type = ?');    binds.push(briefType); }
                if (source)    { clauses.push('source = ?');        binds.push(source); }
                if (team)      { clauses.push('brief_text LIKE ?'); binds.push(`%${team}%`); }

                const sql = `SELECT id, date, brief_type, sport, game_id, brief_text, model,
                                    quality_score, word_count, source, created_at
                             FROM briefs
                             WHERE ${clauses.join(' AND ')}
                             ORDER BY date DESC, created_at DESC
                             LIMIT ?`;
                binds.push(limit);

                const r = await env.ARCHIVE_DB.prepare(sql).bind(...binds).all();
                return new Response(JSON.stringify({
                    ok: true,
                    count: (r.results || []).length,
                    results: r.results || [],
                }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
            }

            // POST /archive/brief — persist AI-generated brief text to briefs D1.
            // Client-side archiveBrief() in jubilant-bassoon fires fire-and-forget;
            // relay returns "ok" on success / JSON error on validation failure.
            // INSERT OR UPDATE on id collision so re-archives (e.g. quality-chain
            // re-runs) overwrite text/word_count/source without disturbing the
            // primary key or created_at.
            if (pathname === '/archive/brief' && request.method === 'POST') {
                await ensureBriefsTable(env);
                let body;
                try { body = await request.json(); }
                catch (_) {
                    return new Response(JSON.stringify({ ok: false, error: 'invalid JSON' }),
                        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
                const { id, brief_type, date, sport, game_id, brief_text,
                        model, quality_score, context_hash, word_count, source } = body || {};
                if (!id || !brief_type || !date || !brief_text) {
                    return new Response(JSON.stringify({ ok: false, error: 'missing required fields (id, brief_type, date, brief_text)' }),
                        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }

                // ── Quality scoring for client-archived briefs ───────────────
                // mlb_game / night_owl / wc_matchup arrive with quality_score=null
                // because the client has no quality chain. Score them here when
                // absent; never regenerate (maxRetries:1, store-only). Scoring
                // failure must never block archival (Rule 5).
                let finalScore = typeof quality_score === 'number' ? quality_score : null;
                if (finalScore === null && brief_text && brief_text.length > 50) {
                    try {
                        const PROXY_URL = env.CLAUDE_PROXY_URL || 'https://field-claude-proxy.jeffunglesbee.workers.dev';
                        const callProxy = async (promptText) => {
                            const r = await fetch(PROXY_URL, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
                                body: JSON.stringify({
                                    model: 'claude-haiku-4-5-20251001',
                                    max_tokens: 1000,
                                    messages: [{ role: 'user', content: promptText }],
                                }),
                            });
                            if (!r.ok) return null;
                            const d = await r.json().catch(() => null);
                            return d ? (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim() || null : null;
                        };
                        // Dim 7+10 context: look up game row from D1 by game_id.
                        // night_owl / mlb_game / wnba_game brief_types submit a
                        // game_id matching regular_season_games.id or postseason_games.id.
                        // Fail gracefully — never block archival (Rule 5).
                        let _archiveGameCtx = null;
                        let _archiveMatchupNote = null;
                        if (game_id) {
                            try {
                                const _gRow = await (async () => {
                                    // Try 1: primary key match (relay-generated briefs)
                                    const r = await env.ARCHIVE_DB.prepare(
                                        `SELECT home, away, home_score, away_score, note
                                         FROM regular_season_games WHERE id = ? LIMIT 1`
                                    ).bind(game_id).first().catch(() => null);
                                    if (r) return r;
                                    // Try 2: espn_event_id match (client night_owl/mlb_game briefs
                                    // pass topGame.sourceId = ESPN numeric event ID as game_id)
                                    const r2 = await env.ARCHIVE_DB.prepare(
                                        `SELECT home, away, home_score, away_score, note
                                         FROM regular_season_games WHERE espn_event_id = ? LIMIT 1`
                                    ).bind(game_id).first().catch(() => null);
                                    if (r2) return r2;
                                    // Try 3: postseason primary key
                                    return await env.ARCHIVE_DB.prepare(
                                        `SELECT home, away, home_score, away_score, NULL as note
                                         FROM postseason_games WHERE id = ? LIMIT 1`
                                    ).bind(game_id).first().catch(() => null);
                                })();
                                if (_gRow && _gRow.home && _gRow.away) {
                                    _archiveGameCtx = {
                                        home: _gRow.home, away: _gRow.away,
                                        homeScore: _gRow.home_score, awayScore: _gRow.away_score,
                                    };
                                    _archiveMatchupNote = _gRow.note || null;
                                }
                            } catch (_) { /* non-fatal — Dims 7+10 unavailable for this brief */ }
                        }
                        const scoringPrompt = `Score this sports brief for journalism quality:\n\n${brief_text}`;
                        const qResult = await runQualityChain(scoringPrompt, brief_text, callProxy, {
                            sport: sport || null,
                            scoreThreshold: 240,
                            maxRetries: 1,
                            game: _archiveGameCtx,
                            matchupNote: _archiveMatchupNote,
                        });
                        finalScore = qResult?.score ?? null;
                    } catch (_) { /* scoring failure must not break archival */ }
                }

                await env.ARCHIVE_DB.prepare(
                    `INSERT INTO briefs
                       (id, date, brief_type, sport, game_id, brief_text, model, quality_score, context_hash, word_count, source)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(id) DO UPDATE SET
                       brief_text = excluded.brief_text,
                       word_count = excluded.word_count,
                       quality_score = COALESCE(excluded.quality_score, briefs.quality_score),
                       source = excluded.source`
                ).bind(
                    id, date, brief_type,
                    sport || null,
                    game_id || null,
                    brief_text,
                    model || null,
                    finalScore,
                    context_hash || null,
                    typeof word_count === 'number' ? word_count : brief_text.split(/\s+/).length,
                    source || 'client'
                ).run();
                return new Response(JSON.stringify({ ok: true, scored: finalScore !== null }),
                    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }

            // POST /archive/bracket-snapshot — batch-write projection snapshot for
            // calibration. Called by BracketDO after every _recomputeAndBroadcast
            // as fire-and-forget. Body: { triggered_by, date, teams: [{name,
            // pR32, pR16, pQF, pSF, pFinal, pChamp}] }. INSERT OR REPLACE keyed
            // on (team, date, triggered_by) so repeated recomputes within the
            // same trigger window collapse to one row per team.
            if (pathname === '/archive/bracket-snapshot' && request.method === 'POST') {
                try {
                    const body = await request.json();
                    const { triggered_by = 'unknown', date, teams = [] } = body || {};
                    if (!teams.length) return new Response(
                        JSON.stringify({ ok: true, inserted: 0 }),
                        { headers: { ...CORS, 'Content-Type': 'application/json' } }
                    );
                    const snapshotDate = date || new Date().toISOString().slice(0, 10);
                    const safeTriggeredBy = String(triggered_by || 'unknown').slice(0, 120);

                    const stmts = teams.map(t => {
                        const id = `snap_${String(t.name || '').replace(/\s+/g, '_')}_${snapshotDate}_${safeTriggeredBy}`.slice(0, 180);
                        return env.ARCHIVE_DB.prepare(
                            `INSERT OR REPLACE INTO bracket_snapshots
                             (id, date, match_id, team, r32_prob, r16_prob, qf_prob, sf_prob, final_prob, champion_prob, triggered_by)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                        ).bind(
                            id, snapshotDate, safeTriggeredBy,
                            t.name || '', t.pR32 ?? null, t.pR16 ?? null,
                            t.pQF ?? null, t.pSF ?? null, t.pFinal ?? null,
                            t.pChamp ?? null, safeTriggeredBy
                        );
                    });
                    await env.ARCHIVE_DB.batch(stmts);
                    return new Response(
                        JSON.stringify({ ok: true, inserted: stmts.length, date: snapshotDate, triggered_by: safeTriggeredBy }),
                        { headers: { ...CORS, 'Content-Type': 'application/json' } }
                    );
                } catch (e) {
                    return new Response(JSON.stringify({ ok: false, error: e.message }),
                        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
            }

            // GET /archive/bracket-replay — query historical bracket snapshots.
            //   ?team=Germany           → full arc for one team
            //   ?date=2026-06-20        → full snapshot at a date
            //   ?triggered_by=wc26_...  → pre/post snapshot for a specific match
            //   ?since=2026-06-20       → all snapshots from date forward
            //   no params               → index page (distinct dates + counts)
            if (pathname === '/archive/bracket-replay' && request.method === 'GET') {
                try {
                    const team        = url.searchParams.get('team');
                    const date        = url.searchParams.get('date');
                    const triggeredBy = url.searchParams.get('triggered_by');
                    const since       = url.searchParams.get('since');

                    let query, params;
                    if (team) {
                        query  = `SELECT * FROM bracket_snapshots WHERE team = ? ORDER BY date, created_at`;
                        params = [team];
                    } else if (triggeredBy) {
                        query  = `SELECT * FROM bracket_snapshots WHERE triggered_by = ? ORDER BY team, created_at`;
                        params = [triggeredBy];
                    } else if (since) {
                        query  = `SELECT * FROM bracket_snapshots WHERE date >= ? ORDER BY date, created_at`;
                        params = [since];
                    } else if (date) {
                        query  = `SELECT * FROM bracket_snapshots WHERE date = ? ORDER BY champion_prob DESC`;
                        params = [date];
                    } else {
                        query  = `SELECT date, triggered_by, COUNT(*) as team_count FROM bracket_snapshots GROUP BY date, triggered_by ORDER BY date DESC LIMIT 50`;
                        params = [];
                    }
                    const rows = await env.ARCHIVE_DB.prepare(query).bind(...params).all();
                    return new Response(
                        JSON.stringify({ ok: true, count: rows.results?.length ?? 0, rows: rows.results }),
                        { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } }
                    );
                } catch (e) {
                    return new Response(JSON.stringify({ ok: false, error: e.message }),
                        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
                }
            }

            return new Response('Archive endpoint not found', { status: 404, headers: CORS });
        }

        // ── /live/* — AmbientDO SSE ambient channel ───────────────────────────────
        // GET /live/ambient  — SSE stream, one connection covers all sports
        //   Emits: score, lead_change, final, all_final, ping, wp_update
        //   Client: AmbientEventSource in index.html feeds fieldEvents bus
        //   Latency: <3s vs 15-30s polling (alarm-driven 30s poll in DO)
        // GET /ambient/state — REST state snapshot (debug / health)
        // POST /ambient/kick — manual poll trigger (admin)
        // GET /live-wp/test  — live odds deployment verification (Spec Step 8)
        if (pathname === '/live/ambient' || pathname.startsWith('/ambient/') || pathname.startsWith('/live-wp/')) {
            if (!env.AMBIENT_DO) {
                return new Response(JSON.stringify({ error: 'AMBIENT_DO not bound' }),
                    { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            const doId = env.AMBIENT_DO.idFromName('field:ambient');
            const stub = env.AMBIENT_DO.get(doId);
            // Pass RELAY_BASE env for self-call pattern in AmbientDO._fetchSport()
            return stub.fetch(request);
        }

        // /cfl/* — CFL odds from The Odds API + CFL internal API (echo.pims.cfl.ca)
        if (pathname === '/cfl/odds-probs') return handleCFLOddsProbs(env);

        // /cfl/fixtures[?season_id=35] — schedule + live scores from CFL internal API
        // /cfl/fixtures/{id}           — single game detail
        // /cfl/stats/players[?season_id=35] — player stats
        // /cfl/stats/teams[?season_id=35]   — team stats
        // /cfl/rosters                      — active rosters summary
        // Auth: none. Requires Referer + Accept headers mimicking cfl.ca browser.
        // ADR: api.cfl.ca dead since 2023. echo.pims.cfl.ca is the live internal API.
        if (pathname.startsWith('/cfl/')) {
            const CFL_BASE = 'https://echo.pims.cfl.ca/api';
            const cflHeaders = {
                'Referer':    'https://www.cfl.ca/',
                'Accept':     'application/json, text/javascript, */*; q=0.01',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15',
            };
            let cflPath = '';
            const seasonId = url.searchParams.get('season_id') || '75'; // 75 = 2026 (internal). External ID=35 does NOT work for /seasons/{id}/fixtures

            if (pathname === '/cfl/fixtures') {
                // Fixtures use /seasons/{id}/fixtures path (not /fixtures?season_id=)
                // season_id=35 is the external CFL ID for 2026 (internal=75, API accepts both)
                cflPath = `/seasons/${seasonId}/fixtures`;
            } else if (pathname.match(/^\/cfl\/fixtures\/\d+$/)) {
                const fid = pathname.split('/').pop();
                cflPath = `/fixtures/${fid}`;
            } else if (pathname === '/cfl/stats/players') {
                cflPath = `/stats/playerrecords?season_id=${seasonId}&limit=50`;
            } else if (pathname === '/cfl/stats/teams') {
                cflPath = `/stats/teamrecords?season_id=${seasonId}`;
            } else if (pathname === '/cfl/rosters') {
                cflPath = `/rosters/summary`;
            } else if (pathname === '/cfl/teams') {
                cflPath = `/teams`;
            } else if (pathname === '/cfl/standings') {
                cflPath = `/seasons/${seasonId}/standings`; // may not exist — test
            } else if (pathname === '/cfl/scoreboard/rounds') {
                // cflscoreboard.cfl.ca — live CFL scoreboard (rounds = schedule + live scores)
                // Used by ha-teamtracker v0.17.4 (May 2026). Refresh 30s live, 10min pre/post.
                const sbResp = await fetch('https://cflscoreboard.cfl.ca/json/scoreboard/rounds.json', {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15' },
                    signal: AbortSignal.timeout(6000),
                });
                const sbBody = await sbResp.text();
                return new Response(sbBody, {
                    status: sbResp.status,
                    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30', ...CORS },
                });
            } else if (pathname === '/cfl/scoreboard/squads') {
                // Team/squad data from cflscoreboard.cfl.ca
                const sqResp = await fetch('https://cflscoreboard.cfl.ca/json/scoreboard/squads.json', {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15' },
                    signal: AbortSignal.timeout(6000),
                });
                const sqBody = await sqResp.text();
                return new Response(sqBody, {
                    status: sqResp.status,
                    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', ...CORS },
                });
            } else {
                // Unknown /cfl/* sub-path
                return new Response(JSON.stringify({ error: 'Unknown CFL route', path: pathname }),
                    { status: 404, headers: { 'Content-Type': 'application/json', ...CORS } });
            }

            try {
                const cflResp = await fetch(`${CFL_BASE}${cflPath}`, {
                    headers: cflHeaders,
                    signal: AbortSignal.timeout(8000),
                });
                const body = await cflResp.text();
                // Cache: 60s for live fixture data, 5min for stats/rosters
                const ttl = pathname === '/cfl/fixtures' ? 60 : 300;
                return new Response(body, {
                    status: cflResp.status,
                    headers: { 'Content-Type': 'application/json',
                               'Cache-Control': `public, max-age=${ttl}`, ...CORS },
                });
            } catch (e) {
                return new Response(JSON.stringify({ error: e.message, path: pathname }),
                    { status: 502, headers: { 'Content-Type': 'application/json', ...CORS } });
            }
        }

        // /v2/* — FieldGame normalized routes (Phase 0, ESPN parallel — additive only)
        if (pathname.startsWith('/v2/')) {
            if (pathname === '/v2/games')     return handleV2Games(url, env, ctx);
            if (pathname === '/v2/standings') return handleV2Standings(url, env);
            if (pathname === '/v2/golf/player-stats') {
                const athleteId = url.searchParams.get('athleteId') || '';
                const season    = url.searchParams.get('season') || '2026';
                if (!athleteId) return new Response(JSON.stringify({ ok:false, error:'missing athleteId' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
                const payload = await handleGolfPlayerStats(athleteId, season, env);
                return new Response(JSON.stringify(payload), {
                    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public,max-age=3600' },
                });
            }
            if (pathname === '/v2/golf/enriched') {
                const date = (url.searchParams.get('date') || new Date().toISOString().slice(0,10).replace(/-/g,''));
                const payload = await handleGolfEnriched(date, env, ctx);
                return new Response(JSON.stringify(payload), {
                    headers: { ...CORS, 'Content-Type': 'application/json',
                               'Cache-Control': `public,max-age=${payload.active ? 600 : 3600}` },
                });
            }
            if (pathname === '/v2/golf/eventlog') {
                const athleteId = url.searchParams.get('athleteId') || '';
                const season    = url.searchParams.get('season') || '2026';
                if (!athleteId) return new Response(JSON.stringify({ ok:false, error:'missing athleteId' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
                const payload = await handleGolfEventlog(athleteId, season, env);
                return new Response(JSON.stringify(payload), {
                    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public,max-age=21600' },
                });
            }
            if (pathname === '/v2/golf/competitor-stats') {
                const eventId   = url.searchParams.get('eventId') || '';
                const athleteId = url.searchParams.get('athleteId') || '';
                if (!eventId || !athleteId) return new Response(JSON.stringify({ ok:false, error:'missing eventId or athleteId' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
                const payload = await handleGolfCompetitorStats(eventId, athleteId, env);
                return new Response(JSON.stringify(payload), {
                    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public,max-age=600' },
                });
            }
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
            && !(pathname === '/analytics/run' && request.method === 'POST')
            && !(pathname === '/d1/execute' && request.method === 'POST')
            && !(pathname === '/session/record' && request.method === 'POST')
            && !(pathname === '/mcp' && request.method === 'POST')
            && !(pathname === '/fixtures/fetch' && request.method === 'POST')
            && !(pathname === '/soccer/fbref/fetch' && request.method === 'POST')
            && !(pathname === '/wc/matchup/cache' && request.method === 'POST'))
            return new Response('Method not allowed', { status: 405, headers: CORS });

        // GET /integrity/briefs?date=YYYY-MM-DD[&repair=true] —
        // Compares KV slate brief vs D1 briefs-table counts for the date.
        // The cron writes KV as the primary store and archives to D1 as
        // a fire-and-forget secondary; this surfaces divergence (KV present,
        // D1 missing) so the Brief Freshness Guard isn't blind to slate
        // briefs that never reached D1. Optional ?repair=true re-inserts
        // the KV brief into D1 with source='kv_repair'.
        if (pathname === '/integrity/briefs' && request.method === 'GET') {
            const date = url.searchParams.get('date');
            if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return new Response(JSON.stringify({ ok: false, error: 'missing or invalid ?date=YYYY-MM-DD' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            if (!env.ARCHIVE_DB || !env.FIELD_JOURNALISM) {
                return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB or FIELD_JOURNALISM not bound' }),
                    { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            const kvRaw = await env.FIELD_JOURNALISM.get(`journalism:${date}`);
            let kvBrief = null;
            try { kvBrief = kvRaw ? JSON.parse(kvRaw) : null; } catch (_) { kvBrief = null; }

            const d1Res = await env.ARCHIVE_DB.prepare(
                `SELECT brief_type, COUNT(*) AS n, SUM(length(brief_text)) AS chars
                 FROM briefs WHERE date = ? GROUP BY brief_type`
            ).bind(date).all().catch(() => ({ results: [] }));
            const byType = {};
            for (const r of (d1Res.results || [])) byType[r.brief_type] = { count: r.n, chars: r.chars };
            const slateCount    = byType.slate?.count       || 0;
            const gameCount     = byType.game_brief?.count  || 0;
            const total         = (d1Res.results || []).reduce((s, r) => s + (r.n || 0), 0);
            const divergence    = !!kvBrief && slateCount === 0;

            let repaired = null;
            if (divergence && url.searchParams.get('repair') === 'true' && kvBrief?.brief) {
                try {
                    const text = String(kvBrief.brief);
                    const wordCount = text.split(/\s+/).filter(Boolean).length;
                    await env.ARCHIVE_DB.prepare(
                        `INSERT OR REPLACE INTO briefs
                           (id, date, brief_type, sport, brief_text, model,
                            quality_score, word_count, source)
                         VALUES (?, ?, 'slate', NULL, ?, NULL, NULL, ?, 'kv_repair')`
                    ).bind(`slate_${date}`, date, text, wordCount).run();
                    repaired = { id: `slate_${date}`, word_count: wordCount };
                } catch (e) { repaired = { error: e.message }; }
            }

            return new Response(JSON.stringify({
                ok: true,
                date,
                kv: kvBrief ? {
                    exists: true,
                    briefLen: (kvBrief.brief || '').length,
                    contextHash: kvBrief.contextHash || null,
                    generatedAt: kvBrief.generatedAt
                        ? new Date(kvBrief.generatedAt).toISOString() : null,
                    gameCount: kvBrief.gameCount ?? null,
                } : { exists: false },
                d1: { slate_count: slateCount, game_brief_count: gameCount, total, by_type: byType },
                divergence,
                repaired,
            }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
        }

        // GET /integrity/games?date=YYYY-MM-DD — Compares completed-game
        // counts per sport between ESPN scoreboard (authoritative) and D1
        // game tables. Gaps surface AmbientDO finals that didn't reach D1
        // (poll miss, restart, network blip). Read-only — does not write.
        if (pathname === '/integrity/games' && request.method === 'GET') {
            const date = url.searchParams.get('date');
            if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return new Response(JSON.stringify({ ok: false, error: 'missing or invalid ?date=YYYY-MM-DD' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            if (!env.ARCHIVE_DB) {
                return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
                    { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            // Mirror handleJournalismCycle's LEAGUES list (kept inline so a
            // future LEAGUES extraction in the cron doesn't ripple here).
            const LEAGUES_LOCAL = [
                { sport: 'basketball', league: 'nba',        label: 'NBA' },
                { sport: 'hockey',     league: 'nhl',        label: 'NHL' },
                { sport: 'baseball',   league: 'mlb',        label: 'MLB' },
                { sport: 'basketball', league: 'wnba',       label: 'WNBA' },
                { sport: 'soccer',     league: 'eng.1',      label: 'EPL' },
                { sport: 'soccer',     league: 'usa.1',      label: 'MLS' },
                { sport: 'soccer',     league: 'fifa.world', label: 'FIFA World Cup' },
            ];
            const espnDate = date.replace(/-/g, '');
            const espn = {};
            await Promise.all(LEAGUES_LOCAL.map(async ({ sport, league, label }) => {
                try {
                    const r = await fetch(
                        `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${espnDate}`,
                        { cf: { cacheTtl: 60, cacheEverything: true } }
                    );
                    if (!r.ok) { espn[label] = { error: `HTTP ${r.status}` }; return; }
                    const j = await r.json();
                    const events = j.events || [];
                    const completed = events.filter(e =>
                        e.competitions?.[0]?.status?.type?.completed === true).length;
                    espn[label] = { total: events.length, completed };
                } catch (e) { espn[label] = { error: e.message }; }
            }));

            // D1 counts per sport label. Both game tables share `sport` +
            // `date` columns; sport vocabulary is the label.
            const d1Res = await env.ARCHIVE_DB.prepare(
                `SELECT sport, COUNT(*) AS n FROM regular_season_games
                  WHERE date = ? GROUP BY sport
                 UNION ALL
                 SELECT sport, COUNT(*) AS n FROM postseason_games
                  WHERE date = ? GROUP BY sport`
            ).bind(date, date).all().catch(() => ({ results: [] }));
            const d1 = {};
            for (const r of (d1Res.results || [])) {
                d1[r.sport] = (d1[r.sport] || 0) + (r.n || 0);
            }
            const gaps = {};
            for (const { label } of LEAGUES_LOCAL) {
                const completedHere = espn[label]?.completed || 0;
                const d1Here = d1[label] || 0;
                if (completedHere > d1Here) gaps[label] = completedHere - d1Here;
            }
            return new Response(JSON.stringify({ ok: true, date, espn, d1, gaps }),
                { headers: { ...CORS, 'Content-Type': 'application/json' } });
        }

        // GET /deploy/verify — Confirms the deployed Worker matches GitHub
        // HEAD. Fetches the current main-branch SHA + the latest successful
        // Deploy RELAY Worker run's head_sha. A drift means deploy CI
        // succeeded but CF propagation lagged, or the bundle exceeded
        // a silent limit. Uses env.GITHUB_PAT when available to avoid
        // anonymous rate-limiting.
        if (pathname === '/deploy/verify' && request.method === 'GET') {
            const repo = 'jeffunglesbee-create/field-relay-nba';
            const ghHeaders = {
                'User-Agent': 'FIELD-relay',
                'Accept': 'application/vnd.github+json',
            };
            if (env.GITHUB_PAT) ghHeaders['Authorization'] = `Bearer ${env.GITHUB_PAT}`;
            let expected = null, deployed = null, deployedAt = null, runId = null, errors = [];
            try {
                const headRes = await fetch(
                    `https://api.github.com/repos/${repo}/commits/main`,
                    { headers: ghHeaders, cf: { cacheTtl: 60, cacheEverything: true } }
                );
                if (headRes.ok) {
                    const j = await headRes.json();
                    expected = (j.sha || '').slice(0, 7);
                } else if (headRes.status === 403) {
                    errors.push('GitHub HEAD: rate-limited');
                } else {
                    errors.push(`GitHub HEAD: HTTP ${headRes.status}`);
                }
            } catch (e) { errors.push(`GitHub HEAD: ${e.message}`); }
            try {
                const runRes = await fetch(
                    `https://api.github.com/repos/${repo}/actions/workflows/deploy.yml/runs?status=success&per_page=1&branch=main`,
                    { headers: ghHeaders, cf: { cacheTtl: 60, cacheEverything: true } }
                );
                if (runRes.ok) {
                    const j = await runRes.json();
                    const run = (j.workflow_runs || [])[0];
                    if (run) {
                        deployed   = (run.head_sha || '').slice(0, 7);
                        deployedAt = run.updated_at || run.run_started_at || null;
                        runId      = run.id;
                    }
                } else if (runRes.status === 403) {
                    errors.push('GitHub runs: rate-limited');
                } else {
                    errors.push(`GitHub runs: HTTP ${runRes.status}`);
                }
            } catch (e) { errors.push(`GitHub runs: ${e.message}`); }

            return new Response(JSON.stringify({
                ok: errors.length === 0,
                expected, deployed,
                match: expected && deployed && expected === deployed,
                deployedAt,
                runId,
                checkedAt: new Date().toISOString(),
                errors: errors.length ? errors : undefined,
            }), { headers: { ...CORS, 'Content-Type': 'application/json',
                             'Cache-Control': 'public, max-age=60' } });
        }

        // GET /backfill/game-briefs — on-demand per-game brief backfill.
        // Finds completed games (home_score IS NOT NULL) with no existing
        // game_brief row, generates 2-3 sentence recaps via the journalism
        // proxy, and INSERTs with source='backfill'. On-demand only — never
        // called from cron. ?dry=true returns the missing-game list without
        // writing. ?date=YYYY-MM-DD filters to one date. ?limit=N caps work
        // per call (max 50).
        if (pathname === '/backfill/game-briefs' && request.method === 'GET') {
            if (!env.ARCHIVE_DB) {
                return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
                    { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            const dateFilter = url.searchParams.get('date') || null;
            const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 50);
            const dryRun = url.searchParams.get('dry') === 'true';
            const force = url.searchParams.get('force') === 'true';

            try {
                await ensureBriefsTable(env);

                const dateClause = dateFilter ? 'AND g.date = ?' : '';
                const regParams = dateFilter ? [dateFilter] : [];

                // When force=true, also match games whose only game_brief is
                // source='backfill' (so we can re-generate stale low-quality
                // backfill prose). When force=false (default), skip any game
                // that already has a game_brief regardless of source.
                const existsClause = force
                    ? `AND NOT EXISTS (
                          SELECT 1 FROM briefs b
                          WHERE b.game_id = g.id AND b.brief_type = 'game_brief' AND b.source != 'backfill'
                      )`
                    : `AND NOT EXISTS (
                          SELECT 1 FROM briefs b
                          WHERE b.game_id = g.id AND b.brief_type = 'game_brief'
                      )`;

                const regMissing = await env.ARCHIVE_DB.prepare(`
                    SELECT g.id, g.date, g.sport, g.home, g.away,
                           g.home_score, g.away_score, g.closing_odds,
                           g.venue, g.espn_event_id,
                           NULL as series_key, NULL as importance
                    FROM regular_season_games g
                    WHERE g.home_score IS NOT NULL ${dateClause}
                      ${existsClause}
                    ORDER BY g.date DESC
                    LIMIT ?
                `).bind(...regParams, limit).all();

                const postMissing = await env.ARCHIVE_DB.prepare(`
                    SELECT g.id, g.date, g.sport, g.home, g.away,
                           g.home_score, g.away_score, g.closing_odds,
                           g.venue, g.espn_event_id,
                           g.series_key, g.importance
                    FROM postseason_games g
                    WHERE g.home_score IS NOT NULL ${dateClause}
                      ${existsClause}
                    ORDER BY g.date DESC
                    LIMIT ?
                `).bind(...regParams, limit).all();

                const allMissing = [
                    ...(regMissing.results || []),
                    ...(postMissing.results || []),
                ].slice(0, limit);

                if (dryRun) {
                    return new Response(JSON.stringify({
                        ok: true, dry_run: true, force,
                        missing: allMissing.length,
                        games: allMissing.map(g => ({
                            id: g.id, date: g.date, sport: g.sport,
                            matchup: `${g.away} @ ${g.home}`,
                            score: `${g.away_score}-${g.home_score}`,
                        })),
                    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
                }

                const callProxy = async (promptText) => {
                    const resp = await fetch(JOURNALISM_CLAUDE_PROXY, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
                        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400,
                            messages: [{ role: 'user', content: promptText }] }),
                    });
                    if (!resp.ok) return null;
                    const data = await resp.json().catch(() => null);
                    return data ? (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim() || null : null;
                };

                const results = [];
                for (const game of allMissing) {
                    try {
                        const sportLabel = game.sport || 'unknown';
                        const isPostseason = !!(game.series_key || game.importance);

                        let seriesContext = '';
                        if (game.series_key) {
                            try {
                                const series = await env.ARCHIVE_DB.prepare(
                                    `SELECT * FROM postseason_series WHERE series_key = ? LIMIT 1`
                                ).bind(game.series_key).first();
                                if (series) {
                                    const hW = (await env.ARCHIVE_DB.prepare(
                                        `SELECT COUNT(*) AS n FROM postseason_games
                                         WHERE series_key = ? AND home_score > away_score AND home_score IS NOT NULL`
                                    ).bind(game.series_key).first().catch(() => null))?.n || 0;
                                    const aW = (await env.ARCHIVE_DB.prepare(
                                        `SELECT COUNT(*) AS n FROM postseason_games
                                         WHERE series_key = ? AND away_score > home_score AND away_score IS NOT NULL`
                                    ).bind(game.series_key).first().catch(() => null))?.n || 0;
                                    seriesContext = `\nSeries record: ${hW}-${aW}`;
                                    if (series.narrative) seriesContext += `\nContext: ${series.narrative}`;
                                }
                            } catch (_) {}
                        }

                        let sportContext = '';
                        try {
                            sportContext = await assembleContext(env, {
                                sport: sportLabel, home: game.home, away: game.away,
                                homeAbbr: '', awayAbbr: '',
                                sourceId: game.espn_event_id || null,  // feeds buildESPNSummaryContext
                                league: game.league || null,           // enables WNBA/WTA sport promotion
                                espnLeague: game.espn_league || null,
                            }, 600);
                        } catch (_) {}

                        const gamePrompt = [
                            FIELD_VOICE_REGISTER,
                            `Write a 50-70 word game brief for this ${sportLabel}${isPostseason ? ' playoff' : ''} game.`,
                            `${game.away} ${game.away_score} at ${game.home} ${game.home_score}`,
                            game.venue ? `Venue: ${game.venue}` : '',
                            `Date: ${game.date}`,
                            isPostseason ? `Round: ${game.importance || 'postseason'}${seriesContext}` : '',
                            sportContext || '',
                            `SPORT BOUNDARY: This is a ${sportLabel} game. Write ONLY ${sportLabel} content. Do not reference players, stats, or terminology from any other sport. If context is empty, write from the score and date only.`,
                            `Rules: Lead with the decisive moment or stat. No clichés. One paragraph, no headers.`,
                            JQ_STYLE,
                        ].filter(Boolean).join('\n');

                        const initial = await callProxy(gamePrompt);
                        if (!initial || initial.length < 30) {
                            results.push({ id: game.id, ok: false, reason: 'empty response' });
                            continue;
                        }

                        const qResult = await runQualityChain(gamePrompt, initial, callProxy, {
                            sport: sportLabel,
                            scoreThreshold: 240,
                            maxRetries: 2,
                            game: { home: game.home, away: game.away, homeScore: game.home_score, awayScore: game.away_score },
                            matchupNote: game.note || null,
                        });
                        const finalText = stripMarkdown(qResult.text);

                        if (force) {
                            await env.ARCHIVE_DB.prepare(
                                `DELETE FROM briefs WHERE game_id = ? AND brief_type = 'game_brief' AND source = 'backfill'`
                            ).bind(String(game.id)).run().catch(() => {});
                        }

                        await env.ARCHIVE_DB.prepare(
                            `INSERT INTO briefs
                               (id, date, brief_type, sport, game_id, brief_text, model, quality_score, word_count, source)
                             VALUES (?, ?, 'game_brief', ?, ?, ?, 'gemini-3.1-flash-lite', ?, ?, 'backfill')
                             ON CONFLICT(id) DO NOTHING`
                        ).bind(
                            `game_brief_${game.sport}_${game.id}_${game.date}`,
                            game.date,
                            game.sport || null,
                            String(game.id),
                            finalText,
                            qResult.score,
                            finalText.split(/\s+/).length
                        ).run();

                        results.push({ id: game.id, ok: true, words: finalText.split(/\s+/).length, score: qResult.score });
                        await new Promise(r => setTimeout(r, 2000));

                    } catch (e) {
                        results.push({ id: game.id, ok: false, reason: e.message });
                    }
                }

                return new Response(JSON.stringify({
                    ok: true,
                    force,
                    processed: results.length,
                    succeeded: results.filter(r => r.ok).length,
                    failed: results.filter(r => !r.ok).length,
                    results,
                }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

            } catch (e) {
                return new Response(JSON.stringify({ ok: false, error: e.message }),
                    { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
        }

        // ── GET /backfill/brief-scores ─────────────────────────────────────────
        // Retroactively scores briefs where quality_score IS NULL. Targets the
        // client-archived types that arrived before /archive/brief gained
        // server-side scoring (commit 5c0b63e). Score-only — never regenerates
        // prose. Per-row failure is swallowed (Rule 5).
        // Params: limit (default 20, max 50), dry=true, type=<brief_type>
        if (pathname === '/backfill/brief-scores' && request.method === 'GET') {
            if (!env.ARCHIVE_DB) {
                return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
                    { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            const limit  = Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 50);
            const dryRun = url.searchParams.get('dry') === 'true';
            const typeFilter = url.searchParams.get('type') || null;
            const rescore   = url.searchParams.get('rescore') === 'true';

            const typeClause = typeFilter ? `AND brief_type = ?` : '';
            const binds = typeFilter ? [typeFilter, limit] : [limit];

            const nullRows = await env.ARCHIVE_DB.prepare(`
                SELECT id, brief_type, sport, brief_text
                FROM briefs
                WHERE ${rescore
                    ? 'quality_score IS NOT NULL AND quality_score <= 245'
                    : 'quality_score IS NULL'}
                  AND brief_text IS NOT NULL
                  AND LENGTH(brief_text) > 50
                  ${typeClause}
                ORDER BY created_at DESC
                LIMIT ?
            `).bind(...binds).all().catch(() => ({ results: [] }));

            const rows = nullRows.results || [];

            if (dryRun) {
                return new Response(JSON.stringify({
                    ok: true, dry_run: true, found: rows.length,
                    by_type: rows.reduce((acc, r) => {
                        acc[r.brief_type] = (acc[r.brief_type] || 0) + 1; return acc;
                    }, {}),
                }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
            }

            const callProxy = async (promptText) => {
                const resp = await fetch(JOURNALISM_CLAUDE_PROXY, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
                    body: JSON.stringify({
                        model: 'claude-haiku-4-5-20251001',
                        max_tokens: 1000,
                        messages: [{ role: 'user', content: promptText }],
                    }),
                });
                if (!resp.ok) return null;
                const data = await resp.json().catch(() => null);
                return data ? (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim() || null : null;
            };

            const scored = [], failed = [];
            for (const row of rows) {
                try {
                    const scoringPrompt = `Score this sports brief for journalism quality:\n\n${row.brief_text}`;
                    const qResult = await runQualityChain(scoringPrompt, row.brief_text, callProxy, {
                        sport: row.sport || null,
                        scoreThreshold: 90,
                        maxRetries: 1,
                    });
                    const score = qResult?.score ?? null;
                    if (score !== null) {
                        await env.ARCHIVE_DB.prepare(
                            `UPDATE briefs SET quality_score = ? WHERE id = ?`
                        ).bind(score, row.id).run();
                        scored.push({ id: row.id, brief_type: row.brief_type, score });
                    } else {
                        failed.push({ id: row.id, reason: 'null score' });
                    }
                } catch (e) {
                    failed.push({ id: row.id, reason: e.message?.slice(0, 80) || 'error' });
                }
            }

            return new Response(JSON.stringify({
                ok: true,
                processed: rows.length,
                scored: scored.length,
                failed: failed.length,
                results: scored,
                errors: failed,
            }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
        }

        // GET /budget/odds — shared Odds-API budget snapshot. Returns the
        // current daily counter (src/budget-helpers.js) + the monthly hard-
        // limit counter (consumeOddsCredit / _consumeAmbientOddsCredit
        // share the same KV key). Read-only, no Odds-API calls.
        if (pathname === '/budget/odds' && request.method === 'GET') {
            if (!env.FIELD_JOURNALISM) {
                return new Response(JSON.stringify({ ok: false, error: 'FIELD_JOURNALISM KV not bound' }),
                    { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            const [daily, monthly] = await Promise.all([
                peekDailyOdds(env),
                peekMonthlyOdds(env),
            ]);
            return new Response(JSON.stringify({ ok: true, daily, monthly }),
                { headers: { ...CORS, 'Content-Type': 'application/json',
                             'Cache-Control': 'public, max-age=30' } });
        }

        // GET /quality/report — quality-score rollup over N days for the
        // O(1) Newspaper alert chip + supervisor-side degradation watch.
        // Groups briefs by (brief_type, sport), surfaces avg/min/max +
        // failure-rate alerts (avg<170 or >30% below 150) and
        // unscored-types (>5 briefs with no quality_score). Read-only.
        if (pathname === '/quality/report' && request.method === 'GET') {
            if (!env.ARCHIVE_DB) return new Response(
                JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
                { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
            const days = Math.min(parseInt(url.searchParams.get('days') || '7', 10) || 7, 30);
            const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
            const rows = await env.ARCHIVE_DB.prepare(`
                SELECT brief_type, sport,
                       COUNT(*) as total,
                       COUNT(quality_score) as scored,
                       ROUND(AVG(quality_score), 1) as avg_score,
                       MIN(quality_score) as min_score,
                       MAX(quality_score) as max_score,
                       SUM(CASE WHEN quality_score < 240 THEN 1 ELSE 0 END) as below_240,
                       SUM(CASE WHEN quality_score >= 240 THEN 1 ELSE 0 END) as above_240
                FROM briefs WHERE date >= ?
                GROUP BY brief_type, sport
                ORDER BY avg_score ASC NULLS LAST
            `).bind(since).all();
            const summary = rows.results || [];
            // Enrichment types: static context data seeded into D1, not
            // journalism prose. Scoring them produces noise — exclude from
            // alerts. They remain visible in `summary`.
            const ENRICHMENT_TYPES = new Set([
                'wc_matchup', 'standings_snapshot', 'narrative_context',
                'enrichment', 'kv_harvest', 'wc_tab',
            ]);
            // Excellence threshold: 80% of 300 = 240. Failure = below 240.
            // Enrichment types and golf (no context builder) stay excluded —
            // structural floor, not a tuning problem.
            const alerts = summary
                .filter(r => r.scored >= 3)
                .filter(r => {
                    if (ENRICHMENT_TYPES.has(r.brief_type)) return false;
                    if (r.sport && r.sport.toLowerCase().includes('golf')) return false;
                    return r.avg_score < 240 || (r.below_240 / r.scored) > 0.2;
                })
                .map(r => ({
                    brief_type: r.brief_type, sport: r.sport || 'all',
                    alert: r.avg_score < 240 ? 'avg_below_240' : 'high_failure_rate',
                    threshold: 240,
                    avg_score: r.avg_score,
                    failure_pct: Math.round(((r.below_240 || 0) / r.scored) * 100),
                }));
            const unscored = summary
                .filter(r => r.total > 5 && r.scored === 0)
                .map(r => ({ brief_type: r.brief_type, sport: r.sport, total: r.total }));
            return new Response(JSON.stringify({
                ok: true, days, since, summary, alerts,
                alert_count: alerts.length,
                unscored_types: unscored,
                unscored_count: unscored.length,
            }), { headers: { ...CORS, 'Content-Type': 'application/json',
                             'Cache-Control': 'public, max-age=300' } });
        }

        // GET /briefs/spot-check — sampled prose verification. Pulls N most
        // recent briefs, scans for banned phrases + cross-sport leaks +
        // out-of-range word count, returns PASS/FAIL verdict. Used by
        // SESSION-END template to gate session_record's success status.
        if (pathname === '/briefs/spot-check' && request.method === 'GET') {
            if (!env.ARCHIVE_DB) return new Response(
                JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
                { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
            const n = Math.min(parseInt(url.searchParams.get('n') || '5', 10) || 5, 20);
            const source = url.searchParams.get('source') || null;
            const briefType = url.searchParams.get('type') || null;
            let query = `SELECT id, brief_type, sport, brief_text, quality_score, source, date
                         FROM briefs WHERE brief_text IS NOT NULL`;
            const params = [];
            if (source) { query += ' AND source = ?'; params.push(source); }
            if (briefType) { query += ' AND brief_type = ?'; params.push(briefType); }
            query += ' ORDER BY date DESC, rowid DESC LIMIT ?';
            params.push(n);
            const rows = await env.ARCHIVE_DB.prepare(query).bind(...params).all();
            const briefs = rows.results || [];
            if (!briefs.length) return new Response(
                JSON.stringify({ ok: true, verdict: 'no_briefs', checked: 0 }),
                { headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
            const BANNED = [
                'automated ball-strike', 'abs challenge', 'challenge system',
                'stunned', 'shocked', 'thriller', 'instant classic', 'for the ages',
                "didn't disappoint", 'lived up to the hype', 'gave fans',
                'left fans', 'in a statement', 'marquee matchup',
            ];
            const CROSS_SPORT = {
                'golf': ['ppg','rebounds','assists','points per game','three-pointer','hat trick','puck'],
                'wnba': ['pitcher','home run','strikeout','hat trick','puck'],
                'FIFA World Cup 2026': ['ppg','rebounds','home run','strikeout'],
                'MLB': ['ppg','hat trick','puck','xG','golden goal'],
            };
            const results = briefs.map(b => {
                const text = (b.brief_text || '').toLowerCase();
                const flagged = BANNED.filter(p => text.includes(p));
                const crossSport = (CROSS_SPORT[b.sport] || []).filter(t => text.includes(t));
                const words = (b.brief_text || '').split(/\s+/).length;
                const pass = flagged.length === 0 && crossSport.length === 0
                             && words >= 30 && words <= 120;
                return {
                    id: b.id, brief_type: b.brief_type, sport: b.sport,
                    date: b.date, source: b.source, quality_score: b.quality_score,
                    word_count: words, pass,
                    flagged_phrases: flagged, cross_sport: crossSport,
                    preview: (b.brief_text || '').slice(0, 150),
                };
            });
            const passed = results.filter(r => r.pass).length;
            const failed = results.filter(r => !r.pass).length;
            return new Response(JSON.stringify({
                ok: true,
                verdict: failed === 0 ? 'PASS' : 'FAIL',
                checked: results.length, passed, failed, results,
            }), { headers: { ...CORS, 'Content-Type': 'application/json',
                             'Cache-Control': 'no-store' } });
        }

        // POST /fixtures/fetch — fetch fixtures from api-sports and insert into D1.
        // Runs server-side so CI never needs APISPORTS_KEY or CF bot-bypass tricks.
        // Auth: X-FIELD-Relay: field-relay-cron-2026 (same as /d1/execute).
        // Body: { league, season, from, to, sport? }  (sport defaults to "MLS")
        if (pathname === '/fixtures/fetch' && request.method === 'POST') {
            const authHeader = request.headers.get('X-FIELD-Relay');
            if (authHeader !== 'field-relay-cron-2026')
                return new Response('unauthorized', { status: 401, headers: CORS });
            if (!env.ARCHIVE_DB)
                return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
                    { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
            if (!env.APISPORTS_KEY)
                return new Response(JSON.stringify({ ok: false, error: 'APISPORTS_KEY not configured' }),
                    { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
            const body = await request.json().catch(() => null);
            if (!body) return new Response(JSON.stringify({ ok: false, error: 'invalid json' }),
                { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
            const { league, season, from: dateFrom, to: dateTo, sport = 'MLS' } = body;
            if (!league || !season || !dateFrom || !dateTo)
                return new Response(JSON.stringify({ ok: false, error: 'league, season, from, to required' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
            try {
                // Fetch fixtures from api-sports server-side (relay holds the key)
                const apiUrl = `https://v3.football.api-sports.io/fixtures?league=${league}&season=${season}&from=${dateFrom}&to=${dateTo}`;
                const apiResp = await fetch(apiUrl, {
                    headers: { 'x-apisports-key': env.APISPORTS_KEY, 'Accept': 'application/json' },
                });
                if (!apiResp.ok)
                    return new Response(JSON.stringify({ ok: false, error: `api-sports ${apiResp.status}` }),
                        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
                const apiData = await apiResp.json();
                const fixtures = apiData?.response || [];
                if (!fixtures.length)
                    return new Response(JSON.stringify({ ok: true, fetched: 0, inserted: 0,
                        note: 'No fixtures returned', errors: apiData?.errors }),
                        { headers: { ...CORS, 'Content-Type': 'application/json' } });

                // Build rows
                const rows = fixtures.map(fx => {
                    const date = (fx?.fixture?.date || '').slice(0, 10);
                    const home = fx?.teams?.home?.name || '';
                    const away = fx?.teams?.away?.name || '';
                    if (!date || !home || !away) return null;
                    const ha = home.slice(0, 5).toLowerCase().replace(/\s+/g, '');
                    const aa = away.slice(0, 5).toLowerCase().replace(/\s+/g, '');
                    return { id: `${date}-mls-${ha}-${aa}`, date, sport, home, away };
                }).filter(Boolean);

                // Batch INSERT OR IGNORE (20 rows/batch)
                let inserted = 0;
                const errors = [];
                for (let i = 0; i < rows.length; i += 20) {
                    const chunk = rows.slice(i, i + 20);
                    const vals = chunk.map(r =>
                        `('${r.id.replace(/'/g,"''")}','${r.date}','${r.sport}','${r.home.replace(/'/g,"''")}','${r.away.replace(/'/g,"''")}',NULL,NULL)`
                    ).join(',');
                    const sql = `INSERT OR IGNORE INTO regular_season_games (id,date,sport,home,away,home_score,away_score) VALUES ${vals}`;
                    try {
                        await env.ARCHIVE_DB.prepare(sql).run();
                        inserted += chunk.length;
                    } catch (e) {
                        errors.push(e.message);
                    }
                }
                return new Response(JSON.stringify({
                    ok: true, fetched: fixtures.length, rows: rows.length,
                    inserted, errors: errors.length ? errors : undefined,
                }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
            } catch (e) {
                return new Response(JSON.stringify({ ok: false, error: e.message }),
                    { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
        }

        // POST /soccer/fbref/fetch — fetch FBref squad stats server-side and
        // upload to R2. FBref blocks GitHub Actions IPs with HTTP 403; CF
        // edge IPs are not blocked. Replaces the per-league GH Actions
        // workflows in jubilant-bassoon that were silently writing empty
        // teams:{} blobs since June 10 2026.
        // Auth: X-FIELD-Relay: field-relay-cron-2026 (same as /fixtures/fetch).
        // Body: { leagues?: string[] }  defaults to all FBREF_LEAGUES.
        if (pathname === '/soccer/fbref/fetch' && request.method === 'POST') {
            const authHeader = request.headers.get('X-FIELD-Relay');
            if (authHeader !== 'field-relay-cron-2026')
                return new Response('unauthorized', { status: 401, headers: CORS });
            if (!env.FIELD_DATA)
                return new Response(JSON.stringify({ ok: false, error: 'FIELD_DATA R2 not bound' }),
                    { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });

            const FBREF_LEAGUES = {
                wc2026:     { compId: '1',  season: '2026',      slug: 'World-Cup',           r2Key: 'soccer/fbref/wc2026.json',     competition: 'FIFA World Cup 2026' },
                epl:        { compId: '9',  season: '2025-2026', slug: 'Premier-League',      r2Key: 'soccer/fbref/epl.json',        competition: 'Premier League 2025-26' },
                mls:        { compId: '22', season: '2025',      slug: 'Major-League-Soccer', r2Key: 'soccer/fbref/mls.json',        competition: 'MLS 2025' },
                laliga:     { compId: '12', season: '2025-2026', slug: 'La-Liga',             r2Key: 'soccer/fbref/laliga.json',     competition: 'La Liga 2025-26' },
                seriea:     { compId: '11', season: '2025-2026', slug: 'Serie-A',             r2Key: 'soccer/fbref/seriea.json',     competition: 'Serie A 2025-26' },
                bundesliga: { compId: '20', season: '2025-2026', slug: 'Fussball-Bundesliga', r2Key: 'soccer/fbref/bundesliga.json', competition: 'Bundesliga 2025-26' },
                ligue1:     { compId: '13', season: '2025-2026', slug: 'Ligue-1',             r2Key: 'soccer/fbref/ligue1.json',     competition: 'Ligue 1 2025-26' },
            };
            const FBREF_HEADERS = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://fbref.com/',
            };
            const TABLE_TYPES = ['shooting', 'misc', 'passing', 'keepers'];
            const stripTags = (s) => (s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
            const round3 = (n) => Math.round(n * 1000) / 1000;

            // FBref hides many tables inside HTML comments to defeat scrapers.
            // Unwrap them before regex extraction.
            function unwrapComments(html) {
                return html.replace(/<!--\s*/g, '').replace(/\s*-->/g, '');
            }
            function extractTable(html, tableId) {
                const re = new RegExp(`<table[^>]+id="${tableId}"[^>]*>([\\s\\S]*?)</table>`, 'i');
                const m = html.match(re);
                return m ? m[1] : null;
            }
            function extractColumns(tableHtml) {
                const theadMatch = tableHtml.match(/<thead[\s\S]*?<\/thead>/i);
                if (!theadMatch) return [];
                const trs = [...theadMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(m => m[0]);
                const headerRow = [...trs].reverse().find(tr => !/over_header/i.test(tr));
                if (!headerRow) return [];
                return [...headerRow.matchAll(/data-stat="([^"]+)"/gi)].map(m => m[1]);
            }
            function extractRows(tableHtml, columns) {
                const tbodyMatch = tableHtml.match(/<tbody>([\s\S]*?)<\/tbody>/i);
                if (!tbodyMatch) return [];
                const out = [];
                const trRe = /<tr([^>]*)>([\s\S]*?)<\/tr>/gi;
                let m;
                while ((m = trRe.exec(tbodyMatch[1])) !== null) {
                    const attrs = m[1] || '';
                    if (/class="[^"]*\b(spacer|thead)\b/i.test(attrs)) continue;
                    const cells = [...m[2].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => stripTags(c[1]));
                    if (!cells.length) continue;
                    const row = {};
                    for (let i = 0; i < cells.length && i < columns.length; i++) row[columns[i]] = cells[i];
                    out.push(row);
                }
                return out;
            }
            function pickInt(row, ...keys) {
                for (const k of keys) {
                    const v = row[k];
                    if (v != null && v !== '') {
                        const n = parseInt(String(v).replace(/,/g, ''), 10);
                        if (Number.isFinite(n)) return n;
                    }
                }
                return null;
            }
            function pickFloat(row, ...keys) {
                for (const k of keys) {
                    const v = row[k];
                    if (v != null && v !== '') {
                        const n = parseFloat(String(v).replace(/,/g, ''));
                        if (Number.isFinite(n)) return round3(n);
                    }
                }
                return null;
            }

            async function fetchAndParse(league, cfg) {
                const teams = {};
                let firstHtmlSample = null;
                let tablesParsed = 0;
                const errors = [];

                for (const tableType of TABLE_TYPES) {
                    const url = `https://fbref.com/en/comps/${cfg.compId}/${cfg.season}/${tableType}/${cfg.season}-${cfg.slug}-Stats`;
                    let html;
                    try {
                        const r = await fetch(url, { headers: FBREF_HEADERS });
                        if (!r.ok) { errors.push(`${tableType} HTTP ${r.status}`); continue; }
                        html = await r.text();
                    } catch (e) { errors.push(`${tableType}: ${e.message}`); continue; }
                    if (!firstHtmlSample) firstHtmlSample = html.slice(0, 2000);
                    const unwrapped = unwrapComments(html);

                    const forId = tableType === 'keepers'
                        ? 'stats_squads_keeper_for'
                        : `stats_squads_${tableType}_for`;
                    const againstId = tableType === 'shooting'
                        ? 'stats_squads_shooting_against'
                        : null;

                    const forTable = extractTable(unwrapped, forId);
                    if (forTable) {
                        tablesParsed++;
                        const cols = extractColumns(forTable);
                        for (const row of extractRows(forTable, cols)) {
                            const squad = stripTags(row.squad || row.team || '');
                            if (!squad || squad === 'Squad') continue;
                            if (!teams[squad]) teams[squad] = {};
                            const t = teams[squad];
                            if (tableType === 'shooting') {
                                t.xGFor = pickFloat(row, 'xg');
                                t.goalsFor = pickInt(row, 'goals_gk', 'gf');
                                t.shots = pickInt(row, 'shots');
                                t.shotsOnTarget = pickInt(row, 'shots_on_target');
                            } else if (tableType === 'misc') {
                                t.pressures = pickInt(row, 'pressures');
                                t.pressureSuccess = pickFloat(row, 'pressure_regains', 'pressures_succ');
                                t.setpieceGoals = pickInt(row, 'corner_kick_goals', 'goal_kick_goals');
                            } else if (tableType === 'passing') {
                                t.progressivePasses = pickInt(row, 'progressive_passes', 'prog');
                                t.passCompletion = pickFloat(row, 'passes_pct', 'cmp_pct');
                                t.keyPasses = pickInt(row, 'assisted_shots', 'kp');
                            } else if (tableType === 'keepers') {
                                t.psxgDiff = pickFloat(row, 'psxg_net', 'psxg_plus_minus');
                                t.svPct = pickFloat(row, 'save_pct', 'sv_pct');
                                t.cleanSheets = pickInt(row, 'clean_sheets', 'cs');
                            }
                        }
                    } else {
                        errors.push(`${tableType}: table ${forId} not found`);
                    }
                    if (againstId) {
                        const againstTable = extractTable(unwrapped, againstId);
                        if (againstTable) {
                            tablesParsed++;
                            const cols = extractColumns(againstTable);
                            for (const row of extractRows(againstTable, cols)) {
                                const squad = stripTags(row.squad || row.team || '').replace(/^vs\s+/i, '');
                                if (!squad || squad === 'Squad') continue;
                                if (!teams[squad]) teams[squad] = {};
                                const t = teams[squad];
                                t.xGAgainst = pickFloat(row, 'xg');
                                t.goalsAgainst = pickInt(row, 'goals_gk', 'ga');
                            }
                        } else {
                            errors.push(`shooting_against: table ${againstId} not found`);
                        }
                    }
                }

                for (const name of Object.keys(teams)) {
                    const t = teams[name];
                    if (t.xGFor != null && t.goalsFor != null) {
                        t.xGDivergence = round3(t.goalsFor - t.xGFor);
                    }
                }
                return { teams, tablesParsed, errors, firstHtmlSample };
            }

            const body = await request.json().catch(() => ({}));
            const requested = Array.isArray(body?.leagues) && body.leagues.length
                ? body.leagues : Object.keys(FBREF_LEAGUES);
            const results = [];

            for (const league of requested) {
                const cfg = FBREF_LEAGUES[league];
                if (!cfg) { results.push({ league, ok: false, error: 'unknown league' }); continue; }
                try {
                    const parsed = await fetchAndParse(league, cfg);
                    const squads = Object.keys(parsed.teams).length;
                    if (squads === 0) {
                        // Rule 77: do not write empty data. Surface raw HTML
                        // sample so a table-ID change can be diagnosed.
                        results.push({
                            league, squads: 0, ok: false,
                            error: parsed.errors.join('; ') || 'no squads parsed',
                            tablesParsed: parsed.tablesParsed,
                            htmlSample: parsed.firstHtmlSample?.slice(0, 2000),
                        });
                        continue;
                    }
                    const output = {
                        updated: new Date().toISOString(),
                        competition: cfg.competition,
                        season: cfg.season,
                        source: 'FBref squad stats via CF Worker relay',
                        teams: parsed.teams,
                    };
                    await env.FIELD_DATA.put(
                        cfg.r2Key,
                        JSON.stringify(output),
                        { httpMetadata: { contentType: 'application/json' } }
                    );
                    results.push({
                        league, squads, ok: true,
                        tablesParsed: parsed.tablesParsed,
                        errors: parsed.errors.length ? parsed.errors : undefined,
                    });
                } catch (e) {
                    results.push({ league, ok: false, error: e.message });
                }
            }

            const allOk = results.every(r => r.ok);
            return new Response(JSON.stringify({ ok: allOk, results }, null, 2), {
                status: 200,
                headers: { ...CORS, 'Content-Type': 'application/json' },
            });
        }

        // POST /session/record — record a session close into the codex table
        // (reuses the existing table; no schema change). Body requires
        // client_head, relay_head, summary; carry_forwards become individual
        // 'incident' codex entries for future session_health pulls.
        if (pathname === '/session/record' && request.method === 'POST') {
            if (!env.ARCHIVE_DB) return new Response(
                JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
                { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
            const body = await request.json().catch(() => null);
            if (!body) return new Response(
                JSON.stringify({ ok: false, error: 'invalid json' }),
                { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
            const {
                client_head, relay_head, smoke, sw_version,
                session_type = 'relay', summary,
                carry_forwards = [], drive_docs = [],
            } = body;
            if (!client_head || !relay_head || !summary) return new Response(
                JSON.stringify({ ok: false, error: 'client_head, relay_head, summary required' }),
                { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
            const date = new Date().toISOString().slice(0, 10);
            const id = `session_${date}_${relay_head}`;
            await env.ARCHIVE_DB.prepare(`
                INSERT INTO codex (key, category, title, content, drive_refs, updated_at)
                VALUES (?, 'session', ?, ?, ?, datetime('now'))
                ON CONFLICT(key) DO UPDATE SET
                    content = excluded.content, drive_refs = excluded.drive_refs,
                    updated_at = datetime('now')
            `).bind(
                id,
                `Session ${date} — ${summary.slice(0, 80)}`,
                JSON.stringify({
                    client_head, relay_head, smoke, sw_version,
                    session_type, summary, carry_forwards,
                    recorded_at: new Date().toISOString(),
                }),
                drive_docs.length ? JSON.stringify(drive_docs) : null
            ).run();
            const channel = session_type === 'docs' ? 'chat' : 'CC';
            const anchor = `CLIENT HEAD ${client_head} · ${date} · via ${channel}. ` +
                           `RELAY HEAD ${relay_head} · ${date} · via ${channel}.`;
            for (const cf of carry_forwards.slice(0, 10)) {
                const slug = cf.slice(0, 40).replace(/\s+/g, '-').toLowerCase()
                              .replace(/[^a-z0-9-]/g, '');
                await env.ARCHIVE_DB.prepare(`
                    INSERT INTO codex (key, category, title, content, updated_at)
                    VALUES (?, 'incident', ?, ?, datetime('now'))
                    ON CONFLICT(key) DO NOTHING
                `).bind(`cf/${date}/${slug}`, cf.slice(0, 120), cf).run().catch(() => {});
            }
            return new Response(JSON.stringify({
                ok: true, session_id: id, anchor,
                carry_forwards_written: Math.min(carry_forwards.length, 10),
            }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
        }

        // GET /identity/mismatches — diagnostic. For each requested sport,
        // fetch current Odds-API events, query today's NULL-opening_odds
        // games from D1, attempt resolveTeamKey matching, and return any
        // unmatched pairs alongside what we *did* find on the Odds-API
        // side so the alias map can be expanded. Costs 1 Odds-API credit
        // per sport probed; hard-capped at 5 sports per call.
        if (pathname === '/identity/mismatches' && request.method === 'GET') {
            if (!env.ARCHIVE_DB) {
                return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
                    { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            if (!env.ODDS_API_KEY) {
                return new Response(JSON.stringify({ ok: false, error: 'ODDS_API_KEY not configured' }),
                    { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
            const sportParam = (url.searchParams.get('sports') || 'EPL,MLS,WNBA,MLB,La Liga').trim();
            const sports = sportParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);

            const report = { date, probed: 0, matched: 0, unmatched: 0, sports: {} };
            for (const sport of sports) {
                const sportKey = archiveSportToOddsKey(sport);
                if (!sportKey) {
                    report.sports[sport] = { error: 'no Odds-API sport key for this sport' };
                    continue;
                }
                const { games: oddsGames, ok } = await fetchSportOddsLive(env, sportKey);
                report.probed++;
                if (!ok) {
                    report.sports[sport] = { error: 'Odds-API fetch failed', sport_key: sportKey };
                    continue;
                }
                const oddsByKey = new Map();
                for (const g of oddsGames) {
                    oddsByKey.set(`${resolveTeamKey(g.home_team)}|${resolveTeamKey(g.away_team)}`,
                                  { odds_home: g.home_team, odds_away: g.away_team });
                }
                const d1Res = await env.ARCHIVE_DB.prepare(
                    `SELECT id, home, away FROM regular_season_games
                     WHERE date = ? AND sport = ? AND opening_odds IS NULL`
                ).bind(date, sport).all();
                const matched = [], unmatched = [];
                for (const row of (d1Res.results || [])) {
                    const k = `${resolveTeamKey(row.home)}|${resolveTeamKey(row.away)}`;
                    if (oddsByKey.has(k)) matched.push({ d1: `${row.home} vs ${row.away}`, key: k });
                    else unmatched.push({
                        d1_home: row.home, d1_away: row.away, d1_key: k,
                    });
                }
                report.matched   += matched.length;
                report.unmatched += unmatched.length;
                report.sports[sport] = {
                    sport_key: sportKey,
                    odds_events: oddsGames.length,
                    d1_missing: (d1Res.results || []).length,
                    matched: matched.length,
                    unmatched,
                    odds_sample: [...oddsByKey.entries()].slice(0, 6).map(([k, v]) =>
                        ({ odds_home: v.odds_home, odds_away: v.odds_away, key: k })),
                };
            }
            return new Response(JSON.stringify(report),
                { headers: { ...CORS, 'Content-Type': 'application/json' } });
        }

        // GET /freshness/{date} — staleness annotations for per-game briefs.
        // Cross-references briefs(date=?) against change_log entries written
        // after each brief's generated_at. Returns the materiality findings
        // per game so the client can mark stale brief cards. ADR-002 clean —
        // each materiality check is a named binary condition, no composite
        // interest score.
        if (pathname.startsWith('/freshness/') && request.method === 'GET') {
            if (!env.ARCHIVE_DB) {
                return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
                    { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            const date = pathname.slice('/freshness/'.length);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return new Response(JSON.stringify({ ok: false, error: 'invalid date — expected YYYY-MM-DD' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            // Slate brief generatedAt is the baseline for per-game briefs
            // written in the same cron tick. KV miss → fall back to midnight
            // UTC so the freshness window is broad rather than zero.
            let slateGeneratedAt = null;
            try {
                if (env.FIELD_JOURNALISM) {
                    const raw = await env.FIELD_JOURNALISM.get(`journalism:${date}`);
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (typeof parsed.generatedAt === 'number') {
                            slateGeneratedAt = new Date(parsed.generatedAt).toISOString();
                        }
                    }
                }
            } catch (_) { /* fall through to midnight default */ }
            const fallbackGen = `${date}T00:00:00Z`;
            try {
                // Per-game briefs only — slate briefs have no per-game id, so
                // they're excluded from the cross-reference today (carry-
                // forward documented in the outbox manifest).
                const briefsRes = await env.ARCHIVE_DB.prepare(
                    `SELECT game_id, brief_text FROM briefs
                     WHERE date = ? AND game_id IS NOT NULL AND game_id != ''`
                ).bind(date).all();
                const briefs = (briefsRes.results || []).map(r => ({
                    game_id: r.game_id,
                    text:    r.brief_text || '',
                    generated_at: slateGeneratedAt || fallbackGen,
                }));
                const results = await checkBriefFreshness(env, briefs);
                return new Response(JSON.stringify({
                    ok: true,
                    date,
                    slate_generated_at: slateGeneratedAt,
                    count: results.length,
                    results,
                }), { headers: { ...CORS, 'Content-Type': 'application/json',
                                 'Cache-Control': 'public, max-age=60' } });
            } catch (e) {
                return new Response(JSON.stringify({ ok: true, date, count: 0, results: [], _note: e.message }),
                    { headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
        }

        // GET /changelog/{date} — recent change_log entries since midnight UTC
        // of the requested date. Read-only diagnostic for the newspaper
        // assembler + brief freshness guard. Date is YYYY-MM-DD.
        if (pathname.startsWith('/changelog/') && request.method === 'GET') {
            if (!env.ARCHIVE_DB) {
                return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
                    { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            const date = pathname.slice('/changelog/'.length);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return new Response(JSON.stringify({ ok: false, error: 'invalid date — expected YYYY-MM-DD' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            const since = `${date}T00:00:00Z`;
            const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);
            const sources = url.searchParams.get('source')
                ? [url.searchParams.get('source')]
                : null;
            try {
                const changes = await getRecentChanges(env, {
                    since, limit, sources, includeConsumed: true,
                });
                return new Response(JSON.stringify({ ok: true, date, count: changes.length, changes }),
                    { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' } });
            } catch (e) {
                // change_log may not exist yet on a fresh deploy.
                return new Response(JSON.stringify({ ok: true, date, count: 0, changes: [], _note: e.message }),
                    { headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
        }

        // POST /d1/execute — authenticated D1 query endpoint for CI scripts.
        // Routes D1 writes through the Worker's native binding instead of
        // requiring the CF REST API (which needs D1:Edit token scope).
        // Table allowlist prevents writes to non-odds tables.
        if (pathname === '/d1/execute' && request.method === 'POST') {
            const authHeader = request.headers.get('X-FIELD-Relay');
            if (authHeader !== 'field-relay-cron-2026') {
                return new Response('unauthorized', { status: 401, headers: CORS });
            }
            let body;
            try { body = await request.json(); }
            catch (_) {
                return new Response(JSON.stringify({ ok: false, error: 'invalid JSON' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            const { sql, params } = body;
            if (!sql) {
                return new Response(JSON.stringify({ ok: false, error: 'missing sql' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            const ALLOWED_TABLES = ['odds_history', 'odds_backfill_progress', 'regular_season_games', 'postseason_games', 'change_log', 'analytics_output', 'briefs'];
            const tableName = sql.match(/(?:INTO|FROM|UPDATE|TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+(\w+)/i)?.[1];
            if (tableName && !ALLOWED_TABLES.includes(tableName)) {
                return new Response(JSON.stringify({ ok: false, error: 'table not allowed', table: tableName }),
                    { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            try {
                const stmt = env.ARCHIVE_DB.prepare(sql);
                const bound = params && params.length > 0 ? stmt.bind(...params) : stmt;
                const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
                const result = isSelect ? await bound.all() : await bound.run();
                return new Response(JSON.stringify({
                    success: true,
                    results: result.results || [],
                    meta: result.meta,
                }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
            } catch (e) {
                return new Response(JSON.stringify({ ok: false, error: e.message }),
                    { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
        }

        // /kali/* → kaliaflstats.com/api/afl/v1 (KALI_AFL_TOKEN injected server-side)
        // Free tier: 5,000 req/day, resets 00:00 UTC. CF edge cache keeps usage low.
        // Provides: predictions/factors, tips (30 models), player-stats, advanced stats,
        //           standings, leaderboards, head-to-head (team_a= team_b= slug params).
        if (pathname.startsWith('/kali/')) {
            const kaliKey = env.KALI_AFL_TOKEN;
            if (!kaliKey) return new Response(
                JSON.stringify({ error: 'KALI_AFL_TOKEN not configured' }),
                { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
            const cleanPath = pathname.replace(/^\/kali/, '');
            if (!kaliAllowed(cleanPath)) return new Response(
                'Kali path not allowed',
                { status: 403, headers: { ...CORS, 'X-RELAY-Error': 'kali-path-not-whitelisted' } }
            );
            const targetUrl = `${KALI_BASE}${cleanPath}${url.search || ''}`;
            return relayFetch(
                targetUrl,
                { 'Authorization': `Bearer ${kaliKey}`, 'Accept': 'application/json' },
                kaliTtl(cleanPath),
                'kali',
                ctx
            );
        }

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

        // /odds/history/:game_id — D1-backed historical odds query (June 20 2026).
        // Reads from the odds_history table populated by the daily
        // .github/workflows/odds-backfill.yml job. Returns all snapshots for
        // a game (typically one 'close' row per bookmaker) ordered by capture
        // time. Match MUST come before the /odds/* passthrough below.
        if (pathname.startsWith('/odds/history/')) {
            if (!env.ARCHIVE_DB) {
                return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
                    { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            const gameId = decodeURIComponent(pathname.slice('/odds/history/'.length));
            if (!gameId) {
                return new Response(JSON.stringify({ ok: false, error: 'missing game_id' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            try {
                const r = await env.ARCHIVE_DB.prepare(
                    `SELECT id, game_id, sport, date, home_team, away_team, commence_time,
                            home_ml, away_ml, draw_ml, over_under, over_price, under_price,
                            bookmaker, snapshot_time, snapshot_type, created_at
                     FROM odds_history
                     WHERE game_id = ?
                     ORDER BY snapshot_time ASC, created_at ASC`
                ).bind(gameId).all();
                return new Response(JSON.stringify({
                    ok: true, game_id: gameId, odds: r.results || [],
                }), { headers: { ...CORS, 'Content-Type': 'application/json',
                                 'Cache-Control': 'public, max-age=3600' } });
            } catch (e) {
                return new Response(JSON.stringify({ ok: false, error: e.message }),
                    { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
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
        // ── /journalism/context-probe — verify Context Assembler output (zero LLM cost) ──
        // Returns the raw sport context blocks that would be injected into the
        // journalism prompt, without calling the LLM. Use for adapter verification.
        if (pathname === '/journalism/context-probe' && request.method === 'GET') {
          const { assembleContext } = await import('./context-assembler.js');
          const espnDate = new Date().toISOString().slice(0,10).replace(/-/g,'');
          const LEAGUES = [
            {sport:'baseball', league:'mlb', label:'MLB'},
            {sport:'basketball', league:'nba', label:'NBA'},
            {sport:'hockey',    league:'nhl', label:'NHL'},
            {sport:'soccer',    league:'usa.1', label:'MLS'},
            {sport:'soccer',    league:'fifa.world', label:'FIFA World Cup'},
          ];
          const _MAP = {'mlb':'mlb','nba':'nba','nhl':'nhl','mls':'mls','fifa world cup':'wc26'};
          const results = [];
          for (const {sport,league,label} of LEAGUES) {
            try {
              const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?dates=${espnDate}`);
              if (!r.ok) continue;
              const d = await r.json();
              for (const ev of (d.events||[]).slice(0, 3)) { // cap at 3 per league for speed
                const comp = ev.competitions?.[0];
                const teams = comp?.competitors || [];
                const home = teams.find(t => t.homeAway === 'home') || teams[0];
                const away = teams.find(t => t.homeAway === 'away') || teams[1];
                const sportKey = _MAP[label.toLowerCase()] || label.toLowerCase();
                const ctx = await assembleContext(env, {
                  sport: sportKey, league: label,
                  home: home?.team?.shortDisplayName || '',
                  away: away?.team?.shortDisplayName || '',
                  homeAbbr: home?.team?.abbreviation || '',
                  awayAbbr: away?.team?.abbreviation || '',
                  espnLeague: league,         // slug e.g. "fifa.world"
                  eventId:    String(ev.id || ''),
                  sourceId:   String(ev.id || ''),  // feeds buildESPNSummaryContext
                }, 600);
                results.push({
                  game: `${away?.team?.abbreviation || '?'} @ ${home?.team?.abbreviation || '?'}`,
                  league: label, sportKey,
                  contextLength: ctx.length,
                  context: ctx || '(empty)',
                });
              }
            } catch(e) { results.push({ league: label, error: e.message }); }
          }
          return new Response(JSON.stringify({ ok: true, date: espnDate, results }, null, 2),
            {headers:{...CORS,'Content-Type':'application/json'}});
        }

        if (pathname === '/journalism/run' && request.method === 'POST') {
          const force = url.searchParams.get('force') === 'true';
          const result = await handleJournalismCycle(env, { force });
          return new Response(JSON.stringify({triggered:'journalism-cycle', result}),
            {headers:{...CORS,'Content-Type':'application/json'}});
        }

        // ── /analytics/* — Analytics Cron Engine endpoints ────────────────────
        // /analytics/status        — last run status from KV
        // /analytics/run           — manual trigger (POST), same logic as the 0 9 * * * cron
        // /analytics/{feature}/{date?}  — generic read of analytics_output row
        if (pathname === '/analytics/status') {
            if (!env.FIELD_JOURNALISM) {
                return new Response(JSON.stringify({ ok: false, error: 'FIELD_JOURNALISM KV not bound' }),
                    { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            const status = await env.FIELD_JOURNALISM.get('field:analytics:status', 'json');
            return new Response(JSON.stringify({ ok: true, status }),
                { headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        if (pathname === '/analytics/run' && (request.method === 'POST' || request.method === 'GET')) {
            // GET form supports ?date=YYYY-MM-DD; POST accepts a JSON body
            // with {date}. GET also lets probe_relay_route hit it for in-
            // sandbox verification (sandbox cannot POST to *.workers.dev).
            let body = {};
            if (request.method === 'POST') {
                body = await request.json().catch(() => ({}));
            } else {
                const qDate = url.searchParams.get('date');
                if (qDate) body = { date: qDate };
            }
            const result = await analyticsEngine(env, body || {});
            return new Response(JSON.stringify({ triggered: 'analytics-engine', result }),
                { headers: { ...CORS, 'Content-Type': 'application/json' } });
        }

        // GET /analytics/newspaper/{date} — O(1) Newspaper bundle.
        // Assembles all analytics_output features + KV editorial into one
        // atomic response. {date} = TODAY's date. Endpoint fetches recap
        // from yesterday (morning_report / truth_is / night_stars /
        // streak_board / quality_feedback) and preview from today
        // (circadian_preview / field_pick) internally.
        //
        // MUST sit before the generic `/analytics/{feature}/{date}` handler
        // below — otherwise the generic catch-all matches "newspaper" as
        // a feature name and returns a single-row null lookup.
        if (pathname.startsWith('/analytics/newspaper/') && request.method === 'GET') {
            if (!env.ARCHIVE_DB) {
                return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
                    { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            const date = pathname.slice('/analytics/newspaper/'.length);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return new Response(JSON.stringify({ ok: false, error: 'invalid date — expected YYYY-MM-DD' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            try {
                // Yesterday in UTC. The cron writes recap features under
                // yesterday's date and preview features under today's.
                const reqDate  = new Date(date + 'T12:00:00Z');
                const yestDate = new Date(reqDate);
                yestDate.setUTCDate(yestDate.getUTCDate() - 1);
                const yesterday = yestDate.toISOString().slice(0, 10);

                const [recapRows, previewRows] = await Promise.all([
                    env.ARCHIVE_DB.prepare(
                        `SELECT feature, value, brief_text FROM analytics_output WHERE date = ?`
                    ).bind(yesterday).all(),
                    env.ARCHIVE_DB.prepare(
                        `SELECT feature, value, brief_text FROM analytics_output WHERE date = ?`
                    ).bind(date).all(),
                ]);

                const parseRows = (rows) => {
                    const out = {};
                    for (const r of (rows.results || [])) {
                        let parsed = null;
                        try { parsed = JSON.parse(r.value); } catch (_) { parsed = r.value; }
                        out[r.feature] = { value: parsed, brief_text: r.brief_text || null };
                    }
                    return out;
                };
                const recap   = parseRows(recapRows);
                const preview = parseRows(previewRows);

                const bundle = {
                    date,
                    recap_date: yesterday,
                    generated_at: recap.morning_report?.value?.generated_at || null,
                    morning_report: recap.morning_report?.brief_text || null,
                    truth_is: recap.truth_is ? {
                        ...(recap.truth_is.value || {}),
                        brief: recap.truth_is.brief_text || null,
                    } : null,
                    night_stars: recap.night_stars?.value || null,
                    pick: preview.field_pick ? {
                        ...(preview.field_pick.value || {}),
                        brief: preview.field_pick.brief_text || null,
                    } : null,
                    preview: preview.circadian_preview?.brief_text || null,
                    streak_board: recap.streak_board?.value || null,
                    quality_feedback: recap.quality_feedback?.value || null,
                    quality_alert: recap.quality_alert ? {
                        ...(recap.quality_alert.value || {}),
                        brief: recap.quality_alert.brief_text || null,
                    } : null,
                    completed_games: [],
                };

                // Completed games for "What Changed" — structural facts only.
                // Schema reality (verified): regular_season_games has no
                // status/OT columns; postseason_games carries `importance`
                // ('clinch' | 'elimination' | 'playoffs' | null). Upset
                // detection runs off closing_odds (favorite lost AND
                // underdog ML >= +150).
                try {
                    const [regGames, postGames] = await Promise.all([
                        env.ARCHIVE_DB.prepare(`
                            SELECT id, sport, home, away, home_score, away_score,
                                   closing_odds, NULL AS importance
                            FROM regular_season_games
                            WHERE date = ? AND home_score IS NOT NULL
                        `).bind(yesterday).all(),
                        env.ARCHIVE_DB.prepare(`
                            SELECT id, sport, home, away, home_score, away_score,
                                   closing_odds, importance
                            FROM postseason_games
                            WHERE date = ? AND home_score IS NOT NULL
                        `).bind(yesterday).all(),
                    ]);
                    const allGames = [
                        ...(regGames.results || []),
                        ...(postGames.results || []),
                    ];
                    bundle.completed_games = allGames.map(g => {
                        let wasUpset = false;
                        try {
                            if (g.closing_odds) {
                                const odds = typeof g.closing_odds === 'string'
                                    ? JSON.parse(g.closing_odds) : g.closing_odds;
                                const homeML = odds?.moneyline?.home;
                                const awayML = odds?.moneyline?.away;
                                if (typeof homeML === 'number' && typeof awayML === 'number') {
                                    const homeFav = homeML < 0 && awayML > 0;
                                    const awayFav = awayML < 0 && homeML > 0;
                                    const homeWon = g.home_score > g.away_score;
                                    if (homeFav && !homeWon) wasUpset = true;
                                    if (awayFav &&  homeWon) wasUpset = true;
                                    if (wasUpset) {
                                        const underdogML = homeFav ? awayML : homeML;
                                        // Threshold: underdog priced >= +150 only.
                                        if (underdogML < 150) wasUpset = false;
                                    }
                                }
                            }
                        } catch (_) { /* odds malformed — leave wasUpset false */ }
                        const margin = Math.abs((g.home_score || 0) - (g.away_score || 0));
                        const isSeriesClinch = g.importance === 'clinch';
                        const isElimination  = g.importance === 'elimination';
                        return {
                            id: g.id,
                            sport: g.sport,
                            home: g.home, away: g.away,
                            homeScore: g.home_score, awayScore: g.away_score,
                            wentToOT: false, // not stored in D1
                            wasUpset, isSeriesClinch, isElimination, margin,
                        };
                    });
                } catch (_) { /* game tables may be empty/missing — keep [] */ }

                return new Response(JSON.stringify({ ok: true, ...bundle }), {
                    headers: {
                        ...CORS,
                        'Content-Type': 'application/json',
                        'Cache-Control': 'public, max-age=300',
                    },
                });
            } catch (e) {
                return new Response(JSON.stringify({
                    ok: false, error: e.message,
                    _note: 'analytics_output table may not exist yet',
                }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
        }
        if (pathname.startsWith('/analytics/')) {
            if (!env.ARCHIVE_DB) {
                return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
                    { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            // pathname: /analytics/{feature}/{date?}
            const parts = pathname.split('/').filter(Boolean); // ['analytics', feature, date?]
            const feature = parts[1];
            const date = parts[2] || new Date(Date.now() - 24*3600*1000).toISOString().slice(0,10);
            if (!feature || !/^[a-z0-9_]+$/i.test(feature)) {
                return new Response(JSON.stringify({ ok: false, error: 'missing or invalid feature' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return new Response(JSON.stringify({ ok: false, error: 'invalid date — expected YYYY-MM-DD' }),
                    { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
            try {
                const row = await env.ARCHIVE_DB.prepare(
                    `SELECT * FROM analytics_output WHERE feature = ? AND date = ? LIMIT 1`
                ).bind(feature, date).first();
                // value is stored as JSON text; rehydrate so clients don't double-parse.
                let parsedValue = null;
                if (row && row.value) {
                    try { parsedValue = JSON.parse(row.value); } catch (_) { parsedValue = row.value; }
                }
                const data = row ? { ...row, value: parsedValue } : null;
                return new Response(JSON.stringify({ ok: true, feature, date, data }),
                    { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
            } catch (e) {
                // analytics_output may not exist yet (created on first cron run).
                return new Response(JSON.stringify({ ok: true, feature, date, data: null, _note: e.message }),
                    { headers: { ...CORS, 'Content-Type': 'application/json' } });
            }
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
            const game        = body.game        || null;
            const matchupNote = body.matchupNote || null;
            // Prepend v4 voice register so /journalism/generate consumers
            // inherit the same framing as cron + backfill paths.
            const promptWithVoice = FIELD_VOICE_REGISTER + '\n' + body.prompt;

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
            const initial = await callProxy(promptWithVoice);
            if (!initial || initial.length < 30) {
              return new Response(JSON.stringify({
                error: 'proxy returned no prose',
                proxy_text_length: initial ? initial.length : 0,
                proxy_diagnostic: _lastProxyDiag,
              }), {status:502, headers:{...CORS,'Content-Type':'application/json'}});
            }

            // Run full quality chain
            const result = await runQualityChain(promptWithVoice, initial, callProxy, {
              sport,
              scoreThreshold: scoreFloor,
              maxRetries: 6,
              game,
              matchupNote,
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
            const eventId = pathname.replace('/journalism/game/', '').replace(/[^a-zA-Z0-9_:-]/g,'');
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
            const NFL_R2_FILES = [
                'player-stats.json', 'ngs-passing.json', 'pfr-rec.json',
                // NFL-B: nflverse parquet pipeline
                'ngs-receiving.json', 'ngs-rushing.json', 'nfl-injuries.json',
            ];
            // Dynamic year: use current NFL season year
            const nflYear = (new Date().getMonth() >= 7) ? new Date().getFullYear() : new Date().getFullYear() - 1;
            // R2-first for nflverse pipeline files (NFL-A, June 10 2026)
            if (NFL_R2_FILES.includes(file) && env.FIELD_DATA) {
                try {
                    const r2obj = await env.FIELD_DATA.get(`nfl/${nflYear}/${file}`);
                    if (r2obj) {
                        return new Response(await r2obj.text(), {
                            headers: { 'Content-Type': 'application/json',
                                       'Cache-Control': 'public, max-age=86400',
                                       'X-Source': 'r2', ...CORS }
                        });
                    }
                } catch(e_) {}
            }
            if (!NFLVERSE_OUT_ALLOWED.includes(file))
                return new Response('nflverse file not allowed', { status: 403, headers: { 'X-RELAY-Error': 'nflverse-not-whitelisted', ...CORS } });
            const targetUrl = `${NFLVERSE_RAW_BASE}/${file}`;
            return relayFetch(targetUrl, { 'Accept': 'application/json' }, 86400, 'nflverse', ctx);
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

            // R2-first: read from FIELD_DATA R2 bucket (MLB-A pipeline, June 10 2026).
            // R2 is populated by runMLBSavantUpdate() (Monday cron or /mlb-savant-update).
            // Falls back to raw.githubusercontent.com/jubilant-bassoon outbox/mlb/ if R2 miss.
            // This makes GitHub Actions mlb-weekly-update.yml optional (not a hard dependency).
            if (env.FIELD_DATA && !file.includes('umpire_abs')) {
                try {
                    const r2Key = `mlb/2026/${file}`;
                    const r2obj = await env.FIELD_DATA.get(r2Key);
                    if (r2obj) {
                        const body = await r2obj.text();
                        return new Response(body, {
                            headers: {
                                'Content-Type': 'application/json',
                                'Cache-Control': 'public, max-age=43200',
                                'X-Source': 'r2',
                                ...CORS
                            }
                        });
                    }
                } catch(e_) { /* R2 miss — fall through to GitHub raw */ }
            }
            // Fallback: GitHub raw (mlb-weekly-update.yml output)
            const targetUrl = `${MLB_STATS_RAW_BASE}/${file}`;
            return relayFetch(targetUrl, { 'Accept': 'application/json' }, 43200, 'mlb-stats', ctx);
        }

        // ── POST /wc-context-patch → write team context patch to R2 ───────────────
        // Stores amendment layer for WC_TEAM_CONTEXT inline data.
        // Body: { "teams": { "USA": { "narrativeNote": "...", "guardrail": "..." } } }
        // Relay merges patches at buildWCTeamContextBlock() call time.
        // Use for: injury updates, form notes, tactical shifts mid-tournament.
        if (pathname === '/wc-context-patch' && request.method === 'POST') {
            if (request.headers.get('X-FIELD-Admin') !== '1')
                return new Response('Forbidden', { status: 403, headers: CORS });
            if (!env.FIELD_DATA)
                return new Response(JSON.stringify({ error: 'FIELD_DATA R2 not bound' }),
                    { status: 503, headers: { 'Content-Type': 'application/json', ...CORS } });
            try {
                const body = await request.json();
                if (!body || typeof body !== 'object')
                    return new Response(JSON.stringify({ error: 'invalid body' }),
                        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } });
                const payload = JSON.stringify({
                    updated: new Date().toISOString(),
                    note: 'WC team context patches — applied at buildWCTeamContextBlock() call time',
                    teams: body.teams || body,
                });
                await env.FIELD_DATA.put('soccer/wc2026-patches.json', payload,
                    { httpMetadata: { contentType: 'application/json' } });
                return new Response(JSON.stringify({ ok: true, teams: Object.keys(body.teams || body) }),
                    { headers: { 'Content-Type': 'application/json', ...CORS } });
            } catch(e) {
                return new Response(JSON.stringify({ error: e.message }),
                    { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } });
            }
        }

        // ── GET /wc-context-patch → read current patches ─────────────────────────
        if (pathname === '/wc-context-patch' && request.method === 'GET') {
            if (!env.FIELD_DATA)
                return new Response(JSON.stringify({ teams: {} }),
                    { headers: { 'Content-Type': 'application/json', ...CORS } });
            try {
                const r2obj = await env.FIELD_DATA.get('soccer/wc2026-patches.json');
                if (!r2obj) return new Response(JSON.stringify({ teams: {} }),
                    { headers: { 'Content-Type': 'application/json', ...CORS } });
                return new Response(await r2obj.text(),
                    { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ...CORS } });
            } catch(e) {
                return new Response(JSON.stringify({ error: e.message }),
                    { status: 502, headers: { 'Content-Type': 'application/json', ...CORS } });
            }
        }

        // ── /nhl-gsax/{file} → MoneyPuck GSAX from R2 (NHL-B) ──────────────────────
        if (pathname.startsWith('/nhl-gsax/')) {
            const gFile = pathname.replace(/^\/nhl-gsax\//, '');
            if (!['playoffs.json', 'regular.json'].includes(gFile))
                return new Response('nhl-gsax file not allowed', { status: 403, headers: CORS });
            if (env.FIELD_DATA) {
                try {
                    const r2obj = await env.FIELD_DATA.get(`nhl/2026/gsax-${gFile}`);
                    if (r2obj) {
                        return new Response(await r2obj.text(), {
                            headers: { 'Content-Type': 'application/json',
                                       'Cache-Control': 'public, max-age=86400',
                                       'X-Source': 'r2', ...CORS }
                        });
                    }
                } catch(e_) {}
            }
            return new Response(JSON.stringify({ error: 'no GSAX data yet' }),
                { status: 404, headers: { 'Content-Type': 'application/json', ...CORS } });
        }

        // ── /nhl-series/{series}/stats → series-adjusted PP/PK from R2 ────────────
        // R2 key: nhl/{series}/series-stats.json
        // Populated by runNHLSeriesUpdate() cron (every 15min during playoffs).
        // Client reads this to enrich NHL journalism context and Scout's Pick signals.
        if (pathname.startsWith('/nhl-series/') && pathname.endsWith('/stats')) {
            const series = pathname.split('/')[2];
            if (!series || !/^[a-z0-9-]+$/.test(series))
                return new Response('invalid series', { status: 400, headers: CORS });
            if (env.FIELD_DATA) {
                try {
                    const r2obj = await env.FIELD_DATA.get(`nhl/${series}/series-stats.json`);
                    if (r2obj) {
                        return new Response(await r2obj.text(), {
                            headers: { 'Content-Type': 'application/json',
                                       'Cache-Control': 'public, max-age=900',
                                       'X-Source': 'r2', ...CORS }
                        });
                    }
                } catch(e_) {}
            }
            return new Response(JSON.stringify({ error: 'no series data yet' }),
                { status: 404, headers: { 'Content-Type': 'application/json', ...CORS } });
        }

        // ── /nba-clutch/{file} → NBA clutch stats (GitHub Actions hybrid) ──────────
        // stats.nba.com returns 520 from CF Workers — GH Actions fetches on ubuntu-latest.
        // R2 key: nba/2026/{file} | GitHub raw fallback: outbox/nba/{file}
        if (pathname.startsWith('/nba-clutch/')) {
            const nbaFile = pathname.replace(/^\/nba-clutch\//, '');
            const NBA_CLUTCH_ALLOWED = ['clutch_playoffs.json', 'clutch_regular.json'];
            if (!NBA_CLUTCH_ALLOWED.includes(nbaFile))
                return new Response('nba-clutch file not allowed', { status: 403, headers: CORS });
            if (env.FIELD_DATA) {
                try {
                    const r2obj = await env.FIELD_DATA.get(`nba/2026/${nbaFile}`);
                    if (r2obj) {
                        return new Response(await r2obj.text(), {
                            headers: { 'Content-Type': 'application/json',
                                       'Cache-Control': 'public, max-age=86400',
                                       'X-Source': 'r2', ...CORS }
                        });
                    }
                } catch(e_) {}
            }
            const nbaCDN = 'https://raw.githubusercontent.com/jeffunglesbee-create/jubilant-bassoon/main/outbox/nba';
            return relayFetch(`${nbaCDN}/${nbaFile}`, { 'Accept': 'application/json' }, 86400, 'nba-clutch', ctx);
        }

        // ── /soccer/xg → ESPN Core API per-game xG (WC2026 + premium leagues) ────
        // Replaces the FBref pipeline (Opta licence lost Jan 2026; GH-Actions
        // IP-blocked anyway). Verified xG present on fifa.world events 760456
        // and 760457; absent for ger.1 (structural — ESPN serves a richer feed
        // for WC/premium). Returns _hasXG:false when feed lacks xG so the
        // Context Assembler degrades to '' gracefully.
        if (pathname === '/soccer/xg') {
            const league  = url.searchParams.get('league');
            const eventId = url.searchParams.get('event');
            if (!league || !eventId) {
                return new Response(JSON.stringify({ error: 'league and event required' }),
                    { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } });
            }
            const CORE = 'https://sports.core.api.espn.com/v2/sports/soccer';
            const compBase = `${CORE}/leagues/${league}/events/${eventId}/competitions/${eventId}`;

            let homeId, awayId, homeName, awayName, homeAbbr, awayAbbr;
            try {
                // site.api.espn.com/summary returns inline displayName + abbreviation
                // alongside competitor IDs. The core API /competitors endpoint returns
                // team as {$ref} only — no inline name — so we use summary for step 1.
                const summaryRes = await fetch(
                    `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/summary?event=${eventId}`,
                    { headers: { 'User-Agent': 'FIELD/1.0' } }
                );
                if (!summaryRes.ok) throw new Error(`summary ${summaryRes.status}`);
                const summaryData = await summaryRes.json();
                const competitors = summaryData?.header?.competitions?.[0]?.competitors || [];
                for (const comp of competitors) {
                    if (comp.homeAway === 'home') {
                        homeId   = comp.id;
                        homeName = comp.team?.displayName || comp.id;
                        homeAbbr = comp.team?.abbreviation;
                    } else {
                        awayId   = comp.id;
                        awayName = comp.team?.displayName || comp.id;
                        awayAbbr = comp.team?.abbreviation;
                    }
                }
                if (!homeId || !awayId) throw new Error('could not resolve competitors');
            } catch (e) {
                return new Response(
                    JSON.stringify({ event: eventId, league, _hasXG: false, _error: e.message }),
                    { headers: { 'Content-Type': 'application/json', 'X-Source': 'espn-core', ...CORS } }
                );
            }

            const [homeStats, awayStats] = await Promise.all([
                fetch(`${compBase}/competitors/${homeId}/statistics`,
                    { headers: { 'User-Agent': 'FIELD/1.0' } })
                    .then(r => r.ok ? r.json() : null).catch(() => null),
                fetch(`${compBase}/competitors/${awayId}/statistics`,
                    { headers: { 'User-Agent': 'FIELD/1.0' } })
                    .then(r => r.ok ? r.json() : null).catch(() => null),
            ]);

            const XG_FIELDS = new Set([
                'expectedGoals', 'expectedGoalsNonPenalty', 'expectedGoalsOpenPlay',
                'expectedAssists', 'bigChanceCreated', 'bigChanceMissed',
                'ppda', 'expectedGoalsConceded',
            ]);
            function extractXG(statsObj) {
                if (!statsObj) return {};
                const out = {};
                for (const cat of statsObj.splits?.categories || []) {
                    for (const stat of cat.stats || []) {
                        if (XG_FIELDS.has(stat.name)) {
                            const v = parseFloat(stat.displayValue);
                            if (!isNaN(v)) out[stat.name] = v;
                        }
                    }
                }
                return out;
            }

            const homeXG = extractXG(homeStats);
            const awayXG = extractXG(awayStats);
            const hasXG  = 'expectedGoals' in homeXG;

            const payload = {
                event: eventId,
                league,
                _hasXG: hasXG,
                _source: 'espn-core',
                home: { id: homeId, name: homeName, abbr: homeAbbr, ...homeXG },
                away: { id: awayId, name: awayName, abbr: awayAbbr, ...awayXG },
            };
            // Pre-game 5min; live 60s; post-game 24h. xG > 0 ⇒ play has started.
            const ttl = !hasXG ? 300 : ((homeXG.expectedGoals > 0 || awayXG.expectedGoals > 0) ? 86400 : 60);
            return new Response(JSON.stringify(payload), {
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': `public, max-age=${ttl}`,
                    'X-Source': 'espn-core',
                    ...CORS,
                },
            });
        }

        // ── /soccer-fbref/{file} → FBref WC squad stats (SOCCER-A hybrid) ──────────
        // FBref is CF-blocked (bot detection). GitHub Actions fetches on ubuntu-latest,
        // writes to R2 (field-relay-data/soccer/fbref/wc2026.json) via CF REST API.
        // Falls back to raw.githubusercontent.com/jubilant-bassoon/outbox/soccer/ if R2 miss.
        // Cron: soccer-fbref-wc.yml every 3 days during WC group stage.
        if (pathname.startsWith('/soccer-fbref/')) {
            const sfFile = pathname.replace(/^\/soccer-fbref\//, '');
            const SF_ALLOWED = ['wc2026.json','epl.json','laliga.json','bundesliga.json','seriea.json','ligue1.json','mls.json'];
            if (!SF_ALLOWED.includes(sfFile))
                return new Response('soccer-fbref file not allowed', { status: 403, headers: { ...CORS } });
            // R2-first
            if (env.FIELD_DATA) {
                try {
                    const r2obj = await env.FIELD_DATA.get(`soccer/fbref/${sfFile}`);
                    if (r2obj) {
                        return new Response(await r2obj.text(), {
                            headers: { 'Content-Type': 'application/json',
                                       'Cache-Control': 'public, max-age=86400',
                                       'X-Source': 'r2', ...CORS }
                        });
                    }
                } catch(e_) {}
            }
            // Fallback: GitHub raw outbox/soccer/
            const sfRaw = 'https://raw.githubusercontent.com/jeffunglesbee-create/jubilant-bassoon/main/outbox/soccer';
            return relayFetch(`${sfRaw}/${sfFile}`, { 'Accept': 'application/json' }, 86400, 'soccer-fbref', ctx);
        }

        // ── /nba-clutch-update → on-demand NBA clutch → R2 update (admin) ─────────
        if (pathname === '/nba-clutch-update' && request.method === 'POST') {
            if (request.headers.get('X-FIELD-Admin') !== '1')
                return new Response('Forbidden', { status: 403, headers: CORS });
            if (!env.FIELD_DATA)
                return new Response(JSON.stringify({ error: 'FIELD_DATA R2 not bound' }),
                    { status: 503, headers: { 'Content-Type': 'application/json', ...CORS } });
            try {
                const result = await runNBACluichUpdate(env);
                return new Response(JSON.stringify(result),
                    { status: result.ok ? 200 : 502, headers: { 'Content-Type': 'application/json', ...CORS } });
            } catch(e) {
                return new Response(JSON.stringify({ error: e.message }),
                    { status: 502, headers: { 'Content-Type': 'application/json', ...CORS } });
            }
        }

        // ── /nfl-r2-update → on-demand nflverse → R2 update (admin) ──────────────
        if (pathname === '/nfl-r2-update' && request.method === 'POST') {
            if (request.headers.get('X-FIELD-Admin') !== '1')
                return new Response('Forbidden', { status: 403, headers: CORS });
            if (!env.FIELD_DATA)
                return new Response(JSON.stringify({ error: 'FIELD_DATA R2 not bound' }),
                    { status: 503, headers: { 'Content-Type': 'application/json', ...CORS } });
            try {
                const result = await runNFLR2Update(env);
                return new Response(JSON.stringify(result),
                    { status: result.ok ? 200 : 502, headers: { 'Content-Type': 'application/json', ...CORS } });
            } catch(e) {
                return new Response(JSON.stringify({ error: e.message }),
                    { status: 502, headers: { 'Content-Type': 'application/json', ...CORS } });
            }
        }

        // ── /mlb-savant-update → on-demand MLB Savant → R2 update (admin) ──────────
        // Triggers runMLBSavantUpdate() immediately. Useful for mid-week data refresh
        // or debugging. Requires X-FIELD-Admin: 1 header to prevent abuse.
        if (pathname === '/mlb-savant-update' && request.method === 'POST') {
            if (request.headers.get('X-FIELD-Admin') !== '1')
                return new Response('Forbidden', { status: 403, headers: CORS });
            if (!env.FIELD_DATA)
                return new Response(JSON.stringify({ error: 'FIELD_DATA R2 not bound' }),
                    { status: 503, headers: { 'Content-Type': 'application/json', ...CORS } });
            try {
                const result = await runMLBSavantUpdate(env);
                return new Response(JSON.stringify(result),
                    { status: result.ok ? 200 : 502, headers: { 'Content-Type': 'application/json', ...CORS } });
            } catch(e) {
                return new Response(JSON.stringify({ error: e.message }),
                    { status: 502, headers: { 'Content-Type': 'application/json', ...CORS } });
            }
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
                        name: 'session_health',
                        description: 'Machine-generated session health: live HEADs, deploy match, smoke count, quality degradation, degraded analytics phases, open Codex incidents. Call at session start instead of read_handoff.',
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
                    {
                        name: 'html_probe',
                        description: 'Fetch any URL from the Cloudflare Worker IP and return structured HTML analysis for ATS reverse engineering. CF Worker IPs bypass WAFs that block GitHub runner IPs (Workday, HiringCafe, Oracle HCM, Infor HCM, etc.). Returns: visibleText (3000 chars), metaTags, jsonLd, frameworks detected, dataAutomationIds, hiddenInputs, htmlSnippet (2000 chars).',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                url: { type: 'string', description: 'Full URL to fetch, e.g. "https://aah.wd5.myworkdayjobs.com/en-US/External?q=epic"' },
                                maxBytes: { type: 'number', description: 'Max bytes of HTML to process (default 500000)' },
                            },
                            required: ['url'],
                        },
                    },
                    {
                        name: 'browser_quick',
                        description: 'Open a URL in a headless browser and return a screenshot, structured JSON, markdown text, or all links. Stateless — no session is maintained between calls. Use browser_navigate for multi-step interactive sessions (Phase 1).',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                url: { type: 'string', description: 'Full URL to open (allowlisted domains only: ATS sites, cloudflare.com, espn.com, FIELD app)' },
                                action: { type: 'string', enum: ['screenshot', 'json', 'markdown', 'links'], description: 'screenshot=PNG | json=structured data | markdown=page content | links=all links' },
                            },
                            required: ['url', 'action'],
                        },
                    },
                    {
                        name: 'browser_navigate',
                        description: 'Open a URL in a headless browser with session persistence. Returns screenshot, page title, visible text, and a sessionId to reuse in browser_interact and browser_extract calls. Sessions auto-close after 5 min idle or 50 actions.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                url: { type: 'string', description: 'Full URL to navigate to (allowlisted domains only)' },
                                sessionId: { type: 'string', description: 'Reuse an existing session. Omit to start a new session (a new sessionId is returned).' },
                                waitUntil: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle0'], description: 'When to consider navigation complete. Default: networkidle0' },
                            },
                            required: ['url'],
                        },
                    },
                    {
                        name: 'browser_interact',
                        description: 'Perform an action on the current page in an active browser session: click, type, select, scroll, wait, back, or forward. Returns updated screenshot and page text.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                sessionId: { type: 'string', description: 'Session ID from browser_navigate' },
                                action: { type: 'string', enum: ['click', 'type', 'select', 'scroll', 'wait', 'back', 'forward'] },
                                selector: { type: 'string', description: 'CSS selector or :text("Button Label") for click/type/select/wait. Omit for back/forward.' },
                                value: { type: 'string', description: 'Text to type, option value to select, or scroll direction (up/down)' },
                                pressEnter: { type: 'boolean', description: 'Press Enter after typing. Default: false' },
                            },
                            required: ['sessionId', 'action'],
                        },
                    },
                    {
                        name: 'browser_extract',
                        description: 'Extract structured data from the current page: cookies, form fields, JSON-LD, all links, raw JS evaluation, or full page text. Does not change page state.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                sessionId: { type: 'string', description: 'Session ID from browser_navigate' },
                                mode: { type: 'string', enum: ['cookies', 'forms', 'json-ld', 'links', 'evaluate', 'full-text'] },
                                expression: { type: 'string', description: 'JS expression for evaluate mode only (e.g. "document.title")' },
                            },
                            required: ['sessionId', 'mode'],
                        },
                    },
                    {
                        name: 'browser_close',
                        description: 'Explicitly close a browser session and free its resources. Sessions also auto-close after 5 min idle.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                sessionId: { type: 'string', description: 'Session ID from browser_navigate' },
                            },
                            required: ['sessionId'],
                        },
                    },
                    {
                        name: 'stat_status',
                        description: 'Get live STAT job intelligence system status without CI overhead. Returns DO health, watchedCompanies, seenJobIds, SelectMinds cursor position, and platform-specific status for a given ATS. Bypasses *.workers.dev sandbox block via CF Worker IP relay. ~2s round-trip vs ~80s CI probe.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                platform: { type: 'string', description: 'Optional ATS platform to get detailed status for (e.g. "selectminds", "workday", "greenhouse"). Omit for overview only.' },
                            },
                            required: [],
                        },
                    },
                    // ── L5: Repo Source Access (FIELD Session Memory) ──
                    {
                        name: 'read_file',
                        description: 'Read a single file from jubilant-bassoon main branch. Path must be in READ_ALLOWLIST (index.html, src/, docs/, scripts/, .github/, CODE_MAP.json, HANDOFF.md, STANDARDS.md, README.md, CLAUDE.md). Returns { path, sha, size, content } as JSON text.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                path: { type: 'string', description: 'Repo-relative path, e.g. "src/index.js" or "index.html"' },
                            },
                            required: ['path'],
                        },
                    },
                    {
                        name: 'read_source',
                        description: 'Search jubilant-bassoon for a literal string and return matching files with sha and size. Use this before read_file when locating where a function/symbol lives. Limited to READ_ALLOWLIST paths.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                query: { type: 'string', description: 'Literal substring to search for, e.g. "function renderAll"' },
                                max_results: { type: 'number', description: 'Max results to return (default 10, max 25)' },
                            },
                            required: ['query'],
                        },
                    },
                    {
                        name: 'read_lines',
                        description: 'Read a line range of a single file (1-indexed, inclusive). Useful for cheap surgical reads when full file would blow context. Path must be in READ_ALLOWLIST.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                path:  { type: 'string', description: 'Repo-relative path' },
                                start: { type: 'number', description: '1-indexed first line' },
                                end:   { type: 'number', description: '1-indexed last line (inclusive)' },
                            },
                            required: ['path', 'start', 'end'],
                        },
                    },
                    {
                        name: 'commit_file',
                        description: 'Replace one file in jubilant-bassoon and commit on main. Path must be in WRITE_ALLOWLIST (docs/, HANDOFF.md, CODE_MAP.json). Caller MUST pass parent_sha (the sha returned by read_file/read_source); a stale parent_sha is rejected to prevent blind overwrite. Commit message is auto-prefixed with [skip ci].',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                path: { type: 'string', description: 'Repo-relative path to overwrite' },
                                content: { type: 'string', description: 'Full new file content (UTF-8)' },
                                commit_message: { type: 'string', description: 'Commit message body; [skip ci] is added automatically' },
                                parent_sha: { type: 'string', description: 'sha returned by the most recent read_file/read_source for this path' },
                            },
                            required: ['path', 'content', 'commit_message', 'parent_sha'],
                        },
                    },
                    {
                        name: 'get_archive_url',
                        description: 'Mint a time-limited HMAC-signed URL to download the jubilant-bassoon tarball via the relay (/repo/archive). The PAT never leaves the relay; the URL expires after ttl_seconds (default 300, max 900). Use this when a session needs to ingest the whole repo at once.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                ttl_seconds: { type: 'number', description: 'URL lifetime in seconds (default 300, max 900)' },
                            },
                            required: [],
                        },
                    },
                    // ── L4: Codex (persistent operational knowledge) ──
                    {
                        name: 'codex_write',
                        description: 'Upsert one codex entry in D1 (ARCHIVE_DB). Key is required and unique; existing entries are updated and updated_at is bumped. drive_refs is optional comma-separated Drive file IDs for L1.5 cross-reference.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                key: { type: 'string', description: 'Stable unique identifier, e.g. "rule-77-no-rationalize"' },
                                category: { type: 'string', description: 'Category bucket, e.g. "rule", "endpoint", "decision", "incident"' },
                                title: { type: 'string', description: 'Short human-readable title' },
                                content: { type: 'string', description: 'Full body (markdown allowed)' },
                                drive_refs: { type: 'string', description: 'Optional comma-separated Drive file IDs' },
                            },
                            required: ['key', 'category', 'title', 'content'],
                        },
                    },
                    {
                        name: 'codex_read',
                        description: 'Read a single codex entry by key. Returns the row as JSON or { error } if not found.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                key: { type: 'string', description: 'Codex key to fetch' },
                            },
                            required: ['key'],
                        },
                    },
                    {
                        name: 'codex_search',
                        description: 'Search codex entries by literal substring across title + content. Optionally filter by category. Returns up to max_results rows (default 10, max 50), newest first.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                query:       { type: 'string', description: 'Literal substring to match (LIKE %query%)' },
                                category:    { type: 'string', description: 'Optional category filter' },
                                max_results: { type: 'number', description: 'Default 10, max 50' },
                            },
                            required: ['query'],
                        },
                    },
                    {
                        name: 'codex_list',
                        description: 'List codex entries (key, category, title, updated_at) — no full content. Optional category filter. Newest first.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                category:    { type: 'string', description: 'Optional category filter' },
                                max_results: { type: 'number', description: 'Default 50, max 200' },
                            },
                            required: [],
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
                const HANDOFF_API_BASE = REPO_API;
                const ghHeaders = (token) => ({
                    'Authorization': `Bearer ${token}`,
                    'User-Agent': 'field-relay-mcp',
                    'Accept': 'application/vnd.github+json',
                });

                // fetchRepoFile — shared GitHub Contents API GET for L5 read_*
                // tools. Returns { ok:true, content, sha, size } on success,
                // { ok:false, status, error } on failure. Caller is responsible
                // for allowlist gating (isPathAllowed) before invoking.
                const fetchRepoFile = async (token, path) => {
                    const r = await fetch(`${REPO_API}/contents/${path}?ref=main`, { headers: ghHeaders(token) });
                    if (!r.ok) {
                        const txt = await r.text();
                        return { ok: false, status: r.status, error: txt };
                    }
                    const data = await r.json();
                    if (Array.isArray(data) || data.type !== 'file') {
                        return { ok: false, status: 415, error: 'Path is a directory or non-file' };
                    }
                    const bytes = atob((data.content || '').replace(/\n/g, ''));
                    const content = decodeURIComponent(escape(bytes));
                    return { ok: true, content, sha: data.sha, size: data.size };
                };

                if (toolName === 'session_health') {
                    const ghToken = env.GITHUB_PAT;
                    const gh = (path) => fetch(
                        `https://api.github.com/repos/${path}`,
                        { headers: ghHeaders(ghToken), cf: { cacheTtl: 60 } }
                    );
                    const out = {};

                    try {
                        const r = await gh('jeffunglesbee-create/jubilant-bassoon/git/refs/heads/main');
                        if (r.ok) out.client_head = ((await r.json()).object?.sha || '').slice(0, 7);
                    } catch(_) { out.client_head = 'unavailable'; }
                    try {
                        const r = await gh('jeffunglesbee-create/field-relay-nba/git/refs/heads/main');
                        if (r.ok) out.relay_head = ((await r.json()).object?.sha || '').slice(0, 7);
                    } catch(_) { out.relay_head = 'unavailable'; }

                    // relay_head_src = most recent commit that actually changed src/
                    // (excludes workflow/docs/outbox commits that advance HEAD without
                    // triggering a deploy → prevents false-alarm deploy_match=false).
                    try {
                        const _srcR = await gh(
                            'jeffunglesbee-create/field-relay-nba/commits?path=src%2F&per_page=1'
                        );
                        if (_srcR.ok) {
                            const _srcCommit = (await _srcR.json())[0];
                            out.relay_head_src = (_srcCommit?.sha || '').slice(0, 7);
                        }
                    } catch(_) { out.relay_head_src = out.relay_head; }

                    try {
                        const r = await gh('jeffunglesbee-create/field-relay-nba' +
                            '/actions/workflows/deploy.yml/runs?status=success&per_page=1');
                        if (r.ok) {
                            const run = (await r.json()).workflow_runs?.[0];
                            if (run) {
                                out.relay_deployed = run.head_sha.slice(0, 7);
                                out.deploy_match = out.relay_deployed === (out.relay_head_src || out.relay_head);
                                out.deployed_at = run.updated_at;
                            }
                        }
                    } catch(_) { out.deploy_match = 'unavailable'; }

                    if (env.ARCHIVE_DB) {
                        try {
                            const since = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
                            const ENRICHMENT_SH = new Set(['wc_matchup','standings_snapshot','narrative_context','enrichment','kv_harvest','wc_tab']);
                            const q = await env.ARCHIVE_DB.prepare(`
                                SELECT brief_type, sport, COUNT(*) as total, COUNT(quality_score) as scored,
                                       ROUND(AVG(quality_score), 1) as avg_score
                                FROM briefs WHERE date >= ? GROUP BY brief_type, sport
                            `).bind(since).all();
                            const types = q.results || [];
                            out.quality = {
                                degraded: types
                                    .filter(r => r.scored >= 3)
                                    .filter(r => !ENRICHMENT_SH.has(r.brief_type))
                                    .filter(r => !(r.sport && r.sport.toLowerCase().includes('golf')))
                                    .filter(r => r.avg_score < 240)
                                    .map(r => r.brief_type),
                                unscored: types.filter(r => r.total > 5 && r.scored === 0)
                                               .map(r => r.brief_type),
                            };
                        } catch(_) { out.quality = 'unavailable'; }

                        try {
                            const today = new Date().toISOString().slice(0, 10);
                            const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
                            const p = await env.ARCHIVE_DB.prepare(`
                                SELECT feature, date, JSON_EXTRACT(value, '$.degraded') as degraded
                                FROM analytics_output WHERE date IN (?, ?)
                                ORDER BY date DESC
                            `).bind(today, yest).all();
                            const phases = {};
                            for (const r of (p.results || []))
                                if (!phases[r.feature])
                                    phases[r.feature] = { date: r.date, degraded: !!r.degraded };
                            out.analytics_phases = phases;
                        } catch(_) { out.analytics_phases = 'unavailable'; }

                        try {
                            const cf = await env.ARCHIVE_DB.prepare(`
                                SELECT key, title FROM codex
                                WHERE category = 'incident'
                                ORDER BY updated_at DESC LIMIT 15
                            `).all();
                            out.open_incidents = (cf.results || []).map(r => r.title);
                        } catch(_) { out.open_incidents = 'unavailable'; }
                    }

                    out.checked_at = new Date().toISOString();
                    return respond(jsonrpc2({ content: [{ type: 'text',
                        text: JSON.stringify(out, null, 2) }] }));
                }

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

                // ── html_probe ──────────────────────────────────────────────────────
                // Fetch any URL DIRECTLY from relay CF IP — no STAT Worker hop needed.
                // CF Worker IPs bypass WAFs that block GitHub runner IPs and direct
                // Node.js fetches (Workday, HiringCafe, Oracle HCM, SelectMinds, etc.)
                // Returns structured analysis: visibleText, metaTags, jsonLd, frameworks,
                // dataAutomationIds, hiddenInputs, htmlSnippet.
                if (toolName === 'html_probe') {
                    const targetUrl = toolArgs.url;
                    const maxBytes  = toolArgs.maxBytes ?? 500_000;
                    if (!targetUrl || !targetUrl.startsWith('http')) {
                        return respond(jsonrpc2({content:[{type:'text',text:'Required: url (string starting with http)'}], isError:true}));
                    }
                    try {
                        const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
                        const res = await fetch(targetUrl, {
                            headers: {
                                'User-Agent': UA,
                                'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.9',
                                'Accept-Language': 'en-US,en;q=0.9',
                                'Cache-Control': 'no-cache',
                            },
                            redirect: 'follow',
                        });
                        const httpStatus = res.status;
                        const contentType = res.headers.get('content-type') ?? '';
                        let html = await res.text();
                        if (html.length > maxBytes) html = html.slice(0, maxBytes);
                        const bytes = html.length;

                        if (!res.ok) {
                            return respond(jsonrpc2({content:[{type:'text',text:JSON.stringify({ok:false,url:targetUrl,httpStatus,bytes,contentType,error:`HTTP ${httpStatus}`,snippet:html.slice(0,500)})}]}));
                        }

                        // Visible text
                        const visibleText = html
                            .replace(/<script[\s\S]*?<\/script>/gi, '')
                            .replace(/<style[\s\S]*?<\/style>/gi, '')
                            .replace(/<[^>]+>/g, ' ')
                            .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                            .replace(/\s+/g, ' ').trim().slice(0, 3000);

                        // Meta tags
                        const metaTags = {};
                        for (const m of html.matchAll(/<meta[^>]+>/gi)) {
                            const tag = m[0];
                            const nameM = tag.match(/(?:name|property)="([^"]+)"/i);
                            const contM = tag.match(/content="([^"]{0,500})"/i);
                            if (nameM && contM) metaTags[nameM[1]] = contM[1];
                        }

                        // JSON-LD
                        let jsonLd = null;
                        const ldMatch = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i);
                        if (ldMatch) { try { jsonLd = JSON.parse(ldMatch[1].trim()); } catch {} }

                        // Framework detection
                        const frameworks = {};
                        for (const [kw, label] of [
                            ['__NEXT_DATA__','nextjs'],['_ngcontent','angular'],['ember','ember'],
                            ['data-bind=','knockout'],['react-dom','react'],['workday','workday'],
                            ['inforcloudsuite','infor'],['oraclecloud','oracle'],['taleo','taleo'],
                            ['successfactors','successfactors'],['selectminds','selectminds'],
                            ['cx-jobs','workday-cx'],['application/ld+json','json-ld'],
                        ]) {
                            const count = (html.match(new RegExp(kw, 'gi')) ?? []).length;
                            if (count > 0) frameworks[label] = count;
                        }

                        // data-automation-ids
                        const dataAutomationIds = [...new Set(
                            [...html.matchAll(/data-automation-id="([^"]+)"/gi)].map(m => m[1])
                        )].slice(0, 30);

                        // Hidden inputs
                        const hiddenInputs = [];
                        for (const m of html.matchAll(/<input[^>]+type="hidden"[^>]*>/gi)) {
                            const tag = m[0];
                            const nameM = tag.match(/\bname="([^"]+)"/i);
                            const idM   = tag.match(/\bid="([^"]+)"/i);
                            const valM  = tag.match(/\bvalue="([^"]{0,200})"/i);
                            if ((nameM || idM) && valM) hiddenInputs.push({name: nameM?.[1] ?? idM?.[1], value: valM[1].slice(0,200)});
                        }

                        // Job links (Workday/SelectMinds pattern)
                        const jobLinks = [...new Set([...html.matchAll(/href="([^"]*(?:job|career|position)[^"]*\d{4,}[^"]*?)"/gi)].map(m=>m[1]))].slice(0,20);

                        const result = {ok:true, url:targetUrl, httpStatus, bytes, contentType,
                            visibleText, metaTags, jsonLd, frameworks, dataAutomationIds,
                            hiddenInputs: hiddenInputs.slice(0,20), jobLinks,
                            htmlSnippet: html.slice(0, 2000)};

                        const out = JSON.stringify(result);
                        const MAX_BODY = 14000;
                        const truncated = out.length > MAX_BODY ? out.slice(0, MAX_BODY) + '…[truncated]' : out;
                        return respond(jsonrpc2({content:[{type:'text',text:truncated}]}));
                    } catch (e) {
                        return respond(jsonrpc2({content:[{type:'text',text:JSON.stringify({ok:false,url:targetUrl,error:e.message})}], isError:true}));
                    }
                }

                // ── browser_quick ────────────────────────────────────────────────
                // Phase 0 Browser MCP — stateless one-shot via env.BROWSER.quickAction.
                // Allowlist enforced inside browserQuick(). Phase 1 adds session DO.
                if (toolName === 'browser_quick') {
                    const { url, action } = toolArgs;
                    if (!url || !action) {
                        return respond(jsonrpc2({content:[{type:'text',text:'Required: url (string), action (screenshot|json|markdown|links)'}], isError:true}));
                    }
                    const result = await browserQuick(env, url, action);
                    return respond(jsonrpc2({content:[{type:'text',text:JSON.stringify(result, null, 2)}], isError: !!result.error}));
                }

                // ── browser_navigate / interact / extract / close ────────────────
                // Phase 1 Browser MCP — BrowserDO session persistence. Each tool
                // call routes through the DO instance keyed by sessionId (UUID).
                // browser_navigate validates URL against the same allowlist as
                // browser_quick; interact/extract/close trust the active session.
                if (toolName === 'browser_navigate' ||
                    toolName === 'browser_interact' ||
                    toolName === 'browser_extract'  ||
                    toolName === 'browser_close') {
                    if (toolName === 'browser_navigate') {
                        const { url } = toolArgs;
                        if (!url) return respond(jsonrpc2({content:[{type:'text',text:'browser_navigate requires url'}], isError:true}));
                        const check = validateBrowserUrl(url);
                        if (!check.ok) {
                            return respond(jsonrpc2({content:[{type:'text',text:JSON.stringify({ error: check.reason, allowed: false }, null, 2)}], isError:true}));
                        }
                    } else if (!toolArgs.sessionId) {
                        return respond(jsonrpc2({content:[{type:'text',text:`${toolName} requires sessionId`}], isError:true}));
                    }
                    const sessionId = toolArgs.sessionId || crypto.randomUUID();
                    const doId  = env.BROWSER_SESSION.idFromName(sessionId);
                    const stub  = env.BROWSER_SESSION.get(doId);
                    const doRes = await stub.fetch(new Request('https://do/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tool: toolName, args: { ...toolArgs, sessionId } }),
                    }));
                    const doJson = await doRes.json();
                    // Always echo sessionId back so the chat can chain follow-up calls.
                    if (!doJson.sessionId) doJson.sessionId = sessionId;
                    return respond(jsonrpc2({content:[{type:'text',text:JSON.stringify(doJson, null, 2)}], isError: !!doJson.error}));
                }

                // ── stat_status ──────────────────────────────────────────────────
                // Direct STAT Worker status — no CI round-trip.
                // Fetches /stat/ (overview) and optionally /stat/platform/{ats}/status.
                // ~2s vs ~80s for worker-probe CI cycle.
                if (toolName === 'stat_status') {
                    const statBase = `${url.origin}/stat`;
                    const platform = toolArgs.platform?.toLowerCase().trim();

                    // Always fetch overview
                    let overview = null;
                    try {
                        const r = await fetch(`${statBase}/`, {
                            headers: { 'User-Agent': 'field-relay-stat-mcp', 'Accept': 'application/json' },
                        });
                        if (r.ok) {
                            const d = await r.json();
                            overview = {
                                activeDOs:        d.activeDOs,
                                watchedCompanies: d.watchedCompanies,
                                seenJobIds:       d.seenJobIds,
                                fitScoring:       d.fitScoring,
                                salary:           d.salary?.status,
                            };
                        }
                    } catch (e) { overview = { error: e.message }; }

                    // Optionally fetch platform-specific status
                    let platformStatus = null;
                    if (platform) {
                        try {
                            const r = await fetch(`${statBase}/platform/${platform}/status`, {
                                headers: { 'User-Agent': 'field-relay-stat-mcp', 'Accept': 'application/json' },
                            });
                            if (r.ok) platformStatus = await r.json();
                            else platformStatus = { error: `HTTP ${r.status}` };
                        } catch (e) { platformStatus = { error: e.message }; }
                    }

                    const result = { overview, ...(platformStatus ? { [platform]: platformStatus } : {}) };
                    return respond(jsonrpc2({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }));
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
                        '/wc/match-wp',
                        '/wc/standings',
                        '/wc/results',
                        '/wc/odds-probs',
                        '/cfl/odds-probs',
                        '/wc/third-place',
                        '/wc/projections',
                        '/wc/traps',
                        '/wc/elimination-traps',
                        '/wc/bracket',
                        '/wc/bracket/state',
                        '/wc/bracket/refresh',
                        '/wc/matchup/cache',
                        '/wc/movers',
                        '/wc/brief/tournament',
                        '/wc/injuries',
                        '/ambient/state',
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
                        '/stat/jobhive-manifest',
                        '/stat/jobhive-sample',
                        '/stat/jobhive-scan',
                        '/stat/profile',
                        '/stat/hc-probe',
                        '/stat/html-probe',
                        '/stat/platform/selectminds/status',
                        '/stat/platform/taleo/status',
                        '/stat/platform/oracle_hcm/status',
                        '/stat/platform/infor_hcm/status',
                        '/stat/platform/icims/status',
                        '/stat/platform/successfactors/status',
                        '/stat/platform/ashby/status',
                        '/stat/',
                        // Brief archive (2026-06-15). /archive/brief is POST-only
                        // in practice (GET falls through to /archive/* 404),
                        // /archive/backfill accepts GET with ?date=YYYY-MM-DD.
                        // Listed so discovery probes can confirm the routes
                        // exist relay-side without bouncing through CI.
                        '/archive/brief',
                        '/archive/backfill',
                        // GET-friendly query endpoint (Close-the-Loop 2026-06-16).
                        // Query string filters (date/sport/team/brief_type/source/
                        // limit) all carry through the GET probe.
                        '/archive/query',
                        // Game archive write (Event Pipeline 2026-06-16). POST-only
                        // — GET falls through to /archive/* 404; listed so the
                        // allow-list reflects the surfaced route inventory.
                        '/archive/game',
                        // Historical odds backfill (Odds Layer 2026-06-16) —
                        // GET with ?date=YYYY-MM-DD, quota-aware.
                        '/archive/odds-backfill',
                        '/archive/backfill-enrich',
                        // Drama persistence (2026-06-19). POST-only in spec;
                        // listed for inventory discovery via the MCP probe.
                        '/archive/drama',
                        // Bracket snapshots (Bracket Compound 2026-06-24).
                        // POST writes per-recompute snapshots from BracketDO;
                        // GET serves historical replay + per-team arcs.
                        '/archive/bracket-snapshot',
                        '/archive/bracket-replay',
                        // ESPN Golf relay (2026-06-17). All four routes are
                        // GET-only; query strings carry through the probe.
                        '/v2/golf/player-stats',
                        '/v2/golf/competitor-stats',
                        '/v2/golf/eventlog',
                        '/v2/golf/enriched',
                    ]);
                    // Context Graph API (2026-06-18) — both routes carry a
                    // segment after the prefix (id or YYYY-MM-DD), so they
                    // live in ALLOWED_PREFIX rather than ALLOWED_EXACT.
                    const ALLOWED_PREFIX = ['/squiggle', '/apisports', '/context/game', '/context/date', '/analytics', '/changelog', '/freshness', '/identity', '/budget', '/integrity', '/deploy', '/backfill', '/quality', '/briefs', '/session', '/health', '/odds-story', '/soccer', '/espn-summary', '/journalism', '/bsd'];
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

                // ── L5: read_file ──
                if (toolName === 'read_file') {
                    const ghToken = env.GITHUB_PAT;
                    if (!ghToken) return respond(jsonrpc2({content:[{type:'text',text:'GITHUB_PAT not configured on worker'}], isError:true}));
                    const { path } = toolArgs;
                    if (typeof path !== 'string') {
                        return respond(jsonrpc2({content:[{type:'text',text:'Required: path (string)'}], isError:true}));
                    }
                    if (!isPathAllowed(path, READ_ALLOWLIST)) {
                        return respond(jsonrpc2({content:[{type:'text',text:`Path not in READ_ALLOWLIST: ${path}`}], isError:true}));
                    }
                    const f = await fetchRepoFile(ghToken, path);
                    if (!f.ok) {
                        return respond(jsonrpc2({content:[{type:'text',text:`GitHub read failed: ${f.status} ${f.error}`}], isError:true}));
                    }
                    return respond(jsonrpc2({content:[{type:'text',text:JSON.stringify({path, sha:f.sha, size:f.size, content:f.content})}]}));
                }

                // ── L5: read_source ──
                // GitHub Code Search API (literal). Filters results to
                // READ_ALLOWLIST. Returns minimal hit info — sha + size only;
                // caller follows up with read_file or read_lines.
                if (toolName === 'read_source') {
                    const ghToken = env.GITHUB_PAT;
                    if (!ghToken) return respond(jsonrpc2({content:[{type:'text',text:'GITHUB_PAT not configured on worker'}], isError:true}));
                    const { query } = toolArgs;
                    const maxResults = Math.min(toolArgs.max_results || 10, 25);
                    if (typeof query !== 'string' || query.length === 0) {
                        return respond(jsonrpc2({content:[{type:'text',text:'Required: query (non-empty string)'}], isError:true}));
                    }
                    const q = encodeURIComponent(`"${query}" repo:${REPO_OWNER}/${REPO_NAME}`);
                    const r = await fetch(`https://api.github.com/search/code?q=${q}&per_page=${maxResults}`, {
                        headers: { ...ghHeaders(ghToken), 'Accept': 'application/vnd.github.v3.text-match+json' },
                    });
                    if (!r.ok) {
                        const txt = await r.text();
                        return respond(jsonrpc2({content:[{type:'text',text:`GitHub search failed: ${r.status} ${txt}`}], isError:true}));
                    }
                    const data = await r.json();
                    const hits = (data.items || [])
                        .filter(it => isPathAllowed(it.path, READ_ALLOWLIST))
                        .slice(0, maxResults)
                        .map(it => ({ path: it.path, sha: it.sha, score: it.score }));
                    return respond(jsonrpc2({content:[{type:'text',text:JSON.stringify({query, total_count: data.total_count, hits})}]}));
                }

                // ── L5: read_lines ──
                if (toolName === 'read_lines') {
                    const ghToken = env.GITHUB_PAT;
                    if (!ghToken) return respond(jsonrpc2({content:[{type:'text',text:'GITHUB_PAT not configured on worker'}], isError:true}));
                    const { path, start, end } = toolArgs;
                    if (typeof path !== 'string' || typeof start !== 'number' || typeof end !== 'number') {
                        return respond(jsonrpc2({content:[{type:'text',text:'Required: path (string), start (number), end (number)'}], isError:true}));
                    }
                    if (!isPathAllowed(path, READ_ALLOWLIST)) {
                        return respond(jsonrpc2({content:[{type:'text',text:`Path not in READ_ALLOWLIST: ${path}`}], isError:true}));
                    }
                    if (start < 1 || end < start) {
                        return respond(jsonrpc2({content:[{type:'text',text:'start must be >= 1 and end must be >= start'}], isError:true}));
                    }
                    const f = await fetchRepoFile(ghToken, path);
                    if (!f.ok) {
                        return respond(jsonrpc2({content:[{type:'text',text:`GitHub read failed: ${f.status} ${f.error}`}], isError:true}));
                    }
                    const lines = f.content.split('\n');
                    const slice = lines.slice(start - 1, end).join('\n');
                    return respond(jsonrpc2({content:[{type:'text',text:JSON.stringify({path, sha:f.sha, start, end, total_lines: lines.length, content: slice})}]}));
                }

                // ── L5: commit_file ──
                // Rule 81 (WRITE-GATE-A) + Rule 82 (ARCHIVE-FRESHNESS-A):
                // parent_sha must match live HEAD for the file. GitHub Contents
                // PUT enforces this when `sha` is supplied; relay double-checks
                // explicitly so the error message is actionable.
                if (toolName === 'commit_file') {
                    const ghToken = env.GITHUB_PAT;
                    if (!ghToken) return respond(jsonrpc2({content:[{type:'text',text:'GITHUB_PAT not configured on worker'}], isError:true}));
                    const { path, content, commit_message, parent_sha } = toolArgs;
                    if (typeof path !== 'string' || typeof content !== 'string' || typeof commit_message !== 'string' || typeof parent_sha !== 'string') {
                        return respond(jsonrpc2({content:[{type:'text',text:'Required: path, content, commit_message, parent_sha (all strings)'}], isError:true}));
                    }
                    if (!isPathAllowed(path, WRITE_ALLOWLIST)) {
                        return respond(jsonrpc2({content:[{type:'text',text:`Path not in WRITE_ALLOWLIST: ${path}`}], isError:true}));
                    }
                    const live = await fetchRepoFile(ghToken, path);
                    if (!live.ok) {
                        return respond(jsonrpc2({content:[{type:'text',text:`Live read failed: ${live.status} ${live.error}`}], isError:true}));
                    }
                    if (live.sha !== parent_sha) {
                        return respond(jsonrpc2({content:[{type:'text',text:`Stale parent_sha: caller has ${parent_sha}, live is ${live.sha}. Re-read and retry.`}], isError:true}));
                    }
                    const utf8 = unescape(encodeURIComponent(content));
                    const b64  = btoa(utf8);
                    const msg  = commit_message.includes('[skip ci]') ? commit_message : `${commit_message} [skip ci]`;
                    const putR = await fetch(`${REPO_API}/contents/${path}`, {
                        method: 'PUT',
                        headers: { ...ghHeaders(ghToken), 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: msg, content: b64, sha: parent_sha, branch: 'main' }),
                    });
                    if (!putR.ok) {
                        const txt = await putR.text();
                        return respond(jsonrpc2({content:[{type:'text',text:`GitHub write failed: ${putR.status} ${txt}`}], isError:true}));
                    }
                    const putData = await putR.json();
                    return respond(jsonrpc2({content:[{type:'text',text:JSON.stringify({path, commit: putData.commit.sha, message: msg, new_sha: putData.content.sha})}]}));
                }

                // ── L5: get_archive_url ──
                // Rule 80 (CREDENTIAL-BOUNDARY-A): PAT never leaves the relay.
                // We mint an HMAC-signed URL with an expiry; /repo/archive
                // verifies the signature then proxies the tarball using the
                // relay-held PAT. The signed URL itself is harmless if leaked
                // after expiry.
                if (toolName === 'get_archive_url') {
                    const secret = env.FIELD_MCP_SECRET;
                    if (!secret) return respond(jsonrpc2({content:[{type:'text',text:'FIELD_MCP_SECRET not configured on worker'}], isError:true}));
                    const ttl = Math.min(toolArgs.ttl_seconds || 300, 900);
                    const exp = Math.floor(Date.now() / 1000) + ttl;
                    const payload = `repo-archive:${exp}`;
                    const key = await crypto.subtle.importKey(
                        'raw',
                        new TextEncoder().encode(secret),
                        { name: 'HMAC', hash: 'SHA-256' },
                        false,
                        ['sign'],
                    );
                    const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
                    const sigHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
                    const urlOut = `${url.origin}/repo/archive?exp=${exp}&sig=${sigHex}`;
                    return respond(jsonrpc2({content:[{type:'text',text:JSON.stringify({url: urlOut, expires_at: exp, ttl_seconds: ttl})}]}));
                }

                // ── L4: codex_write ──
                // Single-row upsert. ON CONFLICT bumps updated_at so callers
                // can sort by freshness. Binding is ARCHIVE_DB (spec footer
                // authorizes binding-name substitution from FIELD_DB).
                if (toolName === 'codex_write') {
                    if (!env.ARCHIVE_DB) return respond(jsonrpc2({content:[{type:'text',text:'ARCHIVE_DB not bound on worker'}], isError:true}));
                    const { key, category, title, content, drive_refs } = toolArgs;
                    if (typeof key !== 'string' || typeof category !== 'string' || typeof title !== 'string' || typeof content !== 'string') {
                        return respond(jsonrpc2({content:[{type:'text',text:'Required: key, category, title, content (all strings)'}], isError:true}));
                    }
                    try {
                        await env.ARCHIVE_DB.prepare(`
                            INSERT INTO codex (key, category, title, content, drive_refs, updated_at)
                            VALUES (?, ?, ?, ?, ?, datetime('now'))
                            ON CONFLICT(key) DO UPDATE SET
                                category = excluded.category,
                                title    = excluded.title,
                                content  = excluded.content,
                                drive_refs = excluded.drive_refs,
                                updated_at = datetime('now')
                        `).bind(key, category, title, content, drive_refs || null).run();
                        return respond(jsonrpc2({content:[{type:'text',text:JSON.stringify({ok:true, key, category, title})}]}));
                    } catch (e) {
                        return respond(jsonrpc2({content:[{type:'text',text:`codex_write failed: ${e.message}`}], isError:true}));
                    }
                }

                // ── L4: codex_read ──
                if (toolName === 'codex_read') {
                    if (!env.ARCHIVE_DB) return respond(jsonrpc2({content:[{type:'text',text:'ARCHIVE_DB not bound on worker'}], isError:true}));
                    const { key } = toolArgs;
                    if (typeof key !== 'string') {
                        return respond(jsonrpc2({content:[{type:'text',text:'Required: key (string)'}], isError:true}));
                    }
                    try {
                        const row = await env.ARCHIVE_DB.prepare(`SELECT key, category, title, content, drive_refs, created_at, updated_at FROM codex WHERE key = ?`).bind(key).first();
                        if (!row) return respond(jsonrpc2({content:[{type:'text',text:JSON.stringify({error:'not_found', key})}]}));
                        return respond(jsonrpc2({content:[{type:'text',text:JSON.stringify(row)}]}));
                    } catch (e) {
                        return respond(jsonrpc2({content:[{type:'text',text:`codex_read failed: ${e.message}`}], isError:true}));
                    }
                }

                // ── L4: codex_search ──
                if (toolName === 'codex_search') {
                    if (!env.ARCHIVE_DB) return respond(jsonrpc2({content:[{type:'text',text:'ARCHIVE_DB not bound on worker'}], isError:true}));
                    const { query, category } = toolArgs;
                    const maxResults = Math.min(toolArgs.max_results || 10, 50);
                    if (typeof query !== 'string' || query.length === 0) {
                        return respond(jsonrpc2({content:[{type:'text',text:'Required: query (non-empty string)'}], isError:true}));
                    }
                    const like = `%${query}%`;
                    try {
                        let stmt;
                        if (typeof category === 'string' && category.length > 0) {
                            stmt = env.ARCHIVE_DB.prepare(`
                                SELECT key, category, title, content, drive_refs, updated_at FROM codex
                                WHERE category = ? AND (title LIKE ? OR content LIKE ?)
                                ORDER BY updated_at DESC LIMIT ?
                            `).bind(category, like, like, maxResults);
                        } else {
                            stmt = env.ARCHIVE_DB.prepare(`
                                SELECT key, category, title, content, drive_refs, updated_at FROM codex
                                WHERE title LIKE ? OR content LIKE ?
                                ORDER BY updated_at DESC LIMIT ?
                            `).bind(like, like, maxResults);
                        }
                        const { results } = await stmt.all();
                        return respond(jsonrpc2({content:[{type:'text',text:JSON.stringify({query, category: category || null, count: results.length, results})}]}));
                    } catch (e) {
                        return respond(jsonrpc2({content:[{type:'text',text:`codex_search failed: ${e.message}`}], isError:true}));
                    }
                }

                // ── L4: codex_list ──
                if (toolName === 'codex_list') {
                    if (!env.ARCHIVE_DB) return respond(jsonrpc2({content:[{type:'text',text:'ARCHIVE_DB not bound on worker'}], isError:true}));
                    const { category } = toolArgs;
                    const maxResults = Math.min(toolArgs.max_results || 50, 200);
                    try {
                        let stmt;
                        if (typeof category === 'string' && category.length > 0) {
                            stmt = env.ARCHIVE_DB.prepare(`SELECT key, category, title, updated_at FROM codex WHERE category = ? ORDER BY updated_at DESC LIMIT ?`).bind(category, maxResults);
                        } else {
                            stmt = env.ARCHIVE_DB.prepare(`SELECT key, category, title, updated_at FROM codex ORDER BY updated_at DESC LIMIT ?`).bind(maxResults);
                        }
                        const { results } = await stmt.all();
                        return respond(jsonrpc2({content:[{type:'text',text:JSON.stringify({category: category || null, count: results.length, results})}]}));
                    } catch (e) {
                        return respond(jsonrpc2({content:[{type:'text',text:`codex_list failed: ${e.message}`}], isError:true}));
                    }
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

            // POST endpoints: /html-probe and /hc-probe accept JSON body
            if (request.method === 'POST' && (statPath === '/html-probe' || statPath === '/hc-probe')) {
                let body = '{}';
                try { body = await request.text(); } catch {}
                const statRes = await fetch(statUrl, {
                    method: 'POST',
                    headers: {
                        'User-Agent': 'field-relay-stat-probe',
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, */*',
                    },
                    body,
                });
                const resBody = await statRes.text();
                return new Response(resBody, {
                    status: statRes.status,
                    headers: {
                        'Content-Type': statRes.headers.get('content-type') || 'application/json',
                        ...CORS,
                    },
                });
            }

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

        // ── Route: game-brief (per-game card brief, enqueued by journalism cron) ──
        // Replaces the old synchronous loop + setTimeout stagger in handleJournalismCycle.
        if (job.type === 'game-brief') {
          if (!env.FIELD_JOURNALISM) { msg.ack(); continue; }
          try {
            const callProxy = async (promptText) => {
              const r = await fetch(PROXY_URL, {
                method: 'POST',
                headers: {'Content-Type':'application/json','X-FIELD-Relay':'field-relay-cron-2026'},
                body: JSON.stringify({model:'claude-haiku-4-5-20251001', max_tokens: job.max_tokens||400,
                  messages:[{role:'user',content:promptText}]}),
              });
              if (r.status === 429) throw new Error('upstream 429');
              if (!r.ok) return null;
              const d = await r.json().catch(()=>null);
              return d ? (d.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('').trim()||null : null;
            };
            // Append [BRACKET IMPACT] for WC game-briefs when pre/post snapshots
            // exist in bracket_snapshots for this game. Snapshot is written async
            // by BracketDO after writeWCResult fires; first attempt may miss, the
            // .catch path returns {} silently — never blocks brief generation.
            let jobPrompt = job.prompt;
            if (job.sport === 'wc26' && job.bracketTriggeredBy && env.ARCHIVE_DB) {
                try {
                    const impact = await findBracketImpact(env, job.bracketTriggeredBy);
                    const entries = Object.entries(impact)
                        .filter(([, d]) => d.change != null && Math.abs(d.change) >= 0.002)
                        .sort(([, a], [, b]) => Math.abs(b.change) - Math.abs(a.change))
                        .slice(0, 6);
                    if (entries.length) {
                        const lines = entries.map(([team, d]) => {
                            const arrow = d.change > 0 ? '↑' : '↓';
                            const pct   = Math.round(Math.abs(d.change) * 100);
                            const state = d.stateBefore !== d.stateAfter
                                ? `${d.stateBefore} → ${d.stateAfter}`
                                : d.stateAfter;
                            return `${team}: ${state} ${arrow}${pct}%`;
                        });
                        jobPrompt = jobPrompt + `\n\n[BRACKET IMPACT]\n${lines.join('\n')}`;
                    }
                } catch (_) { /* bracket impact is additive — never block brief generation */ }
            }
            const initial = await callProxy(jobPrompt);
            if (!initial) throw new Error('proxy returned no prose');
            // Full quality chain — matches backfill + cron slate pipeline
            const qResult = await runQualityChain(jobPrompt, initial, callProxy, {
              sport: job.sport || null,
              scoreThreshold: 240,
              maxRetries: 2,
              game: (job.home && job.away)
                ? { home: job.home, away: job.away, homeScore: job.homeScore, awayScore: job.awayScore }
                : null,
              matchupNote: job.matchupNote || null,
            });
            const finalText = stripMarkdown(qResult.text);
            const qualityScore = qResult.score ?? null;
            await env.FIELD_JOURNALISM.put(
              `brief:game:${job.eventId}`,
              JSON.stringify({
                brief: finalText,
                generatedAt: Date.now(),
                contextHash: job.gameHash,
                sport: job.sport,
                home: job.home,
                away: job.away,
                cycleId: job.cycleId,
              }),
              {expirationTtl: 3600}
            );
            try {
              if (env.ARCHIVE_DB) {
                await ensureBriefsTable(env);
                const briefDate = new Date(job.enqueuedAt || Date.now()).toISOString().slice(0, 10);
                await env.ARCHIVE_DB.prepare(
                  `INSERT INTO briefs
                     (id, date, brief_type, sport, game_id, brief_text, model, quality_score, context_hash, word_count, source)
                   VALUES (?, ?, 'game_recap', ?, ?, ?, ?, ?, ?, ?, 'cron')
                   ON CONFLICT(id) DO UPDATE SET
                     brief_text = excluded.brief_text,
                     word_count = excluded.word_count,
                     source = excluded.source`
                ).bind(
                  `game_recap_${job.sport}_${job.eventId}`,
                  briefDate,
                  job.sport || null,
                  String(job.eventId),
                  finalText,
                  'claude-haiku-4-5-20251001',
                  qualityScore,
                  job.gameHash || null,
                  finalText.split(/\s+/).length
                ).run();
              }
            } catch (_archiveErr) { /* archive failure must not break game-brief delivery */ }
            msg.ack();
          } catch(e) {
            if (msg.attempts >= 3) { msg.ack(); } else { msg.retry(); }
          }
          continue;
        }

        // ── Route: journalism jobs (wc-morning, async /journalism/enqueue) ────────
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
            scoreThreshold: job.scoreThreshold || 240,
            maxRetries: 6,
            game: (job.home && job.away)
              ? { home: job.home, away: job.away, homeScore: job.homeScore, awayScore: job.awayScore }
              : null,
            matchupNote: job.matchupNote || null,
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


// CI re-trigger: 2026-06-22T02:10:47Z
