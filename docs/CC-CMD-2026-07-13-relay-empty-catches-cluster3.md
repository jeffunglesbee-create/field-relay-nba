# Claude Code Command — Relay empty-catch sweep, Cluster 3: named functions (smaller concentrations)

**Date:** 2026-07-13
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** ~24 of the ~67 remaining real, AST-confirmed empty catches (post Clusters 1+2). Named functions only this cluster — the 42 anonymous/top-level sites are a separate, later cluster requiring content-based investigation rather than name lookup.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/relay-empty-catches-cluster3-2026-07-13.md.

## CONTEXT

Clusters 1 (golf handlers + handleV2Games, 23 sites) and 2 (handleJournalismCycle, 28 sites, caught a real production Analytics Engine bug since fixed separately) are both shipped and verified. This is the third pass, covering the smaller named-function concentrations from the original full-repo extraction.

**Standing lessons, all apply:**
- Read the whole function before touching any single site — Cluster 1 found more real sites than its own doc knew about this way.
- Comment-only catch bodies are empty (`catch(_){/* comment */}` has zero runtime behavior) — this was the bug in the original 50-count, already corrected repo-wide.
- Established convention: `console.error("[TAG] message:", e.message)`, matching this file's existing tags.
- Cluster 1 found zero false positives in its batch (a deviation from the expected 10-56% exclusion rate) — don't assume that repeats; investigate each site on its own merits.

### Sites (re-verify all fresh — line numbers are from an earlier extraction, real positions may have shifted)

| Function | Known site count |
|---|---|
| writeWCResult | 4 |
| runWCTournamentProjections | 3 |
| sweepKVBriefs | 3 |
| findGame | 3 |
| backfillWCBsdEventIds | 2 |
| buildAFLJournalismContext | 2 |
| ensureFinalizedAtColumn | 2 |
| oddsFetchWithFallback | 1 |
| captureWithRetry | 1 |
| handleCron | 1 |
| ensureCodexStatusColumn | 1 |
| checkIncidentThresholds | 1 |
| buildBackfillPrompt | 1 |
| executeGameBriefBackfill | 1 |

## TASK 0 — Probe

Re-derive the real, current site list fresh via the same tree-sitter/AST method (or grep for each function name + manual catch inspection if that tooling isn't available in this session) — don't trust the table above as final, it's a starting point from an earlier extraction. Read each function in full before touching any individual catch.

## TASK 1 — Add telemetry to each confirmed-real gap

`console.error("[TAG] message:", e.message)` per function/subsystem, matching established convention. Zero behavior change otherwise.

## TASK 2 — Verify

- Real forced-condition test for at least the dominant pattern class in this batch, matching Cluster 1/2's precedent (identify the most common shape, test it for real rather than 24 separate live tests).
- Confirm success-path behavior unchanged for each touched function.
- Whatever test/lint mechanism this repo runs for relay changes.

## DONE CONDITION

All real sites in this cluster's functions individually investigated (whole-function read). Real gaps get real telemetry; correct exclusions documented with real reasoning. Zero caller behavior change.

**Confidence scoring:**
- TASK 0 confirms real, current site list via full-function reads, not the reference table alone (30 pts)
- TASK 1 correct for every confirmed-real gap, matches convention (35 pts)
- TASK 2 real verification for the dominant pattern, all checks clean (35 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
