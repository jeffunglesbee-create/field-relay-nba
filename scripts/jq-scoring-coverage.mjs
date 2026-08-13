// Are briefs actually being scored right now?
//
// The 2026-08-13 provenance pass left a watch item: era-scoped calibration
// activates once era 3 holds >=5 scored briefs per type, "expected within
// hours on a 15-minute journalism cron". That prediction is only sound if
// briefs are being SCORED as they are written. If they are being written
// unscored, era 3 never fills, the watch item never resolves, and nothing
// says so — it would look like patience rather than a stall.
//
// So this measures the thing the prediction depends on, rather than waiting
// to see whether the prediction comes true.
//
// Per (brief_type, sport) over a recent window:
//   total / scored / unscored, and how many carry scoring_version = 3
//
// Read-only. SELECTs and one GET.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const DAYS = Number(process.env.COVERAGE_DAYS || 7);
const TS = new Date().toISOString();

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
  const out = { ts: TS, days: DAYS };
  try {
    const since = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
    out.since = since;

    // Per day: is the scoring path keeping up with the writing path?
    const byDay = await d1(
      `SELECT date,
              COUNT(*) total,
              COUNT(quality_score) scored,
              SUM(CASE WHEN quality_score IS NULL THEN 1 ELSE 0 END) unscored,
              SUM(CASE WHEN scoring_version = 3 THEN 1 ELSE 0 END) era3
         FROM briefs WHERE date >= '${since}'
        GROUP BY date ORDER BY date`);
    out.byDay = byDay;
    console.log('date        total  scored  unscored  era3');
    for (const r of byDay) {
      console.log(`${r.date}  ${String(r.total).padStart(5)}  ${String(r.scored).padStart(6)}  ` +
        `${String(r.unscored).padStart(8)}  ${String(r.era3).padStart(4)}`);
    }

    const byType = await d1(
      `SELECT brief_type, sport,
              COUNT(*) total,
              COUNT(quality_score) scored,
              SUM(CASE WHEN quality_score IS NULL THEN 1 ELSE 0 END) unscored
         FROM briefs WHERE date >= '${since}'
        GROUP BY brief_type, sport
        ORDER BY unscored DESC, total DESC`);
    out.byType = byType;
    console.log('\nbrief_type / sport with UNSCORED rows:');
    const unscoredTypes = byType.filter(r => r.unscored > 0);
    for (const r of unscoredTypes) {
      console.log(`  ${String(r.brief_type).padEnd(22)} ${String(r.sport || '').padEnd(24)} ` +
        `total=${String(r.total).padStart(4)} scored=${String(r.scored).padStart(4)} unscored=${String(r.unscored).padStart(4)}`);
    }
    if (!unscoredTypes.length) console.log('  (none)');

    // Era 3 specifically — the population the watch item depends on.
    const era3 = await d1(
      `SELECT brief_type, COUNT(*) n FROM briefs
        WHERE scoring_version = 3 GROUP BY brief_type ORDER BY n DESC`);
    out.era3ByType = era3;
    out.era3Total = era3.reduce((a, r) => a + r.n, 0);
    console.log(`\nera-3 scored briefs: ${out.era3Total} total`);
    for (const r of era3) console.log(`  ${String(r.brief_type).padEnd(22)} ${r.n}`);
    console.log(`  types at the >=5 calibration floor: ${era3.filter(r => r.n >= 5).length}`);

    // The endpoint's own view, for cross-check.
    const rep = await fetch(`${RELAY}/quality/report?days=${DAYS}`, { signal: AbortSignal.timeout(30000) });
    const j = await rep.json();
    out.reportUnscoredTypes = j.unscored_types || [];
    out.reportUnscoredCount = j.unscored_count ?? null;
    console.log(`\n/quality/report unscored_types: ${JSON.stringify(out.reportUnscoredTypes)}`);

    const totals = byDay.reduce((a, r) => ({
      total: a.total + r.total, scored: a.scored + r.scored, unscored: a.unscored + r.unscored,
    }), { total: 0, scored: 0, unscored: 0 });
    out.totals = totals;
    out.scoredPct = totals.total ? Math.round((totals.scored / totals.total) * 1000) / 10 : 0;
    console.log(`\nlast ${DAYS}d: ${totals.scored}/${totals.total} scored (${out.scoredPct}%), ${totals.unscored} unscored`);

    // The watch item is only sound if scoring keeps up. Anything materially
    // short of complete means era 3 fills slower than predicted, or not at all.
    out.scoringHealthy = out.scoredPct >= 95;
    console.log(`\n=== scoring healthy (>=95% scored): ${out.scoringHealthy} ===`);
  } catch (e) {
    out.error = String(e.stack || e.message || e);
    console.error('coverage failed:', out.error);
  }

  const fs = await import('node:fs');
  fs.mkdirSync('outbox', { recursive: true });
  fs.writeFileSync(`outbox/jq-scoring-coverage-${TS.replace(/[:.]/g, '-')}.json`, JSON.stringify(out, null, 2));
  process.exit(0);
})();
