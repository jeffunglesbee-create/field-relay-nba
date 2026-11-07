#!/usr/bin/env node
// Why did the BSD join leave Auxerre v Paris FC (Ligue 1, 2026-11-07T18:00Z, row Ligue 1_2026-11-07_e401876411) unmatched
// when it joined 33 of 34 pending rows the same day (outbox/probe-bsd-join-today-2026-11-07T12-24-33-411Z.json)?
//
// The names are not the suspect: the committed BSD fixtures (outbox/fixture-bsd-game-join-*.json) carry "Auxerre" and
// "Paris FC" verbatim, and resolveTeamKey gives auxerre / parisfc for the ESPN spellings. A join is unmatched when no BSD event has
// home = Auxerre AND away = Paris FC. So this reads the events BSD itself serves for the two UTC days the join reads (the
// day and the next), through the relay's own /bsd/events/by-date route (public, same cache key as the join), and prints every
// event naming either club: id, sides IN ORDER, kickoff, status. Three answers are possible and each is visible here:
// no such event (BSD does not have the game), the same game with the sides reversed, or the game on another day.
//
// It sends no secret and writes nothing. Usage: node scripts/probe-bsd-unmatched-row.mjs [--dates 2026-11-06,2026-11-07,2026-11-08]
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolveTeamKey } from '../src/identity-resolver.js'

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev'
const nameOf = t => (t && typeof t === 'object' ? t.name : t)
const NAMED = /auxerre|paris fc/i

const iA = process.argv.indexOf('--dates')
const dates = iA > 0 ? process.argv[iA + 1].split(',') : ['2026-11-06', '2026-11-07', '2026-11-08']
const out = { at: new Date().toISOString(), relay: RELAY, days: {} }
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
  console.log(`${day}  HTTP ${status}  ${events.length} events over ${pages} page(s), ${complete ? 'complete' : 'NOT COMPLETE'}`)
  for (const h of hits) console.log(`   ${h.id}  ${h.home} v ${h.away}  [${h.homeKey} v ${h.awayKey}]  ${h.event_date}  ${h.status}`)
  if (!hits.length) console.log('   (no event names Auxerre or Paris FC)')
}
out.row = { home: 'Auxerre', away: 'Paris FC', homeKey: resolveTeamKey('Auxerre'), awayKey: resolveTeamKey('Paris FC'), start_time: '2026-11-07T18:00Z' }
out.coverage = `${dates.length} day(s) read in full pages of 50 via /bsd/events/by-date; only events naming Auxerre or Paris FC are listed`
console.log(`row keys: ${out.row.homeKey} v ${out.row.awayKey}\nCOVERAGE: ${out.coverage}`)
mkdirSync('outbox', { recursive: true })
writeFileSync(`outbox/probe-bsd-unmatched-row-${out.at.replace(/[:.]/g, '-')}.json`, JSON.stringify(out, null, 2))
