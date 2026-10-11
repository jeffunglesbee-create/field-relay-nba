#!/usr/bin/env node
// docs/CC-CMD-2026-10-10-nhl-win-probability-from-xg.md — Tasks 1-4.
//
// Trains offline, commits a coefficient table, and reports Task 3's gate.
// Runs in CI: the shot files are 403-at-CONNECT from the container.
//
// THE SPLIT IS WHOLE SEASONS, NEVER SHUFFLED. Shots from one game share one
// label, so a shuffled split puts the same game on both sides and Task 3 would
// pass on a model that had memorised outcomes. The CC-CMD names this as the
// one thing standing between the model and a plausible fabrication.
//
// DATA PREMISES ARE MEASURED HERE, NOT ASSUMED. Four of them decide whether
// the feature rows mean what the names say, and every one is answerable from
// the file itself:
//   - is homeTeamGoals the score BEFORE or AFTER the shot on its row?
//   - is homeTeamScore the running score or the final one?
//   - what is timeLeft counting down to?
//   - what are the OT and shootout rates, and the home share of them?
// They are reported in the artifact alongside the result.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import {
  FEATURES, featureVector, stateProblems, trainLogistic, predictFromVector,
  brier, logLoss, reliability, standardise,
  XG_FEATURES, xgFeatureVector, SHOT_TYPES, geometryFromCoords
} from '../src/hockey-wp-lib.js'

export const MP_INDEX = 'https://moneypuck.com/data.htm'

// Resolved from the vendor's own index each run rather than hardcoded. The
// files are NOT on moneypuck.com — the index points at a peter-tanner.com
// mirror, which reading the index found and guessing the path would not have.
export const resolveShotUrls = (html, base = MP_INDEX) => {
  const out = {}
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const abs = m[1].startsWith('http') ? m[1] : new URL(m[1], base).href
    const season = abs.match(/shots_(\d{4})\.zip$/)
    if (season) out[season[1]] = abs
  }
  return out
}

const num = (v) => {
  if (v === undefined || v === null || v === '' || v === 'NA') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export const parseCsv = (text, keep, optional = []) => {
  const lines = text.split('\n')
  const header = lines[0].replace(/\r$/, '').split(',')
  const idx = {}
  const absent = []
  for (const k of keep) {
    const i = header.indexOf(k)
    // An OPTIONAL column may be missing from an older season's file — column
    // sets are not constant across nineteen years of vendor output, and
    // discovering that by throwing on season 2020 after parsing 2021 and 2022
    // is an expensive way to learn it. A REQUIRED column still throws.
    if (i < 0) {
      if (optional.includes(k)) { absent.push(k); continue }
      throw new Error(`required column absent from the vendor file: ${k}`)
    }
    idx[k] = i
  }
  if (absent.length) console.log(`    optional columns absent: ${absent.join(', ')}`)
  parseCsv.lastAbsent = absent
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]
    if (!l || l === '\r') continue
    const v = l.replace(/\r$/, '').split(',')
    const r = {}
    for (const k of keep) r[k] = (k in idx) ? v[idx[k]] : undefined
    rows.push(r)
  }
  return rows
}

export const KEEP = [
  'game_id', 'season', 'isPlayoffGame', 'homeTeamCode', 'awayTeamCode',
  'homeTeamWon', 'time', 'period', 'event', 'goal', 'xGoal', 'isHomeTeam',
  'homeTeamGoals', 'awayTeamGoals', 'homeTeamScore', 'roadTeamScore',
  'homeSkatersOnIce', 'awaySkatersOnIce', 'homeEmptyNet', 'awayEmptyNet',
  'homeWinProbability', 'wentToOT', 'wentToShootout', 'timeLeft', 'gameOver',
  'shotDistance', 'shotAngleAdjusted', 'shotType', 'shotRebound', 'shotRush',
  'shotOnEmptyNet', 'xCordAdjusted', 'yCordAdjusted', 'shotWasOnGoal'
]

// Columns the run can proceed without, each with a named consequence rather
// than a silent one: no MoneyPuck baseline, or no measured OT term.
export const OPTIONAL = [
  'homeWinProbability',   // absent => no vendor-model baseline
  'wentToOT',             // absent => no measured OT term
  'wentToShootout',
  'timeLeft', 'gameOver', 'shotWasOnGoal',
  // MEASURED 2026-10-11: present in season 2024's file, ABSENT from 2021's.
  // The run that found this had already parsed 2020 (78,611 rows) and threw
  // on 2021 — which is why the trainer writes a failure artifact, since the
  // run log was unreadable. Needed only to key the market join on the test
  // season, and their absence there is reported rather than silently costing
  // every match.
  'homeTeamScore', 'roadTeamScore'
]

// ── Task 1: xG rows ─────────────────────────────────────────────────────────
// The vendor's shotType vocabulary is REPORTED, never assumed: an unmapped
// value silently becomes the base level and the coefficient it should have had
// disappears into the intercept.
export const shotTypeVocabulary = (rows) => {
  const counts = {}
  for (const r of rows) counts[r.shotType ?? ''] = (counts[r.shotType ?? ''] || 0) + 1
  const known = SHOT_TYPES
  return {
    counts,
    values_verbatim: Object.keys(counts).sort(),
    unmapped: Object.keys(counts).filter(v => v !== '' && !known.includes(v)),
    unmapped_row_share: (() => {
      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      const bad = Object.entries(counts).filter(([v]) => v !== '' && !known.includes(v))
        .reduce((a, [, n]) => a + n, 0)
      return total ? +(bad / total).toFixed(6) : null
    })()
  }
}

// The geometry is confirmed against the vendor's OWN columns rather than
// trusted: shotDistance and shotAngleAdjusted are recomputed from
// xCordAdjusted / yCordAdjusted and the disagreement is reported. A formula
// that puts every shot at the wrong end of the rink still returns a number.
export const geometryAgreement = (rows, tol = 0.01) => {
  let n = 0, distOk = 0, angOk = 0, worstDist = 0, worstAng = 0
  for (const r of rows.slice(0, 20000)) {
    const x = num(r.xCordAdjusted), y = num(r.yCordAdjusted)
    const d = num(r.shotDistance), a = num(r.shotAngleAdjusted)
    if (x === null || y === null || d === null || a === null) continue
    const g = geometryFromCoords({ xCoord: x, yCoord: y, netX: 89 })
    if (!g) continue
    n += 1
    const dd = Math.abs(g.distance - d), da = Math.abs(g.angleAbs - Math.abs(a))
    if (dd <= tol) distOk += 1
    if (da <= tol) angOk += 1
    worstDist = Math.max(worstDist, dd); worstAng = Math.max(worstAng, da)
  }
  return {
    inspected: n,
    distance_agrees: distOk, angle_agrees: angOk,
    distance_agreement_rate: n ? +(distOk / n).toFixed(4) : null,
    angle_agreement_rate: n ? +(angOk / n).toFixed(4) : null,
    worst_distance_gap: +worstDist.toFixed(4), worst_angle_gap: +worstAng.toFixed(4),
    tolerance: tol
  }
}

export const buildXgRows = (rows) => {
  const out = []
  for (const r of rows) {
    const d = num(r.shotDistance), a = num(r.shotAngleAdjusted), g = num(r.goal)
    if (d === null || a === null || g === null) continue
    const isHome = r.isHomeTeam === '1' || r.isHomeTeam === '1.0'
    const hs = num(r.homeSkatersOnIce), as = num(r.awaySkatersOnIce)
    if (hs === null || as === null) continue
    out.push({
      x: xgFeatureVector({
        distance: d, angleAbs: Math.abs(a),
        shotType: r.shotType,
        isRebound: r.shotRebound === '1',
        isRush: r.shotRush === '1',
        onEmptyNet: r.shotOnEmptyNet === '1',
        shooterSkaterAdvantage: isHome ? hs - as : as - hs
      }),
      y: g,
      mpXg: num(r.xGoal)
    })
  }
  return out
}

// ── premise 1: is the score column pre-shot or post-shot? ───────────────────
// Answered by looking at a GOAL row and the next row of the same game: if the
// goal is already counted on its own row, the column is post-shot.
export const scoreSemantics = (rows) => {
  let preShot = 0, postShot = 0, inspected = 0
  for (let i = 0; i < rows.length - 1; i++) {
    const r = rows[i], n = rows[i + 1]
    if (r.goal !== '1') continue
    if (r.game_id !== n.game_id) continue
    const isHome = r.isHomeTeam === '1' || r.isHomeTeam === '1.0'
    const before = num(isHome ? r.homeTeamGoals : r.awayTeamGoals)
    const after = num(isHome ? n.homeTeamGoals : n.awayTeamGoals)
    if (before === null || after === null) continue
    inspected += 1
    if (after === before + 1) preShot += 1
    else if (after === before) postShot += 1
  }
  return {
    inspected, consistent_with_pre_shot: preShot, consistent_with_post_shot: postShot,
    verdict: inspected === 0 ? 'unmeasured'
      : preShot > postShot * 4 ? 'pre-shot: the goal is NOT yet counted on its own row'
      : postShot > preShot * 4 ? 'post-shot: the goal IS counted on its own row'
      : 'mixed — neither reading dominates, do not build on either'
  }
}

export const finalScoreSemantics = (rows) => {
  const byGame = new Map()
  for (const r of rows) {
    const g = byGame.get(r.game_id) || { scores: new Set(), goals: new Set() }
    g.scores.add(r.homeTeamScore)
    g.goals.add(r.homeTeamGoals)
    byGame.set(r.game_id, g)
  }
  let constScore = 0, varyScore = 0, constGoals = 0
  for (const [, g] of byGame) {
    if (g.scores.size === 1) constScore += 1; else varyScore += 1
    if (g.goals.size === 1) constGoals += 1
  }
  return {
    games: byGame.size,
    homeTeamScore_constant_within_game: constScore,
    homeTeamScore_varies_within_game: varyScore,
    homeTeamGoals_constant_within_game: constGoals,
    verdict: constScore > varyScore
      ? 'homeTeamScore is the FINAL score (constant within a game); homeTeamGoals is the running one'
      : 'homeTeamScore varies within a game — it is not a final score'
  }
}

export const otSemantics = (rows) => {
  // DERIVED FROM THE PERIODS, NOT FROM A COLUMN. wentToOT is present in the
  // 2020 and 2024 shot files and ABSENT from 2021, 2022 and 2023 — and the
  // first version of this function counted `r.wentToOT === '1'` over
  // undefined, producing tieRate 0.0000 across 1400 games and reporting it as
  // a measurement. An absent column rendered as a measured zero is the exact
  // substitution Rule 99 exists to stop, committed here while gating it
  // elsewhere. It then disabled the three-way reconstruction for 1243 games
  // and the gate returned a verdict on the 8 that survived.
  //
  // A game reached overtime if any of its shots is in period 4 or later. That
  // works on every season, and where the column DOES exist the two
  // derivations are compared — a cross-check, not a restatement.
  const byGame = new Map()
  for (const r of rows) {
    const g = byGame.get(r.game_id) || {
      maxPeriod: 0, columnOT: undefined, columnSO: undefined,
      homeTeamWon: num(r.homeTeamWon), isPlayoff: r.isPlayoffGame === '1'
    }
    const p = num(r.period)
    if (p !== null && p > g.maxPeriod) g.maxPeriod = p
    if (r.wentToOT !== undefined) g.columnOT = r.wentToOT === '1'
    if (r.wentToShootout !== undefined) g.columnSO = r.wentToShootout === '1'
    byGame.set(r.game_id, g)
  }
  const all = [...byGame.values()]
  const derivedOT = all.filter(g => g.maxPeriod >= 4)
  const derivedSO = all.filter(g => g.maxPeriod >= 5)
  const otHomeWins = derivedOT.filter(g => g.homeTeamWon === 1).length
  const soHomeWins = derivedSO.filter(g => g.homeTeamWon === 1).length

  const columnPresent = all.some(g => g.columnOT !== undefined)
  let columnAgreement = null
  if (columnPresent) {
    const withCol = all.filter(g => g.columnOT !== undefined)
    const agree = withCol.filter(g => g.columnOT === (g.maxPeriod >= 4)).length
    columnAgreement = {
      inspected: withCol.length, agree, disagree: withCol.length - agree,
      agreement_rate: withCol.length ? +(agree / withCol.length).toFixed(4) : null,
      note: 'the period derivation against the vendor wentToOT column, where that column exists'
    }
  }

  return {
    games: all.length,
    source: 'derived from max period per game',
    wentToOT_column_present: columnPresent,
    column_vs_derivation: columnAgreement,
    wentToOT: derivedOT.length,
    wentToShootout: derivedSO.length,
    tieRate: all.length ? +(derivedOT.length / all.length).toFixed(4) : null,
    // Done condition 3: a MEASURED constant with its sample size, not 0.5 —
    // and null rather than a number when there is nothing to measure.
    otHomeShare: derivedOT.length ? +(otHomeWins / derivedOT.length).toFixed(4) : null,
    otHomeShare_n: derivedOT.length,
    shootoutHomeShare: derivedSO.length ? +(soHomeWins / derivedSO.length).toFixed(4) : null,
    shootoutHomeShare_n: derivedSO.length,
    homeWinRate_all: all.length ? +(all.filter(g => g.homeTeamWon === 1).length / all.length).toFixed(4) : null
  }
}

// RULE 99 HAS FOUR STATES, NOT TWO. A column can be absent from the header,
// present and empty, present and unparseable, or present and usable — and the
// first version of this script treated "in the header" as "usable". Season
// 2024's file lists both homeWinProbability and wentToOT and produced a
// MoneyPuck baseline of n=0 and an OT cross-check of 0.7918, neither of which
// the artifact explained. This counts the states so the explanation is a
// measurement.
export const columnStates = (rows, names) => {
  const out = {}
  for (const name of names) {
    const st = { absent_from_header: 0, empty: 0, na_literal: 0, unparseable: 0, usable: 0, sample_values: [] }
    for (const r of rows) {
      const v = r[name]
      if (v === undefined) { st.absent_from_header += 1; continue }
      if (v === '') { st.empty += 1; continue }
      if (v === 'NA' || v === 'na' || v === 'NaN') { st.na_literal += 1; continue }
      if (!Number.isFinite(Number(v))) { st.unparseable += 1; if (st.sample_values.length < 5) st.sample_values.push(v); continue }
      st.usable += 1
      if (st.sample_values.length < 5) st.sample_values.push(v)
    }
    st.verdict = st.absent_from_header === rows.length ? 'absent from the header'
      : st.usable === 0 ? 'present in the header and carrying NO usable value'
      : st.usable === rows.length ? 'present and usable on every row'
      : `present and usable on ${st.usable} of ${rows.length} rows`
    out[name] = st
  }
  return out
}

export const clockSemantics = (rows) => {
  const sample = rows.filter(r => num(r.time) !== null && num(r.timeLeft) !== null).slice(0, 5000)
  let matchesGame = 0, matchesPeriod = 0
  for (const r of sample) {
    const t = num(r.time), tl = num(r.timeLeft), p = num(r.period)
    if (Math.abs(tl - (3600 - t)) <= 1) matchesGame += 1
    if (p !== null && Math.abs(tl - (p * 1200 - t)) <= 1) matchesPeriod += 1
  }
  return {
    inspected: sample.length, matches_game_remaining: matchesGame, matches_period_remaining: matchesPeriod,
    verdict: matchesGame > matchesPeriod ? 'timeLeft counts down to the end of REGULATION'
      : matchesPeriod > matchesGame ? 'timeLeft counts down to the end of the PERIOD'
      : 'neither — do not use timeLeft'
  }
}

// ── state rows ──────────────────────────────────────────────────────────────
// One row per shot: the game state AT that shot, plus the game's outcome.
// Cumulative xG is accumulated in file order within a game.
export const buildStates = (rows, { scoreIsPreShot, xgOf = null }) => {
  const out = []
  let gid = null, hxg = 0, axg = 0
  for (const r of rows) {
    if (r.game_id !== gid) { gid = r.game_id; hxg = 0; axg = 0 }
    const isHome = r.isHomeTeam === '1' || r.isHomeTeam === '1.0'
    // FIELD's own xG when a scorer is supplied; the vendor column only as a
    // fallback for the self-tests, never in a real run.
    const xg = xgOf ? (xgOf(r) ?? 0) : (num(r.xGoal) ?? 0)
    // The state is read BEFORE this shot's own xG is added: a win probability
    // at the moment of a shot cannot already contain that shot.
    const state = {
      gameId: `${r.season}-${r.game_id}`,
      season: r.season,
      isPlayoff: r.isPlayoffGame === '1',
      elapsedSeconds: num(r.time),
      period: num(r.period),
      homeScore: num(r.homeTeamGoals),
      awayScore: num(r.awayTeamGoals),
      homeSkaters: num(r.homeSkatersOnIce),
      awaySkaters: num(r.awaySkatersOnIce),
      homeEmptyNet: r.homeEmptyNet === '1',
      awayEmptyNet: r.awayEmptyNet === '1',
      xgDiff: +(hxg - axg).toFixed(6),
      homeWinProbability: num(r.homeWinProbability),
      homeTeamWon: num(r.homeTeamWon),
      homeTeamCode: r.homeTeamCode,
      awayTeamCode: r.awayTeamCode
    }
    // If the score column is pre-shot and this row IS a goal, the scoreboard
    // the shot was taken under is the pre-shot one — which is what we want.
    if (!scoreIsPreShot && r.goal === '1') {
      if (isHome) state.homeScore = (state.homeScore ?? 0) - 1
      else state.awayScore = (state.awayScore ?? 0) - 1
    }
    if (isHome) hxg += xg; else axg += xg
    if (stateProblems(state).length === 0 && state.homeTeamWon !== null) out.push(state)
  }
  return out
}

export const splitBy = (states, pred) => states.filter(pred)

export const evaluate = (states, predict, label) => {
  const ps = [], ys = []
  for (const s of states) {
    const p = predict(s)
    if (p === null || p === undefined || !Number.isFinite(p)) continue
    ps.push(p); ys.push(s.homeTeamWon)
  }
  return {
    label, n: ps.length,
    brier: ps.length ? +brier(ps, ys).toFixed(6) : null,
    logLoss: ps.length ? +logLoss(ps, ys).toFixed(6) : null,
    reliability: ps.length ? reliability(ps, ys) : null
  }
}

const BREADCRUMBS = []
const step = (m) => { BREADCRUMBS.push(`${new Date().toISOString()} ${m}`); console.log(`  ${m}`) }

const main = async () => {
  const args = process.argv.slice(2)
  const argOf = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d }
  const trainSeasons = argOf('seasons', '2020,2021,2022').split(',')
  const testSeason = argOf('test', '2023')
  const marketFile = argOf('market', 'outbox/hockey-wp-market-baseline-latest.json')
  const iters = Number(argOf('iters', '400'))
  const xgIters = Number(argOf('xg-iters', '300'))
  const started = new Date().toISOString()

  step('reading the vendor index')
  const idx = await fetch(MP_INDEX, { signal: AbortSignal.timeout(30000) })
  const urls = resolveShotUrls(await idx.text())
  const need = [...trainSeasons, testSeason]
  const missing = need.filter(s => !urls[s])
  if (missing.length) throw new Error(`the vendor index offers no shot file for: ${missing.join(',')}`)

  mkdirSync('/tmp/mp', { recursive: true })
  const bySeason = {}
  const absentBySeason = {}
  for (const s of need) {
    step(`fetching season ${s}`)
    const zip = `/tmp/mp/shots_${s}.zip`
    if (!existsSync(zip)) {
      const r = await fetch(urls[s], { signal: AbortSignal.timeout(300000) })
      if (!r.ok) throw new Error(`shots_${s}: HTTP ${r.status}`)
      writeFileSync(zip, Buffer.from(await r.arrayBuffer()))
    }
    const name = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n')[0]
    const csv = execFileSync('unzip', ['-p', zip, name], { encoding: 'utf8', maxBuffer: 1024 ** 3 })
    bySeason[s] = parseCsv(csv, KEEP, OPTIONAL)
    absentBySeason[s] = parseCsv.lastAbsent || []
    step(`season ${s}: ${bySeason[s].length} shot rows, ${new Set(bySeason[s].map(r => r.game_id)).size} games`)
  }

  step('measuring the data premises on the held-out season')
  const premises = {
    score_columns: scoreSemantics(bySeason[testSeason]),
    final_score_column: finalScoreSemantics(bySeason[testSeason]),
    clock_column: clockSemantics(bySeason[testSeason]),
    overtime: otSemantics(bySeason[testSeason]),
    shot_type_vocabulary: shotTypeVocabulary(bySeason[testSeason]),
    column_states: columnStates(bySeason[testSeason],
      ['homeWinProbability', 'wentToOT', 'wentToShootout', 'homeTeamScore', 'roadTeamScore', 'timeLeft']),
    geometry_vs_vendor_columns: geometryAgreement(bySeason[testSeason])
  }
  const scoreIsPreShot = premises.score_columns.verdict.startsWith('pre-shot')
  if (premises.score_columns.verdict.startsWith('mixed'))
    throw new Error('STOP: the score column reading is mixed; building on either would be a guess')

  // ── Task 1: the xG model ─────────────────────────────────────────────────
  step('training the xG model')
  const xgTrain = trainSeasons.flatMap(s => buildXgRows(bySeason[s]))
  const xgTest = buildXgRows(bySeason[testSeason])
  const xgFit = trainLogistic(xgTrain.map(r => r.x), xgTrain.map(r => r.y), { iters: xgIters })
  const xgModel = {
    version: 1, trainedAt: started, trainSeasons, testSeason,
    rows: xgTrain.length, features: XG_FEATURES, shotTypes: SHOT_TYPES,
    coefficients: xgFit.coefficients.map(v => +v.toFixed(6)),
    intercept: +xgFit.intercept.toFixed(6),
    mean: xgFit.mean.map(v => +v.toFixed(6)),
    sd: xgFit.sd.map(v => +v.toFixed(6))
  }
  const xgOfRow = (r) => {
    const rows = buildXgRows([r])
    return rows.length ? predictFromVector(rows[0].x, xgModel) : null
  }
  const xgPs = xgTest.map(r => predictFromVector(r.x, xgModel))
  const xgYs = xgTest.map(r => r.y)
  const mpPs = xgTest.map(r => r.mpXg).filter(v => v !== null)
  const mpYs = xgTest.filter(r => r.mpXg !== null).map(r => r.y)
  const xgResults = {
    n: xgPs.length,
    goal_rate: xgYs.length ? +(xgYs.reduce((a, b) => a + b, 0) / xgYs.length).toFixed(6) : null,
    field_xg: { brier: +brier(xgPs, xgYs).toFixed(6), logLoss: +logLoss(xgPs, xgYs).toFixed(6),
                mean_prediction: +(xgPs.reduce((a, b) => a + b, 0) / xgPs.length).toFixed(6),
                reliability: reliability(xgPs, xgYs) },
    moneypuck_xg: mpPs.length
      ? { n: mpPs.length, brier: +brier(mpPs, mpYs).toFixed(6), logLoss: +logLoss(mpPs, mpYs).toFixed(6),
          mean_prediction: +(mpPs.reduce((a, b) => a + b, 0) / mpPs.length).toFixed(6) }
      : null,
    constant_base_rate: (() => {
      const base = xgYs.reduce((a, b) => a + b, 0) / xgYs.length
      return { brier: +brier(xgYs.map(() => base), xgYs).toFixed(6) }
    })()
  }

  // ── Task 2: the WP model, with FIELD's own xG as one feature ─────────────
  // Trained on OUR xG, not MoneyPuck's, because at runtime only ours exists.
  // A WP model fed the vendor's xG in training and its own in production is
  // two models sharing one coefficient table.
  step('building WP state rows')
  const trainStates = []
  for (const sn of trainSeasons) {
    for (const st of buildStates(bySeason[sn], { scoreIsPreShot, xgOf: xgOfRow })) trainStates.push(st)
    // Release the raw rows for a training season as soon as its states exist.
    // Three seasons of raw rows AND their states held at once is the one thing
    // in this script with a real chance of exhausting the heap, and a heap
    // death leaves no artifact at all.
    delete bySeason[sn]
    step(`states built for ${sn}, raw rows released; heap ${Math.round(process.memoryUsage().heapUsed / 1e6)}MB`)
  }
  const testStates = buildStates(bySeason[testSeason], { scoreIsPreShot, xgOf: xgOfRow })

  const trainGames = new Set(trainStates.map(s => s.gameId))
  const testGames = new Set(testStates.map(s => s.gameId))
  const overlap = [...testGames].filter(g => trainGames.has(g))
  if (overlap.length) throw new Error(`STOP: ${overlap.length} games appear on both sides of the split`)

  step(`training WP on ${trainStates.length} states from ${trainGames.size} games`)
  const X = trainStates.map(featureVector)
  const y = trainStates.map(s => s.homeTeamWon)
  const fit = trainLogistic(X, y, { iters })

  const model = {
    version: 1,
    trainedAt: started,
    trainSeasons, testSeason,
    rows: X.length,
    games: trainGames.size,
    features: FEATURES,
    coefficients: fit.coefficients.map(v => +v.toFixed(6)),
    intercept: +fit.intercept.toFixed(6),
    mean: fit.mean.map(v => +v.toFixed(6)),
    sd: fit.sd.map(v => +v.toFixed(6)),
    tieRate: premises.overtime.tieRate,
    otHomeShare: premises.overtime.otHomeShare,
    otHomeShare_n: premises.overtime.otHomeShare_n,
    pregamePrior: premises.overtime.homeWinRate_all
  }

  const predModel = (s) => predictFromVector(featureVector(s), model)

  step('evaluating against the baselines')
  const mpWp = (s) => s.homeWinProbability > 1 ? s.homeWinProbability / 100 : s.homeWinProbability
  const results = {
    model: evaluate(testStates, predModel, 'FIELD hockey-wp'),
    constant_half: evaluate(testStates, () => 0.5, 'constant 0.5'),
    pregame_prior_constant: evaluate(testStates, () => model.pregamePrior ?? 0.5,
      'constant home-win base rate'),
    moneypuck: evaluate(testStates.filter(s => s.homeWinProbability !== null), mpWp,
      "MoneyPuck homeWinProbability (vendor's own model)")
  }

  let marketJoin = { attempted: false }
  if (!existsSync(marketFile)) {
    marketJoin = { attempted: false, reason: `no market artifact at ${marketFile}` }
  } else {
    step('joining the market baseline on the ordinal meeting')
    const mk = JSON.parse(readFileSync(marketFile, 'utf8'))

    // THE JOIN KEY IS THE ORDINAL MEETING, NOT THE FINAL SCORE. Season 2023's
    // shot file carries no homeTeamScore/roadTeamScore — measured, after a run
    // keyed on them matched nothing — so the key is (home, away, k-th meeting
    // of the season), with ESPN ordered by date and MoneyPuck by game_id.
    //
    // AND THE JOIN VERIFIES ITSELF. For every matched pair the two sources'
    // OUTCOMES are compared. A mis-ordered join disagrees on roughly half of
    // them, so an agreement rate near 1 is evidence the ordering is right, and
    // anything below the floor below refuses the baseline instead of scoring
    // against a shuffled one. This repository's EPA route reported "149 route
    // plays, 149 client plays, 0 disagreements" while comparing both sides
    // against a table only one had unwrapped; agreement on zero is still
    // agreement, so the comparison here is of outcomes, which can disagree.
    const AGREEMENT_FLOOR = 0.98
    // A real book's three-way overround. The floor of 1 is arithmetic, not
    // taste: below it the book loses money on every outcome. The ceiling is a
    // judgement and the full distribution is reported so the choice is
    // visible rather than buried.
    const K_MIN = 1.00, K_MAX = 1.25

    const espnByPair = new Map()
    for (const g of mk.games || []) {
      const p = (g.providers || []).find(p => p.kind === '3way' || p.kind === '2way')
      if (!p) continue
      const k = `${g.home}|${g.away}`
      if (!espnByPair.has(k)) espnByPair.set(k, [])
      espnByPair.get(k).push({ ...g, provider: p })
    }
    for (const [, arr] of espnByPair) arr.sort((a, b) => String(a.date).localeCompare(String(b.date)))

    const mpByPair = new Map()
    const mpGames = new Map()
    for (const r of bySeason[testSeason]) {
      const id = `${r.season}-${r.game_id}`
      if (mpGames.has(id)) continue
      mpGames.set(id, { home: r.homeTeamCode, away: r.awayTeamCode, homeTeamWon: num(r.homeTeamWon), num: Number(r.game_id) })
      const k = `${r.homeTeamCode}|${r.awayTeamCode}`
      if (!mpByPair.has(k)) mpByPair.set(k, [])
      mpByPair.get(k).push(id)
    }
    for (const [, arr] of mpByPair) arr.sort((a, b) => mpGames.get(a).num - mpGames.get(b).num)

    const { marketProb } = await import('./hockey-wp-market.mjs')
    const probByGame = new Map()
    const kValues = []
    let matched = 0, unmatched = 0, lengthMismatchPairs = 0, outcomeAgree = 0, outcomeDisagree = 0
    let droppedImplausibleK = 0
    const mpCodes = new Set([...mpGames.values()].map(g => g.home))
    const espnCodes = new Set((mk.games || []).map(g => g.home))

    for (const [pair, ids] of mpByPair) {
      const espn = espnByPair.get(pair) || []
      if (espn.length !== ids.length) { lengthMismatchPairs += 1; unmatched += ids.length; continue }
      for (let i = 0; i < ids.length; i++) {
        const mpg = mpGames.get(ids[i]), eg = espn[i]
        if (mpg.homeTeamWon !== null) {
          if (mpg.homeTeamWon === eg.homeWon) outcomeAgree += 1; else outcomeDisagree += 1
        }
        const m = marketProb(eg.provider.homeMoneyLine, eg.provider.awayMoneyLine, model.tieRate, model.otHomeShare)
        if (m.pHome === null) { unmatched += 1; continue }
        if (m.detail?.k) kValues.push(+m.detail.k.toFixed(4))
        // THE RECONSTRUCTION'S OWN CHECK, ENFORCED PER GAME AND NOT JUST
        // REPORTED. k is the three-way overround implied by the measured tie
        // rate. A book cannot overround BELOW 1 — that is paying out more than
        // it takes — so k < 1 means these two prices are not a matched pair,
        // and the first run that merely reported the distribution found a
        // minimum of 0.3548.
        //
        // This matters in a direction that is easy to miss: a garbage market
        // probability makes the MARKET's Brier worse, which flatters the
        // model. Leaving them in would have bought a SHIPS verdict with the
        // baseline's own corrupt rows.
        if (m.detail?.k !== undefined && (m.detail.k < K_MIN || m.detail.k > K_MAX)) {
          droppedImplausibleK += 1
          continue
        }
        probByGame.set(ids[i], m.pHome)
        matched += 1
      }
    }
    kValues.sort((a, b) => a - b)
    const inspected = outcomeAgree + outcomeDisagree
    const agreementRate = inspected ? +(outcomeAgree / inspected).toFixed(4) : null

    marketJoin = {
      attempted: true, file: marketFile, key: 'ordinal meeting within the season',
      espn_pairs: espnByPair.size, moneypuck_pairs: mpByPair.size,
      moneypuck_games: mpGames.size,
      matched, unmatched, pairs_with_a_different_number_of_meetings: lengthMismatchPairs,
      match_rate: mpGames.size ? +(matched / mpGames.size).toFixed(4) : null,
      outcome_crosscheck: { inspected, agree: outcomeAgree, disagree: outcomeDisagree,
                            agreement_rate: agreementRate, floor: AGREEMENT_FLOOR,
                            passed: agreementRate !== null && agreementRate >= AGREEMENT_FLOOR },
      codes_only_in_moneypuck: [...mpCodes].filter(c => !espnCodes.has(c)).sort(),
      codes_only_in_espn: [...espnCodes].filter(c => !mpCodes.has(c)).sort(),
      dropped_for_implausible_overround: droppedImplausibleK,
      accepted_overround_band: { min: K_MIN, max: K_MAX },
      implied_three_way_overround: kValues.length
        ? (() => {
            const q = (f) => kValues[Math.min(kValues.length - 1, Math.floor(kValues.length * f))]
            return {
              n: kValues.length, min: kValues[0], p05: q(0.05), p25: q(0.25),
              median: q(0.5), p75: q(0.75), p95: q(0.95), max: kValues[kValues.length - 1],
              below_1: kValues.filter(k => k < 1).length,
              above_max: kValues.filter(k => k > K_MAX).length,
              note: 'k is the three-way overround implied by the measured tie rate. '
                + 'A median near 1.03-1.07 is evidence the three-way reading is right; '
                + 'the tails are dropped per game, not explained away. One known limitation: '
                + 'k uses one global tie rate, so a badly mismatched fixture has its own true '
                + 'draw probability and its k is mis-estimated by that much.'
            }
          })()
        : null
    }

    if (!marketJoin.outcome_crosscheck.passed) {
      marketJoin.refused = `the join's own outcome cross-check came in at ${agreementRate}, below the ${AGREEMENT_FLOOR} floor — the baseline is NOT used`
      step(`market join REFUSED: outcome agreement ${agreementRate}`)
    } else {
      const marketStates = testStates.filter(s => probByGame.has(s.gameId))
      results.market = evaluate(marketStates, s => probByGame.get(s.gameId),
        'de-vigged market (static pre-game, 3-way reconstructed)')
      results.model_on_market_games = evaluate(marketStates, predModel,
        'FIELD hockey-wp, market-covered games only')
      results.moneypuck_on_market_games = evaluate(
        marketStates.filter(s => s.homeWinProbability !== null), mpWp,
        'MoneyPuck, market-covered games only')
      // The market number is ONE PRE-GAME value per game while the model sees
      // the scoreboard, so beating it across in-game states is close to
      // arithmetic. This is the comparison that is actually hard: the model at
      // puck drop, where it knows nothing the market does not.
      const pregame = marketStates.filter(s => s.elapsedSeconds <= 60)
      results.market_pregame_only = evaluate(pregame, s => probByGame.get(s.gameId),
        'de-vigged market, first minute only')
      results.model_pregame_only = evaluate(pregame, predModel,
        'FIELD hockey-wp, first minute only — the HARD comparison')
    }
  }

  step('splitting by game state')
  const splits = {}
  const defs = {
    even_5v5: s => s.homeSkaters === 5 && s.awaySkaters === 5 && !s.homeEmptyNet && !s.awayEmptyNet,
    power_play: s => s.homeSkaters !== s.awaySkaters,
    final_two_minutes: s => s.elapsedSeconds >= 3480 && s.elapsedSeconds <= 3600,
    empty_net: s => s.homeEmptyNet || s.awayEmptyNet
  }
  for (const [name, pred] of Object.entries(defs)) {
    const sub = splitBy(testStates, pred)
    splits[name] = {
      model: evaluate(sub, predModel, `model / ${name}`),
      constant_half: evaluate(sub, () => 0.5, `0.5 / ${name}`),
      moneypuck: evaluate(sub.filter(s => s.homeWinProbability !== null), mpWp, `MoneyPuck / ${name}`)
    }
  }

  const beats = (a, b) => (a?.brier !== null && a?.brier !== undefined && b?.brier !== null && b?.brier !== undefined)
    ? a.brier < b.brier : null

  // THE VERDICT CARRIES ITS DENOMINATOR, because the first run of this gate
  // did not. It reported "DOES NOT SHIP — the model loses to the de-vigged
  // market baseline" on EIGHT of 1400 games: the OT term had been measured as
  // zero from an absent column, so the three-way reconstruction returned null
  // for 1243 paired games and only the nine genuinely two-way prices
  // survived. Every number needed to see that was in the artifact and the
  // verdict mentioned none of them. Rule 91 — the coverage prints where the
  // result is read, which for a ship/no-ship decision is the verdict string.
  const MARKET_GAME_FLOOR = 0.5
  const marketGames = marketJoin.matched ?? 0
  const marketAvailable = marketJoin.moneypuck_games ?? null
  const marketCoverage = marketAvailable ? marketGames / marketAvailable : 0
  const gate = {
    market_games_used: marketGames,
    market_games_available: marketAvailable,
    market_coverage: +marketCoverage.toFixed(4),
    market_coverage_floor: MARKET_GAME_FLOOR,
    beats_constant_half: beats(results.model, results.constant_half),
    beats_market_overall: results.market ? beats(results.model_on_market_games, results.market) : null,
    beats_market_pregame: results.market_pregame_only ? beats(results.model_pregame_only, results.market_pregame_only) : null,
    beats_moneypuck: beats(results.model, results.moneypuck),
    verdict: null
  }
  gate.verdict =
    !marketJoin.attempted
      ? `UNDECIDED — no market baseline was joined (${marketJoin.reason ?? 'reason not recorded'})`
    : marketJoin.refused
      ? `UNDECIDED — ${marketJoin.refused}`
    : marketCoverage < MARKET_GAME_FLOOR
      ? `UNDECIDED — the market baseline covers only ${marketGames} of ${marketAvailable} games `
        + `(${(marketCoverage * 100).toFixed(1)}%, floor ${MARKET_GAME_FLOOR * 100}%); a verdict on that sample would be noise`
    : gate.beats_market_overall === false
      ? `DOES NOT SHIP — the model loses to the de-vigged market baseline over ${marketGames} of ${marketAvailable} games`
    : gate.beats_constant_half === false
      ? 'DOES NOT SHIP — the model loses to constant 0.5'
    : `SHIPS — beats constant 0.5 and the de-vigged market over ${marketGames} of ${marketAvailable} games`

  const out = {
    cc_cmd: 'docs/CC-CMD-2026-10-10-nhl-win-probability-from-xg.md',
    started_at: started, finished_at: new Date().toISOString(),
    architecture: "CC-CMD option (b): a direct logistic on game state. Score differential and time remaining dominate; cumulative xG is one of nine features. Option (a) — xG rates into a Poisson over remaining time — was NOT built, because (b) cleared the bar. Nothing is ported from soccer-wp.js and DC_RHO is absent by design: it corrects draw inflation and hockey has no draws.",
    split: { trainSeasons, testSeason, shuffled: false, whole_seasons_held_out: true,
             train_states: trainStates.length, train_games: trainGames.size,
             test_states: testStates.length, test_games: testGames.size,
             games_on_both_sides: overlap.length },
    optional_columns_absent_by_season: absentBySeason,
    premises, xgModel, xgResults, model, results, splits, marketJoin, gate,
    breadcrumbs: BREADCRUMBS,
    coverage: `held-out season ${testSeason}: ${testGames.size} games / ${testStates.length} states; ` +
              `market baseline covers ${marketJoin.matched ?? 0} of those games` +
              `${marketJoin.attempted ? ` (match rate ${marketJoin.match_rate})` : ' (no market file present)'}; ` +
              `MoneyPuck baseline covers ${results.moneypuck.n} states`
  }

  mkdirSync('outbox', { recursive: true })
  const ts = started.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  writeFileSync(`outbox/hockey-wp-calibration-${ts}.json`, JSON.stringify(out, null, 2))
  writeFileSync('outbox/hockey-wp-calibration-latest.json', JSON.stringify(out, null, 2))

  if (gate.verdict.startsWith('SHIPS')) {
    writeFileSync('src/hockey-wp-model.js',
      `// GENERATED by scripts/hockey-wp-train.mjs — do not hand-edit.\n` +
      `// docs/CC-CMD-2026-10-10-nhl-win-probability-from-xg.md\n` +
      `//\n` +
      `// Trained ${model.trainedAt} on seasons ${trainSeasons.join(', ')}\n` +
      `// (${model.rows} shot states across ${model.games} games), held out ${testSeason}.\n` +
      `// Gate: ${gate.verdict}\n` +
      `// Held-out Brier — model ${results.model.brier}, constant 0.5 ${results.constant_half.brier}, ` +
      `market ${results.market ? results.market.brier : 'n/a'}, MoneyPuck ${results.moneypuck.brier}.\n` +
      `// Full artifact: outbox/hockey-wp-calibration-latest.json\n` +
      `//\n` +
      `// Inference is a dot product over these coefficients. No ML runtime.\n\n` +
      `export const HOCKEY_WP_MODEL = ${JSON.stringify(model, null, 2)}\n\n` +
      `export const HOCKEY_XG_MODEL = ${JSON.stringify(xgModel, null, 2)}\n`)
    console.log('wrote src/hockey-wp-model.js')
  } else {
    console.log('GATE NOT PASSED — src/hockey-wp-model.js deliberately NOT written')
  }

  console.log(`\n${out.coverage}`)
  console.log(`gate: ${gate.verdict}`)
  for (const [k, v] of Object.entries(results))
    console.log(`  ${k}: brier ${v.brier} logLoss ${v.logLoss} n=${v.n}`)
  console.log(`  xG: field brier ${xgResults.field_xg.brier} vs MoneyPuck ${xgResults.moneypuck_xg?.brier} vs base rate ${xgResults.constant_base_rate.brier}`)
}

const _entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
const _isEntry = _entryHref !== null && import.meta.url === _entryHref

const selfTest = () => {
  let pass = 0, fail = 0
  const t = (n, c) => { if (c) { pass++; console.log(`PASS  ${n}`) } else { fail++; console.log(`FAIL  ${n}`) } }

  t('the shot-file URL is resolved from the vendor index, mirror host included',
    (() => {
      const u = resolveShotUrls('<a href="https://peter-tanner.com/moneypuck/downloads/shots_2024.zip">x</a>')
      return u['2024'] === 'https://peter-tanner.com/moneypuck/downloads/shots_2024.zip'
    })())
  t('a relative href resolves against the index, not the cwd',
    resolveShotUrls('<a href="/dl/shots_2023.zip">x</a>')['2023'] === 'https://moneypuck.com/dl/shots_2023.zip')
  t('a range zip is not mistaken for a season file',
    Object.keys(resolveShotUrls('<a href="https://x/shots_2007-2025.zip">x</a>')).length === 0)

  t('an absent column throws rather than parsing to undefined',
    (() => { try { parseCsv('a,b\n1,2\n', ['a', 'zzz']); return false } catch (e) { return /column absent/.test(e.message) } })())

  const goalRows = [
    { game_id: '1', goal: '1', isHomeTeam: '1', homeTeamGoals: '0', awayTeamGoals: '0' },
    { game_id: '1', goal: '0', isHomeTeam: '0', homeTeamGoals: '1', awayTeamGoals: '0' }
  ]
  t('a goal not yet counted on its own row reads as pre-shot',
    scoreSemantics(goalRows).verdict.startsWith('pre-shot'))
  t('a goal already counted on its own row reads as post-shot',
    scoreSemantics([
      { game_id: '1', goal: '1', isHomeTeam: '1', homeTeamGoals: '1', awayTeamGoals: '0' },
      { game_id: '1', goal: '0', isHomeTeam: '0', homeTeamGoals: '1', awayTeamGoals: '0' }
    ]).verdict.startsWith('post-shot'))
  t('a goal row with no following row in the same game is not inspected',
    scoreSemantics([
      { game_id: '1', goal: '1', isHomeTeam: '1', homeTeamGoals: '0', awayTeamGoals: '0' },
      { game_id: '2', goal: '0', isHomeTeam: '0', homeTeamGoals: '5', awayTeamGoals: '0' }
    ]).inspected === 0)

  t('a constant homeTeamScore within a game reads as the final score',
    finalScoreSemantics([
      { game_id: '1', homeTeamScore: '4', homeTeamGoals: '0' },
      { game_id: '1', homeTeamScore: '4', homeTeamGoals: '1' }
    ]).verdict.startsWith('homeTeamScore is the FINAL'))

  t('the OT home share is derived from the periods and carries its sample size',
    (() => {
      const o = otSemantics([
        { game_id: '1', period: '4', homeTeamWon: '1', isPlayoffGame: '0' },
        { game_id: '2', period: '5', homeTeamWon: '0', isPlayoffGame: '0' },
        { game_id: '3', period: '3', homeTeamWon: '1', isPlayoffGame: '0' }
      ])
      return o.wentToOT === 2 && o.wentToShootout === 1 && o.otHomeShare === 0.5
        && o.otHomeShare_n === 2 && o.tieRate === 0.6667
    })())
  t('with no overtime games the OT share is null, NOT 0.5',
    otSemantics([{ game_id: '1', period: '3', homeTeamWon: '1', isPlayoffGame: '0' }]).otHomeShare === null)
  t('AN ABSENT wentToOT COLUMN NO LONGER PRODUCES A TIE RATE OF ZERO',
    (() => {
      const o = otSemantics([
        { game_id: '1', period: '4', homeTeamWon: '1', isPlayoffGame: '0' },
        { game_id: '2', period: '3', homeTeamWon: '0', isPlayoffGame: '0' }
      ])
      return o.wentToOT_column_present === false && o.tieRate === 0.5 && o.otHomeShare === 1
    })())
  t('where the column exists it is cross-checked against the derivation, not trusted',
    (() => {
      const o = otSemantics([
        { game_id: '1', period: '4', wentToOT: '1', homeTeamWon: '1', isPlayoffGame: '0' },
        { game_id: '2', period: '3', wentToOT: '0', homeTeamWon: '0', isPlayoffGame: '0' }
      ])
      return o.wentToOT_column_present === true && o.column_vs_derivation.agreement_rate === 1
    })())
  t('a column that disagrees with the periods is reported as a disagreement',
    otSemantics([{ game_id: '1', period: '3', wentToOT: '1', homeTeamWon: '1', isPlayoffGame: '0' }])
      .column_vs_derivation.disagree === 1)

  t('a column present in the header but empty on every row is NOT reported usable',
    (() => {
      const c = columnStates([{ a: '' }, { a: '' }], ['a'])
      return c.a.empty === 2 && c.a.usable === 0 && /NO usable value/.test(c.a.verdict)
    })())
  t('a column absent from the header is distinguished from one that is empty',
    (() => {
      const c = columnStates([{ b: '' }, { b: '' }], ['a', 'b'])
      return c.a.verdict === 'absent from the header' && /NO usable value/.test(c.b.verdict)
    })())
  t('an NA literal is its own state, not an unparseable one',
    columnStates([{ a: 'NA' }], ['a']).a.na_literal === 1)
  t('a fully usable column says so',
    columnStates([{ a: '0.5' }, { a: '0.6' }], ['a']).a.verdict === 'present and usable on every row')
  t('a partly usable column reports the fraction rather than a boolean',
    /usable on 1 of 2 rows/.test(columnStates([{ a: '0.5' }, { a: '' }], ['a']).a.verdict))

  t('timeLeft counting to the end of regulation is identified as such',
    clockSemantics([{ time: '600', timeLeft: '3000', period: '1' }]).verdict.includes('REGULATION'))
  t('timeLeft counting to the end of the period is identified as such',
    clockSemantics([{ time: '600', timeLeft: '600', period: '1' }]).verdict.includes('PERIOD'))

  t('a state missing its strength is dropped rather than defaulted to even',
    buildStates([{ season: '2024', game_id: '1', isPlayoffGame: '0', isHomeTeam: '1', time: '10', period: '1',
      homeTeamGoals: '0', awayTeamGoals: '0', homeSkatersOnIce: '', awaySkatersOnIce: '5',
      homeEmptyNet: '0', awayEmptyNet: '0', xGoal: '0.1', homeTeamWon: '1', goal: '0',
      homeTeamCode: 'A', awayTeamCode: 'B', homeWinProbability: '0.5' }], { scoreIsPreShot: true }).length === 0)
  t('cumulative xG excludes the shot on its own row',
    (() => {
      const s = buildStates([
        { season: '2024', game_id: '1', isPlayoffGame: '0', isHomeTeam: '1', time: '10', period: '1',
          homeTeamGoals: '0', awayTeamGoals: '0', homeSkatersOnIce: '5', awaySkatersOnIce: '5',
          homeEmptyNet: '0', awayEmptyNet: '0', xGoal: '0.4', homeTeamWon: '1', goal: '0',
          homeTeamCode: 'A', awayTeamCode: 'B', homeWinProbability: '0.5' },
        { season: '2024', game_id: '1', isPlayoffGame: '0', isHomeTeam: '1', time: '20', period: '1',
          homeTeamGoals: '0', awayTeamGoals: '0', homeSkatersOnIce: '5', awaySkatersOnIce: '5',
          homeEmptyNet: '0', awayEmptyNet: '0', xGoal: '0.1', homeTeamWon: '1', goal: '0',
          homeTeamCode: 'A', awayTeamCode: 'B', homeWinProbability: '0.5' }
      ], { scoreIsPreShot: true })
      return s[0].xgDiff === 0 && Math.abs(s[1].xgDiff - 0.4) < 1e-9
    })())
  t('a post-shot score column is rolled back so the state precedes its own goal',
    (() => {
      const s = buildStates([{ season: '2024', game_id: '1', isPlayoffGame: '0', isHomeTeam: '1', time: '10', period: '1',
        homeTeamGoals: '1', awayTeamGoals: '0', homeSkatersOnIce: '5', awaySkatersOnIce: '5',
        homeEmptyNet: '0', awayEmptyNet: '0', xGoal: '0.4', homeTeamWon: '1', goal: '1',
        homeTeamCode: 'A', awayTeamCode: 'B', homeWinProbability: '0.5' }], { scoreIsPreShot: false })
      return s[0].homeScore === 0
    })())

  t('an optional column may be absent without throwing; a required one throws',
    (() => {
      const rows = parseCsv('game_id,goal\n1,0\n', ['game_id', 'goal', 'homeWinProbability'], ['homeWinProbability'])
      let threw = false
      try { parseCsv('game_id\n1\n', ['game_id', 'goal'], []) } catch (e) { threw = /required column absent/.test(e.message) }
      return rows[0].homeWinProbability === undefined && threw
    })())

  t('the vendor shot-type vocabulary is reported, and an unmapped value is named',
    (() => {
      const v = shotTypeVocabulary([{ shotType: 'WRIST' }, { shotType: 'WRIST' }, { shotType: 'ONE-TIMER' }])
      return v.unmapped.length === 1 && v.unmapped[0] === 'ONE-TIMER'
        && Math.abs(v.unmapped_row_share - 1 / 3) < 1e-6
        && v.values_verbatim.join(',') === 'ONE-TIMER,WRIST'
    })())
  t('a fully mapped vocabulary reports no unmapped values',
    shotTypeVocabulary([{ shotType: 'SNAP' }, { shotType: 'TIP' }]).unmapped.length === 0)

  // THE GEOMETRY IS CONFIRMED AGAINST THE VENDOR'S OWN COLUMNS, on a real row
  // taken verbatim from the probe artifact: xCordAdjusted 57, yCordAdjusted
  // -40 carries shotDistance 51.2249938995 and shotAngleAdjusted
  // 51.3401917459. A formula aimed at the wrong net returns a number too.
  t("the distance formula reproduces the vendor's shotDistance to four places",
    Math.abs(geometryFromCoords({ xCoord: 57, yCoord: -40, netX: 89 }).distance - 51.2249938995) < 0.0005)
  t("the angle formula reproduces the vendor's shotAngleAdjusted to four places",
    Math.abs(geometryFromCoords({ xCoord: 57, yCoord: -40, netX: 89 }).angleAbs - 51.3401917459) < 0.0005)
  t('geometryAgreement reports a mismatch rather than averaging it away',
    (() => {
      const bad = geometryAgreement([{ xCordAdjusted: '57', yCordAdjusted: '-40', shotDistance: '10', shotAngleAdjusted: '5' }])
      const good = geometryAgreement([{ xCordAdjusted: '57', yCordAdjusted: '-40', shotDistance: '51.2249938995', shotAngleAdjusted: '51.3401917459' }])
      return bad.distance_agreement_rate === 0 && good.distance_agreement_rate === 1 && good.angle_agreement_rate === 1
    })())

  t('an xG row carries the shooter skater advantage from the shooter\'s side',
    (() => {
      const home = buildXgRows([{ shotDistance: '20', shotAngleAdjusted: '10', goal: '0', isHomeTeam: '1',
        homeSkatersOnIce: '5', awaySkatersOnIce: '4', shotType: 'WRIST', shotRebound: '0', shotRush: '0', shotOnEmptyNet: '0', xGoal: '0.1' }])
      const away = buildXgRows([{ shotDistance: '20', shotAngleAdjusted: '10', goal: '0', isHomeTeam: '0',
        homeSkatersOnIce: '5', awaySkatersOnIce: '4', shotType: 'WRIST', shotRebound: '0', shotRush: '0', shotOnEmptyNet: '0', xGoal: '0.1' }])
      const i = XG_FEATURES.indexOf('shooterSkaterAdvantage')
      return home[0].x[i] === 1 && away[0].x[i] === -1
    })())
  t('an xG row with no distance is dropped rather than given one',
    buildXgRows([{ shotDistance: '', shotAngleAdjusted: '10', goal: '0', isHomeTeam: '1',
      homeSkatersOnIce: '5', awaySkatersOnIce: '5', shotType: 'WRIST' }]).length === 0)
  t('an unmapped shot type falls to the base level rather than throwing',
    buildXgRows([{ shotDistance: '20', shotAngleAdjusted: '10', goal: '0', isHomeTeam: '1',
      homeSkatersOnIce: '5', awaySkatersOnIce: '5', shotType: 'ONE-TIMER', shotRebound: '0', shotRush: '0', shotOnEmptyNet: '0', xGoal: '0.1' }]).length === 1)

  t('buildStates uses the supplied xG scorer, not the vendor column',
    (() => {
      const row = { season: '2024', game_id: '1', isPlayoffGame: '0', isHomeTeam: '1', time: '10', period: '1',
        homeTeamGoals: '0', awayTeamGoals: '0', homeSkatersOnIce: '5', awaySkatersOnIce: '5',
        homeEmptyNet: '0', awayEmptyNet: '0', xGoal: '0.9', homeTeamWon: '1', goal: '0',
        homeTeamCode: 'A', awayTeamCode: 'B', homeWinProbability: '0.5' }
      const s = buildStates([row, { ...row, time: '20' }], { scoreIsPreShot: true, xgOf: () => 0.25 })
      return Math.abs(s[1].xgDiff - 0.25) < 1e-9
    })())

  t('evaluate skips a baseline that returns null instead of scoring it as 0',
    evaluate([{ homeTeamWon: 1 }, { homeTeamWon: 0 }], () => null, 'x').n === 0)
  t('a perfect predictor scores Brier 0 and a reversed one scores 1',
    (() => {
      const st = [{ homeTeamWon: 1 }, { homeTeamWon: 0 }]
      return evaluate(st, s => s.homeTeamWon, 'p').brier === 0 && evaluate(st, s => 1 - s.homeTeamWon, 'r').brier === 1
    })())
  t('constant 0.5 scores exactly 0.25',
    evaluate([{ homeTeamWon: 1 }, { homeTeamWon: 0 }], () => 0.5, 'h').brier === 0.25)

  console.log(`\n${pass}/${pass + fail} checks passed`)
  if (fail) process.exit(1)
}

if (_isEntry) {
  if (process.argv.includes('--self-test')) selfTest()
  else main().catch(e => {
    // A THROW MUST STILL LEAVE AN ARTIFACT. The first run of this script
    // failed and the reason was unreadable: runs/<id>/logs answers with a
    // redirect to blob storage that this project's GitHub client refuses, and
    // the workflow's `if: always()` commit step had nothing to commit because
    // the script died before writing. live-check.yml already records that
    // redirect as the reason its manifest is committed to outbox/ instead.
    try {
      mkdirSync('outbox', { recursive: true })
      const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
      const body = {
        cc_cmd: 'docs/CC-CMD-2026-10-10-nhl-win-probability-from-xg.md',
        failed_at: new Date().toISOString(),
        argv: process.argv.slice(2),
        error: String(e && e.message || e),
        stack: String(e && e.stack || ''),
        breadcrumbs: BREADCRUMBS,
        heap: process.memoryUsage ? process.memoryUsage() : null
      }
      writeFileSync(`outbox/hockey-wp-train-failure-${ts}.json`, JSON.stringify(body, null, 2))
      writeFileSync('outbox/hockey-wp-train-failure-latest.json', JSON.stringify(body, null, 2))
      console.error(`wrote outbox/hockey-wp-train-failure-${ts}.json`)
    } catch (_) { /* reporting the failure must not replace it */ }
    console.error(String(e && e.stack || e))
    process.exit(1)
  })
}
