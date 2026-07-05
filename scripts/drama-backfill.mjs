// One-shot drama_peak backfill for field-relay-nba.
// Runs in GitHub Actions. Requires CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, RELAY_BASE.
// Scoring formulas ported verbatim from CC-CMD-2026-07-04-container-drama-backfill-v2.md.

import { setTimeout as sleep } from 'node:timers/promises';

const RELAY      = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const CF_TOKEN   = process.env.CLOUDFLARE_API_TOKEN;
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const DB_ID      = 'cc49101c-0569-4d41-8e7a-be139cde4f26';
const BATCH_SIZE = 20;
const MAX_BATCHES = 30;   // safety cap (600 games)
const DELAY_MS   = 150;

// === Cloudflare D1 REST API ===
async function cfD1Query(sql, params = []) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${DB_ID}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`D1 API ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

async function d1Count() {
  const data = await cfD1Query(
    "SELECT COUNT(*) as total, SUM(CASE WHEN drama_peak IS NOT NULL THEN 1 ELSE 0 END) as populated FROM regular_season_games WHERE date >= '2026-06-01'"
  );
  return data.result?.[0]?.results?.[0] ?? { total: '?', populated: '?' };
}

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
    if (runners===3 && outs===2)      sitBonus += isFinalPeriod ? 20 : 12;
    else if (runners===3)             sitBonus += isFinalPeriod ? 15 : 8;
    else if (risp && outs===2)        sitBonus += isFinalPeriod ? 10 : 6;
    if (balls===3 && strikes===2 && risp) sitBonus += 8;
    if (outs===2 && period>=7)        sitBonus += 5;
  } else {
    // soccer
    base = diff===0 ? 1.0 : diff===1 ? 0.72 : diff===2 ? 0.32 : 0.06;
    const minNum = parseInt(clock) || 0;
    if (period>=3)     timeBonus=24;
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

// === ESPN data via relay ===
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

async function fetchSoccerHistoricalStates(espnEventId, leagueSlug) {
  const url = `${RELAY}/espn-summary/sports/soccer/${leagueSlug}/summary?event=${espnEventId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN soccer ${res.status} for event ${espnEventId} (${leagueSlug})`);
  const data = await res.json();

  const comps    = data.header?.competitions?.[0]?.competitors ?? [];
  const homeComp = comps.find(c => c.homeAway === 'home');
  const homeTeamId = homeComp?.team?.id;

  // Filter to goal events only
  const keyEvents = (data.keyEvents || []).filter(e => {
    const txt = (e.type?.text || '').toLowerCase();
    const abbr = (e.type?.abbreviation || '').toLowerCase();
    return txt.includes('goal') || abbr === 'g';
  });

  const states = [];
  let homeScore = 0, awayScore = 0;
  const FIVE_MIN = 5;
  let prevMin = 0, prevPeriod = 1;

  // Opening state
  states.push({ homeScore: 0, awayScore: 0, period: 1, clock: '0' });

  for (const e of keyEvents) {
    const period   = e.period?.number ?? 1;
    const clockStr = e.clock?.displayValue || String(prevMin);
    const minNum   = parseInt(clockStr) || 0;

    // 5-min interpolation between previous state and this event
    for (let m = prevMin + FIVE_MIN; m < minNum; m += FIVE_MIN) {
      states.push({ homeScore, awayScore, period: prevPeriod, clock: String(m) });
    }

    // Apply goal
    if (homeTeamId && e.team?.id === homeTeamId) homeScore++;
    else awayScore++;

    states.push({ homeScore, awayScore, period, clock: clockStr });
    prevMin = minNum;
    prevPeriod = period;
  }

  // Fill remaining minutes to at least 90
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
  if (s.includes('soccer') || s.includes('world cup') || s.includes('wc26') ||
      s.includes('fifa') || s.includes('mls') || s.includes('liga') ||
      s.includes('ligue') || s.includes('premier') || s.includes('league')) return 'soccer';
  return 'other';
}

function soccerLeagueSlug(sport) {
  const s = (sport || '').toLowerCase();
  if (s.includes('world cup') || s.includes('fifa') || s.includes('wc26')) return 'fifa.world';
  if (s.includes('mls')) return 'usa.1';
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

// === D1 write ===
async function writeGameDrama(gameId, peak, arc) {
  const arcStr = arc && arc.length > 0 ? JSON.stringify(arc) : null;
  await cfD1Query(
    'UPDATE regular_season_games SET drama_peak = ?, drama_arc = ? WHERE id = ?',
    [peak, arcStr, gameId]
  );
}

// === Main ===
async function main() {
  if (!CF_TOKEN)   { console.error('Missing CLOUDFLARE_API_TOKEN'); process.exit(1); }
  if (!CF_ACCOUNT) { console.error('Missing CLOUDFLARE_ACCOUNT_ID'); process.exit(1); }

  console.log('=== Drama Peak Backfill ===');
  console.log(`Relay: ${RELAY}\nDB:    ${DB_ID}\n`);

  const before = await d1Count();
  console.log(`BEFORE: total=${before.total}, populated=${before.populated}`);

  let totalProcessed = 0, totalErrors = 0, batchNum = 0;

  while (batchNum < MAX_BATCHES) {
    batchNum++;
    const res = await fetch(`${RELAY}/archive/drama-missing?limit=${BATCH_SIZE}`);
    if (!res.ok) { console.error(`drama-missing HTTP ${res.status} on batch ${batchNum}`); break; }
    const payload = await res.json();
    const games   = payload.games || [];

    if (games.length === 0) {
      console.log(`Batch ${batchNum}: 0 games — backfill complete`);
      break;
    }
    console.log(`\nBatch ${batchNum}: ${games.length} games`);

    for (const game of games) {
      const sport = classifySport(game.sport);
      const label = `${game.sport} | ${game.home} vs ${game.away} (${game.date}) [${game.espn_event_id}]`;

      if (!game.espn_event_id || sport === 'other') {
        await writeGameDrama(game.id, 0, null);
        console.log(`  [skip] ${label} → 0`);
        totalProcessed++;
        await sleep(DELAY_MS);
        continue;
      }

      try {
        let states, homeRank = null, awayRank = null;

        if (sport === 'mlb') {
          states = await fetchMLBHistoricalStates(game.espn_event_id);
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
        // Write 0 to remove from the missing queue so we don't loop forever on one broken game
        try { await writeGameDrama(game.id, 0, null); } catch { /* ignore */ }
        totalErrors++;
        totalProcessed++;
      }

      await sleep(DELAY_MS);
    }
  }

  const after = await d1Count();
  console.log(`\n=== Done ===`);
  console.log(`AFTER:  total=${after.total}, populated=${after.populated}`);
  console.log(`Processed: ${totalProcessed}, Errors: ${totalErrors}`);

  if (totalErrors > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
