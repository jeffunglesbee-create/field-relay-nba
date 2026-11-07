#!/usr/bin/env node
// Does the client's `limit=30` cut an FA Cup day short, and what does ESPN say about the broadcast of each game?
//
// WHY: jubilant-bassoon fetchSoccerFixtures reads every SOCCER_LEAGUES entry from
// https://site.api.espn.com/apis/site/v2/sports/soccer/<league>/scoreboard?dates=YYYYMMDD&limit=30. The EFL Cup, the pattern the FA Cup
// entry copies, has at most about 16 ties on a day. The relay served 33 FA Cup games for 2026-11-07 (/v2/games?sport=facup&date=2026-11-07),
// so `limit=30` may drop three. And the relay served `"streams":[]` for all 33 of 2026-11-07 but ESPN+ for all 4 of 2026-11-08: the
// bundle the client attaches to every card is a static list, so what ESPN itself says per game decides whether a static `["espnplus"]` is
// true, false or partly true. Neither fact was read from the source; both were inferred. This reads them.
//
// Read-only, no secret, no relay call. A runner IP is not a Worker IP and not the client's browser: this answers what ESPN SERVES to
// a plain request with the same URL the client builds, not whether a visitor's browser is let in.
// Usage: node scripts/probe-fa-cup-scoreboard-limit.mjs [--dates 20261107,20261108]
import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.fa/scoreboard'
const HEADERS = {
  Origin: 'https://www.espn.com', Referer: 'https://www.espn.com/', Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}
const iA = process.argv.indexOf('--dates')
const dates = iA > 0 ? process.argv[iA + 1].split(',') : ['20261107', '20261108']
const out = { at: new Date().toISOString(), base: BASE, days: {} }

const names = ev => {
  const b = ev?.competitions?.[0]?.broadcasts
  return Array.isArray(b) ? b.flatMap(x => (Array.isArray(x?.names) ? x.names : [])) : null
}
for (const d of dates) {
  out.days[d] = {}
  for (const [label, qs] of [['limit=30 (the client)', `?dates=${d}&limit=30`], ['no limit', `?dates=${d}`], ['limit=100', `?dates=${d}&limit=100`]]) {
    let rec
    try {
      const r = await fetch(BASE + qs, { headers: HEADERS, signal: AbortSignal.timeout(25_000) })
      if (!r.ok) rec = { status: r.status }
      else {
        const j = await r.json()
        const evs = Array.isArray(j.events) ? j.events : null
        rec = { status: r.status, events: evs ? evs.length : null, ids: evs ? evs.map(e => e.id).sort() : null }
        if (evs) {
          const tally = {}
          for (const e of evs) { const n = names(e); const k = n === null ? '(no broadcasts array)' : n.length ? n.join(' + ') : '(empty)'; tally[k] = (tally[k] ?? 0) + 1 }
          rec.broadcastTally = tally
          rec.dates = [...new Set(evs.map(e => String(e.date).slice(0, 10)))]
          rec.statusNames = [...new Set(evs.map(e => e?.status?.type?.name))]
        }
      }
    } catch (e) { rec = { error: String(e.message || e) } }
    out.days[d][label] = rec
    console.log(`${d}  ${label.padEnd(22)} ${rec.error ? `ERROR ${rec.error}` : `HTTP ${rec.status} events=${rec.events ?? '-'}`}${rec.broadcastTally ? `  broadcasts ${JSON.stringify(rec.broadcastTally)}` : ''}`)
  }
  const a = out.days[d]['limit=30 (the client)'], b = out.days[d]['no limit'], c = out.days[d]['limit=100']
  if (a?.ids && b?.ids && c?.ids) {
    const lost = c.ids.filter(id => !a.ids.includes(id))
    out.days[d].verdict = { clientSees: a.events, espnHas100: c.events, noLimit: b.events, droppedByLimit30: lost.length, droppedIds: lost }
    console.log(`${d}  VERDICT: the client's limit=30 sees ${a.events} of ${c.events} events; dropped ${lost.length}`)
  }
}
out.coverage = `${dates.length} day(s) x 3 query shapes against site.api.espn.com eng.fa; only counts, ids and broadcast names are recorded`
console.log(`COVERAGE: ${out.coverage}`)
mkdirSync('outbox', { recursive: true })
writeFileSync(`outbox/probe-fa-cup-scoreboard-limit-${out.at.replace(/[:.]/g, '-')}.json`, JSON.stringify(out, null, 2))
