// The live proof of the nine alias pairs (docs/CC-CMD-2026-10-28-bsd-join-aliases-beyond-the-fixture-dates.md, Task 4),
// against the DEPLOYED relay and on a runner. Writes outbox/bsd-game-join-aliases-live-latest.json.
//
// It runs the backfill for each date, then reads what a consumer reads: POST /admin/bsd-game-join, GET /context/date/{date},
// POST again. The assertions are over the SERVED rows, not over the function's return value, so the writer cannot mark its
// own work. The expectation for the rows the aliases were added for comes from outbox/bsd-join-aliases-measure-before.json
// (see scripts/lib/bsd-join-aliases-oracle.mjs): a measurement taken before any pair existed, which the rule did not make.
//
// Needs RELAY_SHARED_SECRET in the environment, with NO default (an unset secret must fail loudly, not 401 quietly).
//
// Usage:  node scripts/check-bsd-game-join-aliases-live.mjs --self-test
//         RELAY_SHARED_SECRET=... node scripts/check-bsd-game-join-aliases-live.mjs [--dates 2026-10-10,2026-09-12]
//                                  [--fixture FILE] [--out FILE]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { joinGameToBsd, joinBatch, eventDaysFor, BSD_SOCCER_SPORTS } from '../src/bsd-game-join.js'
import { EXPECT, DERIVED_FROM } from './lib/bsd-join-aliases-oracle.mjs'

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev'
const FIXTURE = 'outbox/fixture-bsd-game-join-more-dates.json'
const OUT = 'outbox/bsd-game-join-aliases-live-latest.json'
const FLOOR = 0.90
const scheme = id => (/_e\d+$/.test(id) ? 'espn' : 'slug')

const rowsOf = (ctx, date) => {
  const g = ctx?.games
  if (!g || !Array.isArray(g.regular) || !Array.isArray(g.postseason)) throw new Error(`context ${date}: games.regular / games.postseason are not both arrays`)
  return [...g.regular, ...g.postseason]
}

export async function run({ relay, secret, dates, fx, log = console.log }) {
  const eventById = new Map(fx.dates.flatMap(d => Object.values(d.events).flat()).map(e => [String(e.id), e]))
  // What the rule, run offline on the fixture's own rows and events, says each row should carry. This is the rule agreeing with
  // itself across the deploy boundary: it proves the deployed relay runs THIS resolver. The independent expectation is EXPECT.
  const offline = new Map()
  for (const d of fx.dates) {
    const events = eventDaysFor(d.date).flatMap(day => d.events[day] ?? [])
    const { results } = joinBatch(d.rows, events)
    d.rows.forEach((r, i) => offline.set(r.id, results[i].bsd_event_id === null ? null : String(results[i].bsd_event_id)))
  }
  const post = async date => {
    const r = await fetch(`${relay}/admin/bsd-game-join`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': secret }, body: JSON.stringify({ date }) })
    const text = await r.text()
    let body
    try { body = JSON.parse(text) } catch (e) { body = { ok: false, raw: text.slice(0, 200), parseError: e.message } }
    return { status: r.status, ...body }
  }
  const context = async date => { const r = await fetch(`${relay}/context/date/${date}`); if (!r.ok) throw new Error(`context ${date}: HTTP ${r.status}`); return r.json() }

  const checks = []
  const check = (name, pass, detail = '') => { checks.push({ name, pass, detail }); log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : '\n      -> ' + detail}`) }
  const out = { measuredAt: new Date().toISOString(), relay, expectationFrom: DERIVED_FROM, dates: {}, assertions: [] }
  const all = []

  for (const date of dates) {
    const first = await post(date)
    const ctx = await context(date)
    const second = await post(date)
    const rows = rowsOf(ctx, date)
    const soccer = rows.filter(r => BSD_SOCCER_SPORTS.includes(r.sport))
    const joined = soccer.filter(r => r.bsd_event_id)
    const byLabel = {}
    for (const s of BSD_SOCCER_SPORTS) { const of = soccer.filter(r => r.sport === s); byLabel[s] = { joined: of.filter(r => r.bsd_event_id).length, soccer: of.length } }
    all.push(...rows.map(r => ({ ...r, _date: date })))
    const before = EXPECT.beforeJoined[date]
    out.dates[date] = {
      contextRows: rows.length, soccerRows: soccer.length, joined: joined.length, joinedBeforeAliases: before ? before.joined : null, byLabel,
      notJoined: soccer.filter(r => !r.bsd_event_id).map(r => ({ id: r.id, sport: r.sport, game: `${r.home} v ${r.away}` })),
      firstRun: { status: first.status, ok: first.ok, pending: first.pending, written: first.written, ambiguous: first.ambiguous, refusedKickoff: first.refusedKickoff, unjudgedKickoff: first.unjudgedKickoff, upstreamPages: first.upstreamPages, cacheHits: first.cacheHits, unmatched: first.unmatched, reason: first.reason },
      secondRun: { status: second.status, ok: second.ok, pending: second.pending, written: second.written },
    }
    const label = Object.entries(byLabel).map(([k, v]) => `${k} ${v.joined}/${v.soccer}`).join(', ')
    log(`      ${date}: joined ${joined.length} of ${soccer.length} soccer rows (${label}); before the aliases ${before ? before.joined : 'unknown'}`)
    check(`${date}: the backfill answered ok, twice`, first.ok === true && second.ok === true, `first ${JSON.stringify({ s: first.status, r: first.reason ?? first.raw })}, second ${JSON.stringify({ s: second.status, r: second.reason ?? second.raw })}`)
    check(`${date}: joined ${joined.length} of ${soccer.length} soccer rows is at least ${FLOOR * 100}%`, soccer.length > 0 && joined.length / soccer.length >= FLOOR, `${joined.length}/${soccer.length}`)
    check(`${date}: a second run writes nothing (the IS NULL scope holds)`, second.written === 0, `second run wrote ${second.written}`)
  }

  // The rows the aliases were added for, against the measurement that named them.
  const byId = new Map(all.map(r => [r.id, r]))
  const expectGroup = (title, list) => {
    const inScope = list.filter(e => dates.includes(e.date))
    const absent = inScope.filter(e => !byId.has(e.rowId))
    const wrong = inScope.filter(e => byId.has(e.rowId) && String(byId.get(e.rowId).bsd_event_id) !== e.eventId)
    const right = inScope.length - absent.length - wrong.length
    check(`${title}: ${right} of ${inScope.length} carry the event the measurement named (${absent.length} absent from the served context, ${wrong.length} wrong or unjoined)`,
      inScope.length > 0 && absent.length === 0 && wrong.length === 0,
      [...absent.map(e => `ABSENT ${e.rowId} (${e.game})`), ...wrong.map(e => `${e.rowId} (${e.game}) wanted ${e.eventId}, got ${byId.get(e.rowId).bsd_event_id}`)].slice(0, 8).join('; '))
    return { inScope: inScope.length, right, absent: absent.map(e => e.rowId), wrong: wrong.map(e => ({ id: e.rowId, wanted: e.eventId, got: byId.get(e.rowId).bsd_event_id })) }
  }
  out.proposals = expectGroup('proposals (both sides named a club BSD spells differently)', EXPECT.proposals)
  out.oneSide = expectGroup('one-side-only (the other side now an alias)', EXPECT.oneSide)
  {
    const inScope = EXPECT.noEvent.filter(e => dates.includes(e.date))
    const present = inScope.filter(e => byId.has(e.rowId))
    const carrying = present.filter(e => byId.get(e.rowId).bsd_event_id)
    out.noEvent = { inScope: inScope.length, present: present.length, carryingAnId: carrying.map(e => ({ id: e.rowId, got: byId.get(e.rowId).bsd_event_id })) }
    check(`no-event (BSD has no event for the game): ${present.length - carrying.length} of ${inScope.length} still carry no id, ${inScope.length - present.length} absent`,
      inScope.length > 0 && present.length === inScope.length && carrying.length === 0, carrying.map(e => `${e.rowId} (${e.game}) carries ${byId.get(e.rowId).bsd_event_id}`).join('; ') || 'a row is absent from the served context')
  }

  // Existing behaviour: every fixture row the offline rule joins is served with the same id.
  {
    const judged = [...offline].filter(([id, ev]) => ev !== null && byId.has(id))
    const differ = judged.filter(([id, ev]) => String(byId.get(id).bsd_event_id) !== ev)
    out.agreement = { fixtureRowsJoinedOffline: [...offline].filter(([, ev]) => ev !== null).length, servedAndCompared: judged.length, differ: differ.length }
    check(`the deployed relay serves the id the offline rule gives on ${judged.length} of ${out.agreement.fixtureRowsJoinedOffline} fixture rows it joins (the deploy carries this resolver)`, differ.length === 0 && judged.length === out.agreement.fixtureRowsJoinedOffline,
      differ.slice(0, 5).map(([id, ev]) => `${id} wanted ${ev}, got ${byId.get(id).bsd_event_id}`).join('; ') || `${out.agreement.fixtureRowsJoinedOffline - judged.length} fixture rows not in the served contexts`)
  }

  // Every joined row names the teams of its event, in order.
  {
    const groups = new Map()
    for (const r of all) if (r.bsd_event_id) { const k = `${r._date}|${r.bsd_event_id}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r) }
    const bad = [], unjudged = []
    let judged = 0
    for (const rs of groups.values()) {
      for (const r of rs) {
        const ev = eventById.get(String(r.bsd_event_id))
        if (!ev) { unjudged.push(`${r.id} -> ${r.bsd_event_id}`); continue }
        judged++
        if (joinGameToBsd(r, [ev]).how !== 'joined') bad.push(`${r.id} -> ${r.bsd_event_id}`)
      }
    }
    out.teams = { joinedRows: all.filter(r => r.bsd_event_id).length, judged, unjudged: unjudged.length, wrong: bad.length }
    check(`every joined row names the teams of its event, in order (${judged} judged, ${unjudged.length} unjudged)`, bad.length === 0 && unjudged.length === 0, [...bad.slice(0, 4), ...unjudged.slice(0, 4).map(u => `UNJUDGED ${u}`)].join('; '))

    // No duplicate claim: two rows of one date may share an event only as one fixture under two id schemes.
    const shared = [...groups.entries()].filter(([, rs]) => rs.length > 1)
    const sameScheme = shared.filter(([, rs]) => new Set(rs.map(r => scheme(r.id))).size < rs.length)
    out.sharedEvents = { groups: shared.length, sameScheme: sameScheme.map(([k, rs]) => ({ key: k, rows: rs.map(r => r.id) })) }
    check(`no event is claimed by two rows of one id scheme (${shared.length} events shared across schemes, counted)`, sameScheme.length === 0, sameScheme.slice(0, 4).map(([k, rs]) => `${k}: ${rs.map(r => r.id).join(' + ')}`).join('; '))
  }

  // Soccer only, and the contract changed by exactly one field (Rule 70: nothing here changes a shape).
  {
    const nonSoccerWithId = all.filter(r => !BSD_SOCCER_SPORTS.includes(r.sport) && r.bsd_event_id)
    out.nonSoccerRowsCarryingAnId = nonSoccerWithId.length
    check(`no row of another sport carries a bsd_event_id (${all.filter(r => !BSD_SOCCER_SPORTS.includes(r.sport)).length} non-soccer rows read)`, nonSoccerWithId.length === 0, nonSoccerWithId.slice(0, 5).map(r => `${r.sport} ${r.id}`).join('; '))
    const want = new Set([...fx.dates[0].rowColumns, 'bsd_event_id'])
    const odd = all.filter(r => { const ks = Object.keys(r).filter(k => k !== '_date'); return ks.length !== want.size || ks.some(k => !want.has(k)) })
    out.contract = { fixtureColumns: fx.dates[0].rowColumns.length, rowsWithADifferentKeySet: odd.length }
    check('every served row\'s key set is the fixture\'s key set plus bsd_event_id, compared by name', odd.length === 0, `${odd.length} rows differ`)
  }

  out.assertions = checks
  out.coverage = `${dates.length} dates, ${all.length} context rows read, ${all.filter(r => BSD_SOCCER_SPORTS.includes(r.sport)).length} soccer rows, ${all.filter(r => r.bsd_event_id).length} carrying an id`
  return { out, checks }
}

// ---- the self-test: every live assertion, aimed at a local stub, each broken on purpose ----------------------------------
async function selfTest() {
  const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  const cols = [...fx.dates[0].rowColumns, 'bsd_event_id']
  const dates = fx.dates.map(d => d.date)
  const anOracle = EXPECT.proposals[0], aNoEvent = EXPECT.noEvent[0], aOneSide = EXPECT.oneSide[0]
  const mk = mode => {
    const rows = new Map(), state = { posts: new Map() }
    for (const d of fx.dates) {
      const events = eventDaysFor(d.date).flatMap(day => d.events[day] ?? [])
      const { results } = joinBatch(d.rows, events)
      const list = d.rows.map((r, i) => ({ ...Object.fromEntries(cols.map(c => [c, null])), ...r, bsd_event_id: null, _pending: results[i].bsd_event_id === null ? null : String(results[i].bsd_event_id) }))
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
      let served = list.map(r => { const { _pending, ...rest } = r; return { ...rest } })
      const find = id => served.find(r => r.id === id)
      if (mode === 'wrongProposal' && find(anOracle.rowId)) find(anOracle.rowId).bsd_event_id = '1'
      if (mode === 'unjoinedProposal' && find(anOracle.rowId)) find(anOracle.rowId).bsd_event_id = null
      if (mode === 'absentProposal') served = served.filter(r => r.id !== anOracle.rowId)
      if (mode === 'wrongOneSide' && find(aOneSide.rowId)) find(aOneSide.rowId).bsd_event_id = '1'
      if (mode === 'noEventGetsId' && find(aNoEvent.rowId)) find(aNoEvent.rowId).bsd_event_id = '210478'
      if (mode === 'nonSoccerId') served.find(r => r.sport === 'MLB').bsd_event_id = '5229'
      if (mode === 'lowCoverage') served.forEach((r, i) => { if (r.sport !== 'MLB' && i % 2) r.bsd_event_id = null })
      if (mode === 'extraColumn') served.forEach(r => { r.surprise = 1 })
      if (mode === 'duplicateClaim') {
        const espn = served.filter(r => r.bsd_event_id && scheme(r.id) === 'espn')
        if (espn.length > 1) espn[1].bsd_event_id = espn[0].bsd_event_id
      }
      if (mode === 'wrongTeams') {
        // A row that is in no expectation group, handed the id of a different game.
        const inGroup = new Set([...EXPECT.proposals, ...EXPECT.oneSide, ...EXPECT.noEvent].map(e => e.rowId))
        const joined = served.filter(r => r.bsd_event_id && !inGroup.has(r.id))
        if (joined.length > 1) joined[0].bsd_event_id = joined[1].bsd_event_id
      }
      res.end(JSON.stringify({ ok: true, date, games: { regular: served, postseason: [] } }))
    })
  }
  let bad = 0
  const expectations = [
    ['good', null], ['wrongProposal', 'proposals'], ['unjoinedProposal', 'proposals'], ['absentProposal', 'proposals'], ['wrongOneSide', 'one-side-only'],
    ['noEventGetsId', 'no-event'], ['nonSoccerId', 'no row of another sport'], ['secondWrites', 'a second run writes nothing'], ['dropColumn', 'every served row'],
    ['extraColumn', 'every served row'], ['lowCoverage', 'at least 90%'], ['duplicateClaim', 'claimed by two rows'], ['wrongTeams', 'names the teams of its event'],
  ]
  for (const [mode, expectRed] of expectations) {
    const srv = mk(mode); await new Promise(r => srv.listen(0, r))
    const relay = `http://127.0.0.1:${srv.address().port}`
    const { out, checks } = await run({ relay, secret: 'x', dates, fx, log: () => {} })
    srv.close()
    if (mode === 'good') console.log(`      good mode ran ${checks.length} assertions over ${out.coverage}; proposals ${out.proposals.right}/${out.proposals.inScope}, one-side ${out.oneSide.right}/${out.oneSide.inScope}, agreement ${out.agreement.servedAndCompared}/${out.agreement.fixtureRowsJoinedOffline}`)
    const reds = checks.filter(c => !c.pass).map(c => c.name)
    const ok = expectRed === null ? reds.length === 0 : reds.some(n => n.includes(expectRed))
    console.log(`${ok ? 'PASS' : 'FAIL'}  stub mode ${mode.padEnd(17)} ${expectRed === null ? 'every live assertion holds' : `turns "${expectRed}" red`}${ok ? '' : `   (red: ${JSON.stringify(reds)})`}`)
    if (!ok) bad++
  }
  console.log(`\n${expectations.length - bad}/${expectations.length} self-test modes behaved (${dates.length} dates, ${EXPECT.proposals.length + EXPECT.oneSide.length} expected joins, ${EXPECT.noEvent.length} expected unjoined)`)
  process.exit(bad ? 1 : 0)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
  if (process.argv.includes('--self-test')) await selfTest()
  const secret = process.env.RELAY_SHARED_SECRET
  if (!secret) { console.error('FAIL: RELAY_SHARED_SECRET is not set'); process.exit(2) }
  const fx = JSON.parse(readFileSync(at('--fixture') ?? FIXTURE, 'utf8'))
  const dates = at('--dates') ? at('--dates').split(',') : fx.dates.map(d => d.date)
  const { out, checks } = await run({ relay: RELAY, secret, dates, fx })
  mkdirSync('outbox', { recursive: true })
  writeFileSync(at('--out') ?? OUT, JSON.stringify(out, null, 2) + '\n')
  const failed = checks.filter(c => !c.pass)
  console.log(`\nCOVERAGE: ${out.coverage}`)
  console.log(`${checks.length - failed.length}/${checks.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}
