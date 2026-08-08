# CC-CMD-2026-08-09-wnba-failover-via-kv

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-09-wnba-failover-via-kv.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## The constraint that forces a different architecture

`CC-CMD-2026-08-09-wnba-secondary-source` found a real WNBA source and
then hit a wall. Measured through `/web-fetch` on the deployed relay, so
this is this relay's own egress, not an inference from another worker
(`outbox/web-fetch-verify-20260808T234440Z.log`):

```
cdn.wnba.com scoreboard  upstream=200 bytes=3839 parsedGames=null <- HTML error page
cdn.wnba.com schedule    upstream=200 bytes=3839 parsedGames=null <- HTML error page
stats.wnba.com sbv2      HTTP 502 (timeout from the Worker)
```
The same URLs served a GitHub runner real JSON **bare, with no headers**.
So it is not headers and not the request shape. It is egress: wnba.com
blocks Cloudflare Worker IPs.

**Therefore the MLB pattern cannot be copied.** `adaptMlbStatsApi` works
because the Worker can reach `statsapi.mlb.com`. No amount of adapter
code makes the Worker reach a host that refuses it. Attempting it anyway
would produce dead code — Rule 63 — and the WNBA CC-CMD's Task 1 gate
exists precisely to stop that.

## The proposal: move the transport, not the adapter

This repo already relies on GitHub Actions as an escape hatch for
*verification* whenever Worker or sandbox egress is blocked — the
CI-as-proxy pattern, used by `espn-reachability-monitor.yml`,
`archive-gap-probe.yml`, and `live-deploy-verify-probe.yml`. The novel
step is applying the same pattern to **data transport**: a runner can
reach wnba.com, so let the runner do the fetching and hand the result to
the Worker through KV.

```
  GitHub Actions (can reach wnba.com)
        |  fetch + adapt to the V2 shape
        v
  KV  wnba:slate:<YYYY-MM-DD>
        |
        v
  Relay /v2/games?sport=wnba
        ESPN primary  ->  KV secondary on ESPN failure
```

**RUWT check, because this changes where data comes from:** the relay
still computes nothing and still serves on pull only. Nothing is pushed.
This is transport, like the existing proxies — Rule 47 and Rule A are
both unaffected.

**The honest costs, stated up front so the choice is informed:**
- **Staleness is bounded by the cron interval, not seconds.** A 5-minute
  cron means WNBA scores can be up to ~5 minutes old *while the failover
  is active*. During a total ESPN outage the alternative is nothing at
  all, so this is a real improvement — but it is NOT parity with the MLB
  failover, and it must not be described as such.
- It only helps if the workflow itself is healthy. A silent workflow
  failure means a silently stale KV, so Task 3's freshness stamp is not
  optional.
- GitHub Actions minutes and KV writes, both small at this cadence.

## Task 1 — probe from HEAD first

- Re-run `/web-fetch` against both `cdn.wnba.com` URLs. **If the Worker
  can now reach them, STOP and close this CC-CMD** — the in-Worker
  failover in `CC-CMD-2026-08-09-wnba-secondary-source` becomes correct
  again and is strictly better than this. Do not build the KV path on a
  stale reading of a block that may have lifted.
- Read `adaptESPNBasketball` and record its exact emitted key set. That
  is the target shape — **not** `adaptNbaCDN`'s, which differs in two
  ways that will silently break consumers: it emits `state: 'final'`
  where the ESPN adapters emit `'post'`, and it has **no `streams`
  field** at all.

## Task 2 — the workflow (producer)

`.github/workflows/wnba-slate-to-kv.yml`, cron every 5 minutes during
the WNBA season, plus `workflow_dispatch`.

- Fetch `cdn.wnba.com/static/json/liveData/scoreboard/todaysScoreboard_10.json`.
- Adapt to the shape recorded in Task 1, in a script under `scripts/`
  that **exports the adapter** so the verifier can import the real one
  rather than a copy.
- Write to KV `wnba:slate:<YYYY-MM-DD>` with a stamped `fetchedAt` and a
  TTL of ~30 min, via `POST /d1/execute`'s sibling pattern or a new
  authenticated KV-write route — check which exists before inventing one.
- Do NOT write if the fetch returned zero games AND the KV already holds
  a non-empty slate for that date: an upstream blip must not erase good
  data.

## Task 3 — the consumer

In `handleV2Games`, extend the SAME `_secondaryFetch` binding the MLB
failover already introduced. Do not create a second mechanism.

- `source: 'wnba-kv'` when the KV path served, so it is observable.
- **Serve a stale slate rather than nothing, but say so:** include
  `fetchedAt` and a computed `staleSeconds` in the response. A consumer
  showing a 20-minute-old score as live is worse than the outage.
- If KV holds nothing for the date, fall through to the existing error.
  Two levels total (Rule 76) — ESPN, then KV. No third.

## Task 4 — verification artifacts (Rule 89)

1. `_forcePrimaryFail=1` with the auth header on
   `/v2/games?sport=wnba` → HTTP 200, real games, `source: 'wnba-kv'`,
   and a `staleSeconds` under the cron interval.
2. Normal path in the same run still `source: 'espn-wc'`.
3. Key-path parity against `adaptESPNBasketball`, importing both real
   functions — nothing missing.
4. **STRUCTURAL 7.** The WNBA CDN scoreboard carries no broadcast data,
   so unlike MLB this failover WILL produce games with empty `streams[]`,
   and STRUCTURAL 7 treats real-games-with-zero-streams as a hard
   failure. This is where the carve-out MLB did not need becomes real:
   make it `source`-aware so a KV-sourced slate with no streams is a
   known-degraded PASS, while an ESPN-sourced slate with no streams stays
   a hard FAILURE. **Do not weaken the ESPN path**, and state explicitly
   in the outbox whether it was weakened. The answer must be no.
5. A run where the producer writes and the consumer reads the same slate,
   quoting the KV key and both timestamps.

## Explicitly NOT in scope

- Do not touch the MLB failover.
- Do not change `adaptESPNBasketball`.
- Do not add secondaries for other sports.

## Outbox

`outbox/cc-session-2026-08-09-wnba-failover-via-kv.md`: the Task 1
re-probe, the five Task 4 artifacts, and an explicit statement of the
real staleness bound observed — not the configured one.
