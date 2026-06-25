# BSD WebSocket → AmbientDO Live Ball Tracking — 2026-06-25

## Probes

- AmbientDO class lives in `src/ambient-do.js`, not `src/index.js`
  (the CC-CMD referenced index.js — I corrected this in place).
- Class at L120, constructor 121–137, `async fetch(request)` at L140,
  class close at L797.
- Existing client session map is `this._clients`, NOT `_sessions`
  (per-client entry: `{writer, write}`; no per-client gameId tracked).
- `/ambient/*` routing wired in src/index.js at L7580 — any path starting
  with `/ambient/` is forwarded to the AmbientDO stub. New routes use
  the existing forwarding without index.js changes.

## Adapt-vs-paste decisions

1. **Spec said `this._sessions[id].gameId === eventId`** — we don't track
   per-client gameId. Instead the BSD fan-out broadcasts to ALL connected
   SSE clients via the existing `_broadcast(eventType, data)` helper.
   Clients filter by `id` (event_id) on receipt. This is the Rule 47 path
   (relay is dumb; clients interpret).
2. **Spec used `Object.values(new WebSocketPair())`** — that creates an
   inbound pair, not needed for outbound. Removed unused pair construction.
3. **Wrapped all `_bsdSocket.send()` in try/catch** — DO hibernation can
   close the socket between readyState check and send.

## Edits (src/ambient-do.js)

**L137–145 (constructor)**: Added BSD state fields — `_bsdSocket`,
`_bsdSubscribed` (Set), `_bsdReconnectTimer`, `_bsdToken`.

**L148–170 (fetch handler)**: Two new routes added before the existing
`/ambient/state` block:
- `POST /ambient/bsd/subscribe` — opens BSD WS (idempotent), subscribes
  to the given event_id. Requires `env.BSD_API_TOKEN` (returns 503 if unset).
- `POST /ambient/bsd/unsubscribe` — removes subscription; closes the
  socket if the last subscription is dropped.

**L817–890 (class methods, before close)**: 4 BSD methods added:
- `_bsdConnect(token)` — opens `wss://sports.bzzoiro.com/ws/live/?token=...`.
  On open: re-subscribes all known event_ids. On close: 15s reconnect.
  On error: log only.
- `_bsdOnFrame(rawData)` — parses BSD frame; filters to `livedata` and
  `event` types. Distills to minimal payload (`bsd:ball` or `bsd:stats`)
  and fans out via `_broadcast(payload.type, payload)`.
- `_bsdSubscribe(eventId)` — adds to set + sends subscribe command if
  socket open.
- `_bsdUnsubscribe(eventId)` — removes + sends unsubscribe + closes
  socket if no subscriptions remain.

## Commit & deploy

- `e5b84f1` feat(ambient): BSD WebSocket → AmbientDO live ball tracking fan-out (1 file, +106)
- Deploy: workflow 28176184883 — completed/success.

## Done conditions

- [x] `_bsdConnect`, `_bsdOnFrame`, `_bsdSubscribe`, `_bsdUnsubscribe` present
      (14 grep hits in source)
- [x] `/ambient/bsd/subscribe` + `/ambient/bsd/unsubscribe` routes wired
      (4 hits — 2 routes × 2 endsWith matches)
- [x] `wss://sports.bzzoiro.com/ws/live/` URL present (1 hit)
- [x] `'bsd:ball'` fan-out payload type (1 hit)
- [x] `node --check src/ambient-do.js` passes
- [x] Deploy green (28176184883)
- [x] `/ambient/state` returns healthy structural response
- [x] Diff scope: `src/ambient-do.js` only

## Behavior notes

- **DO hibernation**: AmbientDO hibernates after idle periods. The outbound
  BSD WS closes when hibernated. On next request that hits AmbientDO, the
  subscribe route will reopen the socket. Active clients trigger the SSE
  keep-alive path which prevents hibernation while subscribed.
- **Reconnect**: On unexpected close, a 15s timer fires `_bsdConnect` again.
  Pending subscriptions in `_bsdSubscribed` are re-sent on open.
- **Fan-out**: Frames hit all SSE clients with `event: bsd:ball` /
  `event: bsd:stats` lines. Each payload carries the BSD `event_id`. The
  jubilant-bassoon client must filter frames by the event_id of the game
  it's rendering.
- **Cost guard**: A single outbound socket per AmbientDO instance, shared
  across all subscriptions. Subscribe/unsubscribe is in-band — no socket
  per client.

## Verify (end-to-end, post live soccer)

```
# Subscribe via REST:
curl -X POST https://field-relay-nba.jeffunglesbee.workers.dev/ambient/bsd/subscribe \
  -H 'Content-Type: application/json' \
  -d '{"event_id":"12345"}'
# Expected: 200, {ok:true, subscribed:"12345"}

# In another shell, watch SSE:
curl -N https://field-relay-nba.jeffunglesbee.workers.dev/live/ambient
# Expected: event: bsd:ball / event: bsd:stats lines flowing for live match

# Unsubscribe:
curl -X POST https://field-relay-nba.jeffunglesbee.workers.dev/ambient/bsd/unsubscribe \
  -H 'Content-Type: application/json' \
  -d '{"event_id":"12345"}'
# Expected: 200, {ok:true}
```

## Next

End-to-end client wiring (jubilant-bassoon): the WC matchup view should
call `/ambient/bsd/subscribe` when entering a live BSD-tracked match and
unsubscribe on view exit. The SSE listener filters `bsd:ball` / `bsd:stats`
by the current game's BSD event_id. The Build-Up Cinema + Momentum Dial
features then render from these distilled payloads.
