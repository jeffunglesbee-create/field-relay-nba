#!/usr/bin/env node
/**
 * GET /identity/mismatches joins a slate the way the relay's writers do, and says how many rows it saw.
 * docs/CC-CMD-2026-10-19-cfb-saturday-coverage-and-join-probe.md, Part B (B1, decided 2026-10-29).
 *
 * WHY THIS EXISTS. The route joined on resolved pair keys alone. On the real 80-game CFB slate of
 * 2026-09-12 that is 0 of 80, while the relay cron's join (indexOddsByPair + findOddsForRow with
 * start_time) solves 73 and the slate matcher the CI backfill runs solves 80. A diagnostic that
 * reports 0 where the writers get 73 sends its reader after a defect that is not there, and the
 * Saturday probe built on it could not pass on any date. It also had no denominator: the opening-line
 * cron prices a game the morning it is played, so a join that WORKS leaves no unpriced rows and the
 * old report read "d1_missing 0" for "all priced" and for "no rows" alike.
 *
 * THIS RUNS THE ROUTE. The real src/index.js default export, a node:sqlite D1 holding the real slate
 * (outbox/fixture-cfb-2026-09-12.json: 80 archive rows, 95 vendor events), a Map KV, a pinned clock
 * and a vendor stub that serves the fixture's events for the CFB key and nothing for the others.
 * The numbers asserted were MEASURED from that fixture with the production join before this file was
 * written, not read off the code:
 *   exact pair key (the old route) 0, findOddsForRow 73, matchSlate 80 (stage 1: 73, stage 2: 7),
 *   80 of the 95 events inside the slate window.
 *
 * THE WORLD IS NOT TIDY, on purpose. The same D1 holds the slate's rows of other sports, other dates
 * and the postseason table, because a query that stops filtering on one of them is exactly the defect
 * a one-sport, one-date world cannot show. The clock is the SUNDAY the delayed scheduled run starts on
 * while ?date= is the Saturday, because a route that reads the clock where the date belongs is invisible
 * when the two agree. The probe asks for four sports; so does this.
 *
 * INDEX_SRC points the worker elsewhere; scripts/mutate-identity-route-join.mjs uses it.
 */
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

register('data:text/javascript,' + encodeURIComponent(
  "export async function resolve(s, c, next) { if (s === '@cloudflare/puppeteer') return { url: 'data:text/javascript,export default {}', shortCircuit: true }; return next(s, c); }"));

const RealDate = Date;
const DELAYED_RUN = RealDate.parse('2026-09-13T02:51:00Z');       // a scheduled run's start, hours after its cron time
let clock = DELAYED_RUN;
class PinnedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(clock); }
  static now() { return clock; }
}
globalThis.Date = PinnedDate;

const MCP_SECRET = 'mcp-secret-for-the-check';
const INDEX = resolve(process.env.INDEX_SRC || 'src/index.js');
const worker = (await import(pathToFileURL(INDEX).href)).default;
const { indexOddsByPair, findOddsForRow } = await import(pathToFileURL(resolve('src/odds-join.js')).href);
const { slateWindow } = await import(pathToFileURL(resolve('src/odds-name-match.js')).href);
const { resolveTeamKey } = await import(pathToFileURL(resolve('src/identity-resolver.js')).href);
const fx = JSON.parse(readFileSync('outbox/fixture-cfb-2026-09-12.json', 'utf8'));

const results = [];
const check = (name, ok, detail = '') => { results.push([name, !!ok, detail]); };

// What the fixture says, from the production join itself and not from a constant: the ids the relay's join solves.
const idx0 = indexOddsByPair(fx.vendor);
const RELAY_IDS = fx.archive.filter(r => findOddsForRow(idx0, r.home, r.away, r.start_time)).map(r => r.id);
const OTHER_IDS = fx.archive.filter(r => !RELAY_IDS.includes(r.id)).map(r => r.id);
check('fixture: the relay\'s join solves 73 of the 80 and leaves 7 (measured before this check was written)', RELAY_IDS.length === 73 && OTHER_IDS.length === 7, `${RELAY_IDS.length} / ${OTHER_IDS.length}`);
const WINDOW = slateWindow(fx.vendor, fx.date).length;
check('fixture: 80 of the 95 events fall in the slate window', WINDOW === 80 && fx.vendor.length === 95, `${WINDOW} of ${fx.vendor.length}`);

const SCHEMA = `
CREATE TABLE regular_season_games (id TEXT PRIMARY KEY, sport TEXT, league TEXT, home TEXT, away TEXT, start_time TEXT, date TEXT,
  opening_odds TEXT, closing_odds TEXT, inplay_odds TEXT, finalized_at TEXT, home_score INTEGER, away_score INTEGER, series_key TEXT);
CREATE TABLE postseason_games (id TEXT PRIMARY KEY, sport TEXT, league TEXT, home TEXT, away TEXT, start_time TEXT, date TEXT,
  opening_odds TEXT, closing_odds TEXT, inplay_odds TEXT, finalized_at TEXT, home_score INTEGER, away_score INTEGER, series_key TEXT);
CREATE TABLE odds_budget (day TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE odds_budget_site (day TEXT NOT NULL, site TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, site));
CREATE TABLE odds_budget_month (month TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE odds_budget_gate (id INTEGER PRIMARY KEY, token TEXT NOT NULL);
CREATE TABLE odds_budget_refusal (day TEXT NOT NULL, scope TEXT NOT NULL, site TEXT NOT NULL, first_at TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, scope, site));
CREATE TABLE odds_reconcile_state (day TEXT NOT NULL, site TEXT NOT NULL, state TEXT NOT NULL, cache TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0, credits_kept INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, site, state, cache));
`;
const PRICE = '{"home":-110,"away":-110}';                                  // a line captured before kickoff
const LATE = '{"_kickoff":{"late_minutes":30},"home":-110,"away":-110}';    // a line captured 30 minutes after it
const BOOK = [{ key: 'book', markets: [] }];                                // enough of a bookmaker for extractOddsForGame

/**
 * One scenario: a fresh world, one request, the report.
 *   priced / pricedLate / pricedBad   ids given an opening_odds blob (a good one, a late one, text that is not JSON)
 *   finalized                         ids given finalized_at
 *   postseason                        ids moved to postseason_games
 *   events                            the CFB vendor payload (default: the fixture's 95 events)
 *   noise                             rows of other sports, dates and tables added to the same D1
 *   sports                            the ?sports= list
 *   feeds                             vendor payloads for the other sports, by Odds-API key
 */
async function report({ priced = [], pricedLate = [], pricedBad = [], finalized = [], postseason = [], events = fx.vendor, noise = true,
  sports = ['CFB'], feeds = {}, now = DELAYED_RUN, query = null, auth = true } = {}) {
  clock = now;
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  sqlite.prepare('INSERT INTO odds_budget VALUES (?, ?)').run('2026-09-13', 100);
  sqlite.prepare('INSERT INTO odds_budget_month VALUES (?, ?)').run('2026-09', 5000);
  const put = (table, r) => sqlite.prepare(`INSERT INTO ${table} (id, sport, league, home, away, start_time, date, opening_odds, finalized_at)
                                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(r.id, r.sport, r.sport, r.home, r.away, r.start_time, r.date, r.opening_odds ?? null, r.finalized_at ?? null);
  const blob = (id) => priced.includes(id) ? PRICE : pricedLate.includes(id) ? LATE : pricedBad.includes(id) ? 'not json at all' : null;
  for (const r of fx.archive) {
    put(postseason.includes(r.id) ? 'postseason_games' : 'regular_season_games',
      { ...r, sport: 'CFB', date: fx.date, opening_odds: blob(r.id), finalized_at: finalized.includes(r.id) ? '2026-09-13T04:00:00Z' : null });
  }
  if (noise) {
    // Other sports on the SAME date with the SAME team names (a shared index would join them), CFB on OTHER dates, both tables.
    for (const r of fx.archive.slice(0, 5)) put('regular_season_games', { ...r, id: `NFL_${r.id}`, sport: 'NFL', date: fx.date });
    for (const r of fx.archive.slice(5, 8)) put('regular_season_games', { ...r, id: `BUN_${r.id}`, sport: 'Bundesliga', date: fx.date });
    for (const r of fx.archive.slice(8, 12)) put('regular_season_games', { ...r, id: `OLD_${r.id}`, sport: 'CFB', date: '2026-09-05' });
    for (const r of fx.archive.slice(12, 15)) put('regular_season_games', { ...r, id: `NEW_${r.id}`, sport: 'CFB', date: '2026-09-19', opening_odds: PRICE });
    for (const r of fx.archive.slice(15, 17)) put('postseason_games', { ...r, id: `PSOLD_${r.id}`, sport: 'CFB', date: '2026-09-05' });
    for (const r of fx.archive.slice(17, 19)) put('postseason_games', { ...r, id: `PSNFL_${r.id}`, sport: 'NFL', date: fx.date });
  }
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
    asked.push(url);
    const key = /\/sports\/([a-z0-9_]+)\/odds/.exec(url)?.[1];
    const payload = key === 'americanfootball_ncaaf' ? events : (feeds[key] ?? []);
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'x-requests-last': '3', 'x-requests-remaining': '400000' } });
  };
  const env = { FIELD_JOURNALISM: KV, ARCHIVE_DB: D1, ODDS_API_KEY: 'k', RELAY_SHARED_SECRET: 's', FIELD_MCP_SECRET: MCP_SECRET };
  const w = console.warn, l = console.log, e = console.error;
  console.warn = console.log = console.error = () => {};
  try {
    const q = query ?? `date=${fx.date}&sports=${sports.join(',')}`;
    const req = new Request(`https://x.test/identity/mismatches?${q}`, auth ? { headers: { Authorization: `Bearer ${MCP_SECRET}` } } : {});
    const res = await worker.fetch(req, env, { waitUntil() {} });
    const text = await res.text();
    let body = null; try { body = JSON.parse(text); } catch { body = null; }
    return { status: res.status, asked, body, sports: (body && body.sports) || {}, entry: body && body.sports && body.sports[sports[0]] };
  } finally { clock = DELAYED_RUN; console.warn = w; console.log = l; console.error = e; }
}

// ── J1. The whole slate, nothing priced, on the delayed run's clock (Sunday), date the Saturday ──
{
  const r = await report();
  const e = r.entry || {};
  check('J1 the route answers 200 with the credential', r.status === 200 && !!r.entry, `status ${r.status}`);
  check('J1 the vendor is called once for the sport', r.asked.length === 1, `${r.asked.length} calls`);
  check('J1 odds_events is the 95 events served; odds_events_in_window the 80 in the slate window', e.odds_events === 95 && e.odds_events_in_window === 80, JSON.stringify({ ev: e.odds_events, win: e.odds_events_in_window }));
  check('J1 d1_rows 80, d1_priced 0, d1_priced_late 0, d1_missing 80: the other sport, other dates and the other table are NOT counted',
    e.d1_rows === 80 && e.d1_priced === 0 && e.d1_priced_late === 0 && e.d1_missing === 80, JSON.stringify({ rows: e.d1_rows, priced: e.d1_priced, late: e.d1_priced_late, missing: e.d1_missing }));
  check('J1 matched is 73 (the relay cron\'s join), not the 0 of the exact pair key', e.matched === 73, String(e.matched));
  check('J1 unmatched lists the other 7', Array.isArray(e.unmatched) && e.unmatched.length === 7, String(e.unmatched && e.unmatched.length));
  check('J1 the report adds up: matched + unmatched = d1_missing = d1_rows - d1_priced', e.matched + (e.unmatched || []).length === e.d1_missing && e.d1_rows - e.d1_priced === e.d1_missing);
  check('J1 slate_matched is 80 (what the CI backfill\'s matcher does with the same slate)', e.slate_matched === 80, String(e.slate_matched));
  check('J1 the fixture events carry no bookmaker, so the cron would write nothing: priceable 0', e.priceable === 0, String(e.priceable));
  const names = (e.unmatched || []).map(u => `${u.d1_home} v ${u.d1_away}`).sort();
  check('J1 the 7 unmatched are the initialism games the per-row join cannot read',
    JSON.stringify(names) === JSON.stringify(['Clemson v GA Southern', 'FAU v Navy', 'FIU v Buffalo', 'Georgia v Western KY', 'Marshall v MTSU', 'North Carolina v ETSU', 'Ohio v Jax State']), JSON.stringify(names));
  const ids = new Set(fx.archive.map(a => `${a.home}|${a.away}`));
  const u0 = (e.unmatched || [])[0] || {};
  check('J1 an unmatched row carries d1_home, d1_away and the resolved d1_key, exactly',
    typeof u0.d1_home === 'string' && u0.d1_key === `${resolveTeamKey(u0.d1_home)}|${resolveTeamKey(u0.d1_away)}` && ids.has(`${u0.d1_home}|${u0.d1_away}`), JSON.stringify(u0));
  check('J1 ...and its start_time and whether it is finalized', typeof u0.start_time === 'string' && u0.finalized === false, JSON.stringify(u0));
  const subs = (e.key_substituted || []).map(k => `${k.name}->${k.key}`).sort();
  check('J1 key_substituted keeps its meaning: the 6 CFB schools the sport-blind alias map sends to another sport\'s club (measured 2026-09-12)',
    JSON.stringify(subs) === JSON.stringify(['Charlotte->charlottefc', 'Cincinnati->fccincinnati', 'Colorado->coloradorapids', 'Houston->houstondynamofc', 'Liberty->newyorkliberty', 'Minnesota->minnesotaunitedfc']) && r.body.key_substituted === 6, JSON.stringify(subs));
  check('J1 odds_sample keeps its shape: six entries of odds_home, odds_away, key',
    Array.isArray(e.odds_sample) && e.odds_sample.length === 6 && e.odds_sample.every(s => s.odds_home && s.odds_away && String(s.key).includes('|')), JSON.stringify(e.odds_sample && e.odds_sample[0]));
  check('J1 the report keeps its top-level counters', r.body && r.body.probed === 1 && r.body.matched === 73 && r.body.unmatched === 7 && r.body.date === fx.date, JSON.stringify(r.body && { probed: r.body.probed, matched: r.body.matched, unmatched: r.body.unmatched, date: r.body.date }));
}

// ── J2. Priced rows leave d1_missing and enter d1_priced; late ones are counted; a blob that is not JSON does not break the read ──
{
  const ids = fx.archive.map(r => r.id);
  const e = (await report({ priced: ids.slice(0, 10), pricedLate: ids.slice(10, 13), pricedBad: ids.slice(13, 14), finalized: [ids[0], ids[10]] })).entry || {};
  check('J2 14 priced (10 good, 3 late, 1 not JSON; two of them finalized): d1_priced 14, d1_priced_late 3, d1_missing 66',
    e.d1_rows === 80 && e.d1_priced === 14 && e.d1_priced_late === 3 && e.d1_missing === 66, JSON.stringify({ rows: e.d1_rows, priced: e.d1_priced, late: e.d1_priced_late, missing: e.d1_missing }));
}

// ── J3. A slate the cron priced leaves nothing to join; and "no rows" is a different number ──
{
  const e = (await report({ priced: fx.archive.map(r => r.id) })).entry || {};
  check('J3 all 80 priced: d1_rows 80, d1_priced 80, d1_missing 0, matched 0', e.d1_rows === 80 && e.d1_priced === 80 && e.d1_missing === 0 && e.matched === 0, JSON.stringify({ rows: e.d1_rows, priced: e.d1_priced, missing: e.d1_missing, matched: e.matched }));
  check('J3 ...and the substitution pass reads only the UNPRICED rows: none left, none reported', Array.isArray(e.key_substituted) && e.key_substituted.length === 0, JSON.stringify(e.key_substituted));
  const none = (await report({ noise: false, sports: ['CFB'], events: fx.vendor, query: `date=2026-09-30&sports=CFB` })).entry || {};
  check('J3 a date with no rows: d1_rows 0, d1_priced 0 (numbers, not null) and no vendor event in its window', none.d1_rows === 0 && none.d1_priced === 0 && none.d1_missing === 0 && none.odds_events_in_window === 0 && none.odds_events === 95, JSON.stringify(none && { rows: none.d1_rows, priced: none.d1_priced, win: none.odds_events_in_window }));
}

// ── J4. The slate matcher decides the WHOLE slate: priced rows are what let it force an initialism by elimination ──
{
  const e = (await report({ priced: RELAY_IDS })).entry || {};
  check('J4 the 73 the relay\'s join solves are priced; the 7 initialisms are left: matched 0, unmatched 7',
    e.d1_priced === 73 && e.d1_missing === 7 && e.matched === 0 && (e.unmatched || []).length === 7, JSON.stringify({ priced: e.d1_priced, missing: e.d1_missing, matched: e.matched }));
  check('J4 ...and slate_matched is 7: the backfill would fill them, because it sees the priced rows too', e.slate_matched === 7, String(e.slate_matched));
}

// ── J5. A finalized row is flagged, so a game already played and gone from the feed is not read as a join fault ──
{
  const miss = fx.archive.find(r => r.home === 'North Carolina' && r.away === 'ETSU');
  const e = (await report({ finalized: [miss.id] })).entry || {};
  const u = (e.unmatched || []).find(x => x.d1_home === 'North Carolina');
  const other = (e.unmatched || []).find(x => x.d1_home === 'FAU');
  check('J5 a finalized unmatched row says finalized: true, and the others false', !!u && u.finalized === true && !!other && other.finalized === false, JSON.stringify({ u, other }));
}

// ── J6. The kickoff window is the production join's: same clubs, a different game, not a match ──
{
  const shifted = fx.vendor.map(ev => ev.home_team.startsWith('East Carolina') ? { ...ev, commence_time: '2026-09-19T16:00:00Z' } : ev);
  const ecu = fx.archive.find(r => r.home === 'East Carolina');
  const e = (await report({ events: shifted })).entry || {};
  const hit = (e.unmatched || []).some(u => u.d1_home === ecu.home && u.d1_away === ecu.away);
  check('J6 the only East Carolina event is a week away: the row is unmatched (kickoff window)', hit && e.matched === 72, JSON.stringify({ hit, matched: e.matched }));
}

// ── J7. priceable: joined is not priced. What the cron would write if it ran now ──
{
  const priced = fx.vendor.map(ev => ({ ...ev, bookmakers: BOOK }));
  const before = RealDate.parse('2026-09-12T11:55:00Z');
  const e1 = (await report({ events: priced, now: before })).entry || {};
  check('J7 with a price on every event and the clock before any kickoff, all 73 joined rows are priceable', e1.matched === 73 && e1.priceable === 73, JSON.stringify({ matched: e1.matched, priceable: e1.priceable }));
  const noBook = fx.vendor.map((ev, i) => i % 2 === 0 ? { ...ev, bookmakers: BOOK } : { ...ev, bookmakers: [] });
  const e2 = (await report({ events: noBook, now: before })).entry || {};
  const expect2 = fx.archive.filter(r => RELAY_IDS.includes(r.id)).filter(r => {
    const ev = findOddsForRow(indexOddsByPair(noBook), r.home, r.away, r.start_time);
    return (ev.bookmakers || []).length > 0;
  }).length;
  check('J7 an event with no bookmaker joins but cannot be priced', e2.matched === 73 && e2.priceable === expect2 && expect2 > 0 && expect2 < 73, JSON.stringify({ matched: e2.matched, priceable: e2.priceable, expect: expect2 }));
  const ids = fx.archive.map(r => r.id);
  const fin = RELAY_IDS.slice(0, 6);
  const e3 = (await report({ events: priced, now: before, finalized: fin })).entry || {};
  check('J7 a finalized row joins but the cron would not write it: 73 joined, 67 priceable', e3.matched === 73 && e3.priceable === 67, JSON.stringify({ matched: e3.matched, priceable: e3.priceable }));
  const mid = RealDate.parse('2026-09-12T17:00:00Z');
  const e4 = (await report({ events: priced, now: mid })).entry || {};
  const idx = indexOddsByPair(priced);
  const expect4 = fx.archive.filter(r => RELAY_IDS.includes(r.id)).filter(r => {
    const ev = findOddsForRow(idx, r.home, r.away, r.start_time);
    // STRICTLY before: a capture at the kickoff instant is late (kickoffMark: lateMs 0 is not < 0); three rows kick off at exactly 17:00Z.
    return mid < Math.min(RealDate.parse(r.start_time), RealDate.parse(ev.commence_time));
  }).length;
  check('J7 once games have started the cron refuses their line (by either clock, and at the kickoff instant itself): priceable is the rows strictly ahead of the clock',
    e4.matched === 73 && e4.priceable === expect4 && expect4 > 0 && expect4 < 73, JSON.stringify({ matched: e4.matched, priceable: e4.priceable, expect: expect4, ids: ids.length }));
}

// ── J7b. The row's own kickoff counts even when the vendor says the game starts later ──
{
  const later = fx.vendor.map(ev => ({ ...ev, bookmakers: BOOK, commence_time: new RealDate(RealDate.parse(ev.commence_time) + 30 * 60e3).toISOString().replace('.000Z', 'Z') }));
  const mid2 = RealDate.parse('2026-09-12T17:10:00Z');
  const e = (await report({ events: later, now: mid2 })).entry || {};
  const idxL = indexOddsByPair(later);
  const joined = fx.archive.filter(r => findOddsForRow(idxL, r.home, r.away, r.start_time));
  const expect = joined.filter(r => mid2 < RealDate.parse(r.start_time)
    && mid2 < RealDate.parse(findOddsForRow(idxL, r.home, r.away, r.start_time).commence_time)).length;
  check('J7b the vendor says kickoff is 30 minutes later than the archive: the cron still refuses a row whose OWN kickoff has passed',
    e.matched === joined.length && e.priceable === expect && expect < joined.length && expect > 0, JSON.stringify({ matched: e.matched, joined: joined.length, priceable: e.priceable, expect }));
}

// ── J8. Four sports in one request, as the probe makes it: nothing is shared between them ──
{
  const r = await report({ sports: ['CFB', 'NFL', 'Bundesliga', 'MLS'] });
  const cfb = r.sports.CFB || {}, nfl = r.sports.NFL || {}, bun = r.sports.Bundesliga || {}, mls = r.sports.MLS || {};
  check('J8 four vendor calls, one per sport', r.asked.length === 4, `${r.asked.length} calls`);
  check('J8 CFB is unchanged by the other three: 80 rows, 73 matched, 7 unmatched', cfb.d1_rows === 80 && cfb.matched === 73 && (cfb.unmatched || []).length === 7, JSON.stringify({ rows: cfb.d1_rows, matched: cfb.matched }));
  check('J8 NFL counts only its own 5 + 2 rows (both tables) and joins none of them against the CFB feed (its own feed is empty)',
    nfl.d1_rows === 7 && nfl.d1_missing === 7 && nfl.matched === 0 && nfl.odds_events === 0, JSON.stringify({ rows: nfl.d1_rows, missing: nfl.d1_missing, matched: nfl.matched, ev: nfl.odds_events }));
  check('J8 Bundesliga counts only its own 3 rows and MLS none', bun.d1_rows === 3 && mls.d1_rows === 0 && mls.d1_missing === 0, JSON.stringify({ bun: bun.d1_rows, mls: mls.d1_rows }));
  check('J8 the top-level counters add the sports up', r.body.probed === 4 && r.body.matched === 73 && r.body.unmatched === 7 + 7 + 3, JSON.stringify({ probed: r.body.probed, matched: r.body.matched, unmatched: r.body.unmatched }));
}

// ── J9. The postseason table is part of the slate (a bowl game is a postseason row) ──
{
  const bowl = fx.archive.slice(20, 23).map(r => r.id);
  const e = (await report({ postseason: bowl, priced: bowl.slice(0, 1) })).entry || {};
  check('J9 three rows moved to postseason_games are still counted: d1_rows 80, d1_priced 1, d1_missing 79', e.d1_rows === 80 && e.d1_priced === 1 && e.d1_missing === 79, JSON.stringify({ rows: e.d1_rows, priced: e.d1_priced, missing: e.d1_missing }));
}

// ── J10. The date is required and checked before anything is billed ──
{
  for (const [what, query] of [['missing', `sports=CFB`], ['not a date', 'date=today&sports=CFB'], ['unpadded', 'date=2026-9-12&sports=CFB'], ['with a suffix', `date=${fx.date}x&sports=CFB`]]) {
    const r = await report({ query });
    check(`J10 a ?date= that is ${what}: 400, and the vendor is never called`, r.status === 400 && r.asked.length === 0 && r.body && r.body.ok === false, `status ${r.status}, ${r.asked.length} calls`);
  }
}

// ── J11. The route is gated: no credential, no vendor call ──
{
  const r = await report({ auth: false });
  check('J11 without the credential: 401 and the vendor is never called', r.status === 401 && r.asked.length === 0, `status ${r.status}, ${r.asked.length} calls`);
}

let failed = 0;
for (const [name, ok, detail] of results) {
  if (!ok) { failed++; console.log(`FAIL  ${name}${detail ? '  [' + detail + ']' : ''}`); }
}
console.log(`ran the real worker on the 80-row CFB slate of ${fx.date} (clock the Sunday after it, other sports, dates and tables in the same D1): relay join 73, slate matcher 80, exact pair key 0 (measured).`);
console.log(`${results.length - failed} of ${results.length} passed.`);
process.exit(failed ? 1 : 0);
