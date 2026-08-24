#!/usr/bin/env node
// A dimension's slate-shape cap must be what the code actually produces, and
// every name in these lists must resolve to a live SCALE key.
//
// WHY THIS EXISTS. Era 6 renamed SCALE.matchup -> SCALE.margin. Two constants
// filtered on the string 'matchup':
//
//   export const UNREACHABLE_DIMS      = ['ctx', 'matchup'];
//   export const UNREACHABLE_DIMS_GAME = ['matchup'];
//
// After the rename neither string named anything, so both filters matched
// NOTHING. REACHABLE_CEILING went 245 -> 277 and REACHABLE_CEILING_GAME went
// 270 -> 294 with no error, no test failure, and no diff on those lines -- and
// the /quality endpoint published `unreachable_points: 0` for the game shape
// while still listing "matchup" among the unreachable dims.
//
// The era fingerprint could not see it either: the rename was weight-preserving,
// 30 points before and after. That gap was flagged in the era-6 commit message
// as "worth its own look". This is the look. A list of names is worth exactly
// the guarantee that the names resolve, and there was none.
//
// The check has two halves, and the second is the one with teeth:
//
//   RESOLVE — every key in SLATE_CAPS and every name in either unreachable list
//             is a real SCALE key. This is what would have caught the rename.
//   DERIVE  — the caps equal what the dimension functions return when the fact
//             is missing. SLATE_CAPS.ctx is the one entry that cannot be derived
//             from an exported function, because dim7 is inline in scoreProse,
//             so it is checked against a real no-game scoreProse call instead of
//             trusted. A declared number beside an implementation, with nothing
//             forcing agreement, is this session's most-repeated defect.
//
// --self-test breaks each half and requires the check to go red.

import {
  SCALE, SLATE_CAPS, UNREACHABLE_DIMS, UNREACHABLE_DIMS_GAME, CAPPED_DIMS,
  REACHABLE_CEILING, REACHABLE_CEILING_GAME, NOMINAL_TOTAL,
  scoreProse, marginAgreement, finalityAgreement, MARGIN_MAX, FINALITY_MAX,
} from '../src/journalism-quality.js'

let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else { fail++; console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`) }
}

// Every name that claims to be a dimension, from every list that holds one.
export const unresolved = (scale, ...lists) =>
  lists.flat().filter((k) => !(k in scale))

// The ceilings, recomputed here from SCALE and the caps rather than imported.
// Importing the answer to check the answer proves nothing.
export const ceilings = (scale, caps, unreachGame) => ({
  slate: Object.entries(scale)
    .reduce((a, [k, v]) => a + (k in caps ? caps[k] : v), 0),
  game: Object.entries(scale)
    .filter(([k]) => !unreachGame.includes(k))
    .reduce((a, [, v]) => a + v, 0),
})

const selfTest = process.argv.includes('--self-test')

if (selfTest) {
  console.log('self-test: an unresolvable name and a wrong cap both go red')

  // THE RENAME, REPLAYED. This is era 6's actual defect: a list still naming
  // the pre-rename key while SCALE has moved on.
  check('a list naming a renamed key is caught',
    unresolved(SCALE, ['ctx', 'matchup']).length === 1,
    `'matchup' is not in SCALE and must be reported, got ${JSON.stringify(unresolved(SCALE, ['ctx', 'matchup']))}`)

  // And the consequence of not catching it: the ceiling silently rises.
  const bentCaps = { margin: 15, finality: 10 }   // ctx dropped, as the rename effectively did
  check('a dropped cap moves the ceiling, and the recomputation shows it',
    ceilings(SCALE, bentCaps, []).slate === ceilings(SCALE, SLATE_CAPS, []).slate + SCALE.ctx,
    `${ceilings(SCALE, bentCaps, []).slate} vs ${ceilings(SCALE, SLATE_CAPS, []).slate}`)

  check('a wrong cap value changes the ceiling',
    ceilings(SCALE, { ...SLATE_CAPS, margin: SLATE_CAPS.margin + 1 }, []).slate
      !== ceilings(SCALE, SLATE_CAPS, []).slate)

  // The control. Without it a checker that reds everything passes the above.
  check('the real lists resolve and the real ceilings match',
    unresolved(SCALE, Object.keys(SLATE_CAPS), UNREACHABLE_DIMS, UNREACHABLE_DIMS_GAME).length === 0
    && ceilings(SCALE, SLATE_CAPS, UNREACHABLE_DIMS_GAME).slate === REACHABLE_CEILING
    && ceilings(SCALE, SLATE_CAPS, UNREACHABLE_DIMS_GAME).game === REACHABLE_CEILING_GAME)
} else {
  console.log('slate caps resolve against SCALE and match what the code produces')

  // ── RESOLVE. ──────────────────────────────────────────────────────────────
  check('every name in SLATE_CAPS / UNREACHABLE_DIMS / UNREACHABLE_DIMS_GAME is a live SCALE key',
    unresolved(SCALE, Object.keys(SLATE_CAPS), UNREACHABLE_DIMS, UNREACHABLE_DIMS_GAME).length === 0,
    `unresolved: ${JSON.stringify(unresolved(SCALE, Object.keys(SLATE_CAPS), UNREACHABLE_DIMS, UNREACHABLE_DIMS_GAME))} — a rename left a list pointing at nothing`)
  check('no cap exceeds its own declared weight',
    Object.entries(SLATE_CAPS).every(([k, v]) => v >= 0 && v <= SCALE[k]),
    JSON.stringify(SLATE_CAPS))
  check('UNREACHABLE_DIMS and CAPPED_DIMS partition the capped set',
    [...UNREACHABLE_DIMS, ...CAPPED_DIMS].sort().join() === Object.keys(SLATE_CAPS).sort().join()
    && UNREACHABLE_DIMS.every((k) => !CAPPED_DIMS.includes(k)),
    `${JSON.stringify(UNREACHABLE_DIMS)} + ${JSON.stringify(CAPPED_DIMS)} vs ${JSON.stringify(Object.keys(SLATE_CAPS))}`)

  // ── DERIVE. ───────────────────────────────────────────────────────────────
  check(`SLATE_CAPS.margin (${SLATE_CAPS.margin}) is what marginAgreement returns with no result`,
    SLATE_CAPS.margin === marginAgreement('x', null).score
    && marginAgreement('x', null).verdict === 'unknown-result',
    JSON.stringify(marginAgreement('x', null)))
  check(`SLATE_CAPS.finality (${SLATE_CAPS.finality}) is what finalityAgreement returns with no fact`,
    SLATE_CAPS.finality === finalityAgreement('x', null).score
    && finalityAgreement('x', null).verdict === 'unknown-finality',
    JSON.stringify(finalityAgreement('x', null)))
  check('an abstain is a MIDPOINT, not a zero — the whole reason the binary list broke',
    SLATE_CAPS.margin === MARGIN_MAX / 2 && SLATE_CAPS.finality === FINALITY_MAX / 2,
    'if either became 0 these dims would be genuinely unreachable and belong in UNREACHABLE_DIMS')

  // ctx is the one declared entry. Checked against a REAL no-game call.
  const noGame = await scoreProse(
    'Arsenal held on to win 2-1 after Saka sealed it late in front of a full house.',
    { sport: 'soccer', game: null, breakdown: true })
  check(`SLATE_CAPS.ctx (${SLATE_CAPS.ctx}) matches a real scoreProse call with game: null`,
    Math.round((noGame.dims.contextAnchoring || 0) * SCALE.ctx) === SLATE_CAPS.ctx,
    `scoreProse with no game scored contextAnchoring ${noGame.dims.contextAnchoring} (${Math.round((noGame.dims.contextAnchoring || 0) * SCALE.ctx)} pts), SLATE_CAPS says ${SLATE_CAPS.ctx}`)
  // The control for that call: it must have scored SOMETHING, or a broken
  // scoreProse would satisfy the line above with an all-zero breakdown.
  check('...and that call scored above zero elsewhere, so the zero is about ctx',
    Object.entries(noGame.dims).some(([k, v]) => k !== 'contextAnchoring' && v > 0),
    JSON.stringify(noGame.dims))

  // ── The arithmetic. ───────────────────────────────────────────────────────
  const c = ceilings(SCALE, SLATE_CAPS, UNREACHABLE_DIMS_GAME)
  check(`REACHABLE_CEILING (${REACHABLE_CEILING}) equals the recomputed slate sum (${c.slate})`,
    REACHABLE_CEILING === c.slate)
  check(`REACHABLE_CEILING_GAME (${REACHABLE_CEILING_GAME}) equals the recomputed game sum (${c.game})`,
    REACHABLE_CEILING_GAME === c.game)
  check('a brief WITH a game reaches the full nominal total',
    REACHABLE_CEILING_GAME === NOMINAL_TOTAL,
    `era 6 emptied UNREACHABLE_DIMS_GAME; if this fails a dimension has become game-unreachable again and needs an entry`)
  check('a slate brief reaches strictly less than a game brief',
    REACHABLE_CEILING < REACHABLE_CEILING_GAME,
    `${REACHABLE_CEILING} vs ${REACHABLE_CEILING_GAME}`)
}

console.log(fail ? `\n${fail} failed` : '\nall passed')
process.exit(fail ? 1 : 0)
