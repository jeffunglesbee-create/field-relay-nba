#!/usr/bin/env node
// Capture one finished BSD event's three coordinate-bearing payloads as a
// committed fixture, so docs/CC-CMD-2026-10-10-bsd-coordinate-frames.md's
// verifier can run with no live match and no BSD token.
//
// Through the relay, not BSD directly: the contract this fixture defends
// describes what the RELAY serves, and the relay is what a client reads. A
// capture taken from BSD would verify a payload no consumer sees.
//
// CI, not sandbox: egress to the relay host is 403-denied at CONNECT here
// (measured 2026-10-10), which is why this is a workflow rather than a
// local script. See .github/workflows/bsd-coordinate-capture.yml.

import { writeFileSync } from 'node:fs'

export const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev'
export const DEFAULT_EVENT = '223324'
export const PARTS = ['average-positions', 'shotmap', 'incidents']

export const fixturePath = (eventId) => `scripts/fixtures/bsd-${eventId}-coordinates.json`

/** A capture is usable only if every part came back as JSON. Rule 99: a part
 *  that failed is recorded as its own state, never as an empty object that
 *  reads like "this event has no shots". */
export const summarise = (parts) => {
  const bad = Object.entries(parts).filter(([, v]) => v.error)
  return {
    complete: bad.length === 0,
    failed: bad.map(([k, v]) => `${k}: ${v.error}`),
    counts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [
      k, v.error ? null : countOf(k, v.body),
    ])),
  }
}

export const countOf = (part, body) => {
  if (part === 'average-positions') {
    const ap = body?.average_positions ?? body
    return { home: (ap?.home || []).length, away: (ap?.away || []).length }
  }
  if (part === 'shotmap') return (body?.shotmap || body?.shots || []).length
  if (part === 'incidents') return (body?.incidents || []).length
  return null
}

async function fetchPart (eventId, part) {
  const url = `${RELAY}/bsd/events/${eventId}/${part}`
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    const text = await r.text()
    if (!r.ok) return { error: `HTTP ${r.status}`, url }
    try { return { url, status: r.status, body: JSON.parse(text) } }
    catch { return { error: 'response was not JSON', url } }
  } catch (e) {
    return { error: String(e && e.message || e), url }
  }
}

function selfTest () {
  let failed = 0
  const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed++ }

  check('a complete capture reports complete',
    summarise({ a: { body: {} }, b: { body: {} } }).complete === true)
  check('ONE failed part makes the capture incomplete',
    summarise({ a: { body: {} }, b: { error: 'HTTP 404' } }).complete === false)
  check('...and names which part failed',
    summarise({ a: { body: {} }, b: { error: 'HTTP 404' } }).failed[0] === 'b: HTTP 404')
  check('a failed part counts as null, NOT as 0 (Rule 99)',
    summarise({ shotmap: { error: 'x' } }).counts.shotmap === null)
  check('an empty shotmap counts as 0, which is a different fact',
    summarise({ shotmap: { body: { shotmap: [] } } }).counts.shotmap === 0)
  check('average-positions counts both sides',
    JSON.stringify(countOf('average-positions', { average_positions: { home: [1, 2], away: [3] } }))
      === JSON.stringify({ home: 2, away: 1 }))
  check('average-positions tolerates an unwrapped payload',
    countOf('average-positions', { home: [1], away: [] }).home === 1)
  check('the fixture path carries the event id',
    fixturePath('223324').endsWith('bsd-223324-coordinates.json'))

  console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${8 - failed}/8 self-tests`)
  return failed
}

if (process.argv[2] === '--self-test') process.exit(selfTest())

const eventId = process.argv[2] || DEFAULT_EVENT
console.log(`=== bsd coordinate capture  event=${eventId}  relay=${RELAY}`)

const parts = {}
for (const p of PARTS) {
  parts[p] = await fetchPart(eventId, p)
  const s = parts[p]
  console.log(`  ${p.padEnd(18)} ${s.error ? 'ERROR ' + s.error : 'ok'}`)
}

const sum = summarise(parts)
console.log(`\n  counts: ${JSON.stringify(sum.counts)}`)

if (!sum.complete) {
  console.log(`\nFAIL: capture incomplete — ${sum.failed.join('; ')}`)
  console.log('Not writing a partial fixture: a verifier green on a partial capture')
  console.log('proves nothing about the parts that are missing.')
  process.exit(1)
}

const out = {
  _capture: {
    event: eventId,
    relay: RELAY,
    parts: PARTS,
    note: 'Fixture for CC-CMD-2026-10-10-bsd-coordinate-frames. Captured through the relay, which is what clients read.',
    counts: sum.counts,
  },
  'average-positions': parts['average-positions'].body,
  shotmap: parts.shotmap.body,
  incidents: parts.incidents.body,
}
writeFileSync(fixturePath(eventId), JSON.stringify(out, null, 2) + '\n')
console.log(`\nwrote ${fixturePath(eventId)}`)
console.log('PASS: all three parts captured')
