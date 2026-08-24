#!/usr/bin/env node
// Every name in the graph resolves to a name that exists.
//
// Six guards were written in one session, each after an incident, each covering
// one edge. The pattern under all of them is the same: something names something
// else, the something else gets renamed or added, and nothing connects the two.
// A rename then surfaces as several separate incidents weeks apart.
//
// SCALE.matchup -> SCALE.margin is the case study. One rename, weight-preserving
// so the era fingerprint could not see it, and no diff on the lines it broke:
//
//   UNREACHABLE_DIMS       kept naming "matchup"; both filters matched NOTHING and
//                          the reachable ceilings moved 245->277 and 270->294
//   DIM_TO_SCALE           mapped matchupDepth -> "matchup"; scoreUnder coerced the
//                          miss to zero, rebuilt a 244-point rubric, reported 294
//   three candidate tables carried "matchup" and no "margin" or "finality"
//
// Found on three separate days by three separate investigations. One edge check
// would have reported all three at once, the hour the rename landed.
//
// WHAT THIS DOES NOT COVER, so nobody trusts it further than it goes. It checks
// that names RESOLVE. It cannot check that a weight equals its implementation
// ceiling, that an abstain scores the midpoint, that a regex means what its
// author intended, or that a published total reconciles with its rows. Those
// stay in the guards that assert them:
//
//   check-scale-matches-implementation   declared weight vs code ceiling
//   check-slate-caps-are-derived         caps derived by calling the functions
//   check-opts-keys-are-read             call-site key vs callee's opts read
//   check-aggregate-launders-unknowns    unknown coerced into a sum
//   margin- / finality-agreement-check   what the dimensions actually score
//
// This subsumes the NAME-RESOLUTION half of those, which is the half that kept
// recurring. Adding a dependency is now adding an edge, not writing a seventh
// script.
//
// --self-test replays each historical break and requires the edge to go red.

import { readFileSync } from 'node:fs'
import { NODES, EDGES, resolveEdges, objectKeysAfter, objectValuesAfter, blankNonCode }
  from './lib/name-graph.mjs'

let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else { fail++; console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`) }
}

if (process.argv.includes('--self-test')) {
  console.log('self-test: each edge replayed against the break that actually happened')

  // Fake nodes standing in for the pre-fix state of the real ones.
  const at = (names) => ({ what: 'fixture', resolve: () => names })
  const real = await (async () => {
    const o = {}
    for (const [k, v] of Object.entries(NODES)) o[k] = await v.resolve()
    return o
  })()

  // 1. THE RENAME. UNREACHABLE_DIMS as it stood before 2026-08-24.
  const r1 = await resolveEdges(
    [{ from: 'pre-fix.unreachable', to: 'scale.keys', why: 'replay' }],
    { ...NODES, 'pre-fix.unreachable': at(['ctx', 'matchup']) })
  check('a list still naming the pre-rename key goes red',
    r1[0].missing.length === 1 && r1[0].missing[0] === 'matchup', JSON.stringify(r1[0].missing))

  // 2. DIM_TO_SCALE's values, same rename.
  const r2 = await resolveEdges(
    [{ from: 'pre-fix.dts-values', to: 'scale.keys', why: 'replay' }],
    { ...NODES, 'pre-fix.dts-values': at(['spec', 'statDepth', 'variety', 'density', 'fresh',
                                          'arc', 'ctx', 'temporal', 'voice', 'matchup']) })
  check('the map that rebuilt a 244-point rubric goes red',
    r2[0].missing.includes('matchup'), JSON.stringify(r2[0].missing))

  // 3. THE ADDITION, which every forward edge misses. `finality` was in SCALE
  //    for a day with no DIM_TO_SCALE entry, and nothing named it — so nothing
  //    could report it. Only the reverse edge catches this.
  const r3 = await resolveEdges(
    [{ from: 'scale.keys', to: 'pre-fix.dts-values', why: 'replay' }],
    { ...NODES, 'pre-fix.dts-values': at(['spec', 'statDepth', 'variety', 'density', 'fresh',
                                          'arc', 'ctx', 'temporal', 'voice', 'matchup']) })
  check('a SCALE key with no consumer goes red on the REVERSE edge',
    r3[0].missing.includes('finality') && r3[0].missing.includes('margin'),
    `${JSON.stringify(r3[0].missing)} — a forward-only graph cannot see an addition`)

  // 4. The breakdown-key half.
  const r4 = await resolveEdges(
    [{ from: 'pre-fix.dts-keys', to: 'breakdown.dims', why: 'replay' }],
    { ...NODES, 'pre-fix.dts-keys': at(['specificity', 'matchupDepth']) })
  check('a breakdown key the scorer no longer returns goes red',
    r4[0].missing.includes('matchupDepth'), JSON.stringify(r4[0].missing))

  // 5. A sport in one event map and not the other.
  const r5 = await resolveEdges(
    [{ from: 'pre-fix.containers', to: 'event.slug-sports', why: 'replay' }],
    { ...NODES, 'pre-fix.containers': at([...real['event.container-sports'], 'mls']) })
  check('a sport with a container and no slug goes red',
    r5[0].missing.includes('mls'),
    'that pair returns an empty block, indistinguishable from a game with no scoring plays')

  // 6. A READER THAT CANNOT FIND ITS ANCHOR MUST FAIL, NOT PASS. An empty set
  //    makes every edge trivially green, which is how a check stops working
  //    without anyone noticing.
  const r6 = await resolveEdges(
    [{ from: 'broken.reader', to: 'scale.keys', why: 'replay' }],
    { ...NODES, 'broken.reader': { what: 'x', resolve: () => null } })
  check('a reader that lost its anchor reports a reader failure, not a pass',
    r6[0].readerFailed === true, JSON.stringify(r6[0]))
  check('objectKeysAfter returns null rather than [] for a missing anchor',
    objectKeysAfter('const OTHER = { a: 1 }', 'const MISSING') === null)
  check('objectValuesAfter returns null rather than [] for a missing anchor',
    objectValuesAfter("const OTHER = { a: 'b' }", 'const MISSING') === null)

  // 7. A name quoted in a COMMENT is not a declaration.
  const commented = "// const DIM_TO_SCALE = { ghost: 'nope' }\nconst DIM_TO_SCALE = { real: 'spec' }"
  check('a map quoted in a comment does not contribute names',
    JSON.stringify(objectKeysAfter(blankNonCode(commented), 'const DIM_TO_SCALE')) === '["real"]',
    JSON.stringify(objectKeysAfter(blankNonCode(commented), 'const DIM_TO_SCALE')))

  // 8. THE REAL SOURCE, not a fixture I wrote. scripts/fixtures/ holds the
  //    DIM_TO_SCALE block verbatim from 5e0f066 -- the last commit before it was
  //    fixed. All THREE breaks must be reported, because in life they were found
  //    on three separate days by three separate investigations.
  const hist = readFileSync('scripts/fixtures/dim-to-scale-at-5e0f066.js', 'utf8')
  const hKeys = objectKeysAfter(blankNonCode(hist), 'const DIM_TO_SCALE')
  const hVals = objectValuesAfter(hist, 'const DIM_TO_SCALE')
  check('the historical fixture parsed at all',
    Array.isArray(hKeys) && hKeys.length === 10 && Array.isArray(hVals) && hVals.length === 10,
    `keys ${JSON.stringify(hKeys)} values ${JSON.stringify(hVals)}`)
  check('real pre-fix source: the renamed SCALE key is reported',
    hVals.filter((v) => !real['scale.keys'].includes(v)).join() === 'matchup')
  check('real pre-fix source: the renamed breakdown key is reported',
    hKeys.filter((k) => !real['breakdown.dims'].includes(k)).join() === 'matchupDepth')
  check('real pre-fix source: BOTH un-consumed SCALE keys are reported',
    real['scale.keys'].filter((k) => !hVals.includes(k)).sort().join() === 'finality,margin',
    'margin was a rename and finality was an addition — one edge direction each')

  // 9. The control. Without it a resolver that reds everything passes all of the
  //    above while proving nothing.
  const live = await resolveEdges()
  check('every real edge resolves today',
    live.every((r) => !r.readerFailed && r.missing.length === 0),
    live.filter((r) => r.readerFailed || r.missing.length)
        .map((r) => `${r.from} -> ${r.to}: ${r.detail || JSON.stringify(r.missing)}`).join('\n       '))
  check('every node was read and returned at least one name',
    Object.values(real).every((v) => Array.isArray(v) && v.length > 0),
    JSON.stringify(Object.fromEntries(Object.entries(real).map(([k, v]) => [k, v ? v.length : v]))))
} else {
  console.log(`name graph — ${EDGES.length} edges over ${Object.keys(NODES).length} nodes`)
  const results = await resolveEdges()
  for (const r of results) {
    check(`${r.from} -> ${r.to}`,
      !r.readerFailed && r.missing.length === 0,
      r.readerFailed
        ? `${r.detail}\n       WHY THIS EDGE EXISTS: ${r.why}`
        : `unresolved: ${JSON.stringify(r.missing)}\n       WHY THIS EDGE EXISTS: ${r.why}`)
  }
  const nodeSizes = {}
  for (const [k, v] of Object.entries(NODES)) { const n = await v.resolve(); nodeSizes[k] = n ? n.length : null }
  check('every node read at least one name from source',
    Object.values(nodeSizes).every((n) => typeof n === 'number' && n > 0),
    JSON.stringify(nodeSizes) + '\n       a node that reads nothing turns its edges green while measuring nothing')
}

console.log(fail ? `\n${fail} failed` : '\nall passed')
process.exit(fail ? 1 : 0)
