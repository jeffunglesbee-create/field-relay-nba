#!/usr/bin/env node
// docs/CC-CMD-2026-11-16-golf-tee-times.md, Task 2: the round's start is the EARLIEST
// teeTime among competitors whose `period` is that round.
//
// Held against the real read: outbox/golf-tee-times-probe-2026-11-16.json (run
// 43975853385), every competitor's status for the Austin Championship, event 401850980.
// Expected values are what that artifact recorded, not what the code computes:
//   round 4: 67 in the round, 67 with a teeTime, first 13:30Z, last 15:31Z
//   round 2: 52 in the round (the cut), none with a teeTime
// And ESPN's golf leaderboard before round 1 of the RSM Classic, event 401850981
// (outbox/golf-leaderboard-rsm-r1-2026-11-19.json), the source the relay reads since
// 2026-11-19 because the core API answers 403 to the Worker:
//   no scoreboard round yet: the round is 1 (every competitor at period 1)
//   round 1: 147 of 147 with a teeTime, first 13:30Z (8:30 AM ET), last 15:42Z
// And the wiring, read from src/index.js: /v2/golf/enriched serves roundStart,
// roundLastTee, timeValid and teeTimes; the leaderboard is read from ESPN_API_BASE with
// one caller, the enriched route (Rule 78: never a cron path); no core-API read is left
// in that route; and the round comes from teeTimeRound.
//
//   node scripts/check-golf-tee-times.mjs              run the check
//   node scripts/check-golf-tee-times.mjs --self-test  the check can still fail (Rule 90)

import { readFileSync } from 'node:fs'
import { summariseGolfTeeTimes, teeTimeRound } from '../src/golf-tee-times.js'

const run = (summarise, pickRound, src) => {
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

  const lb = JSON.parse(readFileSync('outbox/golf-leaderboard-rsm-r1-2026-11-19.json', 'utf8')).competitors.map(c => c.status)
  const lbRound = pickRound(null, lb)
  check('before the first shot (no scoreboard round) the round is the one the field is teed up for, 1', lbRound === 1, String(lbRound))
  const lr1 = summarise(lb, 1)
  check('RSM round 1: 147 of 147 carry a teeTime, first 13:30Z, last 15:42Z',
    lr1.inRound === 147 && lr1.withTeeTime === 147 && lr1.roundStart === '2026-11-19T13:30:00.000Z' && lr1.roundLastTee === '2026-11-19T15:42:00.000Z', JSON.stringify(lr1))
  check('a scoreboard round, when there is one, is the round', pickRound(3, lb) === 3, String(pickRound(3, lb)))
  const cut = pickRound(null, [{ period: 2 }, { period: 4 }, { period: 4 }, {}])
  check('players cut stay on their period; the current round is the highest', cut === 4, String(cut))

  const enriched = src.slice(src.indexOf('async function handleGolfEnriched('))
  const body = enriched.slice(0, enriched.indexOf('\nasync function ', 10))
  check('/v2/golf/enriched serves roundStart, roundLastTee, timeValid and teeTimes',
    ['roundStart:', 'roundLastTee:', 'timeValid:', 'teeTimes:'].every(k => body.includes(k)), 'a field is missing from the enriched result')
  const callers = [...src.matchAll(/getGolfLeaderboardFacts\(/g)].length
  check('the leaderboard reader has exactly one caller besides its definition (the enriched route)', callers === 2, `${callers} occurrences`)
  const reader = src.slice(src.indexOf('async function getGolfLeaderboardFacts('), src.indexOf('async function handleGolfEnriched('))
  check('the leaderboard is read from ESPN_API_BASE, the host the Worker reaches',
    body.includes('`${ESPN_API_BASE}/sports/golf/leaderboard?league=pga&event=') && body.includes('getGolfLeaderboardFacts(leaderboardUrl, eventId)') && reader.includes('fetch(url'), 'no ESPN_API_BASE leaderboard read')
  check('no core-API read is left in the enriched route (403 from the Worker)', !body.includes('sports.core.api.espn.com') && !reader.includes('sports.core.api.espn.com'), 'a core-API URL is in the route')
  check('the round comes from teeTimeRound(scoreboard.round, ...)', body.includes('teeTimeRound(scoreboard.round, facts.statuses)'), 'the round is not chosen by teeTimeRound')
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
  // Each mutant is a wrong summariser, round picker or source; each must turn a check red.
  const S = summariseGolfTeeTimes, R = teeTimeRound
  const srcMut = (a, b) => { if (src.split(a).length !== 2) throw new Error(`mutation anchor not unique: ${a}`); return src.replace(a, b) }
  const mutants = {
    'latest taken as the start': [(st, n) => { const r = S(st, n); return { ...r, roundStart: r.roundLastTee } }, R, src],
    'period filter dropped': [(st) => S(st.map(x => ({ ...x, period: 4 })), 4), R, src],
    'a missing teeTime counted as present': [(st, n) => { const r = S(st, n); return { ...r, withTeeTime: r.inRound } }, R, src],
    'pre-round round left null': [S, (sb) => (sb == null ? null : Number(sb)), src],
    'lowest period taken as the round': [S, (sb, st) => sb ?? Math.min(...st.map(x => Number(x?.period)).filter(p => p >= 1)), src],
    'scoreboard round ignored': [S, (sb, st) => R(null, st), src],
    'core API put back in the route': [S, R, srcMut('const leaderboardUrl = `${ESPN_API_BASE}/sports/golf/leaderboard?league=pga&event=', 'const leaderboardUrl = `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/${eventId}`; const _u = `/sports/golf/leaderboard?league=pga&event=')],
    'the helper fetches something other than the URL it is given': [S, R, srcMut('        const r = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } });\n        if (!r.ok) { console.error(`[GOLF] leaderboard read', '        const r = await fetch(String(eventId), { cf: { cacheTtl: 300, cacheEverything: true } });\n        if (!r.ok) { console.error(`[GOLF] leaderboard read')],
    'round not chosen by teeTimeRound': [S, R, srcMut('teeTimeRound(scoreboard.round, facts.statuses)', 'Number(scoreboard.round)')],
  }
  let survived = 0
  for (const [name, [ms, mr, msrc]] of Object.entries(mutants)) {
    const red = run(ms, mr, msrc).filter(r => !r.ok).length
    console.log(`${red > 0 ? 'CAUGHT' : 'SURVIVED'}  ${name} (${red} red)`)
    if (red === 0) survived++
  }
  const clean = run(summariseGolfTeeTimes, teeTimeRound, src).every(r => r.ok)
  console.log(`\nself-test: ${Object.keys(mutants).length - survived}/${Object.keys(mutants).length} mutants caught; clean run ${clean ? 'green' : 'RED'}`)
  process.exit(survived === 0 && clean ? 0 : 1)
}
process.exit(print(run(summariseGolfTeeTimes, teeTimeRound, src)) ? 0 : 1)
