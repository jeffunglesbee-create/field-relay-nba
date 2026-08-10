# CC-CMD-2026-08-10-laboratory-secret-bootstrap

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Scope:** one workflow step. Bootstrap `CLOUDFLARE_API_TOKEN` into
`jeffunglesbee-create/field-laboratory` via the existing Deploy Courier.

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-10-laboratory-secret-bootstrap.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Why

`field-laboratory` has a complete, verified Cloudflare Worker deploy —
`wrangler.toml` (assets-only, `not_found_handling = "none"`) and
`.github/workflows/deploy.yml`, which builds F# to JavaScript with Fable,
asserts the built `public/` is non-empty, deploys, then fetches the live URL and
greps it for real page content. It has been **skipping cleanly** on every run
for one reason: no `CLOUDFLARE_API_TOKEN` in its Actions secrets.

This is the same problem `field-playground` had on 2026-07-25, and it has the
same answer. Nothing new is needed.

**A correction worth inheriting.** A session working in field-laboratory
concluded the token could not be provisioned automatically, reasoning that
GitHub secrets cannot be read back through its API. That fact is correct and
the conclusion does not follow: this workflow already has the value in its own
environment at run time, which is exactly where the Courier reads it from. The
same session also built a GitHub Pages deploy to route around the non-existent
blocker — since removed, because it introduced Pages as a second hosting style,
which this project deliberately decided against.

---

## PROBE FIRST (read from HEAD, Rule 87)

1. `sed -n '25,60p' workers/field-deploy/src/index.js` — confirm `ALLOWED_REPOS`
   still contains `jeffunglesbee-create/field-relay-nba` (it gates the
   **caller's** OIDC `repository` claim, not the target), and that
   `OIDC_AUDIENCE` is still `field-deploy`.
2. `sed -n '125,140p' workers/field-deploy/src/index.js` — confirm the `/secret`
   body contract is still `{name, value, repo, owner}`.
3. `grep -n "BOOTSTRAP" .github/workflows/deploy.yml` — the two existing
   bootstrap steps (`jubilant-bassoon`, `field-playground`) and the `oidc` step
   that feeds them.

If any of that has moved, **mirror what is actually there** rather than the
snippet below.

---

## TASK — add one step

In `.github/workflows/deploy.yml`, immediately after the existing
**BOOTSTRAP — Sync CLOUDFLARE_API_TOKEN to field-playground** step, add:

```yaml
      - name: BOOTSTRAP — Sync CLOUDFLARE_API_TOKEN to field-laboratory
        continue-on-error: true
        env:
          OIDC_TOKEN: ${{ steps.oidc.outputs.token }}
          CF_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: |
          RESULT=$(curl -s -X POST https://field-deploy.jeffunglesbee.workers.dev/secret \
            -H "Authorization: Bearer $OIDC_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"repo\":\"field-laboratory\",\"name\":\"CLOUDFLARE_API_TOKEN\",\"value\":\"$CF_TOKEN\"}")
          echo "Result: $RESULT"
          echo "$RESULT" | grep -q '"ok":true' \
            && echo "✅ CLOUDFLARE_API_TOKEN synced to field-laboratory" \
            || { echo "❌ Sync FAILED: $RESULT"; exit 1; }
```

That is the `field-playground` step with one repo name changed. Reuse the
existing `steps.oidc.outputs.token` — the job already has
`permissions: id-token: write`, so **do not add a second OIDC step or a second
job**.

Note the deliberate asymmetry, which matches the existing steps: `jubilant-
bassoon` warns on failure, `field-playground` fails the step. Follow
`field-playground` — a silent failure here recreates precisely the state this
fixes, a deploy that looks configured and is not.

Do not `set -x` around any line carrying the token value.

---

## VERIFY, inside this session

1. Dispatch this workflow and confirm the new step prints `"ok":true`.
2. Then dispatch `deploy.yml` in `field-laboratory`. Its own final step fetches
   `https://field-laboratory.jeffunglesbee.workers.dev` and greps the body for
   `FIELD Laboratory` — a bare 200 is not accepted there, because an assets
   Worker pointed at an empty directory also returns 200.
3. Confirm `https://field-laboratory.jeffunglesbee.workers.dev/version.txt`
   returns the deployed commit SHA.

**Done condition:** that URL serves the laboratory page, with no human having
entered a credential anywhere.

`field-laboratory` also refreshes its own `STATUS.md` after any deploy —
it should flip to **live** on its own within the hour with no further action.

---

## Explicitly NOT in scope

- **No Courier code change.** `ALLOWED_REPOS` already permits field-relay-nba as
  caller; the target repo is a body parameter. Editing the Courier here would be
  a change made on a false premise — the same false premise corrected in the
  2026-07-25 CC-CMD.
- **No new credential anywhere.** The value is field-relay-nba's existing
  `CLOUDFLARE_API_TOKEN`; the Courier's `GITHUB_PAT` is already set. Nothing new
  is stored and no credential value passes through chat.
- **No changes to field-laboratory.** Its `wrangler.toml` and `deploy.yml` are
  already correct and waiting on the secret only.

---

## Separately, and more urgent than this task

The Drive document **FIELD — Deploy Courier v3 Reference May 18 2026**
(`1HSpCVein07IRhjXCkyUx5EkLdtWoAERd`) contains a **live GitHub PAT in
plaintext**, documented as `repo`+`workflow` scope and not expiring until
May 2027. Anyone with read access to that folder has write access to these
repositories.

That document also describes the superseded v3 PAT-auth flow. The Courier is now
on OIDC (v4), so the PAT is no longer the mechanism — it is only exposure.
Recommend revoking it and stripping the value from the doc. Flagged rather than
acted on: rotating a credential is Jeff's call, not a session's.

---

## Outbox

`outbox/cc-session-2026-08-10-laboratory-secret-bootstrap.md`: the step added,
the Courier response verbatim, the result of `field-laboratory`'s deploy run
including whether its live content check passed, and the state of `STATUS.md`
afterwards.
