#!/usr/bin/env node
// Rule 90 for scripts/bsd-ws-capture.mjs. Each mutation is a way the recorder or
// the analyzer could pass its self-test while broken; every one must turn
// --self-test red.
//
// The ones that matter most: the tier filter (a match without websocket_plus
// proves nothing about the tier), the per-uts pooling (counting identifiers over
// the whole capture would call a one-player-per-frame feed off-ball-instant),
// and the redaction (the token must never reach an artifact).
//
// Anchor discipline: exactly one match asserted before mutating, the original
// restored and confirmed byte-identical afterwards. NOT CAUGHT with nothing
// mutated is worse than no test.

import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const TARGET = 'scripts/bsd-ws-capture.mjs'
const MUTATIONS = [
  ['a row without the tracking tier is eligible', 'r.websocket_plus === true && r.status', 'r.status'],
  ['a finished match is eligible', "r.status === 'inprogress' && r.id != null", 'r.id != null'],
  ['a halftime row is preferred over a match in play', "r.period !== 'halftime'", "r.period === 'halftime'"],
  ['two identifiers at one uts no longer read off-ball', 'else if (maxIdsAtOneUts >= 2)', 'else if (maxIdsAtOneUts >= 3)'],
  ['identifiers are pooled over the whole capture, not per uts', "const uts = o.uts ?? '<no uts>'", "const uts = 'all'"],
  ['an identifier-less feed is not reported as such', 'else if (Object.keys(idKeySeen).length === 0)', 'else if (false)'],
  ['a zero-frame capture reads as something other than NO-FRAMES', "if (frames.length === 0) verdict = 'NO-FRAMES'", "if (false) verdict = 'NO-FRAMES'"],
  ['a bare-object coordinates field is dropped', 'else if (isObj(c)) { coord.object++; elements = [c] }', 'else if (false) { coord.object++; elements = [c] }'],
  ['stat KEYS are scanned for restart events', 'walkStrings(o, \'\', strings)', 'walkStrings(Object.keys(o), \'\', strings)'],
  ['the uts unit is not read from magnitude', "sorted[sorted.length - 1] >= 1e12 ? 'epoch milliseconds'", "sorted[sorted.length - 1] >= 1e15 ? 'epoch milliseconds'"],
  ['a repeated uts is counted as another clock value', 'new Set(utsVals)', 'utsVals'],
  ['the recorder subscribes with a string id', 'event_id: Number(eventId)', 'event_id: String(eventId)'],
  ['the recorder keeps only livedata and event frames', "frames.push({ t: now() - t0, raw: rawBytes > RAW_BYTES_CAP ? raw.slice(0, 200) : raw })", "if (/\"type\":\"(livedata|event)\"/.test(raw)) frames.push({ t: now() - t0, raw })"],
  ['a binary frame is dropped instead of recorded', "const raw = typeof d === 'string' ? d", "if (typeof d !== 'string') return\n    const raw = typeof d === 'string' ? d"],
  ['the hard cap never ends a silent socket', "if (elapsed >= hardCapMs) return finish('hard-cap')", ''],
  ['the frame floor is ignored', 'elapsed >= durationMs && frames.length >= minFrames', 'elapsed >= durationMs'],
  ['the token is not redacted', "token ? String(text).split(token).join('***') : String(text)", 'String(text)'],
  ['a socket error is not recorded', "log('error', { message: redact(evt?.message", "void ({ message: redact(evt?.message"],
]

const original = readFileSync(TARGET, 'utf8')
let survivors = 0, unapplied = 0
try {
  for (const [name, from, to] of MUTATIONS) {
    const hits = original.split(from).length - 1
    if (hits !== 1) { console.log(`NOT APPLIED  ${name}: anchor matched ${hits} times — NOTHING MUTATED`); unapplied++; continue }
    writeFileSync(TARGET, original.replace(from, () => to))
    if (readFileSync(TARGET, 'utf8') === original) { console.log(`NOT APPLIED  ${name}: file unchanged on disk`); unapplied++; continue }
    const r = spawnSync('node', [TARGET, '--self-test'], { encoding: 'utf8', timeout: 60000 })
    const caught = r.status !== 0
    if (!caught) survivors++
    console.log(`${caught ? 'caught      ' : 'NOT CAUGHT  '} ${name}`)
  }
} finally {
  writeFileSync(TARGET, original)
}
if (readFileSync(TARGET, 'utf8') !== original) { console.log(`FAIL: ${TARGET} was not restored`); process.exit(1) }
console.log(`${MUTATIONS.length} mutations: ${MUTATIONS.length - survivors - unapplied} caught, ${survivors} survived, ${unapplied} not applied`)
process.exit(survivors || unapplied ? 1 : 0)
