# CC Session Doc — 2026-07-21 — verify-job-deploy

## HEAD Progression

| Commit | Message |
|--------|---------|
| 7174db2 | ci: migrate verify job into deploy.yml; delete broken post-deploy-verify.yml |
| bbbe4af | ci: fix YAML syntax error in verify job -- convert heredoc steps to base64 |

## What Was Built

**Goal:** Bypass the permanent failure of `post-deploy-verify.yml` (workflow ID 317109373) by porting all verification steps into `deploy.yml` as a second job (`verify`) with `needs: deploy`. `deploy.yml` (ID 278094868) is already indexed and functional.

**7174db2 — migrate verify job + delete broken workflow**

- Added `verify:` job to `deploy.yml` with `needs: deploy`, `permissions: contents: write`, `fetch-depth: 25`
- Ported all 9 probe steps from `post-deploy-verify.yml`: circadian endpoint checks, /context/game brief bridge, bracketDelta, confidence-gate scan, rule registry check, rule 90 staleness, completion field parity, went-to-OT invariant, /pl/fixtures smoke
- Deleted `post-deploy-verify.yml` (now superseded; frozen workflow ID no longer referenced)
- `Commit results` step uses `git push` with `[skip ci]` to avoid re-triggering deploy

**bbbe4af — fix YAML syntax error**

Root cause: two steps used `python3 - <<'PYEOF'` with Python content at column 1. In a YAML literal block scalar (`run: |`), content at column 0 exits the block — GitHub saw it as a parse error and queued 0 jobs (same symptom as the prior "indexing freeze" diagnosis).

Fixed by converting both offending steps to the base64-decode pattern already used by other steps:
- `bracketDelta end-to-end probe` → `echo "<b64>" | base64 -d > /tmp/bracket_delta_probe.py && python3 /tmp/bracket_delta_probe.py`
- `/pl/fixtures route smoke` → `echo "<b64>" | base64 -d > /tmp/pl_fixtures_smoke.py && python3 /tmp/pl_fixtures_smoke.py`

YAML validated locally with `python3 -c "import yaml; yaml.safe_load(...)"` before push.

## Root Cause Retrospective

The prior sessions' "GitHub YAML indexing freeze" diagnosis for `post-deploy-verify.yml` was likely wrong. The symptom (0 jobs queued, workflow `name` field showing file path instead of YAML `name:` value) is identical to what GitHub shows when it encounters a YAML parse error. `post-deploy-verify.yml` had the same `python3 - <<'PYEOF'` heredoc pattern. A `yaml.safe_load` lint before any commit would have caught it immediately.

**Rule 66 violation (self-caused):** deploy.yml was pushed with a YAML syntax error without local lint. Fixed in the same session.

**Rule 77 note:** CI showed 0 jobs on the first `7174db2` run. Correct response was to lint the YAML first — not reach for job logs or API calls. The YAML error was the most likely cause and the cheapest to check.

## Integration Status

VERIFIED — Run 29843677043 (`workflow_dispatch`, 2026-07-21T15:22:38Z, HEAD `8379f69`): `success`. Both jobs queued and passed:
- `deploy` job: completed
- `verify` job: all 9 probe steps passed (circadian, /context/game brief bridge, bracketDelta, confidence-gate, rule registry, rule 90 staleness, completion field parity, went-to-OT invariant, /pl/fixtures smoke)

**Confidence-gate step detail:** Two prior session docs (73/100 and 90/100) flagged on first run. Both reviewed and acknowledged in `docs/confidence-gate-acknowledged.txt` (commit `8379f69`) — structural ceilings, not code defects, no src/ commits in either session. Gate cleared on second run.

## Open Carry-Forwards

- If `post-deploy-verify.yml` YAML syntax was the root cause of the original failure: the GitHub Support escalation documented in HANDOFF.md (for workflow ID 317109373) is likely unnecessary. Jeff can close/cancel that ticket if it was opened.
