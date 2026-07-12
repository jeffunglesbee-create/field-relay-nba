# Claude Code Command — Generic Degraded-Phase Sweep (analytics-engine)

**Date:** 2026-07-12
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** Generalize the night_stars recompute fix (docs/CC-CMD-2026-07-08-night-stars-recompute.md) to all 10 analytics phases, cost-gated so no phase that calls the AI proxy ever auto-fires.

git pull. Read CLAUDE.md and STANDARDS.md Rule 78 (API-COST-A) before touching this file.

Write findings to outbox/cc-analytics-degraded-sweep-2026-07-12.md.

## CONTEXT — verified from a chat session this same day, re-verify from HEAD before building anything

- `analytics-engine.js` currently defines the phase functions dispatched by `processDate` (runPhase3TruthIs, runPhase4Jinx, runPhase5MorningReport, runPhase6ASportOfWeek, runPhase6BCompositeBrief, runPhase6CContradiction, runPhase6DBrokenRecord, runPhase7StreakBoard, runPhase8QualityFeedback, runPhase9FieldPick, runPhase10APreview, runPhase10BLate, runPhase12QualityAlert — more function names than the 10 features session_health reports; reconcile the real feature-name -> function mapping from `processDate`'s own body, not from this list).
- Every phase writes its result via the shared `writeAnalyticsOutput(env, {date, feature, sport, value, briefText})`, and `value` already carries a `degraded: true/false` boolean in every phase — confirmed via grep, every `writeAnalyticsOutput` call site passes either a computed `degraded` or a literal `degraded: true`.
- Exactly ONE phase, night_stars, has a surgical recompute path: `recomputeNightStars(env, date)` + `POST /analytics/night-stars/recompute` (relay-index.js ~L10859), built because night_stars was found stuck at `degraded:true` on two real dates — its input (`drama_peak`) is filled by a separate, slower-cadence cron (`drama-backfill.yml`, ~2hr cycle), and nothing re-triggered night_stars once that cron caught up.
- The other phases have no equivalent fix. Not proven safe -- just not yet caught the way night_stars was.
- A read query already extracts `degraded` from stored output: `JSON_EXTRACT(value, '$.degraded')` (relay-index.js ~L12931). Confirm its current caller/purpose before assuming it's unused -- it may already partially feed a dashboard or session_health.
- Rule 78 (API-COST-A) applies directly: some of these phases likely call `callProxy()` (the Claude API proxy). Re-running a degraded phase is not free if it makes a real AI call. Do not build an indiscriminate "recompute everything degraded" sweep before classifying which phases are pure/computational (no AI call, like night_stars) vs AI-costing.

## TASK 0 -- Probe: classify every phase as PURE or AI-COSTING

For each `runPhaseN` function, grep its actual body for `callProxy(` or any other external paid-API call. Produce a table: feature name | function | PURE or AI-COSTING | evidence (line number of the call, or "confirmed no callProxy in function body, read in full"). Do not infer from function names. If a phase's classification is ambiguous for any reason, classify it AI-COSTING (fail safe) and say so explicitly.

## TASK 1 -- Generic degraded-row detector

`async function getDegradedPhases(env, sinceDate)` in analytics-engine.js: reads `analytics_output` for rows where `JSON_EXTRACT(value,'$.degraded')=1` and `date >= sinceDate`. Pure read. Check whether the existing ~L12931 query can be refactored to call this shared function instead of duplicating the JSON_EXTRACT logic a second time (Rule 63 -- do not duplicate data/logic you already have).

## TASK 2 -- Auto-recompute path for PURE phases only

Generalize `recomputeNightStars`'s exact shape (read `before`, call the phase's existing run function, write via `writeAnalyticsOutput`, return `{before, after}`) into `recomputePhase(env, feature, date)`, dispatching to the correct `runPhaseN` via the feature-to-function map TASK 0 produced. Wire it into a scheduled cron (reuse the existing cron trigger pattern already in wrangler.toml -- confirm it, do not invent a new one) that calls `getDegradedPhases` then `recomputePhase` for PURE-classified rows only.

## TASK 3 -- Surface, do not auto-fire, the AI-costing phases

For phases classified AI-COSTING in TASK 0, expose them read-only (extend the ~L12931 endpoint or add a new one) so session_health/codex can see "these are currently degraded and need an explicit recompute call, not an automatic one." No auto-firing of paid calls -- a human or a chat session decides.

## VERIFICATION

- TASK 0's classification table is real -- every function body actually read, not guessed from its name.
- TASK 1 tested against real current data: does it find any phase currently degraded (including re-testing against night_stars' own historical rows)?
- TASK 2's cron path is grep-provably unreachable from any `callProxy` call -- this is the one thing that must not be wrong.
- TASK 3's surfaced list is genuinely visible somewhere outside this CC-CMD's own outbox (an endpoint, or explicitly wired for a follow-up chat session to consume).

## DONE CONDITION

`getDegradedPhases` exists and returns real current rows. PURE-classified phases auto-recompute on a schedule with zero reachable path to an unplanned AI-proxy call. AI-costing phases are visible, not silently ignored, and never auto-fired.

**Confidence scoring:**
- TASK 0 classification genuinely read from every function body, not inferred from names (25 pts)
- TASK 1's detector reuses/refactors the existing L12931 query rather than duplicating it (15 pts)
- TASK 2's auto-fire path is grep-provably unreachable from any `callProxy` call (25 pts -- the safety-critical one)
- TASK 3 surfaces AI-costing degraded phases without ever auto-firing them (20 pts)
- Real verification against current live data, not simulated (15 pts)

Do not commit unless confidence >= 95. A wrong PURE classification that later fires an unplanned paid call is the single worst outcome this CC-CMD could produce -- when in doubt, fail toward AI-COSTING and report it plainly instead of guessing.
