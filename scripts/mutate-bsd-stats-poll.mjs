#!/usr/bin/env node
// Rule 90 for scripts/check-bsd-stats-poll.mjs, in two halves (the shape of mutate-bsd-ws-fanout.mjs).
//
// HALF 1 breaks the REAL src/ambient-do.js (in a temp copy, via --source) the ways a poll that spends API
// quota can be broken, and the check must go red on each. HALF 2 breaks the check's own anchor discipline,
// and its --self-test must go red. A poll whose check has only ever passed has proven nothing, and this poll
// spends an allowance nobody can read.
//
// Anchor discipline: exactly one match asserted before mutating; the original restored and confirmed
// byte-identical. NOT APPLIED is a failure, not a pass. Baseline first: a check that is already red would
// "catch" every mutation for the wrong reason.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const CHECK = 'scripts/check-bsd-stats-poll.mjs'
const SRC = 'src/ambient-do.js'

const SOURCE_MUTATIONS = [
  // the cap
  ['the cap is off by one (601 calls)', 'if (st.calls >= BSD_POLL_DAILY_CAP) {', 'if (st.calls > BSD_POLL_DAILY_CAP) {'],
  ['the cap is ten times larger', 'const BSD_POLL_DAILY_CAP = 600;', 'const BSD_POLL_DAILY_CAP = 6000;'],
  ['the cap is never checked', 'if (st.calls >= BSD_POLL_DAILY_CAP) {', 'if (false) {'],
  ['calls are never counted', '            st.calls++;\n', ''],
  ['the call is stored AFTER the request, not before', '            await this.ctx.storage.put(BSD_POLL_STORAGE_KEY, st);   // counted and stored BEFORE the request is made\n            await this._bsdPollOne(id, st);', '            await this._bsdPollOne(id, st);\n            await this.ctx.storage.put(BSD_POLL_STORAGE_KEY, st);'],
  ['the call is never stored', '            await this.ctx.storage.put(BSD_POLL_STORAGE_KEY, st);   // counted and stored BEFORE the request is made\n', ''],
  ['a failing storage write is swallowed and the request is made anyway', '            await this.ctx.storage.put(BSD_POLL_STORAGE_KEY, st);   // counted and stored BEFORE the request is made', '            try { await this.ctx.storage.put(BSD_POLL_STORAGE_KEY, st); } catch (_) { /* mutated */ }'],
  ['the cap announcement repeats every round', 'if (!st.capReachedAt) {', 'if (true) {'],
  // the day
  ['the UTC day never rolls over', "if (st.day !== day) { st.day = day; st.calls = 0; st.stopped = null; st.capReachedAt = null; }", "if (st.day === null) { st.day = day; }"],
  ['a stop survives the day', 'st.calls = 0; st.stopped = null; st.capReachedAt = null; }', 'st.calls = 0; st.capReachedAt = null; }'],
  ['the day is read in local time of a fixed offset', "new Date(now).toISOString().slice(0, 10)", "new Date(now - 6 * 3600 * 1000).toISOString().slice(0, 10)"],
  // the stops
  ['a 429 no longer stops the poll', 'if (r.status === 429 || r.status === 401', 'if (r.status === 4290 || r.status === 401'],
  ['a 403 no longer stops the poll', '|| r.status === 402 || r.status === 403) {', '|| r.status === 402) {'],
  ['a 401 no longer stops the poll', 'if (r.status === 429 || r.status === 401 ||', 'if (r.status === 429 ||'],
  ['the stop is not persisted', "        if (st.stopped) await this.ctx.storage.put(BSD_POLL_STORAGE_KEY, st);\n", ''],
  ['the round does not stop after a refusal', 'if (st.stopped) break;', ''],
  ['a stopped day is polled anyway', 'if (st.stopped) return;', ''],
  ['a 500 stops the poll', "kind = 'http-error';", "kind = 'http-error'; st.stopped = { day: st.day, reason: '500', retryAfter: null, at: Date.now() };"],
  // what is polled
  ['a stale event is polled', 'if (seen === undefined || now - seen > BSD_POLL_FRESH_MS) continue;', 'if (seen === undefined) continue;'],
  ['an event that never streamed is polled', 'if (seen === undefined || now - seen > BSD_POLL_FRESH_MS) continue;', 'if (now - seen > BSD_POLL_FRESH_MS) continue;'],
  ['the freshness window is an hour', 'const BSD_POLL_FRESH_MS = 180_000;', 'const BSD_POLL_FRESH_MS = 3_600_000;'],
  ['the interval is ten seconds', 'const BSD_POLL_INTERVAL_MS = 60_000;', 'const BSD_POLL_INTERVAL_MS = 10_000;'],
  ['the wrong endpoint', "/stats/`, {\n                headers", "/shotmap/`, {\n                headers"],
  ['the token is not sent', "Authorization: `Token ${this._bsdToken}`, ", ''],
  ['the id is spliced into the path unencoded', '${encodeURIComponent(id)}/stats/', '${id}/stats/'],
  ['no timeout on the request', '                signal: AbortSignal.timeout(BSD_POLL_TIMEOUT_MS),\n', ''],
  ['a missing token still spends a call', "if (!this._bsdToken) { this._bsdPollRecord('no-token', id, null, st.calls); break; }", ''],
  // the payload
  ['a non-array shotmap is stored', 'if (Array.isArray(body?.shotmap)) {', 'if (body?.shotmap) {'],
  ['an empty array becomes null', 'this._bsdShot.set(id, { shotmap: body.shotmap, at: Date.now(), pending: true });', 'this._bsdShot.set(id, { shotmap: body.shotmap.length ? body.shotmap : null, at: Date.now(), pending: true });'],
  ['the array is copied and reordered', 'this._bsdShot.set(id, { shotmap: body.shotmap, at: Date.now(), pending: true });', 'this._bsdShot.set(id, { shotmap: [...body.shotmap].reverse(), at: Date.now(), pending: true });'],
  ['a computed field rides along (Rule 47)', 'this._bsdShot.set(id, { shotmap: body.shotmap, at: Date.now(), pending: true });', 'this._bsdShot.set(id, { shotmap: body.shotmap.map(s => ({ ...s, value: 1 })), at: Date.now(), pending: true });'],
  ['the array is re-sent with every frame', '        s.pending = false;\n', ''],
  ['a re-subscribe does not re-send the array', 'if (cached) cached.pending = true;', ''],
  ['the polled array is never delivered', 'shotmap: this._bsdShotmapOnce(eventId) ?? (frame.shotmap || null),', 'shotmap: frame.shotmap || null,'],
  ['frames do not mark an event fresh', '        this._bsdLastFrameAt.set(eventId, Date.now());\n', ''],
  // lifecycle and safety
  ['two rounds can overlap', 'if (!this._bsdPollBusy && this._bsdSubscribed.size > 0) {', 'if (this._bsdSubscribed.size > 0) {'],
  ['the busy flag is never cleared', 'finally { this._bsdPollBusy = false; }', 'finally { }'],
  ['requests are made in parallel', "            await this._bsdPollOne(id, st);\n            if (st.stopped) break;", "            this._bsdPollOne(id, st);\n            if (st.stopped) break;"],
  ['the timer is never re-armed', '            if (this._bsdSubscribed.size > 0) this._bsdPollStart();\n        }\n    }\n\n    async _bsdPollLoad', '        }\n    }\n\n    async _bsdPollLoad'],
  ['subscribing does not arm the timer', '        if (cached) cached.pending = true;\n        this._bsdPollStart();', '        if (cached) cached.pending = true;'],
  ['an empty subscription set leaves the timer running', 'if (this._bsdSubscribed.size === 0) this._bsdPollStop();', ''],
  ['unsubscribing keeps the cache', '        this._bsdShot.delete(String(eventId));\n', ''],
  ['unsubscribing keeps the frame clock', '        this._bsdLastFrameAt.delete(String(eventId));\n', ''],
  ['a failing datapoint breaks the poll', "console.error('[AmbientDO] BSD poll datapoint failed:', e?.message || e);", 'throw e;'],
  ['no datapoint per attempt', "        this._bsdPollRecord(kind, id, status, st.calls);\n    }\n\n    // Telemetry", '    }\n\n    // Telemetry'],
  ['a failed round throws out of the timer', "console.error('[AmbientDO] BSD stats poll round failed:', e?.message || e);", 'throw e;'],
  ['an undeclared assignment (strict mode throws)', "const now = Date.now();\n        const day = new Date(now)", "leakedGlobal = 1; const now = Date.now();\n        const day = new Date(now)"],
]

const CHECK_MUTATIONS = [
  ['a missing anchor does not throw', 'if (n !== 1) throw', 'if (false) throw'],
  ['anchors out of order do not throw', "if (!(cb < ce && ce < of && of < sub && sub < mb && mb < me)) throw", "if (false) throw"],
  ['zero scenarios can pass', "if (r.scenarios < MIN_SCENARIOS) {", "if (false) {"],
]

const readOrig = (f) => readFileSync(f, 'utf8')
let survivors = 0, unapplied = 0, total = 0
const orig = { [CHECK]: readOrig(CHECK) }
const srcText = readOrig(SRC)
const tmp = mkdtempSync(`${tmpdir()}/stats-poll-mut-`)

const base1 = spawnSync('node', [CHECK, '--self-test'], { encoding: 'utf8', timeout: 120000 })
const base2 = spawnSync('node', [CHECK], { encoding: 'utf8', timeout: 120000 })
if (base1.status !== 0 || base2.status !== 0) {
  console.log(`FAIL: baseline is not green (self-test exit ${base1.status}, real-source run exit ${base2.status}); no mutation result would mean anything`)
  process.exit(1)
}
console.log('baseline: --self-test and the real-source run both pass on clean source\n')

try {
  for (const [name, from, to] of SOURCE_MUTATIONS) {
    total++
    const hits = srcText.split(from).length - 1
    if (hits !== 1) { console.log(`NOT APPLIED  ${name}: anchor matched ${hits} times — NOTHING MUTATED`); unapplied++; continue }
    const copy = `${tmp}/ambient-do.mutated.js`
    writeFileSync(copy, srcText.replace(from, () => to))
    if (readFileSync(copy, 'utf8') === srcText) { console.log(`NOT APPLIED  ${name}: copy unchanged`); unapplied++; continue }
    // A mutation that does not even parse is "caught" by the syntax error, not by the check: refuse it.
    if (spawnSync('node', ['--check', copy], { encoding: 'utf8' }).status !== 0) { console.log(`NOT APPLIED  ${name}: the mutated source does not parse`); unapplied++; continue }
    const r = spawnSync('node', [CHECK, '--source', copy], { encoding: 'utf8', timeout: 120000 })
    const caught = r.status !== 0
    if (!caught) survivors++
    console.log(`${caught ? 'caught      ' : 'NOT CAUGHT  '} [source] ${name}`)
  }
  for (const [name, from, to] of CHECK_MUTATIONS) {
    total++
    const hits = orig[CHECK].split(from).length - 1
    if (hits !== 1) { console.log(`NOT APPLIED  ${name}: anchor matched ${hits} times — NOTHING MUTATED`); unapplied++; continue }
    writeFileSync(CHECK, orig[CHECK].replace(from, () => to))
    if (readFileSync(CHECK, 'utf8') === orig[CHECK]) { console.log(`NOT APPLIED  ${name}: file unchanged on disk`); unapplied++; continue }
    // an anchor mutation is visible to --self-test or to a run on a deliberately broken source
    const selfRed = spawnSync('node', [CHECK, '--self-test'], { encoding: 'utf8', timeout: 120000 }).status !== 0
    const brokenSrc = `${tmp}/ambient-do.broken.js`
    writeFileSync(brokenSrc, srcText.replace('// ── BSD stats poll (end)', '// ── BSD stats poll (end)\n// ── BSD stats poll (end)'))
    const runRed = spawnSync('node', [CHECK, '--source', brokenSrc], { encoding: 'utf8', timeout: 120000 }).status !== 0
    const caught = selfRed || runRed
    if (!caught) survivors++
    console.log(`${caught ? 'caught      ' : 'NOT CAUGHT  '} [check]  ${name}`)
  }
} finally {
  writeFileSync(CHECK, orig[CHECK])
}
if (readFileSync(CHECK, 'utf8') !== orig[CHECK]) { console.log(`FAIL: ${CHECK} was not restored`); process.exit(1) }
console.log(`${total} mutations: ${total - survivors - unapplied} caught, ${survivors} survived, ${unapplied} not applied`)
process.exit(survivors || unapplied ? 1 : 0)
