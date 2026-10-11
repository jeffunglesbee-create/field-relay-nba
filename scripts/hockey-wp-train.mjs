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
  brier, logLoss, reliability, standardise
} from './hockey-wp-lib.mjs'

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

export const parseCsv = (text, keep) => {
  const lines = text.split('\n')
  const header = lines[0].replace(/\r$/, '').split(',')
  const idx = {}
  for (const k of keep) {
    const i = header.indexOf(k)
    if (i < 0) throw new Error(`column absent from the vendor file: ${k}`)
    idx[k] = i
  }
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]
    if (!l || l === '\r') continue
    const v = l.replace(/\r$/, '').split(',')
    const r = {}
    for (const k of keep) r[k] = v[idx[k]]
    rows.push(r)
  }
  return rows
}

export const KEEP = [
  'game_id', 'season', 'isPlayoffGame', 'homeTeamCode', 'awayTeamCode',
  'homeTeamWon', 'time', 'period', 'event', 'goal', 'xGoal', 'isHomeTeam',
  'homeTeamGoals', 'awayTeamGoals', 'homeTeamScore', 'roadTeamScore',
  'homeSkatersOnIce', 'awaySkatersOnIce', 'homeEmptyNet', 'awayEmptyNet',
  'homeWinProbability', 'wentToOT', 'wentToShootout', 'timeLeft', 'gameOver'
]

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
  const byGame = new Map()
  for (const r of rows) {
    if (byGame.has(r.game_id)) continue
    byGame.set(r.game_id, {
      wentToOT: r.wentToOT, wentToShootout: r.wentToShootout,
      homeTeamWon: num(r.homeTeamWon), isPlayoff: r.isPlayoffGame === '1'
    })
  }
  const all = [...byGame.values()]
  const ot = all.filter(g => g.wentToOT === '1')
  const so = all.filter(g => g.wentToShootout === '1')
  const otHomeWins = ot.filter(g => g.homeTeamWon === 1).length
  const soHomeWins = so.filter(g => g.homeTeamWon === 1).length
  return {
    games: all.length,
    wentToOT: ot.length,
    wentToShootout: so.length,
    tieRate: all.length ? +(ot.length / all.length).toFixed(4) : null,
    // Done condition 3: a MEASURED constant with its sample size, not 0.5.
    otHomeShare: ot.length ? +(otHomeWins / ot.length).toFixed(4) : null,
    otHomeShare_n: ot.length,
    shootoutHomeShare: so.length ? +(soHomeWins / so.length).toFixed(4) : null,
    shootoutHomeShare_n: so.length,
    homeWinRate_all: all.length ? +(all.filter(g => g.homeTeamWon === 1).length / all.length).toFixed(4) : null
  }
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
export const buildStates = (rows, { scoreIsPreShot }) => {
  const out = []
  let gid = null, hxg = 0, axg = 0
  for (const r of rows) {
    if (r.game_id !== gid) { gid = r.game_id; hxg = 0; axg = 0 }
    const isHome = r.isHomeTeam === '1' || r.isHomeTeam === '1.0'
    const xg = num(r.xGoal) ?? 0
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

const main = async () => {
  const args = process.argv.slice(2)
  const argOf = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d }
  const trainSeasons = argOf('seasons', '2021,2022,2023').split(',')
  const testSeason = argOf('test', '2024')
  const marketFile = argOf('market', 'outbox/hockey-wp-market-baseline-latest.json')
  const iters = Number(argOf('iters', '400'))
  const started = new Date().toISOString()

  const idx = await fetch(MP_INDEX, { signal: AbortSignal.timeout(30000) })
  const urls = resolveShotUrls(await idx.text())
  const need = [...trainSeasons, testSeason]
  const missing = need.filter(s => !urls[s])
  if (missing.length) throw new Error(`the vendor index offers no shot file for: ${missing.join(',')}`)

  mkdirSync('/tmp/mp', { recursive: true })
  const bySeason = {}
  for (const s of need) {
    const zip = `/tmp/mp/shots_${s}.zip`
    if (!existsSync(zip)) {
      const r = await fetch(urls[s], { signal: AbortSignal.timeout(180000) })
      if (!r.ok) throw new Error(`shots_${s}: HTTP ${r.status}`)
      writeFileSync(zip, Buffer.from(await r.arrayBuffer()))
    }
    const name = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n')[0]
    const csv = execFileSync('unzip', ['-p', zip, name], { encoding: 'utf8', maxBuffer: 1024 ** 3 })
    bySeason[s] = parseCsv(csv, KEEP)
    console.log(`  ${s}: ${bySeason[s].length} shot rows`)
  }

  // ── the four data premises, measured on the TEST season ───────────────────
  const premises = {
    score_columns: scoreSemantics(bySeason[testSeason]),
    final_score_column: finalScoreSemantics(bySeason[testSeason]),
    clock_column: clockSemantics(bySeason[testSeason]),
    overtime: otSemantics(bySeason[testSeason])
  }
  const scoreIsPreShot = premises.score_columns.verdict.startsWith('pre-shot')
  if (premises.score_columns.verdict.startsWith('mixed'))
    throw new Error('STOP: the score column reading is mixed; building on either would be a guess')

  const trainStates = trainSeasons.flatMap(s => buildStates(bySeason[s], { scoreIsPreShot }))
  const testStates = buildStates(bySeason[testSeason], { scoreIsPreShot })

  const trainGames = new Set(trainStates.map(s => s.gameId))
  const testGames = new Set(testStates.map(s => s.gameId))
  const overlap = [...testGames].filter(g => trainGames.has(g))
  if (overlap.length) throw new Error(`STOP: ${overlap.length} games appear on both sides of the split`)

  const X = trainStates.map(featureVector)
  const y = trainStates.map(s => s.homeTeamWon)
  console.log(`training on ${X.length} states from ${trainGames.size} games, ${iters} iterations`)
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
    // Measured, not 0.5 — done condition 3.
    tieRate: premises.overtime.tieRate,
    otHomeShare: premises.overtime.otHomeShare,
    otHomeShare_n: premises.overtime.otHomeShare_n,
    pregamePrior: premises.overtime.homeWinRate_all
  }

  const predModel = (s) => predictFromVector(featureVector(s), model)

  // ── Task 3's three baselines ──────────────────────────────────────────────
  // 1. constant 0.5 — the floor.
  // 2. MoneyPuck's own homeWinProbability, which is a COLUMN of the shot file.
  //    The CC-CMD's sourcing section concluded nobody serves an NHL win
  //    probability; that is true of the three LIVE sources it measured and
  //    false of this historical file, and the refutation belongs in the open.
  //    It is NEVER a training target — the label is the outcome. Distilling
  //    MoneyPuck would make this comparison vacuous.
  // 3. the de-vigged market, joined from the ESPN artifact.
  const results = {
    model: evaluate(testStates, predModel, 'FIELD hockey-wp'),
    constant_half: evaluate(testStates, () => 0.5, 'constant 0.5'),
    moneypuck: evaluate(testStates.filter(s => s.homeWinProbability !== null),
      s => s.homeWinProbability > 1 ? s.homeWinProbability / 100 : s.homeWinProbability,
      "MoneyPuck homeWinProbability (vendor's own model)")
  }

  // Market join. ESPN carries date + abbreviation + final score; MoneyPuck
  // carries team codes + final score and NO date, so the join key is
  // (homeCode, awayCode, homeScore, awayScore) within the season and the
  // SCORE AGREEMENT IS THE JOIN'S OWN VERIFICATION. Colliding keys are
  // dropped and counted rather than resolved by a guess.
  let marketJoin = { attempted: false }
  if (existsSync(marketFile)) {
    const mk = JSON.parse(readFileSync(marketFile, 'utf8'))
    const espnByKey = new Map()
    const collisions = new Set()
    for (const g of mk.games || []) {
      const p = (g.providers || []).find(p => p.kind === '3way' || p.kind === '2way')
      if (!p) continue
      const key = `${g.home}|${g.away}|${g.homeScore}|${g.awayScore}`
      if (espnByKey.has(key)) collisions.add(key)
      espnByKey.set(key, { ...g, provider: p })
    }
    for (const k of collisions) espnByKey.delete(k)

    const mpFinal = new Map()
    for (const r of bySeason[testSeason]) {
      const k = `${r.season}-${r.game_id}`
      if (!mpFinal.has(k)) mpFinal.set(k, {
        home: r.homeTeamCode, away: r.awayTeamCode,
        homeScore: num(r.homeTeamScore), awayScore: num(r.roadTeamScore)
      })
    }
    const { marketProb } = await import('./hockey-wp-market.mjs')
    const probByGame = new Map()
    let matched = 0, unmatched = 0
    const mpCodes = new Set(), espnCodes = new Set()
    for (const [gameId, f] of mpFinal) {
      mpCodes.add(f.home)
      const key = `${f.home}|${f.away}|${f.homeScore}|${f.awayScore}`
      const hit = espnByKey.get(key)
      if (!hit) { unmatched += 1; continue }
      const m = marketProb(hit.provider.homeMoneyLine, hit.provider.awayMoneyLine,
        model.tieRate, model.otHomeShare)
      if (m.pHome === null) { unmatched += 1; continue }
      probByGame.set(gameId, m.pHome)
      matched += 1
    }
    for (const g of mk.games || []) espnCodes.add(g.home)
    marketJoin = {
      attempted: true, file: marketFile,
      espn_games_with_usable_provider: espnByKey.size,
      espn_key_collisions_dropped: collisions.size,
      moneypuck_games: mpFinal.size,
      matched, unmatched,
      match_rate: mpFinal.size ? +(matched / mpFinal.size).toFixed(4) : null,
      moneypuck_home_codes: [...mpCodes].sort(),
      espn_home_codes: [...espnCodes].sort(),
      codes_only_in_moneypuck: [...mpCodes].filter(c => !espnCodes.has(c)).sort(),
      codes_only_in_espn: [...espnCodes].filter(c => !mpCodes.has(c)).sort()
    }
    const marketStates = testStates.filter(s => probByGame.has(s.gameId))
    results.market = evaluate(marketStates, s => probByGame.get(s.gameId),
      'de-vigged market (static pre-game, 3-way reconstructed)')
    // Like-for-like: the model scored on exactly the games the market covers.
    results.model_on_market_games = evaluate(marketStates, predModel, 'FIELD hockey-wp, market-covered games only')
    results.moneypuck_on_market_games = evaluate(
      marketStates.filter(s => s.homeWinProbability !== null),
      s => s.homeWinProbability > 1 ? s.homeWinProbability / 100 : s.homeWinProbability,
      'MoneyPuck, market-covered games only')
  }

  // ── splits the CC-CMD names ───────────────────────────────────────────────
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
      moneypuck: evaluate(sub.filter(s => s.homeWinProbability !== null),
        s => s.homeWinProbability > 1 ? s.homeWinProbability / 100 : s.homeWinProbability, `MoneyPuck / ${name}`)
    }
  }

  const beats = (a, b) => (a?.brier !== null && b?.brier !== null) ? a.brier < b.brier : null
  const gate = {
    beats_constant_half: beats(results.model, results.constant_half),
    beats_market: results.market ? beats(results.model_on_market_games, results.market) : null,
    beats_moneypuck: beats(results.model, results.moneypuck),
    verdict: null
  }
  gate.verdict =
    gate.beats_market === null ? 'UNDECIDED — no market baseline was joined, so the gate was not evaluated'
    : gate.beats_market === false ? 'DOES NOT SHIP — the model loses to the de-vigged market baseline'
    : gate.beats_constant_half === false ? 'DOES NOT SHIP — the model loses to constant 0.5'
    : 'SHIPS — beats both required baselines'

  const out = {
    cc_cmd: 'docs/CC-CMD-2026-10-10-nhl-win-probability-from-xg.md',
    started_at: started, finished_at: new Date().toISOString(),
    split: { trainSeasons, testSeason, shuffled: false, whole_seasons_held_out: true,
             train_states: trainStates.length, train_games: trainGames.size,
             test_states: testStates.length, test_games: testGames.size,
             games_on_both_sides: overlap.length },
    premises, model, results, splits, marketJoin, gate,
    coverage: `test season ${testSeason}: ${testGames.size} games / ${testStates.length} states; ` +
              `market baseline covers ${marketJoin.matched ?? 0} of those games` +
              `${marketJoin.attempted ? ` (match rate ${marketJoin.match_rate})` : ' (no market file present)'}`
  }

  mkdirSync('outbox', { recursive: true })
  const ts = started.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  writeFileSync(`outbox/hockey-wp-calibration-${ts}.json`, JSON.stringify(out, null, 2))
  writeFileSync('outbox/hockey-wp-calibration-latest.json', JSON.stringify(out, null, 2))

  // The coefficient table the Worker scores from. Written ONLY when the gate
  // passes: a model that loses to what already ships must not become the file
  // src/hockey-wp.js imports.
  if (gate.verdict.startsWith('SHIPS')) {
    writeFileSync('src/hockey-wp-model.js',
      `// GENERATED by scripts/hockey-wp-train.mjs — do not hand-edit.\n` +
      `// docs/CC-CMD-2026-10-10-nhl-win-probability-from-xg.md\n` +
      `//\n` +
      `// Trained ${model.trainedAt} on seasons ${trainSeasons.join(', ')}\n` +
      `// (${model.rows} shot states across ${model.games} games), held out ${testSeason}.\n` +
      `// Gate: ${gate.verdict}\n` +
      `// Brier on the held-out season — model ${results.model.brier}, ` +
      `constant 0.5 ${results.constant_half.brier}, ` +
      `market ${results.market ? results.market.brier : 'n/a'}, ` +
      `MoneyPuck ${results.moneypuck.brier}.\n` +
      `// Full artifact: outbox/hockey-wp-calibration-latest.json\n\n` +
      `export const HOCKEY_WP_MODEL = ${JSON.stringify(model, null, 2)}\n`)
    console.log('wrote src/hockey-wp-model.js')
  } else {
    console.log('GATE NOT PASSED — src/hockey-wp-model.js deliberately NOT written')
  }

  console.log(`\n${out.coverage}`)
  console.log(`gate: ${gate.verdict}`)
  for (const [k, v] of Object.entries(results))
    console.log(`  ${k}: brier ${v.brier} logLoss ${v.logLoss} n=${v.n}`)
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

  t('the OT home share is measured and carries its sample size',
    (() => {
      const o = otSemantics([
        { game_id: '1', wentToOT: '1', wentToShootout: '0', homeTeamWon: '1', isPlayoffGame: '0' },
        { game_id: '2', wentToOT: '1', wentToShootout: '1', homeTeamWon: '0', isPlayoffGame: '0' },
        { game_id: '3', wentToOT: '0', wentToShootout: '0', homeTeamWon: '1', isPlayoffGame: '0' }
      ])
      return o.wentToOT === 2 && o.otHomeShare === 0.5 && o.otHomeShare_n === 2 && o.tieRate === 0.6667
    })())
  t('with no overtime games the OT share is null, NOT 0.5',
    otSemantics([{ game_id: '1', wentToOT: '0', wentToShootout: '0', homeTeamWon: '1', isPlayoffGame: '0' }]).otHomeShare === null)

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
  else main().catch(e => { console.error(String(e && e.stack || e)); process.exit(1) })
}
