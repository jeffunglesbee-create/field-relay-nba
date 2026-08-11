// CC-CMD-2026-08-10-archive-gap-real-write-path, Tasks 2 and 3.
//
// Fills the 2026-08-05 / 2026-08-06 MLB+WNBA hole in regular_season_games by
// POSTing completed ESPN events to /archive/game -- the route that actually
// writes that table. The predecessor CC-CMD used GET /archive/backfill, which
// reads regular_season_games to build a journalism brief and returned ok:true
// while writing nothing.
//
// EVERY constant below was read from HEAD, not from memory or from the spec:
//
//   ESPN_API_BASE  src/index.js:658   'https://site.web.api.espn.com/apis/site/v2'
//                                     (site.api.espn.com 403s Worker egress)
//   LEAGUES        src/index.js:7341  baseball/mlb -> label 'MLB'
//                                     basketball/wnba -> label 'WNBA'
//   collector      src/index.js:7605  [ARCHIVE-YDAY], the canonical
//                                     ESPN-scoreboard -> /archive/game path
//   route          src/index.js:11055 POST /archive/game
//   id             src/index.js:11141 `${sport}_${date}_${shortify(home)}_${shortify(away)}`
//
// AUTH: none. The collector POSTs with Content-Type only, and /archive/game is
// handled at line 11055, well before the method allow-list at line 11798 that
// would otherwise 405 a POST -- so that list's omission of /archive/game is
// not a block. Independently confirmed empirically: this session's CFL POSTs
// from a GitHub runner returned 200 and created rows.
//
// FIELD MAPPING is copied from [ARCHIVE-YDAY] verbatim, per Rule 62. The one
// that looks wrong and is not: `sport` is sent as the LEAGUES **label**, not
// ESPN's top-level sport string. Sending 'baseball' would build a different id
// prefix and split the competition across two id namespaces -- the exact bug
// CC-CMD-2026-08-06-apply-soccer-league-label-fix repaired for soccer.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const ESPN_API_BASE = 'https://site.web.api.espn.com/apis/site/v2';
const DATES = ['2026-08-05', '2026-08-06'];
const LEAGUES = [
  { sport: 'baseball', league: 'mlb', label: 'MLB' },
  { sport: 'basketball', league: 'wnba', label: 'WNBA' },
];

// Copied from src/index.js:6926 rather than approximated. Only the two labels
// this script touches are reachable, but the table is reproduced whole so a
// future edit here is a visible divergence from the original.
const _WENTTOOT_REGULATION_PERIODS = { nba: 4, wnba: 4, nhl: 3, mlb: 9 };
const _WENTTOOT_SOCCER_SPORTS = new Set(['epl', 'mls', 'ucl', 'wc26']);
const _WENTTOOT_LEAGUE_TO_SPORT_KEY = {
  NBA: 'nba', NHL: 'nhl', MLB: 'mlb', WNBA: 'wnba',
  EPL: 'epl', MLS: 'mls', 'FIFA World Cup': 'wc26',
};
function computeWentToOT(leagueLabel, period) {
  if (period == null) return null;
  const sportKey = _WENTTOOT_LEAGUE_TO_SPORT_KEY[leagueLabel];
  if (!sportKey) return null;
  if (_WENTTOOT_SOCCER_SPORTS.has(sportKey)) return period >= 3;
  if (_WENTTOOT_REGULATION_PERIODS[sportKey]) return period > _WENTTOOT_REGULATION_PERIODS[sportKey];
  return null;
}

async function d1(sql) {
  const res = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
    body: JSON.stringify({ sql, params: [] }),
  });
  const b = await res.json();
  if (!res.ok || b.success === false) throw new Error(`d1: HTTP ${res.status} ${JSON.stringify(b).slice(0, 300)}`);
  return b.results || [];
}

(async () => {
  console.log(`=== archive-gap ESPN backfill  relay=${RELAY}  utc=${new Date().toISOString()} ===\n`);

  // ── GATE 0: is the gap still real? ───────────────────────────────────────
  // The preflight measured this earlier today; that is now an inherited claim
  // (Rule 72) and a write must be gated on the state it is about to act on.
  console.log('--- GATE 0: current rows on the gap dates ---');
  const pre = await d1(
    `SELECT date, sport, COUNT(*) n FROM regular_season_games
      WHERE date IN ('2026-08-05','2026-08-06') AND sport IN ('MLB','WNBA')
      GROUP BY date, sport ORDER BY date, sport`);
  if (!pre.length) console.log('   (no rows -- the gap is intact)');
  for (const r of pre) console.log(`   ${r.date}  ${r.sport}  n=${r.n}`);

  // ── TASK 2: does ESPN still serve these dates? ───────────────────────────
  console.log('\n--- TASK 2: ESPN events per (date, league) ---');
  const source = {};   // `${date}|${label}` -> completed events
  for (const date of DATES) {
    for (const { sport, league, label } of LEAGUES) {
      const espnDate = date.replace(/-/g, '');
      let total = null, completed = [];
      try {
        const r = await fetch(`${ESPN_API_BASE}/sports/${sport}/${league}/scoreboard?dates=${espnDate}`,
          { signal: AbortSignal.timeout(25000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        const events = j?.events || [];
        total = events.length;
        for (const ev of events) {
          const comp = ev.competitions?.[0];
          // THE GATE, identical to [ARCHIVE-YDAY]: completed finals only.
          if (comp?.status?.type?.completed !== true) continue;
          const teams = comp?.competitors || [];
          const home = teams.find((t) => t.homeAway === 'home') || teams[0];
          const away = teams.find((t) => t.homeAway === 'away') || teams[1];
          completed.push({
            label, date,
            home: home?.team?.shortDisplayName || home?.team?.displayName || '',
            away: away?.team?.shortDisplayName || away?.team?.displayName || '',
            homeScore: home?.score ?? null,
            awayScore: away?.score ?? null,
            periodNum: comp?.status?.period ?? null,
            startTime: comp?.date || null,
            venue: comp?.venue?.fullName || '',
            eventId: String(ev.id || ''),
          });
        }
      } catch (e) {
        console.error(`   ${date}  ${label}: FETCH FAILED ${e.message}`);
        console.error('\nSTOP: the source fetch failed. No fallback path -- report and stop.');
        process.exit(1);
      }
      source[`${date}|${label}`] = completed;
      console.log(`   ${date}  ${label}: events=${total}, completed=${completed.length}`);
    }
  }

  // The CC-CMD's Task 2 says to STOP if any count is 0. Applied per DATE, not
  // per (date, league), and this is a deliberate reading rather than an
  // oversight: a league with no games scheduled on a date is a FACT about the
  // schedule, not a source failure. Demanding rows for it would mean inventing
  // them (Rule 1). What would genuinely falsify the plan is a date the source
  // no longer serves at all -- so that is what gates.
  for (const date of DATES) {
    const n = LEAGUES.reduce((a, { label }) => a + source[`${date}|${label}`].length, 0);
    if (n === 0) {
      console.error(`\nSTOP: ${date} has zero completed events across MLB and WNBA. ` +
        'Either the source no longer retains it or no games were played; either way there is nothing to write.');
      process.exit(1);
    }
  }

  // ── TASK 3: write ────────────────────────────────────────────────────────
  // Dedup by espn_event_id first, exactly as [ARCHIVE-YDAY] does. Not
  // defensive padding: this session already turned 5 CFL rows into 7 by
  // POSTing without checking whether the target row was reachable by the id
  // the route builds. Here the check is on the source id, which is what the
  // collector keys its own skip on.
  console.log('\n--- TASK 3: POST /archive/game ---');
  let written = 0, skipped = 0;
  for (const date of DATES) {
    for (const { label } of LEAGUES) {
      for (const gm of source[`${date}|${label}`]) {
        if (!gm.eventId) { console.log(`   SKIP (no eventId): ${gm.away} @ ${gm.home}`); skipped++; continue; }
        const existing = await d1(
          `SELECT home_score FROM regular_season_games WHERE espn_event_id = '${gm.eventId}'
           UNION ALL
           SELECT home_score FROM postseason_games WHERE espn_event_id = '${gm.eventId}'
           LIMIT 1`);
        if (existing.length && existing[0].home_score !== null) {
          console.log(`   SKIP (already archived+scored): ${date} ${label} ${gm.away} @ ${gm.home}`);
          skipped++; continue;
        }
        const body = {
          sport: label,          // LEAGUES label, NOT ESPN's top-level sport
          league: label,
          date,
          home: gm.home,
          away: gm.away,
          home_score: gm.homeScore,
          away_score: gm.awayScore,
          venue: gm.venue,
          start_time: gm.startTime || null,
          source_id: gm.eventId,
          went_to_ot: computeWentToOT(label, gm.periodNum),
        };
        const r = await fetch(`${RELAY}/archive/game`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
        });
        const txt = (await r.text()).slice(0, 200);
        console.log(`   ${date} ${label}  ${gm.away} @ ${gm.home}  ${gm.awayScore}-${gm.homeScore}  HTTP ${r.status} ${txt}`);
        if (r.status === 200) written++;
      }
    }
  }
  console.log(`\n   written=${written}  skipped=${skipped}`);

  await new Promise((s) => setTimeout(s, 5000));

  // ── DONE CONDITION ───────────────────────────────────────────────────────
  console.log('\n--- DONE CONDITION ---');
  const post = await d1(
    `SELECT date, sport, COUNT(*) n,
            SUM(CASE WHEN home_score IS NOT NULL THEN 1 ELSE 0 END) scored
       FROM regular_season_games
      WHERE date IN ('2026-08-05','2026-08-06') AND sport IN ('MLB','WNBA')
      GROUP BY date, sport ORDER BY date, sport`);
  for (const r of post) console.log(`   ${r.date}  ${r.sport}  n=${r.n}  scored=${r.scored}`);

  // Phantom check uses === 0, deliberately. Number(null) is 0, and coercing
  // here previously made NULL-score rows read as phantom 0-0 rows in this repo.
  const raw = await d1(
    `SELECT id, date, sport, home_score, away_score FROM regular_season_games
      WHERE date IN ('2026-08-05','2026-08-06') AND sport IN ('MLB','WNBA')`);
  const phantoms = raw.filter((r) => r.home_score === 0 && r.away_score === 0);
  console.log(`   0-0 phantom rows: ${phantoms.length}   (must be 0)`);

  // Expected groups are derived from what the SOURCE actually had, not from a
  // hardcoded four. A league that played no games that day must not be
  // required to produce rows.
  const expected = [];
  for (const date of DATES) {
    for (const { label } of LEAGUES) {
      const n = source[`${date}|${label}`].length;
      if (n > 0) expected.push({ date, sport: label, n });
    }
  }
  let allGood = true;
  for (const e of expected) {
    const got = post.find((r) => r.date === e.date && r.sport === e.sport);
    const ok = got && got.n > 0 && got.scored === got.n;
    if (!ok) allGood = false;
    console.log(`   expect ${e.date} ${e.sport}: source had ${e.n} completed -> ` +
      `archived n=${got?.n ?? 0} scored=${got?.scored ?? 0}  ${ok ? 'OK' : 'MISSING/UNSCORED'}`);
  }

  const ok = allGood && phantoms.length === 0 && expected.length > 0;
  console.log(`\n=== RESULT: ${ok ? 'PASS' : 'FAIL'} ===`);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('backfill failed:', e.stack || e.message); process.exit(1); });
