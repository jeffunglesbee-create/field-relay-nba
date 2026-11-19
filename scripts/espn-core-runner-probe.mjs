#!/usr/bin/env node
// docs/CC-CMD-2026-10-14-espn-host-flip.md, Task 3, the owner's order of 2026-11-19 "Move the 5 other
// relay routes to runners". Premises before building (Rule 100), each read from a GitHub runner:
//   P1  a runner gets 200 from every core URL the five read sites use
//   P2  how large each body is (they will be stored in D1 rows)
//   P3  the golf competitor statistics carry the stat names the relay picks, with values
// Artifact: outbox/espn-core-runner-probe-<stamp>.json. Coverage: one or two samples per site, printed.
import { writeFileSync, mkdirSync } from 'node:fs'
const SITE = 'https://site.api.espn.com/apis/site/v2'
const CORE = 'https://sports.core.api.espn.com/v2/sports'
const get = async (url) => {
  const t0 = Date.now()
  try { const r = await fetch(url); const text = await r.text(); let j = null; try { j = JSON.parse(text) } catch {}
    return { url, status: r.status, bytes: text.length, ms: Date.now() - t0, json: j } }
  catch (e) { return { url, status: null, error: e.message } }
}
const out = { probedAt: new Date().toISOString(), samples: [] }
// Raw bodies, one per kind, kept byte for byte as fixtures for scripts/check-espn-core-mirror.mjs.
const FIX = 'outbox/espn-core-fixtures'
const keep = (kind, r) => { if (r.status !== 200 || !r.json) return; mkdirSync(FIX, { recursive: true }); writeFileSync(`${FIX}/${kind}.json`, JSON.stringify({ url: r.url, fetchedAt: new Date().toISOString(), body: r.json }) + '\n') }
const rec = (site, r, extra = {}) => { const { json, ...rest } = r; out.samples.push({ site, ...rest, ...extra }); console.log(`${site.padEnd(28)} ${r.status} ${r.bytes ?? '-'} B ${JSON.stringify(extra).slice(0, 160)}`) }
const statNames = j => { const n = []; for (const c of j?.splits?.categories || []) for (const s of c.stats || []) n.push(s.name); for (const s of j?.stats || []) n.push(s.name); return n }
const PICKS = ['scoreToPar','driveDistAvg','driveAccuracyPct','gir','girPoss','puttsGirAvg','sandSaves','sandSavesPoss','birdies','bogeys','doubleBogeysAndWorse']
const pickVals = j => { const flat = []; for (const c of j?.splits?.categories || []) flat.push(...(c.stats || [])); flat.push(...(j?.stats || [])); return Object.fromEntries(PICKS.map(p => { const s = flat.find(x => x?.name === p); return [p, s ? (s.value ?? s.displayValue ?? null) : 'MISSING'] })) }

// Golf: a finished event (Austin, 401850980, its winner 11183) and the event on now (RSM, 401850981).
for (const [ev, ath] of [['401850980', '11183'], ['401850981', '3257']]) {
  const r = await get(`${CORE}/golf/leagues/pga/events/${ev}/competitions/${ev}/competitors/${ath}/statistics/0`)
  rec('golf competitor-stats', r, { event: ev, athlete: ath, statCount: statNames(r.json).length, picked: pickVals(r.json) })
  if (ev === '401850980') keep('golf-competitor-stats', r)
}
{ const r = await get(`${CORE}/golf/leagues/pga/seasons/2026/athletes/11183/eventlog?limit=25`)
  const items = r.json?.events?.items || r.json?.items || []
  rec('golf eventlog', r, { items: items.length, firstEventRef: items[0]?.event?.$ref || null }); keep('golf-eventlog', r) }

// Soccer: a completed and recent game per league, read from the site scoreboard the runner can reach.
const day = n => { const d = new Date(Date.now() - n * 86400000); return d.toISOString().slice(0, 10).replace(/-/g, '') }
for (const lg of ['usa.1', 'eng.1', 'uefa.champions']) {
  let ev = null
  for (let n = 1; n <= 21 && !ev; n++) {
    const sb = await get(`${SITE}/sports/soccer/${lg}/scoreboard?dates=${day(n)}`)
    ev = (sb.json?.events || []).find(e => e?.status?.type?.completed) || null
  }
  if (!ev) { console.log(`${lg}: no completed event in 21 days`); out.samples.push({ site: 'soccer', league: lg, note: 'no completed event in 21 days' }); continue }
  const comp = ev.competitions?.[0]
  for (const c of comp?.competitors || []) {
    const r = await get(`${CORE}/soccer/leagues/${lg}/events/${ev.id}/competitions/${ev.id}/competitors/${c.id}/statistics`)
    const names = statNames(r.json)
    rec('soccer xg (team stats)', r, { league: lg, event: ev.id, team: c.id, statCount: names.length, hasXG: names.includes('expectedGoals'), hasPossession: names.includes('possessionPct') })
    if (lg === 'eng.1') keep(`soccer-team-stats-${c.homeAway}`, r)
  }
  const sum = await get(`${SITE}/sports/soccer/${lg}/summary?event=${ev.id}`)
  const sub = (sum.json?.keyEvents || []).find(k => k.type?.text === 'Substitution')
  const on = sub?.participants?.[0]?.athlete?.id
  if (on) { const r = await get(`${CORE}/soccer/leagues/${lg}/athletes/${on}`); rec('soccer sub-impact (athlete)', r, { league: lg, event: ev.id, athlete: on, position: r.json?.position?.abbreviation ?? null }); if (lg === 'eng.1') keep('soccer-athlete', r) }
  else out.samples.push({ site: 'soccer sub-impact', league: lg, event: ev.id, note: 'no substitution in keyEvents' })
}
const ok = out.samples.filter(s => s.status === 200).length, n = out.samples.filter(s => 'status' in s).length
console.log(`\nchecked ${n} core reads from the runner: ${ok} answered 200`)
mkdirSync('outbox', { recursive: true })
const path = `outbox/espn-core-runner-probe-${out.probedAt.replace(/[:.]/g, '-')}.json`
writeFileSync(path, JSON.stringify(out, null, 1) + '\n'); console.log(`wrote ${path}`)
