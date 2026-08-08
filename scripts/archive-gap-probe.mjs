// CC-CMD-2026-08-08-investigate-mlb-wnba-archive-gap.
//
// INVESTIGATION ONLY. This script reads. It never writes, and the CC-CMD
// explicitly forbids applying a fix, so nothing here mutates a row.
//
// The question it exists to answer: /context/date/ returns ~15 MLB rows a day
// either side of 2026-08-05/06 and zero on those two dates. Three candidate
// causes were genuinely undistinguished when the CC-CMD was written:
//   (1) the archive cron didn't run,
//   (2) the ESPN fetch failed for the baseball/basketball slugs,
//   (3) rows were written under a `sport` label /context/date/ filters out.
//
// Candidate (3) is the one that needs a RAW table read to rule in or out,
// because /context/date/ cannot show you a row it is filtering away. That is
// this script's core move: enumerate DISTINCT sport per date straight from
// regular_season_games and postseason_games, with no sport predicate at all.
//
// created_at is selected alongside date for a reason. The MLS rows visible on
// the gap dates carry created_at of 2026-06-30 / 2026-07-16 -- weeks earlier,
// i.e. schedule seeding, not same-day archival. If the gap dates hold ONLY
// pre-seeded rows while control dates hold rows created on the day itself,
// that separates "nothing ran that day" from "something ran and mislabeled".

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';

// Gap dates plus two controls either side, per the CC-CMD's own measurements.
const GAP      = ['2026-08-05', '2026-08-06'];
const CONTROL  = ['2026-08-04', '2026-08-07'];
const ALL      = [...CONTROL.slice(0, 1), ...GAP, ...CONTROL.slice(1)].sort();
const TABLES   = ['regular_season_games', 'postseason_games'];

async function d1(sql, params) {
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
  // /d1/execute returns the raw D1 shape; normalise the two observed forms.
  if (Array.isArray(r)) return r[0]?.results || r;
  return r.results || [];
}

(async () => {
  console.log(`=== archive-gap-probe  relay=${RELAY}  utc=${new Date().toISOString()} ===`);
  console.log(`gap dates: ${GAP.join(', ')}   control dates: ${CONTROL.join(', ')}`);

  // ── A. RAW distinct sport per date, NO sport predicate ──────────────────
  // This is the discriminator for candidate (3). If MLB games were archived
  // under some other label on the gap dates, they appear here and nowhere in
  // /context/date/.
  for (const table of TABLES) {
    console.log(`\n--- A. ${table}: every distinct sport per date (raw, unfiltered) ---`);
    const r = rows(await d1(
      `SELECT date, sport, COUNT(*) AS n, MIN(created_at) AS first_created, MAX(created_at) AS last_created
         FROM ${table}
        WHERE date IN (?, ?, ?, ?)
        GROUP BY date, sport
        ORDER BY date, sport`,
      ALL,
    ));
    if (!r.length) { console.log('   (no rows at all on these dates)'); continue; }
    for (const x of r) {
      console.log(`   ${x.date}  ${String(x.sport).padEnd(24)} n=${String(x.n).padStart(3)}  created ${x.first_created} .. ${x.last_created}`);
    }
  }

  // ── B. Same-day-created rows only ───────────────────────────────────────
  // Separates archival writes from schedule seeding. A date whose only rows
  // were created weeks earlier had nothing archived ON that date, whatever
  // its total row count looks like.
  for (const table of TABLES) {
    console.log(`\n--- B. ${table}: rows CREATED on the date they describe ---`);
    const r = rows(await d1(
      `SELECT date, sport, COUNT(*) AS n
         FROM ${table}
        WHERE date IN (?, ?, ?, ?)
          AND substr(created_at, 1, 10) >= date
        GROUP BY date, sport
        ORDER BY date, sport`,
      ALL,
    ));
    if (!r.length) { console.log('   (none — every row on these dates predates the date itself)'); continue; }
    for (const x of r) console.log(`   ${x.date}  ${String(x.sport).padEnd(24)} n=${x.n}`);
  }

  // ── C. MLB/WNBA across a wider window ───────────────────────────────────
  // Establishes whether the gap is exactly two days or the visible edge of
  // something longer. Two isolated days points at a run/fetch failure; a
  // ragged pattern points elsewhere.
  for (const table of TABLES) {
    console.log(`\n--- C. ${table}: MLB + WNBA per day, 2026-07-30 .. 2026-08-09 ---`);
    const r = rows(await d1(
      `SELECT date, sport, COUNT(*) AS n
         FROM ${table}
        WHERE date BETWEEN '2026-07-30' AND '2026-08-09'
          AND sport IN ('MLB', 'WNBA')
        GROUP BY date, sport
        ORDER BY date, sport`,
      [],
    ));
    if (!r.length) { console.log('   (no MLB/WNBA rows in the window)'); continue; }
    for (const x of r) console.log(`   ${x.date}  ${String(x.sport).padEnd(6)} n=${x.n}`);
  }

  // ── D. Any row whose sport is not a label /context/date/ would surface ──
  // The soccer mislabel incident this same week wrote real MLS fixtures under
  // 'FIFA World Cup'. If the same shape happened to MLB/WNBA, the row's
  // `league` column still carries the truth (both are written by the same
  // INSERT), so a league/sport disagreement is self-evidencing.
  for (const table of TABLES) {
    console.log(`\n--- D. ${table}: sport/league disagreement on the gap dates ---`);
    const r = rows(await d1(
      `SELECT id, date, sport, league, home, away, home_score, away_score, created_at
         FROM ${table}
        WHERE date IN (?, ?)
          AND league IS NOT NULL AND league != ''
          AND LOWER(sport) != LOWER(league)
        ORDER BY date, sport
        LIMIT 100`,
      GAP,
    ));
    if (!r.length) { console.log('   (none — no row on the gap dates has sport != league)'); continue; }
    for (const x of r) {
      console.log(`   ${x.date}  sport=${x.sport}  league=${x.league}  ${x.home} v ${x.away}  ${x.home_score}-${x.away_score}  created ${x.created_at}`);
    }
  }

  console.log('\n=== probe complete (read-only; no rows were modified) ===');
})().catch((e) => { console.error('PROBE FAILED:', e.message); process.exit(1); });
