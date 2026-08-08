# CC-CMD-2026-08-08-espn-site-api-403-p0

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Severity: P0, live as of 2026-08-08T12:49Z.** Relay-side ESPN scoreboard
data is failing for every sport.

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-08-espn-site-api-403-p0.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## ✅ Detection is ALREADY SHIPPED — do not redo it

Landed before this CC-CMD was written; recorded here so it is not
re-implemented (Rule 69) and so its evidence is available:

- **`47fc080`** — `STRUCTURAL 7` now captures the HTTP status and fails
  explicitly on upstream error. It previously could not distinguish
  "broken" from "quiet": `/v2/games` answers an ESPN 403 with **valid
  JSON** under HTTP 502, so `load()` parsed it, `.get('games')` was
  `None`, and an all-sports outage printed "genuine off-day" and exited 0.
  Strictly additive — genuine-empty-slate still skips, games-without-
  streams still fails.
- **`c0a69cd`** — `espn-reachability-monitor.yml`, hourly, non-blocking,
  red X in the Actions tab. Confirmed firing on its first run
  ([`31258130493`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/31258130493)).
- Outbox: `outbox/cc-session-2026-08-08-espn-403-detection.md`.

**Use the monitor's run history as this CC-CMD's primary input.** It
answers the question that decides everything below: is the block
transient, permanent, or spreading?

## The measured incident

`site.api.espn.com` returns **403 to Cloudflare Worker egress IPs**.
Against the LIVE relay, 2026-08-08:

```
/v2/games?sport=epl&date=2026-08-08  -> 502 {"error":"ESPN upstream 403"}
/v2/games?sport=mlb&date=2026-08-08  -> 502 {"error":"ESPN upstream 403"}
```

It is **not** slugs and **not** headers. A host × header matrix from a
GitHub runner (run [`31257247214`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/31257247214)):

| host | headers | result |
|---|---|---|
| `site.api` | bare | 200 |
| `site.api` | browser (Origin/Referer/UA) | **403** |
| `site.web.api` | bare | 200 |
| `site.web.api` | browser | 200 |

Browser headers make `site.api` *worse* — the inverse of the intuitive
fix. The relay already sends a bare `fetch()` and still 403s, while the
identical bare request from a runner returns 200. The monitor's first run
reconfirmed both hosts at HTTP 200 from a runner while the relay failed.
**The discriminator is the egress IP.**

`html_probe` from the CF Worker IP proves the escape hatch:
```
https://site.web.api.espn.com/apis/site/v2/sports/soccer/eng.league_cup/scoreboard?dates=20260808
-> HTTP 200, 297382 bytes, real live data
```

## Task 1 — Re-verify liveness FIRST (Rule 87), and let it gate everything

Read `espn-reachability-monitor.yml`'s run history, plus a fresh
`probe_relay_route /v2/games?sport=epl&date={today}`.

- **If ESPN is reachable again:** the block was transient. **Do Task 3
  only.** Do NOT re-point 17+ call sites for an outage that healed —
  that is churn, and the monitor now catches a recurrence within the hour.
  Record the monitor's failure window (first red → first green) in the
  outbox; that duration is the real input to whether Task 2 is ever worth
  doing.
- **If still failing:** do Task 2, then Task 3.

## Task 2 — Mitigation: re-point to the working host (only if still failing)

- Route the failing scoreboard/summary reads through **one** constant.
  `ESPN_SUMMARY_BASE = 'https://site.web.api.espn.com/apis/site/v2'`
  already exists and already works from the Worker — reuse it or add one
  sibling constant. Do **not** hand-edit 17 string literals into
  divergence.
- Do **not** add browser headers to `site.api` (the matrix shows it is
  strictly worse). Do **not** change the `cf: { cacheTtl, cacheEverything,
  cacheKey }` options.
- **State plainly in the outbox that this is mitigation, not a fix** —
  `site.web.api` is the same Akamai edge and can be blocked next. That is
  precisely why Task 3 exists.
- Scope: relay only. The client fetches ESPN from **browser** IPs (13
  references in jubilant-bassoon) which are almost certainly not blocked
  — but this is **reasoned, not measured**. Measure it; if the client is
  also failing, write a paired client CC-CMD (Rule 70) rather than
  editing jubilant-bassoon here.

## Task 3 — Resilience: stop being single-sourced where a second source already exists

This is the durable half and is worth doing **even if the block healed**.

### 3a. Audit what is actually single-sourced (do this before writing code)

The relay already carries non-ESPN sources. Build a real table of
sport → primary → available secondary, from source, not from this doc:

| already present in the relay | covers |
|---|---|
| `statsapi.mlb.com` | MLB |
| `api-web.nhle.com` | NHL |
| `cdn.nba.com` | NBA |
| `stats-api.mlssoccer.com` | MLS |
| `api.football-data.org/v4` (`/fd/*`) | top European soccer |
| `fantasy.premierleague.com` | EPL (fantasy-shaped) |

**Correct a claim made earlier in this investigation:** soccer was
initially described as effectively single-sourced. That is wrong — FD is
already wired and allow-listed (`/matches`, `/competitions/*`) and the
client already uses it (`fdPrefetchSoccerLive`). Verify FD's **real
competition coverage** against the leagues FIELD actually serves before
relying on it; do not assume it covers the EFL Cup or the lower English
tiers.

Output of 3a is a written table naming, per sport, whether a genuine
secondary exists. Sports with no secondary are the real exposure and
should be named explicitly rather than left implied.

### 3b. Add a **two-level** source failover where 3a found a real secondary

- **Rule 76 (FALLBACK-CAP-A) applies and must be respected: primary +
  secondary, nothing deeper.** Rule 76 targets guessy field-read chains
  born of a broken contract; a deliberate, declared source failover is a
  different construct — but it earns that distinction only if it stays at
  two levels and is declared in one place, not sprinkled per call site.
  If the design starts needing a third level, stop: that means the
  contract is wrong, not that another `||` is needed.
- Failover must be **observable**: when the secondary serves, say so in
  the response or a log line. A silent failover reintroduces exactly the
  invisibility this whole incident was made of.
- **Rule 78 (API-COST-A):** FD's free tier is rate-limited. Any failover
  that fires per-request under an ESPN outage could burn the quota in one
  cron cycle. Replicate the existing `relayFetch` caching/TTL pattern
  exactly and state the measured limit in the outbox.

### 3c. Explicitly out of scope
- Do not add new vendors or paid sources.
- Do not migrate any sport off ESPN as *primary* — ESPN stays primary
  where it works; this task adds a fallback, it does not re-architect.
- Do not touch the EFL Cup wiring (that is
  `CC-CMD-2026-08-08-efl-carabao-cup-coverage`, and it is blocked on this).

## Task 4 — Verification (Rule 89 — artifacts, not "works")

1. `probe_relay_route /v2/games?sport=epl&date={today}` → HTTP 200 with a
   non-empty `games` array — the exact call returning `ESPN upstream 403`
   today. Same for `mlb`, to prove it is not soccer-specific.
2. `espn-reachability-monitor.yml` dispatched manually and **green**, run
   ID quoted.
3. A deploy run whose `STRUCTURAL 7` step passes *for the right reason* —
   quote the line, and confirm it is the streams-OK message, not the
   off-day skip.
4. For Task 3: a forced-failure test proving the secondary actually
   serves — e.g. point the primary at a deliberately bad host in a
   scratch run and show the secondary responding, with the observability
   line present. "The code has a fallback" is not an artifact.
5. Diff scope: exact files and line counts.

## Outbox

`outbox/cc-session-2026-08-08-espn-site-api-403-p0.md`: whether the block
was still live (and the monitor's failure window), the before/after
`/v2/games` responses verbatim, the 3a source table, what failover was
added and its forced-failure proof, whether the client was **measured**,
and an explicit statement of whether ESPN remains primary everywhere.
