# Claude Code Command — Calibration trend re-check #2 (real volume, contamination-aware)

**Date filed:** 2026-07-16 (by `CC-CMD-2026-07-16-calibration-trend-recheck`)
**Earliest run:** not before 2026-07-17T10:00:00Z (next full live-hours window close — see CONTEXT)
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git pull; git log --oneline -5.

Write findings to outbox/calibration-trend-recheck-2-2026-07-17.md (adjust date if run later). Commit the outbox manifest with `[skip ci]` in the message.

## CONTEXT

`CC-CMD-2026-07-16-calibration-trend-recheck` found the `brief_type_calibration` downward-trend question (does `scoreProse` under the `6aed3bb` formula genuinely score lower than the old formula in real production use, as designed) still inconclusive as of ~14:00 UTC on 2026-07-16 — not from a tooling limitation, but from genuinely thin real post-fix volume (0 real `game_recap` scores, 0 real `mlb_game` scores, 1 real `night_owl`, 1 real `slate`, out of ~13 hours / ~5 real live-hours since the `6aed3bb` deploy at `2026-07-16T01:36:49Z`).

That same dispatch also found and removed 17 synthetic test rows silently contaminating `ARCHIVE_DB.briefs` and, transitively, `/quality/report`'s live aggregates — root-caused to `sweepKVBriefs` (`src/index.js:5022`) sweeping leftover `brief:game:*` KV cache entries (left behind by CI test dispatches that clean up their direct D1 row but not the KV entry) into new parallel D1 rows under its own `game_recap_${gameId}_${sweepDate}` id scheme, for up to the KV entry's 1h TTL after the originating test. This is a *repeatable* contamination path, not a one-off — any future CI probe that writes to `brief:game:*` KV (directly or via `/journalism/game-complete`) and doesn't also delete the KV entry (not just the D1 row) will trigger it again.

## TASK 0 — Probe

Re-confirm current line numbers (`sweepKVBriefs`, the queue consumer's dedup/write logic, `/quality/report`'s route handler) — they drift session to session. Pull live `/quality/report`. Confirm the `6aed3bb` deploy timestamp is still the correct cutoff (it is a fixed historical fact, but re-confirm via `git log` rather than trusting this doc's copy).

## TASK 1 — Repeat the contamination check before trusting any new numbers

Before computing anything, repeat `CC-CMD-2026-07-16-calibration-trend-recheck`'s TASK 0 methodology: for every `briefs` row with `created_at >=` the `6aed3bb` deploy timestamp, cross-check its `id`/`game_id` (stripping any `espn:` prefix) against both `regular_season_games` and `postseason_games` by both `id` and `espn_event_id`. Anything with zero match is synthetic — exclude it from TASK 2, and if it's unambiguously synthetic by the same bar the prior dispatch used, delete it (confirm via direct re-query) and disclose exactly what was deleted, same as the prior dispatch did. Do not assume "no new contamination since last time" — check fresh.

## TASK 2 — Real calibration trend verification, take 2

Same methodology as the prior dispatch: for each `brief_type` with a `brief_type_calibration` entry, compare real (contamination-checked) post-fix average/distribution against the pre-fix historical p25. State plainly per brief_type whether the trend is genuinely downward (expected/correct), inconclusive (still too little real data — state the exact count), or absent (real data exists, no meaningful shift — worth investigating why).

**Minimum real-volume bar before attempting any trend claim for a given brief_type: n ≥ 10 confirmed-real post-fix scores.** Below that, report the exact count and call it inconclusive — do not reach for a smaller n "directionally suggestive" claim (the prior dispatch's n=1 points for `night_owl`/`slate` were correctly not treated as evidence either way, despite one happening to point the predicted direction).

If `game_recap` specifically still shows 0 or near-0 real `source:'cron'` volume, note whether that's plausibly still explained by GameDO's client-driven completion detection (documented elsewhere this session) or whether it's now suspicious enough (given more elapsed time) to warrant its own investigation — state which, with reasoning, don't just repeat the prior dispatch's caveat by default.

## TASK 3 — Decide on the `sweepKVBriefs` root cause

Now that this contamination pattern has recurred/been confirmed reproducible across two dispatches, decide: is a real code fix in scope for a follow-up dispatch (e.g., CI test scripts explicitly deleting their KV entry in cleanup, not just relying on TTL; or `sweepKVBriefs` gaining a synthetic-id guard; or `sweepKVBriefs` being reworked to use the real `game_recap_${sport}_${eventId}` id scheme so `ON CONFLICT DO NOTHING` actually functions as intended)? If yes, file a properly-scoped CC-CMD for it (map every `sweepKVBriefs` caller and every site that writes `brief:game:*` KV first, per Rule 71/Rule 39, before proposing a fix — do not fix inline in this dispatch). If the volume of recurrence is still just 1 known instance beyond the original, document and defer rather than force a fix.

## DONE CONDITION

The calibration trend question gets a real, evidence-based answer at real volume (n≥10 per brief_type or an honest "still below n≥10, here's the count") — not left ambiguous a second time. Any new contamination found is disclosed and removed with the same rigor as the originating dispatch. A decision (fix now / defer with reason) is recorded for the `sweepKVBriefs` root cause.

**Confidence scoring:**
- TASK 0 (10 pts): current line numbers and deploy timestamp re-confirmed, not assumed from this doc
- TASK 1 (25 pts): contamination check repeated fresh, any new synthetic rows found/removed with full disclosure and the same verification rigor
- TASK 2 (50 pts): real, evidence-based trend conclusion per brief_type at the stated n≥10 bar, not overclaimed
- TASK 3 (15 pts): a real, reasoned decision on the `sweepKVBriefs` fix (file a properly-scoped follow-up, or defer with a stated reason) — not silently dropped

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
