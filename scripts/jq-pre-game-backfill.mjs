// TASK 1 (finish) + TASK 3 of CC-CMD-2026-08-14-unscored-pre-game-backlog.
//
// WHAT THE DISCRIMINATOR ACTUALLY SHOWED (and what it killed):
// My code reading said "src/index.js ~8486 hardcodes quality_score NULL for
// pre_game, that's the bug." The data said otherwise — 105 of 116 pre_game/cron
// rows ARE scored, same source, same model, same writer. So the literal NULL is
// by design, not the defect.
//
// Reading further found the real shape. Nothing scores pre_game on write. They
// are scored by `GET /backfill/brief-scores` (src/index.js ~12465), which is a
// MANUAL, pull-only endpoint — no cron calls it. Its selection is:
//
//     WHERE quality_score IS NULL AND brief_text IS NOT NULL
//       AND LENGTH(brief_text) > 50
//     ORDER BY created_at DESC LIMIT ?        (default 20, max 50)
//
// So pre_game coverage is "whatever the last manual run happened to reach."
// 105 were reached; 11 were not. That is a coverage gap, not a scoring failure.
//
// But there is a second possibility hiding in that WHERE clause, and it changes
// the fix: LENGTH(brief_text) > 50 is a PERMANENT exclusion. Any row under 51
// chars can never be selected, no matter how many times the backfill runs.
// If the 11 are short, running the backfill again is futile and the CC-CMD's
// TASK 3 needs a different answer per row.
//
// This measures that first, then acts on the answer, then proves the result.
//
// Writes: only via the repo's OWN /backfill/brief-scores endpoint (Rule 62 —
// do not invent a second scorer). No direct UPDATE of quality_score here.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SECRET = process.env.RELAY_SHARED_SECRET || 'field-relay-cron-2026';
const APPLY = process.env.APPLY === 'true';

async function d1(sql) {
  const r = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': SECRET },
    body: JSON.stringify({ sql, params: [] }),
  });
  const b = await r.json();
  if (!r.ok || b.success === false) throw new Error(`d1 ${r.status}: ${JSON.stringify(b).slice(0, 300)}`);
  return b.results || [];
}

const getJson = async (path) => {
  const r = await fetch(`${RELAY}${path}`, { headers: { 'X-FIELD-Relay': SECRET }, signal: AbortSignal.timeout(120000) });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; }
  catch { return { status: r.status, raw: t.slice(0, 300) }; }
};

(async () => {
  console.log(`=== jq-pre-game-backfill  apply=${APPLY}  utc=${new Date().toISOString()} ===\n`);

  // ── 1. Can the backfill endpoint even see these rows? ────────────────────
  const rows = await d1(
    `SELECT id, date, sport, LENGTH(brief_text) len, created_at
       FROM briefs
      WHERE brief_type = 'pre_game' AND quality_score IS NULL
      ORDER BY created_at DESC`);
  console.log(`unscored pre_game rows: ${rows.length}`);
  console.log('  len  date        sport            created_at            eligible(>50)  id');
  let ineligible = 0;
  for (const r of rows) {
    const ok = r.len > 50;
    if (!ok) ineligible++;
    console.log(`  ${String(r.len).padStart(4)}  ${String(r.date).padEnd(11)} ${String(r.sport).padEnd(16)} ${String(r.created_at).padEnd(21)} ${ok ? 'yes' : 'NO — PERMANENTLY EXCLUDED'}   ${String(r.id).slice(0, 44)}`);
  }
  console.log(`\neligible for /backfill/brief-scores : ${rows.length - ineligible}`);
  console.log(`permanently excluded (len <= 50)   : ${ineligible}`);

  // ── 1b. WHICH mechanism scored the other 105? ────────────────────────────
  // Not idle curiosity — the CC-CMD's TASK 2 says "fix the write path", and the
  // timeline probe falsified the premise that there is one broken write path:
  // scored and unscored pre_game rows interleave across 4 mixed days, so this is
  // intermittent, not a one-time regression. Fixing a path I have not identified
  // would be a guess (Rule 48 class D).
  //
  // The discriminator: the cron writer at src/index.js ~8486 never sets
  // context_hash. The /archive/brief path (~11639) does, and it scores
  // server-side then upserts with
  // `quality_score = COALESCE(excluded.quality_score, briefs.quality_score)`.
  // An in-place backfill UPDATE (~12530 / ~12613) sets quality_score and leaves
  // context_hash NULL. So context_hash separates "scored by the archive path"
  // from "scored later in place".
  const mech = await d1(
    `SELECT CASE WHEN quality_score IS NULL THEN 'unscored'
                 WHEN context_hash IS NULL THEN 'scored, no context_hash (in-place UPDATE)'
                 ELSE 'scored, has context_hash (archive/brief upsert)' END mechanism,
            COUNT(*) n, MIN(created_at) first, MAX(created_at) last
       FROM briefs WHERE brief_type = 'pre_game'
      GROUP BY mechanism ORDER BY n DESC`);
  console.log('\nhow pre_game rows got their score:');
  for (const r of mech) {
    console.log(`  ${String(r.mechanism).padEnd(46)} n=${String(r.n).padStart(4)}  ${r.first} .. ${r.last}`);
  }

  // ── 2. Confirm against the endpoint's own dry run, not just my SQL ────────
  const dry = await getJson('/backfill/brief-scores?dry=true&type=pre_game&limit=50');
  console.log(`\ndry run: status=${dry.status} ${JSON.stringify(dry.body || dry.raw)}`);

  if (!APPLY) {
    console.log('\nAPPLY not set — stopping before any write. Re-dispatch with APPLY=true.');
    process.exit(0);
  }

  // ── 3. Execute the backfill via the repo's own endpoint ──────────────────
  console.log('\n--- APPLY: POSTing to the existing backfill endpoint ---');
  const run = await getJson('/backfill/brief-scores?type=pre_game&limit=50');
  console.log(`status=${run.status}`);
  console.log(JSON.stringify(run.body || run.raw, null, 2));

  // ── 4. Prove the result. This is the done condition, not the run's own ───
  // ── self-report — the endpoint saying "scored: N" is its claim, the row  ───
  // ── count is the fact.                                                    ───
  const after = await d1(
    `SELECT COUNT(*) n FROM briefs WHERE brief_type = 'pre_game' AND quality_score IS NULL`);
  const afterAll = await d1(`SELECT COUNT(*) n FROM briefs WHERE quality_score IS NULL`);
  console.log(`\nunscored pre_game AFTER : ${after[0]?.n}`);
  console.log(`unscored repo-wide AFTER: ${afterAll[0]?.n}`);

  const remaining = after[0]?.n ?? -1;
  console.log(`\n=== RESULT: ${remaining === 0
    ? 'PASS — every unscored pre_game brief now carries a score.'
    : remaining === ineligible && ineligible > 0
      ? `PARTIAL — ${remaining} remain, exactly the rows the endpoint's LENGTH(brief_text) > 50 filter excludes. Not a backfill failure; report per row.`
      : `FAIL — ${remaining} remain, which does NOT equal the ${ineligible} length-excluded rows. Investigate before reporting.`} ===`);
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
