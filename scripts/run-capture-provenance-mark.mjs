#!/usr/bin/env node
// CC-CMD-2026-09-15-name-the-draftkings-writer — the mark, not a repair.
//
// 58 archived closing lines carry a captured_at that is the worker's clock
// rather than the snapshot the data came from, written before a1937eb
// (2026-08-22T21:11:07Z) fixed that. The repair everyone reaches for — write
// the noon anchor instead — was VERIFIED AND REFUSED
// (outbox/captured-at-repair-verify-*.log): it changes nothing a consumer reads
// for 57 of them, and for EPL_2026-08-22_hull_manunited (kickoff 11:30Z, window
// ending 12:00Z) it would flip a verdict that neither value can support.
//
// So this writes what IS knowable: that the stored stamp is a run clock, what
// window the capture actually fell in, and whether the kickoff question can be
// decided at all from that window.
//
// captured_at IS NOT TOUCHED. `_kickoff` IS NOT TOUCHED — 1383 rows carry it,
// its contract is in CONTRACTS.md, and an additive field costs no consumer a
// migration. json_set adds one key; no price passes through JS.
//
// DRY RUN UNLESS --apply.
import { writeFileSync } from 'node:fs';
import { captureMark, hasCaptureMark, replayedRunClockSql } from '../src/odds-capture-provenance.js';
import { parseOddsJSON } from '../src/odds-consumer-rules.js';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const APPLY = process.argv.includes('--apply');
const GATE = process.env.RELAY_SHARED_SECRET;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TABLES = ['regular_season_games', 'postseason_games'];
const log = [];
const say = (s) => { console.log(s); log.push(s); };
const dump = (kind) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const p = `outbox/capture-provenance-mark-${kind}-${stamp}.log`;
  writeFileSync(p, log.join('\n') + '\n');
  console.log(`\nwrote ${p}`);
};

// ONE `fetch failed` KILLED A RUN 59 ROWS IN, on 2026-09-15T14:13:06Z. 874
// sequential POSTs to one Worker is enough for a transient transport error to
// be likely rather than exotic, and a job that dies mid-write leaves rows
// marked and unlogged — the exact unattributable state this session spent a
// task reconstructing. Retries are for the transport only: an HTTP response
// the Worker actually produced is a real answer and is not retried.
async function d1(sql, params = [], attempt = 0) {
  if (!GATE) throw new Error('RELAY_SHARED_SECRET is not set');
  if (!APPLY && !/^\s*SELECT\b/i.test(sql))
    throw new Error('dry run may only SELECT — refusing to send a mutating statement');
  let res;
  try {
    res = await fetch(`${RELAY}/d1/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE, 'User-Agent': UA },
      body: JSON.stringify({ sql, params }),
    });
  } catch (e) {
    if (attempt >= 4) throw new Error(`transport failed after ${attempt + 1} attempts: ${e.message}`);
    const wait = 500 * 2 ** attempt;
    console.warn(`    transport error (${e.message}); retry ${attempt + 1} in ${wait}ms`);
    await new Promise(r => setTimeout(r, wait));
    return d1(sql, params, attempt + 1);
  }
  const b = await res.json().catch(() => ({}));
  if (!res.ok || b.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(b).slice(0, 400)}`);
  return b.results || [];
}

// ONE PREDICATE, SHARED WITH THE WATCH. Selecting by `source = 'draftkings'`
// and an absent total described the 58 rows that happened to be found first;
// it is not what makes them wrong. What makes them wrong is a replayed price
// stamped with the run clock, and src/odds-capture-provenance.js says that
// once so the executor and the watch cannot drift apart.
const SHAPE = replayedRunClockSql('closing_odds');

(async () => {
  say(`=== capture provenance mark  relay=${RELAY}  apply=${APPLY}  utc=${new Date().toISOString()} ===`);

  const todo = [], already = [], undecidable = [];
  for (const table of TABLES) {
    const rows = await d1(
      `SELECT id, date, start_time, closing_odds FROM ${table}
        WHERE closing_odds IS NOT NULL AND ${SHAPE}`);
    say(`\n--- 0. ${table}: ${rows.length} row(s) carry a run-clock closing stamp`);
    for (const r of rows) {
      const blob = parseOddsJSON(r.closing_odds);
      if (hasCaptureMark(blob)) { already.push(r.id); continue; }
      const mark = captureMark(blob, r.date, r.start_time);
      if (!mark) continue;                       // the module declined; not ours to force
      todo.push({ table, id: r.id, mark });
      if (!mark.kickoff_decidable) undecidable.push(r.id);
    }
  }

  say(`\n--- 1. plan`);
  say(`    to mark                  : ${todo.length}`);
  say(`    already marked (no-op)   : ${already.length}`);
  say(`    of the plan, kickoff NOT decidable from the window : ${undecidable.length}`);
  for (const id of undecidable.slice(0, 10)) say(`      undecidable: ${id}`);
  for (const t of todo.slice(0, 5))
    say(`      ${t.id}  window_end=${t.mark.window_end}  decidable=${t.mark.kickoff_decidable}`);

  if (!todo.length) { say(`\nNothing to do.`); dump(APPLY ? 'applied' : 'dryrun'); process.exit(0); }
  if (!APPLY) { say(`\nDRY RUN. Nothing was written. Re-run with --apply.`); dump('dryrun'); process.exit(0); }

  // ── 2. mark, one row at a time ──────────────────────────────────────────
  // Guarded on the key still being absent, so a second run cannot overwrite a
  // mark a later writer has since written with better information.
  say(`\n--- 2. marking`);
  let done = 0;
  try {
    for (const r of todo) {
      await d1(
        `UPDATE ${r.table}
            SET closing_odds = json_set(closing_odds, '$._capture', json(?))
          WHERE id = ? AND json_extract(closing_odds,'$._capture') IS NULL`,
        [JSON.stringify(r.mark), r.id]);
      done++;
      if (done % 100 === 0) say(`    ${done}/${todo.length}`);
    }
  } catch (e) {
    // The count is the resume point and belongs in the artifact, not in a
    // stack trace. The first failure printed nothing and the state had to be
    // recovered by a separate query.
    say(`    ${done}/${todo.length} marked before failing: ${e.message}`);
    throw e;
  }
  say(`    ${done} marked`);

  // ── 3. change_log, OVER WHAT IS MARKED BUT UNLOGGED ─────────────────────
  // Not over `todo`. The first apply died after marking 59 rows and before
  // reaching this step, leaving them marked and unattributable. Deriving the
  // set from the archive instead of from this run's plan means the next run
  // repairs them, and a run that dies here can be resumed by another.
  const logged = new Set();
  for (const r of await d1(
    `SELECT DISTINCT game_id FROM change_log WHERE source = 'capture_provenance'`))
    logged.add(r.game_id);
  const toLog = [];
  for (const table of TABLES) {
    for (const r of await d1(
      `SELECT id, json_extract(closing_odds,'$._capture') AS cap FROM ${table}
        WHERE closing_odds IS NOT NULL AND ${SHAPE}
          AND json_extract(closing_odds,'$._capture') IS NOT NULL`))
      if (!logged.has(r.id)) toLog.push({ id: r.id, mark: r.cap });
  }
  say(`\n--- 3. change_log: ${toLog.length} marked row(s) not yet attributed`
    + `${toLog.length > todo.length ? '  (includes rows from an earlier interrupted run)' : ''}`);


  // `capture_provenance` is deliberately NOT in src/brief-freshness.js's
  // _ODDS_SOURCES set, so metadata rows cannot flood the stale-brief guard with
  // odds movements that did not happen. Chunk size derived, never inlined —
  // scripts/check-d1-batch-param-cap.mjs enforces that.
  const D1_MAX_BOUND_PARAMS = 100, CHANGELOG_COLUMNS = 6;
  const CHUNK = Math.floor(D1_MAX_BOUND_PARAMS / CHANGELOG_COLUMNS);
  for (let i = 0; i < toLog.length; i += CHUNK) {
    const c = toLog.slice(i, i + CHUNK), params = [];
    for (const r of c)
      params.push(r.id, 'capture_provenance', 'closing_odds._capture', null,
                  typeof r.mark === 'string' ? r.mark : JSON.stringify(r.mark),
                  new Date().toISOString());
    await d1(`INSERT INTO change_log (game_id, source, field, old_value, new_value, ts) VALUES `
           + c.map(() => '(?, ?, ?, ?, ?, ?)').join(', '), params);
  }
  say(`    ${toLog.length} entries written`);

  // ── 4. done condition, re-read from the archive ─────────────────────────
  say(`\n--- 4. re-read`);
  let unmarked = 0, marked = 0, priceChanged = 0;
  for (const table of TABLES) {
    const [row] = await d1(
      `SELECT SUM(CASE WHEN json_extract(closing_odds,'$._capture') IS NOT NULL THEN 1 ELSE 0 END) AS m,
              SUM(CASE WHEN json_extract(closing_odds,'$._capture') IS NULL THEN 1 ELSE 0 END) AS u
         FROM ${table} WHERE closing_odds IS NOT NULL AND ${SHAPE}`);
    marked += row?.m || 0; unmarked += row?.u || 0;
  }
  // The mark must have cost no price and no kickoff verdict. Re-read both.
  for (const r of todo) {
    const [row] = await d1(
      `SELECT json_extract(closing_odds,'$.captured_at') AS c,
              json_extract(closing_odds,'$._kickoff') AS k
         FROM ${r.table} WHERE id = ?`, [r.id]);
    if (row && (!row.c || !/\.\d{3}Z$/.test(row.c))) priceChanged++;
  }
  say(`    rows of this shape now marked : ${marked}`);
  say(`    still unmarked                : ${unmarked}`);
  say(`    captured_at altered by the mark : ${priceChanged}  (must be 0)`);

  const ok = unmarked === 0 && priceChanged === 0;
  say(ok
    ? `\nOK: every run-clock closing stamp now says so, and no captured_at moved.`
    : `\nFAIL: ${unmarked} unmarked, ${priceChanged} captured_at altered.`);
  dump('applied');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); dump(APPLY ? 'failed' : 'dryrun-failed'); process.exit(1); });
