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

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { backfillSportToOddsKey } from '../src/odds-sport-keys.js';
import { matchSlate, h2hPrices } from '../src/odds-name-match.js';
import { classifyPair, excludeDead } from './lib/dead-pairs.cjs';

const RELAY   = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;   // no default: an unset secret must 401, not look set
const ODDS_KEY = process.env.ODDS_API_KEY;
const ODDS_API_BASE = 'https://api.the-odds-api.com';
const PER_CALL_COST = 20;          // odds-backfill.js:35 — 10 cr x 2 markets

// THE LEDGER'S TWO FINGERPRINTS. A recorded "this pair buys nothing" is only
// true of the code and the request that measured it, so both are stored with
// every row and an exclusion stops applying the moment either changes.
//
// The matcher one is a hash of the SOURCE, not a constant someone has to
// remember to bump. `none-in-window`, `pool-exhausted` and `priced-zero` are
// all facts about how WE read the vendor's response; the day matchSlate or
// h2hPrices changes, every exclusion resting on them expires by itself and the
// pairs go back in the plan. Nothing to maintain, and no way to forget.
const REQUEST_SHAPE = 'us|h2h,totals|12';   // regions | markets | query hour, as built below
const MATCHER_FP = (() => {
  try {
    return createHash('sha256')
      .update(readFileSync(new URL('../src/odds-name-match.js', import.meta.url), 'utf8'))
      .digest('hex').slice(0, 12);
  } catch (_e) { return 'unreadable'; }
})();
const FP_NOW = { params_fp: REQUEST_SHAPE, matcher_fp: MATCHER_FP };

const APPLY     = process.argv.includes('--apply');
const SINCE     = process.argv.find(a => a.startsWith('--since='))?.split('=')[1] || '2026-05-09';
const MAX_PAIRS = Number(process.argv.find(a => a.startsWith('--max-pairs='))?.split('=')[1] || 0);
const BUDGET    = Number(process.argv.find(a => a.startsWith('--budget='))?.split('=')[1] || 3200);
const SPORT     = (process.argv.find(a => a.startsWith('--sport='))?.split('=')[1] || '').toLowerCase();
// --date exists because --sport and --max-pairs together still cannot name a
// pair. Measured 2026-09-19: after the probe filled 66 of its 80 games,
// `--sport=cfb --max-pairs=1` no longer selects 2026-09-12 — that pair fell to
// 14 remaining games and 2026-09-05 (68) became the heaviest. Re-measuring a
// pair against its own recorded result therefore needed a way to ask for it by
// name, and silently buying a different pair would have looked like the same
// experiment.
const DATE      = (process.argv.find(a => a.startsWith('--date='))?.split('=')[1] || '').trim();

const NEWLY_REACHABLE = new Set([
  'la liga', 'ligue 1', 'bundesliga', 'serie a', 'cfl', 'cfb', 'nfl', 'ufl', 'afl', 'ipl',
  'uefa champions league', 'efl cup',
]);

async function d1(sql, params = [], { write = false } = {}) {
  if (!write && !/^\s*SELECT\b/i.test(sql)) throw new Error(`read helper got a non-SELECT: ${sql.slice(0, 60)}`);
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!res.ok || body.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  const r = body.results || body.result || [];
  return Array.isArray(r) ? (r[0]?.results || r) : (r.results || []);
}

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

const allPairs = [...byPair.entries()]
  .map(([k, gs]) => ({ k, sport: gs[0].s, date: gs[0].date, games: gs.filter(g => !existing.has(g.id)) }))
  .filter(p => p.games.length);

// ── THE DEAD-PAIR LEDGER ────────────────────────────────────────────────────
// The plan is rebuilt every run from games with no odds_history row, sorted by
// game count. A pair the vendor has nothing for keeps every one of those games
// forever, so it sorts straight back to the top and gets re-bought at 20
// credits — and the 2026-09-19 fill proved four of them exist. Nothing recorded
// that, so nothing stopped it.
await d1(
  `CREATE TABLE IF NOT EXISTS odds_fill_dead_pairs (
     sport TEXT NOT NULL, date TEXT NOT NULL,
     klass TEXT NOT NULL,
     events INTEGER, in_window INTEGER, priced INTEGER, wanted INTEGER,
     params_fp TEXT NOT NULL, matcher_fp TEXT NOT NULL,
     credits_spent INTEGER, measured_at TEXT NOT NULL,
     PRIMARY KEY (sport, date))`, [], { write: true });

let ledger = [];
try {
  ledger = await d1(`SELECT sport, date, klass, params_fp, matcher_fp, events, in_window, priced, wanted
                       FROM odds_fill_dead_pairs`);
} catch (e) {
  // REFUSE rather than proceed on an empty ledger. An unreadable ledger and an
  // empty one are different facts (Rule 99), and treating the first as the
  // second re-buys every known-dead pair while looking like it worked.
  console.log(`\nREFUSING: the dead-pair ledger is unreadable — ${String(e.message || e).slice(0, 160)}`);
  console.log(`Proceeding would silently re-buy every pair already known to return nothing.`);
  process.exit(1);
}

const { kept: pairs, skipped: deadSkipped, creditsSaved } =
  excludeDead(allPairs, ledger, FP_NOW, PER_CALL_COST);
if (deadSkipped.length) {
  console.log(`  pairs skipped as known-dead                   : ${deadSkipped.length}`
    + ` (${creditsSaved} credits not spent)`);
  for (const d of deadSkipped) console.log(`      ${d.date}  ${String(d.sport).padEnd(22)} ${d.klass}`);
  console.log(`  matcher fingerprint ${MATCHER_FP} — a matcher-class skip expires when src/odds-name-match.js changes\n`);
}

console.log(`  games with opening_odds NULL in the 12 sports : ${wanted.length}`);
console.log(`  distinct sport-date pairs                     : ${byPair.size}`);
console.log(`  pairs still lacking any odds_history row      : ${pairs.length}`);
console.log(`  projected cost                                : ${pairs.length * PER_CALL_COST} credits\n`);

// --sport exists because max-pairs alone cannot choose WHICH pair. The list is
// date-ordered, so --max-pairs=1 always takes the earliest date — 2026-05-09,
// which is ipl then afl. Asking it for "a CFB pair" would silently have bought
// an AFL one.
//
// And when probing a single pair, the heaviest is the only one worth buying.
// The 1-pair IPL probe matched 1/1 — a real result, but one fixture. CFB pairs
// carry many games each, and a fetch that returns events while matching none of
// their team names inserts 0 rows and still bills. Sorting by game count puts
// the most matcher stress on the 20 credits.
let filtered = SPORT ? pairs.filter(p => p.sport === SPORT) : pairs;
if (SPORT && !filtered.length) {
  console.log(`\nREFUSING: no pair matches --sport=${SPORT}. Available: `
    + [...new Set(pairs.map(p => p.sport))].sort().join(', '));
  process.exit(1);
}
if (DATE) {
  const byDate = filtered.filter(p => p.date === DATE);
  // REFUSE rather than fall through to the unfiltered list. A --date that
  // matches nothing usually means the pair is already complete, and quietly
  // buying the next-heaviest pair instead is how a spend gets made against a
  // target nobody chose.
  if (!byDate.length) {
    console.log(`\nREFUSING: no pair matches --date=${DATE}${SPORT ? ` with --sport=${SPORT}` : ''}.`);
    console.log(`Dates still in the plan${SPORT ? ` for ${SPORT}` : ''}: `
      + filtered.map(p => `${p.date}(${p.games.length})`).sort().join(', ').slice(0, 400));
    process.exit(1);
  }
  filtered = byDate;
  console.log(`  --date=${DATE}: ${filtered.length} pair(s), ${filtered[0].games.length} game(s) remaining\n`);
}
const plan = MAX_PAIRS
  ? [...filtered].sort((a, b) => b.games.length - a.games.length).slice(0, MAX_PAIRS)
  : filtered;
if (SPORT) console.log(`  --sport=${SPORT}: ${filtered.length} pair(s), heaviest first\n`);
if (plan.length * PER_CALL_COST > BUDGET) {
  console.log(`REFUSING: plan costs ${plan.length * PER_CALL_COST} > budget ${BUDGET}. Raise --budget deliberately.`);
  process.exit(1);
}

console.log(`  plan: ${plan.length} pair(s) = ${plan.length * PER_CALL_COST} credits`);
for (const p of plan.slice(0, 12)) console.log(`      ${p.date}  ${String(p.sport).padEnd(22)} ${p.games.length} game(s)`);
if (plan.length > 12) console.log(`      … ${plan.length - 12} more`);

if (!APPLY) {
  // THE COST IS PER CALL, NOT PER GAME. One /historical/sports/{sport}/odds call
  // covers a whole sport-date slate for a flat 20 credits whether that slate
  // holds one fixture or eighty. Dividing a day's credits by a day's paired
  // games produces a "credits per game" figure that is an OUTCOME of that day's
  // slate sizes and match rate — it is not a price, and re-costing this plan
  // with it is wrong in both directions.
  //
  // What the ordering below buys: pairs sorted heaviest-first, with a running
  // total. Because every call costs the same, the games-per-call ratio is the
  // only lever, and it is steep — see how few calls reach half the games.
  const heavy = [...filtered].sort((a, b) => b.games.length - a.games.length);
  const totalGames = heavy.reduce((n, p) => n + p.games.length, 0);
  console.log(`\n  YIELD CURVE — every call costs ${PER_CALL_COST}, so the only lever is games per call`);
  console.log(`  pairs  credits  games reachable  % of the ${totalGames} game(s)`);
  let seen = 0;
  for (const n of [1, 5, 10, 20, 40, 80, heavy.length]) {
    if (n > heavy.length) continue;
    const g = heavy.slice(0, n).reduce((a, p) => a + p.games.length, 0);
    console.log(`  ${String(n).padStart(5)}  ${String(n * PER_CALL_COST).padStart(7)}  ${String(g).padStart(15)}  ${String(Math.round(g / totalGames * 100)).padStart(3)}%`);
    seen = n;
  }
  console.log(`  heaviest pair: ${heavy[0].date} ${heavy[0].sport} with ${heavy[0].games.length} game(s) for ${PER_CALL_COST} credits`);
  console.log(`  ${heavy.filter(p => p.games.length === 1).length} pair(s) carry ONE game — ${PER_CALL_COST} credits each, the worst rate on offer`);

  console.log(`\nDRY RUN — nothing fetched, nothing written. Re-run with --apply to spend.`);
  console.log(`\nCOVERAGE: regular_season_games only. Pairs whose games already carry an`);
  console.log(`odds_history row are excluded above, so this plan is the gap and not the`);
  console.log(`archive. A fetch that returns nothing still bills, so the projected cost`);
  console.log(`is what will be SPENT, not what will be FILLED.`);
  process.exit(0);
}

if (!ODDS_KEY) { console.error('missing ODDS_API_KEY'); process.exit(1); }

let spent = 0, inserted = 0, emptyPairs = 0, ambiguousPairs = 0, pricelessEvents = 0;
let matchedGames = 0, noH2hMarket = 0;
// EVERY ATTEMPT IS RECORDED, including the ones that worked. A ledger holding
// only failures cannot tell "measured, and it was fine" from "never measured",
// and the second is what the whole plan already assumes about every pair.
let deadRecorded = 0;
async function recordOutcome(p, o) {
  const klass = classifyPair(o);
  try {
    await d1(
      `INSERT OR REPLACE INTO odds_fill_dead_pairs
         (sport, date, klass, events, in_window, priced, wanted,
          params_fp, matcher_fp, credits_spent, measured_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [String(p.sport).toLowerCase(), p.date, klass,
       o.events, o.inWindow, o.priced, o.wanted,
       FP_NOW.params_fp, FP_NOW.matcher_fp, PER_CALL_COST, new Date().toISOString()],
      { write: true });
    deadRecorded++;
  } catch (e) {
    // A failed record must not fail the fill that already happened and already
    // billed. It is warned rather than swallowed: an unrecorded dead pair is
    // 20 credits on the next run, and a silent one is this defect again.
    console.log(`      ! ledger write failed for ${p.date} ${p.sport} (${klass}): `
      + String(e.message || e).slice(0, 120));
  }
  return klass;
}

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
  if (!events.length) {
    emptyPairs++;
    const k = APPLY ? await recordOutcome(p, { events: 0, inWindow: 0, priced: 0, wanted: p.games.length }) : 'no-events';
    console.log(`  ${p.date} ${p.sport}: vendor returned 0 events (billed ${PER_CALL_COST}) -> ${k}`);
    continue;
  }

  // The whole pair at once — see matchSlate's header. Per-game matching cannot
  // use the fact that an event belongs to at most one game, which is what pairs
  // the initialisms.
  const slate = matchSlate(p.games, events, p.date);
  ambiguousPairs += slate.ambiguous;
  let hit = 0;
  for (const g of p.games) {
    const m = slate.byGameId.get(g.id);
    if (!m) continue;
    matchedGames++;
    const ev = m.event;
    // THE FIRST BOOKMAKER IS NOT THE ONLY BOOKMAKER. This read `bookmakers[0]`
    // and gave up when that one book carried no h2h market — so the 2026-09-12
    // CFB probe priced 66 of 80 matched games and lost 14 here, a silent 17.5%
    // that was about to be extrapolated into a 200-credit decision as if it
    // were the ceiling.
    //
    // The correct rule already exists in this repo and predates this script:
    // odds-backfill.js's pickConsensus takes "the first bookmaker that carries
    // an h2h market", iterating until it finds one. Its own comment says it is
    // "the implementation the fill script was missing". It was right, and the
    // sharing it describes was never actually done. This is that rule, applied
    // — not a new one (Rule 62).
    //
    // It can only find MORE: an event whose first book has h2h behaves exactly
    // as before.
    let bk = null, h2h = null;
    for (const b of (Array.isArray(ev.bookmakers) ? ev.bookmakers : [])) {
      const found = (Array.isArray(b.markets) ? b.markets : []).find(m2 => m2.key === 'h2h');
      if (found) { bk = b; h2h = found; break; }
    }
    if (!h2h) { noH2hMarket++; continue; }
    // Prices come from the shared reader, keyed off the VENDOR's team names.
    // This line used to compare outcome names to the ARCHIVE's names, which
    // returns null for every college game and inserts a row with no odds in it.
    const { home, away, draw } = h2hPrices(h2h.outcomes, ev);
    if (home === null && away === null) { pricelessEvents++; continue; }
    await d1(
      `INSERT OR IGNORE INTO odds_history
         (id, game_id, sport, date, home_team, away_team, commence_time,
          home_ml, away_ml, draw_ml, bookmaker, snapshot_time, snapshot_type)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [`${g.id}_targeted`, g.id, g.sport_raw, g.date, ev.home_team, ev.away_team,
       ev.commence_time ?? null, home, away, draw, bk?.key ?? null,
       payload?.timestamp ?? null, 'open'],
      { write: true });
    hit++; inserted++;
  }
  const klass = APPLY
    ? await recordOutcome(p, { events: events.length, inWindow: slate.poolSize, priced: hit, wanted: p.games.length })
    : classifyPair({ events: events.length, inWindow: slate.poolSize, priced: hit, wanted: p.games.length });
  console.log(`  ${p.date} ${String(p.sport).padEnd(22)} ${events.length} event(s), `
    + `${slate.poolSize} in window -> ${slate.stage1} by name + ${slate.stage2} by elimination, `
    + `${hit}/${p.games.length} priced -> ${klass}`);
}

console.log(`\n  pairs attempted : ${plan.length}`);
console.log(`  credits spent   : ${spent}`);
console.log(`  odds_history rows inserted : ${inserted}`);
console.log(`  pairs the vendor had nothing for : ${emptyPairs} (billed anyway)`);
console.log(`  games skipped as ambiguous       : ${ambiguousPairs} (never guessed)`);
console.log(`  events matched but unpriced      : ${pricelessEvents} (no row written)`);
console.log(`  matched but no h2h market        : ${noH2hMarket} (no row written)`);
// The balance is printed rather than assumed. Every game that matched must
// leave through exactly one of these doors; a nonzero residual means a path
// exists that no counter names, which is how the last one hid.
const residual = matchedGames - inserted - pricelessEvents - noH2hMarket;
console.log(`\n  games matched   : ${matchedGames}`);
console.log(`  = priced ${inserted} + unpriced ${pricelessEvents} + no-market ${noH2hMarket}`
  + (residual === 0 ? '   (balances)' : `   UNACCOUNTED ${residual} — a path with no counter`));
console.log(`\n  outcomes written to odds_fill_dead_pairs : ${deadRecorded}`
  + `   (params ${FP_NOW.params_fp}, matcher ${FP_NOW.matcher_fp})`);
console.log(`  A 'vendor' class stays dead through any change to our code. A 'matcher'`);
console.log(`  class — none-in-window, pool-exhausted, priced-zero — expires the moment`);
console.log(`  src/odds-name-match.js changes, because those say our reading failed, not`);
console.log(`  that their data is absent.`);
console.log(`\nNo odds_backfill_progress row was read or written by this script.`);
