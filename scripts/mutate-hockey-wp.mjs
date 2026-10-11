#!/usr/bin/env node
// Rule 90 for scripts/check-hockey-wp.mjs.
//
// docs/CC-CMD-2026-10-10-nhl-win-probability-from-xg.md
//
// The check asserts that three absent states are DISTINGUISHABLE and that the
// label differs from the two wp-resolver.js already serves. Those are exactly
// the assertions that pass whether or not they are aimed at anything: a
// refusal that silently became 0.5, or a label that silently became 'Market
// estimate', both leave a green check if the check is testing the template
// rather than the distinction.
//
// Each mutation below breaks the thing one assertion exists to catch. The
// harness asserts its anchor is UNIQUE and was APPLIED before reporting:
// "NOT CAUGHT" with no mutation applied is worse than no test, and this
// repository has shipped exactly that.

import { readFileSync, writeFileSync, copyFileSync, renameSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const VICTIM = 'src/hockey-wp.js'
const LIB = 'src/hockey-wp-lib.js'
const CHECK = 'scripts/check-hockey-wp.mjs'

const MUTATIONS = [
  {
    name: 'M1  the pre-game prior silently becomes 0.5',
    file: VICTIM,
    anchor: "    const prior = Number.isFinite(wp.pregamePrior) ? wp.pregamePrior : null",
    replace: "    const prior = Number.isFinite(wp.pregamePrior) ? wp.pregamePrior : 0.5",
    expect: 'a model with no prior refuses'
  },
  {
    name: 'M2  the model label becomes the market label',
    file: VICTIM,
    anchor: "export const WP_LABEL = 'FIELD model probability'",
    replace: "export const WP_LABEL = 'Market estimate'",
    expect: 'distinct from both labels'
  },
  {
    name: 'M3  the pre-game answer is labelled as a model read',
    file: VICTIM,
    anchor: "      label: PRIOR_LABEL,\n      state: 'prior',",
    replace: "      label: WP_LABEL,\n      state: 'prior',",
    expect: 'labelled a prior'
  },
  {
    name: 'M4  unreadable strength is treated as even strength',
    file: LIB,
    anchor: "  if (!Number.isFinite(s?.homeSkaters) || !Number.isFinite(s?.awaySkaters)) p.push('strength-unreadable')",
    replace: "  if (false) p.push('strength-unreadable')",
    expect: 'does not score as 5v5'
  },
  {
    name: 'M5  an unreadable clock reads as the start of the game',
    file: LIB,
    anchor: "  if (!Number.isFinite(s?.elapsedSeconds)) p.push('clock-unreadable')",
    replace: "  if (false) p.push('clock-unreadable')",
    expect: 'rather than reading as the start'
  },
  {
    name: 'M6  an unreadable score reads as 0-0',
    file: LIB,
    anchor: "  if (!Number.isFinite(s?.homeScore) || !Number.isFinite(s?.awayScore)) p.push('score-unreadable')",
    replace: "  if (false) p.push('score-unreadable')",
    expect: 'rather than reading as 0-0'
  },
  {
    name: 'M7  a null model answers instead of refusing',
    file: VICTIM,
    anchor: "  if (!wp || !Array.isArray(wp.coefficients))\n    return { ...base, state: 'refused', problems: ['model-absent'] }",
    replace: "  if (!wp || !Array.isArray(wp.coefficients))\n    return { ...base, state: 'modelled', probability: 0.5, label: WP_LABEL, problems: [] }",
    expect: 'a null model refuses instead of answering'
  },
  {
    name: 'M8  an absent goalie id stops being reported',
    file: VICTIM,
    anchor: "    caveats.push('goalieInNetId absent; goalie quality is not a model input, so nothing was substituted for it')",
    replace: "    caveats.push('')",
    expect: 'rather than silently applying an average goalie'
  },
  {
    name: 'M9  situationCode accepts a malformed code',
    file: VICTIM,
    anchor: "  if (!/^\\d{4}$/.test(s)) return null",
    replace: "  if (!/^\\d{0,4}$/.test(s)) return null",
    expect: 'unreadable code is null'
  },
  {
    name: 'M10 the walk reads the last PLAY instead of the last shot',
    file: VICTIM,
    anchor: "      shotsSeen += 1\n      last = play\n    }",
    replace: "      shotsSeen += 1\n    }\n    last = play\n    if (false) {",
    expect: 'LAST shot event, not the last play'
  },
  {
    name: 'M11 the attacking net stops flipping by period',
    file: LIB,
    anchor: "  const flips = (period - 1) % 2 === 1",
    replace: "  const flips = false",
    expect: 'flips with each period'
  },
  {
    name: 'M12 the xG model guard is removed again',
    file: VICTIM,
    anchor: "  if (!model || !Array.isArray(model.coefficients))\n    return { xg: null, problems: ['xg-model-absent'], notReported: [] }",
    replace: "  if (false)\n    return { xg: null, problems: ['xg-model-absent'], notReported: [] }",
    expect: 'a null xG model yields no xG instead of throwing'
  },
  {
    name: 'M14 the score goes back to being read off the last shot',
    file: VICTIM,
    anchor: "    homeScore,\n    awayScore,\n    scoreCarriedFromGoalEvents: scoreSeen,",
    replace: "    homeScore: Number.isFinite(d.homeScore) ? d.homeScore : null,\n    awayScore: Number.isFinite(d.awayScore) ? d.awayScore : null,\n    scoreCarriedFromGoalEvents: scoreSeen,",
    expect: 'carried forward from goal events'
  },
  {
    name: 'M15 a root score that disagrees stops being reported',
    file: VICTIM,
    anchor: "    && (rootHome !== homeScore || rootAway !== awayScore)",
    replace: "    && false",
    expect: 'reported, not silently preferred'
  },
  {
    name: 'M16 an absent shot type stops being named again',
    file: VICTIM,
    anchor: "    notReported: mapped === null ? ['shotType'] : []",
    replace: "    notReported: mapped === null && d.shotType !== undefined ? ['shotType'] : []",
    expect: 'carries NO shotType at all'
  },
  {
    // Re-aimed: the source now names BOTH the absent and the unmapped case, so
    // the mutation that proves this assertion is emptying the report outright.
    // Narrowing it back to unmapped-only is M16.
    name: 'M13 the unreported-input list is emptied',
    file: VICTIM,
    anchor: "    notReported: mapped === null ? ['shotType'] : []",
    replace: "    notReported: []",
    expect: 'names the input it could not use'
  }
]

let bad = 0, caught = 0, uncaught = 0
for (const m of MUTATIONS) {
  const before = readFileSync(m.file, 'utf8')
  const hits = before.split(m.anchor).length - 1
  if (hits !== 1) {
    bad += 1
    console.error(`  ANCHOR  ${m.name}\n          anchor occurs ${hits} time(s), expected 1. NOTHING WAS MUTATED.`)
    continue
  }
  const mutated = before.replace(m.anchor, m.replace)
  if (mutated === before) {
    bad += 1
    console.error(`  NO-OP   ${m.name}\n          the replacement is identical to the anchor. NOTHING WAS MUTATED.`)
    continue
  }
  copyFileSync(m.file, m.file + '.mutbak')
  writeFileSync(m.file, mutated)
  let out = ''
  try {
    const r = execFileSync('node', [CHECK], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    out = r
  } catch (e) {
    out = String(e.stdout ?? '') + String(e.stderr ?? '')
  } finally {
    renameSync(m.file + '.mutbak', m.file)
  }

  const failedLines = out.split('\n').filter(l => l.startsWith('FAIL'))
  const threw = /TypeError|ReferenceError|SyntaxError/.test(out)
  if (m.expectUncaught) {
    if (failedLines.length === 0 && !threw) {
      uncaught += 1
      console.log(`  KNOWN   ${m.name}\n          survives as documented: ${m.expectUncaught}`)
    } else {
      bad += 1
      console.error(`  SURPRISE ${m.name} was expected to survive but failed:\n${failedLines.join('\n')}`)
    }
    continue
  }
  const matched = failedLines.some(l => l.includes(m.expect)) || threw
  if (matched) {
    caught += 1
    console.log(`  CAUGHT  ${m.name}`)
  } else {
    bad += 1
    console.error(`  NOT CAUGHT  ${m.name}\n          expected a FAIL mentioning "${m.expect}". Failures seen: ${failedLines.length ? failedLines.join(' | ') : 'none'}`)
  }
}

console.log(`\n${caught} caught, ${uncaught} documented-survivor, ${bad} unsound of ${MUTATIONS.length} mutations`)
process.exit(bad ? 1 : 0)
