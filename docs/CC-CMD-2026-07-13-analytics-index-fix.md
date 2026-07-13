# Claude Code Command — Fix Analytics Engine index-count violation in cron-slate writeDataPoint

**Date:** 2026-07-13
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** one writeDataPoint() call inside handleJournalismCycle. High-blast-radius function (15-min cron) — real care required, matching Cluster 2's own verification standard.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/analytics-index-fix-2026-07-13.md.

## CONTEXT — real bug, confirmed directly via source read before writing this spec

Cluster 2's own forced-live-trigger test (POST /journalism/run?force=true while tailing the worker) caught a genuine, previously-invisible production bug: `[ANALYTICS] cron-slate write failed: writeDataPoint(): Maximum of 1 indexes supported.` Confirmed directly in current source:

```js
env.JQ_ANALYTICS.writeDataPoint({
  indexes: ['cron-slate', 'multi'],
  blobs:   [qualityResult.layers_fired.join(',') || 'none'],
  doubles: [ finalScore, qualityResult.retries, qualityResult.ms, ... ],
});
```

`indexes` has always been a 2-element array; Cloudflare Analytics Engine allows exactly 1. This has been silently failing on every single cron-slate write since the feature shipped — Cluster 2's telemetry fix (already shipped, commit 2b150f7) is what made this visible for the first time via `[ANALYTICS]` console.error, but the underlying write itself is still broken and this CC-CMD is the actual fix.

**Why this matters and why it's safe:** the cron cycle itself is NOT at risk — Cluster 2 confirmed `ok:true` with real fresh content via `/journalism/tonight` despite this bug, because analytics failures are caught and explicitly documented as non-blocking ("analytics failures must not affect cron"). This is purely a data-loss bug for the analytics_output pipeline, not a user-facing correctness bug. Fix it because the data matters, not because anything is currently broken for users.

## TASK 0 — Probe

Confirm the exact current line/content fresh (line numbers may have shifted since this doc was written). Confirm `'cron-slate'` is the index actually used downstream for distinguishing this write path from the live path (the adjacent comment says so — verify against any real query/dashboard/consumer of this Analytics Engine dataset if one is findable, not just the comment).

## TASK 1 — Fix

Reduce `indexes` to a single value: `['cron-slate']`. Move `'multi'` into the `blobs` array (blobs supports multiple values, unlike indexes) rather than dropping it — it may carry real signal (worth confirming what 'multi' actually distinguishes before deciding its exact placement in blobs, e.g. prepend or append, and whether it needs its own array position or can be joined into the existing layers_fired blob string).

## TASK 2 — Verify

Matching Cluster 2's own precedent for this specific function — do NOT reuse KV-corruption-style forced tests here (same collision risk with /journalism/tonight and /journalism/game/{id} that Cluster 2 already identified). Use the same safe method: live-trigger `POST /journalism/run?force=true` while tailing the worker, confirm the `[ANALYTICS]` error is now GONE (write succeeds) rather than just re-observing it. Confirm `/journalism/tonight` still returns real fresh content afterward — zero regression to the actual cron cycle.

## DONE CONDITION

`writeDataPoint()` call succeeds with exactly 1 index, real live-triggered confirmation the error is gone (not just code review), zero regression to journalism cycle output.

**Confidence scoring:**
- TASK 0 confirms real current state, real understanding of what 'multi' distinguishes (25 pts)
- TASK 1 correct fix, 'multi' preserved not dropped, matches established blobs/doubles conventions (35 pts)
- TASK 2 real live-triggered confirmation (not just code review) that the write now succeeds, zero cron regression (40 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
