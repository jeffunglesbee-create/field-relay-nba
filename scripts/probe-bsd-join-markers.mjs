#!/usr/bin/env node
// Which done markers is the BSD game join window pass holding, and who wrote them?
//
// WHY: scripts/probe-bsd-join-today.mjs (outbox/probe-bsd-join-today-2026-11-07T12-24-33-411Z.json) showed the join works
// when called: 33 of 34 pending rows of 2026-11-07 joined at 12:24Z, 459 BSD events read. Yet the scheduled window pass,
// which was called at 10:01Z and again at 11:15Z (the 11:15Z brief shows the tick passed the context gate), wrote
// nothing. A pass that did not run for a date is a pass that found its done marker: `bsd-join:<date>:<utc day>`.
//
// THE HYPOTHESIS, stated so it can fail. The hourly-marker fix (an empty date's marker lasts 1 h, not 36 h) deployed at
// about 01:14Z on 2026-11-07 (Deploy RELAY Worker run 42322923778). Before it, the first pass of the UTC day found
// date 2026-11-07 with nothing pending and held it 36 h. A deploy does not clear KV, so that marker outlived the fix and
// held the date through 10:01Z and 11:15Z. If that is what happened, `bsd-join:2026-11-07:2026-11-07` exists with
// `pending: 0` and MORE THAN AN HOUR left, which the fixed code cannot write (it writes 3600 s for pending 0). If the
// marker is absent, or is hourly, or carries pending > 0, the hypothesis is wrong and the cause is elsewhere.
//
// READ-ONLY. It lists keys under the prefix `bsd-join` in FIELD_JOURNALISM and reads their values through the
// Cloudflare REST API with the token the deploy already uses. Writes nothing to KV. Never prints the token.
//
// Usage: node scripts/probe-bsd-join-markers.mjs   |   --self-test
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const HOUR = 3600, SLACK = 120

/** What one marker says about the code that wrote it. `now` and `expiration` are unix seconds. */
export function classifyMarker({ key, value, expiration, now }) {
  if (key.startsWith('bsd-join-fail:')) return 'FAIL-MARKER (a failed pass; holds the date one hour)'
  let v
  try { v = JSON.parse(value) } catch (_) { return 'UNREADABLE-VALUE' } // not JSON: classified, never guessed at
  if (typeof expiration !== 'number') return 'NO-EXPIRY-REPORTED'
  const left = expiration - now
  if (v.pending === 0) return left > HOUR + SLACK ? 'EMPTY-DATE-HELD-OVER-AN-HOUR (the pre-fix 36 h rule; the fixed code writes 3600 s)' : 'EMPTY-DATE-HOURLY (the fixed rule)'
  if (typeof v.pending === 'number' && v.pending > 0) return `PENDING-ROWS-HELD (${v.written} written of ${v.pending}; 36 h by the rule, a date with rows is read once per UTC day)`
  return 'UNREADABLE-VALUE'
}

if (process.argv.includes('--self-test')) {
  let bad = 0
  const eq = (label, got, want) => { const ok = got.split(' ')[0] === want; if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${got.split(' ')[0]}${ok ? '' : ` (wanted ${want})`}`) }
  const now = 1_000_000
  const m = (key, value, left) => ({ key, value: typeof value === 'string' ? value : JSON.stringify(value), expiration: left === undefined ? undefined : now + left, now })
  eq('pending 0 with 35 h left was written by the 36 h rule', classifyMarker(m('bsd-join:2026-11-07:2026-11-07', { written: 0, pending: 0 }, 35 * HOUR)), 'EMPTY-DATE-HELD-OVER-AN-HOUR')
  eq('pending 0 with 40 minutes left is the hourly rule', classifyMarker(m('bsd-join:2026-11-07:2026-11-07', { written: 0, pending: 0 }, 2400)), 'EMPTY-DATE-HOURLY')
  eq('pending 0 with exactly 3600 s left is the hourly rule', classifyMarker(m('k', { written: 0, pending: 0 }, 3600)), 'EMPTY-DATE-HOURLY')
  // Literal seconds, not HOUR/SLACK: a test written in the constants moves with a mutated constant and proves nothing about it.
  eq('pending 0 with 3720 s left (an hour plus the 2-minute slack) is still hourly', classifyMarker(m('k', { written: 0, pending: 0 }, 3720)), 'EMPTY-DATE-HOURLY')
  eq('pending 0 with 3721 s left is the 36 h rule', classifyMarker(m('k', { written: 0, pending: 0 }, 3721)), 'EMPTY-DATE-HELD-OVER-AN-HOUR')
  eq('pending 5 is a date held with rows', classifyMarker(m('k', { written: 5, pending: 5 }, 30 * HOUR)), 'PENDING-ROWS-HELD')
  eq('a fail marker is named as one', classifyMarker(m('bsd-join-fail:2026-11-07', 'BSD events for 2026-11-07 not fully read', 1800)), 'FAIL-MARKER')
  eq('a non-JSON done value is unreadable, not empty', classifyMarker(m('k', 'oops', 30 * HOUR)), 'UNREADABLE-VALUE')
  eq('a missing expiry is reported, not defaulted', classifyMarker(m('k', { written: 0, pending: 0 })), 'NO-EXPIRY-REPORTED')
  console.log(bad ? `\n${bad} FAILED` : '\nself-test: 9/9')
  process.exit(bad ? 1 : 0)
}

const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID
if (!token || !account) { console.error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must both be set'); process.exit(2) }
const wr = readFileSync('wrangler.toml', 'utf8')
const nsMatch = wr.match(/binding\s*=\s*"FIELD_JOURNALISM"\s*\nid\s*=\s*"([0-9a-f]{32})"/)
if (!nsMatch) { console.error('FIELD_JOURNALISM namespace id not found in wrangler.toml'); process.exit(2) }
const ns = nsMatch[1]
const api = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${ns}`
const H = { Authorization: `Bearer ${token}` }

const now = Math.floor(Date.now() / 1000)
const keys = []
let cursor = ''
for (let page = 0; page < 20; page++) {
  const r = await fetch(`${api}/keys?prefix=bsd-join&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: H, signal: AbortSignal.timeout(30_000) })
  const j = await r.json()
  if (!r.ok || j.success !== true) { console.error(`list refused: HTTP ${r.status} ${JSON.stringify(j.errors)}`); process.exit(1) }
  keys.push(...j.result)
  cursor = j.result_info?.cursor ?? ''
  if (!cursor) break
}
const out = { at: new Date().toISOString(), nowUnix: now, namespace: 'FIELD_JOURNALISM', prefix: 'bsd-join', keysListed: keys.length, markers: [] }
for (const k of keys) {
  const r = await fetch(`${api}/values/${encodeURIComponent(k.name)}`, { headers: H, signal: AbortSignal.timeout(30_000) })
  const value = r.ok ? await r.text() : null
  const klass = value === null ? `VALUE-READ-FAILED (HTTP ${r.status})` : classifyMarker({ key: k.name, value, expiration: k.expiration, now })
  const left = typeof k.expiration === 'number' ? k.expiration - now : null
  out.markers.push({ key: k.name, value, expiration: typeof k.expiration === 'number' ? new Date(k.expiration * 1000).toISOString() : null, secondsLeft: left, verdict: klass })
  console.log(`${k.name.padEnd(40)} left ${left === null ? 'n/a' : `${(left / 3600).toFixed(2)} h`}  ${value === null ? '' : value.slice(0, 60)}  ->  ${klass}`)
}
out.coverage = `${keys.length} key(s) under prefix "bsd-join" listed and each value read; keys outside the prefix are not examined`
console.log(`COVERAGE: ${out.coverage}`)
mkdirSync('outbox', { recursive: true })
writeFileSync(`outbox/probe-bsd-join-markers-${out.at.replace(/[:.]/g, '-')}.json`, JSON.stringify(out, null, 2))
