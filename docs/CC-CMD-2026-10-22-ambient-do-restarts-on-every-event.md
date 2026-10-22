# Claude Code Command — AmbientDO restarts on almost every event, and why is not known

**Date:** 2026-10-22
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** B (unexplained runtime behaviour; its spend effect is already fixed)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** the deploy verification of TASK 1 of
`docs/CC-CMD-2026-10-21-closing-capture-calls-18x-its-need.md`, Rule 87.4.

---

## What was measured

All readings are `/ambient/state?diag=1`, every 30 s, by
`scripts/probe-ambient-capture.mjs`. A "fresh instance" is one whose
`instanceStartedAt` differs from the previous reading and whose
`restoredAt` is null, meaning it has not yet run `_poll`.

| run / log | code | what the readings show |
|---|---|---|
| 39700004408, `…20261022T002944Z` | old | 19 instances in 19 readings. `clients 0` at the first reading |
| 39714396288, `…20261022T025948Z`, 02:59–03:02Z | old | **One instance, started 00:54:54Z, still alive at 03:02:23Z** with `clients 2`. It refused the `scores:today` write on every poll |
| the same log, 03:02:53Z onward | new (`6ef722d`) | 15 instances in 15 readings |
| 39716768024, `…20261022T032548Z` | new | 12 instances in 12 readings, **`clients 0` on every one**. Stored scores steady at 4 entries |
| 39695639761, `…20261021T234722Z` | old | 34 clients at 23:47Z. Capture calls at about one per 15 s poll from 23:53Z to 23:59Z, which needs an instance that lost its memory each poll. 30 of 285 readings met a fresh instance |

**Settled by these readings:**
- A refused write does not by itself restart the object. The 00:54:54Z
  instance refused one on every poll for two hours.
- Instances live under 30 s in the `clients 0` windows.

**Not settled:**
- Why instances are discarded that fast. Cloudflare documents idle eviction
  at 70–140 s.
- Whether connected SSE clients prevent it. The 23:53Z re-buys came 6
  minutes after a 34-client reading.

## Why it still matters after the fix

The closing capture no longer depends on instance lifetime: scores, seen
times and the capture record are all stored and restored. Other state
AmbientDO keeps only in memory is lost on every restart:
- `_bsdSocket`, the BSD WebSocket relay;
- `_oddsLastFetch`, the per-sport odds cooldowns. Their path is behind
  `ODDS_LIVE_PATH_404` today.
- `_wpPeaks`;
- `_pingTimer`;
- the SSE client set.

Each restart also re-reads six storage keys.

**A fresh instance serves an empty state.** `_scores` is restored only inside
`_poll`. So a request that reaches an instance before its first poll gets
empty live views:
- `/ambient/state` returns `sportCount 0` and `liveGames []`;
- the SSE `connected` payload carries no live games.

Run 39716768024 read `sportCount 0` on 12 of 12 readings. While the restarts
continue, the REST fallback is empty almost every time it is read. Restoring
in the request path too, or on construction under `blockConcurrencyWhile`,
would close this independently of the restart cause.

## TASK 0 — premises, one command each

1. **What discards the instance.** Run wrangler tail (pretty JSON) on the
   AmbientDO entrypoint across a 10-minute `clients 0` window. Record each
   event's `outcome` and any `exceptions`, and look for an eviction or reset
   reason. The probe's current filter keeps only 11–12 such events per
   window, so keep every AmbientDO event.
2. **Clients and lifetime.** Run the probe across a window where the client
   count changes, for example an evening slate. Pass if `instanceStartedAt` is
   stable whenever `clients > 0` and changes whenever `clients = 0`. One
   counter-example refutes the premise.
3. **What a restart costs elsewhere.** Count the `/bsd/` WebSocket opens per
   hour from the tail, against the number of live BSD-covered games.

## TASK 1 — decided from TASK 0

No fix is chosen before TASK 0. If the restarts are idle eviction, the fix is
whatever keeps the alarm-driven object resident, or makes the in-memory state
listed above survive a restart.

## Done condition (Rule 90 artifacts)

1. TASK 0's three outputs committed.
2. A probe log in which `instanceStartedAt` is stable across a full window in
   which the fix claims it should be, or the CC-CMD closed with the measured
   reason why it cannot be.
