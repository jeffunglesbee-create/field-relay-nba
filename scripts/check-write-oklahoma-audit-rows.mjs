#!/usr/bin/env node
// Rule 90 for scripts/write-oklahoma-audit-rows.mjs.
//
// Two append-only INSERTs into change_log, one statement per /d1/execute call.
// Nothing here can delete or overwrite, so the assertions are about the three ways
// it could still go wrong: writing an entry that is wrong (a blob that is not what
// the row held), writing it twice, or reporting done when it is not.
//
// Run against a real SQLite (node:sqlite), seeded with the rows as they stand in
// D1. The executor is driven twice: through a function stand-in for /d1/execute,
// and as a real child process against a local HTTP server that speaks the relay's
// wire format, so the dry-run default, the secret header, the request shape and the
// log file are exercised, not read. Every guard is tested on its own.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, chmodSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEEPER, STALE, EVENT, SOURCE, OPEN_LOG, CLOSE_LOG, DELETED_ROW, CLOSING_BLOB, BASELINE,
         expectedDeletion, readQueries, stateFrom, evaluate, buildStatements, execute, relayD1 } from './write-oklahoma-audit-rows.mjs';

const { allowedTables } = createRequire(import.meta.url)('./lib/allowed-tables.cjs');
const CLI = fileURLToPath(new URL('./write-oklahoma-audit-rows.mjs', import.meta.url));

let checked = 0, failed = 0;
const eq = (label, got, want) => {
  checked++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
const throws = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const temps = [];   // every temp directory this check makes, removed at the end (the harness runs it once per mutant)

const TS = '2026-11-18T12:00:00.000Z';
// The keeper's line, as it stands in D1 (277 characters; identical to change_log 26626's new_value).
const LINE = '{"source":"draftkings","captured_at":"2026-11-14T10:02:07.610Z","_oddsProof":{"adapterId":"odds-api","sourceId":"odds-api-the-odds-api"},"moneyline":{"home":-142,"away":120},"spread":{"home":-2.5,"away":2.5,"homePrice":-115,"awayPrice":-105},"total":{"over":49.5,"under":49.5}}';

function seed(mut = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE regular_season_games (id TEXT PRIMARY KEY, espn_event_id TEXT, home_score INTEGER, away_score INTEGER, opening_odds TEXT, closing_odds TEXT);
           CREATE TABLE postseason_games (id TEXT PRIMARY KEY, espn_event_id TEXT);
           CREATE TABLE change_log (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT, source TEXT, field TEXT, old_value TEXT, new_value TEXT, ts TEXT, consumed INTEGER DEFAULT 0);
           CREATE TABLE odds_history (id TEXT PRIMARY KEY, game_id TEXT);`);
  const games = db.prepare('INSERT INTO regular_season_games (id, espn_event_id, home_score, away_score, opening_odds, closing_odds) VALUES (?,?,?,?,?,?)');
  if (!mut.noKeeper) games.run(KEEPER, EVENT, 'homeScore' in mut ? mut.homeScore : 24, 17, 'keeperLine' in mut ? mut.keeperLine : LINE, '{"closing":"keeper"}');
  games.run('CFB_2026-11-15_e999', '999', null, null, null, null);
  if (mut.staleRow) games.run(STALE, EVENT, null, null, LINE, '{}');
  if (mut.thirdRow) games.run('CFB_2026-11-13_e401856887', EVENT, null, null, null, null);
  if (mut.postseason) db.prepare('INSERT INTO postseason_games (id, espn_event_id) VALUES (?,?)').run('p1', EVENT);
  const log = db.prepare('INSERT INTO change_log (id, game_id, source, field, old_value, new_value, ts) VALUES (?,?,?,?,?,?,?)');
  const o = { id: OPEN_LOG, game_id: STALE, source: 'odds_api', field: 'opening_odds', old: null, nv: LINE, ...(mut.open || {}) };
  const c = { id: CLOSE_LOG, game_id: STALE, source: 'odds_backfill', field: 'closing_odds', old: null, nv: CLOSING_BLOB, ...(mut.close || {}) };
  if (!mut.noOpenLog) log.run(o.id, o.game_id, o.source, o.field, o.old, o.nv, '2026-11-14T10:02:07.784Z');
  if (!mut.noCloseLog) log.run(c.id, c.game_id, c.source, c.field, c.old, c.nv, '2026-11-15 16:51:48');
  for (let i = 0; i < (mut.keeperLogs ?? 1); i++) log.run(26734 + i, KEEPER, 'archive_game_closing', 'closing_odds', null, '{}', '2026-11-15 21:15:32');
  for (let i = 0; i < (mut.extraStaleLogs ?? 0); i++) log.run(30000 + i, STALE, 'odds_api', 'opening_odds', null, '{}', '2026-11-14');
  for (let i = 0; i < (mut.history ?? 1); i++) db.prepare('INSERT INTO odds_history (id, game_id) VALUES (?,?)').run(`h${i}`, STALE);
  return db;
}
const read = (db) => {
  const out = {};
  for (const [k, v] of Object.entries(readQueries())) out[k] = db.prepare(v.sql).all(...v.params);
  return stateFrom(out);
};
const stmts = buildStatements({ ts: TS });
const runOne = (db, i) => Number(db.prepare(stmts[i].sql).run(...stmts[i].params).changes);
const run = (db) => stmts.map((s, i) => runOne(db, i));
const snap = (db, table) => JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
const own = (db) => db.prepare('SELECT game_id, source, field, old_value, new_value, ts FROM change_log WHERE source = ? ORDER BY id').all(SOURCE);

// ── 0. the plan as written ──────────────────────────────────────────────
eq('two statements, the copy entry then the deletion entry', stmts.map(s => s.name.split(' ')[0]), ['1', '2']);
eq('every statement binds exactly as many parameters as it has placeholders', stmts.map(s => (s.sql.match(/\?/g) || []).length === s.params.length), [true, true]);
eq('no id, blob or timestamp is interpolated into the SQL text',
  stmts.some(s => [KEEPER, STALE, TS, CLOSING_BLOB, LINE, '26626', '26722'].some(x => s.sql.includes(x))), false);
eq('every statement is an INSERT into change_log and nothing else (no UPDATE, no DELETE)',
  stmts.map(s => /^INSERT INTO change_log /.test(s.sql) && !/\b(UPDATE|DELETE)\b/i.test(s.sql)), [true, true]);
const allowed = allowedTables(readFileSync('src/index.js', 'utf8'));
const firstTable = (sql) => sql.match(/(?:INTO|FROM|UPDATE|TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+(\w+)/i)?.[1];
eq('the /d1/execute table guard admits every statement and every read (its own regex, its own list)',
  [...stmts.map(s => s.sql), ...Object.values(readQueries()).map(q => q.sql)].map(sql => allowed.includes(firstTable(sql))).every(Boolean), true);
eq('the allow-list parsed at all', allowed.length > 5, true);
eq('the pinned facts are what the owner\'s order and the D1 read said',
  [KEEPER, STALE, EVENT, SOURCE, OPEN_LOG, CLOSE_LOG, DELETED_ROW, BASELINE],
  ['CFB_2026-11-15_e401856887', 'CFB_2026-11-14_e401856887', '401856887', 'archive_duplicate_merge', 26626, 26722,
   { table: 'regular_season_games', date: '2026-11-14', sport: 'CFB', league: 'CFB', home: 'Oklahoma', away: 'Ole Miss', venue: 'Memorial Stadium (Norman, OK)',
     espn_event_id: '401856887', start_time: '2026-11-15T18:00Z', created_at: '2026-11-14 10:01:36' },
   { stale_change_log: 2, keeper_change_log: 1, stale_odds_history: 1 }]);
eq('the closing blob is the text the old row was read with',
  CLOSING_BLOB, '{"source":"draftkings","captured_at":"2026-11-14T23:55:04Z","moneyline":{"home":-147,"away":124},"total":{"over":48.5,"under":48.5},"_kickoff":{"at":"2026-11-15T18:00Z","verified":true,"late_minutes":null}}');
eq('the pinned facts are frozen', [Object.isFrozen(DELETED_ROW), Object.isFrozen(BASELINE)], [true, true]);

// ── 1. a fresh run writes exactly the two entries ───────────────────────
{
  const db = seed();
  const ev = evaluate(read(db));
  eq('fresh: every precondition holds', [ev.ok, ev.phase, ev.checks.filter(c => !c.ok).map(c => c.name)], [true, 'fresh', []]);
  const games = snap(db, 'regular_season_games'), hist = snap(db, 'odds_history');
  const logBefore = db.prepare('SELECT * FROM change_log ORDER BY id').all();
  eq('fresh: each statement writes exactly one row', run(db), [1, 1]);
  const rows = own(db);
  eq('fresh: the entries are the copy on the keeper and the row_deleted on the old id',
    rows.map(r => [r.game_id, r.source, r.field]), [[KEEPER, SOURCE, 'opening_odds'], [STALE, SOURCE, 'row_deleted']]);
  eq('fresh: the copy entry is a first population carrying the line, stamped with the run\'s time', [rows[0].old_value, rows[0].new_value, rows[0].ts], [null, LINE, TS]);
  eq('fresh: the deletion entry carries the removed row exactly, key for key, and names the keeper',
    [JSON.stringify(JSON.parse(rows[1].old_value)), rows[1].new_value, rows[1].ts], [JSON.stringify(expectedDeletion(LINE)), KEEPER, TS]);
  eq('fresh: both blobs inside the deletion entry equal the rows they came from',
    [JSON.parse(rows[1].old_value).opening_odds === db.prepare('SELECT new_value FROM change_log WHERE id = ?').get(OPEN_LOG).new_value,
     JSON.parse(rows[1].old_value).closing_odds === db.prepare('SELECT new_value FROM change_log WHERE id = ?').get(CLOSE_LOG).new_value], [true, true]);
  eq('fresh: the games table and odds_history are untouched', [snap(db, 'regular_season_games'), snap(db, 'odds_history')], [games, hist]);
  eq('fresh: every change_log row that existed is byte-identical',
    JSON.stringify(db.prepare(`SELECT * FROM change_log WHERE source <> ? ORDER BY id`).all(SOURCE)), JSON.stringify(logBefore));
  eq('fresh: the new entries carry consumed 0', db.prepare('SELECT consumed FROM change_log WHERE source = ?').all(SOURCE).map(r => r.consumed), [0, 0]);
  const after = evaluate(read(db));
  eq('fresh: the state now reads done and passes every precondition', [after.ok, after.phase], [true, 'done']);
  eq('idempotent: a second run writes nothing', run(db), [0, 0]);
  eq('idempotent: and the table still holds exactly two of this plan\'s rows', own(db).length, 2);
}

// ── 2. every guard of each statement bites on its own ───────────────────
const alone = (label, i, mut, drift) => {
  const db = seed(mut);
  if (drift) drift(db);
  eq(label, runOne(db, i), 0);
};
alone('guard 1: a keeper whose line differs from change_log 26626 gets no copy entry', 0, { keeperLine: '{"other":1}' });
alone('guard 1: a keeper with no line gets no copy entry', 0, { keeperLine: null });
alone('guard 1: change_log 26626 on another game id gives no copy entry', 0, { open: { game_id: 'CFB_other' } });
alone('guard 1: change_log 26626 with another field gives no copy entry', 0, { open: { field: 'closing_odds' } });
alone('guard 1: no change_log 26626 gives no copy entry', 0, { noOpenLog: true });
alone('guard 1: no keeper row gives no copy entry', 0, { noKeeper: true });
{
  const db = seed(); runOne(db, 0);
  eq('guard 1: a second run writes no second copy entry', runOne(db, 0), 0);
}
alone('guard 2: a closing log whose text differs gives no deletion entry', 1, { close: { nv: CLOSING_BLOB.replace('-147', '-148') } });
alone('guard 2: a closing log on another game id gives no deletion entry', 1, { close: { game_id: 'CFB_other' } });
alone('guard 2: no change_log 26722 gives no deletion entry', 1, { noCloseLog: true });
alone('guard 2: an opening log that differs from the keeper\'s line gives no deletion entry', 1, { open: { nv: '{"other":1}' } });
alone('guard 2: an opening log on another game id gives no deletion entry', 1, { open: { game_id: 'CFB_other' } });
alone('guard 2: a keeper with no line gives no deletion entry', 1, { keeperLine: null });
alone('guard 2: a games row that still exists under the old id gives no deletion entry', 1, { staleRow: true });
{
  const db = seed(); runOne(db, 1);
  eq('guard 2: a second run writes no second deletion entry', runOne(db, 1), 0);
}
{
  // interrupted after either statement: the state reads partial, passes, and a re-run completes it
  const a = seed(); runOne(a, 0);
  const va = evaluate(read(a));
  eq('interrupted after the copy entry: partial, and it passes', [va.phase, va.ok], ['partial', true]);
  eq('and re-running completes it, writing only the missing entry', run(a), [0, 1]);
  const b = seed(); runOne(b, 1);
  const vb = evaluate(read(b));
  eq('interrupted after the deletion entry: partial, and it passes', [vb.phase, vb.ok], ['partial', true]);
  eq('and re-running completes it, writing only the missing entry', run(b), [1, 0]);
}

// ── 3. the preconditions refuse what the order did not cover ────────────
const refused = (label, mut, name, drift) => {
  const db = seed(mut);
  if (drift) drift(db);
  const v = evaluate(read(db));
  eq(label, [v.ok, v.checks.filter(c => !c.ok).map(c => c.name).some(n => n.includes(name))], [false, true]);
};
refused('a games row still under the old id is refused', { staleRow: true }, 'exactly one row');
refused('a third row for the event is refused', { thirdRow: true }, 'exactly one row');
refused('a postseason row for the event is refused', { postseason: true }, 'exactly one row');
refused('an unscored keeper (no home score) is refused', { homeScore: null }, 'exactly one row');
refused('no keeper row is refused', { noKeeper: true }, 'exactly one row');
refused('a keeper with no line is refused', { keeperLine: null }, 'holds an opening line');
refused('a keeper whose line is not change_log 26626\'s is refused', { keeperLine: '{"other":1}' }, 'change_log 26626');
refused('change_log 26626 on another source is refused', { open: { source: 'manual' } }, 'change_log 26626');
refused('change_log 26626 on another field is refused', { open: { field: 'closing_odds' } }, 'change_log 26626');
refused('change_log 26626 on another game id is refused', { open: { game_id: KEEPER } }, 'change_log 26626');
refused('a missing change_log 26626 is refused', { noOpenLog: true }, 'change_log 26626');
refused('change_log 26722 with different text is refused', { close: { nv: CLOSING_BLOB + ' ' } }, 'change_log 26722');
refused('change_log 26722 on another source is refused', { close: { source: 'manual' } }, 'change_log 26722');
refused('change_log 26722 on another field is refused', { close: { field: 'opening_odds' } }, 'change_log 26722');
refused('change_log 26722 on another game id is refused', { close: { game_id: KEEPER } }, 'change_log 26722');
refused('a missing change_log 26722 is refused', { noCloseLog: true }, 'change_log 26722');
refused('a third change_log row on the old id is refused (the order was given against two)', { extraStaleLogs: 1 }, 'change_log is the state the apply left');
refused('no change_log row on the keeper is refused', { keeperLogs: 0 }, 'change_log is the state the apply left');
refused('a second change_log row on the keeper is refused', { keeperLogs: 2 }, 'change_log is the state the apply left');
refused('a second odds_history row on the old id is refused', { history: 2 }, 'at most the one odds_history row');
{
  // the state after the 2026-11-18 repoint: the one history row now sits on the keeper, none on the old id
  const db = seed({ history: 0 });
  db.prepare('INSERT INTO odds_history (id, game_id) VALUES (?,?)').run('h0', KEEPER);
  const v = evaluate(read(db));
  eq('after the repoint (no odds_history row on the old id) every precondition still holds', [v.ok, v.phase, v.checks.filter(c => !c.ok).map(c => c.name)], [true, 'fresh', []]);
}
refused('another row of this plan\'s source is refused', {}, 'change_log is the state the apply left',
  (db) => db.prepare(`INSERT INTO change_log (game_id, source, field, old_value, new_value, ts) VALUES (?, ?, 'closing_odds', NULL, '{}', ?)`).run(KEEPER, SOURCE, TS));
refused('two copy entries are refused', {}, 'at most once',
  (db) => { runOne(db, 0); db.prepare(`INSERT INTO change_log (game_id, source, field, old_value, new_value, ts) VALUES (?, ?, 'opening_odds', NULL, ?, ?)`).run(KEEPER, SOURCE, LINE, TS); });
refused('two deletion entries are refused', {}, 'at most once',
  (db) => { runOne(db, 1); db.prepare(`INSERT INTO change_log (game_id, source, field, old_value, new_value, ts) VALUES (?, ?, 'row_deleted', '{}', ?, ?)`).run(STALE, SOURCE, KEEPER, TS); });
refused('a copy entry that carries another line is refused', {}, 'copy entry',
  (db) => db.prepare(`INSERT INTO change_log (game_id, source, field, old_value, new_value, ts) VALUES (?, ?, 'opening_odds', NULL, '{"other":1}', ?)`).run(KEEPER, SOURCE, TS));
refused('a copy entry with an old value is refused', {}, 'copy entry',
  (db) => db.prepare(`INSERT INTO change_log (game_id, source, field, old_value, new_value, ts) VALUES (?, ?, 'opening_odds', 'x', ?, ?)`).run(KEEPER, SOURCE, LINE, TS));
const gone = (oldValue, newValue = KEEPER) => (db) => db.prepare(`INSERT INTO change_log (game_id, source, field, old_value, new_value, ts) VALUES (?, ?, 'row_deleted', ?, ?, ?)`).run(STALE, SOURCE, oldValue, newValue, TS);
refused('a deletion entry that is not JSON is refused', {}, 'deletion entry', gone('not json'));
refused('a deletion entry that does not name the keeper is refused', {}, 'deletion entry', gone(JSON.stringify(expectedDeletion(LINE)), 'CFB_other'));
refused('a deletion entry with another closing blob is refused', {}, 'deletion entry', gone(JSON.stringify({ ...expectedDeletion(LINE), closing_odds: '{}' })));
refused('a deletion entry with another opening blob is refused', {}, 'deletion entry', gone(JSON.stringify({ ...expectedDeletion(LINE), opening_odds: '{}' })));
for (const col of Object.keys(DELETED_ROW)) {
  refused(`a deletion entry with another ${col} is refused`, {}, 'deletion entry', gone(JSON.stringify({ ...expectedDeletion(LINE), [col]: 'zzz' })));
}
refused('a deletion entry with a missing key is refused', {}, 'deletion entry', gone(JSON.stringify((({ venue, ...rest }) => rest)(expectedDeletion(LINE)))));
{
  const base = read(seed());
  for (const [key, st] of [['postseasonCount', { ...base, postseasonCount: NaN }], ['historyStale', { ...base, historyStale: NaN }]]) {
    eq(`evaluate refuses a ${key} that is NaN`, evaluate(st).ok, false);
  }
}

// ── 4. the executor, end to end, against the same SQLite ────────────────
const fakeD1 = (db, hooks = {}) => {
  const calls = { reads: 0, writes: 0 };
  const fn = async (sql, params = []) => {
    const stmt = db.prepare(sql);
    if (/^\s*SELECT/i.test(sql)) { calls.reads++; return { results: stmt.all(...params), meta: {} }; }
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
  const r = await execute({ d1, apply, say: (s) => lines.push(s), now: () => new Date(TS), runId: 'run 1 @ abc' });
  return { ...r, lines: lines.join('\n'), calls: d1.calls };
};
{ // E1 a dry run
  const db = seed(), before = [snap(db, 'change_log'), snap(db, 'regular_season_games')];
  const r = await go(db);
  eq('executor: a dry run exits 0 as a dry run and issues no write', [r.code, r.kind, r.calls.writes], [0, 'dryrun', 0]);
  eq('executor: and leaves every table as it was', [snap(db, 'change_log'), snap(db, 'regular_season_games')], before);
  eq('executor: and prints both statements, that nothing was written, and the run identity',
    [/1 the copy entry/.test(r.lines) && /2 the row_deleted entry/.test(r.lines), /Nothing was written/.test(r.lines), /run 1 @ abc/.test(r.lines)], [true, true, true]);
}
{ // E2 apply, then apply again
  const db = seed();
  const r = await go(db, { apply: true });
  eq('executor: apply writes two rows and verifies them', [r.code, r.kind, r.calls.writes, own(db).length], [0, 'applied', 2, 2]);
  eq('executor: and says OK only after the re-read', /OK: two entries written, once each/.test(r.lines), true);
  const r2 = await go(db, { apply: true });
  eq('executor: a second apply is a no-op that says so', [r2.code, r2.kind, r2.calls.writes], [0, 'already', 0]);
  // THE REAL SEQUENCE: the entries were written, then the history row was repointed to the keeper. A re-dispatch must
  // still read the state as done instead of refusing (and committing a refused log).
  db.prepare('UPDATE odds_history SET game_id = ?').run(KEEPER);
  const r3 = await go(db, { apply: true });
  eq('executor: after the repoint a re-dispatch still reads ALREADY DONE and writes nothing', [r3.code, r3.kind, r3.calls.writes, /ALREADY DONE/.test(r3.lines)], [0, 'already', 0, true]);
}
{ // E3 refusals before any write, with --apply
  for (const [label, mut] of [['a games row still under the old id', { staleRow: true }], ['a keeper line that is not change_log 26626\'s', { keeperLine: '{"x":1}' }],
                              ['a changed closing log', { close: { nv: '{}' } }], ['an extra change_log row on the old id', { extraStaleLogs: 1 }]]) {
    const r = await go(seed(mut), { apply: true });
    eq(`executor: ${label} is refused under --apply, before any write`, [r.code, r.kind, r.calls.writes], [1, 'refused', 0]);
  }
}
{ // E4 absent is not zero
  const r = await go(seed(), { apply: true, hooks: { afterWrite: (n, res) => (n === 1 ? { results: [], meta: {} } : res) } });
  eq('executor: a write with no changes count stops the run, says so, and issues no second write', [r.code, r.kind, /changes=ABSENT/.test(r.lines), r.calls.writes], [1, 'failed', true, 1]);
  const r2 = await go(seed(), { apply: true, hooks: { afterWrite: (n, res) => (n === 1 ? { results: [], meta: { changes: '1' } } : res) } });
  eq('executor: a changes count that is a string is a failure and says what it was', [r2.code, /"1" \(string\)/.test(r2.lines)], [1, true]);
  const r3 = await go(seed(), { apply: true, hooks: { beforeWrite: (n) => (n === 1 ? { results: [], meta: { changes: 0 } } : null) } });
  eq('executor: a fresh write that changes 0 rows stops the run', [r3.code, r3.kind], [1, 'failed']);
  const r4 = await go(seed(), { apply: true, hooks: { beforeWrite: (n) => (n === 1 ? { results: [], meta: { changes: 2 } } : null) } });
  eq('executor: a write that reports 2 rows stops the run', [r4.code, r4.kind], [1, 'failed']);
}
{ // E5 a statement that throws part-way, then a re-run
  const db = seed();
  const r = await go(db, { apply: true, hooks: { beforeWrite: (n) => { if (n === 2) throw new Error('d1 HTTP 500'); } } });
  eq('executor: a failing statement stops the run and names the error', [r.code, r.kind, /d1 HTTP 500/.test(r.lines), /changes=ABSENT/.test(r.lines)], [1, 'failed', true, false]);
  eq('executor: the copy entry is there and the deletion entry is not', own(db).map(x => x.field), ['opening_odds']);
  const r2 = await go(db, { apply: true });
  eq('executor: a re-run issues both statements, the first changes 0 rows and the second writes the missing entry',
    [r2.code, r2.kind, r2.calls.writes, /1 the copy entry on the keeper: 0 row\(s\)/.test(r2.lines), /2 the row_deleted entry on the old id: 1 row\(s\)/.test(r2.lines), own(db).length], [0, 'applied', 2, true, true, 2]);
}
{ // E6 the verdict comes from a re-read
  const r = await go(seed(), { apply: true, hooks: { afterWrite: (n, res, d) => { if (n === 2) d.prepare('UPDATE regular_season_games SET home_score = 99 WHERE id = ?').run(KEEPER); return res; } } });
  eq('executor: a games row that changed during the run is a mismatch', [r.code, r.kind], [1, 'mismatch']);
  const r2 = await go(seed(), { apply: true, hooks: { afterWrite: (n, res, d) => { if (n === 2) d.prepare(`UPDATE change_log SET new_value = 'x' WHERE id = 26734`).run(); return res; } } });
  eq('executor: a change_log row that existed and changed during the run is a mismatch', [r2.code, r2.kind], [1, 'mismatch']);
  const r3 = await go(seed(), { apply: true, hooks: { afterWrite: (n, res, d) => { if (n === 2) d.prepare(`UPDATE change_log SET new_value = '{}' WHERE source = ? AND field = 'opening_odds'`).run(SOURCE); return res; } } });
  eq('executor: an entry that does not hold what it should is a mismatch', [r3.code, r3.kind], [1, 'mismatch']);
}

// ── 5. absence is not zero, and the wire format ─────────────────────────
{
  const resp = (status, body) => async () => ({ ok: status < 400, status, text: async () => body });
  eq('relayD1: a body that is not JSON is a failure', /body is not JSON/.test(await throws(() => relayD1('s', resp(200, '<html>x</html>'))('SELECT 1')) ?? ''), true);
  eq('relayD1: a body that is JSON null is a failure', /not an object/.test(await throws(() => relayD1('s', resp(200, 'null'))('SELECT 1')) ?? ''), true);
  eq('relayD1: a success body with no results array leaves results missing', (await relayD1('s', resp(200, '{"success":true}'))('SELECT 1')).results, undefined);
  eq('relayD1: a success body with no meta leaves meta missing', (await relayD1('s', resp(200, '{"success":true,"results":[]}'))('INSERT INTO t VALUES (1)')).meta, undefined);
  eq('relayD1: success:false is a failure even on HTTP 200', /d1 HTTP 200/.test(await throws(() => relayD1('s', resp(200, '{"success":false}'))('SELECT 1')) ?? ''), true);
  eq('relayD1: an HTTP error status is a failure even when the body says success', /d1 HTTP 500/.test(await throws(() => relayD1('s', resp(500, '{"success":true,"results":[]}'))('SELECT 1')) ?? ''), true);
  eq('relayD1: a 401 text body is a failure', /d1 HTTP 401/.test(await throws(() => relayD1('s', resp(401, 'unauthorized'))('SELECT 1')) ?? ''), true);
  eq('relayD1: no secret means no call', /RELAY_SHARED_SECRET is not set/.test(await throws(() => relayD1('', resp(200, '{}'))('SELECT 1')) ?? ''), true);
  let seen = null;
  await relayD1('sekrit', async (url, init) => { seen = { url, init }; return { ok: true, status: 200, text: async () => '{"success":true,"results":[],"meta":{"changes":1}}' }; })('INSERT INTO t VALUES (?)', [1]);
  eq('relayD1: the request is a POST to /d1/execute with the secret header, the sql, the params and a timeout',
    [seen.url.endsWith('/d1/execute'), seen.init.method, seen.init.headers['X-FIELD-Relay'], JSON.parse(seen.init.body), seen.init.signal instanceof AbortSignal],
    [true, 'POST', 'sekrit', { sql: 'INSERT INTO t VALUES (?)', params: [1] }, true]);
  const missing = { rows: [], postseason: [{ n: 0 }], log: [], history: [{ n: 1 }] };
  for (const k of Object.keys(missing)) {
    const cut = { ...missing }; delete cut[k];
    eq(`stateFrom: a read that returned no array throws (${k})`, /returned no result array/.test(await throws(() => stateFrom(cut)) ?? ''), true);
  }
  eq('stateFrom: a count read with no rows is NaN', Number.isNaN(stateFrom({ ...missing, history: [] }).historyStale), true);
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
  const cwd = mkdtempSync(join(tmpdir(), 'audit-rows-cli-'));
  temps.push(cwd);
  const before = [snap(db, 'change_log'), snap(db, 'regular_season_games')];

  const dry = await runCli([], { RELAY_BASE: relay.base, RELAY_SHARED_SECRET: SECRET }, cwd);
  eq('cli: with no flag it is a dry run: exit 0, no write reached the relay, the tables are unchanged',
    [dry.code, relay.seen.writes, JSON.stringify([snap(db, 'change_log'), snap(db, 'regular_season_games')]) === JSON.stringify(before), /DRY RUN/.test(dry.out)], [0, 0, true, true]);
  eq('cli: the dry run left a log named for its outcome, holding what was printed',
    [logs(cwd).some(f => /^oklahoma-audit-rows-dryrun-.*\.log$/.test(f)), logs(cwd).some(f => /-running-/.test(f)),
     /=== oklahoma audit rows/.test(readFileSync(join(cwd, 'outbox', logs(cwd).find(f => /dryrun/.test(f))), 'utf8'))], [true, false, true]);

  const postsBefore = relay.seen.posts;
  const nosecret = await runCli(['--apply'], { RELAY_BASE: relay.base }, cwd);
  eq('cli: with no secret it refuses before any call', [nosecret.code, relay.seen.posts - postsBefore, /RELAY_SHARED_SECRET is not set/.test(nosecret.out)], [1, 0, true]);
  const wrong = await runCli(['--apply'], { RELAY_BASE: relay.base, RELAY_SHARED_SECRET: 'wrong' }, cwd);
  eq('cli: a wrong secret is a 401, a failure and no write, and no secret is printed', [wrong.code, relay.seen.writes, /d1 HTTP 401/.test(wrong.out), dry.out.includes(SECRET)], [1, 0, true, false]);

  const applied = await runCli(['--apply'], { RELAY_BASE: relay.base, RELAY_SHARED_SECRET: SECRET, GITHUB_RUN_ID: '4242', GITHUB_SHA: 'abcdef0123456789' }, cwd);
  eq('cli: --apply writes the two entries and nothing else', [applied.code, relay.seen.writes, own(db).length], [0, 2, 2]);
  eq('cli: the log names the run and its outcome', [/run 4242 @ abcdef012345/.test(applied.out), logs(cwd).some(f => /^oklahoma-audit-rows-applied-.*\.log$/.test(f))], [true, true]);
  eq('cli: the secret header is on every call and only INSERTs and SELECTs went over the wire',
    [relay.seen.headers.filter(h => h === SECRET).length > 0, relay.seen.bodies.every(b => /^(SELECT|INSERT INTO change_log) /.test(b.sql))], [true, true]);
  const writesAfter = relay.seen.writes;
  const again = await runCli(['--apply'], { RELAY_BASE: relay.base, RELAY_SHARED_SECRET: SECRET }, cwd);
  eq('cli: a second --apply is a no-op that says so', [again.code, relay.seen.writes - writesAfter, /ALREADY DONE/.test(again.out)], [0, 0, true]);
  await relay.close();
}

// ── 7. the workflow that dispatches it ──────────────────────────────────
{
  const WF = '.github/workflows/write-oklahoma-audit-rows.yml';
  const wf = readFileSync(WF, 'utf8');
  const stepBlock = (name) => {
    const at = wf.indexOf(`- name: ${name}`);
    if (at < 0) return '';
    const next = wf.indexOf('\n      - ', at + 4);
    return wf.slice(at, next < 0 ? undefined : next);
  };
  eq('workflow: dispatch only, no push, schedule or pull_request trigger', [/^\s*workflow_dispatch:/m.test(wf), /^\s*(push|schedule|pull_request|workflow_run):/m.test(wf)], [true, false]);
  eq('workflow: the job runs only on main (the log step pushes to main)', /^\s+if: github\.ref == 'refs\/heads\/main'/m.test(wf), true);
  eq('workflow: one run at a time, and a running one is never cancelled', [/^\s+group: oklahoma-audit-rows\s*$/m.test(wf), /^\s+cancel-in-progress: false\s*$/m.test(wf)], [true, true]);
  eq('workflow: Node 22 is pinned (node:sqlite)', /node-version: '22'/.test(wf), true);
  eq('workflow: the job declares a timeout', /^\s+timeout-minutes: \d+/m.test(wf), true);
  eq('workflow: the secret is in the Run step only',
    [stepBlock('Run').includes('RELAY_SHARED_SECRET'), stepBlock('The plan must pass').includes('RELAY_SHARED_SECRET'), stepBlock('Commit the log').includes('RELAY_SHARED_SECRET')], [true, false, false]);
  eq('workflow: the apply input reaches the shell through env, never by interpolation into the script',
    [/APPLY_INPUT: \$\{\{ github\.event\.inputs\.apply \}\}/.test(stepBlock('Run')), (stepBlock('Run').split('run: |')[1] ?? '').includes('${{')], [true, false]);
  eq('workflow: only this workflow\'s own log is staged', /PROBE_PATHS="outbox\/oklahoma-audit-rows-\*\.log"/.test(stepBlock('Commit the log')), true);
  eq('workflow: the log step runs even when an earlier step failed', /if: always\(\)/.test(stepBlock('Commit the log')), true);
  eq('workflow: the checked-in plan is what runs (a clean tree is asserted between the checks and the run)', /git diff --exit-code/.test(stepBlock('The plan must pass')), true);

  const runBlock = (stepBlock('Run').split('run: |')[1] ?? '').split('\n').filter(l => l.trim() !== '');
  const indent = Math.min(...runBlock.map(l => l.match(/^ */)[0].length));
  const script = runBlock.map(l => l.slice(indent)).join('\n');
  const dir = mkdtempSync(join(tmpdir(), 'audit-rows-wf-'));
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
    return [r.status, args.includes('--apply'), args.includes('write-oklahoma-audit-rows.mjs')];
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
