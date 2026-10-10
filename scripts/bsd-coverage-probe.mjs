#!/usr/bin/env node
// docs/CC-CMD-2026-10-10-coverage-replaces-season-date-math.md — the two
// questions that must be answered from a live call before any plumbing.
//
// Q1 (Task 1 / stop condition): does /api/v2/coverage/ really need NO token?
//   The CC-CMD measured it token-free from its authoring sandbox. THIS sandbox
//   gets `CONNECT tunnel failed, response 403` for sports.bzzoiro.com, which is
//   a reader-side egress policy and says nothing about the token. So the claim
//   is re-measured here, from a runner, by calling it BOTH ways.
//
// Q2 (Task 4): is per-league season state available upstream? The CC-CMD says
//   /api/v2/leagues/{id}/season/ and /seasons/ are declared in the schema and
//   UNPROBED, and says in capitals not to assume they carry a current-season
//   flag. So this probes EPL (league_id=1) and reports what is actually there.

export const BASE = 'https://sports.bzzoiro.com'
export const EPL_LEAGUE_ID = 1

/** Does this payload carry a flag naming the CURRENT season, or only a list?
 *  The distinction is the whole of Q2: a list of seasons does not say which one
 *  is running, and reading the last element as "current" is the date
 *  arithmetic this CC-CMD exists to remove, wearing a different hat. */
export const currentSeasonEvidence = (body) => {
  if (body == null || typeof body !== 'object') return { kind: 'not-an-object', flags: [] }
  const rows = Array.isArray(body) ? body : (body.results ?? body.seasons ?? null)
  const probe = (o) => Object.keys(o ?? {}).filter(k => /current|is_active|active|ongoing|present/i.test(k))
  if (Array.isArray(rows)) {
    const flags = [...new Set(rows.flatMap(r => probe(r)))]
    return { kind: 'list', count: rows.length, flags, hasCurrentFlag: flags.length > 0 }
  }
  const flags = probe(body)
  return { kind: 'object', keys: Object.keys(body).slice(0, 25), flags, hasCurrentFlag: flags.length > 0 }
}

/** Rule 99 on the three states this CC-CMD is about. */
export const coverageState = (sportRow, callOk) => {
  if (!callOk) return 'unknown'                                   // the call failed
  if (!sportRow) return 'unknown'                                 // sport absent from payload
  if (sportRow.status !== 'in_season') return 'not-in-season'     // vendor says no
  return (sportRow.priced_next_7d ?? 0) > 0 ? 'priced' : 'in-season-unpriced'
}

function selfTest () {
  let failed = 0
  const check = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failed++ }

  check('a failed call is unknown, never off-season', coverageState({ status: 'in_season', priced_next_7d: 9 }, false) === 'unknown')
  check('a missing sport row is unknown, not off-season', coverageState(null, true) === 'unknown')
  check('off_season is not-in-season', coverageState({ status: 'off_season' }, true) === 'not-in-season')
  check('MUTATION: in_season with 0 priced is its OWN state, not off-season',
    coverageState({ status: 'in_season', priced_next_7d: 0 }, true) === 'in-season-unpriced')
  check('...and not the same as priced',
    coverageState({ status: 'in_season', priced_next_7d: 0 }, true)
      !== coverageState({ status: 'in_season', priced_next_7d: 1 }, true))
  check('MUTATION: an absent priced field reads unpriced, not priced',
    coverageState({ status: 'in_season' }, true) === 'in-season-unpriced')
  check('all four states are distinct', new Set([
    coverageState({ status: 'in_season', priced_next_7d: 1 }, true),
    coverageState({ status: 'in_season', priced_next_7d: 0 }, true),
    coverageState({ status: 'off_season' }, true),
    coverageState(null, false),
  ]).size === 4)

  check('a season LIST with no current flag is reported as such',
    currentSeasonEvidence([{ id: 1, year: '2025/26' }]).hasCurrentFlag === false)
  check('MUTATION: a current flag IS detected when present',
    currentSeasonEvidence([{ id: 1, is_current: true }]).hasCurrentFlag === true)
  check('a results-wrapped list is unwrapped',
    currentSeasonEvidence({ results: [{ current: true }] }).kind === 'list')
  check('a non-object is its own answer, not an empty list',
    currentSeasonEvidence(null).kind === 'not-an-object')

  console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${11 - failed}/11 self-tests`)
  return failed
}

if (process.argv.includes('--self-test')) process.exit(selfTest())

const TOKEN = process.env.BSD_API_TOKEN || null
const get = async (path, withToken) => {
  const headers = { 'User-Agent': 'FIELD/1.0', Accept: 'application/json' }
  if (withToken && TOKEN) headers.Authorization = `Token ${TOKEN}`
  try {
    const r = await fetch(`${BASE}${path}`, { headers })
    const text = await r.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: r.status, ok: r.ok, json, bytes: text.length }
  } catch (e) { return { status: null, ok: false, error: String(e?.message ?? e) } }
}

console.log('=== bsd coverage probe')
console.log(`    token in env: ${TOKEN ? 'yes' : 'NO'}  (Q1 is answered by the NO-TOKEN call either way)\n`)

const noTok = await get('/api/v2/coverage/', false)
const wiTok = await get('/api/v2/coverage/', true)
console.log(`  /api/v2/coverage/  NO token  -> HTTP ${noTok.status}  ${noTok.bytes ?? 0}B`)
console.log(`  /api/v2/coverage/  w/ token  -> HTTP ${wiTok.status}  ${wiTok.bytes ?? 0}B`)

const tokenFree = noTok.ok === true
console.log(`\n  Q1 TOKEN-FREE: ${tokenFree}`)
if (!tokenFree) {
  console.log('  STOP CONDITION — the CC-CMD says to stop and report if this needs a token.')
  console.log('  That contradicts its own measurement and means something changed upstream.')
}

const sports = Array.isArray(noTok.json) ? noTok.json : (noTok.json?.sports ?? noTok.json?.results ?? [])
const rows = Array.isArray(sports) ? sports
  : (noTok.json && typeof noTok.json === 'object'
      ? Object.entries(noTok.json).map(([k, v]) => (v && typeof v === 'object' ? { sport: k, ...v } : null)).filter(Boolean)
      : [])
if (rows.length) {
  console.log(`\n  sport          status          events_7d  priced_7d  live   state`)
  for (const r of rows) {
    const nm = r.sport ?? r.name ?? '?'
    console.log(`  ${String(nm).padEnd(14)} ${String(r.status ?? '?').padEnd(15)} ${String(r.events_next_7d ?? '-').padStart(8)} ${String(r.priced_next_7d ?? '-').padStart(10)} ${String(r.live_now ?? '-').padStart(5)}   ${coverageState(r, noTok.ok)}`)
  }
}

// Q2 — Task 4. Needs the token; these are ordinary BSD endpoints.
console.log(`\n  --- Task 4: per-league season state, EPL league_id=${EPL_LEAGUE_ID}`)
const season  = await get(`/api/v2/leagues/${EPL_LEAGUE_ID}/season/`, true)
const seasons = await get(`/api/v2/leagues/${EPL_LEAGUE_ID}/seasons/`, true)
const sEv  = season.ok  ? currentSeasonEvidence(season.json)  : null
const ssEv = seasons.ok ? currentSeasonEvidence(seasons.json) : null
console.log(`  /leagues/${EPL_LEAGUE_ID}/season/   -> HTTP ${season.status}  ${sEv ? JSON.stringify(sEv).slice(0, 180) : '(no body)'}`)
console.log(`  /leagues/${EPL_LEAGUE_ID}/seasons/  -> HTTP ${seasons.status}  ${ssEv ? JSON.stringify(ssEv).slice(0, 180) : '(no body)'}`)

const perLeagueAnswer = (sEv?.hasCurrentFlag || ssEv?.hasCurrentFlag)
  ? 'YES — a current-season flag exists upstream'
  : (season.ok || seasons.ok)
      ? 'NO — the endpoints answer, but carry no current-season flag; only a list'
      : 'UNKNOWN — neither endpoint answered, so this is not evidence of absence'
console.log(`\n  Q2 PER-LEAGUE SEASON STATE: ${perLeagueAnswer}`)

const artifact = {
  capturedAt: new Date().toISOString(),
  endpoint: '/api/v2/coverage/',
  q1_tokenFree: { answer: tokenFree, noTokenStatus: noTok.status, withTokenStatus: wiTok.status },
  coverage: rows.map(r => ({ ...r, _state: coverageState(r, noTok.ok) })),
  q2_perLeagueSeason: {
    answer: perLeagueAnswer,
    leagueId: EPL_LEAGUE_ID,
    season:  { status: season.status,  evidence: sEv },
    seasons: { status: seasons.status, evidence: ssEv },
  },
  coverageNote: 'Coverage is per SPORT, not per competition. It says football is in season; it does not say the EFL Two is.',
}
const { writeFileSync, mkdirSync } = await import('node:fs')
mkdirSync('outbox', { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(`outbox/bsd-coverage-probe-${stamp}.json`, JSON.stringify(artifact, null, 2) + '\n')
writeFileSync('outbox/bsd-coverage-probe-latest.json', JSON.stringify(artifact, null, 2) + '\n')
console.log(`\nwrote outbox/bsd-coverage-probe-${stamp}.json`)
console.log(`\nCOVERAGE: 1 call to /api/v2/coverage/ each way, 2 league endpoints, 1 league (EPL).`)
process.exit(tokenFree ? 0 : 1)
