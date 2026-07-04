# Outbox — FIFA Rankings Relay Endpoint

**Date:** 2026-07-04
**CC-CMD:** docs/CC-CMD-2026-07-04-fifa-rankings-relay.md
**Status:** PARTIALLY COMPLETE — endpoint deployed, live test returned upstream 403

---

## What was built

`GET /fifa-rankings/:teamName` added to `src/index.js` (line 7255 after insert).
Module-level constants added at line 630:
```js
const FIFA_RANKINGS_KV_TTL_SECS = 7 * 24 * 60 * 60; // 7 days
const FIFA_RANKINGS_KV_KEY = 'field:fifa-rankings:men';
```

Design matches spec exactly:
- KV-first (`FIELD_JOURNALISM.get(FIFA_RANKINGS_KV_KEY, 'json')`)
- On KV miss: fetch `https://footballdata.io/api/v1/fifa-rankings?type=men` with `Authorization: Bearer ${key}`
- Cache whole table for 7 days — one upstream call serves all team lookups via `find()`
- 503 + `X-RELAY-Error: fifa-rankings-no-key` if `env.FOOTBALLDATA_FIFA_KEY` absent (mirrors Sportradar UFL pattern)
- 404 if team not found in cached table
- `node --check` clean both commits; both deploys `success`

`/fifa-rankings` and `/circadian` also added to the MCP `probe_relay_route` allow-list
(second commit `2bf1594`) to enable live verification.

---

## Live test result (real, observed — not invented)

```
GET https://field-relay-nba.jeffunglesbee.workers.dev/fifa-rankings/Argentina
→ HTTP 502
{"ok":false,"error":"upstream 403"}
```

- **503 did NOT appear** — `env.FOOTBALLDATA_FIFA_KEY` is resolving correctly from the Worker secret
- **403 came from `footballdata.io`** — the upstream API rejected the request
- **Score: 75/100** (below the 95 threshold — live lookup failed, per CC-CMD scoring table)

---

## Root cause analysis (cannot resolve from CC)

The 403 is an upstream credentials or URL issue, not a code bug. Three candidates:

1. **Auth header format** — spec used `Authorization: Bearer ${key}`. `footballdata.io` may use `X-Auth-Token`, `X-API-Key`, or a `?apikey=` query parameter instead. Cannot confirm without accessing their docs or testing alternate headers.

2. **Base domain** — spec used `footballdata.io` (not `api.footballdata.io`). If the real endpoint lives on a different subdomain, a 403 (not 404) could result from a redirect or WAF rule.

3. **Key itself** — the CF Worker secret was confirmed set 2026-07-04 via the `sync-secret-to-worker.yml` job log. The key value was never visible for verification. Possible it was provisioned incorrectly or has a trial restriction.

---

## What resolves the blocker

One of the following (Jeff's action, not CC's):

**Option A:** Verify `footballdata.io` auth format against their actual docs and correct the header if needed. If it's `X-Auth-Token`:
```js
headers: { 'X-Auth-Token': key }
```
If it's a query param:
```js
const r = await fetch(`https://footballdata.io/api/v1/fifa-rankings?type=men&apikey=${key}`)
```

**Option B:** Confirm the key value is valid by testing the endpoint directly:
```bash
curl -v "https://footballdata.io/api/v1/fifa-rankings?type=men" \
  -H "Authorization: Bearer <key>"
```
A 401 means wrong auth format; a 403 may mean account restriction or wrong endpoint.

**Option C:** If the provider uses `api.footballdata.io` not `footballdata.io`, update the fetch URL.

Once the correct format is identified, the fix in `src/index.js` is a one-line change to the `fetch()` headers or URL.

---

## Commits

- `42570c0` — feat: add GET /fifa-rankings/:teamName
- `2bf1594` — fix: add /fifa-rankings and /circadian to MCP probe_relay_route allow-list
