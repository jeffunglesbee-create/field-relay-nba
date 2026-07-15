# Claude Code Command — Propagate the structural-cap distinction beyond Layer 3b's own targeting

**Date:** 2026-07-14
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/jq-structural-cap-propagation-2026-07-14.md. Commit the outbox manifest with `[skip ci]` in the message.

## CONTEXT

**Confirmed tonight via direct code read — build on this, do not duplicate it.** `_pickWeakestDims` (src/journalism-quality.js, ~L793) already correctly excludes `contextAnchoring`/`matchupDepth` from Layer 3b's retry-prompt targeting when `game`/`matchupNote` weren't provided at all — its own comment states the exact reasoning: flagging an uncorrectable dimension would produce "an uncorrectable instruction ('use the game data' when there is no game data)." This logic is real, correct, and narrowly scoped to one thing: which dimensions Layer 3b's own retry prompt mentions.

**What this narrow scope does NOT do, confirmed by reading its full context:** it doesn't inform whether `runQualityChain` decides to retry at all, doesn't feed any telemetry, and has no visibility into `/quality/report` or the `brief_type_calibration` work from earlier tonight. A brief missing `game`/`matchupNote` entirely is capped well below 300 (the exact ceiling depends on what else scores, but 55 points are structurally unreachable) — if the rest of its dimensions are also imperfect, the retry loop can spend its full budget chasing a threshold it structurally cannot reach, indistinguishable in any report from a brief that's genuinely just weak and could improve with another attempt.

## TASK 0 — Probe

```bash
grep -n "async function runQualityChain" src/journalism-quality.js
```
Read the full retry loop (all layers, 2 through 3b) to find the real, current decision point(s) for "should we retry again" — confirm whether this decision is a simple score-vs-threshold check, or already has some awareness of dimension-level detail. Confirm the real, current shape of whatever gets returned/logged at the end of `runQualityChain` (the `qualityResult` object real callers receive) — this determines where a new field can be added without breaking existing consumers.

## TASK 1 — Compute and surface the real ceiling, act on it in the retry decision

Using the same exclusion logic `_pickWeakestDims` already encodes (reuse it or extract a shared helper — do not duplicate the game/matchupNote-presence check as a second, potentially-diverging copy), compute a real `structuralCeiling` value whenever context is incomplete: 300 minus whatever points are genuinely unreachable given the actual missing inputs for this specific brief.

Wire this into the retry decision: if the current score is already within a small, real margin of its own `structuralCeiling` (not the flat 300, and not the flat 240 threshold — this brief's own real ceiling), stop retrying regardless of whether 240 was reached — further attempts cannot help, and burning them delays other queued work for no possible gain. Decide the exact margin empirically if a natural one doesn't fall out of the dimension math — document the reasoning either way, don't guess a round number.

Add `structuralCeiling` (and whether the final score is capped by it) to `runQualityChain`'s real return shape, additive only — confirm via TASK 0's own findings that no existing caller breaks from an added field.

## TASK 2 — Surface the distinction in reporting

Extend `/quality/report`'s real output (the same one extended earlier tonight with `brief_type_calibration`) to separately report, per brief_type: how many recent briefs were structurally capped (context genuinely incomplete) versus how many scored low with full context available (genuinely weak). These are different problems needing different fixes — the first needs the context-completeness work from earlier tonight extended to more paths; the second needs actual prose improvement. A report that conflates them can't tell which one to act on.

## TASK 3 — Verify

- `node --check src/journalism-quality.js` (and `src/index.js` if `/quality/report` changes touch it): clean.
- Real forced-condition test: a brief missing `game`/`matchupNote` entirely, scoring near its own real structural ceiling, correctly stops retrying rather than exhausting its full budget. A brief with full context and a genuinely low score still retries normally, unaffected by this change (non-regression).
- Real check of `/quality/report`'s new capped-vs-weak breakdown against actual recent D1 data — confirm the two counts are real and sum sensibly against the existing below-threshold totals, not just that the endpoint returns without erroring.

## DONE CONDITION

The exclusion logic `_pickWeakestDims` already encodes now also informs whether to keep retrying at all, not just which dimension to target when retrying. `/quality/report` can distinguish structurally-capped briefs from genuinely-weak ones, per brief_type, verified against real data. Zero regression to briefs with complete context.

**Confidence scoring:**
- TASK 0 (20 pts): finds the real retry-decision point and the real `qualityResult` shape, doesn't guess either
- TASK 1 (40 pts): reuses `_pickWeakestDims`'s real exclusion logic rather than duplicating it, computes a genuine per-brief ceiling, retry loop correctly stops near it, additive to the real return shape
- TASK 2 (20 pts): `/quality/report` correctly separates capped-vs-weak per brief_type, verified against real data
- TASK 3 (20 pts): real forced test for both the capped and the genuinely-weak case, non-regression confirmed

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
