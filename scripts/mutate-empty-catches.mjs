// Rule 90 for scripts/check-empty-catches.mjs.
//
// docs/CC-CMD-2026-10-03-empty-catch-gate.md Task 2: insert a bare empty catch,
// confirm the gate fails and names the file and line; remove it, confirm green.
//
// Mutants are placed BESIDE the originals, inside src/, because the gate scans
// a directory and a fixture in a temp folder would not prove that the real root
// is covered. They are deleted on exit.
//
// THE HARNESS ASSERTS ITS OWN PLACEMENT. A mutation harness that reports
// NOT CAUGHT without having mutated anything is worse than no test — the
// corollary this repo wrote after mutate-hockey-wp printed exactly that. Here
// the failure mode is specific: a mutant file the gate never scanned, because
// the path was wrong or the extension was not picked up. So every mutation
// checks that filesScanned ROSE before reading the verdict.
//
// AN EMPTY RESULT IS A FAILURE. If the clean scan finds no empty catches at all
// across src/ and scripts/, that is the checker broken, not a clean tree — the
// convention from outbox/cc-session-2026-09-16-odds-name-matcher.md.
import { writeFileSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const GATE = 'scripts/check-empty-catches.mjs'
const DIR = 'src'
const born = []
process.on('exit', () => {
  for (const p of born) {
    try { unlinkSync(p) } catch (_) {} // catch-ok: cleanup on exit; a mutant already gone is the desired state
  }
})

const place = (body, tag) => {
  const p = join(DIR, `.mutant-${tag}-${process.pid}.js`)
  writeFileSync(p, body); born.push(p); return p
}

const run = (extra = []) => {
  try {
    const out = execFileSync(process.execPath, [GATE, 'src', 'scripts', ...extra],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, out }
  } catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` } }
}
const num = (out, label) => {
  const m = out.match(new RegExp(`${label}\\s+(\\d+)`))
  return m ? Number(m[1]) : null
}

// ── baseline on clean source ────────────────────────────────────────────────
const clean = run()
const cleanBare = num(clean.out, 'bare')
const cleanEmpty = num(clean.out, 'empty total')
const cleanFiles = num(clean.out, 'scanned') ?? Number((clean.out.match(/scanned (\d+) file/) || [])[1])
const cleanUnparsed = num(clean.out, 'UNPARSED \\(files\\)')

if (cleanBare === null || cleanEmpty === null) {
  console.log('FAIL — the gate did not print its counts on clean source; no verdict below would mean anything.')
  console.log(clean.out.slice(-600)); process.exit(1)
}
if (cleanEmpty === 0) {
  console.log('FAIL — the clean scan found ZERO empty catches across src/ and scripts/.')
  console.log('That is the checker broken, not a clean tree. An empty result is a failure.')
  process.exit(1)
}
if (cleanUnparsed !== 0) {
  console.log(`FAIL — ${cleanUnparsed} file(s) are UNPARSED on clean source, so the baseline is blind to them.`)
  console.log(clean.out.split('\n').filter(l => l.includes('scan lost')).join('\n')); process.exit(1)
}
console.log(`baseline: ${cleanFiles} files, bare ${cleanBare}, empty total ${cleanEmpty}, UNPARSED 0\n`)

// ── the mutations ───────────────────────────────────────────────────────────
// expect: 'caught'   the gate must go red and name the mutant
// expect: 'passes'   the gate must stay green — a gate that rejects a properly
//                    reasoned catch is as broken as one that accepts a bare one
const MUTATIONS = [
  ['M1 a bare block catch', 'caught',
   'export const f = async () => { try { await g() } catch (e) {} }'],

  ['M2 a bare promise catch', 'caught',
   'export const f = () => { g().catch(() => {}) }'],

  ['M3 catch-ok with no reason is MALFORMED, not a suppression', 'caught',
   'export const f = async () => { try { await g() } catch (e) { // catch-ok:\n } }'],

  ['M4 catch-ok WITH a reason suppresses', 'passes',
   'export const f = async () => { try { await g() } catch (e) { // catch-ok: archive writes must never fail the cron\n } }'],

  ['M5 a plain comment is a stated reason', 'passes',
   'export const f = async () => { try { await g() } catch (e) { /* the vendor omits it off-season */ } }'],

  ['M6 a catch that does something is clean', 'passes',
   'export const f = async () => { try { await g() } catch (e) { console.warn(e) } }'],

  // THE TWO REGRESSIONS THAT COST WHOLE FILES. Both were found by the
  // tree-sitter control disagreeing, not by reading.
  ['M7 a bare catch AFTER a nested template literal', 'caught',
   'export const h = (x, y) => `a ${x ? `<b>${y}</b>` : \'\'} c`\nexport const f = async () => { try { await g() } catch (e) {} }'],

  ['M8 a bare catch AFTER a regex literal holding quotes', 'caught',
   'export const t = (s) => s.match(/:text\\([\'"](.+)[\'"]\\)/)\nexport const f = async () => { try { await g() } catch (e) {} }'],

  // UNPARSED must not read as zero. The mutant has a bare catch the gate
  // cannot see; it must say so rather than count it clean.
  ['M9 an unterminated quote is UNPARSED, not zero', 'unparsed',
   'const broken = \'never closed\nexport const f = async () => { try { await g() } catch (e) {} }'],
]

let caught = 0, wrong = 0, notPlaced = 0
for (const [name, expect, body] of MUTATIONS) {
  const tag = name.split(' ')[0].toLowerCase()
  const p = place(body, tag)
  const r = run([`--baseline=${cleanBare}`])
  const files = Number((r.out.match(/scanned (\d+) file/) || [])[1])
  const unparsed = num(r.out, 'UNPARSED \\(files\\)')

  // the anchor equivalent: did the gate actually read the mutant?
  if (!(files > cleanFiles)) {
    notPlaced++
    console.log(`  NOT-PLACED  ${name}`)
    console.log(`              the gate scanned ${files} files against ${cleanFiles} clean — the mutant at ${p} was never read, so there is no verdict here`)
    try { unlinkSync(p) } catch (_) {} // catch-ok: the exit handler removes it if this misses
    continue
  }

  let verdict
  if (expect === 'unparsed') {
    verdict = (unparsed >= 1 && r.out.includes(p)) ? 'CAUGHT' : 'MISSED'
  } else if (expect === 'caught') {
    verdict = (!r.ok && r.out.includes(p)) ? 'CAUGHT'
      : (!r.ok ? 'RED-BUT-UNNAMED' : 'MISSED')
  } else {
    verdict = r.ok ? 'CAUGHT' : 'FALSE-POSITIVE'
  }

  if (verdict === 'CAUGHT') { caught++; console.log(`  ${expect === 'passes' ? 'PASSES ' : 'CAUGHT '} ${name}`) }
  else {
    wrong++
    console.log(`  ${verdict}  ${name}`)
    console.log(`              bare ${num(r.out, 'bare')} against baseline ${cleanBare}, UNPARSED ${unparsed}, exit ${r.ok ? 0 : 1}`)
  }
  try { unlinkSync(p) } catch (_) {} // catch-ok: the exit handler removes it if this misses
}

// and green again with every mutant gone
const after = run([`--baseline=${cleanBare}`])
const afterBare = num(after.out, 'bare')
console.log(`\nrestored: bare ${afterBare}, exit ${after.ok ? 0 : 1}`)
if (!after.ok || afterBare !== cleanBare) {
  console.log('FAIL — the tree is not back where it started; a mutant survived.')
  process.exit(1)
}

console.log(`\n${caught} caught, ${wrong} wrong, ${notPlaced} never placed, of ${MUTATIONS.length} mutations`)
console.log('COVERAGE: the gate end to end, through real files in src/. It does NOT')
console.log('mutate the classifier\'s own branches — --self-test does that, 35 cases.')
process.exit(wrong || notPlaced ? 1 : 0)
