// CC-CMD-2026-08-13-jq-density-unit-fix — DONE CONDITION 4 and 5.
//
// 4. /quality/report's alert count, with any alert still reporting
//    failure_pct: 100 while avg_score > threshold named explicitly. That
//    combination is self-contradictory and must not survive unexplained.
// 5. The cutover timestamp recorded per TASK 3, read back from the live
//    endpoint rather than from the source file — a constant that is not
//    actually served is not recorded anywhere a reader will look.
//
// Read-only.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const DAYS = process.env.REPORT_DAYS || '30';
const TS = new Date().toISOString();

(async () => {
  const out = { ts: TS, relay: RELAY, days: Number(DAYS) };
  try {
    const r = await fetch(`${RELAY}/quality/report?days=${DAYS}`, { signal: AbortSignal.timeout(30000) });
    out.httpStatus = r.status;
    const j = await r.json();

    out.alertCount = j.alert_count ?? (j.alerts || []).length;
    out.alerts = (j.alerts || []).map(a => ({
      brief_type: a.brief_type, sport: a.sport, alert: a.alert,
      threshold: a.threshold, threshold_source: a.threshold_source,
      avg_score: a.avg_score,
      failure_pct: a.failure_pct,
      below_flat_240_pct: a.below_flat_240_pct,
    }));

    // THE self-contradiction check. Before this CC-CMD every alert of this
    // shape existed; after it, none may.
    out.selfContradictory = out.alerts.filter(
      a => a.failure_pct === 100 && a.avg_score > a.threshold);
    // Weaker but related: any alert whose failure_pct disagrees with its own
    // threshold in direction.
    out.stillUsingFlat240 = out.alerts.filter(
      a => a.below_flat_240_pct === 100 && a.failure_pct !== 100).length;

    // DONE CONDITION 5 — the era table, served.
    out.scoringEras = j.scoring_eras || null;
    out.windowStraddlesEra = j.window_straddles_era || null;
    out.era3Recorded = Array.isArray(j.scoring_eras)
      && j.scoring_eras.some(e => e.era === 3 && typeof e.from === 'string');

    console.log(`alert_count: ${out.alertCount}`);
    console.log(`self-contradictory (failure_pct 100 AND avg_score > threshold): ${out.selfContradictory.length}`);
    for (const a of out.selfContradictory) console.log('  CONTRADICTORY:', JSON.stringify(a));
    console.log(`era 3 recorded and served: ${out.era3Recorded}`);
    console.log(`window straddles: ${JSON.stringify(out.windowStraddlesEra)}`);
    console.log('\nalerts:');
    for (const a of out.alerts) {
      console.log(`  ${String(a.brief_type).padEnd(22)} ${String(a.sport).padEnd(10)} ` +
        `thr=${String(a.threshold).padStart(4)} avg=${String(a.avg_score).padStart(6)} ` +
        `fail=${String(a.failure_pct).padStart(3)}% flat240=${String(a.below_flat_240_pct).padStart(3)}%  ${a.alert}`);
    }
  } catch (e) {
    out.error = String(e.stack || e.message || e);
    console.error('verify failed:', out.error);
  }

  const fs = await import('node:fs');
  fs.mkdirSync('outbox', { recursive: true });
  fs.writeFileSync(`outbox/jq-report-verify-${TS.replace(/[:.]/g, '-')}.json`, JSON.stringify(out, null, 2));
  process.exit(0);
})();
