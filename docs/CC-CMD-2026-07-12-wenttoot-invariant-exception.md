# Claude Code Command — Fix went-to-OT invariant false-positive: 36 genuinely-unresolvable rows, using the existing acknowledged-exceptions pattern

**Date:** 2026-07-12
**Repo:** jeffunglesbee-create/field-relay-nba (sole). Confirmed directly, not inferred: `post-deploy-live-verify.yml` was fetched from field-relay-nba's own `raw.githubusercontent.com` path this session, and it triggers on `workflows: ["Deploy RELAY Worker"]` — field-relay-nba's own deploy — so its checkout, and therefore `docs/confidence-gate-acknowledged.txt` (referenced by the confidence-gate step in this same file), are both in field-relay-nba. TASK 0 still re-confirms this from fresh HEAD per Rule 79 — a prior session's own certainty is not a substitute for a probe — but this is not an open question the way an earlier draft of this doc treated it.

**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** the acknowledged-exceptions list file + the went-to-OT invariant step in `post-deploy-live-verify.yml`.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read CLAUDE.md.

Write findings to outbox/cc-wenttoot-invariant-exception-2026-07-12.md.

## CONTEXT — a real CI failure chat's own earlier fix caused, found by re-checking `Post-deploy live verification` after it failed at commit `24c4000`

`docs/CC-CMD-2026-07-12-completion-field-parity.md`'s went-to-OT live invariant (`finalized_at IS NOT NULL AND sport IN ('MLB','WNBA') ⇒ went_to_ot IS NOT NULL`) is now failing — **36 real rows** confirmed via direct D1 query (list below). Root cause, traced precisely: earlier this session, chat directly ran

```sql
UPDATE regular_season_games
SET finalized_at = COALESCE(finalized_at, created_at)
WHERE home_score IS NOT NULL AND sport IN ('MLB','WNBA') AND finalized_at IS NULL AND created_at IS NOT NULL
```

closing the `finalized_at` gap for 379 rows. That was correct — those rows are genuinely complete. But it had a real side effect: it moved those 379 rows from "outside the invariant's checked population" (the invariant explicitly doesn't assert against `finalized_at IS NULL` rows, treating them as a separate, reported-not-asserted backlog) into "inside the checked population." The later `went-to-ot-historical-backfill` CC-CMD resolved 319 of the resulting 357 `went_to_ot IS NULL` rows — but 38 were confirmed, via real investigation (live ESPN fetches, not assumption), genuinely unresolvable: no matching ESPN record exists for that specific game/date via this pipeline. 36 of those 38 currently have `finalized_at` set (2 may have since resolved via the ongoing 2hr drama-backfill cron, or the count shifted slightly — re-verify exact current count via TASK 0, do not trust "36" or "38" blindly).

This is not a new logic bug in the invariant, and not a regression in the went_to_ot fix — it's a real, already-investigated, already-named set of rows that the invariant has no way to distinguish from an actual new violation. The fix is not to weaken the invariant or revert the finalized_at fix (that would be reintroducing the exact silent-gap problem this whole arc has been about) — it's to give the invariant an explicit, auditable exception mechanism for confirmed-unresolvable rows, reusing the pattern this exact workflow file already established for the confidence-gate check (`docs/confidence-gate-acknowledged.txt`, `grep -v '^#'`, skip acknowledged entries, still report them).

## TASK 0 — Probe

```bash
cat docs/confidence-gate-acknowledged.txt
grep -n "Went-to-OT live invariant" -A40 .github/workflows/post-deploy-live-verify.yml
```

Confirm `docs/confidence-gate-acknowledged.txt`'s real current format/comment style before building TASK 1 in the same style — do not guess the format from this doc's description of it.

Re-run the exact violation query directly against live D1 to get the real, current row list — do not use the 36-row list from investigation earlier this session without re-confirming it's still accurate (time has passed, the 2hr drama-backfill cron may have resolved some):

```
SELECT id, sport FROM regular_season_games WHERE home_score IS NOT NULL AND finalized_at IS NOT NULL AND sport IN ('MLB','WNBA') AND went_to_ot IS NULL
```

## TASK 1 — Create the acknowledged-exceptions file (or extend an existing one if TASK 0 finds one already covers this workflow)

`docs/wenttoot-invariant-acknowledged.txt` (or reuse `confidence-gate-acknowledged.txt`'s exact format/mechanism if that's cleaner and TASK 0 confirms it's in the same repo as this workflow — prefer reusing one file/pattern over inventing a second parallel mechanism, Rule 69). Format: one row `id` per line, `#`-prefixed comment lines allowed for reasons. Populate with the real, current list from TASK 0's re-run query. Include a comment citing this CC-CMD and the historical backfill CC-CMD's outbox as the source of the "genuinely unresolvable" determination — this file should be self-explaining to someone reading it cold in six months.

## TASK 2 — Update the invariant check to skip acknowledged rows, still report them

Modify the went-to-OT invariant script so violations whose `id` appears in the acknowledged file are excluded from the failure count and failure list, but are still printed under a separate "Acknowledged, known-unresolvable (excluded from failure)" heading — visibility without a false alarm. Any row NOT in the acknowledged file that still violates the invariant must still fail the build exactly as today. This is the load-bearing distinction: an unacknowledged violation is still a real failure; only the specific, named, already-investigated rows are excused, and only because they were investigated, not because the check got weaker.

## TASK 3 — Verification

- Re-run the check (via `workflow_dispatch` on `post-deploy-live-verify.yml` if triggerable directly, or the equivalent) and confirm it now passes with the acknowledged rows visibly reported but not counted as failures.
- Real negative test: confirm a row NOT on the acknowledged list still fails the check if it violates the invariant — do not just confirm the acknowledged rows are excluded, prove the check still has teeth for anything new. (Use a temporary real violation the same way the original invariant-proof did: inject, observe fail, restore — do not skip this because TASK 1/2 "should" work.)
- Write outbox manifest per Rule 87.

## DONE CONDITION

The real repo/file placement confirmed, not assumed from this doc's guess. The acknowledged-exceptions file exists with the real, re-confirmed row list and a clear reason. The invariant check passes for the known rows while still failing on a real injected new violation, proven live. No weakening of the check for anything not explicitly named and justified.

**Confidence scoring:**
- TASK 0 confirms real repo/file placement and re-confirms the exact current row list, doesn't trust this doc's numbers (20 pts)
- TASK 1 exceptions file created/extended reusing an existing pattern where possible, self-explaining (20 pts)
- TASK 2 correctly distinguishes acknowledged-and-excluded from still-failing, doesn't just disable the check (30 pts)
- TASK 3 proves both directions live — passes for known rows AND still fails on a real injected new violation, not just one or the other (30 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
