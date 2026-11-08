# Session 2026-11-08 — accounting-edges item 3 built as a PARKED patch, reviewed twice

**Task.** "Next item": item 2 of the 2026-11-07 "novel thinking" answer. The CFL VOID window (2026-11-08 to 2026-11-23) blocks *landing* a change to `reconcileOddsCredit`, not *building* one, so item 3 of `docs/CC-CMD-2026-10-23-odds-guard-accounting-edges.md` was built, proved and parked: a patch, its check, its mutants, a sweep of every gate, two independent reviews, and a landing runbook.
**Nothing landed.** No `src/` commit in this session. HEAD of `main` at the start and the end: `b9edf45` (an outbox-only watch commit); the work was done in throwaway copies and the artifacts are committed under `outbox/`.
**Read first:** the Status, rulings and holds of `docs/CC-CMD-2026-10-23-odds-guard-accounting-edges.md` (item 1 moved to Task 3 of the 09-16 CC-CMD; items 2 to 5 have no other owner), `outbox/odds-cfl-season-end-prediction-2026-10-18.md` ("What voids the experiment"), `docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md`.

## What was built (all in `outbox/`, prefix `odds-reconcile-landed-refund-`, suffix `-2026-11-08`)

| artifact | what it proves |
|---|---|
| `red-at-head` | the new check run against `src/budget-helpers.js` at 67b3f19: **26 of 42 pass, 16 fail**. A1 (cache hit, refund landed, mirror throws) reads state `error`, credits_kept 6 against used 0: the live 648-against-528 shape. A3 (receipt 10 against estimate 6) shows it is also an UNDERstatement. |
| `green-after` | the same check against the patched source: **42 of 42** |
| `mutants` | `scripts/mutate-reconcile-refund-landed.mjs`: **20 of 20 mutants caught**, each by the case meant to catch it (the module-scope hoist only by A6, the `_bumpSite` swallow only by A5, a rethrown tally write only by A10, accumulation only by A7) |
| `sweep` | every `check-*`/`mutate-*`/`lint-*`/`verify-*` command in `deploy.yml` and `guards.yml` (175) run on the unpatched and on the patched tree: identical exit codes except the two new scripts |
| `patch` | the diff against 67b3f19: 6 files, 450 insertions, 7 deletions; `git apply --check` clean on `main` b9edf45 |

**The fix.** One flag in `_reconcileOddsCredit`, `landed`, true only once the D1 correction batch RESOLVES, and the KV mirror in its own try. With `landed`, a mirror failure is a log line and a fixed `note` and the state stays what the receipt says; without it the throw reaches the outer catch exactly as before. A 1,120-cell factorial of HEAD against the patch (review 2) found behaviour changes ONLY where the batch resolved AND the mirror threw (96 cells), and the D1 ledgers and KV contents byte-identical in all 1,120.

**Premise tested first (Rule 100).** The CC-CMD says "the KV mirror is the only step after the D1 batch". Reading `_bumpSite` showed it also runs there, safe only because it swallows its own errors; the patch comment now says so and case A5 (every KV key throws) pins it.

## Two independent reviews, and what they changed

**Review 1** (workflow `wf_722fd05a-71c`, 4 lenses, 54 agents, on the FIRST version of the patch). **Caveat on the record:** the disk filled while it ran; the saved output file was empty and the journal kept all four reviewers' findings but only 17 of about 50 skeptic verdicts. The findings below are the reviewers' own; the blocker was reproduced again by me (`node scripts/check-scope-claims.mjs` after `git add`), and the rest were re-derived by the check's cases.
- **blocker** The new check was in the scope population of `scripts/check-odds-reconciled.mjs` and in neither list: `check-scope-claims` red in both workflows. My keyword-selected sweep had missed it. Fixed (both new scripts excluded, with the reason), and the sweep is now EVERY check and mutate command.
- **major** A D1 batch that rejects AFTER committing (a lost response; `D1_ERROR: Network connection lost` is in the repo's own record of live errors) would have been recorded `error` with the full estimate: the defect reintroduced for that branch, and a regression of two cases HEAD tallied right. **major** A charge that degraded open followed by a failed correction changed from `cache-hit` to `error`. **major (scope)** Flipping a rejected correction to `error` is not in item 3's words ("keep reporting the second as `error`" is about what is reported today). **Resolution:** the flip was removed; the patch is now the single flag. Those cases are pinned UNCHANGED (C, G1, G2, K).
- **check gaps, all added:** a failed correction with a receipt; a receipt above the estimate (A3); the mirror's WRITE throwing (A4); a vacuous charge precondition (now `used` is read between charge and reconcile); the persisted tally state never compared to the returned one.

**Review 2** (workflow `wf_12e579d7-294`, 3 lenses, 20 agents, on the smaller patch; 16 of 17 skeptic verdicts reproduced their finding). No blocker.
- **differential** 1,120 cells, 96 differ, **0 outside the claim, 0 inside it that fail to differ**. Minor: the workflow comment said "every branch" and "(8 of 8)" (fixed: the claim is scoped, no count in the comment). Minor: the exceptions to credits_kept = used were not all named; two classes were not (a degraded-open charge: **K**, now pinned; an ensure that throws once before the correction is attempted, a variant of C, **not pinned**). Minor: the 00:00Z straddle moves the tally's relation to the ledger (**H**, pinned; it is the one place the fix moves a case the wrong way, by coincidence: the ledger is wrong in both).
- **mutants** (40 new mutants written) **major** the check could not see `_bumpSite` stop swallowing (**A5**, M14); **major** per-case fresh imports hide state shared across calls in an isolate, so a module-scope `landed` survived (**A6**, M13). Minors, all added: accumulation of the tally (A7, M16), notes on A3/A4 (the injected fault fired), the day and month ledgers (M17, M18), a failed tally write must not fail the fetch (A10, M15).
- **landing** The declaration list was incomplete (see the runbook). The meaning of an `error` row changes at the deploy instant (one verdict did not reproduce this as a *change*: HEAD's `error` rows already mixed both readings, because `error` was also reported with no D1 or a failed batch; the runbook states the caveat as "mixed before, not-landed after"). No mechanical gate for "the judge's verdict commit exists": added. **The stored prompt of `trig_01QnrMSPjGZfAkL8HJKLc9BH` pointed at "the 10-23 CC-CMD" for the judge's verdict; the judge writes to the 10-18 counter CC-CMD and a new outbox document. Verified by reading both triggers, then corrected on 2026-11-08T01:07Z (only that clause).**

## KNOWN and NOT fixed (pinned in the check so a later change is a decision)

- **C** the correction rejected before it committed, the mirror fine: `cache-hit` while `used` holds the estimate (the mirror image of item 3; HEAD identical).
- **G2** a batch that commits then rejects with the mirror throwing: `error`, ledger corrected (HEAD identical). A rejected batch is not read as "nothing committed".
- **H** (moved by the fix) across 00:00Z the tally reads `cache-hit` kept 0 against used 6 where HEAD read `error` kept 6 = used 6; the ledger is identical.
- **K** a charge that degraded open (nothing charged) followed by a reconcile whose correction works takes the DAY ledger from 100 to 94: a refund for a charge that was never added. Identical at HEAD. It belongs with item 2's degrade-open family and is recorded there, not fixed here.
- The ensure-throws-once variant of C (above), and `landed` meaning "the batch resolved", not "reached the charged day".

## Verified vs STAGED (Rule 74)

- **Verified:** the numbers in the table above, by execution, on throwaway copies of 67b3f19 plus the patch (node 22.22, `node:sqlite`). The fake D1 models rejection before commit and commit-then-reject; **whether real D1 ever rejects after committing is UNMEASURED** (the repo's record lists `D1_ERROR: Network connection lost`, which does not say whether the batch ran). The patch is built not to depend on the answer.
- **STAGED: landing.** Blocked by: the CFL VOID window (2026-11-08 to 2026-11-23), the judge's verdict commit (the judge's VOID check has no `--until`, so a landing before the verdict reads as VOID), and the owner's go. Unblocked when: all three. Verify: the runbook in item 3 of the CC-CMD, step 6 (a read of `GET /budget/odds` with `used` against the sum of kept over ALL cells). The follow-up is armed: trigger `trig_01FFUveETSUTJeuudarUh5h7` (2026-11-24T16:30Z, this session); it lands nothing without both the verdict commit and the owner's go.

## Disk

The review run exhausted the session's disk allowance at about 23:49Z (about 11 GB of per-agent copies of the repo under `/tmp/rv-*`). Cleared by deleting named directories of my own review workflows one at a time; the second review used 2 MB workspaces. Lesson: a review prompt must say what to copy.
