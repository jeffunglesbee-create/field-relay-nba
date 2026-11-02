# Session 2026-11-01 (afternoon) — Task 3: the CFL odds call runs under ctx.waitUntil

**Date:** 2026-11-01 · **Repo:** field-relay-nba · **Branch:** main
**HEAD progression:** `1f097a3` → `6589bc1` (the fix, its checks, the review fixes, the documents) → `this close-out` (this close-out) → ``84be1f5`` (the refusal-streak list, a separate fix)
**Task:** the owner's order "Build task 3", i.e. `docs/CC-CMD-2026-10-13-vendor-residual-window.md`, Task 3 (option 2 of `docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md`, held since 2026-10-18 and unheld by that order).
**Odds API credits spent:** 0. **Worker code changed:** `src/index.js` (the route passes `ctx`; `handleCFLOddsProbs` registers the whole call), comments only in `src/budget-helpers.js`. **Deploy:** run 41330484626 (success, 2026-11-01 17:25Z).

## What was built

| Piece | Where | Proved by |
|---|---|---|
| `handleCFLOddsProbs(env, ctx)` throws if `ctx.waitUntil` is missing (before anything is charged), starts the original body unchanged as `cflOddsProbsPipeline(env)`, registers that promise with `ctx.waitUntil` in its synchronous segment and returns it, so the response, `reconciled` included, is unchanged | `src/index.js` | `scripts/check-cfl-pipeline-registered.mjs`: 76 assertions (12 static, 64 executed) over 13 scenarios; `scripts/mutate-cfl-pipeline-registered.mjs`: 52 of 52 (47 mutations caught by the clause they break, 5 benign edits left green) |
| The abort schedule is cut from the median of three confirmed HIT calls (fractions 0.2 to 0.6), and "loses nothing" needs 3 cut calls; a loss is conclusive with any | `scripts/cfl-abort-experiment.mjs` | self-test 35; `scripts/mutate-cfl-abort-experiment.mjs`: 23 of 23 |
| Done condition 4's executor: check 9 of `verify-staged-items` reads the newest calibrated artifact | `scripts/staged-verdicts.mjs`, `scripts/verify-staged-items.mjs` | `staged-verdicts-check` 98; `scripts/mutate-staged-verdicts-vendor-watch.mjs`: 37 of 37 |
| Check 8's parser rebuilt: a log with no verdict line (a relay error) is PENDING, the judged run's own series row is joined by its `utc=` stamp, every refusal state is tested against the watch's source | `scripts/staged-verdicts.mjs` | the same checker and harness |
| An absent tally or `by_site` in a drift sample throws instead of reading as a quiet zero; a null ledger makes a window unmeasured | `scripts/analyze-cfl-reconcile-gap.mjs` | self-test 17; mutants 15 of 15 |
| The criterion for "the fix works", fixed before the data exist | the CC-CMD, Task 3 | gap at most 48 credits on a day with at least 100 HIT calls; fewer HIT calls is inconclusive |

## The two independent reviews

Both were run with skeptics that tried to refute each finding. Their findings were read, not summarised.

1. **The first** found the check happy-path-only and partly echoing its own stubs. The final version slices the real handler out of the source.
2. **The second** (three lenses: the verifier and gates, the rewritten check and its harness, the documents against the code; then two skeptics per finding) found 29. The ones that changed the work:
   - The check stubbed the refund, so removing an `await` on the D1 batch, the site counter or a KV write passed. It now runs the real `reconcileOddsCredit` and its refund against a fake D1 and KV with a pinned clock where every operation takes time, and an operation that starts while another is in flight, or finishes after the call returned, is a finding. Three cases, because a cache HIT keeps 0 credits and cannot show a wrong `kept` bind.
   - The `ctx.waitUntil` stub ignored `this`; in workerd an unbound call throws `Illegal invocation` after the call has been charged (confirmed on a local workerd). It now throws the same.
   - The reconcile's response argument and the price were only compared to 6. Both are now identity and a cost-model scenario at 7.
   - The registered promise's identity was tested by time ordering, which a timer passes. The reconcile is now held open and the registered promise must stay pending, then settle right after the call.
   - The vendor-watch check turned a relay error into a red run (`FAIL`, 0 verdict lines) and read the LAST series row, so a later bad run turned a PASS into a FAIL. Both fixed, with a mutation harness, because 8 of 20 mutants survived the first tests: a test looped over the very list it was checking.
   - The abort schedule reached 0.95 of one sample, so a call a little faster than the sample finished before its abort (23 runs of 40 at 20% jitter) and the verdict threw away the aborts that did take effect.
   - The documents: the prediction paragraph re-statused tests, which the judge's prompt ("rules exactly as committed on 2026-10-18") would not have read; a Status line still said the mechanism was SHOWN; a done condition contradicted the armed read; stale counts. See "Documents" below.

## Documents, and one decision about the calendar experiment

The prediction document for the CFL post-window now carries facts and annotations, not new rules. The judge scores every test as committed on 2026-10-18 and adds one sentence to H-whole, spec 2.3 and M (c): measured after an intervention that targets the stranded part these tests measure; not evidence about CFL's contribution in either direction. The VOID rule is unchanged: it is commit-based, and this change is committed on 2026-11-01. The judge's prompt (`trig_019aQvU36rYwZ7PqjaMnV5ut`) was NOT edited. The armed read of 2026-11-07 (`trig_01E9kMQiyKXENeyzuxNFBNsV`) WAS edited, to carry the document's criterion in place of "the gap is 0 or close to it".

## Verified end to end vs staged

**VERIFIED:** the whole change in CI on `6589bc1` (pushed 17:14:50Z): Deploy RELAY Worker run 41330484626 success (deploy step 17:25:40Z; its post-deploy gate "confirm relay is live" and "the routes this deploy touched still answer" passed), Repo guards 41330484615 (which includes the two steps that cannot run in the sandbox), Runner read path and CFL gap guards 41330484619 and Workflow YAML Gate 41330484774 success. The relay answers after the deploy: `bash scripts/relay-look.sh "/health" "/budget/odds?date=2026-11-01"`, run 41331595034, both HTTP 200 (the second shows `site_ceilings.handleCFLOddsProbs` null, unchanged).

**NOT verified live:** that `/cfl/odds-probs` answers 200 with the new code, and that a registered promise survives a disconnect. Both need a call to a route that charges 6 Odds API credits before its fetch, and no Odds API call is made without the owner's approval. The first is also covered by the check (the real handler against stubs, with the route passing `ctx`) and by the client's own page-load traffic, whose first rows will show in the drift series; the second only by the repeat.

**RAN 2026-11-02, done condition 4 MET: `abort-loses-nothing`** (run 41413685131, dispatched 08:31:20Z after the owner's "Task 2b approved" at 00:24Z, in the dead-quiet CFL hours and after the vendor reading; artifact `outbox/cfl-abort-experiment-20261102T083943Z.json`: 5 of 5 aborted calls cut at 150 to 451 ms, aborted phase `by_site` 0 and tally rows +5, 6 vendor credits spent, 0 over-record left; the staged verdict reads PASS). Staging record, as written: the repeat of Task 2b after the deploy. Blocked by: the owner's fresh approval of up to 12 Odds API credits (`GET /cfl/odds-probs` charges 6 before the fetch and keeps them on a miss). Unblocked when: the owner dispatches `cfl-abort-experiment.yml` with `approval` equal to `APPROVED: up to 12 Odds API credits for the CFL abort experiment`, after the deploy run is green, on a quiet CFL hour (a repeat against the unfixed Worker would be lossy and read as a regression). Verify: `node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(a.verdict,a.aborted_effective+"/"+a.aborted_calls,a.deltas.aborted_phase.by_site,a.deltas.aborted_phase.hit,a.latency_samples_ms.length)' outbox/cfl-abort-experiment-<stamp>.json` prints `abort-loses-nothing` with at least 3 cut calls, `0`, the number of calls, and `3`. The verifier is `cfl_abort_repeat_loses_nothing` in `staged-verification.yml`. Part 2 of the done condition (the busy-day read of 2026-11-07) is read by hand on 2026-11-08 (`trig_01E9kMQiyKXENeyzuxNFBNsV`).

## Gates

Offline, on the committed tree: the 50 `guards.yml` steps pass except two that cannot run here and fail the same way on a clean copy of `main` (`check-bsd-frame-contract`: `list page 1 failed: HTTP 0`, no egress; `check-archive-date-keying`: `RELAY_SHARED_SECRET must be set`). The first 120 `deploy.yml` steps pass except three Cloudflare-token bootstraps (`KV namespace ID not found`). Same on a clean copy.

## Open

- The owner's approval for the repeat (above). A one-line reply "APPROVED: up to 12 Odds API credits for the CFL abort experiment" is the approval; I will not dispatch without it.
- Not decided here: whether `getWCPregameLambdas` (gap non-zero in 12 of 38 samples, range -20 to +44, reached from `handleV2Games` as well as AmbientDO) gets the same registration.

## Seen, not fixed

- The header comment above `handleCFLOddsProbs` says the route costs 2 credits per call; it charges 6 (`check-odds-calls-guarded` pins 6).
- A vendor fetch that throws goes to the catch branch: the charge stands with no reconcile. Not changed (the route's existing behaviour; named in the prediction document as a reason the stranded figure will not be exactly 0).
- `scripts/watch-odds-daily-vs-vendor.mjs` sums `credits_kept` with `Number(r.credits_kept) || 0` in a loop the absence-collapse gate cannot see.
- The jubilant-bassoon client does not read `reconciled`, so no client change was needed or made.
