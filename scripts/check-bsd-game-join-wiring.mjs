// The BSD game join's I/O, checked as source (docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md, Task 4). src/index.js
// cannot be imported under node (a Workers module), so this reads it the way check-odds-matcher-wiring.mjs reads its
// call sites: a set of shapes that must be present and a set that must be absent, each proven failable by
// scripts/mutate-bsd-game-join.mjs, which aims this check at a broken copy through --source.
//
// WHAT IT PROTECTS, in the order a mistake would cost:
//   * `bsd_game_join` must be a change_log source that brief-freshness.js does NOT treat as material, or a lineup id
//     appearing would stale briefs and spend AI calls;
//   * the write must be scoped to rows `bsd_event_id IS NULL` and go through reconcile(), never a bare UPDATE;
//   * the admin route must check the shared secret with the fail-closed helper;
//   * the cycle hook must sit in its own try/catch, so a BSD failure cannot break journalism;
//   * no `|| []` absence collapse in the new code, and no page read as an empty day.
// Coverage is printed: how many call sites were found.
//
// Usage:  node scripts/check-bsd-game-join-wiring.mjs [--source <index.js>]

import { readFileSync } from 'node:fs'

const i = process.argv.indexOf('--source')
const src = readFileSync(i > 0 ? process.argv[i + 1] : 'src/index.js', 'utf8')
const fresh = readFileSync('src/brief-freshness.js', 'utf8')

const body = (name, until) => { const a = src.indexOf(name); if (a < 0) return ''; const b = until ? src.indexOf(until, a + name.length) : -1; return src.slice(a, b > a ? b : a + 8000) }
const runDate = body('async function runBsdGameJoinForDate(', 'async function runBsdGameJoinWindow(')
const window_ = body('async function runBsdGameJoinWindow(', '// Detect whether a just-archived MLB')
const fetcher = body('async function fetchBsdEventsForDay(', '// Fill bsd_event_id for one archive date.')
const route = body("pathname === '/admin/bsd-game-join'", "// POST /admin/archive/backfill-went-to-ot")
const hook = body('runBsdGameJoinWindow(env, dateKey)', 'Odds annotations for prompt injection')
const hookRegion = (() => { const a = src.indexOf('// ── BSD event ids on the soccer rows of the next few days'); return a < 0 ? '' : src.slice(a, a + 900) })()

let fail = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '\n      -> ' + detail}`); if (!ok) fail++ }

check('the new functions are all present (4 of 4 found)', [runDate, window_, fetcher, route].every(x => x.length > 0), `lengths ${[runDate.length, window_.length, fetcher.length, route.length]}`)
check('the join is the shared module: joinBatch and eventDaysFor, imported and called', /import \{[^}]*joinBatch[^}]*eventDaysFor[^}]*\} from '\.\/bsd-game-join\.js'/.test(src) && runDate.includes('joinBatch(') && runDate.includes('eventDaysFor('), 'not wired to src/bsd-game-join.js')
check('only rows WHERE bsd_event_id IS NULL are read, and only the soccer labels', /bsd_event_id IS NULL AND sport IN/.test(runDate), 'the SELECT is not scoped to unjoined soccer rows')
check('the write goes through reconcile() and not a bare UPDATE', runDate.includes('reconcile(env,') && !/UPDATE\s/.test(runDate), 'a raw UPDATE or no reconcile call')
check("the change_log source is bsd_game_join, and brief-freshness treats no source set as containing it", /source: 'bsd_game_join'/.test(runDate) && !/bsd_game_join/.test(fresh) && !/bsd_event_id/.test(fresh), 'a lineup id could stale a brief')
check('the event fetch uses by-date\'s own cache key shape (date_from, date_to, offset, limit) and refuses a non-page', /\?date_from=\$\{day\}&date_to=\$\{day\}&offset=\$\{page \* 50\}&limit=50/.test(fetcher) && /Array\.isArray\(rows\)\) return null/.test(fetcher), 'cache key drifted, or a non-page is read as empty')
check('a partial event read writes nothing (a null day returns ok:false before any write)', /not fully read; nothing written/.test(runDate), 'a truncated read could be written')
check('the page budget binds: an upstream page past maxUpstreamPages returns null', /budget\.upstreamPages >= budget\.maxUpstreamPages\) return null/.test(fetcher), 'no cap on upstream pages (Rule 78)')
check('the admin route is fail-closed on the shared secret and runs the same function', /relaySecretMatches\(request\.headers\.get\('X-FIELD-Relay'\), env\)/.test(route) && route.includes('runBsdGameJoinForDate('), 'unauthenticated or a different function')
check('the cycle hook is in its own try/catch, after the odds snapshot', /try \{ await runBsdGameJoinWindow\(env, dateKey\); \}\s*\n\s*catch \(e\)/.test(hookRegion) && src.indexOf('ODDS-SNAPSHOT] snapshot failed') < src.lastIndexOf('await runBsdGameJoinWindow(env, dateKey)'), 'a BSD failure could break the journalism cycle')
check('one date per tick and a done marker per UTC day, and a failure marker so a bad date does not hold the rest', /return result;/.test(window_) && /bsd-join:\$\{date\}:\$\{today\}/.test(window_) && /bsd-join-fail:/.test(window_) && /put\(failKey, [^;]*expirationTtl: 3600/.test(window_) && /expirationTtl: 36 \* 3600/.test(window_), 'the window pass can spend more than one date per tick, or retries a failure every tick')
check('an unparseable body is a 400 naming the parse error, not a swallowed null', /try \{ body = await request\.json\(\); \}\s*\n\s*catch \(e\) \{[\s\S]{0,200}?body is not JSON[\s\S]{0,200}?status: 400/.test(route) && !/request\.json\(\)\.catch/.test(route), 'a body that is not JSON is read as null (a bare catch)')
check('no absence collapse is introduced by this code', ![runDate, window_, fetcher, route].some(x => /\|\|\s*\[\]|\?\?\s*\[\]|catch\s*\([^)]*\)\s*\{\s*\}/.test(x)), 'a `|| []` or an empty catch in the new code')
console.log(`\n${13 - fail}/13 checks passed`)
process.exit(fail ? 1 : 0)
