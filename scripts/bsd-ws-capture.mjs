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
// WHICH EVENT: a live row of /bsd/events/live with `websocket_plus === true`.
// The tier is the whole question — `websocket_plus: false` events carry no
// tracking (scripts/bsd-contract-verify.mjs, 588245) — so a match without the
// flag could only prove nothing.
//
// SAMPLE-COVERAGE-A (field-relay-nba/CLAUDE.md Rule 91): the output states how
// many frames, over how many seconds, from how many events. This is ONE match;
// the verdict is about this match's tier, not about every match.

import { writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const WS_BASE = 'wss://sports.bzzoiro.com/ws/live/'
export const LIVE_URL = process.env.RELAY_URL
  ? `${process.env.RELAY_URL}/bsd/events/live`
  : 'https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/live'

export const DURATION_MS = 10 * 60 * 1000   // CC-CMD: "at least 60 frames, or 10 minutes"
export const MIN_FRAMES = 60
export const HARD_CAP_MS = 20 * 60 * 1000   // never hold the runner past this once connected
export const RAW_BYTES_CAP = 6 * 1024 * 1024

// CC-CMD done condition 3's identifier list. `ID_KEY_SEEN` below also reports every
// key an element carries, so an identifier under another name stays visible.
export const ID_KEYS = ['player_id', 'pid', 'id', 'team', 'side', 'home']
export const RESTART_RE = /throw[\s_-]?in|goal[\s_-]?kick|free[\s_-]?kick|corner|foul/i

// --- choosing the event ------------------------------------------------------

/** First live row that carries the tracking tier. A row between halves is taken
 *  only when nothing is in play: frames are expected when play resumes, but a
 *  playing match is the better bet. */
export const pickEvent = (rows) => {
  const eligible = (Array.isArray(rows) ? rows : []).filter(
    (r) => r && r.websocket_plus === true && r.status === 'inprogress' && r.id != null)
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
  for (const { o } of objs) {
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
  const utsVals = objs.map((p) => p.o.uts).filter((u) => typeof u === 'number' && Number.isFinite(u))
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
  const utsNonNumber = objs.filter((p) => 'uts' in p.o && typeof p.o.uts !== 'number').length

  let verdict
  if (frames.length === 0) verdict = 'NO-FRAMES'
  else if (coord.array + coord.object === 0) verdict = 'NO-COORDINATE-FRAMES'
  else if (maxIdsAtOneUts >= 2) verdict = 'OFF-BALL-INSTANT'
  else if (Object.keys(idKeySeen).length === 0) verdict = 'IDENTIFIER-LESS'
  else verdict = 'IDENTIFIED-BUT-ONE-PER-UTS'

  return {
    frames: frames.length,
    parsedObjects: objs.length,
    unparseable,
    keyUnion,
    byType,
    coordinates: { ...coord, maxElements, multiPointFrames },
    elementKinds,
    elementKeys,
    identifierKeysSeen: idKeySeen,
    distinctIdentifiersPerUts: { distribution: idsPerUts, max: maxIdsAtOneUts, utsGroups: idsByUts.size },
    restartEvents: restarts,
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
  token = '' }) => new Promise((resolve) => {
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
    resolve({ events, frames, ended, rawDropped, seconds: Math.round((now() - t0) / 100) / 10 })
  }
  let ws
  try {
    ws = new WS(url)
  } catch (e) {
    log('error', { message: redact(e.message, token) })
    resolve({ events, frames, ended: 'constructor-threw', rawDropped, seconds: 0 })
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
    log('close', { code: evt?.code, reason: redact(evt?.reason ?? '', token) })
    finish('socket-closed')
  })
  ws.addEventListener('error', (evt) => {
    log('error', { message: redact(evt?.message ?? evt?.error?.message ?? 'websocket error', token) })
  })
  pollRef.t = setTimer(function tick() {
    if (done) return
    const elapsed = now() - t0
    if (elapsed >= hardCapMs) return finish('hard-cap')
    if (elapsed >= durationMs && frames.length >= minFrames) return finish('duration-and-frames')
    pollRef.t = setTimer(tick, 1000)
  }, 1000)
})

// --- the run -----------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const waitForEvent = async (waitMs, fetchImpl = fetch) => {
  const deadline = Date.now() + waitMs
  let polls = 0
  let lastRows = []
  for (;;) {
    polls++
    try {
      const r = await fetchImpl(LIVE_URL)
      if (r.ok) {
        lastRows = (await r.json()).events ?? []
        const pick = pickEvent(lastRows)
        if (pick) return { event: pick, polls, liveRows: lastRows.length }
      }
    } catch (e) {
      console.log(`  live poll ${polls} failed: ${e.message}`)
    }
    if (Date.now() + 30_000 > deadline) return { event: null, polls, liveRows: lastRows.length }
    await sleep(30_000)
  }
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
  const { event, polls, liveRows } = await waitForEvent(waitMs)
  const base = { startedAt, polls, liveRowsOnLastPoll: liveRows }
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

  let state
  if (res.frames.length === 0) state = 'protocol-failed'
  else state = 'captured'
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
    ended: res.ended, rawFile: rawName, rawFramesNotStoredInFull: res.rawDropped,
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
    { id: 1, websocket_plus: false, status: 'inprogress', period: '1st_half' },
    { id: 2, websocket_plus: true, status: 'inprogress', period: 'halftime' },
    { id: 3, websocket_plus: true, status: 'inprogress', period: '2nd_half' },
    { id: 4, websocket_plus: true, status: 'finished', period: 'ended' },
  ]
  ok('pickEvent skips websocket_plus:false and finished, prefers a match in play',
    pickEvent(rows)?.id === 3, `got ${pickEvent(rows)?.id}`)
  ok('pickEvent takes a halftime row when nothing is in play',
    pickEvent(rows.filter((r) => r.id === 2))?.id === 2)
  ok('pickEvent refuses a feed with no websocket_plus event',
    pickEvent(rows.filter((r) => r.id === 1 || r.id === 4)) === null)
  ok('pickEvent tolerates a non-array', pickEvent(null) === null)

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
  const r3 = await capture({ WS: WS3, url: 'wss://x/', eventId: 1, now: fakeNow, setTimer: setT, clearTimer: clearT, token: TOKEN })
  const dump = JSON.stringify(r3.events)
  ok('error and close events are recorded with the token redacted',
    r3.ended === 'socket-closed' && dump.includes('1006') && !dump.includes(TOKEN) && dump.includes('***'), dump)
  ok('a socket error is recorded with its message redacted',
    r3.events.some((e) => e.kind === 'error' && e.message === 'failed ***'), dump)
  ok('redact removes every occurrence', redact(`a ${TOKEN} b ${TOKEN}`, TOKEN) === 'a *** b ***')

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
  process.exit(fail === 0 ? 0 : 1)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) await selfTest()
  else await main()
}
