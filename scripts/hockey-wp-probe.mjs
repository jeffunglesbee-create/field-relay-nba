#!/usr/bin/env node
// docs/CC-CMD-2026-10-10-nhl-win-probability-from-xg.md — the probe that has to
// run before any of it is written.
//
// PROBE ONLY. No model ships from this file. It exists because the CC-CMD's
// Tasks 1-3 each rest on a premise that has not been measured, and because
// three of the four premises are cross-boundary facts — a vendor's column
// names, another API's field semantics, a third party's odds payload — which
// this repo's own rules say reading cannot verify.
//
// VENDOR NAMES ARE REPORTED VERBATIM. No mapping to FIELD's vocabulary here;
// a renamed column in the artifact cannot be checked against the vendor.
//
// Runs in CI, not the container: moneypuck.com, api-web.nhle.com and
// site.api.espn.com are all 403-at-CONNECT from the authoring sandbox
// (measured 2026-10-11; the proxy's own recentRelayFailures names it
// "connect_rejected / gateway answered 403 to CONNECT (policy").

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const CALL_BUDGET = 25

// The URL is NOT written from memory. src/nhl-gsax-r2.js already consumes
// moneypuck.com/moneypuck/playerData/seasonSummary/..., which establishes the
// host but says nothing about where shot files live. data.htm is the vendor's
// own index; the probe reads the hrefs off it rather than guessing a path.
export const MP_INDEX = 'https://moneypuck.com/data.htm'
export const NHL_BASE = 'https://api-web.nhle.com/v1'
export const ESPN_SB  = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard'

// Columns the model needs, as the CC-CMD's feature list implies them. Reported
// as four states, never as a boolean: present / absent is the whole question,
// and "absent" is a sibling of the value (Rule 99).
export const NEEDED = [
  'game_id', 'season', 'isPlayoffGame', 'homeTeamCode', 'awayTeamCode',
  'homeTeamWon', 'time', 'period', 'event', 'goal', 'xGoal',
  'homeTeamGoals', 'awayTeamGoals', 'homeSkatersOnIce', 'awaySkatersOnIce',
  'homeEmptyNet', 'awayEmptyNet', 'xCordAdjusted', 'yCordAdjusted',
  'shotDistance', 'shotAngleAdjusted', 'shotType', 'shotRebound', 'shotRush',
  'isHomeTeam', 'teamCode'
]

export const classifyColumns = (header, needed = NEEDED) => {
  const have = new Set(header)
  return {
    present: needed.filter(n => have.has(n)),
    absent:  needed.filter(n => !have.has(n)),
    extra:   header.filter(h => !needed.includes(h)).length
  }
}

// ── situationCode, which the CC-CMD calls "the field that makes this tractable"
//
// Declared reading: four digits — away goalie, away skaters, home skaters,
// home goalie. The declaration is the premise; these two functions are what a
// cross-check can disagree with.
export const parseSituation = (code) => {
  const s = String(code ?? '')
  if (!/^\d{4}$/.test(s)) return null          // unreadable is not even strength
  return {
    awayGoalie:  s[0] === '1',
    awaySkaters: Number(s[1]),
    homeSkaters: Number(s[2]),
    homeGoalie:  s[3] === '1'
  }
}

export const strengthOf = (sit) => {
  if (!sit) return 'unreadable'
  if (!sit.awayGoalie || !sit.homeGoalie) return 'empty-net'
  if (sit.homeSkaters === sit.awaySkaters) return `even-${sit.homeSkaters}v${sit.homeSkaters}`
  return sit.homeSkaters > sit.awaySkaters ? 'home-advantage' : 'away-advantage'
}

// Penalty windows derived from the plays array — an INDEPENDENT derivation of
// "was somebody short-handed here", so agreement with situationCode is
// evidence and disagreement is a finding. Restating situationCode back to
// itself would prove nothing (Rule 90's point about a check that cannot fail).
export const toSeconds = (periodNumber, timeInPeriod) => {
  const [m, s] = String(timeInPeriod ?? '0:00').split(':').map(Number)
  return (periodNumber - 1) * 1200 + m * 60 + s
}

export const penaltyWindows = (plays) => {
  const out = []
  for (const p of plays) {
    if (p.typeDescKey !== 'penalty') continue
    const dur = Number(p.details?.duration)
    if (!Number.isFinite(dur) || dur === 0) continue   // majors/misconducts w/o duration skipped
    const start = toSeconds(p.periodDescriptor?.number ?? 1, p.timeInPeriod)
    out.push({ start, end: start + dur * 60, team: p.details?.eventOwnerTeamId })
  }
  return out
}

const fetchJson = async (url, calls) => {
  calls.n += 1
  const r = await fetch(url, { signal: AbortSignal.timeout(25000) })
  if (!r.ok) return { ok: false, status: r.status }
  return { ok: true, status: r.status, body: await r.json() }
}

const main = async () => {
  const started = new Date().toISOString()
  const calls = { n: 0 }
  const out = {
    cc_cmd: 'docs/CC-CMD-2026-10-10-nhl-win-probability-from-xg.md',
    probe_only: true,
    started_at: started,
    callBudget: CALL_BUDGET,
    callsMade: null,
    premises: {}
  }

  // ── Premise 1: where do MoneyPuck's shot files live, and what is in them?
  try {
    calls.n += 1
    const idx = await fetch(MP_INDEX, { signal: AbortSignal.timeout(25000) })
    const html = idx.ok ? await idx.text() : ''
    const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(m => m[1])
    const shotLinks = hrefs.filter(h => /shot/i.test(h))
    out.premises.moneypuck_index = {
      url: MP_INDEX, status: idx.status,
      shot_hrefs_verbatim: shotLinks.slice(0, 12),
      href_count: hrefs.length
    }

    // Resolve the newest completed season's file from the vendor's own links.
    const abs = shotLinks
      .map(h => h.startsWith('http') ? h : new URL(h, MP_INDEX).href)
      .filter(h => /\.(zip|csv)$/i.test(h))
    out.premises.moneypuck_index.resolved = abs.slice(0, 12)

    const pick = abs.find(h => /shots_2024/.test(h)) || abs[0] || null
    out.premises.moneypuck_file = { chosen: pick }

    if (pick) {
      calls.n += 1
      const r = await fetch(pick, { signal: AbortSignal.timeout(120000) })
      out.premises.moneypuck_file.status = r.status
      out.premises.moneypuck_file.content_type = r.headers.get('content-type')
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer())
        out.premises.moneypuck_file.bytes = buf.length
        mkdirSync('/tmp/mp', { recursive: true })
        const path = `/tmp/mp/shots${pick.endsWith('.zip') ? '.zip' : '.csv'}`
        writeFileSync(path, buf)
        let csv
        if (path.endsWith('.zip')) {
          const names = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).trim().split('\n')
          out.premises.moneypuck_file.zip_entries = names
          csv = execFileSync('unzip', ['-p', path, names[0]], { encoding: 'utf8', maxBuffer: 1024 ** 3 })
        } else {
          csv = buf.toString('utf8')
        }
        const lines = csv.split('\n')
        const header = lines[0].replace(/\r$/, '').split(',')
        out.premises.moneypuck_file.row_count = lines.length - 1
        out.premises.moneypuck_file.column_count = header.length
        out.premises.moneypuck_file.header_verbatim = header
        out.premises.moneypuck_file.needed = classifyColumns(header)
        out.premises.moneypuck_file.sample_rows = lines.slice(1, 3).map(l => {
          const v = l.replace(/\r$/, '').split(',')
          return Object.fromEntries(header.map((h, i) => [h, v[i]]))
        })
        writeFileSync('/tmp/mp/header.txt', header.join('\n'))
      }
    }
  } catch (e) {
    out.premises.moneypuck_index = { error: String(e && e.message || e) }
  }

  // ── Premise 2: is the declared situationCode reading right?
  // Confirmed against TWO independent derivations, per done condition 2.
  try {
    const gameId = '2026020053'
    const pbp = await fetchJson(`${NHL_BASE}/gamecenter/${gameId}/play-by-play`, calls)
    const box = await fetchJson(`${NHL_BASE}/gamecenter/${gameId}/boxscore`, calls)
    const sc = { gameId, pbp_status: pbp.status, boxscore_status: box.status }

    if (pbp.ok) {
      const plays = pbp.body.plays || []
      const shots = plays.filter(p => /shot-on-goal|missed-shot|blocked-shot|goal/.test(p.typeDescKey))
      const wins = penaltyWindows(plays)
      sc.play_count = plays.length
      sc.shot_count = shots.length
      sc.penalty_windows = wins.length

      const dist = {}
      let agree = 0, disagree = 0, noPenaltyAndEven = 0
      const examples = { emptyNet: [], homeAdvantage: [], unreadable: [] }
      for (const p of shots) {
        const sit = parseSituation(p.situationCode)
        const str = strengthOf(sit)
        dist[String(p.situationCode)] = (dist[String(p.situationCode)] || 0) + 1
        const t = toSeconds(p.periodDescriptor?.number ?? 1, p.timeInPeriod)
        const inPenalty = wins.some(w => t >= w.start && t < w.end)
        const asymmetric = str === 'home-advantage' || str === 'away-advantage'
        if (asymmetric === inPenalty) { agree += 1; if (!inPenalty) noPenaltyAndEven += 1 }
        else disagree += 1
        if (str === 'empty-net' && examples.emptyNet.length < 3)
          examples.emptyNet.push({ situationCode: p.situationCode, timeInPeriod: p.timeInPeriod, period: p.periodDescriptor?.number, typeDescKey: p.typeDescKey })
        if (str === 'home-advantage' && examples.homeAdvantage.length < 3)
          examples.homeAdvantage.push({ situationCode: p.situationCode, timeInPeriod: p.timeInPeriod, period: p.periodDescriptor?.number, inPenaltyWindow: inPenalty })
        if (str === 'unreadable' && examples.unreadable.length < 3)
          examples.unreadable.push({ situationCode: p.situationCode, typeDescKey: p.typeDescKey })
      }
      sc.situation_code_distribution = dist
      sc.penalty_crosscheck = { agree, disagree, agree_rate: shots.length ? +(agree / shots.length).toFixed(4) : null, agreed_because_both_negative: noPenaltyAndEven }
      sc.examples = examples
      sc.home_defending_side = pbp.body.homeTeamDefendingSide ?? null
      sc.clock_keys = Object.keys(pbp.body.clock || {})
    }

    // Independent empty-net derivation: goalie time on ice from the boxscore.
    // If a team's goalies cover less than the game's length, that team pulled
    // its goalie — which situationCode must also say, from a different field.
    if (box.ok) {
      const pg = box.body.playerByGameStats || {}
      const toiSec = (side) => (pg[side]?.goalies || []).reduce((a, g) => {
        const [m, s] = String(g.toi ?? '0:00').split(':').map(Number)
        return a + (m * 60 + (s || 0))
      }, 0)
      sc.goalie_toi_crosscheck = {
        homeGoalieToiSec: toiSec('homeTeam'),
        awayGoalieToiSec: toiSec('awayTeam'),
        note: 'a side below regulation length pulled its goalie; situationCode must agree from a different field'
      }
    }
    out.premises.situation_code = sc
  } catch (e) {
    out.premises.situation_code = { error: String(e && e.message || e) }
  }

  // ── Premise 3: THE GATE's baseline. Does ESPN carry a historical moneyline?
  // Task 3 cannot be evaluated at all without a free archive of de-vigged
  // moneylines: the Odds API ceiling was REACHED 2026-10-07 and credits need
  // approval, and field-archive stores no odds column (checked: neither
  // regular_season_games nor postseason_games has one).
  try {
    const dates = ['20240302', '20240413', '20241026']
    const espn = { dates: [], moneyline_key_paths: [], games_with_moneyline: 0, games_total: 0 }
    for (const d of dates) {
      const r = await fetchJson(`${ESPN_SB}?dates=${d}`, calls)
      const row = { date: d, status: r.status, events: 0, withOdds: 0, withMoneyline: 0, sampleOddsKeys: null, sampleOdds: null }
      if (r.ok) {
        const events = r.body.events || []
        row.events = events.length
        for (const ev of events) {
          const comp = ev.competitions?.[0] || {}
          const odds = comp.odds || []
          if (odds.length) row.withOdds += 1
          const o = odds[0]
          if (o && row.sampleOddsKeys === null) {
            row.sampleOddsKeys = Object.keys(o)
            row.sampleOdds = JSON.parse(JSON.stringify(o))
          }
          const ml = o?.homeTeamOdds?.moneyLine ?? o?.moneyline?.home?.close?.odds ?? null
          if (ml !== null && ml !== undefined) row.withMoneyline += 1
          espn.games_total += 1
        }
        espn.games_with_moneyline += row.withMoneyline
      }
      espn.dates.push(row)
    }
    out.premises.espn_market_archive = espn
  } catch (e) {
    out.premises.espn_market_archive = { error: String(e && e.message || e) }
  }

  out.callsMade = calls.n
  out.budget_respected = calls.n <= CALL_BUDGET
  out.finished_at = new Date().toISOString()

  // Rule 91: the denominator prints where the result is read.
  out.coverage = {
    moneypuck_seasons_examined: 1,
    nhl_games_examined: 1,
    espn_dates_examined: 3,
    statement: 'one MoneyPuck season file, one NHL game, three ESPN dates — not a survey of any of the three'
  }

  mkdirSync('outbox', { recursive: true })
  const ts = started.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const file = `outbox/hockey-wp-probe-${ts}.json`
  writeFileSync(file, JSON.stringify(out, null, 2))
  writeFileSync('outbox/hockey-wp-probe-latest.json', JSON.stringify(out, null, 2))
  console.log(`wrote ${file}`)
  console.log(`callsMade ${out.callsMade} of ${CALL_BUDGET}; ${out.coverage.statement}`)
  for (const [k, v] of Object.entries(out.premises))
    console.log(`  ${k}: ${v.error ? 'ERROR ' + v.error : 'measured'}`)
}

const _entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
const _isEntry = _entryHref !== null && import.meta.url === _entryHref

const selfTest = () => {
  let pass = 0, fail = 0
  const t = (name, cond) => { if (cond) { pass++; console.log(`PASS  ${name}`) } else { fail++; console.log(`FAIL  ${name}`) } }

  t('1551 reads as 5v5 with both goalies in',
    strengthOf(parseSituation('1551')) === 'even-5v5')
  t('a leading 0 is an empty away net, not even strength',
    strengthOf(parseSituation('0651')) === 'empty-net')
  t('a trailing 0 is an empty home net',
    strengthOf(parseSituation('1560')) === 'empty-net')
  t('5v4 is a home advantage',
    strengthOf(parseSituation('1451')) === 'home-advantage')
  t('4v5 is an away advantage',
    strengthOf(parseSituation('1541')) === 'away-advantage')
  t('an unreadable code is UNREADABLE, never even strength',
    parseSituation('') === null && strengthOf(null) === 'unreadable')
  t('a 3-digit code is unreadable rather than coerced',
    parseSituation('155') === null)
  t('undefined is unreadable, not 1551',
    parseSituation(undefined) === null)

  t('toSeconds places period 2 after period 1',
    toSeconds(2, '0:00') === 1200 && toSeconds(1, '19:37') === 1177)
  t('a 2-minute penalty becomes a 120-second window',
    (() => {
      const w = penaltyWindows([{ typeDescKey: 'penalty', timeInPeriod: '5:00', periodDescriptor: { number: 1 }, details: { duration: 2, eventOwnerTeamId: 1 } }])
      return w.length === 1 && w[0].start === 300 && w[0].end === 420
    })())
  t('a penalty with no duration is skipped rather than given one',
    penaltyWindows([{ typeDescKey: 'penalty', timeInPeriod: '5:00', periodDescriptor: { number: 1 }, details: {} }]).length === 0)
  t('a non-penalty play contributes no window',
    penaltyWindows([{ typeDescKey: 'shot-on-goal', timeInPeriod: '5:00', periodDescriptor: { number: 1 } }]).length === 0)

  t('a missing needed column is reported absent, not silently dropped',
    (() => {
      const c = classifyColumns(['game_id', 'xGoal'], ['game_id', 'xGoal', 'homeTeamWon'])
      return c.present.length === 2 && c.absent.length === 1 && c.absent[0] === 'homeTeamWon'
    })())

  console.log(`\n${pass}/${pass + fail} checks passed`)
  if (fail) process.exit(1)
}

if (_isEntry) {
  if (process.argv.includes('--self-test')) selfTest()
  else main().catch(e => { console.error(e); process.exit(1) })
}
