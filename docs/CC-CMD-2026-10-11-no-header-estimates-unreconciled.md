# Claude Code Command — the overcharge is one site, one cache state, and the comparison was already instrumented

**Date:** 2026-10-11
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (gap) — the instrumentation exists and nobody had read it against the residual
**Status:** OPEN. Filed rather than deferred, per Rule 87.4, by
`docs/CC-CMD-2026-10-11-monthly-batch-degrades-open.md`, whose Task 1 refuted
two candidate causes for this and so had to say where the real one goes.

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

1. Every response header from one `EXPIRED` revalidation, committed verbatim.
2. A stated decision between Task 1 and Task 2, with the headers as its reason.
3. The next closed day's watch-1 residual inside tolerance, or the `no-header`
   tally named inside the residual so what remains is genuinely unexplained.
