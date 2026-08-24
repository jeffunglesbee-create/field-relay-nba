#!/usr/bin/env node
// Dim 10 after era 6: does the prose agree with how close the game actually was?
//
// It used to score how many words from `matchupNote` reappeared in the brief.
// The note is injected into the prompt, so that paid 30 points for repeating an
// input back out — an echo test, not a depth test, while
// check-prompt-example-leak.mjs two files over exists to catch prose
// reproducing injected strings. And it had no data: 7 of 1292 finalized
// non-golf games carry a note (0.54%). Populating the column would have made it
// worse, since a fully covered echo test measures obedience.
//
// The result is on every finalized row and cannot be copied out of the prompt,
// because it is a RELATION between two numbers rather than a string.
//
// The threshold cases below are the ones that matter. Neither margin nor ratio
// works alone across these sports, and the first version got it wrong: ratio
// <= 0.6 called MLB 5-3 lopsided (3/5 is exactly 0.6) when it is an ordinary
// baseball game.

import { marginAgreement, MARGIN_MAX } from '../src/journalism-quality.js'

let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else { fail++; console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`) }
}
const R = (h, a, ot = false) => ({ homeScore: h, awayScore: a, wentToOt: ot })

const CLOSE    = 'Arsenal edged it late, down to the wire.'
const LOPSIDED = 'Arsenal cruised, never in doubt.'
const NEITHER  = 'Arsenal and Chelsea have met eleven times at this ground.'
const BOTH     = 'Arsenal cruised early, then edged it late down to the wire.'

console.log('margin agreement — the 2x2, the abstains, and the sport-free thresholds')

// ── The two defects. ────────────────────────────────────────────────────────
const routCalledClose = marginAgreement(CLOSE, R(35, 10))
check('calling a rout close scores zero',
  routCalledClose.score === 0 && routCalledClose.verdict === 'calls-a-rout-close',
  JSON.stringify(routCalledClose))
const tightCalledRout = marginAgreement(LOPSIDED, R(3, 2, true))
check('calling a tight game a rout scores zero',
  tightCalledRout.score === 0 && tightCalledRout.verdict === 'calls-a-tight-game-a-rout',
  JSON.stringify(tightCalledRout))

// ── The two agreements. ─────────────────────────────────────────────────────
check('close prose on a one-run game scores full',
  marginAgreement(CLOSE, R(4, 3)).score === MARGIN_MAX)
check('lopsided prose on a blowout scores full',
  marginAgreement(LOPSIDED, R(35, 10)).score === MARGIN_MAX)

// ── Sport-free thresholds. The first version failed the first of these. ─────
const fact = (h, a, ot = false) => marginAgreement('x', R(h, a, ot)).fact
check('MLB 5-3 is ordinary, not lopsided',
  fact(5, 3) === 'ordinary',
  'ratio alone put 3/5 at exactly 0.6 and called an ordinary baseball game a rout')
check('NBA 120-110 is ordinary, not lopsided',
  fact(120, 110) === 'ordinary', 'margin alone would call a 10-point NBA game a rout')
check('NBA 120-70 IS lopsided despite a 0.58 ratio',
  fact(120, 70) === 'lopsided', 'ratio alone would miss a 50-point NBA blowout')
check('MLB 8-3, NFL 35-10 and soccer 3-0 are all lopsided',
  fact(8, 3) === 'lopsided' && fact(35, 10) === 'lopsided' && fact(3, 0) === 'lopsided')
check('soccer 2-0 is ordinary — conservative on purpose',
  fact(2, 0) === 'ordinary')
check('overtime is tight whatever the margin',
  fact(120, 70, true) === 'tight', 'a game decided in extra time was not a rout')

// ── Abstains, each labelled. ────────────────────────────────────────────────
check('an ordinary margin abstains rather than guessing',
  marginAgreement(CLOSE, R(5, 3)).score === MARGIN_MAX / 2
  && marginAgreement(CLOSE, R(5, 3)).verdict === 'no-honest-verdict',
  'no verdict exists for a mid-margin game, and inventing one is worse than abstaining')
check('prose with no closeness reading abstains and says so',
  marginAgreement(NEITHER, R(35, 10)).verdict === 'no-clear-reading')
check('no result abstains and says so',
  marginAgreement(CLOSE, null).score === MARGIN_MAX / 2
  && marginAgreement(CLOSE, null).verdict === 'unknown-result')
check('prose saying BOTH scores zero, same precedent as Dim 11',
  marginAgreement(BOTH, R(35, 10)).score === 0
  && marginAgreement(BOTH, R(35, 10)).verdict === 'contradicts-itself',
  'a contradiction cannot be corrected by learning the fact')

// ── The controls. ───────────────────────────────────────────────────────────
check('the same prose scores differently against different results',
  marginAgreement(CLOSE, R(4, 3)).score !== marginAgreement(CLOSE, R(35, 10)).score,
  'if the result does not change the score, this is an echo test again')
check('the dimension cannot be satisfied by copying the prompt',
  marginAgreement('35 10', R(35, 10)).score === MARGIN_MAX / 2,
  'reciting the scoreline is not a closeness claim, and must not score as one')

console.log(fail ? `\n${fail} failed` : '\nall passed')
process.exit(fail ? 1 : 0)
