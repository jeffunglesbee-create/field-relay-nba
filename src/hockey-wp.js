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

// Task 5 of docs/CC-CMD-2026-10-11-nhl-wpa-attribution.md. WPA is a FIFTH kind
// of number: not a probability at all but a DIFFERENCE between two of our own,
// attributed to a named player. It gets its own label for the same reason the
// four above are listed here rather than written inline — so a check can assert
// the distinction instead of a spelling, and so no caller can render a swing as
// though it were a probability.
export const WPA_LABEL = 'FIELD win probability added'

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

  // The PLAY's own side first. The payload root carries no
  // homeTeamDefendingSide at all (measured null on game 2026020053), so
  // reading it from the root left every shot unscoreable — xgShotsUnscored
  // came back 125 of 125 on the live end-to-end artifact, with the WP model
  // then running on xgDiff 0 while it had been trained on real values.
  const side = play?.homeTeamDefendingSide ?? ctx.homeTeamDefendingSide
  const netX = attackingNetX({ shooterIsHome, homeTeamDefendingSide: side })
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
    // MEASURED: blocked-shot events carry NO shotType key at all (0 of 38 on
    // game 2026020053), and missed/on-goal events carry one. Both the absent
    // and the unmapped case score at the base level, so both are named —
    // reporting only the unmapped one hid 38 of 125 shots.
    notReported: mapped === null ? ['shotType'] : []
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
  if (state.rootScoreDisagrees)
    caveats.push(`the score carried from goal events (${state.homeScore}-${state.awayScore}) disagrees with the payload's own team scores (${state.rootScore?.home}-${state.rootScore?.away}); the carried value was used`)
  if (state.scoreCarriedFromGoalEvents === false && (state.homeScore !== 0 || state.awayScore !== 0))
    caveats.push('no goal event carried a score, so 0-0 is an assumption rather than a reading')

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
export const stateFromPlayByPlay = (pbp, { snapshots = null } = {}) => {
  const plays = Array.isArray(pbp?.plays) ? pbp.plays : []
  const homeTeamId = pbp?.homeTeam?.id
  const awayTeamId = pbp?.awayTeam?.id
  const ctxBase = { homeTeamId, awayTeamId, homeTeamDefendingSide: pbp?.homeTeamDefendingSide }

  let hxg = 0, axg = 0, shotsSeen = 0, xgProblems = 0
  let last = null, prev = null
  // THE SCORE IS CARRIED FORWARD, because only GOAL events carry it.
  // MEASURED 2026-10-11 on game 2026020053: details.homeScore / awayScore
  // appear on 8 of 8 goal events and 0 of the other 117 shot events. The
  // CC-CMD's field list placed them under a shot event's details, I wrote this
  // against that prose, and the deployed route then refused two real live
  // games with 'score-unreadable'. See
  // outbox/hockey-wp-probe-latest-situation.json, details_keys_by_event_type.
  //
  // A goal's details.homeScore is the score AFTER that goal, which is what a
  // win probability read at that moment should use.
  let homeScore = 0, awayScore = 0, scoreSeen = false
  for (const play of plays) {
    // THE SCORE IS APPLIED BEFORE THE SNAPSHOT, not after. A goal's details
    // carry the score INCLUDING that goal, and the win probability a goal
    // produced is the one that holds AFTER it. With the carry below this
    // block, a goal's snapshot held the pre-goal score, its own swing landed
    // on whatever shot came next, and the scorer was credited a delta near
    // zero — measured as -0.0012 on a goal that opened the scoring.
    if (Number.isFinite(play.details?.homeScore) && Number.isFinite(play.details?.awayScore)) {
      homeScore = play.details.homeScore
      awayScore = play.details.awayScore
      scoreSeen = true
    }
    if (SHOT_TYPES_PBP.has(play.typeDescKey)) {
      const r = shotXg(play, { ...ctxBase, previousPlay: prev })
      if (r.xg === null) xgProblems += 1
      else if (play.details?.eventOwnerTeamId === homeTeamId) hxg += r.xg
      else axg += r.xg
      shotsSeen += 1
      last = play
      // Task 1 of the WPA document: the delta series is emitted from THIS walk.
      // Not a second pass, and not a second import of the model — one model,
      // one owner, one evaluation path.
      if (snapshots) {
        // The strength is parsed PER SNAPSHOT. stateFromPlayByPlay parses it
        // once, for the last shot, which is all a single current reading needs
        // — a delta series needs it at every shot, and without it every
        // snapshot refuses on 'strength-unreadable' and the whole series reads
        // as both-endpoints-refused.
        const sitAt = parseSituation(play.situationCode)
        snapshots.push({
          play,
          elapsedSeconds: toElapsedSeconds(play.periodDescriptor?.number, play.timeInPeriod),
          period: play.periodDescriptor?.number ?? null,
          homeScore, awayScore,
          homeSkaters: sitAt ? sitAt.homeSkaters : null,
          awaySkaters: sitAt ? sitAt.awaySkaters : null,
          homeEmptyNet: sitAt ? !sitAt.homeGoalie : null,
          awayEmptyNet: sitAt ? !sitAt.awayGoalie : null,
          xgDiff: +(hxg - axg).toFixed(6),
          situationCode: play.situationCode ?? null,
          goalieInNetId: play.details?.goalieInNetId ?? null,
          isPlayoff: pbp?.gameType === 3,
        })
      }
    }
    prev = play
  }

  if (shotsSeen === 0) return { preGame: true, shotsSeen: 0, xgShotsUnscored: xgProblems }

  const sit = parseSituation(last.situationCode)
  const d = last.details || {}
  const elapsed = toElapsedSeconds(last.periodDescriptor?.number, last.timeInPeriod)
  // The root team scores are the score NOW. For a finished walk they must equal
  // the carried value; a disagreement means goals exist outside the plays array
  // and is reported rather than silently preferred one way or the other.
  const rootHome = pbp?.homeTeam?.score, rootAway = pbp?.awayTeam?.score
  const rootDisagrees = Number.isFinite(rootHome) && Number.isFinite(rootAway)
    && (rootHome !== homeScore || rootAway !== awayScore)
  return {
    shotsSeen,
    xgShotsUnscored: xgProblems,
    elapsedSeconds: elapsed,
    period: last.periodDescriptor?.number ?? null,
    homeScore,
    awayScore,
    scoreCarriedFromGoalEvents: scoreSeen,
    rootScoreDisagrees: rootDisagrees,
    rootScore: Number.isFinite(rootHome) && Number.isFinite(rootAway) ? { home: rootHome, away: rootAway } : null,
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

// ── WIN PROBABILITY ADDED ───────────────────────────────────────────────────
// docs/CC-CMD-2026-10-11-nhl-wpa-attribution.md
//
// A difference between two of our own probabilities, attributed to the player
// the vendor already names on the event. Arithmetic on numbers this relay
// already produces — no model change, no retraining, no new upstream call.
//
// TASK 2 — CREDIT IS A CONVENTION AND IT IS STATED HERE, not buried in a
// constant. A goal's swing belongs to more than the scorer, and how much more
// is a choice nobody can measure. These are the splits, in one place a future
// reader can change, with the reasoning attached:
export const WPA_CREDIT = {
  // A goal is the scorer's event and the assists' too. 60/25/15 keeps the
  // scorer dominant while making a primary assist worth clearly more than a
  // secondary — which is the ordering every hockey scoring system already
  // asserts. It is NOT derived from anything; it is a convention.
  goal: { scorer: 0.60, assist1: 0.25, assist2: 0.15 },
  // A save is the goalie's event. The shooter created the swing that did not
  // happen, so the goalie takes the whole of the (negative-for-the-shooter)
  // delta and the shooter is recorded at zero rather than credited.
  save: { goalie: 1.00, shooter: 0.00 },
  // A block is the blocker's. A miss is nobody's — the shooter generated the
  // chance, the outcome was the shooter's own.
  block: { blocker: 1.00 },
  miss: { shooter: 1.00 },
}

// TASK 3 — FOUR STATES, AND NONE OF THEM IS A ΔWP OF ZERO.
// A play that changed nothing and a play we could not evaluate are different
// facts. The prior-to-first-shot transition is excluded explicitly: the prior
// is a base rate for the training seasons, not a read of this game, and
// differencing against it would manufacture a large bogus opening swing.
export const WPA_STATE = {
  COMPUTED: 'computed',
  ONE_ENDPOINT_REFUSED: 'one-endpoint-refused',
  BOTH_REFUSED: 'both-refused',
  NO_PLAYER_NAMED: 'play-names-no-player',
}

const _playersOn = (play) => {
  const d = play?.details || {}
  const out = []
  if (play.typeDescKey === 'goal') {
    if (d.scoringPlayerId) out.push({ playerId: d.scoringPlayerId, role: 'scorer', share: WPA_CREDIT.goal.scorer })
    if (d.assist1PlayerId) out.push({ playerId: d.assist1PlayerId, role: 'assist1', share: WPA_CREDIT.goal.assist1 })
    if (d.assist2PlayerId) out.push({ playerId: d.assist2PlayerId, role: 'assist2', share: WPA_CREDIT.goal.assist2 })
  } else if (play.typeDescKey === 'shot-on-goal') {
    if (d.goalieInNetId) out.push({ playerId: d.goalieInNetId, role: 'goalie', share: WPA_CREDIT.save.goalie })
  } else if (play.typeDescKey === 'blocked-shot') {
    if (d.blockingPlayerId) out.push({ playerId: d.blockingPlayerId, role: 'blocker', share: WPA_CREDIT.block.blocker })
  } else if (play.typeDescKey === 'missed-shot') {
    if (d.shootingPlayerId) out.push({ playerId: d.shootingPlayerId, role: 'shooter', share: WPA_CREDIT.miss.shooter })
  }
  return out
}

export const winProbAddedFromPlayByPlay = (pbp, { wp = HOCKEY_WP_MODEL } = {}) => {
  const snapshots = []
  const finalState = stateFromPlayByPlay(pbp, { snapshots })
  const series = []
  let prev = null
  let computed = 0, oneRefused = 0, bothRefused = 0, noPlayer = 0
  let sumDelta = 0

  for (const snap of snapshots) {
    const r = hockeyWinProb({ ...snap, shotsSeen: 1 }, { wp })
    const ok = r.state === 'modelled' && typeof r.probability === 'number'
    let state, delta = null
    if (!ok && (prev === null || !prev.ok)) { state = WPA_STATE.BOTH_REFUSED; bothRefused += 1 }
    else if (!ok || prev === null || !prev.ok) { state = WPA_STATE.ONE_ENDPOINT_REFUSED; oneRefused += 1 }
    else {
      // The FIRST modelled shot has no predecessor to difference against. The
      // prior is not one: it is a base rate for the training seasons, and
      // differencing against it would invent an opening swing.
      delta = +(r.probability - prev.p).toFixed(6)
      state = WPA_STATE.COMPUTED
      computed += 1
      sumDelta += delta
    }
    const credits = _playersOn(snap.play)
    if (state === WPA_STATE.COMPUTED && credits.length === 0) { noPlayer += 1 }
    series.push({
      typeDescKey: snap.play.typeDescKey,
      period: snap.period, timeInPeriod: snap.play.timeInPeriod,
      elapsedSeconds: snap.elapsedSeconds,
      wp: ok ? r.probability : null,
      deltaWP: delta,
      state,
      label: WPA_LABEL,
      credits: delta === null ? [] : credits.map(c => ({ ...c, wpa: +(delta * c.share).toFixed(6) })),
      refusal: ok ? null : r.problems,
    })
    prev = { ok, p: ok ? r.probability : null }
  }

  // TASK 4 — THE CONSERVATION CHECK, which is what makes this falsifiable.
  const homeWon = (() => {
    const h = pbp?.homeTeam?.score, a = pbp?.awayTeam?.score
    return Number.isFinite(h) && Number.isFinite(a) && h !== a ? (h > a ? 1 : 0) : null
  })()
  const firstModelled = series.find(x => x.wp !== null)
  const lastModelled = [...series].reverse().find(x => x.wp !== null)
  const conservation = {
    outcome: homeWon,
    first_modelled_wp: firstModelled ? firstModelled.wp : null,
    last_modelled_wp: lastModelled ? lastModelled.wp : null,
    sum_of_deltas: +sumDelta.toFixed(6),
    // The deltas TELESCOPE: sum(wp_i - wp_{i-1}) is identically
    // wp_last - wp_first, so the sum carries no information the two endpoints
    // do not. The residual is therefore outcome - wp_last, and it is whatever
    // happened after the final shot.
    telescoped_identity_holds: firstModelled && lastModelled
      ? Math.abs((lastModelled.wp - firstModelled.wp) - sumDelta) < 1e-6 : null,
    residual: (homeWon !== null && lastModelled) ? +(homeWon - lastModelled.wp).toFixed(6) : null,
    closes: null,
  }
  // Tolerance 0.01, chosen as the rounding floor: the scorer rounds its
  // probability to three decimals, so anything below ~0.001 is representation
  // and 0.01 is a comfortable order above it. A residual larger than that is a
  // real gap, not arithmetic.
  conservation.tolerance = 0.01
  conservation.closes = conservation.residual === null ? null : Math.abs(conservation.residual) <= conservation.tolerance

  return {
    label: WPA_LABEL,
    source: WP_SOURCE,
    finalState,
    shots: snapshots.length,
    stateCounts: { computed, one_endpoint_refused: oneRefused, both_refused: bothRefused, computed_but_no_player_named: noPlayer },
    conservation,
    creditConvention: WPA_CREDIT,
    series,
  }
}
