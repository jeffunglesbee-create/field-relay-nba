// ─────────────────────────────────────────────────────────────────────────────
// FIELD — NHL MoneyPuck GSAX → R2 (NHL-B)
//
// Fetches MoneyPuck goalie CSV and computes GSAX (Goals Saved Above Expected)
// for all playoff goalies. Verified HTTP 200 from CF Workers Plus IPs (June 10 2026).
//
// GSAX = xGoals - goals  (positive = goalie saving more than expected)
// Situation filter: 'all' for full-context GSAX.
//
// MoneyPuck URL: moneypuck.com/moneypuck/playerData/seasonSummary/{year}/playoffs/goalies.csv
//   where year = season start year (2025 for 2025-26 season)
//
// R2 key: nhl/2026/gsax-playoffs.json (playoffs) | nhl/2026/gsax-regular.json (regular season)
// Relay route: /nhl-gsax/playoffs.json | /nhl-gsax/regular.json
// Cron: weekly, both windows (CC-CMD-2026-07-11-nhl-nba-regular-season-continuation
//   TASK 2) -- April-July for playoffs (same guard as series stats), Oct-March for
//   regular season. Confirmed live (2026-07-11) that MoneyPuck's regular-season CSV
//   exists in the identical column shape as playoffs -- not assumed.
//
// ToS: MoneyPuck publishes free analytics for fan consumption.
//   Data is publicly available, non-commercial use.
// ─────────────────────────────────────────────────────────────────────────────

const MONEYPUCK_BASE = 'https://moneypuck.com/moneypuck/playerData/seasonSummary';
const SEASON_YEAR = 2025; // start year of 2025-26 season

function parseCSVRows(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = lines[i].split(',');
    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

function sf(v) { const f = parseFloat(v); return isNaN(f) ? null : Math.round(f * 100) / 100; }

export async function runNHLGSAXUpdate(env, seasonType = 'playoffs') {
  if (!env.FIELD_DATA) throw new Error('FIELD_DATA R2 binding not configured');
  if (seasonType !== 'playoffs' && seasonType !== 'regular') {
    throw new Error(`invalid seasonType: ${seasonType}`);
  }
  const now = new Date().toISOString();

  // Fetch goalie CSV -- 'playoffs' or 'regular', same column shape either way.
  const url = `${MONEYPUCK_BASE}/${SEASON_YEAR}/${seasonType}/goalies.csv`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FIELD/1.0)' },
  });
  if (!r.ok) throw new Error(`MoneyPuck HTTP ${r.status}`);

  const rows = parseCSVRows(await r.text());

  // Filter to situation='all' (full-context stats, not 5on5 only)
  // Aggregate by player name + team (one row per goalie per situation)
  const goalies = {};
  for (const row of rows) {
    if (row.situation !== 'all') continue;
    const name = row.name;
    const team = row.team;
    if (!name || !team) continue;

    const xGoals = sf(row.xGoals);
    const goals  = sf(row.goals);
    const gp     = parseInt(row.games_played) || 0;
    if (xGoals === null || goals === null || gp < 3) continue;

    const gsax = Math.round((xGoals - goals) * 100) / 100;
    const lastName = name.split(' ').pop().toLowerCase().replace(/[^a-z]/g, '');

    goalies[lastName] = {
      name, team,
      gamesPlayed: gp,
      xGoals, goalsAllowed: goals,
      gsax,
      gsaxPer60: gp > 0 ? Math.round(gsax / gp * 60 * 100) / 100 : null,
      tier: gsax >= 2.5 ? 'elite' : gsax >= 1.0 ? 'strong' : gsax >= -0.5 ? 'avg' : 'below',
    };
  }

  const count = Object.keys(goalies).length;
  // Don't overwrite existing good data with an empty result -- e.g. a
  // regular-season CSV fetched right at the season's start before MoneyPuck
  // has published any games yet. Same reasoning that applies to nba-clutch's
  // Season-locked query (see nba-clutch-r2.js), applied here defensively.
  if (count === 0) {
    return { ok: true, updated: false, seasonType, reason: 'empty upstream result, R2 not overwritten' };
  }
  const r2Key = seasonType === 'playoffs' ? 'gsax-playoffs.json' : 'gsax-regular.json';
  const payload = {
    updated: now,
    source: 'MoneyPuck via CF Worker',
    season: `${SEASON_YEAR}-${SEASON_YEAR + 1}`,
    seasonType: seasonType === 'playoffs' ? 'Playoffs' : 'Regular Season',
    definition: 'GSAX = xGoals - goalsAllowed (positive = above expected)',
    goalies,
  };

  await env.FIELD_DATA.put(`nhl/2026/${r2Key}`, JSON.stringify(payload), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { updatedAt: now, goalieCount: String(count) },
  });

  return { ok: true, updated: now, seasonType, goalieCount: count };
}
