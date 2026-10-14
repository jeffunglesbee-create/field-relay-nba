# Claude Code Command — ESPN moved its Worker block to site.web.api

**Date:** 2026-10-14
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** A (live outage) — every ESPN read in the relay answered 403
**Status:** **OPEN.** Task 1 (re-point) **DONE** 2026-10-14 (`2142bad`, all three
done conditions met); Tasks 2-4 open.

Successor to `docs/CC-CMD-2026-08-08-espn-site-api-403-p0.md`, whose Task 2
this repeats in the other direction.

## The incident, measured

`espn-reachability-monitor.yml` went red at 2026-10-13T21:39Z and stayed red
(0 of 4 green on 2026-10-14). Verbatim, run 38591157497:

```
  ✅ mlb: HTTP 200
  ❌ epl: HTTP 502  {"error":"ESPN upstream 403","sport":"epl","date":"2026-10-14"}
  site.api : HTTP 200
  site.web.api : HTTP 200
```

The `mlb` line is not ESPN. `/v2/games?sport=mlb` answered with
`"source":"mlbam-statsapi"`: the failover served it.

From Cloudflare Worker egress (`html_probe`, 2026-10-14 ~18:40Z):

| path | site.web.api | site.api |
|---|---|---|
| `site/v2/.../soccer/eng.1/scoreboard` | 403 | 200 |
| `site/v2/.../football/nfl/scoreboard` | 403 | 200 |
| `v2/sports/football/nfl/standings?...level=2` | — | 200, `children[]` AFC/NFC |
| `common/v3/sports/golf/athletes/9478/stats` | 403 | 200 |
| `sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/seasons/2026` | 403 (no second host) | — |

From the relay itself (`probe_relay_route`): `/v2/games?sport=nfl` 502,
`/v2/games?sport=epl` 502, `/espn-summary/sports/football/nfl/summary?event=…`
403.

From a GitHub runner, both hosts answer, and they serve the same bytes:
**9 of 9 pairs byte-identical and same-shape**, including an NFL summary of
683288 bytes with `boxscore` and 207 `winprobability` entries on both
(`outbox/espn-host-parity-2026-10-14T1845.log`, run 38617840250). This
refutes the src comment that said site.api summaries carry only win
probability. Soccer summary parity is UNMEASURED: 2026-10-04 had no completed
EPL event on the scoreboard the probe read.

## Task 1 — re-point to the host that lets the Worker in (built)

Five literals, no new mechanism: `ESPN_API_BASE`, `ESPN_STANDINGS_PROXY_BASE`
and the golf `common/v3` URL in `src/index.js`; `ESPN_SUMMARY_BASE` and
`ESPN_SCOREBOARD_BASE` in `src/wp-resolver.js`. `src/route-provenance.js`
regenerated (13 routes, hosts only).

**Done condition** — all from the relay's own egress after deploy:

1. `/v2/games?sport=nfl` and `?sport=epl` answer 200, and `nfl` carries a
   source other than `mlbam-statsapi` (the ESPN path, `espn-wc`).
2. `/espn-summary/sports/football/nfl/summary?event=<a final>` answers 200.
3. One `espn-reachability-monitor.yml` run green.

✅ **MET 2026-10-14**, deploy run 38618692905 (deploy job success, 18:5xZ):

1. `probe_relay_route /v2/games?sport=nfl&date=2026-10-15` → 200,
   `"source":"espn-wc"`, DEN v SEA, `"start":"2026-10-16T00:15Z"`.
   `?sport=epl&date=2026-10-18` → 200, `"count":4,"source":"espn-wc"`.
2. `/espn-summary/sports/football/nfl/summary?event=401872994` → 200,
   `bodyBytes: 683288`, the same size the runner probe read on both hosts, with
   the relay's browser headers. The 2026-08 note that browser headers make
   site.api worse from the Worker does not hold today.
3. Monitor run 38619780577 (dispatch, 18:58Z), verbatim:
   ```
     ✅ mlb: HTTP 200
     ✅ epl: HTTP 200
   ESPN reachable through the relay.
   ```

The same deploy's verify job went red on an unrelated, older defect: the
`/context/game` bridge probe's D1 JOIN scanned `regular_season_games` once per
recap brief and passed its 20 s timeout. Fixed in `c6f094a` (95.7 ms, 9935
rows read); dispatched deploy 38620645051 is green on every step.

## Task 2 — the host has flipped twice; decide what survives the third

08-06 site.api blocked → moved to site.web.api. 10-13 site.web.api blocked →
moved back. Both times one constant, and both times the outage ran until
someone read a red monitor (08-08: three days of MLB/WNBA archive lost;
10-13: ~21 h for every ESPN sport without a secondary).

The owner's decision, ranked:

1. **A selected host, not a chain.** A cron health-checks both hosts from the
   Worker and writes the working one to KV; every ESPN read uses it. One host
   per request, so no third fallback level (Rule 76) and nothing hides a
   failure: the selection and its reason are readable. The cost is a new
   KV key and a cron step.
2. **Keep the manual flip**, and make the monitor name which host is blocked
   so the flip is a one-line change read off the red run.
3. Per-request retry on the other host. Rejected here: for MLB it is a third
   level beside the statsapi failover, and it hides which host is blocked.

## Task 3 — sports.core.api.espn.com is also 403 from the Worker

There is no second host to move to. As first written this named two routes;
the audit workflow (`wf_e4283b41-c05`) found five read sites and measured them
through the live relay after the re-point, 2026-10-14:

| route | core read (`src/index.js`) | live result |
|---|---|---|
| `/v2/golf/eventlog` | ~4023 | `{ok:false, error:"ESPN 403"}` |
| `/v2/golf/competitor-stats` | ~3964 | `{ok:false, error:"ESPN 403"}` |
| `/v2/golf/enriched` | ~4106, and 3964 for the top 20 | drops course and top-20 stats on an active event (read from code) |
| `/soccer/xg` | ~19668 | 200 with `_hasXG:false, _hasMatchStats:false` — **silent** |
| `/soccer/sub-impact` | ~19809 | 200 with `defensiveSubs:[]` — **silent**: a 403 reads as "no defensive sub happened" |

The two silent ones are the worse half: `r.ok ? r.json() : null` turns the
outage into a plausible empty answer (Rule 99). The fix decision is the
owner's: a non-ESPN source, or the route says it is degraded.

## Task 4 — the monitor read a failover 200 as ESPN reachable

`espn-reachability-monitor.yml` prints `✅ mlb: HTTP 200` while ESPN is
down, because MLB fails over to statsapi. It must read `source` and report a
failover as a failover. Its own red came from `epl` alone, so with one fewer
sport checked this outage would have been invisible.

## Do not

- Do not add browser headers to the scoreboard fetch.
- Do not touch the `cf` cache options.
- Do not add a per-request host fallback without the Task 2 decision.
