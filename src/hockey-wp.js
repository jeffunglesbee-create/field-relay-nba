// src/hockey-wp.js — NHL live win probability.
//
// docs/CC-CMD-2026-10-10-nhl-win-probability-from-xg.md
//
// WHY THIS FILE EXISTS. Nobody serves a live NHL win probability. Measured
// 2026-10-10: ESPN's hockey summary has 19 top-level keys and no
// winprobability array (it has one for nba/wnba/mlb, which is why
// wp-resolver.js branches on those three and routes NHL to the Odds API); all
// four NHL gamecenter endpoints carry none; and BSD's hockey coverage is 13
// European leagues with no NHL. The only alternative is the de-vigged
// moneyline wp-resolver.js:511 already serves as 'Market estimate'.
//
// RULE 47 / ADR-002. This is a probability of a binary outcome — arithmetic on
// game state. It is not an interest or excitement level, and nothing here
// answers "should I watch this game?". src/soccer-wp.js is the standing
// precedent for a probability model living in the relay; the claim is
// identical and the sport is different. Rule A: PULL ONLY. Nothing in this
// file is pushed, alerted, or recomputed on a cron.
//
// NOTHING IS PORTED FROM soccer-wp.js, and DC_RHO in particular is absent by
// design. Dixon-Coles' rho inflates low-score DRAW probabilities. Hockey has
// no draws: a game tied after regulation is decided in overtime or a shootout
// and one side wins. Copying rho across would be a category error dressed as
// reuse. The architecture is the CC-CMD's option (b) — a direct logistic on
// game state — because score differential and time remaining dominate win
// probability and cumulative xG is one feature of nine, not the model.
//
// INFERENCE IS A DOT PRODUCT over a committed coefficient table. No ML
// runtime in the Worker, which is the CC-CMD's first stop condition.

import {
  featureVector, stateProblems, predictFromVector,
  xgFeatureVector, NHL_SHOT_TYPE_TO_MP, attackingNetX, geometryFromCoords
} from './hockey-wp-lib.js'
import { HOCKEY_WP_MODEL, HOCKEY_XG_MODEL } from './hockey-wp-model.js'

export const WP_SOURCE = 'field-hockey-wp'

// Task 4: the label must be distinct from the two that already exist.
// wp-resolver.js serves 'Market estimate' (a de-vigged book price) and
// 'Statistical probability' (a vendor's own published model). This is a third
// kind of number — FIELD's own model — and conflating it with either is the
// substitution this repository keeps finding.
export const WP_LABEL = 'FIELD model probability'
export const PRIOR_LABEL = 'FIELD pre-game prior'

export const MARKET_LABEL = 'Market estimate'          // do not reuse
export const VENDOR_LABEL = 'Statistical probability'  // do not reuse

export const SHOT_TYPES_PBP = new Set([
  'shot-on-goal', 'missed-shot', 'blocked-shot', 'goal'
])

// The confirmed reading of situationCode: four digits, away goalie / away
// skaters / home skaters / home goalie. CONFIRMED 2026-10-11 against two
// independent derivations on game 2026020053 — penalty windows from the plays
// array (26 informative agreements, 0 disagreements) and goalie time-on-ice
// from the boxscore (away goalies covered 3364s of 3600, and situationCode
// independently reported 0651 for seven third-period shots).
// outbox/hockey-wp-probe-latest.json carries both.
export const parseSituation = (code) => {
  const s = String(code ?? '')
  if (!/^\d{4}$/.test(s)) return null
  return {
    awayGoalie: s[0] === '1',
    awaySkaters: Number(s[1]),
    homeSkaters: Number(s[2]),
    homeGoalie: s[3] === '1'
  }
}

export const toElapsedSeconds = (periodNumber, timeInPeriod) => {
  if (!Number.isFinite(periodNumber)) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeInPeriod ?? ''))
  if (!m) return null
  return (periodNumber - 1) * 1200 + Number(m[1]) * 60 + Number(m[2])
}

// ── xG for one play-by-play shot ────────────────────────────────────────────
export const shotXg = (play, ctx, model = HOCKEY_XG_MODEL) => {
  // The WP path guarded a null model and this one did not, which is the same
  // defect one layer down: scoreLinear dereferenced intercept on null and the
  // whole walk threw. Found by this file's own check before it ran anywhere.
  if (!model || !Array.isArray(model.coefficients))
    return { xg: null, problems: ['xg-model-absent'], notReported: [] }
  const d = play?.details || {}
  const period = play?.periodDescriptor?.number
  const sit = parseSituation(play?.situationCode)
  if (!sit) return { xg: null, problems: ['situation-unreadable'] }
  const shooterIsHome = d.eventOwnerTeamId === ctx.homeTeamId
  if (d.eventOwnerTeamId === undefined || ctx.homeTeamId === undefined)
    return { xg: null, problems: ['shooter-side-unknown'] }

  const netX = attackingNetX({ shooterIsHome, period, homeTeamDefendingSide: ctx.homeTeamDefendingSide })
  if (netX === null) return { xg: null, problems: ['defending-side-unreadable'] }
  const geo = geometryFromCoords({ xCoord: d.xCoord, yCoord: d.yCoord, netX })
  if (!geo) return { xg: null, problems: ['coordinates-absent'] }

  const mapped = NHL_SHOT_TYPE_TO_MP[String(d.shotType ?? '').toLowerCase()] ?? null
  const shooterSkaters = shooterIsHome ? sit.homeSkaters : sit.awaySkaters
  const defenderSkaters = shooterIsHome ? sit.awaySkaters : sit.homeSkaters
  // The target net is the DEFENDING side's net, so an empty net here means
  // the goalie of the team being shot at is pulled.
  const targetNetEmpty = shooterIsHome ? !sit.awayGoalie : !sit.homeGoalie

  const prev = ctx.previousPlay || null
  const prevElapsed = prev ? toElapsedSeconds(prev.periodDescriptor?.number, prev.timeInPeriod) : null
  const thisElapsed = toElapsedSeconds(period, play.timeInPeriod)
  const dt = (prevElapsed !== null && thisElapsed !== null) ? thisElapsed - prevElapsed : null

  const isRebound = !!(prev && SHOT_TYPES_PBP.has(prev.typeDescKey)
    && prev.details?.eventOwnerTeamId === d.eventOwnerTeamId && dt !== null && dt <= 3)
  const isRush = !!(prev && dt !== null && dt <= 5
    && (prev.details?.zoneCode === 'N' || prev.details?.zoneCode === 'D'))

  const x = xgFeatureVector({
    distance: geo.distance,
    angleAbs: geo.angleAbs,
    shotType: mapped ?? 'WRIST',
    isRebound, isRush,
    onEmptyNet: targetNetEmpty,
    shooterSkaterAdvantage: shooterSkaters - defenderSkaters
  })
  return {
    xg: predictFromVector(x, model),
    problems: [],
    // Named, not defaulted silently: an unmapped shot type scores at the base
    // level and the caller is told which input was not reported.
    notReported: mapped === null && d.shotType !== undefined ? ['shotType'] : []
  }
}

// ── the win probability ─────────────────────────────────────────────────────
// Task 4 — three absent states, and none of them is 0.5.
export const hockeyWinProb = (state, { wp = HOCKEY_WP_MODEL } = {}) => {
  const base = { source: WP_SOURCE, probability: null, label: null, state: null, problems: [], caveats: [] }

  if (!wp || !Array.isArray(wp.coefficients))
    return { ...base, state: 'refused', problems: ['model-absent'] }

  // (1) NO SHOTS YET is not an even game. It returns the measured home-win
  // base rate, LABELLED AS A PRIOR, and never the market estimate wearing a
  // model's label. The two are different numbers from different sources and
  // the label says which this is.
  if (state?.shotsSeen === 0 || state?.preGame === true) {
    const prior = Number.isFinite(wp.pregamePrior) ? wp.pregamePrior : null
    return {
      ...base,
      probability: prior,
      label: PRIOR_LABEL,
      state: 'prior',
      problems: prior === null ? ['prior-absent-from-model'] : [],
      caveats: ['no shots have been taken; this is the measured home-win base rate for the training seasons, not a read of this game']
    }
  }

  // (2) An UNREADABLE situationCode is not even strength, and (3) an absent
  // clock or score is not the start of a game. Each is named rather than
  // defaulted, and the return carries no number at all.
  const problems = stateProblems(state)
  if (problems.length) return { ...base, state: 'refused', problems }

  const caveats = []
  // Goalie identity is NOT a model input, so an absent goalieInNetId cannot be
  // defaulted to an average goalie — there is nothing to default. Saying so is
  // the honest form of Task 4's third state: refusing would be theatre, and
  // silently ignoring it would hide that GSAx is not applied.
  if (state.goalieInNetId === null || state.goalieInNetId === undefined)
    caveats.push('goalieInNetId absent; goalie quality is not a model input, so nothing was substituted for it')
  if (state.xgDiff === null || state.xgDiff === undefined)
    caveats.push('cumulative xG unavailable; the xG feature entered as zero difference, which is its no-information value')

  const p = predictFromVector(featureVector(state), wp)
  return {
    ...base,
    probability: Math.round(p * 1000) / 1000,
    label: WP_LABEL,
    state: 'modelled',
    problems: [],
    caveats,
    inputs: {
      scoreDiff: state.homeScore - state.awayScore,
      elapsedSeconds: state.elapsedSeconds,
      homeSkaters: state.homeSkaters,
      awaySkaters: state.awaySkaters,
      homeEmptyNet: state.homeEmptyNet,
      awayEmptyNet: state.awayEmptyNet,
      xgDiff: Number.isFinite(state.xgDiff) ? +state.xgDiff.toFixed(4) : null
    },
    model: { trainedAt: wp.trainedAt, trainSeasons: wp.trainSeasons, rows: wp.rows }
  }
}

// ── derive the state from an NHL play-by-play payload ───────────────────────
// One walk: accumulate xG, carry the previous play for rebound/rush, and read
// the final state from the last shot event.
export const stateFromPlayByPlay = (pbp) => {
  const plays = Array.isArray(pbp?.plays) ? pbp.plays : []
  const homeTeamId = pbp?.homeTeam?.id
  const awayTeamId = pbp?.awayTeam?.id
  const ctxBase = { homeTeamId, awayTeamId, homeTeamDefendingSide: pbp?.homeTeamDefendingSide }

  let hxg = 0, axg = 0, shotsSeen = 0, xgProblems = 0
  let last = null, prev = null
  for (const play of plays) {
    if (SHOT_TYPES_PBP.has(play.typeDescKey)) {
      const r = shotXg(play, { ...ctxBase, previousPlay: prev })
      if (r.xg === null) xgProblems += 1
      else if (play.details?.eventOwnerTeamId === homeTeamId) hxg += r.xg
      else axg += r.xg
      shotsSeen += 1
      last = play
    }
    prev = play
  }

  if (shotsSeen === 0) return { preGame: true, shotsSeen: 0, xgShotsUnscored: xgProblems }

  const sit = parseSituation(last.situationCode)
  const d = last.details || {}
  const elapsed = toElapsedSeconds(last.periodDescriptor?.number, last.timeInPeriod)
  return {
    shotsSeen,
    xgShotsUnscored: xgProblems,
    elapsedSeconds: elapsed,
    period: last.periodDescriptor?.number ?? null,
    homeScore: Number.isFinite(d.homeScore) ? d.homeScore : null,
    awayScore: Number.isFinite(d.awayScore) ? d.awayScore : null,
    homeSkaters: sit ? sit.homeSkaters : null,
    awaySkaters: sit ? sit.awaySkaters : null,
    homeEmptyNet: sit ? !sit.homeGoalie : null,
    awayEmptyNet: sit ? !sit.awayGoalie : null,
    goalieInNetId: d.goalieInNetId ?? null,
    xgDiff: +(hxg - axg).toFixed(6),
    isPlayoff: pbp?.gameType === 3,
    situationCode: last.situationCode ?? null
  }
}

export const winProbFromPlayByPlay = (pbp, opts) =>
  hockeyWinProb(stateFromPlayByPlay(pbp), opts)
