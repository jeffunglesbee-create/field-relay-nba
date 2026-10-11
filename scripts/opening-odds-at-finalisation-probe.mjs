#!/usr/bin/env node
// The in-window denominator: what fraction of rows dated 2026-06-23 → 07-11
// carry `opening_odds` that were written at finalisation?
//
// docs/CC-CMD-2026-08-25-misjoined-opening-odds.md step 1. 156 of 789 across 90
// days is already measured. The open question is the rate INSIDE the window —
// "if it is nearly all of them, the capture path was wrong for that whole
// period rather than intermittently".
//
// TWO DENOMINATORS, because the document names the ambiguity itself: the
// field-laboratory census only reads games that already carry a comparable
// moneyline AND a balanced handicap, so a date with no flagged rows may be
// clean or may simply be absent from that corpus. This reports the rate against
// BOTH every archive row in the window and the census-eligible subset, and
// prints the five dates the document calls empty (06-25, 06-26, 06-29, 06-30,
// 07-01) with their own counts so "clean" and "absent" stop looking alike.
//
// No credential: /context/date serves opening_odds verbatim and publicly, and
// SELECTs * from both tables. No Odds API call, so no quota spend.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev'

// ── the classifier ──────────────────────────────────────────────────────────

export const parseOdds = (v) => {
  if (v == null) return null
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch (_) { return undefined }   // undefined = unparseable
}

// `finalized_at` is a SQLite datetime string ('2026-06-28 21:50:24', UTC) and
// `captured_at` is an ISO instant. Comparing them needs the space replaced and
// a Z added, or Date.parse reads the first as local time — which on a UTC
// runner looks correct and on any other machine is silently off by the offset.
export const toMs = (s) => {
  if (!s || typeof s !== 'string') return null
  const iso = /\d{4}-\d{2}-\d{2}[T ]/.test(s)
    ? (s.includes('T') ? s : s.replace(' ', 'T') + (/[Zz]|[+-]\d{2}:?\d{2}$/.test(s) ? '' : 'Z'))
    : null
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

export const WINDOW_SECONDS = 60

// Four states, never a boolean. The document's test is "captured_at within a
// minute of finalized_at" — but a row with no opening_odds, a row whose blob
// carries no captured_at, and a row that was never finalised are three
// different facts and none of them is "clean".
export const classifyRow = (row) => {
  const o = parseOdds(row.opening_odds)
  if (o === null) return { state: 'no-opening-odds' }
  if (o === undefined) return { state: 'opening-odds-unparseable' }
  const cap = toMs(o.captured_at)
  const fin = toMs(row.finalized_at)
  if (cap === null) return { state: 'no-captured-at' }
  if (fin === null) return { state: 'not-finalised' }
  const deltaS = (cap - fin) / 1000
  return Math.abs(deltaS) <= WINDOW_SECONDS
    ? { state: 'at-finalisation', deltaS }
    : { state: 'before-finalisation', deltaS }
}

// The field-laboratory census's own gate, so the second denominator is the
// corpus that census actually reads rather than a guess at it.
export const censusEligible = (row) => {
  const o = parseOdds(row.opening_odds)
  if (!o || typeof o !== 'object') return false
  const ml = o.moneyline
  const sp = o.spread
  const hasML = ml && Number.isFinite(Number(ml.home)) && Number.isFinite(Number(ml.away))
  const hasBalanced = sp && Number.isFinite(Number(sp.home)) && Number.isFinite(Number(sp.away))
    && Math.abs(Number(sp.home) + Number(sp.away)) < 1e-9
  return !!(hasML && hasBalanced)
}

// ── self-test ───────────────────────────────────────────────────────────────
if (process.argv.includes('--self-test')) {
  let ran = 0, bad = 0
  const eq = (got, want, label) => {
    ran++; const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} = ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
  }
  const F = '2026-06-28 21:50:24'
  eq(classifyRow({ opening_odds: null }).state, 'no-opening-odds', 'no opening_odds')
  eq(classifyRow({ opening_odds: '{oops' }).state, 'opening-odds-unparseable', 'unparseable blob')
  eq(classifyRow({ opening_odds: '{}', finalized_at: F }).state, 'no-captured-at', 'blob with no captured_at')
  eq(classifyRow({ opening_odds: JSON.stringify({ captured_at: '2026-06-28T20:00:00Z' }) }).state,
    'not-finalised', 'never finalised')
  // THE DECISIVE ROW from the document: 2026-06-28T21:50:25.898Z against
  // finalized_at 2026-06-28 21:50:24 — 1.898s.
  eq(classifyRow({ opening_odds: JSON.stringify({ captured_at: '2026-06-28T21:50:25.898Z' }), finalized_at: F }).state,
    'at-finalisation', 'the document\'s decisive row')
  eq(Math.round(classifyRow({ opening_odds: JSON.stringify({ captured_at: '2026-06-28T21:50:25.898Z' }), finalized_at: F }).deltaS * 1000) / 1000,
    1.898, 'and its delta in seconds')
  eq(classifyRow({ opening_odds: JSON.stringify({ captured_at: '2026-06-28T18:00:00Z' }), finalized_at: F }).state,
    'before-finalisation', 'a genuine pre-game capture')
  // Just inside and just outside the minute, both directions.
  eq(classifyRow({ opening_odds: JSON.stringify({ captured_at: '2026-06-28T21:49:25Z' }), finalized_at: F }).state,
    'at-finalisation', '59s before finalisation is inside')
  eq(classifyRow({ opening_odds: JSON.stringify({ captured_at: '2026-06-28T21:49:23Z' }), finalized_at: F }).state,
    'before-finalisation', '61s before is outside')
  eq(classifyRow({ opening_odds: JSON.stringify({ captured_at: '2026-06-28T21:51:24Z' }), finalized_at: F }).state,
    'at-finalisation', '60s after is inside')

  // THE TIMEZONE TRAP. A space-separated SQLite datetime parsed without a Z is
  // read as LOCAL time. On a UTC runner that is invisible; anywhere else it
  // shifts by the offset and every verdict moves.
  eq(toMs('2026-06-28 21:50:24'), Date.parse('2026-06-28T21:50:24Z'), 'a space datetime is read as UTC')
  eq(toMs('2026-06-28T21:50:24.500Z'), Date.parse('2026-06-28T21:50:24.500Z'), 'an ISO instant is unchanged')
  eq(toMs(null), null, 'a null datetime')
  eq(toMs('not a date'), null, 'a non-date string')

  eq(censusEligible({ opening_odds: JSON.stringify({ moneyline: { home: -110, away: -110 }, spread: { home: 1.5, away: -1.5 } }) }),
    true, 'moneyline plus a balanced handicap is eligible')
  eq(censusEligible({ opening_odds: JSON.stringify({ moneyline: { home: -110, away: -110 }, spread: { home: 1.5, away: -2.5 } }) }),
    false, 'an unbalanced handicap is not')
  eq(censusEligible({ opening_odds: JSON.stringify({ spread: { home: 1.5, away: -1.5 } }) }),
    false, 'a handicap with no moneyline is not')
  eq(censusEligible({ opening_odds: null }), false, 'no odds at all is not')

  console.log(`\nself-test: ${ran - bad}/${ran}`)
  console.log('COVERAGE: the classifier and the datetime reader, on synthetic rows.')
  console.log('It reads no archive row and reports nothing about the window.')
  process.exit(bad ? 1 : 0)
}

// ── the live walk ───────────────────────────────────────────────────────────
const dates = []
{
  const from = process.env.FROM || '2026-06-23', to = process.env.TO || '2026-07-11'
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000)
    dates.push(new Date(t).toISOString().slice(0, 10))
}
// The document calls these five dates empty and does not establish whether
// they were clean or simply absent from the census corpus.
const CALLED_EMPTY = new Set(['2026-06-25', '2026-06-26', '2026-06-29', '2026-06-30', '2026-07-01'])

const perDate = []
let calls = 0
for (const d of dates) {
  calls++
  let body = null, status = null
  try {
    const r = await fetch(`${RELAY}/context/date/${d}`, { headers: { 'User-Agent': 'FIELD/1.0' } })
    status = r.status
    if (r.ok) body = await r.json()
  } catch (e) { status = `threw: ${e.message}` }
  const rows = [
    ...(body?.games?.regular || []),
    ...(body?.games?.postseason || []),
  ]
  const states = {}
  let eligible = 0, eligibleAtFin = 0, withProof = 0, atFinWithProof = 0, atFinNoProof = 0
  const proofShapes = {}
  const examples = []
  for (const row of rows) {
    const c = classifyRow(row)
    states[c.state] = (states[c.state] || 0) + 1
    const el = censusEligible(row)
    if (el) eligible++
    if (c.state === 'at-finalisation') {
      if (el) eligibleAtFin++
      if (examples.length < 2) examples.push({ id: row.id, deltaS: c.deltaS, sport: row.sport })
    }
    const o = parseOdds(row.opening_odds)
    const hasProof = !!(o && typeof o === 'object' && o._oddsProof)
    if (hasProof) withProof++
    // THE DOCUMENT'S SIGNAL 3 SAYS THESE ROWS CARRY NO `_oddsProof`. Whether
    // that holds for the flagged rows specifically, rather than for the window
    // as a whole, decides whether the writer can be named from the blob — so
    // the overlap is counted instead of inferred from two separate totals.
    if (c.state === 'at-finalisation' && hasProof) atFinWithProof++
    if (c.state === 'at-finalisation' && !hasProof) atFinNoProof++
    if (hasProof && o._oddsProof) {
      const k = JSON.stringify(o._oddsProof)
      proofShapes[k] = (proofShapes[k] || 0) + 1
    }
  }
  perDate.push({
    date: d, status, rows: rows.length, states,
    atFinalisation: states['at-finalisation'] || 0,
    censusEligible: eligible, censusEligibleAtFinalisation: eligibleAtFin,
    withOddsProof: withProof, atFinalisationWithProof: atFinWithProof,
    atFinalisationNoProof: atFinNoProof, proofShapes,
    calledEmptyByTheDocument: CALLED_EMPTY.has(d),
    examples,
  })
  process.stderr.write('.')
}
process.stderr.write('\n')

// `(r[k] || 0)` was the first version and check-aggregate-launders-unknowns
// refused it, correctly: a field absent from a per-date record and a field
// that genuinely counted zero would both contribute 0, and the total could not
// tell them apart. total() reports `skipped` instead, and a nonzero skipped
// count means a per-date record is missing a key this summary claims to add up.
const { total } = await import('./lib/summary-invariants.mjs')
const sum = (k) => {
  const t = total(perDate, k)
  if (t.skipped !== 0) {
    console.error(`FAIL — ${t.skipped} of ${perDate.length} per-date record(s) carry no numeric '${k}'.`)
    console.error('A total built over those cannot be read, so none is printed.')
    process.exit(1)
  }
  return t.sum
}
const totalRows = sum('rows'), atFin = sum('atFinalisation')
const elig = sum('censusEligible'), eligAtFin = sum('censusEligibleAtFinalisation')
const proof = sum('withOddsProof')
const atFinProof = sum('atFinalisationWithProof'), atFinNo = sum('atFinalisationNoProof')
const allShapes = {}
for (const r of perDate) for (const [k, n] of Object.entries(r.proofShapes || {})) allShapes[k] = (allShapes[k] || 0) + n
const served = perDate.filter(r => r.status === 200).length

const out = {
  probed_at_utc: process.env.PROBE_STAMP || null,
  window: { from: dates[0], to: dates[dates.length - 1], dates: dates.length, served },
  totals: {
    rows: totalRows,
    atFinalisation: atFin,
    rateOfAllRows: totalRows ? +(atFin / totalRows).toFixed(4) : null,
    censusEligible: elig,
    censusEligibleAtFinalisation: eligAtFin,
    rateOfCensusEligible: elig ? +(eligAtFin / elig).toFixed(4) : null,
    withOddsProof: proof,
    atFinalisationWithProof: atFinProof,
    atFinalisationNoProof: atFinNo,
    proofShapes: allShapes,
  },
  perDate,
}

const { writeFileSync, mkdirSync } = await import('node:fs')
mkdirSync('outbox', { recursive: true })
const stamp = process.env.PROBE_STAMP || 'latest'
writeFileSync(`outbox/opening-odds-at-finalisation-${stamp}.json`, JSON.stringify(out, null, 2))
writeFileSync('outbox/opening-odds-at-finalisation-latest.json', JSON.stringify(out, null, 2))

console.log(`\n=== opening_odds written at finalisation — in-window denominator ===\n`)
console.log(`  window                              : ${dates[0]} → ${dates[dates.length - 1]} (${dates.length} dates, ${served} served 200)`)
console.log(`  archive rows in the window          : ${totalRows}`)
console.log(`  of those, captured at finalisation  : ${atFin}  (${totalRows ? (100 * atFin / totalRows).toFixed(1) : '—'}%)`)
console.log(`  census-eligible rows                : ${elig}   (moneyline + balanced handicap)`)
console.log(`  of those, captured at finalisation  : ${eligAtFin}  (${elig ? (100 * eligAtFin / elig).toFixed(1) : '—'}%)`)
console.log(`  carrying _oddsProof                 : ${proof}`)
console.log(`    of the flagged rows, WITH proof   : ${atFinProof}`)
console.log(`    of the flagged rows, WITHOUT      : ${atFinNo}   (the document's signal 3 claims all of them)`)
for (const [k, n] of Object.entries(allShapes).sort((a, b) => b[1] - a[1]).slice(0, 4))
  console.log(`    proof shape x${String(n).padStart(4)}            : ${k.slice(0, 96)}`)
console.log(`\n  per date  (E = the document calls this date empty)`)
console.log(`  date         rows   atFin   eligible   eligAtFin`)
for (const r of perDate) {
  console.log(`  ${r.date} ${r.calledEmptyByTheDocument ? 'E' : ' '} ${String(r.rows).padStart(5)} ${String(r.atFinalisation).padStart(7)} ${String(r.censusEligible).padStart(10)} ${String(r.censusEligibleAtFinalisation).padStart(11)}${r.status !== 200 ? `   status ${r.status}` : ''}`)
}
console.log(`\nCOVERAGE: ${served} of ${dates.length} dates served. Two denominators, because a date`)
console.log('with no flagged row may be clean OR absent from the census corpus, and the')
console.log('rate against all archive rows cannot tell those apart on its own.')
console.log(`calls: ${calls}  (no Odds API call — /context/date only, no quota spend)`)
