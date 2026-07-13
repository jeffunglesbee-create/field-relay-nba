# Claude Code Command — Relay empty-catch sweep, Cluster 5: anonymous sites, second half (lines ~11400-14300) — FINAL cluster

**Date:** 2026-07-13
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** the remaining 21 of 42 anonymous sites. This is the last cluster of the full-repo empty-catch sweep — once this ships, all real, AST-confirmed empty catches in this repo have been individually investigated.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/relay-empty-catches-cluster5-2026-07-13.md.

## CONTEXT

Clusters 1-3 (71 sites) shipped and verified. Cluster 4 (first 21 of the 42 remaining anonymous sites) is a companion CC-CMD, likely running around the same time as this one — if it lands first, re-derive this cluster's real site list fresh rather than assume the line numbers below are still accurate (Cluster 4's edits will shift everything after its own insertion points).

**Standing lessons, all apply, same as Cluster 4:**
- Read surrounding code, not just the cited line — the only way to identify an anonymous catch's real purpose.
- Comment-only catch bodies are empty — already corrected repo-wide.
- `console.error("[TAG] message:", e.message)`, tag matching the real surrounding subsystem, reuse existing adjacent tags where present.
- Don't assume every site is a real gap OR assume every site is a deliberate exclusion — judge each on its own merits, matching Cluster 3's precedent of finding real, reasoned exceptions.
- If genuinely, deliberately silent by design, document why and leave it.

### Sites (re-verify all fresh — may have shifted if Cluster 4 or anything else lands on main first)

L11417, L11431, L11681, L11695, L11809, L11911, L12078, L12178, L12186, L12230, L12270, L12340, L12364, L12388, L12542, L12705, L13500, L14065, L14178, L14217, L14281

## TASK 0 — Probe

Re-derive the real, current empty-catch list fresh. If Cluster 4 has already landed on `main`, account for its line shifts rather than trusting this doc's snapshot. Read surrounding context for each site before deciding on tag/gap-vs-exclusion.

## TASK 1 — Add telemetry to each confirmed-real gap

`console.error("[TAG] message:", e.message)`, matching real surrounding subsystem conventions. Zero behavior change otherwise.

## TASK 2 — Verify

- Real forced-condition test for the dominant pattern class in this batch, matching prior clusters' precedent.
- Confirm success-path behavior unchanged.
- Whatever test/lint mechanism this repo runs for relay changes.
- Since this is the final cluster of the full sweep: a real, direct count check that zero AST-empty catches remain anywhere in the repo after this ships (same tree-sitter/AST method used to establish the original 118-site total) — confirm the sweep is genuinely complete, not just this cluster's own 21 sites.

## DONE CONDITION

All 21 sites in this cluster individually investigated via real surrounding-context reads. Real gaps get real telemetry; genuine exclusions documented with real reasoning. Zero caller behavior change. A real, final repo-wide count confirms zero remaining AST-empty catches.

**Confidence scoring:**
- TASK 0 confirms real, current site list accounting for Cluster 4 if it landed first (30 pts)
- TASK 1 correct for every confirmed-real gap, tags match real conventions (35 pts)
- TASK 2 real verification for the dominant pattern + a real final full-repo zero-remaining count (35 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
