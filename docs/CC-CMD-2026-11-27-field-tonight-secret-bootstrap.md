# CC-CMD-2026-11-27-field-tonight-secret-bootstrap

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Status:** OPEN 2026-11-27. Step added; the verification below is the done condition and is not yet met.
**Owner approval:** 2026-11-27, "option 1", answering a session question that offered "go Courier" (this) or "I'll add it" (the owner pastes the
token by hand). Moving the Cloudflare token into a new repository is the owner's call, so it was asked first.
**Scope:** one workflow step. Bootstrap `CLOUDFLARE_API_TOKEN` into `jeffunglesbee-create/field-tonight` via the existing Deploy Courier.

## Why

`field-tonight` is a new, separate website (owner ruling 2026-11-27: not client, playground or laboratory), created the same day. It has a complete
Cloudflare Worker deploy (`wrangler.toml`, `.github/workflows/deploy.yml`) that has been **skipping cleanly** for one reason: no
`CLOUDFLARE_API_TOKEN` in its Actions secrets. This is the problem `field-playground` had on 2026-07-25 and `field-laboratory` on 2026-08-10
(`docs/CC-CMD-2026-07-25-playground-secret-bootstrap.md`, `docs/CC-CMD-2026-08-10-laboratory-secret-bootstrap.md`) and it has the same answer:
nothing new is needed. This CC-CMD follows the laboratory's, with one repo name changed.

## PROBE FIRST (read from HEAD, 2026-11-27, Rule 87)

1. `sed -n '25,50p' workers/field-deploy/src/index.js`: `ALLOWED_REPOS` contains `jeffunglesbee-create/field-relay-nba` (it gates the CALLER's OIDC
   `repository` claim, not the target); `OIDC_AUDIENCE` is `field-deploy`.
2. `sed -n '139,149p' workers/field-deploy/src/index.js`: `/secret` takes `{name, value, repo, owner}`; `repo` defaults to `jubilant-bassoon` and is a
   plain body parameter; an unreachable target answers `502 "Public key <status>"`; a missing Worker secret answers `500 "GITHUB_PAT Worker secret not set"`.
3. `grep -n "BOOTSTRAP" .github/workflows/deploy.yml`: the bootstrap steps for `jubilant-bassoon`, `field-playground` and `field-laboratory`, and the
   `oidc` step that feeds them. This step is the laboratory's with the repo name changed.
4. `on.push.paths` of `deploy.yml` is `src/**`, `wrangler.toml`, `workers/**`: editing the workflow alone does NOT redeploy the relay.

## NOT verifiable from the source (named, not assumed)

The Courier's stored `GITHUB_PAT` is a Worker secret. If it is scoped to specific repositories it will not reach `field-tonight`; the call then answers
`502 Public key 404` (or 403) and **writes nothing**. The laboratory's step has the same property and is not known to have been tested against a repo
created after the PAT. If that happens, the fix is the owner's (widen the PAT, or paste the token by hand), not a Courier change.

## TASK 1 — add one step (DONE in this commit)

After the `field-laboratory` bootstrap step: `BOOTSTRAP — Sync CLOUDFLARE_API_TOKEN to field-tonight`. It reuses `steps.oidc.outputs.token` (no second
OIDC step, no second job), takes the value from `secrets.CLOUDFLARE_API_TOKEN` through an env var (never a literal), and is `continue-on-error: true`
with `exit 1` on a bad answer, as the laboratory's is: loud in the step, not a red relay deploy. No `set -x` around the token.

## TASK 2 — VERIFY, inside this session (not a carry-forward)

1. Dispatch `Deploy RELAY Worker` (`deploy.yml`) on this repo. It redeploys the relay from `main` HEAD, which is the code already deployed. Read the new
   step's log: it must print `"ok":true`.
2. Dispatch `deploy.yml` in `field-tonight`. It must leave the skip path and run Build, Deploy and the confirm step.
3. `curl -s https://field-tonight.jeffunglesbee.workers.dev/version.txt` (from a runner; the sandbox cannot reach `*.workers.dev`) returns the SHA the
   `field-tonight` deploy run names.

**Done condition:** that URL serves the `field-tonight` page and its `version.txt` equals the deployed commit, with no human having entered a credential.

## Explicitly NOT in scope

- No Courier code change (the caller is already allowed; the target is a body parameter).
- No new credential: the value is this repo's existing `CLOUDFLARE_API_TOKEN`; nothing new is stored and no value passes through chat.
- No change to `field-tonight`'s workflows.
- The open owner items in the laboratory's CC-CMD (the plaintext PAT in the Drive "Deploy Courier v3 Reference") are unchanged and not acted on here.

## Outbox

`outbox/cc-session-2026-11-27-field-tonight-secret-bootstrap.md`.
