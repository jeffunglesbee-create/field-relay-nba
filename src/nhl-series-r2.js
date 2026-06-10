// ─────────────────────────────────────────────────────────────────────────────
// FIELD — NHL SCF Series-Adjusted Special Teams → R2
//
// Aggregates per-game PP/PK stats from NHL gamecenter boxscores across all
// completed SCF games. Writes series-adjusted window to R2 so journalism
// and Scout's Pick use THIS SERIES performance rather than season averages.
//
// Problem solved: NHL_SPECIAL_TEAMS (inline) shows season/playoff-entry stats.
// CAR pk:93.5 was their pre-SCF PK%. After 4 SCF games, the actual series PK%
// may differ substantially — especially when one team has found an exploit.
//
// Source: api-web.nhle.com/v1/gamecenter/{id}/boxscore
//   - playerByGameStats: powerPlayGoals per player (sum = team PPG)
//   - pim per player (proxy for PP opportunities against)
// PBP not needed — boxscore aggregation is sufficient for PP%/PK%.
//
// R2 key: nhl/scf-2026/series-stats.json
// Relay route: /nhl-series/{series}/stats → R2-first
// Also computes series PDO (shooting% + save%) from top-level bs.sog + bs.score.
// Raw PDO (all situations, not score-adjusted) is sufficient for journalism context.
// NST blocked (CF Turnstile 403) — NHL boxscore data makes NST dependency moot.
// Cron: after each SCF game (runs every 15 min — picks up new games automatically)
//
// Verified: api-web.nhle.com returns 200 from Workers Plus IPs (June 10 2026)
// ─────────────────────────────────────────────────────────────────────────────

const NHL_BASE = 'https://api-web.nhle.com';
const NHL_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Referer': 'https://www.nhl.com/',
  'Origin': 'https://www.nhl.com',
};

// SCF 2026 game IDs — season 20252026, gameType 03 (playoffs), series 04 (Final)
// ID format: {season}{gameType}{seriesChar}{gameNum}
// 2025030411 = 2025-26 season, playoffs, SCF, game 1
// Discover completed games by checking the NHL score API.
const SCF_2026_SERIES = 'scf-2026';
const SCF_GAME_ID_BASE = 2025030410; // +1 = G1, +2 = G2 etc.
const MAX_SCF_GAMES = 7;

async function fetchBoxscore(gameId) {
  const url = `${NHL_BASE}/v1/gamecenter/${gameId}/boxscore`;
  const r = await fetch(url, { headers: NHL_HEADERS });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

// Extract team PP stats from a boxscore playerByGameStats block
function extractTeamPP(playerBlock) {
  let ppGoals = 0;
  let pim = 0;  // penalty minutes → rough PP opportunities for opponent
  for (const group of ['forwards', 'defensemen', 'goalies']) {
    for (const player of (playerBlock[group] || [])) {
      ppGoals += player.powerPlayGoals || 0;
      pim     += player.pim || 0;
    }
  }
  // pim ÷ 2 = rough minor penalty count (PP opportunities for opponent)
  // Not exact (majors = 5 min, misconduct = 10 min) but sufficient for series context
  const ppOppsAgainst = Math.floor(pim / 2);
  return { ppGoals, ppOppsAgainst };
}

export async function runNHLSeriesUpdate(env) {
  if (!env.FIELD_DATA) throw new Error('FIELD_DATA R2 binding not configured');

  // Load existing R2 data to avoid re-fetching already-processed games
  let existing = null;
  try {
    const r2obj = await env.FIELD_DATA.get(`nhl/${SCF_2026_SERIES}/series-stats.json`);
    if (r2obj) existing = JSON.parse(await r2obj.text());
  } catch(e_) {}

  const processedIds = new Set((existing?.processedGameIds || []));

  // Probe game IDs G1-G7 to find new completed games
  const newBoxscores = [];
  for (let g = 1; g <= MAX_SCF_GAMES; g++) {
    const gameId = SCF_GAME_ID_BASE + g;
    if (processedIds.has(gameId)) continue;
    const bs = await fetchBoxscore(gameId);
    if (!bs) continue;
    // Only count completed games (gameState: 'OFF' = final)
    if (bs.gameState !== 'OFF' && bs.gameState !== 'FINAL') continue;
    newBoxscores.push({ gameId, bs });
  }

  if (newBoxscores.length === 0 && existing) {
    return { ok: true, updated: false, reason: 'no new completed games' };
  }

  // Build series aggregation
  // Seed from existing if present
  const stats = existing?.teams || {};

  for (const { gameId, bs } of newBoxscores) {
    const awayAbbr = bs.awayTeam?.abbrev;
    const homeAbbr = bs.homeTeam?.abbrev;
    if (!awayAbbr || !homeAbbr) continue;

    const awayPBG = bs.playerByGameStats?.awayTeam || {};
    const homePBG = bs.playerByGameStats?.homeTeam || {};

    const awayPP = extractTeamPP(awayPBG);
    const homePP = extractTeamPP(homePBG);

    // Away team PP opps = home team PIM ÷ 2
    // Home team PP opps = away team PIM ÷ 2
    const awayPPOpps = homePP.ppOppsAgainst;
    const homePPOpps = awayPP.ppOppsAgainst;

    for (const [abbr, ppGoals, ppOpps, isHome] of [
      [awayAbbr, awayPP.ppGoals, awayPPOpps, false],
      [homeAbbr, homePP.ppGoals, homePPOpps, true],
    ]) {
      if (!stats[abbr]) stats[abbr] = { ppGoals: 0, ppOpps: 0, pkGoalsAgainst: 0, pkOpps: 0, games: 0, wins: 0, goalsFor: 0, shotsFor: 0, goalsAgainst: 0, shotsAgainst: 0 };
      stats[abbr].ppGoals += ppGoals;
      stats[abbr].ppOpps  += ppOpps;
      // PK stats: this team's PK opportunities = opponent's PP opportunities
      // Goals against on PK = opponent's PP goals
      const oppAbbr = isHome ? awayAbbr : homeAbbr;
      const oppPPGoals = isHome ? awayPP.ppGoals : homePP.ppGoals;
      stats[abbr].pkOpps          += awayPPOpps + homePPOpps - (isHome ? homePPOpps : awayPPOpps);
      stats[abbr].pkGoalsAgainst  += oppPPGoals;
      stats[abbr].games           += 1;
      // Goals + SOG for PDO computation (top-level team fields, all situations)
      const teamScore = isHome ? (bs.homeTeam?.score ?? 0) : (bs.awayTeam?.score ?? 0);
      const teamSOG   = isHome ? (bs.homeTeam?.sog   ?? 0) : (bs.awayTeam?.sog   ?? 0);
      const oppScore  = isHome ? (bs.awayTeam?.score ?? 0) : (bs.homeTeam?.score ?? 0);
      const oppSOG    = isHome ? (bs.awayTeam?.sog   ?? 0) : (bs.homeTeam?.sog   ?? 0);
      stats[abbr].goalsFor     += teamScore;
      stats[abbr].shotsFor     += teamSOG;
      stats[abbr].goalsAgainst += oppScore;
      stats[abbr].shotsAgainst += oppSOG;
      // Win
      if (teamScore > oppScore) stats[abbr].wins += 1;
    }

    processedIds.add(gameId);
  }

  // Compute derived rates
  const teamsOut = {};
  for (const [abbr, s] of Object.entries(stats)) {
    const ppPct = s.ppOpps > 0 ? Math.round(s.ppGoals / s.ppOpps * 1000) / 10 : null;
    const pkPct = s.pkOpps > 0 ? Math.round((1 - s.pkGoalsAgainst / s.pkOpps) * 1000) / 10 : null;
    // PDO = series shooting% + series save% (raw, all situations)
    // Directionally correct for journalism: "running hot/cold in this series"
    // Not score-adjusted (no NST dependency — computed from NHL boxscore sog/score)
    const shootPct = s.shotsFor > 0 ? s.goalsFor / s.shotsFor : null;
    const savePct  = s.shotsAgainst > 0 ? 1 - (s.goalsAgainst / s.shotsAgainst) : null;
    const pdo = shootPct !== null && savePct !== null
      ? Math.round((shootPct + savePct) * 1000) / 1000
      : null;
    const pdoLabel = pdo !== null
      ? `${pdo.toFixed(3)} PDO (${(shootPct*100).toFixed(1)}% sh + ${(savePct*100).toFixed(1)}% sv, ${s.games}-game series window)`
      : null;
    teamsOut[abbr] = {
      ...s,
      seriesPP:  ppPct,
      seriesPK:  pkPct,
      seriesPDO: pdo,
      ppLabel:   ppPct !== null ? `${ppPct}% PP (${s.ppGoals}/${s.ppOpps} series)` : null,
      pkLabel:   pkPct !== null ? `${pkPct}% PK (${s.pkGoalsAgainst} GA on ${s.pkOpps} opp series)` : null,
      pdoLabel,
    };
  }

  const payload = {
    updated: new Date().toISOString(),
    series: SCF_2026_SERIES,
    source: 'api-web.nhle.com boxscores via CF Worker',
    processedGameIds: [...processedIds].sort(),
    gamesProcessed: processedIds.size,
    teams: teamsOut,
  };

  await env.FIELD_DATA.put(
    `nhl/${SCF_2026_SERIES}/series-stats.json`,
    JSON.stringify(payload),
    { httpMetadata: { contentType: 'application/json' },
      customMetadata: { updatedAt: payload.updated, gamesProcessed: String(processedIds.size) } }
  );

  return { ok: true, updated: true, games: processedIds.size, teams: Object.keys(teamsOut) };
}
