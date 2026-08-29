// How many CFB briefs were written before the classifier could scope them, and
// is the damage detectable?
//
// THE WINDOW. `detectSportClass('CFB')` returned null until 7a0caad, deployed
// 2026-08-29 15:37 UTC. `voiceRegisterFor`'s fallback keeps EVERY segment when
// the class is null, so any brief written before that moment was drafted against
// basketball, hockey, soccer, football, tennis AND golf exemplars at once.
//
// CFB was seeded 2026-08-27 and its first games kicked off around 12:00 UTC on
// 2026-08-29 (the Dublin fixture). The journalism cron writes every 15 minutes.
// So the exposed window is roughly three and a half hours of ticks.
//
// WHAT THIS CAN AND CANNOT MEASURE, stated before the numbers so the numbers are
// not read as more than they are.
//
//   CAN: how many CFB briefs exist, and which of them were written inside the
//   window. `updated_at` beats `created_at` -- three brief writers use
//   ON CONFLICT DO UPDATE, so a brief regenerated after the fix keeps its
//   original created_at and is NOT still contaminated.
//
//   CAN: whether any of them carry another sport's vocabulary, via the real
//   checkSportVocab against the real SPORT_VOCAB_VIOLATIONS. That is mechanical
//   evidence of harm.
//
//   CANNOT: register damage. An exemplar governs how prose sounds -- connective
//   sentences, numbers subordinated into claims -- and a brief can be drafted
//   against a tennis exemplar without ever using a tennis word. A zero here is
//   NOT proof the briefs are fine. It is proof that the one detector available
//   found nothing, which is a smaller claim and the only honest one.

import { checkSportVocab, detectSportClass } from '../src/journalism-quality.js'

const RELAY = process.env.RELAY_URL || 'https://field-relay-nba.jeffunglesbee.workers.dev'
// 7a0caad, the commit that added 'cfb' to detectSportClass's football branch.
const FIX_AT = Date.parse('2026-08-29T15:37:00Z')

let pass = 0, fail = 0
const A = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        → ${detail}`}`)
  ok ? pass++ : fail++
}

// Three states, never two. An unreachable archive is not an archive with no
// CFB briefs -- the defect scripts/fetch-silently-empty-probe.mjs swept for.
let body = null
try {
  const r = await fetch(`${RELAY}/archive/query?sport=CFB&limit=100`)
  if (!r.ok) { console.log(`\n  UNREACHABLE — /archive/query answered HTTP ${r.status}. Nothing concluded.\n`); process.exit(1) }
  body = await r.json()
} catch (e) { console.log(`\n  UNREACHABLE — ${e.message}. Nothing concluded.\n`); process.exit(1) }

const rows = body?.results || body?.rows || (Array.isArray(body) ? body : [])
console.log(`\n  /archive/query?sport=CFB returned ${rows.length} brief(s)\n`)

if (rows.length === 0) {
  console.log('  NOT OBSERVABLE — no CFB brief has been written yet.')
  console.log('  The window may simply have produced none: CFB games finished late')
  console.log('  and a brief is written per completed game, not per tick.\n')
  process.exit(1)
}

const stamp = r => Date.parse((r.updated_at || r.created_at || '').replace(' ', 'T') + 'Z')
const before = rows.filter(r => Number.isFinite(stamp(r)) && stamp(r) < FIX_AT)
const after  = rows.filter(r => Number.isFinite(stamp(r)) && stamp(r) >= FIX_AT)
const undated = rows.length - before.length - after.length

console.log(`  written BEFORE the fix (unscoped):  ${before.length}`)
console.log(`  written AFTER  the fix (scoped):    ${after.length}`)
if (undated) console.log(`  no usable timestamp, cannot testify: ${undated}`)
console.log('')

const dirty = []
for (const r of rows) {
  const hits = checkSportVocab(r.brief_text || r.text || '', 'CFB')
  if (hits.length) dirty.push({ id: r.id ?? r.game_id, when: r.updated_at || r.created_at, hits })
}

if (dirty.length) {
  console.log('  CROSS-SPORT VOCABULARY FOUND:\n')
  for (const d of dirty) console.log(`    ${d.when}  ${d.id}  ${d.hits.join(', ')}`)
  console.log('')
}

A('the archive returned CFB briefs to examine', rows.length > 0, `${rows.length}`)
A('the classifier now scopes CFB', detectSportClass('CFB') === 'football')
A('no CFB brief carries another sport\'s vocabulary',
  dirty.length === 0,
  `${dirty.length} of ${rows.length} — these were drafted against every sport's exemplars`)

console.log(`\n  ${before.length} brief(s) were written unscoped. A clean vocabulary result`)
console.log('  above does NOT clear them: an exemplar governs register, not word')
console.log('  choice, and no detector here measures register. Regenerating them is')
console.log('  a separate decision, and one that costs LLM calls.\n')
console.log(`${fail === 0 ? 'PASS' : 'FAIL'}  ${pass}/${pass + fail} checks passed`)
process.exit(fail === 0 ? 0 : 1)
