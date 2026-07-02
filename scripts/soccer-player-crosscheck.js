#!/usr/bin/env node
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── Inline assertions — run before any real data is touched (Task 3) ────────
//
// Verified rule (CC-CMD-2026-07-02-soccer-player-crosscheck):
//   Strip leading period-terminated initials, keep everything remaining.
//   Handles compound first names (B. A. Yılmaz → Yılmaz) and
//   multi-word surnames (N. Da Costa → Da Costa) with one rule.
//   Do NOT use a different rule without re-testing against real BSD samples.

function extractSurname(bsdName) {
  const tokens = bsdName.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length - 1 && /^[A-Za-z]\.$/.test(tokens[i])) {
    i++;
  }
  return tokens.slice(i).join(' ');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`ASSERTION FAILED [${label}]: expected "${expected}", got "${actual}"`);
  }
  process.stdout.write(`  PASS [${label}]\n`);
}

process.stdout.write('Running inline assertions...\n');
assertEqual(extractSurname('T. Weah'),       'Weah',     'T. Weah → Weah');
assertEqual(extractSurname('B. A. Yılmaz'),  'Yılmaz',   'B. A. Yılmaz → Yılmaz');
assertEqual(extractSurname('N. Da Costa'),   'Da Costa', 'N. Da Costa → Da Costa');
process.stdout.write('All inline assertions passed.\n\n');

// ─── Config ───────────────────────────────────────────────────────────────────

const RELAY = process.env.RELAY_URL || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const OUT_DIR  = path.join(__dirname, '..', 'outbox');
const OUT_FILE = path.join(OUT_DIR, 'soccer-player-crosscheck.json');
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

// Competitions with both bsdLeagueId != null AND espnLeague (Task 1 enumeration).
// eflone/efltwo excluded: bsdLeagueId null — ESPN-only, nothing to cross-check.
// wc26 excluded from this table: no bsdLeagueId in league config; handled below
//   via known BSD event IDs (group stage confirmed finished as of 2026-07-02).
const COMPETITIONS = [
  { key: 'epl',        bsdLeagueId: 1,  espnLeague: 'eng.1',            season: '2026' },
  { key: 'mls',        bsdLeagueId: 18, espnLeague: 'usa.1',            season: '2026' },
  { key: 'ucl',        bsdLeagueId: 7,  espnLeague: 'uefa.champions',   season: '2026' },
  { key: 'europa',     bsdLeagueId: 8,  espnLeague: 'uefa.europa',      season: '2026' },
  { key: 'conference', bsdLeagueId: 8,  espnLeague: 'uefa.europa.conf', season: '2026' },
  { key: 'eflchamp',   bsdLeagueId: 12, espnLeague: 'eng.2',            season: '2026' },
  { key: 'laliga',     bsdLeagueId: 3,  espnLeague: 'esp.1',            season: '2026' },
  { key: 'seriea',     bsdLeagueId: 4,  espnLeague: 'ita.1',            season: '2026' },
  { key: 'bundesliga', bsdLeagueId: 5,  espnLeague: 'ger.1',            season: '2026' },
  { key: 'ligue1',     bsdLeagueId: 6,  espnLeague: 'fra.1',            season: '2026' },
];

// BSD event 8346 confirmed via CC-CMD probe to have average_positions data (WC26 group stage).
const WC26_EVENT_IDS   = [8346];
const WC26_ESPN_LEAGUE = 'fifa.world';

const ROSTER_DELAY_MS = 250; // respect ESPN rate limits between roster fetches

// ─── Utilities ────────────────────────────────────────────────────────────────

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizeForMatch(s) {
  return stripAccents(s || '').toLowerCase().trim();
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'field-relay-soccer-crosscheck/1.0' } }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`JSON parse error from ${url}: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

// ─── BSD helpers ──────────────────────────────────────────────────────────────

async function fetchAveragePositions(eventId) {
  const data = await get(`${RELAY}/bsd/events/${eventId}/average-positions`);
  // BSD response: top-level object with average_positions array.
  // Each entry: { player_id: number, name: string (abbreviated, e.g. "T. Weah"), ... }
  const positions = data.average_positions || data.averagePositions || [];
  if (!Array.isArray(positions) || positions.length === 0) {
    throw new Error(`Empty average_positions in BSD event ${eventId} response`);
  }
  return positions;
}

async function findFinishedBsdEvent(bsdLeagueId, season) {
  const url = `${RELAY}/bsd/events/season?league=${bsdLeagueId}&season=${season}`;
  let data;
  try { data = await get(url); } catch (e) { return null; }

  const events = Array.isArray(data) ? data
    : Array.isArray(data.events) ? data.events
    : Array.isArray(data.data)   ? data.data
    : [];

  const finished = events.find(e => {
    const st = (e.status || e.status_code || '').toString().toLowerCase();
    return st === 'finished' || st === '100'
      || e.finished === true
      || (e.status_type && e.status_type.completed === true);
  });

  return finished ? String(finished.id || finished.event_id || '') : null;
}

// ─── ESPN helpers ─────────────────────────────────────────────────────────────

async function fetchEspnTeamIds(espnLeague) {
  const url = `${ESPN_BASE}/${espnLeague}/teams?limit=100`;
  const data = await get(url);
  // ESPN teams response nests: data.sports[].leagues[].teams[].team
  const sports = data.sports || [];
  const leagues = sports.flatMap(s => s.leagues || []);
  const teams = leagues.flatMap(l => (l.teams || []).map(t => t.team || t));
  if (teams.length === 0 && Array.isArray(data.teams)) {
    return data.teams.map(t => String(t.id)).filter(Boolean);
  }
  return teams.map(t => String(t.id)).filter(Boolean);
}

async function fetchEspnRoster(espnLeague, teamId) {
  const url = `${ESPN_BASE}/${espnLeague}/teams/${teamId}/roster`;
  const data = await get(url);
  return (data.athletes || []).map(a => ({
    id: String(a.id),
    lastName: a.lastName || '',
    fullName: a.fullName || a.displayName || '',
  }));
}

async function fetchAllEspnAthletes(espnLeague) {
  const teamIds = await fetchEspnTeamIds(espnLeague);
  process.stdout.write(`    ${teamIds.length} ESPN teams in ${espnLeague}\n`);

  const athletes = [];
  for (const teamId of teamIds) {
    await delay(ROSTER_DELAY_MS);
    try {
      const roster = await fetchEspnRoster(espnLeague, teamId);
      athletes.push(...roster);
    } catch (e) {
      process.stdout.write(`    roster fetch failed for team ${teamId}: ${e.message}\n`);
    }
  }
  return athletes;
}

// ─── Collision index ──────────────────────────────────────────────────────────

// For each normalized surname in the BSD dataset, track all BSD players sharing it.
// A candidate is collision_risk if ≥1 OTHER BSD player shares the same normalized surname.
function buildBsdCollisionIndex(positions) {
  const idx = {};
  for (const p of positions) {
    const name = p.name || p.player || '';
    if (!name) continue;
    const key = normalizeForMatch(extractSurname(name));
    if (!idx[key]) idx[key] = [];
    idx[key].push({ player_id: p.player_id, bsdName: name });
  }
  return idx;
}

// ─── Cross-check one event ────────────────────────────────────────────────────

async function crossCheck(competitionKey, espnLeague, bsdEventId) {
  const result = { competition: competitionKey, bsdEventId, candidates: [], unmatched: [] };

  let positions;
  try { positions = await fetchAveragePositions(bsdEventId); }
  catch (e) { return { ...result, error: e.message }; }
  process.stdout.write(`    ${positions.length} BSD players in average_positions\n`);

  let espnAthletes;
  try { espnAthletes = await fetchAllEspnAthletes(espnLeague); }
  catch (e) { return { ...result, error: e.message }; }
  process.stdout.write(`    ${espnAthletes.length} ESPN athletes fetched\n`);

  // ESPN lookup: normalizedLastName → [athlete, ...]
  const espnIdx = {};
  for (const a of espnAthletes) {
    const key = normalizeForMatch(a.lastName);
    if (!key) continue;
    if (!espnIdx[key]) espnIdx[key] = [];
    espnIdx[key].push(a);
  }

  const bsdCollision = buildBsdCollisionIndex(positions);

  for (const p of positions) {
    const bsdName = p.name || p.player || '';
    if (!bsdName) continue;

    const bsdSurname  = extractSurname(bsdName);
    const normKey     = normalizeForMatch(bsdSurname);
    const espnMatches = espnIdx[normKey] || [];

    if (espnMatches.length === 0) {
      result.unmatched.push({
        bsdName,
        bsdPlayerId: p.player_id,
        bsdSurname,
        competition: competitionKey,
      });
      continue;
    }

    // Collision: same normalized surname maps to ≥2 distinct BSD players in this dataset
    const collidingBsd   = (bsdCollision[normKey] || []).filter(c => c.player_id !== p.player_id);
    const collisionRisk  = collidingBsd.length > 0;

    for (const espn of espnMatches) {
      // Only log as a candidate if the real strings differ (this is what we're checking for)
      if (bsdSurname !== espn.lastName) {
        result.candidates.push({
          bsdName,
          bsdPlayerId: p.player_id,
          bsdSurname,
          espnLastName:   espn.lastName,
          espnFullName:   espn.fullName,
          espnAthleteId:  espn.id,
          competition:    competitionKey,
          collision_risk: collisionRisk,
          ...(collisionRisk ? { collision_detail: collidingBsd } : {}),
        });
      }
    }
  }

  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const output = { candidates: [], unmatched: [], untestable: [] };

  // WC26 — group stage confirmed finished; BSD accessed directly via known event IDs
  process.stdout.write('Processing wc26...\n');
  for (const eventId of WC26_EVENT_IDS) {
    process.stdout.write(`  BSD event ${eventId}...\n`);
    const result = await crossCheck('wc26', WC26_ESPN_LEAGUE, eventId);
    if (result.error) {
      output.untestable.push({ competition: 'wc26', reason: result.error });
    } else {
      output.candidates.push(...result.candidates);
      output.unmatched.push(...result.unmatched);
    }
    break; // one event sufficient for the cross-check
  }

  // Competitions with bsdLeagueId — find finished events dynamically
  for (const comp of COMPETITIONS) {
    process.stdout.write(`Processing ${comp.key} (bsdLeagueId: ${comp.bsdLeagueId})...\n`);

    const eventId = await findFinishedBsdEvent(comp.bsdLeagueId, comp.season);
    if (!eventId) {
      const reason = `No finished BSD events found for bsdLeagueId=${comp.bsdLeagueId} ` +
        `season=${comp.season} — 2026-27 European domestic season not yet started as of 2026-07-02`;
      process.stdout.write(`  Untestable: ${reason}\n`);
      output.untestable.push({ competition: comp.key, reason });
      continue;
    }

    process.stdout.write(`  Finished event found: ${eventId}\n`);
    const result = await crossCheck(comp.key, comp.espnLeague, eventId);
    if (result.error) {
      output.untestable.push({ competition: comp.key, reason: result.error });
    } else {
      output.candidates.push(...result.candidates);
      output.unmatched.push(...result.unmatched);
    }
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  process.stdout.write(`\nWrote ${OUT_FILE}\n`);
  process.stdout.write(`Candidates: ${output.candidates.length}\n`);
  process.stdout.write(`Unmatched:  ${output.unmatched.length}\n`);
  process.stdout.write(`Untestable: ${output.untestable.length}\n`);
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
