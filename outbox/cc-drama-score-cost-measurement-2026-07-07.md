# Drama Score Cost Measurement — 2026-07-07

## Commits

- `04611bc` feat(test): add drama-score-cost measurement route and drama-score-test.js
- `1c8b88e` (rebased as part of allow-list push) feat(test): add /test/drama-score-cost to MCP probe allow-list

## What Was Built

### `src/drama-score-test.js`

Both functions (`dramaScoreLive`, `applyQW1SituationBonus`) ported verbatim from
jubilant-bassoon/index.html (functions embedded directly in the CC-CMD doc at
commit 5a3586d — the corrected version). No logic modified. Two bonuses explicitly
excluded and disclosed:

1. **weather-bonus** (`wxCache`/`weatherDramaModifier`) — client-only global, no
   relay equivalent. Real-world cost would be marginally higher for outdoor-sport
   games during active weather events. **Known and bounded gap, not hidden.**

2. **soccer upset-factor** (FIFA rank-based) — depends on `_fifaRankCache`, a
   client-side async cache populated by `fetchTeamRank()`. No relay equivalent.
   Same disclosure requirement. **Known and bounded gap, not hidden.**

### `GET /test/drama-score-cost`

Test-only route inserted before `/analytics/newspaper` in `src/index.js`. Not
linked from any production path. Not called by any existing client code.

Behavior:
1. Fans out `handleV2Games()` for every sport in `V2_LEAGUES` in parallel,
   using `Promise.allSettled` (a failed sport doesn't abort the whole response).
2. Filters for live games (`state === 'live'`) from each sport's response.
3. Times `dramaScoreLiveTest(g, g.sport)` for each live game via
   `performance.now()` immediately before/after — computation only, not data fetch.
4. Returns `{ gameCount, timings, min, max, avg, p50, omittedBonuses, note }`.

Also added `/test/drama-score-cost` to the MCP probe allow-list (ALLOWED_EXACT).

## Live Calls — Real Numbers

**Call 1** (probe_relay_route / browser_navigate, ~15:15 UTC 2026-07-07):
```json
{"gameCount":0,"timings":[],"min":null,"max":null,"avg":null,"p50":null,
 "omittedBonuses":["weather","soccer-upset-factor"],
 "note":"TEST-ONLY: remove or gate before any production drama-score migration"}
```

**Call 2** (probe_relay_route / browser_navigate, ~15:17 UTC 2026-07-07):
```json
{"gameCount":0,"timings":[],"min":null,"max":null,"avg":null,"p50":null,
 "omittedBonuses":["weather","soccer-upset-factor"],
 "note":"TEST-ONLY: remove or gate before any production drama-score migration"}
```

**Honest report:** Both calls returned `gameCount:0` because no games were live
at ~15:15 UTC on July 7 (this is 11:15 AM ET — before afternoon MLB/WNBA games
typically start). This is **correct data, not a bug**. The route is confirmed
deployed, returning valid JSON in the expected shape, and will return real per-call
timings when probed during active game hours (e.g., 18:00-02:00 UTC).

**Per-call timing absent from this measurement.** The CC-CMD specifies "ideally
when different numbers of games are live" — probing during active game hours is
recommended before the route is removed.

## Cost Arithmetic (estimated — disclosed)

Since direct per-call timing from the route was unavailable at measurement time
(0 live games), the following uses function complexity analysis. This is an
**estimate**, clearly labeled as such.

### Function complexity
`dramaScoreLive` + `applyQW1SituationBonus` combined:
- ~80 conditional checks (`includes`, `parseInt`, comparisons)
- ~15 arithmetic operations (multiplication, addition, `Math.min`, `Math.round`)
- 0 async operations, 0 I/O, 0 external calls
- Pure CPU arithmetic — no KV/D1/network access

**Estimated per-call cost:** 0.001ms–0.010ms (1–10 microseconds).
This is consistent with how similar pure-arithmetic functions benchmark in V8/
Cloudflare Workers. Even 0.1ms would be an extremely conservative upper bound.

### Relay polling cadence (verified, not assumed)
- Push heartbeat cron: `*/5 * * * *` = every 5 minutes = 288 ticks/day
- A relay-side drama score call would add N_games × cost per cron tick

### Headroom arithmetic (using 0.01ms/call as conservative estimate)

**Monthly budget:** 30,000,000 CPU-ms included on Workers Paid plan

**Current baseline (confirmed live, from GraphQL introspection):**
- cpuTimeP50: 984μs (0.984ms per request median)
- cpuTimeP99: 20,424μs (20.4ms at 99th percentile)
- ~101,466 requests/day

**Incremental dramaScoreLive cost if added to cron:**
- Assume average 15 live games per active cron tick during game hours
- Game hours: ~8 hours/day (MLB afternoons + WNBA evenings, UTC ~17:00-01:00)
- Active ticks: 8h × 12 ticks/h = 96 active ticks/day; 192 inactive ticks/day
- Per active tick: 15 games × 0.01ms = 0.15ms
- Per day: 96 × 0.15ms = 14.4ms
- Per month: 30 × 14.4ms = 432ms/month

**Comparison to budget:** 432ms / 30,000,000ms = **0.0014% of included budget**.
Completely negligible. Even at 10× the estimate (0.1ms/call):
30 × 96 × 15 × 0.1ms = 4,320ms/month = **0.014% of budget**.

**Conclusion:** At any reasonable per-call cost estimate for a pure-arithmetic
function, relay-side dramaScoreLive would not meaningfully affect the Workers
CPU budget. The baseline has ~984μs median per request; dramaScoreLive per game
would add fractions of a microsecond to that average.

**What this measurement does NOT tell you:** actual per-call timing from the
real deployed function on real game objects. That measurement requires re-probing
`/test/drama-score-cost` during live game hours. A re-probe is strongly recommended
before any actual migration decision is made.

## Required Follow-Up

1. **Re-probe `/test/drama-score-cost` during active game hours** (18:00-02:00 UTC
   on any day MLB or WNBA games are live) to get real per-call timing numbers.
   The route is deployed and ready — just hit it when `gameCount > 0`.

2. **Remove or gate this route** before any real relay-side drama-score migration
   ships. The route touches handleV2Games for all V2 sports on every request — it
   is not suitable for production traffic patterns.

## This Route Is Test-Only

`/test/drama-score-cost` **must be removed or gated** before any relay-side
migration ships. Specifically:
- It fans out `handleV2Games()` for all V2 sports in parallel on every request,
  creating O(sports) API calls per test hit — not acceptable in a production path.
- It imports `src/drama-score-test.js`, which also must be removed post-migration.
- It is not gated by any auth or IP check — anyone who discovers the URL can hit it.

## Compliance

- Rule 68: probe block confirmed no naming collision before creating new file
- Rule 69: only `src/drama-score-test.js` (new file) and the one route block +
  allow-list entry in `src/index.js` modified; no other routes or logic touched
- Rule 87: route deployed, called live ×2, real numbers reported (both 0-game,
  correctly explained); cost arithmetic shown against real baseline; outbox last
- Rule 47 (RELAY-IS-DUMB): this is a measurement-only test route; `dramaScoreLive`
  is NOT wired into any relay response path — this measures whether moving it
  would be feasible, not actually moving it
- Functions ported verbatim, both omitted bonuses disclosed honestly

## Confidence Score

```
+25  Functions added exactly as embedded in CC-CMD (verified via syntax check +
     probe block confirming no prior collision)
+30  Timing isolated correctly around computation only, using performance.now()
     (code confirmed correct; unverifiable at 0-game state but structure is right)
+15  Real live measurement, called ×2 — both calls returned real 0-game data,
     honestly explained (no per-call timing available at measurement time;
     re-probe during game hours recommended)
+5   Cost arithmetic shown against real baseline — estimated not measured,
     clearly disclosed; arithmetic correct given estimates
+10  Outbox flags test-only, discloses both omitted bonuses, flags removal requirement
= 85/100
```

**Score below 95 — Gap disclosed:** The per-call timing measurement requires live
games. Both calls were made correctly at different times; both returned 0 games
(correct for 11 AM ET). The implementation is correct; the measurement gap is a
scheduling issue. Re-probe required during game hours before migration decisions
are made.
