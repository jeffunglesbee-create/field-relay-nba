#!/usr/bin/env node
// docs/CC-CMD-2026-10-11-nhl-wpa-attribution.md — Task 4.
//
// "Over a complete game, the sum of all ΔWP plus the opening prior must equal
//  the final outcome (1 or 0) within tolerance. Assert it per game and report
//  the residual distribution across a season. A non-closing sum means plays are
//  being double-counted or dropped."
//
// The stop condition: "If the Task 4 conservation check does not close, STOP
// and report the residual."
//
// This runs it over real finished games and reports the distribution. It does
// not widen the tolerance to make it pass.

import { writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { winProbAddedFromPlayByPlay } from '../src/hockey-wp.js'

export const WEB_BASE = 'https://api-web.nhle.com'
export const CALL_BUDGET = 40

export const summarise = (residuals) => {
  const r = residuals.filter(x => Number.isFinite(x)).slice().sort((a, b) => a - b)
  if (!r.length) return { n: 0, note: 'UNMEASURED — no finished game produced a residual' }
  const q = (f) => r[Math.min(r.length - 1, Math.floor(r.length * f))]
  const abs = r.map(Math.abs).sort((a, b) => a - b)
  return {
    n: r.length,
    min: +r[0].toFixed(4), p25: +q(0.25).toFixed(4), median: +q(0.5).toFixed(4),
    p75: +q(0.75).toFixed(4), max: +r[r.length - 1].toFixed(4),
    mean: +(r.reduce((a, b) => a + b, 0) / r.length).toFixed(4),
    median_ABS: +abs[Math.floor(abs.length / 2)].toFixed(4),
    within_0_01: r.filter(x => Math.abs(x) <= 0.01).length,
  }
}

const getJson = async (url, calls) => {
  calls.n += 1
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'FIELD/1.0' }, signal: AbortSignal.timeout(30000) })
    if (!r.ok) return { ok: false, status: r.status, body: null }
    return { ok: true, status: r.status, body: await r.json() }
  } catch (e) { return { ok: false, status: 0, error: String(e && e.message || e), body: null } }
}

const main = async () => {
  const started = new Date().toISOString()
  const calls = { n: 0 }
  const dates = (process.argv.find(a => a.startsWith('--dates=')) || '--dates=2026-10-08,2026-10-09,2026-10-10').slice(8).split(',')

  const games = []
  for (const d of dates) {
    if (calls.n >= CALL_BUDGET - 10) break
    const sc = await getJson(`${WEB_BASE}/v1/score/${d}`, calls)
    for (const g of (sc.body?.games || [])) {
      if (String(g.gameState || '').toUpperCase().startsWith('OFF') || String(g.gameState || '').toUpperCase() === 'FINAL') games.push(g.id)
    }
  }

  const rows = []
  for (const id of games) {
    if (calls.n >= CALL_BUDGET) break
    const pbp = await getJson(`${WEB_BASE}/v1/gamecenter/${id}/play-by-play`, calls)
    if (!pbp.ok) { rows.push({ gameId: id, error: `pbp HTTP ${pbp.status}` }); continue }
    const w = winProbAddedFromPlayByPlay(pbp.body)
    const c = w.conservation
    rows.push({
      gameId: id, shots: w.shots, stateCounts: w.stateCounts,
      outcome: c.outcome, first_wp: c.first_modelled_wp, last_wp: c.last_modelled_wp,
      sum_of_deltas: c.sum_of_deltas, telescoped: c.telescoped_identity_holds,
      residual: c.residual, closes: c.closes,
      wentToOT: (pbp.body?.plays || []).some(p => (p.periodDescriptor?.number ?? 0) >= 4),
    })
  }

  const scored = rows.filter(r => Number.isFinite(r.residual))
  const closes = scored.filter(r => r.closes).length
  const ot = scored.filter(r => r.wentToOT)
  const reg = scored.filter(r => !r.wentToOT)

  const out = {
    cc_cmd: 'docs/CC-CMD-2026-10-11-nhl-wpa-attribution.md',
    task: 'Task 4 — the conservation check',
    started_at: started, callBudget: CALL_BUDGET, callsMade: calls.n,
    dates, games_found: games.length, games_scored: scored.length,
    tolerance: 0.01,
    closes_count: closes,
    closes_rate: scored.length ? +(closes / scored.length).toFixed(4) : null,
    telescoping_holds_on_every_game: scored.length > 0 && scored.every(r => r.telescoped === true),
    residual_all: summarise(scored.map(r => r.residual)),
    residual_regulation: summarise(reg.map(r => r.residual)),
    residual_overtime: summarise(ot.map(r => r.residual)),
    verdict: scored.length === 0
      ? 'UNMEASURED — no finished game was scored, so the check neither closed nor failed'
      : closes === scored.length
        ? `CLOSES on all ${scored.length} games within 0.01.`
        : `DOES NOT CLOSE on ${scored.length - closes} of ${scored.length} games at tolerance 0.01. STOP per the document and report the residual.`,
    rows,
    coverage: `${scored.length} finished games across ${dates.length} dates. Not a season.`,
  }

  mkdirSync('outbox', { recursive: true })
  const ts = started.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  writeFileSync(`outbox/nhl-wpa-conservation-${ts}.json`, JSON.stringify(out, null, 2))
  writeFileSync('outbox/nhl-wpa-conservation-latest.json', JSON.stringify(out, null, 2))
  console.log(`wrote outbox/nhl-wpa-conservation-${ts}.json`)
  console.log(`callsMade ${calls.n} of ${CALL_BUDGET}`)
  console.log(out.verdict)
  console.log(`telescoping holds on every game: ${out.telescoping_holds_on_every_game}`)
  console.log(`residual all      : ${JSON.stringify(out.residual_all)}`)
  console.log(`residual regulation: ${JSON.stringify(out.residual_regulation)}`)
  console.log(`residual overtime  : ${JSON.stringify(out.residual_overtime)}`)
  console.log(out.coverage)
}

const _e = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
const _isEntry = _e !== null && import.meta.url === _e
const selfTest = () => {
  let pass = 0, fail = 0
  const t = (n, c) => { if (c) { pass++; console.log(`PASS  ${n}`) } else { fail++; console.log(`FAIL  ${n}`) } }
  t('no residuals yields UNMEASURED rather than a distribution of zero',
    summarise([]).n === 0 && /UNMEASURED/.test(summarise([]).note))
  t('the distribution reports the MEDIAN ABSOLUTE residual, so signs cannot cancel',
    (() => { const s = summarise([-0.3, 0.3, -0.3, 0.3]); return s.median_ABS === 0.3 && Math.abs(s.mean) < 1e-9 })())
  t('within_0_01 counts the games that actually close',
    summarise([0.005, 0.5, -0.004]).within_0_01 === 2)
  t('a non-finite residual is excluded rather than counted as zero',
    summarise([0.1, null, undefined, NaN]).n === 1)
  console.log(`\n${pass}/${pass + fail} checks passed`)
  if (fail) process.exit(1)
}
if (_isEntry) {
  if (process.argv.includes('--self-test')) selfTest()
  else main().catch(e => { console.error(String(e && e.stack || e)); process.exit(1) })
}
