#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// FIELD odds historical backfill — budget-aware, fully automated
// ─────────────────────────────────────────────────────────────────────────────
// Rule 78 / API-COST-A compliance: the 2,700 daily Odds API credit ceiling
// is shared across ALL FIELD systems (live polling, WC projections, this
// backfill). This script checks the global remaining quota FIRST via a
// zero-cost /v4/sports call, computes the headroom, and only spends what
// the broader budget allows.
//
// Automation contract:
//   • Runs daily on cron (10:00 UTC). No required workflow_dispatch inputs.
//   • Resumes from D1 odds_backfill_progress — never re-processes a date.
//   • Walks dates oldest-first from 2026-06-11 → yesterday.
//   • Once caught up, the daily run gap-fills only yesterday (~80 credits).
//
// Sources:
//   • Game inventory comes from the relay's /context/date/{iso} (Context Graph)
//   • Historical odds from /v4/historical/sports/{sport}/odds (10 cr × region × market)
//   • Persists into ARCHIVE_DB.odds_history via Cloudflare D1 REST API.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ── Config (all from GitHub secrets) ────────────────────────────────────────
const ODDS_KEY    = process.env.ODDS_API_KEY;
const RELAY_BASE  = process.env.RELAY_BASE        || 'https://field-relay-nba.jeffunglesbee.workers.dev';

const DAILY_CEILING    = 2700;           // global shared across all FIELD odds usage
const PER_CALL_COST    = 20;             // historical /odds = 10 cr × 2 markets (h2h+totals); regions=us
const MIN_BUDGET       = 20;             // need at least one sport-date worth
const ODDS_API_DELAY_MS = 100;           // gentle rate-limit guard
const BACKFILL_START_DATE = '2026-05-09'; // earliest archived game
const ODDS_API_BASE = 'https://api.the-odds-api.com';

if (!ODDS_KEY) {
  console.error('[odds-backfill] missing ODDS_API_KEY');
  process.exit(1);
}

// ── Sport → Odds API key map ────────────────────────────────────────────────
// Drives both the historical odds fetch and the brief-type skip list.
const SPORT_TO_ODDS_KEY = {
  'MLB':                    'baseball_mlb',
  'NBA':                    'basketball_nba',
  'NHL':                    'icehockey_nhl',
  'WNBA':                   'basketball_wnba',
  'FIFA World Cup':         'soccer_fifa_world_cup',
  'FIFA World Cup 2026':    'soccer_fifa_world_cup',
  'EPL':                    'soccer_epl',
  'MLS':                    'soccer_usa_mls',
};

// Brief types that are NOT games — must be ignored when iterating /context/date.
// (Spec lists narrative_context and standings_snapshot.)
const NON_GAME_BRIEF_TYPES = new Set(['narrative_context', 'standings_snapshot']);

// ── Helpers ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function toIsoDate(d) { return d.toISOString().slice(0, 10); }

function* dateRange(startIso, endIso) {
  // Yields YYYY-MM-DD strings inclusive on both ends.
  let cur = new Date(startIso + 'T00:00:00Z');
  const end = new Date(endIso + 'T00:00:00Z');
  while (cur <= end) {
    yield toIsoDate(cur);
    cur = new Date(cur.getTime() + 86400000);
  }
}

function normTeam(s) {
  // Loose team-name normalization for matching Context Graph rows to Odds
  // API event team names — strip diacritics, lowercase, drop non-alnum.
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// ── D1 via relay Worker binding (no CF REST API token scope needed) ──────────
async function d1Query(sql, params = []) {
  const resp = await fetch(`${RELAY_BASE}/d1/execute`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'X-FIELD-Relay': 'field-relay-cron-2026',
    },
    body: JSON.stringify({ sql, params }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`D1 ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  if (!data.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.results || [];
}

async function ensureTables() {
  await d1Query(`CREATE TABLE IF NOT EXISTS odds_history (
    id TEXT PRIMARY KEY,
    game_id TEXT, sport TEXT, date TEXT,
    home_team TEXT, away_team TEXT, commence_time TEXT,
    home_ml REAL, away_ml REAL, draw_ml REAL,
    over_under REAL, over_price REAL, under_price REAL,
    bookmaker TEXT, snapshot_time TEXT,
    snapshot_type TEXT DEFAULT 'close',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  await d1Query(`CREATE TABLE IF NOT EXISTS odds_backfill_progress (
    date TEXT PRIMARY KEY,
    games_processed INTEGER,
    credits_used INTEGER,
    completed_at TEXT DEFAULT (datetime('now'))
  )`);
}

async function getProcessedDates() {
  const rows = await d1Query(`SELECT date FROM odds_backfill_progress`);
  return new Set(rows.map(r => r.date));
}

async function recordProgress(date, gamesProcessed, creditsUsed) {
  await d1Query(
    `INSERT OR REPLACE INTO odds_backfill_progress (date, games_processed, credits_used)
     VALUES (?, ?, ?)`,
    [date, gamesProcessed, creditsUsed]
  );
}

async function insertOddsRow(row) {
  await d1Query(
    `INSERT OR IGNORE INTO odds_history
       (id, game_id, sport, date, home_team, away_team, commence_time,
        home_ml, away_ml, draw_ml, over_under, over_price, under_price,
        bookmaker, snapshot_time, snapshot_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id, row.game_id, row.sport, row.date,
      row.home_team, row.away_team, row.commence_time,
      row.home_ml, row.away_ml, row.draw_ml,
      row.over_under, row.over_price, row.under_price,
      row.bookmaker, row.snapshot_time, row.snapshot_type || 'close',
    ]
  );
}

// ── Odds API helpers ────────────────────────────────────────────────────────
function readQuotaHeaders(resp) {
  const remaining = parseInt(resp.headers.get('x-requests-remaining') || '0', 10) || 0;
  const used      = parseInt(resp.headers.get('x-requests-used')      || '0', 10) || 0;
  return { remaining, used };
}

async function checkQuota() {
  // /v4/sports is a 0-credit endpoint per spec — used only for header read.
  const url = `${ODDS_API_BASE}/v4/sports?apiKey=${ODDS_KEY}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Odds API quota check failed: HTTP ${resp.status}`);
  }
  return readQuotaHeaders(resp);
}

async function fetchHistoricalOdds(sportKey, isoDate) {
  // Closing line proxy: snapshot at 23:59:00Z on the game's date.
  const snap = `${isoDate}T23:59:00Z`;
  const url  = `${ODDS_API_BASE}/v4/historical/sports/${encodeURIComponent(sportKey)}/odds`
             + `?apiKey=${ODDS_KEY}`
             + `&regions=us&markets=h2h,totals&dateFormat=iso&oddsFormat=decimal`
             + `&date=${encodeURIComponent(snap)}`;
  const resp = await fetch(url);
  const quota = readQuotaHeaders(resp);
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    return { ok: false, status: resp.status, error: t.slice(0, 200), quota, data: null };
  }
  const data = await resp.json();
  return { ok: true, status: 200, quota, data };
}

// ── Game-row → odds-row mapping ─────────────────────────────────────────────
function pickConsensus(event) {
  // Take the first bookmaker that carries an h2h market; pull totals from the
  // same one when present. This matches the spec's "consensus odds from the
  // first bookmaker with h2h market" rule.
  const books = Array.isArray(event?.bookmakers) ? event.bookmakers : [];
  for (const b of books) {
    const markets = Array.isArray(b.markets) ? b.markets : [];
    const h2h = markets.find(m => m.key === 'h2h');
    if (!h2h) continue;
    const totals = markets.find(m => m.key === 'totals');
    return {
      bookmaker: b.key || null,
      snapshot_time: b.last_update || null,
      h2h,
      totals: totals || null,
    };
  }
  return null;
}

function buildOddsRow(game, event, consensus, sportKey, isoDate) {
  const homeOutcome = consensus.h2h.outcomes.find(o => normTeam(o.name) === normTeam(event.home_team));
  const awayOutcome = consensus.h2h.outcomes.find(o => normTeam(o.name) === normTeam(event.away_team));
  const drawOutcome = consensus.h2h.outcomes.find(o => /^draw$/i.test(o.name || ''));
  const overOutcome  = consensus.totals?.outcomes?.find(o => /^over$/i.test(o.name  || ''));
  const underOutcome = consensus.totals?.outcomes?.find(o => /^under$/i.test(o.name || ''));
  return {
    id: `${game.id}_${consensus.bookmaker || 'unknown'}_close`,
    game_id:       game.id,
    sport:         game.sport || sportKey,
    date:          isoDate,
    home_team:     event.home_team || null,
    away_team:     event.away_team || null,
    commence_time: event.commence_time || null,
    home_ml: homeOutcome ? Number(homeOutcome.price) : null,
    away_ml: awayOutcome ? Number(awayOutcome.price) : null,
    draw_ml: drawOutcome ? Number(drawOutcome.price) : null,
    over_under:  overOutcome  ? Number(overOutcome.point)  : (underOutcome ? Number(underOutcome.point) : null),
    over_price:  overOutcome  ? Number(overOutcome.price)  : null,
    under_price: underOutcome ? Number(underOutcome.price) : null,
    bookmaker:     consensus.bookmaker,
    snapshot_time: consensus.snapshot_time,
    snapshot_type: 'close',
  };
}

// ── Context Graph: list games for a date ────────────────────────────────────
async function fetchGamesForDate(isoDate) {
  const resp = await fetch(`${RELAY_BASE}/context/date/${isoDate}`);
  if (!resp.ok) {
    return { ok: false, status: resp.status, games: [] };
  }
  const ctx = await resp.json().catch(() => null);
  if (!ctx || !ctx.games) return { ok: true, games: [] };
  const reg = Array.isArray(ctx.games.regular)    ? ctx.games.regular    : [];
  const pst = Array.isArray(ctx.games.postseason) ? ctx.games.postseason : [];
  return { ok: true, games: [...reg, ...pst] };
}

// ── One date worth of work ──────────────────────────────────────────────────
async function processDate(isoDate, remainingBudgetRef) {
  if (remainingBudgetRef.value < PER_CALL_COST) {
    return { date: isoDate, status: 'skipped_budget', games_processed: 0, credits_used: 0 };
  }

  const { ok: ctxOk, games } = await fetchGamesForDate(isoDate);
  if (!ctxOk) {
    return { date: isoDate, status: 'context_graph_failed', games_processed: 0, credits_used: 0 };
  }
  if (!games.length) {
    await recordProgress(isoDate, 0, 0);
    return { date: isoDate, status: 'no_games', games_processed: 0, credits_used: 0 };
  }

  // Skip rows whose sport doesn't map AND brief-style narrative/standings rows.
  const candidates = games.filter(g => {
    if (NON_GAME_BRIEF_TYPES.has(g.brief_type)) return false;
    const key = SPORT_TO_ODDS_KEY[g.sport];
    return !!key;
  });
  if (!candidates.length) {
    await recordProgress(isoDate, 0, 0);
    return { date: isoDate, status: 'no_mappable_sports', games_processed: 0, credits_used: 0 };
  }

  // Group games by sport so each /historical/sports/{sport}/odds call covers
  // the whole sport-day at once (20 credits per sport).
  const bySport = new Map();
  for (const g of candidates) {
    const k = SPORT_TO_ODDS_KEY[g.sport];
    if (!bySport.has(k)) bySport.set(k, []);
    bySport.get(k).push(g);
  }

  let games_processed = 0;
  let credits_used    = 0;

  for (const [sportKey, sportGames] of bySport) {
    if (remainingBudgetRef.value < PER_CALL_COST) break;
    await sleep(ODDS_API_DELAY_MS);
    const res = await fetchHistoricalOdds(sportKey, isoDate);
    credits_used    += PER_CALL_COST;
    remainingBudgetRef.value -= PER_CALL_COST;
    if (!res.ok) {
      console.warn(`[odds-backfill] ${isoDate} ${sportKey}: HTTP ${res.status} ${res.error}`);
      continue;
    }
    // The historical endpoint nests { timestamp, previous_timestamp, next_timestamp, data: [events…] }
    const events = Array.isArray(res.data?.data) ? res.data.data
                  : Array.isArray(res.data)      ? res.data
                  : [];
    // Match by team-name pair
    for (const g of sportGames) {
      const ev = events.find(e =>
        (normTeam(e.home_team) === normTeam(g.home) && normTeam(e.away_team) === normTeam(g.away)) ||
        (normTeam(e.home_team) === normTeam(g.away) && normTeam(e.away_team) === normTeam(g.home))
      );
      if (!ev) continue;
      const consensus = pickConsensus(ev);
      if (!consensus) continue;
      try {
        const row = buildOddsRow(g, ev, consensus, sportKey, isoDate);
        await insertOddsRow(row);
        games_processed++;
      } catch (e) {
        console.warn(`[odds-backfill] insert failed for ${g.id}: ${e.message}`);
      }
    }
  }

  await recordProgress(isoDate, games_processed, credits_used);
  return { date: isoDate, status: 'ok', games_processed, credits_used };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[odds-backfill] start', new Date().toISOString());

  // 1. Schema (idempotent).
  await ensureTables();

  // 2. Read global quota — this is the budget guard (Rule 78).
  //    x-requests-used is MONTHLY cumulative, NOT daily. Comparing it
  //    against DAILY_CEILING is wrong. Instead: cap daily spend at
  //    DAILY_CEILING, check against actual remaining monthly quota.
  const { remaining, used } = await checkQuota();
  const backfillBudget = Math.min(DAILY_CEILING, remaining);
  console.log(`[odds-backfill] quota: remaining=${remaining}, monthly_used=${used}, daily_budget=${backfillBudget}`);
  if (backfillBudget < MIN_BUDGET) {
    console.log(`[odds-backfill] insufficient budget (${backfillBudget} < ${MIN_BUDGET}); exiting clean`);
    return;
  }

  // 3. Compute the date list: oldest unprocessed first, up to yesterday.
  const yesterday = new Date(Date.now() - 86400000);
  const endIso = toIsoDate(yesterday);
  const processed = await getProcessedDates();
  const todo = [];
  for (const iso of dateRange(BACKFILL_START_DATE, endIso)) {
    if (!processed.has(iso)) todo.push(iso);
  }
  if (todo.length === 0) {
    console.log(`[odds-backfill] all dates complete (${BACKFILL_START_DATE} → ${endIso})`);
    await syncOddsToGameTables();
    return;
  }
  console.log(`[odds-backfill] ${todo.length} unprocessed date(s); oldest: ${todo[0]}, newest: ${todo[todo.length - 1]}`);

  // 4. Walk dates oldest-first until budget exhausted.
  const budgetRef = { value: backfillBudget };
  let totalGames = 0, totalCredits = 0, datesDone = 0;
  for (const iso of todo) {
    if (budgetRef.value < PER_CALL_COST) {
      console.log(`[odds-backfill] budget exhausted at ${iso}; stopping (used=${totalCredits})`);
      break;
    }
    const r = await processDate(iso, budgetRef);
    console.log(`[odds-backfill] ${r.date}: ${r.status} games=${r.games_processed} credits=${r.credits_used}`);
    totalGames   += r.games_processed;
    totalCredits += r.credits_used;
    datesDone    += (r.status === 'ok' || r.status === 'no_games' || r.status === 'no_mappable_sports') ? 1 : 0;
  }

  console.log(`[odds-backfill] done: dates=${datesDone}/${todo.length} games=${totalGames} credits=${totalCredits}`);

  // 5. Sync odds_history → game tables' opening_odds column.
  //    The client reads opening_odds from game tables, not odds_history.
  //    This bridge makes backfilled data visible to the Odds Story client.
  await syncOddsToGameTables();
}

// ── Decimal → American moneyline conversion ─────────────────────────────────
function decimalToAmerican(dec) {
  if (dec == null || dec <= 1) return null;
  if (dec >= 2.0) return Math.round((dec - 1) * 100);
  return Math.round(-100 / (dec - 1));
}

// ── Sync odds_history → game tables ─────────────────────────────────────────
async function syncOddsToGameTables() {
  // Find odds_history rows whose game_id exists in game tables with NULL opening_odds
  const candidates = await d1Query(
    `SELECT oh.game_id, oh.sport, oh.home_ml, oh.away_ml, oh.draw_ml,
            oh.over_under, oh.bookmaker, oh.snapshot_time
     FROM odds_history oh
     WHERE oh.game_id IN (
       SELECT id FROM regular_season_games WHERE opening_odds IS NULL
       UNION ALL
       SELECT id FROM postseason_games WHERE opening_odds IS NULL
     )
     GROUP BY oh.game_id`
  );

  if (!candidates.length) {
    console.log('[odds-backfill] sync: no unsynced games');
    return;
  }

  let attempted = 0;
  for (const row of candidates) {
    const odds = {
      source: row.bookmaker || 'odds-api-historical',
      captured_at: row.snapshot_time || new Date().toISOString(),
      moneyline: {
        home: decimalToAmerican(row.home_ml),
        away: decimalToAmerican(row.away_ml),
      },
    };
    if (row.draw_ml) odds.moneyline.draw = decimalToAmerican(row.draw_ml);
    if (row.over_under) {
      odds.total = { over: row.over_under, under: row.over_under };
    }

    const json = JSON.stringify(odds);

    // Try BOTH tables — UPDATE is idempotent (WHERE opening_odds IS NULL)
    for (const table of ['regular_season_games', 'postseason_games']) {
      try {
        await d1Query(
          `UPDATE ${table} SET opening_odds = ? WHERE id = ? AND opening_odds IS NULL`,
          [json, row.game_id]
        );
      } catch (_) { /* table may not have this game — fine */ }
    }
    attempted++;
  }

  // Count actual results
  const afterReg = await d1Query(`SELECT COUNT(*) as c FROM regular_season_games WHERE opening_odds IS NOT NULL`);
  const afterPost = await d1Query(`SELECT COUNT(*) as c FROM postseason_games WHERE opening_odds IS NOT NULL`);
  const totalAfter = (afterReg[0]?.c || 0) + (afterPost[0]?.c || 0);

  console.log(`[odds-backfill] sync: attempted=${attempted}, total_with_odds=${totalAfter} (reg=${afterReg[0]?.c || 0}, post=${afterPost[0]?.c || 0})`);
}

main().catch(err => {
  console.error('[odds-backfill] fatal:', err && err.stack || err);
  process.exit(1);
});
