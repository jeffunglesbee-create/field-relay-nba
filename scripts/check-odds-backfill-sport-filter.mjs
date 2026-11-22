#!/usr/bin/env node
/**
 * GET /archive/odds-backfill?date=...&sport=EPL fetches ONE sport and spends for ONE sport.
 * docs/CC-CMD-2026-11-22-epl-rows-left-unpriced-by-c-palace.md, Task 2.
 *
 * WHY. The route walks every row of the date whose opening_odds is NULL, buckets them by sport and makes one historical
 * fetch per sport at 30 credits. The nine EPL rows the C Palace defect left unpriced sit on dates that also carry five to ten
 * other sports' NULL rows (read from field-archive, 2026-11-22), so repairing them through the unfiltered route would cost
 * several times the 270 credits the nine EPL sport-dates are worth, and the route's own day cap (300) would stop it before
 * it reached EPL on some dates. `?sport=` narrows the rows BEFORE they are bucketed.
 *
 * THIS RUNS THE ROUTE: the real src/index.js default export over a node:sqlite D1 holding NULL-opening rows of four sports
 * on 2026-10-25 plus an EPL row on another date and an already-priced EPL row, a pinned clock, a Map KV, and a vendor stub
 * that records which sport key and date each historical fetch asked for and serves one real-shaped EPL event.
 *
 * INDEX_SRC points the worker elsewhere; scripts/mutate-odds-backfill-sport-filter.mjs uses it.
 */
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

register('data:text/javascript,' + encodeURIComponent(
  "export async function resolve(s, c, next) { if (s === '@cloudflare/puppeteer') return { url: 'data:text/javascript,export default {}', shortCircuit: true }; return next(s, c); }"));

const RealDate = Date;
const CLOCK = RealDate.parse('2026-11-23T10:00:00Z');
class PinnedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(CLOCK); }
  static now() { return CLOCK; }
}
globalThis.Date = PinnedDate;

const MCP_SECRET = 'mcp-secret-for-the-check';
const INDEX = resolve(process.env.INDEX_SRC || 'src/index.js');
const worker = (await import(pathToFileURL(INDEX).href)).default;
const { archiveSportToOddsKey } = await import(pathToFileURL(resolve('src/odds-sport-keys.js')).href);
const { readFileSync } = await import('node:fs');

const results = [];
const check = (name, ok, detail = '') => { results.push([name, !!ok, detail]); };

const DAY = '2026-11-23', MONTH = '2026-11';
const SCHEMA = `
CREATE TABLE regular_season_games (id TEXT PRIMARY KEY, sport TEXT, league TEXT, home TEXT, away TEXT, start_time TEXT, date TEXT,
  opening_odds TEXT, closing_odds TEXT, inplay_odds TEXT, finalized_at TEXT, home_score INTEGER, away_score INTEGER, series_key TEXT);
CREATE TABLE postseason_games (id TEXT PRIMARY KEY, sport TEXT, league TEXT, home TEXT, away TEXT, start_time TEXT, date TEXT,
  opening_odds TEXT, closing_odds TEXT, inplay_odds TEXT, finalized_at TEXT, home_score INTEGER, away_score INTEGER, series_key TEXT);
-- the production table the reconciler writes beside every update (src/sync-reconciler.js, ensureChangeLog)
CREATE TABLE change_log (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL, source TEXT NOT NULL, field TEXT NOT NULL,
  old_value TEXT, new_value TEXT NOT NULL, ts TEXT NOT NULL DEFAULT (datetime('now')), consumed INTEGER DEFAULT 0);
CREATE TABLE odds_budget (day TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE odds_budget_site (day TEXT NOT NULL, site TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, site));
CREATE TABLE odds_budget_month (month TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE odds_budget_gate (id INTEGER PRIMARY KEY, token TEXT NOT NULL);
CREATE TABLE odds_budget_refusal (day TEXT NOT NULL, scope TEXT NOT NULL, site TEXT NOT NULL, first_at TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, scope, site));
CREATE TABLE odds_reconcile_state (day TEXT NOT NULL, site TEXT NOT NULL, state TEXT NOT NULL, cache TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0, credits_kept INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, site, state, cache));
`;

// League differs from sport on purpose: a filter that read the wrong column would not survive it.
const ROWS = [
  { id: 'EPL_2026-10-25_cpalace_newcastle', sport: 'EPL', league: 'Premier League', home: 'C Palace', away: 'Newcastle', start: '2026-10-25T14:00Z', date: '2026-10-25', odds: null },
  { id: 'EPL_2026-10-25_arsenal_spurs',     sport: 'EPL', league: 'Premier League', home: 'Arsenal', away: 'Spurs', start: '2026-10-25T14:00Z', date: '2026-10-25', odds: '{"already":"priced"}' },
  { id: 'EPL_2026-10-18_brighton_cpalace',  sport: 'EPL', league: 'Premier League', home: 'Brighton', away: 'C Palace', start: '2026-10-18T13:00Z', date: '2026-10-18', odds: null },
  { id: 'LL_2026-10-25_realmadrid_barca',   sport: 'La Liga', league: 'LaLiga', home: 'Real Madrid', away: 'Barcelona', start: '2026-10-25T19:00Z', date: '2026-10-25', odds: null },
  { id: 'MLS_2026-10-25_columbus_miami',    sport: 'MLS', league: 'MLS', home: 'Columbus', away: 'Inter Miami CF', start: '2026-10-25T23:00Z', date: '2026-10-25', odds: null },
  { id: 'NFL_2026-10-25_chiefs_bills',      sport: 'NFL', league: 'NFL', home: 'Kansas City Chiefs', away: 'Buffalo Bills', start: '2026-10-25T20:00Z', date: '2026-10-25', odds: null },
];

// A real-shaped Odds API event: the vendor's full names, one preferred bookmaker, a three-way soccer h2h.
const EPL_EVENT = {
  id: 'ev1', sport_key: 'soccer_epl', home_team: 'Crystal Palace', away_team: 'Newcastle United', commence_time: '2026-10-25T14:00:00Z',
  bookmakers: [{ key: 'draftkings', title: 'DraftKings', markets: [{ key: 'h2h', outcomes: [
    { name: 'Crystal Palace', price: 160 }, { name: 'Newcastle United', price: 175 }, { name: 'Draw', price: 250 }] }] }],
};

/** One scenario: a fresh world, one request, then the readings. */
async function world(path, { auth = true, method = 'GET', siteUsed = {} } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  sqlite.prepare('INSERT INTO odds_budget VALUES (?, ?)').run(DAY, 100);
  sqlite.prepare('INSERT INTO odds_budget_month VALUES (?, ?)').run(MONTH, 5000);
  for (const [site, used] of Object.entries(siteUsed)) sqlite.prepare('INSERT INTO odds_budget_site VALUES (?, ?, ?)').run(DAY, site, used);
  // A postseason NFL row on the same date: the filter must cover BOTH tables, or this one would be fetched under sport=EPL.
  sqlite.prepare(`INSERT INTO postseason_games (id, sport, league, home, away, start_time, date, opening_odds, finalized_at, series_key)
                  VALUES ('NFL_PS_2026-10-25_a_b', 'NFL', 'NFL', 'Team A', 'Team B', '2026-10-25T20:00Z', '2026-10-25', NULL, '2026-10-26T00:00:00Z', 'ps')`).run();
  for (const r of ROWS) sqlite.prepare(`INSERT INTO regular_season_games (id, sport, league, home, away, start_time, date, opening_odds, finalized_at)
                                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-10-26T00:00:00Z')`).run(r.id, r.sport, r.league, r.home, r.away, r.start, r.date, r.odds);
  const odds = /odds_budget|odds_reconcile/;
  const mk = (sql, args = []) => ({ sql, args, bind: (...a) => mk(sql, a),
    all: async () => { try { return { results: sqlite.prepare(sql).all(...args), success: true, meta: {} }; } catch (e) { if (odds.test(sql)) throw e; return { results: [], success: true, meta: {} }; } },
    first: async () => { try { return sqlite.prepare(sql).get(...args) ?? null; } catch (e) { if (odds.test(sql)) throw e; return null; } },
    run: async () => { try { const r = sqlite.prepare(sql).run(...args); return { success: true, results: [], meta: { changes: Number(r.changes) } }; } catch (e) { if (odds.test(sql)) throw e; return { success: true, results: [], meta: { changes: 0 } }; } } });
  const D1 = { prepare: (s) => mk(s),
    batch: async (list) => {
      sqlite.exec('BEGIN');
      try {
        const out = list.map(s => /^\s*(SELECT|WITH)/i.test(s.sql) || /RETURNING/i.test(s.sql)
          ? { results: sqlite.prepare(s.sql).all(...s.args), success: true, meta: {} }
          : { results: [], success: true, meta: { changes: Number(sqlite.prepare(s.sql).run(...s.args).changes) } });
        sqlite.exec('COMMIT'); return out;
      } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    } };
  const kv = new Map();
  const KV = { get: async (k) => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); }, list: async () => ({ keys: [] }) };
  const asked = [];
  globalThis.fetch = async (input) => {
    const url = String(input?.url ?? input);
    if (!url.includes('api.the-odds-api.com')) return new Response('{}', { status: 200 });
    const m = /\/v4\/historical\/sports\/([a-z0-9_]+)\/odds\?.*?date=([0-9T:Z-]+)/.exec(url);
    asked.push({ key: m?.[1] ?? null, snapshot: m?.[2] ?? null });
    const data = m?.[1] === 'soccer_epl' && m[2].startsWith('2026-10-25') ? [EPL_EVENT] : [];
    return new Response(JSON.stringify({ timestamp: m?.[2] ?? null, data }), { status: 200, headers: { 'x-requests-last': '30', 'x-requests-remaining': '400000' } });
  };
  const env = { FIELD_JOURNALISM: KV, ARCHIVE_DB: D1, ODDS_API_KEY: 'k', RELAY_SHARED_SECRET: 's', FIELD_MCP_SECRET: MCP_SECRET };
  const w = console.warn, l = console.log, e = console.error;
  console.warn = console.log = console.error = () => {};
  try {
    const req = new Request(`https://x.test${path}`, { method, ...(auth ? { headers: { Authorization: `Bearer ${MCP_SECRET}` } } : {}) });
    const res = await worker.fetch(req, env, { waitUntil() {} });
    const text = await res.text();
    let body = null; try { body = JSON.parse(text); } catch { body = null; }
    const opening = Object.fromEntries(sqlite.prepare('SELECT id, opening_odds FROM regular_season_games').all().map(r => [r.id, r.opening_odds]));
    const spent = sqlite.prepare('SELECT used FROM odds_budget_site WHERE day = ? AND site = ?').get(DAY, 'archiveOddsBackfill')?.used ?? 0;
    return { status: res.status, body, asked, opening, spent };
  } finally { console.warn = w; console.log = l; console.error = e; }
}

const EPL = 'soccer_epl';
const keysAsked = (r) => r.asked.map(a => a.key).sort();
const nullIds = (r) => Object.entries(r.opening).filter(([, v]) => v === null).map(([k]) => k).sort();

check('fixture: the four sports have an Odds-API key and the vendor key of EPL is soccer_epl',
  archiveSportToOddsKey('EPL') === EPL && ['La Liga', 'MLS', 'NFL'].every(s => !!archiveSportToOddsKey(s)));

// ── B1. No filter: every keyed sport with a NULL row on the date is a fetch (the behaviour the filter exists to avoid) ──
{
  const r = await world('/archive/odds-backfill?date=2026-10-25');
  const want = ['EPL', 'La Liga', 'MLS', 'NFL'].map(archiveSportToOddsKey).sort();
  check('B1 unfiltered: one historical fetch for EACH of the four sports with a NULL row on the date', JSON.stringify(keysAsked(r)) === JSON.stringify(want), JSON.stringify(keysAsked(r)));
  check('B1 ...so the ledger moves by 120 (four sport-dates at 30)', r.spent === 120, String(r.spent));
}

// ── B2. ?sport=EPL: one fetch, 30 credits, only the EPL row of that date is touched ──
{
  const r = await world('/archive/odds-backfill?date=2026-10-25&sport=EPL');
  check('B2 sport=EPL: exactly one historical fetch, and it is soccer_epl at noon UTC of the date', JSON.stringify(r.asked) === JSON.stringify([{ key: EPL, snapshot: '2026-10-25T12:00:00Z' }]), JSON.stringify(r.asked));
  check('B2 ...the ledger moves by 30, not 120', r.spent === 30, String(r.spent));
  check('B2 ...the answer says what it was asked: 200, sport EPL, games_found 1, odds_populated 1', r.status === 200 && r.body.sport === 'EPL' && r.body.games_found === 1 && r.body.odds_populated === 1, JSON.stringify(r.body));
  const row = JSON.parse(r.opening['EPL_2026-10-25_cpalace_newcastle'] === null ? 'null' : r.opening['EPL_2026-10-25_cpalace_newcastle']);
  check('B2 ...the C Palace row was priced from the vendor\'s Crystal Palace event (the alias, end to end), with the preferred book and the snapshot\'s own time',
    row !== null && row.source === 'draftkings' && row.captured_at === '2026-10-25T12:00:00Z' && row.moneyline?.home === 160 && row.moneyline?.away === 175 && row.moneyline?.draw === 250, JSON.stringify(row));
  check('B2 ...every other row is exactly as it was: the other sports and the other date stay NULL, the priced row keeps its blob',
    JSON.stringify(nullIds(r)) === JSON.stringify(['EPL_2026-10-18_brighton_cpalace', 'LL_2026-10-25_realmadrid_barca', 'MLS_2026-10-25_columbus_miami', 'NFL_2026-10-25_chiefs_bills']) && r.opening['EPL_2026-10-25_arsenal_spurs'] === '{"already":"priced"}', JSON.stringify(nullIds(r)));
}

// ── B3. The filter selects the sport asked for, not EPL by default ──
{
  const r = await world('/archive/odds-backfill?date=2026-10-25&sport=La%20Liga');
  check('B3 sport=La Liga: one fetch, for La Liga\'s key, and the EPL row is not touched', JSON.stringify(keysAsked(r)) === JSON.stringify([archiveSportToOddsKey('La Liga')]) && r.opening['EPL_2026-10-25_cpalace_newcastle'] === null, JSON.stringify(keysAsked(r)));
}

// ── B4. A date with only the other EPL row: the filter does not read other dates ──
{
  const r = await world('/archive/odds-backfill?date=2026-10-18&sport=EPL');
  check('B4 another date, sport=EPL: one fetch with that date\'s snapshot, one game found, and the 10-25 rows are untouched',
    JSON.stringify(r.asked) === JSON.stringify([{ key: EPL, snapshot: '2026-10-18T12:00:00Z' }]) && r.body.games_found === 1 && r.opening['EPL_2026-10-25_cpalace_newcastle'] === null, JSON.stringify(r.asked));
}

// ── B5. Refused before any billed call ──
for (const [what, path] of [['a label the relay has no key for', '/archive/odds-backfill?date=2026-10-25&sport=Quidditch'], ['an empty value', '/archive/odds-backfill?date=2026-10-25&sport=']]) {
  const r = await world(path);
  check(`B5 ${what}: 400, no vendor call, nothing spent, no row written`, r.status === 400 && r.asked.length === 0 && r.spent === 0 && nullIds(r).length === 5, `status ${r.status}, ${r.asked.length} calls, spent ${r.spent}`);
}

// ── B6. The gate still comes first, with the filter present ──
{
  const r = await world('/archive/odds-backfill?date=2026-10-25&sport=EPL', { auth: false });
  check('B6 no credential with ?sport=EPL: 401, no vendor call, nothing spent', r.status === 401 && r.asked.length === 0 && r.spent === 0);
  const p = await world('/archive/odds-backfill?date=2026-10-25&sport=Quidditch', { auth: false });
  check('B6 no credential and a bad sport: still 401, not 400 (the gate is first)', p.status === 401);
}

// ── B7. The cron\'s call is unchanged: it passes no sport, so it still walks every sport ──
{
  const src = readFileSync(INDEX, 'utf8');
  check('B7 the daily catch-up call site passes no sport filter', /runOddsBackfillForDate\(env, oddsDate\)/.test(src));
}

let failed = 0;
for (const [name, ok, detail] of results) {
  if (!ok) { failed++; console.log(`FAIL  ${name}${detail ? '  [' + detail + ']' : ''}`); }
}
console.log(`${results.length - failed} of ${results.length} passed.`);
process.exit(failed ? 1 : 0);
