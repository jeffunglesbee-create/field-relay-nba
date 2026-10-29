#!/usr/bin/env node
// docs/CC-CMD-2026-10-28-bsd-ws-fanout-field-names.md, done condition 2, end to end
// (Rule 61: data source -> relay -> client stream, not source text).
//
// scripts/check-bsd-ws-fanout.mjs proves the CODE builds the right payload from
// recorded frames. It cannot prove the DEPLOYED Durable Object holds an outbound
// socket to BSD, receives frames and writes them to a client. Nothing in this repo
// has ever observed that: the DO's outbound WebSocket has not been seen working in
// production. So this does what a browser does:
//
//   1. find a live event with `websocket_plus: true` (via the relay's own feed);
//   2. open the relay's SSE stream, GET /live/ambient;
//   3. POST /ambient/bsd/subscribe { event_id };
//   4. listen for `bsd:stats` and `bsd:ball`, and assert what arrives.
//
// States, none of which reads as another:
//   verified                  assertions ran on frames that came through the relay
//   no-qualifying-event       nothing live with the tier in the wait window; NOT a pass
//   no-frames-through-relay   subscribe answered ok, no bsd:stats came: the DO socket
//                             is not delivering. A finding, not a retry.
//   assertions-failed         frames came and one assertion did not hold
//
// SAMPLE-COVERAGE-A (Rule 91): the event, the window and the frame counts are in the
// artifact and the printed result.
//
// Usage: node scripts/bsd-fanout-live-verify.mjs [--wait-minutes 5] [--listen-seconds 200]
//        node scripts/bsd-fanout-live-verify.mjs --self-test

import { writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { KEYS } from './check-bsd-ws-fanout.mjs'
import { pickEvent } from './bsd-ws-capture.mjs'

export const RELAY = process.env.RELAY_URL || 'https://field-relay-nba.jeffunglesbee.workers.dev'

/** Split an SSE byte stream's text into { event, data } records. */
export const parseSSE = (text) => {
  const out = []
  for (const block of text.split('\n\n')) {
    let event = null
    const data = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    if (event && data.length) {
      try { out.push({ event, data: JSON.parse(data.join('\n')) }) } catch { out.push({ event, data: null, unparseable: true }) }
    }
  }
  return out
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Incidents that mark dead time, not an act by a side, and carry `side: null`. 3 of 3 seen: events 602347 at 38:04
 *  (temporary_interruption) and 39:18 (gameon), recorded 2026-10-28, and 7314 at 57:47 (gameon), 2026-10-29. Found
 *  because the first live run of the poll failed this very assertion; before that it had never met one. */
export const DEAD_TIME = ['temporary_interruption', 'gameon']
export const sideOk = (d) => ['home', 'away'].includes(d?.side) || (d?.side === null && DEAD_TIME.includes(d?.situation))

/** The assertions over what came through the relay. Pure. */
export const assess = ({ events, eventId, subscribeResponse }) => {
  const stats = events.filter((e) => e.event === 'bsd:stats')
  const balls = events.filter((e) => e.event === 'bsd:ball')
  const id = String(eventId)
  const keyset = (p) => Object.keys(p).sort().join(',')
  const checks = [
    ['the subscribe call answered ok for this event', subscribeResponse?.ok === true && String(subscribeResponse?.subscribed) === id],
    ['at least one bsd:stats arrived through the relay', stats.length > 0],
    ['every bsd:stats is parseable JSON', stats.every((e) => isObj(e.data))],
    ['every bsd:stats is for this event', stats.every((e) => e.data?.id === id)],
    ['every bsd:stats carries exactly the declared keys', stats.every((e) => isObj(e.data) && keyset(e.data) === KEYS['bsd:stats'].join(','))],
    ['every bsd:stats carries a time object with a numeric minute', stats.every((e) => isObj(e.data?.time) && typeof e.data.time.minute === 'number')],
    ['no bsd:stats carries a top-level minute or period', stats.every((e) => isObj(e.data) && !('minute' in e.data) && !('period' in e.data))],
    ['every bsd:ball is parseable JSON', balls.every((e) => isObj(e.data))],
    ['every bsd:ball is for this event', balls.every((e) => e.data?.id === id)],
    ['every bsd:ball carries exactly the declared keys', balls.every((e) => isObj(e.data) && keyset(e.data) === KEYS['bsd:ball'].join(','))],
    ['every bsd:ball coords is null or exactly an integer x and an integer y',
      balls.every((e) => e.data?.coords === null || (isObj(e.data?.coords) && Object.keys(e.data.coords).sort().join() === 'x,y' &&
        Number.isInteger(e.data.coords.x) && Number.isInteger(e.data.coords.y)))],
    ['every bsd:ball names a side (null only on a dead-time marker) and carries a time object and a string commentary',
      balls.every((e) => sideOk(e.data) && isObj(e.data?.time) && typeof e.data?.commentary === 'string')],
  ]
  return {
    checks: checks.map(([name, pass]) => ({ name, pass: Boolean(pass) })),
    counts: { stats: stats.length, ball: balls.length, other: events.length - stats.length - balls.length },
  }
}

export const stateOf = ({ event, assessed }) => {
  if (!event) return 'no-qualifying-event'
  if (assessed.counts.stats === 0) return 'no-frames-through-relay'
  return assessed.checks.every((c) => c.pass) ? 'verified' : 'assertions-failed'
}

/** The poll half (docs/CC-CMD-2026-10-29-bsd-live-shot-source.md). AmbientDO polls BSD's REST /stats/ once a minute
 *  for a match somebody activated; this asks whether a LIVE match's bsd:stats then carried a shotmap ARRAY, and
 *  what the DO says it did (`poll` is /ambient/state's bsdPoll, read after the window). The premise it settles, that a
 *  live /stats/ carries the same `shotmap` key a finished one does, had no live evidence when the poll was built.
 *  Each state names one thing, and only `poll-verified` is a pass:
 *    poll-state-unreadable                 /ambient/state had no bsdPoll (not deployed, or the read failed)
 *    poll-stopped                          the DO stopped itself (429 / 401 / 402 / 403): a finding about the vendor
 *    poll-did-not-run                      no call counted today inside the window
 *    poll-vendor-sent-no-shotmap-array     the request succeeded and the live body had no shotmap array
 *    poll-request-failed                   the last attempt was an error, not an answer
 *    poll-ok-but-not-delivered             the DO cached an array and no bsd:stats carried it: our bug
 *    poll-shape-wrong                      an array arrived whose records lack pos{x,y} or a boolean home
 *    poll-verified                         an array arrived, in the shape the client reads */
export const assessPoll = ({ events, poll, today }) => {
  const stats = events.filter((e) => e.event === 'bsd:stats')
  const withArray = stats.filter((e) => Array.isArray(e.data?.shotmap))
  const shots = withArray.flatMap((e) => e.data.shotmap)
  const shapeOk = shots.every((x) => isObj(x) && isObj(x.pos) && Number.isFinite(x.pos.x) && Number.isFinite(x.pos.y) && typeof x.home === 'boolean')
  const counts = { statsWithShotmapArray: withArray.length, shotsSeen: shots.length }
  const done = (state) => ({ state, counts })
  if (!isObj(poll) || poll.error) return done('poll-state-unreadable')
  if (poll.stopped) return done('poll-stopped')
  if (!(poll.calls >= 1) || poll.day !== today) return done('poll-did-not-run')
  if (poll.last?.kind === 'no-shotmap-array') return done('poll-vendor-sent-no-shotmap-array')
  if (withArray.length === 0 && poll.last?.kind !== 'ok') return done('poll-request-failed')
  if (withArray.length === 0) return done('poll-ok-but-not-delivered')
  if (!shapeOk) return done('poll-shape-wrong')
  return done('poll-verified')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const waitForEvent = async (waitMs) => {
  const deadline = Date.now() + waitMs
  let polls = 0
  for (;;) {
    polls++
    try {
      const r = await fetch(`${RELAY}/bsd/events/live`)
      if (r.ok) {
        const body = await r.json()
        if (!Array.isArray(body?.events)) throw new Error('live feed has no events array')
        const pick = pickEvent(body.events)
        if (pick) return { event: pick, polls }
      }
    } catch (e) { console.log(`  live poll ${polls} failed: ${e.message}`) }
    if (Date.now() + 30_000 > deadline) return { event: null, polls }
    await sleep(30_000)
  }
}

const main = async () => {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d }
  const waitMs = Number(arg('wait-minutes', '5')) * 60_000
  const listenMs = Number(arg('listen-seconds', '200')) * 1000
  mkdirSync('outbox', { recursive: true })
  const startedAt = new Date().toISOString()
  const { event, polls } = await waitForEvent(waitMs)
  const base = { startedAt, relay: RELAY, polls }
  if (!event) {
    const art = { ...base, state: 'no-qualifying-event', note: `no live websocket_plus row in ${polls} polls over ${waitMs / 60000} min` }
    writeFileSync('outbox/bsd-fanout-live-verify-latest.json', JSON.stringify(art, null, 2) + '\n')
    console.log(`state: ${art.state} — ${art.note}`)
    process.exit(3)
  }
  console.log(`event ${event.id}: ${event.home_team} v ${event.away_team} (${event.league_name}), period ${event.period}, minute ${event.current_minute}`)

  const ac = new AbortController()
  const sse = await fetch(`${RELAY}/live/ambient`, { signal: ac.signal, headers: { Accept: 'text/event-stream' } })
  if (!sse.ok) { console.log(`SSE connect failed: HTTP ${sse.status}`); process.exit(1) }
  let buffer = ''
  const reader = sse.body.getReader()
  const decoder = new TextDecoder()
  const pump = (async () => {
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }) } } catch { /* aborted at the end of the window */ }
  })()
  await sleep(1500)   // the DO writes `connected` first; _broadcast has no clients before it
  const subRes = await fetch(`${RELAY}/ambient/bsd/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_id: event.id }) })
  const subscribeResponse = await subRes.json().catch(() => ({ ok: false, error: `HTTP ${subRes.status}, body not JSON` }))
  console.log(`subscribe: HTTP ${subRes.status} ${JSON.stringify(subscribeResponse)}`)
  await sleep(listenMs)
  // What the DO says it did, read BEFORE the unsubscribe (which drops its cache). A failed read is a state, not a pass.
  let bsdPoll
  try {
    const st = await fetch(`${RELAY}/ambient/state`)
    bsdPoll = st.ok ? (await st.json()).bsdPoll : { error: `HTTP ${st.status}` }
  } catch (e) { bsdPoll = { error: String(e.message) } }
  try {
    await fetch(`${RELAY}/ambient/bsd/unsubscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_id: event.id }) })
  } catch (e) { console.log(`  unsubscribe failed (the verdict is unaffected): ${e.message}`) }
  ac.abort()
  await pump

  const events = parseSSE(buffer)
  const assessed = assess({ events, eventId: event.id, subscribeResponse })
  const state = stateOf({ event, assessed })
  // The poll fires one interval (60 s) after the subscribe and its array rides the next event frame (about 15 s):
  // a window shorter than that cannot judge it, and says so instead of failing it.
  const pollAssessed = listenMs >= 100_000
    ? assessPoll({ events, poll: bsdPoll, today: new Date().toISOString().slice(0, 10) })
    : { state: 'poll-not-assessed', counts: null }
  const art = {
    ...base, state,
    coverage: `${assessed.counts.stats} bsd:stats, ${assessed.counts.ball} bsd:ball, ${assessed.counts.other} other SSE events over ${listenMs / 1000} s from 1 event (${event.id}, ${event.league_name}) through the deployed relay`,
    event: { id: event.id, league_id: event.league_id, league_name: event.league_name, period: event.period, current_minute: event.current_minute, live_websocket: event.live_websocket, websocket_plus: event.websocket_plus },
    subscribeResponse, checks: assessed.checks, counts: assessed.counts,
    pollState: pollAssessed.state, pollCounts: pollAssessed.counts, bsdPoll,
    sample: events.filter((e) => e.event === 'bsd:stats' || e.event === 'bsd:ball').slice(0, 3),
    // When an assertion fails the artifact must show WHICH frames broke it, not only that one did: the whole window's
    // bsd:ball payloads (a few dozen) and the distinct values of the fields the assertions read.
    evidence: state === 'assertions-failed' ? {
      balls: events.filter((e) => e.event === 'bsd:ball').map((e) => e.data),
      sideValues: [...new Set(events.filter((e) => e.event === 'bsd:ball').map((e) => JSON.stringify(e.data?.side)))],
      commentaryTypes: [...new Set(events.filter((e) => e.event === 'bsd:ball').map((e) => typeof e.data?.commentary))],
      timeTypes: [...new Set(events.filter((e) => e.event === 'bsd:ball').map((e) => e.data?.time === null ? 'null' : typeof e.data?.time))],
    } : null,
  }
  writeFileSync('outbox/bsd-fanout-live-verify-latest.json', JSON.stringify(art, null, 2) + '\n')
  for (const c of assessed.checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`)
  console.log(`state: ${state}; ${art.coverage}`)
  console.log(`poll: ${pollAssessed.state}; ${JSON.stringify(pollAssessed.counts)}; DO says ${JSON.stringify(bsdPoll)}`)
  // 0 only when the fan-out AND the poll are both verified. A verified fan-out with a poll that is not is exit 5.
  process.exit(state === 'verified' ? (pollAssessed.state === 'poll-verified' ? 0 : 5) : state === 'assertions-failed' ? 1 : 4)
}

// --- self-test ---------------------------------------------------------------

const selfTest = () => {
  let failed = 0
  const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : ` — ${d}`}`); if (!c) failed++ }
  const stats = (extra = {}) => ({ event: 'bsd:stats', data: { type: 'bsd:stats', id: '7', time: { minute: 48 }, score: { home: 0, away: 0 }, stats: {}, shotmap: null, momentum: null, ...extra } })
  const ball = (extra = {}) => ({ event: 'bsd:ball', data: { type: 'bsd:ball', id: '7', uts: 1, coords: null, situation: 'corner', side: 'home', time: { minute: 1 }, commentary: 'x', ...extra } })
  const sub = { ok: true, subscribed: '7' }
  const A = (events, subscribeResponse = sub) => assess({ events, eventId: 7, subscribeResponse })
  const failing = (a) => a.checks.filter((c) => !c.pass).map((c) => c.name)

  const good = A([stats(), ball(), { event: 'ping', data: {} }])
  ok('conforming traffic passes every assertion and counts what came', failing(good).length === 0 && good.counts.stats === 1 && good.counts.ball === 1 && good.counts.other === 1, JSON.stringify(failing(good)))
  ok('the SSE parser reads event/data records and flags broken JSON',
    parseSSE('event: a\ndata: {"x":1}\n\nevent: b\ndata: {oops\n\n')[0].data.x === 1 && parseSSE('event: a\ndata: {"x":1}\n\nevent: b\ndata: {oops\n\n')[1].unparseable === true)
  ok('no bsd:stats at all fails the arrival assertion', failing(A([ball()])).includes('at least one bsd:stats arrived through the relay'))
  ok('a refused subscribe fails', failing(A([stats()], { ok: false })).includes('the subscribe call answered ok for this event'))
  ok('a subscribe for another event fails', failing(A([stats()], { ok: true, subscribed: '8' })).includes('the subscribe call answered ok for this event'))
  ok('an old-shape bsd:stats (minute and period, no time) fails three assertions',
    failing(A([stats({ time: undefined, minute: 48, period: 2 })])).length >= 3, JSON.stringify(failing(A([stats({ time: undefined, minute: 48, period: 2 })]))))
  ok('a hybrid with time AND a top-level minute fails', failing(A([stats({ minute: 48 })])).some((n) => n.includes('top-level minute')))
  ok('a computed extra key fails the key-set assertion', failing(A([stats({ drama: 1 })])).some((n) => n.includes('exactly the declared keys')))
  ok('a bsd:stats for another event fails', failing(A([stats({ id: '9' })])).some((n) => n.includes('for this event')))
  ok('a bsd:ball for another event fails', failing(A([stats(), ball({ id: '9' })])).includes('every bsd:ball is for this event'))
  ok('a bsd:ball whose coords are a fraction fails', failing(A([stats(), ball({ coords: { x: 72.5, y: 47 } })])).some((n) => n.includes('integer x')))
  ok('a bsd:ball whose coords are an array fails', failing(A([stats(), ball({ coords: [{ x: 1, y: 2 }] })])).some((n) => n.includes('integer x')))
  ok('a bsd:ball whose coords carry an extra key fails', failing(A([stats(), ball({ coords: { x: 1, y: 2, z: 3 } })])).some((n) => n.includes('integer x')))
  ok('a bsd:ball with integer coords passes', failing(A([stats(), ball({ coords: { x: 72, y: 47 } })])).length === 0)
  ok('a bsd:ball without side fails', failing(A([stats(), ball({ side: undefined })])).some((n) => n.includes('names a side')))
  ok('a null side on a corner fails (null is for dead time only)', failing(A([stats(), ball({ side: null })])).some((n) => n.includes('names a side')))
  ok('a null side on a gameon marker passes (seen live, event 7314, 2026-10-29)', failing(A([stats(), ball({ side: null, situation: 'gameon' })])).length === 0)
  ok('a null side on a temporary_interruption marker passes (recorded, event 602347)', failing(A([stats(), ball({ side: null, situation: 'temporary_interruption' })])).length === 0)
  ok('a side that is neither home, away nor null fails even on gameon', failing(A([stats(), ball({ side: 'both', situation: 'gameon' })])).some((n) => n.includes('names a side')))
  ok('a bsd:ball with a non-string commentary fails', failing(A([stats(), ball({ commentary: 5 })])).some((n) => n.includes('string commentary')))
  ok('a bsd:ball with an extra key fails the key-set assertion', failing(A([stats(), ball({ watch: 1 })])).some((n) => n.includes('exactly the declared keys')))
  ok('an unparseable bsd:stats fails', failing(A([{ event: 'bsd:stats', data: null, unparseable: true }])).some((n) => n.includes('parseable')))
  ok('state: no event is no-qualifying-event, never a pass', stateOf({ event: null, assessed: good }) === 'no-qualifying-event')
  ok('state: subscribed but zero bsd:stats is no-frames-through-relay', stateOf({ event: {}, assessed: A([]) }) === 'no-frames-through-relay')
  ok('state: frames that fail an assertion are assertions-failed', stateOf({ event: {}, assessed: A([stats({ drama: 1 })]) }) === 'assertions-failed')
  ok('state: all assertions on real traffic is verified', stateOf({ event: {}, assessed: good }) === 'verified')
  // --- the poll half ---
  const T = '2026-10-29'
  const shot = (extra = {}) => ({ pos: { x: 10.2, y: 53.4, z: 0 }, home: true, xg: 0.1, ...extra })
  const okPoll = { cap: 600, day: T, calls: 2, stopped: null, last: { kind: 'ok' } }
  const P = (events, poll) => assessPoll({ events, poll, today: T }).state
  const withShots = [stats({ shotmap: [shot(), shot({ home: false })] })]
  ok('poll: an array of well-formed shots on a bsd:stats is poll-verified', P(withShots, okPoll) === 'poll-verified')
  ok('poll: an EMPTY array is poll-verified (no shots yet is an answer)', P([stats({ shotmap: [] })], okPoll) === 'poll-verified')
  ok('poll: a null shotmap on every stats frame is poll-ok-but-not-delivered, not verified', P([stats(), stats()], okPoll) === 'poll-ok-but-not-delivered')
  ok('poll: no bsdPoll at all is poll-state-unreadable', P(withShots, undefined) === 'poll-state-unreadable' && P(withShots, { error: 'HTTP 500' }) === 'poll-state-unreadable')
  ok('poll: a stop is poll-stopped even when an array also arrived', P(withShots, { ...okPoll, stopped: { reason: '429' } }) === 'poll-stopped')
  ok('poll: zero calls today is poll-did-not-run', P([stats()], { ...okPoll, calls: 0 }) === 'poll-did-not-run')
  ok('poll: a count from another day is poll-did-not-run', P(withShots, { ...okPoll, day: '2026-10-28' }) === 'poll-did-not-run')
  ok('poll: a successful request whose body had no array names the vendor, not us', P([stats()], { ...okPoll, last: { kind: 'no-shotmap-array' } }) === 'poll-vendor-sent-no-shotmap-array')
  ok('poll: a failed last attempt with no array is poll-request-failed', P([stats()], { ...okPoll, last: { kind: 'http-error' } }) === 'poll-request-failed')
  ok('poll: a shot with no pos fails the shape', P([stats({ shotmap: [{ home: true }] })], okPoll) === 'poll-shape-wrong')
  ok('poll: a shot with a string home fails the shape', P([stats({ shotmap: [shot({ home: 'home' })] })], okPoll) === 'poll-shape-wrong')
  ok('poll: a shot with a non-finite coordinate fails the shape', P([stats({ shotmap: [shot({ pos: { x: null, y: 1 } })] })], okPoll) === 'poll-shape-wrong')
  ok('poll: counts say how many arrays and shots were seen', (() => { const c = assessPoll({ events: withShots, poll: okPoll, today: T }).counts; return c.statsWithShotmapArray === 1 && c.shotsSeen === 2 })())
  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
  return failed === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) process.exit(selfTest())
  await main()
}
