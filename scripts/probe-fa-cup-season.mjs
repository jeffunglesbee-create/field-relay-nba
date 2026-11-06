#!/usr/bin/env node
// Is ESPN serving the 2026-27 FA Cup? The unblock criterion of
// docs/CC-CMD-2026-08-08-fa-cup-coverage.md, measured instead of inferred.
//
// WHY: that CC-CMD says wire eng.fa only when `leagues[0].season.year >= 2026`
// and `season.type.name != "Final"`. The probe that unblocked it on 2026-11-06
// (probe-efl-cup-slug.yml, run 42309071973) printed the league name and an event
// COUNT: 'English FA Cup', events=2. It never read season.year, the criterion
// itself, and never printed an event's date, so it could not say whether the two
// events were 2026-27 fixtures or the tail of the finished 2025-26 season. This
// reads the fields the criterion names, plus each event's date, teams and status.
//
// Both ESPN hosts are read the way the relay reads them (ESPN_SUMMARY_HEADERS for
// the web host, none for the scoreboard path), on a runner: a runner IP is not a
// Worker IP, so this answers what ESPN SERVES, not whether the Worker is let in.
// That second question is answered from the relay's own route after the deploy.
//
// --self-test runs verdict() against fixtures, including the 2026-08-08 payload
// that must come out BLOCKED, and a payload with no season at all, which must
// come out UNKNOWN rather than unblocked.
import { writeFileSync, mkdirSync } from 'node:fs'

const HEADERS = {
  Origin: 'https://www.espn.com', Referer: 'https://www.espn.com/', Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}
const HOSTS = { web: 'https://site.web.api.espn.com', api: 'https://site.api.espn.com' }

/** The CC-CMD's criterion, as a function of one scoreboard payload. */
export function verdict(payload) {
  const season = payload?.leagues?.[0]?.season
  const year = season?.year
  const type = season?.type?.name
  if (typeof year !== 'number' || typeof type !== 'string') return { state: 'UNKNOWN', year: year ?? null, type: type ?? null }
  return { state: year >= 2026 && type !== 'Final' ? 'UNBLOCKED' : 'BLOCKED', year, type }
}

/** One event as the relay's adapter would see it: sides by homeAway, never by array position. */
export function brief(ev) {
  const c = ev?.competitions?.[0]?.competitors ?? []
  const side = (k) => c.find(x => x.homeAway === k)?.team?.displayName ?? null
  return { date: ev?.date ?? null, home: side('home'), away: side('away'), status: ev?.status?.type?.name ?? null, neutral: ev?.competitions?.[0]?.neutralSite ?? null }
}

if (process.argv.includes('--self-test')) {
  let bad = 0
  const eq = (label, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${got}${ok ? '' : ` (wanted ${want})`}`) }
  eq('the 2026-08-08 payload (2025, Final) is BLOCKED', verdict({ leagues: [{ season: { year: 2025, type: { name: 'Final' } } }] }).state, 'BLOCKED')
  eq('a 2026 season at Final is BLOCKED', verdict({ leagues: [{ season: { year: 2026, type: { name: 'Final' } } }] }).state, 'BLOCKED')
  eq('a 2026 season in a round is UNBLOCKED', verdict({ leagues: [{ season: { year: 2026, type: { name: 'First Round' } } }] }).state, 'UNBLOCKED')
  eq('no season at all is UNKNOWN, not unblocked', verdict({ leagues: [{}] }).state, 'UNKNOWN')
  eq('a string year is UNKNOWN, not coerced', verdict({ leagues: [{ season: { year: '2026', type: { name: 'First Round' } } }] }).state, 'UNKNOWN')
  eq('sides come from homeAway, not position', brief({ competitions: [{ competitors: [{ homeAway: 'away', team: { displayName: 'B' } }, { homeAway: 'home', team: { displayName: 'A' } }] }] }).home, 'A')
  console.log(bad ? `\n${bad} FAILED` : '\nself-test: 6/6')
  process.exit(bad ? 1 : 0)
}

const get = async (url, headers) => {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(25_000) })
  return { status: r.status, body: r.ok ? await r.json() : null }
}
const out = { at: new Date().toISOString(), reads: [] }
for (const [host, base] of Object.entries(HOSTS)) {
  for (const [label, qs, hdrs] of [
    ['default scoreboard, browser headers', '', HEADERS],
    ['default scoreboard, no headers', '', {}],
    ['dates=20261101-20261231, browser headers', '?dates=20261101-20261231', HEADERS],
  ]) {
    const url = `${base}/apis/site/v2/sports/soccer/eng.fa/scoreboard${qs}`
    let rec
    try {
      const { status, body } = await get(url, hdrs)
      rec = { host, label, url, status, ...(body ? { verdict: verdict(body), leagueName: body.leagues?.[0]?.name ?? null, seasonDisplayName: body.leagues?.[0]?.season?.displayName ?? null, eventCount: (body.events ?? []).length, events: (body.events ?? []).map(brief) } : {}) }
    } catch (e) { rec = { host, label, url, error: String(e.message || e) } }
    out.reads.push(rec)
    console.log(`${host.padEnd(4)} ${label.padEnd(42)} ${rec.error ? `ERROR ${rec.error}` : `HTTP ${rec.status} ${rec.verdict ? `${rec.verdict.state} year=${rec.verdict.year} type=${rec.verdict.type} events=${rec.eventCount}` : ''}`}`)
    for (const e of rec.events ?? []) console.log(`       ${e.date}  ${e.home} v ${e.away}  [${e.status}]`)
  }
}
const states = out.reads.filter(r => r.verdict).map(r => r.verdict.state)
console.log(`COVERAGE: ${out.reads.length} read(s), ${states.length} answered with a payload (${states.join(', ') || 'none'}). Criterion: season.year >= 2026 and season.type.name != "Final".`)
mkdirSync('outbox', { recursive: true })
writeFileSync(`outbox/probe-fa-cup-season-${out.at.replace(/[:.]/g, '-')}.json`, JSON.stringify(out, null, 2))
