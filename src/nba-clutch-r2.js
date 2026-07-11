// ─────────────────────────────────────────────────────────────────────────────
// FIELD — NBA Clutch Stats → R2 (relay-native, replaces GitHub Actions hybrid)
//
// Fetches stats.nba.com/stats/leaguedashteamclutch directly from the relay Worker.
// Proven accessible June 10 2026: returns 200 with NBA headers (User-Agent + Referer).
// The 520 seen from direct probe was header-verification artefact — not an IP block.
//
// Writes to R2:
//   nba/2026/clutch_playoffs.json  — Playoffs clutch (last 5 min, within 5 pts)
//   nba/2026/clutch_regular.json   — Regular Season clutch (same window)
//
// Relay /nba-clutch/ route: R2-first, GitHub raw fallback.
// Cron: runs 3x/week during NBA Finals window (June–July), 1x/week rest of season.
//
// Spec: Sport-Specific × Workers Plus NBA-B
// [VERIFY] resolved: stats.nba.com returns 200 from Workers Plus IPs with proper headers.
// ─────────────────────────────────────────────────────────────────────────────

const NBA_STATS_BASE = 'https://stats.nba.com/stats';
const NBA_STATS_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer':         'https://www.nba.com/stats/',
  'Origin':          'https://www.nba.com',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control':   'no-cache',
  'Pragma':          'no-cache',
};

// Team abbreviation map (ID → abbrev for NBA_TEAM_ANALYTICS key matching)
const NBA_TEAM_ID_MAP = {
  1610612737:'ATL', 1610612738:'BOS', 1610612751:'BKN', 1610612766:'CHA',
  1610612741:'CHI', 1610612739:'CLE', 1610612742:'DAL', 1610612743:'DEN',
  1610612765:'DET', 1610612744:'GSW', 1610612745:'HOU', 1610612754:'IND',
  1610612746:'LAC', 1610612747:'LAL', 1610612763:'MEM', 1610612748:'MIA',
  1610612749:'MIL', 1610612750:'MIN', 1610612740:'NOP', 1610612752:'NYK',
  1610612760:'OKC', 1610612753:'ORL', 1610612755:'PHI', 1610612756:'PHX',
  1610612757:'POR', 1610612758:'SAC', 1610612759:'SAS', 1610612761:'TOR',
  1610612762:'UTA', 1610612764:'WAS',
};

async function fetchClutchStats(seasonType) {
  const params = new URLSearchParams({
    LeagueID: '00', Season: '2025-26', SeasonType: seasonType,
    PerMode: 'PerGame', MeasureType: 'Advanced',
    ClutchTime: 'Last 5 Minutes', AheadBehind: 'Ahead or Behind', PointDiff: '5',
    PlusMinus: 'N', PaceAdjust: 'N', Rank: 'N',
    Outcome: '', Location: '', Month: '0', SeasonSegment: '',
    DateFrom: '', DateTo: '', OpponentTeamID: '0',
    VsConference: '', VsDivision: '', GameSegment: '',
    Period: '0', ShotClockRange: '', LastNGames: '0',
    GameScope: '', PlayerExperience: '', PlayerPosition: '',
    StarterBench: '', TwoWay: '0', Conference: '', Division: '',
  });
  const r = await fetch(`${NBA_STATS_BASE}/leaguedashteamclutch?${params}`,
    { headers: NBA_STATS_HEADERS });
  if (!r.ok) throw new Error(`nba-clutch HTTP ${r.status} for ${seasonType}`);
  const data = await r.json();
  const rs = data.resultSets?.[0];
  if (!rs) throw new Error('no resultSet in response');

  const hdrs = rs.headers;
  const idx = Object.fromEntries(hdrs.map((h, i) => [h, i]));
  const teams = {};
  for (const row of rs.rowSet) {
    const teamId   = row[idx.TEAM_ID];
    const abbrev   = NBA_TEAM_ID_MAP[teamId] || row[idx.TEAM_ABBREVIATION] || String(teamId);
    teams[abbrev] = {
      teamId,
      name:         row[idx.TEAM_NAME],
      gp:           row[idx.GP],
      wPct:         row[idx.W_PCT],
      clutchOrtg:   row[idx.OFF_RATING],
      clutchDrtg:   row[idx.DEF_RATING],
      clutchNetRtg: row[idx.NET_RATING],
      clutchPace:   row[idx.PACE],
    };
  }
  return teams;
}

export async function runNBACluichUpdate(env) {
  if (!env.FIELD_DATA) throw new Error('FIELD_DATA R2 binding not configured');
  const now = new Date().toISOString();
  const results = {};

  for (const [key, seasonType] of [
    ['clutch_playoffs.json', 'Playoffs'],
    ['clutch_regular.json',  'Regular Season'],
  ]) {
    try {
      const teams = await fetchClutchStats(seasonType);
      const count = Object.keys(teams).length;
      // CC-CMD-2026-07-11-nhl-nba-regular-season-continuation TASK 3: this
      // cron runs year-round with no month gate (Wed-only outside the Finals
      // window), including the Aug-Sep offseason when the hardcoded 2025-26
      // Season param has no games yet -- stats.nba.com returns zero rows.
      // Without this guard, every offseason Wednesday would silently
      // overwrite the last real playoff data with an empty payload.
      if (count === 0) {
        results[key] = { ok: true, updated: false, reason: 'empty upstream result, R2 not overwritten' };
        continue;
      }
      const payload = {
        updated: now,
        source: 'stats.nba.com via CF Worker (relay-native — no GH Actions needed)',
        seasonType, definition: 'last 5 min of regulation, within 5 pts',
        teams,
      };
      await env.FIELD_DATA.put(`nba/2026/${key}`, JSON.stringify(payload), {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { updatedAt: now, teamCount: String(count) },
      });
      results[key] = { ok: true, count };
    } catch(e) {
      results[key] = { ok: false, error: e.message };
    }
  }

  const succeeded = Object.values(results).filter(r => r.ok).length;
  return { ok: succeeded > 0, updated: now, results };
}
