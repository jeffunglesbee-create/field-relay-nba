// WHEN does a day's soccer game get its BSD event id? The real marker logic of runBsdGameJoinWindow (sliced out of
// src/index.js), run through simulated days of 15-minute cron ticks against a fake KV and a fake clock.
//
// WHY THIS EXISTS, measured 2026-11-06. The laboratory's game cards said "No lineup source for this game" for all five
// big-five games of the day at 22:50Z, hours after they had finished. Cause: the archive creates a day's game rows at
// about 10:00Z; a date's first pass of each UTC day runs near 00:00Z, ten hours earlier; it found nothing pending and
// was marked DONE for 36 h; so the rows sat unjoined until the next midnight UTC. change_log joined to
// regular_season_games (read 2026-11-07): the rows of game days 10-30, 10-31, 11-01, 11-02 and 11-06, every one created
// 10:00Z, were joined at 00:xxZ of the following day (68 rows). scripts/check-bsd-game-join-wiring.mjs reads the
// shape of this code; it cannot say how long a row waits. This does.
//
// WHAT THE FIRST VERSION MISSED, found by two reviews the same night (wf_753e8877-a88, wf_2e9f8e6d-9e4). It placed the
// game rows at ONE window position, created them exactly on a tick, and ran every 15 minutes. The first fix (an hour's
// marker on an empty date) passed it and was still wrong: an empty pass took the tick's one slot, so the empty dates AHEAD
// of a date with rows each took a tick and held hourly markers that expired in lockstep, and a date late in the window
// waited for the field date to roll (1140 minutes for the +3 date; 1440 when the join is reached once an hour). So this
// runs rows at EVERY window position, created at four minutes past the hour as well as on it, with the marker's expiry
// boundary read both ways (alive at exactly its TTL, and expired there), a jittered clock, and four reach cadences,
// because production reaches this call only past three gates in handleJournalismCycle (live hours, game lines present,
// slate context changed), not on every tick. It also runs every window date holding rows together, and the bound that
// protects BSD: at most ONE pass that reads BSD per tick (24 upstream pages, Rule 78).
//
// THE BOUND. A row created at time c waits at most until the first reach after c + 1 h + 30 s: by then every marker an
// earlier empty pass could have left (an hour) has expired under either expiry rule, and every empty date ahead of it
// has been passed over without using the tick. When n dates hold rows together the bound is the nth reach after that,
// because only one date reads BSD per reach. A wait beyond that is the code holding a date it should not, not the cadence.
//
// WHAT IS REAL AND WHAT IS A STAND-IN. Real: the text of runBsdGameJoinWindow, including its marker keys, TTLs and the
// loop. Stand-ins: the KV (honours expirationTtl against the simulated clock), the clock, the reach cadence (a stated
// pattern of ticks, NOT the production gates, whose cadence is not measured here), and runBsdGameJoinForDate (it reports
// `pending` as the rows that exist and are unjoined, joins them all, and counts the call; the real one makes no BSD call
// when nothing is pending, which is why an empty pass may be repeated within a tick). It does NOT call BSD and does not
// test the matcher (scripts/check-bsd-game-join.mjs does). The field date key is UTC minus five hours, an approximation of
// the cron's Eastern key; the property under test does not depend on the exact rollover.
//
// Usage:  node scripts/check-bsd-join-window-timing.mjs [--self-test] [--source <index.js>]

import { readFileSync } from 'node:fs'

const argv = process.argv
const srcIdx = argv.indexOf('--source')
const SRC = srcIdx > 0 ? argv[srcIdx + 1] : 'src/index.js'

const sliceFn = (text) => {
  const a = text.indexOf('async function runBsdGameJoinWindow(')
  if (a < 0) return null
  const b = text.indexOf('\n}\n', a)
  return b < 0 ? null : text.slice(a, b + 3)
}

const DAY0 = '2026-11-06'                                 // the field date the rows are created on
const STEP_MIN = 15
const MARKER_MS = 3600 * 1000                             // an empty date's marker, and the bound's one hour
const JITTER_MS = 30_000
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

// Reach cadences: which 15-minute ticks actually call runBsdGameJoinWindow. Production gates it behind
// `hour >= 10 || hour <= 2` (UTC), a non-empty slate and a changed slate context; the last two are not modelled, so these are
// stated patterns that bracket them, not the gate.
export const REACH = {
  'every tick': () => true,
  'live hours only (UTC 10-02)': (ms) => { const h = new Date(ms).getUTCHours(); return h >= 10 || h <= 2 },
  'once an hour, at :00': (ms) => new Date(ms).getUTCMinutes() === 0,
  'sparse (10:00, 14:00, 19:00Z, then every tick from 20:00Z)': (ms) => {
    const d = new Date(ms), h = d.getUTCHours(), m = d.getUTCMinutes()
    return (m === 0 && (h === 10 || h === 14 || h === 19)) || h >= 20 || h <= 2
  },
}

/** The nth reach (a tick that calls the function) strictly after tMs. */
const nthReachAfter = (reach, from, tMs, n) => {
  let seen = 0
  for (let slot = Date.parse(from); slot < Date.parse(from) + 5 * 86400000; slot += STEP_MIN * 60000) if (slot > tMs && reach(slot) && ++seen === n) return slot
  return Infinity
}

/**
 * One simulated UTC span. `dates` is [{ date, rows, stuck }]: for each, `rows` games BSD lists and `stuck` games it never
 * does (a row the join can never match; it keeps the date `pending` after every pass, which is what the 36 h marker
 * exists to stop re-reading from BSD every tick). All rows are created at DAY0 10:00Z plus `createdOffsetMin`.
 * Returns what happened, as data, so the assertions below read numbers and not logs.
 */
export async function simulate(fnText, {
  createdOffsetMin = 0, from = `${DAY0}T00:00:00Z`, to = '2026-11-07T12:00:00Z',
  dates = [{ date: addDays(DAY0, 1), rows: 5, stuck: 1 }],
  reach = REACH['every tick'], tie = 'strict', jitter = false,
} = {}) {
  let nowMs = Date.parse(from)
  const endMs = Date.parse(to)
  const kv = new Map()                                   // key -> { v, exp }
  // `tie` is the marker's expiry boundary: 'strict' treats a marker as gone AT its TTL (exp > now keeps it), 'inclusive'
  // keeps it alive AT its TTL. Real KV is neither exactly; the property must hold under both.
  const alive = (exp) => (tie === 'strict' ? exp > nowMs : exp >= nowMs)
  const KV = {
    get: async (k) => { const e = kv.get(k); return e && alive(e.exp) ? e.v : null },
    put: async (k, v, o = {}) => { kv.set(k, { v, exp: nowMs + (o.expirationTtl ?? 1e12) * 1000 }) },
  }
  const createdMs = Date.parse(`${DAY0}T10:00:00Z`) + createdOffsetMin * 60000
  const tables = new Map(dates.map(d => [d.date, Array.from({ length: d.rows + d.stuck }, (_, i) => ({ stuck: i >= d.rows, joinedAt: null }))]))
  const attempts = []                                     // every runBsdGameJoinForDate call: { at, tick, date, pending }
  const visits = new Map()                                // date -> [ms of every pass over it]
  let tick = -1
  const runBsdGameJoinForDate = async (_env, date) => {
    if (!visits.has(date)) visits.set(date, [])
    visits.get(date).push(nowMs)
    const table = tables.get(date)
    const pending = table && nowMs >= createdMs ? table.filter(r => r.joinedAt === null) : []
    attempts.push({ at: nowMs, tick, date, pending: pending.length })
    for (const r of pending) if (!r.stuck) r.joinedAt = nowMs
    return { ok: true, date, pending: pending.length, written: pending.filter(r => !r.stuck).length }
  }
  class SimDate extends Date { constructor(...a) { if (a.length) super(...a); else super(nowMs) } static now() { return nowMs } }
  const fn = new Function('runBsdGameJoinForDate', 'Date', 'console', `${fnText}\nreturn runBsdGameJoinWindow;`)(runBsdGameJoinForDate, SimDate, { log() {}, warn() {}, error() {} })
  const env = { ARCHIVE_DB: {}, BSD_API_TOKEN: 'x', FIELD_JOURNALISM: KV }
  let seed = 12345
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  let reaches = 0
  for (let slot = Date.parse(from); slot <= endMs; slot += STEP_MIN * 60000) {
    nowMs = slot + (jitter ? Math.floor(rnd() * JITTER_MS) : 0)    // a tick fires up to 30 s late
    if (!reach(slot)) continue
    reaches++
    tick++
    const dateKey = new Date(nowMs - 5 * 3600000).toISOString().slice(0, 10)   // an Eastern-like field date
    await fn(env, dateKey)
  }
  return { createdMs, tables, attempts, visits, endMs, reaches, from, reach }
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 16) + 'Z'

/** Findings for ONE scenario, as an array: an empty one is the pass. */
export async function scenarioFindings(fnText, opts) {
  const out = []
  const r = await simulate(fnText, opts)
  const heavyDates = [...r.tables].filter(([, t]) => t.length).length
  const boundMs = nthReachAfter(r.reach, r.from, r.createdMs + MARKER_MS + JITTER_MS, Math.max(1, heavyDates)) - r.createdMs + JITTER_MS
  for (const [date, table] of r.tables) {
    const joinable = table.filter(x => !x.stuck).map(x => x.joinedAt)
    if (joinable.length) {
      if (joinable.some(x => x === null)) out.push(`date ${date}: ${joinable.filter(x => x === null).length} of ${joinable.length} joinable rows were still unjoined at ${iso(r.endMs)}`)
      else {
        const last = Math.max(...joinable)
        const waitMin = Math.round((last - r.createdMs) / 60000)
        if (last - r.createdMs > boundMs) out.push(`date ${date}: the last joinable row waited ${waitMin} minutes after its creation (${iso(r.createdMs)}) for its join, at ${iso(last)}; the bound is ${Math.round(boundMs / 60000)}`)
        if (joinable.some(x => x < r.createdMs)) out.push(`date ${date}: a row was joined before it existed (the stand-in or the clock is wrong)`)
      }
    }
    // A date never visited is absent from the map, and absence is not an empty list: it is its own finding.
    const visited = r.visits.get(date)
    if (!visited) out.push(`date ${date}: never passed over`)
    else if (!visited.some(t => t >= r.createdMs)) out.push(`date ${date}: not passed over after its rows existed`)
  }
  // A date WITH rows is read from BSD once per UTC day, not on every tick: the upstream bound the marker exists for.
  const heavy = r.attempts.filter(a => a.pending > 0)
  const perDay = new Map()
  for (const a of heavy) { const k = `${a.date}@${new Date(a.at).toISOString().slice(0, 10)}`; perDay.set(k, (perDay.get(k) || 0) + 1) }
  for (const [k, n] of perDay) if (n > 1) out.push(`the date ${k.split('@')[0]} was re-attempted ${n} times with rows pending on UTC day ${k.split('@')[1]}`)
  // The other bound: ONE pass that reads BSD per tick (a pass with rows pending is the one that reads; an empty pass reads
  // only D1). Several in a tick is up to 5 x 24 upstream pages in 15 minutes where the comment above the function says 24.
  const perTick = new Map()
  for (const a of heavy) perTick.set(a.tick, (perTick.get(a.tick) || 0) + 1)
  const worstTick = Math.max(0, ...perTick.values())
  if (worstTick > 1) out.push(`${worstTick} passes that read BSD in one tick (the limit is 1)`)
  return out
}

const SINGLE_OFFSETS = [-1, 0, 1, 2, 3]
const CREATED_OFFSETS_MIN = [0, 7, 29, 59]                // on the hour, and off it: markers expire at other phases
/** The scenario list. Each is { label, opts }. */
export function scenarios() {
  const out = []
  const knobs = []
  for (const tie of ['strict', 'inclusive']) for (const jitter of [false, true]) for (const [reachName, reach] of Object.entries(REACH)) knobs.push({ tie, jitter, reach, reachName })
  for (const offset of SINGLE_OFFSETS) for (const createdOffsetMin of CREATED_OFFSETS_MIN) for (const k of knobs) {
    out.push({ label: `one date, ${offset >= 0 ? '+' : ''}${offset} from the field date, rows created 10:${String(createdOffsetMin).padStart(2, '0')}Z, ${k.tie} expiry, ${k.jitter ? 'jittered' : 'exact'} ticks, reached: ${k.reachName}`,
      opts: { createdOffsetMin, tie: k.tie, jitter: k.jitter, reach: k.reach, dates: [{ date: addDays(DAY0, offset), rows: 5, stuck: 1 }] } })
  }
  const all = (rows, stuck) => SINGLE_OFFSETS.map(o => ({ date: addDays(DAY0, o), rows, stuck }))
  for (const [name, dates] of [['all five dates hold rows', all(3, 0)], ['all five dates hold one unmatched row', all(0, 1)]]) for (const createdOffsetMin of [0, 29]) for (const k of knobs) {
    out.push({ label: `${name}, rows created 10:${String(createdOffsetMin).padStart(2, '0')}Z, ${k.tie} expiry, ${k.jitter ? 'jittered' : 'exact'} ticks, reached: ${k.reachName}`,
      opts: { createdOffsetMin, tie: k.tie, jitter: k.jitter, reach: k.reach, dates } })
  }
  return out
}

/** Every scenario against one source text. */
export async function findings(fnText) {
  if (fnText == null) return ['runBsdGameJoinWindow was not found in the source: nothing was simulated']
  const out = []
  const list = scenarios()
  for (const s of list) {
    let f
    try { f = await scenarioFindings(fnText, s.opts) }
    catch (e) { return [`the simulation could not run runBsdGameJoinWindow: ${e.message}`] }
    for (const m of f) out.push(`[${s.label}] ${m}`)
  }
  findings.scenarios = list.length
  return out
}

if (argv.includes('--self-test')) {
  let ran = 0, pass = 0, fail = 0
  const ok = (label, cond, detail = '') => { ran++; cond ? (pass++, console.log(`  PASS  ${label}`)) : (fail++, console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`)) }
  const real = sliceFn(readFileSync(SRC, 'utf8'))
  const clean = await findings(real)
  ok('the real source is clean (control)', clean.length === 0, JSON.stringify(clean.slice(0, 3)))
  const scenarioCount = findings.scenarios

  const M = async (find, replace) => {
    const n = real.split(find).length - 1
    if (n !== 1) throw new Error(`mutant anchor occurs ${n} times, expected 1: ${find.slice(0, 60)}`)
    return findings(real.replace(find, replace))
  }
  const TTL = 'expirationTtl: result.pending === 0 ? 3600 : 36 * 3600'
  const SKIP = 'if (result.ok && result.pending === 0) continue;'
  const caught = (fs, re) => fs.some(f => re.test(f))
  ok('M1 an empty date held 36 h (the 2026-11-06 defect) is CAUGHT, and names the wait',
     caught(await M(TTL, 'expirationTtl: 36 * 3600'), /waited \d+ minutes|still unjoined/))
  ok('M2 an empty date held for the whole window of 24 h is CAUGHT',
     caught(await M(TTL, 'expirationTtl: result.pending === 0 ? 86400 : 36 * 3600'), /waited \d+ minutes|still unjoined/))
  ok('M3 no done marker at all is CAUGHT (a date with rows re-read on every tick)',
     caught(await M(TTL, 'expirationTtl: 1'), /re-attempted \d+ times/))
  ok('M4 a date with rows held only an hour is CAUGHT (the BSD read happens more than once a day)',
     caught(await M(TTL, 'expirationTtl: 3600'), /re-attempted \d+ times/))
  ok('M5 the done marker never read (the guard removed) is CAUGHT',
     caught(await M('if (await env.FIELD_JOURNALISM.get(doneKey)) continue;', ''), /re-attempted \d+ times|passed over/))
  ok('M6 a window that never reaches the game date is CAUGHT as never visited, not as an empty list',
     caught(await M('[-1, 0, 1, 2, 3].map(shift)', '[7, 8].map(shift)'), /never passed over/))
  // The first review's finding: the first fix (an hour's marker on an empty date) without the `continue`. It passed the single
  // window position the first version tested (+1) and starves the +3 date.
  const starved = await M(SKIP, '')
  ok('M7 an empty pass that uses up the tick (the `continue` removed) is CAUGHT, at the +3 window position',
     starved.some(f => /one date, \+3 .*waited \d+ minutes|one date, \+3 .*still unjoined/.test(f)))
  ok('M8 the same mutant passes the single date at +1 on the hour with exact every-tick cadence, which is why the first version of this check missed it',
     !starved.some(f => /one date, \+1 from the field date, rows created 10:00Z, (strict|inclusive) expiry, exact ticks, reached: every tick\]/.test(f)))
  // The second review's finding: nothing held "one pass that reads BSD per tick" against a `continue` that is too eager.
  ok('M9 `continue` after EVERY ok pass (five dates read BSD in one tick) is CAUGHT',
     caught(await M(SKIP, 'if (result.ok) continue;'), /passes that read BSD in one tick/))
  ok('M10 `continue` after a pass that left ONE row pending (five unmatched rows read in one tick) is CAUGHT',
     caught(await M(SKIP, 'if (result.ok && result.pending <= 1) continue;'), /passes that read BSD in one tick/))
  ok('M11 an unconditional `continue` (no date ever returns) is CAUGHT',
     caught(await M(SKIP, 'continue;'), /passes that read BSD in one tick/))
  ok('M12 a missing function refuses rather than passing', (await findings(null))[0].includes('was not found'))
  console.log(fail ? `\n${fail} FAILED of ${ran}` : `\nself-test: ${ran}/${ran}`)
  console.log(`COVERAGE: ${ran} assertion(s): 1 control, 11 mutant/refusal cases of the real runBsdGameJoinWindow. Each control or mutant`)
  console.log(`runs ${scenarioCount} scenarios (one date at each of 5 window positions x 4 creation minutes, and all five dates together x 2, each x 2 expiry`)
  console.log('rules x exact/jittered ticks x 4 reach cadences) over 2026-11-06T00:00Z to 2026-11-07T12:00Z at 15-minute ticks. It does not call BSD.')
  process.exit(fail ? 1 : 0)
}

const text = readFileSync(SRC, 'utf8')
const found = await findings(sliceFn(text))
if (found.length) {
  console.log(`FAIL  ${found.length} finding(s) in ${SRC}${findings.scenarios ? ` (of ${findings.scenarios} scenarios)` : ''}:`)
  found.slice(0, 12).forEach(f => console.log(`   ${f}`))
  if (found.length > 12) console.log(`   ... and ${found.length - 12} more`)
  process.exit(1)
}
// What the PASS means, in numbers: the largest wait over every single-date scenario, and the largest number of passes that
// read BSD in any tick over every scenario.
const fnText = sliceFn(text)
let worstWait = 0, worstTick = 0
for (const s of scenarios()) {
  const r = await simulate(fnText, s.opts)
  for (const [, table] of r.tables) { const j = table.filter(x => !x.stuck).map(x => x.joinedAt); if (j.length) worstWait = Math.max(worstWait, Math.round((Math.max(...j) - r.createdMs) / 60000)) }
  const perTick = new Map(); for (const a of r.attempts.filter(a => a.pending > 0)) perTick.set(a.tick, (perTick.get(a.tick) || 0) + 1)
  worstTick = Math.max(worstTick, 0, ...perTick.values())
}
console.log(`PASS  ${findings.scenarios} of ${findings.scenarios} scenarios: every joinable row was joined by the first reach after its creation plus one marker hour (the nth, for n dates holding rows); the longest wait in any scenario was ${worstWait} minutes; the most passes that read BSD in any one tick was ${worstTick}; no date with rows was re-read within a UTC day (${SRC})`)
console.log('COVERAGE: the real marker logic and loop, simulated days, a fake KV and a fake runBsdGameJoinForDate, four stated reach cadences. It does not call BSD, test the matcher, or see the real cron gates.')
