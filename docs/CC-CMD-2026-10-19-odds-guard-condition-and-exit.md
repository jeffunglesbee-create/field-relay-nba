# Claude Code Command — the guard's condition and its refusal path

**Date:** 2026-10-19
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** CC, from the second adversarial review of the odds gate
(`wf_710edc9e-6f5`, 2026-10-19, against `79b17ebc` = pushed `1cca6b40`), which
was stopped by the owner. These are its remaining "teeth" findings, apart from
guard ordering, which is
`docs/CC-CMD-2026-10-19-odds-guard-before-fetch.md`. Take them in order, one
commit each. Tasks 3 and 4 start with a decision: fix, or record why not.

---

## TASK 1 (high) — a conjunct in front of the verdict

`check-odds-calls-guarded` credits any `if` condition that merely CONTAINS the
negated verdict. `X && !(await G(...))` passes for any X, so a guard that is
never evaluated still counts.

- **P3, the proxy, one character:** `!oddsBillablePath(cleanPath) && ...`
  meters only the free paths. All 25 deploy-path odds steps stay green, and
  the gate prints `ok ... [/odds/* proxy]`.
- **S3, fetchSportOddsHistorical (30 credits a call):** `if (!_seen &&
  !(await consumeOddsCredit(...)))`.
- **R1:** a `let` verdict overwritten by an env flag before its test.
- **The 2026-10-19 fixture "a verdict inside a compound condition, ending in a
  throw, IS a guard" passes for exactly this reason.** It was written as an
  equivalent and encodes the hole. Correct it in the same commit.

**Fix:** credit only a condition that is exactly `!(await G(...))` or `!x`
(with `x` a `const`, never reassigned). Allow one conjunct,
`oddsBillablePath(cleanPath) &&`, written exactly, at the proxy only. Add red
fixtures for `env.FLAG && !(await G(...))` and
`!oddsBillablePath(p) && !(await G(...))`. Add P3, S3 and R1 to the deploy
harness as must-red.

## TASK 2 (medium) — a refusal path that still reaches the vendor

`consequentExits()` checks only that the last statement starts with `return` or
`throw`.

- **P4:** `return relayFetch(targetUrl, ...)` on refusal ("serve what the edge
  holds") is a billed call on a cache miss.
- **E7:** a `throw` inside a try/catch that only logs is swallowed, and the
  fetch below it runs. The live log-only self-test still printed 9 of 9 on
  this mutant.

**Fix:**
- Reject a final `return` whose expression calls a fetch-like helper.
- Credit `throw` only when no enclosing `catch` swallows it.
- Add P4 and E7 to the harness as must-red.

## TASK 3 (decide first) — billed calls the scan cannot see

`BILLED` matches only a literal vendor host or `${ODDS_BASE}`. A new route built
with the existing `oddsUrl()` / `oddsFetchWithFallback()` helpers is invisible:
the reviewer's N1 (an unguarded event-odds route) passed all 25 steps, with
`10 found, 10 accounted`.

Decide: either widen the scan to those helpers, counting them in
`EXPECTED_SITES`, or record in the checker's header that helper-built calls
are out of its scope, and which check owns them. Either way, the output's
coverage line must say which applies (Rule 91).

## TASK 4 (decide first, low) — three narrow ones

- **Shadowed kill switch.** A local `const ODDS_LIVE_PATH_404 = ...` inside
  `_fetchLiveOdds` is not the binding check-odds-live-disabled reads. This is
  ledger credits only: the vendor 404s and the monthly guard still runs.
- **Regex literals in the blanker.** `scripts/lib/blank-comments.mjs` does not
  tokenize them. 20 lines of src/index.js blank differently from acorn, and
  none of them is in a checked window today. A `/'/g` followed by a commented
  guard can credit a guard that is gone.
- **DONE 2026-10-19 (`9b665971`): the COVERAGE line is now counted.** It was hardcoded: It reads "4 of the 9 guard
  sites", but the red site edits bite at 3 sites; the live poll gets only
  must-stay-green edits. It also says the other 5 are covered by the checker's
  self-test, which in fact covers all 9. Compute both numbers.

## Done condition (Rule 89 artifacts)

- For each task fixed: its mutants are CAUGHT in a committed harness log, every
  equivalent stays green, and reverting the fix turns its own fixture red.
- For each task decided against: the reason is written beside the code it
  concerns, and the checker's coverage line states the limit.
- One green deploy.yml run on the final commit, with its run id recorded.

## FORBIDDEN

- No change to `src/` behaviour.
- Every currently CAUGHT case stays CAUGHT.
