#!/usr/bin/env node
// Rule 90 for scripts/check-bsd-ws-fanout.mjs, in two halves.
//
// HALF 1 breaks the REAL src/ambient-do.js (in a temp copy, via --source) the way
// it was broken: each mutation un-does one thing the fix did, and the check must go
// red on the recorded frames. HALF 2 breaks the CHECK, and its --self-test must go
// red. A check that has only ever passed has proven nothing.
//
// Anchor discipline: exactly one match asserted before mutating; the original
// restored and confirmed byte-identical. NOT CAUGHT with nothing mutated is worse
// than no test.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const CHECK = 'scripts/check-bsd-ws-fanout.mjs'
const SRC = 'src/ambient-do.js'

const SOURCE_MUTATIONS = [
  ['bsd:stats goes back to frame.minute / frame.period', 'time: frame.time, score: frame.score, stats: frame.stats,', 'minute: frame.minute, period: frame.period, score: frame.score, stats: frame.stats,'],
  ['bsd:stats drops the time object', 'time: frame.time, score: frame.score, stats: frame.stats,', 'score: frame.score, stats: frame.stats,'],
  ['bsd:stats drops the score', 'time: frame.time, score: frame.score, stats: frame.stats,', 'time: frame.time, stats: frame.stats,'],
  ['bsd:stats drops a present shotmap', 'shotmap: frame.shotmap || null,', 'shotmap: null,'],
  ['bsd:stats drops a present momentum', 'momentum: frame.momentum || null }', 'momentum: null }'],
  ['bsd:stats carries a computed extra key', 'momentum: frame.momentum || null }', 'momentum: frame.momentum || null, drama: 1 }'],
  ['bsd:ball drops side', 'side: frame.side, time: frame.time, commentary: frame.commentary }', 'time: frame.time, commentary: frame.commentary }'],
  ['bsd:ball drops time', 'side: frame.side, time: frame.time, commentary: frame.commentary }', 'side: frame.side, commentary: frame.commentary }'],
  ['bsd:ball drops commentary', 'side: frame.side, time: frame.time, commentary: frame.commentary }', 'side: frame.side, time: frame.time }'],
  ['bsd:ball drops situation', 'situation: frame.situation,\n', '\n'],
  ['bsd:ball carries a computed extra key', 'side: frame.side, time: frame.time, commentary: frame.commentary }', 'side: frame.side, time: frame.time, commentary: frame.commentary, watch: 1 }'],
  ['an empty coordinates array becomes an object', '? (frame.coordinates[0] || null)', '? (frame.coordinates[0] || {})'],
  ['coords takes the LAST element, which is the OLDEST point of the window', '? (frame.coordinates[0] || null)', '? (frame.coordinates.slice(-1)[0] || null)'],
  ['coords takes the second element', '? (frame.coordinates[0] || null)', '? (frame.coordinates[1] || null)'],
  ['coords is always null', '? (frame.coordinates[0] || null)', '? null'],
  ['a bare coordinates object is dropped', ': (frame.coordinates || null),', ': null,'],
  ['the event id stops being a string', "const eventId = String(frame.event_id || '');", 'const eventId = frame.event_id;'],
  ['a missing event id still broadcasts', 'if (!eventId) return;', ''],
  ['ingest_debug frames are broadcast to clients', "if (frame.type !== 'livedata' && frame.type !== 'event') return;", "if (frame.type !== 'livedata' && frame.type !== 'event' && frame.type !== 'ingest_debug') return;"],
  ['odds frames are broadcast to clients', "if (frame.type !== 'livedata' && frame.type !== 'event') return;", "if (frame.type !== 'livedata' && frame.type !== 'event' && frame.type !== 'odds') return;"],
  ['an undeclared assignment (throws in strict mode, swallowed by the method)', 'const frame = JSON.parse(rawData);', 'const frame = JSON.parse(rawData); leakedGlobal = 1;'],
]

const CHECK_MUTATIONS = [
  ['the event time comparison is removed', "if (!same(p.time, frame.time)) why.push(`time ${JSON.stringify(p.time)} != frame.time ${JSON.stringify(frame.time)}`)\n    if (!same(p.score", 'if (!same(p.score'],
  ['the ball side comparison is removed', "for (const k of ['uts', 'side', 'situation', 'commentary'])", "for (const k of ['uts', 'situation', 'commentary'])"],
  ['the ball commentary comparison is removed', "for (const k of ['uts', 'side', 'situation', 'commentary'])", "for (const k of ['uts', 'side', 'situation'])"],
  ['the coords comparison is removed', 'if (!same(p.coords, newest)) why.push', 'if (false) why.push'],
  ['the shotmap comparison is removed', "if (!same(p.shotmap, frame.shotmap || null)) why.push", 'if (false) why.push'],
  ['the momentum comparison is removed', "if (!same(p.momentum, frame.momentum || null)) why.push", 'if (false) why.push'],
  ['the id comparison is removed', "if (p.id !== String(frame.event_id)) why.push(`id ${p.id} != ${frame.event_id}`)", 'void 0'],
  ['the payload.type comparison is removed', "if (p.type !== name) why.push(", 'if (false) why.push('],
  ['the exact key set comparison is removed', 'if (!same(keysOf(p), KEYS[name])) why.push', 'if (false) why.push'],
  ['another frame type being broadcast is allowed', '} else if (broadcasts.length !== 0) {', '} else if (false) {'],
  ['zero livedata frames can pass', "if (counts.livedata === 0) empty.push('no livedata frames judged')", ''],
  ['zero event frames can pass', "if (counts.event === 0) empty.push('no event frames judged')", ''],
  ['a missing start anchor does not throw', 'if (count(START) !== 1) throw', 'if (false) throw'],
  ['a duplicated end anchor does not throw', 'if (count(END) !== 1) throw', 'if (false) throw'],
  ['anchors in the wrong order do not throw', 'if (b <= a) throw', 'if (false) throw'],
  ['a wrong broadcast count passes', "if (broadcasts.length !== 1 || broadcasts[0].type !== name) {", 'if (false) {'],
  ['the replay runs in sloppy mode', "const Cls = new Function(`return class { ${body} }`)()\n  const host = new Cls()", "const host = new Function(`return ({ ${body} })`)()"],
  ['an unparseable line crashes the run', 'try { l = JSON.parse(line) } catch { unparseable++; continue }', 'l = JSON.parse(line)'],
  ['the distinct event ids are written down instead of derived', 'if (frame.event_id !== undefined) events.add(String(frame.event_id))', "events.add('602466')"],
  ['the synthetic cases are not run', 'const synthetic = runSynthetic(body)', 'const synthetic = { count: 0, failures: [] }'],
  ['a non-JSON message is not replayed', 'for (const raw of NON_JSON) {', 'for (const raw of []) {'],
]

const readOrig = (f) => readFileSync(f, 'utf8')
let survivors = 0, unapplied = 0, total = 0
const orig = { [CHECK]: readOrig(CHECK) }
const srcText = readOrig(SRC)
const tmp = mkdtempSync(`${tmpdir()}/fanout-mut-`)

// BASELINE FIRST. A check whose --self-test is already red, or whose run on the real
// source is already red, "catches" every mutation for the wrong reason; that is how
// a syntax error in this very file once read as 22 of 22 caught.
const base1 = spawnSync('node', [CHECK, '--self-test'], { encoding: 'utf8', timeout: 60000 })
const base2 = spawnSync('node', [CHECK], { encoding: 'utf8', timeout: 60000 })
if (base1.status !== 0 || base2.status !== 0) {
  console.log(`FAIL: baseline is not green (self-test exit ${base1.status}, real-source run exit ${base2.status}); no mutation result would mean anything`)
  process.exit(1)
}
console.log('baseline: --self-test and the real-source run both pass on clean source\n')

try {
  // HALF 1: the real source, mutated in a copy
  for (const [name, from, to] of SOURCE_MUTATIONS) {
    total++
    const hits = srcText.split(from).length - 1
    if (hits !== 1) { console.log(`NOT APPLIED  ${name}: anchor matched ${hits} times — NOTHING MUTATED`); unapplied++; continue }
    const copy = `${tmp}/ambient-do.mutated.js`
    writeFileSync(copy, srcText.replace(from, () => to))
    if (readFileSync(copy, 'utf8') === srcText) { console.log(`NOT APPLIED  ${name}: copy unchanged`); unapplied++; continue }
    const r = spawnSync('node', [CHECK, '--source', copy], { encoding: 'utf8', timeout: 60000 })
    const caught = r.status !== 0
    if (!caught) survivors++
    console.log(`${caught ? 'caught      ' : 'NOT CAUGHT  '} [source] ${name}`)
  }
  // HALF 2: the check itself
  for (const [name, from, to] of CHECK_MUTATIONS) {
    total++
    const hits = orig[CHECK].split(from).length - 1
    if (hits !== 1) { console.log(`NOT APPLIED  ${name}: anchor matched ${hits} times — NOTHING MUTATED`); unapplied++; continue }
    writeFileSync(CHECK, orig[CHECK].replace(from, () => to))
    if (readFileSync(CHECK, 'utf8') === orig[CHECK]) { console.log(`NOT APPLIED  ${name}: file unchanged on disk`); unapplied++; continue }
    const r = spawnSync('node', [CHECK, '--self-test'], { encoding: 'utf8', timeout: 60000 })
    const caught = r.status !== 0
    if (!caught) survivors++
    console.log(`${caught ? 'caught      ' : 'NOT CAUGHT  '} [check]  ${name}`)
  }
} finally {
  writeFileSync(CHECK, orig[CHECK])
}
if (readFileSync(CHECK, 'utf8') !== orig[CHECK]) { console.log(`FAIL: ${CHECK} was not restored`); process.exit(1) }
console.log(`${total} mutations: ${total - survivors - unapplied} caught, ${survivors} survived, ${unapplied} not applied`)
process.exit(survivors || unapplied ? 1 : 0)
