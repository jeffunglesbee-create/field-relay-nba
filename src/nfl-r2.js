// ─────────────────────────────────────────────────────────────────────────────
// FIELD — nflverse → R2 Weekly Pipeline (NFL-A)
//
// Fetches nflverse CSV files from GitHub releases and writes processed JSON
// to R2 bucket FIELD_DATA. Runs weekly (Monday 6AM ET) via scheduled cron.
//
// Spec: Sport-Specific × Workers Plus NFL-A (Drive 16uSESn0apuj0OxbuC-59-XVbC6fcrbN08M7xA7_EAc8)
// Deadline: before September 9, 2026 (NFL Week 1)
//
// R2 keys written:
//   nfl/2026/player-stats.json  — passing/rushing/receiving EPA, target share, wopr/racr
//   nfl/2026/ngs-passing.json   — CPOE, aggressiveness % (NGS passing)
//   nfl/2026/pfr-rec.json       — contested targets, drops, first contact yards
//
// epa_table.json stays in outbox/nfl/ (built by build-epa-table.yml GitHub Actions)
// because it requires nflverse PBP data — too large for Worker CPU budget.
//
// Relay /nflverse/ route: R2-first for player-stats, ngs-passing, pfr-rec;
//   existing GitHub raw fallback for epa_table.json unchanged.
// ─────────────────────────────────────────────────────────────────────────────

const NFLVERSE_BASE = 'https://github.com/nflverse/nflverse-data/releases/download';
const NFLVERSE_HEADERS = {
  'User-Agent': 'FIELD-Sports-Intelligence/1.0',
  'Accept': 'application/octet-stream,text/csv,*/*',
};

// ── Minimal CSV parser (same as mlb-savant-r2.js) ────────────────────────────
function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

function safeFloat(v, def = null) { const f = parseFloat(v); return isNaN(f) ? def : Math.round(f * 1000) / 1000; }
function safeInt(v, def = 0)      { const f = parseInt(v);   return isNaN(f) ? def : f; }

async function fetchNFLCSV(path) {
  const url = `${NFLVERSE_BASE}/${path}`;
  const r = await fetch(url, { headers: NFLVERSE_HEADERS });
  if (!r.ok) throw new Error(`nflverse fetch ${path} HTTP ${r.status}`);
  return parseCSV(await r.text());
}

// ── 1. Player Stats (passing/rushing/receiving EPA + target share) ────────────
// Key fields: player_id, player_name, player_display_name, season, week,
//   recent_team, position, completions, attempts, passing_yards, passing_tds,
//   passing_air_yards, passing_epa, rushing_epa, receiving_epa,
//   target_share, air_yards_share, wopr, racr
async function fetchPlayerStats() {
  const rows = await fetchNFLCSV('player_stats/player_stats.csv');
  // Aggregate season totals by player_id + position
  const byPlayer = {};
  for (const row of rows) {
    const pid = row.player_id;
    const pos = (row.position || '').toUpperCase();
    const season = safeInt(row.season);
    if (!pid || !pos || !season) continue;
    // Only keep the most recent season's data per player
    if (!byPlayer[pid] || byPlayer[pid].season < season) {
      byPlayer[pid] = { season };
    }
    if (byPlayer[pid].season > season) continue;

    const existing = byPlayer[pid];
    // Aggregate by accumulating values
    const weeks = safeInt(row.week, 0);
    if (pos === 'QB') {
      existing.name         = row.player_display_name || row.player_name;
      existing.team         = row.recent_team;
      existing.pos          = pos;
      existing.attempts     = (existing.attempts     || 0) + safeInt(row.attempts, 0);
      existing.completions  = (existing.completions  || 0) + safeInt(row.completions, 0);
      existing.passingYards = (existing.passingYards || 0) + safeInt(row.passing_yards, 0);
      existing.passingEPA   = (existing.passingEPA   || 0) + (safeFloat(row.passing_epa, 0) || 0);
      existing.rushingEPA   = (existing.rushingEPA   || 0) + (safeFloat(row.rushing_epa, 0) || 0);
    } else if (['WR','TE','RB'].includes(pos)) {
      existing.name          = row.player_display_name || row.player_name;
      existing.team          = row.recent_team;
      existing.pos           = pos;
      existing.receivingEPA  = (existing.receivingEPA  || 0) + (safeFloat(row.receiving_epa, 0) || 0);
      existing.targetShare   = safeFloat(row.target_share, null);   // last week value
      existing.airYardsShare = safeFloat(row.air_yards_share, null);
      existing.wopr          = safeFloat(row.wopr, null);
      existing.racr          = safeFloat(row.racr, null);
    }
    existing.weeks = (existing.weeks || 0) + 1;
  }
  // Round aggregates
  const data = {};
  for (const [pid, p] of Object.entries(byPlayer)) {
    if (!p.name) continue;
    data[pid] = {
      name: p.name, team: p.team, pos: p.pos, season: p.season, weeks: p.weeks,
      ...(p.pos === 'QB' ? {
        attempts: p.attempts, completions: p.completions, passingYards: p.passingYards,
        passingEPA: Math.round((p.passingEPA || 0) * 100) / 100,
        rushingEPA: Math.round((p.rushingEPA || 0) * 100) / 100,
      } : {
        receivingEPA: Math.round((p.receivingEPA || 0) * 100) / 100,
        targetShare: p.targetShare, airYardsShare: p.airYardsShare,
        wopr: p.wopr, racr: p.racr,
      }),
    };
  }
  return data;
}

// ── 2. NGS Passing (CPOE + aggressiveness) ───────────────────────────────────
async function fetchNGSPassing() {
  const rows = await fetchNFLCSV('ngs_passing/ngs_passing.csv');
  const data = {};
  for (const row of rows) {
    const pid = row.player_gsis_id || row.player_id;
    if (!pid) continue;
    const season = safeInt(row.season);
    if (!season) continue;
    if (!data[pid] || data[pid].season < season) {
      data[pid] = {
        name: row.player_display_name || row.player_name,
        team: row.team_abbr, season,
        cpoe: safeFloat(row.cpoe),           // Completion % over expected
        aggressiveness: safeFloat(row.aggressiveness), // % throws into tight windows
        avgTimeToThrow: safeFloat(row.avg_time_to_throw),
        avgCompletedAirYards: safeFloat(row.avg_completed_air_yards),
        attempts: safeInt(row.attempts),
      };
    }
  }
  return data;
}

// ── 3. PFR Advanced Receiving Stats (contested targets, drops) ───────────────
async function fetchPFRReceiving() {
  const rows = await fetchNFLCSV('pfr_advstats/advstats_rec.csv');
  const data = {};
  for (const row of rows) {
    const pid = row.pfr_id || row.player_id;
    if (!pid) continue;
    const season = safeInt(row.season);
    if (!season) continue;
    if (!data[pid] || data[pid].season < season) {
      data[pid] = {
        name: row.player,
        team: row.tm || row.team, season,
        targets: safeInt(row.tgt),
        contestedTgts: safeInt(row.ctch_pct_contested_tgt || row.contested_tgt),
        drops: safeInt(row.drop),
        dropPct: safeFloat(row.drop_pct),
        yards: safeInt(row.yds),
        firstContactYards: safeFloat(row.yac_bc_yds_per_tgt || null),
      };
    }
  }
  return data;
}

// ── Main: run all 3 fetches ───────────────────────────────────────────────────
export async function runNFLR2Update(env) {
  if (!env.FIELD_DATA) throw new Error('FIELD_DATA R2 binding not configured');
  const now = new Date().toISOString();
  const results = {};

  const tasks = [
    ['player-stats', () => fetchPlayerStats().then(d => ({ updated: now, source: 'nflverse via CF Worker', data: d }))],
    ['ngs-passing',  () => fetchNGSPassing().then(d => ({ updated: now, source: 'nflverse NGS via CF Worker', data: d }))],
    ['pfr-rec',      () => fetchPFRReceiving().then(d => ({ updated: now, source: 'nflverse PFR via CF Worker', data: d }))],
  ];

  await Promise.allSettled(tasks.map(async ([name, fn]) => {
    try {
      const payload = await fn();
      const count = Object.keys(payload.data || {}).length;
      await env.FIELD_DATA.put(`nfl/2026/${name}.json`, JSON.stringify(payload), {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { updatedAt: now, rowCount: String(count) },
      });
      results[name] = { ok: true, count };
    } catch(e) {
      results[name] = { ok: false, error: e.message };
    }
  }));

  const succeeded = Object.values(results).filter(r => r.ok).length;
  return { ok: succeeded > 0, updated: now, results, succeeded, total: tasks.length };
}
