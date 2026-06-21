# CC Session — AmbientDO → BracketDO Live Score Bridge

**Date**: 2026-06-21
**Repo**: field-relay-nba
**Branch**: claude/zealous-brahmagupta-tm92w3 → merged to main
**Session lead**: Claude Sonnet 4.6
**Status**: Relay-side live score bridge shipped. Client consumers
(Pulse Chip, CASCADE narrative, WC mini-card) are deferred to a
separate jubilant-bassoon prompt.

## Scope pivot

This session originally received the full "Pulse Chip + CASCADE: SSE
Bus Consumers" prompt, but every consumer in that prompt lives in
jubilant-bassoon's `index.html` (line ~26124+) — not this repo.
Asked the user; they redirected to the relay-side prerequisite only.

## HEAD progression

| SHA | Subject |
|---|---|
| 609c65c | (pre) docs: update Phase 8 integration session doc |
| e3a45eb | feat(relay): AmbientDO forwards WC score events to BracketDO |
| 105737f | feat(relay): BracketDO handles live-score provisional recomputation |

2 single-concern commits, fast-forwarded to main.

Smoke delta:
- `src/ambient-do.js` +23 lines (one fire-and-forget block in the
  live-score branch of the poll loop)
- `src/bracket-do.js` +210 lines (POST route, recompute method,
  3 module-scope helpers, 1 constant)

## Per-commit summary

### e3a45eb — AmbientDO forwards WC score events

Added a single block inside the existing `state === 'live'` branch
of AmbientDO's poll cycle, immediately after the canonical SSE
`score` broadcast.

- Fires only for `sport === 'wc26'` — narrow filter, no risk of
  cross-sport spam.
- `ctx.waitUntil(...)` so the round-trip to BracketDO never blocks
  the poll loop or the SSE fan-out behind it.
- `.catch(e => console.warn(...))` so a BracketDO outage logs once
  and degrades silently.
- Passes the raw API team names + game.round group hint; BracketDO
  side does the normalisation.

Touches NO other AmbientDO behavior — _broadcast, lead_change
detection, final/all_final, _fetchLiveOdds remain unchanged.

### 105737f — BracketDO `/bracket/live-score` route + recompute

Three pieces:

**1. POST `/bracket/live-score` route** (in fetch handler, alongside
the existing `/bracket/result`, `/bracket/state`, `/bracket/refresh`):
- 30s per-`gameId` cooldown via in-memory `this._liveLast` Map
- Throttled requests return `{ok:true, throttled:true}` (HTTP 200,
  not an error) so the caller's `.catch` doesn't trip
- On pass-through, builds a `liveResult` shape mirroring the
  canonical `result` shape and hands off to the new recompute method

**2. `_recomputeLiveAndBroadcast(liveResult)`** method:
- Fetches `/wc/standings` + `/wc/odds-probs` (same upstream as
  the canonical `_recomputeAndBroadcast` to avoid drift)
- Layers the live score into the affected group's standings via
  `_applyLiveToStandings()` — mutates in-memory, never persists
- Removes the in-progress fixture from `oddsProbs` via
  `_isSameMatch()` so Monte Carlo doesn't double-count it
- Runs `computeTournamentProjections({N: 2000})` — same engine as
  the canonical path
- Computes delta vs `this.currentSnapshot` (the canonical state)
  so consumers see "how much did THIS goal move us from the
  official picture", not "how much from the last live recompute"
- Fans out `bracket:updated` with `isLive: true`
- Persists ONLY to DO storage key `snapshot:live` (transient).
  Does NOT touch `this.currentSnapshot / .prevSnapshot / .lastDelta`,
  `this.allResults`, or KV (`wc:projections:current`,
  `wc:bracket:current`, `wc:movers:current`).
- When the layering helper returns false (team-name mismatch), fans
  out a `bracket:live-score-noop` event instead — the client still
  knows a goal happened, just no projection update.

**3. Module-scope helpers**:
- `_teamsMatch(a, b)` — case-insensitive trim equality
- `_isSameMatch(fixture, liveResult)` — tolerates home/away flip
  in the oddsProbs feed
- `_applyLiveToStandings(standings, liveResult)` — bumps played +
  won/drawn/lost + gf/ga/gd + points; re-sorts the affected group
  by points DESC → gd DESC → gf DESC

Constant: `LIVE_RECOMPUTE_COOLDOWN_MS = 30 * 1000` at top of file.

## Constraints preserved (per spec)

- writeWCResult / `/bracket/result` (game-final path) is **byte-for-
  byte unchanged**
- `_recomputeAndBroadcast` (canonical recompute) is **unchanged**
- `computeTournamentProjections` core algorithm is **unchanged** —
  the live path reuses it through the same input contract
- KV permanent snapshot (`wc:projections:current`,
  `wc:bracket:current`, `wc:movers:current`) is **never written** by
  the live path — only by `_recomputeAndBroadcast`
- SSE fan-out and `_fetchLiveOdds` in AmbientDO are **untouched**
- WebSocket fan-out logic in BracketDO is **untouched** — live path
  reuses `this.ctx.getWebSockets()` + `ws.send(message)`

## Failure modes (all silent per Rule 5)

| Failure | Behavior |
|---|---|
| `env.BRACKET_DO` unbound | AmbientDO try-catch skips, never throws |
| `bracketStub.fetch(...)` rejects | `.catch` warn-logs, poll continues |
| `/bracket/live-score` cooldown | Returns `{throttled:true}`, no recompute |
| `/wc/standings` fetch fails | `standings = {}`, `_applyLiveToStandings` returns false |
| `/wc/odds-probs` fetch fails | `oddsProbs = []`, fixtures filter no-ops |
| Team name mismatch (Türkiye vs Turkey) | `bracket:live-score-noop` event fans out |
| `computeTournamentProjections` throws | Logs + returns false; no broadcast |
| `ctx.storage.put('snapshot:live')` throws | Caught, ignored (transient anyway) |
| Any failure | `this.currentSnapshot` + permanent KV intact |

## End-to-end verification status

- `node --check src/ambient-do.js` ✅
- `node --check src/bracket-do.js` ✅
- Deploy `27888XXX...` shipping — CI's STRUCTURAL test suite covers
  the regression surface (worker boots, /health responds, /journalism/
  generate e2e produces prose).
- Real WC live-score verification will land **organically** when the
  next WC game generates a score event — AmbientDO polls every 30s,
  BracketDO will recompute the first time and throttle the next 30s
  worth of events.
- Cannot exercise from this sandbox: AmbientDO's poll is alarm-driven
  inside a DO; there's no public route to inject a synthetic score.

## Carry-forwards (client-side consumers, jubilant-bassoon prompt)

These are the original prompt's three consumers — all live in
jubilant-bassoon's `index.html`:

1. **Pulse Chip** — extend `_sseScoreTs` to `{type, ts, data}` shape,
   add `getPulseChip(gameId, espnGame)` with 4-signal priority,
   render `.pulse-chip` on live game cards. Backward-compat
   `_getVelocity` adjustment included.
2. **CASCADE narrative** — handle `bracket:updated` with `isLive:true`
   from the new BracketDO path; filter delta.shifts to OTHER groups;
   render `.cascade-narrative` block above the bracket tab.
3. **WC mini-card** — detect simultaneous live WC games via
   `getLinkedWCGame()`, render sticky `.wc-mini-card` at top of
   schedule.

The relay-side bridge shipped today is the prerequisite for #2 —
CASCADE was non-functional without `isLive:true` deltas from the
live path. Now those events exist on the wire; client just needs
to consume them.

## Other carry-forwards (relay-side)

4. **Name normalisation**: today the live path uses case-insensitive
   matching to bridge AmbientDO's raw API names (`Türkiye`, `Côte
   d'Ivoire`) against the wcFixName-normalised names in standings.
   Coarse but pragmatic. If `bracket:live-score-noop` events show up
   in real WC games, port `wcFixName` + `WC_NAME_FIX` from
   `src/index.js` into `src/bracket-do.js` so layering hits 100%.

5. **Cooldown smoothing**: 30s is conservative. A two-goal burst
   within 30s shows only the first; the second arrives 30s later via
   the next poll. Could tighten to 10s once we observe real cadence.

6. **`/bracket/state` could expose `snapshot:live`** so REST-poll
   consumers (not WebSocket) can read the live-adjusted view. Not
   wired in this commit — the snapshot:live storage is written but
   not exposed. Add an optional `?live=1` query param when needed.

7. **Live snapshot in KV** (rejected for now): could mirror
   `snapshot:live` to a KV key like `wc:projections:live:current`
   with a short TTL (5min) for client REST consumers. Rejected
   because it would risk overwriting the canonical view if a TTL
   sweep misfires. The DO-storage-only approach is safer.

## Files touched

- `src/ambient-do.js` (+23 lines — single fire-and-forget block)
- `src/bracket-do.js` (+210 lines — POST route + recompute + helpers)
- `outbox/cc-session-bracket-bridge.md` (this doc)

## Rules touched

- **Rule 5 (archive failure must not break primaries)**: every new
  code path is try/caught; cooldown short-circuits before any work;
  team-name mismatch fans out a noop instead of throwing.
- **Rule 47 / ADR-002 (RELAY-IS-DUMB)**: BracketDO only recomputes
  facts (per-team `pChampion`, `pAdvance` Monte Carlo estimates).
  No interest scoring, no editorial verdicts.
- **Rule 62 (follow existing conventions)**: `_recomputeLive...`
  mirrors `_recomputeAndBroadcast` step-by-step, reuses
  `_computeDelta` verbatim, calls `computeTournamentProjections`
  with the same input shape. No parallel control loops.
- **Rule 70 (ATOMIC-A — cross-repo atomic changes)**: client
  consumers explicitly deferred to a separate jubilant-bassoon
  prompt so this relay commit can land first without a client
  contract dependency.
- **Rule 71 (CONTEXT-A)**: read `_recomputeAndBroadcast`,
  `_computeDelta`, `writeWCResult`, and `extractWCGroup` before
  writing the live path so the new code matched existing input/
  output contracts.
- **Rule 77 (NO-RATIONALIZE-A)**: when the prompt premise (browser
  code in index.html) clashed with this repo's scope, asked the
  user rather than rationalising "well, I'll just do the relay
  piece and hope they meant that."
- **Rule 78 (API-COST-A)**: 30s per-game cooldown prevents Monte
  Carlo (N=2000) sims from firing on every flutter of the score
  state machine.
- **Rule 79 (PROMPT-HEAD-A)**: pre-build probes confirmed wc_group
  schema, AmbientDO sport label, BracketDO's existing fetch handler,
  and writeWCResult contract BEFORE wiring anything.
