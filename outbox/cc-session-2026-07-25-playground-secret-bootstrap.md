# CC Session — playground-secret-bootstrap
**Date:** 2026-07-25
**CC-CMD:** docs/CC-CMD-2026-07-25-playground-secret-bootstrap.md
**Repo:** field-relay-nba
**HEAD at close:** 48873cd

---

## What shipped

### Step added to `.github/workflows/deploy.yml` (commit `175e1f6`)

```yaml
- name: BOOTSTRAP — Sync CLOUDFLARE_API_TOKEN to field-playground
  continue-on-error: true
  env:
    OIDC_TOKEN: ${{ steps.oidc.outputs.token }}
    CF_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
  run: |
    RESULT=$(curl -s -X POST https://field-deploy.jeffunglesbee.workers.dev/secret \
      -H "Authorization: Bearer $OIDC_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"repo\":\"field-playground\",\"name\":\"CLOUDFLARE_API_TOKEN\",\"value\":\"$CF_TOKEN\"}")
    echo "Result: $RESULT"
    echo "$RESULT" | grep -q '"ok":true' \
      && echo "✅ CLOUDFLARE_API_TOKEN synced to field-playground" \
      || { echo "❌ Sync FAILED: $RESULT"; exit 1; }
```

Placed after the jubilant-bassoon bootstrap step (step 35), before the `verify` job.

### Encryption bug fix in `workers/field-deploy/src/index.js` (commit `48873cd`)

The Courier's `sealedBox()` used arithmetic right shift `>>` in all Salsa20/HSalsa20
rotation expressions. When intermediate values have bit 31 set, `u>>N` sign-extends,
corrupting cipher state. GitHub's API rejected the encrypted value with HTTP 422.

Fix: replaced all `u>>25`, `u>>23`, `u>>19`, `u>>14` with `u>>>25`, `u>>>23`,
`u>>>19`, `u>>>14` (unsigned logical right shift) in `hsalsa20()` and `salsa20Blk()`.

Verified against NaCl official HSalsa20 test vector:
- Input key: `4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742`
- Buggy output: `bee6882d81c78409613ec7dab46710b64edc942b1be98c7652391237de6bfbc5`
- Fixed output: `1b27556473e985d462cd51197a9a46c76009549eac6474f206c4ee0844f68389`
- Expected:     `1b27556473e985d462cd51197a9a46c76009549eac6474f206c4ee0844f68389` ✓

---

## Courier response (verbatim)

From GHA run 30179639107, deploy job step 36, 2026-07-25T23:35:17Z:

```
Result: {"ok":true,"message":"Secret CLOUDFLARE_API_TOKEN created in jeffunglesbee-create/field-playground"}
✅ CLOUDFLARE_API_TOKEN synced to field-playground
```

HTTP 201 (created). jubilant-bassoon step 35 also passed (updated, HTTP 204):
```
Result: {"ok":true,"message":"Secret CLOUDFLARE_API_TOKEN updated in jeffunglesbee-create/jubilant-bassoon"}
```

---

## deploy-playground.yml run result

Dispatched via `workflow_dispatch` at 2026-07-25T23:38:26Z.

Result: **success** (`4b89406`, completed ~23:40Z).

`deploy-playground.yml` ends with a live HTTP 200 assertion against
`https://field-playground.jeffunglesbee.workers.dev/`. The green run confirms
the Worker is deployed and serving — per CC-CMD: "a green run there is the
real done condition."

---

## Done condition

`https://field-playground.jeffunglesbee.workers.dev/` returns HTTP 200
with no human having entered a credential anywhere — **MET**.

---

## Commits this session

| Commit | Description |
|--------|-------------|
| `175e1f6` | ci: add field-playground CLOUDFLARE_API_TOKEN bootstrap step to deploy.yml |
| `48873cd` | fix: correct Salsa20/HSalsa20 rotation -- >> to >>> (unsigned) in sealedBox |

---

## Flag: wrangler.jsonc duplicate in field-playground

`field-playground` has both `wrangler.toml` and `wrangler.jsonc`. `.toml` is
authoritative (`deploy-playground.yml` relies on `account_id` from `.toml`).
`.jsonc` is a duplicate created in a prior chat session — currently a functional
mirror, harmless but should be removed:

```
git rm wrangler.jsonc
git commit -m "chore: remove duplicate wrangler.jsonc (wrangler.toml is authoritative)"
```

Chat cannot delete files. Requires a CC session or manual action.

---

## Pre-existing CI gate failure (not this session)

The `verify` job in `deploy.yml` continues to fail on Rule-90 staleness check:
rule-90 through rule-96 entries are >14 days UNEXERCISED. Pre-existing since
before this session (same failure blocked fece9027 and c2e667e). Separate session
required to exercise those registry entries.
