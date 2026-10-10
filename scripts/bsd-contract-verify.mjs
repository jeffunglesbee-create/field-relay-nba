#!/usr/bin/env node
// Done conditions 1 and 3 of docs/CC-CMD-2026-10-10-bsd-coordinate-frames.md,
// asserted against the DEPLOYED route rather than the source.
//
// Why live and not a source read: the whole defect being repaired was a
// published contract whose prose contradicted the data. Reading src/index.js
// to confirm src/index.js is the source-versus-copy substitution this repo's
// rules exist to prevent — a correct object in the file proves nothing about
// what the worker serves until it has deployed.
//
// CI because a CONNECT to the relay host is 403-denied in the sandbox.

export const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev'
export const WANT_REVISION = '2026-10-10-1'
export const MIRROR = 'x = 100 - x; y = 100 - y'

/** Every done-condition assertion, as data, so the list is checkable and the
 *  mutation below can target one. */
export const assertions = (c) => [
  ['revision is ' + WANT_REVISION, c?.revision === WANT_REVISION],
  ['status no longer says provisional', typeof c?.status === 'string' && !/provisional/i.test(c.status)],
  ['space is per-team', c?.coordinateSystem?.space === 'normalized-pitch-per-team'],
  ['axes.x says the goal this team DEFENDS', /defends/i.test(c?.coordinateSystem?.axes?.x ?? '')],
  ['axes.x no longer says 0 = home goal-line', !/0 = home goal-line/i.test(c?.coordinateSystem?.axes?.x ?? '')],
  ['the old wording is recorded, not deleted silently',
    /0 = home goal-line/i.test(c?.coordinateSystem?.corrected?.was?.x ?? '')],
  ['the six keepers are quoted as the measurement',
    (c?.coordinateSystem?.corrected?.keepers ?? []).length === 6],
  ['...and none of them is near 90',
    (c?.coordinateSystem?.corrected?.keepers ?? []).every(k => k.x < 20)],
  ['four distinct frames are documented',
    new Set(Object.values(c?.frames ?? {}).map(f => f.frame)).size === 4],
  ['the two pitch frames have OPPOSITE origins',
    /DEFENDS/i.test(c?.frames?.['average_positions[]']?.xZero ?? '')
    && /ATTACKS/i.test(c?.frames?.['shotmap[].pos']?.xZero ?? '')],
  ['the mirror is marked REQUIRED', c?.transformReference?.mirrorAwayRequired === true],
  ['the mirror formula is byte-identical', c?.transformReference?.mirrorAway === MIRROR],
  ['the deprecated name still carries the same formula',
    c?.transformReference?.mirrorForAwayPerspective === MIRROR],
  ['the shot example is a real record (gm.x is 0, not a bare x of 88.3)',
    c?.frameShapes?.shot?.example?.gm?.x === 0 && c?.frameShapes?.shot?.example?.x === undefined],
  ['the avgPosition example uses the real keys n/name, not player/touches',
    c?.frameShapes?.avgPosition?.example?.n !== undefined
    && c?.frameShapes?.avgPosition?.example?.touches === undefined],
  ['n is documented as a count of unconfirmed definition, not renamed touches',
    /unconfirmed/i.test(c?.frameShapes?.avgPosition?.n ?? '')],
  ['the incidents sequence shape is documented',
    c?.frameShapes?.incidentSequence?.example?.gk !== undefined],
  ['the open item names the availability state, not the axes',
    /X-AvgPos-State/.test(c?.status ?? '')],
]

function selfTest () {
  let failed = 0
  const check = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failed++ }
  const good = {
    revision: WANT_REVISION, status: 'settled. OPEN: see X-AvgPos-State',
    coordinateSystem: {
      space: 'normalized-pitch-per-team',
      axes: { x: 'horizontal, 0 = the goal this team DEFENDS, 100 = the goal it ATTACKS. Per team.' },
      corrected: { was: { x: 'horizontal, 0 = home goal-line, 100 = away goal-line' },
                   keepers: [10.4, 10.6, 9.4, 12.8, 11.5, 9.4].map(x => ({ x })) },
    },
    frames: {
      'average_positions[]': { frame: 'own-goal-relative', xZero: 'the goal this team DEFENDS' },
      'shotmap[].pos': { frame: 'target-goal-relative', xZero: 'the goal this team ATTACKS' },
      'shotmap[].gm': { frame: 'goal-plane', xZero: 'always 0' },
      'incidents[] goal .gm': { frame: 'goal-mouth-2d', xZero: 'across the mouth' },
    },
    transformReference: { mirrorAway: MIRROR, mirrorAwayRequired: true, mirrorForAwayPerspective: MIRROR },
    frameShapes: {
      shot: { example: { gm: { x: 0 } } },
      avgPosition: { example: { n: 46, name: 'Cleiton' }, n: 'A COUNT, exact definition UNCONFIRMED' },
      incidentSequence: { example: { gk: { x: 5.4 } } },
    },
  }
  check('a correct contract passes every assertion', assertions(good).every(([, ok]) => ok))

  // Rule 90: each mutation must be APPLIED and CAUGHT.
  const mutations = [
    ['stale revision', c => { c.revision = '2026-06-25-1' }],
    ['provisional left in status', c => { c.status = 'provisional — pending verification' }],
    ['old shared-axis wording restored', c => { c.coordinateSystem.axes.x = 'horizontal, 0 = home goal-line, 100 = away goal-line' }],
    ['old wording deleted instead of recorded', c => { c.coordinateSystem.corrected.was.x = '' }],
    ['the mirror formula edited', c => { c.transformReference.mirrorAway = 'x = 100 - x' }],
    ['the two pitch frames given the SAME origin', c => { c.frames['shotmap[].pos'].xZero = 'the goal this team DEFENDS' }],
    ['the invented 88.3 shot example put back', c => { c.frameShapes.shot.example = { x: 88.3, y: 51.5 } }],
    ['n renamed touches on the strength of the old example', c => { c.frameShapes.avgPosition.example = { player: 'x', touches: 71 } }],
  ]
  for (const [name, apply] of mutations) {
    const c = JSON.parse(JSON.stringify(good))
    const before = JSON.stringify(c)
    apply(c)
    const applied = JSON.stringify(c) !== before
    const caught = !assertions(c).every(([, ok]) => ok)
    check(`MUTATION applied and caught: ${name}`, applied && caught)
  }
  console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${9 - failed}/9 self-tests`)
  return failed
}

if (process.argv.includes('--self-test')) process.exit(selfTest())

const url = `${RELAY}/bsd/contract`
console.log(`=== bsd contract, DEPLOYED  ${url}`)
let contract
try {
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) { console.log(`FAIL: HTTP ${r.status}`); process.exit(1) }
  contract = await r.json()
} catch (e) {
  console.log(`FAIL: ${e.message}`)
  console.log('If this ran in the sandbox, that is the 403 CONNECT denial — run it on a runner.')
  process.exit(1)
}

let failed = 0
for (const [name, ok] of assertions(contract)) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failed++
}
// Done condition 3 — the three availability states must be distinguishable in
// the RESPONSE, not just in the source. 588245 is the measured case: finished,
// websocket_plus false, so it returns {} for a reason that is not "not yet".
// A live event, taken from the live feed, is the in-play case. Both are read
// from headers, because that is where a caller would read them.
console.log('')
const stateOf = async (id) => {
  const r = await fetch(`${RELAY}/bsd/events/${id}/average-positions`, { headers: { Accept: 'application/json' } })
  const body = await r.text()
  let empty = null
  try { const j = JSON.parse(body); empty = j && typeof j === 'object' && Object.keys(j).length === 0 } catch {}
  return { status: r.status, state: r.headers.get('X-AvgPos-State'), empty }
}

const finished = await stateOf('588245')
console.log(`  588245 (finished, websocket_plus false): HTTP ${finished.status} empty=${finished.empty} X-AvgPos-State=${finished.state}`)
const stateChecks = [
  ['an empty finished event names a state, not a bare {}',
    finished.empty !== true || (finished.state !== null && finished.state !== undefined)],
  ['...and that state is NOT in-play', finished.empty !== true || finished.state !== 'in-play'],
]

let liveId = null
try {
  const lr = await fetch(`${RELAY}/bsd/events/live`, { headers: { Accept: 'application/json' } })
  const lj = await lr.json()
  liveId = (lj?.events || [])[0]?.id ?? null
} catch {}
if (liveId) {
  const inplay = await stateOf(liveId)
  console.log(`  ${liveId} (in the live feed)                : HTTP ${inplay.status} empty=${inplay.empty} X-AvgPos-State=${inplay.state}`)
  stateChecks.push(['a live event that is empty reads in-play',
    inplay.empty !== true || inplay.state === 'in-play'])
} else {
  // Rule 99 / Rule 91: no live event is a COVERAGE gap, not a pass.
  console.log('  (no event is live right now — the in-play case is UNCHECKED, not passed)')
}
for (const [n, ok] of stateChecks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if (!ok) failed++ }
console.log(`  state coverage: ${liveId ? 2 : 1} of 2 states exercised${liveId ? '' : ' (no live event available)'}`)

const list = assertions(contract)
console.log(`\nCOVERAGE: ${list.length} assertions over the live /bsd/contract response,`)
console.log(`revision ${contract?.revision}. Source is not consulted — this is the served object.`)
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${list.length - failed}/${list.length}`)
process.exit(failed === 0 ? 0 : 1)
