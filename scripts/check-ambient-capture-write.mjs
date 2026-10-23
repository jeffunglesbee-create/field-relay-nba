#!/usr/bin/env node
// AmbientDO's closing-line capture writes a verified line to the right row,
// and buys nothing it cannot write. docs/CC-CMD-2026-10-22-closing-capture-
// before-kickoff.md.
//
// MEASURED BEFORE IT (TASK 0): the capture had written 2 rows since 2026-09-01
// against thousands of billed calls. It found its row by a team name inside the
// id, and archive ids became `<League>_<ET date>_e<espnEventId>`. The one
// October write went to an MLS skeleton row ('lafc' inside its id), and in
// August a Ligue 1 line reached an MLB row ('rangers' contains 'angers'). It
// read the UTC date while the archive dates rows by the ET day. And it fired
// on the pre-to-live transition, so every line it did write was late.
//
// This runs the real AmbientDO poll, lookup, purchase and write against:
//   - a fake ARCHIVE_DB that evaluates the capture's own SQL over in-memory
//     rows shaped like the real ones, refuses a bind count that does not match
//     the placeholders (as D1 does, error 7500), and answers any other query
//     shape with every row of the table, unfiltered, so a dropped predicate
//     shows in behaviour;
//   - a fake relay whose boards are keyed by the ET date of each kickoff, as
//     the relay's are (a 00:30Z kickoff is on the previous day's board);
//   - a fake vendor. A billed call is a fetch of its /odds URL;
//   - for W22 only, the real odds ledger: chargeOdds's own SQL run on
//     node:sqlite, as scripts/check-monthly-atomic.mjs runs it.
//
//   node scripts/check-ambient-capture-write.mjs            # self-test
//   node scripts/check-ambient-capture-write.mjs --mutate   # Rule 90

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../src/ambient-do.js');
const MODULE = process.env.AMBIENT_MODULE || SRC;

const RealDate = Date;
let clock = 0;
class PinnedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(clock); }
  static now() { return clock; }
}
const etDate = (iso) => new RealDate(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const tick = () => new Promise(r => setTimeout(r, 2));   // D1 and the network yield, as the runtime does

// ── the fake archive ────────────────────────────────────────────────────────
function makeDb(world) {
  const run = (sql, params) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    const holes = (s.match(/\?/g) || []).length;
    if (holes !== params.length) throw new Error('D1_ERROR: Wrong number of parameter bindings for SQL query.: SQLITE_ERROR');
    // The real ledger (W22): every statement naming an odds_* table runs on
    // SQLite, a misspelt one included, so it fails as D1 would ("no such
    // table") instead of falling through to the empty answer below.
    if (world.sqlite && /\bodds_\w+/.test(s)) {
      const st = world.sqlite.prepare(s);
      if (/RETURNING/.test(s)) return { rows: st.all(...params), changes: 0 };
      return { rows: [], changes: Number(st.run(...params).changes) };
    }
    let m;
    if ((m = s.match(/^SELECT id, start_time, espn_event_id, home, away FROM (\w+) WHERE sport = \? AND date IN \(([?, ]+)\) AND start_time IS NOT NULL AND closing_odds IS NULL$/))) {
      if (world.d1Fail) throw new Error('D1_ERROR: network connection lost');
      world.lookups++;
      const [sport, ...days] = params;
      return { rows: (world.tables[m[1]] || []).filter(r => r.sport === sport && days.includes(r.date)
        && r.start_time != null && r.closing_odds == null)
        .map(({ id, start_time, espn_event_id, home, away }) => ({ id, start_time, espn_event_id, home, away })) };
    }
    if (/^SELECT .* FROM (regular_season_games|postseason_games)/.test(s)) {
      if (world.d1Fail) throw new Error('D1_ERROR: network connection lost');
      world.lookups++;
      world.otherSelects.push(s);
      return { rows: [...(world.tables[s.match(/FROM (\w+)/)[1]] || [])] };
    }
    if ((m = s.match(/^UPDATE (\w+) SET closing_odds = \? WHERE id = \? AND closing_odds IS NULL$/))) {
      const row = (world.tables[m[1]] || []).find(r => r.id === params[1] && r.closing_odds == null);
      if (row) { row.closing_odds = params[0]; world.updates.push(`${m[1]}/${row.id}`); }
      return { rows: [], changes: row ? 1 : 0 };
    }
    if (/^INSERT INTO change_log/.test(s)) { world.changeLog.push(params[0]); return { rows: [], changes: 1 }; }
    // The odds ledger, for a scenario that sets world.ledger: the day and month
    // charges return their row only when the charge fits, as D1 does with
    // RETURNING. Every other scenario runs without FIELD_JOURNALISM, where the
    // guard opens before it reaches the ledger.
    if (world.ledger && /^UPDATE odds_budget(_month)? SET used = used \+ \? .*RETURNING used$/.test(s)) {
      world.ledger.charges++;
      return { rows: world.ledger.full ? [] : [{ used: 3 }], changes: world.ledger.full ? 0 : 1 };
    }
    return { rows: [], changes: 0 };   // the odds-budget tally's DDL and writes: not under test
  };
  const stmt = (sql, params = []) => ({
    bind: (...p) => stmt(sql, p),
    all: async () => { await tick(); return { results: run(sql, params).rows }; },
    run: async () => { await tick(); const r = run(sql, params); return { success: true, results: r.rows, meta: { changes: r.changes } }; },
    runNow: () => { const r = run(sql, params); return { success: true, results: r.rows, meta: { changes: r.changes } }; },
    first: async () => { await tick(); return run(sql, params).rows[0] ?? null; },
  });
  // With the real ledger a batch is one transaction, as D1's is.
  const batch = async (list) => {
    if (!world.sqlite) return Promise.all(list.map(x => x.run()));
    await tick();
    world.sqlite.exec('BEGIN');
    try { const out = list.map(x => x.runNow()); world.sqlite.exec('COMMIT'); return out; }
    catch (e) { world.sqlite.exec('ROLLBACK'); throw e; }
  };
  return { prepare: (sql) => stmt(sql), batch };
}

function makeWorld({ at, tables = {}, board = [], vendor = {} }) {
  const world = { tables: { regular_season_games: [], postseason_games: [], ...tables }, board, vendor,
    vendorCalls: [], updates: [], changeLog: [], lookups: 0, otherSelects: [], d1Fail: false, at, onVendor: null,
    vendorFail: null, sqlite: null, kvPuts: [] };
  world.storage = {
    _m: new Map(),
    async get(k) { return Array.isArray(k) ? new Map(k.filter(x => this._m.has(x)).map(x => [x, this._m.get(x)])) : this._m.get(k); },
    put(k, v) { this._m.set(k, structuredClone(v)); return Promise.resolve(); },
    setAlarm() { return Promise.resolve(); },
  };
  return world;
}

function installFetch(world) {
  globalThis.fetch = async (url) => {
    await tick();
    const u = new URL(url);
    if (u.hostname === 'api.the-odds-api.com') {
      const key = u.pathname.split('/')[3];
      world.vendorCalls.push(key);
      if (world.onVendor) world.onVendor(world);
      // A billed call that yields no events: an error status, a dropped
      // connection, or a body that is not a list.
      if (world.vendorFail === 'status') return new Response('{"message":"internal"}', { status: 500 });
      if (world.vendorFail === 'throw') throw new TypeError('fetch failed');
      if (world.vendorFail === 'object') return new Response('{"message":"not a list"}', { status: 200 });
      return new Response(JSON.stringify(world.vendor[key] || []), { status: 200 });
    }
    const sport = u.searchParams.get('sport'), date = u.searchParams.get('date');
    return new Response(JSON.stringify({ games: world.board.filter(g => g.sport === sport && etDate(g.start) === date) }), { status: 200 });
  };
}

function instance(C, world, db = true) {
  const ctx = { storage: world.storage, id: 't', waitUntil(p) { ctx.pending.push(p); }, pending: [] };
  const inst = new C(ctx, {});
  inst.env = { ODDS_API_KEY: 'k', RELAY_BASE: 'http://relay.test', ...(db ? { ARCHIVE_DB: makeDb(world) } : {}),
    ...(world.ledger || world.sqlite ? { FIELD_JOURNALISM: { get: async () => null,
      put: async (k) => { world.kvPuts.push(k); } } } : {}) };
  return { inst, ctx };
}

// One poll of the real class at the scenario's instant.
async function poll(C, world, { db = true } = {}) {
  installFetch(world);
  clock = Date.parse(world.at);
  const { inst, ctx } = instance(C, world, db);
  await inst.alarm();
  await Promise.allSettled(ctx.pending);
  return world;
}

const bg = (id, sport, league, start, home, away, espnEventId = null) =>
  ({ id, sport, league, state: 'pre', start, espnEventId,
     home: { name: home, abbr: 'H', score: 0 }, away: { name: away, abbr: 'A', score: 0 }, periodNum: 0, periodLabel: '', clock: '' });
const row = (id, sport, date, start_time, home, away, espn_event_id = null, extra = {}) =>
  ({ id, sport, date, start_time, home, away, espn_event_id, closing_odds: null, ...extra });
// A book's markets. `draw` makes the h2h market three-way; spreads carry prices.
const book = (key, home, away, { ml = [-120, 100], draw = null, spread = [-1.5, 1.5], sprice = [110, -130], total = 2.5, only = null } = {}) => ({
  key, markets: [
    { key: 'h2h', outcomes: [{ name: home, price: ml[0] }, { name: away, price: ml[1] }, ...(draw !== null ? [{ name: 'Draw', price: draw }] : [])] },
    { key: 'spreads', outcomes: [{ name: home, point: spread[0], price: sprice[0] }, { name: away, point: spread[1], price: sprice[1] }] },
    { key: 'totals', outcomes: [{ name: 'Over', point: total, price: -110 }, { name: 'Under', point: total, price: -110 }] },
  ].filter(m => !only || only.includes(m.key)),
});
const event = (home, away, commence, opts = {}, books = null) =>
  ({ home_team: home, away_team: away, commence_time: commence, bookmakers: books || [book('draftkings', home, away, opts)] });
const blobOf = (world, id) => JSON.parse([...world.tables.regular_season_games, ...world.tables.postseason_games].find(r => r.id === id)?.closing_odds || 'null');
const strip = (b) => b && Object.fromEntries(Object.entries(b).filter(([k]) => !['captured_at', '_kickoff'].includes(k)));

async function selfTest() {
  globalThis.Date = PinnedDate;
  const { AmbientDO: C } = await import(pathToFileURL(MODULE).href + `?v=${Math.random()}`);
  C.prototype._fetchLiveOdds = async function () {};
  let failed = 0;
  const eq = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  };

  // W1 — an ESPN board game finds its row by event id, beside an MLS-style
  // skeleton of the same fixture (the old id-substring match wrote to one).
  // The archive's short name ('Nottm Forest') need not match the board's.
  {
    const w = makeWorld({ at: '2026-10-23T18:52:00Z',
      board: [bg('espn:401879253', 'epl', 'EPL', '2026-10-23T19:00Z', 'Nottingham Forest', 'Chelsea', '401879253')],
      tables: { regular_season_games: [
        row('EPL_2026-10-23_e401879253', 'EPL', '2026-10-23', '2026-10-23T19:00Z', 'Nottm Forest', 'Chelsea', '401879253'),
        row('2026-10-23-epl-nottinghamforest-chelsea', 'EPL', '2026-10-23', null, 'Nottingham Forest', 'Chelsea')] },
      vendor: { soccer_epl: [event('Nottingham Forest', 'Chelsea', '2026-10-23T19:00:00Z', { ml: [210, 125], draw: 240 })] } });
    await poll(C, w);
    const b = blobOf(w, 'EPL_2026-10-23_e401879253');
    eq('W1: one call, the event-id row written, the skeleton untouched',
      [w.vendorCalls, w.updates, w.changeLog], [['soccer_epl'], ['regular_season_games/EPL_2026-10-23_e401879253'], ['EPL_2026-10-23_e401879253']]);
    eq('W1: verified, before kickoff, prices by team, the draw kept, the spread priced',
      [b?._kickoff?.verified, b?.captured_at < '2026-10-23T19:00', strip(b)],
      [true, true, { source: 'draftkings', moneyline: { home: 210, away: 125, draw: 240 },
        spread: { home: -1.5, away: 1.5, homePrice: 110, awayPrice: -130 }, total: { over: 2.5, under: 2.5 } }]);
  }

  // W2 — the row already has its line: nothing is bought.
  {
    const w = makeWorld({ at: '2026-10-23T18:52:00Z',
      board: [bg('espn:401879254', 'epl', 'EPL', '2026-10-23T19:00Z', 'Arsenal', 'Everton', '401879254')],
      tables: { regular_season_games: [row('EPL_2026-10-23_e401879254', 'EPL', '2026-10-23', '2026-10-23T19:00Z', 'Arsenal', 'Everton', '401879254', { closing_odds: '{"source":"x"}' })] },
      vendor: { soccer_epl: [event('Arsenal', 'Everton', '2026-10-23T19:00:00Z')] } });
    await poll(C, w);
    eq('W2: a row that already has its line costs no call', [w.vendorCalls, w.updates], [[], []]);
  }

  // W3 — two games of one sport at one instant: one call, two writes.
  {
    const w = makeWorld({ at: '2026-10-23T18:52:00Z',
      board: [bg('espn:401879255', 'epl', 'EPL', '2026-10-23T19:00Z', 'Liverpool', 'Brentford', '401879255'),
              bg('espn:401879256', 'epl', 'EPL', '2026-10-23T19:00Z', 'Fulham', 'Wolverhampton Wanderers', '401879256')],
      tables: { regular_season_games: [
        row('EPL_2026-10-23_e401879255', 'EPL', '2026-10-23', '2026-10-23T19:00Z', 'Liverpool', 'Brentford', '401879255'),
        row('EPL_2026-10-23_e401879256', 'EPL', '2026-10-23', '2026-10-23T19:00Z', 'Fulham', 'Wolves', '401879256')] },
      vendor: { soccer_epl: [event('Liverpool', 'Brentford', '2026-10-23T19:00:00Z'), event('Fulham', 'Wolverhampton Wanderers', '2026-10-23T19:00:00Z')] } });
    await poll(C, w);
    eq('W3: two games due together cost one call and get two lines',
      [w.vendorCalls, [...w.updates].sort()], [['soccer_epl'], ['regular_season_games/EPL_2026-10-23_e401879255', 'regular_season_games/EPL_2026-10-23_e401879256']]);
  }

  // W4 — a 00:00Z kickoff: due at 23:5xZ on the ET-dated board the poll reads,
  // and its row carries the ET day, the day before the kickoff's UTC day.
  {
    const w = makeWorld({ at: '2026-10-19T23:52:00Z',
      board: [bg('espn:401908028', 'mlb', 'MLB', '2026-10-20T00:00Z', 'Tampa Bay Rays', 'Cleveland Guardians', '401908028')],
      tables: { regular_season_games: [row('MLB_2026-10-19_e401908028', 'MLB', '2026-10-19', '2026-10-20T00:00Z', 'Rays', 'Guardians', '401908028')] },
      vendor: { baseball_mlb: [event('Tampa Bay Rays', 'Cleveland Guardians', '2026-10-20T00:00:00Z')] } });
    await poll(C, w);
    eq('W4: a 00:00Z kickoff finds its row on the ET day', w.updates, ['regular_season_games/MLB_2026-10-19_e401908028']);
    eq('W4: a two-way market has no draw key, and every market served is kept',
      strip(blobOf(w, 'MLB_2026-10-19_e401908028')), { source: 'draftkings', moneyline: { home: -120, away: 100 },
        spread: { home: -1.5, away: 1.5, homePrice: 110, awayPrice: -130 }, total: { over: 2.5, under: 2.5 } });
  }

  // W5 — an NHLE board game: no ESPN id, full names, the archive with
  // nicknames and a kickoff 15 minutes off (measured on 1 of 29). The same
  // teams' next game (tomorrow) and a twin 200 minutes on are also NULL.
  {
    const w = makeWorld({ at: '2027-01-15T23:52:00Z',
      board: [bg('nhl:2026020601', 'nhl', 'NHL', '2027-01-16T00:00:00Z', 'Montréal Canadiens', 'Boston Bruins')],
      tables: { regular_season_games: [
        row('NHL_2027-01-15_e401893001', 'NHL', '2027-01-15', '2027-01-16T00:15Z', 'Canadiens', 'Bruins', '401893001'),
        row('NHL_2027-01-15_e401893003', 'NHL', '2027-01-15', '2027-01-16T03:20Z', 'Canadiens', 'Bruins', '401893003'),
        row('NHL_2027-01-16_e401893002', 'NHL', '2027-01-16', '2027-01-17T00:00Z', 'Canadiens', 'Bruins', '401893002')] },
      vendor: { icehockey_nhl: [event('Montreal Canadiens', 'Boston Bruins', '2027-01-16T00:00:00Z')] } });
    await poll(C, w);
    eq('W5: a board without an ESPN id finds tonight\'s row by name, not a twin\'s', w.updates, ['regular_season_games/NHL_2027-01-15_e401893001']);
  }

  // W6 — the vendor lists the same teams' next game (a day on) and a twin 200
  // minutes on: the price must come from this kickoff's event.
  {
    const w = makeWorld({ at: '2026-10-16T23:52:00Z',
      board: [bg('espn:401908026', 'mlb', 'MLB', '2026-10-17T00:00Z', 'Tampa Bay Rays', 'Cleveland Guardians', '401908026')],
      tables: { regular_season_games: [row('MLB_2026-10-16_e401908026', 'MLB', '2026-10-16', '2026-10-17T00:00Z', 'Rays', 'Guardians', '401908026')] },
      vendor: { baseball_mlb: [event('Tampa Bay Rays', 'Cleveland Guardians', '2026-10-18T00:00:00Z', { ml: [-200, 170] }),
                               event('Tampa Bay Rays', 'Cleveland Guardians', '2026-10-17T03:20:00Z', { ml: [-180, 150] }),
                               event('Tampa Bay Rays', 'Cleveland Guardians', '2026-10-17T00:00:00Z', { ml: [-130, 110] })] } });
    await poll(C, w);
    eq('W6: the line is this kickoff\'s, not a later game\'s', blobOf(w, 'MLB_2026-10-16_e401908026')?.moneyline, { home: -130, away: 110 });
  }

  // W7 — the vendor lists the pairing the other way round: each price, and
  // each side of the handicap, must stay with its own team.
  {
    const w = makeWorld({ at: '2026-10-23T18:52:00Z',
      board: [bg('espn:401879257', 'epl', 'EPL', '2026-10-23T19:00Z', 'Tottenham Hotspur', 'Manchester United', '401879257')],
      tables: { regular_season_games: [row('EPL_2026-10-23_e401879257', 'EPL', '2026-10-23', '2026-10-23T19:00Z', 'Spurs', 'Man United', '401879257')] },
      vendor: { soccer_epl: [event('Manchester United', 'Tottenham Hotspur', '2026-10-23T19:00:00Z', { ml: [150, 180], draw: 230, spread: [-0.5, 0.5], sprice: [105, -125] })] } });
    await poll(C, w);
    const b = blobOf(w, 'EPL_2026-10-23_e401879257');
    eq('W7: a reversed listing keeps each team\'s price and handicap',
      [b?.moneyline, b?.spread], [{ home: 180, away: 150, draw: 230 }, { home: 0.5, away: -0.5, homePrice: -125, awayPrice: 105 }]);
  }

  // W8 — the row's kickoff (18:50) has already passed although the board's
  // (19:00) has not: the line is certain to be refused, so nothing is bought.
  {
    const w = makeWorld({ at: '2026-10-23T18:55:00Z',
      board: [bg('espn:401879258', 'epl', 'EPL', '2026-10-23T19:00Z', 'Aston Villa', 'Brighton & Hove Albion', '401879258')],
      tables: { regular_season_games: [row('EPL_2026-10-23_e401879258', 'EPL', '2026-10-23', '2026-10-23T18:50Z', 'Aston Villa', 'Brighton', '401879258')] },
      vendor: { soccer_epl: [event('Aston Villa', 'Brighton and Hove Albion', '2026-10-23T19:00:00Z')] } });
    await poll(C, w);
    eq('W8: a row whose kickoff has passed costs no call', [w.vendorCalls, w.updates], [[], []]);
  }

  // W8b — the same pairing on time. 'Brighton & Hove Albion' and 'Brighton and
  // Hove Albion' share a resolved key and do not token-match.
  {
    const w = makeWorld({ at: '2026-10-23T18:52:00Z',
      board: [bg('espn:401879262', 'epl', 'EPL', '2026-10-23T19:00Z', 'Aston Villa', 'Brighton & Hove Albion', '401879262')],
      tables: { regular_season_games: [row('EPL_2026-10-23_e401879262', 'EPL', '2026-10-23', '2026-10-23T19:00Z', 'Aston Villa', 'Brighton', '401879262')] },
      vendor: { soccer_epl: [event('Aston Villa', 'Brighton and Hove Albion', '2026-10-23T19:00:00Z')] } });
    await poll(C, w);
    eq('W8b: a pair matched by resolved keys alone is written', w.updates, ['regular_season_games/EPL_2026-10-23_e401879262']);
  }

  // W8c — the kickoff passes while the vendor call is in flight: bought, and
  // refused by the shared mark rather than written late.
  {
    const w = makeWorld({ at: '2026-10-23T18:59:30Z',
      board: [bg('espn:401879263', 'epl', 'EPL', '2026-10-23T19:00Z', 'West Ham United', 'Bournemouth', '401879263')],
      tables: { regular_season_games: [row('EPL_2026-10-23_e401879263', 'EPL', '2026-10-23', '2026-10-23T19:00Z', 'West Ham', 'Bournemouth', '401879263')] },
      vendor: { soccer_epl: [event('West Ham United', 'Bournemouth', '2026-10-23T19:00:00Z')] } });
    w.onVendor = () => { clock = Date.parse('2026-10-23T19:00:20Z'); };
    await poll(C, w);
    eq('W8c: a line captured after kickoff is not written', [w.vendorCalls.length, w.updates], [1, []]);
  }

  // W9 — the stray lowercase 'wnba' duplicate shares the event id; only the
  // board's league is a candidate.
  {
    const w = makeWorld({ at: '2026-10-17T19:52:00Z',
      board: [bg('espn:401918305', 'wnba', 'WNBA', '2026-10-17T20:00Z', 'Golden State Valkyries', 'Atlanta Dream', '401918305')],
      tables: { regular_season_games: [
        row('WNBA_2026-10-17_e401918305', 'WNBA', '2026-10-17', '2026-10-17T20:00Z', 'Valkyries', 'Dream', '401918305'),
        row('wnba_2026-10-17_e401918305', 'wnba', '2026-10-17', '2026-10-17T20:00Z', 'Golden State Valkyries', 'Atlanta Dream', '401918305')] },
      vendor: { basketball_wnba: [event('Golden State Valkyries', 'Atlanta Dream', '2026-10-17T20:00:00Z')] } });
    await poll(C, w);
    eq('W9: the lowercase duplicate is not written', w.updates, ['regular_season_games/WNBA_2026-10-17_e401918305']);
  }

  // W10 — the lookup fails: nothing is bought.
  {
    const w = makeWorld({ at: '2026-10-23T18:52:00Z',
      board: [bg('espn:401879259', 'epl', 'EPL', '2026-10-23T19:00Z', 'Newcastle United', 'Burnley', '401879259')],
      tables: { regular_season_games: [row('EPL_2026-10-23_e401879259', 'EPL', '2026-10-23', '2026-10-23T19:00Z', 'Newcastle', 'Burnley', '401879259')] },
      vendor: { soccer_epl: [event('Newcastle United', 'Burnley', '2026-10-23T19:00:00Z')] } });
    w.d1Fail = true;
    await poll(C, w);
    eq('W10: a failed lookup buys nothing', w.vendorCalls, []);
  }

  // W11 — the board's 'Columbus Crew' and 'Chicago Fire FC' against the
  // vendor's stored 'Columbus Crew SC' and 'Chicago Fire': one team needs the
  // token match, the other the resolved key.
  {
    const w = makeWorld({ at: '2026-10-25T20:52:00Z',
      board: [bg('espn:761901', 'mls', 'MLS', '2026-10-25T21:00Z', 'Columbus Crew', 'Chicago Fire FC', '761901')],
      tables: { regular_season_games: [row('MLS_2026-10-25_e761901', 'MLS', '2026-10-25', '2026-10-25T21:00Z', 'Columbus', 'Chicago', '761901')] },
      vendor: { soccer_usa_mls: [event('Columbus Crew SC', 'Chicago Fire', '2026-10-25T21:00:00Z')] } });
    await poll(C, w);
    eq('W11: a pair needing a different test for each team is written', w.updates, ['regular_season_games/MLS_2026-10-25_e761901']);
  }

  // W12 — no ARCHIVE_DB binding: nothing to write to, so nothing is bought.
  {
    const w = makeWorld({ at: '2026-10-23T18:52:00Z',
      board: [bg('espn:401879260', 'epl', 'EPL', '2026-10-23T19:00Z', 'Leeds United', 'Sunderland', '401879260')],
      vendor: { soccer_epl: [event('Leeds United', 'Sunderland', '2026-10-23T19:00:00Z')] } });
    await poll(C, w, { db: false });
    eq('W12: without the archive binding nothing is bought', w.vendorCalls, []);
  }

  // W13 — the only lookup shape is the capture's own: one SELECT per table,
  // scoped by league and the two possible ET days.
  {
    const w = makeWorld({ at: '2026-10-23T18:52:00Z',
      board: [bg('espn:401879261', 'epl', 'EPL', '2026-10-23T19:00Z', 'Everton', 'Crystal Palace', '401879261')],
      tables: { regular_season_games: [row('EPL_2026-10-23_e401879261', 'EPL', '2026-10-23', '2026-10-23T19:00Z', 'Everton', 'C Palace', '401879261')] },
      vendor: { soccer_epl: [event('Everton', 'Crystal Palace', '2026-10-23T19:00:00Z')] } });
    await poll(C, w);
    eq('W13: two lookups, both scoped by league and ET day, and the row written',
      [w.lookups, w.otherSelects, w.updates], [2, [], ['regular_season_games/EPL_2026-10-23_e401879261']]);
  }

  // W14 — two rows claim the same event within 90 minutes (one in each
  // table): ambiguous, so nothing is bought.
  {
    const w = makeWorld({ at: '2026-10-23T18:52:00Z',
      board: [bg('espn:401879264', 'epl', 'EPL', '2026-10-23T19:00Z', 'Brentford', 'Fulham', '401879264')],
      tables: { regular_season_games: [row('EPL_2026-10-23_e401879264', 'EPL', '2026-10-23', '2026-10-23T19:00Z', 'Brentford', 'Fulham', '401879264')],
                postseason_games: [row('EPL_2026-10-23_e401879264_cup', 'EPL', '2026-10-23', '2026-10-23T19:00Z', 'Brentford', 'Fulham', '401879264')] },
      vendor: { soccer_epl: [event('Brentford', 'Fulham', '2026-10-23T19:00:00Z')] } });
    await poll(C, w);
    eq('W14: two candidate rows buy nothing', w.vendorCalls, []);
  }

  // W15 — the vendor lists the same pairing twice within 90 minutes:
  // ambiguous, so the line is not written.
  {
    const w = makeWorld({ at: '2026-10-23T18:52:00Z',
      board: [bg('espn:401879265', 'epl', 'EPL', '2026-10-23T19:00Z', 'Arsenal', 'Chelsea', '401879265')],
      tables: { regular_season_games: [row('EPL_2026-10-23_e401879265', 'EPL', '2026-10-23', '2026-10-23T19:00Z', 'Arsenal', 'Chelsea', '401879265')] },
      vendor: { soccer_epl: [event('Arsenal', 'Chelsea', '2026-10-23T19:00:00Z'), event('Arsenal', 'Chelsea', '2026-10-23T19:30:00Z')] } });
    await poll(C, w);
    eq('W15: two candidate events write nothing', [w.vendorCalls.length, w.updates], [1, []]);
  }

  // W16 — a name-path board whose only nearby row matches the home team only.
  {
    const w = makeWorld({ at: '2027-01-15T23:52:00Z',
      board: [bg('nhl:2026020602', 'nhl', 'NHL', '2027-01-16T00:00:00Z', 'Boston Bruins', 'Toronto Maple Leafs')],
      tables: { regular_season_games: [row('NHL_2027-01-15_e401893010', 'NHL', '2027-01-15', '2027-01-16T00:00Z', 'Bruins', 'Rangers', '401893010')] },
      vendor: { icehockey_nhl: [event('Boston Bruins', 'Toronto Maple Leafs', '2027-01-16T00:00:00Z')] } });
    await poll(C, w);
    eq('W16: a row matching one team only buys nothing', w.vendorCalls, []);
  }

  // W17 — a playoff game's row is in postseason_games: it is found there and
  // written there.
  {
    const w = makeWorld({ at: '2027-05-10T23:52:00Z',
      board: [bg('nhl:2026030121', 'nhl', 'NHL', '2027-05-11T00:00:00Z', 'Boston Bruins', 'Toronto Maple Leafs')],
      tables: { postseason_games: [row('NHL_NHL-R1-BOS-TOR_G3_2027-05-10', 'NHL', '2027-05-10', '2027-05-11T00:00Z', 'Bruins', 'Maple Leafs')] },
      vendor: { icehockey_nhl: [event('Boston Bruins', 'Toronto Maple Leafs', '2027-05-11T00:00:00Z')] } });
    await poll(C, w);
    eq('W17: a postseason row is found and written in its own table',
      [w.updates, w.changeLog], [['postseason_games/NHL_NHL-R1-BOS-TOR_G3_2027-05-10'], ['NHL_NHL-R1-BOS-TOR_G3_2027-05-10']]);
  }

  // W18 — POST /ambient/kick runs a poll beside the alarm's, on the same
  // instance, while the alarm's poll is in its lookup. One purchase, one line,
  // one change_log row.
  {
    const w = makeWorld({ at: '2026-10-23T18:52:00Z',
      board: [bg('espn:401879266', 'epl', 'EPL', '2026-10-23T19:00Z', 'Liverpool', 'Arsenal', '401879266')],
      tables: { regular_season_games: [row('EPL_2026-10-23_e401879266', 'EPL', '2026-10-23', '2026-10-23T19:00Z', 'Liverpool', 'Arsenal', '401879266')] },
      vendor: { soccer_epl: [event('Liverpool', 'Arsenal', '2026-10-23T19:00:00Z')] } });
    installFetch(w);
    clock = Date.parse(w.at);
    const { inst, ctx } = instance(C, w);
    const kick = () => inst.fetch(new Request('http://relay.test/ambient/kick', { method: 'POST' }));
    await Promise.all([inst.alarm(), (async () => { await tick(); await tick(); await tick(); return kick(); })(), kick()]);
    await Promise.allSettled(ctx.pending);
    eq('W18: overlapping polls buy one line, once', [w.vendorCalls.length, w.updates.length, w.changeLog.length], [1, 1, 1]);
  }

  // W19 — another writer fills the row while the vendor call is in flight:
  // the UPDATE changes nothing, so nothing is recorded as written.
  {
    const w = makeWorld({ at: '2026-10-23T18:52:00Z',
      board: [bg('espn:401879267', 'epl', 'EPL', '2026-10-23T19:00Z', 'Chelsea', 'Everton', '401879267')],
      tables: { regular_season_games: [row('EPL_2026-10-23_e401879267', 'EPL', '2026-10-23', '2026-10-23T19:00Z', 'Chelsea', 'Everton', '401879267')] },
      vendor: { soccer_epl: [event('Chelsea', 'Everton', '2026-10-23T19:00:00Z')] } });
    w.onVendor = (world) => { world.tables.regular_season_games[0].closing_odds = '{"source":"other"}'; };
    await poll(C, w);
    eq('W19: a row filled meanwhile gets no change_log row', [w.updates, w.changeLog], [[], []]);
  }

  // W20 — the preferred book is the one every other line comes from, whatever
  // its position; a market the chosen book does not serve is omitted.
  {
    const w = makeWorld({ at: '2026-10-23T18:52:00Z',
      board: [bg('espn:401879268', 'epl', 'EPL', '2026-10-23T19:00Z', 'Burnley', 'Leeds United', '401879268')],
      tables: { regular_season_games: [row('EPL_2026-10-23_e401879268', 'EPL', '2026-10-23', '2026-10-23T19:00Z', 'Burnley', 'Leeds', '401879268')] },
      vendor: { soccer_epl: [event('Burnley', 'Leeds United', '2026-10-23T19:00:00Z', {},
        [book('fanduel', 'Burnley', 'Leeds United', { ml: [300, -110] }), book('draftkings', 'Burnley', 'Leeds United', { ml: [280, -105], only: ['h2h'] })])] } });
    await poll(C, w);
    const b = blobOf(w, 'EPL_2026-10-23_e401879268');
    eq('W20: the preferred book, and no key for a market it does not serve',
      strip(b), { source: 'draftkings', moneyline: { home: 280, away: -105 } });
    const index = readFileSync(path.resolve(HERE, '../src/index.js'), 'utf8').match(/const ODDS_PREFERRED_BOOK = '([^']+)';/)?.[1];
    const mine = readFileSync(MODULE, 'utf8').match(/const CLOSING_PREFERRED_BOOK = '([^']+)';/)?.[1];
    eq('W20: the preferred book is src/index.js\'s ODDS_PREFERRED_BOOK', [!!index, mine], [true, index]);
  }

  // W21 — the odds guard declines the purchase (the day's ceiling is full):
  // no vendor call, no write, and neither game is recorded as bought, so the
  // next poll inside the window, with room on the ledger, buys both in one call
  // and writes each row once (docs/CC-CMD-2026-10-23-odds-ceiling-
  // prerequisites.md, fix 1). Two games of one sport, so a withdrawal of the
  // first only is seen.
  {
    const w = makeWorld({ at: '2026-10-23T18:51:00Z',
      board: [bg('espn:401879269', 'epl', 'EPL', '2026-10-23T19:00Z', 'Fulham', 'Brentford', '401879269'),
              bg('espn:401879270', 'epl', 'EPL', '2026-10-23T19:00Z', 'Everton', 'Burnley', '401879270')],
      tables: { regular_season_games: [row('EPL_2026-10-23_e401879269', 'EPL', '2026-10-23', '2026-10-23T19:00Z', 'Fulham', 'Brentford', '401879269'),
                                       row('EPL_2026-10-23_e401879270', 'EPL', '2026-10-23', '2026-10-23T19:00Z', 'Everton', 'Burnley', '401879270')] },
      vendor: { soccer_epl: [event('Fulham', 'Brentford', '2026-10-23T19:00:00Z'), event('Everton', 'Burnley', '2026-10-23T19:00:00Z')] } });
    w.ledger = { full: true, charges: 0 };
    await poll(C, w);
    const refused = [w.ledger.charges > 0, w.vendorCalls.length, w.updates.length,
      Object.keys(w.storage._m.get('starts:today') ?? {})];
    w.ledger.full = false;
    w.at = '2026-10-23T18:52:00Z';
    await poll(C, w);
    eq('W21: a declined charge buys nothing and records nothing',
      refused, [true, 0, 0, []]);
    eq('W21: the next poll in the window buys both in one call and writes each row once',
      [w.vendorCalls, [...w.updates].sort(), Object.keys(w.storage._m.get('starts:today') ?? {}).sort()],
      [['soccer_epl'], ['regular_season_games/EPL_2026-10-23_e401879269', 'regular_season_games/EPL_2026-10-23_e401879270'],
       ['espn:401879269', 'espn:401879270']]);
  }

  // W22 — THE REFUSAL'S COST ON THE REAL LEDGER, PINNED. The month has no room
  // (84,999 of 85,000) and the day has. chargeOdds charges the day and the site
  // and refuses the call: what its own comment calls intended, and what
  // scripts/check-monthly-atomic.mjs case B pins for one call. Because a refused
  // capture is retried, four polls inside the window are four refusals: day and
  // site +12, the month unmoved, no vendor call. This is today's behaviour, not
  // the wanted one; Task 3 of docs/CC-CMD-2026-09-16-odds-spend-attribution.md
  // changes it, and changes this pin in the same commit.
  {
    const w = makeWorld({ at: '2026-11-14T18:51:00Z',
      board: [bg('espn:401879271', 'epl', 'EPL', '2026-11-14T19:00Z', 'Chelsea', 'Arsenal', '401879271')],
      tables: { regular_season_games: [row('EPL_2026-11-14_e401879271', 'EPL', '2026-11-14', '2026-11-14T19:00Z', 'Chelsea', 'Arsenal', '401879271')] },
      vendor: { soccer_epl: [event('Chelsea', 'Arsenal', '2026-11-14T19:00:00Z')] } });
    w.sqlite = new DatabaseSync(':memory:');
    w.sqlite.exec(`CREATE TABLE odds_budget (day TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE odds_budget_site (day TEXT NOT NULL, site TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, site));
      CREATE TABLE odds_budget_month (month TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE odds_reconcile_state (day TEXT NOT NULL, site TEXT NOT NULL, state TEXT NOT NULL, cache TEXT NOT NULL,
        n INTEGER NOT NULL DEFAULT 0, credits_kept INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, site, state, cache));
      INSERT INTO odds_budget VALUES ('2026-11-14', 100);
      INSERT INTO odds_budget_month VALUES ('2026-11', 84999);`);
    for (const at of ['18:51', '18:52', '18:53', '18:54']) { w.at = `2026-11-14T${at}:00Z`; await poll(C, w); }
    const one = (q) => w.sqlite.prepare(q).get()?.v ?? null;
    eq('W22: four refused polls under a month veto: day and site +12, the month unmoved, no vendor call, the limit key written',
      [one("SELECT used v FROM odds_budget WHERE day = '2026-11-14'"),
       one("SELECT used v FROM odds_budget_site WHERE day = '2026-11-14' AND site = 'ambientCaptureClosingOdds'"),
       one("SELECT used v FROM odds_budget_month WHERE month = '2026-11'"),
       w.vendorCalls.length, w.kvPuts.includes('odds:credits:2026-11:warned:limit'),
       Object.keys(w.storage._m.get('starts:today') ?? {})],
      [112, 12, 84999, 0, true, []]);
  }

  // W23 — a billed call that yields no events (an error status, a dropped
  // connection, a body that is not a list) keeps the game recorded: the vendor
  // was called, or may have been, so later polls inside the window do not call
  // again. Only a refusal, which makes no call, is retried.
  for (const fail of ['status', 'throw', 'object']) {
    const w = makeWorld({ at: '2026-10-23T18:51:00Z',
      board: [bg('espn:401879272', 'epl', 'EPL', '2026-10-23T19:00Z', 'Leeds United', 'Wolverhampton Wanderers', '401879272')],
      tables: { regular_season_games: [row('EPL_2026-10-23_e401879272', 'EPL', '2026-10-23', '2026-10-23T19:00Z', 'Leeds', 'Wolves', '401879272')] },
      vendor: { soccer_epl: [event('Leeds United', 'Wolverhampton Wanderers', '2026-10-23T19:00:00Z')] } });
    w.vendorFail = fail;
    for (const at of ['18:51', '18:52', '18:53']) { w.at = `2026-10-23T${at}:00Z`; await poll(C, w); }
    eq(`W23 (${fail}): one vendor call across three polls, nothing written, the game still recorded`,
      [w.vendorCalls.length, w.updates, Object.keys(w.storage._m.get('starts:today') ?? {})], [1, [], ['espn:401879272']]);
  }

  globalThis.Date = RealDate;
  console.log(failed ? `\nSELF-TEST FAILED: ${failed}` : '\nself-test passed');
  return failed;
}

const ROWS_NEAR = '                return gap !== null && Math.abs(gap) <= CONTESTED_KICKOFF_MINUTES\n                    && kickoffMark(new Date().toISOString(), r.start_time).verified;';
const VENDOR_NEAR = '            const gap = kickoffGapMinutes({ start_time: start.start }, e);\n            return gap !== null && Math.abs(gap) <= CONTESTED_KICKOFF_MINUTES;';
const MUTATIONS = [
  ['a declined charge reads as bought', [["            console.warn('[closing-odds] odds credit guard declined — skipping capture');\n            return false;",
    "            console.warn('[closing-odds] odds credit guard declined — skipping capture');\n            return;"]]],
  ['an error status after a billed call reads as declined', [["                console.warn(`[closing-odds] fetch ${r.status} for ${sport}`);\n                return;",
    "                console.warn(`[closing-odds] fetch ${r.status} for ${sport}`);\n                return false;"]]],
  ['a failed fetch reads as declined', [["            console.warn(`[closing-odds] fetch error for ${sport}: ${e.message}`);\n            return;",
    "            console.warn(`[closing-odds] fetch error for ${sport}: ${e.message}`);\n            return false;"]]],
  ['a body that is not a list reads as declined', [['        if (!Array.isArray(events)) return;', '        if (!Array.isArray(events)) return false;']]],
  ['a refusal withdraws the first game only', [['for (const d of due) this._gameStarts.delete(d.gameId);', 'for (const d of due.slice(0, 1)) this._gameStarts.delete(d.gameId);']]],
  ['any nearby row, not the event id', [["? near.filter(r => String(r.espn_event_id) === String(st.espnEventId))", '? near']]],
  ['names, not the event id, on ESPN boards', [["? near.filter(r => String(r.espn_event_id) === String(st.espnEventId))",
    '? near.filter(r => nameMatches(r.home, st.home) && nameMatches(r.away, st.away))']]],
  ['the old id-substring match', [["? near.filter(r => String(r.espn_event_id) === String(st.espnEventId))",
    "? rows.filter(r => String(r.id).includes(String(st.home).toLowerCase().replace(/[^a-z0-9]/g, '')) || String(r.id).includes(String(st.away).toLowerCase().replace(/[^a-z0-9]/g, '')))"]]],
  ['one name enough on the name path', [['nameMatches(r.home, st.home) && nameMatches(r.away, st.away));', 'nameMatches(r.home, st.home) || nameMatches(r.away, st.away));']]],
  ['the first of several rows', [['if (hit.length === 1) due.push', 'if (hit.length >= 1) due.push']]],
  ['the UTC day only', [['            days.add(new Date(t - 86400000).toISOString().slice(0, 10));\n', '']]],
  ['no kickoff tolerance on the row', [[ROWS_NEAR, '                return kickoffMark(new Date().toISOString(), r.start_time).verified;']]],
  ['row tolerance 720', [[ROWS_NEAR, ROWS_NEAR.replace('<= CONTESTED_KICKOFF_MINUTES', '<= 720')]]],
  ['a row whose kickoff has passed is bought for', [[ROWS_NEAR, '                return gap !== null && Math.abs(gap) <= CONTESTED_KICKOFF_MINUTES;']]],
  ['not scoped by league', [['WHERE sport = ? AND date IN', 'WHERE ? IS NOT NULL AND date IN']]],
  ['rows that already have a line are bought for', [['AND start_time IS NOT NULL AND closing_odds IS NULL`', 'AND start_time IS NOT NULL`']]],
  ['a placeholder short', [["date IN (${[...days].map(() => '?').join(', ')})", "date IN (${[...days].slice(1).map(() => '?').join(', ')})"]]],
  ['postseason rows dropped', [['            for (const r of got) rows.push({ ...r, table });', "            if (table === 'regular_season_games') for (const r of got) rows.push({ ...r, table });"]]],
  ['every UPDATE to the regular table', [['`UPDATE ${match.table} SET closing_odds = ?', '`UPDATE regular_season_games SET closing_odds = ?']]],
  ['the lookup is skipped', [['const due = (await this._closingRowsFor(starts))', 'const due = (starts.map(s => ({ ...s, row: { id: s.gameId, table: "regular_season_games" } })))']]],
  ['no second look after the lookup', [['const due = (await this._closingRowsFor(starts)).filter(d => !this._gameStarts.has(d.gameId));', 'const due = await this._closingRowsFor(starts);']]],
  ['change_log written when nothing changed', [['if (result?.changes === 0) {', 'if (false) {']]],
  ['a late line is written', [['if (odds._kickoff?.verified !== true) {', 'if (false) {']]],
  ['resolved keys only', [['pick((b, v) => resolveTeamKey(b) === resolveTeamKey(v) || nameMatches(b, v))', 'pick((b, v) => resolveTeamKey(b) === resolveTeamKey(v))']]],
  ['tokens only', [['pick((b, v) => resolveTeamKey(b) === resolveTeamKey(v) || nameMatches(b, v))', 'pick((b, v) => nameMatches(b, v))']]],
  ['the first of several events', [['if (straight.length + swapped.length !== 1) return null;', 'if (straight.length + swapped.length < 1) return null;']]],
  ['any vendor event of the pairing, whatever its kickoff', [[VENDOR_NEAR, '            return true;']]],
  ['vendor tolerance 720', [[VENDOR_NEAR, VENDOR_NEAR.replace('<= CONTESTED_KICKOFF_MINUTES', '<= 720')]]],
  ['a reversed listing is read straight', [['        const homeName = found.swapped ? event.away_team : event.home_team;\n        const awayName = found.swapped ? event.home_team : event.away_team;',
    '        const homeName = event.home_team;\n        const awayName = event.away_team;']]],
  ['the first book, not the preferred one', [['event.bookmakers.find(b => b.key === CLOSING_PREFERRED_BOOK) || event.bookmakers[0]', 'event.bookmakers[0]']]],
  ['a market not served is written as nulls', [['        if (sp) baseOdds.spread = sp;', '        baseOdds.spread = sp || { home: null, away: null };']]],
  ['the spread loses its prices', [['        const sp = spreadFrom(', '        const sp = ((h, a) => h && a ? { home: h.point, away: a.point } : null)(']]],
  ['the draw dropped', [['            if (draw !== null) baseOdds.moneyline.draw = draw;', '']]],
  ['a draw key on every line', [['            if (draw !== null) baseOdds.moneyline.draw = draw;', '            baseOdds.moneyline.draw = draw;']]],
];

function mutate() {
  const src = readFileSync(SRC, 'utf8');
  const base = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' });
  if (base.status !== 0) { console.log('BASELINE RED: mutations not run.\n' + base.stdout + base.stderr); return 1; }
  let bad = 0;
  for (const [name, edits] of MUTATIONS) {
    let text = src, why = null;
    for (const [from, to] of edits) {
      const at = text.indexOf(from);
      if (at < 0 || text.indexOf(from, at + 1) >= 0) { why = at < 0 ? 'missing' : 'not unique'; break; }
      text = text.slice(0, at) + to + text.slice(at + from.length);
    }
    if (why) { console.log(`  ANCHOR     ${name} (${why}): not run`); bad++; continue; }
    const mutant = path.join(path.dirname(SRC), `.mutant-${process.pid}-write-ambient-do.js`);
    writeFileSync(mutant, text);
    try {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', env: { ...process.env, AMBIENT_MODULE: mutant } });
      const fails = (r.stdout.match(/^  FAIL (.*)$/gm) || []).map(l => l.slice(7));
      if (r.status !== 0 && /SELF-TEST FAILED/.test(r.stdout) && fails.length) {
        console.log(`  CAUGHT     ${name}\n               by: ${fails.join(' | ')}`);
      } else if (r.status === 0) {
        console.log(`  NOT CAUGHT ${name}`); bad++;
      } else {
        console.log(`  HARNESS ERROR ${name} (exit ${r.status}, no failing assertion)\n${(r.stderr || '').slice(0, 400)}`); bad++;
      }
    } finally { unlinkSync(mutant); }
  }
  console.log(`\nmutations: ${MUTATIONS.length - bad} of ${MUTATIONS.length} caught`);
  return bad ? 1 : 0;
}

if (process.argv.includes('--mutate')) process.exit(mutate());
else process.exit(await selfTest() ? 1 : 0);
