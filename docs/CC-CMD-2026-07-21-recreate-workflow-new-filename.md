# CC-CMD — Recreate post-deploy-live-verify.yml under a new filename to escape the frozen registry entry

**Date:** 2026-07-21
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5

---

## CONTEXT

`post-deploy-live-verify.yml` (workflow ID 306981489) has a frozen
registry entry on GitHub's backend — confirmed via `updated_at` staying
fixed at 2026-07-18 despite a real, non-skip-ci push. All code-level and
token-level causes have been ruled out (see
`outbox/cc-session-2026-07-21-test-real-commit-reindex.md`). A new file
gets a new workflow ID, independent of the frozen one.

**Real, important constraint: preserve the actual verification content.**
The file's own logic (circadian endpoint checks, bracketDelta probe,
confidence-gate check, rule-registry check, soccer-label check, PL
fixtures check) is genuinely still valuable — this is a filename/registry
problem, not a content problem. Don't rewrite or simplify the checks
themselves.

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline -5
cat .github/workflows/post-deploy-live-verify.yml
```

Confirm the real, current, complete file content fresh before copying it
— don't work from a stale copy in this doc or from memory.

---

## TASK 1 — Create the new file with identical content

New filename: `.github/workflows/post-deploy-verify.yml` (distinct from
the original, not a trivial rename that could collide). Copy the current
file's content byte-for-byte — same triggers (`workflow_run` +
`workflow_dispatch`), same jobs, same steps. Only the filename changes.

## TASK 2 — Delete the old file

Remove `.github/workflows/post-deploy-live-verify.yml` in the same
commit as Task 1 (a single commit — create new, delete old — keeps the
history clean and avoids a window where both exist and could both fire
on the next deploy).

## TASK 3 — Real, direct dispatch test on the new file

```bash
gh workflow run post-deploy-verify.yml --repo jeffunglesbee-create/field-relay-nba
```
Report the real, actual result. This is the test that confirms whether
the new file genuinely escapes the frozen registry entry.

## TASK 4 — Confirm the workflow_run trigger still fires correctly

The new file's `workflow_run` trigger (fires when "Deploy RELAY Worker"
completes) needs to keep working for its primary purpose, not just
manual dispatch. This can't be fully verified synchronously in this
session (it fires on the next real deploy) — report this honestly as a
real, pending confirmation rather than claiming it's verified when it
isn't yet.

---

## DONE CONDITION

A real, working `workflow_dispatch` on the new filename (confirmed via
actual dispatch success, not just file presence), with the old,
frozen-registry file removed, and an honest note that `workflow_run`
firing correctly will only be confirmed on the next real deploy.

**Confidence scoring:**
- TASK 1 (25 pts): real, complete, unmodified content preserved in the new file
- TASK 2 (15 pts): old file cleanly removed, same commit
- TASK 3 (40 pts): real, direct dispatch test with actual result
- TASK 4 (20 pts): honest handling of the not-yet-verifiable workflow_run path

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
