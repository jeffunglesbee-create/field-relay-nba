#!/usr/bin/env node
// src/golf-round-line.js: a golf competitor's `today` and `thru` are the CURRENT round's, not round 1's.
// Held against a real scoreboard read after RSM round 2 (outbox/golf-scoreboard-rsm-after-r2-2026-11-21.json,
// 147 competitors). Expected values are what that read shows, not what the code computes:
//   145 players in round 2 with 18 holes; 2 with only a round-1 entry (withdrawn), thru null
//   first competitor: rounds -4 / -5 / not begun -> round 2, today "-5", thru 18
// And the wiring: handleESPNGolfScoreboard takes today and thru from golfRoundLine, and nothing in it
// reads linescores[0] any more.
//   node scripts/check-golf-round-line.mjs              run the check
//   node scripts/check-golf-round-line.mjs --self-test  each mutant must turn a check red (Rule 90)
import { readFileSync } from 'node:fs'
import { golfRoundLine } from '../src/golf-round-line.js'

const fixture = JSON.parse(readFileSync('outbox/golf-scoreboard-rsm-after-r2-2026-11-21.json', 'utf8')).competitors
const holes = l => l.holes

function run(line, src) {
  const results = []
  const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail })
  const out = fixture.map(c => line(c.linescores, holes))
  const r2 = out.filter(x => x.round === 2)
  check('145 players read as in round 2, every one thru 18', r2.length === 145 && r2.every(x => x.thru === 18), `${r2.length} in round 2; thru ${[...new Set(r2.map(x => x.thru))]}`)
  const first = out[0]
  check('the first competitor (-4, -5, round 3 not begun) reads round 2, today -5, thru 18',
    first.round === 2 && first.today === '-5' && first.thru === 18, JSON.stringify(first))
  const r1only = out.filter((x, i) => fixture[i].linescores.length === 1)
  check('a player with only a round-1 entry stays in round 1', r1only.length === 2 && r1only.every(x => x.round === 1), JSON.stringify(r1only))
  const differs = out.filter((x, i) => x.round > 1 && x.today !== fixture[i].linescores[0].displayValue).length
  check('for players past round 1, today is NOT the round-1 score for most of the field (128 of 145)', differs === 128, `${differs}`)
  check('a not-begun round is not counted: an empty round-3 entry leaves the round at 2', line([{ period: 1, displayValue: '-1', holes: 18 }, { period: 2, displayValue: null, holes: 0 }], holes).round === 1, JSON.stringify(line([{ period: 1, displayValue: '-1', holes: 18 }, { period: 2, displayValue: null, holes: 0 }], holes)))
  check('a round in progress reports its own holes', line([{ period: 1, displayValue: '-4', holes: 18 }, { period: 2, displayValue: '-1', holes: 5 }], holes).thru === 5, JSON.stringify(line([{ period: 1, displayValue: '-4', holes: 18 }, { period: 2, displayValue: '-1', holes: 5 }], holes)))

  const a = src.indexOf('async function handleESPNGolfScoreboard(')
  const body = src.slice(a, src.indexOf('\nasync function ', a + 10))
  check('the scoreboard takes today and thru from golfRoundLine', /const line\s*= golfRoundLine\(c\.linescores\);/.test(body) && /today:\s*line\.today/.test(body) && /thru:\s*line\.thru/.test(body), 'not wired')
  check('nothing in the scoreboard reads linescores[0]', !/linescores\[0\]/.test(body), 'a linescores[0] read is back')
  return results
}

const src = readFileSync('src/index.js', 'utf8')
const swap = (a, b) => { if (src.split(a).length !== 2) throw new Error(`mutation anchor not unique: ${a}`); return src.replace(a, b) }
const print = rs => { for (const r of rs) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      → ${r.detail}`}`); const p = rs.filter(r => r.ok).length; console.log(`\n${p}/${rs.length} checks passed`); return p === rs.length }

if (process.argv.includes('--self-test')) {
  const mutants = {
    'round 1 read in every round (the defect)': [(ls, h) => { const r = golfRoundLine(ls, h); const f = Array.isArray(ls) ? ls[0] : null; return { ...r, today: f?.displayValue ?? null, thru: f ? (h(f) || null) : null } }, src],
    'the last entry taken, begun or not': [(ls, h) => { const r = golfRoundLine(ls, h); const l = Array.isArray(ls) ? ls[ls.length - 1] : null; return { round: ls?.length ?? null, today: l?.displayValue ?? null, thru: l ? (h(l) || null) : null } }, src],
    'thru reported as 18 whatever the holes': [(ls, h) => { const r = golfRoundLine(ls, h); return { ...r, thru: r.round ? 18 : null } }, src],
    'the scoreboard reads linescores[0] again': [golfRoundLine, swap('today:     line.today ?? findStat', "today:     (c.linescores?.[0]?.displayValue) ?? line.today ?? findStat").replace('c.linescores?.[0]', 'c.linescores[0]')],
    'the scoreboard does not use golfRoundLine': [golfRoundLine, swap('const line     = golfRoundLine(c.linescores);', 'const line     = { today: null, thru: null };')],
  }
  let survived = 0
  for (const [name, [l, s]] of Object.entries(mutants)) { const red = run(l, s).filter(r => !r.ok).length; console.log(`${red ? 'CAUGHT' : 'SURVIVED'}  ${name} (${red} red)`); if (!red) survived++ }
  const clean = run(golfRoundLine, src).every(r => r.ok)
  console.log(`\nself-test: ${Object.keys(mutants).length - survived}/${Object.keys(mutants).length} mutants caught; clean run ${clean ? 'green' : 'RED'}`)
  process.exit(survived === 0 && clean ? 0 : 1)
}
process.exit(print(run(golfRoundLine, src)) ? 0 : 1)
