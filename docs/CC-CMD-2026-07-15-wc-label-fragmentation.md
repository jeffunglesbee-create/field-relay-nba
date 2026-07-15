# Claude Code Command — Normalize WC26 sport-label casing at every write path

**Date:** 2026-07-15
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/wc-label-fragmentation-2026-07-15.md. Commit the outbox manifest with `[skip ci]` in the message.

## CONTEXT

`/quality/report`'s own `sport` grouping splits what should be one real WC26 population across three separate string variants — re-confirmed live tonight, real, current (7-day window): `"FIFA World Cup"` (n=6), `"FIFA World Cup 2026"` (n=1), `"fifa world cup 2026"` (n=4, lowercase). 11 real `game_recap` rows fragmented into three, each individually too small to calibrate against reliably — this directly weakens the brief-type calibration system shipped earlier tonight for WC26 specifically, since `loadQualityCalibration`/`brief_type_calibration` group by this same raw `sport` string.

**Do not confuse this with the soccer league-mislabel bug fixed earlier tonight** (`1f99409`) — that fixed `adaptESPNWCSoccer` hardcoding `league: 'FIFA World Cup'` for all 13 soccer competitions, a *competition-identity* bug (EPL games showing as World Cup). This is a different, narrower bug: even WC26 games *specifically* get their own sport string written inconsistently across different code paths — casing and date-suffix differences, not wrong-competition confusion.

**Reuse, don't duplicate:** `SOCCER_LEAGUE_LABELS` (added in the earlier fix) already establishes a canonical label for `wc26`. The fix here is making every write path that persists a `sport` string for a WC26 brief use that same canonical value, not defining a second, separate canonical string.

## TASK 0 — Probe

Find every real write path that sets a `sport` value for a WC26-related row — `grep -n "'FIFA World Cup'\|\"FIFA World Cup\"\|wc26" src/index.js` as a starting point, but confirm the *actual* full set of distinct write sites, not just this doc's citations. For each, note whether it writes a literal string, a variable derived from `SOCCER_LEAGUE_LABELS`, or something else (e.g., a raw ESPN league name passed through unnormalized) — the three real variants found tonight suggest at least one path bypasses the canonical label entirely and one applies inconsistent casing.

## TASK 1 — Fix

Normalize every write path found in TASK 0 to use `SOCCER_LEAGUE_LABELS`'s existing WC26 entry (or a shared constant derived from it) rather than a literal string at each call site — this prevents the same fragmentation recurring for a future label change, not just fixing today's three variants. Do not touch any non-WC26 sport's labeling.

**Historical data question — decide, don't skip:** the 11 already-fragmented rows in `briefs` still carry the old variant strings. Decide and document whether to backfill them to the canonical value (restores full calibration statistical power for the existing data) or leave them as a historical record and let the fragmentation only stop growing from here — either is defensible, but pick one deliberately and say why, rather than leaving it unaddressed by default.

## TASK 2 — Verify

- `node --check src/index.js`: clean.
- Real forced-condition test: simulate a brief write from each of the write paths found in TASK 0, confirm all produce the identical canonical `sport` string.
- Real live check: query `/quality/report` (or D1 directly) after the fix, confirm no new fragmentation appears for any WC26 brief generated after this deploys. If historical backfill was chosen in TASK 1, confirm via direct query that the 11 known rows now show one combined value.

## DONE CONDITION

Every write path producing a WC26 `sport` string uses the same canonical value from `SOCCER_LEAGUE_LABELS`. No new fragmentation possible going forward, verified via forced tests covering every real write path found. Historical data question explicitly decided and documented, not silently skipped.

**Confidence scoring:**
- TASK 0 (30 pts): finds every real write path, not just this doc's citations; correctly identifies which paths bypass the canonical label vs. apply inconsistent casing to it
- TASK 1 (40 pts): all paths normalized to the existing SOCCER_LEAGUE_LABELS entry (not a new, separate constant); historical backfill question explicitly decided and justified
- TASK 2 (30 pts): real forced tests for every write path found, real live/D1 confirmation no new fragmentation appears

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
