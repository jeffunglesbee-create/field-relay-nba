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

// The kickoff mark, shared with the worker's two writers so all three label a
// closing line by the same rule. Relative because this script runs from a
// checkout, not from the bundled worker.
import { stampKickoff } from '../../src/odds-kickoff.js';
import { backfillSportToOddsKey } from '../../src/odds-sport-keys.js';
import { matchSlate, h2hPrices } from '../../src/odds-name-match.js';

// ── Config (all from GitHub secrets) ────────────────────────────────────────
const ODDS_KEY    = process.env.ODDS_API_KEY;
const RELAY_BASE  = process.env.RELAY_BASE        || 'https://field-relay-nba.jeffunglesbee.workers.dev';

// NOT shared, and the old comment here said it was. This is a per-RUN
// in-process cap: it is decremented in a local variable and reset every
// invocation, so two dispatches in one day permit 2700 each. It does not
// participate in the worker's KV ledger (odds:daily:*, ceiling 3800) and the
// worker does not know it exists. Two dispatches plus a full worker day is
// 9,200 permitted credits across ceilings that never reconcile.
const DAILY_CEILING    = 2700;           // per-run, in-process, NOT the worker's ledger
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
// This WAS an eight-entry private copy of a table that already exists. It is
// gone deliberately: it is the fourth sport-key registry described in
// CC-CMD-2026-09-15-cfb-opening-odds-gap, and because it carried no American
// football key of any kind, every CFB game was dropped at the candidate filter
// below before one fetch was issued — 177 of them dated 2026-09-01 alone.
//
// It also went unnoticed for 73 days precisely BECAUSE it was a copy:
// src/odds-sport-keys.js calls itself "the one place a sport's Odds API key is
// written down", and a prior session checked the three tables it documents,
// found CFB present, and concluded the cause was downstream. It was upstream,
// here. Adding ten entries would have fixed today and guaranteed the same
// divergence the next time a sport is added to the canonical table.
//
// ARCHIVE carries no World Cup key (WC lives in AMBIENT as `wc26`), so the two
// aliases the private map held are kept as an explicit extension rather than
// silently lost in the swap.
// The lookup itself is backfillSportToOddsKey() in that module, so this script
// and scripts/check-backfill-registry-coverage.mjs test one definition.

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
// Rule 99 (DISTINGUISHABILITY-A). null means the vendor did not tell us; a real
// 0 stays 0. The previous form mapped both onto 0, and main() sizes the day's
// work with `Math.min(DAILY_CEILING, remaining)` -- so one missing header made
// the budget 0 and the entire daily backfill a silent no-op, logging
// "remaining=0" as though the quota were exhausted.
function readQuotaHeaders(resp) {
  const num = (h) => {
    const raw = resp.headers.get(h);
    if (raw === null || String(raw).trim() === '') return null;
    const n = parseInt(String(raw), 10);
    return Number.isFinite(n) ? n : null;
  };
  return { remaining: num('x-requests-remaining'), used: num('x-requests-used') };
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
  // Shared with scripts/targeted-odds-fill.mjs so the two writers into
  // odds_history read prices the same way. Behaviour is unchanged here: this
  // is the implementation the fill script was missing, not a new rule.
  const ml = h2hPrices(consensus.h2h.outcomes, event);
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
    home_ml: ml.home,
    away_ml: ml.away,
    draw_ml: ml.draw,
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
    const key = backfillSportToOddsKey(g.sport);
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
    const k = backfillSportToOddsKey(g.sport);
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
    // Match by team-name pair. The equality matcher that used to live here
    // scored 0 of 80 on cfb 2026-09-12 (outbox/fixture-cfb-2026-09-12.json):
    // the vendor appends a mascot to every college name, so "Georgia" never
    // equalled "Georgia Bulldogs" and this loop matched nothing, silently, for
    // as long as CFB has been in the archive. src/odds-name-match.js and its
    // mutation harness replace it; do not reintroduce a local matcher here.
    // ONE CALL FOR THE WHOLE SLATE, not one per game. A vendor event belongs to
    // at most one game, so pairing the unambiguous ones SPENDS those events and
    // the rest fall out by elimination — which is how an initialism the matcher
    // cannot read ("ETSU", "MTSU", "FAU") still gets paired: via the side that
    // is not abbreviated. matchSlate also windows the payload to this date,
    // because the historical endpoint returns future fixtures that are not
    // candidates and only manufacture ambiguity.
    const slate = matchSlate(sportGames, events, isoDate);
    console.log(`[odds-backfill] ${isoDate} ${sportKey}: ${events.length} event(s), `
      + `${slate.droppedOutOfWindow} out of window, ${slate.poolSize} in pool -> `
      + `${slate.stage1} paired by name, ${slate.stage2} by elimination, `
      + `${slate.unmatched} unmatched, ${slate.ambiguous} ambiguous`);
    for (const g of sportGames) {
      const match = slate.byGameId.get(g.id);
      if (!match) continue;
      const ev = match.event;
      // buildOddsRow keys home_ml off ev.home_team, so a swapped pairing stays
      // internally consistent. Logged because it has never fired in measurement.
      if (match.swapped) {
        console.warn(`[odds-backfill] ${isoDate} ${sportKey}: reversed orientation for ${g.away} @ ${g.home} `
          + `-> stored as ${ev.away_team} @ ${ev.home_team}`);
      }
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
  // An unknown balance is not a budget. Failing loudly beats both alternatives:
  // silently doing nothing (what `|| 0` did), and spending up to DAILY_CEILING
  // blind against a balance we cannot see (Rule 78).
  if (remaining === null) {
    throw new Error(
      'Odds API answered 200 but sent no x-requests-remaining header — the ' +
      'balance is unknown, not zero. Refusing to size a budget against it.');
  }
  const backfillBudget = Math.min(DAILY_CEILING, remaining);
  console.log(`[odds-backfill] quota: remaining=${remaining}, monthly_used=${used === null ? 'unknown' : used}, daily_budget=${backfillBudget}`);
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
  // UTC day boundary. A game dated today has a kickoff still ahead of it (or in
  // progress), so its closing line is not this batch's to write.
  const TODAY_UTC = new Date().toISOString().slice(0, 10);
  let skippedClosing = 0;
  // Find odds_history rows whose game_id exists in game tables with NULL opening_odds
  const candidates = await d1Query(
    `SELECT oh.game_id, oh.sport, oh.home_ml, oh.away_ml, oh.draw_ml,
            oh.over_under, oh.bookmaker, oh.snapshot_time,
            COALESCE(
              (SELECT date FROM regular_season_games WHERE id = oh.game_id),
              (SELECT date FROM postseason_games     WHERE id = oh.game_id)
            ) AS game_date,
            -- Kickoff, so the blob can say whether it has the right to call
            -- itself a closing line. This writer is the only source for old
            -- games, so it labels rather than refuses.
            COALESCE(
              (SELECT start_time FROM regular_season_games WHERE id = oh.game_id),
              (SELECT start_time FROM postseason_games     WHERE id = oh.game_id)
            ) AS game_start_time,
            -- WHICH TABLE, and WHICH FIELD IS ACTUALLY EMPTY.
            -- Without these the loop wrote to BOTH tables and BOTH fields and
            -- logged a change_log row after each one. A game lives in one table,
            -- and the candidate predicate is "opening_odds IS NULL OR
            -- closing_odds IS NULL" -- so a game needing only its opening line
            -- still produced a closing_odds entry attributed to this script
            -- for a write that matched nothing. MEASURED 2026-09-15: 22 archived
            -- closing lines carry a DraftKings American-odds blob with no total,
            -- which this script cannot emit (it converts the odds_history row,
            -- giving that row's bookmaker and its over_under), yet change_log
            -- named odds_backfill for all 22 -- 44 entries, exactly two per game.
            CASE
              WHEN EXISTS (SELECT 1 FROM regular_season_games WHERE id = oh.game_id)
                THEN 'regular_season_games'
              WHEN EXISTS (SELECT 1 FROM postseason_games WHERE id = oh.game_id)
                THEN 'postseason_games'
              ELSE NULL
            END AS game_table,
            COALESCE(
              (SELECT opening_odds IS NULL FROM regular_season_games WHERE id = oh.game_id),
              (SELECT opening_odds IS NULL FROM postseason_games     WHERE id = oh.game_id)
            ) AS opening_is_null,
            COALESCE(
              (SELECT closing_odds IS NULL FROM regular_season_games WHERE id = oh.game_id),
              (SELECT closing_odds IS NULL FROM postseason_games     WHERE id = oh.game_id)
            ) AS closing_is_null
     FROM odds_history oh
     WHERE oh.game_id IN (
       SELECT id FROM regular_season_games WHERE opening_odds IS NULL OR closing_odds IS NULL
       UNION ALL
       SELECT id FROM postseason_games WHERE opening_odds IS NULL OR closing_odds IS NULL
     )
     GROUP BY oh.game_id`
  );

  if (!candidates.length) {
    console.log('[odds-backfill] sync: no unsynced games');
    return;
  }

  let attempted = 0, skippedUndated = 0, skippedNoTable = 0, skippedFilled = 0;
  for (const row of candidates) {
    // A CAPTURED_AT THIS PROCESS INVENTED IS NOT A MEASUREMENT.
    //
    // `row.snapshot_time || new Date().toISOString()` stamped the moment THIS
    // RUN happened whenever the provider row carried no snapshot time — so a
    // game played five days earlier got a five-day-late "closing" capture.
    // MEASURED 2026-09-14: ten rows stamped 2026-08-11T01:58:26..39 for games
    // played 2026-08-05, thirteen seconds apart and sequential, which is what a
    // loop calling new Date() per row looks like.
    //
    // The fallback stays for `opening_odds`, where it is only a provenance
    // wart. It is removed for `closing_odds`, where it is a false fact: that
    // column claims to be the last price before kickoff and a run-time stamp
    // cannot support the claim.
    const measuredCapture = row.snapshot_time || null;
    const odds = {
      source: row.bookmaker || 'odds-api-historical',
      captured_at: measuredCapture || new Date().toISOString(),
      moneyline: {
        home: decimalToAmerican(row.home_ml),
        away: decimalToAmerican(row.away_ml),
      },
    };
    if (row.draw_ml) odds.moneyline.draw = decimalToAmerican(row.draw_ml);
    if (row.over_under) {
      odds.total = { over: row.over_under, under: row.over_under };
    }

    stampKickoff(odds, odds.captured_at, row.game_start_time);
    const json = JSON.stringify(odds);

    // Try BOTH tables — UPDATE is idempotent (WHERE opening_odds IS NULL)
    // Write to BOTH opening_odds and closing_odds for historical games.
    // The Odds API historical endpoint returns odds near game time,
    // which is closer to closing than opening. For completed games with
    // one data point, it serves as both.
    //
    // BUT ONLY FOR GAMES THAT HAVE ALREADY HAPPENED (added 2026-08-21).
    // AmbientDO._captureClosingOdds fires on the pre→live transition and
    // writes `WHERE closing_odds IS NULL`. If this batch has already filled
    // that column for a game that has not kicked off yet, the guard is false
    // forever and the real capture silently never lands -- so opening and
    // closing end up as one snapshot written to two columns, byte-identical,
    // with `closing_odds.captured_at` at or even BEFORE the opening one.
    // That is exactly the state measured on /context/date/2026-08-21, and it
    // is why the laboratory's OddsStory.Moved branch has never been reachable:
    // it correctly refuses to narrate a movement from a non-sequence.
    //
    // For a game in the past there is no kickoff left to capture, so the
    // one-data-point behaviour above is still right and is preserved. For
    // today and later, leave closing_odds NULL and let the hook do its job.
    // A game still to be played keeps closing_odds NULL for the kickoff hook.
    // Driven by the row's own date rather than by the UPDATE's guard alone, so
    // the change_log insert below cannot record a write that never matched.
    const isPast = !!row.game_date && row.game_date < TODAY_UTC;
    // AND ONLY WHEN THE SNAPSHOT TIME IS A MEASUREMENT (added 2026-09-14).
    // Without it the blob's captured_at is this run's clock, and a closing
    // column carrying a run-time stamp is a false fact rather than a stale one.
    const wanted = (isPast && measuredCapture)
      ? ['opening_odds', 'closing_odds'] : ['opening_odds'];
    // Only the columns that are genuinely empty. A write that cannot match is
    // not a write, and logging it makes change_log name a writer that did
    // nothing -- which is worse than silence, because the next session reads
    // it as evidence.
    const isEmpty = { opening_odds: !!row.opening_is_null, closing_odds: !!row.closing_is_null };
    const fields = wanted.filter(f => isEmpty[f]);
    if (wanted.length && !fields.length) skippedFilled++;
    if (!isPast) skippedClosing++;
    else if (!measuredCapture) {
      skippedUndated++;
      console.log(`[odds-backfill] closing_odds skipped for ${row.game_id}: `
        + `odds_history row carries no snapshot_time, so captured_at would be this run's clock`);
    }

    if (!row.game_table) {
      skippedNoTable++;
      console.log(`[odds-backfill] ${row.game_id}: no row in either games table — nothing to update`);
      continue;
    }
    for (const table of [row.game_table]) {
      for (const field of fields) {
        try {
          const guard = field === 'closing_odds' ? ' AND date < ?' : '';
          const args  = field === 'closing_odds'
            ? [json, row.game_id, TODAY_UTC]
            : [json, row.game_id];
          await d1Query(
            `UPDATE ${table} SET ${field} = ? WHERE id = ? AND ${field} IS NULL${guard}`,
            args
          );
          // Log to change_log for O(1) Newspaper "What's Moving" + Brief Freshness Guard.
          // The UPDATE above matched: `table` is the one table this game is in
          // and `field` is one this game's row actually has empty, both read
          // from the candidate query rather than assumed. The previous form of
          // this comment asserted the same thing while the loop wrote to both
          // tables and both fields -- see the note on the candidate query.
          await d1Query(
            `INSERT INTO change_log (game_id, source, field, old_value, new_value, ts)
             VALUES (?, 'odds_backfill', ?, NULL, ?, datetime('now'))`,
            [row.game_id, field, json]
          ).catch(e => {
            // NOT SWALLOWED. A write that cannot record itself is a write
            // nobody can attribute later, and reconstructing the authorship of
            // 62 such rows on 2026-09-14 took two failed fingerprints and a
            // dated elimination argument. The write itself already succeeded;
            // this only makes its silence audible.
            console.warn(`[odds-backfill] change_log insert FAILED for `
              + `${row.game_id}.${field} — this row will be unattributable: ${e.message}`);
          });
        } catch (_) { /* table may not have this game */ }
      }
    }
    attempted++;
  }

  // Count actual results
  const afterRegOpen = await d1Query(`SELECT COUNT(*) as c FROM regular_season_games WHERE opening_odds IS NOT NULL`);
  const afterPostOpen = await d1Query(`SELECT COUNT(*) as c FROM postseason_games WHERE opening_odds IS NOT NULL`);
  const afterRegClose = await d1Query(`SELECT COUNT(*) as c FROM regular_season_games WHERE closing_odds IS NOT NULL`);
  const afterPostClose = await d1Query(`SELECT COUNT(*) as c FROM postseason_games WHERE closing_odds IS NOT NULL`);

  console.log(`[odds-backfill] sync: ${skippedNoTable} game(s) in no games table, `
    + `${skippedFilled} game(s) already had every column this run could fill — neither logged to change_log.`);
  console.log(`[odds-backfill] sync: closing_odds left NULL for ${skippedClosing} game(s) dated ${TODAY_UTC} or later — AmbientDO._captureClosingOdds owns those.`);
  console.log(`[odds-backfill] sync: closing_odds left NULL for ${skippedUndated} past game(s) whose odds_history row carries no snapshot_time — a run-time captured_at cannot support a closing claim.`);
  console.log(`[odds-backfill] sync: attempted=${attempted}, opening_odds=${(afterRegOpen[0]?.c||0)+(afterPostOpen[0]?.c||0)} (reg=${afterRegOpen[0]?.c||0}, post=${afterPostOpen[0]?.c||0}), closing_odds=${(afterRegClose[0]?.c||0)+(afterPostClose[0]?.c||0)} (reg=${afterRegClose[0]?.c||0}, post=${afterPostClose[0]?.c||0})`);
}

main().catch(err => {
  console.error('[odds-backfill] fatal:', err && err.stack || err);
  process.exit(1);
});
