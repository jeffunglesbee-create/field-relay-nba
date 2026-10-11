#!/usr/bin/env node
// Do the four route blocks this session shipped ANSWER on the deployed worker?
//
// WHY THIS EXISTS. deploy.yml's last step is named "the routes this deploy
// touched still answer" and probes exactly two: /health and
// /identity/substitution-census. Those are the routes a PAST deploy touched.
// The name claims coverage of this one.
//
// MEASURED 2026-10-11, and it is the reason this file was written: every
// deploy from 3765a55 through defc1e1 FAILED on the scope-claims gate, so the
// four route blocks — lineups, both broadcasts routes, /nhl-stats/* — were
// never live while their documents were being closed. The probes that produced
// those documents' numbers called the VENDOR directly from a runner, which is
// why they returned real data and proved nothing about the relay. "Route live"
// was an assumption-class-A claim: deployed state asserted from local reading.
//
// CI because the deployed worker is 403-at-CONNECT from the container.

const BASE = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev'

// ── the classifier, which is what the self-test can break ───────────────────

// Four states, never a boolean. A route that answered with the wrong body and
// a route that did not answer are different facts, and so is a route that
// answered correctly while stating nothing.
export const routeState = ({ status, headers = {}, rows = null }) => {
  if (status === null || status === undefined) return 'no-response'
  if (status >= 500) return 'upstream-failed'
  if (status === 403) return 'refused'
  if (status !== 200) return `unexpected-${status}`
  const stated = Object.keys(headers).length > 0
  if (!stated) return 'answered-unstated'
  if (rows === 0) return 'answered-empty'
  return 'answered'
}

// A header whose value must match a shape, not merely exist. Rule 99: absent,
// present-and-empty, and present-and-wrong are three different answers.
export const headerState = (value, shape) => {
  if (value === undefined || value === null) return 'absent'
  if (value === '') return 'empty-string'
  return shape.test(value) ? 'present' : 'present-but-malformed'
}

export const TERRITORY_SHAPE = /^\d+\/\d+$/
export const LINEUP_STATES = new Set(['predicted', 'confirmed', 'status-absent', 'upstream-failed'])
export const lineupStateValid = (v) => headerState(v, /./) === 'present' && LINEUP_STATES.has(v)

// ── self-test ───────────────────────────────────────────────────────────────

if (process.argv.includes('--self-test')) {
  let ran = 0, bad = 0
  const eq = (got, want, label) => {
    ran += 1
    const ok = got === want
    if (!ok) bad += 1
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} = ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`)
  }

  eq(routeState({ status: undefined }), 'no-response', 'no status at all')
  eq(routeState({ status: 502 }), 'upstream-failed', '502')
  eq(routeState({ status: 403 }), 'refused', '403 from the allow-list')
  eq(routeState({ status: 404 }), 'unexpected-404', '404')
  eq(routeState({ status: 200, headers: {} }), 'answered-unstated', '200 stating nothing')
  eq(routeState({ status: 200, headers: { a: '1' }, rows: 0 }), 'answered-empty', '200 with zero rows')
  eq(routeState({ status: 200, headers: { a: '1' }, rows: 3 }), 'answered', '200 with rows')
  // A 200 with rows UNKNOWN is still answered — the row count is a separate
  // measurement and must not be inferred from its own absence.
  eq(routeState({ status: 200, headers: { a: '1' }, rows: null }), 'answered', '200, row count unreadable')

  eq(headerState(undefined, TERRITORY_SHAPE), 'absent', 'territory header absent')
  eq(headerState('', TERRITORY_SHAPE), 'empty-string', 'territory header empty')
  eq(headerState('171/171', TERRITORY_SHAPE), 'present', 'territory 171/171')
  eq(headerState('171 of 171', TERRITORY_SHAPE), 'present-but-malformed', 'territory in prose')
  eq(headerState('0/0', TERRITORY_SHAPE), 'present', 'territory 0/0 is a real answer')

  eq(lineupStateValid('predicted'), true, 'lineup state predicted')
  eq(lineupStateValid('served-empty'), false, 'the FILL value is not a STATE value')
  eq(lineupStateValid(undefined), false, 'lineup state absent')
  eq(lineupStateValid(''), false, 'lineup state empty')

  // The discriminator the catch-all defeated. A 403 from this route carries an
  // `allowed` array; a 403 from anywhere else does not.
  const ownRefusal = (body) => Array.isArray(body?.allowed)
  eq(ownRefusal({ error: 'path not allowed', allowed: ['/shiftcharts'] }), true, 'the route\'s own 403')
  eq(ownRefusal(null), false, 'a plain-text 403 (the /nba/* catch-all)')
  eq(ownRefusal({ error: 'path not allowed' }), false, 'a 403 with the right words and no list')

  console.log(`\nself-test: ${ran - bad}/${ran}`)
  console.log('COVERAGE: both classifiers against synthetic responses. Makes no')
  console.log('HTTP call and proves nothing about the deployed worker.')
  process.exit(bad ? 1 : 0)
}

// ── the live probe ──────────────────────────────────────────────────────────

const calls = []
const get = async (path) => {
  const url = `${BASE}${path}`
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'FIELD/1.0' } })
    const text = await r.text()
    let body = null
    try { body = JSON.parse(text) } catch (_) {}
    const h = {}
    for (const [k, v] of r.headers) if (/^x-/i.test(k)) h[k.toLowerCase()] = v
    calls.push(path)
    return { status: r.status, headers: h, body, text: text.slice(0, 300) }
  } catch (e) {
    calls.push(path)
    return { status: null, headers: {}, body: null, text: e.message }
  }
}

const rowsOf = (body) => Array.isArray(body?.data) ? body.data.length
  : Array.isArray(body?.results) ? body.results.length
  : Array.isArray(body) ? body.length : null

const findings = []
const record = (name, verdict, detail) => {
  findings.push({ name, verdict, ...detail })
  console.log(`  ${verdict === 'PASS' ? 'PASS' : verdict === 'UNMEASURED' ? 'UNM ' : 'FAIL'}  ${name}`)
  for (const [k, v] of Object.entries(detail)) console.log(`          ${k}: ${JSON.stringify(v)}`)
}

const today = process.env.PROBE_DATE || new Date().toISOString().slice(0, 10)
console.log(`probing ${BASE}`)
console.log(`date    ${today}\n`)

// 1 — /nhl-stats/* serves, and the row count is the measurement.
{
  const r = await get('/nhl-stats/shiftcharts?cayenneExp=gameId%3D2026020053&final=1')
  const rows = rowsOf(r.body)
  const st = routeState({ status: r.status, headers: r.headers, rows })
  record('/nhl-stats/shiftcharts answers with rows',
    st === 'answered' && rows > 0 ? 'PASS' : 'FAIL',
    { status: r.status, routeState: st, rows, xState: r.headers['x-nhlstats-state'] ?? null,
      xRows: r.headers['x-nhlstats-rows'] ?? null })
}

// 2 — THE NEGATIVE CONTROL, AND A 403 IS NOT ENOUGH TO PASS IT.
//
// Run 38120962865 is why. This control reported PASS while the route above
// reported FAIL, and both had been refused by the SAME thing: the /nba/*
// catch-all at the end of the fetch handler, because the route block had
// shipped inside the /bsd/ section and could never match. On status alone the
// two are identical, so the control was passing for a reason unrelated to the
// allow-list it exists to exercise.
//
// So the assertion is the route's OWN refusal shape: a json body carrying
// `allowed`, which only nhlStatsAllowed's branch emits. The catch-all answers
// the plain string 'Path not allowed' and fails this.
{
  const r = await get('/nhl-stats/zzz-not-a-real-prefix')
  const st = routeState({ status: r.status, headers: r.headers })
  const ownRefusal = Array.isArray(r.body?.allowed)
  record('/nhl-stats/* refuses a path outside the allow-list, in its own words',
    st === 'refused' && ownRefusal ? 'PASS' : 'FAIL',
    { status: r.status, routeState: st, ownRefusalShape: ownRefusal,
      refusedBy: ownRefusal ? 'nhlStatsAllowed' : 'something else — body is not this route\'s',
      body: r.text })
}

// 3 — discover an event from the deployed relay, not from the vendor.
let eventId = null, channelId = null
{
  const r = await get(`/bsd/events/by-date?date=${today}`)
  const rows = rowsOf(r.body)
  const list = Array.isArray(r.body?.data) ? r.body.data : Array.isArray(r.body?.results) ? r.body.results : []
  eventId = list.find(e => Number.isFinite(e?.id))?.id ?? null
  record('/bsd/events/by-date discovers an event id',
    eventId === null ? 'UNMEASURED' : 'PASS',
    { status: r.status, rows, eventId })
}

// 4 — lineups, and X-Lineup-State must be one of the four.
if (eventId === null) {
  record('/bsd/events/:id/lineups', 'UNMEASURED', { reason: 'no event id discovered for this date' })
} else {
  const r = await get(`/bsd/events/${eventId}/lineups`)
  const state = r.headers['x-lineup-state']
  const fill = r.headers['x-lineup-fill']
  const st = routeState({ status: r.status, headers: r.headers })
  record('/bsd/events/:id/lineups states one of four',
    lineupStateValid(state) && headerState(fill, /./) === 'present' ? 'PASS' : 'FAIL',
    { status: r.status, routeState: st, xLineupState: state ?? null, xLineupFill: fill ?? null,
      xLineupBeta: r.headers['x-lineup-beta'] ?? null })
}

// 5 — event broadcasts, and the territory header must be stated/total.
if (eventId === null) {
  record('/bsd/events/:id/broadcasts', 'UNMEASURED', { reason: 'no event id discovered for this date' })
} else {
  const r = await get(`/bsd/events/${eventId}/broadcasts`)
  const terr = r.headers['x-broadcast-territory-stated']
  const list = Array.isArray(r.body?.data) ? r.body.data : Array.isArray(r.body?.results) ? r.body.results : []
  channelId = list.find(b => Number.isFinite(b?.tv_channel?.id))?.tv_channel?.id
    ?? list.find(b => Number.isFinite(b?.tv_channel_id))?.tv_channel_id ?? null
  record('/bsd/events/:id/broadcasts states territory coverage',
    headerState(terr, TERRITORY_SHAPE) === 'present' ? 'PASS' : 'FAIL',
    { status: r.status, rows: rowsOf(r.body), xTerritory: terr ?? null, channelId })
}

// 6 — channel broadcasts. The id comes from row 5; inventing one would make
// a 404 indistinguishable from a broken route.
if (channelId === null) {
  record('/bsd/tv-channels/:id/broadcasts', 'UNMEASURED',
    { reason: 'no tv_channel id in the event broadcasts rows — not invented' })
} else {
  const r = await get(`/bsd/tv-channels/${channelId}/broadcasts`)
  const terr = r.headers['x-broadcast-territory-stated']
  record('/bsd/tv-channels/:id/broadcasts states territory coverage',
    headerState(terr, TERRITORY_SHAPE) === 'present' ? 'PASS' : 'FAIL',
    { status: r.status, rows: rowsOf(r.body), xTerritory: terr ?? null })
}

const pass = findings.filter(f => f.verdict === 'PASS').length
const fail = findings.filter(f => f.verdict === 'FAIL').length
const unm = findings.filter(f => f.verdict === 'UNMEASURED').length

console.log(`\n${pass} PASS, ${fail} FAIL, ${unm} UNMEASURED of ${findings.length} surfaces`)
console.log(`COVERAGE: ${findings.length} route surfaces, from the 4 route blocks this`)
console.log('session shipped. The fifth document ships NO route — the BSD odds')
console.log('refusal is a comment beside the metered vendor\'s base constant in')
console.log('src/index.js — so it is not probeable')
console.log('here and is absent from the denominator rather than counted as passing.')
console.log(`calls: ${calls.length}`)

const artifact = {
  probed_at_utc: process.env.PROBE_STAMP || null,
  base: BASE, date: today, calls, findings,
  summary: { pass, fail, unmeasured: unm, surfaces: findings.length },
  coverage_note: '4 route blocks, 6 surfaces. The odds-refusal document ships no route.',
}
if (process.env.PROBE_OUT) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(process.env.PROBE_OUT, JSON.stringify(artifact, null, 2))
  console.log(`wrote ${process.env.PROBE_OUT}`)
}
process.exit(fail ? 1 : 0)
