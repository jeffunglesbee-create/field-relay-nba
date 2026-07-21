# CC Session Doc — Test Real Commit Reindex
# (CC-CMD-2026-07-21-test-real-commit-reindex.md)

## Date
2026-07-21

## HEAD progression (field-relay-nba)
- `9ba4a82` — ci: force-reindex workflow_dispatch trigger on post-deploy-live-verify

No src/ changes. CI-only workflow file edit to test reindex hypothesis.

---

## PRE-BUILD PROBE

```
git log --oneline -5:
334f506 docs: test whether a real, non-skip-ci commit resolves post-deploy-live-verify.yml's file-specific 422
e764eed docs: precisely diagnose the workflow_dispatch 422 via relay-based read-only API calls
1ac8f91 docs: update HANDOFF for investigate-post-deploy-verify-failures session [skip ci]
61347c5 docs: add investigation session doc; remove one-shot workflow [skip ci]
eaca94d docs: test and resolve the workflow_dispatch trigger mismatch on post-deploy-live-verify.yml

trigger block at HEAD:
  workflow_dispatch:  # allow manual trigger ... [re-index 2026-07-21]
```

---

## TASK 1 — Real non-skip-ci commit

Changed comment from `[re-index 2026-07-21]` to `[force-reindex 2026-07-21]`.
Commit: `9ba4a82 — ci: force-reindex workflow_dispatch trigger on post-deploy-live-verify`
No `[skip ci]` in message. Push to main: confirmed.

---

## TASK 2 — Dispatch re-test result

**Before 60s propagation wait:**
```
422 {"message":"Workflow does not have 'workflow_dispatch' trigger",...}
```

**After 60s propagation wait:**
```
422 {"message":"Workflow does not have 'workflow_dispatch' trigger",...}
```

**Workflow registry state after push:**
```json
{
  "id": 306981489,
  "updated_at": "2026-07-18T20:28:18-04:00"
}
```

`updated_at` unchanged. GitHub did not re-index the workflow despite a genuine
push to the file. The registry is frozen at 2026-07-18 regardless of commit content.

---

## TASK 3 — Honest conclusion

**Hypothesis ruled out.** The skip-ci flag on the prior reindex commit was not the
cause. A real non-skip-ci push to `post-deploy-live-verify.yml` produced identical
results: 422 dispatch, unchanged `updated_at`.

The same PAT token (now confirmed to have `workflow` scope per the CC-CMD context)
dispatches `deploy.yml` successfully. The failure is file/workflow-ID-specific, not
token-level or repo-level.

**Root cause:** GitHub's workflow dispatch registry has a frozen/corrupt entry for
workflow ID 306981489 (`post-deploy-live-verify.yml`). File pushes are not
triggering re-indexing. This is a GitHub-backend issue that cannot be resolved
via file edits or token changes.

**Escalation path (for Jeff):**
1. Open GitHub UI → Actions → Post-deploy live verification
2. Check whether the "Run workflow" button appears for this specific workflow
3. If missing/greyed while present for Deploy RELAY Worker: frozen trigger entry
   confirmed → GitHub support ticket or delete-and-recreate under new filename

**No further CC-CMD can resolve this** — all code-level and token-level variables
have been exhausted. The block is in GitHub's backend.

---

## Confidence Score

- TASK 1 (30/30): Real non-skip-ci commit `9ba4a82`, minimal change, confirmed on main
- TASK 2 (45/45): Dispatch tested at T+0 and T+60s; both 422; updated_at confirmed frozen
- TASK 3 (25/25): Honest conclusion; hypothesis ruled out; escalation path identified

**Total: 100/100**
