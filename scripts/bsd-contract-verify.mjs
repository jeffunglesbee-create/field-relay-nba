#!/usr/bin/env node
// Done conditions 1 and 3 of docs/CC-CMD-2026-10-10-bsd-coordinate-frames.md,
// asserted against the DEPLOYED route rather than the source.
//
// Why live and not a source read: the whole defect being repaired was a
// published contract whose prose contradicted the data. Reading src/index.js
// to confirm src/index.js is the source-versus-copy substitution this repo's
// rules exist to prevent — a correct object in the file proves nothing about
// what the worker serves until it has deployed.
//
// CI because a CONNECT to the relay host is 403-denied in the sandbox.

export const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev'
// 2026-10-16-1: incidents[].sequence[].pos corrected from per-team
// target-goal-relative to ONE shared pitch (docs/CC-CMD-2026-10-16-bsd-list-and-contract.md).
export const WANT_REVISION = '2026-10-16-1'
export const SEQ = 'incidents[].sequence[].pos'
export const MIRROR = 'x = 100 - x; y = 100 - y'
export const SHARED_AWAY = 'x = x; y = y'

/** Every done-condition assertion, as data, so the list is checkable and the
 *  mutation below can target one. */
export const assertions = (c) => [
  ['revision is ' + WANT_REVISION, c?.revision === WANT_REVISION],
  ['status no longer says provisional', typeof c?.status === 'string' && !/provisional/i.test(c.status)],
  ['space is per-team', c?.coordinateSystem?.space === 'normalized-pitch-per-team'],
  ['axes.x says the goal this team DEFENDS', /defends/i.test(c?.coordinateSystem?.axes?.x ?? '')],
  ['axes.x no longer says 0 = home goal-line', !/0 = home goal-line/i.test(c?.coordinateSystem?.axes?.x ?? '')],
  ['the old wording is recorded, not deleted silently',
    /0 = home goal-line/i.test(c?.coordinateSystem?.corrected?.was?.x ?? '')],
  ['the six keepers are quoted as the measurement',
    (c?.coordinateSystem?.corrected?.keepers ?? []).length === 6],
  ['...and none of them is near 90',
    (c?.coordinateSystem?.corrected?.keepers ?? []).every(k => k.x < 20)],
  ['five distinct frames are documented',
    new Set(Object.values(c?.frames ?? {}).map(f => f.frame)).size === 5],
  ['the goal build-up is ONE shared pitch, not per-team',
    c?.frames?.[SEQ]?.frame === 'shared-pitch' && c?.frames?.[SEQ]?.perTeam === false],
  ['the contract says the prior revision was wrong about it',
    c?.supersedes?.revision === '2026-10-10-1' && (c?.supersedes?.wrongAbout ?? []).includes(SEQ)],
  ['an own goal is declared a frame discontinuity', /discontinuity/i.test(c?.frames?.[SEQ]?.ownGoal ?? '')],
  ['the away mirror is NOT for the shared frame',
    (c?.transformReference?.mirrorAwayNotFor ?? []).some(p => p.startsWith(SEQ))],
  ['the two pitch frames have OPPOSITE origins',
    /DEFENDS/i.test(c?.frames?.['average_positions[]']?.xZero ?? '')
    && /ATTACKS/i.test(c?.frames?.['shotmap[].pos']?.xZero ?? '')],
  ['the mirror is marked REQUIRED', c?.transformReference?.mirrorAwayRequired === true],
  ['the mirror formula is byte-identical', c?.transformReference?.mirrorAway === MIRROR],
  ['the deprecated name still carries the same formula',
    c?.transformReference?.mirrorForAwayPerspective === MIRROR],
  ['the shot example is a real record (gm.x is 0, not a bare x of 88.3)',
    c?.frameShapes?.shot?.example?.gm?.x === 0 && c?.frameShapes?.shot?.example?.x === undefined],
  ['the avgPosition example uses the real keys n/name, not player/touches',
    c?.frameShapes?.avgPosition?.example?.n !== undefined
    && c?.frameShapes?.avgPosition?.example?.touches === undefined],
  ['n is documented as a count of unconfirmed definition, not renamed touches',
    /unconfirmed/i.test(c?.frameShapes?.avgPosition?.n ?? '')],
  ['the incidents sequence shape is documented',
    c?.frameShapes?.incidentSequence?.example?.gk !== undefined],
  ['the open item names the availability state, not the axes',
    /X-AvgPos-State/.test(c?.status ?? '')],
  // The WebSocket fan-out payloads, declared from recorded frames (2026-10-28,
  // event 602466) instead of the spec's invented example. docs/CC-CMD-2026-10-28-bsd-ws-fanout-field-names.md.
  ['the bsd:stats example carries the nested time object, not a top-level minute/period',
    c?.frameShapes?.stats?.example?.time?.minute !== undefined
    && c?.frameShapes?.stats?.example?.minute === undefined
    && c?.frameShapes?.stats?.example?.period === undefined],
  ['the bsd:ball example is an incident (side, time, commentary) whose coords are integer x and y and nothing else',
    c?.frameShapes?.livedata?.example?.side !== undefined
    && c?.frameShapes?.livedata?.example?.time?.minute !== undefined
    && typeof c?.frameShapes?.livedata?.example?.commentary === 'string'
    && Object.keys(c?.frameShapes?.livedata?.example?.coords ?? {}).sort().join() === 'x,y'
    && Number.isInteger(c?.frameShapes?.livedata?.example?.coords?.x)
    && Number.isInteger(c?.frameShapes?.livedata?.example?.coords?.y)],
  ['the empty-window case is declared separately, with null coords',
    c?.frameShapes?.livedata?.exampleWithoutCoordinates?.coords === null],
  ['the livedata note says the window is newest first and that coords is its first element',
    /NEWEST FIRST/.test(c?.frameShapes?.livedata?.note ?? '') && /first element/.test(c?.frameShapes?.livedata?.note ?? '')],
  ['the livedata note states the half-time frame of reference and the limit of that evidence',
    /does not flip the frame/.test(c?.frameShapes?.livedata?.note ?? '')
    && /Only one second half has been measured/.test(c?.frameShapes?.livedata?.note ?? '')],
  ['the stats note tells a reader to accept both period types',
    /accept both types/.test(c?.frameShapes?.stats?.note ?? '')],
  // The shot placement on the pitch the ball is drawn on, measured 2026-10-29 by an exact join of goal
  // incidents to shotmap records (outbox/bsd-shared-pitch-fit-latest.json). docs/CC-CMD-2026-10-28-bsd-pitch-renderer-fields.md.
  ['sharedPitch: the HOME side is rotated (home attacks x = 100 on the shared pitch)',
    c?.transformReference?.sharedPitch?.home === MIRROR],
  ['sharedPitch: the AWAY side is left as it is',
    c?.transformReference?.sharedPitch?.away === SHARED_AWAY],
  ['sharedPitch names its orientation and says it is the OTHER one from mirrorAway',
    /home side attacks x = 100/.test(c?.transformReference?.sharedPitch?.for ?? '')
    && /OTHER orientation/.test(c?.transformReference?.sharedPitch?.note ?? '')],
  ['sharedPitch carries the measurement it rests on (>= 100 paired goals)',
    (c?.transformReference?.sharedPitch?.measured?.paired ?? 0) >= 100],
]

function selfTest () {
  let failed = 0
  let total = 0
  const check = (n, c) => { total++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) failed++ }
  const good = {
    revision: WANT_REVISION, status: 'settled. OPEN: see X-AvgPos-State',
    coordinateSystem: {
      space: 'normalized-pitch-per-team',
      axes: { x: 'horizontal, 0 = the goal this team DEFENDS, 100 = the goal it ATTACKS. Per team.' },
      corrected: { was: { x: 'horizontal, 0 = home goal-line, 100 = away goal-line' },
                   keepers: [10.4, 10.6, 9.4, 12.8, 11.5, 9.4].map(x => ({ x })) },
    },
    frames: {
      'average_positions[]': { frame: 'own-goal-relative', xZero: 'the goal this team DEFENDS' },
      'shotmap[].pos': { frame: 'target-goal-relative', xZero: 'the goal this team ATTACKS' },
      [SEQ]: { frame: 'shared-pitch', perTeam: false, ownGoal: 'a FRAME DISCONTINUITY' },
      'shotmap[].gm': { frame: 'goal-plane', xZero: 'always 0' },
      'incidents[] goal .gm': { frame: 'goal-mouth-2d', xZero: 'across the mouth' },
    },
    supersedes: { revision: '2026-10-10-1', wrongAbout: [SEQ] },
    transformReference: { mirrorAway: MIRROR, mirrorAwayRequired: true, mirrorForAwayPerspective: MIRROR,
                          mirrorAwayNotFor: [`${SEQ} — already one shared pitch`],
                          sharedPitch: { for: 'placing shotmap[].pos where the home side attacks x = 100', home: MIRROR, away: SHARED_AWAY,
                                         note: 'mirrorAway above is the OTHER orientation.', measured: { paired: 123 } } },
    frameShapes: {
      shot: { example: { gm: { x: 0 } } },
      avgPosition: { example: { n: 46, name: 'Cleiton' }, n: 'A COUNT, exact definition UNCONFIRMED' },
      incidentSequence: { example: { gk: { x: 5.4 } } },
      stats: { example: { type: 'bsd:stats', id: '1', time: { minute: 47, period: 2 }, score: { home: 0, away: 0 } },
               note: 'A reader must accept both types.' },
      livedata: { example: { type: 'bsd:ball', id: '1', coords: { x: 72, y: 47 }, side: 'away', time: { minute: 45 }, commentary: 'x' },
                  exampleWithoutCoordinates: { type: 'bsd:ball', id: '2', coords: null },
                  note: 'a SLIDING WINDOW, NEWEST FIRST; coords is its first element or null. BSD does not flip the frame at half time. Only one second half has been measured.' },
    },
  }
  check('a correct contract passes every assertion', assertions(good).every(([, ok]) => ok))

  // Rule 90: each mutation must be APPLIED and CAUGHT.
  const mutations = [
    ['stale revision', c => { c.revision = '2026-06-25-1' }],
    ['provisional left in status', c => { c.status = 'provisional — pending verification' }],
    ['old shared-axis wording restored', c => { c.coordinateSystem.axes.x = 'horizontal, 0 = home goal-line, 100 = away goal-line' }],
    ['old wording deleted instead of recorded', c => { c.coordinateSystem.corrected.was.x = '' }],
    ['the mirror formula edited', c => { c.transformReference.mirrorAway = 'x = 100 - x' }],
    ['the two pitch frames given the SAME origin', c => { c.frames['shotmap[].pos'].xZero = 'the goal this team DEFENDS' }],
    ['the invented 88.3 shot example put back', c => { c.frameShapes.shot.example = { x: 88.3, y: 51.5 } }],
    ['n renamed touches on the strength of the old example', c => { c.frameShapes.avgPosition.example = { player: 'x', touches: 71 } }],
    ['the goal build-up declared per-team again', c => { c.frames[SEQ] = { ...c.frames[SEQ], frame: 'target-goal-relative', perTeam: true } }],
    ['the record of the wrong revision dropped', c => { delete c.supersedes }],
    ['the invented stats example put back (top-level minute and period)', c => { c.frameShapes.stats.example = { type: 'bsd:stats', id: '1', minute: 67, period: 2 } }],
    ['the invented fractional ball coordinates put back', c => { c.frameShapes.livedata.example.coords = { x: 73.2, y: 42.1 } }],
    ['the ball example coords lose y', c => { c.frameShapes.livedata.example.coords = { x: 72 } }],
    ['the ball example coords gain an invented key', c => { c.frameShapes.livedata.example.coords = { x: 72, y: 47, z: 0 } }],
    ['the ball example reverts to null coordinates', c => { c.frameShapes.livedata.example.coords = null }],
    ['the empty-window example is dropped', c => { delete c.frameShapes.livedata.exampleWithoutCoordinates }],
    ['the incident fields dropped from the ball example', c => { delete c.frameShapes.livedata.example.commentary }],
    ['a hybrid stats example: time AND a top-level minute', c => { c.frameShapes.stats.example.minute = 67 }],
    ['a hybrid stats example: time AND a top-level period', c => { c.frameShapes.stats.example.period = 2 }],
    ['the ball example loses its side', c => { delete c.frameShapes.livedata.example.side }],
    ['the ball example loses its time', c => { delete c.frameShapes.livedata.example.time }],
    ['the ball commentary is not a string', c => { c.frameShapes.livedata.example.commentary = 5 }],
    ['the newest-first statement dropped from the note', c => { c.frameShapes.livedata.note = 'coords is the first element. BSD does not flip the frame at half time. Only one second half has been measured.' }],
    ['the second-half caveat dropped from the note', c => { c.frameShapes.livedata.note = 'a SLIDING WINDOW, NEWEST FIRST; coords is its first element or null. BSD does not flip the frame at half time.' }],
    ['the half-time frame statement dropped from the note', c => { c.frameShapes.livedata.note = 'a SLIDING WINDOW, NEWEST FIRST; coords is its first element or null. Only one second half has been measured.' }],
    ['the stats note emptied (the 2026-10-28 damage, as served)', c => { c.frameShapes.stats.note = ' +      +      + ' }],
    ['sharedPitch: home and away swapped (the contract mirrorAway orientation)', c => { const sp = c.transformReference.sharedPitch; [sp.home, sp.away] = [sp.away, sp.home] }],
    ['sharedPitch: away given a y flip', c => { c.transformReference.sharedPitch.away = 'x = x; y = 100 - y' }],
    ['sharedPitch: home given only an x flip', c => { c.transformReference.sharedPitch.home = 'x = 100 - x; y = y' }],
    ['sharedPitch: dropped', c => { delete c.transformReference.sharedPitch }],
    ['sharedPitch: the orientation sentence lost', c => { c.transformReference.sharedPitch.for = 'placing shotmap[].pos' }],
    ['sharedPitch: the OTHER-orientation warning lost', c => { c.transformReference.sharedPitch.note = 'x' }],
    ['sharedPitch: the measurement shrunk to a hand check', c => { c.transformReference.sharedPitch.measured.paired = 7 }],
  ]
  for (const [name, apply] of mutations) {
    const c = JSON.parse(JSON.stringify(good))
    const before = JSON.stringify(c)
    apply(c)
    const applied = JSON.stringify(c) !== before
    const caught = !assertions(c).every(([, ok]) => ok)
    check(`MUTATION applied and caught: ${name}`, applied && caught)
  }
  // the source-note reader
  const goodSrc = `const BSD_WS_LIVEDATA_NOTE =\n  '${'x'.repeat(300)} INCIDENT NEWEST FIRST; coords is its first element. ' +\n  'ONE shared pitch, BSD does not flip the frame at half time. Only one second half has been measured. Coverage varies by match.';\n\nconst BSD_WS_STATS_NOTE =\n  '${'y'.repeat(340)} A reader must accept both types. shotmap and momentum are null. The key count differs by match.';\n\nexport default {`
  check('the source-note reader passes a well-formed pair of constants', noteProblems(goodSrc).length === 0)
  const damaged = goodSrc.replace(/const BSD_WS_STATS_NOTE =[\s\S]*?;\n/, `const BSD_WS_STATS_NOTE =\n  ' +                                    +                                    +                                    + ' +\n  '+                                    +                                    +';\n`)
  check('MUTATION applied and caught: the 2026-10-28 damage (a note of spaces and plus signs)', damaged !== goodSrc && noteProblems(damaged).length > 0)
  check('MUTATION applied and caught: a constant deleted', noteProblems(goodSrc.replace('const BSD_WS_LIVEDATA_NOTE', 'const SOMETHING_ELSE')).length > 0)
  check('MUTATION applied and caught: the newest-first sentence lost', noteProblems(goodSrc.replace('NEWEST FIRST', 'newest last')).length > 0)
  check('MUTATION applied and caught: the half-time sentence lost', noteProblems(goodSrc.replace('does not flip the frame', 'is unknown')).length > 0)
  check('MUTATION applied and caught: a note too short to be one', noteProblems(goodSrc.replace(/x{300}/, '')).length > 0)
  console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${total - failed}/${total} self-tests`)
  return failed
}

// --- the served notes, checked in the SOURCE (no network, no deploy) ----------
//
// The two WebSocket notes live as module constants in src/index.js. On 2026-10-28 a reflow of them
// replaced both with strings of spaces and plus signs: `node --check` passed (it is valid JS), the
// provenance gate passed (the handler got SHORTER), the synthetic self-test passed (it never reads the
// source), and it deployed. Only the live check below would have said so. This reads the constants
// where they are written and asserts what they say, so that cannot ship again.
export const extractNote = (src, name) => {
  const m = src.match(new RegExp(`const ${name} =\\s*([\\s\\S]*?);\\n`))
  if (!m) throw new Error(`${name} is not defined in the source`)
  return new Function(`return (${m[1]})`)()
}
export const NOTE_RULES = {
  BSD_WS_LIVEDATA_NOTE: [[/NEWEST FIRST/, 'says the window is newest first'], [/first element/, 'says coords is the first element'],
    [/does not flip the frame/, 'states the half-time frame of reference'], [/Only one second half has been measured/, 'states the limit of the second-half evidence'],
    [/Coverage varies by match/, 'states that coverage varies by match'], [/INCIDENT/, 'says a livedata frame is an incident']],
  BSD_WS_STATS_NOTE: [[/accept both types/, 'tells a reader to accept both period types'], [/shotmap and momentum are null/, 'states shotmap and momentum are null'],
    [/differs by match/, 'states the stats key count differs by match']],
}
export const noteProblems = (src) => {
  const out = []
  for (const [name, rules] of Object.entries(NOTE_RULES)) {
    let text
    try { text = extractNote(src, name) } catch (e) { out.push(e.message); continue }
    if (typeof text !== 'string' || text.length < 400) out.push(`${name} is ${typeof text === 'string' ? text.length : typeof text} characters, expected a real note`)
    for (const [re, what] of rules) if (!re.test(String(text))) out.push(`${name} does not match ${re}: it ${what}`)
    if (/\+\s{8,}\+/.test(String(text))) out.push(`${name} contains a run of spaces and plus signs: a broken reflow`)
  }
  return out
}
if (process.argv.includes('--source-notes')) {
  const { readFileSync } = await import('node:fs')
  const fileArg = process.argv.indexOf('--source-file') > -1 ? process.argv[process.argv.indexOf('--source-file') + 1] : null
  const problems = noteProblems(readFileSync(fileArg ?? new URL('../src/index.js', import.meta.url), 'utf8'))
  for (const p of problems) console.log(`FAIL  ${p}`)
  console.log(problems.length === 0 ? `OK: both served WebSocket notes read as written (${Object.keys(NOTE_RULES).length} constants, ${Object.values(NOTE_RULES).flat().length} rules)` : `FAILED: ${problems.length} problem(s)`)
  process.exit(problems.length === 0 ? 0 : 1)
}

if (process.argv.includes('--self-test')) process.exit(selfTest())

const url = `${RELAY}/bsd/contract`
console.log(`=== bsd contract, DEPLOYED  ${url}`)
let contract
try {
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) { console.log(`FAIL: HTTP ${r.status}`); process.exit(1) }
  contract = await r.json()
} catch (e) {
  console.log(`FAIL: ${e.message}`)
  console.log('If this ran in the sandbox, that is the 403 CONNECT denial — run it on a runner.')
  process.exit(1)
}

let failed = 0
for (const [name, ok] of assertions(contract)) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failed++
}
// Done condition 3 — the three availability states must be distinguishable in
// the RESPONSE, not just in the source. 588245 is the measured case: finished,
// websocket_plus false, so it returns {} for a reason that is not "not yet".
// A live event, taken from the live feed, is the in-play case. Both are read
// from headers, because that is where a caller would read them.
console.log('')
const stateOf = async (id) => {
  const r = await fetch(`${RELAY}/bsd/events/${id}/average-positions`, { headers: { Accept: 'application/json' } })
  const body = await r.text()
  let empty = null
  try { const j = JSON.parse(body); empty = j && typeof j === 'object' && Object.keys(j).length === 0 } catch {}
  return { status: r.status, state: r.headers.get('X-AvgPos-State'), empty }
}

const finished = await stateOf('588245')
console.log(`  588245 (finished, websocket_plus false): HTTP ${finished.status} empty=${finished.empty} X-AvgPos-State=${finished.state}`)
const stateChecks = [
  ['an empty finished event names a state, not a bare {}',
    finished.empty !== true || (finished.state !== null && finished.state !== undefined)],
  ['...and that state is NOT in-play', finished.empty !== true || finished.state !== 'in-play'],
]

let liveId = null
try {
  const lr = await fetch(`${RELAY}/bsd/events/live`, { headers: { Accept: 'application/json' } })
  const lj = await lr.json()
  liveId = (lj?.events || [])[0]?.id ?? null
} catch {}
if (liveId) {
  const inplay = await stateOf(liveId)
  console.log(`  ${liveId} (in the live feed)                : HTTP ${inplay.status} empty=${inplay.empty} X-AvgPos-State=${inplay.state}`)
  stateChecks.push(['a live event that is empty reads in-play',
    inplay.empty !== true || inplay.state === 'in-play'])
} else {
  // Rule 99 / Rule 91: no live event is a COVERAGE gap, not a pass.
  console.log('  (no event is live right now — the in-play case is UNCHECKED, not passed)')
}
for (const [n, ok] of stateChecks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if (!ok) failed++ }
console.log(`  state coverage: ${liveId ? 2 : 1} of 2 states exercised${liveId ? '' : ' (no live event available)'}`)

const list = assertions(contract)
console.log(`\nCOVERAGE: ${list.length} assertions over the live /bsd/contract response,`)
console.log(`revision ${contract?.revision}. Source is not consulted — this is the served object.`)
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${list.length - failed}/${list.length}`)
process.exit(failed === 0 ? 0 : 1)
