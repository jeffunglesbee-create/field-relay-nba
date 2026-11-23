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
 * ?snapshot=HH:MM (B8) moves the vendor snapshot earlier for a match that kicked off before noon. The case it exists for is real: Liverpool v Chelsea,
 * 2026-05-09, kicked off at 11:30Z (ESPN, read through the relay's /v2/games), 25 minutes before the route's 11:55Z noon snapshot, so the late-snapshot
 * guard refused its line; the four other matches of that date started at 14:00Z or 16:30Z and were priced.
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
const { resolveTeamKey } = await import(pathToFileURL(resolve('src/identity-resolver.js')).href);
// The runner's price per call is a copy of what the relay charges; this check ties the two (B2).
const { CREDITS_PER_CALL } = await import(pathToFileURL(resolve('scripts/run-odds-backfill-capped.mjs')).href);
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

// Real-shaped Odds API events: the vendor's full names, one preferred bookmaker, a three-way soccer h2h. A noon snapshot carries many
// events across several days, so the target is NOT alone: decoys share one team with it (Crystal Palace v Liverpool, Newcastle United v
// Everton), repeat the pair reversed a week later, and carry DIFFERENT prices, so a mis-pairing is a wrong number, not a pass.
const ev = (id, home, away, commence, h, a, d) => ({
  id, sport_key: 'soccer_epl', home_team: home, away_team: away, commence_time: commence,
  bookmakers: [{ key: 'draftkings', title: 'DraftKings', markets: [{ key: 'h2h', outcomes: [
    { name: home, price: h }, { name: away, price: a }, { name: 'Draw', price: d }] }] }],
});
const EPL_EVENT = ev('ev1', 'Crystal Palace', 'Newcastle United', '2026-10-25T14:00:00Z', 160, 175, 250);
const EPL_EVENTS = [
  ev('d1', 'Crystal Palace', 'Liverpool', '2026-10-31T15:00:00Z', 900, 101, 801),
  ev('d2', 'Newcastle United', 'Crystal Palace', '2026-11-01T14:00:00Z', 902, 103, 803),   // the pair reversed, a week later
  EPL_EVENT,
  ev('d3', 'Newcastle United', 'Everton', '2026-10-26T19:00:00Z', 904, 105, 805),
  ev('ps1', 'Everton', 'Liverpool', '2026-10-25T16:30:00Z', 210, 140, 300),                // the postseason EPL row's game
];
const MAY_EVENTS = [
  ev('m1', 'Liverpool', 'Chelsea', '2026-05-09T11:30:00Z', 150, 190, 270),
  ev('m2', 'Brighton and Hove Albion', 'Wolverhampton Wanderers', '2026-05-09T14:00:00Z', -360, 900, 500),
];

/** One scenario: a fresh world, one request, then the readings. */
async function world(path, { auth = true, method = 'GET', siteUsed = {}, servedAt = null, may = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  sqlite.prepare('INSERT INTO odds_budget VALUES (?, ?)').run(DAY, 100);
  sqlite.prepare('INSERT INTO odds_budget_month VALUES (?, ?)').run(MONTH, 5000);
  for (const [site, used] of Object.entries(siteUsed)) sqlite.prepare('INSERT INTO odds_budget_site VALUES (?, ?, ?)').run(DAY, site, used);
  // A postseason NFL row on the same date: the filter must cover BOTH tables, or this one would be fetched under sport=EPL.
  sqlite.prepare(`INSERT INTO postseason_games (id, sport, league, home, away, start_time, date, opening_odds, finalized_at, series_key)
                  VALUES ('NFL_PS_2026-10-25_a_b', 'NFL', 'NFL', 'Team A', 'Team B', '2026-10-25T20:00Z', '2026-10-25', NULL, '2026-10-26T00:00:00Z', 'ps')`).run();
  // A postseason row OF THE REQUESTED SPORT, with a league unlike its sport: the postseason filter must select it, by sport.
  sqlite.prepare(`INSERT INTO postseason_games (id, sport, league, home, away, start_time, date, opening_odds, finalized_at, series_key)
                  VALUES ('EPL_PS_2026-10-25_everton_liverpool', 'EPL', 'Playoff', 'Everton', 'Liverpool', '2026-10-25T16:30Z', '2026-10-25', NULL, '2026-10-26T00:00:00Z', 'ps')`).run();
  // The 2026-05-09 rows of the June seed: no start_time, never finalized, no odds (docs/CC-CMD-2026-11-22-epl-june-seed-rows-unpriced.md).
  if (may) for (const [id, h, a] of [['2026-05-09-epl-liverp-chelse', 'Liverpool', 'Chelsea'], ['2026-05-09-epl-bright-wolver', 'Brighton & Hove Albion', 'Wolverhampton Wanderers']])
    sqlite.prepare(`INSERT INTO regular_season_games (id, sport, league, home, away, start_time, date, opening_odds, finalized_at) VALUES (?, 'EPL', 'Premier League – Matchweek 36', ?, ?, NULL, '2026-05-09', NULL, NULL)`).run(id, h, a);
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
    const data = m?.[1] === 'soccer_epl' && m[2].startsWith('2026-10-25') ? EPL_EVENTS : (m?.[1] === 'soccer_epl' && m[2].startsWith('2026-05-09') ? MAY_EVENTS : []);
    return new Response(JSON.stringify({ timestamp: servedAt ?? m?.[2] ?? null, data }), { status: 200, headers: { 'x-requests-last': '30', 'x-requests-remaining': '400000' } });
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
    const psOpening = Object.fromEntries(sqlite.prepare('SELECT id, opening_odds FROM postseason_games').all().map(r => [r.id, r.opening_odds]));
    const spent = sqlite.prepare('SELECT used FROM odds_budget_site WHERE day = ? AND site = ?').get(DAY, 'archiveOddsBackfill')?.used ?? 0;
    return { status: res.status, body, asked, opening, psOpening, spent };
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

// ── B2. ?sport=EPL: one fetch, 30 credits, only the EPL rows of that date are touched ──
{
  const r = await world('/archive/odds-backfill?date=2026-10-25&sport=EPL');
  check('B2 sport=EPL: exactly one historical fetch, and it is soccer_epl at noon UTC of the date', JSON.stringify(r.asked) === JSON.stringify([{ key: EPL, snapshot: '2026-10-25T12:00:00Z' }]), JSON.stringify(r.asked));
  check('B2 ...the ledger moves by 30, not 120, and 30 is what the runner prices a call at', r.spent === 30 && r.spent === CREDITS_PER_CALL, String(r.spent));
  check('B2 ...the answer says what it was asked: 200, sport EPL, games_found 2 (one regular row, one postseason row), odds_populated 2', r.status === 200 && r.body.sport === 'EPL' && r.body.games_found === 2 && r.body.odds_populated === 2 && r.body.guarded === undefined, JSON.stringify(r.body));
  const row = JSON.parse(r.opening['EPL_2026-10-25_cpalace_newcastle'] === null ? 'null' : r.opening['EPL_2026-10-25_cpalace_newcastle']);
  // Not "the alias": since f4bea6af (2026-10-24) a row WITH a kickoff also joins on name tokens, so 'C Palace' joins 'Crystal Palace' with or
  // without the identity alias. What this proves is the outcome the repair needs, against a vendor slate with decoys and different prices.
  check('B2 ...the C Palace row was priced from ITS event (Crystal Palace v Newcastle United: 160/175/250), not a decoy that shares a team or repeats the pair reversed, with the preferred book and the snapshot\'s own time',
    row !== null && row.source === 'draftkings' && row.captured_at === '2026-10-25T12:00:00Z' && row.moneyline?.home === 160 && row.moneyline?.away === 175 && row.moneyline?.draw === 250, JSON.stringify(row));
  const ps = JSON.parse(r.psOpening['EPL_PS_2026-10-25_everton_liverpool'] === null ? 'null' : r.psOpening['EPL_PS_2026-10-25_everton_liverpool']);
  check('B2 ...the postseason EPL row (a league unlike its sport) was priced from ITS event (Everton v Liverpool: 210/140/300) and the postseason NFL row of the same date was not touched',
    ps !== null && ps.moneyline?.home === 210 && ps.moneyline?.away === 140 && ps.moneyline?.draw === 300 && r.psOpening['NFL_PS_2026-10-25_a_b'] === null, JSON.stringify(ps));
  check('B2 ...every other row is exactly as it was: the other sports and the other date stay NULL, the priced row keeps its blob',
    JSON.stringify(nullIds(r)) === JSON.stringify(['EPL_2026-10-18_brighton_cpalace', 'LL_2026-10-25_realmadrid_barca', 'MLS_2026-10-25_columbus_miami', 'NFL_2026-10-25_chiefs_bills']) && r.opening['EPL_2026-10-25_arsenal_spurs'] === '{"already":"priced"}', JSON.stringify(nullIds(r)));
  // The identity claims the CC-CMD makes about the two spellings, each made to fail by deleting its alias (Rule 90).
  check('B2 the alias: the resolver gives C Palace and Crystal Palace one key', resolveTeamKey('C Palace') === resolveTeamKey('Crystal Palace') && resolveTeamKey('C Palace') !== undefined);
  check('B2 the alias: the resolver gives Coventry and Coventry City one key (the opening fixture, 2026-08-21)', resolveTeamKey('Coventry') === resolveTeamKey('Coventry City') && resolveTeamKey('Coventry') !== undefined);
}

// ── B2b. The same request by POST; a lower-case label is the same sport and is echoed as typed ──
{
  const r = await world('/archive/odds-backfill?date=2026-10-25&sport=EPL', { method: 'POST' });
  check('B2b POST with sport=EPL behaves as GET: one fetch, 30 credits, sport echoed', r.status === 200 && r.body.sport === 'EPL' && r.asked.length === 1 && r.spent === 30);
  const l = await world('/archive/odds-backfill?date=2026-10-25&sport=epl');
  check('B2b sport=epl: the same one fetch and the same two rows priced, the label echoed as typed (the filter, the lookup and the bucketing all ignore case)',
    l.status === 200 && l.body.sport === 'epl' && l.body.games_found === 2 && l.body.odds_populated === 2 && l.asked.length === 1, JSON.stringify(l.body));
}

// ── B2c. A date with no rows of the sport: no fetch, no charge, and the answer STILL says which sport it covered ──
{
  const r = await world('/archive/odds-backfill?date=2026-10-25&sport=Bundesliga');
  check('B2c a sport with no NULL rows on the date: 200, games_found 0, no vendor call, nothing spent, and `sport` echoed (a caller checks it before trusting the counts)',
    r.status === 200 && r.body.games_found === 0 && r.body.sport === 'Bundesliga' && r.asked.length === 0 && r.spent === 0, JSON.stringify(r.body));
}

// ── B2d. The credit guard declines the fetch: nothing spent, and the answer says so (`guarded`), it does not read as a spend ──
{
  const r = await world('/archive/odds-backfill?date=2026-10-25&sport=EPL', { siteUsed: { archiveOddsBackfill: 271 } });
  check('B2d label cap reached (271 of 300 used, a call costs 30): 200, no vendor call, the ledger unmoved, guarded 1, nothing populated, the rows still NULL',
    r.status === 200 && r.asked.length === 0 && r.spent === 271 && r.body.guarded === 1 && r.body.odds_populated === 0 && r.body.sport === 'EPL' && r.opening['EPL_2026-10-25_cpalace_newcastle'] === null, JSON.stringify(r.body));
}

// ── B2e. A snapshot the vendor serves AFTER kickoff prices nothing: the line is not an opener ──
{
  const r = await world('/archive/odds-backfill?date=2026-10-25&sport=EPL', { servedAt: '2026-10-25T15:00:00Z' });
  check('B2e vendor serves a snapshot at 15:00Z, after the 14:00Z kickoff of the C Palace row: that row stays NULL (the 16:30Z postseason row is still priced)',
    r.opening['EPL_2026-10-25_cpalace_newcastle'] === null && r.psOpening['EPL_PS_2026-10-25_everton_liverpool'] !== null && r.body.odds_populated === 1, JSON.stringify(r.body));
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
for (const [what, path] of [['a label the relay has no key for', '/archive/odds-backfill?date=2026-10-25&sport=Quidditch'], ['an empty value', '/archive/odds-backfill?date=2026-10-25&sport='],
  ['the name of an Object property (constructor)', '/archive/odds-backfill?date=2026-10-25&sport=constructor'], ['__proto__', '/archive/odds-backfill?date=2026-10-25&sport=__proto__'],
  ['the runner\'s preflight label', '/archive/odds-backfill?date=2099-01-01&sport=__filter_preflight__']]) {
  const r = await world(path);
  check(`B5 ${what}: 400, no vendor call, nothing spent, no row written`, r.status === 400 && r.asked.length === 0 && r.spent === 0 && nullIds(r).length === 5 && /unknown \?sport=/.test(r.body?.error ?? ''), `status ${r.status}, ${r.asked.length} calls, spent ${r.spent}`);
}

// ── B6. The gate still comes first, with the filter present ──
{
  const r = await world('/archive/odds-backfill?date=2026-10-25&sport=EPL', { auth: false });
  check('B6 no credential with ?sport=EPL: 401, no vendor call, nothing spent', r.status === 401 && r.asked.length === 0 && r.spent === 0);
  const p = await world('/archive/odds-backfill?date=2026-10-25&sport=Quidditch', { auth: false });
  check('B6 no credential and a bad sport: still 401, not 400 (the gate is first)', p.status === 401);
}

// ── B8. ?snapshot=HH:MM: an earlier time of day for a match that kicked off before noon ──
{
  const MAY = '/archive/odds-backfill?date=2026-05-09&sport=EPL';
  const L = '2026-05-09-epl-liverp-chelse', B = '2026-05-09-epl-bright-wolver';
  const d = await world(MAY, { may: true });
  check('B8 default snapshot (noon): one fetch at 12:00Z, Brighton v Wolves (14:00Z) priced, Liverpool v Chelsea (11:30Z) refused as taken after kickoff: games_found 2, odds_populated 1, odds_skipped 1, and NO `snapshot` key in the answer',
    JSON.stringify(d.asked) === JSON.stringify([{ key: EPL, snapshot: '2026-05-09T12:00:00Z' }]) && d.body.games_found === 2 && d.body.odds_populated === 1 && d.body.odds_skipped === 1
    && d.opening[B] !== null && d.opening[L] === null && !('snapshot' in d.body), JSON.stringify(d.body));
  const e = await world(MAY + '&snapshot=09:30', { may: true });
  const lrow = e.opening[L] === null ? null : JSON.parse(e.opening[L]);
  check('B8 snapshot=09:30: ONE fetch asking for 09:30Z, 30 credits, both rows priced, the answer echoes `snapshot` and `sport`, and Liverpool v Chelsea carries its own event\'s three-way price (150/190/270) with captured_at 09:30Z',
    JSON.stringify(e.asked) === JSON.stringify([{ key: EPL, snapshot: '2026-05-09T09:30:00Z' }]) && e.spent === 30 && e.body.snapshot === '09:30' && e.body.sport === 'EPL' && e.body.odds_populated === 2 && e.body.odds_skipped === 0
    && lrow !== null && lrow.moneyline?.home === 150 && lrow.moneyline?.draw === 270 && lrow.moneyline?.away === 190 && lrow.captured_at === '2026-05-09T09:30:00Z', JSON.stringify(e.body));
  const f = await world(MAY + '&snapshot=11:45', { may: true });
  check('B8 snapshot=11:45 (after the 11:30Z kickoff): the guard still refuses Liverpool v Chelsea, so a time that is too late prices nothing and costs the same 30 credits',
    f.asked.length === 1 && f.spent === 30 && f.opening[L] === null && f.opening[B] !== null && f.body.odds_populated === 1 && f.body.snapshot === '11:45', JSON.stringify(f.body));
  const g = await world(MAY + '&snapshot=12:00', { may: true });
  check('B8 snapshot=12:00 given explicitly is the default: the same noon fetch, and no `snapshot` key (the answer of every earlier run is unchanged)', JSON.stringify(g.asked) === JSON.stringify([{ key: EPL, snapshot: '2026-05-09T12:00:00Z' }]) && !('snapshot' in g.body));
  for (const bad of ['25:00', '9:30', '09:30:00', '09:60', '', 'noon', '24:00', '09:30x', 'x09:30', '09:30\n', ' 09:30', '+09:30', '-1:30', '0930', '09-30', '9:5', '30:00']) {
    const r = await world(MAY + '&snapshot=' + encodeURIComponent(bad), { may: true });
    check(`B8 snapshot=${JSON.stringify(bad)}: 400, no vendor call, nothing spent, no row written`, r.status === 400 && r.asked.length === 0 && r.spent === 0 && /bad \?snapshot=/.test(r.body?.error ?? '') && r.opening[L] === null, `status ${r.status}, ${r.asked.length} calls`);
  }
  for (const good of ['00:00', '23:59', '09:05']) {
    const r = await world(MAY + '&snapshot=' + encodeURIComponent(good), { may: true });
    check(`B8 snapshot=${good} (a valid time of day, the edges included): one fetch asking for ${good}Z and the answer echoes it`, r.status === 200 && r.asked.length === 1 && r.asked[0].snapshot === `2026-05-09T${good}:00Z` && r.body.snapshot === good, JSON.stringify(r.asked));
  }
  const u = await world(MAY + '&snapshot=25:00', { may: true, auth: false });
  check('B8 no credential and a bad snapshot: still 401 (the gate is first)', u.status === 401);
  const z = await world('/archive/odds-backfill?date=2026-10-25&sport=Bundesliga&snapshot=09:30');
  check('B8 a date with no rows of the sport and a snapshot: 200, no vendor call, nothing spent, and BOTH `sport` and `snapshot` echoed', z.status === 200 && z.body.games_found === 0 && z.body.sport === 'Bundesliga' && z.body.snapshot === '09:30' && z.asked.length === 0 && z.spent === 0, JSON.stringify(z.body));
  const o = await world('/archive/odds-backfill?date=2026-10-25&snapshot=09:30');
  check('B8 a snapshot with no sport filter reaches every sport\'s fetch (the four sports, each at 09:30Z)', o.asked.length === 4 && o.asked.every(a => a.snapshot === '2026-10-25T09:30:00Z'), JSON.stringify(o.asked));
}

// ── B7. The cron\'s call is unchanged: it passes no sport, so it still walks every sport ──
{
  const src = readFileSync(INDEX, 'utf8');
  check('B7 the daily catch-up call site passes no sport filter', /runOddsBackfillForDate\(env, oddsDate\)/.test(src));
  check('B7 ...and the function\'s own default is no filter (a default of one sport would narrow the cron while its call text stayed the same)',
    /async function runOddsBackfillForDate\(env, isoDate, site = 'fetchSportOddsHistorical', onlySport = null, snapshotTime = ODDS_HIST_SNAPSHOT_DEFAULT\) \{/.test(src));
  check('B7 ...and the default snapshot is noon (B2 proves the BACKFILL route\'s request on the wire; it always hands snapshotTime down, so it cannot prove the next two)', /const ODDS_HIST_SNAPSHOT_DEFAULT = '12:00';/.test(src));
  check('B7 ...and fetchSportOddsHistorical\'s OWN default is that constant: /archive/game calls it with four arguments and relies on it, and no behavioural scenario here reaches that path (a mutant moving it to 09:30 stayed green until this assertion, review 2026-11-23)',
    /async function fetchSportOddsHistorical\(env, sportKey, isoDate, site, snapshotTime = ODDS_HIST_SNAPSHOT_DEFAULT\) \{/.test(src) && /fetchSportOddsHistorical\(env, oddsSportKey, date, 'archiveGameClosing'\)/.test(src));
}

let failed = 0;
for (const [name, ok, detail] of results) {
  if (!ok) { failed++; console.log(`FAIL  ${name}${detail ? '  [' + detail + ']' : ''}`); }
}
console.log(`${results.length - failed} of ${results.length} passed.`);
process.exit(failed ? 1 : 0);
