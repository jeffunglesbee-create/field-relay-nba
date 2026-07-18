# Claude Code Command — MLB briefs backfill, pass 5: city-name alias expansion

**Date:** 2026-07-18
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs. Data-only, no code changes (same as passes 1-4).

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5.

---

## CONTEXT — the root cause, per the original session's own diagnosis

The original backfill session's own "why unrecoverable" breakdown identified this precisely: *"101 LOW_CONFIDENCE briefs: brief text uses city names ('Pittsburgh', 'Detroit', 'Cincinnati') rather than team nicknames ('Pirates', 'Tigers', 'Reds'). Algorithm scores these 1–3 pts."* It named two possible next steps — city-alias expansion (not attempted) and W-L record matching (dispatched separately, pass 4). This CC-CMD is the first, more directly-targeted one.

**Real, novel resolution to the risk that made this seem unsafe at first:** most MLB cities are genuinely, uniquely single-team (Pittsburgh, Detroit, Cincinnati, Milwaukee, Kansas City, etc. — one real team each). The genuinely ambiguous handful (Chicago: Cubs/White Sox; New York: Yankees/Mets; LA: Dodgers/Angels; Bay Area: Giants/Athletics) don't need separate, explicit disambiguation logic — **the existing scoring algorithm already has a venue signal** (3 pts for venue-token match, already in passes 1-3's own scoring). Wrigley Field and Guaranteed Rate Field are different real strings; Yankee Stadium and Citi Field are different real strings. The existing "unique-by-margin ≥2" safety threshold, combined with the existing venue check, should naturally resolve the ambiguous cities without new logic — city aliases can be added directly to the existing team-token dictionary and trusted to the proven scoring mechanism already in place.

---

## PRE-BUILD PROBE BLOCK

```sql
-- Real, current count of still-broken briefs (should be 62 after passes 3-4, re-confirm — don't assume)
SELECT COUNT(*) FROM briefs WHERE brief_type = 'mlb_game' AND game_id LIKE 'g%';
```

Real, current real team-city mapping — confirm the real, canonical city name for every MLB team as used in `regular_season_games.home`/`away` (don't invent aliases; derive them from the real, existing team-identity data already in the codebase or archive).

---

## TASK 1 — Build the real city-alias dictionary

For each real MLB team, add its real city name(s) as additional scoreable tokens alongside the existing nickname tokens — including the genuinely ambiguous ones (Chicago, New York, Los Angeles, Bay Area teams), trusting the existing venue-signal + unique-margin safety mechanism to handle them correctly rather than excluding them.

## TASK 2 — Re-run scoring for all still-broken briefs with the expanded dictionary

Same real scoring algorithm and thresholds as passes 1-3 (venue 3pts, home/away team 2pts each, HIGH ≥5 + unique margin ≥2, MEDIUM =4 + unique margin ≥2 manually reviewed, LOW/NO_CANDIDATES unmatched) — only the token dictionary changes, not the scoring logic itself.

**Real, explicit check on the ambiguous-city safety claim:** for any brief where a genuinely ambiguous city (Chicago/New York/LA/Bay Area) contributes to a HIGH-confidence match, explicitly verify the venue signal was the real disambiguating factor — report this check's real outcome, don't just trust the aggregate score.

## TASK 3 — Apply only real, high-confidence (or manually-reviewed medium) matches

Same standard as every prior pass: a wrong match is worse than an honest miss.

## TASK 4 — Real, honest final accounting

Real count recovered this pass. Real, specific reasons for anything still unmatched even with city aliases added (e.g., neither city nor nickname present, brief too generic, or a genuinely ambiguous city with no venue signal to disambiguate it — flag this last category specifically, since it's the one case the safety mechanism doesn't cover).

## TASK 5 — Real verification

Real D1 query confirming updated broken-brief count. Real spot-checks, including at least one recovered via a city alias (not just nickname), and if any genuinely ambiguous-city case was recovered, explicit confirmation the venue signal was really what disambiguated it.

---

## DONE CONDITION

City-name aliases added to the real scoring dictionary, re-run against all still-broken briefs, high-confidence matches applied with the same standard as every prior pass, and an honest, specific accounting of what remains — including explicit confirmation of whether the venue-signal safety mechanism genuinely held for any ambiguous-city matches, not just assumed.

**Confidence scoring:**
- TASK 1 (20 pts): real, correct city-alias dictionary derived from real team data
- TASK 2 (30 pts): real re-run, explicit check on the ambiguous-city safety claim
- TASK 3 (20 pts): only high-confidence/reviewed-medium matches applied
- TASK 4 (20 pts): real, specific final accounting, flags the uncovered ambiguous-city-no-venue case distinctly
- TASK 5 (10 pts): real verification, including at least one city-alias-driven recovery confirmed

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
