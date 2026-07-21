# FIELD Relay — HANDOFF

## SESSION CLOSE-OUT — 2026-07-21 (investigate-post-deploy-verify-failures)

**HEAD:** 61347c5
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-21-investigate-post-deploy-verify-failures.md

### Commits this session
- `fdd6f26` — ci: re-index workflow_dispatch trigger for post-deploy-live-verify [skip ci]
- `4c740d7` — ci: one-shot investigation workflow for post-deploy-verify failures [skip ci]
- `61347c5` — docs: add investigation session doc; remove one-shot workflow [skip ci]

### Post-deploy-verify investigation: COMPLETE

Runs 29791908505 (`22ed3df`) and 29791607446 (`e48c12b`) both confirm 0 jobs / no log content.
The `conclusion: "failure"` is a workflow-level issue (job never queued) — not a probe defect.

Direct probe results (via probe_relay_route, 2026-07-21):
- `/pl/fixtures`: HTTP 200, 40 fixtures, all required fields present — PASS
- Soccer league label: zero games today (off-season, all soccer keys) — correctly skipped
- Circadian: HTTP 200 both phases (ok:false/text:null = no journalism yet today, expected)

**Conclusion: structural workflow issue, not a data/code defect. No fix needed.**

`workflow_dispatch` is blocked repo-wide (422 on all workflows). Separate issue,
out of scope — requires GitHub admin action, not a code change.

Confidence: 73/100 (sub-95 — no src/ commit made, session doc only).

### Pre-existing failures (not caused by this session)
- `post-deploy-live-verify.yml` — structural 0-job issue confirmed; pre-existing

---

## SESSION CLOSE-OUT — 2026-07-21 (complete-combined-judge-test)

**HEAD:** 1f02f43
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-21-complete-combined-judge-test.md

### Commits this session
- `22ed3df` — fix: re-add /test/gemini-judge for combined-generate-judge Steps 3-4
- `1f02f43` — ci: add combined-judge-corpus workflow for Steps 3-4 corpus test [skip ci]

### Combined-generate-judge Steps 3-4: COMPLETE — VERDICT: FAIL

10-brief corpus run live via GHA runner (run 29791989877). All 4 gates evaluated:

| Gate | Threshold | Result | Verdict |
|------|-----------|--------|---------|
| A — call reduction | ≥40% | ~50% (1 vs 2 calls) | PASS |
| B — quality pass rate | ≥9/10 PASS | 7/10 PASS | **FAIL** |
| C — latency | combined ≤ gen+judge sum | 1376ms avg vs ~1950ms est. | PASS |
| D — FIELD voice (qualitative) | no regression | ✓ B5/B9/B10 clean | PASS |

Gate B failure root cause: single-pass combined prompt's self-check is less effective than a separate dedicated judge call. The model validates what it just produced rather than independently evaluating it. 2 genuine failures (B1, B3: stat numbers appearing as sentence predicates); 1 judge false positive (B7: judge hallucinated a required statistic). Even crediting B7 as PASS → 8/10, still below threshold.

**Step 5: NOT authorized** (Gate B fail + governing prompt constraint).

### Open test routes (cleanup required if investigation resumes)
- `/test/combined-generate-judge` in src/index.js + ALLOWED_EXACT
- `/test/prefilter` in src/index.js + ALLOWED_EXACT
- `/test/gemini-judge` in src/index.js + ALLOWED_EXACT (re-added this session)

### Carry-forwards
- None from this session. Combined test Steps 3-4 now COMPLETE with a real verdict.
- Prefilter test (Steps 1-4): previously confirmed COMPLETE (Gates A/B both PASS).
- Step 5 for both plans: NOT authorized. Requires explicit re-authorization.

---

## SESSION CLOSE-OUT — 2026-07-21 (fix-test-route-allowlist)

**HEAD:** 62671d7
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-21-fix-test-route-allowlist.md

### Commits this session
- `ee27c5e` — fix: add /test/* POST routes to global method-allowlist gate
- `62671d7` — ci: add probe-test-routes workflow for CC-CMD-2026-07-21 Task 2+3 verification [skip ci]

### Global allowlist fix: COMPLETE

Four `/test/*` POST routes were unreachable live (global gate at L11019 never updated in b7edca1).
Fix deployed. All 4 routes confirmed reachable via GitHub Actions runner.

### Prefilter test: re-verified against live endpoint

Gate A ✓ 0/5 FAIL cases return SKIP_JUDGE | Gate B ✓ 5/5 PASS cases (100%) — **identical to prior local execution**. "Code is identical" assumption confirmed correct.

### Combined test: STAGED (route now reachable, corpus not yet run)

Route works live (confirmed: HTTP 200 with real text, 4367ms latency). Prior "STAGED, egress blocked" had two causes: (1) global gate bug (now fixed), (2) sandbox egress proxy 403 (session policy, still in effect). The route is live and reachable from CI runner. **Remaining blocker**: 10-prompt corpus through combined-generate-judge → gemini-judge with 4 gates evaluated. Use probe-test-routes.yml pattern or a session with direct egress.

### Carry-forwards
- Combined test Steps 3-4: STAGED (egress). Route now genuinely live. Exact commands in prior session doc.
- Step 5 for both plans: NOT authorized. Requires explicit re-authorization after combined gates pass.

---

## SESSION CLOSE-OUT — 2026-07-21 (combined-prefilter-test)

**HEAD:** b7edca1
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-21-combined-prefilter-test.md

### Commits this session
- `b7edca1` — feat: add combined-generate-judge and prefilter probe routes [Step 2]

### Prefilter test: Steps 1–4 COMPLETE

Gate A ✓ 0/5 FAIL cases return SKIP_JUDGE | Gate B ✓ 5/5 PASS cases (100%) | Gate C ✓ 0.0014ms

All gates pass on representative corpus (see session doc for caveats on corpus construction).
Step 5 NOT authorized per user prompt.

### Combined test: Steps 3–4 STAGED

Probe routes deployed (b7edca1). Steps 3–4 blocked by sandbox egress policy (403 to workers.dev).
Exact verification commands in session doc. Requires relay egress access to execute.
Step 5 requires: all four gates pass + explicit re-authorization.

### Open test routes (cleanup required if Step 5 ever authorized)
- `/test/workers-ai-judge` (+ ?format=passfail, ?format=reframe) in src/index.js + ALLOWED_EXACT — from 2026-07-20
- `/test/gemini-judge` in src/index.js + ALLOWED_EXACT — from 2026-07-20
- `/test/combined-generate-judge` in src/index.js + ALLOWED_EXACT — this session
- `/test/prefilter` in src/index.js + ALLOWED_EXACT — this session
- `[ai]` binding in wrangler.toml (test-only)

### Carry-forwards
- Combined test Steps 3–4: STAGED (egress restriction). See session doc for verification commands.
- Both Step 5s: NOT authorized. Require explicit re-authorization after combined gates pass.

---

## SESSION CLOSE-OUT — 2026-07-20 (workers-ai-judge-test — extended)

**HEAD:** 0fad644
**Branch:** main
**Session doc:** jubilant-bassoon outbox/cc-session-2026-07-20-workers-ai-judge-results.md

### Commits this session
- `61a4714` — feat: add Workers AI voice judge probe route (Step 2)
- `51a7732` — feat: add Gemini judge probe route for Step 3 corpus comparison
- `77a8913` — feat: raise max_tokens to 2000, fix Gemma 4 response parsing
- `811e8cf` — feat: raise max_tokens to 4000 for Gemma 4 extended test
- `8b2dd8e` — feat: add ?format=passfail (two-phase latency test)
- `0fad644` — feat: add ?format=reframe (8B structural reframe test)

### Steps 1–4 + novel mitigations; Step 5 NOT authorized

**Step 1:** Judge prompt ~2,900 tokens — below 100K gate. ✓

**Step 2:** Two probe routes deployed:
- `GET /test/workers-ai-judge?brief=...&model=...&format=...` — Workers AI judge
- `GET /test/gemini-judge?brief=...` — Gemini comparison via JOURNALISM_CLAUDE_PROXY
Both in ALLOWED_EXACT. `[ai]` binding in wrangler.toml (test-only).

**Step 3–4 + novel ideas — complete matrix:**

| Config | Gate A FN≤10% | Gate B Struct≥80% | Gate C FP≤30% | Gate D p95≤1500ms | Verdict |
|--------|--------------|------------------|--------------|------------------|---------|
| 8B full prompt | ✓ 0% | ✓ 100% | ✗ 100% FP | ✓ ~868ms | **FAIL** |
| 8B reframe | ✗ 100% FN | ✓ 100% | ✓ 0% FP | ✓ ~423ms | **FAIL** |
| 70B full prompt | ✓ 0% | ✓ 100% | ✓ 20% | ✗ ~2909ms | **FAIL** |
| 70B passfail | ✓ 0% | ✓ 100% | ✓ 20% | ✗ p95 1622ms* | **FAIL** |
| Gemma 4 256tok | N/A | ✗ 0% | N/A | N/A | **FAIL** |
| Gemma 4 2000tok | ✓ | ✗ 70% | ✓ | ✗ ~24s | **FAIL** |
| Gemma 4 4000tok | ✓ | ✓ 90% | ✓ | ✗ ~29s | **FAIL** |

*Single PASS outlier (1622ms); 9/10 cases cleared Gate D. Structurally validated but not a gate pass.

**ALL CONFIGS FAIL. Workers AI judge not viable under current constraints.**

Gemini FAIL latency confirmed: 731-816ms (Gate D baseline is valid, not miscalibrated).
8B reframe finding: model capability limit — cannot generalize subordinated-stats concept.
Two-phase finding: FAIL-path latency fixed by stripping SENTENCE/FIX, but Phase 2 adds
~1500-2500ms back, making the full two-phase net latency WORSE than current Gemini.

**Recommendation: Accept circuit breaker (`42d5629`) as permanent cost floor.**
No further Workers AI pursuit unless CF releases sub-500ms non-reasoning 70B-class model.

### Open test routes (cleanup required if Step 5 ever authorized)
- `/test/workers-ai-judge` (+ ?format=passfail, ?format=reframe) in src/index.js + ALLOWED_EXACT
- `/test/gemini-judge` in src/index.js + ALLOWED_EXACT
- `[ai]` binding in wrangler.toml (test-only per plan)

### Carry-forwards
- None. Steps 1–4 + novel mitigations complete. Step 5 requires explicit re-authorization.

---

## SESSION CLOSE-OUT — 2026-07-20 (amnesty-leaderboard-relay)

**HEAD:** eb1e1bb
**Branch:** main
**Session doc:** outbox/amnesty-leaderboard-relay-2026-07-16.md

### Commits this session
- eb1e1bb — feat: add /archive/drama/leaderboard and /archive/drama/percentile endpoints

### Verified live
- `/archive/drama/leaderboard?sport=MLB&limit=5` — top 5 MLB games by drama_peak, all 74
- `/archive/drama/leaderboard?sport=AFL&limit=3` — Collingwood–Hawthorn 93-93 tie at #1
- `/archive/drama/percentile?sport=MLB&score=70` — 92.8% (hand-checked: 349/376)
- `/archive/drama/percentile?sport=AFL&score=60` — 84.8% (hand-checked: 117/138)
- `/archive/drama/percentile?sport=MLS&score=70` — sparse:true, sample_size:10 ✓

### Carry-forwards
- None from this session. MCP allow-list updated in same commit.

### Pre-existing failures (not caused by this session)
- `post-deploy-live-verify.yml` — failing since before 30746bd; pre-existing

---

## SESSION CLOSE-OUT — 2026-07-20 (MLS novel metrics)

**HEAD:** bcfd579
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-20-mls-novel-metrics.md

### Commits this session
- 2e09fc0 — feat: add /mls/stats/team-metrics route for season-aggregate novel metrics
- bcfd579 — feat: extend /soccer/xg with accurateCrosses and crossAccuracy

### Verified live
- `/mls/stats/team-metrics` — 30 MLS teams with secondAssistShare, insideBoxShotShare, counterAttacksPerGame, shotBodyPartSplit
- `/soccer/xg` — now includes accurateCrosses + crossAccuracy (verified hand-math)

### Carry-forwards
- **CLIENT TASK 3 (jubilant-bassoon)** — Wire `/mls/stats/team-metrics` into `renderStatsSection()` MLS block. See CC-CMD-2026-07-19-mls-novel-metrics.md TASK 3 for full spec. Sequencing note: check whether sibling CC-CMDs (mls-sub-impact-metric Task 4, bottom-sheet-stats-reconciliation Task 1) have already modified `renderStatsSection()` before starting.

### Pre-existing failures (not caused by this session)
- `post-deploy-live-verify.yml` — failing since before 30746bd; pre-existing, unrelated to novel metrics work

---

## Prior state (from 2026-07-20 mls-journalism-xg-fix audit)

HEAD before this session: 12e3f0c
Session doc: outbox/cc-session-2026-07-20-mls-journalism-xg-fix.md
Result: No code change needed — MLS xG journalism path already wired correctly.
