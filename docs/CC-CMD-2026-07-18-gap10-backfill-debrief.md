# Claude Code Command — Gap 10: Backfill → Full Debrief Reconstruction

**Date:** 2026-07-18
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5.

---

## CONTEXT

Source: Gap Closers doc, Gap 10. Historical (pre-Phase 3a) games have no `drama_peak` — this gap builds an explicit backfill endpoint that reconstructs whatever real Debrief layers a historical game's actual data supports, honestly rendering "Not tracked" for what it doesn't.

**Real, confirmed foundation:** `drama_peak`/`drama_arc` columns exist (Phase 3a), `findGame()`/Context Graph already assembles the real shape Phase 3b's client consumes. This endpoint doesn't invent new assembly logic — it applies the existing, real Context Graph response shape to historical games on demand.

**Real, honest scope boundary:** this endpoint reconstructs what's genuinely derivable from existing archived data (odds, series, scores — all already in the schema). It does NOT retroactively compute `drama_peak` for games that predate the Phase 3a write path — that data was never captured and can't be reconstructed after the fact. Drama shows as null/"Not tracked" for those games, honestly, per the spec's own instruction.

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline -5
grep -n "function findGame\b" src/index.js
grep -n "/archive/backfill\|debrief-backfill" src/index.js
```

Confirm the real, current `/archive/backfill` endpoint (if one exists) before building a new, separate `/archive/debrief-backfill` — check whether extending the existing one is more correct than adding a parallel endpoint.

---

## TASK 1 — Real confirmation of existing backfill infrastructure

Find any real, current backfill-related endpoint. Determine whether this gap should extend it or add a genuinely new one — report the real finding before choosing.

## TASK 2 — Build the reconstruction endpoint

`/archive/debrief-backfill?date=YYYY-MM-DD` (or extension of an existing real endpoint, per TASK 1's finding):
1. Query Context Graph / real archive tables for each final game on that date
2. Assemble the real Debrief layers from whatever data genuinely exists (drama_peak — null if pre-Phase-3a, honestly; odds from real `opening_odds`/`closing_odds` columns; series from real `postseason_series`/`postseason_games` join; pre-game brief from real `briefs` table if present)
3. Store as a real `brief_type='debrief'` row (or confirm this doesn't collide with existing brief_type conventions — check first)

## TASK 3 — Honest partial-layer handling

A historical game missing `drama_peak` should render 4 of 5 real layers, with drama explicitly shown as "Not tracked" — not silently omitted, not fabricated. Confirm this is genuinely how the response is shaped, not just described in a comment.

## TASK 4 — Real verification

Real probe against a real, genuinely historical date (predating Phase 3a's `drama_peak` write path) — confirm the response honestly shows null/untracked drama alongside real odds/series/brief data where those genuinely exist.

---

## DONE CONDITION

A real, working backfill/reconstruction path produces genuine Debrief data for historical games, honestly reflecting what's actually derivable versus genuinely unavailable — verified via a real probe against a real historical date, not assumed or fabricated for missing fields.

**Confidence scoring:**
- TASK 1 (15 pts): real confirmation of existing infrastructure
- TASK 2 (35 pts): real reconstruction endpoint
- TASK 3 (25 pts): honest partial-layer handling, confirmed not just described
- TASK 4 (25 pts): real probe against a real historical date

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
