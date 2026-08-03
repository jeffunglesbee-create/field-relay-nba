// CC-CMD-2026-08-03-fix-drama-backfill-situational-fields TASK 3.
// One-shot: identifies the real, scoped set of rows written by the buggy
// Node backfill script (drama_arc is a bare JSON ARRAY -- the shape only
// drama-backfill.mjs's computeDramaRetroactive ever produces; every client
// write path, live or client-side-backfill, always writes drama_arc as a
// JSON OBJECT with keys like peak/samples/classification -- confirmed via
// code read of jubilant-bassoon src/legacy/field.js's own
// computeDramaRetroactive + both /archive/drama POST call sites).
// Captures full before-state for every matched row (for real, named-game
// verification later), resets ONLY those rows' drama_peak/drama_arc to
// NULL, then reports real before/after counts.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';

async function d1(sql, params) {
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!res.ok || body.success === false) throw new Error(`d1 exec failed: HTTP ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  console.log('=== Task 3: identify + capture + reset buggy-script-written MLB rows ===\n');

  for (const table of ['regular_season_games', 'postseason_games']) {
    console.log(`--- ${table} ---`);
    const selectSql = `SELECT id, sport, date, home, away, home_score, away_score, drama_peak, drama_arc
                        FROM ${table}
                        WHERE sport='MLB' AND drama_peak IS NOT NULL AND drama_arc LIKE '[%'
                        ORDER BY date DESC`;
    const before = await d1(selectSql);
    const rows = before.results || [];
    console.log(`Matched rows (array-shape drama_arc, sport=MLB): ${rows.length}`);
    rows.forEach(r => {
      console.log(`  [before] id=${r.id} date=${r.date} ${r.home} vs ${r.away} (${r.home_score}-${r.away_score}) drama_peak=${r.drama_peak} arc_head=${(r.drama_arc||'').slice(0,60)}`);
    });

    if (rows.length === 0) {
      console.log('  (nothing to reset in this table)\n');
      continue;
    }

    const resetSql = `UPDATE ${table}
                       SET drama_peak = NULL, drama_arc = NULL
                       WHERE sport='MLB' AND drama_peak IS NOT NULL AND drama_arc LIKE '[%'`;
    const resetResult = await d1(resetSql);
    console.log(`  RESET executed. changes=${resetResult.meta?.changes}`);

    const after = await d1(selectSql);
    console.log(`  After reset, matching rows remaining: ${(after.results || []).length} (expected 0)\n`);
  }

  console.log('=== Done ===');
}

main().catch(e => { console.error('RESET ERROR:', e); process.exit(1); });
