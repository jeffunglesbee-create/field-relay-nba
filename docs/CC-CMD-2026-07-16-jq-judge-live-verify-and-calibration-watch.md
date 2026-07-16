# Claude Code Command — Live-verify the voice judge against a real LLM; watch quality-calibration transition

**Date:** 2026-07-16
**Repo:** field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git pull; git log --oneline -5.

Write findings to outbox/jq-judge-live-verify-and-calibration-watch-2026-07-16.md.

## CONTEXT

`CC-CMD-2026-07-16-journalism-quality-gate-redesign` shipped `scoreProse`'s Dim1/Dim2/Dim4 fix and `runQualityChain`'s qualitative voice-judge replacement for the old numeric 3b retry-accept gate (commit `6aed3bb`, deployed, confirmed live). Scored 92/100 (`outbox/journalism-quality-gate-redesign-2026-07-16.md`) — below the 95 commit threshold, but shipped per this session's established precedent (the fix is correct, fail-safe by design, and thoroughly tested by every method available in-session; the residual gaps are live-verification and monitoring gaps, not correctness gaps). Two real, disclosed gaps carried forward here:

1. **The judge's real-LLM behavior was never proven.** All verification of the judge logic (`_buildVoiceJudgePrompt`, the FAIL→retry→re-judge→accept/reject flow in `runQualityChain`'s 3b block) used a mocked `callProxy`. The sandbox that dispatch ran in blocks direct `fetch`/`curl` to both `field-claude-proxy.jeffunglesbee.workers.dev` and `field-relay-nba.jeffunglesbee.workers.dev` (confirmed via the agent-proxy status endpoint's `recentRelayFailures` log). `probe_relay_route` (the tool that bypasses this block) is GET-only against a hardcoded relay-side allow-list, and none of the write-triggering routes that invoke `runQualityChain` (`/journalism/run`, `/journalism/game-complete`, the queue consumer) are GET or on that allow-list. Real question, unanswered: does the real proxy model (Gemini 3.1 Flash-Lite primary, Claude Haiku 4.5 fallback per this repo's journalism model) reliably respond to the judge prompt with the exact `PASS` / `FAIL: <reason>` format requested? If not, the judge silently degrades to always-PASS (fail-safe, not fail-crash — confirmed by design) but that means the gate would be quietly inert rather than actually gating.
2. **Calibration-transition side effect, found via live D1 data during the same dispatch, not yet monitored.** `/quality/report`'s `brief_type_calibration` percentiles are computed from a rolling 30-day window of stored `quality_score` values. Re-scoring 4 real recent production briefs with the fixed formula showed drops of 26-137 points versus their currently-stored (old-formula) scores. Post-deploy, new-formula scores will compare unfavorably against a stale, old-formula-dominated baseline until enough new data accumulates — likely producing elevated or false `high_failure_rate` alerts in `/quality/report`'s `alerts` array for a transitional period. The system is self-correcting by design (rolling window, live-recomputed per call) — this dispatch is about confirming that it actually does self-correct as expected, not about writing new code.

## TASK 1 — Live-verify the judge against a real LLM

Confirm at the start whether this session's sandbox can reach `field-claude-proxy.jeffunglesbee.workers.dev` or `field-relay-nba.jeffunglesbee.workers.dev` directly (`curl -sS "$HTTPS_PROXY/__agentproxy/status"`, check `recentRelayFailures` for either host, or attempt a direct request and observe the result). If direct egress is now available: call `runQualityChain` locally (mirroring `/tmp/.../test-voice-judge-live.mjs` from the prior dispatch, recreate if needed) against a real wire-copy-shaped synthetic draft using the real `callProxy` pattern from any of the 10 real call sites in `src/index.js`, and confirm a real `PASS` or `FAIL: <reason>` verdict comes back in the expected shape. If direct egress is still blocked, check whether `probe_relay_route`'s allow-list has changed or whether any other available tool can trigger a live `runQualityChain` invocation server-side (e.g. `/journalism/run` via a tool that supports POST with the `X-FIELD-Relay` header, if one has become available) — do not fabricate a workaround that bypasses the sandbox's network policy.

If a live call is obtained: additionally confirm at least 3 real judge responses to sample the model's actual format-following reliability (a single PASS/FAIL response proves the mechanism CAN work, not that it reliably does — sample size matters here since a qualitative gate that only sometimes parses correctly is a real, different problem than one that never does).

If still blocked after checking: wait for the next natural journalism cron cycle (every 15 min) to generate real briefs through the deployed judge, then query D1 (`ARCHIVE_DB`, `ensureBriefsTable`'s `briefs` table) for recently-created rows and cross-reference against what the judge would plausibly have done — this doesn't directly prove the judge's PASS/FAIL parsing, but confirms the pipeline as a whole is still producing viable briefs post-deploy (a weaker, but real, live signal) and should be documented as such, not conflated with the stronger direct-judge-call proof.

## TASK 2 — Calibration transition watch

Query `/quality/report?days=1` (and `?days=7` for a wider window) via `probe_relay_route`, comparing against the two baselines already captured in `outbox/journalism-quality-gate-redesign-2026-07-16.md` (pre-deploy and immediately-post-deploy, both showing `alert_count: 2`). Confirm:
1. Whether `alert_count` has increased (expected, transitional) since the fix went live and new-formula-scored briefs have started accumulating.
2. Whether the `brief_type_calibration` percentiles for high-volume types (`game_recap` n=726, `night_owl` n=400, `mlb_game` n=325 as of the prior dispatch) are visibly trending downward as fresh new-formula scores enter the 30-day window.
3. Whether `alert_count` and the visible percentile trend are consistent with genuine self-correction (percentiles falling roughly in step with the new average, alerts settling rather than growing unboundedly) — document with real numbers, not a prediction.

If self-correction is NOT visibly happening after a reasonable real-data sample (e.g. `alert_count` climbing rather than stabilizing, or percentiles frozen despite new scores flowing in), investigate why before proposing any code change — this dispatch does not pre-authorize modifying `/quality/report`'s calibration or alerting logic; if a fix turns out to be needed, scope it as a third CC-CMD rather than freelancing it here (Rule 87 applies recursively — no unscoped work, even to fix a problem this same lineage of dispatches found).

## DONE CONDITION

TASK 1: either a real, live PASS/FAIL verdict obtained directly from the real proxy (strong proof), or an honest, specific disclosure of exactly what remains blocked and why (same disclosure discipline as the parent dispatch — not a third inconclusive report). TASK 2: real `/quality/report` data confirming the calibration transition is behaving as the self-correcting design predicts, or a specific, evidenced description of how it is not, without freelancing a fix.

**Confidence scoring:**
- TASK 1 (55 pts): real live judge verdict obtained and its format-reliability sampled (3+ real calls), OR a fully honest disclosure of the specific, still-current blocker with no fabricated workaround
- TASK 2 (45 pts): real `/quality/report` data compared against the two documented baselines, with a clear, evidenced conclusion about whether calibration is self-correcting as designed

Do not commit unless confidence >= 95 AND this dispatch produces a code change (if it's pure verification/monitoring with no code change needed, write the outbox and stop — no commit required for a clean read-only result). If score < 95 and a code change was made, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
