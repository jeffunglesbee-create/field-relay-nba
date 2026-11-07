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
// A LATENT DEFECT THE HOURLY MARKER DID NOT REACH, found by reading D1 on 2026-11-07, not by a miss. The hourly marker fixed an
// EMPTY date. A date that already carries a row BSD will never match (a game the archive seeded months ahead, later moved or
// cancelled: D1 holds such rows for 2026-10-24, 10-31 and 11-05) is not empty at the day's first pass near 00:00Z. That pass has
// something pending, reads BSD, joins nothing it can, and would hold the date 36 h, so the rows the archive creates at 10:00Z
// would wait for the next midnight UTC. The scenarios above created every row, stuck or not, at 10:00Z, so none had a row that
// was already there and unjoinable at the first pass. `seeded` is that row. No miss of this kind is on record: the 2026-11-07
// miss was a different thing, a 36 h marker written at 00:45Z by the pre-fix code that survived the deploy, which no simulation
// of the fixed code can show (scripts/probe-bsd-join-markers.mjs read it from KV).
//
// THE RULE THE FIX GIVES, and the second bound. A pass that leaves nothing unjoined holds the date an hour: its next pass finds
// nothing pending and reads only D1. A pass that leaves rows unjoined holds it LEFTOVER_HOLD_HOURS (6): a stuck row costs one
// BSD read per 6 h, never one per tick, and the hold ends before the 10:00Z rows (the cycle returns before the join from 03:00Z
// to 09:59Z, so a pass at 02:45Z holds until 08:45Z). So a date is read from BSD at most MAX_READS_PER_DAY (24 / 6 = 4) times
// in a UTC day. The loop visits today first and yesterday LAST: yesterday's 6 h hold has ended by 10:00Z, and in front of today
// it would take the tick's one BSD slot (found by review; the `unmatchable row already there at -1` scenarios fail on the old order).
//
// NOT MODELLED, named so a green run is not read as covering it: two or more dates with an unmatchable row ahead of a date with
// fresh rows on the SPARSE cadence (three reaches in nine hours). A stuck date's 6 h re-read takes the scarce reach, and a later
// date's rows wait about 10 h. The five-date seeded family therefore leaves that cadence out. In production the reach cadence
// is the slate-context gate, which is not measured here. Likewise a FAILED date (a pass that threw, or answered non-200) is held
// an hour by its failure marker, so on a cadence of one reach an hour or sparser it is tried again at every reach and takes the
// tick, and the dates behind it wait; the throwing-date scenarios use only the 15-minute cadences. A `continue` after a failed pass
// with a page budget shared across the tick would cure it; not built.
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
const LEFTOVER_HOLD_HOURS = 6                             // how long a pass that left rows unjoined holds its date
const MAX_READS_PER_DAY = 24 / LEFTOVER_HOLD_HOURS        // BSD-reading passes over one date in one UTC day
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

// Reach cadences: which 15-minute ticks actually call runBsdGameJoinWindow. Production gates it behind
// `hour >= 10 || hour <= 2` (UTC), a non-empty slate and a changed slate context; the last two are not modelled, so these are
// stated patterns that bracket them, not the gate.
export const REACH = {
  'every tick': () => true,
  'live hours only (UTC 10-02)': (ms) => { const h = new Date(ms).getUTCHours(); return h >= 10 || h <= 2 },
  'once an hour, at :00': (ms) => new Date(ms).getUTCMinutes() === 0,
  'live hours, once an hour at :00 (UTC 10-02)': (ms) => { const d = new Date(ms), h = d.getUTCHours(); return d.getUTCMinutes() === 0 && (h >= 10 || h <= 2) },
  'sparse (10:00, 14:00, 19:00Z, then every tick from 20:00Z)': (ms) => {
    const d = new Date(ms), h = d.getUTCHours(), m = d.getUTCMinutes()
    return (m === 0 && (h === 10 || h === 14 || h === 19)) || h >= 20 || h <= 2
  },
}

/** The nth reach at or after tMs (the tick that CREATES the rows runs the pass after creating them: the seed precedes the join). */
const nthReachAtOrAfter = (reach, from, tMs, n) => {
  let seen = 0
  for (let slot = Date.parse(from); slot < Date.parse(from) + 5 * 86400000; slot += STEP_MIN * 60000) if (slot >= tMs && reach(slot) && ++seen === n) return slot
  return Infinity
}

/** The nth reach (a tick that calls the function) strictly after tMs. */
const nthReachAfter = (reach, from, tMs, n) => {
  let seen = 0
  for (let slot = Date.parse(from); slot < Date.parse(from) + 5 * 86400000; slot += STEP_MIN * 60000) if (slot > tMs && reach(slot) && ++seen === n) return slot
  return Infinity
}

/**
 * One simulated UTC span. `dates` is [{ date, rows, stuck, seeded }]: for each, `rows` games BSD lists, `stuck` games it never
 * does (a row the join can never match; it keeps the date `pending` after every pass, which is what the hold on a date
 * with leftovers exists to stop re-reading from BSD every tick), and `seeded` such unmatchable rows that already exist
 * before the simulation starts. `rows` and `stuck` are created at DAY0 10:00Z plus `createdOffsetMin`; `late: { rows, afterMin }`
 * is a second batch of joinable rows created `afterMin` minutes after that (a game the slate adds later in the day); `throws: true`
 * makes every pass over that date that has rows pending throw (a BSD timeout), as the real function does when its fetch rejects.
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
  const tables = new Map(dates.map(d => [d.date, [
    ...Array.from({ length: d.seeded ?? 0 }, () => ({ stuck: true, created: 0, joinedAt: null })),     // there before the first pass
    ...Array.from({ length: d.rows + d.stuck }, (_, i) => ({ stuck: i >= d.rows, created: createdMs, joinedAt: null })),
    ...Array.from({ length: d.late?.rows ?? 0 }, () => ({ stuck: false, created: createdMs + d.late.afterMin * 60000, joinedAt: null })),
  ]]))
  const throwing = new Set(dates.filter(d => d.throws).map(d => d.date))
  const attempts = []                                     // every runBsdGameJoinForDate call: { at, tick, date, pending, threw }
  const visits = new Map()                                // date -> [ms of every pass over it]
  let tick = -1
  const runBsdGameJoinForDate = async (_env, date) => {
    if (!visits.has(date)) visits.set(date, [])
    visits.get(date).push(nowMs)
    const table = tables.get(date)
    const pending = table ? table.filter(r => r.created <= nowMs && r.joinedAt === null) : []
    const threw = pending.length > 0 && throwing.has(date)
    attempts.push({ at: nowMs, tick, date, pending: pending.length, threw })
    if (threw) throw new Error('simulated BSD timeout')
    for (const r of pending) if (!r.stuck) r.joinedAt = nowMs
    return { ok: true, date, pending: pending.length, written: pending.filter(r => !r.stuck).length }
  }
  class SimDate extends Date { constructor(...a) { if (a.length) super(...a); else super(nowMs) } static now() { return nowMs } }
  const fn = new Function('runBsdGameJoinForDate', 'Date', 'console', `${fnText}\nreturn runBsdGameJoinWindow;`)(runBsdGameJoinForDate, SimDate, { log() {}, warn() {}, error() {} })
  const env = { ARCHIVE_DB: {}, BSD_API_TOKEN: 'x', FIELD_JOURNALISM: KV }
  let seed = 12345
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  let reaches = 0, escapes = 0
  for (let slot = Date.parse(from); slot <= endMs; slot += STEP_MIN * 60000) {
    nowMs = slot + (jitter ? Math.floor(rnd() * JITTER_MS) : 0)    // a tick fires up to 30 s late
    if (!reach(slot)) continue
    reaches++
    tick++
    const dateKey = new Date(nowMs - 5 * 3600000).toISOString().slice(0, 10)   // an Eastern-like field date
    try { await fn(env, dateKey) }
    catch (_) { escapes++ }                                         // production's catch is the cycle's; a throw that gets here escaped the function
  }
  return { createdMs, createdOffsetMin, tables, attempts, visits, endMs, reaches, escapes, from, reach }
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 16) + 'Z'

/** Findings for ONE scenario, as an array: an empty one is the pass. */
export async function scenarioFindings(fnText, opts) {
  const out = []
  const r = await simulate(fnText, opts)
  const throwingDates = new Set(r.attempts.filter(a => a.threw).map(a => a.date)).size
  const heavyDates = [...r.tables.values()].filter(t => t.some(x => !x.stuck)).length + throwingDates     // dates with something to join, and a date whose pass throws takes one reach an hour
  // Without a row that was already there, the longest an earlier pass can hold a date is an empty pass's hour. With one, an earlier
  // pass left rows unjoined and holds LEFTOVER_HOLD_HOURS. Rows created by the day's own 10:00Z tick are created BEFORE that tick's
  // pass (offset 0), so the hold must have ended by then and the nth reach at or after creation joins them; rows created later
  // (a second batch) wait for the hold a pass in the meantime started, which is the stated residual bound.
  const seeded = [...r.tables.values()].some(t => t.some(x => x.created === 0))
  const nDates = Math.max(1, heavyDates)
  // The longest a row created at `at` may wait, as a duration after `at`.
  const boundFor = (at) => (!seeded
    ? nthReachAfter(r.reach, r.from, at + MARKER_MS + JITTER_MS, nDates)
    : r.createdOffsetMin === 0
      ? nthReachAtOrAfter(r.reach, r.from, at, nDates)
      : nthReachAfter(r.reach, r.from, at + LEFTOVER_HOLD_HOURS * 3600 * 1000 + JITTER_MS, nDates)) - at + JITTER_MS
  for (const [date, table] of r.tables) {
    const joinable = table.filter(x => !x.stuck)
    if (joinable.length) {
      if (joinable.some(x => x.joinedAt === null)) out.push(`date ${date}: ${joinable.filter(x => x.joinedAt === null).length} of ${joinable.length} joinable rows were still unjoined at ${iso(r.endMs)}`)
      else {
        // One finding per row, against the bound for ITS creation time: a second batch has its own.
        for (const x of joinable) {
          const bound = boundFor(x.created)
          if (x.joinedAt - x.created > bound) { out.push(`date ${date}: a joinable row waited ${Math.round((x.joinedAt - x.created) / 60000)} minutes after its creation (${iso(x.created)}) for its join, at ${iso(x.joinedAt)}; the bound is ${Math.round(bound / 60000)}`); break }
        }
        if (joinable.some(x => x.joinedAt < x.created)) out.push(`date ${date}: a row was joined before it existed (the stand-in or the clock is wrong)`)
      }
    }
    // A date never visited is absent from the map, and absence is not an empty list: it is its own finding.
    const visited = r.visits.get(date)
    if (!visited) out.push(`date ${date}: never passed over`)
    else if (!visited.some(t => t >= r.createdMs)) out.push(`date ${date}: not passed over after its rows existed`)
  }
  // A date is read from BSD at most MAX_READS_PER_DAY times in a UTC day, not on every tick: the upstream bound the hold exists for.
  const heavy = r.attempts.filter(a => a.pending > 0 && !a.threw)
  const perDay = new Map()
  for (const a of heavy) { const k = `${a.date}@${new Date(a.at).toISOString().slice(0, 10)}`; perDay.set(k, (perDay.get(k) || 0) + 1) }
  for (const [k, n] of perDay) if (n > MAX_READS_PER_DAY) out.push(`the date ${k.split('@')[0]} was re-attempted ${n} times with rows pending on UTC day ${k.split('@')[1]} (the limit is ${MAX_READS_PER_DAY})`)
  // A pass that threw is a failed date: held an hour by its failure marker, not retried on every tick, and the dates behind it are visited.
  if (r.escapes) out.push(`${r.escapes} pass(es) threw out of runBsdGameJoinWindow (the function must hold a throwing date, not propagate it)`)
  const threwAt = new Map()
  for (const a of r.attempts.filter(a => a.threw)) { (threwAt.get(a.date) ?? threwAt.set(a.date, []).get(a.date)).push(a.at) }
  for (const [date, ats] of threwAt) for (let i = 1; i < ats.length; i++) if (ats[i] - ats[i - 1] < MARKER_MS - JITTER_MS) { out.push(`date ${date}: a pass that threw was retried after ${Math.round((ats[i] - ats[i - 1]) / 60000)} minutes (its failure marker holds an hour)`); break }
  // The other bound: ONE pass that reads BSD per tick (a pass with rows pending is the one that reads; an empty pass reads
  // only D1). Several in a tick is up to 5 x 24 upstream pages in 15 minutes where the comment above the function says 24.
  const perTick = new Map()
  for (const a of r.attempts.filter(a => a.pending > 0)) perTick.set(a.tick, (perTick.get(a.tick) || 0) + 1)
  const worstTick = Math.max(0, ...perTick.values())
  if (worstTick > 1) out.push(`${worstTick} passes that read BSD in one tick (the limit is 1)`)
  return out
}

const SINGLE_OFFSETS = [-1, 0, 1, 2, 3]
const FAIL_NAMES = new Set(['every tick', 'live hours only (UTC 10-02)'])   // the cadences with at least 4 reaches an hour
const GATED_NAMES = new Set(['live hours only (UTC 10-02)', 'live hours, once an hour at :00 (UTC 10-02)', 'sparse (10:00, 14:00, 19:00Z, then every tick from 20:00Z)'])   // the cadences that obey the live-hours gate
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
  // A date whose pass throws, directly ahead of a date with rows in the loop's order (today, +1, +2, +3, yesterday). The thrown date
  // is marked failed for an hour and the date behind it is joined; uncaught, it is retried every tick and the date behind never runs.
  // Only the cadences with several reaches inside the failure marker's hour: on one reach an hour the marker ends exactly at the next
  // reach, the failed date is tried again each time and takes the tick (see NOT MODELLED).
  const LOOP = [0, 1, 2, 3, -1]
  for (let i = 0; i < LOOP.length - 1; i++) for (const k of knobs.filter(k => FAIL_NAMES.has(k.reachName))) {
    out.push({ label: `the pass over ${LOOP[i] >= 0 ? '+' : ''}${LOOP[i]} throws, rows on ${LOOP[i + 1] >= 0 ? '+' : ''}${LOOP[i + 1]}, ${k.tie} expiry, ${k.jitter ? 'jittered' : 'exact'} ticks, reached: ${k.reachName}`,
      opts: { createdOffsetMin: 0, tie: k.tie, jitter: k.jitter, reach: k.reach, dates: [{ date: addDays(DAY0, LOOP[i]), rows: 0, stuck: 1, throws: true }, { date: addDays(DAY0, LOOP[i + 1]), rows: 5, stuck: 0 }] } })
  }
  // A second batch: a game the slate adds after the day's first rows were joined (R1 a; 0 of 184 soccer rows since 2026-10-24 were
  // created outside hour 10, so this is a bound on a case not yet seen). The marker after a pass that left nothing unjoined is an hour.
  for (const offset of SINGLE_OFFSETS) for (const afterMin of [90, 360]) for (const k of knobs) {
    out.push({ label: `one date, ${offset >= 0 ? '+' : ''}${offset}, 3 rows at 10:00Z and 2 more ${afterMin} minutes later, ${k.tie} expiry, ${k.jitter ? 'jittered' : 'exact'} ticks, reached: ${k.reachName}`,
      opts: { createdOffsetMin: 0, tie: k.tie, jitter: k.jitter, reach: k.reach, dates: [{ date: addDays(DAY0, offset), rows: 3, stuck: 0, late: { rows: 2, afterMin } }] } })
  }
  // Rows on today and an unmatchable row already there on ANOTHER window date. Yesterday's hold has ended by 10:00Z, so it must not
  // sit in front of today in the loop and take the tick's one BSD slot: today's rows are joined by the creating tick's own pass.
  for (const stuckOffset of [-1, 1, 2, 3]) for (const k of knobs.filter(k => GATED_NAMES.has(k.reachName))) {
    out.push({ label: `rows on the field date, an unmatchable row already there at ${stuckOffset >= 0 ? '+' : ''}${stuckOffset}, ${k.tie} expiry, ${k.jitter ? 'jittered' : 'exact'} ticks, reached: ${k.reachName}`,
      opts: { createdOffsetMin: 0, tie: k.tie, jitter: k.jitter, reach: k.reach, dates: [{ date: addDays(DAY0, 0), rows: 5, stuck: 0 }, { date: addDays(DAY0, stuckOffset), rows: 0, stuck: 0, seeded: 1 }] } })
  }
  // Rows that were already there, unmatchable, when the day's first pass ran. Only the cadences that obey
  // production's live-hours gate (no pass 03:00Z-09:59Z) are run: a 6 h hold from a pass at 09:45Z would end at 15:45Z, and no such
  // pass exists, because the cron's handler returns before the join outside `hour >= 10 || hour <= 2`.
  const gatedKnobs = knobs.filter(k => GATED_NAMES.has(k.reachName))
  for (const offset of SINGLE_OFFSETS) for (const createdOffsetMin of [0, 29]) for (const k of gatedKnobs) {
    out.push({ label: `one date, ${offset >= 0 ? '+' : ''}${offset}, 2 unmatchable rows already there, rows created 10:${String(createdOffsetMin).padStart(2, '0')}Z, ${k.tie} expiry, ${k.jitter ? 'jittered' : 'exact'} ticks, reached: ${k.reachName}`,
      opts: { createdOffsetMin, tie: k.tie, jitter: k.jitter, reach: k.reach, dates: [{ date: addDays(DAY0, offset), rows: 5, stuck: 0, seeded: 2 }] } })
  }
  // Five dates at once: not the sparse cadence. A date left with an unmatchable row is re-read when its hold ends, and on a cadence
  // of three reaches in nine hours that re-read takes a reach a later date was waiting for; the nth-reach bound has no term for it.
  // On the 15-minute and hourly cadences the five dates are served by the first five reaches, before any hold ends.
  for (const createdOffsetMin of [0, 29]) for (const k of gatedKnobs.filter(k => !k.reachName.startsWith('sparse'))) {
    out.push({ label: `all five dates, each with an unmatchable row already there and 3 rows created 10:${String(createdOffsetMin).padStart(2, '0')}Z, ${k.tie} expiry, ${k.jitter ? 'jittered' : 'exact'} ticks, reached: ${k.reachName}`,
      opts: { createdOffsetMin, tie: k.tie, jitter: k.jitter, reach: k.reach, dates: SINGLE_OFFSETS.map(o => ({ date: addDays(DAY0, o), rows: 3, stuck: 0, seeded: 1 })) } })
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
  const TTL = 'expirationTtl: result.pending - result.written > 0 ? 6 * 3600 : 3600'
  const SKIP = 'if (result.ok && result.pending === 0) continue;'
  const caught = (fs, re) => fs.some(f => re.test(f))
  ok('M1 every pass held 36 h (the 2026-11-06 defect: an empty date held 36 h) is CAUGHT, and names the wait',
     caught(await M(TTL, 'expirationTtl: 36 * 3600'), /waited \d+ minutes|still unjoined/))
  ok('M2 a pass that left nothing unjoined held 24 h is CAUGHT',
     caught(await M(TTL, 'expirationTtl: result.pending - result.written > 0 ? 6 * 3600 : 86400'), /waited \d+ minutes|still unjoined/))
  ok('M3 no done marker at all is CAUGHT (a date with rows re-read on every tick)',
     caught(await M(TTL, 'expirationTtl: 1'), /re-attempted \d+ times/))
  ok('M4 a date left with unjoined rows held only an hour is CAUGHT (a stuck row read from BSD 24 times a day)',
     caught(await M(TTL, 'expirationTtl: 3600'), /re-attempted \d+ times/))
  ok('M5 the done marker never read (the guard removed) is CAUGHT',
     caught(await M('if (await env.FIELD_JOURNALISM.get(doneKey)) continue;', ''), /re-attempted \d+ times|passed over/))
  ok('M6 a window that never reaches the game date is CAUGHT as never visited, not as an empty list',
     caught(await M('[0, 1, 2, 3, -1].map(shift)', '[7, 8].map(shift)'), /never passed over/))
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
  // The 2026-11-07 failure the first fix did not reach: an unmatchable row already there at the day's first pass.
  ok('M13 a date left with unjoined rows held 36 h (the pre-fix rule for such a date) is CAUGHT in the seeded scenarios, and names the wait',
     caught(await M(TTL, 'expirationTtl: result.pending - result.written > 0 ? 36 * 3600 : 3600'), /unmatchable rows? already there.*waited \d+ minutes/))
  ok('M14 a date left with unjoined rows held 12 h (past the 10:00Z rows) is CAUGHT',
     caught(await M(TTL, 'expirationTtl: result.pending - result.written > 0 ? 12 * 3600 : 3600'), /unmatchable rows? already there.*waited \d+ minutes/))
  ok('M15 a date left with unjoined rows held 8 h (the 10:00Z pass then holds the 10:29Z rows past the 6 h bound) is CAUGHT',
     caught(await M(TTL, 'expirationTtl: result.pending - result.written > 0 ? 8 * 3600 : 3600'), /unmatchable rows? already there.*waited \d+ minutes/))
  ok('M16 a date left with unjoined rows held 3 h (more than 4 BSD reads a day for a stuck row) is CAUGHT',
     caught(await M(TTL, 'expirationTtl: result.pending - result.written > 0 ? 3 * 3600 : 3600'), /re-attempted \d+ times/))
  ok('M17 a pass that joined something held 6 h whatever it left (a second batch waits for the hold) is CAUGHT by the second-batch scenarios',
     caught(await M(TTL, 'expirationTtl: result.pending > 0 ? 6 * 3600 : 3600'), /2 more \d+ minutes later.*waited \d+ minutes/))
  ok('M18 yesterday FIRST in the loop (the order before review) is CAUGHT: its expired hold takes the tick\'s one BSD slot ahead of today',
     caught(await M('[0, 1, 2, 3, -1].map(shift)', '[-1, 0, 1, 2, 3].map(shift)'), /an unmatchable row already there at -1.*waited \d+ minutes/))
  const CATCH = "try { result = await runBsdGameJoinForDate(env, date); }\n    catch (e) { result = { ok: false, reason: `the pass threw: ${e.message}`, date }; }"
  ok('M19 a throwing pass left uncaught (no marker, retried every tick, the dates behind never visited) is CAUGHT',
     caught(await M(CATCH, 'result = await runBsdGameJoinForDate(env, date);'), /threw out of runBsdGameJoinWindow|still unjoined/))
  ok('M20 a throwing pass caught but no failure marker written (retried every tick) is CAUGHT',
     caught(await M("else await env.FIELD_JOURNALISM.put(failKey, String(result.reason || 'failed'), { expirationTtl: 3600 });", ''), /a pass that threw was retried after \d+ minutes/))
  ok('M12 a missing function refuses rather than passing', (await findings(null))[0].includes('was not found'))
  console.log(fail ? `\n${fail} FAILED of ${ran}` : `\nself-test: ${ran}/${ran}`)
  console.log(`COVERAGE: ${ran} assertion(s): 1 control, 1 designed-to-pass case (M8), 1 refusal (M12) and ${ran - 3} mutants of the real runBsdGameJoinWindow. Each control or mutant`)
  console.log(`runs ${scenarioCount} scenarios, every family crossed with 2 expiry rules x exact/jittered ticks and the cadences named: one date at each of 5 window positions x 4 creation minutes x ${Object.keys(REACH).length} cadences;`)
  console.log(`all five dates together x 2 creation minutes x ${Object.keys(REACH).length}; a second batch of rows x 2 delays x 5 positions x ${Object.keys(REACH).length}; an unmatchable row already there on the ${GATED_NAMES.size} live-hours-gated cadences only (one date x 5 positions x 2,`)
  console.log(`five dates x 2 without the sparse cadence, another date holding the row x 4); a throwing pass ahead of a date with rows x 4 pairs x ${FAIL_NAMES.size} 15-minute cadences; over 2026-11-06T00:00Z to 2026-11-07T12:00Z at 15-minute ticks. It does not call BSD.`)
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
let worstWait = 0, worstTick = 0, worstLabel = ''
for (const s of scenarios()) {
  const r = await simulate(fnText, s.opts)
  for (const [, table] of r.tables) for (const x of table.filter(x => !x.stuck)) { const w = Math.round((x.joinedAt - x.created) / 60000); if (w > worstWait) { worstWait = w; worstLabel = s.label } }
  const perTick = new Map(); for (const a of r.attempts.filter(a => a.pending > 0)) perTick.set(a.tick, (perTick.get(a.tick) || 0) + 1)
  worstTick = Math.max(worstTick, 0, ...perTick.values())
}
console.log(`PASS  ${findings.scenarios} of ${findings.scenarios} scenarios: every joinable row was joined by the first reach after its creation plus one marker hour (the nth, for n dates holding rows; with an unmatchable row already there, by the creating tick's own pass, or one hold later for a second batch); the longest wait in any scenario was ${worstWait} minutes (the nth reach of n dates, inside its bound: ${worstLabel}); the most passes that read BSD in any one tick was ${worstTick}; no date was read from BSD more than ${MAX_READS_PER_DAY} times in a UTC day (${SRC})`)
console.log(`COVERAGE: the real marker logic and loop, simulated days, a fake KV and a fake runBsdGameJoinForDate, ${Object.keys(REACH).length} stated reach cadences (the seeded families use the ${GATED_NAMES.size} that obey the live-hours gate; the five-date seeded family also leaves out the sparse one: see NOT MODELLED in the header). It does not call BSD, test the matcher, or see the real cron gates.`)
