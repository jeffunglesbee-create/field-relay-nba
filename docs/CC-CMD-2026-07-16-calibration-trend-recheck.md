# Claude Code Command — Re-check the calibration trend now that real time has passed, clean up the leftover test row

**Date:** 2026-07-16
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git pull; git log --oneline -5.

Write findings to outbox/calibration-trend-recheck-2026-07-16.md. Commit the outbox manifest with `[skip ci]` in the message.

## CONTEXT

`CC-CMD-2026-07-16-jq-judge-live-verify-and-calibration-watch` stopped at 87/100 — TASK 1 (the voice judge) was fully proven with real LLM evidence, but TASK 2 (whether `brief_type_calibration` trends downward under the new, corrected `scoreProse` formula from `6aed3bb`) was honestly left unobservable at the time, needing real elapsed time and real brief volume that hadn't accumulated yet. Roughly 17+ hours of real live-hours cron activity have passed since then. A real, live data point already exists pointing the right direction: the `dead-hours-bypass` dispatch's own `/quality/report` check found `alert_count` moving from 2 to 4, with new `avg_below_calibrated_p25` alerts appearing — but that was disclosed as *not causally attributable* to that dispatch's own action, just other pipeline activity independently accumulating. This dispatch's job is to properly, formally check whether that's now a real, confirmable trend.

**Also, separately, a real cleanup item found during that same verification and never addressed:** a leftover synthetic test row, `id: game_recap_8880001_2026-07-16`, `sport: null`, still sitting in the live `briefs` table. If it's genuinely stale test data (confirm before deleting — don't assume), it should be removed so it doesn't distort the same calibration aggregates this dispatch is examining.

## TASK 0 — Probe

Confirm the real, current `/quality/report` output. Confirm how many real briefs have been scored under the new formula (post-`6aed3bb`, deployed ~01:36 UTC) versus the old one, per brief_type — enough volume now to draw a real conclusion, or still too thin for any single brief_type. Confirm `game_recap_8880001_2026-07-16` is genuinely synthetic test data and not a real brief before touching it (check for a real, corresponding game with that id anywhere in the schedule data — if none exists, it's confirmed synthetic).

## TASK 1 — Clean up the test row

If TASK 0 confirms it's genuinely synthetic: `DELETE FROM briefs WHERE id = 'game_recap_8880001_2026-07-16'`. Confirm zero remnant afterward via a direct re-query, not just trusting the DELETE's own report.

## TASK 2 — Real calibration trend verification

For each `brief_type` with enough real post-`6aed3bb` volume to be meaningful (state the real threshold used and why): compare the real average/distribution of new-formula scores against the pre-fix historical p25 baseline. State plainly, per brief_type, whether the trend is genuinely downward (as designed — the old formula was measurably rewarding the wire-copy anti-pattern, so lower scores under the new formula are the *correct*, intended outcome, not a regression), inconclusive (real but still too little data), or absent (real data exists and shows no meaningful shift — worth investigating why if so, not just noting it). Do not claim a trend from data volume too thin to support the claim — if every brief_type still has too little post-fix data, say so plainly rather than reaching for the alert-count proxy data as a substitute for direct measurement.

**If TASK 2 finds the trend is real and confirmable:** this closes the original CC-CMD's TASK 2 gap. Update `jq-judge-live-verify-and-calibration-watch`'s own outbox with a dated addendum recording the resolution, matching the established convention for cross-referencing a closed gap back to its origin, rather than only recording the answer in this new dispatch's own outbox.

**If TASK 2 finds it's still genuinely inconclusive:** per standing instruction, do not leave this open silently — file a real follow-up CC-CMD scoped to whatever the actual remaining blocker is (more time, a specific brief_type needing more volume, etc.), with a concrete, real re-check condition, not another open-ended "wait and see."

## DONE CONDITION

The leftover test row is confirmed and removed if genuinely synthetic. The calibration trend question gets a real, evidence-based answer — confirmed-real, confirmed-inconclusive-with-a-concrete-next-step, or confirmed-absent-and-worth-investigating — not left ambiguous.

**Confidence scoring:**
- TASK 0 (25 pts): real current data pulled, test row genuinely confirmed synthetic before any deletion
- TASK 1 (20 pts): clean deletion, confirmed via direct re-query
- TASK 2 (55 pts): real, evidence-based trend conclusion per brief_type, not overclaimed from thin data; addendum written to the original outbox if resolved, or a real follow-up filed with a concrete re-check condition if not

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
