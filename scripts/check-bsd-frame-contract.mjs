#!/usr/bin/env node
// docs/CC-CMD-2026-10-16-bsd-list-and-contract.md, DEFECT 2 — the guard.
//
// /bsd/contract declared incidents[].sequence[].pos as target-goal-relative,
// perTeam: true, and cited ONE goal as its evidence: the 73' goal in 223324,
// an AWAY goal. For the away side the two candidate frames are numerically
// identical — a shared pitch puts the away shooter and the keeper he faces
// near x = 0, and a per-team target-goal frame puts them near x = 0 by
// definition. Only a HOME goal separates them (~88 shared, ~12 per-team). The
// declaration was asserted from a sample structurally incapable of testing it.
//
// So this re-measures every frame the contract declares against R2 captures,
// split by side, and has THREE outcomes, not two:
//
//   agree         every declared frame matches what the captures show
//   DISAGREE      a declaration and the measurement differ; both are named
//   INSUFFICIENT  a side has too few records to discriminate. This is NOT a
//                 pass. A pass from an away-only sample is the original defect
//                 reproduced, so insufficient evidence fails, with its own
//                 exit code and its own words.
//
// Own goals are excluded from the pitch measurements: `is_home` marks the
// CREDITED team while the sequence records the ATTACKING move, and on an own
// goal those are opposite sides — a frame discontinuity, not noise.
//
// The declaration is read from src/index.js (the source), the captures from
// the relay's /bsd/r2/* routes (the sandbox cannot reach the relay; this runs
// on a runner). `--contract=live` reads the deployed /bsd/contract instead.

import { readFileSync } from 'node:fs'

export const RELAY = process.env.RELAY_URL || 'https://field-relay-nba.jeffunglesbee.workers.dev'
export const MIN_PER_SIDE = 3      // fewer records on a side than this cannot discriminate
export const SIDE_AGREE = 0.95     // share of a side's records that must sit in one half
export const SHELL_BYTES = 1000    // a stats.json this small carries an empty shotmap
const READ_CAP = 2500
const CONCURRENCY = 8

const EXIT = { agree: 0, disagree: 1, insufficient: 3 }

// ── the frame vocabulary ───────────────────────────────────────────────────
// A pitch frame is fixed by where x = 0 sits for each side. `anchor` is which
// goal the measured point sits beside: a shooter beside the goal it ATTACKS,
// a keeper beside the goal it DEFENDS.
export const PITCH_FRAMES = {
  'target-goal-relative': { perTeam: true },   // x = 0 at the goal this team attacks
  'own-goal-relative':    { perTeam: true },   // x = 0 at the goal this team defends
  'shared-pitch':         { perTeam: false },  // one pitch; home attacks toward x = 100
  'shared-pitch-reversed':{ perTeam: false },  // one pitch; home attacks toward x = 0
}

/** Which half a side's points sit in: 'low', 'high', 'mixed', or null when the
 *  side has too few points to say (insufficient, never a guess). */
export function halfOf(xs) {
  const n = xs.length
  if (n < MIN_PER_SIDE) return { half: null, n, high: xs.filter(x => x >= 50).length }
  const high = xs.filter(x => x >= 50).length
  const half = high / n >= SIDE_AGREE ? 'high' : (n - high) / n >= SIDE_AGREE ? 'low' : 'mixed'
  return { half, n, high }
}

/** The frame implied by each side's half, given which goal the point sits by. */
export function inferPitchFrame(home, away, anchor) {
  if (home.half === null || away.half === null) return null
  if (home.half === 'mixed' || away.half === 'mixed') return 'mixed'
  // Normalise to "near the goal attacked": a keeper low is near the goal it defends.
  const att = (h) => anchor === 'attacked' ? h : (h === 'low' ? 'high' : 'low')
  const h = att(home.half), a = att(away.half)
  if (h === 'low' && a === 'low') return 'target-goal-relative'
  if (h === 'high' && a === 'high') return 'own-goal-relative'
  if (h === 'high' && a === 'low') return 'shared-pitch'
  return 'shared-pitch-reversed'
}

// ── extraction from captures ───────────────────────────────────────────────
const num = (v) => typeof v === 'number' && Number.isFinite(v)
export const isOwnGoal = (inc) => /own/i.test(String(inc?.goal_type ?? ''))
const isOwnShot = (s) => /own/i.test(String(s?.gtype ?? ''))

/** One capture's contribution to every measurement. */
export function extract({ stats, incidents, avg }) {
  const out = { seqPos: { home: [], away: [] }, seqGk: { home: [], away: [] }, shotPos: { home: [], away: [] },
    keeper: { home: [], away: [] }, shotGmX: { home: [], away: [] }, incGm: { home: [], away: [] },
    incGmPairs: { home: [], away: [] }, ownGoalsExcluded: 0 }
  const shots = Array.isArray(stats?.shotmap) ? stats.shotmap : []
  for (const s of shots) {
    const side = s?.home === true ? 'home' : s?.home === false ? 'away' : null
    if (!side || isOwnShot(s)) continue
    if (num(s?.pos?.x)) out.shotPos[side].push(s.pos.x)
    if (num(s?.gm?.x)) out.shotGmX[side].push(s.gm.x)
  }
  for (const inc of incidents?.incidents ?? []) {
    if (inc?.type !== 'goal') continue
    const side = inc.is_home === true ? 'home' : inc.is_home === false ? 'away' : null
    if (!side) continue
    if (isOwnGoal(inc)) { out.ownGoalsExcluded++; continue }
    const g = Array.isArray(inc.sequence) ? inc.sequence.find(e => e?.event === 'goal') : null
    if (!g) continue
    if (num(g?.pos?.x)) out.seqPos[side].push(g.pos.x)
    if (num(g?.gk?.x)) out.seqGk[side].push(g.gk.x)
    if (num(g?.gm?.x) && num(g?.gm?.y)) {
      out.incGm[side].push({ x: g.gm.x, y: g.gm.y })
      // The same goal in the shotmap: same scorer, same minute, type goal.
      const twin = shots.find(s => s?.type === 'goal' && s?.player_id === inc.player_id && s?.min === inc.minute && num(s?.gm?.z))
      if (twin) out.incGmPairs[side].push({ z: twin.gm.z, y: g.gm.y })
    }
  }
  for (const side of ['home', 'away']) {
    const gk = (avg?.[side] ?? []).find(p => String(p?.pos ?? '').toUpperCase() === 'G')
    if (num(gk?.x)) out.keeper[side].push(gk.x)
  }
  return out
}

export function merge(parts) {
  const m = extract({})
  for (const p of parts) {
    for (const k of Object.keys(m)) {
      if (k === 'ownGoalsExcluded') { m[k] += p[k]; continue }
      for (const s of ['home', 'away']) m[k][s].push(...p[k][s])
    }
  }
  return m
}

// ── the measurements, one per declarable frame kind ───────────────────────
/** Pitch-frame measurement over a { home: [x], away: [x] } split. */
export function measurePitch(split, anchor) {
  const home = halfOf(split.home), away = halfOf(split.away)
  const frame = inferPitchFrame(home, away, anchor)
  const counts = `home ${home.high}/${home.n} at x>=50, away ${away.high}/${away.n} at x>=50`
  if (frame === null) {
    const short = [home.n < MIN_PER_SIDE && `home ${home.n}`, away.n < MIN_PER_SIDE && `away ${away.n}`].filter(Boolean).join(', ')
    return { insufficient: `fewer than ${MIN_PER_SIDE} records on a side (${short}); a one-sided sample cannot test perTeam`, counts }
  }
  if (frame === 'mixed') return { frame: 'mixed', perTeam: null, counts }
  return { frame, perTeam: PITCH_FRAMES[frame].perTeam, counts }
}

/** shotmap[].gm — goal-plane: gm.x is 0 on every shot, both sides. */
export function measureGoalPlane(split) {
  const short = ['home', 'away'].filter(s => split[s].length < MIN_PER_SIDE)
  const counts = `gm.x == 0 on home ${split.home.filter(x => x === 0).length}/${split.home.length}, away ${split.away.filter(x => x === 0).length}/${split.away.length}`
  if (short.length) return { insufficient: `fewer than ${MIN_PER_SIDE} shots on ${short.join(', ')}`, counts }
  const ok = [...split.home, ...split.away].every(x => x === 0)
  return { frame: ok ? 'goal-plane' : 'not-goal-plane', perTeam: false, counts }
}

/** incidents[] goal .gm — goal-mouth-2d, y DOWNWARD: across matched goals, a
 *  higher shot (shotmap gm.z) reads a LOWER incident gm.y. Counted as pairs of
 *  goals ordered the same way (concordant) or opposite (discordant). x must
 *  vary — a constant 0 would be the goal plane, not the mouth. */
export function measureGoalMouth(gms, pairs) {
  const res = {}
  for (const side of ['home', 'away']) {
    const p = pairs[side]; let con = 0, dis = 0
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
      const dz = p[i].z - p[j].z, dy = p[i].y - p[j].y
      if (dz === 0 || dy === 0) continue
      if (Math.sign(dz) === Math.sign(dy)) con++; else dis++
    }
    res[side] = { n: p.length, con, dis }
  }
  const xs = [...gms.home, ...gms.away].map(g => g.x)
  const counts = `matched goals home ${res.home.n} (discordant ${res.home.dis}/${res.home.con + res.home.dis}), away ${res.away.n} (discordant ${res.away.dis}/${res.away.con + res.away.dis}); distinct gm.x ${new Set(xs).size}`
  const short = ['home', 'away'].filter(s => res[s].n < MIN_PER_SIDE)
  if (short.length) return { insufficient: `fewer than ${MIN_PER_SIDE} goals matched to the shotmap on ${short.join(', ')}`, counts }
  const down = (r) => r.dis / Math.max(1, r.con + r.dis) >= 0.8
  const up = (r) => r.con / Math.max(1, r.con + r.dis) >= 0.8
  const varies = new Set(xs).size > 1
  const frame = !varies ? 'not-goal-mouth (gm.x constant)'
    : down(res.home) && down(res.away) ? 'goal-mouth-2d'
    : up(res.home) && up(res.away) ? 'goal-mouth-2d-y-upward' : 'goal-mouth-mixed'
  return { frame, perTeam: false, counts }
}

/** Which measurement answers which declared payload path. A declared path
 *  with no measurement here FAILS: a declaration nothing measures is how the
 *  original one went unchallenged. */
export const MEASURES = {
  'average_positions[]':        (m) => measurePitch(m.keeper, 'defended'),
  'shotmap[].pos':              (m) => measurePitch(m.shotPos, 'attacked'),
  'incidents[].sequence[].pos': (m) => measurePitch(m.seqPos, 'attacked'),
  'shotmap[].gm':               (m) => measureGoalPlane(m.shotGmX),
  'incidents[] goal .gm':       (m) => measureGoalMouth(m.incGm, m.incGmPairs),
}

/** Every declared frame against its measurement. */
export function judge(frames, m) {
  const rows = []
  for (const [path, decl] of Object.entries(frames ?? {})) {
    const fn = MEASURES[path]
    if (!fn) { rows.push({ path, outcome: 'disagree', declared: decl, why: 'no measurement exists for this declared path' }); continue }
    const r = fn(m)
    if (r.insufficient) { rows.push({ path, outcome: 'insufficient', declared: decl, why: r.insufficient, counts: r.counts }); continue }
    const ok = r.frame === decl?.frame && r.perTeam === decl?.perTeam
    rows.push({ path, outcome: ok ? 'agree' : 'disagree', declared: decl, measured: { frame: r.frame, perTeam: r.perTeam }, counts: r.counts })
  }
  for (const path of Object.keys(MEASURES)) if (!(path in (frames ?? {})))
    rows.push({ path, outcome: 'disagree', why: 'measured path is no longer declared by the contract' })
  const outcome = rows.some(r => r.outcome === 'disagree') ? 'disagree' : rows.some(r => r.outcome === 'insufficient') ? 'insufficient' : 'agree'
  return { outcome, rows }
}

/** The mutation: flip one declared frame to a wrong-but-plausible one. */
export function flip(decl) {
  const swap = { 'target-goal-relative': 'shared-pitch', 'shared-pitch': 'target-goal-relative',
    'own-goal-relative': 'target-goal-relative', 'shared-pitch-reversed': 'shared-pitch',
    'goal-plane': 'goal-mouth-2d', 'goal-mouth-2d': 'goal-plane' }
  const frame = swap[decl?.frame] ?? 'target-goal-relative'
  return { ...decl, frame, perTeam: PITCH_FRAMES[frame]?.perTeam ?? false }
}

// ── reading the declaration ────────────────────────────────────────────────
/** The `frames: { ... }` object inside the /bsd/contract handler, evaluated.
 *  It is a literal of strings, numbers and booleans; anything else throws. */
export function framesFromSource(src) {
  const at = src.indexOf("pathname === '/bsd/contract'")
  if (at < 0) throw new Error("no /bsd/contract handler in src/index.js")
  const start = src.indexOf('frames: {', at)
  if (start < 0) throw new Error('no frames: { in the /bsd/contract handler')
  let i = src.indexOf('{', start), depth = 0, q = null
  const from = i
  for (; i < src.length; i++) {
    const c = src[i]
    if (q) { if (c === '\\') { i++; continue } if (c === q) q = null; continue }
    if (c === "'" || c === '"' || c === '`') { q = c; continue }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) break
  }
  return Function(`"use strict"; return (${src.slice(from, i + 1)})`)()
}

// ── live ───────────────────────────────────────────────────────────────────
async function getJson(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } })
      if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 1000 * 2 ** i)); continue }
      if (!r.ok) return { status: r.status, json: null }
      return { status: r.status, json: await r.json() }
    } catch (e) { if (i === 2) return { status: 0, json: null, error: String(e).slice(0, 120) } }
  }
  return { status: 429, json: null }
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const k = next++; out[k] = await fn(items[k]) } }))
  return out
}

/** Every key under bsd/, by cursor. A truncated page without a cursor is a
 *  dead end, and a census that hits one is not called complete. */
export async function listAll(get, prefix = 'bsd/') {
  const keys = []; let cursor = null, pages = 0
  for (;;) {
    const q = `prefix=${encodeURIComponent(prefix)}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const r = await get(`${RELAY}/bsd/r2/list?${q}`); pages++
    if (!Array.isArray(r.json?.keys)) throw new Error(`list page ${pages} failed: HTTP ${r.status}`)
    if (r.json.prefix !== prefix) throw new Error(`list answered prefix ${JSON.stringify(r.json.prefix)} for a request of ${JSON.stringify(prefix)}`)
    keys.push(...r.json.keys)
    if (!r.json.truncated) return { keys, pages }
    if (!r.json.cursor) throw new Error(`page ${pages} is truncated and carries no cursor; the census cannot continue`)
    cursor = r.json.cursor
  }
}

async function live(contractSource) {
  const frames = contractSource === 'live'
    ? (await getJson(`${RELAY}/bsd/contract`)).json?.frames
    : framesFromSource(readFileSync('src/index.js', 'utf8'))
  if (!frames) { console.log('FAIL: could not read the contract frames'); return EXIT.disagree }

  const { keys, pages } = await listAll(getJson)
  const events = new Map()
  for (const k of keys) {
    const m = /^bsd\/([^/]+)\/(\d+)\/([a-z-]+\.json)$/.exec(k.key)
    if (!m) continue
    const e = events.get(`${m[1]}/${m[2]}`) ?? { comp: m[1], id: m[2], files: {} }
    e.files[m[3]] = k.size; events.set(`${m[1]}/${m[2]}`, e)
  }
  const usable = [...events.values()].filter(e => (e.files['stats.json'] ?? 0) >= SHELL_BYTES || (e.files['average-positions.json'] ?? 0) > 2)
  let reads = 0, failed = 0, capped = false
  const read = async (key) => {
    if (reads >= READ_CAP) { capped = true; return null }
    reads++
    const r = await getJson(`${RELAY}/bsd/r2/read?key=${encodeURIComponent(key)}`)
    if (!r.json) failed++
    return r.json
  }
  const parts = await pool(usable, CONCURRENCY, async (e) => {
    const base = `bsd/${e.comp}/${e.id}/`
    const stats = (e.files['stats.json'] ?? 0) >= SHELL_BYTES ? await read(base + 'stats.json') : null
    const incidents = e.files['incidents.json'] && stats ? await read(base + 'incidents.json') : null
    const avg = (e.files['average-positions.json'] ?? 0) > 2 ? await read(base + 'average-positions.json') : null
    return extract({ stats, incidents, avg })
  })
  const m = merge(parts)

  console.log(`=== BSD frame contract  declaration=${contractSource === 'live' ? `${RELAY}/bsd/contract` : 'src/index.js'}  captures=${RELAY}/bsd/r2/*`)
  console.log(`COVERAGE: ${keys.length} keys in ${pages} list page(s); ${events.size} events, ${usable.length} non-shell read; ${reads} reads, ${failed} failed${capped ? `, CAPPED at ${READ_CAP}` : ''}; ${m.ownGoalsExcluded} own goals excluded`)
  const verdict = judge(frames, m)
  for (const r of verdict.rows) {
    const d = r.declared ? `${r.declared.frame} perTeam ${r.declared.perTeam}` : '(not declared)'
    const got = r.measured ? `${r.measured.frame} perTeam ${r.measured.perTeam}` : r.why
    console.log(`${r.outcome.toUpperCase().padEnd(12)} ${r.path}\n             declared ${d}\n             measured ${got}${r.counts ? `\n             ${r.counts}` : ''}`)
  }

  // Rule 90: each pitch declaration flipped must be CAUGHT, and must have been APPLIED.
  let mutFail = 0
  for (const path of Object.keys(frames)) {
    const mutated = { ...frames, [path]: flip(frames[path]) }
    const applied = mutated[path].frame !== frames[path].frame
    const row = judge(mutated, m).rows.find(r => r.path === path)
    const caught = row?.outcome !== 'agree'
    if (!applied || !caught) mutFail++
    console.log(`mutation ${path}: ${frames[path].frame} -> ${mutated[path].frame}  applied ${applied}  caught ${caught} (${row?.outcome})`)
  }
  if (failed || capped) { console.log(`INSUFFICIENT: ${failed} read(s) failed${capped ? ', reads capped' : ''}; the sample is not the census it claims`); return EXIT.insufficient }
  if (mutFail) { console.log(`FAIL: ${mutFail} mutation(s) not applied or not caught; these assertions prove nothing`); return EXIT.disagree }
  console.log(verdict.outcome === 'agree' ? 'PASS: every declared frame agrees with the captures'
    : verdict.outcome === 'insufficient' ? 'INSUFFICIENT EVIDENCE: a side cannot discriminate. This is not agreement.'
    : 'FAIL: a declared frame disagrees with the captures')
  return EXIT[verdict.outcome]
}

// ── self-test ──────────────────────────────────────────────────────────────
function selfTest() {
  let failed = 0
  const ok = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failed++ }
  // A shared-pitch world: home attacks 100, away attacks 0. Shotmap pos is
  // target-goal-relative (distance from the goal attacked), keepers own-goal.
  const goal = (home, x, gkx, extra = {}) => ({ type: 'goal', is_home: home, player_id: extra.pid ?? 1, minute: extra.min ?? 10, goal_type: extra.own ? 'ownGoal' : 'regular',
    sequence: [{ event: 'pass', pos: { x: x - 5, y: 50 } }, { event: 'goal', pos: { x, y: 50 }, gk: { x: gkx, y: 50 }, gm: { x: extra.gmx ?? 40, y: extra.gmy ?? 60 } }] })
  const shot = (home, x, extra = {}) => ({ home, pos: { x, y: 50, z: 0 }, gm: { x: 0, y: 50, z: extra.z ?? 10 }, type: extra.type ?? 'miss', player_id: extra.pid, min: extra.min })
  const capture = (homeGoals, awayGoals) => {
    const g = [], s = []
    homeGoals.forEach((x, i) => { g.push(goal(true, x, 98, { pid: 100 + i, min: 10 + i, gmy: 80 - i * 10, gmx: 30 + i })); s.push(shot(true, 100 - x, { type: 'goal', pid: 100 + i, min: 10 + i, z: 10 + i * 10 })) })
    awayGoals.forEach((x, i) => { g.push(goal(false, x, 2, { pid: 200 + i, min: 50 + i, gmy: 80 - i * 10, gmx: 60 + i })); s.push(shot(false, x, { type: 'goal', pid: 200 + i, min: 50 + i, z: 10 + i * 10 })) })
    return { stats: { shotmap: s }, incidents: { incidents: g },
      avg: { home: [{ pos: 'G', x: 10 }], away: [{ pos: 'G', x: 11 }] } }
  }
  const world = merge([capture([88, 92, 79], [7, 12, 4]), capture([96], [9]), capture([85], [3])].map(extract))
  const truth = {
    'average_positions[]':        { frame: 'own-goal-relative', perTeam: true },
    'shotmap[].pos':              { frame: 'target-goal-relative', perTeam: true },
    'incidents[].sequence[].pos': { frame: 'shared-pitch', perTeam: false },
    'shotmap[].gm':               { frame: 'goal-plane', perTeam: false },
    'incidents[] goal .gm':       { frame: 'goal-mouth-2d', perTeam: false },
  }
  ok('direction 1: a correct declaration AGREES', judge(truth, world).outcome === 'agree')
  const wrong = { ...truth, 'incidents[].sequence[].pos': { frame: 'target-goal-relative', perTeam: true } }
  const w = judge(wrong, world)
  ok('direction 2: the 2026-10-10 declaration DISAGREES', w.outcome === 'disagree')
  ok('...and names both the declaration and the measurement',
    w.rows.find(r => r.path === 'incidents[].sequence[].pos')?.measured?.frame === 'shared-pitch')
  ok('the right frame name with the wrong perTeam disagrees',
    judge({ ...truth, 'incidents[].sequence[].pos': { frame: 'shared-pitch', perTeam: true } }, world).outcome === 'disagree')
  ok('a per-team world reads target-goal-relative from the sequence',
    measurePitch({ home: [12, 8, 20], away: [7, 12, 4] }, 'attacked').frame === 'target-goal-relative')

  // THE ORIGINAL DEFECT: an away-only sample. Both frames predict the same
  // numbers, so neither declaration may pass on it.
  const awayOnly = merge([{ ...extract({ incidents: { incidents: [goal(false, 7.3, 5.4)] } }) }, extract({ incidents: { incidents: [goal(false, 9, 3), goal(false, 4, 2)] } })])
  const m1 = measurePitch(awayOnly.seqPos, 'attacked')
  ok('an away-only sample is INSUFFICIENT, not agreement', !!m1.insufficient)
  ok('...under the wrong declaration', judge({ 'incidents[].sequence[].pos': wrong['incidents[].sequence[].pos'] }, awayOnly).rows[0].outcome === 'insufficient')
  ok('...and under the right one', judge({ 'incidents[].sequence[].pos': truth['incidents[].sequence[].pos'] }, awayOnly).rows[0].outcome === 'insufficient')
  ok('two home goals are still too few', !!measurePitch({ home: [88, 90], away: [5, 6, 7] }, 'attacked').insufficient)
  ok('insufficient has its own exit code, distinct from pass and fail', EXIT.insufficient !== EXIT.agree && EXIT.insufficient !== EXIT.disagree)

  // Own goals: the credited side is not the attacking side.
  const og = extract({ incidents: { incidents: [goal(false, 95, 99, { own: true })] } })
  ok('an own goal is excluded and counted', og.seqPos.away.length === 0 && og.ownGoalsExcluded === 1)
  ok('a half with no 95% majority is mixed, not a frame', halfOf([10, 90, 20, 80]).half === 'mixed')
  ok('a mixed side disagrees with any declaration',
    judge({ 'incidents[].sequence[].pos': truth['incidents[].sequence[].pos'] }, { ...world, seqPos: { home: [10, 90, 20, 80], away: [5, 6, 7] } }).rows[0].outcome === 'disagree')
  ok('a nonzero shotmap gm.x is not the goal plane', measureGoalPlane({ home: [0, 0, 3], away: [0, 0, 0] }).frame !== 'goal-plane')
  ok('an upward incident gm.y is not goal-mouth-2d',
    measureGoalMouth({ home: [{ x: 1 }, { x: 2 }], away: [] }, { home: [{ z: 1, y: 1 }, { z: 2, y: 2 }, { z: 3, y: 3 }], away: [{ z: 1, y: 1 }, { z: 2, y: 2 }, { z: 3, y: 3 }] }).frame !== 'goal-mouth-2d')
  ok('a declared path with no measurement fails', judge({ ...truth, 'mystery[].pos': { frame: 'x' } }, world).outcome === 'disagree')
  ok('a measured path the contract stops declaring fails', judge({ 'shotmap[].pos': truth['shotmap[].pos'] }, world).outcome === 'disagree')

  // MUTATION: flip each declared frame; every flip applied and caught.
  for (const path of Object.keys(truth)) {
    const mut = { ...truth, [path]: flip(truth[path]) }
    ok(`mutation ${path} applied and caught`, mut[path].frame !== truth[path].frame && judge(mut, world).rows.find(r => r.path === path).outcome === 'disagree')
  }
  // The declaration actually in the source, run through the same world.
  try {
    const src = framesFromSource(readFileSync('src/index.js', 'utf8'))
    ok('the source declaration parses, with every measured path', Object.keys(MEASURES).every(p => p in src))
  } catch (e) { ok(`the source declaration parses (${String(e).slice(0, 80)})`, false) }

  // listAll: a truncated page without a cursor is a dead end, said so.
  // Each page after the first is served only to a request carrying the cursor
  // the previous page returned, so a census that drops the cursor cannot page.
  const pager = (pages) => { let i = 0; return async (url) => {
    if (i > 0 && !url.includes(`cursor=${encodeURIComponent(pages[i - 1].cursor)}`)) return { status: 200, json: pages[0] }
    return { status: 200, json: pages[i++] } } }
  return listAll(pager([{ prefix: 'bsd/', keys: [{ key: 'a' }], truncated: true, cursor: 'c1' }, { prefix: 'bsd/', keys: [{ key: 'b' }], truncated: false, cursor: null }]))
    .then(r => ok('the census follows the cursor', r.keys.length === 2 && r.pages === 2))
    .then(() => listAll(pager([{ prefix: 'bsd/', keys: [{ key: 'a' }], truncated: true }])).then(() => false, (e) => /no cursor/.test(e.message)))
    .then(threw => ok('a truncated page with no cursor stops the census', threw))
    .then(() => listAll(pager([{ prefix: 'bsd/wc26/', keys: [{ key: 'a' }], truncated: false }])).then(() => false, () => true))
    .then(threw => ok('a page answered from another prefix stops the census', threw))
    .then(() => { console.log(failed ? `self-test: ${failed} FAILED` : 'self-test: all passed'); return failed ? 1 : 0 })
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const contract = (process.argv.find(a => a.startsWith('--contract=')) ?? '--contract=source').split('=')[1]
  const run = process.argv.includes('--self-test') ? selfTest() : live(contract)
  run.then(code => process.exit(code), e => { console.log(`FAIL: ${String(e?.message ?? e)}`); process.exit(EXIT.insufficient) })
}
