# Claude Code Command — MLB dual-ID-path briefs backfill (authorized)

**Date:** 2026-07-18
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5.

---

## CONTEXT

Real, confirmed problem: 13+ genuine `mlb_game` briefs exist with real, substantive content (real venue factors, real starting pitchers named in the actual text) but carry short `g${n}`-style IDs from the now-fixed generic-ESPN-path bug, permanently unmatchable against the canonical `MLB_{home}_{away}_{date}` IDs the Context Graph queries with.

**A simple date-match was already tried and failed** — zero matches via a direct join against `regular_season_games` on `date(created_at) = date`. This CC-CMD is authorized to do the real, more careful two-signal approach:

1. **Narrow by time proximity:** each `g${n}` brief's `created_at` timestamp should be genuinely close to some real, scheduled MLB game's actual start time (or the pre-game window the journalism pipeline runs in) — this narrows each broken brief to a small set of real candidate games, not all games on that date.
2. **Confirm by text match:** within that narrowed candidate set, check whether the brief's own real text content (venue name, starting pitcher names) matches that specific candidate game's real, known data (venue, probable pitchers if available). Only accept a match when this confirms — don't force a match on time proximity alone.

**Real, explicit standard: a brief that doesn't clear high confidence on both signals stays unmatched, honestly.** A wrong match (relinking real content to the wrong game) is worse than leaving it orphaned — this is data integrity work, not a completeness quota.

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline -5
```

Use the Cloudflare D1 MCP tool directly (already available) rather than building new relay endpoints for this one-time backfill — this is a data-correction task, not a new feature.

```sql
-- Real, current count and content of the broken briefs
SELECT id, game_id, created_at, brief_text FROM briefs
WHERE brief_type = 'mlb_game' AND game_id LIKE 'g%'
ORDER BY created_at;
```

Confirm the real, current count (may have changed since the 13 found earlier tonight — games since then may have added more via the same bug window before the fix landed, or the fix may have already stopped new ones).

---

## TASK 1 — Build real candidate sets per broken brief

For each broken brief, query `regular_season_games`/`postseason_games` for real MLB games within a real, reasonable time window of the brief's `created_at` (start with a few hours either side of typical pre-game brief generation timing — confirm the real, typical generation-to-first-pitch gap from the journalism pipeline's own scheduling logic, don't guess at the window).

## TASK 2 — Confirm via real text matching within each candidate set

For each candidate game, check whether the brief's real text contains that game's real venue name and/or real team names/pitcher names (if pitcher data is available in the schedule tables — confirm what's really there). Score confidence explicitly (e.g., venue match + team match = high confidence; venue match alone = medium; neither = no match).

## TASK 3 — Apply only high-confidence matches

For each broken brief with a real, high-confidence single match (not multiple candidates tied at the same confidence — if ambiguous, leave unmatched and report it), update the brief's `game_id` to the real, canonical game ID.

**Real, explicit safety: this is a data update, not a delete/recreate.** Update `game_id` only, preserve the original brief content and `created_at` exactly.

## TASK 4 — Real, honest final report

For every one of the real, current broken briefs: report whether it was matched (with the real evidence — which signals confirmed it) or left unmatched (with the real reason — no candidate in the time window, multiple ambiguous candidates, no text confirmation). Not a summary count — a real, itemized accounting.

## TASK 5 — Real verification

For each newly-matched brief, confirm via a real `/context/game/{id}` probe that `findBriefs()` now genuinely returns it.

---

## DONE CONDITION

Every real, currently-broken `mlb_game` brief has been either genuinely, high-confidence matched and corrected (verified live), or honestly left unmatched with a real, specific reason — no forced or low-confidence matches, no silent skipping.

**Confidence scoring:**
- TASK 1 (20 pts): real, sensible candidate windows built
- TASK 2 (25 pts): real, evidence-based confidence scoring per candidate
- TASK 3 (25 pts): only high-confidence matches applied, ambiguous cases correctly left unmatched
- TASK 4 (15 pts): real, complete, itemized final report
- TASK 5 (15 pts): real live verification of each correction

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
