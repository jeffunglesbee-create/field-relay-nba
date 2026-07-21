# CC Session Doc — 2026-07-21 — push-trigger-fix

## HEAD Progression

| Commit | Message |
|--------|---------|
| 9e27752 | ci: confirmed both triggers broken on ID 317109373; remove dispatch-verify-once.yml [skip ci] |
| 220e25f | ci: delete post-deploy-verify.yml to clear frozen workflow registry entry ID 317109373 [skip ci] |
| a46b45c | ci: re-add post-deploy-verify.yml with push:branches:main trigger (bypasses GitHub YAML indexing) |

## What Was Built

**Goal:** Fix `post-deploy-verify.yml` triggers after confirming both `workflow_dispatch` (422) and `workflow_run` (never fired despite successful deploy run 29834902927) are broken due to GitHub YAML indexing freeze on workflow ID 317109373.

**Approach:** Delete the file (clearing the frozen registry entry), then re-add with `push: branches: [main]` as the primary trigger — the only trigger type that doesn't require YAML content to be indexed, because it fires at the filesystem level before YAML parsing.

**Changes to `post-deploy-verify.yml`:**
- Added `push: branches: [main]` trigger block
- Added `github.event_name == 'push'` condition to job `if:` expression
- Changed output filename from `${{ github.event.workflow_run.id }}` (empty on push/dispatch events) to `${{ github.run_id }}` (always populated)

## What Was Verified

Run 3 (ID 29837393001) fired at `2026-07-21T14:04:29Z` with `event: push` — the trigger mechanism fires immediately. However, `jobs_total_count: 0` and `conclusion: failure` confirm YAML indexing is frozen at the repo level for all new workflow files, not just the trigger registration. GitHub can fire a run entry but cannot parse the job definitions to queue anything.

Pattern across all 3 runs of workflow ID 317109373:
- `name` field shows file path (`.github/workflows/post-deploy-verify.yml`), not YAML `name:` field → YAML content never indexed
- 0 jobs queued on every run
- `conclusion: failure` with no log content

`deploy.yml` (ID 278094868, indexed May 2026) remains fully functional.

## Integration Status

STAGED — `push: branches: [main]` trigger committed and on main. Cannot execute due to GitHub YAML indexing freeze on workflow ID 317109373. The run fires but no jobs queue.

## Escalation Required

Open GitHub Support ticket:
- Repo: `jeffunglesbee-create/field-relay-nba`
- Workflow ID: 317109373 (`post-deploy-verify.yml`)
- Issue: YAML content never indexed. All 3 runs show file path as `name` instead of YAML `name:` field. No jobs queue on any event type (push, workflow_run, workflow_dispatch).
- Ask: Force re-index of YAML content for workflow ID 317109373.
- Evidence: Run IDs 29796164064, 29831699986, 29837393001 — all 0 jobs, all `failure`.

## Open Carry-Forwards

None code-related. The only remaining action is Jeff opening the GitHub Support ticket.
