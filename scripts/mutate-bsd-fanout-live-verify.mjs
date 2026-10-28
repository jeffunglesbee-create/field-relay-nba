#!/usr/bin/env node
// Rule 90 for scripts/bsd-fanout-live-verify.mjs. Each mutation is a way the live
// verifier could pass while the deployed fan-out is wrong; every one must turn its
// --self-test red. Baseline first: a self-test already red "catches" everything.
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const T = 'scripts/bsd-fanout-live-verify.mjs'
const MUTATIONS = [
  ['the subscribe answer is not checked', "subscribeResponse?.ok === true && String(subscribeResponse?.subscribed) === id", 'true'],
  ['the subscribed id is not compared', "&& String(subscribeResponse?.subscribed) === id", ''],
  ['zero bsd:stats passes the arrival assertion', "['at least one bsd:stats arrived through the relay', stats.length > 0]", "['at least one bsd:stats arrived through the relay', true]"],
  ['bsd:stats key set not compared', "keyset(e.data) === KEYS['bsd:stats'].join(',')", 'true'],
  ['bsd:stats time object not required', "isObj(e.data?.time) && typeof e.data.time.minute === 'number'", 'true'],
  ['a top-level minute/period is tolerated', "!('minute' in e.data) && !('period' in e.data)", 'true'],
  ['bsd:stats id not compared', "stats.every((e) => e.data?.id === id)", 'true'],
  ['bsd:ball key set not compared', "keyset(e.data) === KEYS['bsd:ball'].join(',')", 'true'],
  ['bsd:ball coords may be anything', "e.data?.coords === null || (isObj(e.data?.coords) && Object.keys(e.data.coords).sort().join() === 'x,y' &&\n        Number.isInteger(e.data.coords.x) && Number.isInteger(e.data.coords.y))", 'true'],
  ['bsd:ball coords integers not required', "Number.isInteger(e.data.coords.x) && Number.isInteger(e.data.coords.y)))],", "true))],"],
  ['bsd:ball coords key set not required', "Object.keys(e.data.coords).sort().join() === 'x,y' &&", ''],
  ['bsd:ball side not required', "['home', 'away'].includes(e.data?.side) && ", ''],
  ['bsd:ball commentary type not required', " && typeof e.data?.commentary === 'string'", ''],
  ['bsd:ball id not compared', "balls.every((e) => e.data?.id === id)", 'true'],
  ['a broken JSON stats event is parseable', "stats.every((e) => isObj(e.data))],", 'true],'],
  ['no event reads as a pass', "if (!event) return 'no-qualifying-event'", "if (!event) return 'verified'"],
  ['zero frames reads as verified', "if (assessed.counts.stats === 0) return 'no-frames-through-relay'", ''],
  ['failed assertions read as verified', "return assessed.checks.every((c) => c.pass) ? 'verified' : 'assertions-failed'", "return 'verified'"],
  ['the SSE parser drops the unparseable flag', "out.push({ event, data: null, unparseable: true })", 'out.push({ event, data: {} })'],
]

const base = spawnSync('node', [T, '--self-test'], { encoding: 'utf8', timeout: 60000 })
if (base.status !== 0) { console.log('FAIL: --self-test is not green on clean source; no mutation result would mean anything'); process.exit(1) }
console.log('baseline: --self-test passes on clean source\n')

const original = readFileSync(T, 'utf8')
let survivors = 0, unapplied = 0
try {
  for (const [name, from, to] of MUTATIONS) {
    const hits = original.split(from).length - 1
    if (hits !== 1) { console.log(`NOT APPLIED  ${name}: anchor matched ${hits} times — NOTHING MUTATED`); unapplied++; continue }
    writeFileSync(T, original.replace(from, () => to))
    if (readFileSync(T, 'utf8') === original) { console.log(`NOT APPLIED  ${name}: file unchanged on disk`); unapplied++; continue }
    const r = spawnSync('node', [T, '--self-test'], { encoding: 'utf8', timeout: 60000 })
    const caught = r.status !== 0
    if (!caught) survivors++
    console.log(`${caught ? 'caught      ' : 'NOT CAUGHT  '} ${name}`)
  }
} finally {
  writeFileSync(T, original)
}
if (readFileSync(T, 'utf8') !== original) { console.log(`FAIL: ${T} was not restored`); process.exit(1) }
console.log(`${MUTATIONS.length} mutations: ${MUTATIONS.length - survivors - unapplied} caught, ${survivors} survived, ${unapplied} not applied`)
process.exit(survivors || unapplied ? 1 : 0)
