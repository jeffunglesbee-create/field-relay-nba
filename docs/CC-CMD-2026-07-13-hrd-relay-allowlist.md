# Claude Code Command — Add homeRunDerby to MLB Stats API relay allowlist

**Date:** 2026-07-13
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** one line in MLB_STATS_API_ALLOWED_PREFIXES, plus a real gamePk lookup for tonight's Derby.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/hrd-relay-allowlist-2026-07-13.md.

## CONTEXT

MLB Stats API has a real, documented endpoint: `https://statsapi.mlb.com/api/v1/homeRunDerby/{gamePk}` (optional `bracket`/`pool` sub-paths), returning real bracket/pool data. The relay already proxies statsapi.mlb.com via `/mlb-stats/*` for `/game/`, `/people/`, `/schedule` (confirmed live in src/index.js's `MLB_STATS_API_ALLOWED_PREFIXES`) — `homeRunDerby` is not yet in that list.

This is being built for a client-side jubilant-bassoon CC-CMD (docs/CC-CMD-2026-07-13-hrd-bracket-client.md) that needs this relay change to fully wire live data, but is written to work correctly even if this relay change lands later or not at all this session — this CC-CMD is not a hard blocker for that one.

## TASK 0 — Probe

Confirm `MLB_STATS_API_ALLOWED_PREFIXES`'s real current content fresh. After adding the prefix, make one real test call to `/mlb-stats/homeRunDerby/{gamePk}` with a real gamePk (see below) and confirm the actual response shape — do not assume it from this doc's description.

Find tonight's real gamePk: query the already-allowed `/mlb-stats/schedule` endpoint for date=2026-07-13, probing for whatever gameType MLB uses for special/All-Star-week events (don't guess the gameType value — check the schedule response for what's actually there on this date first).

## TASK 1 — Add the prefix

One line: `'/homeRunDerby/'` added to `MLB_STATS_API_ALLOWED_PREFIXES`. Zero other changes to that array or the surrounding proxy function.

## TASK 2 — Verify

- Real live call to the new path with the real gamePk found in TASK 0, confirm actual response.
- Confirm `/game/`, `/people/`, `/schedule` paths are completely unaffected (same allowlist array, easy to accidentally break with a typo).

## DONE CONDITION

`/homeRunDerby/` genuinely proxies real MLB Stats API data through the relay. Real gamePk for tonight's event documented in the outbox for the client-side CC-CMD to use. Existing three prefixes unaffected.

**Confidence scoring:**
- TASK 0 confirms real prefixes, real gamePk, real response shape via genuine probes (40 pts)
- TASK 1 correct, minimal, one line (25 pts)
- TASK 2 real verification, existing paths confirmed unaffected (35 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
