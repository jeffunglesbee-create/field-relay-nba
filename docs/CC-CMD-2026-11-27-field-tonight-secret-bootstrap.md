# CC-CMD-2026-11-27-field-tonight-secret-bootstrap

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Status:** OPEN 2026-11-27. Step added in `24d07a5`. TASK 2 step 1 was run (relay deploy `46056375985`) and **the bootstrap step was SKIPPED**:
the job failed at its own gate, step 132 "a staged claim names a verifier that exists and runs", on a pre-existing orphan. The same guard fails on
`24d07a5~1`, so it is not this change. Cause: `db0828a` (2026-11-27 16:16Z, a docs commit by another session) added a STAGED claim to
`docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md` ("the 524-row write", blocked on the owner's word) with no `(verifier: <id> @ relay/staged-verification.yml)`
tag. No relay deploy was due between 16:16Z and the dispatch (no `src/`, `wrangler.toml` or `workers/` commit), so nothing in production was blocked yet; the NEXT
push to those paths will fail at step 132 until the claim is tagged. **Not fixed here:** the right verdict id (from `scripts/staged-verdicts.mjs`) is the claim
owner's choice. TASK 2b below does the one approved call without the gate.
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

## TASK 2b — a one-shot, because step 132 blocks TASK 2 (added 2026-11-27)

`.github/workflows/set-field-tonight-secret.yml`, triggered by `outbox/.trigger-set-field-tonight-secret`. The same Courier call as the deploy.yml step, target and
secret name fixed (no inputs), value from `secrets.CLOUDFLARE_API_TOKEN` via env, the Courier's reply (never the value) written to
`outbox/field-tonight-secret-sync-latest.txt`. It does not deploy the relay, so it bypasses nothing the gate protects; the deploy.yml step stays for rotation.
Verify as TASK 2 steps 2 and 3 once the reply says `"ok":true`.

## Explicitly NOT in scope

- No Courier code change (the caller is already allowed; the target is a body parameter).
- No new credential: the value is this repo's existing `CLOUDFLARE_API_TOKEN`; nothing new is stored and no value passes through chat.
- No change to `field-tonight`'s workflows.
- The open owner items in the laboratory's CC-CMD (the plaintext PAT in the Drive "Deploy Courier v3 Reference") are unchanged and not acted on here.

## Outbox

`outbox/cc-session-2026-11-27-field-tonight-secret-bootstrap.md`.
