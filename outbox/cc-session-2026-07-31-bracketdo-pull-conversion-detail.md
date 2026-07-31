# BracketDO pull-based conversion — detailed (still outline only, not implemented)

**Date:** 2026-07-31
**Repo:** field-relay-nba (relay-side facts) + jubilant-bassoon (client-side
detail, read-only reference — no writes made there)
**Context:** expands the "outlined (not implemented) pull-based
conversion" section of `outbox/cc-session-2026-07-30-audit-bracketdo-rule-a.md`
per a follow-up request for more detail. **Still not authorized for
implementation** — that audit's verdict was "not a violation, or a closer
call than initially assessed" on the question it was actually scoped to
(WebSocket connection-establishment). This document exists in case a
future decision on the separate, unresolved question (does the relay's
own autonomous send-on-recompute count as "push" regardless of the
connection being pull-gated) comes down against the current design.

## The good news: this is a client-only change

`GET /wc/bracket/state` is **already deployed and live** on the relay
(`src/index.js:9244-9256`) — it proxies straight to BracketDO's own
`GET /bracket/state` (`src/bracket-do.js:244-264`) and returns the exact
same payload shape the WebSocket already pushes:

```json
{
  "snapshot": { /* canonical Monte Carlo projection, same as bracket:updated.snapshot */ },
  "live": { /* transient in-game provisional snapshot, if a live score is being layered in */ },
  "delta": { /* significant, maxChampShift, shifts, narrativeSeeds — same as bracket:updated.delta */ },
  "resultCount": 0,
  "lastResult": { /* {gameId, group, home, away, hs, as, ts} */ },
  "ts": 0
}
```

It already carries `Cache-Control: public, max-age=30` — Cloudflare's
edge absorbs concurrent polls from multiple open tabs within the same
30s window without re-invoking the BracketDO instance for each one. **No
relay-side code change is required for this conversion at all** — this
also sidesteps the cross-repo atomicity concern (Rule 70) that would
normally apply to a relay-contract change, since the contract already
exists and is already correct.

## What actually needs to change (client only, `jubilant-bassoon/src/legacy/field.js`)

### 1. Remove the WebSocket client IIFE (lines ~31236-31318)

Delete `_open`, `_close`, `_handleMessage`'s WS-specific plumbing, the
ping/pong keepalive (`PING_MS = 45000`), and the reconnect-with-backoff
logic (`MAX_RECONN`, `_attempts`, `_reconnTimer`). None of this has an
equivalent in a poll model — a failed `fetch` just tries again on the
next interval tick, which is a simpler and more robust failure mode than
WS reconnect/backoff.

### 2. Add a poll loop with the same lifecycle the audit already validated

The audit's actual finding was that the current WS is properly
user-action-gated (opens only via an explicit click or URL param, closes
on navigate-away, double-gated at the message layer). **Preserve that
exact lifecycle** — it's the correct, already-proven shape; only the
transport underneath changes:

```js
window._bracketPoll = { start: _startPoll, stop: _stopPoll };
```

- `_startPoll()` called from exactly where `window._bracketWS.open()` is
  called today (`toggleWCView()`'s activation branch, `field.js:30395`,
  and inside `renderWCSection()`, `field.js:31341`).
- `_stopPoll()` called from exactly where `window._bracketWS.close()` is
  called today (`toggleWCView()`'s deactivation branch, `field.js:30402-30403`
  — "no bracket updates needed off-screen" still applies verbatim to
  polling).
- Keep the same `if (!document.body.classList.contains('wc-mode')) return;`
  guard inside the poll handler that `_handleMessage` has today (`field.js:31258`)
  as defense in depth, exactly as before.

### 3. Poll handler replaces the WS message handler

```js
async function _pollBracketState() {
  if (!document.body.classList.contains('wc-mode')) return;
  try {
    const r = await fetch(RELAY_BASE + '/wc/bracket/state', { cache: 'default' }); // let CF edge cache do its job
    if (!r.ok) return;
    const data = await r.json();
    if (data.ts === _lastSeenTs) return; // nothing new since last poll
    _lastSeenTs = data.ts;
    // same downstream handling _handleMessage already does today:
    if (data.delta?.significant && data.delta.narrativeSeeds?.length) { /* tab-title update, unchanged */ }
    if (data.live?.delta?.trigger) { try { renderCascadeNarrative({ ...data.live, isLive: true }); } catch (_e) {} }
    // re-render active tab — same functions, unchanged:
    // renderWCBracketTree() / renderWCTournamentBracket() / renderWCSection()
  } catch (_e) {}
}
```

`data.live` (the transient in-game provisional snapshot) already covers
what the separate `bracket:live-score-noop`/live-broadcast messages
provide today — no functional gap, just delivered on the next poll tick
instead of instantly.

### 4. Cadence

There's a real, honest wrinkle here worth stating plainly: **today, the
WC bracket view has no independent periodic refresh of its own at all** —
`renderWCSection()`'s data fetch only re-runs when a WS message arrives
(`field.js:31279`) or when the view is first opened (`field.js:30395`).
It does not piggyback on the global `fetchV2AllScores()` loop
(30s live / 60s quiet, `field.js:15255`). A pull conversion has to
*introduce* a poll interval, not just redirect an existing one. Two
reasonable options:

- **Dedicated interval while the WC/bracket view is open** (e.g. 30s,
  matching the relay's own edge-cache TTL so no poll is ever "wasted"
  faster than the data could possibly have changed, and matching
  BracketDO's own `LIVE_RECOMPUTE_COOLDOWN_MS = 30000` per-game cooldown
  on the server side — polling faster than that cannot reveal newer
  data). This is the simplest, most literal replacement for "instant
  push" and keeps the perceived responsiveness closest to today's.
- **Piggyback on `fetchV2AllScores()`'s existing cadence** by adding the
  bracket-state fetch into that loop when `wc-mode` is active — fewer
  independent timers running, consistent with how every other sport's
  live data already refreshes, at the cost of being tied to that loop's
  30s/60s (live/quiet) split rather than a WC-specific cadence.

## Real tradeoffs (not free, stated honestly)

- **Latency**: WS delivers within moments of BracketDO's own recompute.
  Polling adds up to one interval's worth of extra delay on top
  (average ≈ half the interval — ~15s at a 30s cadence). Worth noting:
  the WS push was never truly *instant* either — it's already downstream
  of AmbientDO's own live-score poll cadence into `/bracket/live-score`;
  polling adds one more bounded hop on top of a chain that already has
  latency in it. For confirmed-result bracket shifts specifically (not a
  live score tick), this is a small, likely-imperceptible UX cost.
- **Request volume**: polling sends a request every interval regardless
  of whether anything changed; WS only sends when state actually changes.
  This is a real increase in raw request count during quiet periods —
  mitigated by the relay's existing 30s edge cache, which already
  collapses concurrent multi-tab polls into effectively one DO
  invocation per cache window, so the increase is bounded and cheap, not
  proportional to open-tab count.
- **DO wake frequency**: BracketDO's Hibernation WebSocket API already
  lets it sleep between recompute-triggering events regardless of open
  WS connections (per its own header comment) — removing WS doesn't
  change wake frequency on the *write* side (still driven by
  `/bracket/result`/`/bracket/live-score` POSTs). It does add wake
  frequency on the *read* side (each poll invokes the DO to serve
  `/bracket/state`), bounded by the edge cache as above — at WC-tournament
  concurrency levels this is very unlikely to be a real cost concern, but
  it is the honest structural direction of the tradeoff.
- **Simplicity/robustness gain**: no reconnect/backoff state machine, no
  ping/pong keepalive, no WebSocket-upgrade-through-proxies edge cases.
  A `setInterval(fetch)` loop is meaningfully simpler to reason about and
  fails more gracefully (a missed poll just tries again; a dropped WS
  requires active reconnection logic that can itself fail).

## What this conversion does NOT change

The property the 2026-07-30 audit already confirmed favorable — the
connection/poll lifecycle is gated behind an explicit user action to
start and explicit navigation-away to stop — is fully preserved either
way. This document is about the *delivery mechanism* (instant push vs.
bounded-latency pull) for an already properly-gated feature, not a fix
for a channel-establishment problem, since the audit found none.

## Still not implemented

Per the original CC-CMD's explicit scope ("outline... do not implement")
and because the underlying compliance question this would remediate is
itself still open (see the 2026-07-30 audit's Task 3 disclosure) —
implementing this is a separate decision and a separate CC-CMD, touching
`jubilant-bassoon` only, with no relay-side work required.
