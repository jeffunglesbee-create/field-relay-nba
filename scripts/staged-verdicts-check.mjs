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

import { VERDICTS, vendorWatchPayload, vendorWatchLogFiles, VENDOR_WATCH_REFUSALS, VENDOR_WATCH_JUDGED, cflAbortRepeatPayload, cflAbortArtifactFiles } from './staged-verdicts.mjs'
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
  thread_notes_cleanup: { total: 40, expiredBeyondGrace: 0 },
  odds_budget_charging: { tablesExist: true, dayRows: 1, charged: 1014, kvUsed: 1014 },
  vendor_watch_window_aligned: { logsSince: 1, judgedLogs: 1, refusal: '', verdictLines: 1, hasWindowLine: true, hasDiagnosticLines: true, hasKnownCi: true, seriesRow: 'found', seriesNumeric: true, seriesSourceD1: true },
  cfl_abort_repeat_loses_nothing: { artifacts: 2, repeats: 1, file: 'cfl-abort-experiment-20261110T120000Z.json', verdict: 'abort-loses-nothing', effective: 5, calls: 5, byDelta: 0, hitDelta: 5 },
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

console.log(fail ? `\n${fail} failed` : `\n${pass} passed`)
process.exit(fail ? 1 : 0)
