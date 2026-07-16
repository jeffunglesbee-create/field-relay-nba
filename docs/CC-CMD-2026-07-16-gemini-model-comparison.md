# Claude Code Command — Head-to-head test: Gemini 3.1 Flash-Lite vs. 3.5 Flash

**Date:** 2026-07-16
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git pull; git log --oneline -5.

Write findings to outbox/gemini-model-comparison-2026-07-16.md. This is a real, bounded experiment, not a model switch — commit with `[skip ci]`, no deploy needed unless explicitly asked afterward.

## CONTEXT

Real, confirmed pricing (chat-verified against multiple current sources): Gemini 3.1 Flash-Lite (FIELD's current model) is $0.25/$1.50 per MTok in/out. Gemini 3.5 Flash is $1.50/$9.00 — 6x more on both sides, not a minor version bump, a full tier change. Before considering any switch, get a real, apples-to-apples answer on whether 3.5 Flash's output is meaningfully better for FIELD's actual workload (templated game-recap prose), not just its published benchmarks (which skew toward coding/agentic tasks, not necessarily narrative sports writing).

**Reuse, don't rebuild:** the journalism-quality-gate-redesign work from earlier tonight (`6aed3bb`) already built a real, working qualitative voice judge (`_buildVoiceJudgePrompt` in `src/journalism-quality.js`) plus the corrected `scoreProse` numeric rubric. Both exist specifically to answer "is this prose actually good by FIELD's own standard" — use them as the real comparison instrument instead of inventing a new evaluation method.

## TASK 0 — Probe

Confirm the real, current proxy/call path for Gemini requests (`field-claude-proxy` or wherever the real Gemini call currently lives — the July 10 chat history mentions this may have moved; confirm current reality, don't assume). Confirm how to specify a different model string in that same call path without touching the production default (an explicit parameter override for this test only, not a config change).

## TASK 1 — Run the real, bounded test

Select 5 real, distinct recent games already covered by the current pipeline (a mix of brief_types if reasonably available — game_recap, night_owl — real variety, not 5 near-identical cases). For each: build the exact same real prompt/context FIELD already sends for that game (reuse the real prompt-construction code, don't approximate it), and send it to both `gemini-3.1-flash-lite` and `gemini-3.5-flash`, capturing full response, real token counts, and real latency for both.

**Keep this bounded** — 5 games × 2 models = 10 real API calls, not a large-scale test. This is enough for a real signal without meaningfully affecting the day's Gemini spend.

## TASK 2 — Score both outputs on the same real rubric

Run every one of the 10 real outputs through both `scoreProse` (numeric) and the voice judge (qualitative pass/fail) — the same evaluation FIELD already applies to real production briefs. Do not hand-wave a comparison; use the actual scoring functions on actual output text.

## TASK 3 — Report

Real, side-by-side table: per game, per model — `scoreProse` total, voice judge verdict, real token counts (in/out), real latency, and real computed cost for that specific call (using the confirmed per-token rates). Sum real total cost across all 10 calls for both models. State plainly whether 3.5 Flash's real quality scores are meaningfully higher, roughly equivalent, or not distinguishable from 3.1 Flash-Lite for this specific workload — don't round up an ambiguous result into a recommendation either direction if the data doesn't support one.

## DONE CONDITION

A real, evidence-based answer to "is switching to 3.5 Flash worth 6x the cost for FIELD's actual prose" — grounded in FIELD's own quality rubric applied to FIELD's own real prompts, not published third-party benchmarks. No production config changed as a result of this dispatch alone.

**Confidence scoring:**
- TASK 0 (15 pts): confirms the real current call path, doesn't assume it matches old chat history
- TASK 1 (35 pts): 5 real games, real identical prompts to both models, real captured tokens/latency
- TASK 2 (30 pts): both real scoring instruments actually run against actual output, not approximated
- TASK 3 (20 pts): honest verdict matching what the data actually shows, real total cost comparison

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
