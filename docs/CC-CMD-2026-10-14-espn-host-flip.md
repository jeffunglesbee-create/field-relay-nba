# Claude Code Command — ESPN moved its Worker block to site.web.api

**Date:** 2026-10-14
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** A (live outage) — every ESPN read in the relay answered 403
**Status:** **OPEN.** Task 1 (re-point) **DONE** 2026-10-14 (`2142bad`, all three
done conditions met); Task 3 RULED 2026-11-19 (runner mirror) and STAGED (built `9701fdd`,
`b9eeb46`, live on three of the five sites; golf stats and live soccer reads pending, below);
Tasks 2 and 4 open.

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

### Task 3, 2026-11-19: one of the five read sites moved off the core API

- **Re-measured through the relay's own `/web-fetch`** (`outbox/golf-core-reach-probe-2026-11-19T00-41-40-114Z.json`): the core golf event, competition and competitor status still answer **403** to the Worker, while the site.api scoreboard answers 200; a GitHub runner gets 200 on all four with or without a User-Agent.
- `/v2/golf/enriched`'s course read and its new tee-time read (`docs/CC-CMD-2026-11-16-golf-tee-times.md`) now come from ESPN's golf **leaderboard** on `ESPN_API_BASE` (`464d4f7`): a different endpoint on the host the relay already reads everything else from, not a second host for the core API and not a per-request fallback. If the block flips, it moves with `ESPN_API_BASE`.
- Still on the core API and still 403, unchanged here: `/v2/golf/eventlog`, `/v2/golf/competitor-stats` and the enriched route's top-20 stats (all of which call `handleGolfCompetitorStats`), `/soccer/xg`, `/soccer/sub-impact`. The leaderboard read before round 1 carries `statistics` per competitor (`scoreToPar`, `officialAmount`, `cupPoints`) and not the shot stats the top-20 path reads, so it is not a replacement for those; the owner's decision (a non-ESPN source, or the route says it is degraded) stands for them.
- The tee-times build of 2026-11-18 put a new core read into this list without reading this CC-CMD. Recorded there as a BUILD-ON-A miss.

### Task 3, 2026-11-19: RULED and BUILT, the five read sites moved to a runner mirror

**Ruling (owner, 2026-11-19):** "Move the 5 other relay routes to runners." This is the decision the section above left open; it supersedes "a non-ESPN source, or the route says it is degraded" for these five sites.

**Premises, each tried before building (Rule 100):**

| premise | command | result |
|---|---|---|
| a runner can read every core URL the five sites use | `espn-core-runner-probe.yml` (`outbox/espn-core-runner-probe-*.json`) | **held**: 12 of 12 answered 200 (golf stats, eventlog, MLS/EPL/UCL team stats, athlete positions) |
| the bodies carry values and fit D1 rows | the same | **held**: golf stats 6 KB with values (Austin winner -17, 299.2 yd); soccer team stats 64 KB raw with xG in all three leagues; eventlog 12 KB |
| a GitHub schedule can keep a live mirror fresh | gaps between 60 scheduled runs of `wnba-slate-to-kv.yml` (`*/5`) and `auto-merge-stray-branches.yml` (`*/30`) | **refuted**: median 377 and 403 minutes apart (p90 507, 509). So the runner is DISPATCHED by the relay's */15 Cloudflare cron; dispatched runs start within seconds |
| ESPN's scoreboard takes a date range, so a backfill is one read per league | `html_probe` `?dates=20261101-20261119` | **refuted**: HTTP 400. One read per league per day |

**Built:** `9701fdd` (the mirror), `b9eeb46` (a failed read is said, after the absence-collapse ratchet stopped the first deploy on `res.results || []`).

- `scripts/espn-core-mirror.mjs` (runner) reads and trims, then writes ARCHIVE_DB `espn_core_mirror` through `/d1/execute`, which allow-lists the table.
- `.github/workflows/espn-core-mirror.yml` has no schedule. The relay dispatches it from the */15 tick (`dispatchEspnCoreMirror`). With `backfill_days`, it also sweeps finished soccer games further back.
- The read sites call `readCoreMirror(env, <core path>)` (`src/espn-core-mirror.js`). No route names the core host, so the provenance stamps read `d1:ARCHIVE_DB`.
- A missing row is said, not served as empty: xg `_mirror`, sub-impact `positionsUnresolved`, golf `mirroredAt` / `"not mirrored"`. `CONTRACTS.md` "ESPN core API mirror" covers it; jubilant-bassoon is synced (`e1395d6e`).
- `check-espn-core-mirror` is in `deploy.yml`: 30 checks on raw runner-read bodies, self-test 11 of 11 mutants.

**Verified live, 2026-11-19 02:30Z** (deploy run 44443119261, `deploy` and `verify` green):

- Backfill run 44444787613 (7 days):
  - 152 scoreboards, 25 finished games (League One, League Two, EFL Trophy; the top leagues are on the international break);
  - 50 team stats, 140 athlete positions, 147 golf eventlogs written;
  - 0 failed, 15 s.
- Run 44444809145 at 02:30:25, with `backfill_days` 0, was the relay's own */15 dispatch; the only other dispatch was the backfill. It re-read nothing: everything was already final or fresh.
- D1 holds 50 `soccer-team-stats` (all final, largest body 6,751 bytes), 140 `soccer-athlete` and 147 `golf-eventlog` rows.
- `probe_relay_route` reads:
  - `/v2/golf/eventlog?athleteId=3257`: `ok:true`, 18 PGA events, `mirroredAt` 02:30:39Z.
  - `/soccer/xg?league=eng.3&event=401880743`: `_mirror {home 02:30:35.947Z, away 02:30:35.949Z, error null}`.
  - `/soccer/sub-impact` on the same game: `positionsUnresolved: 0`.
  - `/v2/golf/competitor-stats?eventId=401850981&athleteId=3257`: `{ok:false, error:"not mirrored"}`. RSM round 1 has not started, and the runner reads stats only once a player is on the course or finished.
  - `/soccer/xg?league=usa.1&event=761934`: `_mirror.error "not mirrored"`. That game is older than the 7-day window, and the client's MLS scans look back 6 days.

**Still to read** (done conditions, artifacts named):

1. Golf stats during RSM round 1: `/v2/golf/competitor-stats?eventId=401850981&athleteId=<a player on the course>` returns `ok:true` with a `mirroredAt` under 20 minutes old. Read by `trig_01Xgs5MBnCBxLJiUS41EPefg` (17:30Z today), which reads `/v2/golf/enriched` and now also this.
2. The next live soccer game (the top leagues return 2026-11-21): `/soccer/xg` `_mirror.home` under 5 minutes old during play.

**Found while building, recorded and not changed here** (Rule 69):

- **`/soccer/xg` reports `_hasMatchStats: true` on all-zero stats.** ESPN serves every League One team statistic as 0 for game 401880743, `totalGoals` included. Read raw through the browser tool on 2026-11-19, so the zeros are ESPN's, not the mirror's. The route sets `_hasMatchStats` from whether `possessionPct` exists, not from its value, so an empty feed reads as a real 0% match. The context assembler would then write a stats block of zeros. The fix is owner-scoped: what counts as "has match stats".
- **`/v2/golf/eventlog` returns `competitorId` equal to the event id.** `extractId` takes the first `/(events|competitions|competitors)/(\d+)` match, so the competitor `$ref` yields its event id (live read above: `competitorId` 401811936 for athlete 3257). This predates the mirror. The route has no consumer in any of the three repos (grep, 2026-11-19).
