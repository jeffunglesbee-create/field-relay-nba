#!/usr/bin/env node
// The verdict logic of scripts/verify-staged-items.mjs, as pure functions.
//
// WHY IT MOVED OUT OF THAT FILE
//
// Those four checks are the executors everything else points at. field-laboratory
// registers staged items against them by id; this repo's CC-CMDs cite them as
// done conditions. And not one of them had ever been demonstrated to fail.
//
// Four probes in this project were found vacuous during August, and every one
// shared exactly that property — never shown to fail on a known-bad input:
//
//   an n=2 "CONFIRMED" reaching an outbox;
//   a 5.4-point gap reported on n=16 and reversed at n=95;
//   a brief-contamination predicate that could never observe a cessation;
//   a staged-claim scanner that found zero claims because it matched an
//   invented convention instead of the observed one.
//
// Each was caught by a person noticing, days apart, and patched alone. The
// property is mechanical, so the guard is mechanical: every verdict here
// declares `mustFailOn` — a payload it must NOT call PASS — and
// staged-verdicts-check.mjs runs it.
//
// The verdicts were inline ternaries inside four `add({...})` blocks. They are
// COPIED, not rewritten: same branches, same order, same strings. A verdict that
// changed while being extracted would break the thing it is meant to protect,
// and the extraction would be the last place anyone looked.
//
// verify-staged-items.mjs imports these, so there is one copy of each decision.
// Two copies free to disagree is the divergence CONTRACTS.md exists to prevent.

/// Check 1 — closing_odds.captured_at must be after opening_odds.captured_at.
export const closingAfterOpening = ({ rows, sequenced }) =>
  rows === 0 ? 'PENDING — no game has been priced since the fix'
  : sequenced === rows ? 'PASS'
  : sequenced === 0 ? 'FAIL — every pair is still non-sequenced'
  : `PARTIAL — ${sequenced}/${rows} sequenced`
// Every pair non-sequenced is the pre-fix condition: one snapshot in two columns.
closingAfterOpening.mustFailOn = { rows: 8, sequenced: 0 }

/// Check 2 — soccer opening coverage above the measured pre-fix baseline.
export const soccerOpeningCoverage = ({ measurable, tooFew, improved, regressed, minGames }) =>
  !measurable.length
    ? `PENDING — no sport has reached ${minGames} played fixtures since the aliases landed`
      + (tooFew.length ? `; below floor: ${tooFew.map(r => `${r.sport} n=${r.games}`).join(', ')}` : '')
  : regressed.length ? `FAIL — coverage fell for ${regressed.map(r => r.sport).join(', ')}`
  : improved.length ? `PASS — improved for ${improved.map(r => r.sport).join(', ')}`
  : 'PENDING — fixtures exist but none carry a baseline sport yet'
// Coverage BELOW the pre-fix baseline. The whole point of the alias work.
soccerOpeningCoverage.mustFailOn = {
  measurable: [{ sport: 'EPL', games: 5, pct: 10, baseline_pct: 23.1 }],
  tooFew: [], improved: [],
  regressed: [{ sport: 'EPL', games: 5, pct: 10, baseline_pct: 23.1 }],
  minGames: 4,
}

/// Check 3 — EPL briefs are event-grounded and free of prompt-example literals.
export const eplBriefEventGrounded = ({ briefRows, leaking, postLeakFix, grounded, historicalLeaks, liveNote }) =>
  !briefRows ? 'PENDING — no EPL brief written since the deploy'
  : leaking.length ? `FAIL — ${leaking.length}/${postLeakFix} post-fix recap(s) carry a prompt-example literal: `
      + [...new Set(leaking.flatMap(b => b.leaked_literals))].join(', ') + liveNote
  : !grounded ? 'FAIL — every new EPL brief is still the season template'
  : !postLeakFix ? `PARTIAL — ${grounded}/${briefRows} not the season template; `
      + `leak-freedom UNPROVEN: no EPL RECAP written since the 2f fix deployed`
      + (historicalLeaks ? ` (${historicalLeaks} pre-fix recap(s) did leak)` : '') + liveNote
  : `PASS — ${grounded}/${briefRows} not the season template, and no prompt-example `
      + `literal in any of the ${postLeakFix} recap(s) written since the 2f fix` + liveNote
// A post-fix recap still carrying a leaked literal.
eplBriefEventGrounded.mustFailOn = {
  briefRows: 4, postLeakFix: 4, grounded: 4, historicalLeaks: 0, liveNote: '',
  leaking: [{ leaked_literals: ['107.7'] }],
}

/// Check 4 — a game_recap names someone who actually scored in that game.
export const recapNamesScoringPlay = ({ recapRows, testable, named }) =>
  !recapRows ? 'PENDING — no game_recap in the six sports GENERATED since the recap path began assembling context'
  : !testable ? `PENDING — ${recapRows} generated recap(s), none testable (no ESPN scoring plays or no usable event id)`
  : !named ? `FAIL — 0/${testable} recap(s) name anyone who scored in the game they describe`
  : named < testable ? `PARTIAL — ${named}/${testable} recap(s) name a real scorer; see the rest in evidence`
  : `PASS — ${named}/${named} recap(s) name someone who actually scored`
// Testable recaps exist and none names a scorer: the block is not reaching the
// prompt, which is exactly the condition the check was built to surface.
recapNamesScoringPlay.mustFailOn = { recapRows: 6, testable: 6, named: 0 }

/// Check 5 — the hourly cleanup cron actually deletes expired thread notes.
///
/// Found by scripts/staged-verifier-check.mjs on its FIRST run against docs/:
/// `cc-session-2026-07-20-game-thread-relay.md` carried "**STAGED** — fires at
/// next :30 mark post-deploy" and had carried it for 34 days. The cron has run
/// roughly 816 times since. Nobody looked, because nothing was going to.
///
/// Exactly failure A — the unblock is a future event and nothing re-evaluates
/// whether it happened — which is the same shape that left closing-odds two days
/// past its own PASS. The difference is that this one sat for a month.
///
/// A grace window, because "expired" and "not yet swept" are different things:
/// the cron fires at :30, so a row that expired four minutes ago is not
/// evidence of anything. Only rows expired longer than the cron's own interval
/// can testify.
export const threadNotesCleanup = ({ total, expiredBeyondGrace }) =>
  total === 0 ? 'PENDING — no thread notes in the table, so the sweep has nothing to prove'
  : expiredBeyondGrace === 0 ? 'PASS'
  : `FAIL — ${expiredBeyondGrace} note(s) expired more than an hour ago and are still present; the :30 sweep is not running or is throwing`
// Rows long past expiry and still there: the cron never fired, or it throws.
threadNotesCleanup.mustFailOn = { total: 40, expiredBeyondGrace: 37 }

/// Has the D1 write provenance instrumentation named the second writer?
///
/// FOUR STATES, and the middle two are the point. The CC-CMD's own decision
/// table says a window that contains no dash-scheme INSERT is "NOT OBSERVED —
/// neither a pass nor a failure", so this must never return FAIL for it: the
/// second writer may simply not have written during the window, and calling
/// that a regression would train everyone to ignore the probe.
///
/// The CONTROL is what separates "nothing wrote" from "the instrument is
/// broken", and it is the only condition here that can fail. A run with no
/// control entry has measured nothing at all, and reporting that as "no second
/// writer found" would be the loudest possible false negative.
///
/// `gameDaysInWindow` is required rather than assumed: the two observed writes
/// landed the day after a game, so a window containing no such day proves
/// nothing and must not be counted as evidence of absence.
///
/// `controlAttempted` IS REQUIRED, AND ADDING IT IS THE FIX FOR A PERMANENT RED.
///
/// The control is written by `d1-write-provenance-verify.yml`, which is
/// DISPATCH-ONLY. This verdict runs weekly on a schedule. So `controlEntries`
/// was 0 on every scheduled run unless a human happened to dispatch the control
/// inside the same 48h window, and the run returned FAIL — for three weeks, on
/// runs 32, 33 and 34.
///
/// That is exactly the "can never pass, so everyone ignores it" defect the
/// paragraph above says this verdict checker exists to catch, happening to this
/// verdict. A missing control is only evidence of a silent instrument if a
/// control was actually written; otherwise the run has not tested liveness at
/// all, and "not tested" is not "broken".
///
/// The true positive is unchanged and still the only failure: attempt a control
/// and find no entry, and the instrument is silent. What is removed is a red
/// that no scheduled run could ever avoid.
///
/// Not fixed by scheduling the control instead: it issues 90 synthetic writes
/// into live D1 per run, and standing D1 mutations in this repo are authorised
/// case by case, not wired to a cron by the session that noticed the red.
export const d1WriteProvenance = ({ everEntries, controlEntries, dashEntries, windowHours, gameDaysInWindow, controlAttempted }) => {
  for (const [k, v] of Object.entries({ everEntries, controlEntries, dashEntries, windowHours, gameDaysInWindow }))
    if (typeof v !== 'number') throw new TypeError(`d1WriteProvenance: ${k} is required`)
  if (typeof controlAttempted !== 'boolean')
    throw new TypeError('d1WriteProvenance: controlAttempted is required')
  // NEVER WROTE is not WENT SILENT, and collapsing them would make this
  // permanently red until the instrumentation ships — which is precisely the
  // "can never pass, so everyone ignores it" defect the verdict checker exists
  // to catch. The dataset held 0 d1-write entries when this was written.
  if (everEntries === 0)
    return 'PENDING — the provenance instrumentation has never written an entry; it is not deployed yet'
  if (controlEntries === 0)
    return controlAttempted
      ? 'FAIL — a control was written in this window and no entry appeared; the instrument is silent'
      : `PENDING — no control was written in this ${windowHours}h window, so the instrument's`
        + ' liveness was not tested. Dispatch d1-write-provenance-verify to test it'
  if (dashEntries > 0)
    return `PASS — ${dashEntries} dash-scheme INSERT(s) recorded with provenance; the caller is named`
  if (gameDaysInWindow === 0)
    return `PENDING — ${windowHours}h window contains no day-after-game, and both observed writes landed on one; nothing to observe yet`
  return `PENDING — NOT OBSERVED: ${windowHours}h window over ${gameDaysInWindow} qualifying day(s), control present, no dash-scheme INSERT. Extend the window; do not close`
}
// The control missing is the ONE condition that is a failure: the instrument is
// silent, and a silent instrument reporting "no second writer" is the false
// negative this whole item exists to avoid.
d1WriteProvenance.mustFailOn = { everEntries: 12, controlEntries: 0, dashEntries: 0, windowHours: 48, gameDaysInWindow: 2, controlAttempted: true }

/// Check 7 — is the odds budget guard charging through D1 yet?
///
/// Task 1 of CC-CMD-2026-09-18 shipped `ensureOddsBudgetTables` with no caller:
/// Task 2 is its caller. That is a STAGED claim, and on 2026-09-19 it was filed
/// with the marker but WITHOUT a verifier id — which took deploy.yml red at
/// "a staged claim names a verifier that exists and runs" and left the relay
/// undeployed through two commits. The checker was right; the claim had no owner.
///
/// PENDING IS THE HONEST FIRST STATE. The tables are created lazily on first
/// use, so before Task 2 lands there is no table and no row, and that is not a
/// failure — it is the staged condition still holding. `closingAfterOpening` and
/// `threadNotesCleanup` both take the same shape, for the same reason.
///
/// WHY `charged` AND NOT JUST `tables`: a CREATE TABLE that ran once proves the
/// DDL executed, not that the guard routes through it. The guard could ship,
/// throw on every call, degrade open, and leave a table with zero rows — which
/// looks identical to "Task 2 has not landed". Only a row with used > 0 on a day
/// with traffic distinguishes them, so the day's own KV counter comes in as
/// `kvUsed` and a day where BOTH are zero stays PENDING rather than passing.
export const oddsBudgetCharging = ({ tablesExist, dayRows, charged, kvUsed }) =>
  !tablesExist ? 'PENDING — odds_budget does not exist yet; Task 2 creates it on first use'
  : dayRows === 0 && Number(kvUsed) === 0 ? 'PENDING — no odds spend today, so neither counter can testify'
  : dayRows === 0 ? `FAIL — KV charged ${kvUsed} today and odds_budget has no row for it; the guard is not routing through D1`
  : charged === 0 ? 'FAIL — a row exists for today but used is 0 while KV moved; the batch is running and not charging'
  : 'PASS'
// The defect this exists to catch: the tables are there, the day had real spend,
// and D1 recorded none of it — the guard shipped and is not charging through it.
oddsBudgetCharging.mustFailOn = { tablesExist: true, dayRows: 0, charged: 0, kvUsed: 1014 }

/// Check 8 — has the vendor watch printed its window-aligned verdict on a scheduled run since Task 1?
///
/// docs/CC-CMD-2026-10-13-vendor-residual-window.md, done condition 3. Task 1 (46a929f) made the verdict the vendor's spend minus the ledger's over the SAME two readings, printed the
/// UTC-day figure as a labelled diagnostic, and made a window it cannot measure fail the run. The sandbox cannot reach the relay and dispatching the workflow would split the window,
/// so the proof is the first scheduled run that reaches a verdict, which this reads from the log that run commits. It was filed as a STAGED claim with no executor, which took
/// deploy.yml red at "a staged claim names a verifier that exists and runs": the checker was right again.
///
/// A REFUSAL IS NOT A FAILURE AND NOT A PASS. month-boundary, no-data, counter-reset, window-drift and the new ledger-unreadable, ci-unreadable and ledger-went-backwards are the
/// watch's honest answers; none of them is the done condition, so each is PENDING with its reason. FAIL is a log that reached a verdict without the lines Task 1 added, or a
/// series row without a numeric D1 ledger: the change did not do what it claims.
/** The committed logs check 8 reads, from the names in outbox/: the watch's own filename shape, dated 2026-11-02 or later, oldest first. Pure, so the checker drives it with real and broken names. */
export const vendorWatchLogFiles = (names) => names
  .filter((f) => /^odds-daily-vs-vendor-\d{4}-\d{2}-\d{2}T\d{4}\.log$/.test(f) && f.slice('odds-daily-vs-vendor-'.length, 'odds-daily-vs-vendor-'.length + 10) >= '2026-11-02')
  .sort()
/** The states the watch ends a run in. REFUSALS are honest answers that make no comparison; JUDGED are the three verdicts of a window it measured. A log in neither (no verdict line at all
 *  because the run died on an HTTP error or an unusable reading, or a state this list does not know) is NOT judged and is NOT a regression: it is PENDING, with the reason named. */
export const VENDOR_WATCH_REFUSALS = ['month-boundary', 'no-data', 'counter-reset', 'window-drift', 'ledger-unreadable', 'ci-unreadable', 'ledger-went-backwards']
export const VENDOR_WATCH_JUDGED = ['tracks-the-bill', 'counter-under-counts', 'we-overcharge-ourselves']
/** The payload of check 8 from the committed files. `logs` is [{ f: filename, t: text }] from vendorWatchLogFiles, `series` the parsed series file. Pure, so the checker can drive it with the
 *  real 2026-11-01 refusal log and with logs it breaks on purpose. The FIRST judged log decides (a log is judged if it carries the window line or one of the three judged verdicts); with none,
 *  the newest log speaks. The series row checked is the one THAT RUN stored, found by the `utc=` stamp in the log's header, which the watch also writes as the row's `at`: not the last row,
 *  which a later run replaces. */
export const vendorWatchPayload = (logs, series) => {
  const none = { logsSince: 0, judgedLogs: 0, refusal: '', verdictLines: 0, hasWindowLine: false, hasDiagnosticLines: false, hasKnownCi: false, seriesRow: 'n/a', seriesNumeric: false, seriesSourceD1: false }
  if (!logs.length) return none
  const read = (t) => {
    const v = t.split('\n').filter((l) => /^\s*verdict:/.test(l))
    return { lines: v.length, state: v.length ? v[0].replace(/^\s*verdict:\s*/, '').trim().split(/\s+/)[0] : '' }
  }
  const judgedOf = ({ t }) => t.includes('residual (window-aligned)') || VENDOR_WATCH_JUDGED.includes(read(t).state)
  const judgedLogs = logs.filter(judgedOf)
  const decided = judgedLogs[0] || logs[logs.length - 1]
  const t = decided.t
  const { lines, state } = read(t)
  const isJudged = judgedLogs.length > 0
  const utc = (t.match(/^=== .*\butc=(\S+)/m) || [])[1] || ''
  const rows = Array.isArray(series) ? series.filter((r) => r && typeof r === 'object') : []
  const row = isJudged && utc ? rows.find((r) => r.at === utc) : null
  const seriesRow = !isJudged ? 'n/a' : row ? 'found' : (utc && rows.length && utc < String(rows[0].at)) ? 'aged-out' : 'missing'
  return {
    logsSince: logs.length, judgedLogs: judgedLogs.length, log: decided.f, state, verdictLines: lines,
    refusal: isJudged ? '' : (VENDOR_WATCH_REFUSALS.includes(state) ? state : state ? `unrecognised:${state}` : 'no-verdict'),
    hasWindowLine: t.includes('residual (window-aligned)'), hasDiagnosticLines: t.includes('NOT the verdict') && t.includes('residual against that'), hasKnownCi: t.includes('known CI spend'),
    seriesRow, seriesNumeric: !!row && typeof row.ledger_month_used === 'number', seriesSourceD1: !!row && row.ledger_source === 'd1',
  }
}
export const vendorWatchWindowAligned = ({ logsSince, refusal, verdictLines, hasWindowLine, hasDiagnosticLines, hasKnownCi, seriesRow, seriesNumeric, seriesSourceD1 }) =>
  logsSince === 0 ? 'PENDING — no odds-daily-vs-vendor log dated 2026-11-02 or later: the first scheduled run after Task 1 has not committed one'
  : refusal ? `PENDING — no log has judged the window yet; the newest says ${refusal === 'no-verdict' ? 'nothing (it has no verdict line: the run failed before judging, on a relay error or an unusable reading)' : refusal}; that is the watch's honest answer or a transient failure, neither the done condition nor a regression`
  : verdictLines !== 1 ? `FAIL — the judged log carries ${verdictLines} verdict lines, expected exactly 1`
  : !hasWindowLine ? 'FAIL — the judged log reached a verdict without a "residual (window-aligned)" line: the watch is not judging the window'
  : !hasDiagnosticLines ? 'FAIL — the judged log has no labelled UTC-day diagnostic ("NOT the verdict" and "residual against that")'
  : !hasKnownCi ? 'FAIL — the judged log has no "known CI spend" line, the operand the residual subtracts'
  : seriesRow === 'aged-out' ? 'PENDING — the judged run\'s series row has aged out of the 90 rows the watch keeps, so its stored baseline can no longer be read'
  : seriesRow !== 'found' ? 'FAIL — the judged run stored no series row (none has the log\'s utc stamp as its at): the next window has no baseline'
  : !seriesNumeric ? 'FAIL — the judged run\'s series row has no numeric ledger_month_used, so the next window has no baseline'
  : !seriesSourceD1 ? "FAIL — the judged run's series row has a ledger_source that is not 'd1': a KV fallback was stored as a baseline"
  : 'PASS'
// The defect this exists to catch: a run reached a verdict and the window-aligned line is not in it.
vendorWatchWindowAligned.mustFailOn = { logsSince: 1, refusal: '', verdictLines: 1, hasWindowLine: false, hasDiagnosticLines: true, hasKnownCi: true, seriesRow: 'found', seriesNumeric: true, seriesSourceD1: true }

/// Check 9 — has the repeat of Task 2b, after the registration fix, shown that an abandoned CFL call keeps its refund and its tally?
///
/// docs/CC-CMD-2026-10-13-vendor-residual-window.md, done condition 4. Task 3 registered the whole /cfl/odds-probs call with ctx.waitUntil; whether the edge keeps it running after a
/// client disconnect is shown only by running scripts/cfl-abort-experiment.mjs again, with the owner's fresh approval of up to 12 Odds API credits, after the deploy. The run commits
/// its artifact. A REPEAT is an artifact the calibrated schedule made, which records `latency_samples_ms`; the first run (2026-11-01, `abort-loses-refund-and-tally`) predates the
/// fix and the schedule and is not one. With no repeat the item is PENDING (waiting on the owner's approval). The NEWEST repeat decides, because it reflects the current code.
/// INCONCLUSIVE is PENDING, with its reason. A lossy verdict is FAIL: the claim "the fix holds" is refuted. (Dispatch only after the deploy run is green: a repeat against the
/// unfixed Worker would be lossy and would read as a regression.)
export const cflAbortArtifactFiles = (names) => names.filter((f) => /^cfl-abort-experiment-\d{8}T\d{6}Z\.json$/.test(f)).sort()
/** `arts` is [{ f: filename, a: parsed artifact }] from cflAbortArtifactFiles, oldest first. Pure. */
export const cflAbortRepeatPayload = (arts) => {
  const repeats = arts.filter(({ a }) => a && typeof a === 'object' && Array.isArray(a.latency_samples_ms))
  if (!repeats.length) return { artifacts: arts.length, repeats: 0, file: '', verdict: '', effective: null, calls: null, byDelta: null, hitDelta: null }
  const { f, a } = repeats[repeats.length - 1]
  const ph = (a.deltas && a.deltas.aborted_phase) || {}
  return {
    artifacts: arts.length, repeats: repeats.length, file: f, verdict: typeof a.verdict === 'string' ? a.verdict : '',
    effective: typeof a.aborted_effective === 'number' ? a.aborted_effective : null, calls: typeof a.aborted_calls === 'number' ? a.aborted_calls : null,
    byDelta: typeof ph.by_site === 'number' ? ph.by_site : null, hitDelta: typeof ph.hit === 'number' ? ph.hit : null,
  }
}
export const cflAbortRepeatLosesNothing = ({ repeats, verdict, effective, calls, byDelta, hitDelta }) =>
  repeats === 0 ? "PENDING — no repeat of the CFL abort experiment since the fix (an artifact that records latency_samples_ms): it needs the owner's fresh approval of up to 12 Odds API credits"
  : !verdict ? 'FAIL — the newest repeat has no verdict string'
  : verdict.startsWith('inconclusive') ? `PENDING — the newest repeat was ${verdict}, which says nothing about the fix; it needs another run`
  : verdict !== 'abort-loses-nothing' ? `FAIL — the newest repeat returned ${verdict}: a client that abandons /cfl/odds-probs still loses its refund or its tally with the fix deployed`
  : !(typeof effective === 'number' && effective >= 3) ? `FAIL — the newest repeat says abort-loses-nothing with ${effective} cut calls; the verdict needs at least 3`
  : (byDelta !== 0 || hitDelta === null || hitDelta !== calls) ? `FAIL — the newest repeat says abort-loses-nothing but its aborted phase moved by_site ${byDelta} and tallied ${hitDelta} of ${calls}: the artifact contradicts its verdict`
  : 'PASS'
// The defect this exists to catch: the repeat came back lossy, so the registration did not keep the call alive on this route.
cflAbortRepeatLosesNothing.mustFailOn = { repeats: 1, verdict: 'abort-loses-refund-and-tally', effective: 5, calls: 5, byDelta: 6, hitDelta: 0 }

/// Did the fixed `Commit results` step of deploy.yml's `verify` job work on a real deploy?
/// docs/CC-CMD-2026-09-14-git-state-swallow-sweep.md, the STAGED item "the fixed `Commit results`
/// step on a real deploy" (fixed 2026-11-19, `1bb8b9b`). `found` is false until a Deploy run created
/// after the fix has a `verify` job that actually RAN: a run stopped at a deploy gate skips `verify`
/// and tests nothing, so it is PENDING, never FAIL.
export const deployCommitResults = ({ found, deployConclusion, stepConclusion, pushed, errorLines }) =>
  !found ? 'PENDING — no Deploy run since the fix has reached its verify job'
  : (deployConclusion === 'success' && stepConclusion === 'success' && pushed && errorLines === 0) ? 'PASS'
  : `FAIL — deploy ${deployConclusion}, Commit results ${stepConclusion}, ${pushed ? 'pushed' : 'no "Pushed verification note" line'}, ${errorLines} error line(s) in the step`
// The defect it exists to catch: the step ran and failed, or claimed nothing and errored.
deployCommitResults.mustFailOn = { found: true, deployConclusion: 'failure', stepConclusion: 'failure', pushed: false, errorLines: 1 }

/// Check 11 — AFL round discovery finds the round on a real in-season slate.
///
/// docs/CC-CMD-2026-11-24-afl-round-discovery-sends-a-date-range.md. The fix was proven from a runner against real ESPN on PAST
/// dates under a pinned clock (afl-round-live-check.yml, run 45489913728); AFL has no fixtures until 2027, so the one thing
/// that proof cannot say is that discovery works on the slate in front of it. This says it, on the first day it can.
///
/// THE REFERENCE IS NOT THE CODE UNDER TEST. `expectedRound` comes from the relay's /v2/games adapter, which reads each ESPN
/// event's own week.number by a different code path than _discoverAFLRound does; deriving it with the resolver's own reads would
/// verify the copy. PENDING is the honest state off-season: a window with no game carrying a round has nothing to prove, and
/// calling it FAIL would be a red nobody could clear (the defect this file's header exists to prevent). Only a game that the
/// relay reports with a round, for which the resolver finds no round or a different one, is a regression. Round 0 (the Opening
/// Round) is a round, so null is tested strictly.
export const aflRoundInSeason = ({ gamesInWindow, expectedRound, discoveredRound }) =>
  gamesInWindow === 0 ? 'PENDING — no AFL game with a round in the ten-day window the resolver reads (off-season until 2027); nothing to read'
  : discoveredRound === null ? `FAIL — the relay reports a round-${expectedRound} game in the window and the resolver found no round for its home club`
  : discoveredRound !== expectedRound ? `FAIL — the resolver found round ${discoveredRound}; the relay's own adapter reports round ${expectedRound} for the same game`
  : `PASS — ${gamesInWindow} game(s) in the window; the resolver found round ${discoveredRound}, the one the relay's adapter reports`
// Games exist in the window and the resolver finds nothing: the defect the CC-CMD was written for.
aflRoundInSeason.mustFailOn = { gamesInWindow: 6, expectedRound: 18, discoveredRound: null }

/// Checks 12 and 13 — the relay serves an AFL game its OWN Squiggle tip: a FINAL (12) and a REGULAR-SEASON game (13).
///
/// docs/CC-CMD-2026-11-24-afl-finals-round-and-journalism-club-match.md, Part C (finals) and docs/CC-CMD-2026-11-24-afl-squiggle-reads-and-the-round-label.md, Item 5
/// (the regular season in 2027). Both were proven on the finished 2026 season (the 2026-09-05 Adelaide v Western Bulldogs final: the relay used to serve March's 47.29
/// for it; its own tip is 68.60); neither has happened since, and a Squiggle numbering that moves in 2027 (its docs: the season starts at round 1 from 2027) would
/// put every regular tip one round off. These say it, on the first day a game of that kind is in the window.
///
/// THE REFERENCE IS NOT THE CODE UNDER TEST. The relay joins a final to Squiggle by its two clubs and its Melbourne kickoff DAY (src/afl-squiggle.js) and a regular game
/// through ESPN's week read as Squiggle's round. The reference here joins by Squiggle's own games list, the EXACT kickoff instant (ESPN's event.date against Squiggle's
/// unixtime) and the clubs, then reads that game's tip with `?q=tips;game=ID`: another path to the same row. PENDING is the honest state when there is nothing to
/// compare: no game of that kind in the window, no Squiggle tip for ESPN's game yet, or a relay with no journalism context (gated on KALI_AFL_TOKEN). Only a served tip that
/// is missing or differs from the reference is a regression.
const aflGameTip = (noun, when) => (counts) => {
  const { reference, expectedHome, served } = counts;
  const n = counts[noun === 'final' ? 'finalsInWindow' : 'gamesInWindow'];
  return n === 0 ? `PENDING — no AFL ${noun} in the ten-day window the relay reads (${when}); nothing to read`
  : reference !== 'found' ? `PENDING — Squiggle has no tip for ESPN's ${noun} yet (or the reference could not join it); nothing to compare`
  : served === 'absent' ? `PENDING — the relay serves no journalism context for the ${noun} (it is gated on KALI_AFL_TOKEN)`
  : served === null ? `FAIL — Squiggle has a tip for the ${noun} (the home club at ${expectedHome}) and the relay served none`
  : Math.abs(Number(served) - expectedHome) > 0.005 ? `FAIL — the relay served ${served} for the ${noun}'s home club; Squiggle's own tip for that game is ${expectedHome}`
  : `PASS — ${n} ${noun}(s) in the window; the relay served ${served} for the first, the tip Squiggle gives that game`
}
export const aflFinalsTip = aflGameTip('final', 'the finals are in August and September')
// A final in the window, Squiggle's tip for it known, and the relay serving another game's tip (the March one, the defect this was written for).
aflFinalsTip.mustFailOn = { finalsInWindow: 3, reference: 'found', expectedHome: 68.6, served: 47.29 }
export const aflRegularTip = aflGameTip('regular-season game', 'the season is March to August')
// A regular game in the window and the relay serving the tip of another round (a numbering that moved).
aflRegularTip.mustFailOn = { gamesInWindow: 6, reference: 'found', expectedHome: 62.49, served: 71.48 }

export const VERDICTS = {
  closing_after_opening: closingAfterOpening,
  soccer_opening_coverage: soccerOpeningCoverage,
  epl_brief_event_grounded: eplBriefEventGrounded,
  recap_names_a_scoring_play: recapNamesScoringPlay,
  thread_notes_cleanup: threadNotesCleanup,
  d1_write_provenance: d1WriteProvenance,
  odds_budget_charging: oddsBudgetCharging,
  vendor_watch_window_aligned: vendorWatchWindowAligned,
  cfl_abort_repeat_loses_nothing: cflAbortRepeatLosesNothing,
  deploy_commit_results: deployCommitResults,
  afl_round_in_season: aflRoundInSeason,
  afl_finals_tip_in_season: aflFinalsTip,
  afl_regular_tip_in_season: aflRegularTip,
}
