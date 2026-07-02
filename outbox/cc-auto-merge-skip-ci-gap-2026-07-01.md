# Outbox — Close [skip ci] Gap in Auto-Merge Safety Net

**Date:** 2026-07-02
**Relay HEAD:** 663fcc8
**CC-CMD:** docs/CC-CMD-2026-07-01-auto-merge-skip-ci-gap.md
**Status:** SHIPPED

---

## Pre-Build Probe Results

| Probe | Finding |
|-------|---------|
| `cat .github/workflows/auto-merge-stray-branches.yml` | Confirmed single-job `push`-only workflow — matched expected content exactly |
| Gap confirmed | Outbox commit with `[skip ci]` in message: push workflow never fired; branch stranded until manually cleaned up |

---

## Root Cause

`[skip ci]` in a commit message is a GitHub convention that suppresses ALL push-triggered workflow runs — including `auto-merge-stray-branches.yml`. Any doc-only or outbox-only commit with `[skip ci]` pushed to a `claude/**` branch bypasses the safety net entirely.

---

## What Was Built

**`.github/workflows/auto-merge-stray-branches.yml`** — replaced single-job push-only workflow with two-job workflow:

| Job | `if:` gate | Trigger | What it does |
|-----|-----------|---------|--------------|
| `auto-merge-on-push` | `github.event_name == 'push'` | `push` to `claude/**` | Merges the specific branch from `$GITHUB_REF`, deletes it on 201 |
| `auto-merge-sweep` | `github.event_name != 'push'` | `schedule` (*/30) + `workflow_dispatch` | Lists all `claude/**` branches via API, merges + deletes each |

The sweep job is independent of push trigger and commit message content — it runs every 30 minutes unconditionally and cleans up any stranded `claude/**` branches regardless of how they got there.

---

## Verification

- `python3 -c "import yaml; yaml.safe_load(...)"` → **YAML VALID**
- Job names: `['auto-merge-on-push', 'auto-merge-sweep']` ✓
- `auto-merge-on-push if`: `github.event_name == 'push'` ✓
- `auto-merge-sweep if`: `github.event_name != 'push'` ✓  
- `permissions`: `contents: write` (unchanged) ✓
- Triggers: `push`, `schedule` (*/30), `workflow_dispatch` ✓
- Pre-commit hook: `✅ Branch + syntax checks passed`

---

## Worst-case latency

A `[skip ci]` commit to `claude/**` that misses the push trigger will be swept within 30 minutes by the next scheduled run. Previously: indefinite until manual chat-side detection.

---

## Chat-Side Follow-Up

Trigger `Auto-Merge Stray Branches` via `workflow_dispatch` once. Expected: `auto-merge-sweep` job runs (not `auto-merge-on-push`), finds zero `claude/**` branches, prints `No claude/* branches found — nothing to sweep.`, exits 0. That's the clean-state proof the sweep job works.
