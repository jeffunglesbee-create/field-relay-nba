#!/usr/bin/env node
// Every staged-item verdict must prove it can fail.
//
// scripts/verify-staged-items.mjs is the executor field-laboratory registers
// its staged items against, and the one this repo's CC-CMDs cite as their done
// condition. Until 2026-08-23 not one of its four verdicts had ever been
// demonstrated to fail: they ran daily, printed PASS or PENDING, and nothing
// established that a genuine regression would make them say otherwise.
//
// That is not hypothetical here. Four probes in this project were found vacuous
// during August, and all four shared exactly one property — never shown to fail:
//
//   an n=2 "CONFIRMED" reaching an outbox;
//   a 5.4-point gap reported on n=16 that reversed at n=95;
//   a brief-contamination predicate that could never observe a cessation;
//   a staged-claim scanner that found zero claims because it matched an
//   invented convention instead of the observed one.
//
// So this asserts, for each verdict, that a KNOWN-BAD payload does not produce
// PASS. A verdict that passes its own negative control is vacuous, and every
// green it has printed was uninformative.
//
// A MISSING mustFailOn IS ITSELF A FAILURE. Optional would make it the field
// nobody fills in, which is how Rule 89's "specify an artifact" became prose.

import { VERDICTS, UEFA_HISTORY_WINDOWS, squiggleContactSet, squiggleContactStateOf, aflapiContactSet, aflapiContactStateOf, vendorWatchPayload, vendorWatchLogFiles, VENDOR_WATCH_REFUSALS, VENDOR_WATCH_JUDGED, cflAbortRepeatPayload, cflAbortArtifactFiles } from './staged-verdicts.mjs'
import { readFileSync as _readFileSync } from 'node:fs'

let pass = 0, fail = 0
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`) }
}

console.log('staged verdicts are falsifiable')

for (const [id, verdict] of Object.entries(VERDICTS)) {
  const has = Object.prototype.hasOwnProperty.call(verdict, 'mustFailOn')
  check(`${id}: declares a negative control`, has,
    'no mustFailOn — this verdict has never been shown to fail, so a PASS proves nothing')
  if (!has) continue
  let out
  try { out = verdict(verdict.mustFailOn) } catch (e) { out = `THREW: ${e.message}` }
  // FAIL, NOT MERELY "NOT PASS".
  //
  // This asserted `!out.startsWith('PASS')`, which PENDING satisfies. So a
  // verdict whose negative control returns PENDING — one that can never fail at
  // all — passed this check cleanly. Caught 2026-09-07 while changing
  // d1_write_provenance: flipping its mustFailOn to a payload that returns
  // PENDING left this checker green, and the mutation went NOT CAUGHT.
  //
  // That is this file's own stated defect, one level up. "A verdict that passes
  // its own negative control is vacuous" is the header; a verdict that
  // ABSTAINS on its own negative control is equally vacuous, and only one of
  // the two was being tested for.
  check(`${id}: FAILS its negative control`,
    typeof out === 'string' && out.startsWith('FAIL'),
    `returned ${JSON.stringify(out)} — a negative control must produce FAIL, not `
    + `PASS and not PENDING. PENDING means this verdict cannot be made to fail at all.`)
}

// A verdict must also be able to say PASS at all. One that can never pass is
// the mirror defect, and it is the one the brief-contamination predicate had:
// permanently red, so nobody could ever act on it.
const CAN_PASS = {
  closing_after_opening: { rows: 8, sequenced: 8 },
  soccer_opening_coverage: {
    measurable: [{ sport: 'EPL', games: 5, pct: 80, baseline_pct: 23.1 }],
    tooFew: [], regressed: [],
    improved: [{ sport: 'EPL', games: 5, pct: 80, baseline_pct: 23.1 }],
    minGames: 4,
  },
  epl_brief_event_grounded: {
    briefRows: 4, postLeakFix: 4, grounded: 4, historicalLeaks: 0, liveNote: '', leaking: [],
  },
  recap_names_a_scoring_play: { recapRows: 6, testable: 6, named: 6 },
  deploy_commit_results: { found: true, deployConclusion: 'success', stepConclusion: 'success', pushed: true, errorLines: 0 },
  thread_notes_cleanup: { total: 40, expiredBeyondGrace: 0 },
  odds_budget_charging: { tablesExist: true, dayRows: 1, charged: 1014, kvUsed: 1014 },
  vendor_watch_window_aligned: { logsSince: 1, judgedLogs: 1, refusal: '', verdictLines: 1, hasWindowLine: true, hasDiagnosticLines: true, hasKnownCi: true, seriesRow: 'found', seriesNumeric: true, seriesSourceD1: true },
  cfl_abort_repeat_loses_nothing: { artifacts: 2, repeats: 1, file: 'cfl-abort-experiment-20261110T120000Z.json', verdict: 'abort-loses-nothing', effective: 5, calls: 5, byDelta: 0, hitDelta: 5 },
  afl_round_in_season: { gamesInWindow: 6, expectedRound: 18, discoveredRound: 18 },
  afl_finals_tip_in_season: { finalsInWindow: 3, reference: 'found', expectedHome: 68.6, served: '68.60' },
  afl_regular_tip_in_season: { gamesInWindow: 6, reference: 'found', expectedHome: 62.49, served: '62.49' },
  squiggle_contact_set: { state: 'set', httpStatus: 200 },
  aflapi_contact_set: { state: 'set', httpStatus: 200 },
  uefa_history_written: { windows: [{ key: 'ucl_history', scored: 186 }, { key: 'uel_history', scored: 186 }, { key: 'uecl_history', scored: 150 }, { key: 'uecl_may_nov', scored: 57 }] },
  d1_write_provenance: { everEntries: 9, controlEntries: 3, dashEntries: 1, windowHours: 48, gameDaysInWindow: 2, controlAttempted: true },
}
// EVERY REGISTERED VERDICT NEEDS A CLEAN PAYLOAD, not just the ones someone
// remembered. This loop iterated CAN_PASS rather than VERDICTS, so a verdict
// added without an entry here was silently exempt from the one check that says
// it can ever go green — the same shape as a `mustFailOn` nobody wrote, which
// the block above already refuses to allow.
for (const id of Object.keys(VERDICTS))
  check(`${id}: declares a clean payload`, Object.prototype.hasOwnProperty.call(CAN_PASS, id),
    'without one, "can this verdict ever say PASS" is never asked of it')
for (const [id, payload] of Object.entries(CAN_PASS)) {
  const out = VERDICTS[id](payload)
  check(`${id}: CAN reach PASS on a clean payload`, String(out).startsWith('PASS'),
    `returned ${JSON.stringify(out)} — a verdict that can never pass is permanently red and gets ignored`)
}

// ── vendor_watch_window_aligned: the file-reading half, driven with the REAL refusal log of 2026-11-01, the REAL log that has no verdict line (2026-09-19), and logs broken on purpose ──
// The verdict function above is pure; the payload builder is what reads text, and a parser that cannot tell a refusal from a verdict, or a verdict from one that lost its
// window line, would pass every payload the function is given. The refusal log is the one the watch really committed on 2026-11-01 (month-boundary); the judged log is the
// watch's own output format, lines copied from its self-test (scripts/watch-odds-daily-vs-vendor.mjs).
{
  const verdict = VERDICTS.vendor_watch_window_aligned
  const real = _readFileSync('outbox/odds-daily-vs-vendor-2026-11-01T0554.log', 'utf8')
  const noVerdict = _readFileSync('outbox/odds-daily-vs-vendor-2026-09-19T0220.log', 'utf8')
  const AT = '2026-11-02T05:40:00.000Z'
  const JUDGED = [`=== odds daily vs vendor  day=2026-11-01  utc=${AT} ===`, '  known CI spend              : 200   (1 run(s), 0 undated)',
    '  residual (window-aligned)   : -190   tolerance 169   <- the verdict', "  diagnostic, NOT the verdict : the UTC day's counter covers a different 24 hours than the window",
    '  residual against that       : -616   tolerance 169', '', '  verdict: we-overcharge-ourselves'].join('\n')
  const SERIES = [{ at: AT, ledger_month_used: 90, ledger_source: 'd1' }]
  const run = (logs, series = SERIES) => String(verdict(vendorWatchPayload(logs, series)))
  const L = (t, f = 'odds-daily-vs-vendor-2026-11-02T0540.log') => [{ f, t }]
  const ok = (name, got, want) => check(`vendor_watch_window_aligned: ${name}`, got === want, `got ${JSON.stringify(got)}`)
  const pend = (name, got, re) => check(`vendor_watch_window_aligned: ${name}`, re.test(got), `got ${JSON.stringify(got)}`)
  ok('no log since 2026-11-02 is PENDING', run([]).startsWith('PENDING'), true)
  pend('the REAL month-boundary refusal log is PENDING, with its reason', run(L(real)), /^PENDING.*month-boundary/)
  pend('the REAL log with no verdict line (a relay error) is PENDING, not FAIL', run(L(noVerdict)), /^PENDING.*no verdict line/)
  pend('a verdict this parser does not know is PENDING and names it', run(L('  verdict: unreadable')), /^PENDING.*unrecognised:unreadable/)
  // Every refusal state the watch can end in is PENDING with its own name: a state missing from the list would turn a transient refusal into a red run. The lists below are WRITTEN OUT,
  // not read from the module under test (a loop over the module's own list loses a dropped state along with its test), and each state is shown to be one the watch really emits.
  const WATCH_STATES = { refusals: ['month-boundary', 'no-data', 'counter-reset', 'window-drift', 'ledger-unreadable', 'ci-unreadable', 'ledger-went-backwards'], judged: ['tracks-the-bill', 'counter-under-counts', 'we-overcharge-ourselves'] }
  const watchSrc = _readFileSync('scripts/watch-odds-daily-vs-vendor.mjs', 'utf8')
  for (const state of [...WATCH_STATES.refusals, ...WATCH_STATES.judged]) ok(`"${state}" is a state the watch really emits (a quoted literal in its source)`, watchSrc.includes(`'${state}'`), true)
  ok('the module\'s refusal list is exactly the watch\'s refusal states', JSON.stringify([...VENDOR_WATCH_REFUSALS].sort()), JSON.stringify([...WATCH_STATES.refusals].sort()))
  ok('the module\'s judged list is exactly the watch\'s judged states', JSON.stringify([...VENDOR_WATCH_JUDGED].sort()), JSON.stringify([...WATCH_STATES.judged].sort()))
  for (const state of WATCH_STATES.refusals) pend(`the refusal "${state}" is PENDING and names itself`, run(L(`  verdict: ${state}`)), new RegExp(`^PENDING.*the newest says ${state};`))
  // Every judged verdict, with its lines, is PASS: the done condition is that the watch judged, not what it concluded.
  for (const state of WATCH_STATES.judged) ok(`a judged log ending "${state}" is PASS`, run(L(JUDGED.replace('we-overcharge-ourselves', state))), 'PASS')
  for (const state of WATCH_STATES.judged) ok(`a judged verdict "${state}" WITHOUT the window line is FAIL (a verdict without the lines Task 1 added)`, run(L(JUDGED.replace('residual (window-aligned)', 'residual').replace('we-overcharge-ourselves', state))).startsWith('FAIL'), true)
  ok('the FIRST judged log decides over a later refusal', run([...L(JUDGED, 'odds-daily-vs-vendor-2026-11-02T0540.log'), ...L(real, 'odds-daily-vs-vendor-2026-11-03T0540.log')]), 'PASS')
  ok('the FIRST judged log decides over a LATER judged log that is broken', run([...L(JUDGED, 'odds-daily-vs-vendor-2026-11-02T0540.log'), ...L(JUDGED.replace('known CI spend', 'ci'), 'odds-daily-vs-vendor-2026-11-03T0540.log')]), 'PASS')
  ok('a refusal before the first judged log does not decide', run([...L(real, 'odds-daily-vs-vendor-2026-11-02T0539.log'), ...L(JUDGED, 'odds-daily-vs-vendor-2026-11-03T0540.log')], SERIES), 'PASS')
  ok('a judged log WITHOUT the labelled diagnostic (the "NOT the verdict" half) is FAIL', run(L(JUDGED.replace('NOT the verdict', 'a number'))).startsWith('FAIL'), true)
  ok('a judged log WITHOUT the labelled diagnostic (the "residual against that" half) is FAIL', run(L(JUDGED.replace('residual against that', 'a second number'))).startsWith('FAIL'), true)
  ok('a judged log WITHOUT known CI spend is FAIL', run(L(JUDGED.replace('known CI spend', 'ci'))).startsWith('FAIL'), true)
  ok('two verdict lines are FAIL', run(L(JUDGED + '\n  verdict: tracks-the-bill')).startsWith('FAIL'), true)
  ok('a KV ledger stored by the judged run is FAIL', run(L(JUDGED), [{ at: AT, ledger_month_used: 90, ledger_source: 'kv-d1-unreadable' }]).startsWith('FAIL'), true)
  ok('a null ledger stored by the judged run is FAIL', run(L(JUDGED), [{ at: AT, ledger_month_used: null, ledger_source: 'd1' }]).startsWith('FAIL'), true)
  // The series half joins the judged run's OWN row, by the utc stamp in its header; a later run replaces the LAST row and must not change a verdict already reached.
  ok('a LATER run storing a KV ledger does not change the judged run\'s PASS', run(L(JUDGED), [...SERIES, { at: '2026-11-03T05:40:00.000Z', ledger_month_used: null, ledger_source: 'kv-d1-unreadable' }]), 'PASS')
  ok('a series with no row for the judged run is FAIL', run(L(JUDGED), [{ at: '2026-11-02T05:39:00.000Z', ledger_month_used: 90, ledger_source: 'd1' }]).startsWith('FAIL'), true)
  ok('a series whose oldest row is newer than the judged run (it aged out) is PENDING, not FAIL', run(L(JUDGED), [{ at: '2027-02-01T05:40:00.000Z', ledger_month_used: 90, ledger_source: 'd1' }]).startsWith('PENDING'), true)
  ok('a judged log with no utc stamp has no row to join and is FAIL', run(L(JUDGED.replace(/utc=\S+/, 'utc='))).startsWith('FAIL'), true)
  ok('a series file that is not an array is FAIL for a judged run, not a crash', run(L(JUDGED), {}).startsWith('FAIL'), true)
  const p = vendorWatchPayload([...L(real, 'a.log'), ...L(JUDGED, 'b.log'), ...L(JUDGED, 'c.log')], SERIES)
  ok('the coverage is the number of JUDGED logs and the log that decided, not every log', JSON.stringify([p.logsSince, p.judgedLogs, p.log]), JSON.stringify([3, 2, 'b.log']))
  // Which committed files check 8 reads: the watch's own name shape, dated 2026-11-02 or later, oldest first; everything else is not a log.
  const names = ['odds-daily-vs-vendor-2026-11-03T0540.log', 'odds-daily-vs-vendor-2026-11-01T0554.log', 'odds-daily-vs-vendor-series.json', 'odds-daily-vs-vendor-2026-11-02T0540.log.bak', 'xodds-daily-vs-vendor-2026-11-05T0540.log', 'odds-daily-vs-vendor-2026-11-02T0540.log', 'odds-daily-vs-vendor-2026-12-01T0000.log', 'odds-daily-vs-vendor-2026-11-02T054.log']
  ok('log-file selection: right shape, dated 2026-11-02 or later, sorted', JSON.stringify(vendorWatchLogFiles(names)), JSON.stringify(['odds-daily-vs-vendor-2026-11-02T0540.log', 'odds-daily-vs-vendor-2026-11-03T0540.log', 'odds-daily-vs-vendor-2026-12-01T0000.log']))
  ok('log-file selection: the real committed 2026-11-01 log is not "since 2026-11-02"', vendorWatchLogFiles(['odds-daily-vs-vendor-2026-11-01T0554.log']).length, 0)
}

// ── cfl_abort_repeat_loses_nothing: the file-reading half, driven with the REAL first artifact (2026-11-01, lossy, made before the fix) and with repeats broken on purpose ──
{
  const verdict = VERDICTS.cfl_abort_repeat_loses_nothing
  const real = JSON.parse(_readFileSync('outbox/cfl-abort-experiment-20261101T135557Z.json', 'utf8'))
  const REPEAT = { verdict: 'abort-loses-nothing', aborted_effective: 5, aborted_calls: 5, latency_samples_ms: [120, 110, 130], deltas: { aborted_phase: { by_site: 0, kept: 0, n: 5, hit: 5 } } }
  const run = (arts) => String(verdict(cflAbortRepeatPayload(arts)))
  const A = (a, f = 'cfl-abort-experiment-20261110T120000Z.json') => [{ f, a }]
  const ok = (name, got, want) => check(`cfl_abort_repeat_loses_nothing: ${name}`, got === want, `got ${JSON.stringify(got)}`)
  const pend = (name, got, re) => check(`cfl_abort_repeat_loses_nothing: ${name}`, re.test(got), `got ${JSON.stringify(got)}`)
  pend('no artifact at all is PENDING (waiting on the owner\'s approval)', run([]), /^PENDING.*fresh approval/)
  ok('the REAL first artifact (lossy, before the fix, no latency samples) is not a repeat: its verdict is not read as the fix failing', run(A(real, 'cfl-abort-experiment-20261101T135557Z.json')).startsWith('PENDING'), true)
  ok('a repeat that returns abort-loses-nothing with every call cut is PASS', run(A(REPEAT)), 'PASS')
  ok('...and with exactly the minimum of 3 cut calls', run(A({ ...REPEAT, aborted_effective: 3 })), 'PASS')
  ok('a repeat with fewer than 3 cut calls claiming abort-loses-nothing is FAIL', run(A({ ...REPEAT, aborted_effective: 2 })).startsWith('FAIL'), true)
  for (const v of ['abort-loses-refund-and-tally', 'abort-loses-refund-keeps-tally']) pend(`a repeat that returns ${v} is FAIL and says so (the fix does not hold)`, run(A({ ...REPEAT, verdict: v, deltas: { aborted_phase: { by_site: 6, kept: 0, n: 5, hit: 3 } } })), new RegExp(`^FAIL.*returned ${v}`))
  pend('an inconclusive repeat is PENDING, naming its verdict', run(A({ ...REPEAT, verdict: 'inconclusive:abort-not-effective' })), /^PENDING.*inconclusive:abort-not-effective/)
  ok('a verdict that contradicts its own deltas (by_site moved) is FAIL', run(A({ ...REPEAT, deltas: { aborted_phase: { by_site: 6, hit: 5 } } })).startsWith('FAIL'), true)
  ok('a verdict that contradicts its own deltas (tallies short) is FAIL', run(A({ ...REPEAT, deltas: { aborted_phase: { by_site: 0, hit: 4 } } })).startsWith('FAIL'), true)
  ok('a repeat with no deltas at all is FAIL, not a pass on absence', run(A({ ...REPEAT, deltas: undefined })).startsWith('FAIL'), true)
  ok('a repeat with no verdict string is FAIL', run(A({ ...REPEAT, verdict: undefined })).startsWith('FAIL'), true)
  ok('the NEWEST repeat decides: a lossy one after a passing one is FAIL', run([...A(REPEAT, 'cfl-abort-experiment-20261110T120000Z.json'), ...A({ ...REPEAT, verdict: 'abort-loses-refund-and-tally', deltas: { aborted_phase: { by_site: 6, hit: 4 } } }, 'cfl-abort-experiment-20261111T120000Z.json')]).startsWith('FAIL'), true)
  ok('...and a passing one after a lossy one is PASS', run([...A({ ...REPEAT, verdict: 'abort-loses-refund-and-tally', deltas: { aborted_phase: { by_site: 6, hit: 4 } } }, 'cfl-abort-experiment-20261110T120000Z.json'), ...A(REPEAT, 'cfl-abort-experiment-20261111T120000Z.json')]), 'PASS')
  const p = cflAbortRepeatPayload([...A(real, 'cfl-abort-experiment-20261101T135557Z.json'), ...A(REPEAT)])
  ok('the coverage is the number of repeats and the artifact that decided, not every artifact', JSON.stringify([p.artifacts, p.repeats, p.file]), JSON.stringify([2, 1, 'cfl-abort-experiment-20261110T120000Z.json']))
  ok('artifact selection: the experiment\'s own filename shape, sorted', JSON.stringify(cflAbortArtifactFiles(['cfl-abort-experiment-20261110T120000Z.json', 'cfl-abort-experiment-20261101T135557Z.json', 'cfl-abort-local-workerd-20261101.txt', 'cfl-abort-experiment-20261101T135557Z.json.bak', 'cfl-abort-experiment-2026.json'])), JSON.stringify(['cfl-abort-experiment-20261101T135557Z.json', 'cfl-abort-experiment-20261110T120000Z.json']))
}

// ── afl_finals_tip_in_season and afl_regular_tip_in_season: the branches the generic mustFailOn / CAN_PASS pair cannot see ──
// `Math.abs(Number(served) - expectedHome) > 0.005` is false for NaN, so a relay that served no number (a renamed or dropped field, a non-numeric value) PASSED. Each case below
// is a payload a real regression could produce, and the verdict must say FAIL or PENDING, never PASS.
for (const [id, countKey] of [['afl_finals_tip_in_season', 'finalsInWindow'], ['afl_regular_tip_in_season', 'gamesInWindow']]) {
  const v = VERDICTS[id]
  const base = { [countKey]: 3, reference: 'found', expectedHome: 68.6, served: '68.60' }
  const say = (o) => String(v({ ...base, ...o }))
  check(`${id}: the tip served as a string or a number, equal to the reference, is PASS`, say({}).startsWith('PASS') && say({ served: 68.6 }).startsWith('PASS'), say({}))
  for (const [what, served] of [['undefined (the field is gone)', undefined], ['NaN', NaN], ['text', 'abc'], ['an object', {}], ['an empty string', ''], ['blanks', '  ']])
    check(`${id}: a served value that is ${what} is FAIL, not PASS`, say({ served }).startsWith('FAIL'), say({ served }))
  check(`${id}: null served (the relay gave no tip) is FAIL`, say({ served: null }).startsWith('FAIL'), say({ served: null }))
  check(`${id}: a served tip that differs from the reference by more than 0.005 is FAIL, 0.004 is PASS`, say({ served: '68.61' }).startsWith('FAIL') && say({ served: '68.604' }).startsWith('PASS'), `${say({ served: '68.61' })} / ${say({ served: '68.604' })}`)
  for (const [what, o] of [['no game of the kind in the window', { [countKey]: 0 }], ['no reference found', { reference: 'none' }], ['a reference with no number', { expectedHome: null }], ['a reference that is NaN', { expectedHome: NaN }], ['the relay serving no journalism context', { served: 'absent' }]])
    check(`${id}: ${what} is PENDING, not PASS or FAIL`, say(o).startsWith('PENDING'), say(o))
}

// ── squiggle_contact_set: each state the relay can report, the header's mapping, and the executor block itself ──
{
  const v = VERDICTS.squiggle_contact_set
  for (const [state, want] of [['invalid', 'FAIL'], ['unrecognised', 'FAIL'], ['unset', 'PENDING'], [undefined, 'PENDING'], [null, 'PENDING']])
    check(`squiggle_contact_set: a state of ${JSON.stringify(state)} is ${want}`, String(v({ state, httpStatus: 200 })).startsWith(want), String(v({ state, httpStatus: 200 })))
  for (const [httpStatus, want] of [[200, 'PASS'], [403, 'FAIL'], [502, 'PENDING'], [503, 'PENDING'], [429, 'PENDING'], [404, 'PENDING'], [undefined, 'PENDING']])
    check(`squiggle_contact_set: a set contact whose own read answered ${httpStatus === undefined ? 'no status' : httpStatus} is ${want}`, String(v({ state: 'set', httpStatus })).startsWith(want), String(v({ state: 'set', httpStatus })))
  check('squiggle_contact_set: an unset contact with a 403 stays PENDING (the owner\'s step is not done: that is the news)', String(v({ state: 'unset', httpStatus: 403 })).startsWith('PENDING'), String(v({ state: 'unset', httpStatus: 403 })))
  check('squiggle_contact_set: nothing it says could carry an address (it never receives one)', !/[\w.+-]+@[\w-]+\.[\w.-]+/.test(['set', 'invalid', 'unrecognised', 'unset', null].map(state => v({ state })).join('\n')), '')
  // The header is mapped to a word before anything sees it: a present value outside the three words is 'unrecognised' (a broken contract), a missing one is null (not reported).
  const hdr = (value) => new Headers(value === undefined ? {} : { 'X-FIELD-Squiggle-Contact': value })
  for (const [raw, want] of [['set', 'set'], ['unset', 'unset'], ['invalid', 'invalid'], ['  set  ', 'set'], ['Set', 'unrecognised'], ['SET', 'unrecognised'], ['set, set', 'unrecognised'], ['', 'unrecognised'], ['true', 'unrecognised'], ['ops@example.invalid', 'unrecognised'], [undefined, null]])
    check(`squiggle_contact_set: the header ${JSON.stringify(raw)} reads as ${JSON.stringify(want)}`, squiggleContactStateOf(hdr(raw)) === want, JSON.stringify(squiggleContactStateOf(hdr(raw))))
  check('squiggle_contact_set: an address in the header is a FAIL that does not print it', (() => { const s = String(v({ state: squiggleContactStateOf(hdr('ops@example.invalid')) })); return s.startsWith('FAIL') && !s.includes('example.invalid') })(), '')
  // THE EXECUTOR: the real block of scripts/verify-staged-items.mjs run against a stubbed relay, because nothing else runs it before the daily workflow does. A wrong header name, a lost
  // import or a hard-coded state would otherwise leave every other gate green and show only in the first live run.
  const src = _readFileSync('scripts/verify-staged-items.mjs', 'utf8')
  const i0 = src.indexOf('// ── Check 14'), j0 = src.indexOf('// ── Check 15')
  check('squiggle_contact_set: the executor block is found', i0 > 0 && j0 > i0, `markers ${i0} ${j0}`)
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const runBlock = async (respond) => {
    const checks = [], urls = []
    const realFetch = globalThis.fetch
    globalThis.fetch = async (u) => { urls.push(String(u)); return respond(String(u)) }
    try { await (new AsyncFunction('add', 'RELAY', 'UA', 'squiggleContactSet', 'squiggleContactStateOf', src.slice(i0, j0)))(c => checks.push(c), 'https://relay.invalid', 'ua', squiggleContactSet, squiggleContactStateOf) }
    finally { globalThis.fetch = realFetch }
    return { c: checks[0], n: checks.length, urls }
  }
  const resp = (value, status = 200) => async () => new Response('{}', { status, headers: value === undefined ? {} : { 'X-FIELD-Squiggle-Contact': value } })
  for (const [name, respond, status, state, rows] of [['set', resp('set'), 'PASS', 'set', 1], ['invalid', resp('invalid'), 'FAIL', 'invalid', 1], ['unset', resp('unset'), 'PENDING', 'unset', 1],
      ['no header', resp(undefined), 'PENDING', null, 0], ['a 403 that still reports set', resp('set', 403), 'FAIL', 'set', 1], ['a 502 that reports set', resp('set', 502), 'PENDING', 'set', 1], ['an address in the header', resp('ops@example.invalid'), 'FAIL', 'unrecognised', 1]]) {
    const { c, n } = await runBlock(respond)
    check(`squiggle_contact_set executor: ${name} -> ${status}, state ${JSON.stringify(state)}, ${rows} row(s), one check added`, n === 1 && c.id === 'squiggle_contact_set' && String(c.status).startsWith(status) && c.contact_state === state && c.qualifying_rows === rows, JSON.stringify(c))
  }
  const leak = await runBlock(resp('ops@example.invalid'))
  check('squiggle_contact_set executor: nothing it records (manifest row, status, coverage) carries an address from the header', !JSON.stringify(leak.c).includes('example.invalid'), JSON.stringify(leak.c))
  const down = await runBlock(async () => { throw new TypeError('network down') })
  check('squiggle_contact_set executor: a network failure is PENDING "could not read" with no rows', down.c.id === 'squiggle_contact_set' && /^PENDING — could not read: network down/.test(down.c.status) && down.c.qualifying_rows === 0, JSON.stringify(down.c))
  check('squiggle_contact_set executor: it reads the relay\'s /squiggle?q=teams, once', JSON.stringify((await runBlock(resp('set'))).urls) === JSON.stringify(['https://relay.invalid/squiggle?q=teams']), '')
}
// ── aflapi_contact_set: each state the relay can report, the header's mapping, and the executor block itself (the same four things as squiggle_contact_set above) ──
{
  const v = VERDICTS.aflapi_contact_set
  for (const [state, want] of [['invalid', 'FAIL'], ['unrecognised', 'FAIL'], ['unset', 'PENDING'], [undefined, 'PENDING'], [null, 'PENDING']])
    check(`aflapi_contact_set: a state of ${JSON.stringify(state)} is ${want}`, String(v({ state, httpStatus: 200 })).startsWith(want), String(v({ state, httpStatus: 200 })))
  for (const [httpStatus, want] of [[200, 'PASS'], [403, 'PENDING'], [502, 'PENDING'], [404, 'PENDING'], [undefined, 'PENDING']])
    check(`aflapi_contact_set: a set contact whose read answered ${httpStatus === undefined ? 'no status' : httpStatus} is ${want} (only a served board can pass)`, String(v({ state: 'set', httpStatus })).startsWith(want), String(v({ state: 'set', httpStatus })))
  check('aflapi_contact_set: an unset contact stays PENDING whatever the status (the owner\'s step is not done: that is the news)', [200, 403, 502].every(httpStatus => String(v({ state: 'unset', httpStatus })).startsWith('PENDING')), '')
  check('aflapi_contact_set: nothing it says could carry an address (it never receives one)', !/[\w.+-]+@[\w-]+\.[\w.-]+/.test(['set', 'invalid', 'unrecognised', 'unset', null].map(state => v({ state, httpStatus: 200 })).join('\n')), '')
  const hdr = (value) => new Headers(value === undefined ? {} : { 'X-FIELD-Aflapi-Contact': value })
  for (const [raw, want] of [['set', 'set'], ['unset', 'unset'], ['invalid', 'invalid'], ['  set  ', 'set'], ['Set', 'unrecognised'], ['SET', 'unrecognised'], ['set, set', 'unrecognised'], ['', 'unrecognised'], ['true', 'unrecognised'], ['ops@example.invalid', 'unrecognised'], [undefined, null]])
    check(`aflapi_contact_set: the header ${JSON.stringify(raw)} reads as ${JSON.stringify(want)}`, aflapiContactStateOf(hdr(raw)) === want, JSON.stringify(aflapiContactStateOf(hdr(raw))))
  check('aflapi_contact_set: an address in the header is a FAIL that does not print it', (() => { const s = String(v({ state: aflapiContactStateOf(hdr('ops@example.invalid')), httpStatus: 200 })); return s.startsWith('FAIL') && !s.includes('example.invalid') })(), '')
  check('aflapi_contact_set: the Squiggle header is not read as the aflapi one', aflapiContactStateOf(new Headers({ 'X-FIELD-Squiggle-Contact': 'set' })) === null, '')
  // THE EXECUTOR: the real block of scripts/verify-staged-items.mjs run against a stubbed relay (a wrong header name, a lost import or a hard-coded state would otherwise show only in the first live run).
  const src = _readFileSync('scripts/verify-staged-items.mjs', 'utf8')
  const i0 = src.indexOf('// ── Check 15'), j0 = src.indexOf('// ── Check 16')
  check('aflapi_contact_set: the executor block is found', i0 > 0 && j0 > i0, `markers ${i0} ${j0}`)
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const runBlock = async (respond) => {
    const checks = [], urls = []
    const realFetch = globalThis.fetch
    globalThis.fetch = async (u) => { urls.push(String(u)); return respond(String(u)) }
    try { await (new AsyncFunction('add', 'RELAY', 'UA', 'aflapiContactSet', 'aflapiContactStateOf', src.slice(i0, j0)))(c => checks.push(c), 'https://relay.invalid', 'ua', aflapiContactSet, aflapiContactStateOf) }
    finally { globalThis.fetch = realFetch }
    return { c: checks[0], n: checks.length, urls }
  }
  const resp = (value, status = 200) => async () => new Response('{}', { status, headers: value === undefined ? {} : { 'X-FIELD-Aflapi-Contact': value } })
  for (const [name, respond, status, state, rows] of [['set', resp('set'), 'PASS', 'set', 1], ['invalid', resp('invalid'), 'FAIL', 'invalid', 1], ['unset', resp('unset'), 'PENDING', 'unset', 1],
      ['no header', resp(undefined), 'PENDING', null, 0], ['a 502 that reports set', resp('set', 502), 'PENDING', 'set', 1], ['an address in the header', resp('ops@example.invalid'), 'FAIL', 'unrecognised', 1]]) {
    const { c, n } = await runBlock(respond)
    check(`aflapi_contact_set executor: ${name} -> ${status}, state ${JSON.stringify(state)}, ${rows} row(s), one check added`, n === 1 && c.id === 'aflapi_contact_set' && String(c.status).startsWith(status) && c.contact_state === state && c.qualifying_rows === rows, JSON.stringify(c))
  }
  const leak = await runBlock(resp('ops@example.invalid'))
  check('aflapi_contact_set executor: nothing it records (manifest row, status, coverage) carries an address from the header', !JSON.stringify(leak.c).includes('example.invalid'), JSON.stringify(leak.c))
  const down = await runBlock(async () => { throw new TypeError('network down') })
  check('aflapi_contact_set executor: a network failure is PENDING "could not read" with no rows', down.c.id === 'aflapi_contact_set' && /^PENDING — could not read: network down/.test(down.c.status) && down.c.qualifying_rows === 0, JSON.stringify(down.c))
  check('aflapi_contact_set executor: it reads the relay\'s AFLW board on a fixed 2026 day, once', JSON.stringify((await runBlock(resp('set'))).urls) === JSON.stringify(['https://relay.invalid/v2/games?sport=aflw&date=2026-08-09']), '')
}

// ── uefa_history_written: the windows, each state the verdict can reach, and the executor block itself ──
{
  const v = VERDICTS.uefa_history_written
  const W = (a, b, c, d) => ({ windows: [{ key: 'ucl_history', scored: a }, { key: 'uel_history', scored: b }, { key: 'uecl_history', scored: c }, { key: 'uecl_may_nov', scored: d }] })
  // THE WINDOWS ARE THE MEASUREMENT: ESPN's completed counts from the dry runs of 2026-11-27 (186, 186, 150 for 2025-09-01 to 2026-04-30; 57 for the Conference League 2026-05-01 to 2026-11-25).
  // Pinned here so a constant that drifted (a typo, a window that moved past the cron's reach) is red, not a quiet change to what "written" means.
  check('uefa_history_written: the four windows are the ones the dry runs measured (label, dates, expected count)',
    JSON.stringify(UEFA_HISTORY_WINDOWS.map(w => [w.key, w.label, w.from, w.to, w.expected])) === JSON.stringify([
      ['ucl_history', 'UEFA Champions League', '2025-09-01', '2026-04-30', 186], ['uel_history', 'UEFA Europa League', '2025-09-01', '2026-04-30', 186],
      ['uecl_history', 'UEFA Europa Conference League', '2025-09-01', '2026-04-30', 150], ['uecl_may_nov', 'UEFA Europa Conference League', '2026-05-01', '2026-11-25', 57]]), JSON.stringify(UEFA_HISTORY_WINDOWS))
  check('uefa_history_written: no window reaches past 2026-11-25, so the cron never adds to one', UEFA_HISTORY_WINDOWS.every(w => w.to <= '2026-11-25'), '')
  check('uefa_history_written: the 522 history rows and the 524 the claim names add up (186+186+150 history; 55 of 57 May to November are archived, so 2 are to write)',
    UEFA_HISTORY_WINDOWS.filter(w => w.key.endsWith('_history')).reduce((s, w) => s + w.expected, 0) === 522 && UEFA_HISTORY_WINDOWS.find(w => w.key === 'uecl_may_nov').expected - 55 === 2, '')
  // The state read from the archive at 2026-11-27T19:24Z (outbox/archive-label-dates-2026-11-27T19-24-06-750Z.json): nothing in the history windows, 55 of 57 in the Conference May to November window.
  for (const [name, payload, want] of [
    ['the archive as read on 2026-11-27 (nothing written)', W(0, 0, 0, 55), 'PENDING'], ['all four windows empty', W(0, 0, 0, 0), 'PENDING'],
    ['one history window written, the rest not', W(186, 0, 0, 55), 'PARTIAL'], ['a history window half written', W(100, 0, 0, 55), 'PARTIAL'],
    ['all history written, the 2 May Conference rows not', W(186, 186, 150, 55), 'PARTIAL'], ['the May rows written and no history', W(0, 0, 0, 57), 'PENDING'],
    ['one row short in the first window', W(185, 186, 150, 57), 'PARTIAL'], ['one row short in the last window', W(186, 186, 150, 56), 'PARTIAL'],
    ['everything written', W(186, 186, 150, 57), 'PASS'],
    ['a duplicate in the first window', W(187, 186, 150, 57), 'FAIL'], ['a duplicate in the last window', W(186, 186, 150, 58), 'FAIL'], ['a duplicate while the rest is unwritten', W(187, 0, 0, 55), 'FAIL'],
    ['a count above the expected in one window, below in another', W(190, 100, 150, 57), 'FAIL'],
  ]) check(`uefa_history_written: ${name} is ${want}`, String(v(payload)).startsWith(want), String(v(payload)))
  const bad = [['a window missing', { windows: W(186, 186, 150, 57).windows.slice(0, 3) }], ['no windows', { windows: [] }], ['windows not an array', { windows: null }], ['an extra window', { windows: [...W(186, 186, 150, 57).windows, { key: 'x', scored: 1 }] }],
    ['a count that is NaN', W(186, 186, NaN, 57)], ['a count that is a string', W('186', 186, 150, 57)], ['a count that is negative', W(-1, 186, 150, 57)], ['a count that is null', W(186, null, 150, 57)],
    ['a count that is fractional', W(186.5, 186, 150, 57)], ['a wrong key', { windows: [{ key: 'ucl_history', scored: 186 }, { key: 'uel_history', scored: 186 }, { key: 'uecl_history', scored: 150 }, { key: 'uecl_other', scored: 57 }] }]]
  for (const [name, payload] of bad) check(`uefa_history_written: ${name} is FAIL (the contract is broken, nothing is judged), never PASS`, String(v(payload)).startsWith('FAIL'), String(v(payload)))
  check('uefa_history_written: the order the windows arrive in does not matter', String(v({ windows: W(186, 186, 150, 57).windows.reverse() })).startsWith('PASS'), '')
  check('uefa_history_written: PENDING names what it waits on (the owner\'s word) and the counts', /owner's word/.test(v(W(0, 0, 0, 55))) && /0 of 522/.test(v(W(0, 0, 0, 55))) && /uecl_may_nov 55\/57/.test(v(W(0, 0, 0, 55))), v(W(0, 0, 0, 55)))
  // THE EXECUTOR: the real block of scripts/verify-staged-items.mjs against a stubbed d1, because nothing else runs it before the daily workflow does.
  const src = _readFileSync('scripts/verify-staged-items.mjs', 'utf8')
  const i0 = src.indexOf('// ── Check 16'), j0 = src.indexOf('m.summary = ')
  check('uefa_history_written: the executor block is found', i0 > 0 && j0 > i0, `markers ${i0} ${j0}`)
  check('uefa_history_written: the executor says how many checks there are (16)', /const EXPECTED_CHECKS = 16;/.test(src), '')
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const runBlock = async (d1) => {
    const checks = []
    await (new AsyncFunction('add', 'd1', 'UEFA_HISTORY_WINDOWS', 'uefaHistoryWritten', src.slice(i0, j0)))(c => checks.push(c), d1, UEFA_HISTORY_WINDOWS, VERDICTS.uefa_history_written)
    return { c: checks[0], n: checks.length }
  }
  // A stub that answers by the window the params name, and records every statement it was sent.
  const stub = (table) => { const calls = []; const d1 = async (sql, params = []) => { calls.push({ sql, params }); const w = UEFA_HISTORY_WINDOWS.find(x => x.label === params[0] && x.from === params[1] && x.to === params[2]); const r = w ? table[w.key] : null; return r === null || r === undefined ? [] : [r] }; return { d1, calls } }
  const T = (a, b, c, d, rows = null) => ({ ucl_history: { n: rows ?? a, scored: a }, uel_history: { n: rows ?? b, scored: b }, uecl_history: { n: rows ?? c, scored: c }, uecl_may_nov: { n: rows ?? d, scored: d } })
  for (const [name, table, status, rows] of [['nothing written', T(0, 0, 0, 55), 'PENDING', 55], ['everything written', T(186, 186, 150, 57), 'PASS', 579], ['a duplicate', T(187, 186, 150, 57), 'FAIL', 580],
      ['rows with no score are not archived: 4 extra unscored rows do not break a complete write', T(186, 186, 150, 57, 190), 'PASS', 579]]) {
    const { d1 } = stub(table)
    const { c, n } = await runBlock(d1)
    check(`uefa_history_written executor: ${name} -> ${status}, ${rows} qualifying row(s), one check added`, n === 1 && c.id === 'uefa_history_written' && String(c.status).startsWith(status) && c.qualifying_rows === rows && c.windows.length === 4, JSON.stringify(c))
  }
  const sent = stub(T(0, 0, 0, 55)); await runBlock(sent.d1)
  check('uefa_history_written executor: it sends one statement per window, four in all', sent.calls.length === 4, String(sent.calls.length))
  check('uefa_history_written executor: every statement reads BOTH game tables', sent.calls.every(c => /FROM regular_season_games/.test(c.sql) && /FROM postseason_games/.test(c.sql)), sent.calls[0].sql)
  check('uefa_history_written executor: every statement counts scored rows (COUNT(home_score)) in both tables', sent.calls.every(c => (c.sql.match(/COUNT\(home_score\)/g) || []).length === 2), sent.calls[0].sql)
  check('uefa_history_written executor: the label is matched exactly (=, never LIKE) so the Qualifying labels are not counted', sent.calls.every(c => /sport = \?1/.test(c.sql) && !/LIKE/i.test(c.sql)), sent.calls[0].sql)
  check('uefa_history_written executor: the label and both dates are bound parameters, never spliced into the statement',
    sent.calls.every((c, i) => JSON.stringify(c.params) === JSON.stringify([UEFA_HISTORY_WINDOWS[i].label, UEFA_HISTORY_WINDOWS[i].from, UEFA_HISTORY_WINDOWS[i].to]) && !c.sql.includes('UEFA') && !/\d{4}-\d{2}-\d{2}/.test(c.sql)), JSON.stringify(sent.calls[0]))
  check('uefa_history_written executor: it never writes (every statement is a SELECT)', sent.calls.every(c => /^\s*SELECT /i.test(c.sql) && !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE)\b/i.test(c.sql)), sent.calls[0].sql)
  const down = await runBlock(async () => { throw new Error('HTTP 503: relay down') })
  check('uefa_history_written executor: a failed read is PENDING "could not read" with no rows', down.c.id === 'uefa_history_written' && /^PENDING — could not read: HTTP 503/.test(down.c.status) && down.c.qualifying_rows === 0, JSON.stringify(down.c))
  const empty = await runBlock(async () => [])
  check('uefa_history_written executor: a read that returns no row at all is FAIL (a count that is not a count), never PASS', String(empty.c.status).startsWith('FAIL'), JSON.stringify(empty.c))
}
console.log(fail ? `\n${fail} failed` : `\n${pass} passed`)
process.exit(fail ? 1 : 0)
