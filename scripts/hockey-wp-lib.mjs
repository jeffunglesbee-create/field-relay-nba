#!/usr/bin/env node
// docs/CC-CMD-2026-10-10-nhl-win-probability-from-xg.md
//
// Pure functions shared by the trainer (scripts/hockey-wp-train.mjs) and the
// Worker-side scorer (src/hockey-wp.js). ONE implementation of the feature
// vector, imported by both, because a model trained on one feature order and
// scored on another is wrong in a way no test of either side alone can see.
//
// NOTHING IS PORTED FROM src/soccer-wp.js. In particular DC_RHO is absent and
// must stay absent: Dixon-Coles' rho is a low-score DRAW inflation correction
// and hockey has no draws. Copying it would be a category error dressed as
// reuse. The architecture here is the CC-CMD's option (b) — a direct logistic
// on game state — because score differential and time remaining dominate win
// probability and xG is one feature among several, not the model.

// ── feature vector ──────────────────────────────────────────────────────────
// Order is load-bearing: coefficients are committed positionally.
export const FEATURES = [
  'scoreDiff',        // home - away, the dominant term
  'sdPerSqrtT',       // scoreDiff / sqrt(fraction of regulation left), clamped
  'tRem',             // fraction of regulation remaining
  'skaterDiff',       // home skaters - away skaters (power play)
  'homeEmptyNet',
  'awayEmptyNet',
  'xgDiff',           // cumulative xG, home - away. ONE feature, not the model
  'isOT',
  'isPlayoff'
]

export const SD_CLAMP = 25
export const REG_SECONDS = 3600

export const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v

// A state is only scoreable if score, clock and strength are all readable.
// Each absence is reported by name rather than defaulted — a defaulted
// strength is "even" and a defaulted clock is "start of game", and both are
// confident wrong answers (Rule 99).
export const stateProblems = (s) => {
  const p = []
  if (!Number.isFinite(s?.homeScore) || !Number.isFinite(s?.awayScore)) p.push('score-unreadable')
  if (!Number.isFinite(s?.elapsedSeconds)) p.push('clock-unreadable')
  if (!Number.isFinite(s?.homeSkaters) || !Number.isFinite(s?.awaySkaters)) p.push('strength-unreadable')
  if (typeof s?.homeEmptyNet !== 'boolean' || typeof s?.awayEmptyNet !== 'boolean') p.push('goalie-state-unreadable')
  return p
}

export const featureVector = (s) => {
  const tRemRaw = (REG_SECONDS - s.elapsedSeconds) / REG_SECONDS
  const tRem = clamp(tRemRaw, 0, 1)
  const scoreDiff = s.homeScore - s.awayScore
  // 1/120 of regulation is 30 seconds; the floor stops the ratio exploding at
  // the horn without pretending time has stopped.
  const sdPerSqrtT = clamp(scoreDiff / Math.sqrt(Math.max(tRem, 1 / 120)), -SD_CLAMP, SD_CLAMP)
  return [
    scoreDiff,
    sdPerSqrtT,
    tRem,
    s.homeSkaters - s.awaySkaters,
    s.homeEmptyNet ? 1 : 0,
    s.awayEmptyNet ? 1 : 0,
    Number.isFinite(s.xgDiff) ? s.xgDiff : 0,
    tRemRaw < 0 ? 1 : 0,
    s.isPlayoff ? 1 : 0
  ]
}

export const sigmoid = (z) => z >= 0 ? 1 / (1 + Math.exp(-z)) : (() => { const e = Math.exp(z); return e / (1 + e) })()

// Inference is a dot product over committed coefficients — no ML runtime in
// the Worker, which is the CC-CMD's first stop condition.
export const scoreLinear = (x, model) => {
  let z = model.intercept
  for (let i = 0; i < x.length; i++) z += model.coefficients[i] * ((x[i] - model.mean[i]) / (model.sd[i] || 1))
  return z
}

export const predictFromVector = (x, model) => sigmoid(scoreLinear(x, model))

// ── metrics ─────────────────────────────────────────────────────────────────
export const brier = (ps, ys) => {
  if (!ps.length || ps.length !== ys.length) return null
  let s = 0
  for (let i = 0; i < ps.length; i++) s += (ps[i] - ys[i]) ** 2
  return s / ps.length
}

export const logLoss = (ps, ys) => {
  if (!ps.length || ps.length !== ys.length) return null
  let s = 0
  for (let i = 0; i < ps.length; i++) {
    const p = clamp(ps[i], 1e-12, 1 - 1e-12)
    s += -(ys[i] * Math.log(p) + (1 - ys[i]) * Math.log(1 - p))
  }
  return s / ps.length
}

// A good Brier with a bowed reliability curve is a model that is right on
// average and wrong everywhere, which is why the CC-CMD asks for the table
// and not just the score.
export const reliability = (ps, ys, bins = 10) => {
  const rows = Array.from({ length: bins }, (_, i) => ({
    bin: `${(i / bins).toFixed(1)}-${((i + 1) / bins).toFixed(1)}`,
    n: 0, predictedMean: 0, observedRate: 0
  }))
  for (let i = 0; i < ps.length; i++) {
    const b = Math.min(bins - 1, Math.floor(ps[i] * bins))
    rows[b].n += 1
    rows[b].predictedMean += ps[i]
    rows[b].observedRate += ys[i]
  }
  for (const r of rows) {
    if (r.n) {
      r.predictedMean = +(r.predictedMean / r.n).toFixed(4)
      r.observedRate = +(r.observedRate / r.n).toFixed(4)
      r.gap = +(r.observedRate - r.predictedMean).toFixed(4)
    } else { r.predictedMean = null; r.observedRate = null; r.gap = null }
  }
  return rows
}

// ── training: logistic regression, Adam, L2. Deterministic. ─────────────────
export const standardise = (X) => {
  const n = X.length, d = X[0].length
  const mean = new Array(d).fill(0), sd = new Array(d).fill(0)
  for (const row of X) for (let j = 0; j < d; j++) mean[j] += row[j] / n
  for (const row of X) for (let j = 0; j < d; j++) sd[j] += (row[j] - mean[j]) ** 2 / n
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1
  return { mean, sd }
}

export const trainLogistic = (X, y, { l2 = 1e-4, iters = 400, lr = 0.1, mean, sd } = {}) => {
  const n = X.length, d = X[0].length
  const scaler = mean && sd ? { mean, sd } : standardise(X)
  const Z = X.map(r => r.map((v, j) => (v - scaler.mean[j]) / scaler.sd[j]))
  let w = new Array(d).fill(0), b = 0
  let mw = new Array(d).fill(0), vw = new Array(d).fill(0), mb = 0, vb = 0
  const b1 = 0.9, b2 = 0.999, eps = 1e-8
  for (let t = 1; t <= iters; t++) {
    const gw = new Array(d).fill(0)
    let gb = 0
    for (let i = 0; i < n; i++) {
      let z = b
      const row = Z[i]
      for (let j = 0; j < d; j++) z += w[j] * row[j]
      const r = sigmoid(z) - y[i]
      for (let j = 0; j < d; j++) gw[j] += r * row[j]
      gb += r
    }
    for (let j = 0; j < d; j++) {
      const g = gw[j] / n + l2 * w[j]
      mw[j] = b1 * mw[j] + (1 - b1) * g
      vw[j] = b2 * vw[j] + (1 - b2) * g * g
      w[j] -= lr * (mw[j] / (1 - b1 ** t)) / (Math.sqrt(vw[j] / (1 - b2 ** t)) + eps)
    }
    const g0 = gb / n
    mb = b1 * mb + (1 - b1) * g0
    vb = b2 * vb + (1 - b2) * g0 * g0
    b -= lr * (mb / (1 - b1 ** t)) / (Math.sqrt(vb / (1 - b2 ** t)) + eps)
  }
  return { coefficients: w, intercept: b, mean: scaler.mean, sd: scaler.sd }
}
