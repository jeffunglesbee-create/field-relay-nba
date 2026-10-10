#!/usr/bin/env node
// Every workflow that pushes must either land the push or go RED. A step that
// retries, loses every attempt, and still exits 0 reports a lost artifact as
// success — and nothing downstream can tell the difference.
//
// THE SHAPE THIS CATCHES, documented in .github/workflows/bsd-param-probe.yml
// before this check existed:
//
//     for i in 1 2 3; do
//       git pull --rebase origin main && git push origin main && break
//       sleep $((i * 5))
//     done
//                      <- nothing here
//
// The loop's last command is `sleep`, which succeeds. `set -e` does not fire,
// because a failing `&&` list is a tested command. So all three attempts can
// fail and the step still exits 0.
//
// WHAT IT DELIBERATELY DOES NOT CATCH. A census on 2026-10-10 found 35 of 63
// pushing workflows without the is-ancestor guard, and sampling three of them
// found three different answers — one safe, one safe by another route, one a
// deliberate choice. Counting "no guard" as "broken" would have published 35
// defects where there were far fewer. The three safe shapes:
//
//   1. a bare `git pull ... && git push ...` as the block's last command —
//      its exit status IS the step's
//   2. a retry loop followed by `exit 1`
//   3. a retry loop followed by the is-ancestor check
//
// And one shape that is a CHOICE, not a defect: a loop followed by an explicit
// `exit 0` with a reason beside it — drive-upload-outbox.yml does this because
// a daily ledger sweep re-records anything lost, so failing the run would be
// noise. Those are reported separately and do not fail this check.

import { readFileSync, readdirSync } from 'node:fs'

export const DIR = '.github/workflows'

/** The `run:` blocks of a workflow, as raw text. Block boundaries come from
 *  indentation, not a YAML parse: these files carry shell that a strict parse
 *  would have to re-emit, and re-emitting is how a checker starts testing its
 *  own round-trip instead of the file. */
export const runBlocks = (text) => {
  const out = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)run:\s*\|/.exec(lines[i])
    if (!m) continue
    const indent = m[1].length
    const body = []
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]
      if (l.trim() === '') { body.push(l); continue }
      const ind = l.length - l.trimStart().length
      if (ind <= indent) break
      body.push(l)
    }
    out.push(body.join('\n'))
  }
  return out
}

/** Classify one run block that contains a `git push`. */
export const classify = (block) => {
  if (!/git\s+push/.test(block)) return null

  // A push whose exit status is swallowed can never fail its step. Two
  // different swallows, and the first version of this check conflated them:
  // it matched `||` as a pipe and labelled `git push || echo ...` as "piped",
  // which is the right verdict reached through a false reason. A single `|`
  // hands the status to the downstream command; `||` discards it when the
  // right-hand side succeeds. Both are defects; they are not the same defect.
  const pushLine = /^.*git\s+push.*$/m.exec(block)?.[0] ?? ''
  // Remove `||` BEFORE looking for a pipe. A lookahead does not do it: in
  // `a || b` the SECOND bar is not followed by a bar, so /\|(?!\|)/ matches
  // it and reports a pipe. That is how the first version of this check
  // labelled `git push || echo` as "piped" — right verdict, wrong reason.
  const withoutOrElse = pushLine.replace(/\|\|/g, '')
  if (/\|/.test(withoutOrElse)) return 'piped'
  if (/\|\|/.test(pushLine) && !/\|\|[^\n]*\bexit\s+[1-9]/.test(pushLine)) return 'swallowed'

  const loop = /^\s*(for|while)\b[^\n]*;\s*do\s*$/m.test(block) || /^\s*(for|while)\b[^\n]*do\s*$/m.test(block)
  if (!loop) {
    // No loop: the push's status propagates, unless something runs after it
    // that would mask it. The last non-empty line decides.
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
      .filter(l => !l.startsWith('#'))
    const last = lines[lines.length - 1] ?? ''
    return /git\s+push/.test(last) || /exit\s+1/.test(last) ? 'safe-bare' : 'bare-then-more'
  }

  // With a loop, what follows `done` decides.
  const after = block.slice(block.lastIndexOf('\ndone') + 1)
  if (/merge-base\s+--is-ancestor/.test(after)) return 'safe-ancestor'
  if (/\bexit\s+1\b/.test(after)) return 'safe-exit1'
  if (/\bexit\s+0\b/.test(after)) return 'deliberate-exit0'
  return 'DEFECT'
}

export const isDefect = (verdict) =>
  verdict === 'DEFECT' || verdict === 'piped' || verdict === 'swallowed' || verdict === 'bare-then-more'

function selfTest () {
  let failed = 0
  const check = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failed++ }

  const LOOP = 'for i in 1 2 3; do\n  git pull --rebase origin main && git push origin main && break\n  sleep $((i * 5))\ndone\n'

  check('THE DEFECT: a retry loop with nothing after it', classify(LOOP) === 'DEFECT')
  check('...and it is reported as a defect', isDefect(classify(LOOP)) === true)
  check('a loop followed by the is-ancestor guard is safe',
    classify(LOOP + 'git fetch -q origin main\ngit merge-base --is-ancestor HEAD origin/main || exit 1\n') === 'safe-ancestor')
  check('a loop followed by exit 1 is safe',
    classify(LOOP + 'echo "::error::lost"\nexit 1\n') === 'safe-exit1')
  check('a loop followed by an explicit exit 0 is a CHOICE, not a defect',
    classify(LOOP + 'echo "next sweep re-records"; exit 0\n') === 'deliberate-exit0')
  check('...and a choice does not fail the check',
    isDefect(classify(LOOP + 'echo x; exit 0\n')) === false)
  check('a bare push as the last command is safe',
    classify('git add .\ngit pull --rebase origin main && git push origin HEAD:main') === 'safe-bare')
  check('MUTATION: a bare push with work AFTER it is caught',
    classify('git pull && git push origin main\necho "done"') === 'bare-then-more')
  check('MUTATION: a PIPED push is caught — tail\'s status is not git\'s',
    classify('git push origin main 2>&1 | tail -1') === 'piped')
  check('MUTATION: `git push || echo` is caught as SWALLOWED, not piped',
    classify('git push origin main || echo "push failed, retry manually"') === 'swallowed')
  check('...and `|| exit 1` is NOT swallowed — it is the correct form',
    classify('git push origin main || exit 1') !== 'swallowed')
  check('a single pipe and an or-else are different verdicts',
    classify('git push origin main | tee log') !== classify('git push origin main || echo x'))
  check('...and piping is a defect regardless of a loop',
    isDefect(classify('for i in 1 2; do git push origin main | tail -1; done')) === true)
  check('a block with no push is not classified', classify('echo hello') === null)

  // Two BLOCK scalars. A `run: echo x` one-liner is not a block and is not
  // extracted — that is correct, and the earlier version of this test asserted
  // otherwise and failed for that reason rather than finding a real defect.
  const wf = 'jobs:\n  a:\n    steps:\n      - name: x\n        run: |\n          git push origin main\n      - name: y\n        run: |\n          echo nope\n'
  check('run blocks are extracted by indentation', runBlocks(wf).length === 2)
  check('...and the first one carries the push', /git push/.test(runBlocks(wf)[0]))
  check('...and the second does not', !/git push/.test(runBlocks(wf)[1]))

  console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${17 - failed}/17 self-tests`)
  return failed
}

if (process.argv.includes('--self-test')) process.exit(selfTest())

const files = readdirSync(DIR).filter(f => f.endsWith('.yml') || f.endsWith('.yaml')).sort()
const rows = []
for (const f of files) {
  const text = readFileSync(`${DIR}/${f}`, 'utf8')
  for (const b of runBlocks(text)) {
    const v = classify(b)
    if (v) rows.push({ file: f, verdict: v })
  }
}

const tally = {}
for (const r of rows) tally[r.verdict] = (tally[r.verdict] ?? 0) + 1
const defects = rows.filter(r => isDefect(r.verdict))

console.log(`=== push-lands check — ${rows.length} pushing run block(s) across ${files.length} workflow(s)\n`)
for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${k}`)
}
if (defects.length) {
  console.log('\nDEFECTS — these can exit 0 having pushed nothing:')
  for (const d of defects) console.log(`  ${d.verdict.padEnd(16)} ${d.file}`)
}
const choices = rows.filter(r => r.verdict === 'deliberate-exit0')
if (choices.length) {
  console.log('\nDELIBERATE exit 0 (reported, not failed — each has a stated reason):')
  for (const c of choices) console.log(`  ${c.file}`)
}

// Rule 91: the denominator, where the result is read.
console.log(`\nCOVERAGE: every run: | block in ${DIR}, ${rows.length} of them containing a push.`)
console.log('Shell is read as text, not YAML-parsed — a push built from a variable would be missed.')
console.log(`\n${defects.length === 0 ? 'PASS' : 'FAIL'}: ${defects.length} defect(s)`)
process.exit(defects.length === 0 ? 0 : 1)
