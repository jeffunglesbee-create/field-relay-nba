# Claude Code Command — Enforce Branch Policy via Pre-Commit Hook (Not Docs)

**Branch:** main — commit directly, do not create a feature branch or PR.
**(Yes, this instruction is in every CC-CMD already and has been ignored
twice tonight despite also being in CLAUDE.md. This CC-CMD's entire
purpose is to make that failure mode structurally impossible instead of
asking again. If this CC-CMD itself lands on a branch, that is proof
the hook wasn't installed correctly — check for that specifically.)**

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-branch-enforcement-hook-2026-07-01.md.

## CONTEXT

Two real incidents tonight (`/savant/sync` endpoint work, then the
`reconcile()` chunking fix) both landed on stray `claude/*` branches
despite: (a) explicit "Branch: main" text in every CC-CMD, and (b) a
CLAUDE.md branch policy added specifically to prevent this, confirmed
present in the working directory when both incidents occurred. Written
instructions have failed twice. This CC-CMD replaces instruction with
enforcement — a pre-commit hook that hard-blocks the commit if the
current branch isn't `main`, the same way `jubilant-bassoon`'s existing
`scripts/pre-commit` already hard-blocks A190 SW_VERSION mismatches.
`field-relay-nba` currently has NO pre-commit hook at all — confirmed
via direct search, zero hook files exist in this repo. That's the real
gap: the client repo has proven enforcement infrastructure, the relay
repo (where both incidents happened) has none.

## PRE-BUILD PROBE (Rule 87)

```bash
find . -iname "*hook*" -not -path "*/.git/*"
ls .git/hooks/ 2>/dev/null
cat package.json | grep -A5 "husky\|prepare"
```

Confirm there is genuinely no existing hook mechanism (husky, simple-git-hooks, or a raw `.git/hooks/pre-commit`) before creating one from scratch — if one exists but is disconnected/misconfigured, fix that instead of adding a parallel mechanism.

## TASK 1: Create scripts/pre-commit with branch enforcement as the FIRST check

```bash
#!/bin/sh
# field-relay-nba pre-commit hook — branch enforcement + syntax check.
# Added 2026-07-01 after two stray-branch incidents in one session
# despite explicit written instructions (CC-CMD text + CLAUDE.md) being
# ignored both times. This hook makes the failure structurally
# impossible instead of asking again.

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║  COMMIT BLOCKED — not on main                            ║"
  echo "║  Current branch: $BRANCH"
  echo "║  This repo commits directly to main. See CLAUDE.md.       ║"
  echo "╚══════════════════════════════════════════════════════════╝"
  exit 1
fi

command -v node >/dev/null 2>&1 || { echo "⚠ node not found — skipping syntax check"; exit 0; }

echo "🔍 Syntax check (all staged .js files)..."
FAILED=0
for f in $(git diff --staged --name-only --diff-filter=ACM | grep '\.js$'); do
  node -c "$f" 2>&1 || FAILED=1
done
if [ "$FAILED" -ne 0 ]; then
  echo "❌ Syntax check failed — commit blocked"
  exit 1
fi

echo "✅ Branch + syntax checks passed"
exit 0
```

Make it executable (`chmod +x scripts/pre-commit`) and symlink or copy
it into `.git/hooks/pre-commit` per whatever mechanism actually installs
hooks in this repo — check jubilant-bassoon's `package.json`/setup
script for how ITS hook gets installed (husky, a `prepare` script, or
manual), and mirror that exact installation method here rather than
inventing a different one.

## TASK 2: Add the same branch check to jubilant-bassoon's existing hook

**This is a cross-repo addition — confirm you're actually able to edit
jubilant-bassoon from this session before attempting it; if not (repo
scope restriction, same class of limitation hit earlier tonight), note
it in the outbox and leave this as an explicit follow-up for a
jubilant-bassoon-scoped session instead of skipping it silently.**

If accessible, add the identical branch check as the FIRST check in
`scripts/pre-commit`, before the existing SW_VERSION check — same
exact block as Task 1, adapted only if this repo's branch-detection
convention differs.

## TASK 3: Verification

```bash
node -c scripts/pre-commit 2>&1 || sh -n scripts/pre-commit
git branch --show-current
```

**The real test:** this CC-CMD's own commit must land on `main`. If it
doesn't, the hook wasn't installed correctly (or wasn't installed
before this commit was made) — report that explicitly rather than
letting a third stray-branch incident pass silently.

## TASK 4: Outbox manifest (last task)

State explicitly whether Task 2 (jubilant-bassoon) was reachable from
this session, and confirm via `git branch --show-current` that this
CC-CMD's own commits landed on `main` — the literal proof the fix
works.
