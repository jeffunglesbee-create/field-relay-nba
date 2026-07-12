# Claude Code Command — Completion field-parity: backfill vs live-archival, starting with went_to_ot

**Date:** 2026-07-12
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** src/index.js only.

git pull. Read CLAUDE.md and STANDARDS.md Rules 60/76 before touching this file.

Write findings to outbox/cc-completion-field-parity-2026-07-12.md.

## CONTEXT — confirmed this session (chat), re-verify from HEAD before building

Two independent code paths both mark a game "complete," and they write different field sets:

- **Live archival** (~L6117, L6230): sets `went_to_ot: computeWentToOT(gm.league, gm.periodNum)` alongside home_score/away_score at the moment a live-tracked game finishes.
- **Backfill / score-fill** (~L8534-8547, the `UPDATE ... SET home_score = ?, away_score = ?, espn_event_id = COALESCE(...), finalized_at = COALESCE(...)` statements): sets home_score/away_score/espn_event_id/finalized_at — but never touches went_to_ot. Any game whose score arrived via this path (not live tracking) keeps whatever went_to_ot was before — almost always NULL, since these are exactly the games live tracking missed.

Downstream, the newspaper bundle endpoint (~L11289) serializes `wentToOT: !!g.went_to_ot` — collapsing NULL (unknown, because backfilled) and 0 (confirmed no-OT) into the identical `false`. A backfilled game that genuinely went to OT would be silently reported as not having gone to OT, with no trace. Client consumer: index.html ~L22766, a notable-game OR-chain (`g.wentToOT` as one of several highlight triggers).

This is the second known instance of the same root cause — the first was `drama_peak`, which got its own dedicated backfill saga (2026-07-02 through 07-08, see outbox/ and Drive doc "Surgical night_stars Recompute"). The real defect is that backfill's write field-list was never required to match live-archival's field-list for "what a complete game record contains." Fixing `went_to_ot` alone would just be the third point-patch in this family; TASK 2 below is the actual fix.

## TASK 0 — Probe: can backfill even compute went_to_ot? Do not assume either way.

`computeWentToOT(gm.league, gm.periodNum)` needs a period count. Check whether the backfill/score-fill code path has access to period/box-score data at all, or only a final score:

```bash
grep -n "computeWentToOT\|periodNum\|score-fill\|scoreFill" src/index.js
grep -rn "periodNum\|linescore\|innings\|period" scripts/*.mjs 2>/dev/null
cat .github/workflows/drama-backfill.yml 2>/dev/null | grep -A3 "script\|run:"
```

Report the finding plainly, then pick exactly one of TASK 1 / TASK 1b based on what's real — not both, not guessed:
- Period data IS available to the backfill path → TASK 1 (compute and set it for real).
- Period data is NOT available → TASK 1b (make the gap explicit instead of silently wrong — do not fabricate a period count to force TASK 1).

## TASK 1 (only if period data is available) — Extend backfill to compute went_to_ot

Add `went_to_ot` to each backfill UPDATE statement that currently sets home_score, computed via the exact same `computeWentToOT` function live-archival already uses — same formula, no second diverging copy. Use `COALESCE(?, went_to_ot)` semantics so a backfill run that still lacks period data for a specific row doesn't overwrite a real value with a guess.

## TASK 1b (only if period data is NOT available) — Make the gap honest instead of silent

At the serialization site (~L11289), replace `wentToOT: !!g.went_to_ot` with a pass-through that preserves three states instead of collapsing to two:

```javascript
wentToOT: g.went_to_ot === null ? null : !!g.went_to_ot,
```

Update the one known client consumer (index.html ~L22766) so `null` is treated the same as `false` for highlight purposes only (no visual regression) — but the field itself now honestly reports "unknown," not "confirmed no." This is not a fallback: nothing is being guessed or substituted. It is the one place a null is allowed to remain, because it is now true.

## TASK 2 — Structural guardrail (this is the actual fix, not TASK 1/1b alone)

Add one shared constant in src/index.js — a single array naming every field "a complete game record" must carry (start from: `home_score`, `away_score`, `went_to_ot`, `finalized_at`, `espn_event_id`). Reference this same list (or a comment cross-reference to it, if a full shared-builder refactor is out of scope for this CC-CMD) from both the live-archival write and every backfill/score-fill UPDATE, so a future field added to one path cannot silently go missing from the other the way `went_to_ot` did here.

Add a smoke assertion (matching existing field_smoke.js/smoke.js idiom) that fails if a completed game (home_score IS NOT NULL) has any field from that constant's list still NULL beyond a defined grace window — or at minimum, a direct assertion that the backfill UPDATE statements' column lists are a superset of the constant. Pick whichever is actually achievable without inventing new infrastructure; report which you built and why.

## TASK 3 — Verification

- `node --check src/index.js`
- D1: count regular_season_games/postseason_games rows with `home_score IS NOT NULL AND went_to_ot IS NULL`, before and after. If TASK 1 ran, this should measurably drop. If TASK 1b ran, the count is unchanged but report it explicitly as "now honestly null, not silently false at the API."
- curl the bundle endpoint for a real past date with at least one known backfilled game; confirm `wentToOT` reflects the fix (real value if TASK 1, explicit `null` if TASK 1b — not silent `false` either way for an unknown case).
- Run smoke. Confirm the new assertion passes and the count increased by exactly 1.
- Write outbox manifest per Rule 87.

## DONE CONDITION

TASK 0's probe genuinely performed and reported either way — not skipped, not assumed. Exactly one of TASK 1 / TASK 1b executed, matching what the probe actually found. TASK 2's shared field-list guardrail exists with a smoke assertion. Verified via real D1 before/after counts and a real curl, not code review alone. Zero new `||`/`!!`-style silent coercions introduced anywhere in this fix — the point of this CC-CMD is removing one, not adding another.

**Confidence scoring:**
- TASK 0 probe genuinely run, reported honestly in whichever direction is true (20 pts)
- Correct TASK (1 or 1b) selected based on the real probe result, not assumed upfront (15 pts)
- Fix verified via real D1 before/after count, not just code review (25 pts)
- Shared completion-field-list constant + smoke assertion added (25 pts)
- Zero new fallback-style coercions introduced anywhere in the fix (15 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.