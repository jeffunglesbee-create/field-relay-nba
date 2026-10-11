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

/** TASK 1 — PER-LEAGUE RATES, because a pooled number can be a lie.
 *  docs/CC-CMD-2026-10-10-bsd-hook-admission-and-per-league-rates.md.
 *
 *  79.8% pooled is consistent with 100% in one competition and 0% in another,
 *  and a dimension scored against the pooled rate would read as 80% covered
 *  while being structurally blind to a whole league. Rule 91 as this repo
 *  applies it: print the coverage where the result is read. */
export const censusByLeague = (rows, fields, leagueKey = 'league_id') => {
  const byLeague = new Map()
  for (const r of rows) {
    const lid = r?.[leagueKey] ?? '__unstated__'
    if (!byLeague.has(lid)) byLeague.set(lid, [])
    byLeague.get(lid).push(r)
  }
  const out = {}
  for (const [lid, rs] of byLeague) {
    const perField = {}
    for (const f of fields) {
      const t = { absent: 0, null: 0, empty: 0, present: 0 }
      for (const r of rs) t[stateOf(r ?? {}, f)]++
      perField[f] = { ...t, rows: rs.length, presentPct: rs.length ? +(100 * t.present / rs.length).toFixed(1) : null }
    }
    out[String(lid)] = { league_id: lid, rows: rs.length, leagueName: rs[0]?.league_name ?? null, fields: perField }
  }
  return out
}

/** TASK 1, second half — ARE THE MISSING ROWS THE SAME ROWS?
 *  pitch_condition and travel_distance_km are both missing on exactly 39 of
 *  193. An identical denominator on two unrelated fields is unlikely to be
 *  random absence. Same rows means one cause; different rows means two, and
 *  two causes need two answers. */
export const absenceOverlap = (rows, fieldA, fieldB, idKey = 'id') => {
  const missA = new Set(), missB = new Set()
  for (const r of rows) {
    const id = r?.[idKey] ?? r?.event_id ?? JSON.stringify(r).slice(0, 40)
    if (stateOf(r ?? {}, fieldA) !== 'present') missA.add(id)
    if (stateOf(r ?? {}, fieldB) !== 'present') missB.add(id)
  }
  const both = [...missA].filter(x => missB.has(x))
  const onlyA = [...missA].filter(x => !missB.has(x))
  const onlyB = [...missB].filter(x => !missA.has(x))
  return {
    fieldA, fieldB,
    missing_A: missA.size, missing_B: missB.size,
    missing_BOTH: both.length, missing_only_A: onlyA.length, missing_only_B: onlyB.length,
    identical_sets: missA.size > 0 && missA.size === missB.size && onlyA.length === 0 && onlyB.length === 0,
    verdict: missA.size === 0 && missB.size === 0
      ? 'neither field is missing on any row — no absence to explain'
      : (missA.size === missB.size && onlyA.length === 0 && onlyB.length === 0)
        ? 'THE SAME ROWS. One cause — a league or provider tier that serves neither.'
        : `DIFFERENT ROWS: ${onlyA.length} miss only ${fieldA}, ${onlyB.length} miss only ${fieldB}, ${both.length} miss both. Two causes, two answers.`,
  }
}

/** TASK 2 — can "never met" be told from "we could not read it"?
 *  The test available without new calls: does total_matches ever appear as a
 *  real zero, as opposed to the key being absent? If the vendor never serves
 *  the zero case, "never met" is NOT distinguishable from unreadable from this
 *  endpoint, and that is the finding rather than a feature. The document's stop
 *  condition is explicit: do not synthesise it from an empty recent_matches[]. */
export const neverMetDiscriminable = (rows, key = 'head_to_head', inner = 'total_matches') => {
  let withObject = 0, nullOrAbsent = 0, zero = 0, positive = 0, innerAbsent = 0
  for (const r of rows) {
    const st = stateOf(r ?? {}, key)
    if (st !== 'present') { nullOrAbsent++; continue }
    withObject++
    const o = r[key]
    if (!(inner in (o ?? {}))) { innerAbsent++; continue }
    const v = o[inner]
    if (v === 0) zero++
    else if (typeof v === 'number' && v > 0) positive++
  }
  return {
    rows: rows.length,
    head_to_head_present: withObject,
    head_to_head_null_or_absent: nullOrAbsent,
    total_matches_absent_within_object: innerAbsent,
    total_matches_ZERO: zero,
    total_matches_positive: positive,
    discriminable: zero > 0,
    verdict: zero > 0
      ? `"never met" IS distinguishable: total_matches appears as a real 0 on ${zero} row(s).`
      : `"never met" is NOT distinguishable from unreadable on this endpoint — total_matches never appears as 0 across ${rows.length} rows. STOP per the document; do not synthesise it from an empty recent_matches[].`,
  }
}

/** TASK 4 — one SAMPLED VALUE per named field, not a distribution.
 *  A field that is 100% present and holds an opaque integer is not the hook its
 *  rate suggests: whether round_label reads "Matchweek 8" or "8" decides
 *  whether it can appear in prose at all. */
export const sampleValues = (rows, fields) => {
  const out = {}
  for (const f of fields) {
    const hit = rows.find(r => stateOf(r ?? {}, f) === 'present')
    let v = hit ? hit[f] : undefined
    if (v && typeof v === 'object') v = Array.isArray(v) ? v.slice(0, 1) : Object.fromEntries(Object.entries(v).slice(0, 6))
    out[f] = {
      hasPresentRow: !!hit,
      sample: hit ? v : null,
      jsType: hit ? (Array.isArray(hit[f]) ? 'array' : typeof hit[f]) : null,
      note: hit ? null : 'no row carries this field in a present state, so no value could be sampled',
    }
  }
  return out
}

function selfTest () {
  let failed = 0
  // THE DENOMINATOR IS COUNTED, NOT WRITTEN. It was hardcoded as 14 while 24
  // checks ran — so ten new assertions were invisible in the summary line, and
  // a reader checking "14/14" would have believed the suite was the size it
  // said. Rule 91: the coverage prints where the result is read.
  let ran = 0
  const check = (n, c) => { ran++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failed++ }

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

  // ── Task 1: per-league rates, and the pooled number that hides a hole ──
  check('A POOLED RATE CAN HIDE A LEAGUE AT ZERO',
    (() => {
      const rows = [
        { league_id: 1, league_name: 'A', pitch_condition: 'dry' },
        { league_id: 1, league_name: 'A', pitch_condition: 'wet' },
        { league_id: 2, league_name: 'B', pitch_condition: null },
        { league_id: 2, league_name: 'B', pitch_condition: null },
      ]
      const pooled = census(rows).pitch_condition.presentPct      // 50.0
      const per = censusByLeague(rows, ['pitch_condition'])
      return pooled === 50 && per['1'].fields.pitch_condition.presentPct === 100
                           && per['2'].fields.pitch_condition.presentPct === 0
    })())
  check('a row with no league_id lands in an UNSTATED bucket rather than being dropped',
    censusByLeague([{ pitch_condition: 'dry' }], ['pitch_condition'])['__unstated__'].rows === 1)

  // ── Task 1 second half: same rows, or different ones ──
  check('IDENTICAL MISSING SETS ARE REPORTED AS ONE CAUSE',
    (() => {
      const rows = [{ id: 1, a: 1, b: 1 }, { id: 2, a: null, b: null }]
      const o = absenceOverlap(rows, 'a', 'b')
      return o.identical_sets === true && /SAME ROWS/.test(o.verdict) && o.missing_BOTH === 1
    })())
  check('DIFFERENT missing sets of the SAME SIZE are not reported as one cause',
    (() => {
      const rows = [{ id: 1, a: null, b: 1 }, { id: 2, a: 1, b: null }]
      const o = absenceOverlap(rows, 'a', 'b')
      return o.missing_A === 1 && o.missing_B === 1 && o.identical_sets === false && /DIFFERENT ROWS/.test(o.verdict)
    })())

  // ── Task 2: never met, or could not read ──
  check('A REAL ZERO MAKES "never met" DISTINGUISHABLE',
    neverMetDiscriminable([{ head_to_head: { total_matches: 0 } }]).discriminable === true)
  check('TOTAL_MATCHES NEVER ZERO MEANS NOT DISTINGUISHABLE, and says STOP',
    (() => {
      const r = neverMetDiscriminable([{ head_to_head: { total_matches: 3 } }, { head_to_head: null }])
      return r.discriminable === false && /STOP per the document/.test(r.verdict)
    })())
  check('a null head_to_head is counted apart from one whose inner key is absent',
    (() => {
      const r = neverMetDiscriminable([{ head_to_head: null }, { head_to_head: { recent_matches: [] } }])
      return r.head_to_head_null_or_absent === 1 && r.total_matches_absent_within_object === 1
    })())

  // ── Task 4: a sampled value, so 100% present can be read as usable or opaque ──
  check('a sampled value is taken from a PRESENT row, not the first row',
    sampleValues([{ round_label: null }, { round_label: 'Matchweek 8' }], ['round_label']).round_label.sample === 'Matchweek 8')
  check('AN OPAQUE INTEGER IS VISIBLE AS ONE, which is the point of the sample',
    sampleValues([{ round_label: 8 }], ['round_label']).round_label.jsType === 'number')
  check('a field present on no row samples null and says why',
    (() => {
      const v = sampleValues([{ a: null }], ['a']).a
      return v.hasPresentRow === false && v.sample === null && /no value could be sampled/.test(v.note)
    })())
  check('...and an empty shell does not make a sub-field present',
    s.fields.total_matches.present === 1 && s.fields.total_matches.absent === 1)

  console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${ran - failed}/${ran} self-tests`)
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

  // docs/CC-CMD-2026-10-10-bsd-hook-admission-and-per-league-rates.md
  // Task 1 — per-league, because 79.8% pooled is consistent with 100% in one
  // competition and 0% in another, and a dimension scored on the pooled rate
  // would read as 80% covered while being blind to a whole league.
  perLeague: censusByLeague(rows, NAMED),
  // Task 1, second half — are the 39 rows missing pitch_condition the SAME 39
  // missing travel_distance_km? Same rows is one cause; different rows is two.
  absenceOverlap: absenceOverlap(rows, 'pitch_condition', 'travel_distance_km'),
  // Task 2 — can "never met" be told from "we could not read it"?
  neverMet: neverMetDiscriminable(rows),
  // Task 4 — one sampled value per named field, so a 100% rate can be read as
  // usable or opaque. round_label at 100% is a different thing if it holds
  // "Matchweek 8" than if it holds 8.
  sampledValues: sampleValues(rows, NAMED),

  allFields: all,
  coverage: `${rows.length} rows on ${DATE}, ${Object.keys(all).length} distinct field names. One day, not the feed.`,
}
const path = `outbox/bsd-field-census-${stamp}.json`
writeFileSync(path, JSON.stringify(artifact, null, 2) + '\n')
writeFileSync('outbox/bsd-field-census-latest.json', JSON.stringify(artifact, null, 2) + '\n')
console.log(`\n  head_to_head objects: ${artifact.headToHead.rowsWithObject}/${rows.length}`)
console.log(`  absence overlap:      ${artifact.absenceOverlap.verdict}`)
console.log(`  never-met:            ${artifact.neverMet.verdict}`)
console.log(`  leagues seen:         ${Object.keys(artifact.perLeague).length}`)
console.log(`\nCOVERAGE: ${artifact.coverage}`)
console.log(`wrote ${path}`)
console.log('PASS')
