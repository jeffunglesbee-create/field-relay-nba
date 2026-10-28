#!/usr/bin/env node
// docs/CC-CMD-2026-10-28-bsd-ws-fanout-field-names.md, Task 2.
//
// AmbientDO's `_bsdOnFrame` turns a BSD WebSocket frame into the `bsd:stats` and
// `bsd:ball` payloads every SSE client receives. It was written from a spec, and the
// first recorded frames (2026-10-28, event 602466; outbox/bsd-ws-frames-*.jsonl)
// showed it reading `frame.minute` and `frame.period` that the frame does not have
// (they sit at `frame.time.minute`, `frame.time.period`) and dropping `side`, `time`
// and `commentary` from every livedata frame.
//
// So this does not compare the function with a description of it. It extracts the
// REAL `_bsdOnFrame` from src/ambient-do.js and replays every recorded frame through
// it, asserting the payload carries what the frame carries, under the frame's own
// field names (Rule 60: the vendor's names pass through unchanged), and carries
// NOTHING ELSE: the key set is exact, so a computed or invented field fails (Rule 47).
//
// TWO KINDS OF EVIDENCE, kept apart in the printed result:
//   - RECORDED frames: real, from outbox/bsd-ws-frames-*.jsonl.
//   - SYNTHETIC frames: written here, for shapes no recording contains yet (a
//     populated `coordinates`, a present `shotmap`, a missing `event_id`, a
//     non-JSON message). They test the code's handling, not the vendor's shape.
//
// WHAT IT DOES NOT COVER: the socket listener that hands `evt.data` to
// `_bsdOnFrame`. It checks the payload built from every frame, not delivery.
//
// SAMPLE-COVERAGE-A (field-relay-nba/CLAUDE.md Rule 91): the denominators and the
// distinct event ids are printed beside the result, derived from the data, and a run
// that judged zero event or zero livedata frames cannot pass.
//
// Usage:  node scripts/check-bsd-ws-fanout.mjs [--source <ambient-do.js>] [--frames <jsonl>...]
//         node scripts/check-bsd-ws-fanout.mjs --self-test

import { readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const START = '_bsdOnFrame(rawData) {'
const END = 'async _bsdSubscribe'

// The payloads carry exactly these keys. Nothing computed rides along (Rule 47).
export const KEYS = {
  'bsd:stats': ['id', 'momentum', 'score', 'shotmap', 'stats', 'time', 'type'],
  'bsd:ball': ['commentary', 'coords', 'id', 'side', 'situation', 'time', 'type', 'uts'],
}

/** The method body, between its own signature and the next method's. Each anchor
 *  must match exactly once, or nothing was extracted and a pass would mean nothing. */
export const extractOnFrame = (source) => {
  const count = (s) => source.split(s).length - 1
  if (count(START) !== 1) throw new Error(`anchor "${START}" matched ${count(START)} times, not 1`)
  if (count(END) !== 1) throw new Error(`anchor "${END}" matched ${count(END)} times, not 1`)
  const a = source.indexOf(START)
  const b = source.indexOf(END)
  if (b <= a) throw new Error('the next method comes before _bsdOnFrame; the anchors no longer bound it')
  return source.slice(a, b)
}

/** Run the extracted method over one raw frame; returns what it broadcast. The body
 *  is evaluated as a CLASS method, so it runs in strict mode exactly as it does in
 *  production: a sloppy-mode replay would let an undeclared assignment pass that
 *  throws (and is swallowed by the method's own catch) in the Worker. */
export const replay = (body, raw) => {
  const out = []
  const Cls = new Function(`return class { ${body} }`)()
  const host = new Cls()
  host._broadcast = (type, payload) => out.push({ type, payload })
  host._bsdOnFrame(raw)
  return out
}

const same = (a, b) => isDeepStrictEqual(a, b)
const keysOf = (p) => Object.keys(p).sort()

/** The assertions for one frame. Returns [] when it passes, else the reasons. */
export const judge = (frame, broadcasts) => {
  const why = []
  const expectOne = (name) => {
    if (broadcasts.length !== 1 || broadcasts[0].type !== name) {
      return `${frame.type} frame produced ${broadcasts.length} broadcast(s) [${broadcasts.map((b) => b.type).join(',')}], expected one ${name}`
    }
    const p = broadcasts[0].payload
    if (p.type !== name) why.push(`payload.type ${p.type} != broadcast name ${name}`)
    if (!same(keysOf(p), KEYS[name])) why.push(`payload keys [${keysOf(p)}] != declared [${KEYS[name]}]`)
    if (p.id !== String(frame.event_id)) why.push(`id ${p.id} != ${frame.event_id}`)
    return null
  }
  if (frame.type === 'event') {
    const bad = expectOne('bsd:stats')
    if (bad) return [bad]
    const p = broadcasts[0].payload
    if (!same(p.time, frame.time)) why.push(`time ${JSON.stringify(p.time)} != frame.time ${JSON.stringify(frame.time)}`)
    if (!same(p.score, frame.score)) why.push('score differs from frame.score')
    if (!same(p.stats, frame.stats)) why.push('stats differs from frame.stats')
    if (!same(p.shotmap, frame.shotmap || null)) why.push('shotmap differs from frame.shotmap (or null when absent)')
    if (!same(p.momentum, frame.momentum || null)) why.push('momentum differs from frame.momentum (or null when absent)')
  } else if (frame.type === 'livedata') {
    const bad = expectOne('bsd:ball')
    if (bad) return [bad]
    const p = broadcasts[0].payload
    for (const k of ['uts', 'side', 'situation', 'commentary']) {
      if (!same(p[k], frame[k])) why.push(`${k} ${JSON.stringify(p[k])} != frame.${k} ${JSON.stringify(frame[k])}`)
    }
    if (!same(p.time, frame.time)) why.push(`time ${JSON.stringify(p.time)} != frame.time ${JSON.stringify(frame.time)}`)
    // `coords` is the NEWEST element: the array is a sliding window with the newest
    // position FIRST (recorded 2026-10-28, events 602352 and 602347: in 92 of 99
    // consecutive multi-point pairs the next frame is the previous one with new
    // points prepended, in 0 appended). A bare object is forwarded as it came; an
    // empty array is null, never an object.
    const newest = Array.isArray(frame.coordinates) ? (frame.coordinates[0] ?? null) : (frame.coordinates ?? null)
    if (!same(p.coords, newest)) why.push(`coords ${JSON.stringify(p.coords)} != ${JSON.stringify(newest)}`)
  } else if (broadcasts.length !== 0) {
    // Every other recorded type (ingest_debug, subscribed, odds) is NOT forwarded
    // today: ingest_debug is a server diagnostic, subscribed is the ack, odds are
    // served by REST. Pinned so a change is a decision, not an accident.
    why.push(`a ${frame.type} frame was broadcast ${broadcasts.length} time(s): [${broadcasts.map((b) => b.type).join(',')}]`)
  }
  return why
}

/** Frames out of a capture file. A line that is not JSON is COUNTED, not fatal: the
 *  recorder stores a binary message as the text "<binary N bytes ...>". */
export const framesOf = (jsonlText) => {
  const frames = []
  let unparseable = 0
  for (const line of jsonlText.trim().split('\n')) {
    if (!line.trim()) continue
    let l
    try { l = JSON.parse(line) } catch { unparseable++; continue }
    if (typeof l.raw !== 'string') continue
    try { frames.push({ raw: l.raw, frame: JSON.parse(l.raw) }) } catch { unparseable++ }
  }
  frames.unparseable = unparseable
  return frames
}

// --- synthetic frames: shapes no recording contains yet ----------------------------

const ld = (extra) => ({ type: 'livedata', event_id: 9, uts: 1793153961, side: 'home', situation: 'corner',
  time: { minute: 1, second: 0 }, commentary: 'x', ...extra })
const evt = (extra) => ({ type: 'event', event_id: 9, time: { minute: 1 }, score: { home: 0, away: 0 },
  stats: { home: {}, away: {} }, ...extra })

export const SYNTHETIC = [
  ['a populated coordinates array: coords is its FIRST (newest) element', ld({ coordinates: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }), 'frame'],
  ['a four-point window as recorded: coords is the newest, index 0', ld({ coordinates: [{ x: 94, y: 68 }, { x: 85, y: 70 }, { x: 81, y: 69 }, { x: 72, y: 47 }] }), 'frame'],
  ['a one-element coordinates array', ld({ coordinates: [{ x: 5, y: 6 }] }), 'frame'],
  ['a bare coordinates object is forwarded whole', ld({ coordinates: { x: 7, y: 8 } }), 'frame'],
  ['coordinates null', ld({ coordinates: null }), 'frame'],
  ['coordinates absent', ld({}), 'frame'],
  ['a shotmap on an event frame is forwarded', evt({ shotmap: [{ min: 3, xg: 0.1 }] }), 'frame'],
  ['a momentum series on an event frame is forwarded', evt({ momentum: [{ minute: 1, value: 2 }] }), 'frame'],
  ['an empty shotmap array reads as null (the code uses ||)', evt({ shotmap: [] }), 'frame'],
  ['an event with neither shotmap nor momentum carries both as null', evt({}), 'frame'],
  ['a missing event_id broadcasts nothing', ld({ event_id: undefined, coordinates: [] }), 'none'],
  ['a zero event_id broadcasts nothing', evt({ event_id: 0 }), 'none'],
  ['a null event_id broadcasts nothing', ld({ event_id: null, coordinates: [] }), 'none'],
  ['a frame with no type broadcasts nothing', { event_id: 9, uts: 1 }, 'none'],
]
const NON_JSON = ['not json', '<binary 3 bytes base64:AQID>', '{"type":"livedata"', '']

export const runSynthetic = (body) => {
  const failures = []
  for (const [name, frame, expect] of SYNTHETIC) {
    let broadcasts
    try { broadcasts = replay(body, JSON.stringify(frame)) } catch (e) { failures.push({ name, why: [`threw: ${e.message}`] }); continue }
    const why = expect === 'none'
      ? (broadcasts.length === 0 ? [] : [`expected no broadcast, got [${broadcasts.map((b) => b.type)}]`])
      : judge(frame, broadcasts)
    if (why.length) failures.push({ name, why })
  }
  for (const raw of NON_JSON) {
    const name = `non-JSON message ${JSON.stringify(raw)}`
    let broadcasts
    try { broadcasts = replay(body, raw) } catch (e) { failures.push({ name, why: [`threw: ${e.message}`] }); continue }
    if (broadcasts.length) failures.push({ name, why: ['broadcast something'] })
  }
  return { count: SYNTHETIC.length + NON_JSON.length, failures }
}

export const run = ({ source, files }) => {
  const body = extractOnFrame(source)
  const counts = { event: 0, livedata: 0, ingest_debug: 0, other: 0 }
  const failures = []
  const events = new Set()
  let unparseable = 0
  for (const { name, text } of files) {
    const frames = framesOf(text)
    unparseable += frames.unparseable
    for (const { raw, frame } of frames) {
      counts[frame.type in counts ? frame.type : 'other']++
      if (frame.event_id !== undefined) events.add(String(frame.event_id))
      const why = judge(frame, replay(body, raw))
      if (why.length) failures.push({ file: name, type: frame.type, uts: frame.uts, why })
    }
  }
  const synthetic = runSynthetic(body)
  const empty = []
  if (counts.event === 0) empty.push('no event frames judged')
  if (counts.livedata === 0) empty.push('no livedata frames judged')
  return { counts, failures, empty, files: files.length, events: [...events].sort(), unparseable, synthetic }
}

const report = (r) => {
  const one = r.events.length === 1
  console.log(`RECORDED: checked ${r.counts.event} event, ${r.counts.livedata} livedata, ${r.counts.ingest_debug} ingest_debug ` +
    `and ${r.counts.other} other frames from ${r.files} capture file(s); ${r.events.length} distinct event id(s): ${r.events.join(', ')}` +
    `${one ? ' (ONE match: its league and tier are the only ones measured)' : ''}; ${r.unparseable} unparseable line(s) counted, not judged`)
  console.log(`SYNTHETIC: ${r.synthetic.count} constructed cases (shapes no recording contains), ${r.synthetic.failures.length} failed`)
  for (const f of r.failures.slice(0, 8)) console.log(`  FAIL ${f.type} uts=${f.uts ?? '-'}: ${f.why.join('; ')}`)
  if (r.failures.length > 8) console.log(`  ... and ${r.failures.length - 8} more`)
  for (const f of r.synthetic.failures) console.log(`  FAIL synthetic "${f.name}": ${f.why.join('; ')}`)
  for (const e of r.empty) console.log(`  FAIL ${e}: a run that judged nothing proves nothing`)
  const bad = r.failures.length + r.empty.length + r.synthetic.failures.length
  console.log(bad === 0
    ? "OK: the payload built from every recorded frame carries the frame's fields under the frame's own names, and nothing else (socket delivery is not covered)"
    : `FAILED: ${r.failures.length} recorded frame(s) misrepresented, ${r.synthetic.failures.length} synthetic case(s), ${r.empty.length} empty denominator(s)`)
  return bad === 0 ? 0 : 1
}

// --- self-test -----------------------------------------------------------------

const selfTest = () => {
  let failed = 0
  const ok = (name, cond, detail = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`)
    if (!cond) failed++
  }
  const wrap = (body) => `class X {\n    ${body}\n    async _bsdSubscribe() {}\n}`
  // The function as it stood before the fix, kept as a fixture so this check can
  // never lose the ability to go red on the shape that shipped.
  const OLD = readFileSync(new URL('./fixtures/bsd-onframe-pre-fix.txt', import.meta.url), 'utf8')
  // A conforming function, written independently of the real one.
  // Like the real one, the whole body sits in try/catch: a throw is swallowed and
  // nothing is broadcast.
  const GOOD = `_bsdOnFrame(rawData) {
    try {
    const f = JSON.parse(rawData);
    if (!f?.type || !f.event_id) return;
    if (f.type === 'event') this._broadcast('bsd:stats', { type: 'bsd:stats', id: String(f.event_id), time: f.time, score: f.score, stats: f.stats, shotmap: f.shotmap || null, momentum: f.momentum || null });
    else if (f.type === 'livedata') this._broadcast('bsd:ball', { type: 'bsd:ball', id: String(f.event_id), uts: f.uts, side: f.side,
      situation: f.situation, time: f.time, commentary: f.commentary, coords: Array.isArray(f.coordinates) ? (f.coordinates[0] || null) : (f.coordinates || null) });
    } catch (_) {}
  }`
  const ev = { type: 'event', event_id: 7, time: { minute: 48, period: '2T', status: '2nd_half' }, score: { home: 1, away: 0 }, stats: { home: { fouls: 3 }, away: { fouls: 4 } } }
  const ldf = { type: 'livedata', event_id: 7, uts: 1793153961, side: 'away', situation: 'freekick', time: { minute: 45, second: 0, period: 2 }, coordinates: [], commentary: 'x' }
  const dbg = { type: 'ingest_debug', event_id: 7, raw_count: 0 }
  const odds = { type: 'odds', event_id: 7, odds: {} }
  const text = [ev, ldf, dbg, odds].map((f) => JSON.stringify({ t: 1, raw: JSON.stringify(f) })).join('\n')
  const files = [{ name: 'fixture', text }]
  const R = (src, f = files) => run({ source: wrap(src), files: f })

  const good = R(GOOD)
  ok('a conforming function passes, recorded and synthetic, with visible denominators',
    good.failures.length === 0 && good.empty.length === 0 && good.synthetic.failures.length === 0 && good.counts.event === 1 &&
    good.counts.livedata === 1 && good.counts.ingest_debug === 1 && good.counts.other === 1 && good.events.join() === '7', JSON.stringify(good))
  const old = R(OLD)
  ok('the pre-fix function FAILS: event frames lose time, livedata loses side/time/commentary',
    old.failures.some((f) => f.type === 'event' && f.why.some((w) => w.startsWith('time'))) &&
    old.failures.some((f) => f.type === 'livedata' && f.why.some((w) => w.startsWith('side'))), JSON.stringify(old.failures))
  ok('a capture with no livedata frames cannot pass', R(GOOD, [{ name: 'f', text: JSON.stringify({ t: 1, raw: JSON.stringify(ev) }) }]).empty.includes('no livedata frames judged'))
  ok('a capture with no frames at all cannot pass', R(GOOD, [{ name: 'f', text: JSON.stringify({ socketEvent: { kind: 'open' } }) }]).empty.length === 2)

  // one field at a time: a function that drops or corrupts exactly that field must
  // fail on exactly that field, or the comparison for it is not really there
  const failsOn = (mutated, type, key) => R(mutated).failures.some((f) => f.type === type && f.why.some((w) => w.startsWith(key)))
  const SPLIT = "else if (f.type === 'livedata')"
  const dropIn = (branch, k) => {
    const [evp, ball] = GOOD.split(SPLIT)
    const re = new RegExp(`\\b${k}: f\\.${k}`)
    const part = branch === 'event' ? evp : ball
    if (!re.test(part)) throw new Error(`self-test fixture has no ${k} in the ${branch} branch`)
    const mutated = part.replace(re, `__${k}: 0`)
    return branch === 'event' ? mutated + SPLIT + ball : evp + SPLIT + mutated
  }
  for (const k of ['uts', 'side', 'situation', 'time', 'commentary']) ok(`a bsd:ball without ${k} fails on ${k}`, failsOn(dropIn('livedata', k), 'livedata', k))
  for (const k of ['time', 'score', 'stats']) ok(`a bsd:stats without ${k} fails on ${k}`, failsOn(dropIn('event', k), 'event', k))
  const synthFails = (src, nameStart) => R(src).synthetic.failures.some((f) => f.name.startsWith(nameStart))
  ok('a bsd:stats that drops a present shotmap fails (synthetic)', synthFails(GOOD.replace('shotmap: f.shotmap || null', 'shotmap: null'), 'a shotmap on an event'))
  ok('a bsd:stats that drops a present momentum fails (synthetic)', synthFails(GOOD.replace('momentum: f.momentum || null', 'momentum: null'), 'a momentum series'))
  ok('a bsd:stats that swaps shotmap and momentum fails (synthetic)',
    synthFails(GOOD.replace('shotmap: f.shotmap || null, momentum: f.momentum || null', 'shotmap: f.momentum || null, momentum: f.shotmap || null'), 'a shotmap on an event'))
  ok('coordinates that always read null fail (synthetic)',
    synthFails(GOOD.replace('coords: Array.isArray(f.coordinates) ? (f.coordinates[0] || null) : (f.coordinates || null)', 'coords: null'), 'a populated coordinates'))
  ok('coordinates that take the LAST (oldest) element fail (synthetic)', synthFails(GOOD.replace('(f.coordinates[0] || null)', '(f.coordinates.slice(-1)[0] || null)'), 'a populated coordinates'))
  ok('coordinates that take the last element fail on the four-point window as recorded (synthetic)', synthFails(GOOD.replace('(f.coordinates[0] || null)', '(f.coordinates.slice(-1)[0] || null)'), 'a four-point window'))
  ok('a bare coordinates object that is dropped fails (synthetic)', synthFails(GOOD.replace(': (f.coordinates || null)', ': null'), 'a bare coordinates'))
  ok('empty coordinates that become an object fail on coords (recorded)', failsOn(GOOD.replace('(f.coordinates[0] || null)', '(f.coordinates[0] || {})'), 'livedata', 'coords'))
  ok('a broadcast for a missing event_id fails (synthetic)', synthFails(GOOD.replace('if (!f?.type || !f.event_id) return;', 'if (!f?.type) return;'), 'a missing event_id'))
  ok('a function that broadcasts on a non-JSON message fails (synthetic)',
    R(GOOD.replace('} catch (_) {}', "} catch (_) { this._broadcast('bsd:ball', {}); }")).synthetic.failures.some((f) => f.name.startsWith('non-JSON')))
  ok('a function that lets a non-JSON message throw out of the method fails (synthetic)',
    R(GOOD.replace('try {\n    const f', 'if (true) {\n    const f').replace('} catch (_) {}', '}')).synthetic.failures.some((f) => f.name.startsWith('non-JSON') && f.why[0].startsWith('threw')))
  ok('an undeclared assignment fails: strict mode makes it throw, the method swallows it, nothing is broadcast',
    R(GOOD.replace('if (!f?.type', 'leakedGlobal = 1; if (!f?.type')).failures.length > 0)

  // Rule 47: nothing but the declared keys
  ok('a computed extra key on bsd:stats fails', failsOn(GOOD.replace('momentum: f.momentum || null }', 'momentum: f.momentum || null, drama: 1 }'), 'event', 'payload keys'))
  ok('a computed extra key on bsd:ball fails', failsOn(GOOD.replace('commentary: f.commentary, coords', 'commentary: f.commentary, watch: 1, coords'), 'livedata', 'payload keys'))
  ok('a flattened minute beside time on bsd:stats fails', failsOn(GOOD.replace('time: f.time, score', 'time: f.time, minute: f.time.minute, score'), 'event', 'payload keys'))

  // the broadcast name and the payload.type
  ok('a wrong broadcast name fails the count clause', R(GOOD.replace("this._broadcast('bsd:stats',", "this._broadcast('bsd:other',")).failures.some((f) => f.type === 'event'))
  ok('a payload.type that differs from the broadcast name fails', failsOn(GOOD.replace("{ type: 'bsd:stats'", "{ type: 'bsd:statz'"), 'event', 'payload.type'))
  ok('a bsd:stats with the wrong id fails on id', failsOn(GOOD.replace('id: String(f.event_id), time: f.time', "id: 'x', time: f.time"), 'event', 'id'))
  ok('a bsd:ball with the wrong id fails on id', failsOn(GOOD.replace('id: String(f.event_id), uts', "id: 'x', uts"), 'livedata', 'id'))
  const twice = GOOD.replace(SPLIT, "if (f.type === 'event') this._broadcast('bsd:stats', {});\n    " + SPLIT)
  ok('an event frame broadcast twice fails the count', R(twice).failures.some((f) => f.type === 'event' && f.why[0].includes('2 broadcast')))
  ok('a livedata frame that broadcasts nothing fails the count',
    R(GOOD.replace("else if (f.type === 'livedata') this._broadcast", 'else if (false) this._broadcast')).failures.some((f) => f.type === 'livedata' && f.why[0].includes('0 broadcast')))
  ok('an event frame that broadcasts nothing fails the count',
    R(GOOD.replace("if (f.type === 'event') this._broadcast", 'if (false) this._broadcast')).failures.some((f) => f.type === 'event' && f.why[0].includes('0 broadcast')))

  // other frame types are pinned as not forwarded
  const leaky = GOOD.replace(SPLIT, "else if (f.type === 'ingest_debug') this._broadcast('bsd:debug', f);\n    " + SPLIT)
  ok('an ingest_debug frame reaching a client fails', R(leaky).failures.some((f) => f.type === 'ingest_debug'))
  const leakyOdds = GOOD.replace(SPLIT, "else if (f.type === 'odds') this._broadcast('bsd:odds', f);\n    " + SPLIT)
  ok('an odds frame reaching a client fails', R(leakyOdds).failures.some((f) => f.type === 'odds'))

  // capture files
  const withBinary = text + '\n' + JSON.stringify({ t: 2, raw: '<binary 3 bytes base64:AQID>' }) + '\nnot a json line'
  const rb = R(GOOD, [{ name: 'f', text: withBinary }])
  ok('a binary message and a broken line are counted as unparseable, not fatal', rb.unparseable === 2 && rb.failures.length === 0, JSON.stringify({ u: rb.unparseable, f: rb.failures }))
  const two = R(GOOD, [{ name: 'a', text }, { name: 'b', text: text.replaceAll('\\"event_id\\":7', '\\"event_id\\":8') }])
  ok('the distinct event ids are derived from the frames, not written down', two.events.join() === '7,8', two.events.join())

  const throws = (src) => { try { extractOnFrame(src); return '' } catch (e) { return e.message } }
  ok('a source with neither anchor throws', /matched 0 times/.test(throws('no such method')))
  ok('a source with the end anchor but no _bsdOnFrame throws naming the start anchor', throws('class X { async _bsdSubscribe() {} }').includes(START))
  ok('a source with _bsdOnFrame but no following method throws naming the end anchor', throws('class X { _bsdOnFrame(rawData) { } }').includes(END))
  ok('a duplicated start anchor throws naming it', throws(wrap(GOOD) + wrap(GOOD)).includes(`"${START}" matched 2`))
  ok('a duplicated end anchor throws naming it', throws(`class X { ${GOOD} async _bsdSubscribe() {} async _bsdSubscribe() {} }`).includes(`"${END}" matched 2`))
  ok('the next method coming first throws', /comes before/.test(throws(`class X { async _bsdSubscribe() {} ${GOOD} }`)))
  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
  return failed === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) process.exit(selfTest())
  const arg = (flag) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : null }
  const source = readFileSync(arg('--source') ?? new URL('../src/ambient-do.js', import.meta.url), 'utf8')
  const explicit = process.argv.indexOf('--frames') > -1 ? process.argv.slice(process.argv.indexOf('--frames') + 1) : null
  const names = explicit ?? readdirSync(new URL('../outbox/', import.meta.url)).filter((n) => /^bsd-ws-frames-.*\.jsonl$/.test(n))
    .map((n) => new URL(`../outbox/${n}`, import.meta.url).pathname)
  process.exit(report(run({ source, files: names.map((name) => ({ name, text: readFileSync(name, 'utf8') })) })))
}
