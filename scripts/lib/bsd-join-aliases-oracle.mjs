// The expected event for the rows the BSD join left unmatched BEFORE the nine alias pairs of
// docs/CC-CMD-2026-10-28-bsd-join-aliases-beyond-the-fixture-dates.md, read from the measurement that listed them
// (outbox/bsd-join-aliases-measure-before.json: scripts/measure-bsd-game-join.mjs run at 4de1b0c, the resolver before
// any pair was added).
//
// Why this is independent of the rule under test: the measurement names, for each miss, the BSD events inside the kickoff
// window whose two NAMES look like the row's, and a reviewer read them. The join rule never chose these. A row with one
// candidate and one side that did not look alike is `one-side-only`; its only candidate is expected once the other side is
// an alias. A row with no candidate is `no-event`: BSD has no event for it, so ANY id served on it is wrong.
//
// Read from the committed file, not copied, so the expectation cannot drift from the measurement it cites.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const DERIVED_FROM = 'outbox/bsd-join-aliases-measure-before.json'

export function expectationsFrom(before) {
  const proposals = [], oneSide = [], noEvent = []
  for (const d of before.dates) {
    for (const u of d.unmatched) {
      const game = `${u.label}: ${u.home} v ${u.away}`
      if (u.reason === 'proposal') proposals.push({ date: d.date, rowId: u.rowId, eventId: String(u.proposal.eventId), game })
      else if (u.reason === 'one-side-only' && u.candidates.length === 1) oneSide.push({ date: d.date, rowId: u.rowId, eventId: String(u.candidates[0].id), game })
      else if (u.reason === 'no-event') noEvent.push({ date: d.date, rowId: u.rowId, game })
      else throw new Error(`${u.rowId}: an unmatched row with reason ${JSON.stringify(u.reason)} and ${u.candidates.length} candidates is not one this oracle knows how to expect`)
    }
  }
  const beforeJoined = Object.fromEntries(before.dates.map(d => [d.date, { joined: d.counts.joined, rows: d.counts.rows }]))
  return { proposals, oneSide, noEvent, beforeJoined }
}

const here = fileURLToPath(new URL('.', import.meta.url))
export const EXPECT = expectationsFrom(JSON.parse(readFileSync(`${here}../../${DERIVED_FROM}`, 'utf8')))
