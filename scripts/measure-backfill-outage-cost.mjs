// What did the fifteen dead backfill days cost?
//
// `odds-backfill.yml` failed every scheduled run from 2026-09-01 to 2026-09-15
// on an empty ODDS_API_KEY (CC-CMD-2026-09-15-odds-backfill-missing-api-key).
// Run 35012183015 then drained the whole 22-date backlog in one pass.
//
// THE PREMISE THAT MATTERS, AND IT SHIFTED:
// Because the catch-up has ALREADY RUN, this cannot measure the gross cost of
// the outage. Everything recoverable was recovered before this script existed.
// What it measures is the RESIDUAL — the rows the catch-up could not fill —
// and that is a strictly smaller number. Reporting it as "the cost of the
// outage" would be the same substitution CC-CMD-2026-09-15 was filed to record.
// The output says so on its own line, not in this comment (Rule 91).
//
// Rule 99: a NULL opening_odds is not one state. A game with no odds_history
// row had nothing to recover FROM; a game with one did, and still has no
// opening line. Those warrant different action and are counted separately.
//
// READ-ONLY. Every statement here is a SELECT and the guard below enforces it.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const SINCE = process.argv.find(a => a.startsWith('--since='))?.split('=')[1] || '2026-09-01';
const TABLES = ['regular_season_games', 'postseason_games'];

async function d1(sql, params = []) {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error(`refusing non-SELECT: ${sql.slice(0, 80)}`);
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!res.ok || body.success === false) {
    throw new Error(`d1 exec failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 400)}`);
  }
  const r = body.results || body.result || [];
  return Array.isArray(r) ? (r[0]?.results || r) : (r.results || []);
}

// NOT pragma_table_info. /d1/execute matches the first FROM-word against an
// ALLOWED_TABLES list (src/index.js ~15948) and answers 403 "table not allowed"
// for anything else — which run 35012890540 hit, and HANDOFF.md:546 records the
// same guard being "conflated with an answer" once before. A row off the table
// itself is an allowed route and gives the real column set.
// An empty table teaches nothing, and says so rather than returning [].
const cols = async t => {
  const [row] = await d1(`SELECT * FROM ${t} LIMIT 1`);
  if (!row) throw new Error(`${t} returned no rows — cannot learn its columns this way`);
  return Object.keys(row);
};

(async () => {
  console.log(`=== backfill outage cost  relay=${RELAY}  utc=${new Date().toISOString()} ===`);
  console.log(`window: games dated >= ${SINCE}\n`);

  // Probe the schema before writing a query against it. A column named in this
  // script but absent from the table would otherwise produce a confident zero.
  const schema = {};
  for (const t of [...TABLES, 'odds_history']) {
    schema[t] = await cols(t);
    console.log(`  ${t}: ${schema[t].join(', ')}`);
  }
  console.log();

  // `date`, not `game_date`. Run 35013069682 refused to report a count because
  // this script had guessed the latter; both tables call it `date`. The guard
  // turning that into a red run rather than a zero is the reason it is here.
  const need = { regular_season_games: ['opening_odds', 'date'],
                 postseason_games:     ['opening_odds', 'date'] };
  let bad = 0;
  for (const [t, ns] of Object.entries(need)) {
    for (const n of ns) {
      if (!schema[t].includes(n)) { console.log(`FAIL  ${t} has no column ${n}`); bad++; }
    }
  }
  if (bad) { console.log(`\n${bad} expected column(s) missing — refusing to report a count.`); process.exit(1); }

  // odds_history's join key, probed rather than assumed.
  const hKey = ['game_id', 'gameId', 'id'].find(k => schema.odds_history.includes(k));
  if (!hKey) { console.log(`FAIL  odds_history has no recognisable game key`); process.exit(1); }
  console.log(`odds_history join key: ${hKey}\n`);

  const totals = { games: 0, nullOpening: 0, recoverable: 0, nothingToRecover: 0 };

  for (const t of TABLES) {
    const gKey = schema[t].includes('game_id') ? 'game_id' : 'id';
    const [row] = await d1(
      `SELECT COUNT(*) AS games,
              SUM(CASE WHEN opening_odds IS NULL THEN 1 ELSE 0 END) AS null_opening,
              SUM(CASE WHEN opening_odds IS NULL
                        AND EXISTS (SELECT 1 FROM odds_history h WHERE h.${hKey} = g.${gKey})
                       THEN 1 ELSE 0 END) AS recoverable,
              SUM(CASE WHEN opening_odds IS NULL
                        AND NOT EXISTS (SELECT 1 FROM odds_history h WHERE h.${hKey} = g.${gKey})
                       THEN 1 ELSE 0 END) AS nothing_to_recover
         FROM ${t} g
        WHERE g.date >= ?`, [SINCE]);

    console.log(`${t}`);
    console.log(`    games dated >= ${SINCE}          : ${row.games}`);
    console.log(`    opening_odds IS NULL             : ${row.null_opening}`);
    console.log(`      of those, HAS an odds_history row (recoverable, still empty) : ${row.recoverable}`);
    console.log(`      of those, has NO odds_history row (nothing to recover from)  : ${row.nothing_to_recover}\n`);

    totals.games += row.games;
    totals.nullOpening += row.null_opening;
    totals.recoverable += row.recoverable;
    totals.nothingToRecover += row.nothing_to_recover;
  }

  console.log(`TOTAL across ${TABLES.length} tables`);
  console.log(`    games                 : ${totals.games}`);
  console.log(`    opening_odds NULL     : ${totals.nullOpening}`);
  console.log(`    recoverable residual  : ${totals.recoverable}`);
  console.log(`    nothing to recover    : ${totals.nothingToRecover}`);

  // A 532 nobody can attribute is a number, not an answer. The outage is only
  // ONE candidate cause of "no odds_history row": this repo already measured
  // (2026-09-15, /v4/sports) that the vendor offers none of the five cup
  // competitions behind 243 rows labelled sport='MLS', and those rows would
  // read identically here while having nothing to do with a dead cron.
  // Breaking the bucket down by league is what separates the two.
  console.log(`\nthe "nothing to recover" bucket, by league (top 15)`);
  for (const t of TABLES) {
    const gKey = schema[t].includes('game_id') ? 'game_id' : 'id';
    const byLeague = await d1(
      `SELECT COALESCE(g.league, g.sport, '(null)') AS label, COUNT(*) AS n
         FROM ${t} g
        WHERE g.date >= ?
          AND g.opening_odds IS NULL
          AND NOT EXISTS (SELECT 1 FROM odds_history h WHERE h.game_id = g.${gKey})
        GROUP BY label ORDER BY n DESC LIMIT 15`, [SINCE]);
    if (!byLeague.length) { console.log(`  ${t}: none`); continue; }
    console.log(`  ${t}`);
    for (const r of byLeague) console.log(`      ${String(r.n).padStart(4)}  ${r.label}`);
  }
  console.log(`\n  ATTRIBUTION IS NOT ESTABLISHED BY THIS BREAKDOWN. It says which`);
  console.log(`  leagues the gap falls in, not why. A league the vendor never`);
  console.log(`  offered and a league the dead cron failed to fetch look the same`);
  console.log(`  from here; separating them needs the vendor's own sport list.`);

  console.log(`\nCOVERAGE: this is the RESIDUAL after run 35012183015 drained the`);
  console.log(`22-date backlog, not the gross cost of the outage. Everything the`);
  console.log(`catch-up could fill was filled before this ran, so the true cost`);
  console.log(`during 2026-09-01..15 was HIGHER than the numbers above and is not`);
  console.log(`recoverable from the archive's current state.`);
  console.log(`Counted ${totals.games} games across ${TABLES.join(' + ')}; other tables not examined.`);
})().catch(e => { console.error(`ERROR ${e.message}`); process.exit(1); });
