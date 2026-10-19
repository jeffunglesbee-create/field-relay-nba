# CC session — the odds guard must run before the vendor fetch, 2026-10-19

`docs/CC-CMD-2026-10-19-odds-guard-before-fetch.md`, dispatched by the owner.
This is one of the three small CC-CMDs filed from the second odds-gate review.

**HEAD:** `b3c2b275` → `4b4a987c`, with 2 work commits. The harness runs
happened before a rebase onto `bfd7ba4f`, a census commit that touches no
`src/`, `scripts/` or `.github/`. Pre-rebase SHAs: `bb323b61`, `8c29d6b8`.
**Deploy run:** 39279546405 on `4b4a987c`, success: deploy and verify jobs. Repo guards run 39279531277 also succeeded.

## TASK 0 — premises, one command each

| premise | command | result |
|---|---|---|
| the checker is unchanged since `1cca6b40` | `git diff --stat 1cca6b40 HEAD -- scripts/check-odds-calls-guarded.mjs ...` | empty |
| today, every fetch-like call in a guard's span comes after the guard | probe over the 9 negated-guard sites (`outbox/odds-guard-before-fetch-2026-10-19.log` §1) | true at all 9; the proxy's block has one relayFetch, after its guard |
| "the guard must be a top-level statement of the function body" (the CC-CMD's own proposal) | the same probe, and `_fetchLiveOdds`'s structure | **false**: the live poll's guard sits inside a per-sport callback, so that rule would have blocked the deploy on correct code. Block containment was used instead |
| S1, S2, S4, S5, P1 and P2 pass the deploy path | the harness at `bb323b61`, with `--only`, over all 25 odds steps | all six NOT CAUGHT |

## What landed

| commit | what |
|---|---|
| `9b665971` | the harness gains the six must-red cases. A site case may carry several edits. `--only=` runs a labelled partial run. The COVERAGE line is counted, not typed. check-odds-reconciled excludes the harness by name |
| `4b4a987c` | **the rule.** Every fetch-like call in the span (`fetch`, `relayFetch`, `oddsFetchWithFallback`) must come after the crediting `if` ends, and must sit inside the block that holds it. A span with no such call does not count. The proxy is read to its closing brace |

## Done conditions (Rule 89)

1. **Fixtures:** "a guard after the fetch is not a guard" is red, and four
   more ordering fixtures are red with it. All five failed under the unfixed
   rule (log §3) and pass under the new one. The live-poll callback shape is
   green.
2. **Live self-test:** every guard site, moved below its next fetch, goes red:
   9 of 9 caught. The log-only test is still 9 of 9. A 2000-character comment
   after the proxy head no longer hides its guard. 31 of 31 self-tests pass.
3. **Harness:** 25 of 25 cases as expected at `8c29d6b8`, control green.
   - 19 mutants caught, including the six moved guards, each red at "Every
     odds call is charged to the monthly ledger".
   - 6 equivalents green.
   - A must-red edit now bites at 5 of the 9 guard sites. The other 4 are
     covered by the checker's own live self-tests, which run as a deploy
     step.
4. **Deploy:** run 39279546405 on `4b4a987c` succeeded. Its odds steps all passed, including "Every odds call is charged to the monthly ledger". For about 30 minutes the run listing reported it `queued` while its jobs had already run (15:38–15:50 UTC). Read the jobs endpoint, not the run list.

Rule 90 on the rule itself (log §4): 5 of 5 mutations caught, control green.
- ordering unchecked;
- block containment dropped;
- a no-fetch span counted;
- the 1600-character window restored;
- a fetch before the guard allowed.

## What this session got wrong, and the cost

- **The disk allowance filled.** The previous review's agents had left
  archive copies of the repo in the scratchpad. A fixture edit written at
  that moment truncated `check-odds-calls-guarded.mjs` at line 535. It was
  caught by `node --check`, restored from HEAD, and both edits were
  reapplied. Nothing broken was committed. The stale copies were deleted.
- **A shared /g regex.** The first version of the move self-test advanced
  `FETCH_CALL.lastIndex`. `matchAll()` starts from that index, so it would
  have hidden earlier calls from the scan. It was caught on reading the diff
  before commit, and a fresh regex is used.

## Closed in the sibling CC-CMDs as a side effect

- `odds-gate-false-reds` row 4: the 1600-character window half is done. The
  raw `indexOf` of the head stays open.
- `odds-guard-condition-and-exit` task 4, the hardcoded COVERAGE line: done
  in `9b665971`.

## Integration state (Rule 65)

CI only; `src/` is untouched and no relay contract changed.
check-odds-calls-guarded went from 1.61 s to 2.26 s (best of 3, in the
sandbox, `b3c2b275` vs `4b4a987c`). The new live test re-scans each guard's
file once per site.
