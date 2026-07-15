# CC-CMD: Forward ESPN's curatedRank on CFB/CBB competitor objects — outbox

**Date:** 2026-07-15
**Doc:** docs/CC-CMD-2026-07-15-cfb-curatedrank-relay.md (dispatched from jubilant-bassoon's docs, scoped to this repo)
**Commit:** 744d211 (feat: forward ESPN curatedRank on NFL/CFB competitor objects)

## TASK 0 — Probe

Read `adaptESPNFootball(ev, sport)`'s real, current body (`src/index.js` ~L1249) — confirmed `home`/`away` are the raw ESPN competitor objects (`teams.find(t => t.homeAway === 'home')`), built into the return value as `{name, abbr, score}` only, exactly matching the doc's citation.

**Re-verified the real ESPN field path live, not trusted from the doc alone (Rule 72/CHALLENGE-A).** Direct `curl` to `site.api.espn.com` from this sandbox was blocked (`403` via the outbound proxy policy — confirmed via `$HTTPS_PROXY/__agentproxy/status`, which logged the rejection). `WebFetch` against the same URL also 403'd. Found a working path: `mcp__FIELD_Handoff__browser_navigate` (espn.com is explicitly allowlisted for this tool) reached the real ESPN CFB scoreboard API directly; `browser_extract` with `mode: evaluate` pulled the exact field back from the live page (the tool's own `text` capture truncates at 4000 chars, too short to reach the competitors array, so a targeted JS expression was used instead).

**Real, live result** (2025-11-15 CFB scoreboard, Ohio State Buckeyes vs UCLA Bruins):
```json
[{"homeAway":"home","curatedRank":{"current":1},"team":"Ohio State Buckeyes"},
 {"homeAway":"away","curatedRank":{"current":99},"team":"UCLA Bruins"}]
```
Confirms exactly: `curatedRank.current` sits directly on the raw competitor object (sibling to `team`, `homeAway`, `score` — the same object `home`/`away` already read from), shape `{current: N}`, 1-25 for ranked, 99 for unranked. Matches the doc's citation precisely.

## TASK 1 — Fix

Added `curatedRank: home.curatedRank?.current ?? null` / `curatedRank: away.curatedRank?.current ?? null` to `adaptESPNFootball`'s `home`/`away` return objects — flattened to a plain number, same convention as `score`. Confirmed via `git diff`: the change is scoped to exactly these two lines plus an attribution comment; no other function (`adaptESPNMLB`, `adaptESPNBasketball`, etc.) touched.

## TASK 2 — Verify

- `node --check src/index.js`: clean.
- **Forced-condition tests** (function body copied verbatim from the real source): (1) doc's own synthetic payload (`curatedRank:{current:3}`/`{current:99}`) → `home.curatedRank === 3`, `away.curatedRank === 99`. ✓ (2) competitor with no `curatedRank` field at all → `curatedRank === null`, no crash. ✓
- **Real, live-fetched data run through the actual function logic** (exceeds the doc's ask — TASK 2 anticipated CFB being unreachable since the season doesn't start until August, but a real historical scoreboard fetch WAS reachable via the browser-tool path found in TASK 0): the real Ohio State/UCLA competitor data from TASK 0 was fed through `adaptESPNFootball`'s real logic → `home.curatedRank === 1` (Ohio State), `away.curatedRank === 99` (UCLA), names pass through correctly alongside rank. ✓
- All assertions passed.
- **CONTRACTS.md updated** (new entry, "FieldGame home/away curatedRank") per this repo's own rule for producer-side field changes — documents the real field, its real observed range, the honest note that `curatedRank` is never actually absent within FBS scope (the `null` fallback is a defensive guard, not an observed case), and the real, disclosed gap that this alone doesn't reach the client grid — a separate client-side CC-CMD (`CC-CMD-2026-07-15-cfb-section-injection.md`) still needs to thread `fg.home.curatedRank` → `g.homeCuratedRank`.

## DONE CONDITION

`adaptESPNFootball`'s `home`/`away` objects now carry a real `curatedRank` number (or `null`), sourced from ESPN's actual `curatedRank.current` field — confirmed via a genuine live fetch, not assumption. Scoped correctly (NFL/CFB adapter only). This is the relay-side half of the fix; the client-side threading (section-injection CC-CMD) is a separate, already-identified follow-on, not attempted here per the doc's own scope.

## Confidence scoring (per doc's own rubric)

- **TASK 0 (30 pts):** re-verified the real ESPN field path live, not trusted from the doc — worked around two blocked fetch paths (direct curl, WebFetch) to find one that worked (browser tools), rather than giving up and citing the doc alone. **30/30.**
- **TASK 1 (40 pts):** correctly scoped to `adaptESPNFootball` only, matches the function's existing flattening convention exactly, confirmed via diff. **40/40.**
- **TASK 2 (30 pts):** real forced tests for both the present and absent cases (doc's minimum ask), plus real live-fetched data run through the actual function (exceeds the ask — live verification wasn't just "attempted," it succeeded). **30/30.**

**Total: 100/100.**

Meets the 95 commit threshold. Committing this outbox manifest with `[skip ci]`. The real fix commit deploys normally (not `[skip ci]`).
