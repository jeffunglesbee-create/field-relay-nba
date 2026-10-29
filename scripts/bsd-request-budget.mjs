#!/usr/bin/env node
// What does one BSD request cost, and how much of the day is already spent?
// docs/CC-CMD-2026-10-29-bsd-live-shot-source.md, Task 0.
//
// THE PREMISE THIS REPLACES. outbox/cc-session-2026-10-10-bsd-measure-before-building.md, Task 5, concluded
// "no rate-limit header exists" from 16 calls. That probe looked for x-ratelimit-*, ratelimit-limit /
// -remaining / -reset and retry-after. BSD's own pricing page (fetched 2026-10-29) documents a different
// shape: the IETF structured-field pair
//     RateLimit: "tennis";r=87;t=52800            r = left, t = seconds until the counter resets
//     RateLimit-Policy: "tennis";q=7500;w=86400   q = allowance, w = window in seconds
// which none of those names match. The 2026-10-10 absence may be a miss of the name, not of the header.
// This script captures EVERY response header, so the answer cannot depend on which names were guessed.
//
// WHAT IT MEASURES, from the vendor and not from a doc:
//   - the allowance (q, w) and what is left (r, t), per named counter
//   - what a request costs: the same call twice, and a different call, with r read after each
//   - what is already spent today by ALL callers of this token (q - r), and so the average calls/minute so far
//   - how many tracked (websocket_plus) matches are live now and how many kick off today, so a design that
//     polls once per subscribed live match can be sized
// WHAT IT DOES NOT: it never provokes a 429. The documented ceiling is 10 requests/second per IP with burst
// (sports.bzzoiro.com/llms.txt, 2026-10-29); this makes at most CALL_BUDGET requests, GAP_MS apart (< 1/s).
// Rule 78: the budget is the first constant in the file and the run stops at it.
//
// Modes: --self-test | --mutate | --check FILE | (default) run on a runner, BSD_API_TOKEN required.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const BASE = 'https://sports.bzzoiro.com'
export const CALL_BUDGET = 6
export const GAP_MS = 1200
export const ARTIFACT = 'outbox/bsd-request-budget-latest.json'
/** ASSUMPTION, not a measurement: how long a tracked match occupies a live subscription, kickoff to the
 *  last frame. 45 + 15 + 45 + stoppage. Used only to size peak concurrency, and printed as an assumption. */
export const MATCH_MINUTES = 115

// ------------------------------------------------------------------ parsing
/** A structured-field list of named items: `"name";k=1;k2=2, "other";k=3`. Names are quoted and carry no comma.
 *  Returns null for an ABSENT header and { unparsed } for one that is present and not in this shape: two
 *  different facts (Rule 99). */
export function parseItems (raw) {
  if (raw === undefined || raw === null) return null
  const items = []
  for (const part of String(raw).split(',')) {
    const segs = part.trim().split(';')
    const m = /^"([^"]*)"$/.exec(segs[0].trim())
    if (!m) return { unparsed: String(raw) }
    const item = { name: m[1] }
    for (const kv of segs.slice(1)) {
      const p = /^\s*([a-z]+)=(-?\d+)\s*$/.exec(kv)
      if (!p) return { unparsed: String(raw) }
      item[p[1]] = Number(p[2])
    }
    items.push(item)
  }
  return items
}
export const parseRateLimit = (raw) => parseItems(raw)   // r, t
export const parsePolicy = (raw) => parseItems(raw)      // q, w

const isItems = (v) => Array.isArray(v)

/** Pick the counter named `name` out of a parsed list. */
export const counter = (items, name) => (isItems(items) ? items.find(i => i.name === name) : undefined)

// ------------------------------------------------------------------ analysis
/** From the ordered authenticated calls, what the vendor says. Pure: takes records, returns a verdict. */
export function analyse (calls) {
  const auth = calls.filter(c => c.authenticated && c.status === 200)
  const withRl = auth.filter(c => isItems(c.rateLimit))
  const names = new Set()
  for (const c of withRl) for (const i of c.rateLimit) names.add(i.name)
  const out = { authenticatedCalls: auth.length, callsWithRateLimit: withRl.length, counters: {}, verdict: null }
  if (auth.length === 0) { out.verdict = 'NO-AUTHENTICATED-CALL'; return out }
  const unparsed = auth.filter(c => c.rateLimit && !isItems(c.rateLimit))
  if (withRl.length === 0) { out.verdict = unparsed.length ? 'HEADER-UNPARSED' : 'NO-HEADER'; return out }

  for (const name of [...names].sort()) {
    const seq = withRl.map(c => ({ id: c.id, path: c.path, r: counter(c.rateLimit, name)?.r, t: counter(c.rateLimit, name)?.t,
                                   q: counter(c.policy, name)?.q, w: counter(c.policy, name)?.w })).filter(s => Number.isFinite(s.r))
    const deltas = []
    for (let i = 1; i < seq.length; i++) deltas.push({ from: seq[i - 1].id, to: seq[i].id, cost: seq[i - 1].r - seq[i].r })
    const q = seq.find(s => Number.isFinite(s.q))?.q
    const w = seq.find(s => Number.isFinite(s.w))?.w
    const first = seq[0]
    out.counters[name] = { allowance: q ?? null, windowSeconds: w ?? null, sequence: seq, deltas,
      monotonic: deltas.every(d => d.cost >= 0),
      // r after the FIRST call; whether r counts that call is read from the deltas, not assumed
      spentByAllCallers: Number.isFinite(q) ? q - first.r : null }
  }
  const all = Object.values(out.counters)
  if (all.some(c => !c.monotonic)) out.verdict = 'NON-MONOTONIC'
  else if (all.every(c => c.allowance === null)) out.verdict = 'REMAINING-ONLY'
  else out.verdict = 'POLICY-KNOWN'
  return out
}

/** Minutes since 00:00 UTC of a response's own `date` header: the counter resets at midnight UTC. */
export function minutesIntoUtcDay (dateHeader) {
  const d = new Date(dateHeader)
  if (Number.isNaN(d.getTime())) return null
  return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60
}

/** Peak number of tracked matches whose [kickoff, kickoff + minutes] windows overlap. An ASSUMPTION on length. */
export function peakConcurrent (kickoffs, minutes = MATCH_MINUTES) {
  const ev = []
  for (const k of kickoffs) { const t = Date.parse(k); if (Number.isFinite(t)) { ev.push([t, 1]); ev.push([t + minutes * 60000, -1]) } }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let cur = 0, peak = 0
  for (const [, d] of ev) { cur += d; if (cur > peak) peak = cur }
  return peak
}

/** The tracked-match counts out of /api/v2/events/ rows. `truncated` says the page did not hold the day. */
export function trackedOf (body) {
  if (!body || !Array.isArray(body.results)) return { error: 'no results array' }
  const rows = body.results
  const tracked = rows.filter(r => r.websocket_plus === true && r.live_websocket === true)
  return { listed: rows.length, count: body.count, truncated: Number.isFinite(body.count) ? rows.length < body.count : null,
           trackedToday: tracked.length, liveTrackedNow: tracked.filter(r => r.status === 'live').length,
           peakConcurrentAssumed: peakConcurrent(tracked.map(r => r.event_date)), assumedMatchMinutes: MATCH_MINUTES }
}

/** Rule 91: the denominator, where the result is read. */
export const coverageLine = (art) =>
  `COVERAGE: ${art.callsMade} of budget ${CALL_BUDGET} calls (${art.analysis.authenticatedCalls} authenticated, ${art.analysis.callsWithRateLimit} carried a RateLimit header); ` +
  `header names seen: ${art.headerNamesSeen.length}; verdict ${art.analysis.verdict}; one token, one IP (a runner), one moment (${art.generated_at}).`

// ------------------------------------------------------------------ self-test
const mkCall = (id, rl, policy, extra = {}) => ({ id, path: '/x', authenticated: true, status: 200, rateLimit: parseRateLimit(rl), policy: parsePolicy(policy), ...extra })

function selfTest () {
  let failed = 0
  const check = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failed++ }

  check('absent header is null, not empty', parseItems(undefined) === null && parseItems(null) === null)
  const a = parseRateLimit('"tennis";r=87;t=52800')
  check('the documented RateLimit example parses', a?.[0]?.name === 'tennis' && a[0].r === 87 && a[0].t === 52800)
  const p = parsePolicy('"football";q=7500;w=86400')
  check('the policy parses', p?.[0]?.q === 7500 && p[0].w === 86400)
  const m = parseRateLimit('"burst";r=9;t=1, "daily";r=7000;t=40000')
  check('two counters in one header parse', m?.length === 2 && m[1].name === 'daily' && m[1].r === 7000)
  check('a present header in another shape is unparsed, not absent and not empty',
        parseRateLimit('87')?.unparsed === '87' && parseRateLimit('"a";r=x')?.unparsed !== undefined && parseRateLimit('limit=1000, remaining=9')?.unparsed !== undefined)
  check('a zero is a number, not a gap', parseRateLimit('"d";r=0;t=5')[0].r === 0)

  const good = [mkCall('c1', '"football";r=7000;t=40000', '"football";q=7500;w=86400'),
                mkCall('c2', '"football";r=6999;t=39999', '"football";q=7500;w=86400'),
                mkCall('c3', '"football";r=6998;t=39998', '"football";q=7500;w=86400')]
  const g = analyse(good)
  check('policy known, three calls, cost 1 each', g.verdict === 'POLICY-KNOWN' && g.counters.football.deltas.every(d => d.cost === 1))
  check('spent by all callers = allowance - remaining after the first call', g.counters.football.spentByAllCallers === 500)
  check('a repeat that costs nothing is visible as 0', analyse([good[0], mkCall('c2', '"football";r=7000;t=39999', '"football";q=7500;w=86400')]).counters.football.deltas[0].cost === 0)

  check('MUTATION: no RateLimit header anywhere is NO-HEADER, not POLICY-KNOWN',
        analyse(good.map(c => ({ ...c, rateLimit: null }))).verdict === 'NO-HEADER')
  check('MUTATION: a header in another shape is HEADER-UNPARSED, not NO-HEADER',
        analyse(good.map(c => ({ ...c, rateLimit: { unparsed: 'x' } }))).verdict === 'HEADER-UNPARSED')
  check('MUTATION: remaining that goes UP is NON-MONOTONIC',
        analyse([good[0], mkCall('c2', '"football";r=7100;t=39999', '"football";q=7500;w=86400')]).verdict === 'NON-MONOTONIC')
  check('MUTATION: no policy header is REMAINING-ONLY and the spend is null, not 0',
        (() => { const r = analyse(good.map(c => ({ ...c, policy: null }))); return r.verdict === 'REMAINING-ONLY' && r.counters.football.spentByAllCallers === null })())
  check('MUTATION: a 401 call is not counted as authenticated data',
        analyse(good.map(c => ({ ...c, status: 401 }))).verdict === 'NO-AUTHENTICATED-CALL')
  check('a token-free call does not feed the counter',
        analyse([...good, mkCall('c4', '"football";r=1;t=1', '"football";q=7500;w=86400', { authenticated: false })]).counters.football.sequence.length === 3)

  check('minutes into the UTC day, from the response date', minutesIntoUtcDay('Thu, 29 Oct 2026 16:30:30 GMT') === 16 * 60 + 30.5)
  check('a bad date is null', minutesIntoUtcDay('nope') === null)
  check('peak concurrency: three overlapping, one apart', peakConcurrent(['2026-10-29T18:00:00Z', '2026-10-29T18:30:00Z', '2026-10-29T19:00:00Z', '2026-10-29T23:00:00Z']) === 3)
  check('...and a shorter assumed length lowers it', peakConcurrent(['2026-10-29T18:00:00Z', '2026-10-29T19:00:00Z'], 30) === 1)
  const body = { count: 5, results: [
    { websocket_plus: true, live_websocket: true, status: 'live', event_date: '2026-10-29T18:00:00Z' },
    { websocket_plus: true, live_websocket: false, status: 'live', event_date: '2026-10-29T18:00:00Z' },
    { websocket_plus: true, live_websocket: true, status: 'upcoming', event_date: '2026-10-29T20:00:00Z' }] }
  const t = trackedOf(body)
  check('tracked needs BOTH flags; live-now is a subset of tracked', t.trackedToday === 2 && t.liveTrackedNow === 1)
  check('a page shorter than the count says it is truncated', t.truncated === true && trackedOf({ count: 3, results: body.results }).truncated === false)
  check('no results array is an error, not zero matches', trackedOf({}).error === 'no results array' && trackedOf(null).error === 'no results array')

  console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${failed === 0 ? 'all' : failed + ' failed of'} self-tests`)
  return failed
}

// ------------------------------------------------------------------ mutate (Rule 90)
// Break the analysis input and require the verdict or number to MOVE. A mutation that moves nothing is reported
// as not applied, never as caught.
function mutate () {
  const base = [mkCall('c1', '"football";r=7000;t=40000', '"football";q=7500;w=86400'),
                mkCall('c2', '"football";r=6999;t=39999', '"football";q=7500;w=86400'),
                mkCall('c3', '"football";r=6998;t=39998', '"football";q=7500;w=86400')]
  const ref = analyse(base)
  if (ref.verdict !== 'POLICY-KNOWN' || ref.counters.football.spentByAllCallers !== 500) { console.log('BASELINE WRONG — every mutation would look caught'); return 1 }
  const muts = [
    ['RateLimit header stripped', (c) => c.map(x => ({ ...x, rateLimit: null })), (r) => r.verdict !== ref.verdict],
    ['policy stripped', (c) => c.map(x => ({ ...x, policy: null })), (r) => r.counters.football.spentByAllCallers !== 500],
    ['allowance altered', (c) => c.map(x => ({ ...x, policy: parsePolicy('"football";q=100;w=86400') })), (r) => r.counters.football.spentByAllCallers !== 500],
    ['remaining reversed', (c) => [c[2], c[1], c[0]], (r) => r.verdict === 'NON-MONOTONIC'],
    ['counter renamed on the second call only', (c) => [c[0], mkCall('c2', '"other";r=6999;t=1', '"other";q=1;w=1'), c[2]], (r) => Object.keys(r.counters).length === 2],
  ]
  let bad = 0
  for (const [name, fn, caught] of muts) {
    const m = fn(base)
    const applied = JSON.stringify(m) !== JSON.stringify(base)
    const r = analyse(m)
    const ok = applied && caught(r)
    console.log(`mutation: ${name}\n    applied: ${applied}   caught: ${applied ? ok : 'n/a'}`)
    if (!ok) bad++
  }
  console.log(bad === 0 ? '\nOK — all mutations applied and caught' : `\nFAILED — ${bad} mutation(s) not caught or not applied`)
  return bad === 0 ? 0 : 1
}

// ------------------------------------------------------------------ check an artifact offline
function checkArtifact (file) {
  const a = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(a.calls)) { console.log(`FAIL: ${file} has no calls array`); return 1 }
  const again = analyse(a.calls)
  console.log(coverageLine(a))
  if (again.verdict !== a.analysis.verdict) { console.log(`FAIL: artifact says ${a.analysis.verdict}, its own calls say ${again.verdict}`); return 1 }
  console.log(`artifact ${file}: verdict ${again.verdict} re-derived from ${a.calls.length} stored calls`)
  return 0
}

// ------------------------------------------------------------------ run
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const todayUtc = () => new Date().toISOString().slice(0, 10)

async function one (spec, token) {
  const headers = { 'User-Agent': 'FIELD/1.0', Accept: 'application/json' }
  if (spec.authenticated) headers.Authorization = `Token ${token}`
  const url = `${BASE}${spec.path}`
  const at = new Date().toISOString()
  try {
    const r = await fetch(url, { headers })
    const text = await r.text()
    const hdr = {}
    r.headers.forEach((v, k) => { hdr[k] = k === 'set-cookie' ? '[present]' : v })
    let body = null, bodyError = null
    try { body = JSON.parse(text) } catch (e) { bodyError = String(e.message).split('\n')[0] }
    return { id: spec.id, path: spec.path, authenticated: spec.authenticated, at, status: r.status, bodyBytes: text.length, bodyError,
             headers: hdr, date: hdr.date, rateLimit: parseRateLimit(hdr.ratelimit), policy: parsePolicy(hdr['ratelimit-policy']),
             retryAfter: hdr['retry-after'] ?? null, _body: body }
  } catch (e) {
    return { id: spec.id, path: spec.path, authenticated: spec.authenticated, at, status: null, error: String(e?.message || e), headers: {}, rateLimit: null, policy: null, _body: null }
  }
}

async function run () {
  const token = process.env.BSD_API_TOKEN
  if (!token) { console.error('BSD_API_TOKEN is not set'); return 2 }
  const day = todayUtc()
  const specs = [
    { id: 'live-1', path: '/api/v2/events/live/', authenticated: true },
    { id: 'live-2', path: '/api/v2/events/live/', authenticated: true },           // the same call again: does a repeat cost the same?
    { id: 'stats-1', path: '/api/v2/events/602347/stats/', authenticated: true },  // the route a live-shot poll would call, on a finished event
    { id: 'stats-2', path: '/api/v2/events/602347/stats/', authenticated: true },
    { id: 'day', path: `/api/v2/events/?date_from=${day}&date_to=${day}&limit=200`, authenticated: true },
    { id: 'coverage-notoken', path: '/api/v2/coverage/', authenticated: false },   // documented token-free: does it touch the counter?
  ]
  if (specs.length > CALL_BUDGET) { console.error(`the plan has ${specs.length} calls, over the budget of ${CALL_BUDGET}`); return 2 }
  const calls = []
  for (const s of specs) { calls.push(await one(s, token)); await sleep(GAP_MS) }

  const names = new Set()
  for (const c of calls) for (const k of Object.keys(c.headers)) names.add(k)
  const analysis = analyse(calls)
  const first = calls.find(c => c.authenticated && c.status === 200)
  const mins = first ? minutesIntoUtcDay(first.date) : null
  for (const n of Object.keys(analysis.counters)) {
    const c = analysis.counters[n]
    c.minutesIntoUtcDayAtFirstCall = mins
    c.averageCallsPerMinuteSoFarToday = (Number.isFinite(c.spentByAllCallers) && Number.isFinite(mins) && mins > 0) ? Math.round(c.spentByAllCallers / mins * 100) / 100 : null
  }
  const dayCall = calls.find(c => c.id === 'day')
  const tracked = dayCall && dayCall.status === 200 ? trackedOf(dayCall._body) : { error: `day call ${dayCall ? 'HTTP ' + dayCall.status : 'missing'}` }
  const tokenFree = calls.find(c => c.id === 'coverage-notoken')
  const art = {
    generated_at: new Date().toISOString(), base: BASE, callBudget: CALL_BUDGET, callsMade: calls.length, gapMs: GAP_MS,
    verifiedOn: { date: day, method: 'GET with the relay token from a GitHub Actions runner, headers captured in full', conditions: 'free-tier football token, one runner IP, one moment' },
    docClaims: { source: 'sports.bzzoiro.com/llms.txt and /pricing/, fetched 2026-10-29', perIpCeiling: '10 requests/second per IP, with burst',
                 freeDaily: '7,500 per day, resets at midnight UTC (pricing table); "100 req/day" also appears on the same page, unattributed',
                 headerShape: 'RateLimit: "name";r=N;t=SECONDS (pricing page); a claim until the headers below say so' },
    headerNamesSeen: [...names].sort(), analysis, tracked,
    tokenFreeTouchedCounter: tokenFree && tokenFree.status === 200 ? isItems(tokenFree.rateLimit) : null,
    calls: calls.map(({ _body, ...c }) => c),
  }
  console.log(coverageLine(art))
  for (const [n, c] of Object.entries(analysis.counters)) {
    console.log(`  counter "${n}": allowance ${c.allowance} per ${c.windowSeconds} s; remaining after call 1: ${c.sequence[0].r}; spent by all callers so far today: ${c.spentByAllCallers}; ` +
                `avg ${c.averageCallsPerMinuteSoFarToday}/min over ${mins === null ? '?' : mins.toFixed(1)} min; per-call cost ${c.deltas.map(d => `${d.to}:${d.cost}`).join(' ')}`)
  }
  console.log(`  tracked matches: ${JSON.stringify(tracked)}`)
  console.log(`  header names seen across ${calls.length} calls: ${art.headerNamesSeen.join(', ')}`)
  writeFileSync(ARTIFACT, JSON.stringify(art, null, 2) + '\n')
  return analysis.verdict === 'POLICY-KNOWN' ? 0 : 3
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) process.exit(selfTest())
  else if (argv.includes('--mutate')) process.exit(mutate())
  else if (argv.includes('--check')) process.exit(checkArtifact(argv[argv.indexOf('--check') + 1]))
  else run().then(c => process.exit(c), e => { console.error(e); process.exit(1) })
}
