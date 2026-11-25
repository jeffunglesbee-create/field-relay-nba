#!/usr/bin/env node
// The ESPN core API mirror's runner (src/espn-core-mirror.js; docs/CC-CMD-2026-10-14-espn-host-flip.md
// Task 3; the owner's order of 2026-11-19 "Move the 5 other relay routes to runners").
//
// ESPN's core API answers 403 to the relay Worker and 200 here. This reads what the relay's five
// read sites need and writes each body, trimmed to the fields they read, into ARCHIVE_DB
// `espn_core_mirror` through the relay's authenticated /d1/execute:
//
//   soccer team statistics   /soccer/xg            every live game's two sides, each pass; a finished
//                                                  game once more, then marked final and never re-read
//   soccer athlete position  /soccer/sub-impact    every substitute coming on in a live or finished
//                                                  game, once (a position does not change mid-season)
//   golf competitor stats    /v2/golf/competitor-stats and /v2/golf/enriched's top 20: every player
//                            in the current PGA field while any player is on the course; a player who
//                            has finished once more, marked final until their next round starts
//   golf eventlog            /v2/golf/eventlog: every player in the current field, once a day
//
// The relay's */15 cron dispatches this (GitHub's own schedule fires this repo's crons a median 377
// minutes apart, measured 2026-11-19). While any soccer game is live it passes again every 2 minutes,
// for up to 12 minutes, so a live game is at most about 2 minutes behind; with nothing live it makes
// one pass and exits.
//
//   node scripts/espn-core-mirror.mjs                     a normal run
//   node scripts/espn-core-mirror.mjs --backfill-days 7   also sweep finished soccer games back 7 ET days
//   node scripts/espn-core-mirror.mjs --dry-run           read and report, write nothing
//
// Every run prints, per kind, how many reads it wanted, how many answered, and how many rows it wrote.

import { readFileSync } from 'node:fs'
import { CORE_MIRROR_TABLE, CORE_MIRROR_DDL, coreMirrorKey, coreMirrorKind, trimCoreBody } from '../src/espn-core-mirror.js'

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev'
const SECRET = process.env.RELAY_SHARED_SECRET
const SITE = 'https://site.api.espn.com/apis/site/v2/sports'
const CORE = 'https://sports.core.api.espn.com/v2/sports'
const DRY = process.argv.includes('--dry-run')
const bi = process.argv.indexOf('--backfill-days')
const BACKFILL = bi > 0 ? Math.max(0, Math.min(14, Number(process.argv[bi + 1]) || 0)) : 0
const PASS_SECONDS = 120
const BUDGET_SECONDS = 12 * 60
const CONCURRENCY = 8
const started = Date.now()

// The soccer leagues are the relay's own: every `sport: 'soccer'` entry's espnLeague in src/index.js,
// plus the World Cup's. Read from the source so a league added there is mirrored here.
export function soccerLeaguesFrom(src) {
  const set = new Set([...src.matchAll(/sport:\s*'soccer',\s*espnLeague:\s*'([^']+)'/g)].map(m => m[1]))
  if (/espnLeague:\s*'fifa\.world'/.test(src)) set.add('fifa.world')
  return [...set]
}

const etDate = (daysBack = 0) => {
  const d = new Date(Date.now() - daysBack * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/-/g, '')
}

const getJson = async (url) => {
  try {
    const r = await fetch(url)
    if (!r.ok) return { status: r.status, json: null }
    return { status: r.status, json: await r.json() }
  } catch (e) { return { status: null, json: null, error: e.message } }
}

async function d1(sql, params = []) {
  const r = await fetch(`${RELAY}/d1/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': SECRET }, body: JSON.stringify({ sql, params }) })
  const text = await r.text()
  let body
  try { body = JSON.parse(text) } catch { throw new Error(`d1 HTTP ${r.status}, not JSON: ${text.slice(0, 200)}`) }
  if (!r.ok || body.success === false || body.ok === false) throw new Error(`d1 HTTP ${r.status}: ${JSON.stringify(body).slice(0, 300)}`)
  return body
}

// url -> { final, fetched_at } for the keys already mirrored.
async function mirrored(keys) {
  const out = new Map()
  for (let i = 0; i < keys.length; i += 90) {
    const chunk = keys.slice(i, i + 90)
    if (!chunk.length) continue
    const res = await d1(`SELECT url, final, fetched_at FROM ${CORE_MIRROR_TABLE} WHERE url IN (${chunk.map(() => '?').join(',')})`, chunk)
    // A SELECT answer without a results array is a failed read, not "nothing mirrored".
    if (!Array.isArray(res.results)) throw new Error(`d1 SELECT returned no results array: ${JSON.stringify(res).slice(0, 200)}`)
    for (const row of res.results) out.set(row.url, row)
  }
  return out
}

const tally = {}
const count = (kind, field) => { tally[kind] ??= { wanted: 0, answered: 0, written: 0, failed: 0 }; tally[kind][field]++ }

// Read each wanted core URL, trim it, and write it. `want` is [{ url, final }].
async function mirror(want) {
  const rows = []
  let next = 0
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, want.length) }, async () => {
    while (next < want.length) {
      const w = want[next++]
      const kind = coreMirrorKind(w.url)
      if (!kind) throw new Error(`not a mirrored core URL: ${w.url}`)
      count(kind, 'wanted')
      const r = await getJson(w.url)
      const trimmed = r.json ? trimCoreBody(kind, r.json) : null
      if (!trimmed) { count(kind, 'failed'); console.error(`  core ${r.status ?? r.error} ${w.url}`); continue }
      count(kind, 'answered')
      rows.push([coreMirrorKey(w.url), kind, JSON.stringify(trimmed), new Date().toISOString(), w.final ? 1 : 0])
    }
  }))
  if (DRY) return
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20)
    await d1(`INSERT OR REPLACE INTO ${CORE_MIRROR_TABLE} (url, kind, body, fetched_at, final) VALUES ${chunk.map(() => '(?,?,?,?,?)').join(',')}`, chunk.flat())
    for (const c of chunk) count(c[1], 'written')
  }
}

// ── Soccer ────────────────────────────────────────────────────────────────────
// Returns the leagues that had a live game, so the next pass re-reads only those.
async function soccerPass(leagues, days) {
  const live = new Set()
  const byId = new Map()   // one entry per game: a late game is listed on two ET days
  for (const lg of leagues) {
    for (const day of days) {
      const sb = await getJson(`${SITE}/soccer/${lg}/scoreboard?dates=${day}`)
      count('site soccer scoreboard', 'wanted')
      if (!Array.isArray(sb.json?.events)) { count('site soccer scoreboard', 'failed'); console.error(`  site ${sb.status ?? sb.error} ${lg} ${day}`); continue }
      count('site soccer scoreboard', 'answered')
      for (const ev of sb.json.events) {
        const state = ev?.status?.type?.state || ev?.competitions?.[0]?.status?.type?.state
        if (state !== 'in' && state !== 'post') continue
        if (state === 'in') live.add(lg)
        byId.set(`${lg}/${ev.id}`, { lg, ev, state })
      }
    }
  }
  const games = [...byId.values()]
  const teamUrl = (g, c) => `${CORE}/soccer/leagues/${g.lg}/events/${g.ev.id}/competitions/${g.ev.id}/competitors/${c.id}/statistics`
  const teamUrls = []
  for (const g of games) {
    const cs = g.ev.competitions?.[0]?.competitors
    // A started or finished game always lists its two sides; one that does not is a bad read, said.
    if (!Array.isArray(cs) || cs.length !== 2) { count('site soccer scoreboard', 'failed'); console.error(`  site ${g.lg} ${g.ev.id}: ${Array.isArray(cs) ? cs.length : 'no'} competitors`); continue }
    for (const c of cs) teamUrls.push({ url: teamUrl(g, c), final: g.state === 'post', game: g })
  }
  const have = await mirrored(teamUrls.map(t => coreMirrorKey(t.url)))
  // A finished game whose two sides are already final is done; everything else is read.
  const want = teamUrls.filter(t => !(t.final && have.get(coreMirrorKey(t.url))?.final === 1))
  const wantGames = new Set(want.map(t => t.game))

  // Substitutes coming on, from each game being read: participants[0] is the player coming on
  // (verified 2026-07-20, src/index.js /soccer/sub-impact).
  const athleteUrls = []
  for (const g of wantGames) {
    const sum = await getJson(`${SITE}/soccer/${g.lg}/summary?event=${g.ev.id}`)
    count('site soccer summary', 'wanted')
    if (!sum.json) { count('site soccer summary', 'failed'); console.error(`  site ${sum.status ?? sum.error} summary ${g.lg} ${g.ev.id}`); continue }
    count('site soccer summary', 'answered')
    // A game with no key events yet (kickoff minutes ago) has no substitutions to read.
    const keyEvents = Array.isArray(sum.json.keyEvents) ? sum.json.keyEvents : []
    for (const k of keyEvents) {
      if (k?.type?.text !== 'Substitution') continue
      const on = k.participants?.[0]?.athlete?.id
      if (on) athleteUrls.push(`${CORE}/soccer/leagues/${g.lg}/athletes/${on}`)
    }
  }
  const uniqAth = [...new Set(athleteUrls)]
  const haveAth = await mirrored(uniqAth.map(coreMirrorKey))
  const wantAth = uniqAth.filter(u => !haveAth.has(coreMirrorKey(u))).map(url => ({ url, final: true }))

  await mirror([...want.map(({ url, final }) => ({ url, final })), ...wantAth])
  console.log(`soccer: ${leagues.length} leagues x ${days.length} day(s), ${games.length} live or finished games, ${wantGames.size} read, ${wantAth.length} new substitutes`)
  return live
}

// ── Golf ──────────────────────────────────────────────────────────────────────

// What the leaderboard's first event offers to read. ESPN lists an event that has not started with NO `competitors` key on its competition until
// the field is published (measured 2026-11-25 18:05Z from a runner, outbox/espn-golf-leaderboard-shape-2026-11-25T18-05-46-597Z.json: Hero World
// Challenge, status.type.state 'pre', starts 2026-12-03, competitors absent on the mirror's read, the event-specific read and the scoreboard,
// all HTTP 200). That is the leaderboard answering, like an off week, so it is not a failed read: it made every run from 10:15Z red (runs 611 to
// 639). An event that has started or finished and lists no competitors is still one: ESPN would be serving a field it never lost.
export function golfFieldOf(ev) {
  const comps = ev?.competitions?.[0]?.competitors
  if (Array.isArray(comps)) return { kind: 'field', comps }
  if (ev?.status?.type?.state === 'pre') return { kind: 'no field yet' }
  return { kind: 'failed' }
}

async function golfPass() {
  const lb = await getJson(`${SITE}/golf/leaderboard?league=pga`)
  count('site golf leaderboard', 'wanted')
  if (!lb.json) { count('site golf leaderboard', 'failed'); console.error(`  site ${lb.status ?? lb.error} golf leaderboard`); return }
  count('site golf leaderboard', 'answered')
  const ev = Array.isArray(lb.json.events) ? lb.json.events[0] : undefined
  if (!ev) { console.log('golf: the leaderboard lists no PGA event (an off week)'); return }
  const fld = golfFieldOf(ev)
  if (fld.kind === 'no field yet') { console.log(`golf: ${ev.name} (${ev.id}) has not started and lists no field yet`); return }
  if (fld.kind === 'failed') { count('site golf leaderboard', 'failed'); console.error(`  site golf leaderboard: event ${ev.id} lists no competitors`); return }
  const comps = fld.comps
  const season = ev.season?.year
  const anyOn = comps.some(c => c?.status?.type?.state === 'in')
  const statUrl = c => `${CORE}/golf/leagues/pga/events/${ev.id}/competitions/${ev.id}/competitors/${c.id}/statistics/0`
  const stats = comps.map(c => ({ url: statUrl(c), state: c?.status?.type?.state }))
  const have = await mirrored(stats.map(s => coreMirrorKey(s.url)))
  // On the course: read. Finished and not yet read as finished: read once more. Not started: nothing new.
  const want = stats
    .filter(s => (anyOn && s.state === 'in') || (s.state === 'post' && have.get(coreMirrorKey(s.url))?.final !== 1))
    .map(s => ({ url: s.url, final: s.state === 'post' }))

  const logs = season ? comps.map(c => `${CORE}/golf/leagues/pga/seasons/${season}/athletes/${c.id}/eventlog`) : []
  const haveLogs = await mirrored(logs.map(coreMirrorKey))
  const dayAgo = Date.now() - 20 * 3600 * 1000
  const wantLogs = logs.filter(u => { const r = haveLogs.get(coreMirrorKey(u)); return !r || Date.parse(r.fetched_at) < dayAgo }).map(url => ({ url, final: false }))

  await mirror([...want, ...wantLogs])
  console.log(`golf: ${ev.name} (${ev.id}), ${comps.length} players, ${anyOn ? 'play under way' : 'nobody on the course'}, ${want.length} stats and ${wantLogs.length} eventlogs read`)
}

async function main() {
  if (!SECRET && !DRY) throw new Error('RELAY_SHARED_SECRET is not set')
  const leagues = soccerLeaguesFrom(readFileSync(new URL('../src/index.js', import.meta.url), 'utf8'))
  if (leagues.length < 10) throw new Error(`only ${leagues.length} soccer leagues found in src/index.js; refusing to mirror a partial list`)
  if (!DRY) await d1(CORE_MIRROR_DDL)

  const firstDays = [...new Set([0, 1, ...Array.from({ length: BACKFILL + 1 }, (_, i) => i)])].map(etDate)
  let live = await soccerPass(leagues, firstDays)
  await golfPass()
  for (let pass = 2; live.size > 0; pass++) {
    const wait = PASS_SECONDS * 1000 - ((Date.now() - started) % (PASS_SECONDS * 1000))
    if ((Date.now() - started + wait) / 1000 > BUDGET_SECONDS) break
    await new Promise(r => setTimeout(r, wait))
    console.log(`pass ${pass}: ${[...live].join(', ')} live`)
    live = await soccerPass([...live], [etDate(0)])
  }

  let failed = 0
  for (const [kind, t] of Object.entries(tally)) { console.log(`${kind.padEnd(24)} wanted ${t.wanted}, answered ${t.answered}, written ${t.written}, failed ${t.failed}`); failed += t.failed }
  if (!Object.keys(tally).length) console.log('nothing to mirror this run')
  console.log(`${DRY ? 'DRY RUN, nothing written. ' : ''}${Math.round((Date.now() - started) / 1000)} s`)
  if (failed > 0) process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error('MIRROR ERROR:', e.message); process.exit(1) })
