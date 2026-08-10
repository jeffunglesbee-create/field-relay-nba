// Pre-flight for the three archive CC-CMDs, run as ONE dispatch because they
// share this harness and every one of them opens with a gating probe:
//
//   CC-CMD-2026-08-09-backfill-archive-gap-dates    Tasks 1 + 2
//   CC-CMD-2026-08-09-cfl-seed-row-backfill         Task 1
//   CC-CMD-2026-08-09-cleanup-stale-duplicate-rows  Tasks 1 + 2
//
// READ-ONLY. SELECTs and GETs only. Nothing here writes, because each of those
// CC-CMDs says explicitly that its gate decides whether the write happens at
// all -- and two of them say to STOP on a particular answer.
//
// Every gate is reported as its own verdict rather than rolled into a single
// pass/fail: they are independent decisions and merging them would let one
// CC-CMD's green wave another one through.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
// Read from src/index.js:658, not written from memory -- site.api.espn.com
// 403s Worker egress and is the wrong host.
const ESPN_API_BASE = 'https://site.web.api.espn.com/apis/site/v2';

async function d1(sql, params = []) {
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!res.ok || body.success === false) {
    throw new Error(`d1 failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body.results || body.result || [];
}
const rows = (r) => (Array.isArray(r) ? (r[0]?.results || r) : (r.results || []));

(async () => {
  console.log(`=== preflight-archive-backfills  relay=${RELAY}  utc=${new Date().toISOString()} ===\n`);
  const verdicts = {};

  // ── GATE A: are the gap dates still empty? ───────────────────────────────
  // "If they are now populated, something else backfilled them -- stop."
  console.log('--- A. archive gap: MLB/WNBA rows per date, 2026-07-30..2026-08-09 ---');
  const perDate = rows(await d1(
    `SELECT date, sport, COUNT(*) n FROM regular_season_games
      WHERE date BETWEEN '2026-07-30' AND '2026-08-09' AND sport IN ('MLB','WNBA')
      GROUP BY date, sport ORDER BY date, sport`));
  for (const r of perDate) console.log(`   ${r.date}  ${r.sport}  n=${r.n}`);
  const byDate = {};
  for (const r of perDate) byDate[r.date] = (byDate[r.date] || 0) + r.n;
  const gapDates = ['2026-08-05', '2026-08-06'];
  const stillEmpty = gapDates.filter((d) => !byDate[d]);
  const zeroDays = [];
  for (let t = Date.parse('2026-07-30'); t <= Date.parse('2026-08-09'); t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (!byDate[d]) zeroDays.push(d);
  }
  console.log(`   still-empty gap dates: ${JSON.stringify(stillEmpty)}`);
  console.log(`   all zero-days in window: ${JSON.stringify(zeroDays)}`);
  verdicts.gapStillEmpty = stillEmpty.length === 2
    ? 'PROCEED' : `STOP -- expected both gap dates empty, got ${JSON.stringify(stillEmpty)}`;

  // ── GATE B: does ESPN still serve those dates? ───────────────────────────
  // A backfill against a date ESPN no longer serves writes nothing, so this
  // decides whether Task 3 is worth running at all.
  console.log('\n--- B. ESPN retention for the gap dates ---');
  verdicts.espn = {};
  for (const d of ['20260805', '20260806']) {
    let n = null, status = null;
    try {
      const r = await fetch(`${ESPN_API_BASE}/sports/baseball/mlb/scoreboard?dates=${d}`,
        { signal: AbortSignal.timeout(20000) });
      status = r.status;
      if (r.ok) n = (await r.json())?.events?.length ?? null;
    } catch (e) { status = `ERROR ${e.message}`; }
    console.log(`   ${d}: HTTP ${status}, events=${n}`);
    verdicts.espn[d] = { status, events: n };
  }
  const espnOk = Object.values(verdicts.espn).every((v) => (v.events || 0) > 0);
  verdicts.espnServesGapDates = espnOk ? 'PROCEED' : 'STOP -- ESPN serves no events for at least one gap date';

  // ── GATE C: CFL seed rows still unscored? ────────────────────────────────
  console.log('\n--- C. CFL rows (null-score seeds are the backfill target) ---');
  const cfl = rows(await d1(
    `SELECT id, date, home, away, home_score, away_score, espn_event_id, created_at
       FROM regular_season_games WHERE sport='CFL' ORDER BY date`));
  for (const r of cfl) console.log(`   ${r.date}  ${r.away} @ ${r.home}  ${r.away_score}-${r.home_score}  src=${r.espn_event_id}`);
  const nullScore = cfl.filter((r) => r.home_score == null && r.away_score == null);
  console.log(`   null-score rows (unscored seeds, not phantoms): ${nullScore.length}`);
  verdicts.cflSeedRows = nullScore.length > 0
    ? 'PROCEED' : 'MOOT -- no null-score CFL rows remain; close that CC-CMD with this log';

  // ── GATE D: the duplicate-cleanup blocking safety check ──────────────────
  // "If it is not 0, STOP." Deleting a brief-referenced row breaks the
  // analytics joins silently.
  console.log('\n--- D1. join safety: briefs referencing a stale name-scheme id ---');
  const joinCount = rows(await d1(
    `SELECT COUNT(*) n FROM briefs b
       JOIN postseason_games g ON b.game_id = g.id
      WHERE g.series_key IS NOT NULL
        AND instr(g.id, g.series_key) = 0
        AND g.home_score IS NULL`));
  const refs = joinCount[0]?.n ?? null;
  console.log(`   referenced stale rows: ${refs}`);
  verdicts.duplicateJoinSafety = refs === 0
    ? 'PROCEED' : `STOP -- ${refs} briefs reference a stale row`;

  console.log('\n--- D2. the delete set, enumerated before anything is deleted ---');
  const delSet = rows(await d1(
    `SELECT g.id, g.sport, g.date, g.home, g.away, g.series_key, g.created_at
       FROM postseason_games g
      WHERE g.series_key IS NOT NULL
        AND instr(g.id, g.series_key) = 0
        AND g.home_score IS NULL AND g.away_score IS NULL
        AND EXISTS (SELECT 1 FROM postseason_games k
                     WHERE k.sport = g.sport AND k.date = g.date
                       AND k.home = g.home AND k.away = g.away
                       AND instr(k.id, k.series_key) > 0)
      ORDER BY g.date`));
  for (const r of delSet) console.log(`   ${r.date}  ${r.sport}  ${r.away} @ ${r.home}  id=${r.id}`);
  console.log(`   delete-set count: ${delSet.length}`);
  // "If the count is not close to 55, the predicate is wrong -- investigate."
  verdicts.duplicateDeleteSet = (delSet.length >= 50 && delSet.length <= 60)
    ? `PROCEED -- ${delSet.length} rows` : `STOP -- ${delSet.length} rows, not close to the measured 55`;

  console.log('\n=== VERDICTS ===');
  for (const [k, v] of Object.entries(verdicts)) console.log(`  ${k}: ${JSON.stringify(v)}`);
})().catch((e) => { console.error('preflight failed:', e.stack || e.message); process.exit(1); });
