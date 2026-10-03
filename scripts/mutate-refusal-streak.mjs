// Rule 90 for check-refusal-streak.mjs.
//
// This gate's whole job is to notice that another check has stopped judging.
// If it can itself stop judging, the failure is silent twice over — so each
// mutation below breaks one thing its self-test claims to catch, and a
// mutation that does not turn the suite red is an assertion that cannot fail.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const path = 'scripts/check-refusal-streak.mjs'
const backup = `${path}.mutbak`
const original = readFileSync(path, 'utf8')

const run = () => {
  try { execFileSync('node', [path, '--self-test'], { stdio: 'pipe' }); return true }
  catch { return false }
}

// THE POSITIVE CONTROL, first and not negotiable. An UNMUTATED copy written to
// the mutant's own location must pass; if it does not, every verdict below is
// about the harness rather than the code.
copyFileSync(path, backup)
writeFileSync(path, original)
if (!run()) {
  console.log('FAIL — an UNMUTATED copy at the mutant location is red, so no verdict below would mean anything.')
  copyFileSync(backup, path); unlinkSync(backup)
  process.exit(1)
}

const MUTATIONS = [
  ['R1 month-boundary stops counting as a refusal',
   "  'month-boundary', 'no-contained-day', 'not-enough-readings', 'unreadable',",
   "  'no-contained-day', 'not-enough-readings', 'unreadable',",
   'the measured latch was four month-boundary runs; drop it from the set and the exact defect this gate was built for reads as a healthy watch'],

  ['R2 an unparseable log EXTENDS the streak instead of ending it',
   "export const isRefusal = (v) => v !== null && REFUSALS.has(v)",
   "export const isRefusal = (v) => v === null || REFUSALS.has(v)",
   'a log this parser does not understand is not evidence that the watch refused; counting it manufactures a streak out of a format change (Rule 99)'],

  ['R3 the streak is counted from the OLDEST log',
   '  for (const l of logs) {',
   '  for (const l of [...logs].reverse()) {',
   'the question is whether the watch is judging NOW; counting from the far end reports a streak that ended weeks ago and misses one in progress'],

  ['R4 the bar is raised past the measured latch',
   'const MAX_STREAK = 3',
   'const MAX_STREAK = 9',
   'four consecutive refusals is the real event; a bar above it is a gate that would not have fired on the thing it exists for'],

  ['R5 a real verdict no longer breaks the streak',
   "    if (!isRefusal(v)) { endedBy = 'judged'; break }",
   "    if (false) { endedBy = 'judged' }",
   'without the break every log in history joins the streak, so a watch that judged this morning still reports a long streak and the gate cries wolf until it is disabled'],

  ['R6 the two ways a streak ends are collapsed',
   "    if (v === null) { endedBy = 'unparseable'; break }",
   "    if (v === null) { endedBy = 'judged'; break }",
   '"the watch judged" and "we cannot tell" are different facts; reporting the second as the first hides a log format this gate can no longer read'],
]

let caught = 0
for (const [name, anchor, repl, why] of MUTATIONS) {
  const hits = original.split(anchor).length - 1
  if (hits !== 1) { console.log(`FAIL       ${name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`); continue }
  const mutated = original.replace(anchor, repl)
  if (mutated === original) { console.log(`FAIL       ${name}\n            file unchanged — NOTHING MUTATED.`); continue }
  writeFileSync(path, mutated)
  if (readFileSync(path, 'utf8') === original) { console.log(`FAIL       ${name}\n            the written copy is identical — NOTHING MUTATED.`); continue }
  const red = !run()
  console.log(`${red ? 'CAUGHT    ' : 'NOT CAUGHT'} ${name}\n            (${why})`)
  if (red) caught++
}

copyFileSync(backup, path); unlinkSync(backup)
if (readFileSync(path, 'utf8') !== original) {
  console.log('FAIL — the restore did not return the file to its original content.')
  process.exit(1)
}
console.log(`\n${caught} of ${MUTATIONS.length} mutations caught.`)
console.log('COVERAGE: verdictOf, isRefusal and refusalStreak. It does NOT cover the')
console.log('git read itself — that is proven by the gate being RED on the committed')
console.log('record of the latch it was built for, which no fixture can simulate.')
process.exit(caught === MUTATIONS.length ? 0 : 1)
