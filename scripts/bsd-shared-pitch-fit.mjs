#!/usr/bin/env node
// Which transform puts a shotmap `pos` on the SHARED pitch the ball is drawn on?
//
// docs/CC-CMD-2026-10-28-bsd-pitch-renderer-fields.md, Task 2. The client draws a
// ball (livedata `coordinates`, one shared pitch, home defends x = 0) and shots
// (shotmap `pos`, target-goal-relative per team). To draw them together a shot has
// to be placed in the ball's frame, and /bsd/contract's `mirrorAway` does not do
// that: it leaves HOME raw, which makes home attack x = 0, while the ball frame
// has home attacking x = 100 (livedata: home goal at x 93, home goal kick at
// x 5; contract `incidentSequence.frames`: "home attacks x = 100").
//
// The measurement is an EXACT JOIN, not a fit by eye. A goal appears twice in the
// feed: in /incidents, as `sequence[].pos` of the `goal` step (shared pitch), and
// in /shotmap, as `pos` of the `type: goal` record (target-goal-relative). The
// same shot, the same player, the same minute. If the relation is a fixed
// transform the two agree to the vendor's one-decimal rounding, per side:
//
//     home  shared = (100 - x, 100 - y)      away  shared = (x, y)
//
// Hand-checked 2026-10-29 on 7 goals before this script existed (602352 min 53,
// 88; 602347 min 6, 75, 90 home; min 8, 43 away; 223324 min 73 away).
//
// Why goals only: they are the shot a pair of feeds both describe by an id. The
// livedata frame near a shot was tried first and is NOT a usable reference: its
// point is the ball at the moment the frame was cut, not the shot origin (602347
// 34:11, a "home shot" carrying x = 8, the previous frame's point repeated).
//
// Modes
//   --self-test   synthetic data only
//   --mutate      Rule 90: break the thing the check exists to catch, require red
//   --check FILE  re-derive the verdict from the pairs stored in an artifact;
//                 exit 0 CONFIRMED, 3 consistent but not CONFIRMED, 1 inconsistent
//   (default)     fetch finished websocket_plus events via the relay, write the
//                 artifact, exit 0 CONFIRMED / 1 CONTRADICTED / 3 INSUFFICIENT
//
// CI, not sandbox: the relay host is 403 at CONNECT from the container.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev'
export const ARTIFACT = 'outbox/bsd-shared-pitch-fit-latest.json'

/** EXACT: the vendor rounds to one decimal on both sides of the join, so one
 *  rounding step plus float error. 122 of 123 pairs on 2026-10-29 sat inside it. */
export const TOL = 0.15
/** AGREE: what the VERDICT tests. Measured 2026-10-29: one pair in 123 differs by
 *  0.5 (event 604443 min 90, away: the incident holds the shot at 9.7,53.6 and the
 *  shotmap holds the preceding cross's end point 10.2,53.4). That is the same shot
 *  carried to a slightly different place, not a different placement: the other three
 *  candidates are tens of units away. The question this script answers is WHICH of
 *  four placements, whose separable pairs sit more than 1 unit apart, so a pair
 *  within 1.0 of the hypothesis placement agrees with it and a pair outside does not.
 *  Reported separately: `exact` (<= TOL) and `agree` (<= AGREE). */
export const AGREE = 1.0
/** Pairs per side whose four candidate placements are all distinguishable. */
export const MIN_SEPARABLE_PER_SIDE = 8

export const TRANSFORMS = {
  identity: (p) => ({ x: p.x, y: p.y }),
  flipX:    (p) => ({ x: 100 - p.x, y: p.y }),
  flipY:    (p) => ({ x: p.x, y: 100 - p.y }),
  rotate:   (p) => ({ x: 100 - p.x, y: 100 - p.y }),
}
/** What the join must show, per side. This is the claim under test. */
export const HYPOTHESIS = { home: 'rotate', away: 'identity' }

const num = (v) => typeof v === 'number' && Number.isFinite(v)
const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

/** Pair every goal incident with its shotmap record.
 *  Returns pairs plus an account of every goal that did NOT pair, by reason:
 *  Rule 99, an unpaired goal is a different fact from a goal that disagreed. */
export function pairGoals (eventId, shotmap, incidents) {
  const pairs = []
  const unpaired = { no_sequence: 0, own_goal: 0, no_record: 0, ambiguous: 0 }
  let goals = 0
  for (const inc of incidents || []) {
    if (inc?.type !== 'goal') continue
    goals++
    if (inc.goal_type === 'own') { unpaired.own_goal++; continue }
    const step = (inc.sequence || []).find(s => s?.event === 'goal')
    if (!step || !num(step.pos?.x) || !num(step.pos?.y)) { unpaired.no_sequence++; continue }
    const side = inc.is_home === true ? 'home' : 'away'
    const cand = (shotmap || []).filter(s =>
      s?.type === 'goal' && s.player_id === step.pid && (s.home === true) === (side === 'home') &&
      num(s.min) && Math.abs(s.min - inc.minute) <= 1 && num(s.pos?.x) && num(s.pos?.y))
    if (cand.length === 0) { unpaired.no_record++; continue }
    if (cand.length > 1) { unpaired.ambiguous++; continue }
    pairs.push({ event: eventId, minute: inc.minute, side, pid: step.pid,
                 shared: { x: step.pos.x, y: step.pos.y }, rest: { x: cand[0].pos.x, y: cand[0].pos.y } })
  }
  return { pairs, unpaired, goals }
}

/** A pair separates the four transforms when each candidate placement is more
 *  than 1 unit from every other (TOL is 0.15, so a 1-unit gap is not noise). */
export const separable = (rest) => Math.abs(2 * rest.x - 100) > 1 && Math.abs(2 * rest.y - 100) > 1

/** Per side: how many pairs, how many separable, and how many each transform fits. */
export function fitPairs (pairs, hypothesis = HYPOTHESIS) {
  const out = {}
  for (const side of ['home', 'away']) {
    const ps = pairs.filter(p => p.side === side)
    const fits = Object.fromEntries(Object.keys(TRANSFORMS).map(k => [k, 0]))
    const misfits = []
    let sep = 0, exact = 0, widest = 0
    for (const p of ps) {
      const isSep = separable(p.rest)
      if (isSep) sep++
      for (const [k, fn] of Object.entries(TRANSFORMS)) if (dist(fn(p.rest), p.shared) <= TOL) fits[k]++
      const e = dist(TRANSFORMS[hypothesis[side]](p.rest), p.shared)
      if (e <= TOL) exact++
      if (e > widest) widest = e
      if (e > AGREE) misfits.push(p)
    }
    out[side] = { n: ps.length, separable: sep, exact, widest: Math.round(widest * 100) / 100,
                  fits, hypothesis: hypothesis[side], misfits }
  }
  return out
}

/** CONFIRMED needs every pair to AGREE with the hypothesis (<= AGREE) AND enough
 *  separable pairs on each side that agreement means something. Any pair beyond
 *  AGREE is CONTRADICTED, whatever the counts: a transform that is right "mostly"
 *  is not a transform. */
export function verdictOf (fit) {
  if (fit.home.misfits.length || fit.away.misfits.length) return 'CONTRADICTED'
  if (fit.home.separable < MIN_SEPARABLE_PER_SIDE || fit.away.separable < MIN_SEPARABLE_PER_SIDE) return 'INSUFFICIENT'
  return 'CONFIRMED'
}

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)

/** Rule 91: the denominator, where the result is read. */
export function coverageLine (cov, fit, verdict) {
  return `COVERAGE: ${cov.paired} of ${cov.goalIncidents} goal incidents paired across ${cov.events} events ` +
    `(${cov.eventsAvailable} finished websocket_plus events listed on ${cov.dates.join(', ')}); ` +
    `unpaired ${sum(cov.unpaired)} (${Object.entries(cov.unpaired).map(([k, v]) => `${k} ${v}`).join(', ')}); ` +
    `home ${fit.home.n} pairs / ${fit.home.separable} separable / ${fit.home.exact} exact (widest ${fit.home.widest}), ` +
    `away ${fit.away.n} / ${fit.away.separable} / ${fit.away.exact} exact (widest ${fit.away.widest}); ` +
    `fetch errors ${cov.fetchErrors.length}; verdict ${verdict}`
}

// ---------------------------------------------------------------- self-test
const synth = (n, { awayMode = 'identity', homeMode = 'rotate' } = {}) => {
  // Deterministic, off-centre on both axes so every pair separates the four.
  const pairs = []
  for (let i = 0; i < n; i++) {
    for (const side of ['home', 'away']) {
      const rest = { x: 6 + (i * 3.7) % 22, y: 30 + ((i * 11.3 + (side === 'home' ? 0 : 5)) % 40) }
      rest.x = Math.round(rest.x * 10) / 10; rest.y = Math.round(rest.y * 10) / 10
      if (Math.abs(rest.y - 50) <= 2) rest.y += 6
      const mode = side === 'home' ? homeMode : awayMode
      pairs.push({ event: 1000 + i, minute: 10 + i, side, pid: 1, rest, shared: TRANSFORMS[mode](rest) })
    }
  }
  return pairs
}

function selfTest () {
  let failed = 0
  const check = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failed++ }

  const good = synth(12)
  const g = fitPairs(good)
  check('baseline: 12 per side under the hypothesis is CONFIRMED', verdictOf(g) === 'CONFIRMED')
  check('...and every pair is separable (the test has teeth)', g.home.separable === 12 && g.away.separable === 12)
  check('...and exactly one transform fits each side', Object.values(g.home.fits).filter(v => v === 12).length === 1 &&
                                                      Object.values(g.away.fits).filter(v => v === 12).length === 1)

  const refl = fitPairs(synth(12, { awayMode: 'flipY' }))
  check('MUTATION: away drawn with y flipped is CONTRADICTED', verdictOf(refl) === 'CONTRADICTED' && refl.away.misfits.length === 12)
  const contract = fitPairs(synth(12, { homeMode: 'identity', awayMode: 'rotate' }))
  check('MUTATION: the contract mirrorAway placement (home raw, away rotated) is CONTRADICTED',
        verdictOf(contract) === 'CONTRADICTED')
  check('...and fits the home-raw hypothesis, so the two are told apart',
        fitPairs(synth(12, { homeMode: 'identity', awayMode: 'rotate' }), { home: 'identity', away: 'rotate' }).home.misfits.length === 0)
  check('7 pairs are INSUFFICIENT, not CONFIRMED', verdictOf(fitPairs(synth(7))) === 'INSUFFICIENT')
  const bent = synth(12); bent[0].shared = { x: bent[0].shared.x, y: bent[0].shared.y + 5 }
  check('ONE pair off by 5 is CONTRADICTED even with 24 pairs', verdictOf(fitPairs(bent)) === 'CONTRADICTED')
  const half = synth(12); half[0].shared = { x: half[0].shared.x + 0.5, y: half[0].shared.y }
  const hf = fitPairs(half)
  check('one pair off by 0.5 (the measured vendor residual) AGREES but is not exact',
        verdictOf(hf) === 'CONFIRMED' && hf.home.exact === 11 && hf.away.exact === 12 && hf.home.widest === 0.5)
  const edge = synth(12); edge[0].shared = { x: edge[0].shared.x + 1.01, y: edge[0].shared.y }
  check('...and one pair off by 1.01 is past AGREE', verdictOf(fitPairs(edge)) === 'CONTRADICTED')
  const wobble = synth(12); wobble[0].shared = { x: wobble[0].shared.x + 0.1, y: wobble[0].shared.y }
  check('one rounding step (0.1) is NOT a mismatch', verdictOf(fitPairs(wobble)) === 'CONFIRMED')

  // The pairing, on a hand-built event that mirrors the real 602347 shape.
  const shotmap = [
    { type: 'goal', player_id: 7392, home: true,  min: 75, pos: { x: 6.8, y: 53.8 } },
    { type: 'goal', player_id: 5459, home: false, min: 43, pos: { x: 2.7, y: 48.6 } },
    { type: 'miss', player_id: 7392, home: true,  min: 75, pos: { x: 9, y: 9 } },
    { type: 'goal', player_id: 9,    home: true,  min: 20, pos: { x: 1, y: 1 } },
    { type: 'goal', player_id: 9,    home: true,  min: 20, pos: { x: 2, y: 2 } },
    { type: 'goal', player_id: 77,   home: true,  min: 75, pos: { x: 50, y: 50 } },
    { type: 'goal', player_id: 5459, home: false, min: 60, pos: { x: 9, y: 9 } },
  ]
  const incidents = [
    { type: 'goal', minute: 75, is_home: true, goal_type: 'regular',
      sequence: [{ event: 'cross', pid: 1, pos: { x: 99, y: 99 } }, { event: 'goal', pid: 7392, pos: { x: 93.2, y: 46.2 } }] },
    { type: 'goal', minute: 43, is_home: false, goal_type: 'regular', sequence: [{ event: 'goal', pid: 5459, pos: { x: 2.7, y: 48.6 } }] },
    { type: 'goal', minute: 50, is_home: true, goal_type: 'own', sequence: [{ event: 'goal', pid: 3, pos: { x: 1, y: 1 } }] },
    { type: 'goal', minute: 60, is_home: true, goal_type: 'regular' },
    { type: 'goal', minute: 70, is_home: true, goal_type: 'regular', sequence: [{ event: 'goal', pid: 8, pos: { x: 1, y: 1 } }] },
    { type: 'goal', minute: 20, is_home: true, goal_type: 'regular', sequence: [{ event: 'goal', pid: 9, pos: { x: 5, y: 5 } }] },
    { type: 'card', minute: 5 },
  ]
  const r = pairGoals(602347, shotmap, incidents)
  check('pairing: the two real goals pair (a same-minute MISS by the same player is not taken)', r.pairs.length === 2)
  check('...and a same-side same-minute goal by ANOTHER player is not taken (the pid is the key)', r.pairs[0].rest.x === 6.8)
  check('separable: an off-centre pair separates the four placements', separable({ x: 10, y: 52 }) === true)
  check('...a pair on the centre line does not (y = 50 maps flipY onto identity)', separable({ x: 10, y: 50 }) === false)
  check('...nor one 0.4 off it (placements 0.8 apart: under the 1-unit margin, even though above the 0.3 noise floor)', separable({ x: 10, y: 50.4 }) === false)
  check('...home pairs on rotate, away on identity',
        r.pairs[0].side === 'home' && dist(TRANSFORMS.rotate(r.pairs[0].rest), r.pairs[0].shared) <= TOL &&
        r.pairs[1].side === 'away' && dist(TRANSFORMS.identity(r.pairs[1].rest), r.pairs[1].shared) <= TOL)
  check('...an own goal, a missing sequence, a missing record and an ambiguous record are each counted, not paired',
        r.unpaired.own_goal === 1 && r.unpaired.no_sequence === 1 && r.unpaired.no_record === 1 && r.unpaired.ambiguous === 1)
  check('...and the goals add up: paired + unpaired = goal incidents', r.pairs.length + sum(r.unpaired) === r.goals)
  check('a record for the OTHER side with the same player and minute is not taken',
        pairGoals(1, [{ type: 'goal', player_id: 5, home: false, min: 9, pos: { x: 1, y: 2 } }],
                  [{ type: 'goal', minute: 9, is_home: true, sequence: [{ event: 'goal', pid: 5, pos: { x: 3, y: 4 } }] }]).pairs.length === 0)

  console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${failed === 0 ? 'all' : failed + ' failed of'} self-tests`)
  return failed
}

// ---------------------------------------------------------------- mutate
// Rule 90. Each mutation is applied to CONFIRMED data and the harness asserts
// that it CHANGED the data before it reports whether the verdict noticed.
function mutate () {
  const base = synth(12)
  const baseVerdict = verdictOf(fitPairs(base))
  if (baseVerdict !== 'CONFIRMED') { console.log(`BASELINE NOT CONFIRMED (${baseVerdict}) — every mutation would look caught`); return 1 }
  const muts = [
    ['away placed with y flipped', (ps) => ps.map(p => p.side === 'away' ? { ...p, shared: TRANSFORMS.flipY(p.rest) } : p)],
    ['home left raw (the contract mirrorAway placement)', (ps) => ps.map(p => p.side === 'home' ? { ...p, shared: TRANSFORMS.identity(p.rest) } : p)],
    ['one pair nudged by 5', (ps) => ps.map((p, i) => i === 0 ? { ...p, shared: { x: p.shared.x + 5, y: p.shared.y } } : p)],
    ['every away pair removed', (ps) => ps.filter(p => p.side === 'home')],
  ]
  const want = ['CONTRADICTED', 'CONTRADICTED', 'CONTRADICTED', 'INSUFFICIENT']
  let bad = 0
  muts.forEach(([name, fn], i) => {
    const m = fn(base)
    const applied = JSON.stringify(m) !== JSON.stringify(base)
    const v = verdictOf(fitPairs(m))
    console.log(`mutation: ${name}\n    applied: ${applied}   verdict: ${v}   expected: ${want[i]}`)
    if (!applied) { console.log('    MUTATION NOT APPLIED — the harness mutated nothing'); bad++ }
    else if (v !== want[i]) { console.log('    NOT CAUGHT'); bad++ }
  })
  console.log(bad === 0 ? '\nOK — all mutations applied and caught' : `\nFAILED — ${bad} mutation(s) not caught or not applied`)
  return bad === 0 ? 0 : 1
}

// ---------------------------------------------------------------- check
function checkArtifact (file) {
  const a = JSON.parse(readFileSync(file, 'utf8'))
  const fit = fitPairs(a.pairs || [])
  const v = verdictOf(fit)
  console.log(coverageLine(a.coverage, fit, v))
  if (v !== a.verdict) { console.log(`FAIL: artifact says ${a.verdict}, its own pairs say ${v}`); return 1 }
  console.log(`artifact ${file}: verdict ${v} re-derived from ${a.pairs.length} stored pairs`)
  // 1 = the artifact disagrees with its own pairs; 3 = consistent but not CONFIRMED.
  return v === 'CONFIRMED' ? 0 : 3
}

// ---------------------------------------------------------------- run
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function getJson (path) {
  const url = `${RELAY}${path}`
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!r.ok) return { error: `HTTP ${r.status}`, url }
    return { body: await r.json(), url }
  } catch (e) { return { error: String(e?.message || e), url } }
}

async function run (argv) {
  const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt }
  const maxEvents = Number(opt('--max-events', '30'))
  const day = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10)
  const dates = (opt('--dates', '') || `${day(1)},${day(2)},${day(3)}`).split(',').filter(Boolean)
  const cov = { dates, events: 0, eventsAvailable: 0, goalIncidents: 0, paired: 0,
                unpaired: { no_sequence: 0, own_goal: 0, no_record: 0, ambiguous: 0 }, fetchErrors: [] }

  // One request per date, edge-cached 300 s by the relay for a past day; 2 more
  // per event, cached 60 s for a finished event. Capped by --max-events.
  const listed = []
  for (const d of dates) {
    const r = await getJson(`/bsd/events/by-date?date=${d}&limit=50`)
    if (r.error) { cov.fetchErrors.push(`by-date ${d}: ${r.error}`); continue }
    for (const e of r.body?.results || []) if (e.status === 'finished' && e.websocket_plus === true) listed.push(e.id)
    await sleep(250)
  }
  cov.eventsAvailable = listed.length
  const pairs = []
  for (const id of listed.slice(0, maxEvents)) {
    const s = await getJson(`/bsd/events/${id}/shotmap`)
    const i = await getJson(`/bsd/events/${id}/incidents`)
    if (s.error || i.error) { cov.fetchErrors.push(`${id}: ${s.error || ''} ${i.error || ''}`.trim()); continue }
    cov.events++
    const r = pairGoals(id, s.body?.shotmap, i.body?.incidents)
    cov.goalIncidents += r.goals; cov.paired += r.pairs.length
    for (const k of Object.keys(r.unpaired)) cov.unpaired[k] += r.unpaired[k]
    pairs.push(...r.pairs)
    await sleep(250)
  }
  const fit = fitPairs(pairs)
  const verdict = verdictOf(fit)
  console.log(coverageLine(cov, fit, verdict))
  for (const side of ['home', 'away']) {
    console.log(`  ${side}: ${fit[side].n} pairs, ${fit[side].separable} separable; fits ${JSON.stringify(fit[side].fits)}; hypothesis ${fit[side].hypothesis}; misfits ${fit[side].misfits.length}`)
    for (const m of fit[side].misfits.slice(0, 5)) console.log(`    MISFIT event ${m.event} min ${m.minute} pid ${m.pid} shared ${JSON.stringify(m.shared)} rest ${JSON.stringify(m.rest)}`)
  }
  writeFileSync(opt('--out', ARTIFACT), JSON.stringify({
    generated_at: new Date().toISOString(), relay: RELAY, hypothesis: HYPOTHESIS, tolerance: TOL,
    minSeparablePerSide: MIN_SEPARABLE_PER_SIDE, coverage: cov, fit, verdict, pairs,
  }, null, 2) + '\n')
  return verdict === 'CONFIRMED' ? 0 : verdict === 'CONTRADICTED' ? 1 : 3
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) process.exit(selfTest())
  else if (argv.includes('--mutate')) process.exit(mutate())
  else if (argv.includes('--check')) process.exit(checkArtifact(argv[argv.indexOf('--check') + 1]))
  else run(argv).then(c => process.exit(c), e => { console.error(e); process.exit(1) })
}
