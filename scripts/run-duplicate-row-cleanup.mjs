// CC-CMD-2026-08-09-cleanup-stale-duplicate-rows, Tasks 1-3.
//
// Deletes the stale name-scheme siblings in postseason_games left behind by
// the two bulk schedule imports either side of the archive id-scheme change.
//
// DELETE is permitted through /d1/execute -- confirmed from source
// (src/index.js:13130), not assumed. That handler has no verb restriction; it
// extracts the table with /(?:INTO|FROM|UPDATE|TABLE)\s+(\w+)/i and checks it
// against ALLOWED_TABLES, which contains 'postseason_games'. `DELETE FROM
// postseason_games` therefore matches on FROM and passes.
//
// Every gate is re-run HERE rather than inherited from the preflight log: the
// preflight ran earlier, and a DELETE must be gated on the state it is about
// to act on, not on a state that was true some minutes ago.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';

// The delete predicate, written ONCE and shared by the SELECT (Task 2) and the
// DELETE (Task 3). Two hand-copied predicates could drift by a character and
// delete a set that was never enumerated -- which is precisely the failure the
// enumerate-first task exists to prevent.
const PREDICATE = `
  series_key IS NOT NULL
  AND instr(id, series_key) = 0
  AND home_score IS NULL AND away_score IS NULL
  AND EXISTS (SELECT 1 FROM postseason_games k
               WHERE k.sport = postseason_games.sport
                 AND k.date  = postseason_games.date
                 AND k.home  = postseason_games.home
                 AND k.away  = postseason_games.away
                 AND instr(k.id, k.series_key) > 0)`;

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

// Independent of the probe's pass-2 tally, which is scoped to rows INSIDE a
// duplicate group -- so once the groups collapse that tally necessarily reads
// 0 for every bucket, including the survivors. Counting key-scheme rows over
// the whole window is the only measurement that can show survivors were kept.
const KEY_SCHEME_SURVIVORS = `
  SELECT COUNT(*) n FROM postseason_games
   WHERE date BETWEEN '2026-07-25' AND '2026-08-15'
     AND series_key IS NOT NULL AND instr(id, series_key) > 0`;

(async () => {
  console.log(`=== duplicate-row cleanup  relay=${RELAY}  utc=${new Date().toISOString()} ===\n`);

  // ── TASK 1: the blocking safety check, re-run immediately before the write ─
  console.log('--- TASK 1: briefs referencing a stale name-scheme row ---');
  const refs = rows(await d1(
    `SELECT COUNT(*) n FROM briefs b
       JOIN postseason_games g ON b.game_id = g.id
      WHERE g.series_key IS NOT NULL
        AND instr(g.id, g.series_key) = 0
        AND g.home_score IS NULL`))[0]?.n;
  console.log(`   referenced stale rows: ${refs}`);
  if (refs !== 0) {
    console.error('\nSTOP: a brief references a row in the stale set. Deleting it would break the analytics JOIN silently. No DELETE issued.');
    process.exit(1);
  }

  // ── TASK 2: enumerate before deleting ────────────────────────────────────
  console.log('\n--- TASK 2: the delete set, enumerated ---');
  const delSet = rows(await d1(
    `SELECT id, sport, date, home, away, series_key, created_at
       FROM postseason_games WHERE ${PREDICATE} ORDER BY date, home`));
  for (const r of delSet) console.log(`   ${r.date}  ${r.sport}  ${r.away} @ ${r.home}  id=${r.id}`);
  console.log(`   delete-set count: ${delSet.length}`);
  if (delSet.length < 50 || delSet.length > 60) {
    console.error(`\nSTOP: ${delSet.length} rows, not close to the measured 55. The predicate is wrong. No DELETE issued.`);
    process.exit(1);
  }

  const survivorsBefore = rows(await d1(KEY_SCHEME_SURVIVORS))[0]?.n;
  const totalBefore = rows(await d1(
    `SELECT COUNT(*) n FROM postseason_games WHERE date BETWEEN '2026-07-25' AND '2026-08-15'`))[0]?.n;
  console.log(`   key-scheme survivors before: ${survivorsBefore}`);
  console.log(`   total rows in window before: ${totalBefore}`);

  // ── TASK 3: delete ───────────────────────────────────────────────────────
  console.log('\n--- TASK 3: DELETE ---');
  const del = await d1(`DELETE FROM postseason_games WHERE ${PREDICATE}`);
  const changes = del.meta?.changes ?? null;
  console.log(`   meta.changes: ${changes}`);
  if (changes !== delSet.length) {
    console.error(`\nFAIL: deleted ${changes} rows but enumerated ${delSet.length}. The two must be equal.`);
    process.exit(1);
  }

  console.log('\n--- DONE CONDITION ---');
  const dupes = rows(await d1(
    `SELECT sport, date, home, away, COUNT(*) n FROM postseason_games
      WHERE date BETWEEN '2026-07-25' AND '2026-08-15'
      GROUP BY sport, date, home, away HAVING COUNT(*) > 1`));
  const survivorsAfter = rows(await d1(KEY_SCHEME_SURVIVORS))[0]?.n;
  const totalAfter = rows(await d1(
    `SELECT COUNT(*) n FROM postseason_games WHERE date BETWEEN '2026-07-25' AND '2026-08-15'`))[0]?.n;
  const staleLeft = rows(await d1(
    `SELECT COUNT(*) n FROM postseason_games
      WHERE date BETWEEN '2026-07-25' AND '2026-08-15'
        AND series_key IS NOT NULL AND instr(id, series_key) = 0`))[0]?.n;
  console.log(`   duplicate groups: ${dupes.length}                (must be 0)`);
  console.log(`   name-scheme ids WITH a series_key: ${staleLeft}   (must be 0)`);
  console.log(`   key-scheme survivors after: ${survivorsAfter}      (must equal ${survivorsBefore})`);
  console.log(`   total rows in window after: ${totalAfter}      (must equal ${totalBefore} - ${delSet.length} = ${totalBefore - delSet.length})`);

  const ok = dupes.length === 0
    && staleLeft === 0
    && survivorsAfter === survivorsBefore
    && totalAfter === totalBefore - delSet.length;
  console.log(`\n=== RESULT: ${ok ? 'PASS' : 'FAIL'} ===`);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('cleanup failed:', e.stack || e.message); process.exit(1); });
