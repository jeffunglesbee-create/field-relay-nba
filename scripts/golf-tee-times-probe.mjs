#!/usr/bin/env node
// Task 1 of docs/CC-CMD-2026-11-16-golf-tee-times.md: the read cost of golf tee times.
//
// THE QUESTION. ESPN's PGA scoreboard serves no tee time (its start is a placeholder it
// marks `timeValid: false`); its core API carries a real UTC `teeTime` on each
// competitor's `status`. Is there one endpoint that lists a round's tee sheet, or is it
// one request per competitor? The answer decides the relay's design (Rule 78).
//
// WHAT IT READS, all unauthenticated public GETs:
//   1. the site scoreboard: the current event id, its `date`, `timeValid`
//   2. the core event and its competition: every `$ref` child the competition names,
//      each fetched once, with its status and top-level keys, so a tee-sheet endpoint
//      would show up by its keys rather than by a guessed URL
//   3. every competitor's `status` (bounded concurrency), recording teeTime, period,
//      startHole and state per competitor, with the request count and wall time
//
// ARTIFACT: outbox/golf-tee-times-probe-<UTC date>.json. Coverage is printed beside every
// summary (Rule 91): "N of M competitors carry a teeTime".
//
//   node scripts/golf-tee-times-probe.mjs              run the probe
//   node scripts/golf-tee-times-probe.mjs --self-test  the summary can still fail (Rule 90)

import { writeFileSync, mkdirSync } from 'node:fs'

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard'
const CORE = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga'
const CONCURRENCY = 8

/** Per round (`period`): earliest and latest teeTime, and how many carry one. Pure. */
export const summarise = statuses => {
  const byPeriod = {}
  for (const s of statuses) {
    const key = String(s.period ?? 'none')
    const p = (byPeriod[key] ??= { competitors: 0, withTeeTime: 0, first: null, last: null, startHoles: {} })
    p.competitors++
    if (s.startHole != null) p.startHoles[s.startHole] = (p.startHoles[s.startHole] ?? 0) + 1
    if (!s.teeTime) continue
    p.withTeeTime++
    const t = Date.parse(s.teeTime)
    if (Number.isNaN(t)) continue
    if (p.first === null || t < Date.parse(p.first)) p.first = new Date(t).toISOString()
    if (p.last === null || t > Date.parse(p.last)) p.last = new Date(t).toISOString()
  }
  return byPeriod
}

const selfTest = () => {
  let failed = 0
  const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      → ${detail}`}`); if (!ok) failed++ }
  const rows = [
    { period: 4, teeTime: '2026-11-16T15:31Z', startHole: 1 },
    { period: 4, teeTime: '2026-11-16T13:05Z', startHole: 10 },
    { period: 4, teeTime: '2026-11-16T14:00Z', startHole: 1 },
    { period: 4, teeTime: null, startHole: null },
    { period: 3, teeTime: '2026-11-15T14:10Z', startHole: 1 },
  ]
  const s = summarise(rows)
  check('the earliest teeTime of a round is its first, not the first listed', s['4'].first === '2026-11-16T13:05:00.000Z', JSON.stringify(s['4']))
  check('the latest is its last', s['4'].last === '2026-11-16T15:31:00.000Z', JSON.stringify(s['4']))
  check('a competitor without a teeTime is counted in the denominator, not dropped', s['4'].competitors === 4 && s['4'].withTeeTime === 3, JSON.stringify(s['4']))
  check('rounds are kept apart', s['3'].first === '2026-11-15T14:10:00.000Z' && s['3'].competitors === 1, JSON.stringify(s['3']))
  check('a two-tee start is visible in the start holes', s['4'].startHoles['1'] === 2 && s['4'].startHoles['10'] === 1, JSON.stringify(s['4'].startHoles))
  console.log(`\n${5 - failed}/5 checks passed`)
  process.exit(failed ? 1 : 0)
}

let requests = 0
const getJson = async url => {
  requests++
  const started = Date.now()
  const https = url.replace(/^http:/, 'https:')
  const r = await fetch(https, { headers: { accept: 'application/json' } })
  const ms = Date.now() - started
  let json = null
  try { json = await r.json() } catch { json = null }
  return { url: https, status: r.status, ms, json }
}

const pool = async (items, fn) => {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) }
  }))
  return out
}

const run = async () => {
  const wallStarted = Date.now()
  const artifact = { probedAt: new Date().toISOString(), cmd: 'docs/CC-CMD-2026-11-16-golf-tee-times.md, Task 1' }

  const sb = await getJson(SCOREBOARD)
  const ev = sb.json?.events?.[0]
  if (!ev) { artifact.error = `scoreboard ${sb.status}: no event`; return finish(artifact, wallStarted) }
  const comp0 = ev.competitions?.[0] ?? {}
  artifact.scoreboard = { status: sb.status, eventId: ev.id, name: ev.name, date: ev.date, competitionTimeValid: comp0.timeValid, competitors: (comp0.competitors ?? []).length }

  const core = await getJson(`${CORE}/events/${ev.id}`)
  artifact.coreEvent = { status: core.status, date: core.json?.date, timeValid: core.json?.timeValid, keys: Object.keys(core.json ?? {}).sort() }
  const compRef = core.json?.competitions?.[0]?.$ref
  const comp = compRef ? await getJson(compRef) : null
  artifact.competition = comp ? { url: comp.url, status: comp.status, keys: Object.keys(comp.json ?? {}).sort() } : { error: 'no competition $ref' }

  // Every $ref child the competition names, fetched once. A tee-sheet endpoint, if any,
  // is found by what it serves, not by a guessed name.
  const children = Object.entries(comp?.json ?? {})
    .filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.$ref === 'string')
    .map(([k, v]) => [k, v.$ref])
  artifact.competitionChildren = await pool(children, async ([key, ref]) => {
    const r = await getJson(ref)
    const keys = Object.keys(r.json ?? {}).sort()
    const text = JSON.stringify(r.json ?? '')
    return { key, url: r.url, status: r.status, keys, mentionsTeeTime: /tee/i.test(text) }
  })

  // The competitor list, paged as the core API pages it.
  let compList = []
  const listRef = comp?.json?.competitors?.$ref
  if (Array.isArray(comp?.json?.competitors)) compList = comp.json.competitors
  else if (listRef) {
    let page = await getJson(`${listRef}${listRef.includes('?') ? '&' : '?'}limit=500`)
    compList = page.json?.items ?? []
    artifact.competitorList = { status: page.status, count: page.json?.count, pageCount: page.json?.pageCount }
  }
  const statusRefs = compList.map(c => c?.status?.$ref ?? (c?.$ref ? `${c.$ref.split('?')[0]}/status` : null)).filter(Boolean)
  const before = requests
  const statusStarted = Date.now()
  const statuses = await pool(statusRefs, async ref => {
    const r = await getJson(ref)
    const j = r.json ?? {}
    return { url: r.url, httpStatus: r.status, ms: r.ms, period: j.period ?? null, teeTime: j.teeTime ?? null, startHole: j.startHole ?? null, state: j.type?.state ?? null, position: j.position?.displayName ?? null }
  })
  artifact.statusReads = { requests: requests - before, wallMs: Date.now() - statusStarted, concurrency: CONCURRENCY, non200: statuses.filter(s => s.httpStatus !== 200).length }
  artifact.byRound = summarise(statuses)
  artifact.statuses = statuses
  return finish(artifact, wallStarted)
}

const finish = (artifact, wallStarted) => {
  artifact.totalRequests = requests
  artifact.totalWallMs = Date.now() - wallStarted
  mkdirSync('outbox', { recursive: true })
  const path = `outbox/golf-tee-times-probe-${new Date().toISOString().slice(0, 10)}.json`
  writeFileSync(path, JSON.stringify(artifact, null, 2) + '\n')
  console.log(`wrote ${path}`)
  if (artifact.error) { console.log(`ERROR ${artifact.error}`); process.exit(1) }
  console.log(`event ${artifact.scoreboard.eventId} ${artifact.scoreboard.name}: scoreboard date ${artifact.scoreboard.date}, timeValid ${artifact.scoreboard.competitionTimeValid}`)
  for (const c of artifact.competitionChildren ?? []) console.log(`child ${c.key} ${c.status} tee:${c.mentionsTeeTime} keys ${c.keys.slice(0, 12).join(',')}`)
  for (const [round, p] of Object.entries(artifact.byRound ?? {}))
    console.log(`round ${round}: ${p.withTeeTime} of ${p.competitors} competitors carry a teeTime; first ${p.first}, last ${p.last}; start holes ${JSON.stringify(p.startHoles)}`)
  console.log(`status reads: ${artifact.statusReads?.requests} requests in ${artifact.statusReads?.wallMs} ms (concurrency ${CONCURRENCY}, non-200 ${artifact.statusReads?.non200}); total ${artifact.totalRequests} requests in ${artifact.totalWallMs} ms`)
}

if (process.argv.includes('--self-test')) selfTest()
else run().catch(e => { console.error(e); process.exit(1) })
