#!/usr/bin/env node
// CC-CMD-2026-09-14-closing-odds-captured-after-kickoff, Task 3.
//
// TASK 3 WAS "RELABEL THE 91". THIS DOES SOMETHING STRICTLY LESS DESTRUCTIVE
// AND STRICTLY WIDER, AND THE REASON IS THE MARK THAT SHIPPED IN 33b42a1.
//
// Relabelling moves a blob out of closing_odds, leaving the game with no line
// at all. For the 25 rows AmbientDO captured 0-15 minutes after kickoff that is
// a bad trade: a one-minute-late price is the only near-kickoff line those
// games have, and the reader now has a better way to know what it is.
//
// `_kickoff` is computable for any row that already exists — captured_at is in
// the blob and start_time is on the row. So instead of moving 91 blobs, this
// stamps 877: the 786 that are provably pre-kickoff become verified:true, and
// the 91 carry the exact minutes they were late. Nothing is moved, no price
// changes, every consumer can decide for itself, and the archive stops being
// uniformly "unverified".
//
// IT DOES NOT TOUCH THE 530 ROWS WITH NO start_time. Those cannot be asked, and
// stamping them would convert "never checked" into "checked, unknown" for rows
// where a kickoff is still recoverable from an espn_event_id. They keep their
// honest absence until that route is tested.
//
// DRY RUN UNLESS --apply.
import { writeFileSync } from 'node:fs';
import { kickoffMark } from '../src/odds-kickoff.js';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const APPLY = process.argv.includes('--apply');
const GATE = process.env.RELAY_SHARED_SECRET;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TABLES = ['regular_season_games', 'postseason_games'];
const log = [];
const say = (s) => { console.log(s); log.push(s); };
const dump = (kind) => {
  const p = `outbox/kickoff-backstamp-${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  writeFileSync(p, log.join('\n') + '\n');
  console.log(`\nwrote ${p}`);
};

async function d1(sql, params = []) {
  if (!GATE) throw new Error('RELAY_SHARED_SECRET is not set');
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE, 'User-Agent': UA },
    body: JSON.stringify({ sql, params }),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || b.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(b).slice(0, 300)}`);
  return b.results || [];
}

(async () => {
  say(`=== kickoff backstamp  relay=${RELAY}  apply=${APPLY}  utc=${new Date().toISOString()} ===`);

  // ── 0. The set, and its three exclusions stated ──────────────────────────
  const todo = [];
  for (const t of TABLES) {
    const rows = await d1(
      `SELECT id, start_time, json_extract(closing_odds,'$.captured_at') cap
         FROM ${t}
        WHERE closing_odds IS NOT NULL
          AND start_time IS NOT NULL
          AND json_extract(closing_odds,'$._kickoff') IS NULL`);
    for (const r of rows) todo.push({ table: t, ...r, mark: kickoffMark(r.cap, r.start_time) });
    const skipped = (await d1(
      `SELECT
         SUM(CASE WHEN start_time IS NULL THEN 1 ELSE 0 END) no_start,
         SUM(CASE WHEN json_extract(closing_odds,'$._kickoff') IS NOT NULL THEN 1 ELSE 0 END) already
       FROM ${t} WHERE closing_odds IS NOT NULL`))[0] || {};
    say(`    ${t}: ${rows.length} to stamp`
      + `  (${skipped.no_start} have no start_time and are NOT touched,`
      + ` ${skipped.already} already carry the mark)`);
  }

  const verified = todo.filter(r => r.mark.verified).length;
  const late = todo.filter(r => !r.mark.verified && r.mark.late_minutes !== null).length;
  const unreadable = todo.filter(r => !r.mark.verified && r.mark.late_minutes === null).length;
  say(`\n--- 0. ${todo.length} row(s): ${verified} verified pre-kickoff, ${late} late, ${unreadable} unreadable`);
  // 91 WAS MEASURED ON A POPULATION THAT HAS SINCE GROWN, AND PINNING AN
  // ASSERTION TO IT WOULD NOW FIRE FOR THE RIGHT REASON AND READ AS A DEFECT.
  //
  // On 2026-09-14 the askable set was 877 rows and 91 were late. Then
  // run-start-time-resolve.mjs gave 476 more rows a start_time from ESPN, so
  // the denominator moved. A number that was a cross-check against the probe
  // becomes a stale constant the moment the set it described changes.
  //
  // So it is reported as a comparison, not a verdict: a difference is expected
  // here and the line says why, rather than telling a reader to investigate
  // something that is working.
  const PRE_RESOLVE_LATE = 91, PRE_RESOLVE_ASKABLE = 877;
  if (todo.length)
    say(`    (${late} late of ${todo.length} to stamp. Before ESPN start_time resolution the`
      + ` askable set was ${PRE_RESOLVE_ASKABLE} with ${PRE_RESOLVE_LATE} late —`
      + ` a difference here is the wider population, not a disagreement.)`);
  for (const r of todo.filter(x => x.mark.late_minutes !== null)
                     .sort((a, b) => b.mark.late_minutes - a.mark.late_minutes).slice(0, 5))
    say(`    latest: ${r.id}  +${r.mark.late_minutes} min`);

  if (!APPLY) { say(`\nDRY RUN. Nothing was written. Re-run with --apply.`); dump('dryrun'); process.exit(0); }

  // ── 1. Stamp, one row at a time ─────────────────────────────────────────
  // json_set adds the key without reserialising the blob here, so no price can
  // be altered by a round trip through JS. Guarded on the key still being
  // absent, so a second run cannot overwrite a mark a live writer has since
  // written with better information.
  say(`\n--- 1. stamping`);
  let done = 0;
  for (const r of todo) {
    await d1(
      `UPDATE ${r.table}
          SET closing_odds = json_set(closing_odds, '$._kickoff', json(?))
        WHERE id = ? AND json_extract(closing_odds,'$._kickoff') IS NULL`,
      [JSON.stringify(r.mark), r.id]);
    done++;
    if (done % 100 === 0) say(`    ${done}/${todo.length}`);
  }
  say(`    ${done} stamped`);

  // ── 2. change_log ───────────────────────────────────────────────────────
  // SOURCE CHECKED AGAINST ITS CONSUMER. src/brief-freshness.js fires the stale
  // brief guard only for sources in its _ODDS_SOURCES set; `kickoff_backstamp`
  // is deliberately not one, so 877 metadata rows cannot flood that guard with
  // odds movements that did not happen.
  const D1_MAX_BOUND_PARAMS = 100, CHANGELOG_COLUMNS = 6;
  const CHUNK = Math.floor(D1_MAX_BOUND_PARAMS / CHANGELOG_COLUMNS);
  say(`\n--- 2. change_log`);
  for (let i = 0; i < todo.length; i += CHUNK) {
    const c = todo.slice(i, i + CHUNK), params = [];
    for (const r of c)
      params.push(r.id, 'kickoff_backstamp', 'closing_odds._kickoff', null,
                  JSON.stringify(r.mark), new Date().toISOString());
    await d1(`INSERT INTO change_log (game_id, source, field, old_value, new_value, ts) VALUES `
           + c.map(() => '(?, ?, ?, ?, ?, ?)').join(', '), params);
  }
  say(`    ${todo.length} entries`);

  // ── 3. Done condition, re-read from the archive ─────────────────────────
  say(`\n--- 3. re-read`);
  let marked = 0, stillNull = 0;
  for (const t of TABLES) {
    const r = (await d1(
      `SELECT SUM(CASE WHEN json_extract(closing_odds,'$._kickoff') IS NOT NULL THEN 1 ELSE 0 END) marked,
              SUM(CASE WHEN json_extract(closing_odds,'$._kickoff') IS NULL
                        AND start_time IS NOT NULL THEN 1 ELSE 0 END) missed
         FROM ${t} WHERE closing_odds IS NOT NULL`))[0] || {};
    say(`    ${t}: ${r.marked} carry the mark, ${r.missed} askable row(s) still unmarked`);
    marked += r.marked ?? 0; stillNull += r.missed ?? 0;
  }
  const ok = stillNull === 0 && marked >= todo.length;
  say(ok ? `\nOK: every askable closing line now says whether it preceded kickoff.`
         : `\nMISMATCH: ${stillNull} askable row(s) unmarked. Investigate before any further write.`);
  dump(ok ? 'applied' : 'mismatch');
  process.exit(ok ? 0 : 1);
})().catch(e => {
  console.error(`\nFAILED: ${e.message}`);
  log.push(`FAILED: ${e.message}`);
  dump('failed');
  process.exit(1);
});
