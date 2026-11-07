#!/usr/bin/env node
// What does the BSD game join answer, today, for the rows the archive created at 10:00Z?
//
// WHY: docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md. On 2026-11-07 the deployed window pass
// (runBsdGameJoinWindow) was measured NOT to have joined the day's rows by 12:11Z: 34 rows of 2026-11-07 (19 big-five,
// 15 MLS), all created 10:00:29-10:00:39Z, all `bsd_event_id IS NULL`, and no `bsd_game_join` change_log write since
// 2026-11-07T00:30Z. The 11:15Z journalism brief shows the tick got past the context-unchanged gate, so the window pass
// was CALLED. Which of its outcomes it had is not in D1 and not in a log this sandbox can read:
//   (a) a done marker already held the date (the pass is not run again until the marker expires),
//   (b) the pass ran and BSD answered with no events for that day,
//   (c) it ran, events were read, and none matched,
//   (d) it ran and the BSD read failed (a fail marker holds the date an hour).
// This runs the SAME function the tick runs, through the deployed admin route, for one date, and prints its own return
// value. (a) shows up as a pass that has work and does it; (b)-(d) show up as the verdict below. Either way the
// answer is the function's, not an inference from the rows.
//
// IT WRITES: POST /admin/bsd-game-join fills `bsd_event_id` on rows where it IS NULL, through reconcile(), logged as
// source 'bsd_game_join' - exactly the enrichment the tick performs, and the one the CC-CMD's live proof
// (scripts/check-bsd-game-join-live.mjs) has run since 2026-10-28. It never overwrites a value. The second call must
// write nothing; if it does, the IS NULL scope is broken and that is a finding.
//
// Needs RELAY_SHARED_SECRET (no default: an unset secret fails loudly rather than as a quiet 401).
// Usage: node scripts/probe-bsd-join-today.mjs [--dates 2026-11-07[,2026-11-08]]   |   --self-test
import { writeFileSync, mkdirSync } from 'node:fs'
import { getFieldDateKey } from '../src/field-date.js'
import { BSD_SOCCER_SPORTS } from '../src/bsd-game-join.js'

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev'

/** What one admin-route answer means. Order matters: a refusal and a failed read are not "nothing pending". */
export function classify(first) {
  if (first.status === 401 || first.status === 403) return 'ROUTE-REFUSED (secret not accepted)'
  if (first.ok !== true) return `PASS-FAILED: ${first.reason || first.raw || first.error || `HTTP ${first.status}`}`
  if (first.pending === 0) return 'NOTHING-PENDING (no unjoined soccer row for this date)'
  if (first.written > 0) return `JOINED ${first.written} of ${first.pending} pending`
  if (!(first.eventsRead > 0)) return `BSD-HAS-NO-EVENTS (${first.pending} pending, 0 events read)`
  return `NONE-MATCHED (${first.pending} pending, ${first.eventsRead} events read, ambiguous ${first.ambiguous}, refusedKickoff ${first.refusedKickoff}, unmatched ${Array.isArray(first.unmatched) ? first.unmatched.length : 'not reported'})`
}

if (process.argv.includes('--self-test')) {
  let bad = 0
  const eq = (label, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${got}${ok ? '' : ` (wanted ${want})`}`) }
  const head = s => s.split(/[ :(]/)[0]
  eq('a 401 is a refused route, not a failed read', head(classify({ status: 401, ok: false })), 'ROUTE-REFUSED')
  eq('ok:false is a failed pass, with its reason', classify({ status: 502, ok: false, reason: 'BSD events for 2026-11-07 not fully read; nothing written' }), 'PASS-FAILED: BSD events for 2026-11-07 not fully read; nothing written')
  eq('pending 0 is nothing pending, not a join', head(classify({ status: 200, ok: true, pending: 0, written: 0 })), 'NOTHING-PENDING')
  eq('written > 0 is a join', head(classify({ status: 200, ok: true, pending: 34, written: 34, eventsRead: 60 })), 'JOINED')
  eq('pending with no events read is BSD having none', head(classify({ status: 200, ok: true, pending: 34, written: 0, eventsRead: 0 })), 'BSD-HAS-NO-EVENTS')
  eq('pending with events read and no write is none matched', head(classify({ status: 200, ok: true, pending: 34, written: 0, eventsRead: 60, ambiguous: 0, refusedKickoff: 0, unmatched: ['a'] })), 'NONE-MATCHED')
  eq('an absent eventsRead is not read as events present', head(classify({ status: 200, ok: true, pending: 3, written: 0 })), 'BSD-HAS-NO-EVENTS')
  console.log(bad ? `\n${bad} FAILED` : '\nself-test: 7/7')
  process.exit(bad ? 1 : 0)
}

const secret = process.env.RELAY_SHARED_SECRET
if (!secret) { console.error('RELAY_SHARED_SECRET is not set'); process.exit(2) }
const iA = process.argv.indexOf('--dates')
const dates = iA > 0 ? process.argv[iA + 1].split(',') : [getFieldDateKey()]

const post = async date => {
  const r = await fetch(`${RELAY}/admin/bsd-game-join`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': secret }, body: JSON.stringify({ date }), signal: AbortSignal.timeout(60_000) })
  const text = await r.text()
  let body
  try { body = JSON.parse(text) } catch (e) { body = { ok: false, raw: text.slice(0, 200), parseError: e.message } }
  return { status: r.status, ...body }
}
const context = async date => {
  const r = await fetch(`${RELAY}/context/date/${date}`, { signal: AbortSignal.timeout(30_000) })
  if (!r.ok) return { status: r.status, rows: null }
  const j = await r.json()
  // Both arrays or no rows: a missing one is reported as unread (rows null), never read as an empty day.
  if (!Array.isArray(j.games?.regular) || !Array.isArray(j.games?.postseason)) return { status: r.status, rows: null }
  return { status: r.status, rows: [...j.games.regular, ...j.games.postseason] }
}

const out = { at: new Date().toISOString(), relay: RELAY, dates: {} }
for (const date of dates) {
  const before = await context(date)
  const first = await post(date)
  const after = await context(date)
  const second = await post(date)
  const tally = c => {
    if (!c.rows) return { read: false, status: c.status }
    const soccer = c.rows.filter(r => BSD_SOCCER_SPORTS.includes(r.sport))
    const by = {}
    for (const r of soccer) { (by[r.sport] ||= { rows: 0, joined: 0 }).rows++; if (r.bsd_event_id) by[r.sport].joined++ }
    return { read: true, contextRows: c.rows.length, soccerRows: soccer.length, joined: soccer.filter(r => r.bsd_event_id).length, bySport: by }
  }
  out.dates[date] = {
    verdict: classify(first),
    firstRun: { status: first.status, ok: first.ok, pending: first.pending, written: first.written, joined: first.joined, ambiguous: first.ambiguous, refusedKickoff: first.refusedKickoff, unjudgedKickoff: first.unjudgedKickoff, eventsRead: first.eventsRead, upstreamPages: first.upstreamPages, cacheHits: first.cacheHits, reason: first.reason, unmatched: first.unmatched },
    secondRun: { status: second.status, ok: second.ok, pending: second.pending, written: second.written },
    before: tally(before), after: tally(after),
  }
  const d = out.dates[date]
  console.log(`${date}  ${d.verdict}`)
  console.log(`   soccer rows joined ${d.before.joined ?? '?'} -> ${d.after.joined ?? '?'} of ${d.after.soccerRows ?? '?'} (context ${d.after.contextRows ?? '?'} rows)`)
  console.log(`   second run wrote ${second.written} (must be 0)   unmatched: ${JSON.stringify(first.unmatched)}`)
}
out.coverage = `${dates.length} date(s): ${dates.join(', ')}; each read from /context/date before and after one admin-route pass, plus a second pass to prove the IS NULL scope`
console.log(`COVERAGE: ${out.coverage}`)
mkdirSync('outbox', { recursive: true })
writeFileSync(`outbox/probe-bsd-join-today-${out.at.replace(/[:.]/g, '-')}.json`, JSON.stringify(out, null, 2))
