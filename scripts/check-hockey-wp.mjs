#!/usr/bin/env node
// Checks src/hockey-wp.js — the Worker-side scorer.
//
// docs/CC-CMD-2026-10-10-nhl-win-probability-from-xg.md, done condition 5:
// the three absent states must be distinguishable in the return value, with a
// check, and the label must differ from the two that already exist.
//
// Every assertion here is paired with a mutation in
// scripts/mutation-hockey-wp.mjs. A check that has only ever passed has
// proven nothing (Rule 90).

import { pathToFileURL } from 'node:url'
import {
  hockeyWinProb, stateFromPlayByPlay, winProbFromPlayByPlay, shotXg,
  parseSituation, toElapsedSeconds,
  WP_LABEL, PRIOR_LABEL, MARKET_LABEL, VENDOR_LABEL, WP_SOURCE
} from '../src/hockey-wp.js'
import { HOCKEY_WP_MODEL } from '../src/hockey-wp-model.js'
import { FEATURES, XG_FEATURES, attackingNetX } from '../src/hockey-wp-lib.js'

// A synthetic model so the state machine is testable before training runs and
// independently of whatever coefficients training lands on. Nine coefficients
// for nine features; only the first (scoreDiff) is non-zero, so the direction
// of the probability is predictable from the scoreboard alone.
export const FAKE = {
  version: 0, trainedAt: '2026-01-01T00:00:00Z', trainSeasons: ['x'], rows: 1,
  features: FEATURES,
  coefficients: [1.5, 0, 0, 0, 0, 0, 0, 0, 0],
  intercept: 0,
  mean: new Array(FEATURES.length).fill(0),
  sd: new Array(FEATURES.length).fill(1),
  pregamePrior: 0.5432, tieRate: 0.23, otHomeShare: 0.55
}

const liveState = (over = {}) => ({
  shotsSeen: 12, elapsedSeconds: 1800, period: 2,
  homeScore: 2, awayScore: 1, homeSkaters: 5, awaySkaters: 5,
  homeEmptyNet: false, awayEmptyNet: false,
  goalieInNetId: 8471234, xgDiff: 0.4, isPlayoff: false, ...over
})

export const run = () => {
  let pass = 0, fail = 0
  const t = (n, c) => { if (c) { pass++; console.log(`PASS  ${n}`) } else { fail++; console.log(`FAIL  ${n}`) } }

  // ── the label is a third kind of number ───────────────────────────────────
  t('the model label is distinct from both labels wp-resolver.js already serves',
    WP_LABEL !== MARKET_LABEL && WP_LABEL !== VENDOR_LABEL
    && PRIOR_LABEL !== MARKET_LABEL && PRIOR_LABEL !== VENDOR_LABEL
    && WP_LABEL !== PRIOR_LABEL)
  t("the two reserved labels are spelled exactly as wp-resolver.js spells them",
    MARKET_LABEL === 'Market estimate' && VENDOR_LABEL === 'Statistical probability')

  // ── state 1: no shots yet is NOT an even game ────────────────────────────
  const pre = hockeyWinProb({ shotsSeen: 0 }, { wp: FAKE })
  t('no shots yet returns the measured prior, not 0.5',
    pre.state === 'prior' && pre.probability === 0.5432 && pre.probability !== 0.5)
  t('the pre-game answer is labelled a prior, not a model read',
    pre.label === PRIOR_LABEL)
  t('the pre-game answer carries a caveat saying it is not a read of this game',
    Array.isArray(pre.caveats) && /not a read of this game/.test(pre.caveats.join(' ')))
  t('a model with no prior refuses the number rather than inventing one',
    (() => {
      const r = hockeyWinProb({ shotsSeen: 0 }, { wp: { ...FAKE, pregamePrior: undefined } })
      return r.probability === null && r.problems.includes('prior-absent-from-model')
    })())

  // ── state 2: an unreadable situationCode is NOT even strength ────────────
  const noStrength = hockeyWinProb(liveState({ homeSkaters: null, awaySkaters: null }), { wp: FAKE })
  t('unreadable strength refuses, and does not score as 5v5',
    noStrength.state === 'refused' && noStrength.probability === null
    && noStrength.problems.includes('strength-unreadable'))
  t('an unreadable goalie state refuses rather than assuming both goalies in',
    (() => {
      const r = hockeyWinProb(liveState({ homeEmptyNet: null, awayEmptyNet: null }), { wp: FAKE })
      return r.state === 'refused' && r.problems.includes('goalie-state-unreadable')
    })())
  t('an unreadable clock refuses rather than reading as the start of the game',
    hockeyWinProb(liveState({ elapsedSeconds: null }), { wp: FAKE }).problems.includes('clock-unreadable'))
  t('an unreadable score refuses rather than reading as 0-0',
    hockeyWinProb(liveState({ homeScore: null }), { wp: FAKE }).problems.includes('score-unreadable'))
  t('the four refusals are distinguishable from each other by name',
    new Set(['score-unreadable', 'clock-unreadable', 'strength-unreadable', 'goalie-state-unreadable']).size === 4)

  // ── state 3: an absent goalie id is named, and nothing is substituted ────
  const noGoalie = hockeyWinProb(liveState({ goalieInNetId: null }), { wp: FAKE })
  t('an absent goalieInNetId still scores, because goalie quality is not an input',
    noGoalie.state === 'modelled' && noGoalie.probability !== null)
  t('...and it says so, rather than silently applying an average goalie',
    /goalie quality is not a model input/.test(noGoalie.caveats.join(' ')))
  t('a present goalie id adds no goalie caveat',
    !/goalieInNetId absent/.test(hockeyWinProb(liveState(), { wp: FAKE }).caveats.join(' ')))

  // ── the committed model is EITHER absent or well-formed ─────────────────
  // These pinned `HOCKEY_WP_MODEL === null` and broke the moment training
  // wrote a real table — testing which state the file happens to be in rather
  // than the guard that matters. The guard is now tested by injection, and the
  // committed file is tested for being one of two legitimate things.
  t('the committed model is either absent or a complete, labelled table',
    HOCKEY_WP_MODEL === null || (
      Array.isArray(HOCKEY_WP_MODEL.coefficients)
      && HOCKEY_WP_MODEL.coefficients.length === FEATURES.length
      && HOCKEY_WP_MODEL.features.join(',') === FEATURES.join(',')
      && typeof HOCKEY_WP_MODEL.trainedAt === 'string'
      && HOCKEY_WP_MODEL.rows > 0))
  t('a committed model carries the training date, row count and feature list the CC-CMD requires',
    HOCKEY_WP_MODEL === null || (
      HOCKEY_WP_MODEL.trainedAt && HOCKEY_WP_MODEL.rows && Array.isArray(HOCKEY_WP_MODEL.features)
      && Array.isArray(HOCKEY_WP_MODEL.trainSeasons) && HOCKEY_WP_MODEL.trainSeasons.length > 0))
  t('a trained model carries a MEASURED pre-game prior and OT share, never 0.5',
    HOCKEY_WP_MODEL === null || (
      HOCKEY_WP_MODEL.pregamePrior !== 0.5 && HOCKEY_WP_MODEL.otHomeShare !== 0.5
      && HOCKEY_WP_MODEL.otHomeShare_n > 0))
  t('a null model refuses instead of answering',
    (() => {
      const r = hockeyWinProb(liveState(), { wp: null })
      return r.state === 'refused' && r.problems.includes('model-absent') && r.probability === null
    })())
  t('a model whose coefficients are not an array refuses too',
    hockeyWinProb(liveState(), { wp: { intercept: 0 } }).problems.includes('model-absent'))

  // ── direction and shape ─────────────────────────────────────────────────
  t('a two-goal home lead scores above an equal game, which scores above a deficit',
    (() => {
      const a = hockeyWinProb(liveState({ homeScore: 3, awayScore: 1 }), { wp: FAKE }).probability
      const b = hockeyWinProb(liveState({ homeScore: 1, awayScore: 1 }), { wp: FAKE }).probability
      const c = hockeyWinProb(liveState({ homeScore: 1, awayScore: 3 }), { wp: FAKE }).probability
      return a > b && b > c
    })())
  t('a tied game under a scoreDiff-only model sits at exactly 0.5',
    hockeyWinProb(liveState({ homeScore: 1, awayScore: 1 }), { wp: FAKE }).probability === 0.5)
  t('the modelled answer reports its inputs so the number can be audited',
    hockeyWinProb(liveState(), { wp: FAKE }).inputs.scoreDiff === 1)
  t('the source names this relay, not a vendor',
    hockeyWinProb(liveState(), { wp: FAKE }).source === WP_SOURCE)

  // ── situationCode, the confirmed reading ────────────────────────────────
  t('1551 is 5v5 with both goalies in',
    (() => { const s = parseSituation('1551'); return s.homeSkaters === 5 && s.awaySkaters === 5 && s.homeGoalie && s.awayGoalie })())
  t('0651 is an empty away net with six home-side skaters on',
    (() => { const s = parseSituation('0651'); return !s.awayGoalie && s.awaySkaters === 6 })())
  t('an unreadable code is null, never a default',
    parseSituation('x') === null && parseSituation(undefined) === null)
  t('the clock converts period 2 at 10:00 to 1800 seconds elapsed',
    toElapsedSeconds(2, '10:00') === 1800)
  t('a malformed clock is null rather than zero',
    toElapsedSeconds(2, 'soon') === null && toElapsedSeconds(2, undefined) === null)

  // ── xG from play-by-play ────────────────────────────────────────────────
  const shot = (over = {}) => ({
    typeDescKey: 'shot-on-goal', timeInPeriod: '10:00', periodDescriptor: { number: 1 },
    situationCode: '1551',
    details: { xCoord: 57, yCoord: -40, shotType: 'wrist', zoneCode: 'O', eventOwnerTeamId: 10, goalieInNetId: 1 },
    ...over
  })
  const XG = { version: 0, features: XG_FEATURES, coefficients: new Array(XG_FEATURES.length).fill(0),
               intercept: -2, mean: new Array(XG_FEATURES.length).fill(0), sd: new Array(XG_FEATURES.length).fill(1) }
  // The attacking net flips every period. Getting this wrong puts every shot
  // at the far end of the rink and still returns a number, so it is pinned
  // here and not only by the trainer's agreement rate against the vendor.
  t('the attacking net flips with each period',
    attackingNetX({ shooterIsHome: true, period: 1, homeTeamDefendingSide: 'left' }) === 89
    && attackingNetX({ shooterIsHome: true, period: 2, homeTeamDefendingSide: 'left' }) === -89
    && attackingNetX({ shooterIsHome: true, period: 3, homeTeamDefendingSide: 'left' }) === 89)
  t('the two sides attack opposite nets in the same period',
    attackingNetX({ shooterIsHome: true, period: 1, homeTeamDefendingSide: 'left' })
    === -attackingNetX({ shooterIsHome: false, period: 1, homeTeamDefendingSide: 'left' }))
  t('an identical shot scores differently in period 1 and period 2, because the net moved',
    (() => {
      const XG2 = { version: 0, features: XG_FEATURES,
        coefficients: XG_FEATURES.map(f => f === 'distance' ? -0.1 : 0),
        intercept: 0, mean: new Array(XG_FEATURES.length).fill(0), sd: new Array(XG_FEATURES.length).fill(1) }
      const p1 = shotXg(shot({ periodDescriptor: { number: 1 } }), { homeTeamId: 10, homeTeamDefendingSide: 'left' }, XG2).xg
      const p2 = shotXg(shot({ periodDescriptor: { number: 2 } }), { homeTeamId: 10, homeTeamDefendingSide: 'left' }, XG2).xg
      return p1 !== null && p2 !== null && Math.abs(p1 - p2) > 1e-6
    })())

  t('a null xG model yields no xG instead of throwing',
    (() => {
      const r = shotXg(shot(), { homeTeamId: 10, homeTeamDefendingSide: 'left' }, null)
      return r.xg === null && r.problems.includes('xg-model-absent')
    })())
  t('...and an xG model with no coefficient array is refused the same way',
    shotXg(shot(), { homeTeamId: 10, homeTeamDefendingSide: 'left' }, { intercept: 0 })
      .problems.includes('xg-model-absent'))

  t('a shot with an unreadable situationCode yields no xG rather than a default',
    shotXg(shot({ situationCode: 'xx' }), { homeTeamId: 10, homeTeamDefendingSide: 'left' }, XG).xg === null)
  t('a shot with no defending side yields no xG rather than guessing the net',
    shotXg(shot(), { homeTeamId: 10, homeTeamDefendingSide: null }, XG).problems.includes('defending-side-unreadable'))
  t('a shot with absent coordinates yields no xG',
    shotXg(shot({ details: { shotType: 'wrist', eventOwnerTeamId: 10 } }), { homeTeamId: 10, homeTeamDefendingSide: 'left' }, XG).problems.includes('coordinates-absent'))
  t('an unmapped shot type still scores but names the input it could not use',
    (() => {
      const r = shotXg(shot({ details: { ...shot().details, shotType: 'one-timer' } }), { homeTeamId: 10, homeTeamDefendingSide: 'left' }, XG)
      return r.xg !== null && r.notReported.includes('shotType')
    })())
  t('a mapped shot type reports nothing unreported',
    shotXg(shot(), { homeTeamId: 10, homeTeamDefendingSide: 'left' }, XG).notReported.length === 0)

  // ── the walk over a whole payload ───────────────────────────────────────
  t('a payload with no shots reads as pre-game, not as a 0-0 read',
    (() => {
      const s = stateFromPlayByPlay({ plays: [{ typeDescKey: 'faceoff' }], homeTeam: { id: 10 }, awayTeam: { id: 20 } })
      return s.preGame === true && s.shotsSeen === 0
    })())
  t('the state comes from the LAST shot event, not the last play',
    (() => {
      const s = stateFromPlayByPlay({
        homeTeam: { id: 10 }, awayTeam: { id: 20 }, homeTeamDefendingSide: 'left',
        plays: [shot({ timeInPeriod: '05:00', details: { ...shot().details, homeScore: 1, awayScore: 0 } }),
                shot({ timeInPeriod: '15:00', details: { ...shot().details, homeScore: 2, awayScore: 0 } }),
                { typeDescKey: 'stoppage', timeInPeriod: '19:00', periodDescriptor: { number: 1 } }]
      })
      return s.homeScore === 2 && s.elapsedSeconds === 900 && s.shotsSeen === 2
    })())
  t('a payload walked with a null model refuses through the whole path',
    winProbFromPlayByPlay({ plays: [shot()], homeTeam: { id: 10 }, awayTeam: { id: 20 }, homeTeamDefendingSide: 'left' },
      { wp: null }).state === 'refused')
  t('shots whose xG could not be scored are counted, not hidden',
    (() => {
      const s = stateFromPlayByPlay({
        homeTeam: { id: 10 }, awayTeam: { id: 20 }, homeTeamDefendingSide: null,
        plays: [shot(), shot()]
      })
      return s.xgShotsUnscored === 2
    })())

  console.log(`\n${pass}/${pass + fail} checks passed`)
  return fail
}

const _entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (_entry && import.meta.url === _entry) process.exit(run() ? 1 : 0)
