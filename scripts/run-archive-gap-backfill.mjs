// CC-CMD-2026-08-09-backfill-archive-gap-dates, Tasks 3 and 4.
//
// Gates cleared by outbox/preflight-archive-backfills-*.log:
//   both dates still hold zero MLB/WNBA rows
//   ESPN still serves them -- 20260805 events=15, 20260806 events=11
//
// The endpoint contract was read from src/index.js:10430, not assumed:
//   /archive/backfill?date=YYYY-MM-DD, GET or POST, single-date,
//   delegating to executeBackfill(env, date).
// Single-date is why this loops two dates rather than passing a range: there
// is no range parameter to pass, and 2026-08-07 must not be touched.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const DATES = ['2026-08-05', '2026-08-06'];   // NOT 08-07: it recovered on its own

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

const countFor = async () => {
  const out = {};
  for (const r of rows(await d1(
    `SELECT date, sport, COUNT(*) n FROM regular_season_games
      WHERE date BETWEEN '2026-07-30' AND '2026-08-09' AND sport IN ('MLB','WNBA')
      GROUP BY date, sport ORDER BY date, sport`))) {
    out[r.date] = (out[r.date] || 0) + r.n;
  }
  return out;
};

(async () => {
  console.log(`=== archive gap backfill  utc=${new Date().toISOString()} ===\n`);

  const before = await countFor();
  console.log('--- BEFORE ---');
  for (const [d, n] of Object.entries(before)) console.log(`   ${d}  n=${n}`);
  for (const d of DATES) {
    if (before[d]) {
      console.error(`ABORT: ${d} already has ${before[d]} rows. The CC-CMD forbids a second backfill over existing rows.`);
      process.exit(1);
    }
  }

  console.log('\n--- BACKFILL ---');
  for (const date of DATES) {
    const r = await fetch(`${RELAY}/archive/backfill?date=${date}`, {
      method: 'POST',
      headers: { 'X-FIELD-Relay': 'field-relay-cron-2026' },
      signal: AbortSignal.timeout(120000),
    });
    const body = await r.text();
    console.log(`   ${date}: HTTP ${r.status} ${body.slice(0, 400)}`);
  }

  // Settle: the writer commits per-game, so read back after a pause rather
  // than immediately -- an early read would understate and look like a failure.
  await new Promise((s) => setTimeout(s, 8000));

  console.log('\n--- AFTER (Task 4 done condition) ---');
  const after = await countFor();
  for (const [d, n] of Object.entries(after)) console.log(`   ${d}  n=${n}`);

  const perSport = rows(await d1(
    `SELECT date, sport, COUNT(*) n FROM regular_season_games
      WHERE date IN ('2026-08-05','2026-08-06') GROUP BY date, sport ORDER BY date, sport`));
  console.log('\n   per-sport on the two dates:');
  for (const r of perSport) console.log(`   ${r.date}  ${r.sport}  n=${r.n}`);

  // Sample real scores: a row count alone would not distinguish real games
  // from empty skeletons, and the CC-CMD asks for "plausible scores".
  const sample = rows(await d1(
    `SELECT date, sport, home, away, home_score, away_score FROM regular_season_games
      WHERE date IN ('2026-08-05','2026-08-06') AND sport='MLB'
      ORDER BY date LIMIT 6`));
  console.log('\n   sample rows:');
  for (const r of sample) console.log(`   ${r.date}  ${r.away} @ ${r.home}  ${r.away_score}-${r.home_score}`);

  const zeroDays = [];
  for (let t = Date.parse('2026-07-30'); t <= Date.parse('2026-08-09'); t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (!after[d]) zeroDays.push(d);
  }
  const mlb = Object.fromEntries(perSport.filter((r) => r.sport === 'MLB').map((r) => [r.date, r.n]));
  const ok = DATES.every((d) => (mlb[d] || 0) > 0) && zeroDays.length === 0;
  console.log(`\n   remaining zero-days 07-30..08-09: ${JSON.stringify(zeroDays)}`);
  console.log(`\n=== RESULT: ${ok ? 'PASS' : 'FAIL'} — MLB rows on both dates and no zero-day remains ===`);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('backfill failed:', e.stack || e.message); process.exit(1); });
