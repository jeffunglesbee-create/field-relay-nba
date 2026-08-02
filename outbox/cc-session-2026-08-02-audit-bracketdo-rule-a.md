# CC Session — audit BracketDO for Rule A compliance
**Date:** 2026-08-02
**Repo:** field-relay-nba (client-side trace in jubilant-bassoon)
**HEAD at close:** unchanged — investigation only, no commits to `src/`

---

## Task 1 — re-verified fresh

**`bracket-do.js` re-read in full, current HEAD.** Confirmed: `_recomputeAndBroadcast`
(triggered by every `/bracket/result` POST — a confirmed WC game final)
and `_recomputeLiveAndBroadcast` (triggered by every `/bracket/live-score`
POST, throttled 30s per game) both fan out to **every currently-connected
WebSocket client unconditionally** via `this.ctx.getWebSockets()` — delta
significance (`NARRATIVE_THRESHOLD_PP = 5.0`) only gates whether a
journalism brief gets queued (step 9), not whether the broadcast itself
fires. This matches today's earlier finding — unchanged since.

**`ADR-002-CONTEXT.md` Rule A/Rule F read directly from source, not
paraphrased:**
- Rule A (line 121): *"The relay must never autonomously transmit an
  unprompted alert or notification keyed to a computed value crossing a
  threshold or changing... never from the relay's own judgment about a
  scored value."*
- Rule F (line 172): governs *what* may be computed relay-side
  (commodity vs. proprietary) — separate axis. `pChampion`/`pAdvance`
  shifts are Monte Carlo probability outputs, arguably commodity-like
  (Rule F likely clears them) — but Rule F clearing content does not
  clear the transport mechanism; Rule A is independent and is the
  relevant axis here (per ADR-002-CONTEXT.md line 217-219: "both axes
  must independently hold").

## Task 2 — the nuance, resolved with real evidence, not assumed either way

**Question:** is the WebSocket connection user-initiated (arguably a
pull), or does it connect proactively regardless of what the user is
looking at? And does it persist to backgrounded/inactive clients?

**Traced the actual client code** (`field.js`, BracketDO WebSocket client
IIFE, ~line 31236, and its caller):

- **Connection establishment IS pull-gated.** `window._bracketWS.open()`
  is called from exactly one place: inside the `if (isWC)` branch of the
  WC-mode toggle function (`field.js:~30395`), which only runs when the
  user explicitly navigates to/activates the WC section. It is not
  called on app boot or any global render path — confirmed via grep,
  the only two call sites of `_bracketWS.open()`/`.close()` are this
  toggle function and `renderWCSection()`'s own body (self-referential,
  same gate).
- **Teardown on explicit in-app navigation away IS also correct.** The
  same toggle function's `else` branch (user navigating OUT of WC mode)
  calls `window._bracketWS.close()` explicitly (`field.js:30403`,
  comment: *"Close BracketDO WebSocket — no bracket updates needed
  off-screen"*).
- **But there is no `visibilitychange` handler for the bracket socket.**
  Grepped all 6 `visibilitychange` listeners in `field.js` — none
  reference `_bracketWS`, `bracket`, or the WC section. So: once a user
  opens the WC/bracket view (a genuine pull) and then backgrounds the
  browser tab, locks their phone, or switches apps — **without
  explicitly navigating away from WC mode inside the app** — the socket
  stays open. `bracket:updated` messages continue to arrive and are
  still processed by `_handleMessage` (title-attribute update always;
  full re-render only if `wc-mode` class and `document.body` conditions
  still hold, which they do while backgrounded since nothing clears
  that class on backgrounding).

## Task 3 — Verdict: genuinely a closer call than the initial finding, not a clean binary

**Not a confirmed violation in the form the initial finding assumed**
(a globally-open, always-on channel reaching users who never asked for
bracket data) — connection establishment is real, explicit, user-gated
pull, and does tear down correctly on in-app navigation away.

**But a real gap remains**: the channel does not close when the tab is
merely backgrounded (not navigated away from in-app), so a user who
opened the WC view once and then put the app in the background can
still receive and silently process a pushed `bracket:updated` message
without having asked for that specific update. This is the closer
analogue to the prohibited "unprompted alert to a dormant client"
pattern named in the CC-CMD, even though the channel's *origin* was a
real pull.

**Net assessment:** partial mitigation, not full compliance and not a
clean violation. The connection-establishment half of Rule A's concern
is genuinely satisfied; the persistence-while-backgrounded half is not
addressed by any existing code.

## Outlined (NOT implemented) — what a full pull-based conversion would look like

Per the CC-CMD's explicit instruction: outline only, no code written.

- Close (or at minimum stop reacting to messages from) `_bracketWS` on
  `document.visibilitychange` when `document.visibilityState ===
  'hidden'`, matching the existing pattern already used elsewhere in
  this file for other backgrounding-sensitive state (6 precedents
  exist, e.g. `field.js:26198`, `:26713`) — reopen on `'visible'` if
  still in `wc-mode`.
- Alternative, closer to the Layer-4 precedent
  (`CC-CMD-2026-07-30-layer4-cross-game-facts-pull.md`): drop the
  WebSocket entirely, have the client poll `/bracket/state` (already a
  real, working REST endpoint, confirmed present at `bracket-do.js:244`)
  on its existing poll cycle while `wc-mode` is active and the tab is
  visible.
- **Real tradeoff, not free either way:** the WebSocket currently
  delivers a computed delta + narrative seeds + full snapshot
  server-side, instantly, on every confirmed result. A visibilitychange
  guard preserves that instant-push UX while merely closing the gap
  (near-zero latency cost, small implementation). Full polling
  conversion adds real perceived latency (bounded by poll interval,
  likely 15-30s matching the rest of this file's conventions) in
  exchange for a stronger, simpler compliance story (no server-initiated
  send at all). The visibilitychange guard is the narrower, lower-risk
  fix for the specific gap found here; full polling conversion is a
  larger architectural change with its own UX cost that should be a
  separate, explicitly-scoped decision, not bundled into closing this
  gap.

---

## Explicitly NOT touched (per CC-CMD scope)

- `bracket-do.js` — not modified, investigation only.
- No WebSocket code changed anywhere.
- `GameDO`, `UserDO`, `AmbientDO`, `BrowserDO` — not audited, out of
  this CC-CMD's scope. Given today's finding (a visibilitychange gap,
  not a connection-establishment gap), worth flagging as a candidate
  pattern to check in those DOs too, but not actioned here.

## Carry-forwards

- Whether to close the found gap (visibilitychange guard, the narrower
  fix) is Jeff's call, per the CC-CMD's own framing — this audit reports
  the precise finding, does not implement.
- Candidate follow-up: check `GameDO`/`AmbientDO` for the same
  visibilitychange gap, given the pattern found here.
