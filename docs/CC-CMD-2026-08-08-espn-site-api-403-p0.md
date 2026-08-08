# CC-CMD-2026-08-08-espn-site-api-403-p0

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Severity: P0, live now.** Relay-side ESPN scoreboard data is failing for
every sport.

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-08-espn-site-api-403-p0.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## The real, measured incident

`site.api.espn.com` returns **403 to Cloudflare Worker egress IPs**. The
deployed relay is failing on every ESPN-sourced scoreboard right now.
Measured 2026-08-08 via `probe_relay_route` against the LIVE relay:

```
/v2/games?sport=epl&date=2026-08-08  -> 502 {"error":"ESPN upstream 403","sport":"epl"}
/v2/games?sport=mlb&date=2026-08-08  -> 502 {"error":"ESPN upstream 403","sport":"mlb"}
```

**It is not headers, and it is not the slug.** A CI probe
(run [`31257247214`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/31257247214))
tested the full host × header matrix from a GitHub runner:

| host | headers | result |
|---|---|---|
| `site.api` | bare | 200 |
| `site.api` | browser (Origin/Referer/UA) | **403** |
| `site.web.api` | bare | 200 |
| `site.web.api` | browser | 200 |

Note this is the *inverse* of the intuitive guess — adding browser
headers to `site.api` causes a 403. But the relay's V2 path already
sends a **bare** `fetch()` (`src/index.js`, the `cfg.espnLeague`
early-return, `cf: { cacheTtl: 15, cacheEverything: true }`) and still
403s, while the same bare request from a GitHub runner returns 200.
**The discriminator is the egress IP**: Akamai is blocking Cloudflare
Worker IPs on `site.api.espn.com`.

**The fix is proven from the IP that matters.** `html_probe` (which runs
on the CF Worker IP) against the *other* host:

```
https://site.web.api.espn.com/apis/site/v2/sports/soccer/eng.league_cup/scoreboard?dates=20260808
-> HTTP 200, 297382 bytes, real live data (Cambridge United vs Barnet, STATUS_FIRST_HALF, 31')
```

`site.web.api.espn.com` serves the **same scoreboard payload** and is
already trusted in this repo — `ESPN_SUMMARY_BASE` points at it and
`/espn-summary` returns 200 from the Worker today (verified: 838 KB of
real MLB data).

## Blast radius (why this is P0 and not cosmetic)

Relay-side consumers of `site.api.espn.com` scoreboard/summary:
`handleV2Games`, `handleJournalismCycle`'s pre-game seed / today's-finals
catch-up / yesterday catch-up, score-fill, tennis, PGA, and
`src/wp-resolver.js`. 17 references in `src/index.js` + `src/wp-resolver.js`.

**The client is probably NOT affected and must be checked separately, not
assumed:** jubilant-bassoon fetches ESPN directly from the user's browser
(13 references), and browser egress IPs are not what Akamai is blocking.
That asymmetry is why this can be silently degrading the archive /
journalism / analytics layer while users still see live scores — do not
conclude "users are fine so it's minor" without checking.

## Task 1 — Re-verify the incident is still live (Rule 87)

Do not act on this doc's measurements; they may be hours stale and the
block may be intermittent.

- `probe_relay_route /v2/games?sport=epl&date={today}` — confirm it still
  returns `ESPN upstream 403`. If it now returns 200, the block has
  lifted: **stop, report that, and do not make the host change.** A
  transient upstream block is not a reason to permanently re-point every
  ESPN call.
- `html_probe` both hosts for the same scoreboard path and record both
  status codes verbatim.

## Task 2 — If still failing: re-point scoreboard/summary reads

- Introduce a single constant for the working base (there is already
  `ESPN_SUMMARY_BASE = 'https://site.web.api.espn.com/apis/site/v2'`) and
  route the failing call sites through it rather than hand-editing 17
  string literals into divergence (Rule 76 — one contract, not N).
- Do **not** change `cf: { cacheTtl, cacheEverything, cacheKey }` options;
  a cached 403 under `cacheEverything` is a real secondary hazard worth
  noting but the TTLs here are short (15-25s) and are not the root cause.
- Do **not** add browser headers to `site.api` — the matrix above shows
  that makes it strictly worse.
- Scope boundary: relay only. Do not touch jubilant-bassoon in this
  CC-CMD; if Task 1 shows the client is also failing, write a separate
  paired CC-CMD (Rule 70).

## Task 3 — Verification (Rule 89 — artifacts, not "works")

1. `probe_relay_route /v2/games?sport=epl&date={today}` returning HTTP
   200 with a non-empty `games` array — the exact call that returns
   `ESPN upstream 403` today.
2. The same for a second, different sport (`mlb`), to prove it is not
   soccer-specific.
3. A deploy run ID whose `deploy` job succeeded, with the structural
   probe steps' conclusions quoted.
4. A diff limited to the ESPN base-URL change — state the exact number of
   lines and files changed.

## Outbox

`outbox/cc-session-2026-08-08-espn-site-api-403-p0.md`: whether the block
was still live at execution time, the before/after `/v2/games` responses
verbatim, the host×header matrix re-measured, the diff scope, and an
explicit statement of whether the client was checked and what was found.
