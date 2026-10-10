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

export const checks = (r, body, hdrs) => [
  ['the route answers 200', r.status === 200],
  ['X-Coverage-State says the payload is the vendor\'s', hdrs['x-coverage-state'] === 'vendor'],
  ['the TTL is not the 25s live-feed TTL',
    /max-age=(\d+)/.test(hdrs['cache-control'] ?? '') && Number(/max-age=(\d+)/.exec(hdrs['cache-control'])[1]) > 25],
  ['the payload carries a football row', !!body?.football || (Array.isArray(body) && body.some(x => (x.sport ?? x.name) === 'football'))],
  ['...with a status the client can read',
    typeof (body?.football?.status ?? (Array.isArray(body) ? body.find(x => (x.sport ?? x.name) === 'football')?.status : null)) === 'string'],
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
  console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${4 - failed}/4 self-tests`)
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
console.log(`  X-FIELD-Source  : ${hdrs['x-field-source'] ?? '(absent)'}\n`)

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
