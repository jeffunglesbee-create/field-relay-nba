# RELAY_SHARED_SECRET reaches field-laboratory over OIDC

## The requirement

field-laboratory's `check:sport-vocabulary` reads the relay's games tables
through `POST /d1/execute`, which is credentialled. The value was inline in that
repo's `scripts/sport-vocabulary-check.mjs` until today, when its `check:secrets`
matched it against `docs/exposed-secrets.sha256` and failed `verify` — correctly.
That script now reads `process.env.RELAY_SHARED_SECRET` with no fallback and
fails loudly when empty, so the secret has to arrive some other way.

I recommended removing the need for it — a `GET /archive/sport-vocabulary` route,
since every GET on this relay is ungated (the block at `src/index.js:12370` is a
method allowlist returning 405, not auth; auth is the separate `X-FIELD-Relay`
check at 13885). The instruction was OIDC. Building OIDC.

## The mechanism, which already exists

From `FIELD — OIDC Authentication Pattern (Permanent Reference)`, May 18 2026:

```
CI: permissions: id-token: write
 → curl $ACTIONS_ID_TOKEN_REQUEST_URL&audience=field-deploy   (~5 min JWT)
 → POST field-deploy.jeffunglesbee.workers.dev/secret
 → Courier verifies iss / aud / exp / repository against GitHub's JWKS
 → Courier's own GITHUB_PAT sealed-box-encrypts and PUTs the repo secret
```

`workers/field-deploy/src/index.js:139` — `/secret` takes `{name, value, repo,
owner}` with an arbitrary `name`, so nothing needed extending. `deploy.yml`
already runs this three times, **including into field-laboratory** for
`CLOUDFLARE_API_TOKEN` (step 54 of run 32659418899, green).

This is a fourth step of the same shape.

## What shipped

`.github/workflows/deploy.yml`, immediately after the field-laboratory
`CLOUDFLARE_API_TOKEN` sync:

```yaml
- name: BOOTSTRAP — Sync RELAY_SHARED_SECRET to field-laboratory
  env:
    OIDC_TOKEN: ${{ steps.oidc.outputs.token }}
    RELAY_SECRET: ${{ secrets.RELAY_SHARED_SECRET }}
```

No credential in any file. The value passes from this repo's Actions secret
through the runner's environment into the Courier's sealed box. That is the
whole reason to use the Courier rather than a literal — a literal is what
field-laboratory removed this morning.

**Empty is fatal, not skipped.** Pushing an empty value would create a secret in
field-laboratory that exists and authenticates nothing, and the check there would
report the resulting 401 as "the probe failed" — the silence both repos spent
today deleting. The step exits 1 and names the manual action.

## The one manual step

`RELAY_SHARED_SECRET` must exist as an Actions secret **in field-relay-nba**:
Settings → Secrets and variables → Actions.

There is nothing to read it from otherwise. This relay's five other workflows
carry the value inline rather than as a secret, and copying one of those literals
into the sync step would recreate the exposure in a new place.

This matches the precedent exactly. From `Security incident: FIELD_MCP_SECRET
leaked twice, rotated, root-caused, history scrubbed`: *"User rotated the GitHub
Actions repo secret value (manual step, outside this session's access)."* Steady
state afterwards is zero manual steps, per the OIDC doc.

Until that secret exists, this step is red and `check:sport-vocabulary` in
field-laboratory stays red. Both reds are accurate.

## The guard

`scripts/check-courier-sync-uses-secrets.mjs`, gated in `deploy.yml`. It parses
every Courier `/secret` call in the workflow and requires the value to be a shell
expansion.

The regression it exists for is specific and tempting: the new step is red until
the secret is added, and the one-line fix for a red step is to paste the value
where the variable goes. That would put the credential into a committed workflow
in a repo where it already appears 27 times in `src/index.js`, hours after
field-laboratory removed it for exactly that reason.

Deleting the step is the other way to turn a red step green, and it blinds
`check:sport-vocabulary` permanently. Both are caught.

**Both demonstrated failing** — `--self-test` mutates the real workflow in memory:

```
self-test: the check rejects its own negative controls
  ok   a pasted literal is caught
  ok   a deleted RELAY_SHARED_SECRET sync is caught
  ok   the real workflow passes
  ok   and it found the syncs at all
```

The third and fourth are controls: a check that reds everything would satisfy the
first two while saying nothing, and a regex that stopped matching would report
zero literals out of zero syncs.

## Standing, not fixed by this

Syncing the value does not reduce its exposure. It remains a hardcoded fallback
in this repo — `env.RELAY_SHARED_SECRET || '<literal>'` — across 27 occurrences
in `src/index.js`, 1 in `src/analytics-engine.js`, 5 workflows and 8 docs. The
incident record is direct about the general case: rotation alone did not stop the
`FIELD_MCP_SECRET` leak recurring, because the root cause was the logging site.
Here the root cause is the fallback.

Dropping it is an authentication change on a live worker — every cron and every
`/d1/execute` caller 401s at the next deploy if the binding differs — so it needs
the binding's real value confirmed against the Cloudflare account first.

**Separately and more urgent:** `FIELD — OIDC Authentication Pattern Permanent
Reference May 18 2026` (Drive `1GRvHk70ScS8AGmm1EfcZgROCPUmOBBK0`) contains the
Courier's own `GITHUB_PAT` in plaintext in its one-time-setup section — a
repo+workflow-scoped token that can write secrets into all four repositories.
That is the credential this entire mechanism depends on.

## Files

- `.github/workflows/deploy.yml` — the sync step, and the guard step
- `scripts/check-courier-sync-uses-secrets.mjs` — new
