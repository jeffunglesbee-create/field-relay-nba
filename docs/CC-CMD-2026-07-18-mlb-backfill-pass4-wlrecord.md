# Claude Code Command — MLB briefs backfill, pass 4: W-L record extraction + targeted matching

**Date:** 2026-07-18
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs. Data-only, no code changes (same as passes 1-3).

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5.

---

## CONTEXT — real, novel finding, not a hypothesis

Passes 1-3 recovered 207 of 309 broken briefs via venue/team-name text matching. 102 remain, split between genuinely unrecoverable (no archive row for that date — city-name-vs-nickname text mismatches with no other signal) and cases where the algorithm's own confidence-scoring never had a strong enough signal.

**Real, unexploited signal, confirmed present in real brief text** (per an earlier spot-check: *"The Dodgers arrive holding a 61-36 record, but they face a 3.0 GB deficit"*): specific win-loss records and games-behind figures. A specific record on a specific date is highly discriminating — much more so than a city name, which can be ambiguous (Chicago = Cubs or White Sox; New York = Yankees or Mets).

**This is fully computable from data already in D1 — no new external fetch needed.** `regular_season_games.home_score`/`away_score` for every archived game is enough to compute any team's real win-loss record as of any real date by summing results across all their prior games that season.

**Real scope discipline, matching the "next recovery path" the original session itself named but correctly declined to build broadly:** this is not "compute full league standings." It's a targeted, per-brief check — extract the specific record mentioned in each still-unmatched brief's own text, and check that one number against each real candidate team's real computed record for that date only.

---

## PRE-BUILD PROBE BLOCK

```sql
-- Real, current count of still-broken briefs (should be 102 after pass 3, re-confirm)
SELECT COUNT(*) FROM briefs WHERE brief_type = 'mlb_game' AND game_id LIKE 'g%';

-- Confirm real record data is genuinely computable: spot-check one already-corrected
-- brief's own stated record (if it has one) against a real, computed W-L from home_score/away_score
```

Pull the real text of a few of the 102 remaining briefs first — confirm how many genuinely contain a parseable `\d+-\d+` record pattern before committing to this approach. If most don't, report that honestly and this pass has limited real value; don't force it.

---

## TASK 1 — Real inventory: which of the 102 remaining briefs contain a parseable record

Regex for a real, standard W-L pattern (e.g., `(\d{1,3})-(\d{1,3})\s*(record|mark)`) against each remaining brief's `brief_text`. Report the real count that match — this determines whether this pass is genuinely worth the rest of the effort.

## TASK 2 — For each match, compute real candidate team records for that date

For each brief with a parseable record, get its real candidate games (same-date exact match via `briefs.date`, per pass 3's now-confirmed correct approach — not `created_at`). For each candidate game's two teams, compute their real win-loss record as of that date: `SELECT COUNT(*) FILTER (WHERE (home=team AND home_score>away_score) OR (away=team AND away_score>home_score)) as wins, COUNT(*) FILTER (WHERE ...) as losses FROM regular_season_games WHERE date < briefDate AND (home=team OR away=team)` — adapt the real, correct SQL for D1/SQLite's actual supported syntax (confirm `FILTER` is supported, or use `SUM(CASE...)` if not).

## TASK 3 — Match and apply

Compare the brief's parsed record against each candidate team's real computed record. A match (or close match — confirm real tolerance, e.g., off-by-one from a game played same-day timing) on a team unique to one candidate game in the date's real slate is a real, high-confidence signal — combine with the existing venue/team-name scoring as an additional point source, not a replacement for it, per the same tiered confidence standard as passes 1-3.

## TASK 4 — Real, honest final accounting

Real count of additionally recovered briefs. Real, specific reasons for any that still don't clear confidence even with the record signal added (e.g., record ambiguous across multiple candidates, or brief's stated record doesn't match any real candidate's actual computed record — worth flagging as a genuinely different anomaly if so, not just "unmatched").

## TASK 5 — Real verification

Real D1 query confirming updated broken-brief count. Real spot-checks on newly-recovered briefs.

---

## DONE CONDITION

Real, honest assessment of how many of the 102 remaining briefs contain a parseable record (Task 1 may reveal this approach has limited applicability — a valid, complete outcome if so). For those that do, real record-based matching applied with the same high-confidence-only standard as passes 1-3, combined with existing text signals rather than used alone.

**Confidence scoring:**
- TASK 1 (25 pts): real, honest inventory of parseable records — correctly reports low applicability if that's what's found, doesn't force relevance
- TASK 2 (25 pts): real, correct D1-compatible record computation
- TASK 3 (25 pts): real matching, correctly combined with existing signals, same confidence standard
- TASK 4 (15 pts): real, specific final accounting, flags genuine anomalies distinctly from simple non-matches
- TASK 5 (10 pts): real verification

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
