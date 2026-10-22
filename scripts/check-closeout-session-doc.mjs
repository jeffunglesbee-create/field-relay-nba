#!/usr/bin/env node
// A HANDOFF close-out names a session doc, and the doc it names exists.
// docs/CC-CMD-2026-10-18-relay-governance-guards.md, TASK 2.
//
// THE MISSING DIRECTION. check-handoff-current.mjs covers work → HANDOFF (work
// landed that no close-out records). field-laboratory's
// check-session-docs-indexed.mjs covers session doc → HANDOFF (a doc nothing
// references). Nothing covered close-out → session doc: a close-out that names
// no doc, or names one that is not there.
//
// TWO FACTS, TWO BUDGETS, never one number (the CC-CMD's FORBIDDEN list):
//
//   absence    a close-out naming no session doc. RATCHET at 6.
//   broken     a close-out naming a doc that does not exist. TRIPWIRE at 0.
//
// WHAT COUNTS. A close-out is a `## SESSION CLOSE-OUT` section, the form
// check-handoff-current.mjs reads. It names a session doc in any of the seven
// forms listed at `closeOuts` below. THE BUDGET IS NOT THE CC-CMD'S 36. That
// count read only `**Session doc:**` at the start of a line (21 of 57 at
// 147f375); reproduced exactly, it called close-outs that DO name their doc
// absent, including the plain `Session doc: outbox/...` form Rule 67 itself
// prescribes. Read in every form, 147f375 had 4 close-outs naming none, and
// 3adb159 has 6 of 60 (measured 2026-10-22), each read by hand:
//   2026-10-21, 2026-08-29, 2026-08-27          name nothing
//   2026-10-19 (chat), 2026-10-18, 2026-10-16    chat's, which cannot write outbox/
//
// `Session doc: not written` counts as absence. That is chat's 2026-10-18
// close-out: chat's write allowlist excludes outbox/, a real exemption, and it
// stays in the baseline rather than being dressed up as a doc. `Session doc:
// Drive <id>` (Rule 67's other form) counts as named; it cannot be checked on
// disk, and it is reported as such.

import { readFileSync, existsSync, readdirSync } from 'node:fs'

// Measured 2026-10-22 at 3adb159. Lower it when the count falls; never raise it.
export const ABSENT_BUDGET = 6

const HANDOFF = process.env.HANDOFF_PATH || 'HANDOFF.md'

let failed = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok && detail) console.log(`      → ${detail}`)
  if (!ok) failed++
}

/** The paths a marker paragraph names, in any of the forms HANDOFF has used. */
const PATH = /(?:\b([\w.-]+)\/)?\b((?:outbox|docs)\/[^\s`,;)*]+\*?[^\s`,;)]*)/g

/**
 * Each close-out: its heading, and the session docs it names.
 *
 * THE FORMS, all measured in HANDOFF.md on 2026-10-22, because a first draft
 * that read only `Session doc: <path>` at the start of a line counted 30
 * close-outs as naming nothing, and most of them name one:
 *   `Session doc: outbox/x.md`                     Rule 67's own form
 *   `**Session doc:** \`outbox/x.md\``             bold
 *   `**HEAD:** ... Session doc:\n\`outbox/x.md\``  mid-line, path on the next line
 *   `Session doc, per Rule 67:` / `**Session doc (Rule 67):**`
 *   `Session docs:` / `Session docs — all five, per Rule 67:` + a list
 *   `outbox/2026-08-25-*`                          a glob
 *   `jubilant-bassoon/outbox/x.md`                 another repo's outbox
 * A marker is "Session doc(s)" followed, within 30 characters on its line, by
 * a colon or a dash. "the session doc says which to believe" is prose, not a
 * marker. The paths are every path in the marker's paragraph.
 */
export function closeOuts (text) {
  const starts = [...text.matchAll(/^## +SESSION CLOSE-OUT\b.*$/gm)].map(m => m.index)
  return starts.map((s, i) => {
    const section = text.slice(s, starts[i + 1] ?? text.length).split(/\n(?=## )/)[0]
    const heading = section.split('\n')[0].trim()
    const docs = []
    for (const m of section.matchAll(/\bSession docs?\b[^:\n]{0,30}?(?::|—|\s-\s)/gi)) {
      // The marker's paragraph, and the next one when the marker's own holds no
      // path: 2026-10-10's "Session docs — all five, per Rule 67:" has a blank
      // line before its list.
      const blocks = section.slice(m.index).split(/\n\s*\n/)
      const paragraph = PATH.test(blocks[0]) || !blocks[1] ? blocks[0] : `${blocks[0]}\n${blocks[1]}`
      PATH.lastIndex = 0
      if (/^Session docs?[^\n]{0,30}?(?::|—)\s*\**\s*not written\b/i.test(paragraph)) { docs.push({ kind: 'none', line: 'not written' }); continue }
      const paths = [...paragraph.matchAll(PATH)]
      if (!paths.length) { docs.push(/\bDrive\b\s+[\w-]{10,}/.test(paragraph) ? { kind: 'drive', line: paragraph.slice(0, 60) } : { kind: 'none', line: paragraph.slice(0, 60) }); continue }
      // Only outbox/*.md (or an outbox glob) is a session doc: Rule 67 says
      // `outbox/cc-session-{date}-{scope}.md`. A marker paragraph also cites
      // artifacts (.json, .log) and CC-CMDs; measured 2026-10-22, three such
      // citations read as "missing session docs" before this filter.
      const sessionDocs = paths.filter(p => /^outbox\/.*(\.md|\*)$/.test(p[2].replace(/[.:]+$/, '')))
      if (!sessionDocs.length) { docs.push({ kind: 'none', line: paragraph.slice(0, 60) }); continue }
      for (const p of sessionDocs) {
        const repo = p[1], path = p[2].replace(/[.:]+$/, '')
        if (repo && repo !== 'field-relay-nba') docs.push({ kind: 'elsewhere', path: `${repo}/${path}` })
        else if (path.includes('*')) docs.push({ kind: 'glob', path })
        else docs.push({ kind: 'path', path })
      }
    }
    return { heading, docs }
  })
}

/** Does a glob like `outbox/2026-08-25-*` match a file? One `*`, at the end. */
const globMatches = (glob, list) => list().some(f => f.startsWith(glob.replace(/\*.*$/, '')))

export function survey (text, exists = existsSync, list = () => listOutbox()) {
  const all = closeOuts(text)
  const named = d => ['path', 'glob', 'elsewhere', 'drive'].includes(d.kind)
  const absent = all.filter(c => !c.docs.some(named))
  const broken = all.flatMap(c => c.docs
    .filter(d => (d.kind === 'path' && !exists(d.path)) || (d.kind === 'glob' && !globMatches(d.path, list)))
    .map(d => `${c.heading}: ${d.path}`))
  const elsewhere = all.flatMap(c => c.docs.filter(d => d.kind === 'elsewhere' || d.kind === 'drive').map(d => `${c.heading}: ${d.path ?? d.line}`))
  return { total: all.length, absent, broken, drive: elsewhere }
}

function listOutbox () {
  try { return [...readdirSync('outbox').map(f => `outbox/${f}`), ...readdirSync('docs').map(f => `docs/${f}`)] } catch { return [] }
}

function selfTest () {
  const here = new Set(['outbox/real.md'])
  const exists = p => here.has(p)
  const doc = (...secs) => secs.map(s => `## SESSION CLOSE-OUT — 2026-10-01\n\n${s}\n`).join('\n')
  check('a plain `Session doc:` line names a doc (Rule 67\'s own form)',
    survey(doc('Session doc: outbox/real.md'), exists).absent.length === 0)
  check('...and so does the bold form',
    survey(doc('**Session doc:** `outbox/real.md`'), exists).absent.length === 0)
  check('a close-out with no Session doc line is absence',
    survey(doc('**HEAD:** `a` → `b`'), exists).absent.length === 1)
  check('`Session doc: not written` is absence, not a named doc',
    survey(doc('Session doc: not written. Chat cannot write outbox/.'), exists).absent.length === 1)
  check('"not written" stays absence even when the line cites an .md elsewhere',
    survey(doc('Session doc: not written; the run is in `outbox/real.md`.'), exists).absent.length === 1)
  check('THE TRIPWIRE FAILS: a close-out naming a file that does not exist',
    survey(doc('Session doc: outbox/never-written.md'), exists).broken.length === 1)
  check('...and absence is NOT counted as broken: two facts, two numbers',
    survey(doc('no doc here'), exists).broken.length === 0)
  check('a Drive id counts as named, and is reported, not checked on disk',
    (s => s.absent.length === 0 && s.drive.length === 1)(survey(doc('Session doc: Drive 1AbCdEfGhIjKlMnOpQrStUvWxYz012345'), exists)))
  check('a dated section that is not a close-out is not counted',
    survey('## 2026-10-20 (afternoon) — work\n\nno doc\n', exists).total === 0)
  check('a Session doc line in the NEXT section does not count for this one',
    survey(doc('nothing') + '## 2026-10-02 — other\n\nSession doc: outbox/real.md\n', exists).absent.length === 1)
  const over = doc('a', 'b', 'c')
  check('THE RATCHET FAILS one over budget', survey(over, exists).absent.length > 2)
  // The forms HANDOFF actually uses, each from a real close-out.
  check('a mid-line marker with the path on the next line is read',
    survey(doc('**HEAD:** `a` → `b`. Session doc:\n`outbox/real.md`.'), exists).absent.length === 0)
  check('"Session doc, per Rule 67:" and "**Session doc (Rule 67):**" are read',
    survey(doc('Session doc, per Rule 67:\n`outbox/real.md`.'), exists).absent.length === 0 &&
    survey(doc('**Session doc (Rule 67):** `outbox/real.md`'), exists).absent.length === 0)
  check('a list after a blank line is still the marker\'s list (2026-10-10)',
    survey(doc('Session docs — all two, per Rule 67:\n\n- `outbox/real.md`\n- `outbox/real.md`'), exists).absent.length === 0)
    check('a plural list is read, and each listed doc is checked',
    survey(doc('Session docs — all two, per Rule 67:\n- `outbox/real.md`\n- `outbox/gone.md`'), exists).broken.length === 1)
  check('an artifact in the same paragraph is not a session doc, and not "missing"',
    survey(doc('Session doc: `outbox/real.md`, numbers in `outbox/run-123.json`'), exists).broken.length === 0)
  check('prose about "the session doc" is not a marker',
    survey(doc('the session doc says which to believe.'), exists).absent.length === 1)
  check('a glob matching nothing is broken; one matching a file is not',
    survey(doc('**Session docs (Rule 67)** — `outbox/zz-*`:'), exists, () => ['outbox/real.md']).broken.length === 1 &&
    survey(doc('**Session docs (Rule 67)** — `outbox/re*`:'), exists, () => ['outbox/real.md']).broken.length === 0)
  console.log(failed ? `\nself-test: ${failed} FAILED` : '\nself-test: all passed')
  return failed ? 1 : 0
}

function live () {
  const s = survey(readFileSync(HANDOFF, 'utf8'))
  console.log(`\n${s.total} close-out(s) in ${HANDOFF}; ${s.total - s.absent.length} name a session doc, ${s.absent.length} do not (budget ${ABSENT_BUDGET}), ${s.broken.length} name one that is missing\n`)
  check(`a close-out names a session doc: ${s.absent.length} without, budget ${ABSENT_BUDGET} (ratchet)`, s.absent.length <= ABSENT_BUDGET,
    `${s.absent.length - ABSENT_BUDGET} more than the budget. Rule 67: the close-out names its session doc. Newest without: ${s.absent[0]?.heading}`)
  if (s.absent.length < ABSENT_BUDGET)
    console.log(`      note: ${s.absent.length} is below the budget; lower ABSENT_BUDGET to ${s.absent.length}`)
  check('every named session doc exists (tripwire, 0)', s.broken.length === 0, s.broken.join('\n      → '))
  if (s.drive.length) console.log(`      note: ${s.drive.length} named in another repo or on Drive, not checkable here: ${s.drive.join('; ')}`)
  check('there are close-outs to check at all', s.total > 0, `none found in ${HANDOFF}`)
  return failed ? 1 : 0
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : live())
}
