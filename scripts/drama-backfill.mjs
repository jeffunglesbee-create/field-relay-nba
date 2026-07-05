// One-shot drama_peak backfill for field-relay-nba.
// Fetches game list from relay, computes scores, writes results via
// the relay's POST /archive/drama-by-id endpoint (uses relay's own
// ARCHIVE_DB binding — no CLOUDFLARE_API_TOKEN scope required).
//
// Scoring formulas ported verbatim from CC-CMD-2026-07-04-container-drama-backfill-v2.md.

import { setTimeout as sleep } from 'node:timers/promises';

const RELAY      = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const BATCH_SIZE = 20;
const MAX_BATCHES = 30;   // safety cap (600 games max)
const DELAY_MS   = 200;

// === Drama scoring — exact port from CC-CMD v2, verbatim ===
function dramaScoreLive(st, sport, homeRank, awayRank) {
  const homeScore = st.homeScore ?? 0;
  const awayScore = st.awayScore ?? 0;
  const diff   = Math.abs(homeScore - awayScore);
  const period = st.period ?? 1;
  const clock  = st.clock ?? '';
  let base = 0, timeBonus = 0, sitBonus = 0, upsetBonus = 0;

  if (sport === 'mlb') {
    base = diff===0 ? 1.0 : diff===1 ? 0.85 : diff===2 ? 0.55 : diff<=4 ? 0.28 : 0.08;
    if (period>=10) timeBonus=22;
    else if (period>=9) timeBonus=16;
    else if (period>=7) timeBonus=7;
    const isFinalPeriod = period >= 9;
    const onFirst  = st.onFirst  ?? false;
    const onSecond = st.onSecond ?? false;
    const onThird  = st.onThird  ?? false;
    const outs    = st.outs    ?? 0;
    const balls   = st.balls   ?? 0;
    const strikes = st.strikes ?? 0;
    const runners = [onFirst, onSecond, onThird].filter(Boolean).length;
    const risp    = onSecond || onThird;
    if (runners===3 && outs===2)          sitBonus += isFinalPeriod ? 20 : 12;
    else if (runners===3)                 sitBonus += isFinalPeriod ? 15 : 8;
    else if (risp && outs===2)            sitBonus += isFinalPeriod ? 10 : 6;
    if (balls===3 && strikes===2 && risp) sitBonus += 8;
    if (outs===2 && period>=7)            sitBonus += 5;
  } else if (sport === 'wnba') {
    base = diff===0 ? 1.0 : diff<=3 ? 0.82 : diff<=7 ? 0.52 : diff<=14 ? 0.22 : 0.05;
    const mins = parseInt(clock) || 0;
    if (period>4) timeBonus=22;
    else if (period>=3 && mins<2) timeBonus=18;
    else if (period===4) timeBonus=10;
    else if (period===3) timeBonus=5;
  } else if (sport === 'afl') {
    base = diff===0 ? 1.0 : diff<6 ? 0.82 : diff<=18 ? 0.60 : diff<=36 ? 0.28 : 0.05;
    const q = period;
    const mins = parseInt(clock) || 0;
    if (q>=4 && mins<5) timeBonus=22;
    else if (q>=4) timeBonus=14;
    else if (q===3) timeBonus=5;
  } else {
    // soccer
    base = diff===0 ? 1.0 : diff===1 ? 0.72 : diff===2 ? 0.32 : 0.06;
    const minNum = parseInt(clock) || 0;
    if (period>=3)       timeBonus=24;
    else if (minNum>=90) timeBonus=18;
    else if (minNum>=80) timeBonus=10;
    else if (minNum>=70) timeBonus=5;
    if ((clock||'').includes('+')) sitBonus += 8;
    // WC-advancement sitBonus OMITTED — live-only signal, unavailable for historical games
    if (homeRank != null && awayRank != null) {
      const rankGap = Math.abs(homeRank - awayRank);
      if (rankGap >= 30 && diff <= 1) upsetBonus = Math.min(15, Math.floor(rankGap / 10));
    }
  }

  const raw = base * 52 + timeBonus + sitBonus + upsetBonus;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

function computeDramaRetroactive(states, sport, homeRank, awayRank) {
  if (!states || states.length === 0) return { peak: 0, arc: [] };
  const scores = states.map(st => dramaScoreLive(st, sport, homeRank, awayRank));
  return { peak: Math.max(...scores), arc: scores };
}

// === ESPN data via relay proxy ===
async function fetchMLBHistoricalStates(espnEventId) {
  const url = `${RELAY}/espn-summary/sports/baseball/mlb/summary?event=${espnEventId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN MLB ${res.status} for event ${espnEventId}`);
  const data = await res.json();
  const plays = data.plays || [];
  if (plays.length === 0) return [];
  return plays.map(p => ({
    homeScore: p.homeScore ?? 0,
    awayScore: p.awayScore ?? 0,
    period:    p.period?.number ?? 1,
    clock:     p.clock?.displayValue || '',
    onFirst:   p.situation?.onFirst  ?? false,
    onSecond:  p.situation?.onSecond ?? false,
    onThird:   p.situation?.onThird  ?? false,
    outs:      p.situation?.outs    ?? 0,
    balls:     p.situation?.balls   ?? 0,
    strikes:   p.situation?.strikes ?? 0,
  }));
}

async function fetchWNBAHistoricalStates(espnEventId) {
  const url = `${RELAY}/espn-summary/sports/basketball/wnba/summary?event=${espnEventId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN WNBA ${res.status} for event ${espnEventId}`);
  const data = await res.json();
  const plays = data.plays || [];
  if (plays.length === 0) return [];
  return plays.map(p => ({
    homeScore: p.homeScore ?? 0,
    awayScore: p.awayScore ?? 0,
    period:    p.period?.number ?? 1,
    clock:     p.clock?.displayValue || '',
  }));
}

async function fetchSoccerHistoricalStates(espnEventId, leagueSlug) {
  const url = `${RELAY}/espn-summary/sports/soccer/${leagueSlug}/summary?event=${espnEventId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN soccer ${res.status} for event ${espnEventId} (${leagueSlug})`);
  const data = await res.json();

  const comps     = data.header?.competitions?.[0]?.competitors ?? [];
  const homeComp  = comps.find(c => c.homeAway === 'home');
  const homeTeamId = homeComp?.team?.id;

  const keyEvents = (data.keyEvents || []).filter(e => {
    const txt  = (e.type?.text || '').toLowerCase();
    const abbr = (e.type?.abbreviation || '').toLowerCase();
    return txt.includes('goal') || abbr === 'g';
  });

  const states = [];
  let homeScore = 0, awayScore = 0;
  const FIVE_MIN = 5;
  let prevMin = 0, prevPeriod = 1;

  states.push({ homeScore: 0, awayScore: 0, period: 1, clock: '0' });

  for (const e of keyEvents) {
    const period   = e.period?.number ?? 1;
    const clockStr = e.clock?.displayValue || String(prevMin);
    const minNum   = parseInt(clockStr) || 0;

    for (let m = prevMin + FIVE_MIN; m < minNum; m += FIVE_MIN) {
      states.push({ homeScore, awayScore, period: prevPeriod, clock: String(m) });
    }

    if (homeTeamId && e.team?.id === homeTeamId) homeScore++;
    else awayScore++;

    states.push({ homeScore, awayScore, period, clock: clockStr });
    prevMin = minNum;
    prevPeriod = period;
  }

  const endMin = Math.max(90, prevMin);
  for (let m = prevMin + FIVE_MIN; m <= endMin; m += FIVE_MIN) {
    states.push({ homeScore, awayScore, period: prevPeriod, clock: String(m) });
  }

  return states;
}

// === Sport classification ===
function classifySport(sport) {
  if (!sport) return 'other';
  const s = sport.toLowerCase();
  if (s === 'mlb') return 'mlb';
  if (s === 'wnba') return 'wnba';
  if (s === 'afl') return 'afl';
  if (s === 'epl' || s.includes('soccer') || s.includes('world cup') || s.includes('wc26') ||
      s.includes('fifa') || s.includes('mls') || s.includes('liga') ||
      s.includes('ligue') || s.includes('premier') || s.includes('league')) return 'soccer';
  return 'other';
}

function soccerLeagueSlug(sport) {
  const s = (sport || '').toLowerCase();
  if (s.includes('world cup') || s.includes('fifa') || s.includes('wc26')) return 'fifa.world';
  if (s.includes('mls')) return 'usa.1';
  if (s === 'epl') return 'eng.1';
  return 'fifa.world';
}

// === FIFA rankings (in-memory cache) ===
const rankCache = new Map();
async function getFifaRanking(teamName) {
  if (rankCache.has(teamName)) return rankCache.get(teamName);
  try {
    const res = await fetch(`${RELAY}/fifa-rankings/${encodeURIComponent(teamName)}`);
    if (!res.ok) { rankCache.set(teamName, null); return null; }
    const data = await res.json();
    const rank = data.rank ?? null;
    rankCache.set(teamName, rank);
    return rank;
  } catch {
    rankCache.set(teamName, null);
    return null;
  }
}

// === Relay write — exact ID, no fuzzy match ===
async function writeGameDrama(gameId, peak, arc) {
  const res = await fetch(`${RELAY}/archive/drama-by-id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: gameId, drama_peak: peak, drama_arc: arc }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`drama-by-id ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.ok) throw new Error(`drama-by-id error: ${data.error} (id=${gameId})`);
  return data;
}

// === Main ===
async function main() {
  console.log('=== Drama Peak Backfill ===');
  console.log(`Relay: ${RELAY}\n`);

  let totalProcessed = 0, totalErrors = 0, batchNum = 0;

  while (batchNum < MAX_BATCHES) {
    batchNum++;
    const res = await fetch(`${RELAY}/archive/drama-missing?limit=${BATCH_SIZE}`);
    if (!res.ok) {
      console.error(`drama-missing HTTP ${res.status} on batch ${batchNum}`);
      break;
    }
    const payload = await res.json();
    const games   = payload.games || [];

    if (games.length === 0) {
      console.log(`Batch ${batchNum}: 0 games — backfill complete`);
      break;
    }
    console.log(`Batch ${batchNum}: ${games.length} games`);

    for (const game of games) {
      const sport = classifySport(game.sport);
      const label = `${game.sport} | ${game.home} vs ${game.away} (${game.date}) [event=${game.espn_event_id}]`;

      if (!game.espn_event_id || sport === 'other') {
        await writeGameDrama(game.id, 0, null);
        console.log(`  [skip] ${label} → 0`);
        totalProcessed++;
        await sleep(DELAY_MS);
        continue;
      }

      // AFL: Squiggle has final scores only (no quarter granularity); ESPN confirmed dead.
      // Write 0 — separate follow-up required for quarter-level AFL data.
      if (sport === 'afl') {
        await writeGameDrama(game.id, 0, null);
        console.log(`  [no-quarter-data/afl] ${label} → 0`);
        totalProcessed++;
        await sleep(DELAY_MS);
        continue;
      }

      try {
        let states, homeRank = null, awayRank = null;

        if (sport === 'mlb') {
          states = await fetchMLBHistoricalStates(game.espn_event_id);
        } else if (sport === 'wnba') {
          states = await fetchWNBAHistoricalStates(game.espn_event_id);
        } else {
          const slug = soccerLeagueSlug(game.sport);
          states = await fetchSoccerHistoricalStates(game.espn_event_id, slug);
          [homeRank, awayRank] = await Promise.all([
            getFifaRanking(game.home),
            getFifaRanking(game.away),
          ]);
        }

        if (!states || states.length === 0) {
          await writeGameDrama(game.id, 0, null);
          console.log(`  [no-states] ${label} → 0`);
        } else {
          const { peak, arc } = computeDramaRetroactive(states, sport, homeRank, awayRank);
          await writeGameDrama(game.id, peak, arc);
          console.log(`  [ok] ${label} → drama_peak=${peak}`);
        }
        totalProcessed++;
      } catch (err) {
        console.error(`  [error] ${label}: ${err.message}`);
        // Write 0 to clear this game from the missing queue so we don't loop forever
        try { await writeGameDrama(game.id, 0, null); } catch { /* ignore */ }
        totalErrors++;
        totalProcessed++;
      }

      await sleep(DELAY_MS);
    }
  }

  console.log(`\n=== Done: ${totalProcessed} processed, ${totalErrors} errors ===`);
  if (totalErrors > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
