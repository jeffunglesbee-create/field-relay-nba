#!/usr/bin/env node
// Verifier for docs/CC-CMD-2026-10-10-bsd-coordinate-frames.md, Task 6.
// Two assertions over a committed capture. No live match, no BSD token.
//
// ASSERTION 1 — `gml` agrees with sign(gm.y - 50), on BOTH sides.
//   `gml` is the one field in the feed that labels its own number, so it is a
//   self-describing control rather than a convention this repo chose. It is
//   what settled y. The agreement must hold identically for home: true and
//   home: false. A SPLIT BY SIDE would mean the two teams' lateral axes have
//   opposite handedness — a reflection, not a rotation — and the contract's
//   `mirrorAway` transform (y = 100 - y) would be wrong. That is a documented
//   STOP condition, not a failure to patch.
//
// ASSERTION 2 — |home_gk.x - away_gk.x| < 20 in average_positions.
//   This is the test that discriminates a per-team frame from a shared axis.
//   What it replaces matters more than what it does: checking the HOME keeper's
//   x alone reads ~10 and concludes, correctly, that x = 0 is the home goal —
//   while the away side is silently drawn into the home half. THE ONE-SIDED
//   CHECK PASSES ON BROKEN DATA. `--mutate` proves this one is not that one.

import { readFileSync, existsSync } from 'node:fs'

export const FIXTURE = 'scripts/fixtures/bsd-223324-coordinates.json'
export const GK_SPREAD_MAX = 20

/** left / right / centre, from the human label. Returns null when the label
 *  says none of the three — absent, not centre (Rule 99). */
export const sideOf = (gml) => {
  const s = String(gml ?? '').toLowerCase()
  if (/\bleft\b|-left|left-/.test(s)) return 'left'
  if (/\bright\b|-right|right-/.test(s)) return 'right'
  if (/centre|center/.test(s)) return 'centre'
  return null
}

/** The expected sign of (gm.y - 50) for a label, or null where the label
 *  constrains nothing. Centre deliberately constrains NOTHING: a centre shot
 *  sitting either side of 50 is not evidence about handedness, and asserting
 *  a band there would be inventing a tolerance the feed never promised. */
export const expectedSign = (side) => side === 'left' ? 1 : side === 'right' ? -1 : null

/** One shot's verdict. `skip` where the label does not discriminate. */
export const shotAgrees = (shot) => {
  const side = sideOf(shot?.gml)
  const want = expectedSign(side)
  const y = shot?.gm?.y
  if (want === null || typeof y !== 'number') return { side, skip: true }
  const got = y > 50 ? 1 : y < 50 ? -1 : 0
  return { side, skip: false, agrees: got === want, y }
}

/** Assertion 1, split by side so a reflection is visible rather than averaged
 *  away. `onlyHome` exists for --mutate: it is the broken form. */
export const gmlAgreement = (shots, { onlyHome = false } = {}) => {
  const buckets = { home: { n: 0, agree: 0 }, away: { n: 0, agree: 0 } }
  let skipped = 0
  for (const s of shots) {
    if (onlyHome && s?.home !== true) continue
    const v = shotAgrees(s)
    if (v.skip) { skipped++; continue }
    const b = s?.home === true ? buckets.home : buckets.away
    b.n++; if (v.agrees) b.agree++
  }
  const rate = b => b.n === 0 ? null : b.agree / b.n
  const hr = rate(buckets.home), ar = rate(buckets.away)
  // A split is one side agreeing and the other anti-agreeing. Both-null is not
  // a split, it is no data — a different answer.
  const split = hr !== null && ar !== null && ((hr > 0.9 && ar < 0.1) || (ar > 0.9 && hr < 0.1))
  // In the one-sided form, `ok` is what the BROKEN check actually concluded:
  // "the home shots agree, so the convention holds". It never looked at away,
  // so its verdict cannot depend on away — modelling it as "fails because away
  // is absent" would make the mutation pass for the wrong reason and prove
  // nothing. The honest form is the one that passes on broken data.
  return {
    buckets, skipped, homeRate: hr, awayRate: ar, split,
    ok: onlyHome ? hr === 1 : (hr !== null && ar !== null && hr === 1 && ar === 1),
    total: buckets.home.n + buckets.away.n,
  }
}

/** Both sides' goalkeepers from average_positions. Returns nulls, never 0, when
 *  a side carries no `pos: "G"` — "this capture has no keeper" and "the keeper
 *  is at the origin" are different facts. */
export const keepers = (avg) => {
  const ap = avg?.average_positions ?? avg ?? {}
  const gkOf = (arr) => (arr || []).find(p => String(p?.pos ?? '').toUpperCase() === 'G') ?? null
  return { home: gkOf(ap.home), away: gkOf(ap.away) }
}

/** Assertion 2. `oneSided` is the broken form --mutate installs. */
export const keeperSpread = ({ home, away }, { oneSided = false } = {}) => {
  if (oneSided) {
    const x = home?.x
    return { oneSided: true, homeX: x ?? null, awayX: away?.x ?? null,
             ok: typeof x === 'number' && x < 25, spread: null }
  }
  if (typeof home?.x !== 'number' || typeof away?.x !== 'number') {
    return { ok: false, reason: 'a side carries no pos:"G"', homeX: home?.x ?? null, awayX: away?.x ?? null, spread: null }
  }
  const spread = Math.abs(home.x - away.x)
  return { ok: spread < GK_SPREAD_MAX, homeX: home.x, awayX: away.x, spread }
}

// ---------------------------------------------------------------- self-test
function selfTest () {
  let failed = 0
  const check = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failed++ }

  check('a "left" label is read as left', sideOf('low-left') === 'left')
  check('a "right" label is read as right', sideOf('high-right') === 'right')
  check('a "centre" label is read as centre', sideOf('low-centre') === 'centre')
  check('American spelling is read too', sideOf('low-center') === 'centre')
  check('an unknown label is null, NOT centre (Rule 99)', sideOf('blocked') === null)
  check('a missing label is null', sideOf(undefined) === null)
  check('centre constrains no sign', expectedSign('centre') === null)

  const rot = [ // y>50 is left for BOTH sides — a rotation
    { home: true,  gml: 'low-left',   gm: { y: 71.1 } },
    { home: true,  gml: 'high-right', gm: { y: 38.7 } },
    { home: false, gml: 'low-left',   gm: { y: 62.4 } },
    { home: false, gml: 'low-right',  gm: { y: 45.9 } },
  ]
  const a = gmlAgreement(rot)
  check('a rotation agrees on both sides', a.ok === true && a.split === false)
  check('...and counts every discriminating shot', a.total === 4)

  const refl = [ // home agrees, away is inverted — a reflection
    { home: true,  gml: 'low-left',   gm: { y: 71.1 } },
    { home: true,  gml: 'high-right', gm: { y: 38.7 } },
    { home: false, gml: 'low-left',   gm: { y: 37.6 } },
    { home: false, gml: 'low-right',  gm: { y: 54.1 } },
  ]
  const r = gmlAgreement(refl)
  check('MUTATION: a REFLECTION is caught as a split', r.split === true && r.ok === false)
  check('...and the one-sided form MISSES it, which is why it is banned',
    gmlAgreement(refl, { onlyHome: true }).ok === true)

  check('an unlabelled shot is skipped, not failed',
    gmlAgreement([{ home: true, gml: 'blocked', gm: { y: 71 } }]).skipped === 1)
  check('no data is not a split', gmlAgreement([]).split === false)

  const perTeam = { average_positions: { home: [{ pos: 'G', x: 10.6 }], away: [{ pos: 'G', x: 10.4 }] } }
  const shared  = { average_positions: { home: [{ pos: 'G', x: 10.6 }], away: [{ pos: 'G', x: 89.6 }] } }
  check('per-team frames put both keepers near 0',
    keeperSpread(keepers(perTeam)).ok === true)
  check('MUTATION: a SHARED axis is caught by the spread',
    keeperSpread(keepers(shared)).ok === false)
  check('...and the ONE-SIDED check PASSES on that same broken data',
    keeperSpread(keepers(shared), { oneSided: true }).ok === true)
  check('a side with no keeper fails rather than reading 0 (Rule 99)',
    keeperSpread(keepers({ average_positions: { home: [{ pos: 'G', x: 10 }], away: [{ pos: 'D', x: 20 }] } })).homeX === 10)
  check('...and reports the missing side as null, not 0',
    keeperSpread(keepers({ average_positions: { home: [{ pos: 'G', x: 10 }], away: [] } })).awayX === null)

  console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${18 - failed}/18 self-tests`)
  return failed
}

if (process.argv.includes('--self-test')) process.exit(selfTest())

// ---------------------------------------------------------------- live run
const mutate = process.argv.includes('--mutate')

if (!existsSync(FIXTURE)) {
  console.log(`FAIL: no fixture at ${FIXTURE}`)
  console.log('Capture it first: .github/workflows/bsd-coordinate-capture.yml')
  console.log('(the sandbox cannot reach the relay; the capture runs on a runner)')
  process.exit(1)
}

const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const shots = fx.shotmap?.shotmap ?? fx.shotmap?.shots ?? fx.shotmap ?? []
const shotList = Array.isArray(shots) ? shots : []

console.log(`=== bsd coordinate frames  fixture=${FIXTURE}  event=${fx._capture?.event ?? '?'}`)
if (mutate) console.log('    --mutate: running the BROKEN one-sided forms; both MUST fail\n')

const agree = gmlAgreement(shotList, { onlyHome: mutate })
const gk = keeperSpread(keepers(fx['average-positions']), { oneSided: mutate })

console.log(`  shots in capture        : ${shotList.length}`)
console.log(`  discriminating (l/r)    : ${agree.total}   skipped (centre/unlabelled): ${agree.skipped}`)
console.log(`  gml agrees, home side   : ${agree.buckets.home.agree}/${agree.buckets.home.n}`)
console.log(`  gml agrees, away side   : ${agree.buckets.away.agree}/${agree.buckets.away.n}`)
console.log(`  keeper x, home / away   : ${gk.homeX} / ${gk.awayX}   spread ${gk.spread ?? 'n/a'}`)
console.log('')

let failed = 0
const assert = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failed++ }

if (agree.split) {
  console.log('STOP CONDITION HIT — gml agreement SPLITS BY SIDE.')
  console.log('That is a reflection, not a rotation, and the contract mirror is wrong.')
  console.log('Report before changing the transform. See the CC-CMD stop conditions.')
  process.exit(2)
}

assert('gml agrees with sign(gm.y - 50) on every discriminating shot', agree.ok)
assert('...and agrees on BOTH sides, so the frames are a rotation', !agree.split && agree.awayRate === 1)
assert('both goalkeepers sit near their own goal line (per-team frame)', gk.ok)

// Rule 91: the denominator, where the result is read.
console.log(`\nCOVERAGE: 1 event (${fx._capture?.event ?? '?'}), ${agree.total} of ${shotList.length} shots`)
console.log('discriminating; the rest are centre or unlabelled and constrain no sign.')
console.log('One capture, not a sample of the feed — widening it means capturing another event.')

if (mutate) {
  const caught = failed > 0
  console.log(`\n${caught ? 'OK' : 'MUTATION NOT CAUGHT'} — the one-sided forms ${caught ? 'failed, as they must' : 'PASSED, so these assertions prove nothing'}`)
  process.exit(caught ? 0 : 1)
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${3 - failed}/3 assertions`)
process.exit(failed === 0 ? 0 : 1)
