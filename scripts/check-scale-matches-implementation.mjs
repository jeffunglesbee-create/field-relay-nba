#!/usr/bin/env node
// A declared weight must equal the ceiling its dimension can actually reach.
//
// SCALE has ten entries. Five of them were read by nothing.
//
//   grep -n "SCALE\." src/journalism-quality.js
//   661:  const W = { spec: SCALE.spec, statDepth: SCALE.statDepth, variety: SCALE.variety,
//   662:              density: SCALE.density, fresh: SCALE.fresh };
//
// That is the only read in src/ or scripts/. Dims 1-5 are multiplied by their
// SCALE weight in `base`. Dims 6-10 are summed RAW, with their ceilings written
// as literals inside their own computations, and those literals disagreed with
// the declared weights in both directions:
//
//   arc       declared 55   code 45   (10+10+10+15)
//   ctx       declared 32   code 25   (8+8+9)
//   temporal  declared 25   code 20   (Math.round(ratio * 20))
//   voice     declared 20   code 30   (Math.min(30, ...))
//   matchup   declared 24   code 30   (Math.min(30, hits * 10))
//
// Era 4 (2026-08-23) reweighted exactly those five. Its own `change` string
// reads "arc 45->55, ctx 25->32, temporal 20->25, funded by voice 30->20,
// density 16->10, matchup 30->24" -- and the from-values are the code's real
// ceilings, which is the tell: the era wrote new numbers into a table the
// scorer does not consult for those dimensions. Only `density 16->10` was
// applied, because density is a dim 1-5. The measured +11.5 gap is real; its
// attribution was not.
//
// This asks the only question that keeps them honest: does each declared weight
// equal the ceiling the code can actually produce? It reads the ceilings out of
// the source rather than trusting a second constant, because a second constant
// is how the first one drifted.
//
// --self-test perturbs each declared weight and requires the check to go red.

import { readFileSync } from 'node:fs'
import { SCALE } from '../src/journalism-quality.js'

const SRC = 'src/journalism-quality.js'

// Each dim's ceiling, read from the expression that produces it. The `find`
// regex must anchor on code that cannot plausibly appear elsewhere in the file;
// a match count that is not exactly `expect` fails rather than guessing, since a
// pattern that silently matches the wrong line is worse than one that misses.
const DIMS = [
  {
    key: 'arc',
    where: 'Dim 6 arcScore — stakes + tension + resolution + bonus',
    find: /\((?:stakes|tension|resolution|bonus)\?(\d+):0\)/g,
    expect: 4,
    ceiling: (ns) => ns.reduce((a, b) => a + b, 0),
  },
  {
    key: 'ctx',
    where: 'Dim 7 contextAnchoring — home term + away term + score',
    find: /dim7 \+= (\d+)/g,
    expect: 3,
    ceiling: (ns) => ns.reduce((a, b) => a + b, 0),
  },
  {
    key: 'temporal',
    where: 'Dim 8 _temporalPrecision — anchored/statSentences scaled',
    find: /\(anchored \/ statSentences\) \* (\d+)\)/g,
    expect: 1,
    ceiling: (ns) => ns[0],
  },
  {
    key: 'voice',
    where: 'Dim 9 _voiceConsistency — per-sport Math.min caps',
    find: /score = Math\.min\((\d+), Math\.max\(0,/g,
    expect: 4,
    // Every branch caps at the same number; a divergent branch is itself a bug,
    // so this fails rather than taking the max and hiding it.
    ceiling: (ns) => (new Set(ns).size === 1 ? ns[0] : null),
  },
  {
    key: 'finality',
    where: 'Dim 11 finalityAgreement — FINALITY_MAX',
    find: /export const FINALITY_MAX = (\d+);/g,
    expect: 1,
    ceiling: (ns) => ns[0],
  },
  {
    key: 'matchup',
    where: 'Dim 10 matchupDepth — Math.min(N, hits * 10)',
    find: /dim10 = Math\.min\((\d+), hits \* 10\)/g,
    expect: 1,
    ceiling: (ns) => ns[0],
  },
]

// Dims 1-5 are genuinely multiplied by SCALE in `base`, so their declared weight
// IS the ceiling by construction. They are listed so the file states which half
// of the table is which, rather than leaving it to be inferred.
const APPLIED = ['spec', 'statDepth', 'variety', 'density', 'fresh']

// Comments are stripped before matching. The first version did not strip them,
// and the very commit that fixed SCALE broke this check: the new SCALE block
// annotates each weight with the expression it came from --
// `arc: 45,  // (stakes?10:0)+(tension?10:0)+...` -- which doubled the arc match
// count, tripped the exactly-N guard, and reported all three as unreadable. The
// guard was right to refuse rather than guess; the reader was wrong to call a
// comment code. "Read the ceiling out of the code" has to mean the code.
export const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

export const ceilingsFrom = (rawSrc) => {
  const src = stripComments(rawSrc)
  const out = {}
  for (const d of DIMS) {
    const ns = [...src.matchAll(d.find)].map((m) => Number(m[1]))
    out[d.key] = ns.length === d.expect ? d.ceiling(ns) : null
  }
  return out
}

export const disagreements = (scale, ceilings) =>
  DIMS.map((d) => ({ key: d.key, where: d.where,
                     declared: scale[d.key], ceiling: ceilings[d.key] }))
      .filter((r) => r.ceiling === null || r.declared !== r.ceiling)

let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else { fail++; console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`) }
}

const src = readFileSync(SRC, 'utf8')
const ceilings = ceilingsFrom(src)

if (process.argv.includes('--self-test')) {
  console.log('self-test: a perturbed weight is caught, one dimension at a time')

  // Every dim, individually. A check that only ever exercised `arc` would pass
  // this file while four other weights drifted -- which is the exact history.
  for (const d of DIMS) {
    const bent = { ...SCALE, [d.key]: SCALE[d.key] + 1 }
    const found = disagreements(bent, ceilings)
    check(`a wrong ${d.key} weight is caught`,
      found.length === 1 && found[0].key === d.key,
      `perturbing ${d.key} produced ${JSON.stringify(found.map(f => f.key))}`)
  }

  // The control. Without it, a checker that reds everything passes all of the
  // above while proving nothing.
  check('the real table passes',
    disagreements(SCALE, ceilings).length === 0,
    JSON.stringify(disagreements(SCALE, ceilings)))

  // And the reader must have read something. If every regex missed, `ceilings`
  // is all-null, every perturbation "fails" for the wrong reason, and the
  // self-test above would be green while measuring nothing.
  check('every ceiling was actually read from source',
    Object.values(ceilings).every((v) => typeof v === 'number' && v > 0),
    JSON.stringify(ceilings))

  // A comment that QUOTES the code must not change the answer. This is the
  // failure that actually happened, replayed: SCALE's own annotations restate
  // the expressions, and an unstripped reader counts them as second copies.
  const commented = src.replace(
    'export const SCALE = {',
    '// (stakes?10:0)+(tension?10:0)+(resolution?10:0)+(bonus?15:0) dim7 += 8\n' +
    '/* dim7 += 8 dim7 += 9 (anchored / statSentences) * 20) */\n' +
    'export const SCALE = {')
  check('a comment quoting the code does not change the ceilings',
    commented !== src &&
    JSON.stringify(ceilingsFrom(commented)) === JSON.stringify(ceilings),
    `with comments: ${JSON.stringify(ceilingsFrom(commented))}\n       without:      ${JSON.stringify(ceilings)}`)
} else {
  console.log('declared weights equal implementation ceilings')
  for (const d of DIMS) {
    check(`${d.key}: declared ${SCALE[d.key]} = code ${ceilings[d.key]}`,
      ceilings[d.key] !== null && SCALE[d.key] === ceilings[d.key],
      ceilings[d.key] === null
        ? `could not read the ceiling for ${d.key} (${d.where}) — the expression moved`
        : `${d.where}: SCALE says ${SCALE[d.key]}, the code can only reach ${ceilings[d.key]}`)
  }
  check('dims 1-5 are the applied half and are all present',
    APPLIED.every((k) => typeof SCALE[k] === 'number'),
    `missing: ${APPLIED.filter((k) => typeof SCALE[k] !== 'number').join(', ')}`)
  check(`SCALE declares exactly these ${DIMS.length + APPLIED.length} dimensions`,
    Object.keys(SCALE).length === DIMS.length + APPLIED.length,
    `SCALE has ${Object.keys(SCALE).length} keys; a new one needs a ceiling reader here or it is unchecked`)
}

console.log(fail ? `\n${fail} failed` : '\nall passed')
process.exit(fail ? 1 : 0)
