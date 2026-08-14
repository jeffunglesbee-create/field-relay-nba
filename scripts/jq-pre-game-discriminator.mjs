// TASK 1 of CC-CMD-2026-08-14-unscored-pre-game-backlog: what separates the 11
// unscored pre_game briefs from the ~101 that ARE scored?
//
// Code reading already found a strong candidate: src/index.js ~8486 is the ONLY
// writer in the file that hardcodes `quality_score` as a literal NULL in the
// INSERT, and it writes brief_type='pre_game' with source='cron'. Every other
// briefs writer either binds a real score or binds it as a parameter.
//
// That is a hypothesis from reading, not a finding. If it is right, the unscored
// rows cluster ENTIRELY on source='cron' and the scored pre_game rows come from
// some other source. If unscored rows appear under several sources, or scored
// rows also appear under 'cron', the read is wrong and the cause is elsewhere.
// This asks the data, exactly as the CC-CMD specifies.
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
  console.log(`=== jq-pre-game-discriminator  utc=${new Date().toISOString()} ===\n`);

  // ── The CC-CMD's discriminator, verbatim in intent ────────────────────────
  const bySource = await d1(
    `SELECT source, model, COUNT(*) n,
            SUM(CASE WHEN quality_score IS NULL THEN 1 ELSE 0 END) unscored
       FROM briefs WHERE brief_type = 'pre_game'
      GROUP BY source, model ORDER BY n DESC`);
  console.log('pre_game briefs by (source, model):');
  console.log('  source                model                      n   unscored');
  for (const r of bySource) {
    console.log(`  ${String(r.source).padEnd(20)} ${String(r.model).padEnd(24)} ${String(r.n).padStart(4)} ${String(r.unscored).padStart(10)}`);
  }

  // Does the cluster hold cleanly, or is it mixed?
  const unscoredSources = bySource.filter(r => r.unscored > 0).map(r => r.source);
  const cronRows = bySource.filter(r => r.source === 'cron');
  const cronUnscored = cronRows.reduce((a, r) => a + r.unscored, 0);
  const cronTotal = cronRows.reduce((a, r) => a + r.n, 0);
  const otherUnscored = bySource.filter(r => r.source !== 'cron').reduce((a, r) => a + r.unscored, 0);

  console.log(`\nsources holding unscored rows : ${[...new Set(unscoredSources)].join(', ') || '(none)'}`);
  console.log(`source='cron'                 : ${cronUnscored}/${cronTotal} unscored`);
  console.log(`every other source            : ${otherUnscored} unscored`);

  // ── Is the same true repo-wide? A literal-NULL writer would show up as an ──
  // ── entire (brief_type, source) pair that is 100% unscored.                ──
  const allTypes = await d1(
    `SELECT brief_type, source, COUNT(*) n,
            SUM(CASE WHEN quality_score IS NULL THEN 1 ELSE 0 END) unscored
       FROM briefs GROUP BY brief_type, source
      HAVING unscored > 0 ORDER BY unscored DESC`);
  console.log('\nEVERY (brief_type, source) pair holding unscored rows, repo-wide:');
  for (const r of allTypes) {
    const pct = ((r.unscored / r.n) * 100).toFixed(0);
    console.log(`  ${String(r.brief_type).padEnd(16)} ${String(r.source).padEnd(20)} ${String(r.unscored).padStart(4)}/${String(r.n).padEnd(5)} (${pct}%)`);
  }

  // ── Control: pre_game rows written by 'cron' that DID get scored, if any ───
  // If some exist, the writer is not unconditionally unscored and the cause is
  // narrower than "this INSERT hardcodes NULL".
  const cronScored = await d1(
    `SELECT COUNT(*) n FROM briefs
      WHERE brief_type = 'pre_game' AND source = 'cron' AND quality_score IS NOT NULL`);
  console.log(`\npre_game + source='cron' rows WITH a score: ${cronScored[0]?.n ?? '?'}`);

  const clean = cronUnscored > 0 && otherUnscored === 0 && (cronScored[0]?.n ?? 0) === 0;
  console.log(`\n=> ${clean
    ? "CONFIRMED — unscored pre_game rows are exactly the source='cron' set, and NO cron-written "
      + 'pre_game row has ever been scored. Consistent with the literal-NULL INSERT at src/index.js ~8486.'
    : 'NOT A CLEAN CLUSTER — the reading from code does not fully explain the data. Investigate before fixing.'}`);
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
