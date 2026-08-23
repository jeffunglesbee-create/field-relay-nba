#!/usr/bin/env node
// Every live STAGED claim must name a verifier that exists and runs.
//
// WHY THIS EXISTS
//
// Rule 74 already requires a staged item to state what unblocks it and the exact
// commands to verify it. That is a DOCUMENT discipline: it produces a written
// verification a human then has to remember to execute. Measured 2026-08-23:
// 55 files across the two repos contain the word STAGED; four things actually
// check anything.
//
// The gap produced three distinct failures, all of them real, all of them
// patched individually before anyone noticed they were one defect:
//
//   A. THE UNBLOCK IS A FUTURE EVENT, and nothing re-evaluates whether it
//      happened. `closing-odds-capture` read "blocked by a soccer slate running
//      after bb04fc8" for two days AFTER soccer had played, while the relay's
//      own probe had already measured EPL 4/5 and La Liga 2/3 and reported PASS.
//
//   B. THE VERIFICATION IS WRITTEN AND NEVER RUN. The 2026-08-16 session wrote
//      an explicit Rule 90 artifact for its done condition, marked it UNVERIFIED
//      because its sandbox 403s *.workers.dev, and it sat unrun for six days.
//
//   C. THE VERIFICATION RUNS AND CANNOT DISCRIMINATE. The brief-contamination
//      probe scanned every returned brief with no baseline, so one pre-fix brief
//      pinned it at "still generating" permanently and the fix it measured could
//      never be observed.
//
// A and B are both "no executor". C is a different problem — a probe that runs
// and lies — and this check does NOT solve it. Said plainly because a guard
// claiming more than it does is the failure it was built to prevent.
//
// THE MOVE, WHICH THIS REPO HAS ALREADY MADE TWICE
//
// `Sport.Golf` did not get fixed; `Omission` made "unmodelled" a DECLARED case
// carrying a reason, and sportMeta's exhaustive match turned forgetting one into
// a compile error. `.githooks/pre-commit` did the same to the outbox rule: a
// documented discipline became a mechanical one. Same move here — STAGED becomes
// unrepresentable without a named executor.
//
// THE TAG
//
//     **STAGED** (verifier: some_check_id @ relay/staged-verification.yml)
//
// PORTED FROM field-laboratory 2026-08-23, with the repo prefix inverted: here
// `relay/…` ids resolve locally against scripts/staged-verdicts.mjs and the
// named workflow must carry a `schedule:`; `lab/…` ids are checked for
// well-formedness only. Each repo can verify its own executors and neither
// pretends to verify the other's — the same division the laboratory copy states
// from its side.
//
// This repo is the one with the exposure: 55 files here contain the word
// STAGED against four executors. The laboratory copy found zero orphans on the
// day it shipped because that session had already closed them all; this one is
// expected to find real ones.
//
// outbox/ is exempt by construction. Those are records of what happened, not
// live claims, and "was STAGED, now verified" is a sentence that should stay
// writable.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/// Run the scan only when invoked directly. Without this, importing `claimsIn`
/// -- which the historical-proof harness and any future test does -- executed a
/// full docs scan as a side effect and printed its report twice. A module whose
/// import has side effects cannot be tested against anything but itself.
const IS_MAIN = import.meta.url === pathToFileURL(process.argv[1] ?? '').href

const DOCS = 'docs'
const LOCAL_REGISTRY = 'scripts/staged-verdicts.mjs'
const WORKFLOWS = '.github/workflows'

/// A live staged claim: the word STAGED in a heading or bolded assertion, as
/// opposed to prose ABOUT staging. Deliberately narrow — this fires on the
/// shape a session writes when it is staging something, not on every mention.
/// Captures the WHOLE line, not just up to the marker. The first version
/// stopped at `**STAGED**` and so never saw the tag that follows it on the same
/// line — it reported every tagged claim as an orphan, which would have made the
/// check unsatisfiable and therefore deleted.
///
/// CASE-INSENSITIVE, and that is not a loosening. The first version required
/// uppercase STAGED and found ZERO claims across docs/ — because the shape this
/// repo actually writes is `**Staged verification (Rule 74).**`. A check that
/// matches an invented convention instead of the observed one passes forever
/// while measuring nothing, which is the exact class of vacuous test the
/// contamination probe turned out to be six hours earlier.
export const STAGED_CLAIM = /(?:^|\n)([^\n]*\*\*Staged[^*]*\*\*[^\n]*)/gi

/// The tag that discharges it.
export const VERIFIER_TAG = /\(verifier:\s*([a-z0-9_-]+)\s*@\s*([a-z]+)\/([A-Za-z0-9._-]+)\)/

/// Split a document into live staged claims and their tags. Returns one entry
/// per claim so a file with two staged items cannot be satisfied by one tag.
export function claimsIn(text) {
  const out = []
  for (const m of text.matchAll(STAGED_CLAIM)) {
    const line = m[1]
    const tag = line.match(VERIFIER_TAG)
    out.push({
      line: line.trim().slice(0, 160),
      id: tag?.[1] ?? null,
      repo: tag?.[2] ?? null,
      workflow: tag?.[3] ?? null,
    })
  }
  return out
}

if (IS_MAIN && process.argv.includes('--self-test')) {
  let pass = 0, fail = 0
  const t = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`) }

  const tagged = '**STAGED** (verifier: soccer_opening_coverage @ relay/staged-verification.yml), blocked by a slate.'
  const bare = '**STAGED (Rule 74).** That the alias fix raises coverage is staged, blocked by a soccer slate.'

  t('a tagged claim resolves its id', claimsIn(tagged)[0].id === 'soccer_opening_coverage')
  t('a tagged claim resolves its repo and workflow',
    claimsIn(tagged)[0].repo === 'relay' && claimsIn(tagged)[0].workflow === 'staged-verification.yml')
  t('an untagged claim is an orphan', claimsIn(bare)[0].id === null)
  t('two claims in one file are counted separately',
    claimsIn(`${tagged}\n\n${bare}`).length === 2)
  // The exemption that keeps history writable.
  t('prose ABOUT staging is not a claim',
    claimsIn('The item was staged for two days and is now verified.').length === 0)
  t('a lowercase mention is not a claim',
    claimsIn('this reads staged until the relay grounds soccer briefs').length === 0)
  // The failure that motivated the tag: a claim whose unblock is a future event
  // and which names no executor.
  t('"unblocks on the next slate" without a verifier is still an orphan',
    claimsIn('**STAGED.** Unblocks on the next slate; verify with curl.')[0].id === null)
  // The shape this repo ACTUALLY writes, taken verbatim from
  // CC-CMD-2026-08-21-closing-odds-capture before it was tagged.
  t('the real observed shape is matched, not just the invented one',
    claimsIn('**Staged verification (Rule 74).** That the alias fix raises soccer opening coverage is *staged*, blocked by a soccer slate.').length === 1)
  t('and it reads as an orphan until tagged',
    claimsIn('**Staged verification (Rule 74).** blocked by a soccer slate.')[0].id === null)
  t('a malformed tag does not count as tagged',
    claimsIn('**STAGED** (verifier: no_workflow_named)')[0].id === null)

  console.log(`\n${pass}/${pass + fail} checks passed`)
  process.exit(fail ? 1 : 0)
}

if (!IS_MAIN) { /* imported for its predicate only */ }
else {
const files = existsSync(DOCS)
  ? readdirSync(DOCS).filter(f => f.endsWith('.md')).map(f => join(DOCS, f))
  : []

const registry = existsSync(LOCAL_REGISTRY) ? readFileSync(LOCAL_REGISTRY, 'utf8') : ''
const scheduled = f => {
  const p = join(WORKFLOWS, f)
  return existsSync(p) && /^\s*schedule:/m.test(readFileSync(p, 'utf8'))
}

const orphans = [], unresolved = [], crossRepo = [], ok = []

for (const f of files) {
  for (const c of claimsIn(readFileSync(f, 'utf8'))) {
    const where = `${f}: ${c.line}`
    if (!c.id) { orphans.push(where); continue }
    if (c.repo !== 'relay') { crossRepo.push(`${f}: ${c.id} @ ${c.repo}/${c.workflow}`); continue }
    if (!registry.includes(c.id)) { unresolved.push(`${where}\n      id "${c.id}" is not a verdict in ${LOCAL_REGISTRY}`); continue }
    if (!scheduled(c.workflow)) { unresolved.push(`${where}\n      ${c.workflow} has no schedule: — a verifier nobody runs is the defect`); continue }
    ok.push(`${f}: ${c.id} @ ${c.workflow}`)
  }
}

console.log(`staged claims in ${DOCS}/: ${orphans.length + unresolved.length + crossRepo.length + ok.length}`)
console.log(`  resolved locally  ${ok.length}`)
for (const s of ok) console.log(`    ok   ${s}`)
console.log(`  cross-repo        ${crossRepo.length}  (well-formed; existence is the other repo's to assert)`)
for (const s of crossRepo) console.log(`    xrepo ${s}`)

if (unresolved.length) {
  console.error(`\n${unresolved.length} claim(s) name a verifier that does not resolve:`)
  for (const s of unresolved) console.error(`    ${s}`)
}
if (orphans.length) {
  console.error(`\n${orphans.length} staged claim(s) name NO verifier:`)
  for (const s of orphans) console.error(`    ${s}`)
  console.error(`
A staged claim with no executor is a claim with no owner. It can only be
cleared by a human remembering to look, which is how closing-odds sat two days
past its own passing result.

Tag it:  **STAGED** (verifier: <id> @ relay/staged-verification.yml)

where <id> is one of the verdicts in scripts/staged-verdicts.mjs.

and make sure the verifier exists and its workflow is on a schedule.`)
}
process.exit(orphans.length + unresolved.length ? 1 : 0)
}
