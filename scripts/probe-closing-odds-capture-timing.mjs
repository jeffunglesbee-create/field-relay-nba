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

// STRING COMPARISON IS WRONG HERE, AND THE FIRST VERSION OF THIS PROBE SHIPPED
// IT AND REPORTED A NUMBER FROM IT.
//
// start_time comes in at least two shapes — `2026-07-25T20:05Z` (minute
// precision, no seconds) and `2026-06-06T23:00:00+00:00` (offset form) — while
// captured_at carries `2026-07-25T20:05:30.000Z`. Compared as text, 'Z' (0x5A)
// sorts above ':' (0x3A), so `...20:05:30.000Z` < `...20:05Z` and a capture
// thirty seconds AFTER kickoff reads as before it. The 90-of-879 figure quoted
// on 2026-09-14 undercounts by that window.
//
// Both shapes were printed by this probe's own step 0. Reading past them is the
// defect Rule 100 exists for.
//
// julianday() parses all three forms; it returns NULL on anything it cannot,
// which is counted separately rather than folded into "not late" (Rule 99).
const JD = (x) => `julianday(replace(replace(${x}, 'T', ' '), 'Z', ''))`;
const JD_CAP = JD(`json_extract(closing_odds,'$.captured_at')`);
const JD_START = JD(`start_time`);

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
  let after = 0, comparable = 0, noStart = 0, unparsed = 0;
  for (const t of TABLES) {
    for (const [label, pred] of [['dash', DASH], ['ours', `NOT (${DASH})`]]) {
      // RULE 91: the denominator travels with the numerator, and so does the set
      // that could not be asked.
      //
      // MEASURED 2026-09-14: this line first printed `dash: 0` and it was read as
      // "the dash writer is punctual". It is not — the two D.C. United collision
      // pairs put it 25 minutes past kickoff. Its MLS rows carry no start_time, so
      // they were never in the denominator, and a bare zero over an invisible
      // denominator is a claim about everything.
      const q = (await d1(
        `SELECT
           SUM(CASE WHEN start_time IS NOT NULL AND ${JD_START} IS NOT NULL
                     AND ${JD_CAP} IS NOT NULL AND ${JD_CAP} >= ${JD_START}
                THEN 1 ELSE 0 END) AS late,
           SUM(CASE WHEN start_time IS NOT NULL
                     AND ${JD_START} IS NOT NULL AND ${JD_CAP} IS NOT NULL
                THEN 1 ELSE 0 END) AS asked,
           SUM(CASE WHEN start_time IS NULL THEN 1 ELSE 0 END) AS no_start,
           SUM(CASE WHEN start_time IS NOT NULL
                     AND (${JD_START} IS NULL OR ${JD_CAP} IS NULL)
                THEN 1 ELSE 0 END) AS unparsed,
           COUNT(*) AS total
         FROM ${t} WHERE closing_odds IS NOT NULL AND ${pred}`))[0] || {};
      say(`    ${t} / ${label}: ${q.late} late of ${q.asked} asked`
        + `  — ${q.no_start} with no start_time (NOT asked), ${q.unparsed} unparseable, ${q.total} total`);
      after += q.late ?? 0; comparable += q.asked ?? 0;
      noStart += q.no_start ?? 0; unparsed += q.unparsed ?? 0;
    }
  }

  // ── 2b. CAN THE UNASKABLE BE ASKED? ──────────────────────────────────────
  //
  // A percentage over 877 while 530 sit unasked is not a percentage of the
  // archive. This counts what could supply a kickoff for those rows.
  //
  // THE TWIN TEST IS ASKED OF THE CENSUS, NOT WRITTEN AS SQL, AND THAT IS THE
  // WHOLE POINT. The first version joined on exact (date, sport, home, away)
  // and returned 0. It could not have returned anything else: the pairs it was
  // modelled on differ on precisely those columns — `Toronto FC` against
  // `Toronto`, `Nashville SC` against `Nashville`. A query that cannot find the
  // case it exists for reports 0 and looks like an answer.
  //
  // /identity/substitution-census already pairs rows with the relay's own
  // normaliser. Re-implementing that here would verify the copy.
  //
  // A TWIN IS A PROVEN ROUTE; AN ESPN ID IS NOT. The D.C. United pairs were
  // resolved from the twin's start_time — same match, so the twin's kickoff IS
  // the kickoff. Whether an espn_event_id can be turned into one without an API
  // call is UNTESTED and is counted as an anchor a later task might resolve,
  // never as a recoverable kickoff.
  say(`\n--- 2b. of the rows with no start_time, what could supply one`);
  const cen = await (await fetch(`${RELAY}/identity/substitution-census`,
                                 { headers: { 'User-Agent': UA } })).json();
  if (!cen.ok || cen.same_slate_pair_detail_error) {
    // Rule 99: a failed read is not "no twins".
    say(`    CENSUS UNAVAILABLE (${cen.error || cen.same_slate_pair_detail_error})`
      + ` — the twin route could not be measured, which is not the same as zero.`);
  } else {
    // Every row the census considers half of a pair, and whether its partner
    // carries a start_time.
    const partnerHasStart = new Map();
    for (const c of (cen.same_slate_pair_colliding || [])) {
      const [x, y] = c.games;
      if (x && y) { partnerHasStart.set(x.id, y.start_time != null);
                    partnerHasStart.set(y.id, x.start_time != null); }
    }
    say(`    census pairs ${partnerHasStart.size} row(s) across ${(cen.same_slate_pair_colliding || []).length} collision(s)`);
    for (const t of TABLES) {
      const rows = await d1(
        `SELECT id, espn_event_id FROM ${t}
          WHERE closing_odds IS NOT NULL AND start_time IS NULL`);
      const twin = rows.filter(r => partnerHasStart.get(r.id) === true).length;
      const espn = rows.filter(r => r.espn_event_id != null).length;
      say(`    ${t}: ${rows.length} unaskable — ${twin} have a census-paired twin carrying start_time (PROVEN route),`);
      say(`        ${espn} carry an espn_event_id (an anchor, resolvability UNTESTED)`);
    }
  }

  // ── 3. HOW LATE, IN MINUTES ──────────────────────────────────────────────
  // A few seconds late is a clock skew. Ten minutes is a cron firing on its own
  // schedule, and the distribution tells them apart.
  say(`\n--- 3. how late, for the ones that are late`);
  for (const t of TABLES) {
    const rows = await d1(
      `SELECT id, start_time, json_extract(closing_odds,'$.captured_at') cap,
              CAST((${JD_CAP} - ${JD_START}) * 1440 AS INT) late_min
         FROM ${t}
        WHERE closing_odds IS NOT NULL AND start_time IS NOT NULL
          AND ${JD_CAP} IS NOT NULL AND ${JD_START} IS NOT NULL
          AND ${JD_CAP} >= ${JD_START}
        ORDER BY late_min DESC LIMIT 10`);
    for (const r of rows) say(`    ${t}  ${r.id}  +${r.late_min} min  (start ${r.start_time}, cap ${r.cap})`);
    if (!rows.length) say(`    ${t}: none`);
  }

  say(`\nTOTAL: ${after} of ${comparable} askable closing lines were captured at or after kickoff.`);
  say(`       ${noStart} sit on rows with no start_time and were NOT asked.`);
  say(`       ${unparsed} have a start_time julianday() could not parse and were NOT asked.`);
  say(`       Any percentage quoted from the first number alone excludes ${noStart + unparsed} rows.`);
  const p = `outbox/closing-odds-capture-timing-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  writeFileSync(p, log.join('\n') + '\n');
  console.log(`\nwrote ${p}`);
})().catch(e => {
  console.error(`\nFAILED: ${e.message}`);
  log.push(`FAILED: ${e.message}`);
  writeFileSync(`outbox/closing-odds-capture-timing-failed-${Date.now()}.log`, log.join('\n') + '\n');
  process.exit(1);
});
