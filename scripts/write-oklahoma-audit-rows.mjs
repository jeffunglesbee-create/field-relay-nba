#!/usr/bin/env node
// The two change_log entries that option A of
// docs/CC-CMD-2026-10-16-cfl-archive-date-keying.md did not write.
//
// The owner ordered them on 2026-11-18 ("Write the audit rows"). The copy of the
// opening line onto CFB_2026-11-15_e401856887 and the deletion of
// CFB_2026-11-14_e401856887 (run 44223383680) left no record in change_log. This
// writes exactly two APPEND-ONLY rows, in the shape the 2026-09-13 cleanup used
// for a deletion (docs/CC-CMD-2026-09-13-archive-duplicate-rows.md, Task 3):
//
//   1. on the keeper:  field 'opening_odds', old NULL, new = the line it now holds
//   2. on the old id:  field 'row_deleted', old = JSON of the row that was removed
//                      (both blobs, date, names, league, venue, ids, created_at),
//                      new = the keeper's id
//
// Source label 'archive_duplicate_merge'. Neither entry is read as a change by
// src/brief-freshness.js (that label is in no source set), and nothing else is
// written: no games row, no odds_history row, no existing change_log row.
//
// WHERE THE DELETED ROW'S CONTENT COMES FROM. The two blobs are NOT retyped: the
// opening line is change_log 26626's new_value (and must equal what the keeper
// holds now, byte for byte) and the closing line is change_log 26722's new_value
// (and must equal the text the old row was read with on 2026-11-18 before the
// delete). The date, names, league, venue, ids and created_at were read from the
// old row at the same time and are pinned below.
//
// DRY RUN UNLESS --apply. EVERY STATEMENT IS GUARDED AND IDEMPOTENT: it writes
// only if its own entry does not exist and the facts above still hold, so a
// re-run, a retry or a second dispatch changes nothing.
//
// ABSENT IS NOT ZERO (Rule 99): a write whose response carries no `changes`
// count is a failure, and a read with no result array is a failed read.
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const KEEPER = 'CFB_2026-11-15_e401856887';
export const STALE = 'CFB_2026-11-14_e401856887';
export const EVENT = '401856887';
export const SOURCE = 'archive_duplicate_merge';
export const OPEN_LOG = 26626;     // odds_api opening_odds on the old id
export const CLOSE_LOG = 26722;    // odds_backfill closing_odds on the old id
// The old row, read from D1 on 2026-11-18 before it was deleted.
export const DELETED_ROW = Object.freeze({
  table: 'regular_season_games', date: '2026-11-14', sport: 'CFB', league: 'CFB',
  home: 'Oklahoma', away: 'Ole Miss', venue: 'Memorial Stadium (Norman, OK)',
  espn_event_id: '401856887', start_time: '2026-11-15T18:00Z', created_at: '2026-11-14 10:01:36',
});
export const CLOSING_BLOB = '{"source":"draftkings","captured_at":"2026-11-14T23:55:04Z","moneyline":{"home":-147,"away":124},"total":{"over":48.5,"under":48.5},"_kickoff":{"at":"2026-11-15T18:00Z","verified":true,"late_minutes":null}}';
// The state the apply left, read 2026-11-18.
export const BASELINE = Object.freeze({ stale_change_log: 2, keeper_change_log: 1, stale_odds_history: 1 });

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 30_000;

/** d1(sql, params) -> { results, meta }. Throws on any non-success. */
export function relayD1(secret, fetchImpl = fetch) {
  return async (sql, params = []) => {
    if (!secret) throw new Error('RELAY_SHARED_SECRET is not set; refusing to call /d1/execute');
    const res = await fetchImpl(`${RELAY}/d1/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': secret, 'User-Agent': UA },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    let b;
    try { b = JSON.parse(text); }
    catch (e) { throw new Error(`d1 HTTP ${res.status}: body is not JSON: ${text.slice(0, 200)}`); }
    if (b === null || typeof b !== 'object') throw new Error(`d1 HTTP ${res.status}: body is not an object: ${text.slice(0, 200)}`);
    if (!res.ok || b.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(b).slice(0, 300)}`);
    return { results: b.results, meta: b.meta };
  };
}

/** What the deletion entry must hold in old_value, as an object. */
export function expectedDeletion(keeperLine) {
  return { ...DELETED_ROW, opening_odds: keeperLine, closing_odds: CLOSING_BLOB };
}

export function readQueries() {
  return {
    rows:       { sql: 'SELECT id, home_score, away_score, opening_odds FROM regular_season_games WHERE espn_event_id = ? ORDER BY id', params: [EVENT] },
    postseason: { sql: 'SELECT COUNT(*) AS n FROM postseason_games WHERE espn_event_id = ?', params: [EVENT] },
    log:        { sql: 'SELECT id, game_id, source, field, old_value, new_value FROM change_log WHERE game_id IN (?, ?) ORDER BY id', params: [KEEPER, STALE] },
    history:    { sql: 'SELECT COUNT(*) AS n FROM odds_history WHERE game_id = ?', params: [STALE] },
  };
}

export function stateFrom(results) {
  const arr = (name) => {
    if (!Array.isArray(results[name])) throw new Error(`read "${name}" returned no result array`);
    return results[name];
  };
  const n = (name) => Number(arr(name)[0]?.n ?? NaN);   // NaN fails every === that follows
  const log = arr('log');
  const own = log.filter(r => r.source === SOURCE);
  return {
    rows: arr('rows'),
    postseasonCount: n('postseason'),
    historyStale: n('history'),
    byId: Object.fromEntries(log.map(r => [r.id, r])),
    logStale: log.filter(r => r.game_id === STALE && r.source !== SOURCE).length,
    logKeeper: log.filter(r => r.game_id === KEEPER && r.source !== SOURCE).length,
    copy: own.filter(r => r.game_id === KEEPER && r.field === 'opening_odds'),
    deleted: own.filter(r => r.game_id === STALE && r.field === 'row_deleted'),
    ownOther: own.filter(r => !((r.game_id === KEEPER && r.field === 'opening_odds') || (r.game_id === STALE && r.field === 'row_deleted'))).length,
  };
}

const check = (name, ok, detail) => ({ name, ok: Boolean(ok), detail: ok ? '' : detail });
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

/** -> { ok, phase, checks }. phase: fresh (neither entry) | partial (one) | done (both) | refuse. */
export function evaluate(state) {
  const keeper = state.rows.find(r => r.id === KEEPER);
  const open = state.byId[OPEN_LOG], close = state.byId[CLOSE_LOG];
  const line = keeper?.opening_odds ?? null;
  const copy = state.copy[0] ?? null, gone = state.deleted[0] ?? null;
  const checks = [];

  checks.push(check('the event has exactly one row, the scored keeper, and none in postseason_games',
    state.rows.length === 1 && Boolean(keeper) && keeper.home_score != null && keeper.away_score != null && state.postseasonCount === 0,
    `rows ${JSON.stringify(state.rows.map(r => r.id))}, postseason ${state.postseasonCount}`));
  checks.push(check('the keeper holds an opening line', line != null, 'opening_odds is null'));
  checks.push(check('change_log 26626 is the old id\'s odds_api opening line, and it equals the keeper\'s line byte for byte',
    Boolean(open) && open.game_id === STALE && open.source === 'odds_api' && open.field === 'opening_odds' && line != null && open.new_value === line,
    open ? `game ${open.game_id}, source ${open.source}, field ${open.field}, equals keeper ${open.new_value === line}` : 'row missing'));
  checks.push(check('change_log 26722 is the old id\'s odds_backfill closing line, and it equals the text the old row was read with',
    Boolean(close) && close.game_id === STALE && close.source === 'odds_backfill' && close.field === 'closing_odds' && close.new_value === CLOSING_BLOB,
    close ? `game ${close.game_id}, source ${close.source}, field ${close.field}, equals the read blob ${close.new_value === CLOSING_BLOB}` : 'row missing'));
  checks.push(check('change_log is the state the apply left: 2 rows on the old id, 1 on the keeper, none of this plan\'s beyond the two entries',
    state.logStale === BASELINE.stale_change_log && state.logKeeper === BASELINE.keeper_change_log && state.ownOther === 0,
    `old id ${state.logStale} (want ${BASELINE.stale_change_log}), keeper ${state.logKeeper} (want ${BASELINE.keeper_change_log}), other own rows ${state.ownOther}`));
  // AT MOST the one row the order was given against. This plan never writes odds_history, so its
  // presence was never a precondition of the two entries; the 2026-11-18 repoint moved the row to the
  // keeper and left none, and a re-dispatch must still read the state as done (not refuse and commit a
  // refused log). A second row on the old id is still not the state the order was given against.
  checks.push(check('at most the one odds_history row the order was given against is keyed to the old id (the repoint of 2026-11-18 moved it to the keeper)', state.historyStale <= BASELINE.stale_odds_history, `rows ${state.historyStale}`));
  checks.push(check('each entry exists at most once', state.copy.length <= 1 && state.deleted.length <= 1,
    `copy entries ${state.copy.length}, deletion entries ${state.deleted.length}`));
  if (copy) {
    checks.push(check('the copy entry is the keeper\'s opening_odds, first populated, carrying the line it holds',
      copy.old_value === null && copy.new_value === line && line != null, `old ${copy.old_value === null ? 'null' : 'set'}, new equals line ${copy.new_value === line}`));
  }
  if (gone) {
    const want = expectedDeletion(line);
    checks.push(check('the deletion entry carries the removed row (both blobs, date, names, league, venue, ids, created_at) and names the keeper',
      JSON.stringify(parse(gone.old_value)) === JSON.stringify(want) && gone.new_value === KEEPER,
      `old_value parses ${parse(gone.old_value) !== null}, equals the expected row ${JSON.stringify(parse(gone.old_value)) === JSON.stringify(want)}, new_value ${gone.new_value}`));
  }
  const phase = state.copy.length + state.deleted.length === 0 ? 'fresh'
    : state.copy.length === 1 && state.deleted.length === 1 ? 'done'
    : state.copy.length + state.deleted.length === 1 ? 'partial' : 'refuse';
  checks.push(check('the state is one the plan knows', phase !== 'refuse', `copy ${state.copy.length}, deleted ${state.deleted.length}`));
  return { ok: checks.every(c => c.ok), phase, checks };
}

/** The two statements, in order. Each writes only if its own entry is absent and its facts still hold. */
export function buildStatements({ ts }) {
  const D = DELETED_ROW;
  return [
    { name: '1 the copy entry on the keeper',
      sql: `INSERT INTO change_log (game_id, source, field, old_value, new_value, ts) `
         + `SELECT k.id, ?, 'opening_odds', NULL, k.opening_odds, ? FROM regular_season_games k WHERE k.id = ? `
         + `AND k.opening_odds = (SELECT c.new_value FROM change_log c WHERE c.id = ? AND c.game_id = ? AND c.field = 'opening_odds') `
         + `AND NOT EXISTS (SELECT 1 FROM change_log x WHERE x.game_id = k.id AND x.source = ? AND x.field = 'opening_odds')`,
      params: [SOURCE, ts, KEEPER, OPEN_LOG, STALE, SOURCE] },
    { name: '2 the row_deleted entry on the old id',
      sql: `INSERT INTO change_log (game_id, source, field, old_value, new_value, ts) `
         + `SELECT o.game_id, ?, 'row_deleted', json_object('table', ?, 'date', ?, 'sport', ?, 'league', ?, 'home', ?, 'away', ?, 'venue', ?, `
         + `'espn_event_id', ?, 'start_time', ?, 'created_at', ?, 'opening_odds', o.new_value, 'closing_odds', c.new_value), ?, ? `
         + `FROM change_log o JOIN change_log c ON c.id = ? WHERE o.id = ? AND o.game_id = ? AND c.game_id = ? AND c.new_value = ? `
         + `AND o.new_value = (SELECT k.opening_odds FROM regular_season_games k WHERE k.id = ?) `
         + `AND NOT EXISTS (SELECT 1 FROM regular_season_games g WHERE g.id = ?) `
         + `AND NOT EXISTS (SELECT 1 FROM change_log x WHERE x.game_id = o.game_id AND x.source = ? AND x.field = 'row_deleted')`,
      params: [SOURCE, D.table, D.date, D.sport, D.league, D.home, D.away, D.venue, D.espn_event_id, D.start_time, D.created_at,
               KEEPER, ts, CLOSE_LOG, OPEN_LOG, STALE, STALE, CLOSING_BLOB, KEEPER, STALE, SOURCE] },
  ];
}

async function readState(d1) {
  const results = {};
  for (const [name, { sql, params }] of Object.entries(readQueries())) {
    const r = await d1(sql, params);
    if (!Array.isArray(r.results)) throw new Error(`read ${name} returned no result array`);
    results[name] = r.results;
  }
  return stateFrom(results);
}

/** -> { code, kind }: dryrun | applied | already | refused | failed | mismatch. */
export async function execute({ d1, apply = false, now = () => new Date(), say = console.log, runId = null }) {
  say(`=== oklahoma audit rows  relay=${RELAY}  apply=${apply}  utc=${now().toISOString()}${runId ? `  ${runId}` : ''} ===`);
  say(`    two change_log entries for ${STALE} -> ${KEEPER} (ESPN event ${EVENT}), source ${SOURCE}`);

  const before = await readState(d1);
  const ev = evaluate(before);
  say(`\n--- 0. preconditions   (phase: ${ev.phase})`);
  for (const c of ev.checks) say(`    ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : `\n          ${c.detail}`}`);
  if (!ev.ok) { say(`\nSTOP: the archive is not in the state the owner ordered this against. Nothing was written.`); return { code: 1, kind: 'refused' }; }

  const stmts = buildStatements({ ts: now().toISOString() });
  say(`\n--- 1. statements (${stmts.length}), one /d1/execute call each`);
  for (const s of stmts) say(`    ${s.name}\n        params ${JSON.stringify(s.params).slice(0, 400)}`);

  if (ev.phase === 'done') { say(`\nALREADY DONE. Both entries exist and agree with the archive. Nothing was written.`); return { code: 0, kind: 'already' }; }
  if (!apply) { say(`\nDRY RUN. Nothing was written. Re-run with --apply to execute.`); return { code: 0, kind: 'dryrun' }; }

  say(`\n--- 2. writes`);
  for (const s of stmts) {
    let r;
    try { r = await d1(s.sql, s.params); }
    catch (e) { say(`\nSTOP: ${s.name} failed: ${e.message}\n      Every statement is guarded and idempotent: re-running completes it.`); return { code: 1, kind: 'failed' }; }
    const changes = r.meta?.changes;
    // on a fresh run every statement must write its one row; a partial run may find its own entry already there
    const want = ev.phase === 'fresh' || (s.name.startsWith('1') ? before.copy.length === 0 : before.deleted.length === 0) ? 1 : 0;
    if (changes !== want) {
      say(`\nSTOP: ${s.name} reported changes=${changes === undefined ? 'ABSENT' : `${JSON.stringify(changes)} (${typeof changes})`}; expected exactly ${want}.`);
      return { code: 1, kind: 'failed' };
    }
    say(`    ${s.name}: ${changes} row(s)`);
  }

  say(`\n--- 3. re-read`);
  const after = await readState(d1);
  const again = evaluate(after);
  for (const c of again.checks) say(`    ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : `\n          ${c.detail}`}`);
  const sameKeeper = JSON.stringify(after.rows) === JSON.stringify(before.rows);
  say(`    ${sameKeeper ? 'PASS' : 'FAIL'}  the games table was not touched (the event's row is what it was)`);
  const untouched = [OPEN_LOG, CLOSE_LOG, ...Object.keys(before.byId).map(Number)].every(id => JSON.stringify(before.byId[id]) === JSON.stringify(after.byId[id]));
  say(`    ${untouched ? 'PASS' : 'FAIL'}  the change_log rows that existed are unchanged`);
  const ok = again.ok && again.phase === 'done' && sameKeeper && untouched;
  say(ok ? `\nOK: two entries written, once each; nothing else changed.` : `\nMISMATCH: investigate before any further write.`);
  return { code: ok ? 0 : 1, kind: ok ? 'applied' : 'mismatch' };
}

// ── CLI ─────────────────────────────────────────────────────────────────
// The log is appended line by line and renamed to its outcome at the end, so a
// run the runner kills still leaves a record.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync('outbox', { recursive: true });
  const running = `outbox/oklahoma-audit-rows-running-${stamp}.log`;
  writeFileSync(running, '');
  const say = (s) => { console.log(s); appendFileSync(running, s + '\n'); };
  const finish = (kind) => { const p = `outbox/oklahoma-audit-rows-${kind}-${stamp}.log`; renameSync(running, p); console.log(`\nwrote ${p}`); };
  const sha = process.env.GITHUB_SHA;
  const runId = process.env.GITHUB_RUN_ID ? `run ${process.env.GITHUB_RUN_ID} @ ${sha ? sha.slice(0, 12) : 'sha not set'}` : null;
  execute({ d1: relayD1(process.env.RELAY_SHARED_SECRET), apply: process.argv.includes('--apply'), say, runId })
    .then(({ code, kind }) => { finish(kind); process.exit(code); })
    .catch((e) => { say(`\nFAILED: ${e.message}`); finish('failed'); process.exit(1); });
}
