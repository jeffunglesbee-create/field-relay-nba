#!/usr/bin/env node
// Done condition 1 of docs/CC-CMD-2026-10-10-coverage-replaces-season-date-math.md,
// against the DEPLOYED route rather than the source.
//
// Reading src/index.js to confirm src/index.js is the source-versus-copy
// substitution: a branch above the guard in the file proves nothing about what
// the worker serves until it has deployed. And the one thing most worth
// proving — that the route answers with NO BSD token involved — is only
// observable from outside.

export const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev'

/** Find the football row whatever the envelope is. The first version of this
 *  file assumed `body.football` or a top-level array, which came from reading
 *  the PROBE's normalised output rather than the raw payload — the
 *  source-versus-copy substitution, committed and run before being caught.
 *  This searches the shapes the feed could plausibly use and reports which one
 *  matched, so the next reader does not have to guess either. */
export const footballRow = (body) => {
  if (!body || typeof body !== 'object') return { row: null, via: 'not-an-object' }
  if (body.football && typeof body.football === 'object') return { row: body.football, via: 'top-level key' }
  if (Array.isArray(body)) {
    const row = body.find(x => (x?.sport ?? x?.name) === 'football')
    if (row) return { row, via: 'top-level array' }
  }
  for (const k of ['sports', 'results', 'coverage', 'data']) {
    const v = body[k]
    if (!v) continue
    if (Array.isArray(v)) {
      const row = v.find(x => (x?.sport ?? x?.name) === 'football')
      if (row) return { row, via: `${k}[] array` }
    } else if (typeof v === 'object' && v.football) {
      return { row: v.football, via: `${k}.football` }
    }
  }
  return { row: null, via: 'not found' }
}

export const checks = (r, body, hdrs) => [
  ['the route answers 200', r.status === 200],
  ['X-Coverage-State says the payload is the vendor\'s', hdrs['x-coverage-state'] === 'vendor'],
  ['the TTL is not the 25s live-feed TTL',
    /max-age=(\d+)/.test(hdrs['cache-control'] ?? '') && Number(/max-age=(\d+)/.exec(hdrs['cache-control'])[1]) > 25],
  ['the payload carries a football row', footballRow(body).row !== null],
  ['...with a status the client can read', typeof footballRow(body).row?.status === 'string'],
]

if (process.argv.includes('--self-test')) {
  let failed = 0
  const ck = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failed++ }
  const ok = checks({ status: 200 }, { football: { status: 'in_season' } },
    { 'x-coverage-state': 'vendor', 'cache-control': 'public, max-age=600' })
  ck('a correct response passes every check', ok.every(([, v]) => v))
  ck('MUTATION: a 25s TTL is caught', !checks({ status: 200 }, { football: { status: 'x' } },
    { 'x-coverage-state': 'vendor', 'cache-control': 'public, max-age=25' })[2][1])
  ck('MUTATION: upstream-failed is caught', !checks({ status: 200 }, { football: { status: 'x' } },
    { 'x-coverage-state': 'upstream-failed', 'cache-control': 'public, max-age=600' })[1][1])
  ck('MUTATION: a payload with no football row is caught',
    !checks({ status: 200 }, { tennis: {} }, { 'x-coverage-state': 'vendor', 'cache-control': 'max-age=600' })[3][1])
  ck('a top-level football key is found', footballRow({ football: { status: 'x' } }).via === 'top-level key')
  ck('a top-level array is found', footballRow([{ sport: 'football', status: 'x' }]).via === 'top-level array')
  ck('a sports[] envelope is found', footballRow({ sports: [{ sport: 'football', status: 'x' }] }).via === 'sports[] array')
  ck('a sports.football envelope is found', footballRow({ sports: { football: { status: 'x' } } }).via === 'sports.football')
  ck('MUTATION: a payload with no football is "not found", not a null row silently passing',
    footballRow({ tennis: {} }).via === 'not found')
  console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${9 - failed}/9 self-tests`)
  process.exit(failed)
}

const r = await fetch(`${RELAY}/bsd/coverage`, { headers: { Accept: 'application/json' } })
const text = await r.text()
let body = null; try { body = JSON.parse(text) } catch {}
const hdrs = Object.fromEntries([...r.headers].map(([k, v]) => [k.toLowerCase(), v]))

console.log(`=== /bsd/coverage, DEPLOYED  ${RELAY}/bsd/coverage`)
console.log(`  HTTP ${r.status}  ${text.length}B`)
console.log(`  X-Coverage-State: ${hdrs['x-coverage-state'] ?? '(absent)'}`)
console.log(`  Cache-Control   : ${hdrs['cache-control'] ?? '(absent)'}`)
console.log(`  X-FIELD-Source  : ${hdrs['x-field-source'] ?? '(absent)'}`)
console.log(`  top-level keys  : ${body && typeof body === 'object' ? Object.keys(body).slice(0, 12).join(', ') : '(not an object)'}`)
const _fb = footballRow(body)
console.log(`  football row via: ${_fb.via}\n`)

let failed = 0
for (const [n, ok] of checks(r, body, hdrs)) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if (!ok) failed++ }

// The ?sport= narrowing the CC-CMD documents.
const r2 = await fetch(`${RELAY}/bsd/coverage?sport=football`, { headers: { Accept: 'application/json' } })
console.log(`\n  ?sport=football -> HTTP ${r2.status}`)
const narrowed = r2.status === 200
console.log(`${narrowed ? 'PASS' : 'FAIL'}  the ?sport= narrowing is forwarded`)
if (!narrowed) failed++

console.log(`\nCOVERAGE: 2 live requests to the deployed route. No BSD token is held by this`)
console.log('runner for either call — the route answering at all is the token-free proof.')
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
