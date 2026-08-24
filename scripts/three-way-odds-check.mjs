#!/usr/bin/env node
// Association football is a three-outcome market. The relay served two.
//
// CC-CMD-2026-08-23-soccer-three-way-odds. Measured 2026-08-23 on fifteen MLS
// games: every one with `opening_odds` carried `moneyline {home, away}` and no
// draw, so field-laboratory's `winProbabilityFrom` took its ThreeWayDrawMissing
// branch and every soccer card rendered "three-way market; no draw price served"
// instead of a win probability.
//
// THE DRAW WAS NEVER DROPPED. It was never asked for. extractOddsForGame matched
// h2h outcomes against `home` and `away` and nothing else; a soccer h2h prices
// three, and the third matched neither predicate. Nothing discarded it — no code
// path ever referred to it.
//
// IDENTIFIED BY POSITION, NOT BY NAME. `o.name === 'Draw'` is the obvious fix and
// the wrong one: it is a string literal this session cannot verify from the
// sandbox, and a renamed selection would silently drop the price again — the
// defect class that emptied UNREACHABLE_DIMS and broke DIM_TO_SCALE this same
// day. On a three-outcome market the entry that is neither team IS the draw, by
// construction. There is no literal to drift.
//
// NO SPORT CHECK, DELIBERATELY. The ask requires non-soccer markets not to gain
// a null draw. A branch on sport could be wrong about which competitions draw;
// a two-outcome h2h simply has no third entry. The SHAPE enforces it, which is
// stronger than a conditional that has to be right.
//
// The laboratory needs no change: Market.ThreeWay, winProbabilityFrom and the
// renderer are shipped, and Market.fs makes fabricating a draw from a two-way
// line unrepresentable. The draw comes from the market or not at all.

import { readFileSync } from 'node:fs'
import { drawPriceFrom } from '../src/odds-shape.js'

let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else { fail++; console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`) }
}

// The h2h outcome arrays, exercised through the real selection rule.
const H = { name: 'New England Revolution', price: 125 }
const A = { name: 'New York City FC', price: 180 }
const draw = (outcomes, h = H, a = A) => drawPriceFrom(outcomes, h, a)

// ── Soccer: three outcomes. The middle entry is the draw whatever it is called.
check('a three-outcome market yields a draw price',
  draw([H, { name: 'Draw', price: 240 }, A]) === 240)
// The measured live shape, from the CC-CMD's own table (ne-nyc, 2026-08-23:
// home 125, away 180, no draw served). An `||` here would have made this
// trivially true, which is the shape of assertion this repo spent the day
// deleting.
const NE = { name: 'New England Revolution', price: 125 }
const NYC = { name: 'New York City FC', price: 180 }
check('the ne-nyc market, with its draw restored, yields 240',
  drawPriceFrom([NE, { name: 'Draw', price: 240 }, NYC], NE, NYC) === 240)
check('...and the same market as actually served yields nothing',
  drawPriceFrom([NE, NYC], NE, NYC) === null,
  'two prices is what fifteen MLS games carried on 2026-08-23')

// THE POINT OF IDENTIFYING BY POSITION. A renamed selection must still work.
for (const label of ['Tie', 'Empate', 'X', 'DRAW', ''])
  check(`a draw selection named ${JSON.stringify(label)} is still found`,
    draw([H, { name: label, price: 240 }, A]) === 240,
    'matching the literal "Draw" would drop this silently')

// ── Non-soccer: two outcomes. Must gain nothing, not even a null.
check('a two-outcome market yields no draw',
  draw([H, A]) === null,
  'the ask requires non-soccer markets not to gain a null draw')

// ── Shapes that must NOT produce a price.
check('a four-outcome market yields no draw',
  draw([H, { name: 'Draw', price: 240 }, A, { name: 'Void', price: 900 }]) === null,
  'an unseen shape is not a market to guess at')
check('a non-numeric third price yields no draw, not a draw of null',
  draw([H, { name: 'Draw', price: null }, A]) === null)
check('a missing team outcome yields no draw',
  drawPriceFrom([H, { name: 'Draw', price: 240 }, A], undefined, A) === null,
  'a draw cannot arrive without the teams it sits between')
check('a one-outcome or empty market yields no draw',
  draw([H]) === null && draw([]) === null && drawPriceFrom(null, H, A) === null)

// ── The wiring. This module is only worth testing if src/index.js uses it.
const src = readFileSync('src/index.js', 'utf8')
check('src/index.js imports the rule rather than reimplementing it',
  /import \{ drawPriceFrom \} from '\.\/odds-shape\.js'/.test(src),
  'a second implementation is how one concept comes to have two that disagree')
check('...and applies it to the h2h outcomes inside extractOddsForGame',
  /drawPriceFrom\(h2h\.outcomes, h, a\)/.test(src))
check('...and only sets the key when a price came back',
  /if \(draw !== null\) out\.moneyline\.draw = draw;/.test(src),
  'assigning unconditionally would put a null draw on every non-soccer market')

console.log(fail ? `\n${fail} failed` : '\nall passed')
process.exit(fail ? 1 : 0)
