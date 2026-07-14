# Claude Code Command — MLS identity-resolver club-ID mapping (season-form context gap)

**Date:** 2026-07-14
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/mls-identity-resolver-2026-07-14.md. Commit the outbox manifest with `[skip ci]` in the message — it's a docs-only addition after the real fix commits are already in and deployed; do not let it re-trigger CI.

## CONTEXT

`/soccer/season-form?team_id=MLS-CLU-xxxxxx` (src/index.js, ~L11240) works correctly when called directly — confirmed real data on 2026-06-30 (Inter Miami: 15MP, xG 34.484, xG_efficiency 4.516, clean_sheets 3, possession 56.29%). The gap is upstream: nothing resolves an MLS team *name* (as it appears in a real game object from `/v2/games`) to the `MLS-CLU-xxxxxx` ID this route needs. Confirmed fresh tonight: zero `MLS-CLU-`/`mlsHomeTeamId`/`mlsAwayTeamId` references anywhere in the current codebase — this was flagged as a known gap on 2026-06-30 ("needs identity-resolver extended... wired into gameMeta construction, index.js:5571 at the time") and never built. Every MLS game currently gets zero season-form context in journalism as a result. `buildSoccerSeasonFormContext` (the consumer of this data) is client-side (jubilant-bassoon), not relay-side — this CC-CMD's job is populating `mlsHomeTeamId`/`mlsAwayTeamId` on the relay's game objects so that client-side function has something to call `/soccer/season-form` with. It is not this CC-CMD's job to modify jubilant-bassoon.

**Known unknown, explicitly for TASK 0 to resolve, not guess:** where the real `MLS-CLU-xxxxxx` ID list comes from. A guessed `stats-api.mlssoccer.com` clubs endpoint returned a real 404 from the upstream tonight — do not keep guessing paths. Use the same real methodology that found `stats-api.mlssoccer.com` in the first place (2026-06-30: fetching mlssoccer.com's own application JS bundle and reading its literal endpoint-construction functions) if a working clubs/teams endpoint isn't found on the first direct attempt. `MLS-CLU-000008` (Inter Miami, confirmed real and working) is the one known-correct ID — use it as a concrete anchor to verify whatever endpoint/pattern TASK 0 finds actually produces IDs in this same format for other clubs, rather than trusting a plausible-looking response that might be a different ID scheme entirely.

## TASK 0 — Probe

```bash
grep -n "'/soccer/season-form'" src/index.js
grep -n "gameMeta\s*=" src/index.js   # confirm real current line, doc's June 30 citation (5571) will have drifted
grep -n "V2_LEAGUES\|'mls':" src/index.js   # confirm current MLS config entry
```
Read the full `/soccer/season-form` handler to confirm exactly what ID format/shape it queries with. Confirm whether an identity-resolver file/module already exists for other sports' name→ID mapping (the doc's June 30 context mentions "identity-resolver expanded 10→30 clubs" from the same session — investigate what that expansion actually covered; if it's a different kind of mapping than what's needed here, say so explicitly rather than assuming it's reusable).

## TASK 1 — Build the name → MLS-CLU-xxxxxx mapping

Cover all real MLS clubs for the 2026 season (confirm the real, current count and roster via whatever source TASK 0 establishes — do not assume it's still 30 without checking, given expansion/contraction is possible year to year). Verify at least 3 IDs independently against real `/soccer/season-form` responses (not just that the ID *looks* plausible) before trusting the full mapping, using `MLS-CLU-000008` (Inter Miami) as the known-correct anchor.

## TASK 2 — Wire into gameMeta construction

Populate `mlsHomeTeamId`/`mlsAwayTeamId` on real MLS game objects at the confirmed-current gameMeta construction site, using the TASK 1 mapping keyed on the same team-name format `/v2/games` actually returns (verify the exact real format — display name, abbreviation, or something else — do not assume).

## TASK 3 — Verify

- `node --check src/index.js`: clean.
- Live check: for at least 2 of the real July 16/17 MLS games (CF Montréal vs Toronto FC, Chicago Fire vs Vancouver Whitecaps, St. Louis CITY vs Sporting KC, Seattle vs Portland), confirm `mlsHomeTeamId`/`mlsAwayTeamId` are now populated with real, correct `MLS-CLU-xxxxxx` values, and that calling `/soccer/season-form` with those exact values returns real season data, not an error or empty result.
- Confirm no regression: a non-MLS soccer game's `gameMeta` entry is unaffected (no MLS-specific fields leak into it).

## DONE CONDITION

Real MLS games from `/v2/games` now carry correct `mlsHomeTeamId`/`mlsAwayTeamId`, verified against real `/soccer/season-form` responses for at least 2 real upcoming games, not just structurally present. Mapping covers the real, current full club list, not a partial/assumed set. Zero regression to non-MLS game objects.

**Confidence scoring:**
- TASK 0 confirms the real, current handler/gameMeta/config state, and does not proceed on a guessed club-ID source without first verifying it against the known-correct `MLS-CLU-000008` anchor (20 pts)
- TASK 1 builds the mapping against the real, current full club list (not assumed), independently verifies at least 3 IDs against real season-form responses (30 pts)
- TASK 2 wiring uses the real team-name format `/v2/games` actually returns, confirmed not assumed (20 pts)
- TASK 3 real live verification for at least 2 real upcoming MLS games, confirmed non-regression on non-MLS games (30 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
