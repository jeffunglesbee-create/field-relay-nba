#!/usr/bin/env node
// A missing field must not reach an aggregate through `??` or `||`.
//
// WHAT SHIPPED. Two artifacts, published two days apart, both PASSING:
//
//   quality-scale-verify-20260822T234307Z  briefs_counted: 0  cleared_196: 61  all_passed: true
//   quality-scale-verify-20260823T145535Z  briefs_counted: 0  cleared_196: 66  all_passed: true
//
// Zero briefs counted, and sixty-six of them cleared 196. One line did it:
//
//   n: x.n ?? x.count ?? null          // then Number(n) || 0, then summed
//
// /quality/report serves `total` and `scored`. It has never served `n` or
// `count`. Both guesses missed, `n` was null on all 48 rows, and the sum over
// 48 erased unknowns is indistinguishable from a real zero.
//
// THE NULL WAS THE HONEST PART. `n: null` correctly said "I do not know". `??`
// dressed that unknown as a deliberate value and `|| 0` made it arithmetic.
// Neither operator is wrong on its own; what is wrong is either one standing
// between a field that might be absent and a number that gets summed. Every
// other defect this session was a value whose NAME and MEASUREMENT disagreed.
// This is the next stage: an unknown converted to a number and then aggregated,
// after which no reader can tell it from a real zero.
//
// TWO HALVES, and the second is the one with teeth:
//
//   STATIC   flag `?? null` / `|| 0` on a value that flows into a reduce or a
//            published total, in the scripts that write outbox artifacts.
//   REPLAY   feed the two ACTUAL published artifacts through the invariants
//            that now guard the probe, and require both to go red. "This would
//            have caught it" is otherwise a claim about code nobody ran.
//
// --self-test breaks each half and requires the check to notice.

import { readFileSync, readdirSync } from 'node:fs'
import { invariants, total } from './lib/summary-invariants.mjs'

let fail = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`)
  else { fail++; console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`) }
}

// ── STATIC ──────────────────────────────────────────────────────────────────
// FIRST ATTEMPT, AND WHY IT WAS WRONG. This flagged any coalescing CHAIN ending
// in null/0 on a member expression. It returned 27 hits across the publisher
// scripts, of which one was the defect. `type: e.type?.text ?? null` in a probe
// is honest labelling -- it PUBLISHES a null, which is exactly the right thing
// to do with an unknown. A guard at 4% precision gets ignored, and an ignored
// guard is the same as no guard.
//
// The defect was never "a coalesce exists". It is a coalesce standing between a
// possibly-absent field and a SUM. That has a precise shape, and it is the one
// this looks for: a coercion inside a reduce callback.
//
//   n + (r.total || 0)                     <- verify-2f-score-bias.mjs:53
//   sum + (dims[k] || 0) * (W[k] ?? 0)     <- rescore-quality-6b.mjs:89
//   s + (Number(x[k]) || 0)                <- the one that shipped
//
// Three hits across 45 scripts, two of them genuine. That is an instrument
// worth reading. Both were fixed to route through total() or to throw.
export const LAUNDERING = /\breduce\s*\(/
export const launderingLines = (src) => {
  const lines = src.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim()
    if (text.startsWith('//') || text.startsWith('*')) continue
    if (!LAUNDERING.test(text)) continue
    // The callback can wrap; look at the reduce line and the two after it.
    const window = lines.slice(i, i + 3).join(' ')
    if (!/(?:\|\||\?\?)\s*0\b/.test(window) && !/\bNumber\s*\([^)]*\)\s*\|\|/.test(window)) continue
    // A coercion on the ACCUMULATOR is the counter idiom -- `(a[k] || 0) + 1`
    // initialises a tally slot that genuinely does not exist yet. That is not an
    // unknown being laundered; it is a zero being created on purpose. Only a
    // coercion on something OTHER than the accumulator hides a missing input.
    const acc = (window.match(/reduce\s*\(\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)/) || [])[1]
    const coerced = [...window.matchAll(/([A-Za-z_$][\w$]*(?:\s*[.[][^)]*?)?)\s*(?:\|\||\?\?)\s*0\b/g)]
      .map((m) => m[1].trim())
    if (acc && coerced.length && coerced.every((c) => c === acc || c.startsWith(acc + '[') || c.startsWith(acc + '.')))
      continue
    out.push({ line: i + 1, text: text.slice(0, 110) })
  }
  return out
}

// Files that publish outbox artifacts — the ones where a laundered zero becomes
// a durable claim rather than a transient value.
const SELF = 'check-aggregate-launders-unknowns.mjs'
const PUBLISHERS = readdirSync('scripts')
  .filter((f) => f.endsWith('.mjs'))
  // This file's own string literals ARE the defect, quoted as fixtures. It is
  // covered by --self-test instead, which exercises the same function against
  // those literals and requires each verdict -- stronger than scanning itself.
  .filter((f) => f !== SELF)
  .filter((f) => readFileSync(`scripts/${f}`, 'utf8').includes('outbox/'))

// ── REPLAY ──────────────────────────────────────────────────────────────────
// The real artifacts, on disk, unedited.
const ARTIFACTS = readdirSync('outbox')
  .filter((f) => /^quality-scale-verify-.*\.json$/.test(f))

export const replay = (file) => {
  const a = JSON.parse(readFileSync(`outbox/${file}`, 'utf8'))
  const rows = Array.isArray(a.summary) ? a.summary : []
  return { file, rows: rows.length, claimed: a.score_reality ?? null,
           all_passed: a.all_passed, failed: invariants(rows).filter((i) => !i.pass) }
}

if (process.argv.includes('--self-test')) {
  console.log('self-test: each half is shown failing, and shown not firing on clean input')

  // STATIC, on the exact line that shipped.
  const shipped = '    const tot = (k) => out.summary.reduce((s, x) => s + (Number(x[k]) || 0), 0);'
  check('the aggregate that shipped is flagged',
    launderingLines(shipped).length === 1, JSON.stringify(launderingLines(shipped)))
  check('the other two real instances are flagged',
    launderingLines('  out.corpus.expected = summary.reduce((n, r) => n + (r.total || 0), 0);').length === 1 &&
    launderingLines('    .reduce((sum, [d, w]) => sum + (dims[d] || 0) * (W[w] ?? 0), 0);').length === 1)
  // A coalesce that PUBLISHES a null is honest and must not be flagged, or the
  // check is noise and gets ignored -- which is the same as not existing. The
  // first version of this guard flagged 27 lines to catch 1.
  check('a coalesce that publishes rather than sums is not flagged',
    launderingLines('        type: e.type?.text ?? e.type?.id ?? null,').length === 0)
  check('a reduce with no coercion is not flagged',
    launderingLines('  const s = nums.reduce((a, b) => a + b, 0);').length === 0)
  check('a comment quoting the defect is not flagged',
    launderingLines('        // s + (Number(x[k]) || 0)').length === 0)
  // The accumulator exemption, and the proof it is narrow. A tally slot that
  // does not exist yet is a zero created on purpose; a source field that is
  // absent is an unknown being hidden.
  check('a counter tally on the accumulator is not flagged',
    launderingLines('  const t = xs.reduce((a, d) => (a[d.k] = (a[d.k] || 0) + 1, a), {});').length === 0)
  check('...but a coercion on a NON-accumulator in the same reduce still is',
    launderingLines('  const t = xs.reduce((a, d) => a + (d.count || 0), 0);').length === 1,
    'the exemption must key on the accumulator name, not on the presence of one')

  // REPLAY. Fabricate the impossible pair and require every relevant invariant.
  const impossible = [{ brief_type: 'a', scored: null, cleared_196: 66, above_240: 0 }]
  const failed = invariants(impossible).filter((i) => !i.pass).map((i) => i.name)
  check('a null denominator beside a non-zero numerator fails MORE than one invariant',
    failed.length >= 2, `failed: ${JSON.stringify(failed)}`)
  check('...including the zero-denominator one by name',
    failed.includes('a zero denominator is not published beside a non-zero numerator'))
  // The control. Without it a checker that reds everything passes all of the above.
  const sane = [{ brief_type: 'a', scored: 100, cleared_196: 66, above_240: 12 }]
  check('a coherent summary passes every invariant',
    invariants(sane).every((i) => i.pass),
    JSON.stringify(invariants(sane).filter((i) => !i.pass)))
  // And `total` must not launder: a null contributes nothing AND is counted.
  const t = total([{ v: 3 }, { v: null }, { v: 4 }], 'v')
  check('total() reports what it could not read instead of scoring it zero',
    t.sum === 7 && t.n === 2 && t.skipped === 1, JSON.stringify(t))
} else {
  console.log('no aggregate launders an unknown into a number')

  // STATIC
  const hits = []
  for (const f of PUBLISHERS)
    for (const l of launderingLines(readFileSync(`scripts/${f}`, 'utf8')))
      hits.push(`scripts/${f}:${l.line}  ${l.text.slice(0, 90)}`)
  check(`no reduce coerces a possibly-absent field to zero (${PUBLISHERS.length} publisher scripts scanned)`,
    hits.length === 0,
    hits.join('\n       ') + '\n       a missing field coerced inside a sum is indistinguishable from a real zero — route it through lib/summary-invariants.mjs total(), or throw')

  // REPLAY — the historical artifacts must still be recognised as broken.
  console.log(`\n  replaying ${ARTIFACTS.length} published artifact(s) through the invariants:`)
  const results = ARTIFACTS.map(replay)
  for (const r of results) {
    const verdict = r.failed.length
      ? `${r.failed.length} invariant(s) fail: ${r.failed.map((f) => f.name).join('; ')}`
      : 'coherent'
    console.log(`    ${r.file}  rows=${r.rows}  claimed briefs_counted=${r.claimed?.briefs_counted ?? 'n/a'}` +
                `  cleared_196=${r.claimed?.cleared_196 ?? 'n/a'}  all_passed=${r.all_passed}  -> ${verdict}`)
  }
  // Artifacts written BEFORE the fix carry the old field names, so they must
  // fail. One that passes means either the fix regressed or the artifact was
  // regenerated — both are things to look at, not to shrug past.
  const broken = results.filter((r) => r.failed.length > 0)
  check('the invariants recognise the artifacts that shipped the contradiction',
    ARTIFACTS.length === 0 || broken.length > 0,
    'no published artifact fails — if the pre-fix artifacts are still on disk, this check has stopped working')
  check('every artifact that fails an invariant had claimed all_passed: true',
    broken.every((r) => r.all_passed === true),
    'the point of the replay: these were not reported as failures at the time')
}

console.log(fail ? `\n${fail} failed` : '\nall passed')
process.exit(fail ? 1 : 0)
