#!/usr/bin/env node
// A CC-CMD's status must be greppable, and it must not contradict the document
// it sits on top of. Ported from field-laboratory's scripts/cc-cmd-status-check.mjs
// by docs/CC-CMD-2026-10-18-relay-governance-guards.md, TASK 1.
//
// WHY THIS EXISTS HERE
//
// docs/CC-CMD-2026-10-16-cfl-archive-date-keying.md read
// `**Status:** NOT STARTED — not dispatched.` while five commits cited it, three
// by task number. Nothing noticed: the laboratory has this guard and this repo
// did not, so a status line could disagree with the tree indefinitely. That old
// text is a fixture in the self-test below, and this script fails on it.
//
// RATCHET, NOT REQUIREMENT, for the one property the back catalogue lacks.
// Measured 2026-10-22 at 3adb159: 402 CC-CMDs, 331 with no `**Status:**` line.
// Requiring one everywhere would be red on arrival, which is the wallpaper
// failure scripts/odds-coverage.mjs documents. So "carries a status" is a
// ratchet at 331: new CC-CMDs must carry one, and the count may only fall.
// The other three properties are already perfect and are TRIPWIRES at 0.
//
// WHAT IT DOES NOT CHECK: whether a status matches the tree. The CFL document is
// caught because `NOT` is outside the vocabulary. Had it read `FILED, not
// started` with the same five commits citing it, nothing here would fire.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// TERMINAL: the ask needs no further work in this repository.
//   APPLIED (relay addition): a data change applied and verified, e.g.
//     CC-CMD-2026-09-15-capture-provenance-mark. A real state, not a synonym
//     for code that landed.
//   STOPPED (relay addition): halted by the document's own stop condition, with
//     any remainder filed as a second CC-CMD (Rule 87.4). Three documents.
// NON-TERMINAL:
//   RULED (relay addition, named by the CC-CMD): decided by the owner, not yet
//     built. CC-CMD-2026-10-14-archive-game-unauthenticated-write and
//     CC-CMD-2026-10-14-push-cron-gambit-path.
export const TERMINAL = ['CLOSED', 'RESOLVED', 'BUILT', 'DONE', 'LANDED', 'SHIPPED', 'WITHDRAWN', 'SUPERSEDED', 'APPLIED', 'STOPPED']
export const NONTERMINAL = ['FILED', 'OPEN', 'IN PROGRESS', 'BLOCKED', 'STAGED', 'PARTIAL', 'RULED']

// Measured 2026-10-22 at 3adb159 (402 CC-CMDs). Lower it when the count falls;
// never raise it to absorb a new document without a status.
export const MISSING_BUDGET = 331

// A closing SECTION, not a passing mention.
const CLOSING_SECTION = /^#{2,4} *(CLOSED|RESOLVED|LANDED|COMPLETE)\b/im

const DIR = process.env.CC_CMD_DIR || 'docs'

let failed = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok && detail) console.log(`      → ${detail}`)
  if (!ok) failed++
}

/** { count } when there is not exactly one status line, else { count: 1, body, word, terminal }. */
export function readStatus (text) {
  const lines = text.split('\n').filter(l => /^\*\*Status:\*\*/.test(l))
  if (lines.length !== 1) return { count: lines.length }
  const body = lines[0].replace(/^\*\*Status:\*\*\s*/, '').replace(/\*/g, '').trim()
  const upper = body.toUpperCase()
  const word = [...TERMINAL, ...NONTERMINAL].find(w => upper.startsWith(w)) || null
  return { count: 1, body, word, terminal: word ? TERMINAL.includes(word) : null }
}

export function contradicts (text) {
  const s = readStatus(text)
  return s.count === 1 && s.terminal === false && CLOSING_SECTION.test(text)
}

/** The four facts, over { name: text }. */
export function survey (docs) {
  const r = { files: 0, missing: [], multiple: [], unknown: [], conflicted: [] }
  for (const [f, text] of Object.entries(docs)) {
    r.files++
    const s = readStatus(text)
    if (s.count === 0) r.missing.push(f)
    else if (s.count > 1) r.multiple.push(`${f}: ${s.count} Status lines`)
    else if (!s.word) r.unknown.push(`${f}: "${s.body.slice(0, 70)}"`)
    else if (contradicts(text)) r.conflicted.push(`${f}: status ${s.word}, closing section "${text.match(CLOSING_SECTION)[0].trim()}"`)
  }
  return r
}

export function judge (r, budget = MISSING_BUDGET) {
  return {
    status: r.missing.length <= budget,
    one: r.multiple.length === 0,
    vocabulary: r.unknown.length === 0,
    consistent: r.conflicted.length === 0,
    nonVacuous: r.files > 0,
  }
}

function selfTest () {
  // The incident, verbatim: the CFL status as it read before 2026-10-18.
  const CFL_BEFORE = '# CFL\n\n**Status:** NOT STARTED — not dispatched.\n\n## Tasks\n'
  check('THE INCIDENT IS CAUGHT: the CFL status as it read before 2026-10-18 is outside the vocabulary',
    readStatus(CFL_BEFORE).word === null && !judge(survey({ cfl: CFL_BEFORE })).vocabulary)
  check('...and its corrected form passes',
    judge(survey({ cfl: '**Status:** **PARTIAL — TASKs 3, 4 and 5 landed 2026-10-18' })).vocabulary)
  check('bold inside the status does not defeat the vocabulary',
    readStatus('**Status:** **DONE — 2026-10-19.** Writer fixed').word === 'DONE')
  check('RULED, APPLIED and STOPPED are read, RULED as non-terminal',
    readStatus('**Status:** RULED 2026-10-18').terminal === false &&
    readStatus('**Status:** APPLIED and verified').terminal === true &&
    readStatus('**Status:** STOPPED AT TASK 1').terminal === true)
  check('a sentence that merely contains a word does not pass: TASKS 1 DONE',
    readStatus('**Status:** TASKS 1, 2 DONE').word === null)
  check('two Status lines are a conflict, not an override',
    !judge(survey({ a: '**Status:** FILED\n**Status:** DONE' })).one)
  check('FILED above a ## CLOSED section is a contradiction',
    !judge(survey({ a: '**Status:** FILED\n\n## CLOSED 2026-10-01\n' })).consistent)
  check('...and a passing mention of "closed" is not',
    judge(survey({ a: '**Status:** FILED\n\nthe relay just closed it\n' })).consistent)
  // The ratchet, both ways.
  const many = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [`d${i}`, '# no status']))
  check('THE RATCHET FAILS one over budget', !judge(survey(many(4)), 3).status)
  check('...and holds at the budget', judge(survey(many(3)), 3).status)
  check('an empty directory is not a pass', !judge(survey({})).nonVacuous)
  console.log(failed ? `\nself-test: ${failed} FAILED` : '\nself-test: all passed')
  return failed ? 1 : 0
}

function live () {
  const files = readdirSync(DIR).filter(f => /^CC-CMD-.*\.md$/.test(f)).sort()
  const r = survey(Object.fromEntries(files.map(f => [f, readFileSync(join(DIR, f), 'utf8')])))
  const j = judge(r)
  console.log(`\n${r.files} CC-CMD(s); ${r.files - r.missing.length} carry a status, ${r.missing.length} do not (budget ${MISSING_BUDGET})\n`)
  check(`a CC-CMD carries a Status line: ${r.missing.length} without, budget ${MISSING_BUDGET} (ratchet)`, j.status,
    `${r.missing.length - MISSING_BUDGET} more than the budget. A new CC-CMD needs a **Status:** line; raising the budget is the failure this exists to catch.`)
  if (j.status && r.missing.length < MISSING_BUDGET)
    console.log(`      note: ${r.missing.length} is below the budget; lower MISSING_BUDGET to ${r.missing.length}`)
  check('exactly one Status line per CC-CMD, so a second cannot override the first', j.one, r.multiple.join('\n      → '))
  check('every status opens with a word from the vocabulary', j.vocabulary, r.unknown.join('\n      → '))
  check('no CC-CMD is open at the top and closed further down', j.consistent, r.conflicted.join('\n      → '))
  check('there are CC-CMDs to check at all', j.nonVacuous, `${r.files} found in ${DIR}/`)
  return failed ? 1 : 0
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : live())
}
