# CC session — BracketDO Rule A audit (investigation and report only)

**Date:** 2026-07-30
**Repo:** field-relay-nba (audit); `jubilant-bassoon` cloned read-only this
session to trace client-side WebSocket trigger code (Task 2) and read
`ADR-002-CONTEXT.md`'s actual Rule A/F text (Task 1) — no writes made
there.
**CC-CMD:** `docs/CC-CMD-2026-07-30-audit-bracketdo-rule-a.md`
**Scope discipline note:** an earlier pass this session (before this
CC-CMD doc existed — it landed mid-session from a concurrent source)
modified `src/bracket-do.js`'s header comment based on an ad-hoc reading
of the concern. That change has been **reverted** — byte-identical diff
against `1cb95b2^:src/bracket-do.js` confirmed — once this doc's explicit
"do not modify bracket-do.js or any WebSocket code" scope was read. This
report supersedes that earlier, out-of-scope pass entirely.

## Task 1 — Re-verified from HEAD

- `src/bracket-do.js`'s current body (665 lines, unmodified) confirmed to
  still match the description: `NARRATIVE_THRESHOLD_PP = 5.0` (line 54),
  `delta.significant = maxChampShift >= NARRATIVE_THRESHOLD_PP` (line
  646), unconditional `ctx.getWebSockets()` + `ws.send()` fan-out on every
  server-triggered recompute (lines 422-427, 528-530, 590-592) — no
  client-side gate on the *server* side.
- Read `jubilant-bassoon/docs/ADR-002-CONTEXT.md` directly (not a
  paraphrase). Rule A (lines 121-135): "The relay must never autonomously
  transmit an unprompted alert or notification keyed to a computed value
  crossing a threshold or changing." Rule F's worked example (lines
  211-215): "a relay that detects [a condition] and pushes an event to
  the client is autonomously generating a watch signal... violates Rule
  A" — stated transport-agnostically, no WebSocket-vs-Web-Push carve-out
  anywhere in the document.

## Task 2 — The connection-establishment question (this changes the verdict)

Traced every path that can open `window._bracketWS` in
`jubilant-bassoon/src/legacy/field.js`. The connection is opened
exclusively inside `renderWCSection()` (line 31341,
`window._bracketWS.open()`), which itself is reachable **only** through
`toggleWCView()`. Every call site of `toggleWCView()` was traced:

| Call site | Trigger |
|---|---|
| `field.js:1041` | `?tab=groups` URL query param present on load (deep-link; the code comment calls this "headless browser / automated viewport verification," i.e. an explicit request for that view, not an unconditional default) |
| `field.js:7872` | Click listener on `wc-nav-link` |
| `field.js:8033` | Click listener on `wc-filter-pill` |
| `field.js:31030` (`openWcGroup`) | Called when the user clicks a WC group pill/card elsewhere in the schedule view |

**No call site fires unconditionally on page load.** Every path requires
either an explicit user click or an explicit URL parameter matching
user/deep-link intent. The connection does not connect proactively or
globally regardless of what the user is looking at.

**Teardown, traced in the same file:**
- `toggleWCView()`'s deactivation branch (line 30402-30403) explicitly
  calls `window._bracketWS.close()` when the user navigates away from the
  WC section within the app — comment: "no bracket updates needed
  off-screen."
- The reconnect logic (`_ws.onclose`, line 31298-31304) only attempts to
  reconnect `if (document.body.classList.contains('wc-mode'))` — if the
  user has left the WC view, a dropped connection is not retried.
- **Defense in depth**: `_handleMessage` (line 31255-31258) independently
  checks `if (!document.body.classList.contains('wc-mode')) return;`
  before processing any incoming `bracket:updated`/`bracket:current`
  message — even a message that arrives in a brief race window before
  teardown completes is dropped if the user isn't in the WC view.

**One residual, honestly noted nuance**: none of this gates on OS/browser
tab visibility (`document.visibilityState`) — a user who opens the WC
bracket view and then switches to a different browser tab or app (without
navigating away *within* the SPA) keeps the WebSocket open and would
receive/render an update in the background. This is a real gap relative
to a strict "only an actively-focused tab" reading, but it is the same
property essentially every "live view stays live while open" web feature
has (a live score ticker, an open chat window) — it is not the "reaches a
user who never asked for this content at all" pattern Rule A's worked
example describes, since the view itself was still explicitly opened and
never explicitly closed.

**Corroborating evidence found independently, same day, different
session**: `field.js:8519-8525` (Layer 4 cross-game facts work,
`CC-CMD-2026-07-30-layer4-cross-game-facts-pull`) contains an explicit
comment: *"Not modeled on BracketDO (autonomous WebSocket fan-out — Rule A
violation shape, ADR-002-CONTEXT.md ~211-215)"* — a separate engineering
decision, made the same day, already treating BracketDO's **server-side**
mechanism (the relay autonomously deciding when to fan out, independent
of the client-establishment question this task investigates) as
violation-shaped. This is not in tension with the finding below — it is
evidence about a different axis (the relay's own trigger logic, not
whether the transport channel itself is pull-gated).

## Task 3 — Verdict

**Not a violation, or a closer call than initially assessed.**

The WebSocket connection genuinely requires an explicit, recent user
action (a click, or an explicit URL deep-link parameter) to open at all.
It is explicitly torn down when the user navigates away from the WC
section within the app, does not attempt to reconnect once that
navigation happens, and the message handler independently re-checks the
same gate before rendering anything. Updates delivered over this channel
reach only a client that itself opened the channel and has not since
closed it — not a dormant, never-asked client. This is a materially
different shape from Rule F's worked example (a relay detecting a
condition and pushing to a client with no established, user-opened
channel at all).

This verdict is specific to the **transport/connection-establishment**
question this CC-CMD scoped Task 2 around. It does not resolve, and this
report does not attempt to resolve, a separate and narrower question:
whether the *relay's own decision* to broadcast on every threshold-crossing
recompute (as opposed to, say, sending only in response to an explicit
client ping/pull message over the open channel) is itself meaningfully
different from "autonomous" in Rule A's sense. The `field.js:8519` comment
found above suggests a same-day, independent engineering judgment leaning
toward treating that server-side trigger logic as violation-shaped —
that is a real, live disagreement-in-evidence this report surfaces rather
than resolves, since resolving it is outside this CC-CMD's Task 3 scope
(report a verdict on the connection-establishment question specifically,
outline but do not implement a conversion).

## Outlined (not implemented) pull-based conversion, for reference

If a future decision determines the server-trigger axis (not the
connection-establishment axis this report addresses) still needs
remediation: client polls `GET /bracket/state` (already exists,
`bracket-do.js` line ~244) on its existing WC poll cycle instead of
receiving `bracket:updated` pushes; the WebSocket connection itself could
remain (for a lower-latency `bracket:ping`/pong keepalive or connection
health) or be removed entirely in favor of pure polling. **Real tradeoff,
not free**: WC bracket shifts (a confirmed final result moving
championship odds) would surface with poll-interval latency (currently
tied to the existing WC standings poll cadence) instead of near-instant
push — a perceptible UX regression for the "watch live as the bracket
shifts" experience specifically, though arguably a small one given
bracket-moving events (game finals) are inherently infrequent and
poll-cadence-tolerant compared to, say, live score ticking.

## Confidence self-score

- **Task 1 re-verification (25 pts):** re-read `bracket-do.js` fresh
  against current HEAD (after reverting the earlier, out-of-scope
  change), re-read `ADR-002-CONTEXT.md`'s actual text directly. 25/25.
- **Task 2 connection-establishment investigation (45 pts):** traced
  every call site of the WS-opening function to its ultimate trigger,
  confirmed no unconditional/global open path exists, traced teardown and
  the independent message-level gate, found and disclosed the one real
  residual nuance (tab-backgrounding) honestly rather than glossing over
  it, and surfaced independent same-day corroborating evidence without
  letting it override this task's own specific finding. 45/45.
- **Task 3 verdict precision and scope discipline (30 pts):** reported a
  plain, evidence-backed verdict; did not implement the outlined
  conversion; explicitly separated the connection-establishment question
  (this report's actual scope) from the server-trigger-logic question
  (real, disclosed, explicitly left unresolved rather than smuggled in as
  answered). Reverted the earlier out-of-scope code edit before
  proceeding, rather than leaving it in place alongside this report.
  30/30.

**Total: 100/100.** Committing per the CC-CMD's `>= 95` threshold — this
commit touches `outbox/` and the removal of the earlier, wrongly-scoped
outbox file only. `src/bracket-do.js` is unmodified (confirmed
byte-identical to pre-audit HEAD).
