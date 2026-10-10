#!/usr/bin/env node
// Task 1 of docs/CC-CMD-2026-10-10-bsd-fields-already-arriving.md.
//
// What field set does the relay ACTUALLY receive today? The standing census is
// from 2026-10-03 and this month has already produced one vocabulary surprise
// (`period: "halftime"`, searched for on 10-03 and not found, observed live on
// 10-10). Seven days is long enough for a schema to move.
//
// NO NEW UPSTREAM CALL. This hits /api/v2/events/ with date_from/date_to —
// the same endpoint and the same parameters the relay's WC enrichment already
// uses at src/index.js:4412 and the claims harness already uses at
// scripts/bsd-newsletter-claims.mjs:129.
//
// PRESENCE IN THE SCHEMA AND PRESENCE IN THE DATA ARE DIFFERENT CLAIMS, and
// that is the whole point of counting rather than listing. A field every row
// carries as null is in the schema and absent from the data; a brief that
// cites it would cite nothing.

import { writeFileSync, mkdirSync } from 'node:fs'

export const BSD_BASE = 'https://sports.bzzoiro.com'

/** The eleven the CC-CMD names, plus the one field already consumed as a
 *  control — if `weather` does not show up as present, the census is pointed
 *  at the wrong thing and every other zero in it is meaningless. */
export const NAMED = [
  'has_xg', 'pitch_condition', 'travel_distance_km', 'is_local_derby',
  'is_neutral_ground', 'attendance', 'head_to_head', 'round_label',
  'round_name', 'round_number', 'stage', 'stage_name',
  'previous_leg_event_id', 'referee_id', 'home_coach_id', 'away_coach_id',
  'highlights',
]
export const CONTROL = 'weather'

/** Rule 99: four states, not two. A key that is absent, a key that is null, a
 *  key whose value is empty, and a key with a real value are four different
 *  facts about the feed, and collapsing them is how "we have this field"
 *  becomes true about a column of nulls. */
export const stateOf = (row, key) => {
  if (!(key in row)) return 'absent'
  const v = row[key]
  if (v === null || v === undefined) return 'null'
  if (v === '') return 'empty'
  if (Array.isArray(v)) return v.length === 0 ? 'empty' : 'present'
  if (typeof v === 'object') return Object.keys(v).length === 0 ? 'empty' : 'present'
  return 'present'
}

/** Per-field tallies across rows. Every field seen in ANY row is counted, not
 *  just the named ones — a census that only looks for what it expects cannot
 *  report a field that appeared since the last run. */
export const census = (rows) => {
  const keys = new Set()
  for (const r of rows) for (const k of Object.keys(r ?? {})) keys.add(k)
  const out = {}
  for (const k of [...keys].sort()) {
    const t = { absent: 0, null: 0, empty: 0, present: 0 }
    for (const r of rows) t[stateOf(r ?? {}, k)]++
    out[k] = { ...t, rows: rows.length, presentPct: rows.length ? +(100 * t.present / rows.length).toFixed(1) : null }
  }
  return out
}

/** Sub-field tallies for one nested object field, so `head_to_head` is not
 *  reported as "present" when every row carries it as an empty shell. */
export const subCensus = (rows, key) => {
  const nested = rows.map(r => r?.[key]).filter(v => v && typeof v === 'object' && !Array.isArray(v))
  return nested.length ? { rowsWithObject: nested.length, fields: census(nested) } : { rowsWithObject: 0, fields: {} }
}

function selfTest () {
  let failed = 0
  const check = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failed++ }

  check('an absent key is absent', stateOf({}, 'a') === 'absent')
  check('MUTATION: a NULL key is not absent — they are different facts',
    stateOf({ a: null }, 'a') === 'null' && stateOf({ a: null }, 'a') !== 'absent')
  check('an empty string is empty, not present', stateOf({ a: '' }, 'a') === 'empty')
  check('an empty array is empty, not present', stateOf({ a: [] }, 'a') === 'empty')
  check('an empty object is empty, not present', stateOf({ a: {} }, 'a') === 'empty')
  check('MUTATION: zero is PRESENT, not empty — 0 attendance is a reading',
    stateOf({ a: 0 }, 'a') === 'present')
  check('MUTATION: false is PRESENT — is_local_derby false is an answer',
    stateOf({ a: false }, 'a') === 'present')
  check('a populated object is present', stateOf({ a: { x: 1 } }, 'a') === 'present')

  const rows = [{ a: 1, b: null }, { a: 0, b: 2 }, { c: 'x' }]
  const c = census(rows)
  check('every key in any row is counted', Object.keys(c).join(',') === 'a,b,c')
  check('a key missing from one row counts as absent there', c.a.absent === 1 && c.a.present === 2)
  check('a null and an absent are tallied separately', c.b.null === 1 && c.b.absent === 1 && c.b.present === 1)
  check('presentPct is over ALL rows, not over rows carrying the key',
    c.a.presentPct === 66.7)

  const h2h = [{ head_to_head: { total_matches: 3 } }, { head_to_head: {} }, { head_to_head: null }]
  const s = subCensus(h2h, 'head_to_head')
  check('subCensus skips null and counts only real objects', s.rowsWithObject === 2)
  check('...and an empty shell does not make a sub-field present',
    s.fields.total_matches.present === 1 && s.fields.total_matches.absent === 1)

  console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${14 - failed}/14 self-tests`)
  return failed
}

if (process.argv.includes('--self-test')) process.exit(selfTest())

const TOKEN = process.env.BSD_API_TOKEN
if (!TOKEN) {
  console.log('FAIL: BSD_API_TOKEN absent — the census would be UNKNOWN, not empty (Rule 99).')
  process.exit(1)
}
const DATE = process.argv[2] || new Date().toISOString().slice(0, 10)
const headers = { Authorization: `Token ${TOKEN}`, 'User-Agent': 'FIELD/1.0', Accept: 'application/json' }

console.log(`=== bsd field census  date=${DATE}  endpoint=/api/v2/events/`)
const rows = []
let next = `/api/v2/events/?date_from=${DATE}&date_to=${DATE}&limit=100`
let pages = 0
while (next && pages < 5) {
  const r = await fetch(next.startsWith('http') ? next : `${BSD_BASE}${next}`, { headers })
  if (!r.ok) { console.log(`FAIL: HTTP ${r.status} on page ${pages + 1}`); process.exit(1) }
  const j = await r.json()
  rows.push(...(j.results || []))
  next = j.next || null
  pages++
}
console.log(`  ${rows.length} event row(s) over ${pages} page(s)\n`)

if (rows.length === 0) {
  console.log('FAIL: zero rows. An empty day is not a census — it cannot distinguish')
  console.log('"this field is never populated" from "nothing played today".')
  process.exit(1)
}

const all = census(rows)
const control = all[CONTROL]
console.log(`  CONTROL ${CONTROL}: present on ${control?.present ?? 0}/${rows.length}`)
if (!control || control.present === 0) {
  console.log('  ...the one field the relay already consumes reads absent. That points')
  console.log('  at the census, not at the feed. Not writing an artifact from it.')
  process.exit(1)
}

console.log(`\n  field                      present  null  empty  absent   %`)
for (const k of NAMED) {
  const t = all[k]
  if (!t) { console.log(`  ${k.padEnd(26)} NOT IN ANY ROW`); continue }
  console.log(`  ${k.padEnd(26)} ${String(t.present).padStart(6)} ${String(t.null).padStart(5)} ${String(t.empty).padStart(6)} ${String(t.absent).padStart(7)} ${String(t.presentPct).padStart(5)}`)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
mkdirSync('outbox', { recursive: true })
const artifact = {
  capturedAt: new Date().toISOString(),
  date: DATE,
  endpoint: '/api/v2/events/',
  note: 'No new upstream call: same endpoint and params the WC enrichment and the claims harness already use.',
  rows: rows.length,
  pages,
  control: { field: CONTROL, present: control.present },
  named: Object.fromEntries(NAMED.map(k => [k, all[k] ?? null])),
  headToHead: subCensus(rows, 'head_to_head'),
  allFields: all,
  coverage: `${rows.length} rows on ${DATE}, ${Object.keys(all).length} distinct field names. One day, not the feed.`,
}
const path = `outbox/bsd-field-census-${stamp}.json`
writeFileSync(path, JSON.stringify(artifact, null, 2) + '\n')
writeFileSync('outbox/bsd-field-census-latest.json', JSON.stringify(artifact, null, 2) + '\n')
console.log(`\n  head_to_head objects: ${artifact.headToHead.rowsWithObject}/${rows.length}`)
console.log(`\nCOVERAGE: ${artifact.coverage}`)
console.log(`wrote ${path}`)
console.log('PASS')
