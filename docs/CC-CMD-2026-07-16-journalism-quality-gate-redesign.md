# Claude Code Command — Replace scoreProse's composite-rubric retry gate with a qualitative voice judge

**Date:** 2026-07-16
**Repo:** field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git pull; git log --oneline -5.

Write findings to outbox/journalism-quality-gate-redesign-2026-07-16.md.

## CONTEXT

A full read of `src/journalism-quality.js` (984 lines) established a baseline before this dispatch (see chat context — not re-derived here, cite it). The chain has three genuinely different kinds of layer, and only one of them is the actual problem:

1. **Factual/correctness gates (layers 2, 2b, 2d, 2d-score, 2e)** — banned-phrase removal, sport-vocabulary contamination, stat-verification-against-prompt, score-contradiction detection (with a documented real catch: a fabricated "2-3" score in a Colombia/Congo DR brief), cross-league hallucination. **These are correct as built. Not in scope for this dispatch — do not touch.**
2. **The voice/craft prompt layer (`FIELD_VOICE_REGISTER`, `FIELD_PROSE_STYLE`)** — real prose exemplars per sport, a labeled anti-exemplar, six explicit number-subordination patterns. This is already good and not the problem. **Not in scope — do not touch, only reuse (see TASK 1).**
3. **`scoreProse()` (10-dimension, 300-point composite) + `runQualityChain`'s "3b" step** (score < 240 → dimension-targeted regex-derived correction → retry → accept only if `newScore >= score`). **This is the actual scored rubric the "not the way to get to real journalism" consensus is about, and it contains a demonstrable internal contradiction:** Dim4 ("Density") scores higher the more proper-nouns-and-numbers are packed per sentence — literally the fact-stuffing pattern `FIELD_VOICE_REGISTER`'s own anti-exemplar section labels as the wire-copy failure mode ("A brief with 15 numbers in 8 sentences is wire copy regardless of register"). A piece that matches the file's own Exemplars A–D (lean, one number per sentence) would plausibly score *worse* on Dim1/Dim4 than stat-stuffed wire copy, and the retry loop would "correct" it back toward wire copy because that's what the metric rewards.

**"A gate has to exist" (explicit, prior instruction) — this dispatch replaces the gate, it does not remove it.**

**Known real dependency, not yet resolved — TASK 0 must resolve it before any scoring-formula change ships:** `runQualityChain`'s numeric `score` is not purely an internal retry signal. It's logged to `JQ_ANALYTICS` (Analytics Engine `doubles` field) and — per this repo's own quality-calibration system (`loadQualityCalibration`, `brief_type_calibration`, the subject of `CC-CMD-2026-07-15-wc-label-fragmentation` earlier this cycle) — used as historical input for per-sport/per-brief-type quality baselines. Changing `scoreProse`'s internal formula (e.g. fixing Dim4) changes what that historical number *means* without changing its 0–300 scale — TASK 0 must confirm whether calibration cares about the formula's internals or just trusts the raw number as an opaque trend line, before TASK 1 touches it.

**Real blast radius, enumerated at dispatch time (re-confirm in TASK 0 — HEAD may have moved):** 10 real `runQualityChain(...)` call sites and 3 real direct `jqScoreProse(...)` (aliased `scoreProse`) call sites, all in `src/index.js` (`grep -n "runQualityChain(\|scoreProse(\|jqScoreProse"`). No other file imports `journalism-quality.js`.

## TASK 0 — Probe

1. Re-confirm the 13 real call sites above against current HEAD. For each `runQualityChain` call, note whether it passes `game`/`matchupNote`/`sport` (some `scoreProse` dimensions are conditionally inapplicable without them — Dim7/Dim10 — the judge replacement must handle the same conditionality, not assume every caller has full context).
2. Read `loadQualityCalibration` and `brief_type_calibration`'s consumers in full (`/quality/report`, wherever calibration reads historical `score` values) to answer the dependency question above: does calibration treat `score` as an opaque number to baseline against (safe to change the formula, historical trend just shifts once) or does it assume something about the formula's internal composition? Document the real answer, not an assumption.
3. Reproduce the Dim4-vs-voice-register contradiction concretely: run `scoreProse()` (or a faithful extracted copy) against one of `FIELD_VOICE_REGISTER`'s own 4 real exemplars (lean, ~100-145 words, one number per sentence) and against a synthetic wire-copy paragraph matching the file's own anti-exemplar shape. Confirm live whether the anti-exemplar actually scores competitively or higher on Dim1/Dim4 than the real exemplar — this is the concrete evidence TASK 1's fix must resolve, not a hypothetical.
4. Check current retry-budget economics: `runQualityChain`'s `maxRetries` defaults to 7, shared 1-retry-per-layer across layers 2/2b/2c/2d/2d-score/2e/3b. Confirm how many of those 7 slots are realistically consumed by the factual layers in practice (sample real `layers_fired` values from `JQ_ANALYTICS` or the `briefs` table if the data is queryable) so TASK 1's judge-retry doesn't get starved the way `CC-CMD-2026-07-08-jq-3b-starvation-and-targeting` already had to fix once for the old 3b step.

## TASK 1 — Fix

Two-part fix, evidence-based per TASK 0's findings:

**1a — Neutralize the Dim4 contradiction in `scoreProse` itself** (not routed around — fixed at the source, since the score remains a real calibration/analytics input per TASK 0.2's finding). Density's current formula rewards raw (proper-nouns + numbers) per sentence with no ceiling tied to what's actually good prose. Redesign it to stop rewarding stacking beyond what one clause can hold — e.g., cap the per-sentence contribution so a sentence with 1 number scores the same or better than one with 3 crammed in, consistent with `FIELD_PROSE_STYLE`'s own "one metaphor max," "ONE-NUMBER-PER-SENTENCE RATIO" guidance already stated elsewhere in this same file. Audit Dim1 (Specificity) and Dim3 (Variety) for the same class of problem while in there — both are also raw ratios with no ceiling — document findings even if no change is needed for those two.

**1b — Replace `runQualityChain`'s "3b" retry-trigger/accept logic.** Currently: `score < 240` → build a dimension-targeted regex-derived correction → retry → accept only if `newScore >= score`. Replace with: a qualitative judge call that reuses `FIELD_VOICE_REGISTER`'s existing exemplars/anti-exemplar verbatim (do not duplicate them into a second copy — pass the same constant or a reference to it) and asks for a strict verdict — does this draft read like the real exemplars or like the anti-exemplar — PASS/FAIL plus, on FAIL, one concise sentence naming the single biggest issue (matching this file's own established "name the specific violation" pattern from layers 2/2b/2c). Retry on FAIL, within the SAME shared retry budget layer 3b already occupied (do not add a new, additional retry slot — Rule 76, FALLBACK-CAP-A). Accept the retry unconditionally if the judge says PASS (no more "accept only if the composite number didn't regress" — that's exactly the score-chasing behavior being removed).

The numeric `scoreProse` score keeps being computed and logged (calibration/analytics keep receiving it, per TASK 0.2), but after this fix it is **descriptive only** — nothing in `runQualityChain` uses it to decide whether to retry or whether to accept a retry anymore.

Do not touch layers 2/2b/2c/2d/2d-score/2e. Do not touch `FIELD_VOICE_REGISTER`/`FIELD_PROSE_STYLE`'s content (reuse only).

## TASK 2 — Verify

- `node --check src/index.js`: clean.
- Real forced-condition test reproducing TASK 0.3's contradiction check against the FIXED `scoreProse`: confirm a real `FIELD_VOICE_REGISTER` exemplar now scores at or above a synthetic wire-copy paragraph of similar length on Dim1/Dim4 (the concrete regression test for the bug this dispatch fixes).
- Real forced-condition test for the new judge-based retry logic: a synthetic draft matching the anti-exemplar shape triggers a retry; a synthetic draft matching a real exemplar's shape does not.
- Live test (proxy call required — use the real `field-claude-proxy` path, not a mock) confirming the judge call itself works: send one real synthetic draft through, confirm a real PASS or FAIL verdict comes back with the expected shape.
- Confirm retry-budget accounting: the new judge-retry still costs at most 1 retry slot, same as the old 3b step — no new proxy-call layer added beyond what TASK 0.4 found already existing.
- Confirm calibration/analytics still receive a `score` field of the same shape/scale (0–300) — a live `/quality/report` check post-deploy, not just code review.

## DONE CONDITION

`scoreProse`'s Dim4 (and any other dimension TASK 0.3/1a found with the same contradiction) no longer rewards the wire-copy fact-stacking pattern `FIELD_VOICE_REGISTER` explicitly forbids — verified via a real before/after test against the file's own exemplars, not asserted. `runQualityChain`'s retry-acceptance criterion for the aesthetic layer is now a qualitative PASS/FAIL judgment reusing the existing exemplars, not a numeric non-regression check against a composite score that was measurably fighting the voice guidance. The gate still exists (explicit requirement) and still runs unattended inside the same retry budget — this is a fix to what the gate checks, not a removal of gating or a bolted-on fallback alongside the old one.

**Confidence scoring:**
- TASK 0 (30 pts): all 13 real call sites re-confirmed; calibration's real dependency on `score`'s internals (vs. treating it as opaque) resolved with evidence, not assumed; the Dim4 contradiction reproduced concretely against the file's own real exemplars; retry-budget economics checked against real `layers_fired` data
- TASK 1 (45 pts): Dim4 (and any sibling dimensions found) fixed at the source, not routed around; judge-based retry correctly reuses existing exemplars (no duplication); retry budget unchanged (no new slot); factual-gate layers and voice-prompt content completely untouched; numeric score preserved for calibration/analytics as descriptive-only
- TASK 2 (25 pts): real before/after regression test against real exemplars; real judge-retry forced tests; a real live proxy call proving the judge mechanism works, not just unit-tested; live confirmation calibration/analytics still receive the expected score shape

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
