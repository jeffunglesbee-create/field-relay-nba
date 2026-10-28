#!/usr/bin/env node
// docs/CC-CMD-2026-10-16-bsd-ws-frame-shape.md (field-laboratory) — record raw
// BSD WebSocket frames VERBATIM from one live match, then say what shape they have.
//
// WHY A RUNNER: the BSD token is an Actions secret and the container cannot reach
// sports.bzzoiro.com (403 at CONNECT). Nothing is pushed to anyone: this opens a
// read-only socket, subscribes to ONE event id, and writes two files.
//
// WHAT IT DOES NOT ASSUME. `src/ambient-do.js` `_bsdOnFrame` keeps frames whose
// `type` is 'livedata' or 'event' and drops the rest silently. The URL, the
// `{action:'subscribe', event_id}` message and both type names come from the
// 2026-06-25 CC-CMD spec, not from an observed BSD document. So this records
// EVERY event the socket produces (open, every message of every type, close,
// error) and filters afterwards. A recorder that kept only `livedata` would, if
// that name is wrong, record zero frames and read as "no data".
//
// WHICH EVENT: a live row of /bsd/events/live with BOTH `live_websocket === true`
// and `websocket_plus === true`. They are two flags, and the first run of
// bsd-fanout-live-verify.yml (2026-10-28, event 601989) showed that the second
// alone is not enough: that row had websocket_plus true and live_websocket FALSE,
// the relay subscribed to it and received no frame in 150 s, while every match that
// delivered frames had live_websocket true. `live_websocket` is whether BSD streams
// the match at all; `websocket_plus` is the tracking tier. Without the tier a match
// carries no tracking (scripts/bsd-contract-verify.mjs, 588245), so a match without
// either flag could only prove nothing.
//
// SAMPLE-COVERAGE-A (field-relay-nba/CLAUDE.md Rule 91): the output states how
// many frames, over how many seconds, from how many events. This is ONE match;
// the verdict is about this match's tier, not about every match.

import { writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { total } from './lib/summary-invariants.mjs'

export const WS_BASE = 'wss://sports.bzzoiro.com/ws/live/'
export const LIVE_URL = process.env.RELAY_URL
  ? `${process.env.RELAY_URL}/bsd/events/live`
  : 'https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/live'

export const DURATION_MS = 10 * 60 * 1000   // CC-CMD: "at least 60 frames, or 10 minutes"
export const MIN_FRAMES = 60
export const HARD_CAP_MS = 20 * 60 * 1000   // never hold the runner past this once connected
export const MAX_RECONNECTS = 5
export const RECONNECT_PAUSE_MS = 5000
export const RAW_BYTES_CAP = 6 * 1024 * 1024

// CC-CMD done condition 3's identifier list. `ID_KEY_SEEN` below also reports every
// key an element carries, so an identifier under another name stays visible.
export const ID_KEYS = ['player_id', 'pid', 'id', 'team', 'side', 'home']
export const RESTART_RE = /throw[\s_-]?in|goal[\s_-]?kick|free[\s_-]?kick|corner|foul/i

// --- choosing the event ------------------------------------------------------

/** First live row that carries the tracking tier. A row between halves is taken
 *  only when nothing is in play: frames are expected when play resumes, but a
 *  playing match is the better bet. */
export const pickEvent = (rows, leagueIds = []) => {
  const eligible = (Array.isArray(rows) ? rows : []).filter(
    (r) => r && r.live_websocket === true && r.websocket_plus === true && r.status === 'inprogress' && r.id != null &&
      (leagueIds.length === 0 || leagueIds.includes(Number(r.league_id))))
  return eligible.find((r) => r.period !== 'halftime') ?? eligible[0] ?? null
}

// --- redaction: the token never reaches an artifact or a log ------------------

export const redact = (text, token) =>
  token ? String(text).split(token).join('***') : String(text)

// --- the analysis, a pure function of the recorded frames --------------------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const bump = (m, k, n = 1) => { m[k] = (m[k] ?? 0) + n }

const walkStrings = (v, path, out) => {
  if (typeof v === 'string') { out.push([path, v]); return }
  if (Array.isArray(v)) { v.forEach((x, i) => walkStrings(x, `${path}[]`, out)); return }
  if (isObj(v)) for (const k of Object.keys(v)) walkStrings(v[k], path ? `${path}.${k}` : k, out)
}

/**
 * frames: [{ t, raw }] — `raw` is the message text exactly as received.
 * Returns the done-condition facts 1-5 and the verdict.
 */
export const analyze = (frames) => {
  const parsed = []
  let unparseable = 0
  for (const f of frames) {
    try { parsed.push({ t: f.t, o: JSON.parse(f.raw) }) } catch { unparseable++ }
  }
  const objs = parsed.filter((p) => isObj(p.o))

  // 1. key union and counts by frame.type
  const keyUnion = {}
  const byType = {}
  for (const { o } of objs) {
    for (const k of Object.keys(o)) bump(keyUnion, k)
    bump(byType, typeof o.type === 'string' ? o.type : '<no type>')
  }

  // The subscribe ack is `{type:'subscribed', event, livedata:[...], odds}` (seen
  // 2026-10-28, run 40619254199): the backlog of livedata frames rides INSIDE it, so
  // a coordinate analysis of top-level frames alone would call a populated backlog
  // empty. Each element is analysed as a frame of its own, and counted as such.
  const subscribedLivedata = {}
  const units = []
  for (const { o } of objs) {
    units.push(o)
    if (o.type === 'subscribed' && Array.isArray(o.livedata)) {
      bump(subscribedLivedata, String(o.livedata.length))
      for (const el of o.livedata) if (isObj(el)) units.push(el)
    }
  }

  // 2. frame.coordinates: shape and length distribution
  const coord = { absent: 0, array: 0, object: 0, other: 0, lengths: {} }
  // 3. coordinate element keys and identifier keys
  const elementKeys = {}
  const elementKinds = {}
  const idKeySeen = {}
  // 4. distinct identifiers per uts
  const idsByUts = new Map()
  let multiPointFrames = 0
  let maxElements = 0
  for (const o of units) {
    if (!('coordinates' in o)) { coord.absent++; continue }
    const c = o.coordinates
    let elements
    if (Array.isArray(c)) { coord.array++; bump(coord.lengths, String(c.length)); elements = c }
    else if (isObj(c)) { coord.object++; elements = [c] }
    else { coord.other++; continue }
    maxElements = Math.max(maxElements, elements.length)
    if (elements.length > 1) multiPointFrames++
    const ids = new Set()
    for (const el of elements) {
      if (isObj(el)) {
        bump(elementKinds, 'object')
        for (const k of Object.keys(el)) {
          bump(elementKeys, k)
          if (ID_KEYS.includes(k) && el[k] !== null && el[k] !== undefined) {
            bump(idKeySeen, k)
            ids.add(`${k}=${JSON.stringify(el[k])}`)
          }
        }
      } else {
        bump(elementKinds, Array.isArray(el) ? 'array' : typeof el)
      }
    }
    const uts = o.uts ?? '<no uts>'
    const set = idsByUts.get(uts) ?? new Set()
    for (const id of ids) set.add(id)
    idsByUts.set(uts, set)
  }
  const idsPerUts = {}
  let maxIdsAtOneUts = 0
  for (const set of idsByUts.values()) {
    bump(idsPerUts, String(set.size))
    maxIdsAtOneUts = Math.max(maxIdsAtOneUts, set.size)
  }

  // 5a. restart events: any frame.type or STRING VALUE naming one (keys do not count:
  //     a stats key `corners` is a count, not an event)
  const restarts = {}
  for (const { o } of objs) {
    const strings = []
    walkStrings(o, '', strings)
    for (const [path, value] of strings) {
      if (RESTART_RE.test(value)) bump(restarts, `${path} = ${value.slice(0, 60)}`)
    }
  }

  // 5b. clock grain of frame.uts
  const utsVals = units.map((o) => o.uts).filter((u) => typeof u === 'number' && Number.isFinite(u))
  const sorted = [...new Set(utsVals)].sort((a, b) => a - b)
  let minStep = null
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i] - sorted[i - 1]
    if (minStep === null || d < minStep) minStep = d
  }
  const magnitude = sorted.length === 0 ? null
    : sorted[sorted.length - 1] >= 1e12 ? 'epoch milliseconds'
      : sorted[sorted.length - 1] >= 1e9 ? 'epoch seconds'
        : 'smaller than an epoch (a match clock or counter — unit not established by magnitude)'
  const utsNonNumber = units.filter((o) => 'uts' in o && typeof o.uts !== 'number').length

  // 5c. restart COUNTERS. The `event` frames carry cumulative per-team stats whose
  //     KEYS name restarts (throw_ins, free_kicks, goal_kicks, corner_kicks, fouls):
  //     a count that moves between frames, not a typed event with a clock. The keys
  //     matching RESTART_RE are reported with first/last value and when they moved.
  const restartCounters = {}
  for (const { t, o } of objs) {
    const ev = o.type === 'subscribed' && isObj(o.event) ? o.event : o
    if (!isObj(ev?.stats)) continue
    for (const side of ['home', 'away']) {
      const st = ev.stats[side]
      if (!isObj(st)) continue
      for (const k of Object.keys(st)) {
        if (!RESTART_RE.test(k) || typeof st[k] !== 'number') continue
        const c = restartCounters[`${side}.${k}`] ??= { first: st[k], last: st[k], changes: 0, changedAtMs: [] }
        if (st[k] !== c.last) { c.changes++; c.changedAtMs.push(t); c.last = st[k] }
      }
    }
  }

  // 5d. what the server says it is ingesting. `ingest_debug` frames carry
  //     raw_count / sent_count / last_seen_uts: zero throughout a live half is
  //     evidence that no livedata exists upstream, whatever the tier flag says.
  const dbg = objs.map((p) => p.o).filter((o) => o.type === 'ingest_debug')
  // Each pull repeats the items it still sees, so counts are the MAX seen in one
  // pull, never a sum across pulls.
  const maxPerPull = (field) => {
    const out = {}
    for (const o of dbg) {
      if (!isObj(o[field])) continue
      for (const [k, v] of Object.entries(o[field])) out[k] = Math.max(out[k] ?? 0, typeof v === 'number' ? v : 1)
    }
    return out
  }
  // A frame missing `raw_count` is a finding about the frame, never a zero: total()
  // sums only numbers and reports how many frames were skipped.
  const rawTotal = total(dbg, 'raw_count')
  const sentTotal = total(dbg, 'sent_count')
  const ingestDebug = {
    frames: dbg.length,
    rawCountSum: rawTotal.sum,
    rawCountFramesWithoutNumber: rawTotal.skipped,
    sentCountSum: sentTotal.sum,
    sentCountFramesWithoutNumber: sentTotal.skipped,
    advancedTrue: dbg.filter((o) => o.advanced_uts === true).length,
    lastSeenUts: [...new Set(dbg.map((o) => o.last_seen_uts))].slice(0, 5),
    pulledAtSecondsEpoch: dbg.length && dbg.every((o) => o.pulled_at >= 1e9 && o.pulled_at < 1e11),
    typeBreakdownNonEmpty: dbg.filter((o) => isObj(o.type_breakdown) && Object.keys(o.type_breakdown).length).length,
    incidentTypesSeenMaxPerPull: maxPerPull('type_breakdown'),
    dropReasonsSeenMaxPerPull: maxPerPull('drop_breakdown'),
  }

  // 5e. what the livedata frames ARE, by `situation`, and what the event frames call
  //     the period (a field that changes type between frames is a contract fact).
  const situations = {}
  for (const o of units) if (o.type === 'livedata') bump(situations, typeof o.situation === 'string' ? o.situation : '<no situation>')
  const eventTimePeriodValues = {}
  for (const { o } of objs) if (o.type === 'event' && isObj(o.time)) bump(eventTimePeriodValues, JSON.stringify(o.time.period))
  const livedataTimeSecondValues = {}
  for (const o of units) if (o.type === 'livedata' && isObj(o.time)) bump(livedataTimeSecondValues, JSON.stringify(o.time.second))

  let verdict
  if (frames.length === 0) verdict = 'NO-FRAMES'
  else if (coord.array + coord.object === 0) verdict = 'NO-COORDINATE-FRAMES'
  // `coordinates: []` on every frame (seen 2026-10-28, six livedata frames) has no
  // element to be identified or anonymous, so it supports neither the off-ball
  // reading nor the ball-trail reading; it is its own verdict.
  else if (maxElements === 0) verdict = 'COORDINATES-EMPTY'
  else if (maxIdsAtOneUts >= 2) verdict = 'OFF-BALL-INSTANT'
  else if (Object.keys(idKeySeen).length === 0) verdict = 'IDENTIFIER-LESS'
  else verdict = 'IDENTIFIED-BUT-ONE-PER-UTS'

  return {
    frames: frames.length,
    parsedObjects: objs.length,
    unparseable,
    keyUnion,
    byType,
    subscribedLivedataLengths: subscribedLivedata,
    coordinates: { ...coord, maxElements, multiPointFrames },
    elementKinds,
    elementKeys,
    identifierKeysSeen: idKeySeen,
    distinctIdentifiersPerUts: { distribution: idsPerUts, max: maxIdsAtOneUts, utsGroups: idsByUts.size },
    restartEvents: restarts,
    restartCounters,
    ingestDebug,
    livedataSituations: situations,
    livedataTimeSecondValues,
    eventTimePeriodValues,
    utsClock: {
      numericFrames: utsVals.length, nonNumeric: utsNonNumber, distinctValues: sorted.length,
      magnitude, smallestNonzeroStep: minStep, sample: sorted.slice(0, 5),
    },
    verdict,
  }
}

// --- the recorder, against an injected WebSocket constructor -----------------

/**
 * Records everything the socket does. Resolves with { events, frames, ended }.
 * `now` and `WS` are injected so the self-test runs with no network and no clock.
 */
export const capture = ({ WS, url, eventId, durationMs = DURATION_MS, minFrames = MIN_FRAMES,
  hardCapMs = HARD_CAP_MS, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  token = '', maxReconnects = MAX_RECONNECTS, reconnectPauseMs = RECONNECT_PAUSE_MS }) => new Promise((resolve) => {
  const t0 = now()
  const events = []
  const frames = []
  let rawBytes = 0
  let rawDropped = 0
  let done = false
  const pollRef = { t: null }
  const log = (kind, extra = {}) => events.push({ t: now() - t0, kind, ...extra })
  const finish = (ended) => {
    if (done) return
    done = true
    clearTimer(pollRef.t)
    try { ws.close() } catch { /* already closed */ }
    resolve({ events, frames, ended, rawDropped, reconnects, seconds: Math.round((now() - t0) / 100) / 10 })
  }
  let ws
  let reconnects = 0
  const connect = () => {
  if (done) return
  try {
    ws = new WS(url)
  } catch (e) {
    log('error', { message: redact(e.message, token) })
    finish('constructor-threw')
    return
  }
  ws.binaryType = 'arraybuffer'
  ws.addEventListener('open', () => {
    log('open')
    const msg = JSON.stringify({ action: 'subscribe', event_id: Number(eventId) })
    ws.send(msg)
    log('sent', { raw: msg })
  })
  ws.addEventListener('message', (evt) => {
    const d = evt.data
    const raw = typeof d === 'string' ? d
      : `<binary ${d?.byteLength ?? '?'} bytes base64:${Buffer.from(d).toString('base64')}>`
    rawBytes += raw.length
    // The analysis keeps every frame; only the stored copy is bounded, and the
    // count of frames not stored is reported, never implied.
    if (rawBytes > RAW_BYTES_CAP) rawDropped++
    frames.push({ t: now() - t0, raw: rawBytes > RAW_BYTES_CAP ? raw.slice(0, 200) : raw })
  })
  ws.addEventListener('close', (evt) => {
    if (done) return
    log('close', { code: evt?.code, reason: redact(evt?.reason ?? '', token) })
    // An abnormal close mid-match (1006 after 109 s, run 40619254199) is recorded and
    // the recorder subscribes again, as the relay's own handler does; every close and
    // every reconnect is in the event log, and the count is bounded.
    if (reconnects < maxReconnects && now() - t0 < hardCapMs) {
      reconnects++
      log('reconnect', { attempt: reconnects })
      setTimer(connect, reconnectPauseMs)
      return
    }
    finish('socket-closed')
  })
  ws.addEventListener('error', (evt) => {
    log('error', { message: redact(evt?.message ?? evt?.error?.message ?? 'websocket error', token) })
  })
  }
  connect()
  pollRef.t = setTimer(function tick() {
    if (done) return
    const elapsed = now() - t0
    if (elapsed >= hardCapMs) return finish('hard-cap')
    if (elapsed >= durationMs && frames.length >= minFrames) return finish('duration-and-frames')
    pollRef.t = setTimer(tick, 1000)
  }, 1000)
})

/** The CC-CMD's floor is "at least 60 frames, or 10 minutes"; a socket that closed
 *  early, or a capture the hard cap ended, did not meet it however many frames it
 *  holds. Only a capture that ran its full duration with the frame floor met is
 *  `captured`; zero frames is `protocol-failed`; anything else is `incomplete` and
 *  says why in `ended`. */
export const stateOf = ({ ended, frames }) => {
  if (frames.length === 0) return 'protocol-failed'
  return ended === 'duration-and-frames' ? 'captured' : 'incomplete'
}

// --- the run -----------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const waitForEvent = async (waitMs, leagueIds = [], fetchImpl = fetch) => {
  const deadline = Date.now() + waitMs
  let polls = 0
  let lastRows = []
  for (;;) {
    polls++
    try {
      const r = await fetchImpl(LIVE_URL)
      if (r.ok) {
        const body = await r.json()
        // A feed with no `events` array is a failed poll, not an empty slate.
        if (!Array.isArray(body?.events)) throw new Error('live feed has no events array')
        lastRows = body.events
        const pick = pickEvent(lastRows, leagueIds)
        if (pick) return { event: pick, polls, liveRows: lastRows.length }
      }
    } catch (e) {
      console.log(`  live poll ${polls} failed: ${e.message}`)
    }
    if (Date.now() + 30_000 > deadline) return { event: null, polls, liveRows: lastRows.length }
    await sleep(30_000)
  }
}

/** Rebuild a committed artifact's analysis from its own raw file with the current
 *  analyzer. The recorded frames are the evidence; the analysis is a pure function
 *  of them, so a better analyzer can be applied without a second match. */
export const reanalyze = async (artifactPath) => {
  const { readFileSync } = await import('node:fs')
  const art = JSON.parse(readFileSync(artifactPath, 'utf8'))
  const lines = readFileSync(art.rawFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const frames = lines.filter((l) => l.raw !== undefined)
  art.analysis = analyze(frames)
  art.verdict = art.analysis.verdict
  art.state = stateOf({ ended: art.ended, frames })
  art.reanalyzedWith = 'scripts/bsd-ws-capture.mjs analyze() at the commit that wrote this line'
  writeFileSync(artifactPath, JSON.stringify(art, null, 2) + '\n')
  console.log(`reanalyzed ${art.rawFile}: ${frames.length} frames, state ${art.state}, verdict ${art.verdict}`)
}

const main = async () => {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`)
    return i > -1 ? process.argv[i + 1] : dflt
  }
  const waitMs = Number(arg('wait-minutes', '5')) * 60_000
  const durationMs = Number(arg('duration-minutes', '10')) * 60_000
  const token = process.env.BSD_API_TOKEN
  if (!token) { console.error('BSD_API_TOKEN is not set'); process.exit(2) }
  console.log(`::add-mask::${token}`)
  if (typeof WebSocket !== 'function') { console.error('no global WebSocket in this Node'); process.exit(2) }

  mkdirSync('outbox', { recursive: true })
  const startedAt = new Date().toISOString()
  const leagueIds = String(arg('league-ids', '')).split(',').map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0)
  const { event, polls, liveRows } = await waitForEvent(waitMs, leagueIds)
  const base = { startedAt, polls, liveRowsOnLastPoll: liveRows, leagueIdFilter: leagueIds.length ? leagueIds : null }
  if (!event) {
    const out = { ...base, state: 'no-qualifying-event',
      note: `no live row with websocket_plus === true and status 'inprogress' in ${polls} polls over ${waitMs / 60000} min` }
    writeFileSync('outbox/bsd-ws-frame-shape-latest.json', JSON.stringify(out, null, 2) + '\n')
    console.log(`state: ${out.state} — ${out.note}`)
    process.exit(3)
  }
  console.log(`event ${event.id}: ${event.home_team} v ${event.away_team} (${event.league_name}), ` +
    `period ${event.period}, minute ${event.current_minute}, websocket_plus ${event.websocket_plus}`)

  const url = `${WS_BASE}?token=${token}`
  const res = await capture({ WS: WebSocket, url, eventId: event.id, durationMs, token })
  const analysis = analyze(res.frames)

  const stamp = startedAt.replace(/[:.]/g, '-')
  const rawName = `outbox/bsd-ws-frames-${event.id}-${stamp}.jsonl`
  writeFileSync(rawName, [
    ...res.events.map((e) => JSON.stringify({ socketEvent: e })),
    ...res.frames.map((f) => JSON.stringify({ t: f.t, raw: f.raw })),
  ].map((l) => redact(l, token)).join('\n') + '\n')

  const state = stateOf(res)
  const out = {
    ...base, state, verdict: analysis.verdict,
    coverage: `${res.frames.length} frames over ${res.seconds} s from 1 event (${event.id}, ${event.league_name}); ` +
      'the verdict describes this match on this tier, not every match',
    event: {
      id: event.id, league_id: event.league_id, league_name: event.league_name,
      home_team: event.home_team, away_team: event.away_team, status: event.status,
      period: event.period, current_minute: event.current_minute,
      live_websocket: event.live_websocket, websocket_plus: event.websocket_plus,
    },
    ended: res.ended, reconnects: res.reconnects, rawFile: rawName, rawFramesNotStoredInFull: res.rawDropped,
    socketEvents: res.events.map((e) => JSON.parse(redact(JSON.stringify(e), token))),
    analysis,
  }
  writeFileSync('outbox/bsd-ws-frame-shape-latest.json', redact(JSON.stringify(out, null, 2), token) + '\n')
  console.log(`state: ${state}; verdict: ${analysis.verdict}; ${out.coverage}`)
  console.log(`types: ${JSON.stringify(analysis.byType)}`)
  process.exit(state === 'captured' ? 0 : 4)
}

// --- self-test ---------------------------------------------------------------

const selfTest = async () => {
  let fail = 0
  const ok = (name, cond, detail = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`)
    if (!cond) fail++
  }
  const fr = (o, t = 0) => ({ t, raw: typeof o === 'string' ? o : JSON.stringify(o) })

  // pickEvent
  const rows = [
    { id: 1, live_websocket: true, websocket_plus: false, status: 'inprogress', period: '1st_half' },
    { id: 2, live_websocket: true, websocket_plus: true, status: 'inprogress', period: 'halftime' },
    { id: 3, live_websocket: true, websocket_plus: true, status: 'inprogress', period: '2nd_half' },
    { id: 4, live_websocket: true, websocket_plus: true, status: 'finished', period: 'ended' },
    { id: 5, live_websocket: false, websocket_plus: true, status: 'inprogress', period: '2nd_half' },
  ]
  ok('pickEvent skips a row with websocket_plus true and live_websocket FALSE (601989: the relay got no frame)',
    pickEvent([rows[4]]) === null && pickEvent([rows[4], rows[2]])?.id === 3, `got ${pickEvent([rows[4]])?.id}`)
  ok('pickEvent skips websocket_plus:false and finished, prefers a match in play',
    pickEvent(rows)?.id === 3, `got ${pickEvent(rows)?.id}`)
  ok('pickEvent takes a halftime row when nothing is in play',
    pickEvent(rows.filter((r) => r.id === 2))?.id === 2)
  ok('pickEvent refuses a feed with no websocket_plus event',
    pickEvent(rows.filter((r) => r.id === 1 || r.id === 4)) === null)
  ok('pickEvent tolerates a non-array', pickEvent(null) === null)
  const lg = [{ id: 10, league_id: 80, live_websocket: true, websocket_plus: true, status: 'inprogress', period: '2nd_half' },
    { id: 11, league_id: 7, live_websocket: true, websocket_plus: true, status: 'inprogress', period: '2nd_half' }]
  ok('pickEvent with a league filter takes only a listed league', pickEvent(lg, [7, 8])?.id === 11, `got ${pickEvent(lg, [7, 8])?.id}`)
  ok('pickEvent with a league filter and no listed league in play returns null', pickEvent(lg, [1]) === null)
  ok('pickEvent with no filter takes the first eligible row', pickEvent(lg, [])?.id === 10)

  // the live poll: a feed without an events array is a FAILED poll, said so, not an empty slate
  const logged = []
  const realLog = console.log
  console.log = (...a) => logged.push(a.join(' '))
  const noEvents = await waitForEvent(1000, [], async () => ({ ok: true, json: async () => ({}) }))
  const goodFeed = await waitForEvent(1000, [], async () => ({ ok: true, json: async () => ({ events: [
    { id: 9, league_id: 1, live_websocket: true, websocket_plus: true, status: 'inprogress', period: '1st_half' }] }) }))
  console.log = realLog
  ok('a live feed with no events array is reported as a failed poll', noEvents.event === null &&
    logged.some((l) => l.includes('no events array')), JSON.stringify(logged))
  ok('a live feed with a qualifying row returns it', goodFeed.event?.id === 9 && goodFeed.polls === 1, JSON.stringify(goodFeed))

  // verdicts
  const trail = analyze([
    fr({ type: 'livedata', uts: 100, coordinates: [{ x: 1, y: 2 }, { x: 2, y: 3 }] }),
    fr({ type: 'livedata', uts: 105, coordinates: [{ x: 3, y: 4 }] }),
  ])
  ok('identifier-less multi-point frames read IDENTIFIER-LESS, not off-ball',
    trail.verdict === 'IDENTIFIER-LESS' && trail.coordinates.multiPointFrames === 1 &&
    trail.coordinates.lengths['2'] === 1 && trail.coordinates.lengths['1'] === 1, JSON.stringify(trail.verdict))
  const identified = analyze([
    fr({ type: 'livedata', uts: 100, coordinates: [{ player_id: 7, x: 1, y: 2 }, { player_id: 9, x: 5, y: 5 }] }),
  ])
  ok('two identified coordinates at one uts read OFF-BALL-INSTANT',
    identified.verdict === 'OFF-BALL-INSTANT' && identified.distinctIdentifiersPerUts.max === 2,
    identified.verdict)
  const oneEach = analyze([
    fr({ type: 'livedata', uts: 100, coordinates: [{ player_id: 7, x: 1, y: 2 }] }),
    fr({ type: 'livedata', uts: 105, coordinates: [{ player_id: 9, x: 5, y: 5 }] }),
  ])
  ok('identifiers are counted per uts, not across the whole capture',
    oneEach.verdict === 'IDENTIFIED-BUT-ONE-PER-UTS' && oneEach.distinctIdentifiersPerUts.max === 1,
    oneEach.verdict)
  const split = analyze([
    fr({ type: 'livedata', uts: 100, coordinates: [{ player_id: 7, x: 1, y: 2 }] }),
    fr({ type: 'livedata', uts: 100, coordinates: [{ player_id: 9, x: 5, y: 5 }] }),
  ])
  ok('two frames sharing one uts pool their identifiers', split.verdict === 'OFF-BALL-INSTANT', split.verdict)
  ok('no frames reads NO-FRAMES', analyze([]).verdict === 'NO-FRAMES')
  const stats = analyze([fr({ type: 'event', minute: 4, stats: { corners: 3 } })])
  ok('only non-coordinate frames read NO-COORDINATE-FRAMES', stats.verdict === 'NO-COORDINATE-FRAMES')
  ok('a bare-object coordinates field is read as one element',
    analyze([fr({ type: 'livedata', uts: 1, coordinates: { x: 1, y: 2 } })]).coordinates.object === 1)
  const junk = analyze([fr('not json'), fr('[1,2]'), fr({ type: 'livedata', uts: 1, coordinates: [] })])
  ok('unparseable and non-object frames are counted, not fatal',
    junk.unparseable === 1 && junk.parsedObjects === 1 && junk.coordinates.lengths['0'] === 1, JSON.stringify(junk.coordinates))

  // restart events: values count, keys do not
  const rs = analyze([
    fr({ type: 'throw_in', uts: 1 }),
    fr({ type: 'event', incidents: [{ type: 'Goal Kick' }, { kind: 'corner' }], stats: { corners: 3 } }),
  ])
  ok('restart events are found in frame.type and in nested values',
    rs.restartEvents['type = throw_in'] === 1 && rs.restartEvents['incidents[].type = Goal Kick'] === 1 &&
    rs.restartEvents['incidents[].kind = corner'] === 1, JSON.stringify(rs.restartEvents))
  ok('a stats KEY named corners is not a restart event',
    Object.keys(rs.restartEvents).every((k) => !k.startsWith('stats')), JSON.stringify(rs.restartEvents))

  // clock grain
  const clk = analyze([
    fr({ type: 'livedata', uts: 1790000000000 }), fr({ type: 'livedata', uts: 1790000005000 }),
    fr({ type: 'livedata', uts: 1790000005000 }), fr({ type: 'livedata', uts: 1790000007500 }),
  ])
  ok('uts unit and smallest nonzero step are read from the values',
    clk.utsClock.magnitude === 'epoch milliseconds' && clk.utsClock.smallestNonzeroStep === 2500 &&
    clk.utsClock.distinctValues === 3, JSON.stringify(clk.utsClock))
  ok('epoch-seconds magnitude is distinguished',
    analyze([fr({ type: 'x', uts: 1790000000 })]).utsClock.magnitude === 'epoch seconds')

  // capture, against a stub socket
  const sentMessages = []
  const makeWS = (script) => class {
    constructor(u) { this.url = u; this.l = {}; setImmediate(() => script(this)) }
    addEventListener(k, f) { (this.l[k] ??= []).push(f) }
    emit(k, e) { (this.l[k] ?? []).forEach((f) => f(e)) }
    send(m) { sentMessages.push(m) }
    close() {}
  }
  let clock = 0
  const fakeNow = () => clock
  const timers = []
  const setT = (f) => { timers.push(f); return timers.length }
  const clearT = () => {}
  const pump = async (n) => { for (let i = 0; i < n; i++) { clock += 1000; const f = timers.shift(); if (f) f() ; await new Promise((r) => setImmediate(r)) } }

  const TOKEN = 'sekret-token-123'
  const WS1 = makeWS((s) => {
    s.emit('open', {})
    s.emit('message', { data: JSON.stringify({ type: 'hello', note: `token ${TOKEN}` }) })
    for (let i = 0; i < 3; i++) s.emit('message', { data: JSON.stringify({ type: 'livedata', uts: i, coordinates: [{ x: i, y: i }] }) })
    s.emit('message', { data: new Uint8Array([1, 2, 3]).buffer })
  })
  const p1 = capture({ WS: WS1, url: `wss://x/?token=${TOKEN}`, eventId: '602466', durationMs: 3000, minFrames: 2,
    hardCapMs: 60000, now: fakeNow, setTimer: setT, clearTimer: clearT, token: TOKEN })
  await new Promise((r) => setImmediate(r))
  await pump(8)
  const r1 = await p1
  ok('capture sends the subscribe message verbatim',
    sentMessages[0] === '{"action":"subscribe","event_id":602466}', sentMessages[0])
  ok('capture records every frame including a non-livedata type and a binary frame',
    r1.frames.length === 5 && r1.frames[0].raw.includes('hello') && r1.frames[4].raw.startsWith('<binary 3 bytes'),
    JSON.stringify(r1.frames.map((f) => f.raw.slice(0, 20))))
  ok('capture ends on duration once the frame floor is met', r1.ended === 'duration-and-frames', r1.ended)

  // the hard cap ends a silent socket, and says so
  const WS2 = makeWS((s) => s.emit('open', {}))
  const p2 = capture({ WS: WS2, url: 'wss://x/', eventId: 1, durationMs: 2000, minFrames: 60, hardCapMs: 5000,
    now: fakeNow, setTimer: setT, clearTimer: clearT, token: TOKEN })
  await new Promise((r) => setImmediate(r))
  await pump(10)
  const r2 = await p2
  ok('a socket that stays silent ends at the hard cap with zero frames',
    r2.ended === 'hard-cap' && r2.frames.length === 0, `${r2.ended} ${r2.frames.length}`)
  ok('zero frames reads NO-FRAMES', analyze(r2.frames).verdict === 'NO-FRAMES')

  // an error and close are recorded, and the token is redacted from them
  const WS3 = makeWS((s) => { s.emit('error', { message: `failed ${TOKEN}` }); s.emit('close', { code: 1006, reason: `bye ${TOKEN}` }) })
  const r3 = await capture({ WS: WS3, url: 'wss://x/', eventId: 1, now: fakeNow, setTimer: setT, clearTimer: clearT, token: TOKEN, maxReconnects: 0 })
  const dump = JSON.stringify(r3.events)
  ok('error and close events are recorded with the token redacted',
    r3.ended === 'socket-closed' && dump.includes('1006') && !dump.includes(TOKEN) && dump.includes('***'), dump)
  ok('a socket error is recorded with its message redacted',
    r3.events.some((e) => e.kind === 'error' && e.message === 'failed ***'), dump)
  ok('redact removes every occurrence', redact(`a ${TOKEN} b ${TOKEN}`, TOKEN) === 'a *** b ***')

  // an abnormal close mid-match: recorded, then subscribed again, frames from both sockets kept
  sentMessages.length = 0
  let opened = 0
  const WS4 = makeWS((s) => {
    opened++
    s.emit('open', {})
    if (opened === 1) s.emit('close', { code: 1006, reason: '' })
    else for (let i = 0; i < 3; i++) s.emit('message', { data: JSON.stringify({ type: 'event', n: i }) })
  })
  const p4 = capture({ WS: WS4, url: 'wss://x/', eventId: 5, durationMs: 4000, minFrames: 2, hardCapMs: 60000,
    now: fakeNow, setTimer: setT, clearTimer: clearT, token: TOKEN, maxReconnects: 2, reconnectPauseMs: 1000 })
  await new Promise((r) => setImmediate(r))
  await pump(12)
  const r4 = await p4
  ok('a 1006 close is recorded and the recorder subscribes again',
    opened === 2 && sentMessages.length === 2 && r4.reconnects === 1 &&
    r4.events.some((e) => e.kind === 'close' && e.code === 1006) && r4.events.some((e) => e.kind === 'reconnect'),
    JSON.stringify({ opened, sent: sentMessages.length, ev: r4.events.map((e) => e.kind) }))
  ok('frames from the socket after the reconnect are kept', r4.frames.length === 3 && r4.ended === 'duration-and-frames',
    `${r4.frames.length} ${r4.ended}`)
  // the shape seen on the wire: a livedata frame is an incident with an empty coordinates array
  const inc = analyze([
    fr({ type: 'livedata', uts: 1793153961, side: 'away', situation: 'freekick', time: { minute: 45, second: 0 }, coordinates: [], commentary: 'x' }),
    fr({ type: 'livedata', uts: 1793153989, side: 'home', situation: 'corner', time: { minute: 47, second: 0 }, coordinates: [], commentary: 'y' }),
    fr({ type: 'event', time: { period: '2T', minute: 48 }, stats: {} }),
    fr({ type: 'event', time: { period: 2, minute: 48 }, stats: {} }),
  ])
  ok('empty coordinate arrays read COORDINATES-EMPTY, not a ball trail',
    inc.verdict === 'COORDINATES-EMPTY' && inc.coordinates.array === 2 && inc.coordinates.maxElements === 0, inc.verdict)
  ok('livedata situations are counted and the uts step is read', inc.livedataSituations.freekick === 1 &&
    inc.livedataSituations.corner === 1 && inc.utsClock.smallestNonzeroStep === 28 && inc.utsClock.magnitude === 'epoch seconds')
  ok('an event period that changes type between frames is visible',
    inc.eventTimePeriodValues['"2T"'] === 1 && inc.eventTimePeriodValues['2'] === 1, JSON.stringify(inc.eventTimePeriodValues))
  ok('livedata time.second values are reported', inc.livedataTimeSecondValues['0'] === 2)
  const dbgs = analyze([
    fr({ type: 'ingest_debug', raw_count: 2, sent_count: 0, last_seen_uts: 1, pulled_at: 1793153555, type_breakdown: { periodstart: 2 }, drop_breakdown: { duplicate: 2 }, advanced_uts: false }),
    fr({ type: 'ingest_debug', raw_count: 2, sent_count: 0, last_seen_uts: 1, pulled_at: 1793153557, type_breakdown: { periodstart: 2 }, drop_breakdown: { duplicate: 2 }, advanced_uts: false }),
    fr({ type: 'ingest_debug', raw_count: 1, sent_count: 1, last_seen_uts: 2, pulled_at: 1793153559, type_breakdown: { corner: 1 }, drop_breakdown: {}, advanced_uts: true }),
  ])
  ok('incident types and drop reasons are the max in one pull, not a sum over repeated pulls',
    dbgs.ingestDebug.incidentTypesSeenMaxPerPull.periodstart === 2 && dbgs.ingestDebug.incidentTypesSeenMaxPerPull.corner === 1 &&
    dbgs.ingestDebug.dropReasonsSeenMaxPerPull.duplicate === 2 && dbgs.ingestDebug.sentCountSum === 1, JSON.stringify(dbgs.ingestDebug))

  const WS5 = makeWS((s) => { s.emit('open', {}); s.emit('close', { code: 1006, reason: '' }) })
  const p5 = capture({ WS: WS5, url: 'wss://x/', eventId: 5, durationMs: 4000, minFrames: 2, hardCapMs: 60000,
    now: fakeNow, setTimer: setT, clearTimer: clearT, token: TOKEN, maxReconnects: 1, reconnectPauseMs: 1000 })
  await new Promise((r) => setImmediate(r))
  await pump(8)
  const r5 = await p5
  ok('reconnects are bounded: a socket that always closes ends as socket-closed',
    r5.ended === 'socket-closed' && r5.reconnects === 1, `${r5.ended} ${r5.reconnects}`)

  // reanalysis rebuilds analysis, verdict and state from the artifact's own raw file
  const { mkdtempSync, writeFileSync: wf, readFileSync: rf } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(`${tmpdir()}/bsd-ws-`)
  const rawPath = `${dir}/raw.jsonl`
  wf(rawPath, [
    JSON.stringify({ socketEvent: { t: 0, kind: 'open' } }),
    JSON.stringify({ t: 1, raw: JSON.stringify({ type: 'livedata', uts: 1793153961, situation: 'corner', coordinates: [] }) }),
    JSON.stringify({ t: 2, raw: JSON.stringify({ type: 'event', time: { period: '2T' } }) }),
  ].join('\n') + '\n')
  wf(`${dir}/art.json`, JSON.stringify({ rawFile: rawPath, ended: 'socket-closed', state: 'captured', verdict: 'STALE', analysis: {} }))
  await reanalyze(`${dir}/art.json`)
  const re = JSON.parse(rf(`${dir}/art.json`, 'utf8'))
  ok('reanalyze recomputes analysis, verdict and state from the raw file',
    re.analysis.frames === 2 && re.verdict === 'COORDINATES-EMPTY' && re.state === 'incomplete', JSON.stringify({ f: re.analysis.frames, v: re.verdict, s: re.state }))

  // state: only a full-duration capture with the frame floor met is `captured`
  ok('stateOf: full duration is captured', stateOf({ ended: 'duration-and-frames', frames: [1] }) === 'captured')
  ok('stateOf: a socket that closed early is incomplete, not captured',
    stateOf({ ended: 'socket-closed', frames: [1, 2, 3] }) === 'incomplete')
  ok('stateOf: the hard cap is incomplete', stateOf({ ended: 'hard-cap', frames: [1] }) === 'incomplete')
  ok('stateOf: zero frames is protocol-failed', stateOf({ ended: 'hard-cap', frames: [] }) === 'protocol-failed')

  // the shapes seen on the wire 2026-10-28 (run 40619254199)
  const sub = analyze([
    fr({ type: 'subscribed', event_id: 1, event: { stats: { home: { throw_ins: 10, corner_kicks: 3, passes: 5 }, away: { throw_ins: 4 } } },
      livedata: [{ type: 'livedata', uts: 1793152600, coordinates: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }], odds: {} }, 0),
  ])
  ok('livedata frames riding inside a subscribed ack are analysed as frames',
    sub.coordinates.array === 1 && sub.coordinates.maxElements === 2 && sub.verdict === 'IDENTIFIER-LESS' &&
    sub.subscribedLivedataLengths['1'] === 1 && sub.utsClock.magnitude === 'epoch seconds', JSON.stringify(sub.coordinates))
  ok('an EMPTY subscribed livedata backlog is not a coordinate frame',
    analyze([fr({ type: 'subscribed', event_id: 1, livedata: [] })]).verdict === 'NO-COORDINATE-FRAMES')
  const ctr = analyze([
    fr({ type: 'event', stats: { home: { throw_ins: 10, passes: 1 }, away: { free_kicks: 5, fouls: 4 } } }, 100),
    fr({ type: 'event', stats: { home: { throw_ins: 12, passes: 2 }, away: { free_kicks: 5, fouls: 6 } } }, 900),
  ])
  ok('restart counters report first, last and when they moved; non-restart keys are left out',
    ctr.restartCounters['home.throw_ins']?.first === 10 && ctr.restartCounters['home.throw_ins'].last === 12 &&
    ctr.restartCounters['home.throw_ins'].changedAtMs[0] === 900 && ctr.restartCounters['away.free_kicks'].changes === 0 &&
    ctr.restartCounters['away.fouls'].changes === 1 && !('home.passes' in ctr.restartCounters), JSON.stringify(ctr.restartCounters))
  const ing = analyze([
    fr({ type: 'ingest_debug', raw_count: 0, sent_count: 0, last_seen_uts: 5, pulled_at: 1793153369, type_breakdown: {}, advanced_uts: false }),
    fr({ type: 'ingest_debug', raw_count: 0, sent_count: 0, last_seen_uts: 5, pulled_at: 1793153371, type_breakdown: {}, advanced_uts: false }),
  ])
  ok('ingest_debug is summarised: zero ingested, uts frozen, pulled_at in epoch seconds',
    ing.ingestDebug.frames === 2 && ing.ingestDebug.rawCountSum === 0 && ing.ingestDebug.lastSeenUts.length === 1 &&
    ing.ingestDebug.advancedTrue === 0 && ing.ingestDebug.pulledAtSecondsEpoch === true, JSON.stringify(ing.ingestDebug))
  const ingMissing = analyze([
    fr({ type: 'ingest_debug', raw_count: 4, sent_count: 1, pulled_at: 1793153369 }),
    fr({ type: 'ingest_debug', sent_count: 1, pulled_at: 1793153371 }),
    fr({ type: 'ingest_debug', raw_count: 'x', pulled_at: 1793153373 }),
  ])
  ok('an ingest_debug frame without a numeric raw_count is counted as such, not summed as zero',
    ingMissing.ingestDebug.rawCountSum === 4 && ingMissing.ingestDebug.rawCountFramesWithoutNumber === 2 &&
    ingMissing.ingestDebug.sentCountSum === 2 && ingMissing.ingestDebug.sentCountFramesWithoutNumber === 1,
    JSON.stringify(ingMissing.ingestDebug))
  const ing2 = analyze([fr({ type: 'ingest_debug', raw_count: 3, sent_count: 3, last_seen_uts: 6, pulled_at: 1793153369,
    type_breakdown: { livedata: 3 }, advanced_uts: true })])
  ok('ingest_debug with data reads as ingesting', ing2.ingestDebug.rawCountSum === 3 && ing2.ingestDebug.advancedTrue === 1 &&
    ing2.ingestDebug.typeBreakdownNonEmpty === 1)

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exit(fail === 0 ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) await selfTest()
  else if (process.argv.includes('--reanalyze')) await reanalyze(process.argv[process.argv.indexOf('--reanalyze') + 1])
  else await main()
}
