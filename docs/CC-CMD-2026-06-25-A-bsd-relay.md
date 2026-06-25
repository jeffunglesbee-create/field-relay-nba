# CC-CMD A: BSD Relay Integration
**Date:** 2026-06-25 · **Repo:** field-relay-nba · **Rule 87:** Self-completing.

---

## CONTEXT — WHAT HAPPENED BEFORE CC RUNS THIS

Tasks 1+2 were executed via chat session (not CC). Two commits landed:
- `350fbd9` — deploy.yml: BSD_API_TOKEN added to secrets + env blocks
- `8cdb23a` — src/index.js: BSD route handler (8 routes) inserted before /health/sources

CI run on 8cdb23a FAILED at `Bootstrap KV namespace (field-push-subs)` step.
No `continue-on-error: true` on that step — all downstream steps skipped.
Wrangler deploy never ran. e97fffd is still live. BSD routes exist in source only.

CC's job: verify the prior commits are correct, fix the CI blocker, get BSD live.

---

## PROBE BLOCK — RUN ALL BEFORE TOUCHING ANYTHING

```bash
cd /home/claude/field-relay-nba && git pull

# ── VERIFY COMMIT 350fbd9 (deploy.yml BSD_API_TOKEN) ─────────────────────────
echo "=== Verifying 350fbd9 ==="
git show 350fbd9 --stat
# Expected: .github/workflows/deploy.yml | changed

git show 350fbd9:.github/workflows/deploy.yml | grep -c BSD_API_TOKEN
# Expected: 3 (one in secrets list, one in env block, one comment)
# If 0: commit didn't land correctly — re-apply Task 1 manually

# ── VERIFY COMMIT 8cdb23a (index.js BSD routes) ───────────────────────────────
echo "=== Verifying 8cdb23a ==="
git show 8cdb23a --stat
# Expected: src/index.js | changed, +116 lines

git show 8cdb23a:src/index.js | grep -c "pathname.startsWith('/bsd/')"
# Expected: 1

git show 8cdb23a:src/index.js | grep -c "BSD_API_TOKEN not configured"
# Expected: 1

# ── VERIFY CURRENT SOURCE STATE ───────────────────────────────────────────────
echo "=== Current source state ==="
grep -c "pathname.startsWith('/bsd/')" src/index.js
# Expected: 1

grep -c BSD_API_TOKEN .github/workflows/deploy.yml
# Expected: 3

grep -c "BSD_API_TOKEN" wrangler.toml
# Expected: 0 (BSD_API_TOKEN is a secret, not a var — not in wrangler.toml)

# ── VERIFY CI FAILURE ROOT CAUSE ─────────────────────────────────────────────
echo "=== CI bootstrap KV step ==="
grep -n "continue-on-error" .github/workflows/deploy.yml | head -5
# Expected: 0 lines — no continue-on-error on Bootstrap KV steps yet

grep -n "Bootstrap KV" .github/workflows/deploy.yml
# Expected: 3 lines (field-push-subs, field-journalism, field-mcp-oauth)
# Note their line numbers — these are the steps to fix

# ── VERIFY WHAT IS CURRENTLY DEPLOYED ────────────────────────────────────────
echo "=== Deploy state ==="
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/deploy/verify
# Expected: {"expected":"8cdb23a","deployed":"e97fffd","match":false}
# 8cdb23a = source HEAD, e97fffd = last deployed (pre-BSD)

curl -s https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/live | head -c 50
# Expected: "Path not allowed" or similar — BSD not yet deployed
```

All probes passing as described = prior commits correct, CI fix is the only task.
If any probe fails unexpectedly: stop, report, do not proceed.

---

## TASK 1 — Fix CI: add continue-on-error to Bootstrap KV steps

The three Bootstrap KV steps in `.github/workflows/deploy.yml` each need
`continue-on-error: true` added. These steps create KV namespaces if they
don't exist — if the CF API returns unexpected output they fail and halt the
entire pipeline, blocking the wrangler deploy.

Find each step by name and add the flag:

**Step 1 of 3** — field-push-subs (around L22):
OLD:
```yaml
      - name: Bootstrap KV namespace (field-push-subs)
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```
NEW:
```yaml
      - name: Bootstrap KV namespace (field-push-subs)
        continue-on-error: true
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

**Step 2 of 3** — field-journalism (around L40):
OLD:
```yaml
      - name: Bootstrap KV namespace (field-journalism)
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```
NEW:
```yaml
      - name: Bootstrap KV namespace (field-journalism)
        continue-on-error: true
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

**Step 3 of 3** — field-mcp-oauth (around L58):
OLD:
```yaml
      - name: Bootstrap KV namespace (field-mcp-oauth)
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```
NEW:
```yaml
      - name: Bootstrap KV namespace (field-mcp-oauth)
        continue-on-error: true
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

Commit with [skip ci] — this is a CI fix only, no code change:
```bash
git add .github/workflows/deploy.yml
git commit -m "fix(ci): continue-on-error on Bootstrap KV steps to unblock BSD deploy [skip ci]"
git push origin main
```

---

## TASK 2 — Trigger deploy and wait

The code (8cdb23a) is already in the repo. Push an empty commit to trigger CI:

```bash
git commit --allow-empty -m "ci: trigger deploy after Bootstrap KV fix"
git push origin main
```

Wait for CI to complete. The `Deploy to Cloudflare Workers` step must succeed.
Monitor: watch the Actions tab or poll via API.

Expected CI sequence:
- Bootstrap KV steps: may still show ⚠️ (continue-on-error) — that is correct
- Deploy to Cloudflare Workers: ✅
- Deploy gate — confirm relay is live: ✅
- STRUCTURAL 1-6: ✅
- PROBE A-E: ✅

If Deploy step itself fails: read the wrangler output, diagnose, fix before continuing.

---

## DONE CONDITIONS

```bash
# 1. continue-on-error on all 3 Bootstrap KV steps
grep -c "continue-on-error: true" .github/workflows/deploy.yml
# Expected: ≥ 3

# 2. Deploy gate confirms BSD HEAD is live
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/deploy/verify | python3 -c "
import json,sys; d=json.load(sys.stdin)
print(f'expected={d["expected"]} deployed={d["deployed"]} match={d["match"]}')
"
# Expected: match=true (both sha should be 8cdb23a or later)

# 3. BSD live events endpoint responds
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/live
# Expected: JSON with count field (NOT "Path not allowed")

# 4. BSD tennis endpoint responds
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/bsd/tennis/matches/live
# Expected: JSON (NOT "Path not allowed")

# 5. BSD shotmap route accessible (use any event ID from /bsd/events/live)
EVENT_ID=$(curl -s https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/live | python3 -c "
import json,sys; d=json.load(sys.stdin)
evts=d.get('events',[])
print(evts[0]['id'] if evts else 'no-live-events')
")
echo "Live event: $EVENT_ID"
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/${EVENT_ID}/shotmap" | head -c 100
# Expected: JSON from BSD (or empty if no live games — 200 OK either way)

# 6. diff — only deploy.yml changed in the KV fix commit
git show HEAD --stat
# Expected: .github/workflows/deploy.yml only
```
