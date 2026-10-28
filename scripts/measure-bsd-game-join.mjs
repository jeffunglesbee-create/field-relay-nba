// Measure what the BSD game join leaves unmatched on a captured fixture, and offer a reviewer the BSD events
// each miss could be. docs/CC-CMD-2026-10-28-bsd-join-aliases-beyond-the-fixture-dates.md, Task 2.
//
// WHAT THIS IS. A reviewer's aid. `joinBatch` (src/bsd-game-join.js, the rule, untouched) decides what is joined; this
// reads its verdicts and, for each row it did not join, lists the BSD events NOT already claimed by a joined row whose
// names look like the row's. Nothing in src/ reads this, and nothing here chooses an alias: Task 3 reads the output
// and adds a name only where the NAMES say two strings are the same club.
//
// WHAT "LOOKS LIKE" MEANS, and why the kickoff is not in it. A side looks like an event's side when the two resolve to
// the same key, or when one folded name contains the other ("alaves" in "deportivoalaves", four characters or more).
// The kickoff gap is printed beside each candidate and never ranks or filters one: the owner ruling of 2026-10-19 is
// that a kickoff may refuse and never chooses, and two unmatched rows at one kickoff would otherwise pair by the clock.
//
// A PROPOSAL exists only when exactly one unclaimed event looks like the row on BOTH sides. Two such events is
// `ambiguous`, an event for neither is `no-event`, and neither is proposed.
//
// COVERAGE IS PRINTED WITH THE RESULT (Rule 91): dates, rows and events, per label, and the distinct clubs behind the
// misses. More than 40 such clubs is the CC-CMD's stop condition and is reported as such.
//
// Usage:  node scripts/measure-bsd-game-join.mjs --self-test
//         node scripts/measure-bsd-game-join.mjs --fixture outbox/fixture-bsd-game-join-more-dates.json [--json out.json]

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { joinBatch, eventDaysFor } from '../src/bsd-game-join.js'
import { resolveTeamKey } from '../src/identity-resolver.js'

export const STOP_CLUBS = 40
const nameOf = t => (t && typeof t === 'object' ? t.name : t)
export const fold = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Do two club names look like the same club? Equal keys, or one folded name inside the other. */
export const looksLike = (a, b) => {
  const ka = resolveTeamKey(a), kb = resolveTeamKey(b)
  if (ka && kb && ka === kb) return true
  const fa = fold(a), fb = fold(b)
  if (fa.length < 4 || fb.length < 4) return false
  return fa.includes(fb) || fb.includes(fa)
}

const gapMinutes = (row, e) => {
  const x = Date.parse(row.start_time), y = Date.parse(e.event_date)
  return Number.isNaN(x) || Number.isNaN(y) ? null : Math.round(Math.abs(x - y) / 60000)
}

/** One date. Pure over the rows and events it is handed. */
export function analyse(date, rows, events) {
  const { results, counts } = joinBatch(rows, events)
  const claimed = new Set(results.filter(r => r.how === 'joined').map(r => String(r.bsd_event_id)))
  const free = events.filter(e => !claimed.has(String(e.id)))
  const unmatched = []
  rows.forEach((row, i) => {
    const r = results[i]
    if (r.how === 'joined' || r.how === 'not-soccer') return
    const candidates = free
      .map(e => ({
        id: String(e.id), home: nameOf(e.home_team), away: nameOf(e.away_team),
        homeLike: looksLike(row.home, nameOf(e.home_team)), awayLike: looksLike(row.away, nameOf(e.away_team)),
        gapMinutes: gapMinutes(row, e),
      }))
      .filter(c => c.homeLike || c.awayLike)
    const both = candidates.filter(c => c.homeLike && c.awayLike)
    let reason, proposal = null
    if (r.how === 'ambiguous') reason = 'ambiguous'
    else if (r.how === 'refused-kickoff') reason = 'refused-kickoff'
    else if (both.length === 1) {
      reason = 'proposal'
      const c = both[0]
      proposal = { eventId: c.id, pairs: [] }
      if (resolveTeamKey(row.home) !== resolveTeamKey(c.home)) proposal.pairs.push({ archive: row.home, bsd: c.home })
      if (resolveTeamKey(row.away) !== resolveTeamKey(c.away)) proposal.pairs.push({ archive: row.away, bsd: c.away })
    } else if (both.length > 1) reason = 'ambiguous-proposals'
    else reason = candidates.length ? 'one-side-only' : 'no-event'
    unmatched.push({ rowId: row.id, label: row.sport, home: row.home, away: row.away, how: r.how, reason, candidates, proposal })
  })
  const byLabel = {}
  rows.forEach((row, i) => {
    const l = (byLabel[row.sport] ??= { rows: 0, joined: 0 })
    l.rows++
    if (results[i].how === 'joined') l.joined++
  })
  // The clubs behind the misses: a side whose key matches no side of any unclaimed event on this date.
  const freeKeys = new Set(free.flatMap(e => [resolveTeamKey(nameOf(e.home_team)), resolveTeamKey(nameOf(e.away_team))]))
  const clubs = new Set()
  for (const u of unmatched) for (const side of [u.home, u.away]) if (!freeKeys.has(resolveTeamKey(side))) clubs.add(side)
  return { date, counts, byLabel, unmatched, clubs: [...clubs], events: events.length, freeEvents: free.length }
}

/** Every date of a fixture. */
export function analyseFixture(fx) {
  return fx.dates.map(d => analyse(d.date, d.rows, eventDaysFor(d.date).flatMap(day => d.events[day] || [])))
}

// --- self-test ---------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--self-test')) {
  let bad = 0
  const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); if (!ok) bad++ }
  const row = (id, home, away, extra = {}) => ({ id, sport: 'La Liga', home, away, start_time: '2026-10-10T19:00Z', ...extra })
  const ev = (id, home, away) => ({ id, home_team: home, away_team: away, event_date: '2026-10-10T19:00:00+00:00' })

  const known = analyse('d', [row('a', 'Sevilla', 'Real Betis')], [ev(1, 'Sevilla', 'Real Betis')])
  check('a row whose names are known is joined and listed nowhere', known.counts.joined === 1 && known.unmatched.length === 0, JSON.stringify(known.counts))

  const oneSide = analyse('d', [row('a', 'Alavés', 'Sevilla')], [ev(1, 'Deportivo Alavés', 'Sevilla')])
  check('one unknown club: listed with its one candidate and a one-pair proposal',
    oneSide.unmatched.length === 1 && oneSide.unmatched[0].reason === 'proposal' &&
    oneSide.unmatched[0].proposal.eventId === '1' && oneSide.unmatched[0].proposal.pairs.length === 1 &&
    oneSide.unmatched[0].proposal.pairs[0].bsd === 'Deportivo Alavés', JSON.stringify(oneSide.unmatched[0]))

  // Two invented clubs, because the resolver already equates real ones ("Atlético" and "Atlético Madrid" are the same
  // key, found when the first version of this test used them), and the point is two names it does NOT equate.
  const both = analyse('d', [row('a', 'Quux Town', 'Zork Rovers')], [ev(1, 'Quux Town Athletic', 'Zork Rovers Calcio')])
  check('both clubs unknown: a two-pair proposal from the NAMES', both.unmatched[0]?.proposal?.pairs.length === 2, JSON.stringify(both.unmatched[0]))
  check('a club the resolver already equates is not proposed again',
    analyse('d', [row('a', 'Alavés', 'Atlético')], [ev(1, 'Deportivo Alavés', 'Atlético Madrid')]).unmatched[0]?.proposal?.pairs.length === 1)

  // The kickoff is identical for both events, so only the names can tell them apart; and when the names cannot, the
  // answer is "ambiguous", never the nearer clock.
  const twin = analyse('d', [row('a', 'Alavés', 'Atlético')], [ev(1, 'Deportivo Alavés', 'Atlético Madrid'), ev(2, 'Deportivo Alavés', 'Atlético Madrid B')])
  check('MUTATION: two events that look like the row are ambiguous and not proposed',
    twin.unmatched[0].reason === 'ambiguous-proposals' && twin.unmatched[0].proposal === null, JSON.stringify(twin.unmatched[0]))

  // Event 1 is claimed by row a, and it shares row b's HOME club, so it WOULD be offered to row b if the claim were not
  // subtracted. The first version of this case used an event that looked nothing like row b, and a mutation removing the
  // subtraction survived it.
  const claimed = analyse('d', [row('a', 'Sevilla', 'Real Betis'), row('b', 'Sevilla', 'Zork Rovers')],
    [ev(1, 'Sevilla', 'Real Betis'), ev(2, 'Sevilla', 'Zork Rovers Calcio')])
  const claimedAlso = analyse('d', [row('a', 'Alavés', 'Sevilla'), row('b', 'Alavés', 'Sevilla')], [ev(1, 'Sevilla', 'Real Betis'), ev(2, 'Deportivo Alavés', 'Sevilla')])
  check('an event already claimed by a joined row is not offered to another row, though it looks like it',
    claimed.unmatched.length === 1 && claimed.unmatched[0].candidates.length === 1 && claimed.unmatched[0].candidates[0].id === '2',
    JSON.stringify(claimed.unmatched[0]?.candidates))
  check('...and both of two rows unmatched see the same free event, which is why a proposal is not a claim',
    claimedAlso.unmatched.length === 2 && claimedAlso.unmatched.every(u => u.candidates.some(c => c.id === '2')))

  const none = analyse('d', [row('a', 'Alavés', 'Atlético')], [ev(1, 'Girona', 'Valencia')])
  check('MUTATION: a row with no event that looks like it is no-event, never proposed',
    none.unmatched[0].reason === 'no-event' && none.unmatched[0].proposal === null, JSON.stringify(none.unmatched[0]))

  check('the kickoff gap is printed beside a candidate and does not rank or filter it',
    oneSide.unmatched[0].candidates[0].gapMinutes === 0 &&
    analyse('d', [row('a', 'Alavés', 'Sevilla', { start_time: '2026-10-10T10:00Z' })], [ev(1, 'Deportivo Alavés', 'Sevilla')]).unmatched[0].candidates.length === 1)
  check('MUTATION: a name under four characters does not match by containment',
    looksLike('Eibar', 'Deportivo Eibar') === true && looksLike('FC', 'FC Dallas') === false)
  check('the clubs behind the misses are counted once each',
    analyse('d', [row('a', 'Alavés', 'Sevilla'), row('b', 'Alavés', 'Girona')], [ev(1, 'Deportivo Alavés', 'Sevilla'), ev(2, 'Deportivo Alavés', 'Girona')]).clubs.length <= 1)
  check('a non-soccer row is neither joined nor listed',
    analyse('d', [{ id: 'x', sport: 'NBA', home: 'A', away: 'B' }], []).unmatched.length === 0)
  console.log(`\n${12 - bad}/12 checks passed`)
  process.exit(bad ? 1 : 0)
}

// --- cli ---------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url) && !process.argv.includes('--self-test')) {
  const at = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
  const file = at('--fixture')
  if (!file) { console.error('usage: measure-bsd-game-join.mjs --fixture FILE [--json OUT]'); process.exit(2) }
  const fx = JSON.parse(readFileSync(file, 'utf8'))
  const all = analyseFixture(fx)
  let rows = 0, joined = 0, events = 0
  const clubs = new Set(), labels = {}
  for (const a of all) {
    rows += a.counts.rows; joined += a.counts.joined; events += a.events
    a.clubs.forEach(c => clubs.add(c))
    for (const [l, v] of Object.entries(a.byLabel)) { const t = (labels[l] ??= { rows: 0, joined: 0 }); t.rows += v.rows; t.joined += v.joined }
    console.log(`\n${a.date}: joined ${a.counts.joined} of ${a.counts.rows} soccer rows (${a.events} BSD events, ${a.freeEvents} unclaimed)`)
    console.log(`  ${Object.entries(a.byLabel).map(([l, v]) => `${l} ${v.joined}/${v.rows}`).join(', ')}`)
    for (const u of a.unmatched) {
      console.log(`  - ${u.label}: ${u.home} v ${u.away}  [${u.how} -> ${u.reason}]`)
      for (const c of u.candidates.slice(0, 4)) console.log(`      candidate ${c.id}: ${c.home} v ${c.away}  (home ${c.homeLike ? 'like' : '-'}, away ${c.awayLike ? 'like' : '-'}, kickoff gap ${c.gapMinutes ?? '?'} min)`)
      if (u.proposal) console.log(`      PROPOSAL event ${u.proposal.eventId}: ${u.proposal.pairs.map(p => `${p.archive} = ${p.bsd}`).join('; ') || '(names already resolve; check why)'}`)
    }
  }
  console.log(`\nCOVERAGE: ${all.length} dates, ${rows} soccer rows, ${events} BSD events; joined ${joined} of ${rows} (${((joined / rows) * 100).toFixed(1)}%)`)
  console.log(`  per label: ${Object.entries(labels).map(([l, v]) => `${l} ${v.joined}/${v.rows}`).join(', ')}`)
  console.log(`  unmatched rows: ${rows - joined}; distinct clubs behind them: ${clubs.size}${clubs.size > STOP_CLUBS ? `  -- MORE THAN ${STOP_CLUBS}: STOP (design problem, not a long list)` : ''}`)
  if (at('--json')) writeFileSync(at('--json'), JSON.stringify({ file, measuredAt: new Date().toISOString(), dates: all }, null, 1) + '\n')
  process.exit(clubs.size > STOP_CLUBS ? 3 : 0)
}
