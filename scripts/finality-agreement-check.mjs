#!/usr/bin/env node
// Dim 11 candidate: prose-vs-fact agreement, all four corners and both abstains.
//
// The dimension this checks scores AGREEMENT, not finality. Full marks for a
// recap that reads as finished on a finished game AND for a brief that hedges
// about a game still being played; zero for either mismatch. That symmetry is
// the ask (CC-CMD-2026-08-23-finality-dimension §2) and it is also why the
// existing LIVE_LANG split cannot measure it: LIVE_LANG classifies by prose
// alone, so rewarding a correctly hedged live brief NARROWS that gap and would
// read as a regression for a dimension working exactly as specified.
//
// Every case below is an input/output pair, not a "looks right" (Rule 89). The
// four corners must differ from each other, or the dimension is a constant with
// extra steps.

import { finalityAgreement, FINALITY_MAX } from '../src/journalism-quality.js'

let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else { fail++; console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`) }
}

const FINISHED = 'Arsenal held on to win 2-1 after Saka sealed it late.'
const HEDGING  = 'Arsenal lead 2-1 at halftime, with Saka already on the scoresheet.'
const NEITHER  = 'Arsenal and Chelsea have met eleven times at this ground.'
const BOTH     = 'Arsenal held on to win 2-1; they had led 2-0 at halftime.'

console.log('finality agreement — the 2x2, plus what abstains')

// ── The two defects. These are the reason the dimension exists. ──────────────
const liveCalledFinal = finalityAgreement(FINISHED, false)
check('calling a live game final scores zero',
  liveCalledFinal.score === 0 && liveCalledFinal.verdict === 'calls-a-live-game-final',
  JSON.stringify(liveCalledFinal))

const finishedHedged = finalityAgreement(HEDGING, true)
check('hedging about a finished game scores zero',
  finishedHedged.score === 0 && finishedHedged.verdict === 'hedges-a-finished-game',
  `the mirrored defect — ${JSON.stringify(finishedHedged)}`)

// ── The two agreements. Without these the dimension could just score hedging. ─
check('a recap that reads final on a finished game scores full',
  finalityAgreement(FINISHED, true).score === FINALITY_MAX)
check('a brief that hedges about a live game ALSO scores full',
  finalityAgreement(HEDGING, false).score === FINALITY_MAX,
  'this corner is the whole difference from a hedge-penalty, and the one the LIVE_LANG split gets backwards')

// ── Abstains, both labelled. A dimension that is zero everywhere passes every
//    aggregate test while doing nothing — Dim 10 did exactly that for two
//    months, zero on 190 of 190 rows.
const unknown = finalityAgreement(FINISHED, null)
check('unknown finality scores the midpoint and says so',
  unknown.score === FINALITY_MAX / 2 && unknown.verdict === 'unknown-finality',
  JSON.stringify(unknown))
const noReading = finalityAgreement(NEITHER, true)
check('prose with no finality reading scores the midpoint and says so',
  noReading.score === FINALITY_MAX / 2 && noReading.verdict === 'no-clear-reading',
  JSON.stringify(noReading))
check('prose reading BOTH ways is not scored as either',
  finalityAgreement(BOTH, true).reading === 'mixed'
  && finalityAgreement(BOTH, true).score === FINALITY_MAX / 2,
  `a recap that names a halftime score is not hedging — ${JSON.stringify(finalityAgreement(BOTH, true))}`)

// ── The controls. ───────────────────────────────────────────────────────────
check('the four corners are not all the same number',
  new Set([
    finalityAgreement(FINISHED, true).score, finalityAgreement(FINISHED, false).score,
    finalityAgreement(HEDGING, true).score,  finalityAgreement(HEDGING, false).score,
  ]).size === 2,
  'a dimension whose corners agree is a constant')
check('the same prose scores differently against different facts',
  finalityAgreement(FINISHED, true).score !== finalityAgreement(FINISHED, false).score,
  'if the fact does not change the score, the dimension is not reading the fact — it is reading the prose, which arc and ctx already do')

console.log(fail ? `\n${fail} failed` : '\nall passed')
process.exit(fail ? 1 : 0)
