#!/usr/bin/env node
// docs/CC-CMD-2026-10-29-bsd-live-shot-source.md, Task 1 (the build, owner's cap 600).
//
// AmbientDO polls BSD's REST /stats/ once a minute for each match somebody activated, so a LIVE match gets a
// shotmap (0 of 170 recorded WebSocket `event` frames carry one). Nothing about BSD's allowance can be read
// (outbox/bsd-request-budget-latest.json), so the poll is only acceptable if it provably stops itself. This
// does not describe the poll: it EXTRACTS the real constants and methods from src/ambient-do.js and runs them
// against a fake clock, a fake storage, a fake `fetch` and a fake Analytics Engine binding, and asserts:
//
//   - the request is exactly GET {base}/api/v2/events/{id}/stats/ with the token, once per FRESH subscribed event
//   - the vendor's array reaches bsd:stats byte for byte, ONCE, and again after a re-subscribe (Rule 47)
//   - the daily cap of 600 binds exactly (the 601st call is never made), is stored BEFORE the request, resets at
//     00:00Z, and a failing storage write means no request
//   - 429, 401, 402 and 403 each stop the poll for the rest of the UTC day; 500s and network errors do not, but
//     still count
//   - an absent shotmap is not an empty one: [] is delivered as [], a missing or non-array body stores nothing
//   - one Analytics Engine datapoint per attempt, and a failing binding breaks nothing (Rule 5)
//   - an event with no recent frame is not polled; unsubscribing drops the cache and stops an empty timer
//   - two rounds never overlap, and requests are sequential
//
// The REAL recorded /stats/ body is scripts/fixtures/bsd-223324-coordinates.json (.shotmap, 32 shots).
//
// WHAT IT DOES NOT COVER: BSD's behaviour under load (never provoked, Rule 78), a LIVE /stats/ body (none is
// live in CI; the shotmap array is the same key the finished body has, which is the premise, stated), the
// socket and SSE delivery, and a Durable Object restart (storage is faked; its persistence is asserted as
// "put before fetch", not as an eviction).
//
// SAMPLE-COVERAGE-A (Rule 91): the number of scenarios and assertions run is printed, and a run that executed
// fewer than MIN_SCENARIOS cannot pass.
//
// Usage: node scripts/check-bsd-stats-poll.mjs [--source <ambient-do.js>]
//        node scripts/check-bsd-stats-poll.mjs --self-test

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

export const MIN_SCENARIOS = 15
export const FIXTURE = 'scripts/fixtures/bsd-223324-coordinates.json'

const MARK = {
  constBegin: '// ── BSD stats poll constants (begin)', constEnd: '// ── BSD stats poll constants (end)',
  methBegin: '// ── BSD stats poll (begin)', methEnd: '// ── BSD stats poll (end)',
  onFrame: '_bsdOnFrame(rawData) {', subscribe: 'async _bsdSubscribe',
}

/** Each anchor must match exactly once, in order, or nothing was extracted and a pass would mean nothing. */
export const extract = (source) => {
  const once = (s) => {
    const n = source.split(s).length - 1
    if (n !== 1) throw new Error(`anchor "${s}" matched ${n} times, not 1`)
    return source.indexOf(s)
  }
  const cb = once(MARK.constBegin), ce = once(MARK.constEnd), mb = once(MARK.methBegin), me = once(MARK.methEnd)
  const of = once(MARK.onFrame), sub = once(MARK.subscribe)
  if (!(cb < ce && ce < of && of < sub && sub < mb && mb < me)) throw new Error('the anchors are not in the order constants, _bsdOnFrame, _bsdSubscribe, poll methods')
  return {
    consts: source.slice(cb, ce),
    // _bsdOnFrame and its two helpers, then _bsdSubscribe and _bsdUnsubscribe, then the poll methods.
    methods: source.slice(of, sub) + source.slice(sub, mb) + source.slice(mb, me),
  }
}

// ---------------------------------------------------------------- the harness
const T0 = Date.parse('2026-10-29T18:00:00Z')

export function makeHost (src, opts = {}) {
  const clock = { t: opts.t ?? T0 }
  const timers = []
  const logs = []
  class FakeDate extends Date {
    static now () { return clock.t }
    constructor (...a) { if (a.length === 0) super(clock.t); else super(...a) }
  }
  const fakeSetTimeout = (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t }
  const fakeClearTimeout = (t) => { if (t) t.cleared = true }
  const fakeConsole = { error: (...a) => logs.push(a.map(String).join(' ')), log: () => {}, warn: () => {} }

  const store = new Map()
  const storage = {
    puts: 0, failPut: false,
    async get (k) { return store.has(k) ? structuredClone(store.get(k)) : undefined },
    async put (k, v) { if (storage.failPut) throw new Error('storage unavailable'); storage.puts++; store.set(k, structuredClone(v)) },
  }
  const fetchLog = []
  let inFlight = 0, maxInFlight = 0
  const net = { next: [], gate: null }
  const fakeFetch = async (url, init) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
    fetchLog.push({ url, headers: init?.headers, calls: store.get('bsd_poll')?.calls, hasSignal: !!init?.signal })
    try {
      if (net.gate) await net.gate
      const step = net.next.length ? net.next.shift() : opts.default
      if (step === undefined) throw new Error('the fake network had no response queued')
      if (step instanceof Error) throw step
      return new Response(step.rawBody ?? JSON.stringify(step.body), { status: step.status ?? 200, headers: step.headers ?? {} })
    } finally { inFlight-- }
  }
  const points = []
  const env = { JQ_ANALYTICS: { writeDataPoint: (p) => { if (opts.aeThrows) throw new Error('ae down'); points.push(p) } } }

  const Cls = new Function('fetch', 'Date', 'setTimeout', 'clearTimeout', 'console', `${src.consts}\n return { Cls: class { ${src.methods} }, consts: { BSD_POLL_INTERVAL_MS, BSD_POLL_DAILY_CAP, BSD_POLL_FRESH_MS, BSD_POLL_INDEX, BSD_POLL_BASE } }`)(
    fakeFetch, FakeDate, fakeSetTimeout, fakeClearTimeout, fakeConsole)
  const host = new Cls.Cls()
  Object.assign(host, {
    ctx: { storage }, env: opts.noAe ? {} : env, _bsdSubscribed: new Set(), _bsdLastFrameAt: new Map(), _bsdShot: new Map(),
    _bsdPollTimer: null, _bsdPollBusy: false, _bsdPollState: null, _bsdToken: opts.token === undefined ? 'TOK' : opts.token, _bsdSocket: null,
  })
  const out = []
  host._broadcast = (type, payload) => out.push({ type, payload })
  const frame = (id, type = 'event') => host._bsdOnFrame(JSON.stringify(type === 'event'
    ? { type, event_id: Number(id), time: { minute: 10 }, score: { home: 0, away: 0 }, stats: { home: {}, away: {} } }
    : { type, event_id: Number(id), uts: 1, side: 'home', situation: 'x', time: { minute: 10 }, commentary: 'c', coordinates: [] }))
  return { host, clock, timers, logs, storage, store, fetchLog, net, points, out, frame, consts: Cls.consts, maxInFlight: () => maxInFlight }
}

const bodyOf = () => JSON.parse(readFileSync(FIXTURE, 'utf8')).shotmap
const stored = (h) => h.store.get('bsd_poll')

// ---------------------------------------------------------------- scenarios
export const scenarios = (src, fixtureBody) => {
  const fx = fixtureBody
  const results = []
  const S = (name, fn) => results.push({ name, fn })

  S('the constants are the owner\'s: cap 600, a minute, 180 s fresh, the index name', async () => {
    const h = makeHost(src)
    return [['cap is 600 (the owner\'s number, "use 600")', h.consts.BSD_POLL_DAILY_CAP === 600], ['interval is 60 s', h.consts.BSD_POLL_INTERVAL_MS === 60000],
            ['an event is fresh for 180 s', h.consts.BSD_POLL_FRESH_MS === 180000], ['the datapoint index', h.consts.BSD_POLL_INDEX === 'bsd-stats-poll'],
            ['the base is the vendor host', h.consts.BSD_POLL_BASE === 'https://sports.bzzoiro.com']]
  })

  S('one request per FRESH subscribed event, to the exact URL, with the token, counted before it is made', async () => {
    const h = makeHost(src, { default: { body: fx } })
    await h.host._bsdSubscribe('111'); await h.host._bsdSubscribe('222')
    h.frame('111')                                   // 222 never streams
    await h.host._bsdPollTick()
    const f = h.fetchLog
    return [['exactly one request, for the streaming event only', f.length === 1 && f[0].url === 'https://sports.bzzoiro.com/api/v2/events/111/stats/'],
            ['the token header is the DO\'s token', f[0]?.headers?.Authorization === 'Token TOK'],
            ['a timeout signal is set', f[0]?.hasSignal === true],
            ['the call was already stored when the request was made', f[0]?.calls === 1],
            ['and is stored as 1 afterwards', stored(h).calls === 1 && stored(h).day === '2026-10-29']]
  })

  S('the vendor\'s array reaches bsd:stats byte for byte, once, and again after a re-subscribe (Rule 47)', async () => {
    const h = makeHost(src, { default: { body: fx } })
    await h.host._bsdSubscribe('111'); h.frame('111')
    await h.host._bsdPollTick()
    h.out.length = 0                                  // drop the frame that preceded the poll
    h.frame('111'); h.frame('111'); h.frame('111')
    const p = h.out.filter(o => o.type === 'bsd:stats').map(o => o.payload.shotmap)
    const first = JSON.stringify(p[0]) === JSON.stringify(fx.shotmap)
    await h.host._bsdSubscribe('111'); h.frame('111')
    const again = h.out.filter(o => o.type === 'bsd:stats').pop().payload.shotmap
    return [['the first frame after the poll carries the vendor\'s array, identical', first && isDeepStrictEqual(p[0], fx.shotmap)],
            [`...and it has the fixture's ${fx.shotmap.length} shots`, p[0].length === fx.shotmap.length && fx.shotmap.length > 0],
            ['the next two frames carry null ("nothing new"), not a re-sent array', p[1] === null && p[2] === null && p.length === 3],
            ['a re-subscribe hands the cached array over again', isDeepStrictEqual(again, fx.shotmap)]]
  })

  S('an event with no recent frame is not polled; one 100 s old is', async () => {
    const h = makeHost(src, { default: { body: fx } })
    await h.host._bsdSubscribe('111'); await h.host._bsdSubscribe('222'); await h.host._bsdSubscribe('333')
    h.frame('111'); h.clock.t += 100_000; h.frame('222')
    h.clock.t += 100_000   // 111 is 200 s old, 222 is 100 s old, 333 never streamed
    await h.host._bsdPollTick()
    return [['only the 100 s old event is polled', h.fetchLog.length === 1 && h.fetchLog[0].url.includes('/events/222/')]]
  })

  S('the cap binds exactly: 599 stored, one more call, then none, and the cap is announced once', async () => {
    const h = makeHost(src, { default: { body: fx } })
    h.store.set('bsd_poll', { day: '2026-10-29', calls: 599, stopped: null, capReachedAt: null, last: null })
    await h.host._bsdSubscribe('111'); await h.host._bsdSubscribe('222'); h.frame('111'); h.frame('222')
    await h.host._bsdPollTick()
    const afterFirst = h.fetchLog.length
    const st = stored(h)
    h.clock.t += 60_000; h.frame('111'); h.frame('222')
    await h.host._bsdPollTick()
    return [['the 600th call is made and the 601st is not (this round: 1 request of 2 events)', afterFirst === 1],
            ['calls is exactly 600', st.calls === 600],
            ['capReachedAt is set and persisted', Number.isFinite(stored(h).capReachedAt)],
            ['the next round makes no request', h.fetchLog.length === 1],
            ['one cap-reached datapoint, not one per round', h.points.filter(p => p.blobs[0] === 'cap-reached').length === 1]]
  })

  S('the cap resets at 00:00Z and a stop does not outlive its day', async () => {
    const h = makeHost(src, { default: { body: fx } })
    h.store.set('bsd_poll', { day: '2026-10-29', calls: 600, stopped: { day: '2026-10-29', reason: '429' }, capReachedAt: T0 - 1, last: null })
    await h.host._bsdSubscribe('111'); h.frame('111')
    await h.host._bsdPollTick()
    const sameDay = h.fetchLog.length
    h.clock.t = Date.parse('2026-10-30T00:00:30Z'); h.frame('111')
    await h.host._bsdPollTick()
    return [['same UTC day, stopped and over the cap: no request', sameDay === 0],
            ['after 00:00Z: one request', h.fetchLog.length === 1],
            ['calls restarts at 1 and the day is the new one', stored(h).calls === 1 && stored(h).day === '2026-10-30'],
            ['the stop and the cap marker are cleared', stored(h).stopped === null && stored(h).capReachedAt === null]]
  })

  S('a storage write that fails means NO request', async () => {
    const h = makeHost(src, { default: { body: fx } })
    await h.host._bsdSubscribe('111'); h.frame('111')
    h.storage.failPut = true
    await h.host._bsdPollTick()
    return [['no request was made', h.fetchLog.length === 0],
            ['the failure is logged, not thrown out of the timer', h.logs.some(l => l.includes('round failed'))],
            ['the timer is re-armed anyway', h.timers.filter(t => !t.cleared).length >= 1]]
  })

  for (const code of [429, 401, 402, 403]) {
    S(`${code} stops the poll for the rest of the UTC day, and records why`, async () => {
      const h = makeHost(src, { default: { body: fx } })
      h.net.next.push({ status: code, body: {}, headers: { 'Retry-After': '120' } })
      await h.host._bsdSubscribe('111'); await h.host._bsdSubscribe('222'); h.frame('111'); h.frame('222')
      await h.host._bsdPollTick()
      const first = h.fetchLog.length
      h.clock.t += 60_000; h.frame('111'); h.frame('222')
      await h.host._bsdPollTick()
      const st = stored(h)
      return [['the round stopped at the refusal (1 request, not 2)', first === 1],
              ['the next round, same day, makes none', h.fetchLog.length === 1],
              ['the stop is persisted with its reason and Retry-After', st.stopped?.reason === String(code) && (code !== 429 || st.stopped?.retryAfter === '120')],
              ['a stopped-' + code + ' datapoint', h.points.some(p => p.blobs[0] === `stopped-${code}`)]]
    })
  }

  S('a 500 and a network error are COUNTED and do not stop the poll or change the cache', async () => {
    const h = makeHost(src, { default: { body: fx } })
    await h.host._bsdSubscribe('111'); h.frame('111')
    await h.host._bsdPollTick()                       // ok: cached
    h.net.next.push({ status: 500, body: {} }); h.clock.t += 60_000; h.frame('111')
    await h.host._bsdPollTick()
    h.net.next.push(new Error('socket hang up')); h.clock.t += 60_000; h.frame('111')
    await h.host._bsdPollTick()
    h.clock.t += 60_000; h.frame('111')
    await h.host._bsdPollTick()                       // ok again
    const kinds = h.points.map(p => p.blobs[0])
    return [['four requests, four counted calls', h.fetchLog.length === 4 && stored(h).calls === 4],
            ['neither failure stopped the poll', stored(h).stopped === null],
            ['kinds recorded in order', JSON.stringify(kinds) === JSON.stringify(['ok', 'http-error', 'fetch-error', 'ok'])],
            ['the network error was logged', h.logs.some(l => l.includes('socket hang up'))]]
  })

  S('absent is not empty: a body with no shotmap array stores nothing; [] is delivered as []', async () => {
    const h = makeHost(src)
    await h.host._bsdSubscribe('111'); h.frame('111')
    for (const b of [{ event_id: 111 }, { shotmap: null }, { shotmap: { a: 1 } }, { shotmap: 'x' }]) {
      h.net.next.push({ body: b }); h.clock.t += 60_000; h.frame('111')
      await h.host._bsdPollTick()
    }
    const stored0 = h.host._bsdShot.has('111')
    h.net.next.push({ body: { shotmap: [] } }); h.clock.t += 60_000; h.frame('111')
    await h.host._bsdPollTick(); h.frame('111')
    const p = h.out.filter(o => o.type === 'bsd:stats').pop().payload.shotmap
    return [['four malformed bodies stored nothing', stored0 === false],
            ['and each was recorded as no-shotmap-array', h.points.slice(0, 4).every(x => x.blobs[0] === 'no-shotmap-array')],
            ['an empty array is stored and delivered as [] (not null)', Array.isArray(p) && p.length === 0]]
  })

  S('one Analytics Engine datapoint per attempt; a failing binding breaks nothing; a missing one is fine', async () => {
    const h = makeHost(src, { default: { body: fx } })
    await h.host._bsdSubscribe('111'); h.frame('111')
    await h.host._bsdPollTick()
    const bad = makeHost(src, { default: { body: fx }, aeThrows: true })
    await bad.host._bsdSubscribe('111'); bad.frame('111')
    await bad.host._bsdPollTick(); bad.frame('111')
    const none = makeHost(src, { default: { body: fx }, noAe: true })
    await none.host._bsdSubscribe('111'); none.frame('111')
    await none.host._bsdPollTick()
    const dp = h.points[0]
    return [['one datapoint for one request', h.points.length === 1],
            ['index bsd-stats-poll, blobs [kind, id, status], doubles [1, calls]', dp.indexes[0] === 'bsd-stats-poll' && dp.blobs.join() === 'ok,111,200' && dp.doubles.join() === '1,1'],
            ['a throwing binding does not stop the poll from delivering the shotmap', bad.fetchLog.length === 1 && isDeepStrictEqual(bad.out.filter(o => o.type === 'bsd:stats').pop().payload.shotmap, fx.shotmap)],
            ['the throw was logged', bad.logs.some(l => l.includes('datapoint failed'))],
            ['no binding at all is fine', none.fetchLog.length === 1]]
  })

  S('no token: no request and no call spent', async () => {
    const h = makeHost(src, { default: { body: fx }, token: null })
    await h.host._bsdSubscribe('111'); h.frame('111')
    await h.host._bsdPollTick()
    return [['nothing was requested', h.fetchLog.length === 0], ['and nothing was counted', (stored(h)?.calls ?? 0) === 0 || stored(h) === undefined],
            ['recorded as no-token', h.points.some(p => p.blobs[0] === 'no-token')]]
  })

  S('two rounds never overlap, and the requests inside one round are sequential', async () => {
    const h = makeHost(src, { default: { body: fx } })
    let release; h.net.gate = new Promise(r => { release = r })
    await h.host._bsdSubscribe('111'); await h.host._bsdSubscribe('222'); h.frame('111'); h.frame('222')
    const a = h.host._bsdPollTick()
    await new Promise(r => setImmediate(r))
    await h.host._bsdPollTick()             // arrives while the first is in flight
    const during = h.fetchLog.length
    release(); await a
    return [['a tick during a round makes no request of its own', during === 1], ['both events were polled by the one round', h.fetchLog.length === 2],
            ['never more than one request in flight', h.maxInFlight() === 1]]
  })

  S('unsubscribing drops the cache and the frame clock; an empty set stops the timer; subscribing arms it once', async () => {
    const h = makeHost(src, { default: { body: fx } })
    await h.host._bsdSubscribe('111'); await h.host._bsdSubscribe('222')
    const armed = h.timers.filter(t => !t.cleared).length
    h.frame('111'); await h.host._bsdPollTick()
    const hadCache = h.host._bsdShot.has('111')
    await h.host._bsdUnsubscribe('111')
    const afterOne = [h.host._bsdShot.has('111'), h.host._bsdLastFrameAt.has('111')]
    const stillArmed = h.host._bsdPollTimer !== null
    await h.host._bsdUnsubscribe('222')
    return [['two subscribes arm one timer', armed === 1], ['the poll cached the array', hadCache === true],
            ['unsubscribe drops both the cache and the frame clock', afterOne[0] === false && afterOne[1] === false],
            ['one event left: the timer stays', stillArmed === true], ['none left: the timer is stopped', h.host._bsdPollTimer === null]]
  })

  S('an event id is URL-encoded, not spliced', async () => {
    const h = makeHost(src, { default: { body: fx } })
    // A WebSocket event_id is a number, so a hostile id from /ambient/bsd/subscribe can never become "fresh" through
    // _bsdOnFrame; the encoding is the second line, so it is exercised by marking the id fresh directly.
    await h.host._bsdSubscribe('1/../x'); h.host._bsdLastFrameAt.set('1/../x', h.clock.t)
    await h.host._bsdPollTick()
    return [['the path carries the encoded id', h.fetchLog[0]?.url === 'https://sports.bzzoiro.com/api/v2/events/1%2F..%2Fx/stats/']]
  })

  S('the state view reports the cap, the count, the stop and what is cached', async () => {
    const h = makeHost(src, { default: { body: fx } })
    await h.host._bsdSubscribe('111'); h.frame('111'); await h.host._bsdPollTick()
    const v = await h.host._bsdPollView()
    return [['cap and count', v.cap === 600 && v.calls === 1 && v.day === '2026-10-29'], ['no stop yet', v.stopped === null],
            ['the cache is listed with its shot count', v.shotmapsCached?.[0]?.id === '111' && v.shotmapsCached[0].shots === fx.shotmap.length],
            ['the timer state is visible', typeof v.timerArmed === 'boolean']]
  })

  S('a livedata frame also keeps an event fresh (the ball stream counts as streaming)', async () => {
    const h = makeHost(src, { default: { body: fx } })
    await h.host._bsdSubscribe('111'); h.frame('111', 'livedata')
    await h.host._bsdPollTick()
    return [['polled on the strength of a livedata frame alone', h.fetchLog.length === 1]]
  })
  return results
}

export async function run (src, fixtureBody) {
  const all = scenarios(src, fixtureBody)
  let assertions = 0, failed = 0
  for (const s of all) {
    let rows
    try { rows = await s.fn() } catch (e) { console.log(`FAIL  ${s.name}\n      threw: ${e.message}`); failed++; assertions++; continue }
    const bad = rows.filter(([, ok]) => ok !== true)
    assertions += rows.length
    console.log(`${bad.length === 0 ? 'PASS' : 'FAIL'}  ${s.name}  (${rows.length} assertions)`)
    for (const [n] of bad) { console.log(`      ✗ ${n}`); failed++ }
  }
  return { scenarios: all.length, assertions, failed }
}

// ---------------------------------------------------------------- self-test
function selfTest () {
  let failed = 0
  const check = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failed++ }
  const good = `${MARK.constBegin}\nconst A = 1\n${MARK.constEnd}\nclass X {\n ${MARK.onFrame}\n }\n ${MARK.subscribe}(e) {}\n ${MARK.methBegin}\n m() {}\n ${MARK.methEnd}\n}`
  check('well-formed anchors extract', (() => { try { extract(good); return true } catch { return false } })())
  const throws = (s) => { try { extract(s); return false } catch { return true } }
  check('a missing anchor throws', throws(good.replace(MARK.methEnd, 'x')))
  check('a duplicated anchor throws', throws(good + MARK.constBegin))
  check('anchors out of order throw', throws(good.replace(MARK.subscribe, 'x') + MARK.subscribe))
  check('a fixture with no shots cannot make the check pass (it needs a non-empty array)', (() => { try { return readFileSync(FIXTURE, 'utf8').length > 0 && bodyOf().shotmap.length > 0 } catch { return false } })())
  console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${failed === 0 ? 'all' : failed + ' failed of'} self-tests`)
  return failed
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.includes('--self-test')) process.exit(selfTest())
  const i = process.argv.indexOf('--source')
  const file = i > -1 ? process.argv[i + 1] : 'src/ambient-do.js'
  const src = extract(readFileSync(file, 'utf8'))
  const fx = bodyOf()
  const r = await run(src, fx)
  console.log(`\nCOVERAGE: ${r.scenarios} scenarios, ${r.assertions} assertions, run against the REAL constants and methods in ${file} and a recorded /stats/ body (${fx.shotmap.length} shots, event ${fx.event_id}); fake clock, storage, fetch and Analytics Engine.`)
  if (r.scenarios < MIN_SCENARIOS) { console.log(`FAIL: ${r.scenarios} scenarios ran, fewer than ${MIN_SCENARIOS}`); process.exit(1) }
  console.log(r.failed === 0 ? 'OK: the poll spends only what it counted first, stops itself, and hands the vendor\'s array through unchanged' : `FAILED: ${r.failed} assertion(s)`)
  process.exit(r.failed === 0 ? 0 : 1)
}
