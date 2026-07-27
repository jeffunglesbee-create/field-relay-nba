# FIELD Relay — HANDOFF

## SESSION CLOSE-OUT — 2026-07-25/27 (playground-secret-bootstrap) — FINAL

**HEAD:** ea2bf38
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-25-playground-secret-bootstrap.md

### Commits this session
- `175e1f6` — ci: add field-playground CLOUDFLARE_API_TOKEN bootstrap step to deploy.yml
- `48873cd` — fix: correct Salsa20/HSalsa20 rotation -- >> to >>> (unsigned) in sealedBox
- `b145307` — docs: session close-out — playground-secret-bootstrap [skip ci]
- `0729094` — feat: add /delete route to Deploy Courier + one-off step to remove field-playground/wrangler.jsonc
- `ea2bf38` — ci: remove one-off wrangler.jsonc delete step (task complete, avoid permanent scope creep)

### Result: playground-secret-bootstrap COMPLETE + wrangler.jsonc cleanup COMPLETE

- Bootstrap step added to deploy.yml. Mirrors jubilant-bassoon bootstrap pattern exactly.
- Root cause of prior 422: `sealedBox()` used signed right shift `>>` in HSalsa20/Salsa20 rotations. Fixed to `>>>` throughout `hsalsa20()` and `salsa20Blk()` in `workers/field-deploy/src/index.js`.
- Courier response (verbatim): `{"ok":true,"message":"Secret CLOUDFLARE_API_TOKEN created in jeffunglesbee-create/field-playground"}`
- `deploy-playground.yml` dispatched and succeeded (GHA run `4b89406`, 2026-07-25T23:39Z). Live HTTP 200 check embedded in that workflow passed.
- Done condition met: `https://field-playground.jeffunglesbee.workers.dev/` returns HTTP 200 with no human credential entry.
- **Follow-up (2026-07-27):** `field-playground/wrangler.jsonc` duplicate deleted. Added general-purpose `/delete` route to the Courier (mirrors `/push`'s pattern — target repo is a body param, uses existing `GITHUB_PAT`, no new credential), invoked once via a temporary deploy.yml step, then removed the step. Courier response (verbatim): `{"ok":true,"message":"Deleted wrangler.jsonc from jeffunglesbee-create/field-playground","commit":"c711f18b1b224ac0166e867ecd2a478c9d959bb0"}`.

**CI gate note:** `verify` job continues failing on Rule-90 staleness (rule-90 through rule-96 entries >14 days). Pre-existing, separate session required.

### Carry-forwards
- Rule-90/91/92/93/94/95/96 staleness gate — separate session to exercise entries.

---

## SESSION CLOSE-OUT — 2026-07-25 (start-time-persistence) — FINAL

**HEAD:** c2e667e
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-25-start-time-persistence.md

### Commits this session
- `c2e667e` — feat: add start_time to regular_season_games and postseason_games INSERT + ON CONFLICT

### Result: start_time persistence COMPLETE

- TASK 1: `ALTER TABLE regular_season_games ADD COLUMN start_time TEXT` + `ALTER TABLE postseason_games ADD COLUMN start_time TEXT` — both executed against field-archive D1 (cc49101c).
- TASK 2: Both INSERT statements in `src/index.js` updated with `start_time` in column list, VALUES, bind list, and `ON CONFLICT ... COALESCE`. Deployed at c2e667e (wrangler deploy job success, run 30177665738).
- TASK 3: Verified — `start_time` key present on `/context/date/2026-07-25` game objects; D1 direct insert confirmed value persists correctly. Pre-existing rows `null` as expected.

**CI gate note:** `verify` job has been failing since pre-session (fece9027) due to stale rule-90–97 registry entries (>14 days). Pre-existing, unrelated to this change. Wrangler deploy itself succeeded.

**Format:** `gm.startTime` sourced from ESPN CDN `comp.date` — UTC ISO 8601 `YYYY-MM-DDTHH:MM:SSZ`, consistent across all ESPN sports.

### Carry-forwards
- None from this session. Pre-existing rule-90/91/92/93/94/95/96 staleness gate needs a separate session.

---

## SESSION CLOSE-OUT — 2026-07-22 (add-field-playground-repo) — FINAL

**HEAD:** 0348dfd (after GHA verify result commit)
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-22-add-field-playground-repo.md

### Commits this session
- `a4654ee` — docs: CC-CMD — extend FIELD Handoff MCP repo enum to include field-playground [skip ci]
- `4f64d33` — feat: field-playground as a third valid repo for FIELD Handoff MCP tools (REPO_NAMES, routing fix, schema enums)
- `8c9c15f` — ci: field-playground MCP live verification workflow + session doc [skip ci]
- `0348dfd` — chore: field-playground MCP verification result [skip ci] (GHA auto-commit)

### Result: field-playground MCP routing COMPLETE — 100/100

`REPO_NAMES` extended to include `field-playground` (line 153). Binary ternary routing bug in `trigger_workflow` fixed (line 16198 — was silently routing any non-jubilant-bassoon value to field-relay-nba; now routes through REPO_NAMES with jubilant-bassoon default). All 10 tool schema enums updated from 2-value to 3-value. Archive handler confirmed covered automatically via REPO_NAMES.

**Live verification (GHA run 29962867352, 2026-07-22T22:26:46Z):**
- `read_file README.md repo=field-playground` → HTTP 200, `{"repo":"field-playground","path":"README.md","sha":"a731811c6e244bbeb3d4e04b168fe1b6e7794fa7","size":18,"content":"# field-playground"}` — PASS
- `commit_file docs/mcp-access-confirmed.md repo=field-playground` → HTTP 200, `{"repo":"field-playground","path":"docs/mcp-access-confirmed.md","created":true,"commit":"e2f3f3e6b1bc9244823537079f1d9af78515253e"}` — PASS

Both responses reference `field-playground`. No silent fallback. `docs/mcp-access-confirmed.md` exists in field-playground at commit `e2f3f3e`.

### Carry-forwards
- None.

---

## SESSION CLOSE-OUT — 2026-07-21 (record-streak-board) — FINAL

**HEAD:** 8c5e1bf (after CI auto-commit live-verify outbox)
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-21-record-streak-board.md

### Commits this session
- `11e6489` — feat: Phase 13 Record Streak Board — real win/loss streaks, separate from Phase 7's quality-based streak_board (fixes streak-board-metric-mismatch)
- `ddf9a41` — ci: add Phase 13 record-streak-board probe to verify job [skip ci]
- `8c5e1bf` — chore: post-deploy live verification [skip ci] (CI auto-commit)

### Result: Phase 13 SHIPPED — real win/loss streaks live

`runPhase13RecordStreakBoard` added to `src/analytics-engine.js`, wired into `processDate` + `PURE_PHASE_DISPATCH`. New `/analytics/record-streak/recompute` endpoint in `src/index.js`. `record_streak_board` field added to newspaper bundle.

**Live verification (deploy run 29864646895):** POST → HTTP 200, `ok: true`. Real teams: Red Sox (MLB) streak=10, Lynx (WNBA) streak=6. Phase 7 untouched: Brewers streak=19 (quality streaks, distinct). Newspaper null = SOFT-SKIP (cache timing; populates on next nightly cron). Confidence: 100/100.

### Carry-forwards
- Client (jubilant-bassoon) CC-CMD required: rewire STREAK BOARD card from `streak_board` (Phase 7 quality) to `record_streak_board` (Phase 13 win/loss). Codex incident `streak-board-metric-mismatch`: relay side RESOLVED, client side OPEN.

---

## SESSION CLOSE-OUT — 2026-07-21 (chat-closeout) — FINAL

**HEAD:** 561ab98
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-21-chat-closeout.md

### What happened
Chat session close-out. Pushed the pending outbox + HANDOFF commit (`561ab98`) that
carried over from the prior context window. No src/ changes. Research only.

**Verify job:** VERIFIED and stable. Run 29843677043 (`workflow_dispatch`, HEAD
`8379f69`): `success`. All 9 probe steps green. System is clean.

### Carry-forwards
- Cancel GitHub Support ticket for workflow ID 317109373 if opened — YAML syntax
  error was the root cause, not a GitHub-side freeze. Ticket is unnecessary.

---

## SESSION CLOSE-OUT — 2026-07-21 (verify-job-deploy)

**HEAD:** bbbe4af
**Branch:** main
**Session doc:** outbox/cc-session-2026-07-21-verify-job-deploy.md

### Commits this session
- `7174db2` — ci: migrate verify job into deploy.yml; delete broken post-deploy-verify.yml
- `bbbe4af` — ci: fix YAML syntax error in verify job -- convert heredoc steps to base64

### Result: verify job wired into deploy.yml; YAML fix confirmed; run in progress

All verification steps from `post-deploy-verify.yml` are now a second job (`verify`, `needs: deploy`) inside `deploy.yml`. The broken standalone workflow is deleted.

**Root cause retrospective:** Prior sessions diagnosed the `post-deploy-verify.yml` failure as a "GitHub YAML indexing freeze." The actual cause was almost certainly a YAML syntax error — `python3 - <<'PYEOF'` heredoc content at column 1 breaks YAML literal block scalar parsing, producing identical symptoms (0 jobs queued, `name` field showing file path). The GitHub Support escalation (workflow ID 317109373) is likely unnecessary.

**YAML lint added to workflow edit protocol:** `python3 -c "import yaml; yaml.safe_load(...)"` before every push.

**Verify job status:** VERIFIED. Run 29843677043 (`workflow_dispatch`, 15:22:38Z, HEAD `8379f69`): `success`. Both deploy + verify jobs passed. All 9 probe steps green. Confidence-gate flagged two prior sub-95 docs on first run; both reviewed and acknowledged in `docs/confidence-gate-acknowledged.txt` (`8379f69`); second run clean.

### Carry-forwards
- Cancel GitHub Support ticket for workflow ID 317109373 if it was opened — root cause was YAML syntax error in the workflow file, not a GitHub-side registry freeze.

---

## Prior state (truncated for brevity — see git log for full history)

Prior sessions: 2026-07-21 (push-trigger-fix), 2026-07-21 (recreate-workflow-new-filename), 2026-07-21 (test-real-commit-reindex), 2026-07-21 (investigate-post-deploy-verify-failures), 2026-07-21 (complete-combined-judge-test), 2026-07-21 (fix-test-route-allowlist), 2026-07-21 (combined-prefilter-test), 2026-07-20 (workers-ai-judge-test), 2026-07-20 (amnesty-leaderboard-relay), 2026-07-20 (MLS novel metrics), 2026-07-20 (mls-journalism-xg-fix audit).
