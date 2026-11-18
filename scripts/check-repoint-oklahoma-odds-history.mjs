#!/usr/bin/env node
// Rule 90 for scripts/repoint-oklahoma-odds-history.mjs.
//
// One UPDATE on a production table. Unlike an append-only insert it can overwrite, so
// the assertions are about the ways it could still go wrong: moving a row it was not
// ordered to move, moving the right row into a state that arms a refill or a
// duplicate, changing a column it should not, writing twice, or reporting done when it
// is not.
//
// Run against a real SQLite (node:sqlite), seeded with the rows as they stand in D1
// (the odds_history DDL is D1's own). The executor is driven twice: through a function
// stand-in for /d1/execute, and as a real child process against a local HTTP server
// that speaks the relay's wire format, so the dry-run default, the secret header, the
// request shape and the log file are exercised, not read. Every guard is tested on
// its own, so a guard removed from the statement turns exactly one test red.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, chmodSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEEPER, STALE, EVENT, PK, NEW_STYLE_ID, PROGRESS_DATE, ROW,
         readQueries, stateFrom, evaluate, buildStatements, execute, relayD1 } from './repoint-oklahoma-odds-history.mjs';

const { allowedTables } = createRequire(import.meta.url)('./lib/allowed-tables.cjs');
const CLI = fileURLToPath(new URL('./repoint-oklahoma-odds-history.mjs', import.meta.url));

let checked = 0, failed = 0;
const eq = (label, got, want) => {
  checked++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
const throws = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const temps = [];   // every temp directory this check makes, removed at the end (the harness runs the check once per mutant)

const OPENING = '{"source":"draftkings","captured_at":"2026-11-14T10:02:07.610Z","moneyline":{"home":-142,"away":120}}';
const CLOSING = '{"source":"draftkings","captured_at":"2026-11-15T11:55:36Z","moneyline":{"home":-142,"away":120}}';

// D1's own DDL for odds_history, read from sqlite_master on 2026-11-18.
const ODDS_HISTORY_DDL = `CREATE TABLE odds_history (
    id TEXT PRIMARY KEY,
    game_id TEXT, sport TEXT, date TEXT,
    home_team TEXT, away_team TEXT, commence_time TEXT,
    home_ml REAL, away_ml REAL, draw_ml REAL,
    over_under REAL, over_price REAL, under_price REAL,
    bookmaker TEXT, snapshot_time TEXT,
    snapshot_type TEXT DEFAULT 'close',
    created_at TEXT DEFAULT (datetime('now'))
  )`;
const INSERT_HISTORY = `INSERT INTO odds_history (id, game_id, sport, date, home_team, away_team, commence_time, home_ml, away_ml, draw_ml, over_under, over_price, under_price, bookmaker, snapshot_time, snapshot_type, created_at)
                        VALUES (:id, :game_id, :sport, :date, :home_team, :away_team, :commence_time, :home_ml, :away_ml, :draw_ml, :over_under, :over_price, :under_price, :bookmaker, :snapshot_time, :snapshot_type, :created_at)`;

function seed(mut = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`${ODDS_HISTORY_DDL};
           CREATE TABLE regular_season_games (id TEXT PRIMARY KEY, espn_event_id TEXT, home_score INTEGER, away_score INTEGER, opening_odds TEXT, closing_odds TEXT);
           CREATE TABLE postseason_games (id TEXT PRIMARY KEY, espn_event_id TEXT);
           CREATE TABLE odds_backfill_progress (date TEXT PRIMARY KEY, games_processed INTEGER, credits_used INTEGER, completed_at TEXT DEFAULT (datetime('now')));`);
  const hist = (over) => db.prepare(INSERT_HISTORY).run({ ...ROW, ...over });
  if (!mut.noRow) hist({ game_id: mut.rowGame ?? STALE, ...(mut.rowOver ?? {}) });
  if (mut.onKeeperExtra) hist({ id: 'extra_keeper_row', game_id: KEEPER, bookmaker: 'fanduel' });
  if (mut.onStaleExtra) hist({ id: 'extra_stale_row', game_id: STALE, bookmaker: 'fanduel' });
  if (mut.newStyle) hist({ id: NEW_STYLE_ID, game_id: 'CFB_other' });
  // unrelated rows, which must never be touched (one is an MLS row whose id does not start with its game id)
  hist({ id: 'CFB_2026-11-14_eOTHER_draftkings_close', game_id: 'CFB_2026-11-14_eOTHER', home_team: 'A', away_team: 'B', home_ml: 1.5 });
  hist({ id: '2026-08-15-mls-sj-stl_fanduel_close', game_id: 'MLS_2026-08-15_sanjose_stlouis', sport: 'MLS', bookmaker: 'fanduel', home_ml: 2.1 });
  const games = db.prepare('INSERT INTO regular_season_games (id, espn_event_id, home_score, away_score, opening_odds, closing_odds) VALUES (?,?,?,?,?,?)');
  if (!mut.noKeeper) games.run(KEEPER, EVENT, 'homeScore' in mut ? mut.homeScore : 24, 'awayScore' in mut ? mut.awayScore : 17,
    'opening' in mut ? mut.opening : OPENING, 'closing' in mut ? mut.closing : CLOSING);
  games.run('CFB_2026-11-15_e999', '999', null, null, null, null);
  if (mut.staleGames) games.run(STALE, EVENT, null, null, OPENING, '{}');
  if (mut.thirdGames) games.run('CFB_2026-11-13_e401856887', EVENT, null, null, null, null);
  if (mut.postseason) db.prepare('INSERT INTO postseason_games (id, espn_event_id) VALUES (?,?)').run('p1', EVENT);
  if (!mut.noProgress) db.prepare('INSERT INTO odds_backfill_progress (date, games_processed, credits_used) VALUES (?,?,?)').run(mut.progressDate ?? PROGRESS_DATE, 16, 100);
  db.prepare('INSERT INTO odds_backfill_progress (date, games_processed, credits_used) VALUES (?,?,?)').run('2026-11-14', 12, 80);
  return db;
}
const read = (db) => {
  const out = {};
  for (const [k, v] of Object.entries(readQueries())) out[k] = db.prepare(v.sql).all(...v.params);
  return stateFrom(out);
};
const stmts = buildStatements();
const runOne = (db) => Number(db.prepare(stmts[0].sql).run(...stmts[0].params).changes);
const snap = (db, table) => JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
const rowOf = (db, id) => db.prepare('SELECT * FROM odds_history WHERE id = ?').get(id);
const gameOf = (db, id) => rowOf(db, id)?.game_id;

// ── 0. the plan as written ──────────────────────────────────────────────
eq('one statement, the repoint', stmts.map(s => s.name.split(' ')[0]), ['1']);
eq('the statement binds exactly as many parameters as it has placeholders', (stmts[0].sql.match(/\?/g) || []).length === stmts[0].params.length, true);
eq('no id, date or event is interpolated into the SQL text',
  [KEEPER, STALE, PK, NEW_STYLE_ID, PROGRESS_DATE, EVENT].some(x => stmts[0].sql.includes(x)), false);
eq('the statement is an UPDATE of odds_history that sets game_id and nothing else, with no DELETE or INSERT',
  [/^UPDATE odds_history SET game_id = \? WHERE id = \? AND game_id = \? /.test(stmts[0].sql), /\b(DELETE|INSERT|REPLACE)\b/i.test(stmts[0].sql), (stmts[0].sql.match(/\bSET\b/g) || []).length], [true, false, 1]);
const allowed = allowedTables(readFileSync('src/index.js', 'utf8'));
const TABLE_RE = /(?:INTO|FROM|UPDATE|TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+(\w+)/i;
const firstTable = (sql) => sql.match(TABLE_RE)?.[1];
const handlerRe = readFileSync('src/index.js', 'utf8').match(/const tableName = sql\.match\((\/.+\/i)\)\?\.\[1\];/);
eq('the check\'s table regex is the /d1/execute handler\'s, read from src/index.js (the allow-list is parsed there too)', handlerRe === null ? null : handlerRe[1], String(TABLE_RE));
eq('the /d1/execute table guard admits the statement and every read (its own regex, its own list)',
  [stmts[0].sql, ...Object.values(readQueries()).map(q => q.sql)].map(sql => allowed.includes(firstTable(sql))).every(Boolean), true);
eq('the statement\'s table, by that regex, is odds_history', firstTable(stmts[0].sql), 'odds_history');
eq('the allow-list parsed at all', allowed.length > 5, true);
eq('the pinned facts are what the owner\'s order and the D1 read said',
  [KEEPER, STALE, EVENT, PK, NEW_STYLE_ID, PROGRESS_DATE, ROW],
  ['CFB_2026-11-15_e401856887', 'CFB_2026-11-14_e401856887', '401856887', 'CFB_2026-11-14_e401856887_draftkings_close', 'CFB_2026-11-15_e401856887_draftkings_close', '2026-11-15',
   { id: 'CFB_2026-11-14_e401856887_draftkings_close', game_id: 'CFB_2026-11-14_e401856887', sport: 'CFB', date: '2026-11-14', home_team: 'Oklahoma Sooners', away_team: 'Ole Miss Rebels',
     commence_time: '2026-11-15T18:00:00Z', home_ml: 1.68, away_ml: 2.24, draw_ml: null, over_under: 48.5, over_price: 1.89, under_price: 1.93, bookmaker: 'draftkings',
     snapshot_time: '2026-11-14T23:55:04Z', snapshot_type: 'close', created_at: '2026-11-15 16:51:48' }]);
eq('the pinned row is frozen', Object.isFrozen(ROW), true);
eq('the history read names its columns (no SELECT *), so a schema change cannot slip a column past the pin',
  /^SELECT id, game_id, sport, date, home_team, away_team, commence_time, home_ml, away_ml, draw_ml, over_under, over_price, under_price, bookmaker, snapshot_time, snapshot_type, created_at FROM odds_history WHERE id = \?$/.test(readQueries().row.sql), true);

// ── 1. a fresh run moves exactly one row's game_id ──────────────────────
{
  const db = seed();
  const ev = evaluate(read(db));
  eq('fresh: every precondition holds', [ev.ok, ev.phase, ev.checks.filter(c => !c.ok).map(c => c.name)], [true, 'fresh', []]);
  const before = rowOf(db, PK), others = db.prepare('SELECT * FROM odds_history WHERE id <> ? ORDER BY id').all(PK);
  const games = snap(db, 'regular_season_games'), progress = snap(db, 'odds_backfill_progress');
  eq('fresh: the statement changes exactly one row', runOne(db), 1);
  const after = rowOf(db, PK);
  eq('fresh: the row is now on the keeper', after.game_id, KEEPER);
  eq('fresh: every other column of that row, the primary key included, is byte-identical', { ...after, game_id: null }, { ...before, game_id: null });
  eq('fresh: no other history row changed', JSON.stringify(db.prepare('SELECT * FROM odds_history WHERE id <> ? ORDER BY id').all(PK)), JSON.stringify(others));
  eq('fresh: the games table and the progress table are untouched', [snap(db, 'regular_season_games'), snap(db, 'odds_backfill_progress')], [games, progress]);
  eq('fresh: no row exists under the new-style id (the primary key was not renamed)', db.prepare('SELECT COUNT(*) AS n FROM odds_history WHERE id = ?').get(NEW_STYLE_ID).n, 0);
  const done = evaluate(read(db));
  eq('fresh: the state now reads done and passes every precondition', [done.ok, done.phase], [true, 'done']);
  eq('idempotent: a second run changes nothing', runOne(db), 0);
  eq('idempotent: and the row is still on the keeper, once', [gameOf(db, PK), db.prepare('SELECT COUNT(*) AS n FROM odds_history WHERE game_id = ?').get(KEEPER).n], [KEEPER, 1]);
}

// ── 2. every guard of the statement bites on its own ────────────────────
const alone = (label, mut, drift) => {
  const db = seed(mut);
  if (drift) drift(db);
  eq(label, [runOne(db), gameOf(db, PK)], [0, mut.rowGame ?? STALE]);
};
{
  // the primary-key guard: a second row on the old game id is not swept along
  const db = seed({ onStaleExtra: true });
  eq('guard id: with a second row on the old game id, exactly one row changes and the other stays', [runOne(db), gameOf(db, PK), gameOf(db, 'extra_stale_row')], [1, KEEPER, STALE]);
}
alone('guard game_id: a row on some other game id is not moved', { rowGame: 'CFB_other' });
alone('guard game_id: a row already on the keeper is not moved again', { rowGame: KEEPER });
alone('guard keeper-free: a history row already on the keeper blocks the move', { onKeeperExtra: true });
alone('guard new-style id: a row under the new-style id blocks the move', { newStyle: true });
alone('guard keeper-opening: a keeper with no opening line blocks the move', { opening: null });
alone('guard keeper-closing: a keeper with no closing line blocks the move', { closing: null });
alone('guard keeper-exists: no keeper row blocks the move', { noKeeper: true });
alone('guard old-games-row: a games row still under the old id blocks the move', { staleGames: true });
alone('guard progress: no 2026-11-15 progress row blocks the move', { noProgress: true });
alone('guard progress: a progress row for another date does not stand in for 2026-11-15', { progressDate: '2026-11-16' });
{
  const db = seed({ noRow: true }), before = snap(db, 'odds_history');
  eq('no pinned row at all: nothing is written', [runOne(db), snap(db, 'odds_history') === before], [0, true]);
}

// ── 3. the preconditions refuse what the order did not cover ────────────
const refused = (label, mut, name, drift) => {
  const db = seed(mut);
  if (drift) drift(db);
  const v = evaluate(read(db));
  eq(label, [v.ok, v.checks.filter(c => !c.ok).map(c => c.name).some(n => n.includes(name))], [false, true]);
};
refused('a games row still under the old id is refused', { staleGames: true }, 'exactly one games row');
refused('a third games row for the event is refused', { thirdGames: true }, 'exactly one games row');
refused('a postseason row for the event is refused', { postseason: true }, 'exactly one games row');
refused('an unscored keeper (no home score) is refused', { homeScore: null }, 'exactly one games row');
refused('an unscored keeper (no away score) is refused', { awayScore: null }, 'exactly one games row');
refused('no keeper row is refused', { noKeeper: true }, 'exactly one games row');
refused('a keeper with no opening line (NULL) is refused', { opening: null }, 'opening line');
refused('a keeper with an empty opening line is refused', { opening: '' }, 'opening line');
refused('a keeper with no closing line (NULL) is refused', { closing: null }, 'closing line');
refused('a keeper with an empty closing line is refused', { closing: '' }, 'closing line');
refused('no 2026-11-15 progress row is refused', { noProgress: true }, 'odds_backfill_progress');
refused('a progress row for another date only is refused', { progressDate: '2026-11-16' }, 'odds_backfill_progress');
refused('no history row at all is refused', { noRow: true }, 'history row exists once');
for (const [col, val] of [['sport', 'NFL'], ['date', '2026-11-15'], ['home_team', 'Oklahoma'], ['away_team', 'Ole Miss'], ['commence_time', '2026-11-15T18:00Z'],
                          ['home_ml', 1.69], ['away_ml', 2.25], ['draw_ml', 3.1], ['over_under', 49.5], ['over_price', 1.9], ['under_price', 1.94],
                          ['bookmaker', 'fanduel'], ['snapshot_time', '2026-11-15T11:55:36Z'], ['snapshot_type', 'open'], ['created_at', '2026-11-15 16:51:49']]) {
  refused(`a history row with another ${col} is refused`, { rowOver: { [col]: val } }, 'history row exists once');
}
refused('a row under the new-style id is refused', { newStyle: true }, 'new-style id for the keeper is free');
refused('a history row on some other game id is refused', { rowGame: 'CFB_other' }, 'old game id or on the keeper');
refused('a second history row on the old game id is refused', { onStaleExtra: true }, 'counts agree');
refused('a history row already on the keeper, beside the one before the move, is refused', { onKeeperExtra: true }, 'counts agree');
refused('after the move, a second row on the keeper is refused', { rowGame: KEEPER, onKeeperExtra: true }, 'counts agree');
refused('after the move, a row left on the old game id is refused', { rowGame: KEEPER, onStaleExtra: true }, 'counts agree');
{
  const done = evaluate(read(seed({ rowGame: KEEPER })));
  eq('the done state, on its own, passes', [done.ok, done.phase], [true, 'done']);
  const base = read(seed());
  for (const key of ['postseasonCount', 'onOld', 'onKeeper', 'newStyle']) {
    eq(`evaluate refuses a ${key} that is NaN`, evaluate({ ...base, [key]: NaN }).ok, false);
  }
  // states the real reads cannot produce (the primary key is unique; the progress read is WHERE date = ?) but the interface admits
  eq('evaluate refuses two history rows for the primary key', evaluate({ ...base, rows: [base.rows[0], base.rows[0]] }).ok, false);
  eq('evaluate refuses a progress row that is not 2026-11-15', evaluate({ ...base, progress: [{ date: '2026-11-16' }] }).ok, false);
}

// ── 4. the executor, end to end, against the same SQLite ────────────────
const fakeD1 = (db, hooks = {}) => {
  const calls = { reads: 0, writes: 0 };
  const fn = async (sql, params = []) => {
    const stmt = db.prepare(sql);
    if (/^\s*SELECT/i.test(sql)) { calls.reads++; if (hooks.beforeRead) hooks.beforeRead(calls.reads, calls.writes); return { results: stmt.all(...params), meta: {} }; }
    calls.writes++;
    if (hooks.beforeWrite) { const out = hooks.beforeWrite(calls.writes, sql, params, db); if (out) return out; }
    const r = stmt.run(...params);
    const res = { results: [], meta: { changes: Number(r.changes) } };
    return hooks.afterWrite ? (hooks.afterWrite(calls.writes, res, db) ?? res) : res;
  };
  fn.calls = calls;
  return fn;
};
const go = async (db, { apply = false, hooks } = {}) => {
  const lines = [], d1 = fakeD1(db, hooks);
  const r = await execute({ d1, apply, say: (s) => lines.push(s), now: () => new Date('2026-11-18T12:00:00.000Z'), runId: 'run 1 @ abc' });
  return { ...r, lines: lines.join('\n'), calls: d1.calls };
};
{ // E1 a dry run
  const db = seed(), before = [snap(db, 'odds_history'), snap(db, 'regular_season_games')];
  const r = await go(db);
  eq('executor: a dry run exits 0 as a dry run and issues no write', [r.code, r.kind, r.calls.writes], [0, 'dryrun', 0]);
  eq('executor: and leaves every table as it was', [snap(db, 'odds_history'), snap(db, 'regular_season_games')], before);
  eq('executor: and prints the statement, that nothing was written, and the run identity',
    [/1 repoint the history row/.test(r.lines), /Nothing was written/.test(r.lines), /run 1 @ abc/.test(r.lines)], [true, true, true]);
}
{ // E2 apply, then apply again
  const db = seed();
  const r = await go(db, { apply: true });
  eq('executor: apply writes one row and verifies it', [r.code, r.kind, r.calls.writes, gameOf(db, PK)], [0, 'applied', 1, KEEPER]);
  eq('executor: and says OK only after the re-read', /OK: one row repointed \(changes=1, addressed by primary key\)/.test(r.lines), true);
  const r2 = await go(db, { apply: true });
  eq('executor: a second apply is a no-op that says so', [r2.code, r2.kind, r2.calls.writes], [0, 'already', 0]);
}
{ // E3 refusals before any write, with --apply
  for (const [label, mut] of [['a games row still under the old id', { staleGames: true }], ['a keeper with no opening line', { opening: null }],
                              ['no progress row for 2026-11-15', { noProgress: true }], ['a row under the new-style id', { newStyle: true }],
                              ['a history row already on the keeper', { onKeeperExtra: true }]]) {
    const db = seed(mut), before = snap(db, 'odds_history');
    const r = await go(db, { apply: true });
    eq(`executor: ${label} is refused under --apply, before any write`, [r.code, r.kind, r.calls.writes, snap(db, 'odds_history') === before], [1, 'refused', 0, true]);
  }
}
{ // E4 absent is not zero
  const r = await go(seed(), { apply: true, hooks: { afterWrite: () => ({ results: [], meta: {} }) } });
  eq('executor: a write with no changes count stops the run and says so', [r.code, r.kind, /changes=ABSENT/.test(r.lines)], [1, 'failed', true]);
  const r2 = await go(seed(), { apply: true, hooks: { afterWrite: () => ({ results: [], meta: { changes: '1' } }) } });
  eq('executor: a changes count that is a string is a failure and says what it was', [r2.code, /"1" \(string\)/.test(r2.lines)], [1, true]);
  const r3 = await go(seed(), { apply: true, hooks: { beforeWrite: () => ({ results: [], meta: { changes: 0 } }) } });
  eq('executor: a write that changes 0 rows stops the run', [r3.code, r3.kind], [1, 'failed']);
  const r4 = await go(seed(), { apply: true, hooks: { beforeWrite: () => ({ results: [], meta: { changes: 2 } }) } });
  eq('executor: a write that reports 2 rows stops the run', [r4.code, r4.kind], [1, 'failed']);
}
{ // E5 a statement that throws, then a re-run
  const db = seed();
  const r = await go(db, { apply: true, hooks: { beforeWrite: () => { throw new Error('d1 HTTP 500'); } } });
  eq('executor: a failing statement stops the run and names the error', [r.code, r.kind, /d1 HTTP 500/.test(r.lines), /changes=ABSENT/.test(r.lines)], [1, 'failed', true, false]);
  eq('executor: and the row has not moved', gameOf(db, PK), STALE);
  const r2 = await go(db, { apply: true });
  eq('executor: a re-run then applies it', [r2.code, r2.kind, gameOf(db, PK)], [0, 'applied', KEEPER]);
}
{ // E6 the verdict comes from a re-read
  const r = await go(seed(), { apply: true, hooks: { afterWrite: (n, res, d) => { d.prepare('UPDATE regular_season_games SET home_score = 99 WHERE id = ?').run(KEEPER); return res; } } });
  eq('executor: a games row that changed during the run is a mismatch', [r.code, r.kind], [1, 'mismatch']);
  const r2 = await go(seed(), { apply: true, hooks: { afterWrite: (n, res, d) => { d.prepare('UPDATE odds_history SET home_ml = 9 WHERE id = ?').run(PK); return res; } } });
  eq('executor: a column of the row that changed during the run is a mismatch', [r2.code, r2.kind], [1, 'mismatch']);
  const r3 = await go(seed(), { apply: true, hooks: { afterWrite: (n, res, d) => { d.prepare('UPDATE odds_history SET game_id = ? WHERE id = ?').run('CFB_other', PK); return res; } } });
  eq('executor: a row that is not on the keeper after the run is a mismatch', [r3.code, r3.kind], [1, 'mismatch']);
}

{ // E7 a re-read that fails after the write has landed
  const db = seed();
  const r = await go(db, { apply: true, hooks: { beforeRead: (reads, writes) => { if (writes >= 1) throw new Error('d1 HTTP 503'); } } });
  eq('executor: a re-read that fails after the write says the write landed, and what to do', [r.code, r.kind, /the write reported changes=1 but the re-read failed: d1 HTTP 503/.test(r.lines), /prints ALREADY DONE/.test(r.lines)], [1, 'failed', true, true]);
  eq('executor: and the row has moved, and a re-run says so without writing', [gameOf(db, PK), (await go(db, { apply: true })).kind], [KEEPER, 'already']);
}

// ── 5. absence is not zero, and the wire format ─────────────────────────
{
  const resp = (status, body) => async () => ({ ok: status < 400, status, text: async () => body });
  eq('relayD1: a body that is not JSON is a failure', /body is not JSON/.test(await throws(() => relayD1('s', resp(200, '<html>x</html>'))('SELECT 1')) ?? ''), true);
  eq('relayD1: a body that is JSON null is a failure', /not an object/.test(await throws(() => relayD1('s', resp(200, 'null'))('SELECT 1')) ?? ''), true);
  eq('relayD1: a success body with no results array leaves results missing', (await relayD1('s', resp(200, '{"success":true}'))('SELECT 1')).results, undefined);
  eq('relayD1: a success body with no meta leaves meta missing', (await relayD1('s', resp(200, '{"success":true,"results":[]}'))('UPDATE t SET a = 1')).meta, undefined);
  eq('relayD1: success:false is a failure even on HTTP 200', /d1 HTTP 200/.test(await throws(() => relayD1('s', resp(200, '{"success":false}'))('SELECT 1')) ?? ''), true);
  eq('relayD1: an HTTP error status is a failure even when the body says success', /d1 HTTP 500/.test(await throws(() => relayD1('s', resp(500, '{"success":true,"results":[]}'))('SELECT 1')) ?? ''), true);
  eq('relayD1: a 401 text body is a failure', /d1 HTTP 401/.test(await throws(() => relayD1('s', resp(401, 'unauthorized'))('SELECT 1')) ?? ''), true);
  eq('relayD1: no secret means no call', /RELAY_SHARED_SECRET is not set/.test(await throws(() => relayD1('', resp(200, '{}'))('SELECT 1')) ?? ''), true);
  let seen = null;
  await relayD1('sekrit', async (url, init) => { seen = { url, init }; return { ok: true, status: 200, text: async () => '{"success":true,"results":[],"meta":{"changes":1}}' }; })('UPDATE t SET a = ?', [1]);
  eq('relayD1: the request is a POST to /d1/execute with the secret header, the sql, the params and a timeout',
    [seen.url.endsWith('/d1/execute'), seen.init.method, seen.init.headers['X-FIELD-Relay'], JSON.parse(seen.init.body), seen.init.signal instanceof AbortSignal],
    [true, 'POST', 'sekrit', { sql: 'UPDATE t SET a = ?', params: [1] }, true]);
  const full = { row: [], onOld: [{ n: 1 }], onKeeper: [{ n: 0 }], newStyle: [{ n: 0 }], games: [], postseason: [{ n: 0 }], progress: [] };
  for (const k of Object.keys(full)) {
    const cut = { ...full }; delete cut[k];
    eq(`stateFrom: a read that returned no array throws (${k})`, /returned no result array/.test(await throws(() => stateFrom(cut)) ?? ''), true);
  }
  eq('stateFrom: a count read with no rows is NaN', Number.isNaN(stateFrom({ ...full, onOld: [] }).onOld), true);
  eq('executor: a read with no results array throws instead of reading an empty archive',
    /returned no result array/.test(await throws(() => execute({ d1: async () => ({ meta: {} }), say: () => {} })) ?? ''), true);
}

// ── 6. the real CLI, as a child process, against a relay stand-in ───────
{
  const SECRET = 'test-secret-do-not-use';
  const startRelay = (db) => new Promise((resolve) => {
    const seen = { posts: 0, writes: 0, bodies: [], headers: [] };
    const srv = createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
        if (req.method === 'POST' && req.url === '/d1/execute') {
          seen.posts++; seen.headers.push(req.headers['x-field-relay'] ?? null);
          if (req.headers['x-field-relay'] !== SECRET) { res.writeHead(401); return res.end('unauthorized'); }
          const { sql, params } = JSON.parse(body); seen.bodies.push({ sql, params });
          const table = firstTable(sql);
          if (table && !allowed.includes(table)) return send(403, { ok: false, error: 'table not allowed', table });
          try {
            const stmt = db.prepare(sql);
            if (/^\s*SELECT/i.test(sql)) return send(200, { success: true, results: stmt.all(...(params || [])), meta: {} });
            seen.writes++;
            const r = stmt.run(...(params || []));
            return send(200, { success: true, results: [], meta: { changes: Number(r.changes) } });
          } catch (e) { return send(500, { ok: false, error: e.message }); }
        }
        send(404, { error: 'no route' });
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise(r => srv.close(r)) }));
  });
  const runCli = (args, env, cwd) => new Promise((resolve) => {
    const p = spawn(process.execPath, ['--no-warnings', CLI, ...args], { cwd, env: { ...process.env, RELAY_SHARED_SECRET: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.on('close', code => resolve({ code, out }));
  });
  const logs = (cwd) => { try { return readdirSync(join(cwd, 'outbox')); } catch { return []; } };

  const db = seed();
  const relay = await startRelay(db);
  const cwd = mkdtempSync(join(tmpdir(), 'repoint-cli-'));
  temps.push(cwd);
  const before = [snap(db, 'odds_history'), snap(db, 'regular_season_games')];

  const dry = await runCli([], { RELAY_BASE: relay.base, RELAY_SHARED_SECRET: SECRET }, cwd);
  eq('cli: with no flag it is a dry run: exit 0, no write reached the relay, the tables are unchanged',
    [dry.code, relay.seen.writes, JSON.stringify([snap(db, 'odds_history'), snap(db, 'regular_season_games')]) === JSON.stringify(before), /DRY RUN/.test(dry.out)], [0, 0, true, true]);
  eq('cli: the dry run left a log named for its outcome, holding what was printed',
    [logs(cwd).some(f => /^oklahoma-odds-history-repoint-dryrun-.*\.log$/.test(f)), logs(cwd).some(f => /-running-/.test(f)),
     /=== oklahoma odds_history repoint/.test(readFileSync(join(cwd, 'outbox', logs(cwd).find(f => /dryrun/.test(f))), 'utf8'))], [true, false, true]);

  const postsBefore = relay.seen.posts;
  const nosecret = await runCli(['--apply'], { RELAY_BASE: relay.base }, cwd);
  eq('cli: with no secret it refuses before any call', [nosecret.code, relay.seen.posts - postsBefore, /RELAY_SHARED_SECRET is not set/.test(nosecret.out)], [1, 0, true]);
  const wrong = await runCli(['--apply'], { RELAY_BASE: relay.base, RELAY_SHARED_SECRET: 'wrong' }, cwd);
  eq('cli: a wrong secret is a 401, a failure and no write', [wrong.code, relay.seen.writes, /d1 HTTP 401/.test(wrong.out)], [1, 0, true]);

  const applied = await runCli(['--apply'], { RELAY_BASE: relay.base, RELAY_SHARED_SECRET: SECRET, GITHUB_RUN_ID: '4242', GITHUB_SHA: 'abcdef0123456789' }, cwd);
  eq('cli: --apply writes the one row and nothing else', [applied.code, relay.seen.writes, gameOf(db, PK)], [0, 1, KEEPER]);
  eq('cli: the log names the run and its outcome', [/run 4242 @ abcdef012345/.test(applied.out), logs(cwd).some(f => /^oklahoma-odds-history-repoint-applied-.*\.log$/.test(f))], [true, true]);
  eq('cli: the secret header is on every call and only UPDATEs of odds_history and SELECTs went over the wire',
    [relay.seen.headers.filter(h => h === SECRET).length > 0, relay.seen.bodies.every(b => /^(SELECT|UPDATE odds_history) /.test(b.sql))], [true, true]);
  const writesAfter = relay.seen.writes;
  const again = await runCli(['--apply'], { RELAY_BASE: relay.base, RELAY_SHARED_SECRET: SECRET }, cwd);
  eq('cli: a second --apply is a no-op that says so', [again.code, relay.seen.writes - writesAfter, /ALREADY DONE/.test(again.out)], [0, 0, true]);
  await relay.close();
  // the secret must not appear in any run's console (the right one or the wrong one) or in any log file the workflow commits
  const everything = [dry.out, nosecret.out, wrong.out, applied.out, again.out, ...logs(cwd).map(f => readFileSync(join(cwd, 'outbox', f), 'utf8'))].join('\n');
  eq('cli: no run prints the secret, in the console or in a log file (5 runs, every log)', [everything.includes(SECRET), everything.includes('wrong'), logs(cwd).length >= 4], [false, false, true]);
}

// ── 7. the workflow that dispatches it ──────────────────────────────────
{
  const WF = '.github/workflows/repoint-oklahoma-odds-history.yml';
  const wf = readFileSync(WF, 'utf8');
  const stepBlock = (name) => {
    const at = wf.indexOf(`- name: ${name}`);
    if (at < 0) return '';
    const next = wf.indexOf('\n      - ', at + 4);
    return wf.slice(at, next < 0 ? undefined : next);
  };
  const count = (re) => { const m = wf.match(re); return m === null ? 0 : m.length; };
  eq('workflow: the apply input defaults to a dry run (a plain click on Run workflow must not apply)', [/^\s+default: 'dry-run'\s*$/m.test(wf), /default: 'APPLY'/.test(wf)], [true, false]);
  eq('workflow: the plan step comes before Run, and Run before the log step',
    [wf.indexOf('- name: The plan must pass') > 0, wf.indexOf('- name: The plan must pass') < wf.indexOf('- name: Run'), wf.indexOf('- name: Run') < wf.indexOf('- name: Commit the log')], [true, true, true]);
  eq('workflow: the secret appears once, in the Run step', [count(/^.*RELAY_SHARED_SECRET.*$/gm), stepBlock('Run').includes('RELAY_SHARED_SECRET')], [1, true]);
  eq('workflow: the expressions are exactly the secret and the apply input, in that order',
    (wf.match(/\$\{\{[^}]*\}\}/g) ?? []).map(x => x.replace(/\s+/g, ' ')), ['${{ secrets.RELAY_SHARED_SECRET }}', '${{ github.event.inputs.apply }}']);
  eq('workflow: permissions are contents: write and nothing else', [count(/^permissions:/gm), /^permissions:\n  contents: write\n\n/m.test(wf), count(/^[ \t]+permissions:/gm)], [1, true, 0]);
  eq('workflow: env is set in the Run step only', count(/^[ \t]*env:[ \t]*$/gm), 1);
  eq('workflow: dispatch only, no push, schedule or pull_request trigger', [/^\s*workflow_dispatch:/m.test(wf), /^\s*(push|schedule|pull_request|workflow_run):/m.test(wf)], [true, false]);
  eq('workflow: the job runs only on main (the log step pushes to main)', /^\s+if: github\.ref == 'refs\/heads\/main'/m.test(wf), true);
  eq('workflow: one run at a time, and a running one is never cancelled', [/^\s+group: oklahoma-odds-history-repoint\s*$/m.test(wf), /^\s+cancel-in-progress: false\s*$/m.test(wf)], [true, true]);
  eq('workflow: Node 22 is pinned (node:sqlite)', /node-version: '22'/.test(wf), true);
  eq('workflow: the job declares a timeout', /^\s+timeout-minutes: \d+/m.test(wf), true);
  eq('workflow: the secret is in the Run step only',
    [stepBlock('Run').includes('RELAY_SHARED_SECRET'), stepBlock('The plan must pass').includes('RELAY_SHARED_SECRET'), stepBlock('Commit the log').includes('RELAY_SHARED_SECRET')], [true, false, false]);
  eq('workflow: the apply input reaches the shell through env, never by interpolation into the script',
    [/APPLY_INPUT: \$\{\{ github\.event\.inputs\.apply \}\}/.test(stepBlock('Run')), (stepBlock('Run').split('run: |')[1] ?? '').includes('${{')], [true, false]);
  eq('workflow: only this workflow\'s own log is staged', /PROBE_PATHS="outbox\/oklahoma-odds-history-repoint-\*\.log"/.test(stepBlock('Commit the log')), true);
  eq('workflow: the log step runs even when an earlier step failed', /if: always\(\)/.test(stepBlock('Commit the log')), true);
  eq('workflow: the checked-in plan is what runs (a clean tree is asserted between the checks and the run)', /git diff --exit-code/.test(stepBlock('The plan must pass')), true);
  eq('workflow: it runs this check and this harness, and the script it applies is this one',
    [/check-repoint-oklahoma-odds-history\.mjs/.test(stepBlock('The plan must pass')), /mutate-repoint-oklahoma-odds-history\.mjs/.test(stepBlock('The plan must pass')), /scripts\/repoint-oklahoma-odds-history\.mjs/.test(stepBlock('Run'))], [true, true, true]);

  const runBlock = (stepBlock('Run').split('run: |')[1] ?? '').split('\n').filter(l => l.trim() !== '');
  const indent = Math.min(...runBlock.map(l => l.match(/^ */)[0].length));
  const script = runBlock.map(l => l.slice(indent)).join('\n');
  const dir = mkdtempSync(join(tmpdir(), 'repoint-wf-'));
  temps.push(dir);
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin', 'node'), `#!/bin/sh\necho "$@" >> "${dir}/args.txt"\n`);
  chmodSync(join(dir, 'bin', 'node'), 0o755);
  const gate = (value) => {
    writeFileSync(join(dir, 'args.txt'), '');
    const env = { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` };
    if (value === undefined) delete env.APPLY_INPUT; else env.APPLY_INPUT = value;
    const r = spawnSync('bash', ['-e', '-c', script], { env, encoding: 'utf8' });
    const args = readFileSync(join(dir, 'args.txt'), 'utf8').trim();
    return [r.status, args.includes('--apply'), args.includes('repoint-oklahoma-odds-history.mjs')];
  };
  eq('workflow gate: the literal APPLY adds --apply', gate('APPLY'), [0, true, true]);
  for (const v of ['dry-run', '', 'apply', 'Apply', 'APPLY ', ' APPLY', 'APPLY;touch x', 'true', 'yes', '--apply']) {
    eq(`workflow gate: ${JSON.stringify(v)} is a dry run`, gate(v), [0, false, true]);
  }
  eq('workflow gate: no input at all is a dry run', gate(undefined), [0, false, true]);
}

for (const d of temps) rmSync(d, { recursive: true, force: true });
console.log(`\n${checked - failed}/${checked} checks passed`);
process.exit(failed ? 1 : 0);
