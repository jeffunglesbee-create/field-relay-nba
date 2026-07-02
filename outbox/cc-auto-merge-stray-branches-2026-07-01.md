# Outbox — Auto-Merge Stray Branches (CI Safety Net)

**Date:** 2026-07-02
**Relay HEAD:** 503af15
**CC-CMD:** docs/CC-CMD-2026-07-01-auto-merge-stray-branches.md
**Status:** SHIPPED

---

## Pre-Build Probe Results

| Probe | Finding |
|-------|---------|
| `ls .github/workflows/` | 12 existing workflows — `deploy.yml`, `verify-pending-checks.yml`, etc. |
| Trigger convention | `deploy.yml` uses `push: branches: [main]`; new workflow uses `push: branches: - 'claude/**'` — consistent glob-list format |
| Permissions pattern | `deploy.yml` uses `permissions: contents: read` at job level; new workflow uses `contents: write` at workflow level (required for merge + branch delete via API) |

---

## What Was Built

**`.github/workflows/auto-merge-stray-branches.yml`** (new):

- Trigger: `push` to any `claude/**` branch — narrow match, won't touch human-created feature branches with different naming
- Permissions: `contents: write` — required for GitHub API merge commit creation and branch deletion
- Step: GitHub API `POST /repos/{owner}/{repo}/merges` with `base: main`, `head: $BRANCH`
  - 201 → merged + branch deleted via `DELETE /git/refs/heads/$BRANCH`
  - 204 → already up to date, no-op
  - other → step fails with exit 1, branch left intact for manual review

---

## GITHUB_TOKEN Permissions Note

`secrets.GITHUB_TOKEN` is the standard Actions token. The `permissions: contents: write` block in the workflow grants it merge and branch-deletion rights for this specific workflow run. This is the standard approach for workflows that need to push or merge — no additional repo-level secrets or PATs required. If the repo has org-level "Restrict permissions for GITHUB_TOKEN" set to read-only, this would fail; that case would require a PAT. Cannot confirm from the sandbox — noted here as a known conditional.

---

## Verification

- `python3 -c "import yaml; yaml.safe_load(open(...))"` → **YAML VALID**
- Trigger pattern confirmed: `- 'claude/**'` (lines 4–6)
- Permissions block confirmed: `contents: write` (lines 7–8)
- Pre-commit hook: `✅ Branch + syntax checks passed`

**Note on PyYAML `on` key**: Python's `yaml.safe_load` parses `on:` as boolean `True` (a known PyYAML quirk). This does not affect GitHub Actions — the runner parses YAML correctly and treats `on` as the trigger keyword. All 12 existing workflows in this repo use the same unquoted `on:` without issue.

---

## Three-Layer Defense Stack (Current State)

| Layer | Mechanism | Reliability |
|-------|-----------|-------------|
| 1 | Per-CC-CMD text instruction | Failed 3× — not reliable |
| 2 | CLAUDE.md branch policy | Failed 2× — not reliable alone |
| 3 | `.git/hooks/pre-commit` | Active in this clone; persistence gap across fresh clones (no npm/prepare hook to auto-install) |
| 4 (this) | CI auto-merge on `claude/**` push | Unconditional; doesn't depend on CC reading anything |

Layer 4 is the safety net: when layers 1-3 fail, any `claude/**` push is auto-merged to main within seconds and the stray branch is deleted. The cost of a stray-branch incident is now near-zero rather than requiring manual chat-side detection and merging.

---

## Chat-Side Follow-Up

If a fourth stray-branch incident occurs: confirm the `Auto-Merge Stray Branches` workflow ran on that push and produced a merge commit on main. That's the real end-to-end proof — the YAML being valid is necessary but not sufficient.
