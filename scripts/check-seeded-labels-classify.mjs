// Every label the journalism cron seeds must classify to a sport class.
//
// WHY THIS EXISTS, and it has now fired three times without anyone watching.
//
// `voiceRegisterFor(sport)` scopes the voice exemplars a brief is written
// against. Its fallback, when `detectSportClass` returns null:
//
//   const keep = cls && scoped.some(s => s.sport === cls)
//     ? seg => seg.sport === null || seg.sport === cls
//     : () => true          // <- EVERY segment
//
// So an unclassified sport does not get NO exemplars. It gets ALL of them —
// basketball, hockey, soccer, football, tennis and golf at once — while looking
// classified from the outside. `journalism-quality.js` records this happening
// twice already, in its own comments:
//
//   CFL, before 2026-08-24: "It was unclassified, so it took the
//   keep-everything fallback and received basketball and hockey exemplars in
//   every brief."
//
//   golf, before 2026-08-24: "a class with no exemplar takes voiceRegisterFor's
//   keep-everything fallback, which is how golf came to receive basketball and
//   hockey exemplars while looking classified."
//
// On 2026-08-29 a census of all 22 seeded labels found three more: CFB (seeded
// two days earlier, briefs already being written), EFL Cup and EFL Trophy
// (seeded for weeks). `'efl cup'` does not contain `'epl'` — one transposed
// letter — which is why no one caught it by eye across every review those
// competitions went through.
//
// THE CLASSIFIER IS A SUBSTRING MATCHER AND THE LABELS ARE CHOSEN ELSEWHERE.
// Those two facts do not compose: `LEAGUES` in src/index.js is where a label is
// declared, `detectSportClass` is where it must be recognised, and nothing
// connected them. A new competition is one table edit away from silently
// un-scoping its own briefs. This is that connection.
//
// It asserts nothing about WHICH class a label gets — that is a judgement, and
// a linter that guessed it would be worse than none. It asserts only that the
// judgement was made.

import { readFileSync } from 'node:fs'
import { detectSportClass } from '../src/journalism-quality.js'

const SRC = 'src/index.js'

let pass = 0, fail = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        → ${detail}`}`)
  ok ? pass++ : fail++
}

export function seededLabels (src) {
  const i = src.indexOf('  const LEAGUES = [')
  if (i < 0) return []
  const blk = src.slice(i, src.indexOf('\n  ];', i))
  return [...blk.matchAll(/\{sport:'([^']+)',\s*league:'([^']+)',\s*label:'([^']+)'/g)].map(m => m[3])
}

if (process.argv.includes('--self-test')) {
  const T = (l, ok) => check(l, ok)
  const FIX = `
  const LEAGUES = [
    {sport:'baseball', league:'mlb', label:'MLB'},
    {sport:'golf',     league:'pga', label:'PGA Tour', individual:true},
    {sport:'kabaddi',  league:'pkl', label:'Pro Kabaddi'},
  ];`
  const rows = seededLabels(FIX)
  T('the parser reads labels, including a row with a trailing flag',
    rows.length === 3 && rows[1] === 'PGA Tour')
  T('a real label classifies', detectSportClass('MLB') === 'baseball')
  T('THE DEFECT IS DETECTED: an unrecognised label classifies to null',
    detectSportClass('Pro Kabaddi') === null)
  // The three found on 2026-08-29, as regression fixtures. Each one is a label
  // that WAS null and must never be again.
  T('CFB stays classified (was null until 2026-08-29)', detectSportClass('CFB') === 'football')
  T('EFL Cup stays classified (was null until 2026-08-29)', detectSportClass('EFL Cup') === 'soccer')
  T('EFL Trophy stays classified (was null until 2026-08-29)', detectSportClass('EFL Trophy') === 'soccer')
  // And the near-miss that hid the EFL bug: one transposed letter.
  T('EPL and EFL are different strings and both classify',
    detectSportClass('EPL') === 'soccer' && detectSportClass('EFL Cup') === 'soccer')
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass}/${pass + fail} self-test(s)\n`)
  process.exit(fail === 0 ? 0 : 1)
}

const labels = seededLabels(readFileSync(SRC, 'latin1').replace(/\x00/g, ''))
const byClass = new Map()
const unclassified = []
for (const l of labels) {
  const c = detectSportClass(l)
  if (!c) unclassified.push(l)
  else byClass.set(c, [...(byClass.get(c) ?? []), l])
}

console.log(`\n  ${labels.length} seeded label(s)\n`)
for (const [c, ls] of [...byClass].sort()) console.log(`    ${c.padEnd(11)} ${ls.join(', ')}`)
console.log('')

// Non-vacuity first: a parser that matched nothing would report zero
// unclassified labels and read as a clean table.
check('the LEAGUES table parsed to real labels', labels.length >= 15, `${labels.length}`)
check('every seeded label classifies to a sport class',
  unclassified.length === 0,
  `${unclassified.join(', ')} — each takes voiceRegisterFor's keep-everything ` +
  `fallback and receives EVERY sport's exemplars while looking classified. Add ` +
  `the label's own token to detectSportClass in src/journalism-quality.js; ` +
  `pick the class deliberately, and say why in a comment beside it.`)

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass}/${pass + fail} checks passed`)
process.exit(fail === 0 ? 0 : 1)
