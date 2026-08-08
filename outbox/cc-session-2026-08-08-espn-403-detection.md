# ESPN site.api 403 — detection half — Result

## Status: DETECTION SHIPPED AND CONFIRMED FIRING.
## The P0 itself is NOT fixed — host swap deliberately not done.

## What prompted this

A request to get FIELD ready for the EFL (Carabao) Cup. Probing for the
ESPN slug turned up a live production incident instead:
`site.api.espn.com` returns **403 to Cloudflare Worker egress IPs**, so
the deployed relay answers `{"error":"ESPN upstream 403"}` for `/v2/games`
on every sport tested (`epl`, `mlb`).

## Why it was invisible — the actual engineering gap

`STRUCTURAL 7` was the **only** ESPN-touching gate in the entire deploy,
and it could not distinguish "broken" from "quiet":

```python
if not games:
    print('⏳ No real MLB/WNBA games found for today -- genuine off-day')
    sys.exit(0)
```

`/v2/games` answers an ESPN 403 with **valid JSON** under HTTP 502, so
`load()` parsed it cleanly, `.get('games')` returned `None`, `games` was
`[]`, and an all-sports upstream outage was reported as an off-day. The
status code was discarded entirely. Compounding it, `deploy.yml` only
triggers on `src/**` pushes — so a quiet period produces no signal at all.

Net effect: users likely still saw live scores (the client fetches ESPN
from browser IPs, which are not blocked) while the relay-side archive,
journalism, and analytics layer silently returned nothing.

## Shipped

**`47fc080` — STRUCTURAL 7 now captures HTTP status and fails on upstream
error.** Strictly additive; verified all four branches against real
payloads including today's verbatim 502 body:

| case | before | after |
|---|---|---|
| real 502 ESPN-403 | exit 0 (silent pass) | **exit 1** |
| genuine empty slate | exit 0 | exit 0 (unchanged) |
| real games with streams | exit 0 | exit 0 (unchanged) |
| games but no streams (original bug) | exit 1 | exit 1 (unchanged) |

No pre-existing assertion was weakened or removed.

**`c0a69cd` — hourly `espn-reachability-monitor.yml`**, non-blocking, red
X in the Actions tab, same pattern as `rule90-staleness-monitor.yml`. It
checks the relay (the signal that matters, since Worker egress is what is
blocked) and records both ESPN hosts from the runner as context.

## Confirmed firing — first run

Run [`31258130493`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/31258130493),
2026-08-08T12:49Z, verbatim:

```
RELAY_FAIL: 1
=== both ESPN hosts, from this runner (NOT a Worker IP) ===
  site.api     : HTTP 200
  site.web.api : HTTP 200
::error::ESPN is unreachable through the deployed relay.
```

Two facts from one run: **the outage is still live**, and both hosts
answer 200 from a non-Worker IP — consistent with IP-reputation blocking
rather than anything about hosts, headers, or slugs.

## Deliberately NOT done

The host swap to `site.web.api.espn.com` (proven working from the Worker
IP via `html_probe`, 297 KB of real live data). Reasons, both real:

1. It re-points 17+ call sites across `src/index.js` and
   `src/wp-resolver.js` — an infrastructure change that Rule 39 wants
   mapped and consumer-audited first.
2. **It is the same Akamai edge.** Nothing prevents `site.web.api` being
   blocked next. It is mitigation, not a fix — which is exactly why
   detection went first: without it there is no way to know whether a
   swap held.

The open question the monitor now answers hourly is whether this block is
transient, permanent, or spreading. That determines whether the swap is
warranted or whether the durable answer is reducing single-source
dependence (the relay already carries `statsapi.mlb.com`,
`api-web.nhle.com`, `cdn.nba.com`, `stats-api.mlssoccer.com`, FD, FPL —
ESPN is sole source mainly for the 11 soccer club leagues and WC).

## Still open
- `docs/CC-CMD-2026-08-08-espn-site-api-403-p0.md` — the fix half.
- `docs/CC-CMD-2026-08-08-efl-carabao-cup-coverage.md` — blocked on it.
- Client impact confirmed as *probably* unaffected by reasoning about
  egress IPs, **not** measured. Flagged in the P0 CC-CMD as
  must-check-not-assume.

## Outbox
This file.
