# Claude Code Command — Widen FPL allowlist, wire real player analytics into EPL journalism context

**Date:** 2026-07-15
**Repo:** jeffunglesbee-create/field-relay-nba (sole — the relay's own FPL allowlist and CONTEXT_SOURCES both live here)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/fpl-analytics-context-2026-07-15.md. Commit the outbox manifest with `[skip ci]` in the message.

## CONTEXT

FPL (`fantasy.premierleague.com/api`, proxied via this relay's `/fpl/*` route) is currently used for exactly one real purpose end to end: `bootstrap-static` + `fixtures` feed the client's `fplExtractScorers()`, resolving goal-scorer names for EPL match reporting. That's it.

A June 27 2026 research session identified a much richer, still-unused layer: `element-summary/{player_id}` carries per-player xG, xA, ICT index, rolling form, and `set-piece-notes` carries corner/free-kick/penalty taker assignments — genuinely distinctive journalism context nothing else in the stack provides (ESPN gives scores, BSD gives shot-level match data, Football-Data gives standings — none give "who takes this team's penalties" or a player's rolling underlying-numbers trend). **This was never actually built** — confirmed tonight via direct code read: the relay's own allowlist only ever permitted `bootstrap-static`, `fixtures`, and `/event/{gw}/live/`:
```js
const FPL_ALLOWED_EXACT = ['/bootstrap-static', '/fixtures'];
const FPL_ALLOWED_PREFIXES_FPL = ['/fixtures?', '/event/'];
```
`element-summary` and `set-piece-notes` both return the relay's own `403 "FPL path not allowed"` today — a relay-side restriction, not an upstream rejection (confirmed via reading the actual response body, not assumed from the status code alone).

**Real, live-confirmed shape from bootstrap-static tonight** (do not re-derive, use as the known-good reference): `elements[]` entries carry `expected_goals`, `expected_assists`, `ict_index`, `form`, `now_cost`, `selected_by_percent`, `news` (injury/suspension text), `chance_of_playing_next_round` — all already reachable via the currently-allowed `bootstrap-static` alone, without touching `element-summary` at all. Real example confirmed live in June: Salah, GW38 — goals=7 assists=7 xG=8.23 xA=5.44 ICT=207.1. **Check whether this alone is enough before assuming `element-summary` is required** — `element-summary` adds per-fixture history depth (form over time, not just a season snapshot), which is a real but separate question from whether current-season aggregate xG/ICT/form is already sitting in data already allowed.

## TASK 0 — Probe

```bash
grep -n "FPL_ALLOWED_EXACT\|FPL_ALLOWED_PREFIXES_FPL\|fplAllowed(" src/index.js
grep -n "CONTEXT_SOURCES" src/context-assembler.js | head -20
```
Read the real, current CONTEXT_SOURCES registration pattern (priority ordering, how a source decides whether to fire for a given game) before designing a new one — match the established convention, don't invent a different shape.

Fetch a real, live `bootstrap-static` response and confirm current-season `elements[]` genuinely carries the same fields as the June example (season will have reset by the time this executes — 2026-27 data will differ in values, not necessarily in shape; confirm the shape held, don't assume the specific numbers). If `element-summary`'s real, live response (once TASK 1 unblocks it) adds real, usable content beyond what `bootstrap-static` already has, keep it in scope; if it's redundant for this use case, say so and drop it rather than building an unused fetch.

## TASK 1 — Widen the allowlist, build the context source

Add `element-summary` (prefix, since it takes a path-embedded player ID) and `set-piece-notes` (exact) to the relay's FPL allowlist, matching the existing array-based pattern.

Build a new CONTEXT_SOURCE (naming matching the established `buildXContext` convention) that, for a real EPL fixture: identifies the relevant players (reasoned choice — e.g., each team's top-2 by `ict_index` among likely starters, or players already surfaced via the existing goalscorer path, or set-piece takers specifically; pick one with real justification, document why, don't guess a fifth option without reasoning) and injects real xG/xA/ICT/form context plus set-piece taker assignments into the journalism prompt, following the same bracketed-block convention (`[FPL PLAYER CONTEXT]` or similar, matching `[BSD MOMENTUM]`'s established style) other CONTEXT_SOURCES already use.

Gate this to EPL only for now (`game.sport === 'epl'` or the real equivalent field) — FPL's data model is Premier League-specific; do not attempt to generalize this one across other leagues.

## TASK 2 — Verify

- `node --check src/index.js src/context-assembler.js`: clean.
- Real live test: a real current-season EPL fixture (once the 2026-27 season's real data is reachable — if not yet available at execution time, use the most recent real completed-season data available and disclose that plainly, not asserted as current-season) produces real, non-empty context via the new source.
- Confirm the widened allowlist doesn't open anything beyond the two new, deliberately-added paths — no broader wildcard, no accidental widening.
- Confirm zero regression to the existing goalscorer-extraction path (client-side `fplExtractScorers`) — this task only adds new relay capability, doesn't touch that already-working feature.

## DONE CONDITION

`element-summary`/`set-piece-notes` are reachable through the relay for real use, not just theoretically allowlisted. A real CONTEXT_SOURCE injects real FPL player analytics (xG/xA/ICT/form, set-piece assignments) into EPL journalism prompts, verified against real data. The existing goalscorer feature is unaffected.

**Confidence scoring:**
- TASK 0 (25 pts): reads the real current allowlist/CONTEXT_SOURCES pattern, confirms via a real live fetch whether `element-summary` adds real value beyond what `bootstrap-static` already carries, doesn't assume either way
- TASK 1 (45 pts): allowlist widened to exactly the two needed paths, new context source follows the established convention, player-selection logic reasoned and documented, correctly scoped to EPL only
- TASK 2 (30 pts): real live verification (or an honestly-disclosed most-recent-available substitute), allowlist scope confirmed exact, non-regression on the existing goalscorer path confirmed

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
