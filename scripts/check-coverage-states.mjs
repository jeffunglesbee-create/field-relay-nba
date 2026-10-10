#!/usr/bin/env node
// Task 2 of docs/CC-CMD-2026-10-10-coverage-replaces-season-date-math.md:
// "The response must let a caller distinguish off_season, in_season with
//  priced_next_7d: 0, and the coverage call itself failing. The third must
//  never read as either of the first two."
//
// Plus the two structural facts that make the route work at all, both of which
// are silent failures if they regress:
//
//   1. the branch sits ABOVE the 503 BSD_API_TOKEN guard. Below it, a
//      token-free endpoint 503s for want of a token it never wanted — and the
//      symptom is indistinguishable from the endpoint being down.
//   2. the branch attaches NO Authorization header. Sending a credential an
//      endpoint does not require is how one leaks, and nothing upstream would
//      complain.

import { readFileSync, existsSync } from 'node:fs'
import { coverageState } from './bsd-coverage-probe.mjs'

export const SRC = 'src/index.js'
export const PROBE = 'outbox/bsd-coverage-probe-latest.json'

/** The coverage branch's source text, from `if (pathname === '/bsd/coverage')`
 *  to the 503 guard. Returned with the two line numbers so ordering is a
 *  measurement rather than an assumption. */
export const branchOf = (src) => {
  const lines = src.split('\n')
  const covIdx = lines.findIndex(l => l.includes("pathname === '/bsd/coverage'"))
  const grdIdx = lines.findIndex(l => l.includes('BSD_API_TOKEN not configured'))
  if (covIdx === -1 || grdIdx === -1) return null
  // The branch ENDS where the guard BEGINS, which is `const bsdToken = ...`,
  // not the 'not configured' string two lines later. Slicing to the latter
  // swept the guard's own `env.BSD_API_TOKEN` into the branch text, and the
  // credential check then failed on the guard rather than on the route — a
  // check reporting a real-looking defect in code that did not have one.
  const startIdx = lines.findIndex((l, i) => i >= covIdx && /const bsdToken\s*=/.test(l))
  const endIdx = startIdx === -1 ? grdIdx : startIdx
  return {
    coverageLine: covIdx + 1,
    guardLine: grdIdx + 1,
    aboveGuard: covIdx < grdIdx,
    text: lines.slice(covIdx, endIdx).join('\n'),
  }
}

/** Does this branch attach a credential? Comments are stripped first: this
 *  branch's comment explains WHY no Authorization header is attached, and a
 *  naive match on the word would be satisfied by the explanation. */
export const attachesCredential = (text) => {
  const code = text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  return /Authorization|BSD_API_TOKEN|bsdHeaders|bsdToken/.test(code)
}

function selfTest () {
  let failed = 0
  const check = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failed++ }

  // The four states, which is the heart of Task 2.
  check('off_season is not-in-season', coverageState({ status: 'off_season' }, true) === 'not-in-season')
  check('in_season with prices is priced', coverageState({ status: 'in_season', priced_next_7d: 5 }, true) === 'priced')
  check('MUTATION: in_season with ZERO prices is its own state',
    coverageState({ status: 'in_season', priced_next_7d: 0 }, true) === 'in-season-unpriced')
  check('MUTATION: a FAILED call is unknown — never off-season',
    coverageState({ status: 'off_season' }, false) === 'unknown')
  check('...and never unpriced either',
    coverageState({ status: 'in_season', priced_next_7d: 0 }, false) === 'unknown')
  check('all four are mutually distinct', new Set([
    coverageState({ status: 'in_season', priced_next_7d: 1 }, true),
    coverageState({ status: 'in_season', priced_next_7d: 0 }, true),
    coverageState({ status: 'off_season' }, true),
    coverageState(null, false),
  ]).size === 4)

  // The structural facts, each with a mutation.
  const good = `if (pathname === '/bsd/coverage') {\n  // no Authorization here, deliberately\n  fetch(url, { headers: { 'User-Agent': 'x' } });\n}\nBSD_API_TOKEN not configured`
  const b = branchOf(good)
  check('the branch is found and read as above the guard', b?.aboveGuard === true)
  check('a comment SAYING "no Authorization" does not count as attaching one',
    attachesCredential(b.text) === false)
  check('MUTATION: a real Authorization header IS caught',
    attachesCredential(`fetch(u, { headers: { Authorization: 'Token x' } })`) === true)
  check('MUTATION: reusing bsdHeaders IS caught', attachesCredential('fetch(u, { headers: bsdHeaders })') === true)

  const flipped = `BSD_API_TOKEN not configured\nif (pathname === '/bsd/coverage') {\n}`
  check('MUTATION: the branch BELOW the guard is caught',
    branchOf(flipped)?.aboveGuard === false)
  check('a missing branch is null, not false — absent and wrong are different',
    branchOf('nothing here') === null)
  check('MUTATION: the GUARD\'s own env.BSD_API_TOKEN is not read as the route\'s',
    attachesCredential(branchOf(
      `if (pathname === '/bsd/coverage') {\n  fetch(u);\n}\nconst bsdToken = env.BSD_API_TOKEN;\nBSD_API_TOKEN not configured`
    ).text) === false)

  console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${13 - failed}/13 self-tests`)
  return failed
}

if (process.argv.includes('--self-test')) process.exit(selfTest())

let failed = 0
const assert = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failed++ }

const src = readFileSync(SRC, 'utf8')
const b = branchOf(src)
console.log(`=== coverage states  ${SRC}\n`)
if (!b) {
  console.log('FAIL: no /bsd/coverage branch found at all.')
  process.exit(1)
}
console.log(`  /bsd/coverage branch : line ${b.coverageLine}`)
console.log(`  503 BSD token guard  : line ${b.guardLine}\n`)

assert('the coverage branch sits ABOVE the 503 token guard', b.aboveGuard)
assert('the coverage branch attaches no credential', !attachesCredential(b.text))
assert('the branch names the upstream-failed state', /upstream-failed/.test(b.text))
assert('...and says plainly it is not off-season', /NOT off-season/i.test(b.text))
assert('the branch sets X-Coverage-State', /X-Coverage-State/.test(b.text))
assert('a TTL is set and is not the 25s live-feed TTL',
  /max-age=(\d+)/.test(b.text) && Number(/max-age=(\d+)/.exec(b.text)[1]) > 25)

if (existsSync(PROBE)) {
  const p = JSON.parse(readFileSync(PROBE, 'utf8'))
  assert('the measurement says the endpoint is token-free', p.q1_tokenFree?.answer === true)
  const unpriced = (p.coverage ?? []).filter(r => r._state === 'in-season-unpriced')
  console.log(`\n  in_season with 0 priced, live today: ${unpriced.length}` +
              (unpriced.length ? ` (${unpriced.map(r => r.sport ?? r.name).join(', ')})` : ''))
  assert('the third state is not hypothetical — the vendor reports it today',
    unpriced.length > 0)
  console.log(`  COVERAGE: ${(p.coverage ?? []).length} sports in the probe artifact of ${p.capturedAt}`)
} else {
  console.log(`\n  NOTE: no ${PROBE} — the live half is UNCHECKED, not passed.`)
  console.log('  Run .github/workflows/bsd-coverage-probe.yml.')
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
