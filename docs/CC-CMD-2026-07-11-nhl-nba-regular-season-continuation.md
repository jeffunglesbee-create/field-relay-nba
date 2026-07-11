# Claude Code Command — Extend playoff-only NHL/NBA seasonal items to also cover the October regular season

**Date:** 2026-07-11
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Scope:** `nhl-gsax-r2.js`'s cron is explicitly scoped "weekly during playoffs (same April-July guard as series stats)" — but its own route already anticipates a `regular.json` variant (`['playoffs.json', 'regular.json'].includes(gFile)`) that nothing currently populates. This is very likely not an isolated case — any NHL/NBA seasonal data pipeline built during a playoff push probably has the same playoffs-only scoping with no regular-season continuation wired. Audit the whole class, not just this one instance, and extend each to resume when the next regular season starts (NHL and NBA both start their regular seasons in October).

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md and STANDARDS.md before touching anything.

Write findings to outbox/cc-nhl-nba-regular-season-continuation-2026-07-11.md.

## TASK 1 — Full audit: every NHL/NBA cron or data pipeline with playoff-only scoping

Grep for cron schedule comments/guards mentioning "playoffs," date ranges like "April-July," or similar seasonal gating, across all NHL and NBA data files (`nhl-gsax-r2.js`, `nhl-series` equivalent, `nba-clutch` equivalent, and any others found — do not assume the list is limited to what's named here). For each, determine:
- Does the route/consumer already anticipate a regular-season variant (like `nhl-gsax`'s `regular.json` option), or would one need to be added?
- Does the underlying upstream data source (MoneyPuck, stats.nba.com, etc.) actually publish equivalent regular-season data in a comparable shape? Confirm this directly — do not assume regular-season data exists in the same format just because playoff data does.
- Is this genuinely a "should continue in regular season" case, or is the underlying stat conceptually playoffs-specific (e.g., something that only makes sense in elimination-game context)? Report this distinction explicitly per item — do not apply a blanket "extend everything" answer.

## TASK 2 — Extend cron scheduling for every genuine case found

For each pipeline confirmed to need regular-season continuation: extend the cron guard so it resumes when the next regular season begins in October, running against the regular-season variant of the upstream data source, writing to the regular-season R2 key/variant the route already expects (or adding that route support if TASK 1 found it doesn't exist yet). Preserve the existing playoffs-window behavior unchanged — this is additive (cover more of the year), not a replacement of the current logic.

## TASK 3 — Confirm this doesn't create an August-September gap

NHL/NBA regular seasons start in October; playoffs guards currently end around July. Confirm whether an August-September gap is expected and fine (genuinely no games, nothing to serve) or whether any pipeline needs to explicitly handle that dead window (e.g., the route should keep serving last season's data with a staleness flag, vs. correctly returning "no data" like `nhl-gsax` already does today). Report the decision per pipeline, matching the same distinction-not-blanket-answer approach as TASK 1.

## VERIFICATION

- For each extended pipeline: confirm the cron's new schedule actually spans the intended window (verify the cron syntax, don't just eyeball it).
- Confirm no existing playoffs-window behavior changed for pipelines already correctly running today.
- If any route needed new regular-season support added (not just a cron extension), test it live against a real or simulated regular-season data pull.

## DONE CONDITION

Every genuine playoff-only NHL/NBA pipeline found in TASK 1 is either confirmed correctly extended to resume in October, or explicitly and individually justified as playoffs-only by nature (not a blanket assumption). The August-September gap behavior is a stated decision per pipeline, not left ambiguous. Confidence ≥ 95.

**Confidence scoring:**
- TASK 1 audit genuinely complete across both sports, each item individually classified (30 pts)
- TASK 2 extensions correctly implemented, additive not replacing existing playoff behavior, verified against real upstream data shape (35 pts)
- TASK 3 August-September gap behavior explicitly decided per pipeline (20 pts)
- No blanket "extend everything" or "extend nothing" answer applied without per-item justification (15 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.