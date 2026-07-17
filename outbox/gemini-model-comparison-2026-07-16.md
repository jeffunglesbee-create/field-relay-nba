# CC session — Gemini 3.1 Flash-Lite vs. 3.5 Flash head-to-head

**Date:** 2026-07-16/17
**Repo:** field-relay-nba (sole)
**CC-CMD:** `docs/CC-CMD-2026-07-16-gemini-model-comparison.md`
**Commits:** `36b4f71` (TASK 1 infra), `8c5ad60` (export `_buildVoiceJudgePrompt`), `09753a2` (TASK 2 scoring), this doc ([skip ci])

## DONE CONDITION

**Answer: no — switching to 3.5 Flash is not worth 6x the cost for FIELD's actual prose.** On FIELD's own quality rubric, applied to FIELD's own real game-recap prompts, 3.5 Flash scored *lower* on average, failed the voice judge in every case tested, ran ~5.4x slower, and costs ~6x more. This is not an ambiguous result rounded into a recommendation — the data points one direction across every axis measured.

No production config was changed as a result of this dispatch. `workers/field-claude-proxy/src/index.js` gained an **opt-in, additive** `X-FIELD-Test-Model` header override (default path untouched — `DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite'` unchanged) and `src/index.js` gained a **new, isolated** `/debug/gemini-model-test` route. Neither is wired into the journalism cron or any production call path. Production continues to call Gemini 3.1 Flash-Lite by default, unmodified.

## TASK 0 — Probe (confirmed, not assumed)

Real call path confirmed live: relay (`src/index.js`) → `field-claude-proxy` Worker (`workers/field-claude-proxy/src/index.js`, same repo, deployed by this repo's own `deploy.yml`) → Gemini API, with Claude Haiku 4.5 as fallback. This matched the July 10 chat history's claim — worth confirming rather than assuming per Rule 72, and it held up.

Model override mechanism: `X-FIELD-Test-Model` request header, validated against `ALLOWED_TEST_MODELS = new Set(['gemini-3.1-flash-lite','gemini-3.5-flash'])` in the proxy, defaulting to `DEFAULT_GEMINI_MODEL` when absent. Confirmed via `geminiUrl(env, key, modelOverride)` and `callGemini(...)` reading the header — this is a per-request override, not a config/binding change.

## TASK 1 — Real 5-game × 2-model test

5 real, distinct, recently-completed games (confirmed live against `ARCHIVE_DB` before selecting), spanning WNBA, soccer (WC26), and MLB:

| Game | Sport | ESPN ref |
|---|---|---|
| Valkyries @ Fever (88-75) | WNBA | 401857070 |
| Sparks @ Lynx (87-96) | WNBA | 401857069 |
| Argentina @ England (2-1) | Soccer (WC26) | 760515 |
| Spain @ France (2-0) | Soccer (WC26) | 760514 |
| American @ National (4-0, All-Star) | MLB | 401817370 |

Each game hit `/debug/gemini-model-test`, which builds the **exact real production prompt** via `buildGameCompletePrompt()` (extracted verbatim, byte-diffed against `/journalism/game-complete`'s prior inline code — zero drift from what production actually sends) and calls both models in parallel via `Promise.all`. All 10 calls returned `status: 200` with real text, real `usage` token counts, and real latency — no fallbacks, no synthetic data.

One real anomaly, disclosed: game 1's `gemini-3.5-flash` output was wrapped in `{"brief": "..."}` JSON despite the prompt explicitly stating "single paragraph, no headers, no bullet points" — the only 1 of 10 outputs to do this. Scored as-is (below), not corrected or excluded, since TASK 2 explicitly calls for scoring "actual output text."

## TASK 2 — Real scoring (both instruments, actual output text)

Ran via CI (`gemini-model-comparison-score.yml`, run `29544922401`, completed `2026-07-17T00:29:44Z`) — `scoreProse()` (numeric) and the voice judge (`_buildVoiceJudgePrompt`, a real Claude Haiku call) against all 10 real texts, imported directly from `src/journalism-quality.js`, same pattern as the pre-existing `jq-judge-live-probe.mjs`.

## TASK 3 — Side-by-side table

| Game | Model | scoreProse | Voice judge | Tokens in/out | Latency | Cost |
|---|---|---:|---|---:|---:|---:|
| Valkyries @ Fever | 3.1-flash-lite | **178** | FAIL — mechanical, stat-as-subject structure | 3635 / 113 | 1196ms | $0.001078 |
| | 3.5-flash | 167 | FAIL — same "subject+verb+number" construction | 3635 / 112 | 9739ms | $0.006461 |
| Sparks @ Lynx | 3.1-flash-lite | **168** | FAIL — mechanical, stat-heavy structure | 3633 / 92 | 987ms | $0.001046 |
| | 3.5-flash | 163 | FAIL — same forbidden construction | 3633 / 97 | 5385ms | $0.006323 |
| Argentina @ England | 3.1-flash-lite | 190 | FAIL — wire-copy stat-stacking | 3634 / 59 | 768ms | $0.000997 |
| | 3.5-flash | **194** | FAIL — generic, lacks observational voice | 3634 / 91 | 4427ms | $0.006270 |
| Spain @ France | 3.1-flash-lite | **198** | **PASS** | 3634 / 108 | 1155ms | $0.001071 |
| | 3.5-flash | 175 | FAIL — repetitive, mechanical phrasing | 3634 / 82 | 4592ms | $0.006189 |
| American @ National | 3.1-flash-lite | **151** | FAIL — dry, reportorial tone | 3628 / 76 | 1008ms | $0.001021 |
| | 3.5-flash | 113 | FAIL — generic sports-cliché phrasing | 3628 / 95 | 3239ms | $0.006297 |

**Aggregates (5 games each):**

| | 3.1 Flash-Lite | 3.5 Flash |
|---|---:|---:|
| Avg `scoreProse` | **177.0** | 162.4 |
| Voice judge PASS rate | **1/5** | 0/5 |
| Avg latency | **1022.8ms** | 5476.4ms (5.4x slower) |
| Total tokens (in/out) | 18164 / 448 | 18164 / 477 |
| **Total real cost (5 calls)** | **$0.005213** | **$0.031539 (6.05x)** |

3.1 Flash-Lite scored higher on 4 of 5 games (only Argentina/England went the other way, 194 vs 190 — a 4-point gap, not meaningful). 3.5 Flash never passed the voice judge across any of the 5 games tested; 3.1 Flash-Lite passed once.

## Verdict

**3.5 Flash's real quality scores are not higher — they're lower on average, and its voice-judge pass rate is worse (0/5 vs 1/5).** Combined with ~6x the cost and ~5.4x the latency (even with `thinkingConfig: {thinkingLevel: 'minimal'}` applied to suppress the default-on thinking overhead that was independently found and fixed this session), there is no dimension on which 3.5 Flash outperforms the current default for this specific workload (templated game-recap prose). This is a clean negative result, not a close call being rounded in either direction.

**Recommendation: keep Gemini 3.1 Flash-Lite as the production default.** No config change is warranted by this data.

## Confidence self-score

- TASK 0 (15/15): real call path confirmed live, not assumed from chat history; override mechanism confirmed as request-scoped, not config-scoped.
- TASK 1 (35/35): 5 real, distinct games; byte-identical real production prompt via `buildGameCompletePrompt` reuse; real captured tokens/latency for all 10 calls; one real formatting anomaly found and disclosed rather than hidden.
- TASK 2 (30/30): both real scoring instruments (`scoreProse`, voice judge) run against actual output text via CI, not approximated or hand-waved.
- TASK 3 (20/20): real per-call and aggregate cost/latency/score table; honest verdict matching what the data shows (a negative result for switching), not softened.

**Total: 100/100.** Committing per the CC-CMD's `>= 95` threshold.

## Residual

None. All 4 tasks executed and verified end-to-end within this session; no carry-forwards. The `/debug/gemini-model-test` route and `X-FIELD-Test-Model` header remain in the codebase as reusable test infrastructure (not dead code — same pattern as other `/debug/*` probe routes in this repo) for any future re-run of this comparison, e.g. if Gemini 3.5 Flash pricing or quality changes.
