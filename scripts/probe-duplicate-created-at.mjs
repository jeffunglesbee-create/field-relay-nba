// CC-CMD-2026-08-09-cleanup-stale-duplicate-rows — the check its Task 2 implies
// but does not spell out, and which the preflight made necessary.
//
// The 2026-08-08 investigation measured 55 rows in 2026-07-25..08-15, all from
// two bulk writes (created_at 2026-06-30 19:27 and 2026-07-16 12:23). The
// preflight today enumerates 60, now reaching 2026-10-21.
//
// The CC-CMD's own tolerance ("if the count is not close to 55, the predicate
// is wrong") is about the predicate. This asks the question behind it: is the
// growth from the SAME two historical imports simply covering a wider date
// range than the original 14-day sample, or is a live writer still producing
// name-scheme rows? Those have opposite answers -- one-time cleanup versus
// deleting rows that will come straight back, which would be treating a
// symptom exactly as the CFL CC-CMD warns against.
//
// READ-ONLY.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
async function d1(sql) {
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
    body: JSON.stringify({ sql, params: [] }),
  });
  const b = await res.json();
  if (!res.ok || b.success === false) throw new Error(`d1: ${JSON.stringify(b).slice(0, 300)}`);
  return b.results || b.result || [];
}
const rows = (r) => (Array.isArray(r) ? (r[0]?.results || r) : (r.results || []));

const PRED = `g.series_key IS NOT NULL
        AND instr(g.id, g.series_key) = 0
        AND g.home_score IS NULL AND g.away_score IS NULL
        AND EXISTS (SELECT 1 FROM postseason_games k
                     WHERE k.sport = g.sport AND k.date = g.date
                       AND k.home = g.home AND k.away = g.away
                       AND instr(k.id, k.series_key) > 0)`;

(async () => {
  console.log(`=== duplicate created_at distribution  utc=${new Date().toISOString()} ===\n`);

  const dist = rows(await d1(
    `SELECT substr(g.created_at,1,16) minute, COUNT(*) n
       FROM postseason_games g WHERE ${PRED}
      GROUP BY minute ORDER BY minute`));
  console.log('--- created_at, to the minute ---');
  for (const r of dist) console.log(`   ${r.minute}  n=${r.n}`);

  const newest = rows(await d1(
    `SELECT MAX(g.created_at) newest, MIN(g.created_at) oldest, COUNT(*) n
       FROM postseason_games g WHERE ${PRED}`))[0];
  console.log(`\n   oldest=${newest.oldest}  newest=${newest.newest}  total=${newest.n}`);

  // The decisive question: anything written in the last 14 days would mean a
  // live writer, not a historical import.
  const recent = rows(await d1(
    `SELECT COUNT(*) n FROM postseason_games g
      WHERE ${PRED} AND g.created_at > datetime('now','-14 days')`))[0];
  console.log(`   created in the last 14 days: ${recent.n}`);

  const verdict = recent.n === 0
    ? 'PROCEED -- every row predates the last 14 days; this is a historical import, so a one-time DELETE is a real cleanup'
    : `STOP -- ${recent.n} rows written within 14 days: a live writer is still producing name-scheme rows, and deleting them treats a symptom`;
  console.log(`\n=== VERDICT: ${verdict} ===`);
})().catch((e) => { console.error('probe failed:', e.stack || e.message); process.exit(1); });
