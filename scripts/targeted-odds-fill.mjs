// Fetch odds for the sport-date pairs the 2026-09-15 registry work made
// reachable — and NOTHING else.
//
// WHY NOT A PROGRESS RESET. odds_backfill_progress is keyed by DATE; the gap is
// per SPORT-DATE. processDate() has no per-game "already fetched" skip, so
// clearing a progress row re-fetches every mappable sport on that date.
// Measured (run of progress-reset-cost.yml, 2026-09-15):
//
//   the gap                       151 pairs   3,020 credits
//   what a date reset re-fetches  293 pairs   5,860 credits
//   waste, already complete       142 pairs   2,840 credits  (49 mlb, 40 wnba,
//                                                             20 mls, 19 epl,
//                                                             14 fifa world cup)
//
// This asks for the 151 and touches no progress row.
//
// DRY RUN IS THE DEFAULT. --apply is required to spend anything. Every guard
// below exists because this is the first live write path this session has
// built, and "a fetch that returns nothing still bills" — the premise that the
// new keys actually return vendor data for historical dates is NOT yet tested.
// --max-pairs exists so that premise can be bought for 20 credits instead of
// 3,020.

import { backfillSportToOddsKey } from '../src/odds-sport-keys.js';

const RELAY   = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const ODDS_KEY = process.env.ODDS_API_KEY;
const ODDS_API_BASE = 'https://api.the-odds-api.com';
const PER_CALL_COST = 20;          // odds-backfill.js:35 — 10 cr x 2 markets

const APPLY     = process.argv.includes('--apply');
const SINCE     = process.argv.find(a => a.startsWith('--since='))?.split('=')[1] || '2026-05-09';
const MAX_PAIRS = Number(process.argv.find(a => a.startsWith('--max-pairs='))?.split('=')[1] || 0);
const BUDGET    = Number(process.argv.find(a => a.startsWith('--budget='))?.split('=')[1] || 3200);

const NEWLY_REACHABLE = new Set([
  'la liga', 'ligue 1', 'bundesliga', 'serie a', 'cfl', 'cfb', 'nfl', 'ufl', 'afl', 'ipl',
  'uefa champions league', 'efl cup',
]);

async function d1(sql, params = [], { write = false } = {}) {
  if (!write && !/^\s*SELECT\b/i.test(sql)) throw new Error(`read helper got a non-SELECT: ${sql.slice(0, 60)}`);
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!res.ok || body.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  const r = body.results || body.result || [];
  return Array.isArray(r) ? (r[0]?.results || r) : (r.results || []);
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

console.log(`=== targeted odds fill  utc=${new Date().toISOString()} ===`);
console.log(`mode: ${APPLY ? '*** APPLY — WILL SPEND CREDITS ***' : 'DRY RUN (no fetch, no write)'}`);
console.log(`since=${SINCE}  max-pairs=${MAX_PAIRS || 'all'}  budget=${BUDGET} credits\n`);

// 1. The pairs, and which of them still lack an odds_history row. A pair whose
//    games already have rows is not refetched — that is the waste this script
//    exists to avoid, and skipping it silently would reintroduce it.
const games = await d1(
  `SELECT id, LOWER(sport) AS s, sport AS sport_raw, date, home, away
     FROM regular_season_games
    WHERE date >= ? AND opening_odds IS NULL`, [SINCE]);

const wanted = games.filter(g => NEWLY_REACHABLE.has(g.s) && backfillSportToOddsKey(g.s));
const byPair = new Map();
for (const g of wanted) {
  const k = `${g.s}|${g.date}`;
  if (!byPair.has(k)) byPair.set(k, []);
  byPair.get(k).push(g);
}

const existing = new Set((await d1(
  `SELECT DISTINCT game_id FROM odds_history`)).map(r => r.game_id));

const pairs = [...byPair.entries()]
  .map(([k, gs]) => ({ k, sport: gs[0].s, date: gs[0].date, games: gs.filter(g => !existing.has(g.id)) }))
  .filter(p => p.games.length);

console.log(`  games with opening_odds NULL in the 12 sports : ${wanted.length}`);
console.log(`  distinct sport-date pairs                     : ${byPair.size}`);
console.log(`  pairs still lacking any odds_history row      : ${pairs.length}`);
console.log(`  projected cost                                : ${pairs.length * PER_CALL_COST} credits\n`);

const plan = MAX_PAIRS ? pairs.slice(0, MAX_PAIRS) : pairs;
if (plan.length * PER_CALL_COST > BUDGET) {
  console.log(`REFUSING: plan costs ${plan.length * PER_CALL_COST} > budget ${BUDGET}. Raise --budget deliberately.`);
  process.exit(1);
}

console.log(`  plan: ${plan.length} pair(s) = ${plan.length * PER_CALL_COST} credits`);
for (const p of plan.slice(0, 12)) console.log(`      ${p.date}  ${String(p.sport).padEnd(22)} ${p.games.length} game(s)`);
if (plan.length > 12) console.log(`      … ${plan.length - 12} more`);

if (!APPLY) {
  console.log(`\nDRY RUN — nothing fetched, nothing written. Re-run with --apply to spend.`);
  console.log(`\nCOVERAGE: regular_season_games only. Pairs whose games already carry an`);
  console.log(`odds_history row are excluded above, so this plan is the gap and not the`);
  console.log(`archive. A fetch that returns nothing still bills, so the projected cost`);
  console.log(`is what will be SPENT, not what will be FILLED.`);
  process.exit(0);
}

if (!ODDS_KEY) { console.error('missing ODDS_API_KEY'); process.exit(1); }

let spent = 0, inserted = 0, emptyPairs = 0;
for (const p of plan) {
  const sportKey = backfillSportToOddsKey(p.sport);
  const url = `${ODDS_API_BASE}/v4/historical/sports/${encodeURIComponent(sportKey)}/odds`
    + `?apiKey=${ODDS_KEY}&regions=us&markets=h2h,totals&oddsFormat=american`
    + `&date=${p.date}T12:00:00Z`;
  const res = await fetch(url);
  spent += PER_CALL_COST;
  if (!res.ok) { console.log(`  ${p.date} ${p.sport}: HTTP ${res.status} — skipped`); continue; }
  const payload = await res.json();
  const events = payload?.data || [];
  if (!events.length) { emptyPairs++; console.log(`  ${p.date} ${p.sport}: vendor returned 0 events (billed ${PER_CALL_COST})`); continue; }

  let hit = 0;
  for (const g of p.games) {
    const ev = events.find(e => norm(e.home_team) === norm(g.home) && norm(e.away_team) === norm(g.away));
    if (!ev) continue;
    const bk = ev.bookmakers?.[0];
    const h2h = bk?.markets?.find(m => m.key === 'h2h');
    if (!h2h) continue;
    const home = h2h.outcomes?.find(o => norm(o.name) === norm(g.home))?.price ?? null;
    const away = h2h.outcomes?.find(o => norm(o.name) === norm(g.away))?.price ?? null;
    const draw = h2h.outcomes?.find(o => /^draw$/i.test(o.name))?.price ?? null;
    await d1(
      `INSERT OR IGNORE INTO odds_history
         (id, game_id, sport, date, home_team, away_team, commence_time,
          home_ml, away_ml, draw_ml, bookmaker, snapshot_time, snapshot_type)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [`${g.id}_targeted`, g.id, g.sport_raw, g.date, g.home, g.away,
       ev.commence_time ?? null, home, away, draw, bk?.key ?? null,
       payload?.timestamp ?? null, 'open'],
      { write: true });
    hit++; inserted++;
  }
  console.log(`  ${p.date} ${String(p.sport).padEnd(22)} ${events.length} event(s) -> ${hit}/${p.games.length} matched`);
}

console.log(`\n  pairs attempted : ${plan.length}`);
console.log(`  credits spent   : ${spent}`);
console.log(`  odds_history rows inserted : ${inserted}`);
console.log(`  pairs the vendor had nothing for : ${emptyPairs} (billed anyway)`);
console.log(`\nNo odds_backfill_progress row was read or written by this script.`);
