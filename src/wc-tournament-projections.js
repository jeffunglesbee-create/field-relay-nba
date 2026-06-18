// ═══════════════════════════════════════════════════════════════════════════
// WC Tournament Projections — Monte Carlo path probability engine
// Built: June 11 2026
// ═══════════════════════════════════════════════════════════════════════════
//
// PURPOSE
//   For each of the 48 WC 2026 teams, compute the probability of reaching
//   every knockout round: R32, R16, QF, SF, Final, Champion.
//   Run daily (or after each matchday) and diff against yesterday's snapshot
//   to produce: (a) biggest movers, (b) secondary beneficiaries, (c) journalism.
//
// ALGORITHM
//   1. Derive team attack/defense strengths from group-stage Poisson lambdas
//      (lambdaHome, lambdaAway from /wc/odds-probs response).
//   2. Monte Carlo N=2000 simulations:
//      a. For each group: complete remaining fixtures via Poisson sampling.
//      b. Rank all 12 3rd-place teams → take top 8.
//      c. Apply R32 bracket (FIFA Annex C slots).
//      d. Simulate R32 → R16 → QF → SF → Final using team lambdas.
//   3. Per-team path probabilities = count / N.
//   4. Diff against KV snapshot ('wc:projections:prev') → movers.
//   5. Secondary beneficiaries: pFinal improved but team had no game today.
//
// LIMITATIONS
//   - Knockout stage uses neutral-venue lambdas (no home advantage).
//   - Extra time / penalties: loser eliminated, winner continues regardless
//     of how they won (probability-based selection, not simulated ET/PKs).
//   - 3rd-place qualification uses simplified ordering (Pts → GD → GF).
//     Full FIFA fair-play tiebreaker not implemented.
// ═══════════════════════════════════════════════════════════════════════════

import { winProbsFromLambda } from './soccer-wp.js';
import { WC_TEAM_CONTEXT, WC_NAME_TO_CODE } from './wc-team-context.js';

// ── R32 bracket slots (FIFA Annex C, matches 73–88) ─────────────────────────
// Mirrors WC_R32_SLOTS in index.html — kept in sync manually.
const R32_SLOTS = [
  { match:73, home:{pos:2,group:'A'}, away:{pos:2,group:'B'}       },
  { match:74, home:{pos:1,group:'E'}, away:{pos:3,eligible:'ABCDF'}},
  { match:75, home:{pos:1,group:'F'}, away:{pos:2,group:'C'}       },
  { match:76, home:{pos:1,group:'C'}, away:{pos:2,group:'F'}       },
  { match:77, home:{pos:1,group:'I'}, away:{pos:3,eligible:'CDFGH'}},
  { match:78, home:{pos:2,group:'E'}, away:{pos:2,group:'I'}       },
  { match:79, home:{pos:1,group:'A'}, away:{pos:3,eligible:'CEFHI'}},
  { match:80, home:{pos:1,group:'L'}, away:{pos:3,eligible:'EHIJK'}},
  { match:81, home:{pos:1,group:'D'}, away:{pos:3,eligible:'BEFIJ'}},
  { match:82, home:{pos:1,group:'G'}, away:{pos:3,eligible:'AEHIJ'}},
  { match:83, home:{pos:2,group:'K'}, away:{pos:2,group:'L'}       },
  { match:84, home:{pos:1,group:'H'}, away:{pos:2,group:'J'}       },
  { match:85, home:{pos:1,group:'B'}, away:{pos:3,eligible:'EFGIJ'}},
  { match:86, home:{pos:1,group:'J'}, away:{pos:2,group:'H'}       },
  { match:87, home:{pos:1,group:'K'}, away:{pos:3,eligible:'DEIJL'}},
  { match:88, home:{pos:2,group:'D'}, away:{pos:2,group:'G'}       },
];

// R16 bracket: winners of adjacent R32 matches face each other
// {a: R32 matchA, b: R32 matchB} → winner(a) vs winner(b)
const R16_PAIRINGS = [
  {a:49,b:50}, {a:51,b:52}, {a:53,b:54}, {a:55,b:56},  // upper half
  {a:57,b:58}, {a:59,b:60}, {a:61,b:62}, {a:63,b:64},  // lower half
];
// FIFA 2026 actual R16 pairing: winners of R32 matches pair as:
// M73 winner vs M74 winner → R16 match
// M75 winner vs M76 winner → R16 match
// etc. (adjacent pair in sequential order)
const R32_TO_R16_PAIRS = [
  [73,74], [75,76], [77,78], [79,80],
  [81,82], [83,84], [85,86], [87,88],
];
const R16_TO_QF_PAIRS   = [[0,1],[2,3],[4,5],[6,7]];   // indices into R16 results
const QF_TO_SF_PAIRS    = [[0,1],[2,3]];
const SF_TO_FINAL_PAIRS = [[0,1]];

// ── Confederation strength multiplier (Change 2) ────────────────────────────
// Applied to attack lambda inside rankBasedStrengths(). Values reflect WC
// performance differential by confederation across recent cycles (UEFA +
// CONMEBOL teams have historically over-performed pure FIFA-rank expectation;
// AFC/OFC have under-performed). Sourced from the drive spec.
const CONFED_MULTIPLIER = {
  UEFA:     1.06,
  CONMEBOL: 1.04,
  CONCACAF: 1.00,
  CAF:      0.97,
  AFC:      0.96,
  OFC:      0.92,
};
const CODE_TO_CONFED = {
  // Group A
  MEX: 'CONCACAF', RSA: 'CAF',      KOR: 'AFC',      CZE: 'UEFA',
  // Group B
  CAN: 'CONCACAF', BIH: 'UEFA',     QAT: 'AFC',      SUI: 'UEFA',
  // Group C
  BRA: 'CONMEBOL', MAR: 'CAF',      HAI: 'CONCACAF', SCO: 'UEFA',
  // Group D
  USA: 'CONCACAF', PAR: 'CONMEBOL', AUS: 'AFC',      TUR: 'UEFA',
  // Group E
  GER: 'UEFA',     CUW: 'CONCACAF', CIV: 'CAF',      ECU: 'CONMEBOL',
  // Group F
  NED: 'UEFA',     JPN: 'AFC',      TUN: 'CAF',      SWE: 'UEFA',
  // Group G
  BEL: 'UEFA',     EGY: 'CAF',      IRN: 'AFC',      NZL: 'OFC',
  // Group H
  ESP: 'UEFA',     CPV: 'CAF',      KSA: 'AFC',      URU: 'CONMEBOL',
  // Group I
  FRA: 'UEFA',     SEN: 'CAF',      IRQ: 'AFC',      NOR: 'UEFA',
  // Group J
  ARG: 'CONMEBOL', ALG: 'CAF',      AUT: 'UEFA',     JOR: 'AFC',
  // Group K
  COL: 'CONMEBOL', COD: 'CAF',      POR: 'UEFA',     UZB: 'AFC',
  // Group L
  PAN: 'CONCACAF', ENG: 'UEFA',     CRO: 'UEFA',     GHA: 'CAF',
};

// ── rankBasedStrengths ──────────────────────────────────────────────────────
// Build a 48-team strength map from WC_TEAM_CONTEXT.fifaRank when no odds
// prior is available (or to fill teams with no measured odds). Confederation
// multipliers are layered on in Change 2 — this commit only does the rank
// component.
//
// rankFactor = (50 - clamp(rank, 1, 100)) / 50
//   rank   1 → +0.98   (strongest)
//   rank  50 →  0.00   (neutral)
//   rank 100 → -1.00   (weakest)
// attack  = BASE_LAMBDA + rankFactor * RANK_SPREAD              (clamped)
// defense = BASE_LAMBDA - rankFactor * RANK_SPREAD * 0.85        (clamped)
//
// Defense scaling is 85% of attack — teams differentiate more by attack than
// by defense in WC samples; tuned to keep the [0.4, 2.0] clamp from biting
// the extreme tails (San Marino-class rank 100 teams).
const RANK_SPREAD = 0.55;
function rankBasedStrengths() {
  const out = {};
  for (const ctx of Object.values(WC_TEAM_CONTEXT)) {
    if (!ctx.displayName) continue;
    const rank = Math.max(1, Math.min(100, Number(ctx.fifaRank) || 50));
    const rankFactor = (50 - rank) / 50;
    let att = BASE_LAMBDA + rankFactor * RANK_SPREAD;
    const def = BASE_LAMBDA - rankFactor * RANK_SPREAD * 0.85;
    // Change 2 — confederation multiplier on attack lambda only. Defense
    // stays a function of rank alone (defensive structure correlates more
    // with squad quality than continental style).
    const confed = ctx.fifaCode ? CODE_TO_CONFED[ctx.fifaCode] : null;
    if (confed && CONFED_MULTIPLIER[confed]) att *= CONFED_MULTIPLIER[confed];
    out[ctx.displayName] = {
      attack:  Math.max(0.4, Math.min(2.0, att)),
      defense: Math.max(0.4, Math.min(2.0, def)),
    };
  }
  return out;
}

// ── deriveTeamStrengths ──────────────────────────────────────────────────────
// From /wc/odds-probs array, derive each team's attack and defense lambda.
// Each team plays 3 group stage games; average lambdas across their fixtures.
// Returns: { 'Mexico': {attack, defense}, ... }
export function deriveTeamStrengths(oddsProbs) {
  const agg = {};  // { name: { attackSum, defenseSum, count } }

  function acc(name, att, def, w) {
    if (!agg[name]) agg[name] = { attackSum:0, defenseSum:0, count:0 };
    // Change 8 — temporal freshness weight scales the COUNT, not the lambdas
    // (scaling lambdas would shrink them; we want odds to lose influence on
    // the per-team average, not on the magnitude). count becomes a real
    // weighted sum.
    agg[name].attackSum  += att * w;
    agg[name].defenseSum += def * w;
    agg[name].count      += w;
  }

  const now = Date.now();
  const freshnessWeight = (commenceIso) => {
    if (!commenceIso) return 1.0;
    const t = Date.parse(commenceIso);
    if (!Number.isFinite(t)) return 1.0;
    const hours = (t - now) / 3_600_000;
    if (hours < 24) return 1.0;
    if (hours < 72) return 0.85;
    return 0.7;
  };

  for (const g of (oddsProbs || [])) {
    const lH = g.lambdaHome || 1.0;
    const lA = g.lambdaAway || 1.0;
    const w  = freshnessWeight(g.commence);
    acc(normalizeTeamName(g.home_team), lH, lA, w);
    acc(normalizeTeamName(g.away_team), lA, lH, w);
  }

  const strengths = {};
  for (const [name, v] of Object.entries(agg)) {
    // Each team plays exactly 3 group games. Pad any missing games toward the
    // raw agg average so a single Curaçao blowout doesn't dominate Ecuador's rating.
    // Re-compute averages after padding below.
    strengths[name] = {
      attack:  v.attackSum  / v.count,
      defense: v.defenseSum / v.count,
      count:   v.count,
    };
  }

  // Change 6 — Cross-match triangulation. For each team with count < 2,
  // borrow signal from teams that share an opponent in oddsProbs. When
  // teamX has played opponent Z, and teamY has also played Z, teamY's
  // observation against Z (scaled by Z's strength) is a proxy for what
  // teamX's strength implies. Blend at weight 0.5 because it's transitive.
  // Only active when oddsProbs has actual content.
  if ((oddsProbs || []).length > 0) {
    // For each (team, opponent) seen in oddsProbs, record the team's
    // observed attack and defense vs that opponent.
    const playedBy = {}; // opponent → [{team, att, def}]
    for (const g of oddsProbs) {
      const home = normalizeTeamName(g.home_team);
      const away = normalizeTeamName(g.away_team);
      const lH = g.lambdaHome || 1.0;
      const lA = g.lambdaAway || 1.0;
      (playedBy[away] = playedBy[away] || []).push({ team: home, att: lH, def: lA });
      (playedBy[home] = playedBy[home] || []).push({ team: away, att: lA, def: lH });
    }
    for (const [name, s] of Object.entries(strengths)) {
      if ((s.count || 0) >= 2) continue;
      // Opponents this team played
      const myOpponents = (playedBy[name] || []).map(o => o.team);
      let triAtt = 0, triDef = 0, triN = 0;
      for (const opp of myOpponents) {
        const cohort = playedBy[opp] || [];
        for (const c of cohort) {
          if (c.team === name) continue;
          const bridge = strengths[c.team];
          if (!bridge) continue;
          // inferredAtt = bridge.observedAtt × (BASE_LAMBDA / bridge.defense)
          // inferredDef = bridge.observedDef × (BASE_LAMBDA / bridge.attack)
          const inferredAtt = c.att * (BASE_LAMBDA / (bridge.defense || BASE_LAMBDA));
          const inferredDef = c.def * (BASE_LAMBDA / (bridge.attack  || BASE_LAMBDA));
          triAtt += inferredAtt;
          triDef += inferredDef;
          triN++;
        }
      }
      if (triN > 0) {
        const avgInfAtt = triAtt / triN;
        const avgInfDef = triDef / triN;
        // 0.5 / 0.5 blend — half the team's own thin signal, half the bridge.
        s.attack  = 0.5 * s.attack  + 0.5 * avgInfAtt;
        s.defense = 0.5 * s.defense + 0.5 * avgInfDef;
      }
    }
  }

  // Rank-derived priors (Change 1) — used both as the empty-odds fallback and
  // as the per-team default for teams the odds market didn't cover.
  const rankPriors = rankBasedStrengths();

  // Tournament averages from measured fixtures
  const measuredTeams = Object.values(strengths);
  // When NO oddsProbs are available (e.g. Odds API quota exhausted), fall
  // back to the rank-derived priors rather than flat BASE_LAMBDA — preserves
  // strength differentiation across the 48 teams. rankBasedStrengths()
  // intentionally returns values centered on BASE_LAMBDA, so the existing
  // padding math still behaves correctly.
  const rawAvgAtt = measuredTeams.length
    ? measuredTeams.reduce((s,v) => s+v.attack,  0) / measuredTeams.length
    : BASE_LAMBDA;
  const rawAvgDef = measuredTeams.length
    ? measuredTeams.reduce((s,v) => s+v.defense, 0) / measuredTeams.length
    : BASE_LAMBDA;

  // Pad teams with < 3 fixtures toward their rank-based prior (when known)
  // OR the tournament average when the team isn't in WC_TEAM_CONTEXT.
  for (const name in strengths) {
    const s = strengths[name];
    const missing = Math.max(0, 3 - (s.count || 0));
    if (missing > 0) {
      const fallback = rankPriors[name] || { attack: rawAvgAtt, defense: rawAvgDef };
      const total = s.count + missing;
      s.attack  = (s.attack  * s.count + fallback.attack  * missing) / total;
      s.defense = (s.defense * s.count + fallback.defense * missing) / total;
    }
    delete s.count;
  }

  // Fill any missing teams (no odds data at all) with rank-based priors —
  // the empty-odds path lands here with every team getting their FIFA-rank-
  // derived strength instead of a flat BASE_LAMBDA.
  for (const name of getAllTeamNames()) {
    if (!strengths[name]) {
      strengths[name] = rankPriors[name]
        ? { ...rankPriors[name] }
        : { attack: rawAvgAtt, defense: rawAvgDef };
    }
  }
  return strengths;
}

// ── applyBayesianUpdate ─────────────────────────────────────────────────────
// Blend prior strengths (rank-derived or odds-derived) with observed match
// performance. Two refinements over the original "PRIOR_WEIGHT = 3" blend:
//
// Change 4 (result quality): goalDiff scales each observation's weight by
//   qualityWeight = 1 + 0.15 * |hScore - aScore|. A 3-0 result counts as
//   ~1.45 observations vs 1.0 for a 0-0 draw. Decisive results cut through
//   the prior faster — a small bump that compounds over the group stage.
//
// Change 5 (dynamic prior decay): the prior weight tapers from 3.0 at
//   tournament start down to ~0.8 once all 72 group games are in:
//     dynamicPrior = Math.max(0.5, 3.0 - nResults * 0.03)
//   After matchday 1 (~24 results) → ~2.28
//   After matchday 2 (~48 results) → ~1.56
//   After matchday 3 (~72 results) → ~0.84
//   The floor at 0.5 keeps the prior from disappearing entirely.
//
// Opponent-strength adjustment (unchanged):
//   obsAttack  = goalsScored   × BASE / opponent_defense_prior
//   obsDefense = goalsConceded × BASE / opponent_attack_prior

function applyBayesianUpdate(strengths, d1Results) {
  if (!d1Results || d1Results.length === 0) return;

  // Change 5 — dynamic prior decay. Computed once for the whole batch.
  const dynamicPrior = Math.max(0.5, 3.0 - d1Results.length * 0.03);

  const obs = {}; // { teamName: { attSum, defSum, games } }
  const addObs = (name, att, def, weight) => {
    if (!obs[name]) obs[name] = { attSum: 0, defSum: 0, games: 0 };
    obs[name].attSum += att * weight;
    obs[name].defSum += def * weight;
    obs[name].games  += weight;
  };

  for (const r of d1Results) {
    const home = normalizeTeamName(r.home);
    const away = normalizeTeamName(r.away);
    const hPrior = strengths[home] || { attack: BASE_LAMBDA, defense: BASE_LAMBDA };
    const aPrior = strengths[away] || { attack: BASE_LAMBDA, defense: BASE_LAMBDA };
    const hScore = r.home_score ?? 0;
    const aScore = r.away_score ?? 0;

    // Change 4 — result quality weight. 0-0 draw → 1.0; 1-0 → 1.15; 3-0 → 1.45.
    const goalDiff = Math.abs(hScore - aScore);
    const qualityWeight = 1 + 0.15 * goalDiff;

    addObs(home, hScore * BASE_LAMBDA / (aPrior.defense || BASE_LAMBDA),
                 aScore * BASE_LAMBDA / (aPrior.attack  || BASE_LAMBDA),
                 qualityWeight);
    addObs(away, aScore * BASE_LAMBDA / (hPrior.defense || BASE_LAMBDA),
                 hScore * BASE_LAMBDA / (hPrior.attack  || BASE_LAMBDA),
                 qualityWeight);
  }

  // Blend: posterior = (dynamicPrior × prior + nGames × observed) / (dynamicPrior + nGames)
  for (const [name, o] of Object.entries(obs)) {
    if (!strengths[name]) continue;
    const prior = strengths[name];
    const obsAtt = o.attSum / o.games;
    const obsDef = o.defSum / o.games;
    const w = dynamicPrior + o.games;
    strengths[name].attack  = (dynamicPrior * prior.attack  + o.games * obsAtt) / w;
    strengths[name].defense = (dynamicPrior * prior.defense + o.games * obsDef) / w;
  }
}

// ── getAllTeamNames ──────────────────────────────────────────────────────────
// Returns all 48 WC team display names from WC_TEAM_CONTEXT.
function getAllTeamNames() {
  return Object.values(WC_TEAM_CONTEXT).map(t => t.displayName);
}

// ── h2hLambdas ───────────────────────────────────────────────────────────────
// Head-to-head expected goals for teamA vs teamB on a neutral venue.
// Formula: λA = BASE × (attackA/BASE) × (defenseB/BASE)
//               = attackA × defenseB / BASE
// defense = avg lambda conceded (goals opponents score vs this team).
// High defense value → leaky defense → easier to score against ✅
// Low defense value  → strong defense → harder to score against ✅
const BASE_LAMBDA = 1.15;  // ~WC knockout average per team per 90 min
// Change 3 — host nation home advantage. The three 2026 co-hosts get a
// scoring uplift when they're in the lambda calc (every group game in their
// home market, friendly crowd, no travel). HOST_BOOST is added to attack
// lambda BEFORE the floor clamp.
const HOST_CODES = new Set(['USA', 'MEX', 'CAN']);
const HOST_BOOST = 0.18;
function h2hLambdas(teamA, teamB, strengths) {
  const A = strengths[teamA] || { attack: BASE_LAMBDA, defense: BASE_LAMBDA };
  const B = strengths[teamB] || { attack: BASE_LAMBDA, defense: BASE_LAMBDA };
  // defense is how many goals this team CONCEDES on average;
  // higher defense = more porous → scale up opponent's expected goals
  let lA = A.attack * (B.defense / BASE_LAMBDA);
  let lB = B.attack * (A.defense / BASE_LAMBDA);
  const aCode = WC_NAME_TO_CODE[teamA];
  const bCode = WC_NAME_TO_CODE[teamB];
  if (aCode && HOST_CODES.has(aCode)) lA += HOST_BOOST;
  if (bCode && HOST_CODES.has(bCode)) lB += HOST_BOOST;
  return [Math.max(0.2, lA), Math.max(0.2, lB)];
}

// ── simulateMatch ────────────────────────────────────────────────────────────
// Simulate one knockout match, returning 'A' or 'B' as the winner.
// Uses Poisson WP; draws are broken randomly 50/50 (ET/PKs abstraction).
function simulateMatch(teamA, teamB, strengths, rng) {
  const [lA, lB] = h2hLambdas(teamA, teamB, strengths);
  const wp = winProbsFromLambda(lA, lB);
  const r = rng();
  if (r < wp.homeWin) return teamA;
  if (r < wp.homeWin + wp.awayWin) return teamB;
  return rng() < 0.5 ? teamA : teamB;  // draw → 50/50 ET/PKs
}

// ── sampleGroupResult ────────────────────────────────────────────────────────
// For a single group game, sample W/D/L using odds probabilities.
// Returns { winner: name|null, draw: bool, loser: name }
function sampleGroupResult(home, away, pHome, pDraw, pAway, rng) {
  const r = rng();
  if (r < pHome)           return { home: 1, away: 0 };  // home win
  if (r < pHome + pDraw)   return { home: 0, away: 0 };  // draw
  return                          { home: 0, away: 1 };  // away win
}

// ── simulateGroupStage ───────────────────────────────────────────────────────
// Complete all remaining group stage games for all 12 groups.
// Returns: { A: [{name, pts, gf, ga}], B: [...], ... } sorted by pts→GD→GF.
//
// completedResults: [{home, away, homeScore, awayScore}] already played
// remainingFixtures: [{home, away, pHome, pDraw, pAway}]
// currentStandings: { A: [{name,pts,gf,ga,...}], ... }
function simulateGroupStage(currentStandings, remainingFixtures, rng) {
  // Copy standings
  const pts  = {}, gf = {}, ga = {}, group = {};
  for (const [g, rows] of Object.entries(currentStandings || {})) {
    for (const r of (rows || [])) {
      const n = normalizeTeamName(r.name || r.team);
      pts[n]   = r.points || r.pts || 0;
      gf[n]    = r.gf || 0;
      ga[n]    = r.ga || 0;
      group[n] = g;
    }
  }

  // Register any teams appearing in remaining fixtures but absent from standings.
  // Happens on Day 1 before any results exist. Look up group from WC_TEAM_CONTEXT.
  const allCtx = Object.values(WC_TEAM_CONTEXT);
  const nameToGroup = {};
  for (const c of allCtx) nameToGroup[c.displayName] = c.group;

  for (const fix of (remainingFixtures || [])) {
    for (const side of [fix.home, fix.away]) {
      const normSide = normalizeTeamName(side);
      if (!group[normSide]) {
        const grp = nameToGroup[normSide] || null;
        if (grp) { group[normSide] = grp; pts[normSide] = 0; gf[normSide] = 0; ga[normSide] = 0; }
      }
    }
  }

  // Simulate remaining games
  for (const fix of (remainingFixtures || [])) {
    const home = normalizeTeamName(fix.home);
    const away = normalizeTeamName(fix.away);
    const res = sampleGroupResult(home, away,
      fix.pHome, fix.pDraw, fix.pAway, rng);
    const draw = res.home + res.away === 0;
    pts[home]  = (pts[home]  || 0) + (res.home === 1 ? 3 : draw ? 1 : 0);
    pts[away]  = (pts[away]  || 0) + (res.away === 1 ? 3 : draw ? 1 : 0);
    const lH = fix.lambdaHome || 1.3, lA = fix.lambdaAway || 0.8;
    const goalsH = poissonSample(res.home === 1 ? Math.max(lH, 0.5) : res.home === 0 ? 0 : 0, rng);
    const goalsA = poissonSample(res.away === 1 ? Math.max(lA, 0.5) : res.away === 0 ? 0 : 0, rng);
    gf[home]  = (gf[home]  || 0) + goalsH + (res.home === 1 ? 1 : 0);
    ga[home]  = (ga[home]  || 0) + goalsA + (res.away === 1 ? 1 : 0);
    gf[away]  = (gf[away]  || 0) + goalsA + (res.away === 1 ? 1 : 0);
    ga[away]  = (ga[away]  || 0) + goalsH + (res.home === 1 ? 1 : 0);
  }

  // Rebuild sorted group tables
  const tables = {};
  const groups = {};
  for (const [name, g] of Object.entries(group)) {
    if (!groups[g]) groups[g] = [];
    groups[g].push({ name, pts: pts[name]||0, gf: gf[name]||0, ga: ga[name]||0,
                     gd: (gf[name]||0)-(ga[name]||0) });
  }
  for (const [g, rows] of Object.entries(groups)) {
    tables[g] = rows.sort((a,b) => (b.pts-a.pts)||(b.gd-a.gd)||(b.gf-a.gf));
  }
  return tables;
}

// ── pickBest8Third ───────────────────────────────────────────────────────────
// Pick the best 8 of 12 third-place teams by pts → GD → GF.
// Returns array of 8 {name, group} objects.
function pickBest8Third(tables) {
  const thirds = Object.entries(tables)
    .map(([g, rows]) => rows[2] ? { ...rows[2], group: g } : null)
    .filter(Boolean);
  thirds.sort((a,b) => (b.pts-a.pts)||(b.gd-a.gd)||(b.gf-a.gf));
  return thirds.slice(0, 8);
}

// ── resolveR32Teams ──────────────────────────────────────────────────────────
// Given final group tables and best8Third, resolve who plays in each R32 match.
// Returns: { 73: {home: 'Mexico', away: 'USA'}, 74: {...}, ... }
function resolveR32Teams(tables, best8Third) {
  const matchups = {};

  // Step 1: Resolve all 1st/2nd place slots (no ordering issue)
  const thirdSlots = []; // collect 3rd-place slots for constraint-first assignment
  for (const slot of R32_SLOTS) {
    const resolveFixed = (side) => {
      if (side.pos === 1 || side.pos === 2) {
        const row = (tables[side.group] || [])[side.pos - 1];
        return row?.name || `${side.pos===1?'W':'RU'}-${side.group}`;
      }
      return null; // 3rd-place — handle below
    };
    const home = resolveFixed(slot.home);
    const away = resolveFixed(slot.away);
    if (home && away) {
      matchups[slot.match] = { home, away };
    } else {
      // One side is a 3rd-place slot
      const fixedSide = home ? 'home' : 'away';
      const thirdSide = home ? slot.away : slot.home;
      matchups[slot.match] = { [fixedSide]: home || away };
      thirdSlots.push({ match: slot.match, side: home ? 'away' : 'home', eligible: thirdSide.eligible });
    }
  }

  // Step 2: Constraint-first assignment for 3rd-place slots
  // Build candidate sets per slot
  const best8Set = new Set(best8Third.map(t => t.group));
  const b8ByGroup = {};
  for (const t of best8Third) b8ByGroup[t.group] = t.name;
  for (const ts of thirdSlots) {
    ts.candidates = (ts.eligible || '').split('')
      .filter(g => best8Set.has(g));
  }

  // Sort by fewest candidates first (most constrained first)
  thirdSlots.sort((a, b) => a.candidates.length - b.candidates.length);

  // Backtracking solver: assign one group per slot, no group reused
  const usedGroups = new Set();
  const slotAssignment = new Array(thirdSlots.length).fill(null); // index → group letter

  function backtrack(idx) {
    if (idx >= thirdSlots.length) return true;
    const ts = thirdSlots[idx];
    for (const g of ts.candidates) {
      if (usedGroups.has(g)) continue;
      usedGroups.add(g);
      slotAssignment[idx] = g;
      if (backtrack(idx + 1)) return true;
      usedGroups.delete(g);
      slotAssignment[idx] = null;
    }
    return false;
  }
  backtrack(0);

  // Apply: each slot gets the team from its assigned group
  for (let i = 0; i < thirdSlots.length; i++) {
    const ts = thirdSlots[i];
    const g = slotAssignment[i];
    matchups[ts.match][ts.side] = g ? (b8ByGroup[g] || `3rd-${g}`) : `3rd-${ts.eligible}`;
  }

  return matchups;
}

// ── simulateKnockoutBracket ──────────────────────────────────────────────────
// Given R32 matchups, simulate all knockout rounds.
// Returns: { reached: { teamName: maxRound } }
// Rounds: 'R32', 'R16', 'QF', 'SF', 'Final', 'Champion'
const ROUND_NAMES = ['R32', 'R16', 'QF', 'SF', 'Final', 'Champion'];

function simulateKnockoutBracket(r32Matchups, strengths, rng, finishPositions = {}) {
  const reached = {};  // teamName → last round reached
  const track = (team, round) => {
    if (!reached[team] || ROUND_NAMES.indexOf(round) > ROUND_NAMES.indexOf(reached[team])) {
      reached[team] = round;
    }
  };
  // slotWinners: slot ID → winning team name for THIS simulation
  const slotWinners = {};

  // R32: 16 matches
  const r32Winners = {};
  for (const slot of R32_SLOTS) {
    const m = r32Matchups[slot.match];
    if (!m) continue;
    track(m.home, 'R32'); track(m.away, 'R32');
    const winner = simulateMatch(m.home, m.away, strengths, rng);
    r32Winners[slot.match] = winner;
    slotWinners[`R32_${slot.match}`]   = winner;  // existing: R32 winner (for R16 pairing)
    slotWinners[`R32_${slot.match}_A`] = m.home;  // both participants for full bracket display
    slotWinners[`R32_${slot.match}_B`] = m.away;
  }

  // R16: 8 matches from R32 winner pairs
  const r16Winners = [];
  for (let i = 0; i < R32_TO_R16_PAIRS.length; i++) {
    const [matchA, matchB] = R32_TO_R16_PAIRS[i];
    const tA = r32Winners[matchA], tB = r32Winners[matchB];
    if (!tA || !tB) { r16Winners.push(null); continue; }
    track(tA, 'R16'); track(tB, 'R16');
    const wR16 = simulateMatch(tA, tB, strengths, rng);
    r16Winners.push(wR16);
    slotWinners[`R16_${i}`] = wR16;        // winner (for QF pairing)
    slotWinners[`R16_${i}_A`] = tA;        // both participants for full bracket display
    slotWinners[`R16_${i}_B`] = tB;
  }

  // QF: 4 matches
  const qfWinners = [];
  for (let i = 0; i < R16_TO_QF_PAIRS.length; i++) {
    const [iA, iB] = R16_TO_QF_PAIRS[i];
    const tA = r16Winners[iA], tB = r16Winners[iB];
    if (!tA || !tB) { qfWinners.push(null); continue; }
    track(tA, 'QF'); track(tB, 'QF');
    const wQF = simulateMatch(tA, tB, strengths, rng);
    qfWinners.push(wQF);
    slotWinners[`QF_${i}`] = wQF;          // winner (for SF pairing)
    slotWinners[`QF_${i}_A`] = tA;         // both participants for full bracket display
    slotWinners[`QF_${i}_B`] = tB;
  }

  // SF: 2 matches
  const sfWinners = [];
  for (let i = 0; i < QF_TO_SF_PAIRS.length; i++) {
    const [iA, iB] = QF_TO_SF_PAIRS[i];
    const tA = qfWinners[iA], tB = qfWinners[iB];
    if (!tA || !tB) { sfWinners.push(null); continue; }
    track(tA, 'SF'); track(tB, 'SF');
    const wSF = simulateMatch(tA, tB, strengths, rng);
    sfWinners.push(wSF);
    slotWinners[`SF_${i}`] = wSF;          // winner (for Final pairing)
    slotWinners[`SF_${i}_A`] = tA;         // both participants for full bracket display
    slotWinners[`SF_${i}_B`] = tB;
  }

  // Final
  const tA = sfWinners[0], tB = sfWinners[1];
  if (tA && tB) {
    track(tA, 'Final'); track(tB, 'Final');
    const champion = simulateMatch(tA, tB, strengths, rng);
    track(champion, 'Champion');
    slotWinners['Final'] = champion;       // winner/champion
    slotWinners['Final_A'] = tA;           // both participants for full bracket display
    slotWinners['Final_B'] = tB;
    slotWinners['Champion'] = champion;
  }

  return { reached, finishPositions, slotWinners };
}

// ── seededRng ────────────────────────────────────────────────────────────────
// Deterministic PRNG (xorshift32) for reproducible tests. Not used in production
// (production uses Math.random for actual Monte Carlo randomness).
export function seededRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// ── computeTournamentProjections ─────────────────────────────────────────────
// Main entry point. Given current data, return per-team probabilities.
//
// Params:
//   currentStandings: { A: [{name/team, points, gf, ga}], ... }
//   remainingFixtures: [{home, away, pHome, pDraw, pAway}] — yet to be played
//   oddsProbs:         [{home_team, away_team, lambdaHome, lambdaAway}] all group games
//   N:                 number of simulations (default 2000)
//
// Returns:
//   { teams: [{name, group, fifaCode, pR32, pR16, pQF, pSF, pFinal, pChamp}],
//     generatedAt: ISO timestamp, N: number }
export function computeTournamentProjections({
  currentStandings = {},
  remainingFixtures = [],
  oddsProbs         = [],
  d1Results         = [],
  N                 = 2000,
} = {}) {
  const rng = Math.random;
  const strengths = deriveTeamStrengths(oddsProbs);

  // Tier 1: Bayesian strength update from actual match results.
  // Blend odds-derived priors with opponent-adjusted observed performance.
  applyBayesianUpdate(strengths, d1Results);

  // Auto-build remainingFixtures from oddsProbs if caller didn't provide them.
  // Uses commence timestamp to exclude already-played games; on Day 1 all are future.
  let effectiveRemaining = remainingFixtures.length > 0
    ? remainingFixtures
    : oddsProbs.map(g => ({
        home: g.home_team, away: g.away_team,
        pHome: g.pHome, pDraw: g.pDraw || Math.max(0, 1 - g.pHome - g.pAway),
        pAway: g.pAway,
        lambdaHome: g.lambdaHome, lambdaAway: g.lambdaAway,
      }));

  // Fallback: when the Odds API is unavailable AND the caller did not pass
  // remainingFixtures, the WC group-stage round-robin schedule is synthesized
  // from WC_TEAM_CONTEXT (the factual 12-groups-of-4 layout). Any fixture
  // already represented in effectiveRemaining or already in d1Results is
  // skipped. Probabilities come from h2hLambdas → winProbsFromLambda using
  // the strengths derived above — no new rating system introduced.
  const _normName = s => (s || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const haveKey = new Set();
  for (const f of effectiveRemaining) {
    haveKey.add(`${_normName(f.home)}|${_normName(f.away)}`);
    haveKey.add(`${_normName(f.away)}|${_normName(f.home)}`);
  }
  for (const r of (d1Results || [])) {
    haveKey.add(`${_normName(r.home)}|${_normName(r.away)}`);
    haveKey.add(`${_normName(r.away)}|${_normName(r.home)}`);
  }
  const teamsByGroup = {};
  for (const ctx of Object.values(WC_TEAM_CONTEXT)) {
    if (!ctx.group || !ctx.displayName) continue;
    (teamsByGroup[ctx.group] = teamsByGroup[ctx.group] || []).push(ctx.displayName);
  }
  const synthesized = [];
  for (const teams of Object.values(teamsByGroup)) {
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const home = teams[i], away = teams[j];
        if (haveKey.has(`${_normName(home)}|${_normName(away)}`)) continue;
        const [lH, lA] = h2hLambdas(home, away, strengths);
        const wp = winProbsFromLambda(lH, lA);
        // winProbsFromLambda returns { home, draw, away } — see soccer-wp.js:79.
        synthesized.push({
          home, away,
          pHome:      +wp.home.toFixed(3),
          pDraw:      +wp.draw.toFixed(3),
          pAway:      +wp.away.toFixed(3),
          lambdaHome: lH,
          lambdaAway: lA,
        });
      }
    }
  }
  if (synthesized.length) effectiveRemaining = effectiveRemaining.concat(synthesized);
  const counts = {};  // { teamName: { R32:0, R16:0, QF:0, SF:0, Final:0, Champion:0 } }
  // countsByPos: { teamName: { 1: {R32,R16,...,Champion,total}, 2: {...}, 3: {...} } }
  // Tracks outcomes split by whether team finished 1st, 2nd, or 3rd in group.
  const countsByPos = {};
  // slotCounts: { slotId: { teamName: count } } — tracks most-frequent winner per bracket slot
  const slotCounts = {};
  const tallySlot = (slotId, team) => {
    if (!slotCounts[slotId]) slotCounts[slotId] = {};
    slotCounts[slotId][team] = (slotCounts[slotId][team] || 0) + 1;
  };

  const initCounts = (name) => {
    if (!counts[name]) counts[name] = { R32:0, R16:0, QF:0, SF:0, Final:0, Champion:0 };
    if (!countsByPos[name]) countsByPos[name] = {
      1: { R32:0, R16:0, QF:0, SF:0, Final:0, Champion:0, total:0 },
      2: { R32:0, R16:0, QF:0, SF:0, Final:0, Champion:0, total:0 },
      3: { R32:0, R16:0, QF:0, SF:0, Final:0, Champion:0, total:0 },
    };
  };

  // Ensure all 48 teams have a counter even if they never appear
  for (const ctx of Object.values(WC_TEAM_CONTEXT)) initCounts(ctx.displayName);

  for (let i = 0; i < N; i++) {
    // 1. Simulate group stage
    const tables = simulateGroupStage(currentStandings, effectiveRemaining, rng);
    // 2. Pick best 8 third
    const best8 = pickBest8Third(tables);
    // 3. Build R32 matchups
    const r32 = resolveR32Teams(tables, best8);
    // 4. Record each team's finish position for this simulation
    const simFinishPos = {};  // { teamName: 1|2|3 }
    for (const [g, rows] of Object.entries(tables)) {
      rows.forEach((row, idx) => {
        if (idx < 3) simFinishPos[row.name] = idx + 1;
      });
    }
    // 5. Simulate knockout
    const { reached, slotWinners: simSlots } = simulateKnockoutBracket(r32, strengths, rng, simFinishPos);
    // 5b. Tally slot winners for bracket tree
    for (const [slotId, team] of Object.entries(simSlots)) {
      if (team) tallySlot(slotId, team);
    }
    // 6. Tally global counts + per-position counts
    for (const [team, round] of Object.entries(reached)) {
      initCounts(team);
      const roundIdx = ROUND_NAMES.indexOf(round);
      for (let r = 0; r <= roundIdx; r++) {
        counts[team][ROUND_NAMES[r]]++;
      }
      // Per-position tally
      const pos = simFinishPos[team];
      if (pos && countsByPos[team]?.[pos]) {
        countsByPos[team][pos].total++;
        for (let r = 0; r <= roundIdx; r++) {
          countsByPos[team][pos][ROUND_NAMES[r]]++;
        }
      }
    }
  }

  // Build output: look up FIFA code + group from WC_TEAM_CONTEXT
  const nameToCtx = {};
  for (const ctx of Object.values(WC_TEAM_CONTEXT)) nameToCtx[ctx.displayName] = ctx;
  const codeToCtx = {};
  for (const ctx of Object.values(WC_TEAM_CONTEXT)) codeToCtx[ctx.fifaCode] = ctx;

  const teams = Object.entries(counts).map(([name, c]) => {
    const ctx = nameToCtx[name] || {};
    return {
      name,
      fifaCode:  ctx.fifaCode  || '',
      group:     ctx.group     || '',
      fifaRank:  ctx.fifaRank  || 99,
      pR32:      round2(c.R32    / N),
      pR16:      round2(c.R16    / N),
      pQF:       round2(c.QF     / N),
      pSF:       round2(c.SF     / N),
      pFinal:    round2(c.Final  / N),
      pChamp:    round2(c.Champion / N),
    };
  });

  // Sort by pChamp desc — filter out abstract placeholders (no fifaCode)
  teams.sort((a,b) => b.pChamp - a.pChamp);
  const filteredTeams = teams.filter(t => t.fifaCode);

  // Detect bracket traps using position-conditional counts
  const bracketTraps = detectBracketTraps(countsByPos, N, nameToCtx);

  // ── Coherent bracket builder ─────────────────────────────────────────────
  // Instead of independent mode-per-slot (which causes team duplication and
  // cross-round inconsistency), build a single coherent bracket:
  //   1. Modal group finishing order (most frequent 1st/2nd/3rd per group)
  //   2. Best 8 third-place from modal 3rd-place teams
  //   3. R32 matchups from FIFA Annex C rules
  //   4. Each knockout match: Poisson probability → deterministic favorite
  //   5. Winners feed forward: R32→R16→QF→SF→Final→Champion
  // Result: each team appears exactly once, bracket flows logically.
  // Probabilities shown = team's Monte Carlo advancement rate for that round.

  // Step 1: Modal group finishing order
  const groups = 'ABCDEFGHIJKL'.split('');
  const modalTables = {};
  for (const g of groups) {
    const groupTeams = Object.values(WC_TEAM_CONTEXT)
      .filter(ctx => ctx.group === g)
      .map(ctx => ctx.displayName);
    const rows = [];
    const placed = new Set();
    for (const pos of [0, 1, 2, 3]) { // 0=1st, 1=2nd, 2=3rd, 3=4th
      let bestTeam = null, bestCount = 0;
      for (const team of groupTeams) {
        if (placed.has(team)) continue;
        const cPos = pos < 3 ? (countsByPos[team]?.[pos + 1]?.total || 0) : 0;
        // For 4th place: use N minus sum of other positions
        const count = pos < 3 ? cPos : N;
        if (count > bestCount || !bestTeam) { bestTeam = team; bestCount = count; }
      }
      if (bestTeam) {
        rows.push({ name: bestTeam, group: g, pts: 0, gd: 0, gf: 0 });
        placed.add(bestTeam);
      }
    }
    modalTables[g] = rows;
  }

  // Step 2: Pick best 8 third-place teams (by R32 qualification frequency)
  const modalThirds = groups.map(g => {
    const thirdTeam = modalTables[g]?.[2]?.name;
    if (!thirdTeam) return null;
    const r32AsThird = countsByPos[thirdTeam]?.[3]?.R32 || 0;
    return { name: thirdTeam, group: g, pts: 0, gd: 0, gf: 0, qualRate: r32AsThird / N };
  }).filter(Boolean).sort((a, b) => b.qualRate - a.qualRate);
  const modalBest8 = modalThirds.slice(0, 8);

  // Step 3: Build R32 matchups via FIFA Annex C
  const modalR32 = resolveR32Teams(modalTables, modalBest8);

  // Step 4+5: Forward-simulate bracket (deterministic — pick Poisson favorite)
  const bracketSlots = {};
  const _pmf = (l, k) => { let r = Math.exp(-l); for (let i = 1; i <= k; i++) r *= l / i; return r; };
  const _pickFav = (tA, tB) => {
    const sA = strengths[tA] || { attack: BASE_LAMBDA, defense: BASE_LAMBDA };
    const sB = strengths[tB] || { attack: BASE_LAMBDA, defense: BASE_LAMBDA };
    const lA = sA.attack * sB.defense / BASE_LAMBDA;
    const lB = sB.attack * sA.defense / BASE_LAMBDA;
    let pA = 0, pDraw = 0;
    for (let a = 0; a <= 8; a++) for (let b = 0; b <= 8; b++) {
      const p = _pmf(lA, a) * _pmf(lB, b);
      if (a > b) pA += p; else if (a === b) pDraw += p;
    }
    pA += pDraw * 0.5; // knockout draws → ~50/50 penalties
    return pA >= 0.5 ? tA : tB;
  };
  const _slot = (name, round) => {
    const ctx = nameToCtx[name] || {};
    const c = counts[name] || {};
    return { team: name, fifaCode: ctx.fifaCode || '', prob: round2((c[round] || 0) / N) };
  };

  // R32: 16 matches
  const r32Winners = {};
  for (const slot of R32_SLOTS) {
    const m = modalR32[slot.match];
    if (!m?.home || !m?.away) continue;
    bracketSlots[`R32_${slot.match}_A`] = _slot(m.home, 'R32');
    bracketSlots[`R32_${slot.match}_B`] = _slot(m.away, 'R32');
    r32Winners[slot.match] = _pickFav(m.home, m.away);
  }

  // R16: 8 matches from R32 winner pairs
  const r16Winners = [];
  for (let i = 0; i < R32_TO_R16_PAIRS.length; i++) {
    const [matchA, matchB] = R32_TO_R16_PAIRS[i];
    const tA = r32Winners[matchA], tB = r32Winners[matchB];
    if (!tA || !tB) { r16Winners.push(null); continue; }
    bracketSlots[`R16_${i}_A`] = _slot(tA, 'R16');
    bracketSlots[`R16_${i}_B`] = _slot(tB, 'R16');
    r16Winners.push(_pickFav(tA, tB));
  }

  // QF: 4 matches
  const qfWinners = [];
  for (let i = 0; i < R16_TO_QF_PAIRS.length; i++) {
    const [iA, iB] = R16_TO_QF_PAIRS[i];
    const tA = r16Winners[iA], tB = r16Winners[iB];
    if (!tA || !tB) { qfWinners.push(null); continue; }
    bracketSlots[`QF_${i}_A`] = _slot(tA, 'QF');
    bracketSlots[`QF_${i}_B`] = _slot(tB, 'QF');
    qfWinners.push(_pickFav(tA, tB));
  }

  // SF: 2 matches
  const sfWinners = [];
  for (let i = 0; i < QF_TO_SF_PAIRS.length; i++) {
    const [iA, iB] = QF_TO_SF_PAIRS[i];
    const tA = qfWinners[iA], tB = qfWinners[iB];
    if (!tA || !tB) { sfWinners.push(null); continue; }
    bracketSlots[`SF_${i}_A`] = _slot(tA, 'SF');
    bracketSlots[`SF_${i}_B`] = _slot(tB, 'SF');
    sfWinners.push(_pickFav(tA, tB));
  }

  // Final
  if (sfWinners[0] && sfWinners[1]) {
    bracketSlots['Final_A'] = _slot(sfWinners[0], 'Final');
    bracketSlots['Final_B'] = _slot(sfWinners[1], 'Final');
    const champion = _pickFav(sfWinners[0], sfWinners[1]);
    bracketSlots['Champion'] = _slot(champion, 'Champion');
  }

  return { teams: filteredTeams, bracketTraps, bracketSlots, generatedAt: new Date().toISOString(), N };
}

// ── detectBracketTraps ────────────────────────────────────────────────────────
// A "bracket trap" = finishing 1st in your group leads to a harder knockout
// path such that pChamp_as_2nd > pChamp_as_1st by at least TRAP_THRESHOLD.
//
// Requires enough simulations in each position bucket to be meaningful.
// MIN_SAMPLES: position must have appeared in at least 5% of simulations.
//
// Returns: [ { team, group, fifaCode,
//              pChampIf1st, pChampIf2nd, delta,
//              pFinalIf1st, pFinalIf2nd,
//              note } ]
// Sorted by delta desc (biggest trap first).
const TRAP_THRESHOLD = 0.005;  // 0.5pp — meaningful path divergence
const MIN_SAMPLES    = 0.05;   // position must appear in ≥5% of sims to count

export function detectBracketTraps(countsByPos, N, nameToCtx) {
  const traps = [];
  for (const [name, byPos] of Object.entries(countsByPos)) {
    const p1 = byPos[1], p2 = byPos[2];
    if (!p1 || !p2) continue;
    // Only evaluate if both positions have enough sample mass
    if (p1.total < N * MIN_SAMPLES) continue;
    if (p2.total < N * MIN_SAMPLES) continue;

    const pChamp1 = p1.Champion / p1.total;
    const pChamp2 = p2.Champion / p2.total;
    const delta   = pChamp2 - pChamp1;  // positive = 2nd is better

    if (delta < TRAP_THRESHOLD) continue;

    const pFinal1 = p1.Final / p1.total;
    const pFinal2 = p2.Final / p2.total;

    const ctx = nameToCtx?.[name] || {};
    traps.push({
      team:       name,
      group:      ctx.group    || '',
      fifaCode:   ctx.fifaCode || '',
      pChampIf1st: round2(pChamp1),
      pChampIf2nd: round2(pChamp2),
      delta:       round2(delta),
      pFinalIf1st: round2(pFinal1),
      pFinalIf2nd: round2(pFinal2),
    });
  }
  traps.sort((a, b) => b.delta - a.delta);
  return traps;
}

// ── computeMovers ─────────────────────────────────────────────────────────────
// Compare prev and curr projections. Return biggest movers + secondary beneficiaries.
//
// "Secondary beneficiary": team whose pFinal changed significantly but had no
// fixture in remainingFixtures today (they didn't play).
//
// Params:
//   prev: output of computeTournamentProjections from previous run
//   curr: current output
//   teamsPlayedToday: Set of team names that had a fixture today
//
// Returns:
//   { gainers: [...], losers: [...], secondaryBeneficiaries: [...],
//     secondaryLosers: [...], topMover: {...} }
export function computeMovers(prev, curr, teamsPlayedToday = new Set()) {
  if (!prev?.teams || !curr?.teams) return null;

  const prevByName = {};
  for (const t of prev.teams) prevByName[t.name] = t;

  const diffs = curr.teams.map(t => {
    const p = prevByName[t.name];
    if (!p) return null;
    const deltaFinal = t.pFinal - p.pFinal;
    const deltaChamp = t.pChamp - p.pChamp;
    const played = teamsPlayedToday.has(t.name);
    return { name: t.name, fifaCode: t.fifaCode, group: t.group,
             pFinal: t.pFinal, prevFinal: p.pFinal, deltaFinal,
             pChamp: t.pChamp, prevChamp: p.pChamp, deltaChamp,
             played };
  }).filter(Boolean);

  // Sort by absolute change in pFinal
  const byDelta = [...diffs].sort((a,b) => Math.abs(b.deltaFinal) - Math.abs(a.deltaFinal));

  const gainers               = byDelta.filter(d => d.deltaFinal > 0.005 &&  d.played).slice(0, 5);
  const losers                = byDelta.filter(d => d.deltaFinal < -0.005 && d.played).slice(0, 5);
  const secondaryBeneficiaries = byDelta.filter(d => d.deltaFinal > 0.005 && !d.played).slice(0, 5);
  const secondaryLosers        = byDelta.filter(d => d.deltaFinal < -0.005 && !d.played).slice(0, 5);
  const topMover               = byDelta[0] || null;

  return { gainers, losers, secondaryBeneficiaries, secondaryLosers, topMover,
           generatedAt: curr.generatedAt };
}

// ── buildMoversBriefPrompt ────────────────────────────────────────────────────
// Build the Claude prompt for daily movers journalism.
// Returns a prompt string; caller sends to Claude and caches in KV.
export function buildMoversBriefPrompt(movers, projections) {
  if (!movers) return null;

  const pct = v => `${Math.round(v * 100)}%`;

  const fmtTeam = (d) => {
    const ctx = Object.values(WC_TEAM_CONTEXT).find(c => c.displayName === d.name);
    const note = ctx?.narrativeNote || '';
    return `${d.name} (Group ${d.group}): Final probability ${pct(d.prevFinal)} → ${pct(d.pFinal)} (${d.deltaFinal > 0 ? '+' : ''}${pct(d.deltaFinal)}). Championship odds ${pct(d.prevChamp)} → ${pct(d.pChamp)}. Context: ${note}`;
  };

  const lines = [
    'You are FIELD, a sports intelligence product. Write a 3-paragraph World Cup tournament outlook brief.',
    '',
    'RULES:',
    '- Maximum 120 words total.',
    '- No bullet points. Flowing prose only.',
    '- No drama scores, no "must-watch", no excitement ratings.',
    '- Only factual statements about probability changes and why they happened.',
    '- Paragraph 1: biggest direct movers (teams that played and gained/lost).',
    '- Paragraph 2: secondary beneficiaries or losers (teams that shifted without playing).',
    '- Paragraph 3: the most surprising bracket trap — a team where finishing 2nd leads to a better championship path than finishing 1st, and WHY (which specific opponents they avoid).',
    '- DO NOT INVENT results. Only reference data provided below.',
    '- DO NOT INVENT goal counts, scorelines, or player statistics. No goal counts appear in the data below, so do not mention any. Refer to results in prose ("won", "drew", "lost") without inventing scorelines.',
    '- If you do mention goals from a verified historical fact in the narrative notes, use lowercase "goal"/"goals" (singular when count is exactly 1; plural otherwise).',
    '',
    'TOURNAMENT PROJECTIONS DATA:',
    `Generated: ${movers.generatedAt}`,
    '',
  ];

  if (movers.gainers?.length) {
    lines.push('DIRECT GAINERS (played today):');
    movers.gainers.forEach(d => lines.push(fmtTeam(d)));
    lines.push('');
  }
  if (movers.losers?.length) {
    lines.push('DIRECT LOSERS (played today):');
    movers.losers.forEach(d => lines.push(fmtTeam(d)));
    lines.push('');
  }
  if (movers.secondaryBeneficiaries?.length) {
    lines.push('SECONDARY BENEFICIARIES (did NOT play today but improved):');
    movers.secondaryBeneficiaries.forEach(d => lines.push(fmtTeam(d)));
    lines.push('');
  }
  if (movers.secondaryLosers?.length) {
    lines.push('SECONDARY LOSERS (did NOT play today but declined):');
    movers.secondaryLosers.forEach(d => lines.push(fmtTeam(d)));
    lines.push('');
  }

  if (projections?.bracketTraps?.length) {
    lines.push('BRACKET TRAPS (finishing 2nd is better than 1st for pChamp):');
    projections.bracketTraps.slice(0, 3).forEach(t => {
      lines.push(
        `${t.team} (Group ${t.group}): pChamp as 1st=${pct(t.pChampIf1st)}, as 2nd=${pct(t.pChampIf2nd)}, delta=+${pct(t.delta)}`
      );
    });
    lines.push('');
  }

  if (projections?.teams) {
    lines.push('TOP 8 CHAMPIONSHIP PROBABILITIES (current):');
    projections.teams.slice(0, 8).forEach(t =>
      lines.push(`${t.name}: ${pct(t.pChamp)} to win · ${pct(t.pFinal)} to reach Final`));
  }

  return lines.join('\n');
}

// ── ODDS API name aliases ─────────────────────────────────────────────────────
// Maps Odds API team names to WC_TEAM_CONTEXT displayName.
// Mismatches arise from FIFA name evolution vs. common usage.
const ODDS_NAME_ALIAS = {
  'Czech Republic':           'Czechia',
  'Bosnia & Herzegovina':     'Bosnia and Herzegovina',
  'Bosnia And Herzegovina':   'Bosnia and Herzegovina',
  'DR Congo':                 'Congo DR',
  'Republic of Ireland':      'Republic of Ireland',  // same
  'USA':                      'United States',
  'Turkey':                   'Türkiye',
  'Turkiye':                  'Türkiye',               // no-umlaut variant
  'Curacao':                  'Curaçao',               // no-cedilla variant
  'Ivory Coast':              'Ivory Coast',           // same
  "Cote d'Ivoire":            'Ivory Coast',           // French name variant
  'Cote dIvoire':             'Ivory Coast',           // no-apostrophe variant
  'Korea Republic':           'South Korea',           // FIFA official name
  'Republic of Korea':        'South Korea',           // alternate formal name
};

function normalizeTeamName(name) {
  return ODDS_NAME_ALIAS[name] || name;
}

// ── computeMatchWP ──────────────────────────────────────────────────────────
// Per-match win-probability for /wc/match-wp. Derives strengths the same way
// the projection engine does (oddsProbs prior + d1Results Bayesian update) and
// returns {homeWP, drawWP, awayWP} via the engine's h2hLambdas →
// winProbsFromLambda path. Designed to replace odds-implied WP when the
// Odds API is exhausted — the entire pipeline uses BASE_LAMBDA defaults
// when oddsProbs is empty (no new ratings introduced).
//
// `homeName` / `awayName` are WC_TEAM_CONTEXT displayNames (already resolved
// by the caller). `oddsProbs` and `d1Results` may be empty arrays.
export function computeMatchWP(homeName, awayName, { oddsProbs = [], d1Results = [] } = {}) {
  const strengths = deriveTeamStrengths(oddsProbs);
  applyBayesianUpdate(strengths, d1Results);
  const home = normalizeTeamName(homeName);
  const away = normalizeTeamName(awayName);
  const [lH, lA] = h2hLambdas(home, away, strengths);
  const wp = winProbsFromLambda(lH, lA);
  // winProbsFromLambda (src/soccer-wp.js:79) returns { home, draw, away } — NOT
  // { homeWin, draw, awayWin }. (Other helpers in soccer-wp.js DO use the
  // {homeWin/awayWin} shape; do not confuse them.)
  return {
    homeWP: +wp.home.toFixed(3),
    drawWP: +wp.draw.toFixed(3),
    awayWP: +wp.away.toFixed(3),
    lambdaHome: +lH.toFixed(3),
    lambdaAway: +lA.toFixed(3),
  };
}

// Sample from Poisson distribution (simple truncated series)
function poissonSample(lambda, rng) {
  if (lambda <= 0) return 0;
  let L = Math.exp(-lambda), k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L && k < 10);
  return k - 1;
}

function round2(v) { return Math.round(v * 1000) / 1000; }
