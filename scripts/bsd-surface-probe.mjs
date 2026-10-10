#!/usr/bin/env node
// docs/CC-CMD-2026-10-10-bsd-measure-before-building.md — five tasks, one run,
// one artifact, a declared call budget.
//
// PROBE ONLY. No feature ships from this file. It answers questions; four
// separate CC-CMDs can then be written against numbers instead of premises.
//
// BSD's FIELD NAMES ARE REPORTED VERBATIM. Mapping them to FIELD's vocabulary
// is a later decision, and doing it here would hide the evidence — a key
// renamed in the artifact cannot be checked against the vendor's docs.

import { writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const BASE = 'https://sports.bzzoiro.com'
export const CALL_BUDGET = 40

// ── rate limits (Task 5) ────────────────────────────────────────────────────
/** Every header worth capturing. A header is a measurement; a doc is a claim. */
// RATE-LIMIT headers and CACHE headers are captured separately. Lumping them
// together made the artifact read "rate-limit headers observed:
// {x-cache-status, cf-cache-status}" on a run where NOT ONE rate-limit header
// came back — a cache header answering a question about rate limits, which is
// the exact substitution this CC-CMD was written to stop.
export const RATE_HEADERS = [
  'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
  'x-ratelimit-used', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset',
  'retry-after',
]
export const CACHE_HEADERS = ['x-cache-status', 'x-cache', 'cf-cache-status']
export const pick = (hdrs, names) => {
  const out = {}
  for (const k of names) if (hdrs[k] != null) out[k] = hdrs[k]
  return out
}
export const rateHeadersOf = (hdrs) => pick(hdrs, RATE_HEADERS)
export const cacheHeadersOf = (hdrs) => pick(hdrs, CACHE_HEADERS)

/** The finding, which must be about RATE LIMITS even when cache headers are
 *  the only thing present. */
export const rateLimitFinding = (rate, cache) =>
  Object.keys(rate).length > 0
    ? `rate-limit headers observed: ${JSON.stringify(rate)}`
    : 'NO rate-limit header was returned on any call this run. The absence is the finding: '
      + 'the limits remain unmeasured from responses, and the docs\' "Conventions & limits" is a '
      + 'claim, not a measurement. '
      + (Object.keys(cache).length
          ? `Cache headers WERE present (${JSON.stringify(cache)}) — they are not rate-limit headers and do not answer this.`
          : 'No cache header either.')

// ── Task 1 verdict ──────────────────────────────────────────────────────────
/** The four market families FIELD's model needs. Matched against BSD's keys by
 *  substring, case-insensitively, and the MATCHED KEY IS RECORDED so a reader
 *  can see what was counted rather than trusting the label. */
export const MARKET_FAMILIES = {
  moneyline: ['1x2', 'match_winner', 'moneyline', 'match_odds', 'home_draw_away', 'winner', 'ml'],
  spread:    ['spread', 'handicap', 'asian', 'line'],
  // 'ou' was here and FALSE-MATCHED `double_chance` — d-o-u-ble — reporting a
  // double-chance market as a goals total. A two-letter needle is not a market
  // name. Removed; matchedKeys exists so this kind of thing is visible rather
  // than hidden behind a boolean, and that is how it was caught.
  total:     ['total', 'over_under', 'over/under', 'goals_over'],
  opening:   ['opening', 'open_price', 'first_price'],
}
export const familiesPresent = (marketKeys) => {
  const keys = (marketKeys ?? []).map(k => String(k).toLowerCase())
  const out = {}
  for (const [fam, needles] of Object.entries(MARKET_FAMILIES)) {
    const hits = keys.filter(k => needles.some(n => k.includes(n)))
    out[fam] = { present: hits.length > 0, matchedKeys: hits }
  }
  return out
}

/** The CC-CMD asks for one of three verdicts, in these words. */
export const oddsVerdict = (fams) => {
  const core = ['moneyline', 'spread', 'total']
  const have = core.filter(f => fams[f]?.present)
  if (have.length === core.length && fams.opening?.present) return 'markets sufficient for the model'
  if (have.length === 0) return 'insufficient'
  return `sufficient only for a subset (${have.join(', ')})`
}

/** Done condition 2, in the document's own words. */
/** The verdict PER MATCH STATE. Merging pre-match and live keys into one
 *  verdict hides the finding: BSD's odds product is described as PRE-MATCH, and
 *  the pre-match sample carries neither a moneyline nor a goals total while the
 *  live one carries both. A single merged answer reads as "mostly there" and is
 *  wrong about the state that matters. */
export const verdictByState = (keysByState) =>
  Object.fromEntries(Object.entries(keysByState).map(([state, keys]) => {
    const fams = familiesPresent(keys)
    return [state, { marketKeysVerbatim: keys, families: fams, verdict: oddsVerdict(fams) }]
  }))

export const substitutionViable = (verdict) =>
  verdict === 'markets sufficient for the model'
    ? 'the free-odds substitution is viable'
    : 'the free-odds substitution is NOT viable'

// ── Task 4 ──────────────────────────────────────────────────────────────────
/** Is a broadcast payload territory-scoped? A channel list with no territory is
 *  unusable for a US reader and worse than none, so "no territory field" is a
 *  finding, not a blank. */
export const TERRITORY_KEYS = ['country', 'country_code', 'territory', 'region', 'locale', 'market']
export const territoryScoped = (rows) => {
  const list = Array.isArray(rows) ? rows : (rows?.results ?? rows?.broadcasts ?? [])
  if (!Array.isArray(list) || list.length === 0) return { scoped: null, reason: 'no rows to judge', keysSeen: [] }
  const keys = [...new Set(list.flatMap(r => Object.keys(r ?? {})))]
  const hits = keys.filter(k => TERRITORY_KEYS.some(t => k.toLowerCase().includes(t)))
  return { scoped: hits.length > 0, territoryKeys: hits, keysSeen: keys }
}

// ── self-test ───────────────────────────────────────────────────────────────
function selfTest () {
  let failed = 0
  const check = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failed++ }

  check('the 10-03 keys are insufficient',
    oddsVerdict(familiesPresent(['btts', 'draw_no_bet'])) === 'insufficient')
  check('MUTATION: a full set reads sufficient',
    oddsVerdict(familiesPresent(['1x2', 'asian_handicap', 'total_goals', 'opening_price']))
      === 'markets sufficient for the model')
  check('MUTATION: core without opening is a SUBSET, not sufficient',
    oddsVerdict(familiesPresent(['1x2', 'spread', 'total'])).startsWith('sufficient only for a subset'))
  check('...and the subset names what it has',
    oddsVerdict(familiesPresent(['1x2'])) === 'sufficient only for a subset (moneyline)')
  check('the matched key is recorded, not just a boolean',
    familiesPresent(['asian_handicap']).spread.matchedKeys[0] === 'asian_handicap')
  check('MUTATION: double_chance is NOT a goals total — the ou needle is gone',
    familiesPresent(['double_chance']).total.present === false)
  check('...while over_under_25 still is', familiesPresent(['over_under_25']).total.present === true)
  check('per-state verdicts do not merge',
    verdictByState({ pre: ['asian_handicap'], live: ['1x2', 'asian_handicap', 'over_under_25'] }).pre.verdict
      !== verdictByState({ pre: ['asian_handicap'], live: ['1x2', 'asian_handicap', 'over_under_25'] }).live.verdict)
  check('MUTATION: a thin pre-match state is named as such',
    verdictByState({ pre: ['asian_handicap', 'btts'] }).pre.verdict === 'sufficient only for a subset (spread)')
  check('done condition 2 uses the document\'s words',
    substitutionViable('insufficient') === 'the free-odds substitution is NOT viable')
  check('...and the positive form too',
    substitutionViable('markets sufficient for the model') === 'the free-odds substitution is viable')

  check('a broadcast row with country IS territory-scoped',
    territoryScoped([{ channel: 'ESPN', country_code: 'US' }]).scoped === true)
  check('MUTATION: a row with NO territory is scoped:false, a finding',
    territoryScoped([{ channel: 'ESPN' }]).scoped === false)
  check('no rows is scoped:null — unjudgeable, not unscoped (Rule 99)',
    territoryScoped([]).scoped === null)

  check('MUTATION: a cache header does NOT satisfy a rate-limit question',
    /NO rate-limit header/.test(rateLimitFinding({}, { 'cf-cache-status': 'DYNAMIC' })))
  check('...and the cache headers are still reported, labelled as not answering it',
    /not rate-limit headers/.test(rateLimitFinding({}, { 'cf-cache-status': 'DYNAMIC' })))
  check('a real rate-limit header IS the finding',
    /observed/.test(rateLimitFinding({ 'x-ratelimit-remaining': '9' }, {})))
  check('cache headers are captured separately, not as rate headers',
    Object.keys(rateHeadersOf({ 'cf-cache-status': 'x' })).length === 0
      && Object.keys(cacheHeadersOf({ 'cf-cache-status': 'x' })).length === 1)
  check('rate headers are picked out when present',
    rateHeadersOf({ 'x-ratelimit-remaining': '99', 'content-type': 'x' })['x-ratelimit-remaining'] === '99')
  check('MUTATION: an empty capture is an empty object, and the caller must say so',
    Object.keys(rateHeadersOf({ 'content-type': 'x' })).length === 0)

  console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${20 - failed}/20 self-tests`)
  return failed
}

// IMPORT PURITY — everything below makes live calls and writes an artifact.
const _entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
// `import.meta.url.endsWith(basename)` was here, and it is WRONG in two ways:
// a `node -e` import leaves argv[1] empty, `''.endsWith('')` is true, and the
// module ran anyway — defeating the very guard it is; and a basename match
// would also fire for a same-named file in another directory. pathToFileURL
// compares the resolved path, which is the only thing that settles it.
const _isEntry = _entryHref !== null && import.meta.url === _entryHref
if (!_isEntry) {
  // imported; the exports above are pure
} else if (process.argv.includes('--self-test')) {
  process.exit(selfTest())
} else {

const TOKEN = process.env.BSD_API_TOKEN
if (!TOKEN) { console.log('FAIL: BSD_API_TOKEN absent — every answer would be UNKNOWN, not empty.'); process.exit(1) }

let callsMade = 0
const rateSeen = {}
const cacheSeen = {}
const callLog = []
let budgetHit = false

const call = async (path, note) => {
  if (callsMade >= CALL_BUDGET) {
    budgetHit = true
    callLog.push({ path, note, skipped: 'call budget reached' })
    return { budgetExceeded: true, ok: false, json: null }
  }
  callsMade++
  try {
    const r = await fetch(`${BASE}${path}`, { headers: {
      Authorization: `Token ${TOKEN}`, 'User-Agent': 'FIELD/1.0', Accept: 'application/json' } })
    const hdrs = Object.fromEntries([...r.headers].map(([k, v]) => [k.toLowerCase(), v]))
    Object.assign(rateSeen, rateHeadersOf(hdrs))
    Object.assign(cacheSeen, cacheHeadersOf(hdrs))
    const text = await r.text()
    let json = null; try { json = JSON.parse(text) } catch {}
    callLog.push({ path, note, status: r.status, bytes: text.length })
    return { ok: r.ok, status: r.status, json, headers: hdrs }
  } catch (e) {
    callLog.push({ path, note, error: String(e?.message ?? e) })
    return { ok: false, status: null, json: null, error: String(e?.message ?? e) }
  }
}

const keysOf = (o) => (o && typeof o === 'object') ? Object.keys(o) : []
const firstRow = (j) => Array.isArray(j) ? j[0] : (j?.results?.[0] ?? j?.events?.[0] ?? null)
const iso = (d) => d.toISOString().slice(0, 10)

console.log(`=== bsd surface probe   budget ${CALL_BUDGET} calls\n`)

// ── find a pre-match, a live and a finished event ───────────────────────────
const TOMORROW = iso(new Date(Date.now() + 86400000))
const preR  = await call(`/api/v2/events/?date_from=${TOMORROW}&date_to=${TOMORROW}&limit=20`, 'pre-match slate')
const liveR = await call('/api/v2/events/live/', 'live slate')
const preRow  = firstRow(preR.json)
const liveRows = Array.isArray(liveR.json) ? liveR.json : (liveR.json?.results ?? liveR.json?.events ?? [])
const liveRow = Array.isArray(liveRows) ? liveRows[0] : null
const FINISHED_ID = 223324  // the event this repo already has a committed fixture for

const states = {
  preMatch: preRow ? { id: preRow.id, status: preRow.status ?? null, period: preRow.period ?? null } : null,
  live:     liveRow ? { id: liveRow.id, status: liveRow.status ?? null, period: liveRow.period ?? null } : null,
  finished: { id: FINISHED_ID, status: 'finished (known fixture)', period: null },
}
console.log(`  pre-match event: ${states.preMatch?.id ?? 'NONE FOUND'}   live: ${states.live?.id ?? 'NONE LIVE'}   finished: ${FINISHED_ID}`)

// ── TASK 1 — odds ───────────────────────────────────────────────────────────
const oddsFor = async (id, label) => {
  if (id == null) return { event: null, note: `no ${label} event available to sample` }
  const cmp = await call(`/api/v2/events/${id}/odds/comparison/`, `task1 ${label} comparison`)
  const raw = await call(`/api/v2/events/${id}/odds/`, `task1 ${label} odds`)
  const body = cmp.json ?? {}
  const marketKeys = keysOf(body.markets ?? body.odds ?? body).filter(k => !['event_id', 'id', 'updated_at'].includes(k))
  const perMarket = {}
  const src = body.markets ?? body.odds ?? body
  for (const k of marketKeys) {
    const m = src?.[k]
    const books = Array.isArray(m) ? m : (m?.bookmakers ?? m?.books ?? null)
    const bookCount = Array.isArray(books) ? books.length : null
    const sample = Array.isArray(books) ? books[0] : (m && typeof m === 'object' ? m : null)
    perMarket[k] = {
      bookmakerCount: bookCount,
      sampleKeys: keysOf(sample),
      hasOpeningValue: keysOf(sample).some(x => /open/i.test(x)),
    }
  }
  return {
    eventId: id, label, comparisonStatus: cmp.status, oddsStatus: raw.status,
    marketKeysVerbatim: marketKeys,
    perMarket,
    rawOddsTopLevelKeys: keysOf(raw.json),
  }
}
const t1pre  = await oddsFor(states.preMatch?.id ?? null, 'pre-match')
const t1live = await oddsFor(states.live?.id ?? null, 'live')
const best   = await call('/api/v2/odds/best/', 'task1 odds/best')

const allKeys = [...(t1pre.marketKeysVerbatim ?? []), ...(t1live.marketKeysVerbatim ?? [])]
const fams = familiesPresent(allKeys)
const t1verdict = oddsVerdict(fams)
console.log(`\n  TASK 1 market keys (verbatim): ${allKeys.length ? allKeys.join(', ') : '(none)'}`)
console.log(`  TASK 1 verdict: ${t1verdict}`)
console.log(`  TASK 1 → ${substitutionViable(t1verdict)}`)

// ── TASK 2 — team form ──────────────────────────────────────────────────────
const teamId = preRow?.home_team_id ?? liveRow?.home_team_id ?? null
const formR = teamId != null ? await call(`/api/v2/teams/${teamId}/form/`, 'task2 team form') : null
const formBody = formR?.json ?? null
const formRows = Array.isArray(formBody) ? formBody : (formBody?.results ?? formBody?.form ?? null)
const t2 = {
  teamId,
  status: formR?.status ?? null,
  topLevelKeysVerbatim: keysOf(formBody),
  rowCount: Array.isArray(formRows) ? formRows.length : null,
  rowKeysVerbatim: Array.isArray(formRows) && formRows[0] ? keysOf(formRows[0]) : [],
  carriesXg: JSON.stringify(formBody ?? {}).toLowerCase().includes('xg')
          || JSON.stringify(formBody ?? {}).toLowerCase().includes('expected_goal'),
  perCompetitionEvidence: keysOf(formBody).filter(k => /league|competition|comp/i.test(k))
    .concat(Array.isArray(formRows) && formRows[0]
      ? keysOf(formRows[0]).filter(k => /league|competition|comp/i.test(k)) : []),
}
t2.verdict = formR == null ? 'UNPROBED — no team id available'
  : !formR.ok ? `endpoint does not serve a form shape (HTTP ${formR.status})`
  : `form shape served: ${t2.rowCount ?? 'non-list'} row(s), xG ${t2.carriesXg ? 'PRESENT' : 'ABSENT'}, ` +
    `per-competition ${t2.perCompetitionEvidence.length ? 'evidenced by ' + [...new Set(t2.perCompetitionEvidence)].join('/') : 'NOT evidenced'}`
console.log(`\n  TASK 2: ${t2.verdict}`)

// ── TASK 3 — basketball and hockey leagues ──────────────────────────────────
const leaguesOf = async (sport) => {
  const r = await call(`/${sport}/api/v2/leagues/`, `task3 ${sport} leagues`)
  const rows = Array.isArray(r.json) ? r.json : (r.json?.results ?? [])
  const names = (Array.isArray(rows) ? rows : []).map(x => x?.name ?? x?.league ?? x?.title).filter(Boolean)
  return { status: r.status, count: names.length, namesVerbatim: names,
           rowKeysVerbatim: Array.isArray(rows) && rows[0] ? keysOf(rows[0]) : [] }
}
const t3basket = await leaguesOf('basketball')
const t3hockey = await leaguesOf('hockey')
const hasNBA = t3basket.namesVerbatim.some(n => /\bNBA\b/i.test(n))
const hasNHL = t3hockey.namesVerbatim.some(n => /\bNHL\b/i.test(n))
const t3verdict = `basketball ${t3basket.count} league(s), NBA ${hasNBA ? 'PRESENT' : 'ABSENT'}; ` +
                  `hockey ${t3hockey.count} league(s), NHL ${hasNHL ? 'PRESENT' : 'ABSENT'}`
console.log(`\n  TASK 3: ${t3verdict}`)

// ── TASK 4 — broadcasts and lineups at three states ─────────────────────────
const lineupAt = async (id, label) => {
  if (id == null) return { label, note: 'no event available at this state' }
  const r = await call(`/api/v2/events/${id}/lineups/`, `task4 lineups ${label}`)
  const b = r.json ?? {}
  return { label, eventId: id, status: r.status,
           lineup_status: b.lineup_status ?? null, beta: b.beta ?? null,
           topLevelKeysVerbatim: keysOf(b) }
}
const t4lineups = [
  await lineupAt(states.preMatch?.id ?? null, 'pre-match'),
  await lineupAt(states.live?.id ?? null, 'live'),
  await lineupAt(FINISHED_ID, 'finished'),
]
const bcPre = states.preMatch?.id != null
  ? await call(`/api/v2/events/${states.preMatch.id}/broadcasts/`, 'task4 broadcasts pre-match') : null
const bcFin = await call(`/api/v2/events/${FINISHED_ID}/broadcasts/`, 'task4 broadcasts finished')
const bcBody = bcPre?.json ?? bcFin?.json ?? null
const terr = territoryScoped(bcBody)
let channelProbe = null
const bcList = Array.isArray(bcBody) ? bcBody : (bcBody?.results ?? bcBody?.broadcasts ?? [])
const chanId = Array.isArray(bcList) && bcList[0] ? (bcList[0].tv_channel_id ?? bcList[0].channel_id ?? bcList[0].id) : null
if (chanId != null) {
  const cr = await call(`/api/v2/tv-channels/${chanId}/broadcasts/`, 'task4 tv-channel broadcasts')
  const crRows = Array.isArray(cr.json) ? cr.json : (cr.json?.results ?? [])
  channelProbe = { channelId: chanId, status: cr.status, rowCount: Array.isArray(crRows) ? crRows.length : null,
                   rowKeysVerbatim: Array.isArray(crRows) && crRows[0] ? keysOf(crRows[0]) : [] }
}
console.log(`\n  TASK 4 lineup_status: ${t4lineups.map(l => `${l.label}=${l.lineup_status ?? (l.note ? 'n/a' : 'null')}`).join('  ')}`)
console.log(`  TASK 4 broadcasts territory-scoped: ${terr.scoped === null ? 'UNJUDGEABLE (no rows)' : terr.scoped}`)

// ── TASK 5 — rate limits ────────────────────────────────────────────────────
const rateFinding = rateLimitFinding(rateSeen, cacheSeen)
console.log(`\n  TASK 5: ${rateFinding}`)

// ── artifact ────────────────────────────────────────────────────────────────
const artifact = {
  capturedAt: new Date().toISOString(),
  callBudget: CALL_BUDGET,
  callsMade,
  budgetHit,
  unmeasured: budgetHit ? callLog.filter(c => c.skipped).map(c => `${c.path} (${c.note})`) : [],
  eventStatesSampled: states,
  task1_odds: {
    verdict: t1verdict,
    byState: verdictByState({
      preMatch: t1pre.marketKeysVerbatim ?? [],
      live: t1live.marketKeysVerbatim ?? [],
    }),
    doneCondition2: substitutionViable(t1verdict),
    marketFamilies: fams,
    preMatch: t1pre, live: t1live,
    oddsBestStatus: best.status, oddsBestTopLevelKeysVerbatim: keysOf(best.json),
    note: 'Market keys are BSD\'s, verbatim. No mapping to FIELD vocabulary is done here.',
  },
  task2_form: t2,
  task3_leagues: { verdict: t3verdict, basketball: t3basket, hockey: t3hockey },
  task4_broadcastsAndLineups: {
    lineupStatusByState: t4lineups,
    broadcastsPreMatchStatus: bcPre?.status ?? null,
    broadcastsFinishedStatus: bcFin?.status ?? null,
    territory: terr,
    tvChannelProbe: channelProbe,
  },
  task5_rateLimits: { rateLimitHeadersObserved: rateSeen, cacheHeadersObserved: cacheSeen, finding: rateFinding },
  callLog,
  coverage: `${callsMade} of a ${CALL_BUDGET}-call budget. One pre-match event, ` +
            `${states.live ? 'one live event' : 'NO live event was available'}, one finished event. ` +
            'One team for form, one league list per sport. Not a survey of the feed.',
}
mkdirSync('outbox', { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(`outbox/bsd-surface-probe-${stamp}.json`, JSON.stringify(artifact, null, 2) + '\n')
writeFileSync('outbox/bsd-surface-probe-latest.json', JSON.stringify(artifact, null, 2) + '\n')
console.log(`\n  callsMade ${callsMade} / callBudget ${CALL_BUDGET}${budgetHit ? '  — BUDGET HIT, see unmeasured[]' : ''}`)
console.log(`wrote outbox/bsd-surface-probe-${stamp}.json`)
console.log('\nPROBE ONLY — no feature ships from this run.')

}  // end entry guard
