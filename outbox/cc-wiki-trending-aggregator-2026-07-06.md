# Wiki Trending Aggregator — 2026-07-06

## Commit

- `15942c1` feat(wiki): add /wiki/trending endpoint with KV caching and throttled batch fetch

## What Was Built

### Endpoint: `GET /wiki/trending?date=YYYY-MM-DD`

Returns a single JSON object mapping every tracked team name → Wikimedia 8-day trailing pageview spike data. If `date` is omitted, defaults to today.

**Cache hit path:** Returns from `FIELD_JOURNALISM` KV under key `wiki:trending:{date}`, TTL 26 hours. Zero external Wikimedia fetches. Response includes `X-Cache: HIT`.

**Cache miss path:** Fetches all 86 teams in batches of 5, with 150ms between batches — never a naive `Promise.all` of 86 simultaneous calls. Each team fetches independently; a failed fetch returns `null` for that team's value, not a 500 for the whole response.

**Per-team computation** (matching client's `fetchWikiSignificance` exactly):
- 8-day window: days 0–7 before `dateParam`
- `todayViews` = final day's views
- `avgViews` = mean of days 0–6
- `spikeRatio` = `todayViews / avgViews` (rounded to 2dp)
- `trending` = `spikeRatio > 2.0`

**Team list:** copied verbatim from `jubilant-bassoon/index.html`'s `WIKI_TITLES` constant — 86 teams across NBA (26), NHL (16), MLB (24), EPL (16), EFL (4).

`/wiki` also added to the MCP probe allow-list so `probe_relay_route` can reach it for future verification.

### TASK 2 — Verification

**Cold path (first call, cache miss):**
```
GET /wiki/trending?date=2026-07-06
status: 200, bodyBytes: 7648
```
Real data confirmed for sample teams (hand-cross-checkable values):
- Kansas City Royals: `todayViews: 1988, avgViews: 796, spikeRatio: 2.5, trending: true` ✓
- New York Knicks: `todayViews: 5973, avgViews: 6082, spikeRatio: 0.98` ✓
- Manchester City: `todayViews: 34035, avgViews: 17908, spikeRatio: 1.9` ✓

All 86 teams present. Zero null values in the response.

**Warm path (immediate second call, cache hit):**
```
GET /wiki/trending?date=2026-07-06
status: 200, bodyBytes: 7648 (byte-identical)
```
Values are identical to the millisecond — confirming KV cache was served, not a second live fetch (which would produce slightly different views counts on a fresh Wikimedia call). `X-Cache: HIT` header confirmed.

**Individual team failure isolation:** not directly triggered in live test (all 86 fetched successfully), but the `try/catch` per team with `return [teamName, null]` fallback is code-reviewed — one bad title cannot throw out of the batch loop.

## Client-Side Follow-Up — Separate CC-CMD Required

This relay endpoint is built and live. The client (`jubilant-bassoon/index.html`'s `fetchWikiSignificance`) **still makes direct per-team Wikimedia fetches** — it does not yet call this endpoint. A separate jubilant-bassoon CC-CMD is needed to:
1. Replace `fetchWikiSignificance`'s per-team `fetch()` calls with a single `fetch('/wiki/trending?date=today')`
2. Map the relay's response shape back onto the existing `wikiData[teamName]` structure the client already consumes
3. Verify the substitution produces identical rendering with no layout shift

Until that CC-CMD ships, this endpoint exists but the rate-limiting problem on the client side is not yet solved.

## Confidence Score

```
+30  Endpoint built correctly; exact WIKI_TITLES list copied verbatim; no re-derivation
+25  KV caching correct: FIELD_JOURNALISM binding, key=wiki:trending:{date}, TTL=26*3600
+20  Throttled batching: 5 teams per batch, 150ms delay — not a naive Promise.all of 86
+15  Both paths verified live: cold fetch returned real data (7648 bytes, 86 teams, 0 nulls);
     warm hit returned byte-identical payload confirming KV served, not re-fetched
+10  Individual-team failure isolation via per-team try/catch returning null
= 100/100
```

## Compliance

- Rule 68: probe block confirmed zero existing Wikimedia code before starting; both cold and warm paths verified live post-deploy
- Rule 69: only new `/wiki/trending` route block added + one `/wiki` entry to probe allow-list; no other routes or logic touched
- Rule 87: live verification completed within session (both cache paths probed); outbox is last task
- Rule 47 (RELAY-IS-DUMB): endpoint returns raw pageview facts; the `trending: spikeRatio > 2.0` computation is a direct copy of the client's existing arithmetic, not new editorial logic invented here
