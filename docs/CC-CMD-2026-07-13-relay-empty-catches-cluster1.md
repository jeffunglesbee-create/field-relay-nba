# Claude Code Command — Relay empty-catch sweep, Cluster 1: golf handlers + handleV2Games

**Date:** 2026-07-13
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** 16 of 50 real, AST-confirmed empty catches in this repo's own src/index.js (verified via tree-sitter against real source, not the deployed bundle — the bundle includes bundled third-party code and isn't the right thing to count against). First batch of what will need several more to cover the rest.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/relay-empty-catches-cluster1-2026-07-13.md.

## CONTEXT — this repo has no prior classification queue, unlike the client

jubilant-bassoon had an 827-site survey (docs/TYPED-RESULT-MIGRATION-QUEUE.md) classifying every null/false/swallowed-catch site into A (real bugs)/B (telemetry-worthy)/C (correctly fine). This repo has no equivalent — tonight's only relay-side fixes (P15B's archive catch-up, loadQualityCalibration's D1 fallback) were done ad hoc, not from a systematic sweep. This CC-CMD is the first real pass at doing that systematically for this repo, starting with the two tightest, most concentrated clusters.

**Standing lessons from tonight's client-side sweep, apply here too:**
- Expect a real fraction (historically 10-56%) to have zero real exception surface on close reading — a correct exclusion is a healthy outcome, not a shortfall.
- A function may have several catches where only some are genuine gaps — read the full function, not just one cited line.
- Established convention for this repo, confirmed live in already-shipped code: `console.error("[TAG] message:", e.message)` inside the catch, matching the file's own existing tags (`[QUALITY]`, `[ARCHIVE-CATCHUP]`, `[ANALYTICS]`, `[BracketDO]`, `[AmbientDO]`). Pick a new bracketed tag per function/subsystem matching this exact style — do not invent a different pattern.
- Real, deterministic point of caution: a mechanical AST scan found these as empty; some may turn out to be deliberately, correctly empty (e.g., "never throw from a socket handler"-style design) — confirm each individually before adding telemetry, exactly as the client-side sweep did.

### Group A — golf handler siblings (10 catches across 5 functions, genuinely related — all part of the golf data pipeline)

| Function | Empty catch line(s) |
|---|---|
| handleESPNGolfScoreboard | ~L2504, ~L2627 |
| handleGolfPlayerStats | ~L2644, ~L2683 |
| handleGolfCompetitorStats | ~L2699, ~L2740 |
| handleGolfEventlog | ~L2755, ~L2793 |
| handleGolfEnriched | ~L2816, ~L2825, ~L2977 (3 catches in this one function — read the whole function, not just one site) |

### Group B — handleV2Games (6 catches, all in one function — read the whole function before touching any single site)

Empty catch lines: ~L3215, ~L3245, ~L3331, ~L3354, ~L3472, ~L3591

## TASK 0 — Probe

Re-confirm each function's current real line numbers and exact catch structure fresh (line numbers above are from a source snapshot pulled at the start of this analysis — re-verify before editing, per this repo's own established discipline). For handleGolfEnriched and handleV2Games specifically, map all catches in the function together before deciding which (if any) need telemetry — do not treat each site in isolation.

## TASK 1 — Add telemetry to each confirmed-real gap

`console.error("[TAG] message:", e.message)` matching this file's established convention. Zero behavior change otherwise.

## TASK 2 — Verify

- Real forced-condition test for each function that gets telemetry (matching the live-log-tail rigor already established tonight for this repo's other fixes, or the most practical equivalent for this batch).
- Confirm genuine success behavior unchanged.
- Run whatever test/lint mechanism this repo has for relay changes.

## DONE CONDITION

All 16 sites individually investigated. Real gaps get real telemetry matching established convention; correct exclusions documented with real reasoning, not defaulted either direction. Zero caller behavior change.

**Confidence scoring:**
- TASK 0 confirms real current state for all 16, full-function context read not just cited lines (25 pts)
- TASK 1 correct for every confirmed-real gap, matches established `[TAG]` convention exactly (35 pts)
- TASK 2 real verification for each addition, all suites/checks clean (40 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
