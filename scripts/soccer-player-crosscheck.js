#!/usr/bin/env node
'use strict';

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  // Turkish dotless-ı (U+0131) is NOT a combining-accent character --
  // it's a distinct base letter, so NFD leaves it untouched. Confirmed
  // live 2026-07-02: this alone caused 5+ of 8 initially-unmatched WC26
  // players (Yılmaz/Yilmaz, Kahveci, etc.) to fail matching even though
  // every other Turkish letter (İ, ş, ç, ğ, ö, ü) already normalizes
  // correctly via NFD. Explicit substitution, not covered generically.
  return s.replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
  // NOTE: the standalone /bsd/events/{id}/average-positions route 404s —
  // confirmed live 2026-07-02 (see CC-CMD context). average_positions is
  // only available combined within the /shotmap response.
  const data = await get(`${RELAY}/bsd/events/${eventId}/shotmap`);
  // Real shape confirmed live 2026-07-02: data.average_positions is an
  // object { home: [...], away: [...] }, NOT a flat array. Each entry:
  // { player_id: number, name: string (abbreviated, e.g. "T. Weah"), ... }
  const ap = data.average_positions || {};
  const positions = [...(ap.home || []), ...(ap.away || [])];
  if (positions.length === 0) {
    throw new Error(`Empty average_positions in BSD event ${eventId} response`);
  }
  return positions;
}

async function findFinishedBsdEvent(bsdLeagueId, season) {
  const url = `${RELAY}/bsd/events/season?league_id=${bsdLeagueId}&season=${season}`;
  let data;
  try { data = await get(url); } catch (e) { return null; }

  const events = Array.isArray(data) ? data
    : Array.isArray(data.results) ? data.results
    : Array.isArray(data.events)  ? data.events
    : Array.isArray(data.data)    ? data.data
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

// A real professional squad has 20+ players. Below this, ESPN's roster
// data for the team is genuinely incomplete right now (confirmed live
// 2026-07-02: Real Madrid, Barcelona, Bayern Munich, Dortmund, Leverkusen
// all show 0; several La Liga/Bundesliga teams show exactly 1 -- this is
// real 2026-27 preseason data sparsity, inconsistent per-team even within
// the same league, not a script bug and not evenly distributed by league).
const MIN_PLAUSIBLE_ROSTER_SIZE = 15;

// European competitions worth trying as a fallback context for the SAME
// ESPN team ID. Confirmed live 2026-07-02: ESPN's roster data is
// genuinely competition-context-dependent even for an identical team ID
// -- Atletico Madrid (id 1068) returns 1 athlete via esp.1 but 40 via
// uefa.champions. Also confirmed BSD's player_id is globally stable
// across competitions for the same person (Lookman id 1306, Hancko id
// 764 -- identical in both a La Liga event and a UCL event for the same
// club), so a fallback match found this way is the same real player, not
// a coincidence. Domestic leagues only fall back to these three; they
// don't fall back to each other or to domestic leagues (no evidence a
// team's EPL-context roster would help fill a Bundesliga-context gap
// for an unrelated club, and most clubs aren't in more than one of
// these three anyway).
// Continental (top-division clubs across multiple countries) + domestic
// cups (lower/mid-table clubs not in Europe still play these alongside
// their league's biggest clubs). Verified real before adding each:
// eng.fa/eng.league_cup rescued Birmingham City and Bristol City
// (0->30+ athletes each). esp.copa_del_rey rescued all 3 remaining
// La Liga gaps (Alaves, Elche, Osasuna, all 0-1->32-35 athletes).
// ger.dfb_pokal rescued 1 of 2 remaining Bundesliga gaps (Elversberg,
// 0->27) but NOT Paderborn (confirmed real DFB-Pokal participant,
// consistently 1 athlete there too, checked twice -- a genuine
// exception, not every team is rescuable by this pattern). Applied
// uniformly to every competition -- harmless for clubs not in a given
// cup (team ID simply won't be found there).
const ROSTER_FALLBACK_CONTEXTS = [
  'uefa.champions', 'uefa.europa', 'uefa.europa.conf',
  'eng.fa', 'eng.league_cup',
  'esp.copa_del_rey', 'ger.dfb_pokal',
];

async function fetchEspnRosterWithFallback(espnLeague, teamId) {
  let roster = await fetchEspnRoster(espnLeague, teamId);
  if (roster.length >= MIN_PLAUSIBLE_ROSTER_SIZE) {
    return { roster, sourceContext: espnLeague, usedFallback: false };
  }
  for (const fallbackLeague of ROSTER_FALLBACK_CONTEXTS) {
    if (fallbackLeague === espnLeague) continue;
    await delay(ROSTER_DELAY_MS);
    try {
      const fallbackRoster = await fetchEspnRoster(fallbackLeague, teamId);
      if (fallbackRoster.length >= MIN_PLAUSIBLE_ROSTER_SIZE) {
        return { roster: fallbackRoster, sourceContext: fallbackLeague, usedFallback: true };
      }
      // Track the best of a bad set of options in case nothing clears the bar
      if (fallbackRoster.length > roster.length) roster = fallbackRoster;
    } catch (e) {
      // Fallback context doesn't have this team (not in that competition) -- expected, not an error.
    }
  }
  return { roster, sourceContext: espnLeague, usedFallback: false };
}

async function fetchAllEspnAthletes(espnLeague) {
  const teamIds = await fetchEspnTeamIds(espnLeague);
  process.stdout.write(`    ${teamIds.length} ESPN teams in ${espnLeague}\n`);

  const athletes = [];
  const dataGapTeams = [];
  let fallbackRescues = 0;
  for (const teamId of teamIds) {
    await delay(ROSTER_DELAY_MS);
    try {
      const { roster, sourceContext, usedFallback } = await fetchEspnRosterWithFallback(espnLeague, teamId);
      if (usedFallback) {
        fallbackRescues++;
        process.stdout.write(`    team ${teamId}: rescued via ${sourceContext} fallback (${roster.length} athletes)\n`);
      }
      if (roster.length < MIN_PLAUSIBLE_ROSTER_SIZE) {
        dataGapTeams.push({ teamId, athleteCount: roster.length });
      }
      athletes.push(...roster);
    } catch (e) {
      dataGapTeams.push({ teamId, athleteCount: 0, error: e.message });
    }
  }
  if (fallbackRescues > 0) {
    process.stdout.write(`    ${fallbackRescues}/${teamIds.length} teams rescued via European competition fallback\n`);
  }
  return { athletes, dataGapTeams, totalTeams: teamIds.length, fallbackRescues };
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

  let espnAthletes, dataGapTeams, totalTeams, fallbackRescues;
  try {
    ({ athletes: espnAthletes, dataGapTeams, totalTeams, fallbackRescues } = await fetchAllEspnAthletes(espnLeague));
  }
  catch (e) { return { ...result, error: e.message }; }
  process.stdout.write(`    ${espnAthletes.length} ESPN athletes fetched\n`);
  if (dataGapTeams.length > 0) {
    process.stdout.write(`    ESPN roster data gap: ${dataGapTeams.length}/${totalTeams} teams below ${MIN_PLAUSIBLE_ROSTER_SIZE} athletes\n`);
  }
  result.espn_data_gap = {
    teamsWithGap: dataGapTeams.length,
    totalTeams,
    fallbackRescues: fallbackRescues || 0,
    detail: dataGapTeams,
  };

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

    // IMPORTANT: espnMatches is drawn from the WHOLE tournament/league
    // athlete pool, not scoped to the two teams in this specific match
    // (no BSD route exists to get per-event team names to scope by —
    // confirmed 2026-07-02, /bsd/events/{id} 404s, by-date listing
    // doesn't include this event). This means a same/similar surname
    // from a COMPLETELY DIFFERENT team can appear in espnMatches.
    // Found live: BSD "Z. Çelik" (Turkey) matched against ESPN's global
    // pool included both the correct Zeki Çelik (Turkey, exact match)
    // AND an unrelated "Nidal Celik" from a different squad. Naively
    // emitting a candidate for every non-exact match would have wrongly
    // proposed BSD player 1062 -> Nidal Celik as if they were the same
    // person. Never guess:
    const exactMatch = espnMatches.find(e => e.lastName === bsdSurname);
    if (exactMatch) {
      // Real player already resolves correctly on the real roster --
      // nothing to fix, not a candidate, regardless of any other
      // same-surname athletes elsewhere in the tournament pool.
      continue;
    }
    if (espnMatches.length > 1) {
      // No exact match AND more than one same-surname athlete in the
      // whole pool -- genuinely ambiguous without team-scoping. Do not
      // pick one and call it a candidate.
      result.unmatched.push({
        bsdName, bsdPlayerId: p.player_id, bsdSurname, competition: competitionKey,
        reason: `ambiguous: ${espnMatches.length} ESPN athletes share normalized surname "${normKey}" across the full tournament pool, no team-scoping available to disambiguate`,
        espnCandidates: espnMatches.map(e => ({ id: e.id, fullName: e.fullName, lastName: e.lastName })),
      });
      continue;
    }

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
  const output = { candidates: [], unmatched: [], untestable: [], espn_data_gaps: [] };

  // Only worth recording if it affects a real fraction of the league --
  // a couple of teams with sparse data is normal noise, not worth
  // cluttering the report. Threshold is a judgment call, documented here.
  const GAP_REPORT_THRESHOLD = 0.25; // >=25% of teams below MIN_PLAUSIBLE_ROSTER_SIZE

  function recordGap(competitionKey, gap) {
    if (!gap || gap.totalTeams === 0) return;
    const frac = gap.teamsWithGap / gap.totalTeams;
    if (frac >= GAP_REPORT_THRESHOLD) {
      output.espn_data_gaps.push({
        competition: competitionKey,
        teamsWithGap: gap.teamsWithGap,
        totalTeams: gap.totalTeams,
        fallbackRescues: gap.fallbackRescues,
        note: 'ESPN roster data for these teams has fewer than ' +
          MIN_PLAUSIBLE_ROSTER_SIZE + ' athletes right now -- confirmed real ' +
          '2026-07-02 (Real Madrid, Barcelona, Bayern Munich, Dortmund, ' +
          'Leverkusen all show 0), not a fetch bug. ' +
          (gap.fallbackRescues > 0
            ? `${gap.fallbackRescues} of these were rescued via a fallback ` +
              '(UCL/Europa/Conference for continental clubs, FA Cup/League ' +
              'Cup for English lower-league clubs -- same ESPN team ID, ' +
              'different competition-context path -- confirmed live this ' +
              'returns genuinely different, fuller roster data for the same ' +
              'club). teamsWithGap/detail below reflect the count still ' +
              'unresolved AFTER the fallback, not before.'
            : 'No fallback rescues available for this competition (teams not ' +
              'in any of the fallback contexts, or fallback also sparse).') +
          ' Candidates/unmatched from this competition are unreliable for the ' +
          'still-affected teams -- do not treat sparse unmatched counts here as genuine mismatches.',
      });
    }
  }

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
      recordGap('wc26', result.espn_data_gap);
    }
    break; // one event sufficient for the cross-check
  }

  // Competitions with bsdLeagueId — find finished events dynamically
  for (const comp of COMPETITIONS) {
    process.stdout.write(`Processing ${comp.key} (bsdLeagueId: ${comp.bsdLeagueId})...\n`);

    const eventId = await findFinishedBsdEvent(comp.bsdLeagueId, comp.season);
    if (!eventId) {
      const reason = `No finished BSD events found for bsdLeagueId=${comp.bsdLeagueId} season=${comp.season}`;
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
      recordGap(comp.key, result.espn_data_gap);
    }
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  process.stdout.write(`\nWrote ${OUT_FILE}\n`);
  process.stdout.write(`Candidates: ${output.candidates.length}\n`);
  process.stdout.write(`Unmatched:  ${output.unmatched.length}\n`);
  process.stdout.write(`Untestable: ${output.untestable.length}\n`);
  process.stdout.write(`ESPN data gaps: ${output.espn_data_gaps.length} competition(s) affected\n`);
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
