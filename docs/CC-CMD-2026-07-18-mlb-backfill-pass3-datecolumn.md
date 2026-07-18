# Claude Code Command — MLB briefs backfill, pass 3: re-attempt remaining 142 using the correct `date` column

**Date:** 2026-07-18
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs. Data-only, no code changes (same as passes 1-2).

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5.

---

## CONTEXT — real, novel finding, not a hypothesis

The `briefs` table schema has a dedicated `date TEXT NOT NULL` column, **separate from** `created_at TEXT DEFAULT (datetime('now'))`. Confirmed directly via schema query and real row inspection: `date` matches every checked brief's own ID-date-suffix exactly and never drifts; `created_at` visibly varies by hours within the same `date` and crosses UTC-midnight boundaries independently of it.

**Passes 1-2 of the original backfill used `created_at` for candidate-window matching** (correctly finding this necessary at the time, and correctly discovering the adjacent-date drift pattern as a real, valuable insight) — but `date` was available the whole time and doesn't have this problem. Re-running candidate matching against `date` should produce a narrower, more precise candidate set per broken brief than the `created_at`-based window did.

**Real, honest expectation-setting: this may not recover everything.** The 57 "NO_CANDIDATES" briefs were genuinely due to dates absent from the archive entirely (game rows never archived) — `date` vs `created_at` doesn't change that; those stay unrecoverable regardless of which column is used. The real opportunity is specifically in the 101 "LOW_CONFIDENCE" briefs, where a noisier multi-day candidate window may have diluted otherwise-real signal.

---

## PRE-BUILD PROBE BLOCK

```sql
-- Re-confirm the real, current count of still-broken briefs (should be 142, but re-check, don't assume)
SELECT COUNT(*) FROM briefs WHERE brief_type = 'mlb_game' AND game_id LIKE 'g%';

-- Spot-check: does `date` genuinely, precisely match real game dates for a few already-corrected briefs
-- (compare against the real game's own `date` in regular_season_games via the now-correct game_id)
SELECT b.id, b.date as brief_date, r.date as real_game_date
FROM briefs b JOIN regular_season_games r ON b.game_id = r.id
WHERE b.brief_type = 'mlb_game' AND b.game_id LIKE 'MLB_%'
LIMIT 10;
```

Confirm `brief_date` and `real_game_date` genuinely match exactly for already-corrected briefs before trusting `date` as the re-run's primary signal.

---

## TASK 1 — Re-run candidate matching using `date`, not `created_at`, for the 142 remaining

For each of the real, currently-still-broken briefs (`game_id LIKE 'g%'`), build the real candidate set from `regular_season_games`/`postseason_games` WHERE `date = briefs.date` exactly (no window, no adjacent-day search — `date` shouldn't need one). Apply the same real scoring algorithm from passes 1-2 (venue token + home/away team token matching, same thresholds: HIGH ≥5 pts + unique margin ≥2, MEDIUM =4 pts + unique margin ≥2 reviewed manually, LOW/NO_CANDIDATES left unmatched).

## TASK 2 — Apply only real, high-confidence (or manually-reviewed medium-confidence) matches

Same standard as passes 1-2: a wrong match is worse than an honest miss. Update `game_id` only, preserve `brief_text`/`created_at`/`date` exactly.

## TASK 3 — Real, itemized comparison against passes 1-2's own findings

For each of the 142, report: was it recovered this pass (with real evidence), or does it remain unmatched — and if unmatched, is the real reason the same as passes 1-2 identified (genuinely no archive row for that date) or different (archive row exists for the exact `date`, but text signals still don't clear the confidence bar)? This distinction matters — the first confirms passes 1-2's own diagnosis was already complete for that case; the second means `date` genuinely found a real candidate `created_at`'s drift had obscured.

## TASK 4 — Real verification

Real D1 query confirming the final, updated broken-brief count. Spot-check at least 3 newly-recovered briefs the same way passes 1-2 did (real brief text confirmed against the real matched game's real data).

---

## DONE CONDITION

Every one of the 142 remaining broken briefs has been re-attempted using the correct `date` column, with a real, itemized accounting of what changed (if anything) versus passes 1-2's own diagnosis — genuinely recovered cases applied with the same high-confidence-only standard, genuinely still-unmatched cases left honest with a real, specific reason.

**Confidence scoring:**
- Probe (10 pts): `date` column's precision confirmed against real, already-corrected briefs before trusting it
- TASK 1 (30 pts): real re-run against all 142 using `date`, not `created_at`
- TASK 2 (25 pts): only high-confidence (or reviewed-medium) matches applied
- TASK 3 (20 pts): real, itemized comparison distinguishing "same diagnosis as before" from "date column found something created_at drift had hidden"
- TASK 4 (15 pts): real final count verification, real spot-checks

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
