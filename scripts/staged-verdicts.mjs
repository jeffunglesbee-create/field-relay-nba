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
export const d1WriteProvenance = ({ everEntries, controlEntries, dashEntries, windowHours, gameDaysInWindow }) => {
  for (const [k, v] of Object.entries({ everEntries, controlEntries, dashEntries, windowHours, gameDaysInWindow }))
    if (typeof v !== 'number') throw new TypeError(`d1WriteProvenance: ${k} is required`)
  // NEVER WROTE is not WENT SILENT, and collapsing them would make this
  // permanently red until the instrumentation ships — which is precisely the
  // "can never pass, so everyone ignores it" defect the verdict checker exists
  // to catch. The dataset held 0 d1-write entries when this was written.
  if (everEntries === 0)
    return 'PENDING — the provenance instrumentation has never written an entry; it is not deployed yet'
  if (controlEntries === 0)
    return 'FAIL — entries exist historically but none in the window; the instrument wrote before and has gone silent'
  if (dashEntries > 0)
    return `PASS — ${dashEntries} dash-scheme INSERT(s) recorded with provenance; the caller is named`
  if (gameDaysInWindow === 0)
    return `PENDING — ${windowHours}h window contains no day-after-game, and both observed writes landed on one; nothing to observe yet`
  return `PENDING — NOT OBSERVED: ${windowHours}h window over ${gameDaysInWindow} qualifying day(s), control present, no dash-scheme INSERT. Extend the window; do not close`
}
// The control missing is the ONE condition that is a failure: the instrument is
// silent, and a silent instrument reporting "no second writer" is the false
// negative this whole item exists to avoid.
d1WriteProvenance.mustFailOn = { everEntries: 12, controlEntries: 0, dashEntries: 0, windowHours: 48, gameDaysInWindow: 2 }

export const VERDICTS = {
  closing_after_opening: closingAfterOpening,
  soccer_opening_coverage: soccerOpeningCoverage,
  epl_brief_event_grounded: eplBriefEventGrounded,
  recap_names_a_scoring_play: recapNamesScoringPlay,
  thread_notes_cleanup: threadNotesCleanup,
  d1_write_provenance: d1WriteProvenance,
}
