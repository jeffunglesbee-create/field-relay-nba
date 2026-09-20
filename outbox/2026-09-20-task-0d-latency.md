# Task 0d: what Task 2 cost in latency

**2026-09-20** · field-relay-nba · commits `5b0dd28`, `5217798`
Artifact: `outbox/odds-budget-latency-20260920T032540Z.log` (run 35486…, deploy 983)

## The answer

| series | median | what it is |
|---|---|---|
| `kv_four_ops` | **517 ms** | the old guard: get+put on daily, get+put on site — every call |
| `d1_batch_warm` | **38 ms** | the new guard: one batch — every call after the first |
| `d1_first_call_on_isolate` | **67 ms** | DDL + KV seed read + batch — once per isolate |

**Per-request delta: −479 ms.** Verdict `warm-cheaper`. Task 2 bought atomicity
and took 13.6× off the path `fetchSportOddsLive` pays on every request.

Raw samples, in call order, because a median with no spread behind it is a claim
rather than a measurement:

```
kv_four_ops:              643 545 525 517 487 448 509
d1_batch_warm:             53  38  52  37  38  37  37
d1_first_call_on_isolate:  77  83  67  64  75  67  64
```

The old form's spread is ~200 ms wide and the new form's is ~16 ms. That is the
second finding and it is not in the headline: the replaced path was not merely
slower, it was *variable*, which is what a per-request path can least afford.

## The spec was stale in three ways, and building to it would have measured nothing

0d asked for "(a) four sequential `FIELD_JOURNALISM` ops, **as the guard does
them now** (b) one `env.DB.batch` of the three Task 2 statements."

1. **The guard does not do four KV ops.** Task 2 removed them the day before.
   They are the BASELINE here — the thing Task 2 replaced — reconstructed, and
   labelled that way in the route's own output rather than in a footnote.
2. **`DB` was removed 2026-09-20.** Task 2 landed on `ARCHIVE_DB`.
3. **The new path is not one call.** `checkAndIncrementDailyOdds` also calls
   `ensureOddsBudgetTables` and `_seedFromKv`, both behind module-level flags.
   First call on an isolate: three round trips. Every later call: one.

Point 3 is the one that would have done real damage. Timing only the batch and
reporting "38 ms" would have been true and misleading — it omits a cost that is
real, just rare. So the two are measured apart, and the cold number is kept out
of the per-request verdict **by construction**: mutation `L1` adds it to the
comparison and the self-test goes red. `L3` is its mirror — the cold number is
still *required to be present*, so "reported beside the verdict" cannot quietly
decay into "absent".

## What the CC-CMD got right, and it is worth keeping

The paragraph immediately above the 0d spec refused to predict the answer:

> KV reads are edge-cached and cheap; KV writes and D1 both go to a central
> store, so a lower op count is not by itself a lower latency. Measure both
> sides; do not reason about either.

Correct — and the answer still came out enormous, for a reason that sentence
does not contain. The cost was never the op count. It was two KV **writes**,
each replicating globally, on a path that only ever needed one transaction
against one store. A document that had reasoned its way to "4 ops → 1 op, so
~4× faster" would have been directionally right and numerically nowhere near.

## The measurement had to happen inside the worker

"On the same isolate" is the whole requirement. Timing a D1 batch from a GitHub
runner measures the runner's path to Cloudflare, not the worker's path to D1. So
the timing lives at `POST /debug/odds-budget-latency` and CI only reads it.

**Writes are bounded and cleaned up in a `finally`.** Everything lands on the
sentinel day `0000-00-00` and two sentinel KV keys. Every reader of
`odds_budget` filters `WHERE day = ?` — three call sites, checked rather than
assumed — so the sentinel is invisible to them even in the window before
cleanup. The artifact records what was removed:
`["odds_budget","odds_budget_site","odds:latency-probe:daily","odds:latency-probe:site"]`.

The ceiling is bound high on purpose. A vetoed charge does less work, and would
have timed the wrong path while looking like a valid sample.

## A ratchet did its job on me

The first version of the route carried its own `authHeader !== '<literal>'` — a
116th hard-coded copy of the shared secret in a public repo.
`check-exposed-secrets` went red on the commit that added it, which is precisely
what that ratchet is for.

Adding one to the declared number was the quick route. Naming the literal once
(`CI_ROUTE_GATE`) was the correct one, and it ends with a **tighter** bound than
before: **115 → 109**, `src/index.js` from 27 occurrences to 20.

That went wider than the one site strictly required — all eight inbound route
gates now read the constant. Stated plainly because Rule 69 says refactoring does
not hitchhike: one named and seven inline is worse for a reader than either
extreme, and converting all eight is what let the bound tighten rather than hold.
The remaining 20 in that file *send* the header on outbound calls rather than
checking it; different shape, separate change.

## Verification

| what | result |
|---|---|
| `probe-odds-budget-latency.mjs --self-test` | 12/12 |
| `mutate-odds-budget-latency.mjs` | 6/6 caught |
| `check-exposed-secrets` | PASS at the new bound of 109 |
| `check-route-provenance` | PASS, 188 routes, 186 with a declared source |
| the new route's own provenance | `d1:ARCHIVE_DB + kv:FIELD_JOURNALISM`, generated not typed |
| `check-push-lands.py` | OK, 26 loops |
| deploy.yml node gates | 93/95 — the 2 red are `--live` variants printing "RELAY_SHARED_SECRET is not set" in the sandbox |
| deploy | run 983, success |
| rows left behind | 0 |

## One wasted step, recorded

I spent nine minutes waiting on a `curl` loop against the worker from the
sandbox. The sandbox's egress proxy denies CONNECT to that host — measured
2026-09-19, written in this repo's own probe headers, and the reason the probe
runs in CI at all. I had the fact and did not apply it to my own wait loop.

Cost: nine minutes and nothing else. Recorded because the general shape —
knowing a constraint and then building something that violates it — is the same
shape as the premise failures Rule 100 exists for.

## What this closes

Task 0d was the last unmeasured item in CC-CMD-2026-09-18 other than
`odds-daily-vs-vendor`, which needs three closed days and cannot report before
~2026-09-22. The batching question the spec left conditional
("if (b) is slower than (a)…") does not become live: (b) is faster, so there is
nothing to decide about charging per slate instead of per game.
