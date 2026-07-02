# Outbox — Pre-Commit Branch Enforcement Hook

**Date:** 2026-07-02
**Relay HEAD:** 4b5b84f
**CC-CMD:** docs/CC-CMD-2026-07-01-branch-enforcement-hook.md
**Status:** SHIPPED

---

## Pre-Build Probe Results

| Probe | Finding |
|-------|---------|
| `find . -iname "*hook*" -not -path "*/.git/*"` | No hook files outside `.git/` — only the CC-CMD doc matched |
| `ls .git/hooks/` | Only `.sample` files — no active hooks at all |
| `grep "husky\|prepare\|simple-git-hooks" package.json` | No `package.json` in this repo — Cloudflare Workers project, no npm hook management |
| `ls scripts/` | Directory did not exist |
| `git branch --show-current` | `main` |

No existing hook infrastructure. Raw `.git/hooks/pre-commit` copy from `scripts/pre-commit` is the correct install method.

---

## What Was Built

**`scripts/pre-commit`** (new, committed, chmod +x):
- Branch check first: hard-blocks commit if `git rev-parse --abbrev-ref HEAD` ≠ `main`, with a bordered error message naming the blocked branch
- Syntax check second: `node -c` on every staged `.js` file; blocks on any failure
- Graceful fallback: if `node` not found, skips syntax check rather than blocking

**`.git/hooks/pre-commit`** (not tracked by git, installed via `cp scripts/pre-commit .git/hooks/pre-commit` during this session):
- Active copy of the above; new clones must re-run the copy

---

## Verification

- `sh -n scripts/pre-commit` → **SHELL SYNTAX OK**
- `git branch --show-current` → **main**
- **Real proof**: this CC-CMD's own commit (`4b5b84f`) ran through the hook and produced `✅ Branch + syntax checks passed` on stdout. The commit landed on `main`. That is the literal proof the hook is correctly installed and working.

---

## Task 2 — jubilant-bassoon (NOT DONE — explicit follow-up)

**jubilant-bassoon is outside this session's GitHub scope.** The GitHub MCP tools for this session are restricted to `jeffunglesbee-create/field-relay-nba`. Attempting `get_file_contents` on jubilant-bassoon returned `Access denied`. This is the same repo-scope limitation documented in the xERA materiality outbox.

**Required follow-up in a jubilant-bassoon-scoped session:**
- Read `scripts/pre-commit` in jubilant-bassoon (confirm the existing SW_VERSION check structure)
- Add the identical branch check as the FIRST block before the SW_VERSION check:
  ```sh
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$BRANCH" != "main" ]; then
    echo "COMMIT BLOCKED — not on main. Current branch: $BRANCH"
    exit 1
  fi
  ```
- Verify `sh -n scripts/pre-commit` passes
- Commit and confirm the commit itself lands on the correct branch

---

## Note on Hook Persistence Across Clones

`.git/hooks/` is not tracked by git. The `scripts/pre-commit` file IS tracked and committed, so it survives clones — but new clones must re-run `cp scripts/pre-commit .git/hooks/pre-commit` to activate it. A `package.json` `prepare` script or a setup note in CLAUDE.md would automate this. Left for a future prompt since adding `package.json` to a Cloudflare Workers project is a non-trivial change with potential side-effects.
