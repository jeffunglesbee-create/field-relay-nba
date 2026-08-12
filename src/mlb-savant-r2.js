// ─────────────────────────────────────────────────────────────────────────────
// FIELD — MLB Savant → R2 Weekly Pipeline
//
// Ports the mlb-weekly-update.py GitHub Actions pipeline to a Cloudflare Worker.
// Runs via scheduled cron (Monday 6AM ET / 11AM UTC) and on-demand via
// POST /mlb-savant-update (admin endpoint, requires X-FIELD-Admin header).
//
// Writes 5 tables to R2 bucket FIELD_DATA:
//   mlb/2026/team_abs.json
//   mlb/2026/expected_stats.json
//   mlb/2026/sprint_speed.json
//   mlb/2026/pitch_tempo.json
//   mlb/2026/pitch_arsenals.json
//
// Relay /mlb-stats/{file} route reads from R2 first, falls back to
// raw.githubusercontent.com/jubilant-bassoon/main/outbox/mlb/{file}.
//
// UMPIRE ABS: intentionally excluded. The Statcast search CSV (full season)
// requires a 3-minute fetch — exceeds Worker CPU budget. Umpire ABS stays
// on GitHub Actions (mlb-weekly-update.yml) + existing /mlb-umpire-scrape endpoint.
//
// Spec: Sport-Specific × Workers Plus — MLB-A (Drive 16uSESn0apuj0OxbuC-59-XVbC6fcrbN08M7xA7_EAc8)
// Verification: Baseball Savant accessible from Workers Plus IPs (html_probe 200 June 10 2026)
// ─────────────────────────────────────────────────────────────────────────────

const SAVANT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/csv,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://baseballsavant.mlb.com/',
};

const YEAR = 2026;

// ── Minimal CSV parser ────────────────────────────────────────────────────────
// Handles quoted fields, strips BOM, returns [{header:value}, ...]
function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Simple split — adequate for Savant's clean CSV (no embedded commas in values)
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

function safeFloat(v, def = 0) { const f = parseFloat(v); return isNaN(f) ? def : f; }
function safeInt(v, def = 0)   { const f = parseInt(v);   return isNaN(f) ? def : f; }

function nameKey(raw) {
  // "Wood, James" → "wood" | "Witt Jr., Bobby" → "witt"
  const parts = (raw || '').split(',');
  let last = (parts[0] || '').trim().toLowerCase()
    .replace(/ jr\.?$/i, '').replace(/ sr\.?$/i, '').replace(/ ii+$/i, '');
  return last.replace(/[\s-]/g, '_');
}

// ── 1. Team ABS ──────────────────────────────────────────────────────────────
async function fetchTeamABS() {
  const url = `https://baseballsavant.mlb.com/leaderboard/abs-challenges?challengeType=batting-team&year=${YEAR}&min=1&csv=true`;
  const r = await fetch(url, { headers: SAVANT_HEADERS });
  if (!r.ok) throw new Error(`Team ABS HTTP ${r.status}`);
  const rows = parseCSV(await r.text());
  const data = {};
  for (const row of rows) {
    const abbr = (row.team_abbr || '').trim();
    if (!abbr || abbr === 'MLB') continue;
    const attempts   = safeInt(row.n_challenges);
    const overturned = safeInt(row.n_overturns);
    const rate       = safeFloat(row.rate_overturns);
    const netFor     = safeFloat(row.net_for);
    const totalVs    = safeFloat(row.total_vs_expected);
    const grade = rate >= 0.60 ? 'A' : rate >= 0.56 ? 'A-' : rate >= 0.52 ? 'B+' :
                  rate >= 0.48 ? 'B' : rate >= 0.44 ? 'C+' : 'C';
    data[abbr] = {
      battingRate: Math.round(rate * 1000) / 1000,
      battingWon: overturned, battingAttempted: attempts,
      netOverturns: Math.round(netFor * 10) / 10,
      totalVsExpected: Math.round(totalVs * 10) / 10,
      grade,
    };
  }
  return data;
}

// ── 2. Expected Stats ────────────────────────────────────────────────────────
async function fetchExpectedStats() {
  const url = `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${YEAR}&min=50&csv=true`;
  const r = await fetch(url, { headers: SAVANT_HEADERS });
  if (!r.ok) throw new Error(`Expected Stats HTTP ${r.status}`);
  const rows = parseCSV(await r.text());
  const data = {};
  for (const row of rows) {
    const nameRaw = row['last_name, first_name'] || row.last_name || '';
    const last = nameKey(nameRaw);
    if (!last) continue;
    const pa = safeInt(row.pa);
    if (pa < 50) continue;
    data[last] = {
      ba: Math.round(safeFloat(row.ba) * 1000) / 1000,
      xba: Math.round(safeFloat(row.est_ba) * 1000) / 1000,
      slg: Math.round(safeFloat(row.slg) * 1000) / 1000,
      xslg: Math.round(safeFloat(row.est_slg) * 1000) / 1000,
      woba: Math.round(safeFloat(row.woba) * 1000) / 1000,
      xwoba: Math.round(safeFloat(row.est_woba) * 1000) / 1000,
      pa,
    };
  }
  return data;
}

// ── 3. Sprint Speed ──────────────────────────────────────────────────────────
async function fetchSprintSpeed() {
  const url = `https://baseballsavant.mlb.com/leaderboard/sprint_speed?year=${YEAR}&min=10&pos=&team=&csv=true`;
  const r = await fetch(url, { headers: SAVANT_HEADERS });
  if (!r.ok) throw new Error(`Sprint Speed HTTP ${r.status}`);
  const rows = parseCSV(await r.text());
  const data = {};
  for (const row of rows) {
    const nameRaw = row['last_name, first_name'] || row.last_name || '';
    const last = nameKey(nameRaw);
    if (!last) continue;
    const fts  = safeFloat(row.sprint_speed);
    const runs = safeInt(row.competitive_runs);
    if (fts < 25 || runs < 10) continue;
    const tier = fts >= 29.5 ? 'elite' : fts >= 28.5 ? 'above_avg' :
                 fts >= 26.5 ? 'average' : 'below_avg';
    const pctile = Math.min(99, Math.max(1, Math.round(50 + (fts - 27.0) / 1.1 * 34)));
    data[last] = {
      sprintSpeed: Math.round(fts * 10) / 10,
      pctile, tier,
      team: (row.team || '').trim(),
      bolts: safeInt(row.bolts),
    };
  }
  return { leagueAvg: 27.0, data };
}

// ── 4. Pitch Tempo ───────────────────────────────────────────────────────────
async function fetchPitchTempo() {
  const url = `https://baseballsavant.mlb.com/leaderboard/pitch-tempo?type=Pit&year=${YEAR}&min=100&csv=true`;
  const r = await fetch(url, { headers: SAVANT_HEADERS });
  if (!r.ok) throw new Error(`Pitch Tempo HTTP ${r.status}`);
  const rows = parseCSV(await r.text());
  const data = {};
  for (const row of rows) {
    const last = nameKey(row.entity_name || '');
    if (!last) continue;
    const t = safeFloat(row.median_seconds_empty);
    if (t <= 0) continue;
    const timerEquiv = Math.round(Math.max(0, t - 6.0) * 10) / 10;
    const tempoClass = t < 15 ? 'Fast' : t > 30 ? 'Slow' : 'Average';
    data[last] = { medianTempo: Math.round(t * 10) / 10, tempoClass, timerEquiv };
  }
  return data;
}

// ── 5. Pitch Arsenal Stats ───────────────────────────────────────────────────
async function fetchPitchArsenals() {
  const url = `https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats?type=pitcher&year=${YEAR}&min=100&csv=true`;
  const r = await fetch(url, { headers: SAVANT_HEADERS });
  if (!r.ok) throw new Error(`Pitch Arsenals HTTP ${r.status}`);
  const rows = parseCSV(await r.text());
  const PITCH_MAP = [
    ['ff','4-Seam'],['si','Sinker'],['sl','Slider'],['ch','Changeup'],
    ['cu','Curveball'],['kc','Knuckle-Curve'],['fc','Cutter'],
    ['fs','Splitter'],['st','Sweeper'],['sv','Sweeper'],
  ];
  const data = {};
  for (const row of rows) {
    const nameRaw = row['last_name, first_name'] || row.last_name || '';
    const last = nameKey(nameRaw);
    if (!last) continue;
    const pitches = [];
    for (const [code, label] of PITCH_MAP) {
      const usage = safeFloat(row[`${code}_usage`] || row[`${code}_pa_used`] || '0');
      const vel   = safeFloat(row[`${code}_avg_speed`] || row[`${code}_velocity`] || '0');
      const whiff = safeFloat(row[`${code}_whiff_percent`] || row[`${code}_whiff`] || '0');
      if (usage > 0.03 && vel > 65) {
        pitches.push({ type: label, vel: Math.round(vel * 10) / 10,
                       whiffRate: Math.round(whiff / 100 * 1000) / 1000,
                       usage: Math.round(usage * 1000) / 1000 });
      }
    }
    if (pitches.length) {
      pitches.sort((a, b) => b.usage - a.usage);
      data[last] = { team: (row.team || '').trim(), pitches };
    }
  }
  return data;
}

// ── Main: run all 5 fetches and write to R2 ──────────────────────────────────
export async function runMLBSavantUpdate(env) {
  if (!env.FIELD_DATA) throw new Error('FIELD_DATA R2 binding not configured');
  const now = new Date().toISOString();
  const results = {};

  const tasks = [
    ['team_abs',       () => fetchTeamABS().then(d => ({ updated: now, source: 'Savant via CF Worker', data: d }))],
    ['expected_stats', () => fetchExpectedStats().then(d => ({ updated: now, source: 'Savant via CF Worker', data: d }))],
    ['sprint_speed',   () => fetchSprintSpeed().then(d => ({ updated: now, source: 'Savant via CF Worker', leagueAvg: d.leagueAvg, data: d.data }))],
    ['pitch_tempo',    () => fetchPitchTempo().then(d => ({ updated: now, source: 'Savant via CF Worker', data: d }))],
    ['pitch_arsenals', () => fetchPitchArsenals().then(d => ({ updated: now, source: 'Savant via CF Worker', data: d }))],
  ];

  await Promise.allSettled(tasks.map(async ([name, fn]) => {
    try {
      const payload = await fn();
      const count = Object.keys(payload.data || {}).length;
      // NEVER overwrite good data with nothing.
      //
      // This loop previously put unconditionally and reported ok:true even at
      // count 0, so a parse that returned nothing silently replaced a
      // populated table with an empty one. Measured 2026-08-12: the relay
      // served /mlb-stats/pitch_arsenals.json with X-Source: r2 and 0 entries
      // while its own GitHub fallback held 194 -- and because an empty object
      // is a HIT, not a miss, the fallback could never fire. Client-side, the
      // whole pitch-arsenal line went missing from every scouting report
      // (gamesWithArsenal 0/15) while pitch_tempo, written by this same loop
      // from the same source, was fine at 341.
      //
      // A zero-row Savant parse is a FAILURE, not a legitimate empty result:
      // these leaderboards are never empty mid-season. Treating it as one is
      // what made a transient fetch problem permanent. Savant blocking
      // Cloudflare Worker IPs is documented in this repo for the umpire
      // scrape and is the most likely cause here too.
      if (count === 0) {
        results[name] = { ok: false, error: 'empty payload — refusing to overwrite R2', count: 0 };
        return;
      }
      const json = JSON.stringify(payload);
      await env.FIELD_DATA.put(`mlb/${YEAR}/${name}.json`, json, {
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
