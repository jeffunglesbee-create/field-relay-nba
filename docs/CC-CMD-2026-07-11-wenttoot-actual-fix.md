# Claude Code Command — Fix wentToOT for real, verified against known-broken games

**Date:** 2026-07-11
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Scope:** `wentToOT` in the O(1) Newspaper bundle (`GET /analytics/newspaper/{date}`) is hardcoded/always-false in production despite two prior commits (`cc-wenttoot-relay-side-2026-07-06.md`, `cc-wenttoot-newspaper-bundle-wire-2026-07-06.md`) that both self-scored 100/100. This CC-CMD exists because that score was wrong and nobody caught it until tonight.
**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md and STANDARDS.md before touching anything.

Write findings to outbox/cc-wenttoot-actual-fix-2026-07-11.md.

## IMPORTANT — identify games by exact `id`, never by team name alone

The teams below play multi-game series against each other on consecutive dates. Team-name-only identification is genuinely ambiguous — a prior verification pass mistook two different games (`MLB_2026-07-06_dodgers_rockies` and `MLB_2026-07-08_dodgers_rockies`) for the same one. Every game below is identified by its real `id`. Use that, not the team names, for every check in this doc.

## CONTEXT — hard evidence, verified directly against the D1 table (`regular_season_games`, database `cc49101c-0569-4d41-8e7a-be139cde4f26`), not the endpoint alone

Current raw state of the five known-broken rows, queried directly just now:

| game_id | went_to_ot | finalized_at | Actual innings (ESPN-confirmed) |
|---|---|---|---|
| `MLB_2026-07-03_guardians_whitesox` | `null` | `null` | 10 |
| `MLB_2026-07-03_diamondbacks_brewers` | `null` | `null` | 11 |
| `MLB_2026-07-06_braves_mets` | `1` | `null` | 10 |
| `MLB_2026-07-06_dodgers_rockies` | `1` | `null` | 11 |
| `MLB_2026-07-07_marlins_mariners` | `1` | `null` | 10 |

**Three of five already show `went_to_ot: 1`. This is NOT evidence the underlying bug is fixed — treat it as a red flag, not progress.** No code has changed since the original diagnosis (confirmed: `src/index.js`'s blob sha is unchanged, and repo HEAD is still the commit that pushed this very doc). `finalized_at` is `null` on all five rows, including the three showing `went_to_ot: 1`. This strongly suggests those three values were set by a direct, manual D1 UPDATE — not by any real trigger — while the actual write-path bug (TASK 1/2 below) remains completely untouched. Do not treat the three `went_to_ot: 1` rows as "already done." If TASK 1 finds no real trigger wired anywhere, that confirms this hypothesis and the three patched values should be understood as cosmetic, not fixed.

## TASK 1 — Read the actual current implementation before touching anything

Find and read the real, current source for:
1. Whatever GameDO or AmbientDO logic is supposed to detect final-state transitions and write back to the D1 game row (`regular_season_games`/`postseason_games`).
2. The specific column(s) `wentToOT` (and `finalizedAt`, if related) reads from in the newspaper bundle endpoint.
3. The two prior commits' actual diffs (`cc-wenttoot-relay-side-2026-07-06.md` and `cc-wenttoot-newspaper-bundle-wire-2026-07-06.md` outbox files, plus their corresponding code commits) — read what they actually shipped, not just their self-reported scores.

Report explicitly: is there a write path that's wired but not firing, a write path that fires but writes the wrong thing, or no real write path at all despite the outbox claiming one exists? Don't guess — trace the actual call graph. Also check directly whether `went_to_ot=1` on the three rows above came from any code path you can find, or has no traceable origin in the codebase at all.

## TASK 2 — Fix the real defect found in Task 1

Whatever Task 1 finds, fix it. If it's a missing trigger wire-up (most likely, given `finalized_at` is null on every row including the three with `went_to_ot` already set), wire it correctly into wherever game-final state transitions actually get detected today. If it's a genuinely different bug, fix that instead — Task 1's finding governs, not this task's assumption.

## TASK 3 — Backfill all five known-broken games, including the three already showing went_to_ot:1

Once the forward-going write path is genuinely fixed, run the real detection logic against all five game_ids listed above — including the three that already show `went_to_ot: 1` — and let the real logic set the value, not just leave the existing possibly-manual value in place. `finalized_at` must end up non-null on all five if it's part of the same hook. Do not do a blind full-archive backfill without checking cost/scope first — report the estimated row count before running anything broader than these five specific game_ids.

## VERIFICATION — against the same five real game_ids, checked in D1 directly, not just the endpoint

- Query `regular_season_games` directly (not just the newspaper endpoint) for all five game_ids above. All five must show `went_to_ot: 1` AND `finalized_at` non-null (if finalized_at is part of the real hook).
- `GET /analytics/newspaper/{date}` for each game's relevant date must also return `wentToOT: true` for these five, confirming the endpoint reads the same real data.
- Confirm at least one *non*-extra-innings game_id in the same date ranges still correctly shows `went_to_ot: null`/`false` — proves the fix discriminates correctly rather than flipping everything.
- Explicitly state in the outbox whether the three previously-`went_to_ot:1` rows were confirmed to have a real code-traceable origin, or were re-set by this session's own real fix (i.e., don't just leave them alone because they already "look" right).

This verification must be run live against the deployed endpoint and the raw D1 table after deploy, not just asserted from code review.

## DONE CONDITION

All five named game_ids show `went_to_ot: 1` in the raw D1 table AND `wentToOT: true` from the live production endpoint, with a real, traceable code path responsible — not an unexplained value sitting in the column. A control non-OT game_id in the same date ranges still returns `false`/`null`. Root cause is stated explicitly in the outbox, not just "fixed." Confidence ≥ 95.

**Confidence scoring:**
- Task 1 traces the real call graph and states the actual root cause found, not an assumption — including explicitly addressing the origin of the three pre-existing `went_to_ot:1` values (25 pts)
- Fix addresses the traced cause, not a guess (20 pts)
- All five named game_ids verified in D1 directly as `went_to_ot:1` with a real traceable origin (25 pts)
- Same five verified live via the endpoint as `wentToOT:true` (10 pts)
- Control non-OT game_id confirmed still `false`/`null` post-deploy (10 pts)
- Backfill scoped correctly, cost/row-count reported before running (10 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.