// Why did the BSD join leave Rennes v Lille (14:00Z) and Angers v Nice (16:15Z) of Ligue 1, 2026-11-08, unmatched at 10:55Z when the creating tick
// (10:01Z) joined 20 of 22 Bundesliga, EPL, La Liga, Ligue 1 and Serie A rows that day? (Rows Ligue 1_2026-11-08_e401876406 and _e401876412.)
//
// Same method and same answer space as scripts/probe-bsd-unmatched-row.mjs (the 2026-11-07 Auxerre v Paris FC case): read the events BSD itself serves for
// the days the join reads, through the relay's public /bsd/events/by-date route (same cache key as the join), and print every event naming one of
// the four clubs with the team keys resolveTeamKey gives both the ESPN spelling and BSD's. A join is unmatched when no BSD event has home = Rennes AND away = Lille
// (or the Angers / Nice pair). Three answers are possible and each is visible: BSD has no such event, it has the same game with the sides reversed or under a name
// the resolver does not know (the keys differ), or the game is on another day.
//
// CONTROL, so a silent miss cannot pass for "BSD has no event": Brest v Lyon, same day, same league, which DID join (bsd_event_id 210524, D1 row
// Ligue 1_2026-11-08_e401876410). The probe must find an event naming both clubs, and it must carry id 210524. If it does not, the reading is broken and says so.
//
// It sends no secret and writes nothing but its own outbox file. Usage: node scripts/probe-bsd-unmatched-rows-2026-11-08.mjs [--dates 2026-11-07,2026-11-08,2026-11-09]
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolveTeamKey } from '../src/identity-resolver.js'

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev'
const nameOf = t => (t && typeof t === 'object' ? t.name : t)
const ROWS = [
  { id: 'Ligue 1_2026-11-08_e401876406', home: 'Rennes', away: 'Lille', start_time: '2026-11-08T14:00Z' },
  { id: 'Ligue 1_2026-11-08_e401876412', home: 'Angers', away: 'Nice', start_time: '2026-11-08T16:15Z' },
]
const CONTROL = { id: 'Ligue 1_2026-11-08_e401876410', home: 'Brest', away: 'Lyon', start_time: '2026-11-08T16:15Z', expectBsdId: 210524 }
const NAMED = /\b(rennes|rennais|lille|losc|angers|nice|brest|lyon|lyonnais)\b/i

const iA = process.argv.indexOf('--dates')
const dates = iA > 0 ? process.argv[iA + 1].split(',') : ['2026-11-07', '2026-11-08', '2026-11-09']
const out = { at: new Date().toISOString(), relay: RELAY, days: {} }
const all = []
for (const day of dates) {
  const events = []
  let pages = 0, status = null, complete = false
  for (let page = 0; page < 12; page++) {
    const r = await fetch(`${RELAY}/bsd/events/by-date?date=${day}&offset=${page * 50}&limit=50`, { signal: AbortSignal.timeout(30_000) })
    status = r.status
    if (!r.ok) break
    const body = await r.json()
    pages++
    if (!Array.isArray(body.results)) break
    events.push(...body.results)
    if (body.results.length < 50 || (typeof body.count === 'number' && events.length >= body.count)) { complete = true; break }
  }
  const hits = events.filter(e => NAMED.test(String(nameOf(e.home_team))) || NAMED.test(String(nameOf(e.away_team))))
    .map(e => ({ id: e.id, home: nameOf(e.home_team), away: nameOf(e.away_team), homeKey: resolveTeamKey(nameOf(e.home_team)), awayKey: resolveTeamKey(nameOf(e.away_team)), event_date: e.event_date, status: e.status ?? null }))
  out.days[day] = { httpStatus: status, pages, eventsRead: events.length, complete, hits }
  all.push(...hits.map(h => ({ ...h, day })))
  console.log(`${day}  HTTP ${status}  ${events.length} events over ${pages} page(s), ${complete ? 'complete' : 'NOT COMPLETE'}`)
  for (const h of hits) console.log(`   ${h.id}  ${h.home} v ${h.away}  [${h.homeKey} v ${h.awayKey}]  ${h.event_date}  ${h.status}`)
}
// For each row: would the join's test (home key AND away key, either order) match any event BSD serves for the days read?
const verdict = (row) => {
  const hk = resolveTeamKey(row.home), ak = resolveTeamKey(row.away)
  const same = all.filter(h => h.homeKey === hk && h.awayKey === ak)
  const rev = all.filter(h => h.homeKey === ak && h.awayKey === hk)
  const either = all.filter(h => [h.homeKey, h.awayKey].some(k => k === hk || k === ak))
  return { row: row.id, home: row.home, away: row.away, homeKey: hk, awayKey: ak, sameSides: same, reversedSides: rev, anyEventNamingEitherClub: either.map(h => `${h.id} ${h.home} v ${h.away} ${h.event_date} [${h.homeKey} v ${h.awayKey}]`) }
}
out.rows = ROWS.map(verdict)
out.control = { ...verdict(CONTROL), expectBsdId: CONTROL.expectBsdId }
out.control.found = out.control.sameSides.some(h => h.id === CONTROL.expectBsdId)
out.coverage = `${dates.length} day(s) read in full pages of 50 via /bsd/events/by-date; only events naming Rennes, Lille, Angers, Nice, Brest or Lyon are listed; the join's own key test is applied to them`
for (const v of out.rows) console.log(`ROW ${v.home} v ${v.away} [${v.homeKey} v ${v.awayKey}]: same sides ${v.sameSides.length}, reversed ${v.reversedSides.length}${v.sameSides.length ? '  -> an event BSD serves SHOULD join this row: ' + v.sameSides.map(h => h.id + ' ' + h.event_date).join(', ') : v.reversedSides.length ? '  -> only with the sides reversed' : '  -> NO event has both clubs'}`)
console.log(`CONTROL ${CONTROL.home} v ${CONTROL.away}: ${out.control.found ? 'FOUND event ' + CONTROL.expectBsdId + ' (the reading works)' : 'NOT FOUND: the reading is broken, so nothing above says BSD lacks an event'}`)
console.log(`COVERAGE: ${out.coverage}`)
mkdirSync('outbox', { recursive: true })
writeFileSync(`outbox/probe-bsd-unmatched-rows-${out.at.replace(/[:.]/g, '-')}.json`, JSON.stringify(out, null, 2))
