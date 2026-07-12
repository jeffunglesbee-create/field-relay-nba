# Claude Code Command — Retroactive went_to_ot historical backfill (357 known rows)

**Date:** 2026-07-12
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** src/index.js only (one new admin route). Do not touch score-fill.mjs's live cron selection query — that stays scoped to prospective rows only, per the original completion-field-parity CC-CMD's decision.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read CLAUDE.md and STANDARDS.md Rule 97 (CI-AS-INVARIANT-A) before touching this file.

Write findings to outbox/cc-went-to-ot-historical-backfill-2026-07-12.md.

## CONTEXT — chat already closed half of this gap directly; this closes the other half

Live D1 query (chat, this session): 379 regular_season_games rows (MLB 314, WNBA 65) had `home_score IS NOT NULL` and were missing `finalized_at` and/or `went_to_ot`. `finalized_at` was closed for all 379 directly via a chat-run D1 UPDATE (`finalized_at = COALESCE(finalized_at, created_at)`) — zero external data needed, safe, already done, verified: 0 remaining NULL.

`went_to_ot` is different — it genuinely requires an ESPN periodNum lookup per game, which chat cannot safely batch-execute at this volume without risking rate limits and without reusing the exact matching logic already built and deployed. Current known population (re-verify from HEAD, do not trust this count blindly — time will have passed): **295 MLB + 62 WNBA = 357 rows**, `date` range roughly 2026-05-20 through 2026-07-11.

**The novel move here is reuse, not a new pipeline:** `/archive/score-by-id`'s self-fetch-and-match logic (added by the completion-field-parity CC-CMD, already live) does exactly what this backfill needs — fetch `/v2/games?sport=X&date=Y`, match by espn_event_id/team-name, extract periodNum, call the module-scope `computeWentToOT`. This CC-CMD does not reimplement that matching logic; it wraps the SAME function in a batch loop grouped by (sport, date) to minimize `/v2/games` calls (~50ish distinct dates, not 357 individual fetches).

## TASK 0 — Probe

```bash
grep -n "computeWentToOT\|function.*matchGame\|espn_event_id.*normalize\|teamNameMatch" src/index.js | head -20
```

Confirm the exact matching function signature used by `/archive/score-by-id` (name may differ from what's guessed above) before writing TASK 1 — reuse it by name, do not re-derive matching logic from scratch.

## TASK 1 — Add `POST /admin/archive/backfill-went-to-ot` (one-time, not a cron)

Auth: same `Authorization: Bearer ${FIELD_MCP_SECRET}` gate as other `/admin/*` routes (grep for one, e.g. `/admin/wc/bsd-backfill`, match its exact pattern).

Body: `{sport?: 'MLB'|'WNBA', limit?: number}` — optional filters for incremental/manual runs; no body = process the full known population.

Logic:
1. `SELECT id, sport, date, home, away, espn_event_id FROM regular_season_games WHERE home_score IS NOT NULL AND went_to_ot IS NULL AND sport IN ('MLB','WNBA')` (filtered by body params if present).
2. Group results by `(sport, date)`.
3. For each group, one `/v2/games?sport=&date=` self-fetch (same cf cache pattern as the adjacent route).
4. For each row, match within that fetch's results using the exact function confirmed in TASK 0, extract periodNum, compute `went_to_ot` via `computeWentToOT`.
5. `UPDATE regular_season_games SET went_to_ot = COALESCE(?, went_to_ot) WHERE id = ?` per resolved row — never overwrite a non-NULL value, never guess when no match is found.
6. Return `{ok: true, processed, resolved, unresolved: [...ids that couldn't be matched...], groups_fetched}`.

Rate-limit courtesy: small delay between group fetches if the existing `/v2/games` self-fetch pattern elsewhere in this file does one (grep for precedent, match it — do not invent a new throttling scheme).

## TASK 2 — Run it for real against the actual backlog

Call the new endpoint for real (both sports, no limit — or paginated if `resolved` count suggests a timeout risk; report which). This is not a synthetic test.

## TASK 3 — Verification

- D1 before/after: `SELECT sport, COUNT(*) FROM regular_season_games WHERE home_score IS NOT NULL AND went_to_ot IS NULL AND sport IN ('MLB','WNBA') GROUP BY sport` — report the real drop.
- Any `unresolved` rows: sample 3, state the real reason each couldn't be matched (no ESPN record found / ambiguous team match / other) — do not guess if uninspected.
- `node --check src/index.js`.
- Write outbox manifest per Rule 87.

## DONE CONDITION

The endpoint exists, reuses the existing matching function (confirmed by name, not re-derived), was run for real against the actual backlog (not simulated), and the D1 before/after count is reported honestly — including any genuinely-unresolvable residual, named with a real reason per Rule 74 (STAGED-GATE-A: if any rows remain unresolved, state exactly what would unblock them, don't leave it vague).

**Confidence scoring:**
- TASK 0 probe confirms the real matching function name before building (15 pts)
- New endpoint reuses existing matching + computeWentToOT, zero duplicated logic (25 pts)
- Run for real against the actual backlog, not simulated (30 pts)
- D1 before/after reported honestly, any residual named with a real reason (20 pts)
- Zero new fallback-style coercions anywhere (10 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.