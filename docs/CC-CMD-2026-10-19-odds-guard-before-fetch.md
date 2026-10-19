# Claude Code Command — the odds guard must run before the vendor fetch

**Date:** 2026-10-19
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Confidence gate:** >= 95 before any commit
**Status:** **DONE 2026-10-19.** Every fetch-like call must follow the crediting guard and sit inside its block. TASK 0 replaced the "top-level statement" proposal: it would have rejected the live poll's real guard. Shipped in `9b665971` and `4b4a987c`.
- The six mutants: NOT CAUGHT before, CAUGHT after.
- Harness 25 of 25; Rule 90 5 of 5.
- Deploy run 39279546405, green.
- Proof: `outbox/odds-guard-before-fetch-2026-10-19.log`. Session doc: `outbox/cc-session-2026-10-19-odds-guard-before-fetch.md`.
**Filed by:** CC. This comes from the second adversarial review of the odds gate
(`wf_710edc9e-6f5`, 2026-10-19), which ran against `79b17ebc`; it was pushed as
`293ffcf6..1cca6b40` and the code is unchanged. The owner stopped that review
after 7 of its 12 verifiers had returned, and asked for its findings as small,
separate tasks. This is one of three. The others are
`docs/CC-CMD-2026-10-19-odds-gate-false-reds.md` and
`docs/CC-CMD-2026-10-19-odds-guard-condition-and-exit.md`.

---

## The gap (three reviewers found it independently)

`scripts/check-odds-calls-guarded.mjs` credits a monthly guard found anywhere in
the enclosing function, provided its refusal ends in `return` or `throw`. It
never asks whether the guard runs BEFORE the vendor call. A guard placed below
the fetch refuses after the credits are spent, and all 25 deploy-path odds steps
stay green.

The reviewers' mutants, most plausible first:

| id | site | edit |
|---|---|---|
| S1 | `fetchSportOddsLive` (src/index.js) | guard block moved below the fetch ("charge what was actually fetched") |
| P1 | `/odds/*` proxy | a TTL special case for `/v4/events/` that returns `relayFetch` before the guard |
| P2 | `/odds/*` proxy | `relayFetch` moved above the guard; a refusal returns 429 after the vendor billed |
| S4 | `_captureClosingOdds` (src/ambient-do.js) | fetch first so "the closing line does not wait on D1", then the guard |
| S2 | wp-resolver | fetch promise started before the guard, awaited after it |
| S5 | `getWCPregameLambdas` | verdict named before the fetch, tested only after it |

The proxy is the one public billable route.

## TASK 0 — probe (Rule 100: one command per premise)

1. Run `git log --oneline -5`, and confirm `check-odds-calls-guarded.mjs` is
   unchanged since `1cca6b40`.
2. Reproduce S1, P2 and S4 in a fresh committed `git archive HEAD` copy.
   - Assert each anchor is unique.
   - Run every odds step of HEAD's deploy.yml, which is
     `scripts/mutate-deploy-odds-wrappers.mjs`'s selection.
   - Record the rc of each step.
3. For each of the 9 guard sites, list the fetch-like calls in the enclosing
   function that use the billed URL: `fetch(`, `relayFetch(`,
   `oddsFetchWithFallback(`, `fetch(buildUrl(`. This list is the premise the
   fix rests on.

## TASK 1 — the fix

In `scan()` and in `proxyGuarded()`:
- Require the crediting `if` to END before the first fetch-like call that uses
  the billed URL.
- The `if` must be a top-level statement of the function body, not inside
  `try`, a loop or another `if`.
- For the named form, the `!x` test must precede the fetch, not just the
  declaration.
- Bound the proxy block by bracket matching from its head, not by a
  1600-character window. See finding 10 in the false-reds CC-CMD; do both
  in the same commit only if they cannot be separated.

## Done condition (Rule 89 artifacts)

1. A fixture "a guard after the fetch is not a guard" is red, and "a guard
   before the fetch" is green.
2. The live log-only self-test gains a second mutation at every live site:
   the guard moved below its fetch. Every site goes red, and its output prints
   `N of N`.
3. S1, S2, S4, S5, P1 and P2 are added to `SITES` in
   `scripts/mutate-deploy-odds-wrappers.mjs` as must-red. The harness log is
   committed with them CAUGHT and every equivalent still green.
4. One green deploy.yml run on the commit, with its run id recorded.

## FORBIDDEN

- No change to `src/` behaviour.
- Do not loosen any existing assertion to make room.
