// src/nhl-onice.js — who was on the ice at a given instant.
//
// docs/CC-CMD-2026-10-11-nhl-shift-charts-on-ice.md, Task 3.
//
// THE JOIN IS BY TIME INTERVAL, NOT BY eventNumber. The obvious move is to
// join shiftcharts[].eventNumber to plays[].eventId. MEASURED 2026-10-11 and
// it does not work: 0 of 692 shift eventNumbers on game 2026020053 appear as a
// play eventId, and 0 of 2,573 across four further games. The two ranges
// overlap, so they look joinable and are different numbering spaces — the same
// shape as BSD's tennis date parameters, "accepted and silently dropped",
// which produce a confident wrong answer rather than an error.
//
// MEASURED SEMANTICS, not assumed (outbox/nhl-shiftcharts-probe-latest.json):
//   endTime is EXCLUSIVE   119 of 125 shots agree with situationCode, against
//                          108 of 125 when treated as inclusive.
//   the clock COUNTS UP    692 of 692 shifts end after they start, the same
//                          direction as hockey-wp.js's
//                          (period - 1) * 1200 + mm * 60 + ss.
//   times are PERIOD-RELATIVE — a period-1 shift starts at "03:25".
//
// FOUR STATES, NOT TWO (Rule 99). An empty array must never read as "nobody on
// the ice", and a reconstruction that contradicts situationCode is wrong rather
// than interesting: situationCode is confirmed by two independent derivations
// and this is not.

export const SHIFT_END_EXCLUSIVE = true

export const shiftSeconds = (period, mmss) => {
  if (!Number.isFinite(period)) return null
  const m = /^(\d{1,3}):(\d{2})$/.exec(String(mmss ?? ''))
  if (!m) return null
  return (period - 1) * 1200 + Number(m[1]) * 60 + Number(m[2])
}

/**
 * @returns one of:
 *   { state: 'resolved',          home: [ids], away: [ids] }
 *   { state: 'disagrees-with-situation', home, away, expected } — do not use
 *   { state: 'no-shift-data' }            the game has no shift chart at all
 *   { state: 'instant-in-no-interval' }   shift data exists, this second is in none
 */
export const onIceAt = ({ shifts, period, elapsedSeconds, homeTeamId, situationCode = null }) => {
  if (!Array.isArray(shifts) || shifts.length === 0) return { state: 'no-shift-data' }
  if (!Number.isFinite(elapsedSeconds)) return { state: 'instant-in-no-interval', reason: 'elapsed second unreadable' }

  const on = []
  for (const s of shifts) {
    const a = shiftSeconds(s.period, s.startTime)
    const b = shiftSeconds(s.period, s.endTime)
    if (a === null || b === null) continue
    if (elapsedSeconds >= a && (SHIFT_END_EXCLUSIVE ? elapsedSeconds < b : elapsedSeconds <= b)) on.push(s)
  }
  // An empty result is NOT an empty roster. It is an instant the shift data
  // does not cover, and the caller must be able to tell those apart.
  if (on.length === 0) return { state: 'instant-in-no-interval' }

  const home = on.filter(s => String(s.teamId) === String(homeTeamId)).map(s => s.playerId)
  const away = on.filter(s => String(s.teamId) !== String(homeTeamId)).map(s => s.playerId)

  if (situationCode) {
    const m = /^\d{4}$/.test(String(situationCode)) ? String(situationCode) : null
    if (m) {
      // situationCode is away-goalie / away-skaters / home-skaters / home-goalie.
      // Shift charts do not label goalies, so the comparison is total bodies.
      const expHome = Number(m[2]) + (m[3] === '1' ? 1 : 0)
      const expAway = Number(m[1]) + (m[0] === '1' ? 1 : 0)
      if (home.length !== expHome || away.length !== expAway) {
        return {
          state: 'disagrees-with-situation',
          home, away,
          expected: { home: expHome, away: expAway },
          note: 'situationCode is confirmed by two independent derivations and this reconstruction is not. '
              + 'The measured cause on game 2026020053 is a line change in progress: 6 of 125 shots resolve '
              + 'to one extra body on a side while a player leaves and another arrives within the same second.',
        }
      }
    }
  }
  return { state: 'resolved', home, away }
}
