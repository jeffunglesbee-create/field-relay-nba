// CC-CMD-2026-08-08-cfl-archive-collection — Task 3, the part left unrun.
//
// The session that shipped the CFL collector scored itself 88 and said why:
// Task 3's two assertions had never been executed. `/archive/query?sport=CFL`
// reads the BRIEFS table, not `regular_season_games`, so its `count: 0` proved
// nothing; `/context/date/` truncates at ~238 KB before CFL rows are visible.
// The only read that actually answers the question is a raw D1 SELECT, which
// needs POST /d1/execute, which needs a runner (this sandbox 403s
// *.workers.dev and probe_relay_route is GET-only).
//
// Read-only. SELECTs exclusively, plus one GET against the CFL source.
//
// The two assertions, stated so they cannot pass vacuously:
//
//   A1  Rows exist. At least one CFL row is present in regular_season_games
//       for a date on which the source reports a completed game. If the cron
//       window (yesterday+today UTC) contains no completed CFL game at all,
//       this script does NOT quietly pass — it reports NOT-YET-PROVABLE and
//       exits non-zero, because "no games were played" is not evidence that
//       the writer works.
//
//   A2  No phantoms. Every CFL row in D1 corresponds to a game the source
//       marks `status === 'complete'`. This is the assertion that matters:
//       the gate exists because `homeSquad.score` is 0 rather than null on
//       unplayed fixtures, so a writer gated on "score present" would archive
//       0-0 finals for games that have not kicked off. A2 is checked against
//       EVERY CFL row, not just the window, which is why it is stronger than
//       the CC-CMD's "no rows for a scheduled-only date" phrasing.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SOURCE = 'https://cflscoreboard.cfl.ca/json/scoreboard/rounds.json';

async function d1(sql, params = []) {
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!res.ok || body.success === false) {
    throw new Error(`d1 exec failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 400)}`);
  }
  return body.results || body.result || [];
}

function rows(r) {
  if (Array.isArray(r)) return r[0]?.results || r;
  return r.results || [];
}

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

(async () => {
  console.log(`=== cfl-archive-verify  relay=${RELAY}  utc=${new Date().toISOString()} ===`);

  // ── source of truth ─────────────────────────────────────────────────────
  const srcRes = await fetch(SOURCE, { signal: AbortSignal.timeout(15000) });
  if (!srcRes.ok) throw new Error(`cflscoreboard HTTP ${srcRes.status}`);
  const roundsJson = await srcRes.json();
  if (!Array.isArray(roundsJson)) throw new Error('cflscoreboard root was not an array');

  // Flatten to (date, status, id, home, away). Same traversal the collector
  // uses in src/index.js, read from that code rather than assumed.
  const games = [];
  for (const round of roundsJson) {
    for (const t of (round?.tournaments || [])) {
      games.push({
        id: t?.id != null ? String(t.id) : null,
        date: String(t?.date || '').slice(0, 10),
        status: t?.status,
        home: t?.homeSquad?.name || '',
        away: t?.awaySquad?.name || '',
      });
    }
  }
  const complete = games.filter((g) => g.status === 'complete');
  const scheduled = games.filter((g) => g.status !== 'complete');
  console.log(`source: ${games.length} games  complete=${complete.length}  not-complete=${scheduled.length}`);

  const completeById = new Map(complete.filter((g) => g.id).map((g) => [g.id, g]));
  const completeDates = new Set(complete.map((g) => g.date));

  // The collector only ever writes yesterday+today (UTC), by design.
  const WINDOW = [day(-1), day(0)];
  const windowComplete = complete.filter((g) => WINDOW.includes(g.date));
  console.log(`cron window: ${WINDOW.join(', ')}  completed games in window: ${windowComplete.length}`);

  // ── D1: every CFL row, no date predicate ────────────────────────────────
  const all = rows(await d1(
    `SELECT id, date, sport, home, away, home_score, away_score, source_id, created_at
       FROM regular_season_games WHERE sport = 'CFL' ORDER BY date`,
  ));
  console.log(`\nD1: ${all.length} CFL rows in regular_season_games`);
  for (const r of all) {
    console.log(`  ${r.date}  ${r.away} @ ${r.home}  ${r.away_score}-${r.home_score}  src=${r.source_id}  created=${r.created_at}`);
  }

  // ── A1 ──────────────────────────────────────────────────────────────────
  let a1;
  const inWindowRows = all.filter((r) => WINDOW.includes(r.date));
  if (windowComplete.length === 0) {
    a1 = 'NOT-YET-PROVABLE';
    console.log(`\nA1 ${a1}: the source reports zero completed CFL games on ${WINDOW.join(' or ')}.`);
    console.log('   The collector is bounded to that window, so there is nothing it could');
    console.log('   have written. This is not a pass. Re-run on a day following a CFL game.');
  } else if (inWindowRows.length > 0) {
    a1 = 'PASS';
    console.log(`\nA1 PASS: ${inWindowRows.length} CFL row(s) present for the window, against ${windowComplete.length} completed source game(s).`);
  } else {
    a1 = 'FAIL';
    console.log(`\nA1 FAIL: source has ${windowComplete.length} completed CFL game(s) in the window and D1 has zero CFL rows for those dates.`);
  }

  // ── A2 ──────────────────────────────────────────────────────────────────
  // Match on source_id where the row carries one (the collector writes t.id),
  // and fall back to date-membership only for rows that predate it.
  const phantoms = all.filter((r) => {
    if (r.source_id && completeById.has(String(r.source_id))) return false;
    if (!r.source_id && completeDates.has(r.date)) return false;
    return true;
  });
  const a2 = phantoms.length === 0 ? 'PASS' : 'FAIL';
  if (a2 === 'PASS') {
    console.log(`A2 PASS: all ${all.length} CFL row(s) correspond to a source game with status='complete'. Zero phantom rows.`);
  } else {
    console.log(`A2 FAIL: ${phantoms.length} CFL row(s) have no completed source game:`);
    for (const p of phantoms) console.log(`   ${p.date}  ${p.away} @ ${p.home}  ${p.away_score}-${p.home_score}  src=${p.source_id}`);
  }

  // Named separately because it is the specific trap the gate exists for.
  const zeroZero = all.filter((r) => Number(r.home_score) === 0 && Number(r.away_score) === 0);
  console.log(`0-0 rows: ${zeroZero.length}${zeroZero.length ? ' <- inspect, a real 0-0 CFL final is impossible' : ''}`);

  console.log(`\n=== RESULT A1=${a1} A2=${a2} ===`);
  process.exit(a1 === 'PASS' && a2 === 'PASS' ? 0 : 1);
})().catch((e) => {
  console.error('probe failed:', e.stack || e.message);
  process.exit(1);
});
