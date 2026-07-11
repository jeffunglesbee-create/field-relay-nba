# Claude Code Command — Fix wentToOT for real, verified against known-broken games

**Date:** 2026-07-11
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Scope:** `wentToOT` in the O(1) Newspaper bundle (`GET /analytics/newspaper/{date}`) is hardcoded/always-false in production despite two prior commits (`cc-wenttoot-relay-side-2026-07-06.md`, `cc-wenttoot-newspaper-bundle-wire-2026-07-06.md`) that both self-scored 100/100. This CC-CMD exists because that score was wrong and nobody caught it until tonight.
**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md and STANDARDS.md before touching anything.

Write findings to outbox/cc-wenttoot-actual-fix-2026-07-11.md.

## CONTEXT — hard evidence gathered from chat tonight, verified live against production, not self-reported

Three real MLB games, independently confirmed via ESPN's scoreboard API to have gone to extra innings, all show `wentToOT: false` in the live `GET /analytics/newspaper/{date}` response:

| Game | Date | Actual innings (ESPN-confirmed) | `wentToOT` returned |
|---|---|---|---|
| SEA @ MIA (Mariners @ Marlins) | 2026-07-07 | 10 | `false` |
| NYM @ ATL (Mets @ Braves) | 2026-07-06 | 10 | `false` |
| COL @ LAD (Rockies @ Dodgers) | 2026-07-06 | 11 | `false` |

The last two are from the *same day* the relay-side fix was supposedly committed. If the write path were working at all after that commit, it's very unlikely both of that day's own qualifying games were missed.

Full raw object pulled live for the Marlins/Mariners game, for reference — the field exists in the schema, so the bundle-wire half of the prior fix did land:
```json
{
  "id": "MLB_2026-07-07_marlins_mariners",
  "sport": "MLB", "home": "Marlins", "away": "Mariners",
  "homeScore": 6, "awayScore": 5,
  "wentToOT": false,
  "wasUpset": false, "isSeriesClinch": false, "isElimination": false,
  "margin": 1,
  "finalizedAt": null
}
```

`finalizedAt: null` on a completed game (both scores present) is a real clue, not confirmed as the cause — if `wentToOT` and `finalizedAt` are set by the same final-state-transition hook, a hook that never fires would explain both symptoms at once. This is a hypothesis to check, not something to assume true.

## TASK 1 — Read the actual current implementation before touching anything

Find and read the real, current source for:
1. Whatever GameDO or AmbientDO logic is supposed to detect final-state transitions and write back to the D1 game row (`regular_season_games`/`postseason_games`).
2. The specific column(s) `wentToOT` (and `finalizedAt`, if related) reads from in the newspaper bundle endpoint.
3. The two prior commits' actual diffs (`cc-wenttoot-relay-side-2026-07-06.md` and `cc-wenttoot-newspaper-bundle-wire-2026-07-06.md` outbox files, plus their corresponding code commits) — read what they actually shipped, not just their self-reported scores.

Report explicitly: is there a write path that's wired but not firing, a write path that fires but writes the wrong thing, or no real write path at all despite the outbox claiming one exists? Don't guess — trace the actual call graph.

## TASK 2 — Fix the real defect found in Task 1

Whatever Task 1 finds, fix it. If it's a missing trigger wire-up (most likely given `finalizedAt` is also null), wire it correctly into wherever game-final state transitions actually get detected today. If it's a genuinely different bug, fix that instead — Task 1's finding governs, not this task's assumption.

## TASK 3 — Backfill the three known-broken games specifically

The three games above are real, already-archived, and currently wrong. Once the forward-going write path is fixed, explicitly correct these three existing D1 rows too (not just rely on new games going forward being right) — a one-time UPDATE against the same detection logic used going forward, scoped to just these three `game_id`s or a short reasonable date range around them. Do not do a blind full-archive backfill without checking cost/scope first — report the estimated row count before running anything broader than the three named games.

## VERIFICATION — against the same three real games, not new synthetic ones

- `GET /analytics/newspaper/2026-07-08` → Marlins/Mariners row → `wentToOT` must now be `true`.
- `GET /analytics/newspaper/2026-07-07` → Braves/Mets row → `wentToOT` must now be `true`.
- Same call → Dodgers/Rockies row → `wentToOT` must now be `true`.
- Confirm at least one *non*-extra-innings game in the same responses still correctly shows `false` — this proves the fix discriminates correctly rather than flipping everything to `true`.
- If `finalizedAt` was part of the same hook, confirm it's now populated (non-null) for these three games too.

This verification must be run live against the deployed endpoint after deploy, not just asserted from code review — that's exactly the step that was skipped last time.

## DONE CONDITION

All three named games return `wentToOT: true` from the live production endpoint. A control non-OT game in the same response still returns `false`. Root cause is stated explicitly in the outbox, not just "fixed." Confidence ≥ 95.

**Confidence scoring:**
- Task 1 traces the real call graph and states the actual root cause found, not an assumption (30 pts)
- Fix addresses the traced cause, not a guess (20 pts)
- All three named games verified live post-deploy as `true` (30 pts)
- Control non-OT game confirmed still `false` post-deploy (10 pts)
- Backfill scoped correctly, cost/row-count reported before running (10 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.

---

**One-liner:**
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-11-wenttoot-actual-fix.md. Execute all tasks. Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```
