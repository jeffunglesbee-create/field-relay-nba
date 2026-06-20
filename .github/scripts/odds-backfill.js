#!/usr/bin/env node
/**
 * odds-backfill.js — Backfill historical odds from The Odds API into D1.
 *
 * Rule 78 (API-COST-A): strict credit budget enforcement.
 * Daily cap: 2,700 credits (leaves 633 headroom from 3,333 daily budget).
 * Historical endpoint: 10 credits per region per market per event.
 * One snapshot per game (closing line — most editorially useful).
 *
 * Progress: tracks backfilled dates in D1 `odds_backfill_progress` table.
 * Skips dates already processed. Picks up where it left off.
 */

const ACCOUNT_ID   = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN    = process.env.CLOUDFLARE_API_TOKEN;
const ODDS_KEY     = process.env.ODDS_API_KEY;
const D1_DB_ID     = process.env.D1_DATABASE_ID;
const RELAY_BASE   = process.env.RELAY_BASE;
const CREDIT_CAP   = parseInt(process.env.DAILY_CREDIT_CAP || '2700', 10);
const DRY_RUN      = process.env.DRY_RUN === 'true';
const START_DATE   = process.env.START_DATE || '';

const D1_API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${D1_DB_ID}/query`;
const ODDS_API = 'https://api.the-odds-api.com/v4';

// Credits used this run
let creditsUsed = 0;

// ── Sport key mapping ──────────────────────────────────────────────────────
// Context Graph sport names → Odds API sport keys
const SPORT_MAP = {
  'MLB':                    'baseball_mlb',
  'NBA':                    'basketball_nba',
  'NHL':                    'icehockey_nhl',
  'WNBA':                   'basketball_wnba',
  'FIFA World Cup':          'soccer_fifa_world_cup',
  'FIFA World Cup 2026':     'soccer_fifa_world_cup',
  'EPL':                     'soccer_epl',
  'MLS':                     'soccer_usa_mls',
};

// ── D1 helper ──────────────────────────────────────────────────────────────
async function d1Query(sql, params = []) {
  const res = await fetch(D1_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });
  const data = await res.json();
  if (!data.success) {
    console.error('[D1 ERROR]', JSON.stringify(data.errors));
    return null;
  }
  return data.result?.[0] || null;
}

// ── Ensure tables exist ────────────────────────────────────────────────────
async function ensureTables() {
  await d1Query(`
    CREATE TABLE IF NOT EXISTS odds_history (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      sport TEXT NOT NULL,
      date TEXT NOT NULL,
      home_team TEXT,
      away_team TEXT,
      commence_time TEXT,
      home_ml REAL,
      away_ml REAL,
      draw_ml REAL,
      over_under REAL,
      over_price REAL,
      under_price REAL,
      bookmaker TEXT DEFAULT 'consensus',
      snapshot_time TEXT,
      snapshot_type TEXT DEFAULT 'close',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await d1Query(`
    CREATE TABLE IF NOT EXISTS odds_backfill_progress (
      date TEXT PRIMARY KEY,
      games_processed INTEGER DEFAULT 0,
      credits_used INTEGER DEFAULT 0,
      completed_at TEXT DEFAULT (datetime('now'))
    )
  `);
  console.log('[INIT] Tables ensured');
}

// ── Get dates to backfill ──────────────────────────────────────────────────
async function getDatesToBackfill() {
  // Get already-processed dates
  const progress = await d1Query(
    `SELECT date FROM odds_backfill_progress ORDER BY date DESC`
  );
  const done = new Set((progress?.results || []).map(r => r.date));

  // Build date range: June 11 (WC start / wc26 active) through yesterday
  const dates = [];
  const start = START_DATE || '2026-06-11';
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const endStr = yesterday.toISOString().slice(0, 10);

  let d = new Date(start + 'T00:00:00Z');
  while (d.toISOString().slice(0, 10) <= endStr) {
    const iso = d.toISOString().slice(0, 10);
    if (!done.has(iso)) dates.push(iso);
    d.setDate(d.getDate() + 1);
  }

  console.log(`[DATES] ${dates.length} dates to backfill (${done.size} already done)`);
  return dates;
}

// ── Get games for a date from Context Graph ────────────────────────────────
async function getGamesForDate(date) {
  try {
    const res = await fetch(`${RELAY_BASE}/context/date/${date}`);
    const data = await res.json();
    const briefs = data.briefs || [];

    // Extract unique games with sport tags
    const games = new Map();
    for (const b of briefs) {
      if (!b.game_id || !b.sport) continue;
      // Skip non-game briefs (team narratives, standings snapshots)
      if (b.brief_type === 'narrative_context' || b.brief_type === 'standings_snapshot') continue;
      // Skip games we can't map to Odds API
      const sportKey = SPORT_MAP[b.sport];
      if (!sportKey) continue;

      if (!games.has(b.game_id)) {
        games.set(b.game_id, {
          game_id: b.game_id,
          sport: b.sport,
          sportKey,
          date,
        });
      }
    }
    return [...games.values()];
  } catch (e) {
    console.error(`[ERROR] Failed to get games for ${date}:`, e.message);
    return [];
  }
}

// ── Fetch historical odds for a sport+date ─────────────────────────────────
// Returns all events for that sport on that date with odds at close
async function fetchHistoricalOdds(sportKey, date) {
  // Snapshot at 11:59 PM UTC on the game date (closing line proxy)
  const snapshotTime = `${date}T23:59:00Z`;
  const url = `${ODDS_API}/historical/sports/${sportKey}/odds`
    + `?apiKey=${ODDS_KEY}`
    + `&regions=us`
    + `&markets=h2h,totals`
    + `&dateFormat=iso`
    + `&oddsFormat=decimal`
    + `&date=${snapshotTime}`;

  try {
    const res = await fetch(url);

    // Track credits from response headers
    const remaining = res.headers.get('x-requests-remaining');
    const used = res.headers.get('x-requests-used');
    if (remaining) console.log(`  [ODDS API] remaining: ${remaining}, used: ${used}`);

    if (!res.ok) {
      console.error(`  [ODDS API] ${res.status} for ${sportKey} on ${date}`);
      return null;
    }

    const data = await res.json();
    return data;
  } catch (e) {
    console.error(`  [ODDS API] fetch error for ${sportKey}:`, e.message);
    return null;
  }
}

// ── Extract consensus odds from snapshot ────────────────────────────────────
function extractConsensusOdds(event) {
  const bookmakers = event.bookmakers || [];
  if (!bookmakers.length) return null;

  // Use first available bookmaker (API returns by preference)
  // h2h market
  let homeMl = null, awayMl = null, drawMl = null;
  let overUnder = null, overPrice = null, underPrice = null;
  let bookmakerName = 'unknown';

  for (const bk of bookmakers) {
    const h2h = bk.markets?.find(m => m.key === 'h2h');
    if (h2h && !homeMl) {
      bookmakerName = bk.key;
      for (const o of h2h.outcomes) {
        if (o.name === event.home_team) homeMl = o.price;
        else if (o.name === event.away_team) awayMl = o.price;
        else if (o.name === 'Draw') drawMl = o.price;
      }
    }
    const totals = bk.markets?.find(m => m.key === 'totals');
    if (totals && !overUnder) {
      for (const o of totals.outcomes) {
        if (o.name === 'Over') { overUnder = o.point; overPrice = o.price; }
        if (o.name === 'Under') { underPrice = o.price; }
      }
    }
    if (homeMl && overUnder) break;  // Got both markets
  }

  if (!homeMl) return null;

  return {
    home_team: event.home_team,
    away_team: event.away_team,
    commence_time: event.commence_time,
    home_ml: homeMl,
    away_ml: awayMl,
    draw_ml: drawMl,
    over_under: overUnder,
    over_price: overPrice,
    under_price: underPrice,
    bookmaker: bookmakerName,
  };
}

// ── Write odds to D1 ───────────────────────────────────────────────────────
async function writeOddsToD1(gameId, sport, date, odds, snapshotTime) {
  const id = `odds_${sport}_${gameId}_${date}`;

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write: ${id} | ${odds.home_team} vs ${odds.away_team} | ML: ${odds.home_ml}/${odds.away_ml} | O/U: ${odds.over_under}`);
    return true;
  }

  const result = await d1Query(
    `INSERT OR IGNORE INTO odds_history
     (id, game_id, sport, date, home_team, away_team, commence_time,
      home_ml, away_ml, draw_ml, over_under, over_price, under_price,
      bookmaker, snapshot_time, snapshot_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'close')`,
    [id, gameId, sport, date, odds.home_team, odds.away_team, odds.commence_time,
     odds.home_ml, odds.away_ml, odds.draw_ml, odds.over_under,
     odds.over_price, odds.under_price, odds.bookmaker, snapshotTime]
  );

  return !!result;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('ODDS HISTORY BACKFILL');
  console.log(`Credit cap: ${CREDIT_CAP} | Dry run: ${DRY_RUN}`);
  console.log('═══════════════════════════════════════════════════');

  await ensureTables();
  const dates = await getDatesToBackfill();

  if (!dates.length) {
    console.log('[DONE] All dates already backfilled');
    return;
  }

  let totalGames = 0;
  let totalWritten = 0;

  for (const date of dates) {
    if (creditsUsed >= CREDIT_CAP) {
      console.log(`\n[CAP] Credit cap reached (${creditsUsed}/${CREDIT_CAP}). Resuming tomorrow.`);
      break;
    }

    console.log(`\n── ${date} ──────────────────────────────`);

    const games = await getGamesForDate(date);
    if (!games.length) {
      console.log(`  No mappable games for ${date}`);
      // Still mark as processed so we don't retry
      if (!DRY_RUN) {
        await d1Query(
          `INSERT OR IGNORE INTO odds_backfill_progress (date, games_processed, credits_used) VALUES (?, 0, 0)`,
          [date]
        );
      }
      continue;
    }

    // Group games by sport key to batch API calls
    const bySport = {};
    for (const g of games) {
      if (!bySport[g.sportKey]) bySport[g.sportKey] = [];
      bySport[g.sportKey].push(g);
    }

    let dateGames = 0;
    let dateCredits = 0;

    for (const [sportKey, sportGames] of Object.entries(bySport)) {
      // Each historical call returns ALL events for that sport+date
      // Cost: 10 credits per region(1) per market(2: h2h+totals) = 20 credits per sport-date
      const estimatedCost = 20;  // 10 per market × 2 markets (h2h + totals)

      if (creditsUsed + estimatedCost > CREDIT_CAP) {
        console.log(`  [CAP] Skipping ${sportKey} — would exceed cap (${creditsUsed}+${estimatedCost} > ${CREDIT_CAP})`);
        continue;
      }

      console.log(`  Fetching ${sportKey} (${sportGames.length} games, ~${estimatedCost} credits)...`);
      const snapshot = await fetchHistoricalOdds(sportKey, date);
      creditsUsed += estimatedCost;
      dateCredits += estimatedCost;

      if (!snapshot?.data) {
        console.log(`  No data returned for ${sportKey}`);
        continue;
      }

      const snapshotTime = snapshot.timestamp || `${date}T23:59:00Z`;
      const events = snapshot.data || [];
      console.log(`  ${events.length} events in snapshot`);

      // Match Context Graph games to Odds API events
      for (const game of sportGames) {
        // Find matching event by team names (fuzzy)
        const match = events.find(ev => {
          const home = (ev.home_team || '').toLowerCase();
          const away = (ev.away_team || '').toLowerCase();
          // Context Graph game_ids vary — try matching by partial team name
          const gid = (game.game_id || '').toLowerCase();
          return gid.includes(home.split(' ').pop()) || gid.includes(away.split(' ').pop())
            || home.includes(gid) || away.includes(gid);
        });

        if (!match) continue;

        const odds = extractConsensusOdds(match);
        if (!odds) continue;

        const written = await writeOddsToD1(
          game.game_id, game.sport, date, odds, snapshotTime
        );
        if (written) {
          totalWritten++;
          dateGames++;
        }
      }

      // Rate limit: 100ms between API calls
      await new Promise(r => setTimeout(r, 100));
    }

    totalGames += dateGames;

    // Record progress
    if (!DRY_RUN) {
      await d1Query(
        `INSERT OR REPLACE INTO odds_backfill_progress (date, games_processed, credits_used) VALUES (?, ?, ?)`,
        [date, dateGames, dateCredits]
      );
    }
    console.log(`  ✓ ${date}: ${dateGames} games, ${dateCredits} credits`);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`COMPLETE: ${totalWritten} games written, ${creditsUsed} credits used`);
  console.log('═══════════════════════════════════════════════════');
}

main().catch(e => {
  console.error('[FATAL]', e);
  process.exit(1);
});
