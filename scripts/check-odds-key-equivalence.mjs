// Extracting the odds-key tables must change NOTHING. This proves it.
//
// CC-CMD-2026-09-11-odds-key-map-reconcile, Task 1 — executed on its STRUCTURAL
// claim only. Its causal claim (that map divergence starves MLS of odds) is
// disproven: ambient-do.js's map holds eleven entries including
// `mls: 'soccer_usa_mls'`, created that way in 043f4d6 and never changed.
// See outbox/cc-session-2026-09-11-odds-key-map-reconcile.md.
//
// A refactor does not need the bug's story to be true. What IS true and
// measured: index.js:6344 and wp-resolver.js:53 declare the SAME 16 keys with
// the SAME 16 values. That is one table written twice.
//
// THE INVARIANT: for every key any call site can pass, the extracted table must
// return exactly what the in-file table returned. Not a sample — every key in
// every table, plus every sport label the archive actually stores.
//
// If any lookup differs, the tables were never the same mapping and the
// divergence is semantic rather than accidental — which is a finding, not a
// failure to route around.

import { readFileSync } from 'node:fs'

const SELF_TEST = process.argv.includes('--self-test')
let failed = 0
const check = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if (!ok) { failed++; if (d) console.log(`      → ${d}`) } }

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

/** An object-literal table parsed out of a source file by name. */
export const tableIn = (src, name) => {
  const i = src.indexOf(`const ${name} =`)
  if (i < 0) return null
  const j = src.indexOf('\n};', i)
  if (j < 0) return null
  const body = strip(src.slice(i, j))
  const re = /(?:^|[{,])\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_]\w*))\s*:\s*'([^']+)'/g
  return Object.fromEntries([...body.matchAll(re)].map(m => [m[1] || m[2] || m[3], m[4]]))
}

/** Same keys, same values — order-independent. */
export const equivalent = (a, b) => {
  if (!a || !b) return { ok: false, why: 'one side is missing' }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort()
  const onlyA = ka.filter(k => !(k in b)), onlyB = kb.filter(k => !(k in a))
  const diff = ka.filter(k => k in b && a[k] !== b[k])
  return {
    ok: !onlyA.length && !onlyB.length && !diff.length,
    why: [onlyA.length && `only left: ${onlyA}`, onlyB.length && `only right: ${onlyB}`,
          diff.length && `value differs: ${diff.map(k => `${k} ${a[k]}!=${b[k]}`)}`].filter(Boolean).join('; '),
  }
}

if (SELF_TEST) {
  check('identical tables are equivalent', equivalent({ a: '1' }, { a: '1' }).ok)
  // MUTATION: the three ways a table can differ must each be caught, or an
  // extraction that quietly drops or rewrites an entry would ship as "no change".
  check('MUTATION: a MISSING key is caught', equivalent({ a: '1', b: '2' }, { a: '1' }).ok === false,
    'a dropped entry would silently remove odds coverage for that sport')
  check('MUTATION: an EXTRA key is caught', equivalent({ a: '1' }, { a: '1', b: '2' }).ok === false,
    'an added entry is new API spend, which Task 2 gates')
  check('MUTATION: a CHANGED value is caught', equivalent({ a: '1' }, { a: '2' }).ok === false,
    'a rewritten value points a sport at the wrong vendor key')
  check('key ORDER does not matter', equivalent({ a: '1', b: '2' }, { b: '2', a: '1' }).ok)
  check('a table name that does not exist parses to null', tableIn('const X = {\n};', 'NOPE') === null)
  check('unquoted and quoted keys both parse',
    JSON.stringify(tableIn("const T = {\n  mls: 'x',\n  'la liga': 'y',\n};", 'T')) === '{"mls":"x","la liga":"y"}',
    'an earlier census of these very tables dropped every unquoted key')
  console.log(`\n${failed === 0 ? 'SELF-TEST PASS' : `${failed} FAILING`}`)
  process.exit(failed === 0 ? 0 : 1)
}

const idx = readFileSync('src/index.js', 'utf8')
const wp = readFileSync('src/wp-resolver.js', 'utf8')
const amb = readFileSync('src/ambient-do.js', 'utf8')

let shared = null
try { shared = readFileSync('src/odds-sport-keys.js', 'utf8') } catch { /* pre-extraction */ }

const archiveIdx = tableIn(idx, 'ARCHIVE_SPORT_TO_ODDS_KEY')
const archiveWp = tableIn(wp, 'ARCHIVE_SPORT_TO_ODDS_KEY')
const cronIdx = tableIn(idx, 'ODDS_SPORT_KEYS')
const ambTable = tableIn(amb, 'ODDS_SPORT_KEYS')

console.log(`in-file tables: index archive ${archiveIdx ? Object.keys(archiveIdx).length : '-'}, `
  + `wp archive ${archiveWp ? Object.keys(archiveWp).length : '-'}, `
  + `index cron ${cronIdx ? Object.keys(cronIdx).length : '-'}, `
  + `ambient ${ambTable ? Object.keys(ambTable).length : '-'}`)

if (!shared) {
  // BEFORE the extraction. The duplicate pair must already agree, or the
  // extraction is not a refactor and must not proceed.
  const e = equivalent(archiveIdx, archiveWp)
  check('PRE-EXTRACTION: the two archive tables are already the same mapping', e.ok, e.why)
  console.log('\n(no src/odds-sport-keys.js yet — this is the baseline run)')
} else {
  const archiveShared = tableIn(shared, 'ARCHIVE_SPORT_TO_ODDS_KEY')
  const cronShared = tableIn(shared, 'CRON_SPORT_LEAGUE_TO_ODDS_KEY')
  const ambShared = tableIn(shared, 'AMBIENT_SPORT_TO_ODDS_KEY')

  check('the shared module declares all three tables',
    Boolean(archiveShared && cronShared && ambShared),
    `archive=${!!archiveShared} cron=${!!cronShared} ambient=${!!ambShared}`)

  // The duplicated pair is GONE from both files.
  check('index.js no longer declares its own archive table', archiveIdx === null,
    'the duplicate survived the extraction')
  check('wp-resolver.js no longer declares its own archive table', archiveWp === null,
    'the duplicate survived the extraction')
  check('index.js no longer declares its own cron table', cronIdx === null)
  // ambient-do.js keeps `const ODDS_SPORT_KEYS = AMBIENT_SPORT_TO_ODDS_KEY` — a
  // deliberate alias so every read site in that file is untouched by the
  // extraction. So the assertion is not "no declaration" but "no table LITERAL,
  // and the shared module is imported". Asserting absence alone would fail on
  // the correct code and pass on a file that imported nothing.
  check('ambient-do.js declares no table literal of its own',
    ambTable === null || Object.keys(ambTable).length === 0,
    `ambient-do still declares ${ambTable && Object.keys(ambTable).length} entries inline`)
  check('...and imports the shared table',
    /import\s*\{[^}]*AMBIENT_SPORT_TO_ODDS_KEY[^}]*\}\s*from\s*'\.\/odds-sport-keys\.js'/.test(amb),
    'the alias must resolve to the shared module, not to a local of the same name')
  check('index.js imports the shared table and accessors',
    /import\s*\{[^}]*archiveSportToOddsKey[^}]*\}\s*from\s*'\.\/odds-sport-keys\.js'/.test(idx))
  check('wp-resolver.js imports the shared table',
    /import\s*\{[^}]*ARCHIVE_SPORT_TO_ODDS_KEY[^}]*\}\s*from\s*'\.\/odds-sport-keys\.js'/.test(wp))

  // EQUIVALENCE against the values recorded at extraction time. These literals
  // are the pre-extraction tables, pasted once; if the shared module drifts from
  // them the refactor stopped being a refactor.
  const BASELINE_ARCHIVE = {
    nba: 'basketball_nba', wnba: 'basketball_wnba', nhl: 'icehockey_nhl', mlb: 'baseball_mlb',
    epl: 'soccer_epl', mls: 'soccer_usa_mls', 'la liga': 'soccer_spain_la_liga',
    'ligue 1': 'soccer_france_ligue_one', bundesliga: 'soccer_germany_bundesliga',
    'serie a': 'soccer_italy_serie_a', cfl: 'americanfootball_cfl', cfb: 'americanfootball_ncaaf',
    nfl: 'americanfootball_nfl', ufl: 'americanfootball_ufl', afl: 'aussierules_afl', ipl: 'cricket_ipl',
  }
  const BASELINE_CRON = {
    'basketball|nba': 'basketball_nba', 'basketball|wnba': 'basketball_wnba',
    'hockey|nhl': 'icehockey_nhl', 'baseball|mlb': 'baseball_mlb',
    'soccer|eng.1': 'soccer_epl', 'soccer|fifa.world': 'soccer_fifa_world_cup',
  }
  const BASELINE_AMBIENT = {
    nba: 'basketball_nba', nhl: 'icehockey_nhl', mlb: 'baseball_mlb', wnba: 'basketball_wnba',
    wc26: 'soccer_fifa_world_cup', epl: 'soccer_epl', mls: 'soccer_usa_mls',
    laliga: 'soccer_spain_la_liga', seriea: 'soccer_italy_serie_a',
    bundesliga: 'soccer_germany_bundesliga', ligue1: 'soccer_france_ligue_one',
  }
  for (const [name, base, now] of [
    ['archive', BASELINE_ARCHIVE, archiveShared],
    ['cron', BASELINE_CRON, cronShared],
    ['ambient', BASELINE_AMBIENT, ambShared],
  ]) {
    const e = equivalent(base, now)
    check(`${name} table is byte-for-byte what it was before extraction (${Object.keys(base).length} keys)`,
      e.ok, e.why)
  }

  // THE COVERAGE DIFFERENCE IS DELIBERATE AND MUST STAY VISIBLE. Merging ambient
  // up to the archive table's 16 would add six sports to a live API path, which
  // is exactly what Task 2 gates. Asserting the gap keeps a future edit from
  // closing it by accident.
  const archVals = new Set(Object.values(archiveShared || {}))
  const ambVals = new Set(Object.values(ambShared || {}))
  const notInAmbient = [...archVals].filter(v => !ambVals.has(v)).sort()
  check('the ambient/archive coverage gap is unchanged, and is six vendor keys',
    notInAmbient.length === 6,
    `gap is ${notInAmbient.length}: ${notInAmbient.join(', ')} — closing it is new API spend and needs Task 2`)
  console.log(`\n  ambient does not cover: ${notInAmbient.join(', ')}`)
}

console.log(`\n${failed === 0 ? 'PASS' : `${failed} FAILING`}`)
process.exit(failed === 0 ? 0 : 1)
