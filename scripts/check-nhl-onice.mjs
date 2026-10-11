#!/usr/bin/env node
// Checks src/nhl-onice.js — docs/CC-CMD-2026-10-11-nhl-shift-charts-on-ice.md
// Task 3's four states. An empty array must never read as "nobody on the ice",
// and a reconstruction that contradicts situationCode must be refused.
import { pathToFileURL } from 'node:url'
import { onIceAt, shiftSeconds, SHIFT_END_EXCLUSIVE } from '../src/nhl-onice.js'

export const run = () => {
  let pass = 0, fail = 0
  const t = (n, c) => { if (c) { pass++; console.log(`PASS  ${n}`) } else { fail++; console.log(`FAIL  ${n}`) } }

  const six = (teamId, period = 1, startTime = '00:00', endTime = '02:00') =>
    [...Array(6)].map((_, i) => ({ playerId: teamId * 100 + i, teamId, period, startTime, endTime }))
  const shifts = [...six(10), ...six(20)]

  t('times are period-relative and count up into game seconds',
    shiftSeconds(1, '03:25') === 205 && shiftSeconds(3, '00:00') === 2400)
  t('a malformed time is null, never zero',
    shiftSeconds(1, 'x') === null && shiftSeconds(null, '01:00') === null)
  t('endTime is EXCLUSIVE, as measured — 119 of 125 against 108',
    SHIFT_END_EXCLUSIVE === true)

  t('a covered instant resolves to both sides',
    (() => {
      const r = onIceAt({ shifts, period: 1, elapsedSeconds: 60, homeTeamId: 10, situationCode: '1551' })
      return r.state === 'resolved' && r.home.length === 6 && r.away.length === 6
    })())

  // FOUR STATES, and none of them is an empty array.
  t('NO SHIFT DATA IS ITS OWN STATE, not an empty roster',
    onIceAt({ shifts: [], period: 1, elapsedSeconds: 60, homeTeamId: 10 }).state === 'no-shift-data'
    && onIceAt({ shifts: null, period: 1, elapsedSeconds: 60, homeTeamId: 10 }).state === 'no-shift-data')
  t('AN INSTANT IN NO INTERVAL IS ITS OWN STATE, not an empty roster',
    onIceAt({ shifts, period: 1, elapsedSeconds: 5000, homeTeamId: 10 }).state === 'instant-in-no-interval')
  t('...and neither of those returns a home or away array at all',
    (() => {
      const a = onIceAt({ shifts: [], period: 1, elapsedSeconds: 60, homeTeamId: 10 })
      const b = onIceAt({ shifts, period: 1, elapsedSeconds: 5000, homeTeamId: 10 })
      return a.home === undefined && b.home === undefined
    })())
  t('an unreadable elapsed second does not resolve to the start of the game',
    onIceAt({ shifts, period: 1, elapsedSeconds: null, homeTeamId: 10 }).state === 'instant-in-no-interval')

  t('A RECONSTRUCTION THAT CONTRADICTS situationCode IS REFUSED, not returned',
    (() => {
      const extra = [...shifts, { playerId: 999, teamId: 20, period: 1, startTime: '00:00', endTime: '02:00' }]
      const r = onIceAt({ shifts: extra, period: 1, elapsedSeconds: 60, homeTeamId: 10, situationCode: '1551' })
      return r.state === 'disagrees-with-situation' && r.expected.away === 6 && r.away.length === 7
    })())
  t('...and it still reports what it found, so the disagreement is inspectable',
    (() => {
      const extra = [...shifts, { playerId: 999, teamId: 20, period: 1, startTime: '00:00', endTime: '02:00' }]
      const r = onIceAt({ shifts: extra, period: 1, elapsedSeconds: 60, homeTeamId: 10, situationCode: '1551' })
      return Array.isArray(r.home) && Array.isArray(r.away)
    })())
  t('an empty net changes the expected count, so a pulled goalie is not a disagreement',
    (() => {
      const away5 = [...Array(6)].map((_, i) => ({ playerId: 2000 + i, teamId: 20, period: 1, startTime: '00:00', endTime: '02:00' }))
      const r = onIceAt({ shifts: [...six(10), ...away5], period: 1, elapsedSeconds: 60, homeTeamId: 10, situationCode: '0651' })
      return r.state === 'resolved'
    })())
  t('with NO situationCode the reconstruction is returned unjudged rather than refused',
    onIceAt({ shifts, period: 1, elapsedSeconds: 60, homeTeamId: 10 }).state === 'resolved')
  t('an unreadable situationCode does not silently become a disagreement',
    onIceAt({ shifts, period: 1, elapsedSeconds: 60, homeTeamId: 10, situationCode: 'xx' }).state === 'resolved')

  t('the exclusive boundary excludes the end second and includes the start',
    (() => {
      const s = [{ playerId: 1, teamId: 10, period: 1, startTime: '00:00', endTime: '01:00' }]
      return onIceAt({ shifts: s, period: 1, elapsedSeconds: 0, homeTeamId: 10 }).state === 'resolved'
          && onIceAt({ shifts: s, period: 1, elapsedSeconds: 60, homeTeamId: 10 }).state === 'instant-in-no-interval'
    })())

  console.log(`\n${pass}/${pass + fail} checks passed`)
  return fail
}
const _e = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (_e && import.meta.url === _e) process.exit(run() ? 1 : 0)
