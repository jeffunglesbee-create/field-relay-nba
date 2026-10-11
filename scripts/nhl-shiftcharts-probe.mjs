#!/usr/bin/env node
// docs/CC-CMD-2026-10-11-nhl-shift-charts-on-ice.md — Task 1. PROBE ONLY.
//
// Nothing ships from this file. It answers five questions the document rests
// on, every one of which currently exists only in that document's prose.
//
// DONE CONDITION 1 IS SATISFIABLE WITHOUT PROVING ANYTHING, and the document
// says so one section earlier about a different API: "accepted and silently
// dropped", HTTP 200 with the same unfiltered page. A cayenneExp query with a
// wrong gameId will very likely answer 200 with an empty array, which is
// indistinguishable from "this season has no shift charts" if only the status
// is reported. So:
//   - the ROW COUNT is the measurement, never the status; and
//   - each game id is CONTROLLED against api-web.nhle.com first. A game whose
//     play-by-play does not exist cannot be evidence about a season.
//
// TWO HOSTS. src/index.js proxies /nhl/* to api-web.nhle.com. Shift charts are
// on api.nhle.com — a different host, never called from this repository. Its
// reachability from CI is itself unproven and is reported rather than assumed.

import { writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseSituation, toElapsedSeconds } from '../src/hockey-wp.js'

export const STATS_BASE = 'https://api.nhle.com'
export const WEB_BASE = 'https://api-web.nhle.com'
export const CALL_BUDGET = 24

// Season -> a game id to try. NHL ids are SSSS02NNNN; game 1 of each regular
// season. Named here rather than left to the reader (Rule 75), and every one is
// controlled for existence before its shift-chart answer is believed.
export const SEASON_GAMES = {
  2020: '2020020001', 2021: '2021020001', 2022: '2022020001', 2023: '2023020001',
}

// Shift times are period-relative strings. Returns seconds from the start of
// the GAME, the same convention the WP model uses:
//   (period - 1) * 1200 + mm * 60 + ss
export const shiftSeconds = (period, mmss) => {
  if (!Number.isFinite(period)) return null
  const m = /^(\d{1,3}):(\d{2})$/.exec(String(mmss ?? ''))
  if (!m) return null
  return (period - 1) * 1200 + Number(m[1]) * 60 + Number(m[2])
}

// Who is on the ice at `t`, by INTERVAL. The document's measured negative is
// that eventNumber is not a join key, so time is the only one available.
// `endExclusive` is a parameter because Task 4 asks which it is — it is not
// assumed here, it is measured by trying both.
export const onIceAt = (shifts, t, endExclusive = true) => {
  const out = []
  for (const s of shifts) {
    const a = shiftSeconds(s.period, s.startTime)
    const b = shiftSeconds(s.period, s.endTime)
    if (a === null || b === null) continue
    const inside = endExclusive ? (t >= a && t < b) : (t >= a && t <= b)
    if (inside) out.push(s)
  }
  return out
}

// situationCode is the INDEPENDENT control and it is already confirmed — two
// derivations, 26 informative agreements, 0 disagreements. A reconstruction
// that disagrees with it is wrong, not interesting.
export const compareToSituation = (onIce, situationCode, homeTeamId) => {
  const sit = parseSituation(situationCode)
  if (!sit) return { comparable: false, reason: 'situationCode unreadable' }
  const home = onIce.filter(s => String(s.teamId) === String(homeTeamId))
  const away = onIce.filter(s => String(s.teamId) !== String(homeTeamId))
  // Shift charts do not label goalies, so the comparison is on TOTAL bodies:
  // situationCode's skaters plus its goalie.
  const expHome = sit.homeSkaters + (sit.homeGoalie ? 1 : 0)
  const expAway = sit.awaySkaters + (sit.awayGoalie ? 1 : 0)
  return {
    comparable: true,
    homeOnIce: home.length, awayOnIce: away.length,
    homeExpected: expHome, awayExpected: expAway,
    agrees: home.length === expHome && away.length === expAway,
    resolvesToNobody: onIce.length === 0,
  }
}

const getJson = async (url, calls, timeout = 30000) => {
  calls.n += 1
  try {
    const r = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'FIELD/1.0' }, signal: AbortSignal.timeout(timeout) })
    const text = await r.text()
    let body = null
    try { body = JSON.parse(text) } catch (_) {}
    return { ok: r.ok, status: r.status, body, bytes: text.length }
  } catch (e) { return { ok: false, status: 0, error: String(e && e.message || e), body: null } }
}

const shiftRows = (body) => Array.isArray(body?.data) ? body.data : (Array.isArray(body) ? body : [])

const main = async () => {
  const started = new Date().toISOString()
  const calls = { n: 0 }
  const out = {
    cc_cmd: 'docs/CC-CMD-2026-10-11-nhl-shift-charts-on-ice.md',
    task: 'Task 1 — PROBE ONLY, nothing ships',
    started_at: started, callBudget: CALL_BUDGET, callsMade: null,
    host_reachability: {},
  }

  // ── is api.nhle.com reachable from CI AT ALL? Never called from this repo. ──
  const reach = await getJson(`${STATS_BASE}/stats/rest/en/shiftcharts?cayenneExp=gameId=2026020053`, calls)
  out.host_reachability = {
    host: STATS_BASE, status: reach.status, ok: reach.ok,
    rows: shiftRows(reach.body).length,
    note: reach.status === 0 ? 'UNREACHABLE from this runner — every answer below is UNMEASURED'
        : 'reachable; this repo has never called this host before today',
  }

  // ── 1.1 HISTORICAL DEPTH, with an existence control per game ──────────────
  const depth = []
  const perGameEventNumber = []   // done condition 2 asks for THREE games
  for (const [season, gid] of Object.entries(SEASON_GAMES)) {
    if (calls.n >= CALL_BUDGET - 6) break
    const control = await getJson(`${WEB_BASE}/v1/gamecenter/${gid}/play-by-play`, calls)
    const playCount = Array.isArray(control.body?.plays) ? control.body.plays.length : 0
    const sc = await getJson(`${STATS_BASE}/stats/rest/en/shiftcharts?cayenneExp=gameId=${gid}`, calls)
    const rows = shiftRows(sc.body)
    depth.push({
      season, gameId: gid,
      control_playByPlay_status: control.status, control_playCount: playCount,
      gameExists: control.ok && playCount > 0,
      shiftcharts_status: sc.status, shiftRows: rows.length,
      distinctPlayers: new Set(rows.map(r => r.playerId)).size,
      // The status is NOT the answer. A 200 with zero rows against a game that
      // demonstrably exists is a real negative; against a game that does not
      // exist it is nothing at all.
      verdict: !control.ok || playCount === 0
        ? 'UNMEASURED — the control game itself does not resolve, so zero shift rows prove nothing about this season'
        : rows.length > 0 ? `shift charts served: ${rows.length} rows`
        : 'SERVED AND EMPTY — the game exists and shift charts returned no rows. The backfill window is bounded here.',
    })
    // The eventNumber negative, on THIS game too — done condition 2 asks for
    // three games and all shift rows, not one game and nine samples.
    if (control.ok && rows.length) {
      const ids = new Set((control.body?.plays || []).map(p => p.eventId).filter(v => v !== undefined))
      const ens = rows.map(r => r.eventNumber).filter(v => v !== undefined && v !== null)
      const m = ens.filter(n => ids.has(n)).length
      perGameEventNumber.push({ gameId: gid, shift_eventNumbers: ens.length, play_eventIds: ids.size, matched: m,
                                match_rate: ens.length ? +(m / ens.length).toFixed(4) : null })
    }
  }
  out.task1_1_historicalDepth = depth

  // ── 1.2 WIDEN THE eventNumber NEGATIVE ────────────────────────────────────
  // Nine samples on one game is the document's own caveat. This checks EVERY
  // shift row against the full play eventId set, on the games already fetched.
  const current = '2026020053'
  const pbp = await getJson(`${WEB_BASE}/v1/gamecenter/${current}/play-by-play`, calls)
  const sc = await getJson(`${STATS_BASE}/stats/rest/en/shiftcharts?cayenneExp=gameId=${current}`, calls)
  const plays = Array.isArray(pbp.body?.plays) ? pbp.body.plays : []
  const shifts = shiftRows(sc.body)
  const playIds = new Set(plays.map(p => p.eventId).filter(v => v !== undefined))
  const shiftEventNumbers = shifts.map(s => s.eventNumber).filter(v => v !== undefined && v !== null)
  const matched = shiftEventNumbers.filter(n => playIds.has(n)).length
  const acrossGames = [...perGameEventNumber, null].filter(Boolean)
  out.task1_2_eventNumberJoin = {
    gameId: current,
    across_games: acrossGames,
    games_checked: acrossGames.length + 1,
    matched_across_all_games: acrossGames.reduce((a, g) => a + g.matched, 0),
    denominator_across_all_games: acrossGames.reduce((a, g) => a + g.shift_eventNumbers, 0),
    shift_rows: shifts.length,
    shift_eventNumbers_present: shiftEventNumbers.length,
    play_eventIds: playIds.size,
    matched, denominator: shiftEventNumbers.length,
    match_rate: shiftEventNumbers.length ? +(matched / shiftEventNumbers.length).toFixed(4) : null,
    // The document predicts zero. If it ever matches, that prediction is wrong.
    verdict: shiftEventNumbers.length === 0 ? 'UNMEASURED — no eventNumber on any shift row'
      : matched === 0 ? `CONFIRMED NEGATIVE: 0 of ${shiftEventNumbers.length} shift eventNumbers appear as a play eventId. They are different numbering spaces.`
      : `STOP — ${matched} of ${shiftEventNumbers.length} MATCHED. The document's measured negative is wrong and the join may be real.`,
  }

  // ── 1.3 INTERVAL-JOIN RATE, against situationCode ─────────────────────────
  // ── 1.4 BOUNDARY SEMANTICS — both readings tried, not assumed ─────────────
  const homeTeamId = pbp.body?.homeTeam?.id
  const SHOTS = new Set(['shot-on-goal', 'missed-shot', 'blocked-shot', 'goal'])
  const shotPlays = plays.filter(p => SHOTS.has(p.typeDescKey))
  const evaluate = (endExclusive) => {
    let exact = 0, disagree = 0, nobody = 0, uncomparable = 0
    const examples = []
    for (const p of shotPlays) {
      const t = toElapsedSeconds(p.periodDescriptor?.number, p.timeInPeriod)
      if (t === null) { uncomparable += 1; continue }
      const on = onIceAt(shifts, t, endExclusive)
      const c = compareToSituation(on, p.situationCode, homeTeamId)
      if (!c.comparable) { uncomparable += 1; continue }
      if (c.resolvesToNobody) nobody += 1
      else if (c.agrees) exact += 1
      else { disagree += 1; if (examples.length < 5) examples.push({ timeInPeriod: p.timeInPeriod, period: p.periodDescriptor?.number, situationCode: p.situationCode, ...c }) }
    }
    return { endExclusive, shots: shotPlays.length, agrees_with_situationCode: exact, disagrees: disagree,
             resolves_to_nobody: nobody, uncomparable,
             agreement_rate: shotPlays.length ? +(exact / shotPlays.length).toFixed(4) : null, examples }
  }
  const exclusive = evaluate(true)
  const inclusive = evaluate(false)
  out.task1_3_intervalJoin = { exclusive, inclusive,
    better: exclusive.agrees_with_situationCode >= inclusive.agrees_with_situationCode ? 'endTime EXCLUSIVE' : 'endTime INCLUSIVE',
    note: 'situationCode is the independent control. A reconstruction that disagrees with it is wrong, not interesting.' }
  out.task1_4_boundary = {
    question: 'is endTime inclusive or exclusive?',
    exclusive_agreement: exclusive.agreement_rate,
    inclusive_agreement: inclusive.agreement_rate,
    verdict: exclusive.agreement_rate === null ? 'UNMEASURED'
      : exclusive.agreement_rate === inclusive.agreement_rate
        ? 'INDISTINGUISHABLE on this game — no shot lands exactly on a shift boundary, so the rule is not established by this sample'
        : (exclusive.agreement_rate > inclusive.agreement_rate ? 'EXCLUSIVE agrees with situationCode more often' : 'INCLUSIVE agrees with situationCode more often'),
  }

  // ── 1.5 CLOCK DIRECTION ───────────────────────────────────────────────────
  // If shift times counted DOWN, a period-1 shift would start high and end low.
  let up = 0, down = 0, equal = 0
  for (const s of shifts) {
    const a = shiftSeconds(s.period, s.startTime), b = shiftSeconds(s.period, s.endTime)
    if (a === null || b === null) continue
    if (b > a) up += 1; else if (b < a) down += 1; else equal += 1
  }
  out.task1_5_clockDirection = {
    shifts_compared: up + down + equal, end_after_start: up, end_before_start: down, equal,
    verdict: (up + down) === 0 ? 'UNMEASURED'
      : up > down * 10 ? 'COUNTS UP, same direction as the WP model\'s (period-1)*1200 + mm*60 + ss'
      : down > up * 10 ? 'COUNTS DOWN — the WP model\'s elapsed-second derivation would be INVERTED against it'
      : 'MIXED — neither direction dominates, which is itself a finding',
  }

  out.callsMade = calls.n
  out.coverage = `${depth.length} season control games, 1 current game for the join measurements, `
               + `${shotPlays.length} shots and ${shifts.length} shift rows. One game is not the API's policy.`

  mkdirSync('outbox', { recursive: true })
  const ts = started.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  writeFileSync(`outbox/nhl-shiftcharts-probe-${ts}.json`, JSON.stringify(out, null, 2))
  writeFileSync('outbox/nhl-shiftcharts-probe-latest.json', JSON.stringify(out, null, 2))
  console.log(`wrote outbox/nhl-shiftcharts-probe-${ts}.json`)
  console.log(`callsMade ${calls.n} of ${CALL_BUDGET}`)
  console.log(`host: ${out.host_reachability.note}`)
  for (const d of depth) console.log(`  ${d.season}: ${d.verdict}`)
  console.log(`eventNumber: ${out.task1_2_eventNumberJoin.verdict}`)
  console.log(`interval join (exclusive): ${exclusive.agrees_with_situationCode}/${exclusive.shots} agree, ${exclusive.disagrees} disagree, ${exclusive.resolves_to_nobody} resolve to nobody`)
  console.log(`boundary: ${out.task1_4_boundary.verdict}`)
  console.log(`clock: ${out.task1_5_clockDirection.verdict}`)
  console.log(out.coverage)
}

const _entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
const _isEntry = _entryHref !== null && import.meta.url === _entryHref

const selfTest = () => {
  let pass = 0, fail = 0
  const t = (n, c) => { if (c) { pass++; console.log(`PASS  ${n}`) } else { fail++; console.log(`FAIL  ${n}`) } }

  t('shift times are period-relative and convert to game seconds',
    shiftSeconds(1, '03:25') === 205 && shiftSeconds(2, '00:00') === 1200 && shiftSeconds(3, '10:00') === 3000)
  t('a malformed shift time is null, never zero',
    shiftSeconds(1, 'soon') === null && shiftSeconds(1, undefined) === null && shiftSeconds(null, '01:00') === null)

  const shifts = [
    { playerId: 1, teamId: 10, period: 1, startTime: '00:00', endTime: '01:00' },
    { playerId: 2, teamId: 10, period: 1, startTime: '01:00', endTime: '02:00' },
    { playerId: 3, teamId: 20, period: 1, startTime: '00:30', endTime: '01:30' },
  ]
  t('an interval join returns who was on at that second',
    onIceAt(shifts, 45).map(s => s.playerId).join(',') === '1,3')
  t('EXCLUSIVE and INCLUSIVE differ exactly at a boundary, which is why both are measured',
    onIceAt(shifts, 60, true).map(s => s.playerId).join(',') === '2,3'
    && onIceAt(shifts, 60, false).map(s => s.playerId).join(',') === '1,2,3')
  t('a shift whose times do not parse is skipped rather than counted at zero',
    onIceAt([{ playerId: 9, teamId: 10, period: 1, startTime: 'x', endTime: 'y' }], 10).length === 0)

  t('an on-ice set matching situationCode agrees',
    (() => {
      const on = [...Array(6)].map((_, i) => ({ teamId: 10 })).concat([...Array(6)].map(() => ({ teamId: 20 })))
      const c = compareToSituation(on, '1551', 10)
      return c.comparable && c.agrees && c.homeOnIce === 6 && c.homeExpected === 6
    })())
  t('A RECONSTRUCTION THAT DISAGREES WITH situationCode IS REPORTED AS WRONG',
    (() => {
      const on = [...Array(7)].map(() => ({ teamId: 10 })).concat([...Array(6)].map(() => ({ teamId: 20 })))
      return compareToSituation(on, '1551', 10).agrees === false
    })())
  t('an unreadable situationCode makes the comparison incomparable, not agreeing',
    compareToSituation([], 'xx', 10).comparable === false)
  t('an empty on-ice set is reported as resolving to NOBODY, not as a disagreement of size zero',
    compareToSituation([], '1551', 10).resolvesToNobody === true)
  t('an empty net lowers the expected body count by one',
    (() => {
      const on = [...Array(6)].map(() => ({ teamId: 10 })).concat([...Array(6)].map(() => ({ teamId: 20 })))
      const c = compareToSituation(on, '0651', 10)   // away goalie pulled, 6 away skaters
      return c.awayExpected === 6 && c.homeExpected === 6
    })())

  console.log(`\n${pass}/${pass + fail} checks passed`)
  if (fail) process.exit(1)
}

if (_isEntry) {
  if (process.argv.includes('--self-test')) selfTest()
  else main().catch(e => { console.error(String(e && e.stack || e)); process.exit(1) })
}
