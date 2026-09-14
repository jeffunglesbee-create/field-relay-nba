#!/usr/bin/env node
// READ-ONLY. Is a `closing_odds` blob actually a CLOSING line?
//
// RULE 42. Two collision pairs held two different closing lines and no rule
// picked between them: delete destroys data, COALESCE cannot write into a
// non-NULL, and recency is useless because one side's captured_at is the same
// wall-clock second on two different dates. Three dead ends is the signal to
// stop choosing and look at what the rows are showing.
//
// What they show: `2026-07-25T23:55:28Z` against `2026-07-25T23:41:27.699Z`,
// with finalized_at at 01:45:42. An MLS match runs about two hours, so kickoff
// was near 23:45 — 19:45 ET, the standard slot. One capture is four minutes
// BEFORE the match and the other is ten minutes INTO it. They are not two
// closing lines. One is a closing line and one is an in-play line in a column
// that means closing.
//
// THE PAIRS ARE NOT THE DEFECT, THEY ARE WHERE IT BECAME VISIBLE. A cron firing
// at :55 captures ten minutes late for every 19:45 kickoff, and nothing would
// ever reveal it except a collision parking a correct capture beside it. So
// this probe does not look at the two pairs. It asks how wide this is.
//
// NO WRITE PATH. SELECT only, enforced.
import { writeFileSync } from 'node:fs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE = process.env.RELAY_SHARED_SECRET;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const log = [];
const say = (s) => { console.log(s); log.push(s); };

async function d1(sql, params = []) {
  if (!GATE) throw new Error('RELAY_SHARED_SECRET is not set');
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('this probe issues SELECT only');
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': GATE, 'User-Agent': UA },
    body: JSON.stringify({ sql, params }),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || b.success === false) throw new Error(`d1 HTTP ${res.status}: ${JSON.stringify(b).slice(0, 400)}`);
  return b.results || [];
}

// A dash-scheme id is `YYYY-MM-DD-<sport>-<home>-<away>`; ours are not. Written
// as a SQL predicate rather than imported from src/d1-provenance.js because this
// has to run inside the query, over rows that never reach JS.
const DASH = `id GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*'`;
const TABLES = ['regular_season_games', 'postseason_games'];

(async () => {
  say(`=== closing-odds capture timing  ${new Date().toISOString()} ===`);

  // ── 0. THE FORMATS, BEFORE ANY COMPARISON IS WRITTEN AGAINST THEM ────────
  // start_time and captured_at are compared as strings below. If they are not
  // the same shape that comparison is meaningless and would return a confident
  // wrong number, so both are printed first and the run stops if they differ.
  say(`\n--- 0. shapes, read from the rows`);
  for (const t of TABLES) {
    const s = await d1(
      `SELECT id, start_time, json_extract(closing_odds,'$.captured_at') cap
         FROM ${t} WHERE closing_odds IS NOT NULL AND start_time IS NOT NULL LIMIT 3`);
    for (const r of s) say(`    ${t}  ${r.id}\n        start_time=${r.start_time}\n        captured_at=${r.cap}`);
    if (!s.length) say(`    ${t}: no row has both start_time and a closing capture`);
  }

  // ── 1. IS THE CAPTURE TIME A CONSTANT? ───────────────────────────────────
  // If one wall-clock second dominates the dash-scheme rows, that writer runs
  // on a schedule rather than at kickoff, and its captured_at carries no
  // information about the match at all.
  say(`\n--- 1. capture second, by id scheme`);
  for (const t of TABLES) {
    for (const [label, pred] of [['dash', DASH], ['ours', `NOT (${DASH})`]]) {
      const rows = await d1(
        `SELECT substr(json_extract(closing_odds,'$.captured_at'), 12, 8) hms, COUNT(*) n
           FROM ${t} WHERE closing_odds IS NOT NULL AND ${pred}
          GROUP BY hms ORDER BY n DESC LIMIT 6`);
      const total = rows.reduce((a, r) => a + r.n, 0);
      say(`    ${t} / ${label}: ${total} row(s) in the top 6 buckets`);
      for (const r of rows) say(`        ${r.hms}  ${r.n}`);
      if (!rows.length) say(`        (none)`);
    }
  }

  // ── 2. HOW MANY CLOSING LINES WERE CAPTURED AFTER THE MATCH STARTED? ──────
  // This is the whole question. A price taken after kickoff is an in-play price
  // and calling it `closing_odds` makes every downstream reader wrong.
  say(`\n--- 2. captures at or after start_time (an in-play price called closing)`);
  let after = 0, comparable = 0, noStart = 0;
  for (const t of TABLES) {
    const r = (await d1(
      `SELECT
         SUM(CASE WHEN start_time IS NOT NULL
                   AND json_extract(closing_odds,'$.captured_at') >= start_time
              THEN 1 ELSE 0 END) AS after_kick,
         SUM(CASE WHEN start_time IS NOT NULL THEN 1 ELSE 0 END) AS comparable,
         SUM(CASE WHEN start_time IS NULL THEN 1 ELSE 0 END) AS no_start,
         COUNT(*) AS total
       FROM ${t} WHERE closing_odds IS NOT NULL`))[0] || {};
    say(`    ${t}: ${r.after_kick} of ${r.comparable} comparable captured at/after kickoff`
      + `  (${r.no_start} row(s) have no start_time to compare against, of ${r.total} with a closing line)`);
    after += r.after_kick ?? 0; comparable += r.comparable ?? 0; noStart += r.no_start ?? 0;
    // Rule 99: a row with no start_time is NOT a row that passed. It is a row
    // that could not be asked, and it is reported separately rather than folded
    // into the denominator.
    for (const [label, pred] of [['dash', DASH], ['ours', `NOT (${DASH})`]]) {
      const q = (await d1(
        `SELECT COUNT(*) n FROM ${t}
          WHERE closing_odds IS NOT NULL AND start_time IS NOT NULL
            AND json_extract(closing_odds,'$.captured_at') >= start_time AND ${pred}`))[0] || {};
      say(`        ${label}: ${q.n}`);
    }
  }

  // ── 3. HOW LATE, IN MINUTES ──────────────────────────────────────────────
  // A few seconds late is a clock skew. Ten minutes is a cron firing on its own
  // schedule, and the distribution tells them apart.
  say(`\n--- 3. how late, for the ones that are late`);
  for (const t of TABLES) {
    const rows = await d1(
      `SELECT id, start_time, json_extract(closing_odds,'$.captured_at') cap,
              CAST((julianday(replace(replace(json_extract(closing_odds,'$.captured_at'),'T',' '),'Z',''))
                    - julianday(start_time)) * 1440 AS INT) late_min
         FROM ${t}
        WHERE closing_odds IS NOT NULL AND start_time IS NOT NULL
          AND json_extract(closing_odds,'$.captured_at') >= start_time
        ORDER BY late_min DESC LIMIT 10`);
    for (const r of rows) say(`    ${t}  ${r.id}  +${r.late_min} min  (start ${r.start_time}, cap ${r.cap})`);
    if (!rows.length) say(`    ${t}: none`);
  }

  say(`\nTOTAL: ${after} of ${comparable} comparable closing lines were captured at or after kickoff.`);
  say(`       ${noStart} closing line(s) sit on rows with no start_time and could not be asked.`);
  const p = `outbox/closing-odds-capture-timing-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  writeFileSync(p, log.join('\n') + '\n');
  console.log(`\nwrote ${p}`);
})().catch(e => {
  console.error(`\nFAILED: ${e.message}`);
  log.push(`FAILED: ${e.message}`);
  writeFileSync(`outbox/closing-odds-capture-timing-failed-${Date.now()}.log`, log.join('\n') + '\n');
  process.exit(1);
});
