# Claude Code Command — Push-based invalidation: drama_peak backfill → night_stars recompute

**Date:** 2026-07-12
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** One file, one function's worth of change: `scripts/drama-backfill.mjs`. No relay route changes, no new credential, no new endpoint — `POST /analytics/night-stars/recompute?date=` already exists and already does exactly the recompute this needs.

git pull. Read CLAUDE.md.

Write findings to outbox/cc-drama-nightstars-invalidation-2026-07-12.md.

## CONTEXT — verified against current HEAD this session, not assumed

`recomputeNightStars`'s own doc comment in `src/analytics-engine.js` (~line 180) states the gap directly: *"surgical, single-feature recompute for when drama_peak backfill (drama-backfill.yml, ~2hr cron) catches up to a full day's games AFTER night_stars was already computed and stored (0 9 * * * cron) with a stale/degraded snapshot... Does not fix the underlying cron-timing race."* That race is real and already fired once — `docs/CC-CMD-2026-07-08-night-stars-recompute.md` exists specifically because it had to be found and fixed by hand, for two specific dates, after the fact.

The shape of the bug: `computeNightStars` (analytics-engine.js ~line 128) reads `drama_peak` and writes a permanent snapshot (`INSERT OR REPLACE INTO analytics_output`, keyed `night_stars_{date}`) once daily at 09:00 UTC. `drama_peak` itself is filled in separately by `drama-backfill.yml`'s ~2-hour cron, running `scripts/drama-backfill.mjs`. If backfill hasn't caught up by 09:00 for a given date, `night_stars` correctly flags `degraded:true` at that moment — then never looks again, because nothing tells it the input changed. The recompute endpoint that would fix this already exists and already works (used manually, twice, on 2026-07-08) — it has just never been wired to fire on its own.

Confirmed via source read this session: of the 10 analytics phases in `analytics-engine.js`, only Phase 2 (Night Stars) treats `drama_peak` as a snapshot-freezing dependency this way. Phase 4 (Jinx) also reads `game.drama_peak` (~line 1225) but per-pick, not as a daily slate snapshot — same underlying pull-vs-push problem, genuinely possible, but a different call shape. **Out of scope for this CC-CMD** — do not touch Jinx. A second CC-CMD should be written for it; note this explicitly in the outbox rather than silently leaving it unaddressed.

`writeGameDrama(gameId, peak, arc)` (drama-backfill.mjs ~line 267) is the single function all 5 write paths in `main()`'s loop already funnel through (`[ok]`, `[skip]` no-espn-id-or-unclassified, `[no-match/afl]`, `[no-states]`, `[error]` catch-block). Every one of those 5 paths still means `drama_peak` transitioned out of `NULL` for that game's `date` — including the zero-writes, since `computeNightStars`'s `degraded` check is `dramaMissing > totalGames * 0.5` where `dramaMissing` counts `g.drama_peak == null`. A game going `null → 0` still reduces `dramaMissing` and can flip `degraded` from true to false. All 5 paths need to count, not just `[ok]`.

## PRE-BUILD PROBE (Rule 68/87 — re-run before editing, report drift if found)

```bash
grep -n "async function main" scripts/drama-backfill.mjs
grep -n "for (const game of games)" scripts/drama-backfill.mjs
grep -n "writeGameDrama(game.id" scripts/drama-backfill.mjs
grep -n "while (batchNum < MAX_BATCHES)" scripts/drama-backfill.mjs
grep -n "night-stars/recompute" src/index.js src/analytics-engine.js
node --check scripts/drama-backfill.mjs
```
Expected: 5 `writeGameDrama(game.id` call sites inside one `for` loop inside one `while` loop inside `main()`; the recompute endpoint present in both files as already described above. If the count of `writeGameDrama` call sites is not 5, or the endpoint signature differs, STOP and report before proceeding — do not silently adapt around drift.

## TASK 1 — Track touched dates, minimal diff

In `main()`, before the `while` loop: add `const touchedDates = new Set();`

Inside `for (const game of games) {`, as the **first line** of the loop body (before `classifySport` or any branch): add `touchedDates.add(game.date);`

This is deliberately the only insertion point — every one of the 5 existing `writeGameDrama` call sites is reached only after entering this loop iteration, so one line covers all 5 without touching `writeGameDrama` itself or any of its call sites individually.

## TASK 2 — Fire the existing recompute endpoint, best-effort

After the `while` loop exits (either break condition — `games.length === 0` or `batchNum >= MAX_BATCHES`), add:

```javascript
if (touchedDates.size > 0) {
  console.log(`\n=== Recompute trigger: ${touchedDates.size} date(s) touched ===`);
  for (const date of touchedDates) {
    try {
      const r = await fetch(`${RELAY}/analytics/night-stars/recompute?date=${date}`, { method: 'POST' });
      const body = await r.json().catch(() => ({}));
      console.log(`  [recompute] ${date} → HTTP ${r.status} ${JSON.stringify(body).slice(0, 150)}`);
    } catch (err) {
      console.error(`  [recompute-error] ${date}: ${err.message}`);
      // best-effort — a failed recompute call must never fail the backfill run itself
    }
  }
}
```

Place this after the existing end-of-`main()` summary logging (`totalProcessed`/`totalErrors`), not before it — the backfill's own success/fail accounting is unrelated and must not depend on recompute succeeding.

## TASK 3 — Verification (self-contained, does not require waiting for a real stuck case)

The live discovery queue (`/archive/drama-missing`) is confirmed empty right now — the 2hr cron is caught up. So the test must be synthetic and reversible, not "wait for a real gap":

1. Pick one real, already-scored, already-`drama_peak`-populated past game (query `regular_season_games` for any row with `home_score IS NOT NULL AND drama_peak IS NOT NULL`, most recent date).
2. Record its current `drama_peak`/`drama_arc`, and record `analytics_output`'s `night_stars_{that date}` row's `created_at`.
3. `UPDATE regular_season_games SET drama_peak = NULL, drama_arc = NULL WHERE id = ?` for that one row only — single-row, documented, reversible.
4. Manually dispatch `drama-backfill.yml` (`workflow_dispatch`).
5. Confirm via workflow logs: the `[recompute]` log line fires for that date.
6. Confirm via D1: `drama_peak`/`drama_arc` restored to the exact values recorded in step 2 (proves the backfill logic itself is unchanged), AND `night_stars_{date}`'s `created_at` is now newer than the value recorded in step 2 (proves the recompute genuinely re-ran, not just that the endpoint returned 200).
7. If the restored `drama_peak` does not exactly match the recorded original, STOP — that would mean the backfill's scoring logic itself drifted, a separate and more serious problem than this CC-CMD's scope.

## DONE CONDITION

`touchedDates` tracking added (2 lines), post-loop recompute block added, `node --check` clean, AND step 3's synthetic test shows `night_stars`'s stored `created_at` for the test date genuinely advancing after a backfill run — live-verified, not just code-reviewed. Jinx's parallel gap named in the outbox as a real, separate, not-yet-written follow-up — not silently dropped.

**Confidence scoring:**
- Probe block re-run, 5-call-site count confirmed, no drift (15 pts)
- `touchedDates` tracking correctly covers all 5 write paths via the single insertion point, not just `[ok]` (20 pts)
- Recompute block correctly placed post-loop, best-effort, never fails the backfill run itself (15 pts)
- Synthetic single-row test executed for real: `drama_peak` nulled, backfill dispatched, restored value byte-matches original (20 pts)
- `night_stars` `created_at` for the test date independently confirmed newer post-run, via direct D1 query before AND after (20 pts)
- Jinx gap explicitly named in outbox as scoped-out, not silently skipped (10 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
