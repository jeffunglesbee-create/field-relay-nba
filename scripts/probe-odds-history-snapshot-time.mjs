#!/usr/bin/env node
// READ-ONLY. What did the 2026-09-14 closing_odds skip actually cost?
//
// The backfill stopped writing `closing_odds` when the `odds_history` row
// carries no `snapshot_time`, because a captured_at taken from this run's clock
// cannot support a column that claims to be the last price before kickoff. That
// was the right call and its coverage cost was never measured.
//
// THE PREMISES THIS PROBE EXISTS TO REFUTE, not confirm (Rule 100):
//
//  P1  "the cost is the number of odds_history rows with a NULL snapshot_time."
//      It is not. The skip only bites on rows the writer actually reaches:
//      a game with a NULL odds column, dated before today, AFTER the writer's
//      `GROUP BY oh.game_id` has collapsed the game's rows to one.
//
//  P2  "GROUP BY picks a representative row." SQLite returns an ARBITRARY row
//      from each group for bare columns. If a game has one odds_history row
//      WITH a snapshot_time and one WITHOUT, whether closing_odds is written is
//      decided by which row the engine happened to hand back. That is not a
//      coverage cost, it is a coin flip, and this probe counts it separately.
//
//  P3  "NULL is the only falsy snapshot_time." An empty string is falsy too and
//      would take the same branch while looking present to `IS NOT NULL`.
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

// Quoted from .github/scripts/odds-backfill.js so the reader can check it
// without opening the file: `const TODAY_UTC = new Date().toISOString().slice(0, 10);`
const TODAY_UTC = new Date().toISOString().slice(0, 10);

// The writer's own candidate predicate, transcribed. Any divergence here makes
// every number below a measurement of a different population.
const CANDIDATE_IDS = `
  SELECT id FROM regular_season_games WHERE opening_odds IS NULL OR closing_odds IS NULL
  UNION ALL
  SELECT id FROM postseason_games WHERE opening_odds IS NULL OR closing_odds IS NULL`;

const one = (rows) => Object.values(rows[0] || {})[0] ?? null;

(async () => {
  say(`=== odds_history snapshot_time  relay=${RELAY}  utc=${new Date().toISOString()} ===`);

  // --- 0. the raw shape, including P3
  const total   = one(await d1(`SELECT COUNT(*) AS c FROM odds_history`));
  const nulls   = one(await d1(`SELECT COUNT(*) AS c FROM odds_history WHERE snapshot_time IS NULL`));
  const empties = one(await d1(`SELECT COUNT(*) AS c FROM odds_history WHERE snapshot_time = ''`));
  const games   = one(await d1(`SELECT COUNT(DISTINCT game_id) AS c FROM odds_history`));
  say(`\n--- 0. odds_history as a whole`);
  say(`    rows                      : ${total}`);
  say(`    distinct game_id          : ${games}`);
  say(`    snapshot_time IS NULL     : ${nulls}`);
  say(`    snapshot_time = '' (P3)   : ${empties}`);

  // --- 1. the population the writer actually reaches
  const cand = one(await d1(
    `SELECT COUNT(DISTINCT oh.game_id) AS c FROM odds_history oh WHERE oh.game_id IN (${CANDIDATE_IDS})`));
  const past = one(await d1(
    `SELECT COUNT(DISTINCT oh.game_id) AS c FROM odds_history oh
      WHERE oh.game_id IN (${CANDIDATE_IDS})
        AND COALESCE(
              (SELECT date FROM regular_season_games WHERE id = oh.game_id),
              (SELECT date FROM postseason_games     WHERE id = oh.game_id)) < ?`, [TODAY_UTC]));
  say(`\n--- 1. what the writer reaches (P1)`);
  say(`    candidate games (a NULL odds column) : ${cand}`);
  say(`    of those, dated before ${TODAY_UTC}  : ${past}   <- only these can be skipped`);

  // --- 2. per past candidate: does the GROUP BY outcome depend on luck (P2)?
  const buckets = await d1(
    `SELECT CASE
              WHEN with_t = 0            THEN 'none have a snapshot_time'
              WHEN without_t = 0         THEN 'all have a snapshot_time'
              ELSE 'MIXED — the GROUP BY decides'
            END AS bucket,
            COUNT(*) AS games,
            SUM(with_t + without_t) AS rows
       FROM (
         SELECT oh.game_id,
                SUM(CASE WHEN oh.snapshot_time IS NOT NULL AND oh.snapshot_time <> '' THEN 1 ELSE 0 END) AS with_t,
                SUM(CASE WHEN oh.snapshot_time IS NULL OR oh.snapshot_time = ''       THEN 1 ELSE 0 END) AS without_t
           FROM odds_history oh
          WHERE oh.game_id IN (${CANDIDATE_IDS})
            AND COALESCE(
                  (SELECT date FROM regular_season_games WHERE id = oh.game_id),
                  (SELECT date FROM postseason_games     WHERE id = oh.game_id)) < ?
          GROUP BY oh.game_id)
      GROUP BY bucket ORDER BY games DESC`, [TODAY_UTC]);
  say(`\n--- 2. per past candidate game (P2)`);
  if (!buckets.length) say('    no past candidate games at all — the skip has nothing to bite on');
  for (const b of buckets) say(`    ${String(b.bucket).padEnd(34)} ${String(b.games).padStart(5)} game(s), ${b.rows} row(s)`);

  // --- 3. name the ones that are actually lost, and the ones that are a coin flip
  const lost = await d1(
    `SELECT oh.game_id,
            COALESCE(
              (SELECT date FROM regular_season_games WHERE id = oh.game_id),
              (SELECT date FROM postseason_games     WHERE id = oh.game_id)) AS game_date,
            COUNT(*) AS rows
       FROM odds_history oh
      WHERE oh.game_id IN (${CANDIDATE_IDS})
        AND COALESCE(
              (SELECT date FROM regular_season_games WHERE id = oh.game_id),
              (SELECT date FROM postseason_games     WHERE id = oh.game_id)) < ?
      GROUP BY oh.game_id
     HAVING SUM(CASE WHEN oh.snapshot_time IS NOT NULL AND oh.snapshot_time <> '' THEN 1 ELSE 0 END) = 0
      ORDER BY game_date DESC LIMIT 25`, [TODAY_UTC]);
  say(`\n--- 3. games where NO odds_history row carries a snapshot_time`);
  say(`    ${lost.length === 25 ? 'first 25' : lost.length + ' total'}:`);
  for (const r of lost) say(`      ${r.game_date}  ${r.game_id}  (${r.rows} row(s))`);

  // --- 4. THE GUARD MAY BE INERT, WHICH IS NOT THE SAME AS SAFE.
  //
  // The skip was added because ten archive rows carried a `captured_at` of
  // 2026-08-11T01:58:26..39 for games played 2026-08-05 — thirteen seconds
  // apart and sequential, which is a loop calling new Date() per row. If
  // snapshot_time is never NULL, that fallback cannot be where those stamps
  // came from, and the mechanism that produced them is still unfixed.
  //
  // So: for every archived closing line, does its captured_at match the
  // snapshot_time of its own odds_history row?
  const cmp = await d1(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN json_extract(g.closing_odds, '$.captured_at') = oh.snapshot_time
                     THEN 1 ELSE 0 END) AS same,
            SUM(CASE WHEN json_extract(g.closing_odds, '$.captured_at') <> oh.snapshot_time
                     THEN 1 ELSE 0 END) AS differ
       FROM (SELECT id, closing_odds FROM regular_season_games WHERE closing_odds IS NOT NULL
             UNION ALL
             SELECT id, closing_odds FROM postseason_games     WHERE closing_odds IS NOT NULL) g
       JOIN odds_history oh ON oh.game_id = g.id`);
  const c = cmp[0] || {};
  say(`\n--- 4. is the archive's captured_at the odds_history snapshot_time?`);
  say(`    archived closing lines with an odds_history row : ${c.n ?? 0}`);
  say(`    captured_at == snapshot_time                     : ${c.same ?? 0}`);
  say(`    captured_at <> snapshot_time                     : ${c.differ ?? 0}`);

  const drift = await d1(
    `SELECT g.id,
            json_extract(g.closing_odds, '$.captured_at') AS captured_at,
            oh.snapshot_time,
            json_extract(g.closing_odds, '$.source') AS source
       FROM (SELECT id, closing_odds FROM regular_season_games WHERE closing_odds IS NOT NULL
             UNION ALL
             SELECT id, closing_odds FROM postseason_games     WHERE closing_odds IS NOT NULL) g
       JOIN odds_history oh ON oh.game_id = g.id
      WHERE json_extract(g.closing_odds, '$.captured_at') <> oh.snapshot_time
      ORDER BY captured_at DESC LIMIT 10`);
  for (const r of drift)
    say(`      ${r.id}\n        blob ${r.captured_at}  vs  history ${r.snapshot_time}  (source ${r.source})`);

  // --- 5. WHO wrote the 22, and did the history row exist when they did?
  //
  // The blobs carry 10:00:4x.xxxZ with milliseconds, decrementing by fractions
  // of a second across games in one batch — a loop calling new Date(). Their
  // odds_history rows carry 23:5x:xxZ the same evening, LATER than the blob.
  // Two readings fit: the history row had no snapshot_time at write time and
  // got one later, or a different writer produced the blob entirely. change_log
  // names the writer; guessing between them from the timestamps does not.
  const authors = await d1(
    `SELECT cl.source, COUNT(*) AS writes, MIN(cl.ts) AS first_ts, MAX(cl.ts) AS last_ts
       FROM change_log cl
      WHERE cl.field = 'closing_odds'
        AND cl.game_id IN (
          SELECT g.id
            FROM (SELECT id, closing_odds FROM regular_season_games WHERE closing_odds IS NOT NULL
                  UNION ALL
                  SELECT id, closing_odds FROM postseason_games     WHERE closing_odds IS NOT NULL) g
            JOIN odds_history oh ON oh.game_id = g.id
           WHERE json_extract(g.closing_odds, '$.captured_at') <> oh.snapshot_time)
      GROUP BY cl.source ORDER BY writes DESC`);
  say(`\n--- 5. who wrote the rows whose captured_at is not the snapshot_time`);
  if (!authors.length) say(`    change_log names NO writer for any of them — they predate attribution.`);
  for (const a of authors)
    say(`    ${String(a.source).padEnd(24)} ${String(a.writes).padStart(4)} write(s)   ${a.first_ts} .. ${a.last_ts}`);

  say(`\nCOVERAGE: every odds_history row was counted in step 0; steps 1-3 are`);
  say(`    restricted to the writer's own candidate predicate, transcribed above, and`);
  say(`    to games dated before ${TODAY_UTC}. Step 3 lists at most 25 of its group.`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `outbox/odds-history-snapshot-time-${stamp}.log`;
  writeFileSync(path, log.join('\n') + '\n');
  console.log(`\nwrote ${path}`);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
