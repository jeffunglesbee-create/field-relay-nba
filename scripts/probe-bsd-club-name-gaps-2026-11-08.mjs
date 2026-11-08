// Which archive club names would the BSD join fail to match, BEFORE a fixture exposes it?
//
// The join (src/bsd-game-join.js joinGameToBsd) matches a row to a BSD event when resolveTeamKey(archive home) = resolveTeamKey(BSD home) AND the same for
// away. A club whose archive spelling and BSD spelling have different keys can never join. Two such gaps were found one at a time by unmatched rows
// (AJ Auxerre, 2026-11-07; LOSC Lille and OGC Nice, 2026-11-08). This reads the other direction: every club name the archive holds for the five leagues the
// join covers with a BSD league (outbox/archive-club-names-2026-11-08.json, from D1) against every team name BSD serves for the three UTC days in which every
// one of those clubs played (2026-11-06 to 2026-11-08: each club's last archive date is one of the three, except "Man United", renamed "Man Utd" in the archive on
// the 8th). A club whose key is in no BSD event of those days is listed with the BSD names that share a word with it.
//
// CONTROLS, so a silent miss cannot pass for "no gap": POSITIVE Brest (joined on 2026-11-08, event 210524) must be found; NEGATIVE a name no club has must NOT be.
// If either is wrong the reading is broken and the script exits non-zero with that said first.
//
// It sends no secret and writes nothing but its own outbox file. BSD is read through the relay's public /bsd/events/by-date route (the join's own cache key),
// pages of 50, sequentially: about 15 requests for the three days.
// Usage: node scripts/probe-bsd-club-name-gaps-2026-11-08.mjs [--dates 2026-11-06,2026-11-07,2026-11-08]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolveTeamKey } from '../src/identity-resolver.js'

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev'
const nameOf = t => (t && typeof t === 'object' ? t.name : t)
const archive = JSON.parse(readFileSync(new URL('../outbox/archive-club-names-2026-11-08.json', import.meta.url), 'utf8'))
const iA = process.argv.indexOf('--dates')
const dates = iA > 0 ? process.argv[iA + 1].split(',') : ['2026-11-06', '2026-11-07', '2026-11-08']
const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const bsd = new Map()            // key -> Set of BSD spellings
const out = { at: new Date().toISOString(), relay: RELAY, days: {}, eventKeysOfFirst: null }
let eventsRead = 0, firstEvent = null, allComplete = true
for (const day of dates) {
  let n = 0, pages = 0, status = null, complete = false
  for (let page = 0; page < 12; page++) {
    const r = await fetch(`${RELAY}/bsd/events/by-date?date=${day}&offset=${page * 50}&limit=50`, { signal: AbortSignal.timeout(30_000) })
    status = r.status
    if (!r.ok) break
    const body = await r.json()
    pages++
    if (!Array.isArray(body.results)) break
    for (const e of body.results) {
      n++
      firstEvent ??= e
      for (const side of [e.home_team, e.away_team]) {
        const nm = nameOf(side); if (!nm) continue
        const k = resolveTeamKey(nm)
        if (!bsd.has(k)) bsd.set(k, new Set())
        bsd.get(k).add(String(nm))
      }
    }
    if (body.results.length < 50 || (typeof body.count === 'number' && n >= body.count)) { complete = true; break }
  }
  allComplete &&= complete
  eventsRead += n
  out.days[day] = { httpStatus: status, pages, events: n, complete }
  console.log(`${day}  HTTP ${status}  ${n} events over ${pages} page(s), ${complete ? 'complete' : 'NOT COMPLETE'}`)
}
out.eventKeysOfFirst = firstEvent ? Object.keys(firstEvent) : null
const bsdNames = [...new Set([...bsd.values()].flatMap(s => [...s]))]

const check = (name) => {
  const key = resolveTeamKey(name)
  if (bsd.has(key)) return { name, key, matched: true, bsdSpellings: [...bsd.get(key)] }
  const words = fold(name).split(/[^a-z0-9]+/).filter(w => w.length >= 4)
  const candidates = bsdNames.filter(b => { const f = fold(b); return words.some(w => f.includes(w)) })
  return { name, key, matched: false, candidates: candidates.slice(0, 8) }
}
const control = { positive: check('Brest'), negative: check('Zzyzx Rovers') }
const controlOk = control.positive.matched === true && control.negative.matched === false
console.log(`CONTROL positive Brest: ${control.positive.matched ? 'FOUND ' + control.positive.bsdSpellings.join(' | ') : 'NOT FOUND'}; negative "Zzyzx Rovers": ${control.negative.matched ? 'FOUND (the reading matches anything)' : 'not found (as it must be)'}`)
if (!controlOk || !allComplete || eventsRead === 0) {
  console.log('THE READING IS BROKEN (control or paging failed); nothing below says anything about gaps.')
  out.broken = true
}
out.control = control
out.leagues = {}
let total = 0, matched = 0
const gaps = []
for (const [sport, names] of Object.entries(archive.sports)) {
  const rows = names.map(check)
  total += rows.length; matched += rows.filter(r => r.matched).length
  out.leagues[sport] = { clubs: rows.length, matched: rows.filter(r => r.matched).length, unmatched: rows.filter(r => !r.matched) }
  for (const r of rows.filter(r => !r.matched)) gaps.push({ sport, ...r })
}
out.coverage = `${total} archive club names (${Object.keys(archive.sports).join(', ')}) checked against ${bsd.size} distinct BSD team keys from ${eventsRead} events over ${dates.length} day(s) (${dates.join(', ')}), every page of 50 read (${allComplete ? 'all complete' : 'NOT ALL COMPLETE'}); BSD events of every sport are in the set, so a match is by key only and a match against another sport's club would hide a gap`
out.summary = { total, matched, unmatched: gaps.length }
for (const g of gaps) console.log(`UNMATCHED ${g.sport}: ${g.name} [${g.key}]  BSD names sharing a word: ${g.candidates.length ? g.candidates.join(' | ') : '(none)'}`)
console.log(`SUMMARY ${matched} of ${total} archive clubs have a BSD team under the same key; ${gaps.length} unmatched`)
console.log(`COVERAGE: ${out.coverage}`)
mkdirSync('outbox', { recursive: true })
writeFileSync(`outbox/probe-bsd-club-name-gaps-${out.at.replace(/[:.]/g, '-')}.json`, JSON.stringify(out, null, 2))
if (out.broken) process.exit(1)
