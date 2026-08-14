// Before "fixing" the pre_game write path, check whether it is ALREADY fixed.
//
// The facts so far do not fit the story I had. If pre_game were scored only by
// the manual, LIMIT-capped /backfill/brief-scores endpoint (ORDER BY created_at
// DESC), then the NEWEST unscored rows would be picked first — yet the 11
// unscored rows are the OLDEST pre_game rows in the table (2026-07-16 .. 08-01)
// and everything newer is scored. A manual backfill cannot produce that pattern
// by accident.
//
// The pattern it DOES fit: at some point the write path started scoring
// pre_game on write, and these 11 predate that change. If so, TASK 2 of the
// CC-CMD ("fix the write path") is already satisfied and re-fixing it would be
// an unprompted rewrite of working code (Rule 69) — the only real work left is
// the backfill.
//
// This finds the boundary date instead of assuming one exists.
//
// Read-only. SELECTs only.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';

async function d1(sql) {
  const r = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
    body: JSON.stringify({ sql, params: [] }),
  });
  const b = await r.json();
  if (!r.ok || b.success === false) throw new Error(`d1 ${r.status}: ${JSON.stringify(b).slice(0, 300)}`);
  return b.results || [];
}

(async () => {
  console.log(`=== jq-pre-game-timeline  utc=${new Date().toISOString()} ===\n`);

  const span = await d1(
    `SELECT CASE WHEN quality_score IS NULL THEN 'unscored' ELSE 'scored' END state,
            COUNT(*) n, MIN(created_at) first_written, MAX(created_at) last_written
       FROM briefs WHERE brief_type = 'pre_game' GROUP BY state`);
  console.log('pre_game rows by state:');
  for (const r of span) {
    console.log(`  ${String(r.state).padEnd(9)} n=${String(r.n).padStart(4)}  first=${r.first_written}  last=${r.last_written}`);
  }

  // Day by day: is there a clean boundary, or are scored and unscored interleaved?
  // Interleaved would kill the "write path changed" reading.
  const byDay = await d1(
    `SELECT substr(created_at,1,10) day, COUNT(*) n,
            SUM(CASE WHEN quality_score IS NULL THEN 1 ELSE 0 END) unscored
       FROM briefs WHERE brief_type = 'pre_game'
      GROUP BY day ORDER BY day`);
  console.log('\nper write-day (created_at), oldest first:');
  console.log('  day          n  unscored');
  for (const r of byDay) {
    const flag = r.unscored === r.n ? '  <- all unscored' : r.unscored > 0 ? '  <- MIXED' : '';
    console.log(`  ${r.day}  ${String(r.n).padStart(3)}  ${String(r.unscored).padStart(8)}${flag}`);
  }

  const mixed = byDay.filter(r => r.unscored > 0 && r.unscored < r.n);
  const allUnscoredDays = byDay.filter(r => r.unscored === r.n).map(r => r.day);
  const cleanDays = byDay.filter(r => r.unscored === 0).map(r => r.day);

  console.log(`\ndays where every pre_game row is unscored : ${allUnscoredDays.join(', ') || '(none)'}`);
  console.log(`days where every pre_game row is scored   : ${cleanDays.length} day(s), earliest ${cleanDays[0] || '—'}`);
  console.log(`days with BOTH (mixed)                    : ${mixed.length}`);

  const boundaryClean = mixed.length === 0
    && allUnscoredDays.length > 0
    && cleanDays.length > 0
    && Math.max(...allUnscoredDays.map(d => d.replace(/-/g, '') * 1))
       < Math.min(...cleanDays.map(d => d.replace(/-/g, '') * 1));

  console.log(`\n=> ${boundaryClean
    ? `CLEAN BOUNDARY — every unscored row predates every scored row, no mixed days. Consistent with the write path gaining scoring after ${allUnscoredDays[allUnscoredDays.length - 1]}. TASK 2 is likely already satisfied; verify in code before changing anything.`
    : 'NO CLEAN BOUNDARY — scored and unscored pre_game rows interleave in time, so a one-time write-path change does not explain the gap. The scoring path is intermittent; do NOT skip TASK 2.'}`);
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
