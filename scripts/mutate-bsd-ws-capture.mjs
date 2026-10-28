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
  ['a socket that closed early is called captured', "return ended === 'duration-and-frames' ? 'captured' : 'incomplete'", "return 'captured'"],
  ['an abnormal close is not followed by a reconnect', 'if (reconnects < maxReconnects && now() - t0 < hardCapMs) {', 'if (false) {'],
  ['reconnects are unbounded', 'if (reconnects < maxReconnects && now() - t0 < hardCapMs) {', 'if (now() - t0 < hardCapMs) {'],
  ['livedata inside a subscribed ack is not analysed', 'for (const el of o.livedata) if (isObj(el)) units.push(el)', ''],
  ['restart counters match every stat key', '!RESTART_RE.test(k) || typeof st[k]', 'typeof st[k]'],
  ['restart counters never record a change', 'if (st[k] !== c.last) {', 'if (false) {'],
  ['ingest_debug raw_count is not summed', 'rawCountSum: dbg.reduce((a, o) => a + (Number(o.raw_count) || 0), 0)', 'rawCountSum: 0'],
  ['ingest_debug advanced_uts is not counted', "advancedTrue: dbg.filter((o) => o.advanced_uts === true).length", 'advancedTrue: 0'],
  ['empty coordinate arrays read as a ball trail', "else if (maxElements === 0) verdict = 'COORDINATES-EMPTY'", 'else if (false) verdict = \'COORDINATES-EMPTY\''],
  ['livedata situations are not counted', "if (o.type === 'livedata') bump(situations,", "if (false) bump(situations,"],
  ['the event period type flip is not recorded', "bump(eventTimePeriodValues, JSON.stringify(o.time.period))", "bump(eventTimePeriodValues, '\"x\"')"],
  ['incident types are summed over repeated pulls', "out[k] = Math.max(out[k] ?? 0, typeof v === 'number' ? v : 1)", "out[k] = (out[k] ?? 0) + (typeof v === 'number' ? v : 1)"],
  ['reanalysis keeps the stale state', 'art.state = stateOf({ ended: art.ended, frames })', 'art.state = art.state'],
  ['the league filter is ignored', "(leagueIds.length === 0 || leagueIds.includes(Number(r.league_id)))", 'true'],
  ['an empty league filter excludes everything', 'leagueIds.length === 0 ||', 'false ||'],
  ['a feed with no events array reads as an empty slate', "if (!Array.isArray(body?.events)) throw new Error('live feed has no events array')", ''],
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
