// CC-CMD-2026-08-09-cfl-seed-row-backfill, Task 3.
//
// Two rows only: the 2026-06-06 CFL fixtures that carry NULL scores and no
// source id, created 2026-06-15 by a writer that predates the collector. The
// collector in handleJournalismCycle is bounded to yesterday+today by design,
// so it can never reach them.
//
// The upsert path was read from src/index.js before writing, not taken on
// trust: /archive/game's regular_season_games INSERT has
// ON CONFLICT(id) DO UPDATE ... home_score = COALESCE(excluded.home_score,
// home_score), so a write carrying real scores fills a NULL without
// disturbing any other column.
//
// Field mapping is the collector's own, copied from the [ARCHIVE-CFL] block:
// sport 'CFL', league 'CFL', venue null (no venue exists anywhere in that
// payload -- inventing one would be a Rule 2 violation), start_time t.date,
// source_id t.id.

const RELAY  = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SOURCE = 'https://cflscoreboard.cfl.ca/json/scoreboard/rounds.json';
const TARGET_DATE = '2026-06-06';

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
const cflRows = () => d1(
  `SELECT id, date, home, away, home_score, away_score, espn_event_id
     FROM regular_season_games WHERE sport='CFL' ORDER BY date`).then(rows);

(async () => {
  console.log(`=== CFL seed-row backfill  utc=${new Date().toISOString()} ===\n`);

  const before = await cflRows();
  console.log('--- BEFORE ---');
  for (const r of before) console.log(`   ${r.date}  ${r.away} @ ${r.home}  ${r.away_score}-${r.home_score}  src=${r.espn_event_id}`);
  const targets = before.filter((r) => r.date === TARGET_DATE && r.home_score == null);
  if (!targets.length) {
    console.log('\nMOOT: no null-score rows on the target date. Nothing to do.');
    process.exit(0);
  }

  const srcRes = await fetch(SOURCE, { signal: AbortSignal.timeout(15000) });
  if (!srcRes.ok) throw new Error(`cflscoreboard HTTP ${srcRes.status}`);
  const roundsJson = await srcRes.json();
  if (!Array.isArray(roundsJson)) throw new Error('cflscoreboard root was not an array');

  const games = [];
  for (const round of roundsJson) {
    for (const t of (round?.tournaments || [])) {
      if (t?.status !== 'complete') continue;                 // THE GATE, same as the collector's
      if (String(t?.date || '').slice(0, 10) !== TARGET_DATE) continue;
      games.push(t);
    }
  }
  console.log(`\n--- SOURCE: ${games.length} completed games on ${TARGET_DATE} ---`);
  for (const t of games) console.log(`   ${t.awaySquad?.name} @ ${t.homeSquad?.name}  ${t.awaySquad?.score}-${t.homeSquad?.score}  id=${t.id}`);

  if (games.length !== targets.length) {
    console.error(`\nABORT: ${targets.length} null-score rows but ${games.length} completed source games. Writing a mismatched set risks creating a row rather than filling one.`);
    process.exit(1);
  }

  console.log('\n--- WRITE ---');
  for (const t of games) {
    const body = {
      sport: 'CFL', league: 'CFL',
      date: String(t.date).slice(0, 10),
      home: t.homeSquad?.name || '',
      away: t.awaySquad?.name || '',
      home_score: t.homeSquad?.score ?? null,
      away_score: t.awaySquad?.score ?? null,
      venue: null,
      start_time: t.date || null,
      source_id: t.id ? String(t.id) : null,
    };
    const r = await fetch(`${RELAY}/archive/game`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    console.log(`   ${body.away} @ ${body.home}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  }

  await new Promise((s) => setTimeout(s, 5000));

  console.log('\n--- AFTER (done condition) ---');
  const after = await cflRows();
  for (const r of after) console.log(`   ${r.date}  ${r.away} @ ${r.home}  ${r.away_score}-${r.home_score}  src=${r.espn_event_id}`);
  const stillNull = after.filter((r) => r.home_score == null && r.away_score == null);
  const zeroZero  = after.filter((r) => r.home_score === 0 && r.away_score === 0);
  console.log(`\n   null-score rows: ${stillNull.length}  (must be 0)`);
  console.log(`   0-0 phantom rows: ${zeroZero.length}  (must stay 0)`);
  // The row count must not grow: the point is filling NULLs via upsert, and a
  // new row would mean the id did not match and a duplicate was created.
  console.log(`   row count before/after: ${before.length}/${after.length}  (must be equal)`);
  const ok = stillNull.length === 0 && zeroZero.length === 0 && after.length === before.length;
  console.log(`\n=== RESULT: ${ok ? 'PASS' : 'FAIL'} ===`);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('backfill failed:', e.stack || e.message); process.exit(1); });
