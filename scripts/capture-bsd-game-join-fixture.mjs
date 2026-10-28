// The offline corpus for the BSD game join (docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md, Task 1).
//
// Captures, from the DEPLOYED relay and on a runner (the authoring sandbox cannot reach *.workers.dev):
//   * the soccer rows of /context/date/{date}, every column as served, for each date;
//   * the BSD events of /bsd/events/by-date for that UTC day AND the following one, all pages.
// A join rule is then developed against this file, not against the live route: a matcher developed live
// is paid for in upstream calls (docs/CC-CMD-2026-09-16 session: "a fixture of both sides was captured so
// a matcher could be developed offline").
//
// WHY BOTH UTC DAYS. /bsd/events/by-date takes a UTC day. A late US game kicks off at 00:30Z to 02:30Z, the NEXT
// UTC day, so asking for the context date alone never returns it (measured by field-laboratory's probe,
// 2026-10-26: 14 of 93 soccer games).
//
// COVERAGE IS PRINTED WITH THE RESULT (Rule 91): rows, events and pages, per date, and in the artifact.
//
// Usage:  node scripts/capture-bsd-game-join-fixture.mjs --self-test
//         node scripts/capture-bsd-game-join-fixture.mjs [--dates 2026-08-29,2026-09-05]

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev'
export const SOCCER = ['MLS', 'EPL', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1']
export const PAGE = 50
export const MAX_PAGES = 12
export const KEEP = ['id', 'league_id', 'season_id', 'home_team_id', 'home_team', 'away_team_id', 'away_team', 'event_date', 'status', 'stage']

/** Where the fixture is written. The DEFAULT is the file the offline check and the mutation harness read, and it
 *  must stay the default: a second capture of other dates (docs/CC-CMD-2026-10-28-bsd-join-aliases-beyond-the-
 *  fixture-dates.md) names its own file with `--out`, or it would replace the two-date fixture the join's
 *  checks stand on. */
export const DEFAULT_OUT = 'outbox/fixture-bsd-game-join-2026-08-29-09-05.json'
export const outPathOf = argv => { const i = argv.indexOf('--out'); return i > 0 && argv[i + 1] ? argv[i + 1] : DEFAULT_OUT }

export const nextDay = date => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)

/** All pages of one UTC day. `getJson` is injected so the loop can be tested with no network. */
export async function pagedEvents(getJson, day) {
  const events = []
  let pages = 0, count = null
  for (let i = 0; i < MAX_PAGES; i++) {
    const body = await getJson(`${RELAY}/bsd/events/by-date?date=${day}&limit=${PAGE}&offset=${i * PAGE}`)
    const rows = body.results
    if (!Array.isArray(rows)) throw new Error(`${RELAY}/bsd/events/by-date for ${day}: not a page (no results array); refusing to read it as an empty day`)
    pages++
    if (count === null && typeof body.count === 'number') count = body.count
    events.push(...rows)
    if (rows.length < PAGE) break
    if (count !== null && events.length >= count) break
  }
  return { events, pages, count, truncated: pages === MAX_PAGES && (count === null || events.length < count) }
}

export const slim = e => Object.fromEntries(KEEP.map(k => [k, e[k] ?? null]))

const getJson = async url => {
  const res = await fetch(url, { headers: { 'User-Agent': 'field-relay-nba capture-bsd-game-join-fixture' } })
  const text = await res.text()
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}: ${text.slice(0, 160)}`)
  return JSON.parse(text)
}

export async function captureDate(get, date) {
  const ctx = await get(`${RELAY}/context/date/${date}`)
  const all = [...(ctx.games?.regular || []), ...(ctx.games?.postseason || [])]
  const rows = all.filter(g => SOCCER.includes(g.sport))
  const days = [date, nextDay(date)]
  const events = {}, counts = {}
  for (const day of days) {
    const r = await pagedEvents(get, day)
    events[day] = r.events.map(slim)
    counts[day] = { fetched: r.events.length, pages: r.pages, bsdCount: r.count, truncated: r.truncated }
  }
  return {
    date, rowColumns: rows[0] ? Object.keys(rows[0]) : [], contextRows: all.length, rows,
    events, counts,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    let bad = 0
    const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`); if (!ok) bad++ }
    const mk = n => Array.from({ length: n }, (_, i) => ({ id: i }))
    const pagesOf = (total, withCount = true) => async url => {
      const off = Number(new URL(url).searchParams.get('offset'))
      return { count: withCount ? total : undefined, results: mk(Math.max(0, Math.min(PAGE, total - off))) }
    }
    const a = await pagedEvents(pagesOf(120), '2026-09-05')
    check('120 events are fetched over 3 pages', a.events.length === 120 && a.pages === 3 && !a.truncated, JSON.stringify([a.events.length, a.pages]))
    const b = await pagedEvents(pagesOf(100), '2026-09-05')
    check('exactly 100 events stop at the count, not one page later', b.events.length === 100 && b.pages === 2, JSON.stringify([b.events.length, b.pages]))
    const c = await pagedEvents(pagesOf(5000), '2026-09-05')
    check('an unbounded day is cut at the page cap and says it was truncated', c.pages === MAX_PAGES && c.truncated === true, JSON.stringify([c.pages, c.truncated]))
    const d = await pagedEvents(pagesOf(120, false), '2026-09-05')
    check('with no count in the response, a short page is what stops the loop', d.events.length === 120 && d.pages === 3 && !d.truncated, JSON.stringify([d.events.length, d.pages]))
    check('nextDay crosses a month end', nextDay('2026-08-31') === '2026-09-01', nextDay('2026-08-31'))
    check('slim keeps the ten named fields and drops the rest', Object.keys(slim({ id: 1, head_to_head: { x: 1 } })).length === KEEP.length && !('head_to_head' in slim({ id: 1, head_to_head: 1 })), '')
    check('with no --out the fixture the join checks read is the file written', outPathOf(['node', 'x']) === 'outbox/fixture-bsd-game-join-2026-08-29-09-05.json', outPathOf(['node', 'x']))
    check('--out names another file, so a second capture cannot replace the first', outPathOf(['node', 'x', '--dates', 'a', '--out', 'outbox/other.json']) === 'outbox/other.json')
    check('--out with no value falls back to the default, never to undefined', outPathOf(['node', 'x', '--out']) === DEFAULT_OUT)
    console.log(`\n${9 - bad}/9 checks passed`)
    process.exit(bad ? 1 : 0)
  }
  const i = process.argv.indexOf('--dates')
  const dates = (i > 0 ? process.argv[i + 1] : '2026-08-29,2026-09-05').split(',')
  const out = { capturedAt: new Date().toISOString(), relay: RELAY, soccerSports: SOCCER, dates: [] }
  for (const d of dates) {
    const r = await captureDate(getJson, d)
    out.dates.push(r)
    const ev = Object.values(r.counts).reduce((n, c) => n + c.fetched, 0), pg = Object.values(r.counts).reduce((n, c) => n + c.pages, 0)
    console.log(`${d}: ${r.rows.length} soccer rows of ${r.contextRows} context rows, ${ev} BSD events in ${pg} pages (${Object.entries(r.counts).map(([k, v]) => `${k} ${v.fetched}${v.truncated ? ' TRUNCATED' : ''}`).join(', ')})`)
    if (Object.values(r.counts).some(c => c.truncated)) { console.error('FAIL: a day was cut at the page cap; the fixture is incomplete'); process.exitCode = 1 }
  }
  mkdirSync('outbox', { recursive: true })
  const name = outPathOf(process.argv)
  writeFileSync(name, JSON.stringify(out) + '\n')
  console.log(`COVERAGE: ${dates.length} dates, ${out.dates.reduce((n, r) => n + r.rows.length, 0)} soccer rows, ${out.dates.reduce((n, r) => n + Object.values(r.events).reduce((m, e) => m + e.length, 0), 0)} events -> ${name}`)
}
