# Claude Code Command — Gap 7: Bracket Projection Delta in WC Debrief

**Date:** 2026-07-18
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5.

---

## CONTEXT

Source: Gap Closers doc, Gap 7. `BracketDO` (confirmed real, `class BracketDO` present in `src/bracket-do.js`) recomputes WC advancement projections after each result. This gap captures the pre-match vs. post-match delta for The Debrief's Series Arc-adjacent WC-specific context — currently lost, since BracketDO only stores the latest state.

**Real dependency:** this is WC-specific, additive to The Debrief's existing Series Arc layer (Phase 3b, live), not a replacement for it. Confirm at execution time whether a live or recent WC match exists to verify against — if the tournament has concluded or isn't active, this becomes a logic-trace-only verification (matching the honest pattern established by tonight's MLB dual-ID-path fix, which also couldn't fully live-verify one path).

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline -5
grep -n "class BracketDO" src/bracket-do.js
grep -n "getAdvancementProbability" src/bracket-do.js
grep -n "function findGame\|/archive/game" src/index.js | head -5
```

Confirm real, current `BracketDO` method names and the real recompute trigger point before adding to it — the spec's own commit references ("22fe8fb," "cdf68f9" from Gap 1's own doc) are month-old and likely stale.

---

## TASK 1 — Real confirmation of BracketDO's recompute trigger

Find the real, current point where BracketDO recomputes projections after a result (the spec assumes this exists and fires per-result — confirm, don't assume).

## TASK 2 — Snapshot pre-match projections before recompute

Before the real recompute call, snapshot current `getAdvancementProbability()` values for the affected teams.

## TASK 3 — Compute and store the delta

After recompute, compute post-match values, build the delta object per spec (`{before, after, change}` per team), write to the archive as a real row — confirm the real, current `briefs` table schema supports this cleanly (the spec's own example uses `brief_type='bracket_delta'` — verify this doesn't conflict with existing brief_type usage).

## TASK 4 — Include in Context Graph response

`findGame()`/`/context/game/{id}` should include `bracket_delta` in its enrichment results for WC games where it exists.

## TASK 5 — Real verification

If a live/recent WC match is available: real probe confirming the delta appears correctly. If not: a real, explicit logic trace using historical/hand-constructed data matching the real, confirmed schema — honestly labeled as logic-trace-only, not claimed as live-verified.

---

## DONE CONDITION

BracketDO's real recompute path now captures and stores a real pre/post delta, available via the Context Graph — verified live if a real WC match exists to test against, or honestly logic-traced if not, with the distinction clearly stated rather than blurred.

**Confidence scoring:**
- TASK 1 (15 pts): real recompute trigger confirmed
- TASK 2 (20 pts): real snapshot logic
- TASK 3 (25 pts): real delta computation and storage
- TASK 4 (20 pts): real Context Graph inclusion
- TASK 5 (20 pts): real verification, honestly labeled live vs. logic-trace

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
