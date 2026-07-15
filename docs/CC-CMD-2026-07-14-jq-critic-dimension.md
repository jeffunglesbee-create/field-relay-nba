# Claude Code Command — Independent critic pass as an 11th scoring dimension

**Date:** 2026-07-14
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/jq-critic-dimension-2026-07-14.md. Commit the outbox manifest with `[skip ci]` in the message.

## CONTEXT

**Corrected premise, confirmed tonight via direct code read — do not build against the wrong one.** `scoreProse` (src/journalism-quality.js) never calls the LLM. All 10 dimensions are deterministic: pattern matching, stat density, banned-phrase detection, temporal-anchor checks, cliche detection. The only LLM involvement in the whole quality chain is inside `runQualityChain`'s retry prompts, regenerating text after a deterministic check flags a problem. There is no self-scoring bias to fix — the scorer and the generator are never the same call.

**What's real and worth building instead:** deterministic checks can verify surface patterns (a stat has a date near it, a banned phrase is absent, sentence variety exists) but cannot assess whether the *analysis itself* is insightful, whether the narrative actually coheres, or whether a reader would find this genuinely worth reading. That's a real gap none of the current 10 dimensions can close by construction, not a bias in an existing one.

## TASK 0 — Probe

```bash
grep -n "export async function scoreProse\|export async function runQualityChain" src/journalism-quality.js
grep -n "callProxy(" src/journalism-quality.js
```
Re-confirm the real, current dimension list and total point allocation (300 across 10) before adding an 11th. Confirm no existing dimension already does semantic/coherence assessment under a different name — read all 10 dimension names and their computation functions before assuming this is net-new.

## TASK 1 — Build the critic dimension

Add an 11th dimension, additive to the existing 300-point scale (i.e., ceiling becomes 300 + N, do not renormalize the existing 10 or change their point values — TASK 0's own probe should confirm this doesn't collide with any hardcoded `/300` assumption elsewhere, like the 240 excellence threshold, `brief_type_calibration`'s real percentiles from tonight, or the client-side display — flag and fix every real site found, don't leave a stale `/300` label next to a `/300+N` actual ceiling).

Real design constraints, not optional:
- **One LLM call, not a loop.** A single critic prompt against the already-generated text, framed explicitly to find weaknesses rather than confirm quality (e.g., "assume this is mediocre until the text proves otherwise; name the single weakest sentence and why") — a framing that asks for confirmation produces confirmation; a framing that asks for weaknesses produces something deterministic checks can't.
- **The critic reads text only, no game/matchupNote context** — its job is prose judgment, not fact-checking (deterministic dimensions and the existing quality chain already cover factual grounding). Keep its scope narrow and well-defined, not a second general-purpose quality chain.
- **Output must be a bounded score plus one real, specific reason** — not free-form prose. A number with no reasoning isn't independently verifiable; free-form prose with no number can't feed the composite score.
- **Cost-aware:** this adds one real LLM call per scored brief. Confirm via TASK 0 how many briefs get scored per day currently (the 10-day baseline data from tonight's earlier session gives real per-type volume) and calculate the real added cost before shipping — if this meaningfully changes daily spend, say so explicitly in the outbox rather than silently shipping it.

## TASK 2 — Verify

- `node --check src/journalism-quality.js`: clean.
- Real test: run the critic against 2-3 real, already-scored production texts pulled from D1 (a genuinely strong one, a genuinely weak one) — confirm the critic's score and reasoning are directionally sane (doesn't rate the weak one higher than the strong one) before trusting it in production.
- Confirm the additive change doesn't alter any existing dimension's score on the same real texts — before/after on the original 10 dimensions must be byte-identical.
- Confirm every real `/300` reference found in TASK 0 is either correctly updated or confirmed unaffected, not left silently stale.

## DONE CONDITION

An 11th, LLM-based critic dimension exists, scoped narrowly to prose-judgment only, additive to the existing 300-point scale with every real downstream `/300` reference checked and correctly handled. Verified against real production texts for directional sanity, not just that it runs. Real cost impact stated, not assumed negligible.

**Confidence scoring:**
- TASK 0 (20 pts): confirms no existing dimension already covers this, finds every real `/300` reference that would be affected
- TASK 1 (50 pts): single well-scoped LLM call, weakness-seeking framing (not confirmation-seeking), bounded score + real reason, real cost calculated and disclosed
- TASK 2 (30 pts): real directional-sanity test against production texts, non-regression on the original 10 dimensions confirmed, every /300 reference correctly handled

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
