# Claude Code Command — no shot is drawn during a live match: `bsd:stats` never carries one

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba (`src/ambient-do.js`) executes the relay half; jubilant-bassoon needs no change if the payload keeps its name
**Filed:** 2026-10-29, by CC, found while verifying `docs/CC-CMD-2026-10-28-bsd-pitch-renderer-fields.md`
**Status:** BLOCKED on one owner decision. Task 0 DONE 2026-10-29 (`outbox/bsd-request-budget-latest.json`, run 40962540855): the budget CANNOT be measured from the
vendor, which is the finding. Task 1 design decided below. The build waits on ONE owner decision, a daily cap for the new poll
(recommended: 600). Blocked by: that number. Unblocked by: "use 600" or another figure. Nothing else.

---

## Related, read before building (BUILD-ON-A)

Searched 2026-10-29 by content (`shotmap`, `momentum`, `live shot`, `bsd:stats`, `_bsdOnFrame`) in `docs/CC-CMD-*.md`
of field-relay-nba and field-laboratory.

- `docs/CC-CMD-2026-10-28-bsd-ws-fanout-field-names.md` (DONE): recorded that `shotmap` and `momentum` are `null`
  on every event frame and left them forwarded as-is. It did not ask where a live shot would come from.
- `docs/CC-CMD-2026-10-28-bsd-pitch-renderer-fields.md` (DONE): the client now places a shot from `pos` + `home`.
  That reader is proven on a recorded payload; this command is what gives it a live one.
- Rule 78 (API-COST-A) governs the budget question in Task 0.

## What was measured (Rule 73)

2026-10-28/29, `field-relay-nba` `outbox/bsd-ws-frames-*.jsonl`, four matches:

1. 0 of 170 recorded `event` frames carry a `shotmap` key (their keys: type, event_id, home, away, score, time,
   stats, websocket_plus). AmbientDO's `bsd:stats` therefore always has `shotmap: null`.
2. The client draws shots from two places only: `bsd:stats.shotmap` (always null) and, for a finished game,
   `/bsd/r2/read?key=bsd/{league}/{id}/stats.json` (the REST record array, `pos`, `home`, `xg`). So a LIVE match
   shows a ball and never a shot.
3. The REST route `/bsd/events/{id}/shotmap` is `no-store` while an event is live (`src/index.js`, the shotmap
   handler: a live event is not edge-cached, deliberately, 2026-07-03). A client that polled it would send every
   viewer's poll to BSD.

## Task 0 — measure the budget (run first, on a runner; the sandbox cannot reach the relay)

BSD's request limit and cost model are not recorded in this repo for `/api/v2/events/{id}/stats/`. Before any
design: read the limit from the vendor's response headers on a runner, and count the existing calls per minute
(`/bsd/events/live` 25 s cache, `_bsdEventIsLive`, the odds and archive crons). The artifact is
`outbox/bsd-request-budget-latest.json` with the limit, the window, the headers it came from and the current
steady-state calls per minute, each with its date and conditions (Rule 73).

## Task 0 result (2026-10-29)

Premise tested first (Rule 100). The 2026-10-10 probe concluded "no rate-limit header exists" from 16 calls that looked for
`x-ratelimit-*`, `ratelimit-limit/-remaining/-reset` and `retry-after`. BSD's pricing page documents a different shape,
`RateLimit: "name";r=N;t=S` and `RateLimit-Policy: "name";q=N;w=S`, which none of those names match. So the absence might have been a miss
of the NAME. `scripts/bsd-request-budget.mjs` captures EVERY response header. **Refuted: the 2026-10-10 finding stands.** On 6 calls
(5 authenticated, all 200, 1 token-free; 23 distinct header names, listed in the artifact) there is no `ratelimit`, `ratelimit-policy`,
`retry-after`, or any name containing rate, limit, quota, remain, credit or usage. Conditions: one free-tier football token, one GitHub
runner IP, 22:01Z, 2026-10-29. Cost of one call and the daily spend therefore cannot be read.

What the vendor says instead, three ways, fetched 2026-10-29 (claims, not measurements, and they disagree):
- `sports.bzzoiro.com/.well-known/pricing.md`: Free football, "Rate limits: None".
- `sports.bzzoiro.com/pricing/`: Free "7,500 per day, resets at midnight UTC"; Unlimited "No limit"; a tile on the same page says "100 req/day".
- `sports.bzzoiro.com/llms.txt` and `llms-full.txt`: "10 requests/second per IP, with burst. Daily quotas apply per plan and are reported in the
  RateLimit response headers" (the headers this token does not get).
The only figure two pages agree on is 10 requests/second per IP. A `429` with `Retry-After` is documented on the free plan's page; it is not
provoked here (Rule 78).

Two things the artifact does measure:
- BSD answers from its own cache: `x-cache-status` HIT or STALE on 5 of 5 authenticated calls (a repeat of the same path was HIT or STALE too).
  Whether a cached answer counts against any allowance is not observable without a counter.
- The day: 63 events listed today, 26 tracked (`websocket_plus` and `live_websocket` both true). Peak concurrent, ASSUMING a tracked match
  occupies a subscription for 115 minutes, is 9. The page held the whole day (`count` 63, `truncated` false).

The relay's own demand is not countable from outside: 33 lines in `src/index.js` name a BSD REST path, 22 in the `/bsd/` route block
(user-triggered, several edge-cached: live 25 s, by-date 25 s today and 300 s past, shotmap only when the event is not live) and 11 in helpers
(endgame capture, WC backfill, the game join, the V2 live lookup). There is no counter on them. That is the gap a poll must not widen blind.

## Task 1 — design from the number

DECIDED 2026-10-29. Because neither the allowance nor the current spend can be read, the poll carries its own measurement and its own stop:
1. One `GET /api/v2/events/{id}/stats/` per event that has at least one connected subscriber (`_bsdSubscribed`), every 60 s, shared by every client.
   Nothing polls an event nobody activated.
2. A hard daily cap, counted in the DO and reset at 00:00Z: **600** (recommended; 5 subscribed matches for their whole 115 minutes is 575). It is
   8% of the strictest figure above that grants a quota (7,500) and 20% of the worst case of the day measured here (26 tracked matches x 115 minutes
   = 2,990 calls, if every one had a viewer). At the cap the poll stops and `bsd:stats.shotmap` stays null; it never spends past it.
3. On the first `429`, stop polling for the rest of the UTC day and honour `Retry-After`. The documented ceiling of 10 requests/second per IP is
   not approached: peak 9 events is 0.15 requests/second.
4. Every poll is one Analytics Engine datapoint (`bsd-stats-poll`), so the relay's own BSD demand becomes countable for the first time.
5. The cap is the owner's number. Everything else is mechanical.

Original recommendation, kept: AmbientDO polls
`/api/v2/events/{id}/stats/` once per subscribed live event every 60 s (one call shared by every client, not one per
client) and puts the vendor's `shotmap` in the next `bsd:stats` payload, unchanged (Rule 47: it is the vendor's
record, nothing computed). The client needs no change: `_bsdOnSSEFrame` already reads `data.shotmap`.
Rejected: a client-side poll of `/bsd/events/{id}/shotmap` (N viewers, N upstream calls, `no-store`).

## Verification (Rule 89/90)

A recorded live event is not available in CI, so the proof is the poll function against a recorded `/stats/` body
(`scripts/check-bsd-ws-fanout.mjs` already replays frames through the real `_bsdOnFrame`; extend it, and mutate
first: remove the merge and require the check to go red), plus the existing `bsd-pitch-probe.yml` unchanged.

## Done conditions

1. MET, as a finding: `outbox/bsd-request-budget-latest.json` exists on main, dated, with every header seen. It carries no limit and no
   steady-state rate because the vendor serves neither to this token; the artifact says `NO-HEADER` and `--check` re-derives it.
2. MET. The decision is written above and in the session doc (Part 3) with the arithmetic.
3. If built: `node scripts/check-bsd-ws-fanout.mjs` replays a `/stats/` body and the produced `bsd:stats.shotmap` is
   the vendor's array, byte for byte; its mutation is caught.
