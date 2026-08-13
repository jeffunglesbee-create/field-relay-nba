// Label existing briefs with the scoring era they were scored under.
//
// NOT a rescore. Nothing recomputes any quality_score — this only records
// WHICH formula produced the score already stored, which is information the
// table never captured and which was reconstructible only by hand until now.
//
// Boundaries from SCORING_ERAS (src/journalism-quality.js), read here as
// literals because /d1/execute takes SQL, not an import. Kept in one place in
// this file so a drift is visible in one diff:
//
//   era 1  ..           < 2026-07-16   pre-6aed3bb
//   era 2  2026-07-16   .. 2026-08-12  6aed3bb (Dim 1 per-sentence, Dim 4 clamped)
//   era 3  >= 2026-08-13               Dim 4 unit -> numbers/sentence
//
// Boundary DATES are excluded, not guessed: era `from` timestamps carry a time
// of day and `briefs.date` does not, so a same-day row cannot be attributed.
// Those rows keep scoring_version NULL and the report falls back to
// eraForDate(), which flags them ambiguous and drops them from era-scoped
// calibration. A handful of unlabelled rows is better than a wrong label.
//
// Idempotent: every UPDATE is guarded by `scoring_version IS NULL`, so a
// re-run cannot relabel a row that a future writer has already stamped.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const APPLY = process.env.APPLY === 'true';
const TS = new Date().toISOString();

const ERA2_DATE = '2026-07-16';
const ERA3_DATE = '2026-08-13';

async function d1(sql) {
  const r = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
    body: JSON.stringify({ sql, params: [] }),
  });
  const b = await r.json();
  if (!r.ok || b.success === false) throw new Error(`d1 ${r.status}: ${JSON.stringify(b).slice(0, 300)}`);
  return b;
}
const rows = (b) => b.results || [];

(async () => {
  const out = { ts: TS, apply: APPLY, era2: ERA2_DATE, era3: ERA3_DATE };
  try {
    // The column must exist. It is created by ensureScoringVersionColumn on
    // the first /quality/report call after deploy, so touch that first rather
    // than assuming the migration has run.
    const probe = await fetch(`${RELAY}/quality/report?days=1`, { signal: AbortSignal.timeout(30000) });
    out.reportTouch = probe.status;

    const before = rows(await d1(
      `SELECT scoring_version, COUNT(*) n FROM briefs
        WHERE quality_score IS NOT NULL GROUP BY scoring_version`));
    out.before = before;
    console.log('before:', JSON.stringify(before));

    // Enumerate what each rule WOULD touch before touching anything.
    const plan = {};
    for (const [label, where] of Object.entries({
      era1: `date < '${ERA2_DATE}'`,
      era2: `date > '${ERA2_DATE}' AND date < '${ERA3_DATE}'`,
      era3: `date > '${ERA3_DATE}'`,
      boundary_excluded: `date IN ('${ERA2_DATE}','${ERA3_DATE}')`,
    })) {
      const c = rows(await d1(
        `SELECT COUNT(*) n FROM briefs
          WHERE quality_score IS NOT NULL AND scoring_version IS NULL AND (${where})`));
      plan[label] = c[0]?.n ?? 0;
    }
    out.plan = plan;
    console.log('plan:', JSON.stringify(plan));

    if (!APPLY) {
      console.log('\nDRY RUN — set APPLY=true to write. No rows changed.');
    } else {
      for (const [era, where] of [
        [1, `date < '${ERA2_DATE}'`],
        [2, `date > '${ERA2_DATE}' AND date < '${ERA3_DATE}'`],
        [3, `date > '${ERA3_DATE}'`],
      ]) {
        const r = await d1(
          `UPDATE briefs SET scoring_version = ${era}
            WHERE quality_score IS NOT NULL AND scoring_version IS NULL AND (${where})`);
        console.log(`  era ${era}: changes=${r.meta?.changes ?? 'n/a'}`);
        out[`applied_era${era}`] = r.meta?.changes ?? null;
      }
      const after = rows(await d1(
        `SELECT scoring_version, COUNT(*) n FROM briefs
          WHERE quality_score IS NOT NULL GROUP BY scoring_version`));
      out.after = after;
      console.log('after:', JSON.stringify(after));

      // DONE CONDITION: every scored row is labelled EXCEPT the boundary-date
      // rows, which must remain NULL by design.
      const stillNull = rows(await d1(
        `SELECT COUNT(*) n FROM briefs
          WHERE quality_score IS NOT NULL AND scoring_version IS NULL`))[0]?.n ?? null;
      out.stillNull = stillNull;
      out.expectedNull = plan.boundary_excluded;
      out.pass = stillNull === plan.boundary_excluded;
      console.log(`\nstill NULL: ${stillNull}  expected (boundary dates): ${plan.boundary_excluded}`);
      console.log(`=== RESULT: ${out.pass ? 'PASS' : 'FAIL'} ===`);
    }
  } catch (e) {
    out.error = String(e.stack || e.message || e);
    console.error('backfill failed:', out.error);
  }

  const fs = await import('node:fs');
  fs.mkdirSync('outbox', { recursive: true });
  fs.writeFileSync(`outbox/jq-scoring-version-backfill-${TS.replace(/[:.]/g, '-')}.json`, JSON.stringify(out, null, 2));
  process.exit(0);
})();
