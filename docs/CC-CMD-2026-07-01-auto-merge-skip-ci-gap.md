# Claude Code Command — Close the [skip ci] Gap in Auto-Merge Safety Net

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-auto-merge-skip-ci-gap-2026-07-01.md.

## CONTEXT

Confirmed real (chat-side, live test): the auto-merge-stray-branches
workflow correctly merged its first real stray push (`503af15`), but
never fired for a second push to the same branch because that commit's
message contained `[skip ci]` — a standard GitHub convention that
suppresses ALL push-triggered workflows. That convention was used
throughout this session for doc-only commits (including by chat, which
is where CC likely picked up the pattern for its own outbox commit) —
meaning any future outbox-only or doc-only push will bypass the safety
net entirely, regardless of who wrote the commit message.

**Fix: add a second, `schedule`-triggered job to the same workflow that
doesn't depend on `push` firing at all.** It lists all `claude/**`
branches directly via the GitHub API and merges any that are ahead of
`main`, independent of what triggered the original push or what its
commit message contained.

## PRE-BUILD PROBE (Rule 87)

```bash
cat .github/workflows/auto-merge-stray-branches.yml
```

Confirm the exact current file content before editing — reproduced
below from the 2026-07-01 investigation, re-verify it matches.

## TASK 1: Add a scheduled sweep job to the same workflow

```yaml
name: Auto-Merge Stray Branches
on:
  push:
    branches:
      - 'claude/**'
  schedule:
    - cron: '*/30 * * * *'  # every 30 min — catches anything push missed (e.g. [skip ci])
  workflow_dispatch: {}

permissions:
  contents: write

jobs:
  auto-merge-on-push:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - name: Merge into main
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          BRANCH="${GITHUB_REF#refs/heads/}"
          echo "Auto-merging stray branch: $BRANCH"
          RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
            "https://api.github.com/repos/${{ github.repository }}/merges" \
            -H "Authorization: token $GH_TOKEN" \
            -H "Accept: application/vnd.github+json" \
            -d "{\"base\": \"main\", \"head\": \"$BRANCH\", \"commit_message\": \"auto-merge: stray branch $BRANCH (CI safety net — push trigger)\"}")
          HTTP_CODE=$(echo "$RESPONSE" | tail -1)
          BODY=$(echo "$RESPONSE" | sed '$d')
          echo "HTTP $HTTP_CODE"
          echo "$BODY"
          if [ "$HTTP_CODE" -eq 201 ]; then
            curl -s -X DELETE "https://api.github.com/repos/${{ github.repository }}/git/refs/heads/$BRANCH" \
              -H "Authorization: token $GH_TOKEN" -H "Accept: application/vnd.github+json"
            echo "🗑 Deleted $BRANCH"
          elif [ "$HTTP_CODE" -ne 204 ]; then
            echo "❌ Merge failed — branch left intact for manual review"
            exit 1
          fi

  auto-merge-sweep:
    if: github.event_name != 'push'
    runs-on: ubuntu-latest
    steps:
      - name: Sweep all claude/** branches
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          BRANCHES=$(curl -s "https://api.github.com/repos/${{ github.repository }}/branches?per_page=100" \
            -H "Authorization: token $GH_TOKEN" -H "Accept: application/vnd.github+json" \
            | python3 -c "import json,sys; [print(b['name']) for b in json.load(sys.stdin) if b['name'].startswith('claude/')]")

          if [ -z "$BRANCHES" ]; then
            echo "No claude/* branches found — nothing to sweep."
            exit 0
          fi

          for BRANCH in $BRANCHES; do
            echo "Sweeping: $BRANCH"
            RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
              "https://api.github.com/repos/${{ github.repository }}/merges" \
              -H "Authorization: token $GH_TOKEN" \
              -H "Accept: application/vnd.github+json" \
              -d "{\"base\": \"main\", \"head\": \"$BRANCH\", \"commit_message\": \"auto-merge: stray branch $BRANCH (CI safety net — scheduled sweep, likely missed by push trigger e.g. via [skip ci])\"}")
            HTTP_CODE=$(echo "$RESPONSE" | tail -1)
            echo "  HTTP $HTTP_CODE"
            if [ "$HTTP_CODE" -eq 201 ]; then
              curl -s -X DELETE "https://api.github.com/repos/${{ github.repository }}/git/refs/heads/$BRANCH" \
                -H "Authorization: token $GH_TOKEN" -H "Accept: application/vnd.github+json"
              echo "  🗑 Deleted $BRANCH"
            elif [ "$HTTP_CODE" -eq 204 ]; then
              echo "  ℹ️ Already up to date"
            else
              echo "  ❌ Merge failed for $BRANCH — left intact for manual review"
            fi
          done
```

**Verify this split (two jobs, gated by `github.event_name`) is the
correct way to have one workflow file serve both trigger types** —
confirm via the probe/a quick syntax check that `if:` conditions on jobs
work as expected, rather than assuming the YAML is correct without
checking.

## TASK 2: Verification

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/auto-merge-stray-branches.yml'))"
```

Cannot fully verify end-to-end from the CC sandbox. Done condition:
valid YAML, both jobs correctly gated, permissions block unchanged.

**Chat-side follow-up:** trigger via `workflow_dispatch` once to confirm
the sweep job runs cleanly against current branch state (should find
zero `claude/*` branches right now, since both prior stray branches
were already manually cleaned up — a clean "nothing to sweep" run is
still a valid, useful confirmation the mechanism works).

## TASK 3: Outbox manifest (last task)
