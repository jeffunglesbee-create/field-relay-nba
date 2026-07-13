# Claude Code Command — Relay empty-catch sweep, Cluster 4: anonymous sites, first half (lines ~7200-11400)

**Date:** 2026-07-13
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** 21 of the 42 remaining real, AST-confirmed empty catches — all anonymous/top-level (no enclosing named function), requiring content-based investigation rather than name lookup.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/relay-empty-catches-cluster4-2026-07-13.md.

## CONTEXT

Clusters 1-3 (71 sites across golf handlers, handleV2Games, handleJournalismCycle, and 14 smaller named functions) are shipped and verified. This is the fourth pass — the last 42 sites in the repo are all genuinely anonymous (event-bus listeners, IIFEs, setInterval callbacks, inline catch blocks with no stable enclosing function name), split into two clusters of 21 by line-range proximity since there's no name to group by. This is the first half.

**Standing lessons, all apply, this cluster especially since none have names to anchor on:**
- Read the surrounding code (not just the cited line) to understand what each catch actually wraps — an anonymous catch's context is the only way to identify it, unlike named-function clusters.
- Comment-only catch bodies are empty — already corrected repo-wide, applies to any new sites found during full-context reads too.
- Established convention: `console.error("[TAG] message:", e.message)` — pick a tag describing the subsystem/route the surrounding code belongs to (e.g. an IIFE inside a specific handler should get that handler's tag family, not a generic one).
- Cluster 1 found zero false positives; Cluster 3 found real, deliberate non-empty exclusions requiring genuine reasoning (return/continue with real control-flow effect) — don't assume either pattern repeats, judge each site on its own merits.
- If a site turns out to be genuinely, deliberately silent by design (matching this codebase's established "never throw from a bus listener"-style patterns seen elsewhere tonight), document why and leave it, don't force telemetry onto intentional design.

### Sites (re-verify all fresh — line numbers are current as of this doc's writing, may have shifted if anything else lands on main before this runs)

L7221, L7360, L7829, L8232, L8263, L8435, L8654, L8661, L8860, L8948, L9155, L9171, L9184, L9218, L9351, L9362, L9975, L9987, L10738, L11346, L11393

## TASK 0 — Probe

Re-derive the real, current empty-catch list fresh (same tree-sitter/AST method as prior clusters, or manual grep + full-context read if that tooling isn't available this session) — the line list above is a starting point, not final. For each site, read enough surrounding code to identify what subsystem/route it belongs to before deciding on a tag or whether it's a genuine exclusion.

## TASK 1 — Add telemetry to each confirmed-real gap

`console.error("[TAG] message:", e.message)`, tag matching the surrounding subsystem, reusing an existing adjacent tag where one already exists in that same code region (matching Cluster 3's precedent of reusing 3 tags from real adjacent code). Zero behavior change otherwise.

## TASK 2 — Verify

- Real forced-condition test for the dominant pattern class in this batch if one emerges (matching Clusters 1-3's precedent — identify it, test it for real once rather than 21 separate live tests).
- Confirm success-path behavior unchanged.
- Whatever test/lint mechanism this repo runs for relay changes.

## DONE CONDITION

All 21 sites individually investigated via real surrounding-context reads. Real gaps get real telemetry; genuine design-intentional exclusions documented with real reasoning. Zero caller behavior change.

**Confidence scoring:**
- TASK 0 confirms real, current site list, reads real surrounding context for each (30 pts)
- TASK 1 correct for every confirmed-real gap, tags match real adjacent subsystem conventions (35 pts)
- TASK 2 real verification for the dominant pattern, all checks clean (35 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
