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

  // Read during round 2: status names only the current round, linescores keep every round.
  const rsmR2 = JSON.parse(readFileSync('outbox/golf-leaderboard-rsm-r2-2026-11-20.json', 'utf8')).competitors
  const tees = rsmR2.flatMap(c => c.linescores)
  const past = summarise(tees, 1)
  check('round 1 read back during round 2, from linescores: 147 of 147, first 13:30Z, last 15:42Z',
    past.inRound === 147 && past.withTeeTime === 147 && past.roundStart === '2026-11-19T13:30:00.000Z' && past.roundLastTee === '2026-11-19T15:42:00.000Z', JSON.stringify(past))
  const cur = summarise(tees, 2)
  // The final, read 2026-11-24: a four-man playoff at 19:09Z after round 4 (12:20Z to 14:10Z).
  const fin = JSON.parse(readFileSync('outbox/golf-leaderboard-rsm-final-2026-11-24.json', 'utf8')).competitors
  const finTees = fin.flatMap(c => c.linescores.filter(l => l.isPlayoff !== true))
  const fin4 = summarise(finTees, 4)
  check('round 4 from linescores, the playoff excluded: 66 of 66, 12:20Z to 14:10Z',
    fin4.inRound === 66 && fin4.withTeeTime === 66 && fin4.roundStart === "2026-11-23T12:20:00.000Z" && fin4.roundLastTee === "2026-11-23T14:10:00.000Z", JSON.stringify(fin4))
  const fin5 = summarise(finTees, 5)
  check('no fifth round: the playoff tee time is not a round', fin5.inRound === 0 && fin5.roundStart === null, JSON.stringify(fin5))
  check('round 2 from linescores: first 13:30Z on 11-20', cur.roundStart === '2026-11-20T13:30:00.000Z' && cur.withTeeTime === cur.inRound, JSON.stringify(cur))

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
  check('the round comes from teeTimeRound(scoreboard.round, ...)', body.includes('teeTimeRound(scoreboard.round, facts.numberOfRounds ? facts.statuses.filter(st => Number(st?.period) <= facts.numberOfRounds) : facts.statuses)'), 'the round is not chosen by teeTimeRound')
  check('the tee times are summarised from linescores (roundTees), not the current-round status',
    body.includes('summariseGolfTeeTimes(facts.roundTees, round)') && /roundTees: list\.flatMap\(c => \(Array\.isArray\(c\?\.linescores\) \? c\.linescores : \[\]\)\.filter\(l => l\?\.isPlayoff !== true\)/.test(reader), 'not read from linescores')
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
    'playoff tee times kept as a round': [S, R, srcMut('.filter(l => l?.isPlayoff !== true).map(l => ({ period: l?.period, teeTime: l?.teeTime }))', '.map(l => ({ period: l?.period, teeTime: l?.teeTime }))')],
    'tee times read from status again': [S, R, srcMut('summariseGolfTeeTimes(facts.roundTees, round)', 'summariseGolfTeeTimes(facts.statuses.filter(Boolean), round)')],
    'round not chosen by teeTimeRound': [S, R, srcMut('teeTimeRound(scoreboard.round, facts.numberOfRounds ? facts.statuses.filter(st => Number(st?.period) <= facts.numberOfRounds) : facts.statuses)', 'Number(scoreboard.round)')],
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
