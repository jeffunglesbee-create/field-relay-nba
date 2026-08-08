// CC-CMD-2026-08-08-confirm-duplicate-fixture-mechanism.
//
// CONFIRMATION ONLY. SELECTs exclusively. That CC-CMD forbids applying
// either candidate fix, so nothing here writes.
//
// The CC-CMD's working hypothesis, stated as "consistent with every observed
// pair but not yet confirmed": the pre-game SEED writes from `gameMeta` (built
// from ESPN's scoreboard), which carries no `series_key`, so it always takes
// the name-based branch of the id ternary, while resolution always has one and
// takes the series_key branch -- two permanent writers, not a migration.
//
// Reading the source refutes half of that. The seed body at the
// '[ARCHIVE-SEED]' fetch really does omit series_key (it sends sport, league,
// date, home, away, venue, start_time, streams, source_id and nothing else),
// and gameMeta really is built purely from ESPN scoreboard events, which carry
// no MLS series_key -- so the seed genuinely cannot obtain one. That part
// holds.
//
// But a spot check of a real duplicate pair shows the NAME-BASED row itself
// carrying a populated series_key column:
//   id  MLS_2026-08-05_clubdeftbolmonterreyrayadosac_orlandocity
//   series_key  MLS-COM-000006_MLS-MAT-000A38
// A row cannot have been written by the seed path and still carry a
// series_key. So at least that pair was written by a caller that HAD a
// series_key at a time when the id ternary did not yet use it -- which is the
// migration story the code comment tells, not the two-permanent-writers story
// the CC-CMD hypothesises.
//
// One pair is an anecdote. These queries measure it across the whole
// duplicate population, so the answer rests on the distribution rather than
// on the sample that happened to be looked at first.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';

async function d1(sql, params) {
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!res.ok || body.success === false) {
    throw new Error(`d1 exec failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 400)}`);
  }
  return body.results || body.result || [];
}

function rows(r) {
  if (Array.isArray(r)) return r[0]?.results || r;
  return r.results || [];
}

(async () => {
  console.log(`=== duplicate-fixture-probe  relay=${RELAY}  utc=${new Date().toISOString()} ===`);

  // ── 1. Re-measure the duplicates fresh (Rule 87 — don't trust the doc) ──
  // A duplicate is two rows sharing (sport, date, home, away). espn_event_id
  // is null on every measured pair, so it is unusable as the join key -- which
  // is itself a fact the CC-CMD's option 2 depends on, re-checked below.
  console.log('\n--- 1. duplicate groups by (sport, date, home, away), postseason_games ---');
  const dupes = rows(await d1(
    `SELECT sport, date, home, away, COUNT(*) AS n
       FROM postseason_games
      WHERE date BETWEEN '2026-07-25' AND '2026-08-15'
      GROUP BY sport, date, home, away
     HAVING COUNT(*) > 1
      ORDER BY date, home`,
    [],
  ));
  console.log(`   duplicate groups: ${dupes.length}`);
  for (const x of dupes) console.log(`   ${x.date}  ${x.sport}  ${x.home} v ${x.away}  n=${x.n}`);

  // ── 2. THE DISCRIMINATOR ────────────────────────────────────────────────
  // For every row inside a duplicate group: does it carry a series_key, and
  // which id scheme does its id follow?
  //
  //   name-based id + series_key NULL     -> seed path. Hypothesis holds.
  //   name-based id + series_key PRESENT  -> written by a series_key-bearing
  //                                          caller before the id ternary
  //                                          started using it. Migration.
  //
  // The id scheme is detected by structure, not by guessing: the series_key
  // branch builds `${sport}_${series_key}_${round}_${date}`, so its id
  // contains the series_key as a substring. The name branch builds
  // `${sport}_${date}_${idTail}`, so its id contains the date right after the
  // sport. Both are checkable in SQL without parsing.
  console.log('\n--- 2. id scheme vs series_key presence, within duplicate groups ---');
  const detail = rows(await d1(
    // Joined rather than written as a row-value `(a,b,c) IN (SELECT ...)`:
    // row-value IN needs SQLite >= 3.15 and this probe should not depend on
    // D1's exact engine version to return an answer.
    `SELECT g.id, g.sport, g.date, g.home, g.away, g.home_score, g.away_score,
            g.series_key, g.espn_event_id, g.created_at, g.finalized_at
       FROM postseason_games g
       JOIN (SELECT sport, date, home, away
               FROM postseason_games
              WHERE date BETWEEN '2026-07-25' AND '2026-08-15'
              GROUP BY sport, date, home, away
             HAVING COUNT(*) > 1) d
         ON g.sport = d.sport AND g.date = d.date
        AND g.home = d.home AND g.away = d.away
      WHERE g.date BETWEEN '2026-07-25' AND '2026-08-15'
      ORDER BY g.date, g.home, g.created_at`,
    [],
  ));
  let nameWithKey = 0, nameNoKey = 0, keyScheme = 0;
  for (const x of detail) {
    const usesKeyScheme = x.series_key && String(x.id).includes(String(x.series_key));
    if (usesKeyScheme) keyScheme++;
    else if (x.series_key) nameWithKey++;
    else nameNoKey++;
    console.log(
      `   ${x.date} ${String(x.home).slice(0, 22).padEnd(22)} ` +
      `${usesKeyScheme ? 'KEY-ID ' : 'NAME-ID'} ` +
      `series_key=${x.series_key ? 'present' : 'NULL   '} ` +
      `espn_event_id=${x.espn_event_id ? 'present' : 'NULL'} ` +
      `score=${x.home_score ?? '—'}-${x.away_score ?? '—'} created=${x.created_at}`,
    );
  }
  console.log('\n   TALLY:');
  console.log(`     key-scheme ids                      : ${keyScheme}`);
  console.log(`     name-scheme ids WITH a series_key   : ${nameWithKey}   <- migration shape`);
  console.log(`     name-scheme ids with NO series_key  : ${nameNoKey}   <- seed-path shape`);
  console.log('   If nameNoKey is 0, the seed path is NOT producing these duplicates');
  console.log('   and the CC-CMD hypothesis is refuted by the data, not by argument.');

  // ── 3. Option 2's stated precondition, re-checked ───────────────────────
  // The CC-CMD proposes read-time dedupe on (sport, date, home, away) and
  // asks whether two genuinely different games can share that tuple -- a
  // doubleheader. Checked against rows that are NOT duplicates of the kind
  // above: same tuple, both scored, different scores.
  console.log('\n--- 3. would (sport, date, home, away) dedupe ever merge two REAL games? ---');
  for (const table of ['regular_season_games', 'postseason_games']) {
    const r = rows(await d1(
      `SELECT sport, date, home, away, COUNT(*) AS n,
              COUNT(DISTINCT home_score || '-' || away_score) AS distinct_scores
         FROM ${table}
        WHERE home_score IS NOT NULL AND away_score IS NOT NULL
        GROUP BY sport, date, home, away
       HAVING COUNT(*) > 1 AND distinct_scores > 1
        ORDER BY date DESC
        LIMIT 40`,
      [],
    ));
    console.log(`   ${table}: ${r.length} tuple(s) with 2+ scored rows carrying DIFFERENT scores`);
    for (const x of r) console.log(`      ${x.date} ${x.sport} ${x.home} v ${x.away} n=${x.n} distinct_scores=${x.distinct_scores}`);
  }

  console.log('\n=== probe complete (read-only; no rows were modified) ===');
})().catch((e) => { console.error('PROBE FAILED:', e.message); process.exit(1); });
