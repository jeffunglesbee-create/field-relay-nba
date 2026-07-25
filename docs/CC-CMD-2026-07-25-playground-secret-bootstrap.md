# CC-CMD-2026-07-25-playground-secret-bootstrap

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Scope:** one workflow step. Bootstrap `CLOUDFLARE_API_TOKEN` into
`jeffunglesbee-create/field-playground` via the existing Deploy Courier,
so the playground's deploy needs no manual secret entry.

---

## Why

`field-playground` now has a Worker deploy (`wrangler.toml` +
`.github/workflows/deploy-playground.yml`) but no
`CLOUDFLARE_API_TOKEN` in its Actions secrets, so the deploy step fails.
The obvious answer is "Jeff adds the secret by hand." That's wrong —
this project already automated exactly this problem and the machinery is
live.

**Verified against HEAD, not memory** (`workers/field-deploy/src/index.js`):

- `ALLOWED_REPOS` (line ~29) gates the **caller's** OIDC `repository`
  claim, not the target repo. It already contains
  `jeffunglesbee-create/field-relay-nba`.
- `/secret` (line ~129) takes `{name, value, repo, owner}` in the body.
  `repo` defaults to `DEFAULT_REPO` (`jubilant-bassoon`) but is a plain
  parameter — **any** target repo can be named.
- The handler fetches the target repo's public key, seals the value with
  `sealedBox()`, and `PUT`s it to
  `/repos/{owner}/{repo}/actions/secrets/{name}` using the Courier's own
  internal `GITHUB_PAT`.

**Therefore no Courier change is required.** An earlier chat message
claimed `field-playground` had to be added to the Courier's allowed
`repository` claims — that was wrong, based on assuming the allowlist
covered targets. It covers callers. Correcting it here so the mistake
doesn't get inherited.

This is one new step in a workflow that already holds
`CLOUDFLARE_API_TOKEN` and already mints OIDC tokens.

---

## PROBE FIRST (read from HEAD)

1. `cat workers/field-deploy/src/index.js | sed -n '25,60p'` — confirm
   `ALLOWED_REPOS`, `OIDC_AUDIENCE` (expected `field-deploy`), and
   `OIDC_ISSUER` still match the above.
2. `sed -n '125,140p' workers/field-deploy/src/index.js` — confirm the
   `/secret` body contract is still `{name, value, repo, owner}`.
3. `ls .github/workflows/` and read the workflow that deploys the
   Courier / relay. Find the existing step that mints an OIDC token
   (search for `ACTIONS_ID_TOKEN_REQUEST_URL`) and the existing
   `/secret` bootstrap call for `jubilant-bassoon`, if one is still
   present. **Mirror that step's exact shape** rather than writing a new
   pattern from this document.
4. Confirm `secrets.CLOUDFLARE_API_TOKEN` is referenced in that
   workflow already.

---

## TASK — add one bootstrap step

In the same workflow that already mints an OIDC token, add a step that
sets the token into `field-playground`. Match the existing
`jubilant-bassoon` bootstrap's style exactly; this is the shape, not
literal code to paste:

```yaml
- name: Bootstrap field-playground deploy secret
  run: |
    OIDC_TOKEN=$(curl -s -H "Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
      "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=field-deploy" | jq -r .value)
    curl -sS -X POST https://field-deploy.jeffunglesbee.workers.dev/secret \
      -H "Authorization: Bearer $OIDC_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"CLOUDFLARE_API_TOKEN\",\"owner\":\"jeffunglesbee-create\",\"repo\":\"field-playground\",\"value\":\"${{ secrets.CLOUDFLARE_API_TOKEN }}\"}"
```

Requirements:

- The job needs `permissions: id-token: write`. If the existing job
  already has it, reuse that job rather than adding a second one.
- **Do not echo the response body unredacted** — on failure the Courier
  returns GitHub's error text, which is safe, but do not `set -x` around
  a line containing the token value.
- Parse the response and **fail the step on `ok:false`**. A silent
  failure here recreates exactly the situation this fixes: a deploy that
  looks configured but isn't.

---

## VERIFY, inside this session

1. Run the workflow (push or `workflow_dispatch`).
2. Confirm the step reports `Secret CLOUDFLARE_API_TOKEN created in
   jeffunglesbee-create/field-playground` (201) or `updated` (204).
3. Then dispatch `deploy-playground.yml` in `field-playground` and
   confirm it gets past the deploy step. That workflow already ends with
   a live check (`curl` the root, assert HTTP 200) — a green run there
   is the real done condition, not just a green secret-set.

**Done condition:** `https://field-playground.jeffunglesbee.workers.dev/`
returns HTTP 200 with no human having entered a credential anywhere.

---

## Explicitly NOT in scope

- **No Courier code change.** `ALLOWED_REPOS` already permits
  field-relay-nba as caller; the target is a body param. Editing the
  Courier here would be a change made on a false premise.
- **No new credential anywhere.** The value comes from
  field-relay-nba's existing `CLOUDFLARE_API_TOKEN`; the Courier's
  `GITHUB_PAT` is already set. Nothing new is stored, and no credential
  value passes through chat.
- **No changes to field-playground.** Its `wrangler.toml` and
  `deploy-playground.yml` are already correct and waiting on the
  secret only.

---

## Outbox

Write `outbox/cc-session-2026-07-25-playground-secret-bootstrap.md`: the
step added, the Courier response verbatim, and the result of the
`deploy-playground.yml` run including whether the live 200 check passed.

**Also flag, separately:** `field-playground` currently has BOTH
`wrangler.toml` and `wrangler.jsonc`. The `.toml` is authoritative (it
carries `account_id`, which `deploy-playground.yml` relies on since it
doesn't pass `accountId` to wrangler-action). The `.jsonc` is a
duplicate created in parallel by chat and is currently an exact
functional mirror so the ambiguity is harmless — but it should be
deleted (`git rm wrangler.jsonc`). Chat has no delete capability.
