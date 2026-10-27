// The live proof of the BSD game join, against the DEPLOYED relay and on a runner
// (docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md, Task 6 and the done condition). Writes
// outbox/bsd-game-join-live-latest.json.
//
// IT RUNS THE BACKFILL, THEN READS WHAT A CONSUMER READS: POST /admin/bsd-game-join for each date, then
// GET /context/date/{date}. The assertions are over the served rows, not over the function's own return value, so the
// writer cannot mark its own work.
//
// Needs RELAY_SHARED_SECRET in the environment, with NO default (an unset secret must fail loudly, not 401 quietly).
//
// Usage:  node scripts/check-bsd-game-join-live.mjs [--dates 2026-08-29,2026-09-05]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { joinGameToBsd, BSD_SOCCER_SPORTS, BSD_KICKOFF_REFUSE_MINUTES } from '../src/bsd-game-join.js'
import { ORACLE } from './lib/bsd-game-join-oracle.mjs'

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev'
const FLOOR = 0.90

export async function run({ relay, secret, dates, fx, log = console.log }) {
  const eventById = new Map(fx.dates.flatMap(d => Object.values(d.events).flat()).map(e => [String(e.id), e]))
  const post = async date => {
    const r = await fetch(`${relay}/admin/bsd-game-join`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': secret }, body: JSON.stringify({ date }) })
    const text = await r.text()
    let body = null
    try { body = JSON.parse(text) } catch (e) { body = { ok: false, raw: text.slice(0, 200), parseError: e.message } }
    return { status: r.status, ...body }
  }
  const context = async date => { const r = await fetch(`${relay}/context/date/${date}`); if (!r.ok) throw new Error(`context ${date}: HTTP ${r.status}`); return r.json() }

  const checks = []
  const check = (name, pass, detail = '') => { checks.push({ name, pass, detail }); log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : '\n      -> ' + detail}`) }

  const out = { measuredAt: new Date().toISOString(), relay, dates: {}, assertions: [] }
  const allRows = []
  for (const date of dates) {
    const first = await post(date)
    const ctx = await context(date)
    const second = await post(date)
    const rows = [...(ctx.games?.regular || []), ...(ctx.games?.postseason || [])]
    const soccer = rows.filter(r => BSD_SOCCER_SPORTS.includes(r.sport))
    const joined = soccer.filter(r => r.bsd_event_id)
    const notJoined = soccer.filter(r => !r.bsd_event_id)
    allRows.push(...rows.map(r => ({ ...r, _date: date })))
    out.dates[date] = {
      contextRows: rows.length, soccerRows: soccer.length, joined: joined.length, notJoined: notJoined.map(r => ({ id: r.id, sport: r.sport, game: `${r.home} v ${r.away}`, start_time: r.start_time })),
      firstRun: { status: first.status, ok: first.ok, pending: first.pending, written: first.written, ambiguous: first.ambiguous, refusedKickoff: first.refusedKickoff, unjudgedKickoff: first.unjudgedKickoff, upstreamPages: first.upstreamPages, cacheHits: first.cacheHits, unmatched: first.unmatched, reason: first.reason },
      secondRun: { status: second.status, ok: second.ok, pending: second.pending, written: second.written },
    }
    check(`${date}: the backfill answered ok`, first.ok === true && second.ok === true, `first ${JSON.stringify({ s: first.status, r: first.reason || first.raw })}, second ${JSON.stringify({ s: second.status, r: second.reason || second.raw })}`)
    check(`${date}: joined ${joined.length} of ${soccer.length} soccer rows is at least ${FLOOR * 100}% (every other row named in the artifact)`, soccer.length > 0 && joined.length / soccer.length >= FLOOR, `${joined.length}/${soccer.length}; not joined: ${notJoined.slice(0, 6).map(r => `${r.home} v ${r.away}`).join('; ')}`)
    check(`${date}: a second run writes nothing (the IS NULL scope holds)`, second.written === 0, `second run wrote ${second.written}`)
  }

  // The oracle, 12 of 12 or the absent ones NAMED.
  const byId = new Map(allRows.map(r => [r.id, r]))
  const present = ORACLE.filter(([id]) => byId.has(id)), absent = ORACLE.filter(([id]) => !byId.has(id))
  const wrong = present.filter(([id, ev]) => String(byId.get(id).bsd_event_id) !== String(ev))
  out.oracle = { fixed: ORACLE.length, present: present.length, absent: absent.map(a => a[0]), wrong: wrong.map(([id, ev]) => ({ id, wanted: ev, got: byId.get(id).bsd_event_id })) }
  check(`the oracle pairs present in the live archive carry their fixed event id (${present.length} of ${ORACLE.length} present)`, present.length >= 9 && wrong.length === 0, JSON.stringify(out.oracle.wrong))
  if (absent.length) log(`      absent from the live archive, named: ${absent.map(a => a[0]).join(', ')}`)

  // Shared ids: two rows may share one only when each, joined on its own to that event, still joins (the same fixture written twice).
  {
    const groups = new Map()
    for (const r of allRows) if (r.bsd_event_id) (groups.get(String(r.bsd_event_id)) || groups.set(String(r.bsd_event_id), []).get(String(r.bsd_event_id))).push(r)
    const bad = []
    let shared = 0
    for (const [id, rs] of groups) {
      if (rs.length > 1) shared++
      const ev = eventById.get(id)
      if (!ev) continue
      for (const r of rs) if (joinGameToBsd(r, [ev]).how !== 'joined') bad.push(`${r.id} -> ${id}`)
    }
    out.sharedEvents = shared
    check(`every joined row names the teams of its event, in order (events shared by two rows: ${shared})`, bad.length === 0, bad.slice(0, 5).join('; '))
  }

  // Kickoff: every joined row with a start_time is within the refusal; the unjudged are counted, not passed.
  {
    let judged = 0, unjudged = 0; const far = []
    for (const r of allRows) {
      if (!r.bsd_event_id) continue
      const ev = eventById.get(String(r.bsd_event_id))
      if (!ev || !r.start_time) { unjudged++; continue }
      judged++
      const gap = Math.abs(Date.parse(r.start_time) - Date.parse(ev.event_date)) / 60000
      if (gap > BSD_KICKOFF_REFUSE_MINUTES) far.push(`${r.id} ${gap} min`)
    }
    out.kickoff = { judged, unjudged, far }
    check(`every joined row with a start_time is within ${BSD_KICKOFF_REFUSE_MINUTES} minutes of its event (${judged} judged, ${unjudged} UNJUDGED and counted, not a pass)`, far.length === 0, far.join('; '))
  }

  // Soccer only, and the contract changed by exactly one field.
  {
    const nonSoccerWithId = allRows.filter(r => !BSD_SOCCER_SPORTS.includes(r.sport) && r.bsd_event_id)
    out.nonSoccerRowsCarryingAnId = nonSoccerWithId.length
    check(`no row of another sport carries a bsd_event_id (${allRows.filter(r => !BSD_SOCCER_SPORTS.includes(r.sport)).length} non-soccer rows read)`, nonSoccerWithId.length === 0, nonSoccerWithId.slice(0, 5).map(r => `${r.sport} ${r.id}`).join('; '))
    const want = new Set([...fx.dates[0].rowColumns, 'bsd_event_id'])
    const odd = allRows.filter(r => { const ks = Object.keys(r).filter(k => k !== '_date'); return ks.length !== want.size || ks.some(k => !want.has(k)) })
    const gotUnion = new Set(allRows.flatMap(r => Object.keys(r).filter(k => k !== '_date')))
    const missing = [...want].filter(k => !gotUnion.has(k)), extra = [...gotUnion].filter(k => !want.has(k))
    out.contract = { fixtureColumns: fx.dates[0].rowColumns.length, servedColumnsUnion: gotUnion.size, rowsWithADifferentKeySet: odd.length, missing, extra }
    check('every served row\'s key set is the fixture\'s key set plus bsd_event_id, compared by name', odd.length === 0 && missing.length === 0 && extra.length === 0, `${odd.length} rows differ; missing ${JSON.stringify(missing)}, extra ${JSON.stringify(extra)}`)
  }

  out.assertions = checks
  out.coverage = `${dates.length} dates, ${allRows.length} context rows read, ${allRows.filter(r => BSD_SOCCER_SPORTS.includes(r.sport)).length} soccer rows, ${allRows.filter(r => r.bsd_event_id).length} carrying an id`
  return { out, checks }
}

// ---- the self-test: the live assertions, aimed at a local stub, each broken on purpose ------------------------------------
async function selfTest() {
  const { joinBatch, eventDaysFor } = await import('../src/bsd-game-join.js')
  const fx = JSON.parse(readFileSync('outbox/fixture-bsd-game-join-2026-08-29-09-05.json', 'utf8'))
  const cols = [...fx.dates[0].rowColumns, 'bsd_event_id']
  const mk = mode => {
    const rows = new Map(), state = { posts: new Map() }
    for (const d of fx.dates) {
      const events = eventDaysFor(d.date).flatMap(day => d.events[day] || [])
      const { results } = joinBatch(d.rows, events)
      const list = d.rows.map((r, i) => ({ ...Object.fromEntries(cols.map(c => [c, null])), ...r, bsd_event_id: null, _pending: results[i].bsd_event_id }))
      list.push({ ...Object.fromEntries(cols.map(c => [c, null])), id: `MLB_${d.date}_x`, sport: 'MLB', date: d.date, home: 'A', away: 'B', bsd_event_id: null })
      rows.set(d.date, list)
    }
    if (mode === 'dropColumn') for (const l of rows.values()) for (const r of l) delete r.bsd_event_id
    return createServer(async (req, res) => {
      const u = new URL(req.url, 'http://x')
      if (req.method === 'POST') {
        let body = ''; for await (const c of req) body += c
        const date = JSON.parse(body).date, list = rows.get(date), n = state.posts.has(date) ? state.posts.get(date) + 1 : 1
        state.posts.set(date, n)
        let written = 0
        for (const r of list) if (r._pending && r.bsd_event_id == null) { r.bsd_event_id = r._pending; written++ }
        if (n > 1 && mode === 'secondWrites') written = 1
        res.end(JSON.stringify({ ok: true, date, pending: list.filter(r => r.bsd_event_id == null).length, written, unmatched: [] })); return
      }
      const date = u.pathname.split('/').pop(), list = rows.get(date)
      const served = list.map(r => { const { _pending, ...rest } = r; return { ...rest } })
      if (mode === 'wrongOracle') { const o = served.find(r => r.id === '2026-08-29-mls-stl-dal'); if (o) o.bsd_event_id = '1' }
      if (mode === 'nonSoccerId') served.find(r => r.sport === 'MLB').bsd_event_id = '5229'
      if (mode === 'lowCoverage') served.forEach((r, i) => { if (r.sport !== 'MLB' && i % 2) r.bsd_event_id = null })
      if (mode === 'farKickoff') { const far = fx.dates[1].events[Object.keys(fx.dates[1].events)[0]].find(e => Date.parse(e.event_date) > Date.parse('2026-09-05T20:00Z')); const j = served.find(r => r.bsd_event_id && r.start_time); if (j && far) j.bsd_event_id = String(far.id) }
      if (mode === 'extraColumn') served.forEach(r => { r.surprise = 1 })
      res.end(JSON.stringify({ ok: true, date, games: { regular: served, postseason: [] } }))
    })
  }
  let bad = 0
  const expectations = [
    ['good', null], ['wrongOracle', 'the oracle pairs'], ['nonSoccerId', 'no row of another sport'], ['secondWrites', 'a second run writes nothing'],
    ['dropColumn', 'every served row'], ['extraColumn', 'every served row'], ['lowCoverage', 'at least 90%'], ['farKickoff', 'within'],
  ]
  for (const [mode, expectRed] of expectations) {
    const srv = mk(mode); await new Promise(r => srv.listen(0, r))
    const relay = `http://127.0.0.1:${srv.address().port}`
    const { checks } = await run({ relay, secret: 'x', dates: fx.dates.map(d => d.date), fx, log: () => {} })
    srv.close()
    const reds = checks.filter(c => !c.pass).map(c => c.name)
    const ok = expectRed === null ? reds.length === 0 : reds.some(n => n.includes(expectRed))
    console.log(`${ok ? 'PASS' : 'FAIL'}  stub mode ${mode.padEnd(13)} ${expectRed === null ? 'every live assertion holds' : `turns "${expectRed}" red`}${ok ? '' : `   (red: ${JSON.stringify(reds)})`}`)
    if (!ok) bad++
  }
  console.log(`\n${expectations.length - bad}/${expectations.length} self-test modes behaved`)
  process.exit(bad ? 1 : 0)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) await selfTest()
  const secret = process.env.RELAY_SHARED_SECRET
  if (!secret) { console.error('FAIL: RELAY_SHARED_SECRET is not set'); process.exit(2) }
  const fx = JSON.parse(readFileSync('outbox/fixture-bsd-game-join-2026-08-29-09-05.json', 'utf8'))
  const i = process.argv.indexOf('--dates')
  const dates = i > 0 ? process.argv[i + 1].split(',') : fx.dates.map(d => d.date)
  const { out, checks } = await run({ relay: RELAY, secret, dates, fx })
  mkdirSync('outbox', { recursive: true })
  writeFileSync('outbox/bsd-game-join-live-latest.json', JSON.stringify(out, null, 2) + '\n')
  const failed = checks.filter(c => !c.pass)
  console.log(`\nCOVERAGE: ${out.coverage}`)
  console.log(`${checks.length - failed.length}/${checks.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}
