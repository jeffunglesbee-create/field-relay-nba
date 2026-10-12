# Claude Code Command — the overcharge is one site, one cache state, and the comparison was already instrumented

**Date:** 2026-10-11
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (gap) — the instrumentation exists and nobody had read it against the residual
**Status:** DONE 2026-10-11. Task 0 settled it for zero credits against a
budgeted 1-2, and the answer was neither of the two branches this document
enumerated. Filed originally per Rule 87.4 by
`docs/CC-CMD-2026-10-11-monthly-batch-degrades-open.md`, whose Task 1 refuted
two candidate causes for this and so had to say where the real one goes.

## TASK 0 — THE ANSWER, and it is not EXPIRED revalidation

**`/v4/sports/{sport}/odds-live` is a 404. The vendor does not serve it.**

Run `38186065943`, from a runner, with the literal key
`INVALID_KEY_FOR_PATH_TEST`, so nothing was billable:

```
/v4/sports/soccer_fifa_world_cup/odds       401 INVALID_KEY
/v4/sports/soccer_fifa_world_cup/odds-live  404 Not Found
/v4/sports/soccer_epl/odds                  401 INVALID_KEY
/v4/sports/soccer_epl/odds-live             404 Not Found
```

The control carries the result: `/odds` resolving to an auth error on both
sport keys means the keys are right and the path is not. Both paths 404ing
would have meant a bad sport key, and the probe REFUSES in that case rather
than concluding — one of its ten self-tests, and the one that matters.

So every `ambientFetchLiveOdds` call was a 404. A 404 carries no
`x-requests-last`, which is exactly why reconcile recorded `no-header` on every
one; a 404 is also billed nothing, which is why the vendor's figure never moved
with ours. And `if (!r.ok) return;` sits below the fetch — **the function has
never produced a single odds row in its life**, while the line above the fetch
charged 2 credits per attempt.

`oddsCreditCost` on that URL returns 2, which is where the exact 2.0 per call
came from: 2074/1037, 796/398, 674/337, 578/289, all four exact.

**This document's own Task 0 instruction was wrong and had to be refuted before
it could be followed.** It said to probe *"from a runner with the same `cf`
options"*. `cf` is a Workers-only argument to `fetch`; a runner cannot set it,
and `cf-cache-status` never appears on a request that does not pass through the
relay. Had that instruction been followed literally it would have produced a
confident reading of a cache state that was never the mechanism.

**The EXPIRED premise is dead, not confirmed.** `cache: EXPIRED` on every
no-header row is Cloudflare caching the 404 response, not a revalidation of a
real payload. Neither Task 1 nor Task 2 below applies: the charge is not right
and the receipt is not lost — there was never a call to bill.

## THE DECISION — a third answer, stated

Not "refund EXPIRED" (Task 1) and not "stop routing through cacheEverything"
(Task 2). **Stop making the call, and do not repoint it without a budget.**

`ODDS_LIVE_PATH_404` returns before the charge. Repointing at `/odds` would make
eleven sports of 15-second polling start billing for real against a ceiling
already reached at 14:03:59Z, and `src/odds-sport-keys.js` says plainly that
raising ambient's coverage is a budget change made under its own document. That
decision is `docs/CC-CMD-2026-10-11-odds-live-path-404.md`.

Held by `scripts/check-odds-live-disabled.mjs` in `guards.yml`: 7/7, six
mutations, including the guard moved BELOW the charge — still disabled, still
spending, and the half a reading would miss.

## TASK 3 — the residual stops carrying it silently

`noHeaderCredits` in `watch-odds-daily-vs-vendor.mjs` reports the tally beside
the residual rather than inside it:

```
  unreconciled estimate  : 2074 over 1037 call(s) in state no-header
                           from ambientFetchLiveOdds
  residual after it      : 107   (the part no named cause accounts for)
```

Beside, not folded in: netting it out would silently reclassify days, and the
verdict's three states are what every other watch quotes. Null rather than zero
when the tally cannot be read. Seven new self-tests, 20 total, and two new
mutations — a null tally reading as nothing unreconciled, and reconciled rows
counted as unreconciled, which would make any day look fully explained.

## The measurement nobody had made

`src/budget-helpers.js:522` already says what to look for, in the source, as a
comment on the instrumentation that was built for it:

> *"A day where by_site is large and nearly all of it sits under state
> `no-header` is the overcharge: the provider sent no receipt, the edge cache
> answered, and the estimate stood. That comparison is the entire reason for
> this."*

The comparison, from committed artifacts:

| day | no-header calls | no-header credits | day's `used` | watch 1 residual |
|---|---|---|---|---|
| 2026-10-09 (21:55) | 337 | 674 | 2576 | — |
| 2026-10-10 (16:26) | 398 | 796 | 1640 | — |
| **2026-10-10 (23:55)** | **1037** | **2074** | **3800** | **−1967** |
| 2026-10-11 (16:51) | 289 | 578 | 3800 | (day not closed) |

**2,074 un-reconciled credits on 2026-10-10 against a measured residual of
−1,967 for that same closed day. Within 107, or 5.2%.**

Two independent instruments — the vendor reconciliation watch and the
per-site reconcile tally — agree to within 5% on a day's over-recording.

## It is ONE site and ONE rate

Across every committed `odds-site-drift-*.log`, the only site ever in state
`no-header` is **`ambientFetchLiveOdds`**, always with `cache: EXPIRED`, and
always at exactly 2.0 credits per call (2074/1037, 796/398, 674/337, 578/289 —
all four exact).

`ambientCaptureClosingOdds` reconciles normally from the *same* `EXPIRED` cache
state, so `EXPIRED` alone is not the discriminator.

## Where the estimate survives

`_reconcileOddsCredit` (`src/budget-helpers.js:995`) branches on two headers:

```js
const cache = resp.headers.get('cf-cache-status');
const last  = resp.headers.get('x-requests-last');
if (cache === 'HIT')      { out.actual = 0; out.state = 'cache-hit'; }
else if (last === null)   { out.state = 'no-header'; return out; }
```

`HIT` is handled — the provider was never contacted, so the charge is refunded
in full. `EXPIRED` falls through to the `last === null` test and the estimate
stands, deliberately: *"an unreconciled charge is safe, a wrong one is not."*

The call is made with `cf: { cacheTtl: 60, cacheEverything: true }`
(`src/ambient-do.js:614`), and it charges **before** the fetch
(`src/ambient-do.js:613`).

## The load-bearing premise, and the ONE command for it

**Premise:** on an `EXPIRED` revalidation the vendor is contacted and does bill,
but its `x-requests-last` does not survive to the Response the worker sees — so
the charge is right and only the receipt is missing.

**The alternative, which costs real money if true:** the vendor is NOT billing
these, the edge served a revalidated body, and we are charging 2 credits for a
call that cost 0 — which `cache === 'HIT'` already refunds and `EXPIRED` does
not.

These two have opposite fixes and the residual cannot tell them apart. The
command that can: one request to the same URL shape with the same `cf` options
from a runner, printing every response header, repeated until
`cf-cache-status` comes back `EXPIRED`, and read alongside
`x-requests-remaining` on either side of it. **That spends 1–2 credits and
therefore needs approval before it runs.**

`/wc/odds-probs`'s `cost` field already reads `X-Requests-Last` and the
2026-09 measurement there corroborated a cost of 6 against
`X-Requests-Remaining` falling exactly 6 — so the technique is established in
this repo and does not need inventing.

## Tasks

**Task 0 — settle the premise before writing anything.** The probe above, with
approval. Record every header verbatim in the outbox. Until it has run, neither
fix may be written: one of them refunds charges the vendor really billed.

**Task 1 — if the vendor does not bill an EXPIRED revalidation**, `EXPIRED`
joins `HIT` in the refund branch, and the reconcile tally's `credits_kept` for
`ambientFetchLiveOdds` should fall to near zero. Done condition: the next
closed day's watch-1 residual inside its tolerance.

**Task 2 — if the vendor does bill it**, the charge is correct and the defect is
the missing receipt. Then the fix is to stop the receipt being lost — most
likely by not routing the billed call through `cacheEverything`, which is a
Rule 78 change and needs its rate-limit analysis written first.

**Task 3 — either way, the watch must stop reporting this as unexplained.**
Watch 1's `we-overcharge-ourselves` and watch 4's `UNEXPLAINED: -2362` should
name the `no-header` tally as the accounted-for portion, so the residual that
remains is the part nobody has explained. Rule 91: a residual that silently
contains a known quantity is not a measurement.

## Stop conditions

- **Do not spend a credit on Task 0 without approval.**
- Do not refund `EXPIRED` before Task 0. An unreconciled charge is safe; a
  wrong refund hides real spend and is how a ceiling stops protecting anything.
- Do not change `oddsCreditCost`, the ceiling, or any cron frequency.
- Do not read this as the monthly-batch defect. That one is fixed and separate;
  it cost the guard, not the headroom.

## Done conditions

1. ~~Every response header from one `EXPIRED` revalidation, committed
   verbatim.~~ **Not met as written, and it should not be.** There was never an
   EXPIRED revalidation of a real endpoint to capture — the responses were
   cached 404s. The condition asked for evidence of a mechanism that does not
   exist. What stands in its place is the probe output above, committed verbatim
   in `outbox/odds-live-endpoint-2026-10-11T2355.log`, which answers the
   question the condition was trying to ask.
2. ✅ A stated decision, with the measurement as its reason — a third answer,
   neither Task 1 nor Task 2, and the document says why both were wrong.
3. ✅ The `no-header` tally is named inside the residual, with its own
   mutations. The first clause — the next closed day's residual inside
   tolerance — is now a prediction of this fix and is
   `docs/CC-CMD-2026-10-11-odds-live-path-404.md`'s done condition 3.

   **Live half met 2026-10-12** — the scheduled run of 05:48:55Z (closed day
   2026-10-11, `outbox/odds-daily-vs-vendor-2026-10-12T0548.log`) printed both
   lines against real data, verbatim:

   ```
     residual               : -1220   tolerance 140
     unreconciled estimate  : 584 over 292 call(s) in state no-header
                              from ambientFetchLiveOdds
     residual after it      : -636   (the part no named cause accounts for)
   ```

   292 / 584 is the pre-fix rate, as predicted: the 16:51Z in-flight reading
   was 289 / 578, and 2026-10-11 is entirely before the 00:25Z 10-12 deploy.
   **The −636 left over is not explained by anything this document names.**
   2026-10-10's was +107. Its cause is not established here. The 2026-10-12
   closed day, with `no-header` near zero, is the first reading that
   isolates it.
