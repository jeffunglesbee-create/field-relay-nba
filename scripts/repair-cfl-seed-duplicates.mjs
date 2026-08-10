// Repair for the failed CC-CMD-2026-08-09-cfl-seed-row-backfill Task 3 run
// (workflow run 31350990187, log outbox/run-cfl-seed-backfill-20260810T025307Z.log).
//
// WHAT WENT WRONG
//
// run-cfl-seed-backfill.mjs POSTed the two real 2026-06-06 CFL results to
// /archive/game expecting ON CONFLICT(id) DO UPDATE to fill the seed rows'
// NULL scores. It did not: row count went 5 -> 7 and both seed rows are still
// null-null. The upsert never fired because it keys on `id`, and the seed
// rows' ids were not built by this route.
//
// From source (src/index.js:11072-11141), /archive/game builds
//     shortify = s => String(s).toLowerCase().replace(/[^a-z0-9]/g,'')
//     id = `${sport}_${date}_${shortify(home)}_${shortify(away)}`
// for a caller with no series_key. Note this is NOT the "Redblacks" vs
// "RedBlacks" casing difference visible in the log -- shortify lowercases, so
// both collapse to `ottawaredblacks`. The mismatch is therefore in the seed
// rows' id scheme itself, written 2026-06-15 by a writer that predates this
// route's scheme. Task 1 below prints both ids side by side so the cause is
// an artifact rather than this paragraph's assertion.
//
// WHY DELETE THE SEED ROWS RATHER THAN RE-TRY THE FILL
//
// This is now exactly the postseason stale-sibling shape: an unscored
// name-scheme row alongside a real scored row for the same fixture. The scored
// rows carry the source id and are the ones every downstream read wants. There
// is no id under which a write could reach the seed rows short of renaming
// them, and id renaming is the specific hazard src/index.js:11105 declines to
// accept. Deleting the two superseded rows reaches the CC-CMD's own done
// condition -- null-score rows: 0, no phantoms, no duplicates -- and reverses
// the two rows this session added.
//
// Strictly bounded: sport CFL, date 2026-06-06, home_score AND away_score
// NULL, espn_event_id NULL, and a scored sibling must exist for the same
// fixture. Five conditions, all required.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const TARGET_DATE = '2026-06-06';

async function d1(sql) {
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
    body: JSON.stringify({ sql, params: [] }),
  });
  const b = await res.json();
  if (!res.ok || b.success === false) throw new Error(`d1: HTTP ${res.status} ${JSON.stringify(b).slice(0, 300)}`);
  return b;
}
const rows = (b) => b.results || [];
const cflRows = async () => rows(await d1(
  `SELECT id, date, home, away, home_score, away_score, espn_event_id, created_at
     FROM regular_season_games WHERE sport='CFL' ORDER BY date, id`));

// The same shortify as src/index.js:11072, so the expected id can be computed
// here and COMPARED to what is actually stored -- rather than asserting a
// mismatch that was only reasoned about.
const shortify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const DELETE_PREDICATE = `
  sport = 'CFL'
  AND date = '${TARGET_DATE}'
  AND home_score IS NULL AND away_score IS NULL
  AND espn_event_id IS NULL
  AND EXISTS (SELECT 1 FROM regular_season_games k
               WHERE k.sport = 'CFL' AND k.date = regular_season_games.date
                 AND k.home_score IS NOT NULL
                 AND k.espn_event_id IS NOT NULL
                 AND lower(replace(replace(k.home,' ',''),'-','')) =
                     lower(replace(replace(regular_season_games.home,' ',''),'-','')))`;

(async () => {
  console.log(`=== repair-cfl-seed-duplicates  relay=${RELAY}  utc=${new Date().toISOString()} ===\n`);

  // ── TASK 1: the id mismatch, as an artifact ──────────────────────────────
  console.log('--- 1. every CFL row, with its stored id and the id /archive/game WOULD build ---');
  const before = await cflRows();
  for (const r of before) {
    const wouldBe = `CFL_${r.date}_${shortify(r.home)}_${shortify(r.away)}`;
    console.log(`   ${r.date}  ${String(r.away).slice(0, 24).padEnd(24)} @ ${String(r.home).slice(0, 24).padEnd(24)} ` +
      `${r.away_score ?? '—'}-${r.home_score ?? '—'}  src=${r.espn_event_id ?? 'NULL'}`);
    console.log(`        stored id : ${r.id}`);
    console.log(`        route id  : ${wouldBe}   ${r.id === wouldBe ? '<- MATCH' : '<- MISMATCH (this is why the upsert missed)'}`);
  }

  // ── TASK 2: nothing may reference the rows about to be deleted ───────────
  // Same blocking check as the postseason cleanup: briefs.game_id JOINs
  // games.id in src/analytics-engine.js, and a deleted referent breaks that
  // join silently.
  console.log('\n--- 2. briefs referencing a row in the delete set ---');
  const refs = rows(await d1(
    `SELECT COUNT(*) n FROM briefs b
       JOIN regular_season_games g ON b.game_id = g.id
      WHERE g.sport='CFL' AND g.date='${TARGET_DATE}'
        AND g.home_score IS NULL AND g.espn_event_id IS NULL`))[0]?.n;
  console.log(`   referenced rows: ${refs}`);
  if (refs !== 0) {
    console.error('\nSTOP: a brief references one of these rows. No DELETE issued.');
    process.exit(1);
  }

  // ── TASK 3: enumerate, then delete exactly that set ──────────────────────
  console.log('\n--- 3. delete set ---');
  const delSet = rows(await d1(
    `SELECT id, date, home, away, created_at FROM regular_season_games WHERE ${DELETE_PREDICATE}`));
  for (const r of delSet) console.log(`   ${r.date}  ${r.away} @ ${r.home}  id=${r.id}  created=${r.created_at}`);
  console.log(`   count: ${delSet.length}  (must be exactly 2)`);
  if (delSet.length !== 2) {
    console.error(`\nSTOP: expected exactly the 2 seed rows, got ${delSet.length}. No DELETE issued.`);
    process.exit(1);
  }

  const del = await d1(`DELETE FROM regular_season_games WHERE ${DELETE_PREDICATE}`);
  const changes = del.meta?.changes ?? null;
  console.log(`   meta.changes: ${changes}`);

  // ── DONE CONDITION: the CC-CMD's own, unchanged ──────────────────────────
  console.log('\n--- DONE CONDITION ---');
  const after = await cflRows();
  for (const r of after) console.log(`   ${r.date}  ${r.away} @ ${r.home}  ${r.away_score ?? '—'}-${r.home_score ?? '—'}  src=${r.espn_event_id ?? 'NULL'}`);
  const stillNull = after.filter((r) => r.home_score == null && r.away_score == null);
  const zeroZero = after.filter((r) => r.home_score === 0 && r.away_score === 0);
  const onTarget = after.filter((r) => r.date === TARGET_DATE);
  console.log(`\n   null-score CFL rows: ${stillNull.length}   (must be 0)`);
  console.log(`   0-0 phantom rows:    ${zeroZero.length}   (must be 0)`);
  console.log(`   rows on ${TARGET_DATE}:  ${onTarget.length}   (must be 2 -- one per real fixture)`);
  console.log(`   total CFL rows: ${before.length} -> ${after.length}   (must be ${before.length - 2}, i.e. the 2 rows this session added are gone)`);

  const ok = stillNull.length === 0 && zeroZero.length === 0
    && onTarget.length === 2 && changes === 2 && after.length === before.length - 2;
  console.log(`\n=== RESULT: ${ok ? 'PASS' : 'FAIL'} ===`);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('repair failed:', e.stack || e.message); process.exit(1); });
