#!/usr/bin/env node
// Repoint the one odds_history row that option A of
// docs/CC-CMD-2026-10-16-cfl-archive-date-keying.md left on a deleted game id.
//
// The owner ordered it on 2026-11-18 ("Repoint the odds_history row"). Option A
// deleted CFB_2026-11-14_e401856887; its one history row, id
// CFB_2026-11-14_e401856887_draftkings_close, still carries that game id. This moves
// that one row's game_id to the surviving CFB_2026-11-15_e401856887, and writes
// nothing else: no games row, no change_log row, no other history row, and NOT the
// primary key (the laboratory's MLS merge of 2026-09-03 left the id alone on its 20
// repoints, and a rename is outside the order).
//
// WHY THE PRECONDITIONS ARE WHAT THEY ARE. A read-only review on 2026-11-18 (five
// agents over the relay, the laboratory and the client) found the bare statement safe
// today and found two things it ARMS, so they are refused here rather than recorded:
//   1. The daily 10:00Z sync in .github/scripts/odds-backfill.js selects history rows by
//      game_id for games whose opening_odds or closing_odds is NULL. Attached to the
//      keeper, this row would refill an empty blob with the EARLIER snapshot (-147/+124)
//      over the real one (-142/+120). So both keeper blobs must be non-empty.
//   2. That backfill dedupes by primary key only, and there is no unique index on
//      (game_id, bookmaker, snapshot_type). If the 2026-11-15 row in
//      odds_backfill_progress were deleted, a reprocess would insert
//      CFB_2026-11-15_e401856887_draftkings_close beside this row. So that progress row
//      must exist, and that id must be free.
//
// DRY RUN UNLESS --apply. The statement is guarded and idempotent: it addresses the row
// by primary key AND old game id, so it moves one row or none, and a re-run matches
// nothing. Checked inside the statement itself: the keeper has no history row, the
// new-style id is free, both keeper blobs are NOT NULL, the old games row is absent, the
// progress row exists. Checked by the read before it, and not re-asserted in it: one
// scored games row, no postseason row, non-empty blobs, every pinned column of the row,
// one row on the old id. The few hundred milliseconds between that read and the write
// are covered by the re-read, which prints MISMATCH rather than OK.
//
// AFTER THE WRITE, TWO CONDITIONS STAND, because the preconditions guard the moment of
// the write and not what comes after: if the keeper's opening_odds or closing_odds is
// ever NULLed, the daily sync refills it from this earlier snapshot; and if
// odds_backfill_progress 2026-11-15 is ever deleted, a reprocess inserts a second close
// row beside this one. Both are recorded in
// docs/CC-CMD-2026-10-16-cfl-archive-date-keying.md.
//
// ABSENT IS NOT ZERO (Rule 99): a write whose response carries no `changes` count is a
// failure, and a read with no result array is a failed read.
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const KEEPER = 'CFB_2026-11-15_e401856887';
export const STALE = 'CFB_2026-11-14_e401856887';
export const EVENT = '401856887';
export const PK = 'CFB_2026-11-14_e401856887_draftkings_close';
export const NEW_STYLE_ID = 'CFB_2026-11-15_e401856887_draftkings_close';
export const PROGRESS_DATE = '2026-11-15';
// The row as D1 held it on 2026-11-18, read before this was written. Every column but
// game_id must still match, and none is changed.
export const ROW = Object.freeze({
  id: PK, game_id: STALE, sport: 'CFB', date: '2026-11-14',
  home_team: 'Oklahoma Sooners', away_team: 'Ole Miss Rebels', commence_time: '2026-11-15T18:00:00Z',
  home_ml: 1.68, away_ml: 2.24, draw_ml: null, over_under: 48.5, over_price: 1.89, under_price: 1.93,
  bookmaker: 'draftkings', snapshot_time: '2026-11-14T23:55:04Z', snapshot_type: 'close', created_at: '2026-11-15 16:51:48',
});

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

export function readQueries() {
  return {
    row:        { sql: 'SELECT id, game_id, sport, date, home_team, away_team, commence_time, home_ml, away_ml, draw_ml, over_under, over_price, under_price, bookmaker, snapshot_time, snapshot_type, created_at FROM odds_history WHERE id = ?', params: [PK] },
    onOld:      { sql: 'SELECT COUNT(*) AS n FROM odds_history WHERE game_id = ?', params: [STALE] },
    onKeeper:   { sql: 'SELECT COUNT(*) AS n FROM odds_history WHERE game_id = ?', params: [KEEPER] },
    newStyle:   { sql: 'SELECT COUNT(*) AS n FROM odds_history WHERE id = ?', params: [NEW_STYLE_ID] },
    games:      { sql: 'SELECT id, home_score, away_score, opening_odds, closing_odds FROM regular_season_games WHERE espn_event_id = ? ORDER BY id', params: [EVENT] },
    postseason: { sql: 'SELECT COUNT(*) AS n FROM postseason_games WHERE espn_event_id = ?', params: [EVENT] },
    progress:   { sql: 'SELECT date FROM odds_backfill_progress WHERE date = ?', params: [PROGRESS_DATE] },
  };
}

export function stateFrom(results) {
  const arr = (name) => {
    if (!Array.isArray(results[name])) throw new Error(`read "${name}" returned no result array`);
    return results[name];
  };
  const n = (name) => Number(arr(name)[0]?.n ?? NaN);   // NaN fails every === that follows
  return {
    rows: arr('row'),
    onOld: n('onOld'),
    onKeeper: n('onKeeper'),
    newStyle: n('newStyle'),
    games: arr('games'),
    postseasonCount: n('postseason'),
    progress: arr('progress'),
  };
}

const check = (name, ok, detail) => ({ name, ok: Boolean(ok), detail: ok ? '' : detail });
const present = (v) => typeof v === 'string' && v.length > 0;
const matchesPinned = (r) => r !== null && Object.keys(ROW).every(k => k === 'game_id' || r[k] === ROW[k]);

/** -> { ok, phase, checks }. phase: fresh (row on the old id) | done (row on the keeper) | refuse. */
export function evaluate(state) {
  const keeper = state.games.find(g => g.id === KEEPER);
  const row = state.rows.length === 1 ? state.rows[0] : null;
  const at = row === null ? null : row.game_id;
  const phase = at === STALE ? 'fresh' : at === KEEPER ? 'done' : 'refuse';
  const checks = [];

  checks.push(check('the event has exactly one games row, the scored keeper, and none in postseason_games',
    state.games.length === 1 && Boolean(keeper) && keeper.home_score != null && keeper.away_score != null && state.postseasonCount === 0,
    `games ${JSON.stringify(state.games.map(g => g.id))}, postseason ${state.postseasonCount}`));
  checks.push(check('the keeper holds an opening line (an empty one would be refilled from this row by the daily sync)',
    Boolean(keeper) && present(keeper.opening_odds), 'opening_odds is empty'));
  checks.push(check('the keeper holds a closing line (an empty one would be refilled from this row by the daily sync)',
    Boolean(keeper) && present(keeper.closing_odds), 'closing_odds is empty'));
  checks.push(check('odds_backfill_progress holds 2026-11-15 (a reprocess would otherwise insert a second close row for the keeper)',
    state.progress.length === 1 && state.progress[0].date === PROGRESS_DATE, `progress rows ${state.progress.length}`));
  checks.push(check('the history row exists once, by its primary key, and carries every pinned column but game_id',
    matchesPinned(row), row === null ? `rows ${state.rows.length}` : `differs in ${Object.keys(ROW).filter(k => k !== 'game_id' && row[k] !== ROW[k]).join(', ')}`));
  checks.push(check('the new-style id for the keeper is free',
    state.newStyle === 0, `rows ${state.newStyle}`));
  checks.push(check('the row is on the old game id or on the keeper, and nowhere else',
    phase !== 'refuse', `game_id ${at}`));
  checks.push(check('the counts agree with the phase: 1 on the old id and 0 on the keeper before, 0 and 1 after',
    phase === 'fresh' ? state.onOld === 1 && state.onKeeper === 0 : phase === 'done' ? state.onOld === 0 && state.onKeeper === 1 : false,
    `on the old id ${state.onOld}, on the keeper ${state.onKeeper}, phase ${phase}`));
  return { ok: checks.every(c => c.ok), phase, checks };
}

/** The statement. It writes only while every fact above holds, and addresses the row by primary key AND old game id. */
export function buildStatements() {
  return [
    { name: '1 repoint the history row to the keeper',
      sql: `UPDATE odds_history SET game_id = ? WHERE id = ? AND game_id = ? `
         + `AND NOT EXISTS (SELECT 1 FROM odds_history x WHERE x.game_id = ?) `
         + `AND NOT EXISTS (SELECT 1 FROM odds_history y WHERE y.id = ?) `
         + `AND EXISTS (SELECT 1 FROM regular_season_games k WHERE k.id = ? AND k.opening_odds IS NOT NULL AND k.closing_odds IS NOT NULL) `
         + `AND NOT EXISTS (SELECT 1 FROM regular_season_games g WHERE g.id = ?) `
         + `AND EXISTS (SELECT 1 FROM odds_backfill_progress p WHERE p.date = ?)`,
      params: [KEEPER, PK, STALE, KEEPER, NEW_STYLE_ID, KEEPER, STALE, PROGRESS_DATE] },
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
  say(`=== oklahoma odds_history repoint  relay=${RELAY}  apply=${apply}  utc=${now().toISOString()}${runId ? `  ${runId}` : ''} ===`);
  say(`    one odds_history row, ${PK}: game_id ${STALE} -> ${KEEPER} (ESPN event ${EVENT}); the primary key is not changed`);

  const before = await readState(d1);
  const ev = evaluate(before);
  say(`\n--- 0. preconditions   (phase: ${ev.phase})`);
  for (const c of ev.checks) say(`    ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : `\n          ${c.detail}`}`);
  if (!ev.ok) { say(`\nSTOP: the archive is not in the state the owner ordered this against. Nothing was written.`); return { code: 1, kind: 'refused' }; }

  const stmts = buildStatements();
  say(`\n--- 1. statement (${stmts.length}), one /d1/execute call`);
  for (const s of stmts) say(`    ${s.name}\n        params ${JSON.stringify(s.params)}`);

  if (ev.phase === 'done') { say(`\nALREADY DONE. The row is on the keeper and agrees with the archive. Nothing was written.`); return { code: 0, kind: 'already' }; }
  if (!apply) { say(`\nDRY RUN. Nothing was written. Re-run with --apply to execute.`); return { code: 0, kind: 'dryrun' }; }

  say(`\n--- 2. write`);
  for (const s of stmts) {
    let r;
    try { r = await d1(s.sql, s.params); }
    catch (e) { say(`\nSTOP: ${s.name} failed: ${e.message}\n      The statement is guarded and idempotent: re-running reads the state first.`); return { code: 1, kind: 'failed' }; }
    const changes = r.meta?.changes;
    if (changes !== 1) {
      say(`\nSTOP: ${s.name} reported changes=${changes === undefined ? 'ABSENT' : `${JSON.stringify(changes)} (${typeof changes})`}; expected exactly 1.`);
      return { code: 1, kind: 'failed' };
    }
    say(`    ${s.name}: ${changes} row(s)`);
  }

  say(`\n--- 3. re-read`);
  let after;
  try { after = await readState(d1); }
  catch (e) { say(`\nSTOP: the write reported changes=1 but the re-read failed: ${e.message}\n      The row has most likely moved. Re-running reads the state first and prints ALREADY DONE if it has.`); return { code: 1, kind: 'failed' }; }
  const again = evaluate(after);
  for (const c of again.checks) say(`    ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : `\n          ${c.detail}`}`);
  const gamesSame = JSON.stringify(after.games) === JSON.stringify(before.games);
  say(`    ${gamesSame ? 'PASS' : 'FAIL'}  the event's games rows are unchanged (id, scores, opening and closing lines)`);
  const ok = again.ok && again.phase === 'done' && gamesSame;
  say(ok ? `\nOK: one row repointed (changes=1, addressed by primary key); the event's games rows are unchanged.` : `\nMISMATCH: investigate before any further write.`);
  return { code: ok ? 0 : 1, kind: ok ? 'applied' : 'mismatch' };
}

// ── CLI ─────────────────────────────────────────────────────────────────
// The log is appended line by line and renamed to its outcome at the end, so a
// run the runner kills still leaves a record.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync('outbox', { recursive: true });
  const running = `outbox/oklahoma-odds-history-repoint-running-${stamp}.log`;
  writeFileSync(running, '');
  const say = (s) => { console.log(s); appendFileSync(running, s + '\n'); };
  const finish = (kind) => { const p = `outbox/oklahoma-odds-history-repoint-${kind}-${stamp}.log`; renameSync(running, p); console.log(`\nwrote ${p}`); };
  const sha = process.env.GITHUB_SHA;
  const runId = process.env.GITHUB_RUN_ID ? `run ${process.env.GITHUB_RUN_ID} @ ${sha ? sha.slice(0, 12) : 'sha not set'}` : null;
  execute({ d1: relayD1(process.env.RELAY_SHARED_SECRET), apply: process.argv.includes('--apply'), say, runId })
    .then(({ code, kind }) => { finish(kind); process.exit(code); })
    .catch((e) => { say(`\nFAILED: ${e.message}`); finish('failed'); process.exit(1); });
}
