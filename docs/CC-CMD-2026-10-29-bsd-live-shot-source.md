# Claude Code Command — no shot is drawn during a live match: `bsd:stats` never carries one

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba (`src/ambient-do.js`) executes the relay half; jubilant-bassoon needs no change if the payload keeps its name
**Filed:** 2026-10-29, by CC, found while verifying `docs/CC-CMD-2026-10-28-bsd-pitch-renderer-fields.md`
**Status:** FILED, not started. Blocked by: the BSD request budget is unmeasured (Task 0). Unblocked by Task 0's artifact.

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

## Task 1 — design from the number

Recommended, if the budget allows one extra call per live subscribed event per minute: AmbientDO polls
`/api/v2/events/{id}/stats/` once per subscribed live event every 60 s (one call shared by every client, not one per
client) and puts the vendor's `shotmap` in the next `bsd:stats` payload, unchanged (Rule 47: it is the vendor's
record, nothing computed). The client needs no change: `_bsdOnSSEFrame` already reads `data.shotmap`.
Rejected: a client-side poll of `/bsd/events/{id}/shotmap` (N viewers, N upstream calls, `no-store`).

## Verification (Rule 89/90)

A recorded live event is not available in CI, so the proof is the poll function against a recorded `/stats/` body
(`scripts/check-bsd-ws-fanout.mjs` already replays frames through the real `_bsdOnFrame`; extend it, and mutate
first: remove the merge and require the check to go red), plus the existing `bsd-pitch-probe.yml` unchanged.

## Done conditions

1. `outbox/bsd-request-budget-latest.json` exists on main with the limit and the steady-state rate, dated.
2. The decision is written in the session doc with the arithmetic (extra calls per minute at N live subscribed
   events against the limit).
3. If built: `node scripts/check-bsd-ws-fanout.mjs` replays a `/stats/` body and the produced `bsd:stats.shotmap` is
   the vendor's array, byte for byte; its mutation is caught.
