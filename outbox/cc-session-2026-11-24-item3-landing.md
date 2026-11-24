# CC session 2026-11-24 — accounting-edges item 3 landed: a refund that landed in D1 is never recorded as `error`

**Task:** `trig_01FFUveETSUTJeuudarUh5h7` (fired 2026-11-24T16:30Z): the landing check for item 3 of `docs/CC-CMD-2026-10-23-odds-guard-accounting-edges.md`, then the owner's go.
**Result:** landed, one commit, no Odds API call, 0 credits. Spec: that item's "LANDING" list; patch `outbox/odds-reconcile-landed-refund-patch-2026-11-08.patch`; build record
`outbox/cc-session-2026-11-08-reconcile-landed-refund.md`.

## HEAD progression (field-relay-nba, branch `main`)

`05d78b9` (main when the landing worktree was cut; the WC cleanup record `05d78b9` was the tip) -> the landing commit (this document, the patch, the declarations, the HANDOFF entry).
Main had moved while the sweeps ran (golf round line, ESPN Task 0 instruments, from another session); the patch's four shared files had not changed, and the whole sweep was run again on the
new tip.

## The two conditions, as artifacts

1. **The verdict commit exists:** `git log origin/main --since=2026-11-24T14:00:00Z` lists `0f35c96` (14:41:43Z) and `1cdc521` (14:41:51Z); `outbox/odds-cfl-season-end-judgment-2026-11-24.md`
   matches `H-whole|H-none` 12 times and names M.
2. **The owner's go:** the AskUserQuestion answer "Go: land item 3" (asked once, at about 16:40Z, with the evidence and the known gaps C, G2, H and K in the question). Recorded in the
   CC-CMD as `OWNER GO item 3 landing: 2026-11-24`.

## What was run

| artifact | result |
|---|---|
| `git apply --check`, then `git apply`, patch on a clean worktree of main | clean, no `--3way` |
| new check against main's `src/budget-helpers.js` (`BUDGET_HELPERS_SRC`) | 26 of 42 pass, 16 fail |
| the same check, patched | 42 of 42 |
| `node scripts/mutate-reconcile-refund-landed.mjs` | 20 of 20 mutants caught |
| deploy.yml, every step before "Deploy to Cloudflare Workers" (run by `gate1/run-gates.py` in a clean worktree named `field-relay-nba`) | main 125 pass; patched 126 pass (one new step); 5 skipped (secrets) on both |
| guards.yml, every step | main 58 pass; patched 59 pass; 3 skipped (secrets); one red on BOTH trees (the BSD frame contract step: `HTTP 0`, this sandbox's proxy answers 403 to the live relay; green on the runner for main) |
| analyzer after the comment edits | `--self-test` 41 of 41; `mutate-analyze-cfl-reconcile-gap.mjs` 35 of 35 |

**The one difference found, and what it was.** In the first sweep the two trees ran at the same time and `check-deploy-commit-results.sh` was red on the patched tree only. It was investigated, not
explained away: alone it is green on both trees (59 of 59, 6 runs), the second sweep (sequential, current main) had it green, and with eight copies at once it goes red on MAIN's tree too (12 of 16)
and on the patched tree (17 of 24). A load sensitivity of that check, not an effect of the patch. Filed as `docs/CC-CMD-2026-11-24-commit-results-check-load-sensitive.md` with its probe and
done condition (the shared resource is NOT identified).

## What landed

`src/budget-helpers.js` (+25, -5: the `landed` flag in `_reconcileOddsCredit`, the KV mirror in its own `try`), `scripts/check-odds-reconciled.mjs` (the scope line), the new check and its mutation
harness, nine lines each in `deploy.yml` and `guards.yml`; the declarations of the CC-CMD's step 4 (listed in the CC-CMD); this document; the HANDOFF entry.

**The reading of an `error` row changed at the deploy.** Before it an `error` row could mean the mirror threw after the refund landed OR the correction did not land; after it, the correction
did NOT land. The tally key `(day, site, state, cache)` has no version, so on 2026-11-24 one `error` cell mixes both; **2026-11-25 is the first clean UTC day**. `stranded` stays right for both.

## Known and NOT fixed (unchanged; pinned in the check, so a later change is a decision)

C (a correction rejected before it committed, the mirror fine: `cache-hit` while `used` holds the estimate), G2 (a batch that commits and then rejects with the mirror throwing: `error`, ledger
corrected), H (moved by the fix: across 00:00Z the tally reads `cache-hit` kept 0 against used 6 where HEAD read `error` kept 6; the ledger is identical), K (a degraded-open charge followed by a
reconcile that works takes the day ledger from 100 to 94: item 2's family). **UNMEASURED:** whether real D1 ever rejects a batch it committed.

## Verified vs STAGED

Verified by execution: the table above; the post-deploy read in HANDOFF (Update bullet). **Not verified:** any CFL day with `error` rows after the deploy (the 2026-11-07 traffic is gone; the next
CFL day is in the 2027 season), so the invariant is read on today's data, which holds no `error` row, and exercised by the check on `node:sqlite`.
