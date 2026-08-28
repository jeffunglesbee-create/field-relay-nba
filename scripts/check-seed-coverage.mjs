// A competition the relay can fetch must be seeded, excluded, or undecided —
// never simply absent. CC-CMD-2026-08-21-archive-seed-coverage, asks 1 and 2.
//
// WHY THIS EXISTS, and what it would have caught
//
// `/context/date` reads ONLY ARCHIVE_DB. The journalism cron's `LEAGUES` table is
// what writes to it. `V2_LEAGUES` is a separate, larger table saying what the
// relay can fetch on demand. A competition in the second and not the first is
// reachable and never persisted, and nothing says whether that is deliberate.
//
// Found by a human twice. Six UEFA club competitions sat in V2_LEAGUES with slugs
// and BSD ids — `/v2/games?sport=ucl` answered — while `/context/date/2026-08-19`
// listed 49 games with no Champions League among them.
//
// THE OFFLINE HALF (this file, blocking) reads both tables out of src/index.js
// and fails on any V2_LEAGUES key that is in none of the three declared states.
// It needs no network and costs no quota.
//
// THE LIVE HALF is `--live`, run from CI by seed-coverage.yml against a date that
// has ALREADY PASSED ITS SEEDING TICK. That constraint is the ask's own
// correction, and it is load-bearing: the original artifact said "on 2026-08-22
// the check flags EPL", which was a false positive that would have fired every
// day forever. EPL was seeded. What the author read as a gap on a FUTURE date is
// game-day seeding — MLB, indisputably seeded and playing, was present on 3/3
// past days and 0/2 future days, exactly like EPL. Only MLS pre-seeds ahead. A
// future-dated query returning only MLS is the system working.
//
// So: evaluate a PAST date, or measure nothing.
//
// PARSING SOURCE, AND WHY THAT IS THE LESSER EVIL. Both tables are literals
// inside src/index.js, which imports @cloudflare/puppeteer and cannot be imported
// here. Copying them into this file would create the third copy of a list whose
// second copy is already stale — see the LEAGUES_LOCAL assertion below. A parser
// that stops matching fails loudly on the row-count floor; a stale copy is
// silent, which is the defect class this whole ask is about.

import { readFileSync } from 'node:fs'
import { EXCLUDED, UNDECIDED, classify } from '../src/seed-manifest.js'

const SRC = 'src/index.js'
const src = readFileSync(SRC, 'latin1').replace(/\x00/g, '')

let pass = 0, fail = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        → ${detail}`}`)
  ok ? pass++ : fail++
}

// ── the two tables, read from source ────────────────────────────────────────
export function cronLeagues (src) {
  const i = src.indexOf('  const LEAGUES = [')
  if (i < 0) return []
  const blk = src.slice(i, src.indexOf('\n  ];', i))
  return [...blk.matchAll(/\{sport:'([^']+)',\s*league:'([^']+)',\s*label:'([^']+)'/g)]
    .map(m => ({ sport: m[1], league: m[2], label: m[3] }))
}
export function integrityLeagues (src) {
  const i = src.indexOf('const LEAGUES_LOCAL = [')
  if (i < 0) return []
  const blk = src.slice(i, src.indexOf('\n            ];', i))
  return [...blk.matchAll(/league:\s*'([^']+)'/g)].map(m => m[1])
}
export function v2Leagues (src) {
  const i = src.indexOf('const V2_LEAGUES')
  if (i < 0) return []
  const blk = src.slice(i, src.indexOf('\n};', i))
  return [...blk.matchAll(/'([a-z0-9_.]+)':\s*\{[^}]*espnLeague:\s*'([^']+)'/g)]
    .map(m => ({ key: m[1], espnLeague: m[2] }))
}

// ── self-test: the detector must be able to fail ────────────────────────────
if (process.argv.includes('--self-test')) {
  const FIX = `
  const LEAGUES = [
    {sport:'baseball', league:'mlb', label:'MLB'},
    {sport:'golf',     league:'pga', label:'PGA Tour', individual:true},
  ];
const V2_LEAGUES = {
    'mlb':   { sport: 'baseball', espnLeague: 'mlb' },
    'pga':   { sport: 'golf',     espnLeague: 'pga' },
    'ghost': { sport: 'kabaddi',  espnLeague: 'kabaddi' },
};
            const LEAGUES_LOCAL = [
                { sport: 'baseball', league: 'mlb', label: 'MLB' },
            ];`
  const c = cronLeagues(FIX), v = v2Leagues(FIX), l = integrityLeagues(FIX)
  check('the cron parser reads a row that carries a fourth field (individual:true)',
    c.length === 2 && c[1].label === 'PGA Tour',
    'the golf row has a trailing flag; a regex anchored on the closing brace misses it')
  check('the V2 parser reads every entry', v.length === 3, `${v.length}`)
  check('the LEAGUES_LOCAL parser reads its rows', l.length === 1, `${l.length}`)
  const seeded = new Set(c.map(r => r.league))
  check('AN UNDECLARED COMPETITION IS DETECTED — this check can fail',
    classify('ghost', 'kabaddi', seeded) === 'undeclared',
    'a fetchable competition in no list must not classify as anything else')
  check('...and a seeded one is not flagged', classify('mlb', 'mlb', seeded) === 'seeded')
  // Fixture maps, not the live manifest. Asserting against real keys made this
  // test fail when `cfb` was correctly seeded -- it was measuring a coverage
  // decision, not the classifier.
  const EX = { fixture_excluded: { reason: 'x'.repeat(30) } }
  const UN = { fixture_undecided: { question: 'y'.repeat(30) } }
  check('...and an excluded one is not flagged',
    classify('fixture_excluded', 'nope', seeded, EX, UN) === 'excluded')
  check('...and an undecided one is not flagged',
    classify('fixture_undecided', 'nope', seeded, EX, UN) === 'undecided')
  check('seeded wins over a key that also appears in a manifest map',
    classify('fixture_excluded', 'mlb', seeded, EX, UN) === 'seeded',
    'a competition that got seeded after being excluded must read as seeded')
  check('a seeded-but-individual row still classifies as seeded, not excluded',
    classify('pga', 'pga', seeded) === 'seeded',
    'golf is archived through a golf-aware path; individual:true is not an exclusion')
  check('the LEAGUES_LOCAL drift is visible on the fixture',
    c.filter(r => !l.includes(r.league)).length === 1)
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass}/${pass + fail} self-test(s)\n`)
  process.exit(fail === 0 ? 0 : 1)
}

const cron = cronLeagues(src)
const v2 = v2Leagues(src)
const local = integrityLeagues(src)
const seededSlugs = new Set(cron.map(r => r.league))

// ── non-vacuity FIRST. A parser that matched nothing would agree with anything ─
// The floors are deliberately below the real counts, so ordinary growth does not
// trip them and a regex that stopped matching does.
check('the cron LEAGUES table parsed to real rows', cron.length >= 15, `${cron.length} row(s)`)
check('V2_LEAGUES parsed to real rows', v2.length >= 20, `${v2.length} entr(ies)`)
check('the two tables are not the same table', cron.length !== v2.length || cron.length === 0,
  `both parsed to ${cron.length} — one regex is probably matching the other's block`)

// ── ask 1: every fetchable competition is declared ───────────────────────────
const byState = { seeded: [], excluded: [], undecided: [], undeclared: [] }
for (const { key, espnLeague } of v2) byState[classify(key, espnLeague, seededSlugs)].push(`${key} (${espnLeague})`)

console.log(`\n  ${v2.length} fetchable competition(s): ${byState.seeded.length} seeded, ` +
            `${byState.excluded.length} excluded, ${byState.undecided.length} undecided\n`)
for (const k of byState.undecided) console.log(`    UNDECIDED  ${k}`)
if (byState.undecided.length) console.log('')

check('no competition is fetchable and declared nowhere',
  byState.undeclared.length === 0,
  `${byState.undeclared.length} in the silent state this ask exists to remove: ` +
  `${byState.undeclared.join(', ')}\n        → add it to the cron LEAGUES table, or to ` +
  `EXCLUDED/UNDECIDED in src/seed-manifest.js with a reason`)

// A manifest entry for a competition that is no longer fetchable is dead weight
// that reads as a live decision.
const v2Keys = new Set(v2.map(r => r.key))
const orphans = [...Object.keys(EXCLUDED), ...Object.keys(UNDECIDED)].filter(k => !v2Keys.has(k))
check('no manifest entry names a competition the relay cannot fetch', orphans.length === 0,
  `${orphans.join(', ')} — removed from V2_LEAGUES but still declared`)

// An exclusion without a reason is a silence with extra steps.
const reasonless = Object.entries(EXCLUDED).filter(([, v]) => !v.reason || v.reason.length < 20).map(([k]) => k)
check('every exclusion states a reason', reasonless.length === 0, reasonless.join(', '))
const questionless = Object.entries(UNDECIDED).filter(([, v]) => !v.question || v.question.length < 20).map(([k]) => k)
check('every undecided entry states the question that decides it', questionless.length === 0, questionless.join(', '))

// ── the second copy, which is already stale ─────────────────────────────────
// /integrity/games carries LEAGUES_LOCAL, commented "Mirror handleJournalismCycle's
// LEAGUES list (kept inline so a future LEAGUES extraction in the cron doesn't
// ripple here)". It is not a mirror. Reported, not enforced — fixing it is
// CC-CMD-2026-08-27-integrity-leagues-drift, filed rather than carried forward.
const missingFromLocal = cron.filter(r => !local.includes(r.league))
if (local.length) {
  console.log(`  /integrity/games covers ${local.length} of ${cron.length} seeded competition(s).`)
  if (missingFromLocal.length) {
    console.log(`  Blind to ${missingFromLocal.length}: ${missingFromLocal.map(r => r.label).join(', ')}`)
    console.log('  Tracked by CC-CMD-2026-08-27-integrity-leagues-drift. Not failed here.\n')
  } else console.log('')
}
check('LEAGUES_LOCAL contains nothing the cron does not seed',
  local.every(l => seededSlugs.has(l)),
  `${local.filter(l => !seededSlugs.has(l)).join(', ')} — the integrity endpoint would ` +
  'report a permanent gap for a competition nothing ever seeds')

// ── ask 2, the live half ────────────────────────────────────────────────────
//
// For a date that has ALREADY PASSED ITS SEEDING TICK: every seeded competition
// with fixtures on ESPN must have rows in /context/date. A seeded competition
// with fixtures and zero rows is the gap.
//
// THE DATE MUST BE IN THE PAST, and that is this ask's own correction rather
// than a convenience. Its original artifact — "on 2026-08-22 the check flags
// EPL" — was a false positive that would have fired daily forever. Most
// competitions seed on the GAME DAY, not ahead; only MLS pre-seeds. MLB,
// indisputably seeded and playing, was present on 3/3 past days and 0/2 future
// days, exactly like the EPL the author read as missing.
//
// Default is 3 days back: past the tick, inside any sensible retention, and far
// enough that a same-day partial seed cannot read as a gap.
if (process.argv.includes('--live')) {
  const RELAY = process.env.RELAY_URL || 'https://field-relay-nba.jeffunglesbee.workers.dev'
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports'
  const argDate = process.argv[process.argv.indexOf('--live') + 1]
  const date = /^\d{4}-\d{2}-\d{2}$/.test(argDate || '')
    ? argDate
    : new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)

  if (new Date(date) >= new Date(new Date().toISOString().slice(0, 10))) {
    console.log(`\n  FAIL  the live half needs a PAST date; got ${date}`)
    console.log('        a future or same-day date measures game-day seeding, not coverage')
    process.exit(1)
  }
  console.log(`\n  Live half, ${date} (${Math.round((Date.now() - new Date(date)) / 86400000)} day(s) ago)\n`)

  const ctxRes = await fetch(`${RELAY}/context/date/${date}`)
  check('the archive answers for that date', ctxRes.ok, `HTTP ${ctxRes.status}`)
  const ctx = ctxRes.ok ? await ctxRes.json() : {}

  // `games` is an OBJECT of two arrays, not an array. Run 33134550309 read it
  // as `Array.isArray(ctx.games) ? ctx.games : []`, got [], and reported six
  // competitions as gaps -- MLB, WNBA, La Liga, EFL Cup, EFL Trophy and UCL
  // Qualifying, all of which had rows. A check that misreads its input reports
  // a universal failure and looks like a discovery.
  //
  // The shape is read from two existing consumers rather than guessed a second
  // time: field-laboratory `scripts/brief-join-capture.mjs:84`
  // (`[...(j.games?.regular ?? []), ...(j.games?.postseason ?? [])]`) and
  // `scripts/drift-check.mjs:100` (`n(j?.games?.regular) + n(j?.games?.postseason)`).
  const games = [...(ctx.games?.regular ?? []), ...(ctx.games?.postseason ?? [])]

  // The shape assertion, so a payload change fails BY NAME instead of arriving
  // as every competition simultaneously going missing.
  check('the payload carries games.regular / games.postseason, not a bare array',
    ctx.games !== undefined && !Array.isArray(ctx.games) && typeof ctx.games === 'object',
    `games is ${Array.isArray(ctx.games) ? 'an array' : typeof ctx.games} — ` +
    'the shape changed, and every "gap" below is this check misreading it')

  const archived = new Map()
  for (const g of games) archived.set(g.sport, (archived.get(g.sport) || 0) + 1)

  const espnDate = date.replace(/-/g, '')
  const rows = []
  for (const r of cron) {
    const u = `${ESPN}/${r.sport}/${r.league}/scoreboard?dates=${espnDate}`
    let n = null
    try { const j = await (await fetch(u)).json(); n = (j.events || []).length } catch { /* n stays null */ }
    rows.push({ ...r, espn: n, archive: archived.get(r.label) || 0 })
  }

  // A competition ESPN could not be asked about is NOT evidence of a gap.
  const unreachable = rows.filter(r => r.espn === null)
  const withFixtures = rows.filter(r => r.espn > 0)
  const gaps = withFixtures.filter(r => r.archive === 0)

  console.log('  competition            ESPN  archive')
  for (const r of rows.filter(r => r.espn !== 0))
    console.log(`  ${String(r.label).padEnd(22)} ${String(r.espn ?? '?').padStart(4)} ${String(r.archive).padStart(8)}${r.espn > 0 && r.archive === 0 ? '   GAP' : ''}`)

  // Non-vacuity, and it is the assertion this check most needs: a day on which
  // ESPN returned nothing anywhere would show zero gaps and prove nothing.
  console.log('')
  check('the date carried fixtures somewhere — otherwise a clean run is vacuous',
    withFixtures.length >= 3, `${withFixtures.length} competition(s) with fixtures`)
  check('the archive returned rows for that date', games.length > 0, `${games.length} game(s)`)
  check('every seeded competition with fixtures reached the archive', gaps.length === 0,
    gaps.map(g => `${g.label} — ${g.espn} fixture(s) on ESPN ${g.league}, 0 rows in /context/date`).join('\n        → '))
  if (unreachable.length)
    console.log(`\n  ${unreachable.length} competition(s) ESPN did not answer for; not counted either way:` +
                `\n    ${unreachable.map(r => r.label).join(', ')}`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass}/${pass + fail} checks passed`)
process.exit(fail === 0 ? 0 : 1)
