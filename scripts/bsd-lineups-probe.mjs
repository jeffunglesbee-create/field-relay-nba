#!/usr/bin/env node
// docs/CC-CMD-2026-10-10-bsd-predicted-lineups.md — Tasks 3 and 4.
//
// Task 3: the INNER shape of `lineups` and `unavailable_players` at PRE-MATCH.
// The surface probe recorded top-level keys only, and the 10-03 sub-field list
// came from a FINISHED event. This document's whole premise is that pre-match
// differs from finished, so the finished shape must not be assumed. The odds
// measurement in the same artifact is the standing warning: pre-match and live
// differed in exactly the field that mattered.
//
// Task 4: the non-null rate for `unavailable_players[].reason`, WITH a
// denominator. Two samples in the repo disagree about whether that field is
// even there — event 605110 carried `reason`, event 375055 carried `home`/`away`
// only — so a rate with no denominator cannot be told from a rate of zero.
//
// THE EVENT IS DISCOVERED, NOT HARDCODED. The artifact's pre-match event 220230
// was pre-match on 2026-10-10 and has since been played; a probe that reused it
// would measure a finished event while reporting on pre-match.

import { writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const BASE = 'https://sports.bzzoiro.com'
export const CALL_BUDGET = 24

// Four states, never collapsed. A missing lineup_status must NOT default to
// `predicted` or to `confirmed` (Rule 99).
export const lineupState = ({ ok, body }) => {
  if (!ok) return 'call-failed'
  const st = body?.lineup_status
  if (st === undefined || st === null || st === '') return 'status-absent'
  if (st === 'predicted') return body?.beta === true ? 'predicted-beta' : 'predicted-not-beta'
  if (st === 'confirmed') return 'confirmed'
  return `status-unrecognised:${st}`
}

// Served and empty is a THIRD thing — not a 404 and not a team sheet.
export const lineupsFill = (body) => {
  const l = body?.lineups
  if (l === undefined) return 'absent'
  if (l === null) return 'null'
  if (Array.isArray(l)) return l.length === 0 ? 'served-empty' : `array:${l.length}`
  if (typeof l === 'object') {
    const k = Object.keys(l)
    if (k.length === 0) return 'served-empty'
    return `object:${k.sort().join(',')}`
  }
  return `scalar:${typeof l}`
}

// Walks any nesting and returns dotted key paths, so "the inner shape" is
// reported rather than guessed at one level.
export const keyPaths = (v, prefix = '', depth = 0, out = new Set()) => {
  if (depth > 4 || v === null || typeof v !== 'object') return out
  if (Array.isArray(v)) {
    if (v.length) keyPaths(v[0], `${prefix}[]`, depth + 1, out)
    return out
  }
  for (const k of Object.keys(v)) {
    const p = prefix ? `${prefix}.${k}` : k
    out.add(p)
    keyPaths(v[k], p, depth + 1, out)
  }
  return out
}

// Task 4's rate, with its denominator, and the absent case kept separate from
// the empty one.
export const reasonRate = (bodies) => {
  let players = 0, withReasonKey = 0, nonNullReason = 0, eventsWithList = 0, eventsWithoutList = 0
  const shapes = new Set()
  for (const b of bodies) {
    const up = b?.unavailable_players
    if (!up || (Array.isArray(up) && up.length === 0) || (typeof up === 'object' && !Array.isArray(up) && Object.keys(up).length === 0)) {
      eventsWithoutList += 1
      continue
    }
    eventsWithList += 1
    const lists = Array.isArray(up) ? [up] : Object.values(up).filter(Array.isArray)
    if (!Array.isArray(up)) shapes.add(Object.keys(up).sort().join(','))
    for (const list of lists) for (const p of list) {
      players += 1
      if (p && Object.prototype.hasOwnProperty.call(p, 'reason')) {
        withReasonKey += 1
        if (p.reason !== null && p.reason !== '') nonNullReason += 1
      }
    }
  }
  return {
    events_with_a_list: eventsWithList,
    events_without_a_list: eventsWithoutList,
    players_total: players,
    players_carrying_a_reason_KEY: withReasonKey,
    players_with_a_NON_NULL_reason: nonNullReason,
    // A rate with no denominator cannot be told from a rate of zero.
    non_null_reason_rate: players ? +(nonNullReason / players).toFixed(4) : null,
    rate_denominator: players,
    container_shapes_seen: [...shapes],
    note: players === 0
      ? 'NO unavailable players were returned at all, so the rate is UNMEASURED, not zero'
      : 'rate is over named players across the sampled events',
  }
}

const get = async (path, token, calls) => {
  calls.n += 1
  try {
    const r = await fetch(`${BASE}${path}`, {
      headers: { 'Authorization': `Token ${token}`, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(25000),
    })
    const text = await r.text()
    let body = null
    try { body = JSON.parse(text) } catch (_) {}
    return { ok: r.ok, status: r.status, body }
  } catch (e) { return { ok: false, status: 0, error: String(e && e.message || e), body: null } }
}

const main = async () => {
  const token = process.env.BSD_API_TOKEN
  if (!token) { console.error('FAIL: BSD_API_TOKEN absent — every answer would be UNKNOWN, not empty.'); process.exit(1) }
  const started = new Date().toISOString()
  const calls = { n: 0 }
  const dayArg = process.argv.find(a => a.startsWith('--date='))
  const day = dayArg ? dayArg.slice(7) : started.slice(0, 10)

  // Discover pre-match events for the day rather than reusing a stale id.
  const list = await get(`/api/v2/events/?date_from=${day}&date_to=${day}&limit=100`, token, calls)
  const rows = list.body?.results || list.body?.data || (Array.isArray(list.body) ? list.body : [])
  const preMatch = rows.filter(r => String(r?.status ?? '').toLowerCase() === 'notstarted')
  const finished = rows.filter(r => String(r?.status ?? '').toLowerCase() === 'finished')

  const sample = [
    ...preMatch.slice(0, 8).map(r => ({ id: r.id ?? r.event_id, state: 'pre-match' })),
    ...finished.slice(0, 3).map(r => ({ id: r.id ?? r.event_id, state: 'finished' })),
  ].filter(x => x.id)

  const perEvent = []
  const bodiesPre = []
  for (const s of sample) {
    if (calls.n >= CALL_BUDGET) break
    const r = await get(`/api/v2/events/${s.id}/lineups/`, token, calls)
    if (s.state === 'pre-match' && r.ok) bodiesPre.push(r.body)
    perEvent.push({
      eventId: s.id,
      declaredState: s.state,
      status: r.status,
      lineupState: lineupState(r),
      lineup_status: r.body?.lineup_status ?? null,
      beta: r.body?.beta ?? null,
      updated_at: r.body?.updated_at ?? null,
      lineupsFill: lineupsFill(r.body),
      topLevelKeys: r.body && typeof r.body === 'object' ? Object.keys(r.body).sort() : [],
      innerKeyPaths: r.ok ? [...keyPaths(r.body)].sort().slice(0, 120) : [],
    })
  }

  const preRows = perEvent.filter(e => e.declaredState === 'pre-match')
  const out = {
    cc_cmd: 'docs/CC-CMD-2026-10-10-bsd-predicted-lineups.md',
    tasks: 'Tasks 3 and 4 — the inner shape at PRE-MATCH, and the reason rate with a denominator',
    started_at: started, date_probed: day,
    callBudget: CALL_BUDGET, callsMade: calls.n,
    discovery: { listStatus: list.status, rowsSeen: rows.length, preMatchSeen: preMatch.length, finishedSeen: finished.length },
    stateCounts: perEvent.reduce((a, e) => { a[e.lineupState] = (a[e.lineupState] || 0) + 1; return a }, {}),
    lineupsFillCounts: perEvent.reduce((a, e) => { a[e.lineupsFill] = (a[e.lineupsFill] || 0) + 1; return a }, {}),
    perEvent,
    task4_reason: reasonRate(bodiesPre),
    coverage: `${preRows.length} pre-match event(s) and ${perEvent.length - preRows.length} finished, on ${day}. `
            + `Not a survey of the vendor's policy — a pre-match shape claim rests on these ${preRows.length} events.`,
  }

  mkdirSync('outbox', { recursive: true })
  const ts = started.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  writeFileSync(`outbox/bsd-lineups-probe-${ts}.json`, JSON.stringify(out, null, 2))
  writeFileSync('outbox/bsd-lineups-probe-latest.json', JSON.stringify(out, null, 2))
  console.log(`wrote outbox/bsd-lineups-probe-${ts}.json`)
  console.log(`callsMade ${calls.n} of ${CALL_BUDGET}`)
  console.log(`states: ${JSON.stringify(out.stateCounts)}`)
  console.log(`lineups fill: ${JSON.stringify(out.lineupsFillCounts)}`)
  console.log(`reason: ${JSON.stringify(out.task4_reason)}`)
  console.log(out.coverage)
}

const _entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
const _isEntry = _entryHref !== null && import.meta.url === _entryHref

const selfTest = () => {
  let pass = 0, fail = 0
  const t = (n, c) => { if (c) { pass++; console.log(`PASS  ${n}`) } else { fail++; console.log(`FAIL  ${n}`) } }

  t('a predicted lineup flagged beta is its own state',
    lineupState({ ok: true, body: { lineup_status: 'predicted', beta: true } }) === 'predicted-beta')
  t('PREDICTED WITHOUT beta IS NOT THE SAME STATE — the flag is the feature',
    lineupState({ ok: true, body: { lineup_status: 'predicted', beta: false } }) === 'predicted-not-beta')
  t('confirmed is confirmed', lineupState({ ok: true, body: { lineup_status: 'confirmed', beta: false } }) === 'confirmed')
  t('AN ABSENT lineup_status DEFAULTS TO NEITHER predicted NOR confirmed',
    lineupState({ ok: true, body: {} }) === 'status-absent'
    && lineupState({ ok: true, body: { lineup_status: null } }) === 'status-absent')
  t('a failed call is its own fourth state',
    lineupState({ ok: false, body: null }) === 'call-failed')
  t('an unrecognised status is reported verbatim rather than mapped',
    lineupState({ ok: true, body: { lineup_status: 'provisional' } }) === 'status-unrecognised:provisional')

  t('SERVED AND EMPTY IS A THIRD THING, not absent and not a team sheet',
    lineupsFill({ lineups: [] }) === 'served-empty' && lineupsFill({ lineups: {} }) === 'served-empty')
  t('absent and null are distinguished from each other',
    lineupsFill({}) === 'absent' && lineupsFill({ lineups: null }) === 'null')
  t('a populated lineups object reports its keys',
    lineupsFill({ lineups: { home: 1, away: 2 } }) === 'object:away,home')

  t('key paths walk into nesting rather than stopping at the top',
    (() => {
      const p = [...keyPaths({ a: { b: { c: 1 } }, d: 2 })]
      return p.includes('a.b.c') && p.includes('d')
    })())
  t('an array reports its element shape with a [] marker',
    [...keyPaths({ players: [{ name: 'x', reason: 'y' }] })].includes('players[].reason'))

  t('the reason rate carries its denominator',
    (() => {
      const r = reasonRate([{ unavailable_players: { home: [{ name: 'a', reason: 'knock' }, { name: 'b', reason: null }], away: [] } }])
      return r.rate_denominator === 2 && r.players_with_a_NON_NULL_reason === 1 && r.non_null_reason_rate === 0.5
    })())
  t('NO unavailable players yields UNMEASURED, never a rate of zero',
    (() => {
      const r = reasonRate([{ unavailable_players: [] }, {}])
      return r.non_null_reason_rate === null && /UNMEASURED, not zero/.test(r.note) && r.events_without_a_list === 2
    })())
  t('a player carrying the reason KEY but a null value is counted separately from one carrying none',
    (() => {
      const r = reasonRate([{ unavailable_players: { home: [{ name: 'a', reason: null }, { name: 'b' }] } }])
      return r.players_carrying_a_reason_KEY === 1 && r.players_with_a_NON_NULL_reason === 0 && r.rate_denominator === 2
    })())
  t('an array-shaped unavailable_players is handled as well as an object-shaped one',
    reasonRate([{ unavailable_players: [{ name: 'a', reason: 'ill' }] }]).rate_denominator === 1)

  console.log(`\n${pass}/${pass + fail} checks passed`)
  if (fail) process.exit(1)
}

if (_isEntry) {
  if (process.argv.includes('--self-test')) selfTest()
  else main().catch(e => { console.error(String(e && e.stack || e)); process.exit(1) })
}
