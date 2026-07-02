# Claude Code Command — Auto-Merge Stray claude/* Branches (CI-Side Safety Net)

**Branch:** main — commit directly, do not create a feature branch or PR.
**(If this specific CC-CMD lands on a branch, the new workflow this
CC-CMD adds should catch and merge it automatically — that would
actually be a valid, if ironic, first real-world test of the fix.)**

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-auto-merge-stray-branches-2026-07-01.md.

## CONTEXT

Three prevention mechanisms have been tried tonight for the stray-
branch problem, in order: (1) per-CC-CMD text instruction, (2) a
CLAUDE.md branch policy, (3) a local pre-commit hook. All three have
failed at least once, and the pre-commit hook (the strongest of the
three) has a real, unresolved persistence gap — `.git/hooks/pre-commit`
isn't git-tracked, so it doesn't survive a fresh clone automatically,
and this repo's real bootstrap never runs a local `npm install`
(confirmed — the only `npm install` in any workflow is a global
wrangler install), ruling out the standard "npm prepare script" fix.

**Reframe: every prevention mechanism so far depends on CC reading and
following something before acting — proven unreliable three times.**
This CC-CMD instead removes the actual cost (staying stranded on a
branch, requiring manual chat-side detection and merging) via a
mechanism that doesn't depend on CC's compliance at all — CI triggered
by `push` itself, which runs unconditionally.

**This does not replace the pre-commit hook or CLAUDE.md policy** —
those stay as first-line prevention. This is a safety net for when they
fail, converting "someone has to notice and manually merge" into
"merged automatically within seconds of the push."

## PRE-BUILD PROBE (Rule 87)

```bash
ls .github/workflows/
cat .github/workflows/smoke-and-verify.yml | head -20
```

Confirm the real workflow-trigger conventions already used in this repo
before adding a new one, to match style/naming.

## TASK 1: New workflow — auto-merge-stray-branches.yml

```yaml
name: Auto-Merge Stray Branches
on:
  push:
    branches:
      - 'claude/**'

permissions:
  contents: write

jobs:
  auto-merge:
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
            -d "{\"base\": \"main\", \"head\": \"$BRANCH\", \"commit_message\": \"auto-merge: stray branch $BRANCH (CI safety net — see CLAUDE.md branch policy)\"}")

          HTTP_CODE=$(echo "$RESPONSE" | tail -1)
          BODY=$(echo "$RESPONSE" | sed '$d')

          echo "HTTP $HTTP_CODE"
          echo "$BODY"

          if [ "$HTTP_CODE" -eq 201 ]; then
            echo "✅ Merged successfully"
            # Delete the stray branch now that it's merged
            curl -s -X DELETE \
              "https://api.github.com/repos/${{ github.repository }}/git/refs/heads/$BRANCH" \
              -H "Authorization: token $GH_TOKEN" \
              -H "Accept: application/vnd.github+json"
            echo "🗑 Deleted $BRANCH"
          elif [ "$HTTP_CODE" -eq 204 ]; then
            echo "ℹ️ Already up to date — nothing to merge"
          else
            echo "❌ Merge failed (conflict or other issue) — branch left intact for manual review"
            exit 1
          fi
```

**Verify this uses `secrets.GITHUB_TOKEN` correctly** — confirm the
default token has `contents: write` permission granted (via the
`permissions:` block above) to push a merge commit and delete a branch;
if the default token's permissions are more restricted in this repo's
actual settings, note that in the outbox rather than assuming it works.

**Trigger scope note:** this only fires on `claude/**` branches
specifically — a deliberate, narrow match so it never touches an
intentional, differently-named feature branch a human might create for
an unrelated reason. Do not widen this pattern without explicit
instruction.

## TASK 2: Verification

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/auto-merge-stray-branches.yml'))"
```

Cannot fully verify end-to-end from the CC sandbox (needs a real
`claude/*` branch push to trigger it). Done condition: valid YAML,
correct trigger pattern, correct permissions block present.

**Chat-side follow-up:** if a fourth stray-branch incident happens after
this lands, confirm the workflow actually fired and auto-merged it
within the expected timeframe — that's the real proof, not the YAML
being syntactically valid.

## TASK 3: Outbox manifest (last task)
