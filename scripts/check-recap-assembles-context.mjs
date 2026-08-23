#!/usr/bin/env node
// The live game_recap path must assemble context.
//
// `match_events` shipped 2026-08-23 (644d7f6), registered correctly in
// src/context-assembler.js, and reached ZERO recaps. assembleContext is called
// from four places and none of them was the live per-game recap path: two
// backfills, the journalism-cron SLATE brief, and an import. The path that
// actually writes `game_recap_${sport}_${eventId}` -- game finalizes ->
// buildGameCompletePrompt -> JOURNALISM_QUEUE -> consumer -- assembled nothing.
//
// Four hours later, check 5 of verify-staged-items.mjs said so on its first live
// run: "FAIL — 0/3 recap(s) name anyone who scored", with ESPN carrying 3-4
// scoring plays for each of the three games. That check is the right long-term
// detector, but it can only speak once a slate has finalised. This one speaks at
// deploy time, which is when the wiring is actually being changed.
//
// It asserts the STRUCTURE, not the output: that GAME-COMPLETE calls
// assembleContext, that its result reaches buildGameCompletePrompt, and that the
// prompt renders it. A registered context source that no prompt receives is the
// defect class, and all three links have to hold for it not to recur.
//
// `--self-test` runs each check against a source with that one link cut, and
// requires it to fail. A structural check is a regex over a 19,000-line file:
// nothing else establishes that it is looking at the thing it names, and a check
// never shown to fail proves nothing about the run where it printed ok.

import { readFileSync } from 'node:fs'

const SRC = 'src/index.js'

// Each check is a predicate over the source plus the mutation that must break
// it. The mutation is a [find, replace] pair applied to the real file, so a
// refactor that moves the code out from under a check breaks the self-test too.
const CHECKS = [
  {
    name: 'buildGameCompletePrompt takes a sportContext parameter',
    detail: 'the parameter is gone — every caller passing context is silently dropping it',
    holds: (src) => /function buildGameCompletePrompt\(\{[^}]*\bsportContext\b/.test(src),
    breakIt: (src) => src.replace(/(function buildGameCompletePrompt\(\{[^}]*?), sportContext/, '$1'),
  },
  {
    // Checked separately from the signature: a parameter that is accepted and
    // never used is exactly as broken as one that is missing, and reads as
    // wired to anyone grepping the signature.
    name: 'the prompt body renders sportContext',
    detail: 'the parameter is accepted but never reaches the returned prompt',
    holds: (src) => /sportContext \|\| null,/.test(src),
    breakIt: (src) => src.replace('sportContext || null,', ''),
  },
  {
    // The whole defect in one assertion.
    name: 'the GAME-COMPLETE path calls assembleContext',
    detail: 'the live recap path builds a prompt with no context — the 2026-08-23 defect',
    holds: (src) => /assembleContext\(env, \{[\s\S]{0,400}?sourceId: gameId/
      .test(src.slice(src.indexOf('[GAME-COMPLETE]'))),
    breakIt: (src) => src.replace('sourceId: gameId,', ''),
  },
  {
    // A call whose result is discarded is the same silent failure with more
    // code in it.
    name: 'GAME-COMPLETE passes sportContext into the prompt',
    detail: 'assembled and then dropped on the floor',
    // Scoped to the GAME-COMPLETE block. Unscoped, this matched the function
    // DECLARATION -- which names sportContext whether or not any caller passes
    // it -- and the self-test caught that: cutting the argument at the call
    // site left the check green. The other two call sites (the declaration at
    // ~5332, /debug/gemini-model-test at ~9253) both sit above this slice.
    holds: (src) => /buildGameCompletePrompt\(\{[^}]*\bsportContext\b[^}]*\}\)/
      .test(src.slice(src.indexOf('[GAME-COMPLETE]'))),
    breakIt: (src) => src.replace('debriefCtx, sportContext });', 'debriefCtx });'),
  },
  {
    // Rule 5: a context source can never break a primary function, and the
    // primary function here is enqueueing the brief at all.
    name: 'the assembly is bounded so it cannot block the enqueue',
    detail: 'an unbounded await sits between a game finalizing and its brief being queued',
    holds: (src) => /Promise\.race\(\[[\s\S]{0,300}?assembleContext/.test(src),
    breakIt: (src) => src.replace('await Promise.race([', 'await ('),
  },
]

const src = readFileSync(SRC, 'utf8')
let fail = 0

if (process.argv.includes('--self-test')) {
  console.log('self-test: every check rejects its own negative control')
  for (const c of CHECKS) {
    const broken = c.breakIt(src)
    if (broken === src) {
      fail++
      console.log(`  FAIL ${c.name}\n       the mutation changed nothing — the check no longer describes the code`)
    } else if (c.holds(broken)) {
      fail++
      console.log(`  FAIL ${c.name}\n       still passes with the link cut — it is not testing what it names`)
    } else {
      console.log(`  ok   ${c.name}`)
    }
  }
} else {
  console.log('the live recap path assembles context')
  for (const c of CHECKS) {
    if (c.holds(src)) console.log(`  ok   ${c.name}`)
    else { fail++; console.log(`  FAIL ${c.name}\n       ${c.detail}`) }
  }
}

console.log(fail ? `\n${fail} failed` : '\nall passed')
process.exit(fail ? 1 : 0)
