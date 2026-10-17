#!/usr/bin/env node
// Rule 90 for scripts/check-bsd-frame-contract.mjs. Each mutation is a way the
// guard could pass while broken; every one must turn its --self-test red.
//
// The two that matter most are the first and the last-but-one: a guard that
// stops treating a one-sided sample as INSUFFICIENT passes the original defect
// again, and a guard that compares frame names but not perTeam passes a
// declaration that names the right frame with the wrong scope. Both survived
// the first draft of the self-test, which is why both tests exist.
//
// Anchor discipline: exactly one match asserted before mutating, the original
// restored from memory and confirmed byte-identical afterwards. NOT CAUGHT
// with nothing mutated is worse than no test.

import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const GUARD = 'scripts/check-bsd-frame-contract.mjs'
const MUTATIONS = [
  ['a one-sided sample is no longer insufficient', "if (home.half === null || away.half === null) return null", 'if (false) return null'],
  ['own goals are counted', 'if (isOwnGoal(inc)) { out.ownGoalsExcluded++; continue }', 'if (false) { out.ownGoalsExcluded++; continue }'],
  ['the census stops sending the cursor', "${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}", "${''}"],
  ['a truncated page with no cursor is accepted', 'if (!r.json.cursor) throw', 'if (false) throw'],
  ['the keeper anchor is ignored', "const att = (h) => anchor === 'attacked' ? h : (h === 'low' ? 'high' : 'low')", 'const att = (h) => h'],
  ['a page from another prefix is accepted', 'if (r.json.prefix !== prefix) throw', 'if (false) throw'],
  ['a split side reads as a half', "high / n >= SIDE_AGREE ? 'high' : (n - high) / n >= SIDE_AGREE ? 'low' : 'mixed'", "high / n >= 0.5 ? 'high' : 'low'"],
  ['a nonzero gm.x passes as the goal plane', 'const ok = [...split.home, ...split.away].every(x => x === 0)', 'const ok = true'],
  ['an upward gm.y passes as goal-mouth-2d', "down(res.home) && down(res.away) ? 'goal-mouth-2d'", "true ? 'goal-mouth-2d'"],
  ['perTeam is not compared', 'const ok = r.frame === decl?.frame && r.perTeam === decl?.perTeam', 'const ok = r.frame === decl?.frame'],
  ['the live mutation flips a declaration that disagrees', "if (base.find(r => r.path === path)?.outcome !== 'agree') return { path, skipped: true }", '0'],
  ['a measured path the contract drops is tolerated', "rows.push({ path, outcome: 'disagree', why: 'measured path is no longer declared by the contract' })", '0'],
]

const original = readFileSync(GUARD, 'utf8')
let survivors = 0, unapplied = 0
try {
  for (const [name, from, to] of MUTATIONS) {
    const hits = original.split(from).length - 1
    if (hits !== 1) { console.log(`NOT APPLIED  ${name}: anchor matched ${hits} times — NOTHING MUTATED`); unapplied++; continue }
    writeFileSync(GUARD, original.replace(from, to))
    if (readFileSync(GUARD, 'utf8') === original) { console.log(`NOT APPLIED  ${name}: file unchanged on disk`); unapplied++; continue }
    const r = spawnSync('node', [GUARD, '--self-test'], { encoding: 'utf8' })
    const caught = r.status !== 0
    if (!caught) survivors++
    console.log(`${caught ? 'caught      ' : 'NOT CAUGHT  '} ${name}`)
  }
} finally {
  writeFileSync(GUARD, original)
}
if (readFileSync(GUARD, 'utf8') !== original) { console.log(`FAIL: ${GUARD} was not restored`); process.exit(1) }
console.log(`${MUTATIONS.length} mutations: ${MUTATIONS.length - survivors - unapplied} caught, ${survivors} survived, ${unapplied} not applied`)
process.exit(survivors || unapplied ? 1 : 0)
