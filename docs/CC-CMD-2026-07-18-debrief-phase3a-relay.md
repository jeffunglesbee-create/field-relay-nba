# Claude Code Command — Compound Architecture Phase 3a: The Debrief (relay)

**Date:** 2026-07-18
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5.

**This CC-CMD requires explicit authorization before execution.**

---

## CONTEXT

Source spec: Drive doc "FIELD — Compound Architecture: Schedule + UI Primitives + The Debrief" (June 15 2026, APPROVED, ID `1cWgNEs3uanFh_PDi2ISSrIBTINdousbHcE1VQphvZ2I`), Part 3.

**Patent compliance, confirmed twice — once in the original spec, once via a direct compliance check July 7-8 against ADR-002's push-pull reading of RUWT US 9,421,446:**

> RUWT covers "watch this game because interest=87" (real-time, prospective). The Debrief says "this game had drama=87, here's why" — retrospective analysis, after the fact, not a live recommendation. The Debrief reveals computations that already occurred, after they're no longer actionable for viewing decisions.

**Firm constraint, carried directly from Gap 6's own compliance check and directly applicable here too:** drama_score must never be used to decide *whether* to compute, store, or surface something in real time — it appears only inside content the user has already, actively chosen to view (opening a finished game's card). This CC-CMD writes drama_score to the archive on game-final (an objective event), not on any drama-threshold condition.

Phase 1 (UI Primitives) and Phase 2 (Schedule Compound) are confirmed complete and live-verified in jubilant-bassoon. `buildEnrichedGame` already provides the consuming `debrief: { dramaSealed, oddsOutcome, preGameBrief, seriesArc }` structure on the client side — this CC-CMD builds what the relay needs to actually populate it with real data.

**This is the relay side only.** Client-side rendering (Drama Unsealed, FIELD Was Watching, The Odds Story, Series Arc visualization, Night Owl integration) is a separate CC-CMD (Phase 3b), dependent on this one.

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline -5
grep -n "drama_score" src/index.js src/game-do.js 2>&1 | head -10
# Confirm zero existing implementation
grep -n "function.*archive/game\|/archive/game" src/index.js | head -5
# Confirm the real, current archive write handler
grep -n "function findGame\|/context/game/" src/index.js | head -5
# Confirm the real, current Context Graph handler
```

Report real output. Confirm the real, current schema and handler names before touching anything — the spec is over a month old.

---

## TASK 1 — Schema: drama_score column

```sql
ALTER TABLE regular_season_games ADD COLUMN drama_score REAL;
ALTER TABLE postseason_games ADD COLUMN drama_score REAL;
```

Use the D1 MCP tool or the relay's own migration path — confirm the real, current method for schema changes in this repo before assuming the exact SQL above is how it should be applied.

## TASK 2 — GameDO final-state hook: include drama_score in the archive write

Find the real, current final-state hook in `src/game-do.js` (the spec references "commit 22fe8fb" as historical context — don't assume that commit hash is still relevant, find the real current hook by function/behavior, not by an old commit reference). Confirm the real, current field name GameDO uses internally for its drama computation (the spec says "this.drama, this._dramaScore — use whatever field GameDO stores" — actually check, don't guess).

Add the real drama value to the `/archive/game` POST payload, sent only on game-final (the existing, objective trigger this hook already fires on — do not add any new condition).

## TASK 3 — /archive/game handler: write drama_score to the D1 row

Confirm the real, current handler (the spec references "commit cdf68f9" — verify this is still current, don't assume). Add drama_score to both the regular-season and postseason INSERT/UPDATE statements.

## TASK 4 — Context Graph: include drama_score in the /context/game/{id} response

The real, current `findGame()` (or equivalent) response should include the real drama_score value for final games. Also confirm the response shape aligns with what `buildEnrichedGame`'s `debrief.dramaSealed` on the client expects to consume — check the client's real, current expectations via the jubilant-bassoon repo if accessible, don't assume they match without checking.

## TASK 5 — Real verification

```bash
# Confirm schema change applied
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/context/game/{a real, recent final game id}" | node -e "..."
```

Real probe against a real, recently-final game — confirm drama_score genuinely appears in the response, is a real number (not null/undefined for a game that should have one), and confirm this was populated via the game-final hook, not backfilled or faked for the test. Real deploy verification via the relay's own CI, not assumed clean from a local test.

---

## DONE CONDITION

`drama_score` column exists on both game tables, is written by GameDO's final-state hook on game-final only (never on any drama-threshold condition), is persisted by the archive handler, and is returned by the Context Graph — all confirmed via a real, live probe against a real recent game, not assumed.

**Confidence scoring:**
- TASK 1 (15 pts): real schema change confirmed
- TASK 2 (25 pts): real hook modification, confirmed trigger remains game-final only
- TASK 3 (20 pts): real archive write confirmed
- TASK 4 (20 pts): real Context Graph response includes the field, shape confirmed compatible with client expectations
- TASK 5 (20 pts): real, live probe against a real game confirming end-to-end data flow

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
