#!/usr/bin/env node
// Do site.api.espn.com and site.web.api.espn.com serve the same payload for
// every ESPN endpoint the relay reads? Measured on a runner, both hosts, each
// fetched the way the relay fetches it.
//
// WHY: on 2026-10-13T21:39Z site.web.api began answering 403 to Cloudflare
// Worker egress, the mirror image of 2026-08-08 when site.api did. From the
// Worker IP, site.api now answers 200 (html_probe, 2026-10-14). Re-pointing the
// relay's constants back is the documented mitigation
// (docs/CC-CMD-2026-08-08-espn-site-api-403-p0.md, Task 2), but src/index.js
// carries an older claim that "site.api.espn.com only returns WP;
// site.web.api.espn.com returns full game data" for summaries. If that is true
// today, a re-point would trade an explicit 403 for a silent loss of plays and
// boxscore. This measures it instead of trusting either comment.
//
// A runner IP is not a Worker IP. Both hosts answer a runner, so this compares
// PAYLOADS, which is a property of the host. Whether the Worker is allowed in is
// a separate question, answered from the relay's own routes after a deploy.
//
// --self-test runs the comparator against fixtures and must see a dropped key.
import { writeFileSync, mkdirSync } from 'node:fs'

const HOSTS = { api: 'https://site.api.espn.com', web: 'https://site.web.api.espn.com' }
// The relay's ESPN_SUMMARY_HEADERS (src/index.js), copied, not invented. The
// scoreboard fetch in /v2/games sends none.
const RELAY_HEADERS = {
  Origin: 'https://www.espn.com',
  Referer: 'https://www.espn.com/',
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}

// Every key path to `depth`, arrays collapsed to `[]` over their first three
// elements. A shape, not a value: two hosts serving the same game at slightly
// different moments differ in values but must not differ in shape.
export function keyPaths(v, depth = 4, prefix = '', out = new Set()) {
  if (depth < 0 || v === null || typeof v !== 'object') return out
  if (Array.isArray(v)) {
    for (const el of v.slice(0, 3)) keyPaths(el, depth, `${prefix}[]`, out)
    return out
  }
  for (const k of Object.keys(v)) {
    const p = prefix ? `${prefix}.${k}` : k
    out.add(p)
    keyPaths(v[k], depth - 1, p, out)
  }
  return out
}

export function compare(a, b) {
  const A = keyPaths(a), B = keyPaths(b)
  const onlyA = [...A].filter(k => !B.has(k)).sort()
  const onlyB = [...B].filter(k => !A.has(k)).sort()
  return { paths: A.size, onlyApi: onlyA, onlyWeb: onlyB, same: onlyA.length === 0 && onlyB.length === 0 }
}

// The summary fields relay consumers read. Counted, not just present: a host
// that returns `plays: []` for a finished game is as lossy as one that omits it.
export function summaryFields(j) {
  const len = x => (Array.isArray(x) ? x.length : x === undefined ? 'absent' : x === null ? 'null' : typeof x)
  return {
    plays: len(j?.plays),
    winprobability: len(j?.winprobability),
    boxscore_teams: len(j?.boxscore?.teams),
    boxscore_players: len(j?.boxscore?.players),
    header_competitions: len(j?.header?.competitions),
    keyEvents: len(j?.keyEvents),
  }
}

if (process.argv.includes('--self-test')) {
  let fail = 0
  const ok = (name, c) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${name}`); if (!c) fail++ }
  const base = { events: [{ id: '1', competitions: [{ broadcasts: [{ names: ['FOX'] }] }] }], leagues: [{ id: '28' }] }
  const same = JSON.parse(JSON.stringify(base)); same.events[0].id = '2'
  const dropped = JSON.parse(JSON.stringify(base)); delete dropped.events[0].competitions[0].broadcasts
  ok('identical shapes with different values compare equal', compare(base, same).same)
  const d = compare(base, dropped)
  ok('a dropped nested key is caught', !d.same && d.onlyApi.includes('events[].competitions[].broadcasts'))
  ok('plays [] is counted, not read as present', summaryFields({ plays: [] }).plays === 0)
  ok('an absent field reads absent', summaryFields({}).plays === 'absent')
  console.log(fail ? `self-test: ${fail} failed` : 'self-test: 4/4')
  process.exit(fail ? 1 : 0)
}

async function get(url, headers) {
  const t0 = Date.now()
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) })
    const text = await r.text()
    // A 403 page is HTML. Not JSON is a result to record, not to drop: the
    // row then reads not-comparable with the reason beside it.
    let json = null, parseError
    try { json = JSON.parse(text) } catch (e) { parseError = String(e).slice(0, 80) }
    return { status: r.status, bytes: text.length, ms: Date.now() - t0, json, error: parseError && `not JSON: ${parseError}` }
  } catch (e) {
    return { status: 0, bytes: 0, ms: Date.now() - t0, json: null, error: String(e).slice(0, 160) }
  }
}

const SCOREBOARDS = [
  'football/nfl/scoreboard?dates=20261012',
  'football/college-football/scoreboard?dates=20261010',
  'soccer/eng.1/scoreboard?dates=20261004',
  'soccer/usa.1/scoreboard?dates=20261011',
  'baseball/mlb/scoreboard?dates=20261013',
  'hockey/nhl/scoreboard?dates=20261013',
]

const stamp = new Date().toISOString().replace(/[:]/g, '').slice(0, 15)
const lines = []
const say = s => { console.log(s); lines.push(s) }
const rows = []

say(`=== espn host parity  utc=${new Date().toISOString()}  runner (NOT a Worker IP) ===`)

async function pair(kind, path, headers, label) {
  const [a, w] = await Promise.all([get(`${HOSTS.api}${path}`, headers), get(`${HOSTS.web}${path}`, headers)])
  const row = { kind, path, headers: label, api: { status: a.status, bytes: a.bytes, error: a.error }, web: { status: w.status, bytes: w.bytes, error: w.error } }
  if (a.json && w.json) {
    const c = compare(a.json, w.json)
    row.shape = { same: c.same, paths: c.paths, onlyApi: c.onlyApi.slice(0, 25), onlyWeb: c.onlyWeb.slice(0, 25), onlyApiCount: c.onlyApi.length, onlyWebCount: c.onlyWeb.length }
    if (kind === 'summary') row.fields = { api: summaryFields(a.json), web: summaryFields(w.json) }
    if (kind === 'scoreboard') row.events = { api: a.json.events?.length ?? 'absent', web: w.json.events?.length ?? 'absent' }
  }
  rows.push(row)
  const verdict = row.shape ? (row.shape.same ? 'same-shape' : `DIFFERS (+api ${row.shape.onlyApiCount}, +web ${row.shape.onlyWebCount})`) : 'not-comparable'
  say(`  ${kind.padEnd(10)} ${label.padEnd(13)} api ${a.status} ${String(a.bytes).padStart(8)}B   web ${w.status} ${String(w.bytes).padStart(8)}B   ${verdict}   ${path}`)
  if (row.fields) say(`             fields api ${JSON.stringify(row.fields.api)}\n             fields web ${JSON.stringify(row.fields.web)}`)
  if (row.shape && !row.shape.same) {
    if (row.shape.onlyApi.length) say(`             only on api: ${row.shape.onlyApi.slice(0, 8).join(', ')}`)
    if (row.shape.onlyWeb.length) say(`             only on web: ${row.shape.onlyWeb.slice(0, 8).join(', ')}`)
  }
  return { a, w }
}

const firstFinal = j => (j?.events || []).find(e => e?.status?.type?.completed)?.id

let nflJson = null, eplJson = null
for (const s of SCOREBOARDS) {
  const { a } = await pair('scoreboard', `/apis/site/v2/sports/${s}`, {}, 'none (relay)')
  if (s.startsWith('football/nfl')) nflJson = a.json
  if (s.startsWith('soccer/eng.1')) eplJson = a.json
}
const summaries = [
  ['football/nfl', firstFinal(nflJson)],
  ['soccer/eng.1', firstFinal(eplJson)],
].filter(([, id]) => id)
for (const [lg, id] of summaries) {
  await pair('summary', `/apis/site/v2/sports/${lg}/summary?event=${id}`, RELAY_HEADERS, 'browser (relay)')
  await pair('summary', `/apis/site/v2/sports/${lg}/summary?event=${id}`, {}, 'none')
}
await pair('standings', '/apis/v2/sports/football/nfl/standings?region=us&lang=en&contentorigin=espn&type=0&level=2&sort=playoffseed:asc', RELAY_HEADERS, 'browser (relay)')

const comparable = rows.filter(r => r.shape)
const differ = comparable.filter(r => !r.shape.same)
say('')
say(`COVERAGE: ${rows.length} host pairs fetched, ${comparable.length} comparable (both answered JSON), ${differ.length} differ in shape.`)
say(`          summaries for ${summaries.length} of 2 leagues (an event id is taken from a completed game on that day's scoreboard).`)
say('          Shapes to depth 4, arrays read over their first 3 elements. A runner is not a Worker:')
say('          this says what each host SERVES, not whether the relay is let in.')

mkdirSync('outbox', { recursive: true })
writeFileSync(`outbox/espn-host-parity-${stamp}.json`, JSON.stringify({ at: new Date().toISOString(), rows }, null, 2) + '\n')
writeFileSync(`outbox/espn-host-parity-${stamp}.log`, lines.join('\n') + '\n')
console.log(`wrote outbox/espn-host-parity-${stamp}.{json,log}`)
