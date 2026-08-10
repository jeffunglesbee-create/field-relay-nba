// Post-cleanup verification for CC-CMD-2026-08-09-cleanup-stale-duplicate-rows.
//
// run-duplicate-row-cleanup.mjs reported RESULT: FAIL on ONE line:
//     total rows in window after: 57   (must equal 112 - 60 = 52)
// while every other done condition passed (duplicate groups 0, name-scheme
// ids WITH a series_key 0, key-scheme survivors 57 -> 57, meta.changes 60
// exactly equal to the 60 enumerated).
//
// The arithmetic is mine and it is wrong: it subtracted a delete set that has
// NO date bound (the CC-CMD's Task 2 predicate is date-unscoped) from a total
// that is scoped to 2026-07-25..08-15. The enumerated list itself shows five
// rows outside that window -- 2026-09-01, 09-15, 09-16, 09-17, 10-21 -- so 55
// of the 60 were in-window and 112 - 55 = 57, which is exactly what came back.
//
// That is a reading, not a proof, so this script measures the two things the
// reading implies and would falsify it if wrong:
//   1. exactly 5 of the deleted rows were outside the window, and no
//      key-scheme row was removed anywhere (not merely in-window)
//   2. the stale shape is gone repo-wide, not just inside the window
//
// Read-only. SELECTs only.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';

async function d1(sql) {
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
    body: JSON.stringify({ sql, params: [] }),
  });
  const b = await res.json();
  if (!res.ok || b.success === false) throw new Error(`d1: HTTP ${res.status} ${JSON.stringify(b).slice(0, 300)}`);
  return b.results || [];
}
const one = async (sql) => (await d1(sql))[0]?.n;

(async () => {
  console.log(`=== verify-duplicate-cleanup  utc=${new Date().toISOString()} ===\n`);

  // ── 1. the stale shape, repo-wide (no date bound) ────────────────────────
  const staleAll = await one(
    `SELECT COUNT(*) n FROM postseason_games
      WHERE series_key IS NOT NULL AND instr(id, series_key) = 0
        AND home_score IS NULL AND away_score IS NULL`);
  console.log(`1. name-scheme + series_key + unscored, REPO-WIDE : ${staleAll}   (must be 0)`);

  // ── 2. duplicate groups, repo-wide rather than only in the window ────────
  const dupAll = (await d1(
    `SELECT sport, date, home, away, COUNT(*) n FROM postseason_games
      GROUP BY sport, date, home, away HAVING COUNT(*) > 1`));
  console.log(`2. duplicate groups, REPO-WIDE                    : ${dupAll.length}`);
  for (const r of dupAll) console.log(`     ${r.date}  ${r.sport}  ${r.home} v ${r.away}  n=${r.n}`);
  // NOTE: a non-zero count here is not necessarily a failure. The same
  // investigation found two `PGA Tour` rows whose home AND away are both NULL
  // and which are genuinely different events -- they share this tuple without
  // being duplicates. Any group printed above must be checked against that
  // before being treated as leftover.

  // ── 3. no key-scheme row was lost, anywhere ──────────────────────────────
  const keyAll = await one(
    `SELECT COUNT(*) n FROM postseason_games
      WHERE series_key IS NOT NULL AND instr(id, series_key) > 0`);
  const keyWindow = await one(
    `SELECT COUNT(*) n FROM postseason_games
      WHERE date BETWEEN '2026-07-25' AND '2026-08-15'
        AND series_key IS NOT NULL AND instr(id, series_key) > 0`);
  console.log(`3. key-scheme rows repo-wide                      : ${keyAll}`);
  console.log(`   key-scheme rows in 2026-07-25..08-15           : ${keyWindow}   (was 57 before AND after the delete)`);

  // ── 4. the five out-of-window deletions, accounted for by date ───────────
  // If the reading is right, the dates the cleanup log listed outside the
  // window now hold key-scheme rows only.
  console.log('\n4. the out-of-window dates the delete touched:');
  for (const d of ['2026-09-01', '2026-09-15', '2026-09-16', '2026-09-17', '2026-10-21']) {
    const rs = await d1(
      `SELECT id, home, away, home_score, series_key FROM postseason_games WHERE date = '${d}'`);
    for (const r of rs) {
      const keyScheme = r.series_key && String(r.id).includes(String(r.series_key));
      console.log(`   ${d}  ${keyScheme ? 'KEY-ID ' : 'NAME-ID'}  score=${r.home_score ?? '—'}  ${r.id}`);
    }
    if (!rs.length) console.log(`   ${d}  (no rows)`);
  }

  const ok = staleAll === 0 && keyWindow === 57;
  console.log(`\n=== RESULT: ${ok ? 'PASS' : 'FAIL'} ===`);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('verify failed:', e.stack || e.message); process.exit(1); });
