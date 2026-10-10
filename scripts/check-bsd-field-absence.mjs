#!/usr/bin/env node
// Task 3 of docs/CC-CMD-2026-10-10-bsd-fields-already-arriving.md:
// "A row missing a field is distinguishable from a row whose field is zero,
//  and a check asserts it."
//
// This is the check. It runs against the REAL census artifact when one is
// present, not only against invented rows — the 2026-10-10 census is what
// makes the distinction load-bearing rather than theoretical:
//
//     attendance             0 present, 193 null    <- would serialize as 0
//     previous_leg_event_id  0 present, 193 null    <- would serialize as 0
//     round_name             0 present, 193 EMPTY   <- empty string, not null
//     is_local_derby       193 present, often FALSE <- would read as missing
//
// Both directions are defects and they pull opposite ways, which is why a
// one-sided check is not enough: collapse absence into 0 and a brief reports a
// crowd of nobody; collapse `false` into absence and 193 answered rows read as
// 193 unanswered ones.

import { readFileSync, existsSync } from 'node:fs'
import { forwardBsdFields, isReading, partitionIsExact, FORWARDED } from '../src/bsd-fields.js'

export const CENSUS = 'outbox/bsd-field-census-latest.json'

/** The two confusions this check exists to prevent, as predicates over a
 *  forwarded object, so a mutation can target one without the other. */
export const absenceIsNotZero = (bsd, field) =>
  !(field in bsd) && (bsd._notReported ?? []).includes(field)

export const zeroIsNotAbsence = (bsd, field) =>
  (field in bsd) && !(bsd._notReported ?? []).includes(field)

function selfTest () {
  let failed = 0
  const check = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failed++ }

  check('null is not a reading', isReading(null) === false)
  check('undefined is not a reading', isReading(undefined) === false)
  check('an empty string is not a reading', isReading('') === false)
  check('an empty array is not a reading', isReading([]) === false)
  check('an empty object is not a reading', isReading({}) === false)
  check('ZERO IS A READING — 0 attendance is a crowd figure', isReading(0) === true)
  check('FALSE IS A READING — is_local_derby false answers the question', isReading(false) === true)

  const row = { attendance: null, is_local_derby: false, round_name: '', has_xg: true, highlights: [] }
  const bsd = forwardBsdFields(row)

  check('a null attendance is NOT forwarded as 0', !('attendance' in bsd))
  check('...and it is named in _notReported, so the absence is readable',
    absenceIsNotZero(bsd, 'attendance'))
  check('a FALSE derby flag IS forwarded', bsd.is_local_derby === false)
  check('...and is not listed as missing', zeroIsNotAbsence(bsd, 'is_local_derby'))
  check('an empty round_name is treated as not reported, not as ""',
    absenceIsNotZero(bsd, 'round_name'))
  check('an empty highlights array is not reported', absenceIsNotZero(bsd, 'highlights'))
  check('the partition is exact — nothing in both, nothing in neither',
    partitionIsExact(bsd).ok === true)

  // Rule 90 — the two collapses, each applied and each caught.
  const collapsedToZero = { ...bsd, attendance: 0 }
  check('MUTATION: absence collapsed to 0 is caught',
    absenceIsNotZero(collapsedToZero, 'attendance') === false)

  const falseTreatedAsMissing = forwardBsdFields(row, FORWARDED)
  delete falseTreatedAsMissing.is_local_derby
  falseTreatedAsMissing._notReported = [...falseTreatedAsMissing._notReported, 'is_local_derby']
  check('MUTATION: a false reading treated as missing is caught',
    zeroIsNotAbsence(falseTreatedAsMissing, 'is_local_derby') === false)

  const bothAtOnce = { ...bsd, attendance: 0, _notReported: [...bsd._notReported] }
  check('MUTATION: a field in BOTH halves breaks the partition',
    partitionIsExact(bothAtOnce).ok === false)

  const n = 17
  console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${n - failed}/${n} self-tests`)
  return failed
}

if (process.argv.includes('--self-test')) process.exit(selfTest())

let failed = 0
const assert = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failed++ }

if (!existsSync(CENSUS)) {
  console.log(`FAIL: no census at ${CENSUS}.`)
  console.log('Run .github/workflows/bsd-field-census.yml — this check asserts against')
  console.log('measured rows, and inventing them would assert against the invention.')
  process.exit(1)
}

const c = JSON.parse(readFileSync(CENSUS, 'utf8'))
console.log(`=== bsd field absence  census=${c.capturedAt}  rows=${c.rows}\n`)

// Rebuild the states the census measured and forward them, so the check runs
// over the real distribution rather than over a hand-written row.
const everNull = [], everFalseOrZero = [], everEmpty = []
for (const [k, v] of Object.entries(c.named)) {
  if (!v) continue
  if (v.null > 0) everNull.push(k)
  if (v.empty > 0) everEmpty.push(k)
}
console.log(`  fields with at least one NULL row : ${everNull.length}  (${everNull.join(', ') || 'none'})`)
console.log(`  fields with at least one EMPTY row: ${everEmpty.length}  (${everEmpty.join(', ') || 'none'})`)

for (const k of everNull) {
  const bsd = forwardBsdFields({ [k]: null })
  assert(`a null ${k} is not forwarded as a value`, absenceIsNotZero(bsd, k))
}
for (const k of everEmpty) {
  const empty = Array.isArray(c.named[k]?.example) ? [] : ''
  const bsd = forwardBsdFields({ [k]: empty })
  assert(`an empty ${k} is not forwarded as a value`, absenceIsNotZero(bsd, k))
}
assert('a zero attendance would still be forwarded, were one ever reported',
  zeroIsNotAbsence(forwardBsdFields({ attendance: 0 }), 'attendance'))
assert('a false is_local_derby is forwarded, matching the 193 rows that carry one',
  zeroIsNotAbsence(forwardBsdFields({ is_local_derby: false }), 'is_local_derby'))
assert('the partition is exact over every named field',
  partitionIsExact(forwardBsdFields({})).ok === true)

console.log(`\nCOVERAGE: ${FORWARDED.length} forwarded field names, checked against the`)
console.log(`${c.rows}-row census of ${c.date}. One day's distribution, not the feed's.`)
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
