# Claude Code Command — Make source='completion-trigger' sticky against later cron overwrites

**Date:** 2026-07-12
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** src/index.js, one SQL clause.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read CLAUDE.md and docs/CC-CMD-2026-07-12-completion-trigger-close.md (the fix this one follows up on) before touching this file.

Write findings to outbox/cc-completion-trigger-sticky-2026-07-12.md.

## CONTEXT — found by chat re-verifying the prior fix's own outbox claim against live D1, not by CC self-reporting a gap

`docs/CC-CMD-2026-07-12-completion-trigger-close.md` shipped and its outbox reported a real, live-confirmed `source='completion-trigger'` row (`game_recap_mlb_401816130`) — genuinely true at that moment, verified by chat independently at the time it was reported.

Re-checked the same row later, independently: `source` is now back to `'cron'`, with different `brief_text` and a different `word_count`. Root cause, confirmed by reading the actual SQL: the `game_recap` INSERT's `ON CONFLICT(id) DO UPDATE SET` includes `source = excluded.source`. The completion-trigger write and the ordinary per-game cron write for the same finished game share the identical row id (`game_recap_{sport}_{gameId}`) — whichever writes last wins entirely, including the tag. The regular cron evidently ran again for this game after it went final and silently overwrote the completion-triggered row.

This is not the same bug TASK 1/2 fixed (those are confirmed correct and unchanged) — it's a third, distinct gap: the fix works at write time but isn't durable against a later, unrelated write to the same id.

## TASK 0 — Probe

```bash
grep -n "ON CONFLICT(id) DO UPDATE SET" -A5 src/index.js
```

Confirm the exact current clause and line number before editing — may have shifted since this doc was written.

## TASK 1 — Make the tag sticky, not the whole row

Change the `source` line in the `ON CONFLICT DO UPDATE SET` clause from:
```sql
source = excluded.source
```
to:
```sql
source = CASE WHEN briefs.source = 'completion-trigger' THEN briefs.source ELSE excluded.source END
```

Deliberately scoped to `source` only — `brief_text`/`word_count`/`quality_score` stay freely overwritable by later cron passes (a completion-triggered brief's *text* may legitimately still benefit from a later refresh; it's the *provenance tag* that needs to be permanent once true, not the content). Do not freeze other columns — that's a different, unrequested behavior change (Rule 69).

## TASK 2 — Verification

- `node --check src/index.js`.
- Real test, not simulated: pick a `game_id` currently showing `source='cron'` in `briefs` (any real row). Manually set it to `source='completion-trigger'` via a direct D1 UPDATE (temporary, for this test only). Trigger a normal cron-path write to the same id (or simulate the exact INSERT the cron would run, with a different `brief_text`). Confirm after: `source` is still `'completion-trigger'`, `brief_text` reflects the new write. This proves the CASE logic works both directions (protects the tag, still allows content refresh) — don't just re-read the SQL and assume it's correct.
- Revert the temporary test row to its real original state afterward — do not leave test data in production `briefs`.
- Write outbox manifest per Rule 87.

## DONE CONDITION

The CASE expression is live, confirmed via a real write-after-write test (not code review alone) that a `completion-trigger` tag survives a subsequent cron-path write while the brief text still updates normally. Test data cleaned up. No other columns' overwrite behavior changed.

**Confidence scoring:**
- TASK 0 probe confirms real current clause/line before editing (15 pts)
- TASK 1 CASE expression correctly scoped to `source` only (35 pts)
- TASK 2 real write-after-write test proves both directions (tag sticks, content still refreshes), not assumed from reading SQL (40 pts)
- Test data cleaned up, zero other column behavior changed (10 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
