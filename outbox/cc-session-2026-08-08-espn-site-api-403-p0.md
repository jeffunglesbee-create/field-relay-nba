# CC-CMD-2026-08-08-espn-site-api-403-p0 — Result

## Status: Task 1 ✅ · Task 2 ✅ FIXED AND VERIFIED LIVE · Task 3a ✅ ·
## Task 3b → second CC-CMD (Rule 87), because 3a materially changed its shape.

## Task 1 — block was STILL LIVE at execution time

The CC-CMD gates everything on this. Re-checked against the deployed
relay before touching code:

```
/v2/games?sport=epl&date=2026-08-08 -> 502 {"error":"ESPN upstream 403"}
/v2/games?sport=mlb&date=2026-08-08 -> 502 {"error":"ESPN upstream 403"}
```

Monitor history: 1 run, `failure` (2026-08-08T12:49Z). So the swap was
warranted, not churn. `site.web.api` re-confirmed from the **Worker IP**
via `html_probe`: HTTP 200, 308402 bytes of real MLB scoreboard.

## Task 2 — mitigation shipped and verified

`214da59`. 14 hardcoded `https://site.api.espn.com/apis/site/v2` literals
across 2 files collapsed to one constant each — `ESPN_API_BASE`
(`src/index.js`), `ESPN_SCOREBOARD_BASE`/`ESPN_SUMMARY_BASE`
(`src/wp-resolver.js`, which cannot import from index.js; that
duplication is pre-existing and documented in-file). Diff: 2 files,
+39/-16. No browser headers added anywhere (the matrix showed they make
`site.api` strictly worse), no `cf:{cacheTtl,cacheEverything,cacheKey}`
options touched.

Deploy [`31260065550`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/31260065550)
— **run-level `success`** (which also shows the 2026-08-06 push-race fix
holding).

**Before → after on the exact failing calls:**

| call | before | after |
|---|---|---|
| `/v2/games?sport=mlb` | 502 `ESPN upstream 403` | **200, 15 real games** |
| `/v2/games?sport=epl` | 502 `ESPN upstream 403` | **200**, `count:0` |

MLB returns full payloads with `streams` populated (`MLB.TV`, `YES`,
`NESN`, `FOX`, `SNY`…) — the exact shape `STRUCTURAL 7` asserts. The EPL
`count:0` is a genuine pre-season empty, **not** an error: it is HTTP 200
with `source:"espn-wc"` and no error field, which is precisely the
distinction the 2026-08-06 detection fix was built to make. Verifying on
MLB rather than accepting EPL's empty array is the same lesson applied.

## Task 3a — source audit, and a correction to my own earlier claim

**Correction (Rule 77 applies to my own reporting):** I earlier described
this as breaking "every sport." That was an overreach — I measured `epl`
and `mlb`, both ESPN-backed, and generalised. The real table, read from
`V2_LEAGUES`:

| sport(s) | primary source | ESPN-dependent? | native alternative present in relay |
|---|---|---|---|
| **NBA** | `cdn.nba.com` (`nbaSource:'cdn'`) | **NO** | already migrated (June 2026) |
| **NHL** | `api-web.nhle.com` (`nhleSource:true`) | **NO** | already migrated (June 2026) |
| MLB | ESPN `mlb` | YES | **`statsapi.mlb.com`** (`MLB_STATS_API_BASE`) |
| MLS | ESPN `usa.1` | YES | **`stats-api.mlssoccer.com`** (`MLS_STATS_BASE`) |
| EPL / La Liga / Serie A / Bundesliga / Ligue 1 / UCL / UEL / UECL (+quals) | ESPN | YES | **`api.football-data.org/v4`** (`/fd/*`, allow-listed) — coverage per competition NOT yet verified |
| AFL | ESPN `afl` | YES | **Squiggle** + **Kali** present |
| WNBA, NFL, CFB, PGA, ATP/WTA, WC26, EFL Champ/L1/L2 | ESPN | YES | **none present** — true single-source exposure |

**NBA and NHL were never affected by this outage.** That is not luck — it
is the June 2026 migration off API-Sports onto native sources, and it is
precisely the resilience pattern Task 3 asks for, already executed twice,
with `adaptNbaCDN()` and `adaptNhle()` as working templates that emit the
same V2 game shape.

## Task 3b — deliberately NOT implemented here; second CC-CMD written

`docs/CC-CMD-2026-08-08-espn-secondary-source-failover.md`.

3a changed 3b's shape, which is exactly what an audit-first task is for.
The parent CC-CMD anticipated a config-level failover; the real
`/v2/games` architecture routes every ESPN sport through a per-sport
**adapter** (`adaptESPNMLB`, `adaptESPNWCSoccer`, `adaptESPNFootball`…).
A genuine secondary therefore needs a *new adapter per source*, mapping
that API's shape into the V2 game shape — not a base-URL swap. Real
consequences that must be designed, not improvised:

- `statsapi.mlb.com` carries no broadcast data, so an MLB failover yields
  games with empty `streams` — which `STRUCTURAL 7` currently treats as a
  **failure**. Shipping that blind would trade an outage for a red CI.
- FD's per-competition coverage is unverified and its free tier is
  rate-limited (Rule 78).

Attempting that inside this CC-CMD's remaining budget would be the "quick
way" Rule 88 forbids. Scoped to MLB-first in the second CC-CMD to prove
the pattern against a sport that is in-season and testable today.

## Task 4 — artifacts

1. ✅ `/v2/games?sport=mlb` → 200, 15 games, streams populated (above).
2. ✅ `/v2/games?sport=epl` → 200 (was 502); empty is real, not an error.
3. ✅ Deploy `31260065550`, run-level success.
4. ✅ Diff scope: 2 files, +39/-16, ESPN base URL only.
5. ⏳ Forced-failure failover proof — belongs to the second CC-CMD, since
   no failover exists yet.
6. ⏳ Monitor re-run green — see residual below.

## Residual, disclosed

- **`espn-reachability-monitor.yml` not yet re-run green.** The relay
  probes above are stronger evidence (they are the same assertion the
  monitor makes), but the monitor's own green run is not yet recorded. It
  runs hourly on its own schedule and will record it unattended.
- **Client not measured.** Still reasoned-only: jubilant-bassoon fetches
  ESPN from browser IPs, which are not what Akamai blocked. The 13 client
  literals still point at `site.api`. If browser IPs are ever included in
  the block, the client breaks independently of this fix. Carried into
  the second CC-CMD rather than left loose.
- **ESPN remains primary for every sport that had it as primary.** This
  change swapped hosts only; it did not re-architect or demote ESPN
  anywhere.

## Outbox
This file.
