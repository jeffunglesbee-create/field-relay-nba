#!/usr/bin/env node
// docs/CC-CMD-2026-11-16-golf-tee-times.md: why /v2/golf/enriched returns roundStart and venue null.
//
// Measured 2026-11-19 00:40Z: /v2/golf/enriched serves round 4 for the Austin Championship and still
// `teeTimes: null` and `venue: null`; both come from ESPN's CORE API read inside the Worker
// (sports.core.api.espn.com), while the same core records load from outside. This asks the Worker
// itself, through the relay's authenticated /web-fetch, and asks the runner directly, for the same
// URLs, and records each HTTP status. /web-fetch sends a User-Agent; the golf code does not, so the
// runner also tries each core URL with and without one.
//
// Artifact: outbox/golf-core-reach-probe-<stamp>.json.

import { writeFileSync, mkdirSync } from 'node:fs'

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev'
const SECRET = process.env.RELAY_SHARED_SECRET
const EVENT = '401850981'
const CORE = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga'
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const URLS = {
  scoreboard_control: 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard',
  core_event: `${CORE}/events/${EVENT}`,
  core_competition: `${CORE}/events/${EVENT}/competitions/${EVENT}`,
  core_status: `${CORE}/events/${EVENT}/competitions/${EVENT}/competitors/3257/status`,
}

const viaWorker = async (url) => {
  // A per-run parameter, so /web-fetch's cache cannot answer for the Worker.
  const target = `${url}${url.includes('?') ? '&' : '?'}probe=${STAMP}`
  const r = await fetch(`${RELAY}/web-fetch?url=${encodeURIComponent(target)}`, { headers: { 'X-FIELD-Relay': SECRET } })
  const text = await r.text()
  let j = null
  try { j = JSON.parse(text) } catch { /* recorded below as unparsed */ }
  return { relayHttp: r.status, upstreamStatus: j?.status ?? null, ok: j?.ok ?? null, error: j?.error ?? null, bytes: j?.text?.length ?? text.length, head: (j?.text ?? text).slice(0, 160) }
}
const direct = async (url, ua) => {
  const r = await fetch(url, ua ? { headers: { 'User-Agent': ua } } : {})
  const t = await r.text()
  return { status: r.status, bytes: t.length, head: t.slice(0, 120) }
}

const main = async () => {
  if (!SECRET) throw new Error('RELAY_SHARED_SECRET is not set')
  const out = { probedAt: new Date().toISOString(), event: EVENT, worker: {}, runnerNoUA: {}, runnerUA: {} }
  for (const [k, u] of Object.entries(URLS)) {
    out.worker[k] = await viaWorker(u)
    out.runnerNoUA[k] = await direct(u, null)
    out.runnerUA[k] = await direct(u, 'FIELD-relay/1.0 (field.dev; sports-context-app)')
    console.log(`${k.padEnd(20)} worker(with UA): ${out.worker[k].upstreamStatus ?? out.worker[k].error} | runner no UA: ${out.runnerNoUA[k].status} | runner UA: ${out.runnerUA[k].status}`)
  }
  mkdirSync('outbox', { recursive: true })
  const path = `outbox/golf-core-reach-probe-${STAMP}.json`
  writeFileSync(path, JSON.stringify(out, null, 2) + '\n')
  console.log(`wrote ${path}`)
}
main().catch(e => { console.error('PROBE ERROR:', e.message); process.exit(1) })
