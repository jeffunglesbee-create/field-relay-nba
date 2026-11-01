# Claude Code Command — the vendor watch's residual compares two different windows

**Date:** 2026-10-13
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** A (defect in a watch) plus an open measurement
**Status:** PARTIAL — Task 1 built and pushed 2026-11-01 (`46a929f`; session doc `outbox/cc-session-2026-11-01-vendor-residual-window.md`); done condition 3 is the scheduled run of 2026-11-02. Task 2 (P5) MEASURED 2026-11-01: the CFL refund gap tracks the ledger's over-record (Pearson r 0.93, 11 windows), and its mechanism is SUPPORTED BY ONE CALL: Task 2b, run with the owner's approval, left no tally for 0 of 5 aborted calls against 5 of 5 control calls, and one aborted call kept its 6-credit charge (the other four are ambiguous between cut and never arrived; the share of the production gap that real disconnects cause is not shown). The fix (Task 3) was BUILT on 2026-11-01 by the owner's order; its done condition, a repeat of Task 2b plus a busy-day read, is staged (done condition 4) behind a fresh approval of up to 12 credits. Deployed 2026-11-01 17:25Z (`6589bc1`, run 41330484626).

## What was read

Closed day 2026-10-12, `outbox/odds-daily-vs-vendor-2026-10-13T0642.log`:

```
  2026-10-12 our counter : 3799 / 3800
  vendor billed that day : 3383
  known CI spend         : 200   (1 run(s), 0 undated)
  residual               : -616   tolerance 169
  unreconciled estimate  : 0 — no call kept an estimate for want of a receipt
  verdict: we-overcharge-ourselves
```

`no-header` is at zero, so the over-recording the 2026-10-11 documents named is
gone, and −616 remains. 2026-10-11's residual after its `no-header` estimate was
−636. This document does **not** name a cause. It lists the premises, the
command that tests each, and what has already been run.

## Premises and the command that tests each

| # | premise | command | result |
|---|---|---|---|
| P1 | the residual compares the UTC-day counter with a vendor window offset from it | the daily counter at the two vendor reading times, from `outbox/odds-site-drift-series.json` | **CONFIRMED, measured.** The vendor window is 10-12T05:48:55Z → 10-13T06:42:50Z. The daily counter read 507 at 10-12T02:50Z and 513 at 09:52Z, and 129 at 10-13T02:17Z. Realigned to the window, the daily counter is about **3,420, not 3,799**, so the offset accounts for about **380 of the 616**. ±10, because 10-13 06:42Z itself was not sampled. |
| P2 | the window-aligned remainder is real over-recording | `ledger_month_used` deltas in `outbox/odds-daily-vs-vendor-series.json`, which ARE taken at the vendor's reading times | **Partly measured.** Over the same window the monthly ledger moved **3,373** against a vendor bill of **3,383**. `odds-backfill` calls the vendor directly (`.github/scripts/odds-backfill.js`, `ODDS_API_BASE`), so its 200 is not in the ledger: relay spend ≤ 3,183, and the ledger is over it by **≥ 190**. The daily counter in the same window is over by about **240**. Both are just above the 169 tolerance. |
| P3 | D1 overload degrades explain it | direction | **REFUTED by sign.** A degrade-open is a vendor call the counter did NOT see. It pushes the residual positive, and this one is negative. |
| P4 | CI spend missing from knownCI explains it | direction | **REFUTED by sign.** Unrecorded CI spend sits in the vendor figure and is not subtracted. It makes the residual larger, not more negative. |
| P5 | `handleCFLOddsProbs` keeps charges it never reconciles | per-site `by_site` against the reconcile tally's `credits_kept`, in the same drift sample | **ANOMALY, not a cause.** At 10-12T20:28Z, `by_site` 666 against `kept` 66: a gap of 600. `fetchSportOddsLive` charges through the same `consumeOddsCredit` and shows no gap. But 600 is **larger** than the whole window-aligned excess (~240), so this gap cannot simply be over-recording. The tally reads the INTENT of a correction, not whether it landed (`creditsKeptBy`'s own comment). Next command: the Worker log's `[odds-reconcile]` and `[odds-reconcile-tally]` warnings for this site, and the same per-site comparison across every drift sample since 10-09. **Update 2026-11-01 (Task 2):** the drift series starts 2026-10-19, not 10-09, so 10-12 itself cannot be re-measured. Over the 11 windows that can be measured the gap does bear on the residual (Task 2, Result). |

## Task 1 — the watch reads the window it actually measures

`watch-odds-daily-vs-vendor.mjs` takes the vendor delta over its two reading
times and subtracts the **UTC day's** counter. Those are different windows by
~6 h at each edge, and spend is not uniform across the day: about 510 of
10-12's 3,799 landed before 05:48Z. The residual must be computed against a
counter taken at the same instants. `ledger_month_used`, already on every
series row, is exactly that. Print both: the window-aligned residual is the
verdict, and the UTC-day figure stays as a diagnostic, labelled.

Self-test: the real 10-12 pair must give a window-aligned residual of
`3383 − 3373 − 200 = −190` and NOT −616. Mutation: put the UTC-day counter back,
and the mutation must be CAUGHT.

## Task 2 — P5, before any fix

Run P5's command over every drift sample since 2026-10-09 and report per site:
`by_site − Σ kept`, the number of cache-hit calls, and whether the gap moves
with them. Read the Worker's `console.warn` output for the reconcile correction.
Name the site and mechanism only when a command has failed to refute it.

### Result, 2026-11-01

**Command:** `node scripts/analyze-cfl-reconcile-gap.mjs` (no network, no credits; 9 mutations caught when first run, 15 after the 2026-11-01 review; output committed as `outbox/cfl-reconcile-gap.json`). **Inputs, verified 2026-11-01:** `outbox/odds-site-drift-series.json` (60 samples, 2026-10-19T21:46Z to 2026-11-01T09:49Z) and `outbox/odds-daily-vs-vendor-series.json` plus the `known CI spend` line of each day's log. **Conditions:** CFL regular season and playoffs; one window (10-31 to 11-01) is unmeasured because the vendor's month reset inside it (vendor 36,032 to 171, ledger 47,989 to 189), so every figure below is over **11 of 12 windows**.

`by_site` is net of the corrections that landed; `credits_kept` is the reconcile tally's INTENT. For `handleCFLOddsProbs` one call charges 6 credits before the fetch; a cache HIT is then corrected by -6 in one D1 batch (day, site, month) and THEN tallied. `by_site - kept` is therefore a whole number of 6-credit calls whose charge stayed although the tally says it was refunded, or whose tally is missing.

1. **The gap is a whole number of 6-credit calls in 59 of 59 samples that carry CFL activity, never negative, and 0 in 23 of them.** The 23 are the quiet samples (4 to 18 calls in the day).
2. **It moves with cache-hit calls, in bursts.** Samples with 40 or more HIT calls: 21, gap above 0 in 21. Samples with fewer: 38, gap above 0 in 15. On 10-24 the day held 389 HIT calls and 75 calls' worth of 6 stayed charged (450 credits); on 10-29, 357 HIT calls and 98 calls (588); on 10-31, 158 and 13 (78).
3. **No other site shows it.** Six of the seven other sites with traffic have a gap of exactly 0 in every sample, up to 383 tallied calls in a day (`ambientCaptureClosingOdds`). The one other non-zero site, `getWCPregameLambdas`, ranges -20 to +44, is not a multiple of 6 (its cost varies), and has up to 918 tallied calls a day; it is the same charge-fetch-reconcile shape and is reached from a client request in `handleV2Games`, so "a request handler" does not by itself separate CFL from a healthy site. What does differ is the caller: the high-volume healthy sites are driven by Durable Object alarms and AmbientDO's server-side polling; CFL is the one high-volume site fed by browsers' own requests (`fetchCFLOddsProbs` in the client). That is consistent with H1 below and says nothing against H2.
4. **It bears on the residual.** Beside each vendor-series pair, the CFL gap added inside the same two instants (bounds from the 6-hourly samples):

   | window (UTC) | vendor Δ | ledger Δ | known CI | residual | CFL gap added | residual + gap |
   |---|---|---|---|---|---|---|
   | 10-20 04:41 → 10-21 04:36 | 872 | 917 | 140 | -185 | 192 | 7 |
   | 10-21 → 10-22 | 1103 | 1085 | 80 | -62 | 54 | -8 |
   | 10-22 → 10-23 | 1301 | 1251 | 140 | -90 | 90 | 0 |
   | 10-23 → 10-24 | 811 | 711 | 100 | 0 | 0 | 0 |
   | 10-24 → 10-25 | 2120 | 2333 | 200 | -413 | 462 | 49 |
   | 10-25 → 10-26 | 1323 | 1083 | 240 | 0 | 0 | 0 |
   | 10-26 → 10-27 | 378 | 228 | 180 | -30 | 36 | 6 |
   | 10-27 → 10-28 | 445 | 411 | 160 | -126 | 12 to 132 | -114 to 6 |
   | 10-28 → 10-29 | 636 | 752 | 120 | -236 | 96 to 348 | -140 to 112 |
   | 10-29 → 10-30 | 650 | 1038 | 140 | -528 | 570 to 702 | 42 to 174 |
   | 10-30 → 10-31 | 445 | 691 | 160 | -406 | 198 | -208 |

   Sum of the 11 residuals **-2,076**; sum of the CFL gap midpoints **1,962**; Pearson r between the gap and the over-record **0.925**; in **10 of 11** windows the residual plus the gap is within 60 of zero somewhere in its bounds. The outlier is 10-30 to 10-31: 208 credits of over-record that the CFL gap (198) does not account for. In 10-24 to 10-25 and 10-29 to 10-30 the gap exceeds the over-record (by 49, and by 42 to 174), which 6-hourly sampling and a vendor window offset by hours can produce.

**What this changes.** The 2026-10-13 text of this document said the P5 gap was "bigger than the thing it would be fixing" (600 against about 240, for 10-12 alone, from one sample on a UTC day compared with an offset window). On the 11 windows that can be measured the gap is **the same size as the over-record**, and the ledger sits above the vendor by roughly what CFL holds. The 2026-10-18 owner ruling ("do not fix the over-record yet") is not touched by this; what changes is that Task 2's second done condition can no longer be met by "shown not to bear on the residual".

**Premises, each with the one command that refutes it (Rule 100), and what the command said:**

| # | premise | command | 2026-11-01 |
|---|---|---|---|
| H1 | A client that disconnects mid-request stops the handler before the refund and the tally (the awaited continuation is cancelled) | `npm install --no-save miniflare@4 && node scripts/cfl-abort-local-workerd.mjs` (output `outbox/cfl-abort-local-workerd-20261101.txt`): a handler of the same shape on local workerd (miniflare 4, workerd 1.20260730.1), 54 calls, no network, no credits, with a positive control | **UNDECIDED, AND THE LOCAL INSTRUMENT IS INVALID.** The calls aborted during the reconcile still completed charge, refund and tally, but so did the positive control, a handler that checks `request.signal` and stops when it is aborted (6 of 6, through miniflare's Node proxy and directly on workerd's socket). A run that cannot see a disconnect cannot say the continuation survived one. Whether Cloudflare's edge propagates a disconnect to a production Worker is not testable locally; only Task 2b can decide it. The client does not time out by itself: `fetchCFLOddsProbs` in jubilant-bassoon `src/legacy/field.js` calls `fetch(..., { cache: 'no-store' })` with no AbortController, so a disconnect needs a navigation, a closed tab or a dropped connection. **Task 2b, 2026-11-01, in production: SUPPORTED BY ONE CALL.** 0 of 5 aborted calls tallied, 5 of 5 control calls did, one charge left standing; for the other four the ledger cannot say whether they were cut or never arrived (Task 2b, Result). |
| H2 | The correction batch fails for another reason (a D1 error under load) and the tally still lands | the Worker's `[odds-reconcile] D1 correction failed` warnings for this site | **NOT TESTABLE NOW.** `wrangler.toml` has no observability block, so the warnings exist only for a live `wrangler tail`; enabling logs needs the owner's approval. What the series does say: degrade-open (D1 overload) is reported above 0 in 2 of 59 samples (gap 390 and 588) and is 0 on the other large days (10-24: 450, 10-30: 324, 10-28: 204). **Task 2b: not needed to explain the effect** (the ledger was idle); not excluded as a contributor on busy days. |
| H3 | The gap is lost tallies for calls that were correctly kept; the ledger itself is right | the sign of the window-aligned residual | **REFUTED.** If the ledger were right the residual would be 0 while the gap stayed. Nine of the 11 residuals are negative and two are exactly 0; residual plus the CFL gap is within 60 of zero in 10 of 11 windows when judged anywhere inside the gap's [lo, hi] bounds, and in 9 of 11 by the bounds' midpoints (the 10-29 and 10-30 windows are off by 108 and -208). |
| H4 | The `MAX(0, used + ?)` clamp in the correction | whether the gap is always a whole number of the call's charge and never negative | **REFUTED for CFL.** 59 of 59 whole multiples of 6; none negative. |
| H5 | The same defect at every site | `by_site - kept` per site | **REFUTED as a general reconcile defect.** Six of seven other sites: 0 in every sample. |

### Task 2b — the run that separates H1 from H2 (RAN 2026-11-01 with the owner's approval)

**Dispatched 2026-11-01T13:53Z after the owner's "cfl approved"; run 41313403502, artifact `outbox/cfl-abort-experiment-20261101T135557Z.json`. Result below. The paragraphs after the result are the staging record, kept as written: the script they describe (a schedule of 3 to 100 ms, 23 assertions, 14 mutations) has since been reworked, see Task 3's done condition for the calibrated schedule and the counts that now hold.**


**Result, 2026-11-01. Verdict `abort-loses-refund-and-tally`.** Cost: 6 vendor credits (the warm-up came back EXPIRED, a real vendor call; the confirmation was a HIT) and 6 credits of over-record left in the relay's ledger. The ledger was quiet (the two readings before the run are identical), 5 of 5 aborts took effect (at 3, 10, 25, 50 and 100 ms), and every call the client did not abort answered 200 and HIT.

| phase | calls | `by_site` change | `kept` change | tally rows added (of which HIT) |
|---|---|---|---|---|
| aborted | 5 | **+6** | 0 | **0** (0) |
| control (not aborted) | 5 | 0 | 0 | **+5** (+5) |
| 20 s later | | 0 | 0 | 0 |

The tally is the last step of the continuation. **0 of 5 aborted calls reached it; 5 of 5 control calls did and were refunded; nothing arrived late.** At least one aborted call also kept its 6-credit charge (`by_site` +6). The ledger was idle, so a D1 error under load is not what happened here: H2 is not needed for this effect.

**What it shows, and what it does not.** It shows that at least one abandoned call was cut: its 6-credit charge stood with no refund (`by_site` +6). The other four left no tally and no standing charge, which fits a cut after the refund as well as a call that never reached the Worker (a 3 ms abort can predate arrival), and the ledger cannot tell the two apart. So the mechanism is demonstrated for one call, not measured. It does not show how much of the production gap (75 calls' worth against 389 HIT calls on 10-24) is real browsers disconnecting: these 5 calls were abandoned on purpose, inside the reconcile window. The split among the other four aborted calls (never charged, or charged and refunded before the cut) is not recoverable, because the ledger keeps no count of charges. One run, n = 5. H2 is not excluded as a further contributor on busy days.

**For the vendor watch.** The run adds 6 credits the vendor billed that nothing else explains (residual +6) and 6 credits of over-record in the ledger (residual -6), both in the window that closes at the 2026-11-02 reading; they cancel, well inside max(50, 5% of the vendor's spend).

**What was staged:** `scripts/cfl-abort-experiment.mjs` and `.github/workflows/cfl-abort-experiment.yml`. It reads `GET /budget/odds` (CFL `by_site`, `kept`, tallied calls, HIT calls), sends a normal `GET /cfl/odds-probs` to warm the cache and a second to confirm `cf-cache-status: HIT`, then makes 5 calls that the client abandons after 3, 10, 25, 50 and 100 ms (only after a HIT was confirmed), then 5 normal calls as the control, and reads the ledger again after each phase and 20 s later. Verdicts: `abort-loses-nothing`, `abort-loses-refund-and-tally` (the continuation did not run: H1), `abort-loses-refund-keeps-tally` (the refund fails after the tally lands, an abort-triggered H2), `inconclusive:*` (ledger not quiet, abort not effective, control moved, cache not warm, warm-up failed). It was proved against a fake relay that can lose a continuation (23 assertions, 14 mutations caught) and never against the real one.

**What blocks it:** `GET /cfl/odds-probs` charges 6 Odds API credits BEFORE the vendor fetch and keeps them on a cache miss, and the standing rule is that no Odds API call is made without the owner's approval. **Cost, bounded:** at most 2 cold-cache calls (the warm-up and, if it was not yet HIT, its confirmation) = **at most 12 credits at the vendor**; the aborted calls are made only on a confirmed HIT, so they reach the edge cache, not the vendor. It can leave up to 5 x 6 = 30 credits of over-record in the relay's own ledger for the day (a lost refund is exactly what is being tested); the artifact states the number so that day's window-aligned residual can be corrected by hand (the tolerance is max(50, 5% of the vendor's spend)).

**What unblocks it:** the owner dispatches `cfl-abort-experiment.yml` with `approval` equal to `APPROVED: up to 12 Odds API credits for the CFL abort experiment` (the job refuses to send a request otherwise), on a day and hour with no CFL games and more than an hour from the 05:30Z vendor reading. A busy ledger returns `inconclusive:ledger-not-quiet` and costs only the warm-up.

**Verify:** `node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(a.verdict,a.aborted_effective+"/"+a.aborted_calls,a.ledger_overrecord_left_credits)' outbox/cfl-abort-experiment-<stamp>.json` prints a verdict that does not start with `inconclusive`, `5/5` aborted calls effective, and the over-record left.

**What each verdict decides:** `abort-loses-refund-and-tally` names H1 for production, and the candidate fix is to run the post-fetch reconcile under `ctx.waitUntil` so a disconnect cannot cancel it (a one-function change in `handleCFLOddsProbs`, to be proposed to the owner with the 2026-10-18 ruling in view, not made here). `abort-loses-nothing` leaves H2: the next step is the owner's approval to enable Workers Logs for one CFL day and read the `[odds-reconcile] D1 correction failed` count. A counter of charges per site in `odds_budget_site` would settle either case without an experiment, but it changes the charge batch and needs the owner's approval too.

## Task 3 — the fix (BUILT 2026-11-01 by the owner's order "Build task 3"; repeat of Task 2b pending approval)

**Landed 2026-11-01:** commit `6589bc1`; Deploy RELAY Worker run 41330484626 completed success (the Cloudflare deploy step at 17:25:40Z, the job at 17:26:30Z, the post-deploy `verify` job at 17:27:06Z); Repo guards 41330484615, Runner read path and CFL gap guards 41330484619 and Workflow YAML Gate 41330484774 also success. **Live, 17:28Z:** `scripts/relay-look.sh "/health"` answered HTTP 200 (run 41331595034). **Not verified live:** `/cfl/odds-probs` itself, which spends credits; the repeat of Task 2b is its proof. 

**Probe, 2026-11-01** (three independent readers, then my own runs of the gates): `handleCFLOddsProbs(env)` took no `ctx`; its one call site is the `/cfl/odds-probs` route in the fetch handler, where `ctx` is in scope. The only reader of the response's `reconciled` field in any of the four checkouts is `scripts/cfl-abort-experiment.mjs`, which copies `.state` into its artifact and never into a verdict; the client reads `ok`, `probs` and `remaining` only. `CONTRACTS.md` has no text about this route in either repo. This fix is **Option 2** of `docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md`, held on 2026-10-18; the owner's order lifts that hold, and that document's Note 2026-11-01 says so.

**What was built** (`src/index.js`): `handleCFLOddsProbs(env, ctx)` throws if `ctx.waitUntil` is missing, before anything is charged; starts the original body, unchanged, as `cflOddsProbsPipeline(env)`; registers THAT promise with `ctx.waitUntil` in its synchronous segment; and returns it. The charge, the vendor fetch, the reconcile and the tally are one promise, and the response is built from the same result. The platform documents that `waitUntil` work can run for up to 30 s after the client disconnects (workers/runtime-apis/context and workers/platform/limits); that it does so for THIS route is not shown until the repeat of Task 2b. The bound matters: the vendor fetch has no timeout of its own, so a vendor that hangs longer than 30 s after a disconnect still strands the charge, and the cancellation is logged only to Workers Logs and Tail Workers, which `wrangler.toml` does not enable. Three of this document's and its sibling's earlier statements were wrong and are corrected here: the candidate said the response then "cannot carry the final state (report `deferred`)", that CONTRACTS.md changes, and (in Task 2b) that the fix is to run only "the post-fetch reconcile" under `ctx.waitUntil`. None holds: with the whole call inside the registered promise the response still carries the real `reconciled`, and there is no contract text to change. The route passes `ctx`; nothing else in routing changed.

**Why the whole call and not only the reconcile.** Task 2b cannot say WHERE it cut each call: the aborted phase added 0 tally rows and one standing charge, and the other four are either never charged or charged and refunded before the cut, because the ledger keeps no count of charges. A registration placed after the fetch would leave every earlier moment open to a cut, including the calls aborted at 3 ms. Registering at the start leaves none: nothing can precede it. That is a design choice made because the measurement cannot exclude the earlier windows, not a finding that they exist.

**Checks.** `scripts/check-cfl-pipeline-registered.mjs` runs the real `handleCFLOddsProbs` and `cflOddsProbsPipeline` out of `src/index.js`, and the real `reconcileOddsCredit` with its refund (`_reconcileOddsCredit`, `_bumpSite`, `creditsKeptBy`) out of `src/budget-helpers.js`, against recording stubs. 76 assertions, 12 of them static reads of the comment-and-string-blanked source and 64 executed, over 13 scenarios: a cache HIT with a slate of known probabilities and a nonce on `reconciled`; the registered promise's identity (the reconcile is held open: the registered promise must stay pending while the call is in flight and settle right after it, which a timer or a decoy cannot do); the charge and the reconcile priced by the cost model (a literal 6 fails when the model says 7); the reconcile handed the very response the fetch returned; a declined charge, no key, a vendor 500, a throwing fetch, a throwing charge (rejecting to the caller, charged once), `ctx` undefined and `ctx` without `waitUntil`; and three cases of the real reconcile (a HIT refunding 6, a billed MISS of 4 refunding 2, a billed MISS of 6 refunding nothing) against a fake D1 and KV with a pinned clock, where every operation takes time and one that starts while another is in flight, or finishes after the call returned, is a finding. The `ctx` stub throws on an unbound or copied `waitUntil`, as workerd does (a local workerd showed `const { waitUntil } = ctx` throws `Illegal invocation`). Static: one definition of each function, one caller of the pipeline and no bare reference to either (an alias, `.call`), the route passing `ctx`, the runtime hop into `_fetch` passing it, and `ctx` not reassigned between them (compound and destructuring assignments included, an arrow parameter named `ctx` not). Its harness, `scripts/mutate-cfl-pipeline-registered.mjs`, puts the ORIGINAL defect back and 46 other breaks in copies of the sources, each required to be caught by the clause it breaks, and adds 5 benign edits (a comment naming the handler, the route written with braces and `await`, a timeout signal added to the vendor fetch, a decoy in a comment, an arrow parameter named `ctx`) that must stay green: 52 of 52. It is a step of `deploy.yml` (so it blocks the deploy) and of `guards.yml`. Two independent reviews on 2026-11-01 shaped it: the first found the first version happy-path-only and partly echoing its own stubs; the second ran 9 findings against it (the refund stubbed out, a `waitUntil` stub that ignored `this`, a reconcile that ignored its response argument, an unchecked hop into `_fetch`, an identity test by time ordering only) and each is now an assertion with a mutant. It cannot show that the edge keeps a registered promise running after a disconnect: a node process has no edge and the local workerd run was invalid. Only the repeat of Task 2b shows that. Its limits are printed on its own COVERAGE line.

**Not changed, and why.** `handleWCOddsProbs`, `oddsProxyRoute` and the request path of `getWCPregameLambdas` have the same shape. Measured over the 60 drift samples (`node scripts/analyze-cfl-reconcile-gap.mjs`): `handleWCOddsProbs` has gap 0 in all 42 samples (at most 19 calls tallied in a day); `oddsProxyRoute` does not appear in the per-site list at all, which is absence of rows, not a measured zero traffic; `getWCPregameLambdas` has a non-zero gap in 12 of 38 samples, range -20 to +44, so the trigger this paragraph first wrote ("if `by_site - kept` becomes non-zero for any of them") has already fired for it. Its request path is reached from `handleV2Games` (a client request) as well as from AmbientDO, and which of the two drives the gap is NOT measured. It is not changed here because the owner's order was Task 3, the CFL route, and its 12-of-38 gap is small (a few calls) beside CFL's; whether to give it the same registration is a separate decision, recorded rather than taken. Left as found, outside this task's scope: the header comment above `handleCFLOddsProbs` says the route costs 2 credits per call, and it charges 6 (`check-odds-calls-guarded` pins 6).

**Accepted, not fixed.** If `ctx.waitUntil` itself threw synchronously after the pipeline had started, the call would run unregistered while the caller got the error. The documentation names no condition under which it throws when called as a method (a detached call throws, and this one is not detached), so this is hypothetical; the guard before it covers a missing `ctx`.

**Done condition, STAGED (done condition 4 below carries its verifier).** Two parts, both fixed here before the data exist.

1. **The repeat of Task 2b** returns `abort-loses-nothing` with at least 3 aborted calls cut (the verdict's own minimum) and the aborted phase's `by_site` +0 and tally rows equal to the calls made. It uses a CALIBRATED abort schedule: fractions 0.2 to 0.6 of the MEDIAN latency of three confirmed cache-HIT calls (floor 40 ms) instead of 3, 10, 25, 50 and 100 ms, because the review found that an abort at 3 to 25 ms can predate the request's arrival (a call that never arrived reads like one that was cut), and that a schedule reaching 0.95 of one sample leaves some abort after the response whenever the call is a little faster (23 runs of 40 at 20% jitter) and so discards the aborts that did take effect. A loss is conclusive with any cut call; "loses nothing" needs 3. The artifact records the latency samples, the schedule and the warm-up time. **Limits, stated:** `aborted_effective` counts client-side abort errors only; the artifact does not record which deploy served it (the repeat is only meaningful after this change has deployed, which the close-out of the push records); and no run has shown that the calibrated schedule produces a lossy verdict on the unfixed code in production (it does against the fake relay, and the earlier lossy result is one call under the old schedule). The local check's mutation A1 puts the awaited chain back in a copy of the source and is caught; that proves the check, not the production repeat.
2. **A busy-day read.** The 2026-11-07 CFL day, read on 2026-11-08 from the committed drift series with `node scripts/analyze-cfl-reconcile-gap.mjs` (a scheduled read is armed): the gap (`by_site - kept`) added across the day is at most 48 credits (8 calls, inside the watch's own tolerance floor of 50) on a day with at least 100 HIT calls tallied. On 10-24 the pre-fix figure was 75 calls' worth against 389 HIT calls (about 19%), so 100 HIT calls would have shown about 19 lost calls (114 credits) before the fix; fewer than 100 HIT calls is inconclusive, not a pass. Quiet days before the fix already showed a gap of 12 (11-01T02:47Z and 09:49Z), so "0" is not the bar, and a gap above 48 on a busy day with the fix live means something other than a disconnect (H2, a throwing fetch, a hang past 30 s) is real. This replaces the armed read's earlier wording, "the gap is 0 or close to it".

**Blocked by:** the owner's fresh approval of up to 12 Odds API credits for the repeat (the one before covered one run). **Unblocked when** the owner dispatches `cfl-abort-experiment.yml` with `approval` equal to `APPROVED: up to 12 Odds API credits for the CFL abort experiment`, after the deploy, on a quiet CFL hour. **Verify:** `node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(a.verdict,a.aborted_effective+"/"+a.aborted_calls,a.deltas.aborted_phase.by_site,a.deltas.aborted_phase.hit,a.latency_samples_ms.length)' outbox/cfl-abort-experiment-<stamp>.json` prints `abort-loses-nothing` with `5/5` (or at least 3 of 5), `0`, `5` and `3`.

## Done conditions

1. **MET 2026-11-01 (`46a929f`).** The watch's verdict is the window-aligned residual, with the real 10-12 pair
   at −190 in its self-test and the mutation CAUGHT.
2. P5 is either explained by a named mechanism with the command that showed it,
   or shown not to bear on the residual. **MET 2026-11-01, with a stated limit.** P5 bears on the residual (Task 2, Result), and a mechanism is shown to exist by the command that showed it: `outbox/cfl-abort-experiment-20261101T135557Z.json`, verdict `abort-loses-refund-and-tally` (one abandoned call kept its charge with no tally; the other four are ambiguous between cut and never arrived). H3, H4 and H5 are refuted. Not shown: what share of the production gap real browser disconnects account for, and H2 as a further contributor.
3. The first scheduled run after Task 1 prints both figures. **STAGED** (verifier: vendor_watch_window_aligned @ relay/staged-verification.yml) the run of 2026-11-02 (about 05:30Z to 07:00Z; the sandbox cannot reach the relay and dispatching the workflow would split the window). Verify: `outbox/odds-daily-vs-vendor-2026-11-02T*.log` carries `residual (window-aligned)` and `residual against that`, and the series row it stores has a numeric `ledger_month_used` and `ledger_source` `d1`.

4. The fix holds in production. **STAGED** (verifier: cfl_abort_repeat_loses_nothing @ relay/staged-verification.yml) Task 3's repeat of Task 2b, after the deploy and the owner's fresh approval, returns `abort-loses-nothing`; the busy-day read of 2026-11-07 (Task 3, part 2) is read by hand on 2026-11-08 and is not part of the verifier. Verify: `outbox/cfl-abort-experiment-*.json` newest with `latency_samples_ms` has `verdict` `abort-loses-nothing`, `aborted_effective` at least 3, `deltas.aborted_phase.by_site` 0 and `deltas.aborted_phase.hit` equal to `aborted_calls`.

## Do not

- Do not dispatch `odds-daily-vs-vendor.yml`. It differences two readings, and
  an off-schedule reading splits the next window (HANDOFF.md).
- ~~Do not "fix" `handleCFLOddsProbs` on P5 alone.~~ Superseded 2026-11-01: the gap is the
  same size as the over-record, Task 2b showed the mechanism for one call, and the owner
  ordered Task 3, which lifts the 2026-10-18 hold on option 2. Do not change
  `handleCFLOddsProbs` between 2026-11-08 and 11-23 (the calendar experiment's VOID window).
- Do not dispatch `cfl-abort-experiment.yml` again without a new approval. It ran once on
  2026-11-01; it can spend up to 12 Odds API credits.

## Data points

- **2026-11-01, Task 2b ran (run 41313403502).** Verdict `abort-loses-refund-and-tally`: 5 of 5 aborts effective; 0 of 5 aborted calls tallied against 5 of 5 control calls; `by_site` +6 in the aborted phase; 6 vendor credits spent, 6 of over-record left in the ledger. The mechanism of P5 is supported by one call (the other four aborted calls are ambiguous between cut and never arrived); its share of the production gap is not measured.

- **2026-11-01, Task 2 measured (`scripts/analyze-cfl-reconcile-gap.mjs`).** 11 of 12 windows from 10-20 to 10-31: sum of residuals -2,076, sum of CFL gap midpoints 1,962, Pearson r 0.925, 10 of 11 windows within 60 of zero once the gap is added back. 59 of 59 CFL gaps are whole multiples of 6. Six of seven other sites have a gap of 0 in every sample. The local workerd abort run (54 calls) cannot decide H1: its own positive control did not see the disconnect, so the instrument is invalid and its readings are not evidence either way. Full table and the H1-H5 rows in Task 2 above.

- **2026-10-31, the window-aligned residual by hand for the eight closed days 10-23 to 10-30** (Task 1 is not built, so the watch still prints the UTC-day figure; this is Task 1's formula, vendor delta − `ledger_month_used` delta − known CI spend, computed from the committed `outbox/odds-daily-vs-vendor-series.json` rows and the `known CI spend` line of each day's log; windows 23.8 to 24.6 h; negative = the ledger recorded more than the vendor billed):

  | closed day | vendor Δ | ledger Δ | known CI | window-aligned | the watch's UTC-day verdict |
  |---|---|---|---|---|---|
  | 10-23 | 811 | 711 | 100 | **0** | `counter-under-counts` (+75) |
  | 10-24 | 2120 | 2333 | 200 | −413 | `we-overcharge-ourselves` (−404) |
  | 10-25 | 1323 | 1083 | 240 | **0** | `we-overcharge-ourselves` (−225) |
  | 10-26 | 378 | 228 | 180 | −30 | `tracks-the-bill` (−12) |
  | 10-27 | 445 | 411 | 160 | −126 | `tracks-the-bill` (+24) |
  | 10-28 | 636 | 752 | 120 | −236 | `we-overcharge-ourselves` (−75) |
  | 10-29 | 650 | 1038 | 140 | −528 | `we-overcharge-ourselves` (−674) |
  | 10-30 | 445 | 691 | 160 | −406 | `we-overcharge-ourselves` (−631) |

  Two readings. **(1) The one `counter-under-counts` verdict in this series after the owner's 2026-10-18 ruling, on 10-23, is a window artifact:** its window-aligned residual is exactly 0, so the enforcing counter did not under-count that day; the +75 was the UTC-day counter (636) read against a window whose ledger delta was 711. This is premise P1 of this document, observed on a day it flipped the verdict's sign. It had not been recorded in any CC-CMD, and the watch's own text calls that verdict "THE BREACH". **(2) The window-aligned residual is not small on the last three days (−236, −528, −406)**, and the days with the largest over-record are the days `handleCFLOddsProbs` carries (10-30: `by_site` 696 against 150 credits kept by `reconcile`, 451 cache hits at 0, read from `GET /budget/odds?date=2026-10-30`), which is P5. Both stay inside the ruling of 2026-10-18 (a one-directional over-record is headroom thrown away, never spend; do not fix the over-record yet). Not a verdict: no `counter-under-counts` is observed after window alignment in these eight days, and the CFL season ends inside the CFL VOID window (2026-11-08 to 2026-11-23), after which `handleCFLOddsProbs` should stop contributing. **Unblocked, a watch-only change with no credits and no change to the counter:** Task 1 (the watch prints the window-aligned residual). Verify with the command in Done condition 1.

- **2026-11-01, Task 1 built (`46a929f`).** `judgeDay` differences the vendor window against `monthly.used` over the same two readings less known CI spend; the UTC-day figure is a labelled diagnostic. Pinned on three real series pairs: 10-12 reads -190 (not -616), **10-23 reads 0 = `tracks-the-bill`** (the UTC-day figure read `counter-under-counts`, +75), 10-30 reads -406. A window that cannot be measured fails the run: `ledger-unreadable` (including a ledger the route served from KV), `ledger-went-backwards`, and `ci-unreadable` (the old code read a D1 500 as zero CI spend; on the 10-12 pair that read `tracks-the-bill`). An independent review replayed the new `judgeDay` over all 43 real pairs and reproduced the table above. Open and unchanged: the window-drift refusal, the P2 premise that CI credits are not in the ledger (read from source, not measured), and Task 2.
