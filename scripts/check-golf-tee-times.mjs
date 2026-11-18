#!/usr/bin/env node
// docs/CC-CMD-2026-11-16-golf-tee-times.md, Task 2: the round's start is the EARLIEST
// teeTime among competitors whose `period` is that round.
//
// Held against the real read: outbox/golf-tee-times-probe-2026-11-16.json (run
// 43975853385), every competitor's status for the Austin Championship, event 401850980.
// Expected values are what that artifact recorded, not what the code computes:
//   round 4: 67 in the round, 67 with a teeTime, first 13:30Z, last 15:31Z
//   round 2: 52 in the round (the cut), none with a teeTime
// And the wiring, read from src/index.js: /v2/golf/enriched serves roundStart,
// roundLastTee, timeValid and teeTimes, and the tee-time reader is not called from a
// cron path (Rule 78: a cache miss must not add per-competitor reads to the cycle).
//
//   node scripts/check-golf-tee-times.mjs              run the check
//   node scripts/check-golf-tee-times.mjs --self-test  the check can still fail (Rule 90)

import { readFileSync } from 'node:fs'
import { summariseGolfTeeTimes } from '../src/golf-tee-times.js'

const run = (summarise, src) => {
  const results = []
  const check = (name, ok, detail = '') => results.push({ name, ok, detail })
  const art = JSON.parse(readFileSync('outbox/golf-tee-times-probe-2026-11-16.json', 'utf8'))
  const statuses = art.statuses
  const r4 = summarise(statuses, 4)
  check('round 4: 67 of 67 in-round competitors carry a teeTime', r4.inRound === 67 && r4.withTeeTime === 67, JSON.stringify(r4))
  check('round 4 starts at the earliest teeTime, 13:30Z', r4.roundStart === '2026-11-16T13:30:00.000Z', r4.roundStart)
  check('round 4 last tee is the latest, 15:31Z', r4.roundLastTee === '2026-11-16T15:31:00.000Z', r4.roundLastTee)
  const r2 = summarise(statuses, 2)
  check('round 2 read after the cut: 52 in the round, none with a teeTime, no start invented',
    r2.inRound === 52 && r2.withTeeTime === 0 && r2.roundStart === null && r2.roundLastTee === null, JSON.stringify(r2))
  const r3 = summarise(statuses, 3)
  check('a round nobody is in yields nulls, not a start', r3.inRound === 0 && r3.roundStart === null, JSON.stringify(r3))

  const enriched = src.slice(src.indexOf('async function handleGolfEnriched('))
  const body = enriched.slice(0, enriched.indexOf('\nasync function ', 10))
  check('/v2/golf/enriched serves roundStart, roundLastTee, timeValid and teeTimes',
    ['roundStart:', 'roundLastTee:', 'timeValid:', 'teeTimes:'].every(k => body.includes(k)), 'a field is missing from the enriched result')
  const callers = [...src.matchAll(/getGolfRoundTeeTimes\(/g)].length
  check('the tee-time reader has exactly one caller besides its definition (the enriched route)', callers === 2, `${callers} occurrences`)
  return results
}

const print = results => {
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      → ${r.detail}`}`)
  const passed = results.filter(r => r.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  return passed === results.length
}

const src = readFileSync('src/index.js', 'utf8')
if (process.argv.includes('--self-test')) {
  // Each mutant is a wrong summariser; each must turn at least one check red.
  const mutants = {
    'latest taken as the start': (st, n) => { const r = summariseGolfTeeTimes(st, n); return { ...r, roundStart: r.roundLastTee } },
    'period filter dropped': (st) => summariseGolfTeeTimes(st.map(x => ({ ...x, period: 4 })), 4),
    'a missing teeTime counted as present': (st, n) => { const r = summariseGolfTeeTimes(st, n); return { ...r, withTeeTime: r.inRound } },
  }
  let survived = 0
  for (const [name, m] of Object.entries(mutants)) {
    const red = run(m, src).filter(r => !r.ok).length
    console.log(`${red > 0 ? 'CAUGHT' : 'SURVIVED'}  ${name} (${red} red)`)
    if (red === 0) survived++
  }
  const clean = run(summariseGolfTeeTimes, src).every(r => r.ok)
  console.log(`\nself-test: ${Object.keys(mutants).length - survived}/${Object.keys(mutants).length} mutants caught; clean run ${clean ? 'green' : 'RED'}`)
  process.exit(survived === 0 && clean ? 0 : 1)
}
process.exit(print(run(summariseGolfTeeTimes, src)) ? 0 : 1)
