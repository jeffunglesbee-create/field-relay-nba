// Are the 4 unscored briefs a stall, or just in-flight?
//
// jq-health-watch 20260814T100504Z showed the first non-zero unscored count
// since the provenance pass: 4 rows (3 pre_game/mlb, 1 pre_game/nfl) against
// 324 scored over 7 days. The 20260813T224618Z baseline had ZERO unscored on
// every day in its window, so this is a deviation, not the usual state.
//
// Two readings fit that number and they call for opposite responses:
//   (a) IN-FLIGHT — the rows were written minutes ago and the scoring pass has
//       simply not reached them yet. Nothing is wrong; the number decays.
//   (b) STALLED — the rows are hours old and are not going to be scored. The
//       write path is outrunning the scoring path for these types, and 100%
//       coverage was masking it.
//
// The discriminator is AGE, which the coverage script never prints — it groups
// by `date` (the game's date), not by when the row was written. A pre_game brief
// for tomorrow's game is dated tomorrow and written today, which is exactly why
// an 08-15 row showed up "unscored" in a window ending 08-14 and why date alone
// cannot answer this.
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
  console.log(`=== jq-unscored-triage  utc=${new Date().toISOString()} ===\n`);

  // What columns actually exist? Don't guess a timestamp column name.
  const cols = await d1(`PRAGMA table_info(briefs)`);
  const names = cols.map(c => c.name);
  console.log('briefs columns:', names.join(', '), '\n');

  const tsCol = ['created_at', 'generated_at', 'inserted_at', 'ts', 'updated_at']
    .find(c => names.includes(c)) || null;
  console.log(`timestamp column in use: ${tsCol || 'NONE FOUND — age cannot be measured'}\n`);

  const sel = tsCol ? `${tsCol} AS ts,` : '';
  const rows = await d1(
    `SELECT ${sel} date, brief_type, sport, quality_score, scoring_version,
            substr(COALESCE(id,''),1,48) id
       FROM briefs
      WHERE quality_score IS NULL
      ORDER BY ${tsCol || 'date'} DESC
      LIMIT 40`);

  console.log(`unscored rows (repo-wide, not window-scoped): ${rows.length}`);
  for (const r of rows) {
    let age = '';
    if (r.ts) {
      const ms = Date.now() - new Date(r.ts).getTime();
      age = Number.isFinite(ms) ? `  age=${(ms / 60000).toFixed(1)}min` : '';
    }
    console.log(`  ${r.ts || '(no ts)'}  ${String(r.date).padEnd(11)} ${String(r.brief_type).padEnd(14)} ${String(r.sport).padEnd(6)}${age}  ${r.id}`);
  }

  // The control the reading needs: how fast does a SCORED brief normally get
  // scored? If unscored rows are younger than the typical scoring lag, (a).
  if (tsCol) {
    const recent = await d1(
      `SELECT ${tsCol} AS ts, brief_type, sport, quality_score, scoring_version
         FROM briefs
        WHERE quality_score IS NOT NULL
        ORDER BY ${tsCol} DESC LIMIT 10`);
    console.log('\nmost recent SCORED briefs (for comparison):');
    for (const r of recent) {
      const ms = Date.now() - new Date(r.ts).getTime();
      console.log(`  ${r.ts}  ${String(r.brief_type).padEnd(14)} ${String(r.sport).padEnd(6)} score=${r.quality_score} v=${r.scoring_version ?? '—'}  age=${(ms / 60000).toFixed(1)}min`);
    }

    const oldest = rows.filter(r => r.ts).map(r => Date.now() - new Date(r.ts).getTime());
    if (oldest.length) {
      const maxAgeMin = Math.max(...oldest) / 60000;
      console.log(`\noldest unscored row: ${maxAgeMin.toFixed(1)} min`);
      // The journalism cron is */15. Anything much past a couple of cycles is
      // not "in flight" by any reading.
      console.log(maxAgeMin <= 30
        ? '=> READING (a) IN-FLIGHT — younger than two 15-min cron cycles.'
        : '=> READING (b) STALLED — older than two cron cycles; the scoring path is not reaching these.');
    }
  }
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
