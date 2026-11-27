# Session doc: the field-tonight secret bootstrap (Rule 67)

**Date:** 2026-11-27. **Repo:** field-relay-nba. **CC-CMD:** `docs/CC-CMD-2026-11-27-field-tonight-secret-bootstrap.md`.
**Branch:** main. **Owner approval:** "option 1" (2026-11-27), to a question offering the Courier route or pasting the token by hand.

## HEAD progression

`a847890` -> this commit.

## What was built

One step in `.github/workflows/deploy.yml`: `BOOTSTRAP — Sync CLOUDFLARE_API_TOKEN to field-tonight`, after the field-laboratory one. Same shape, same
OIDC token, `continue-on-error: true`, value from `secrets.CLOUDFLARE_API_TOKEN` via env.

## Verified here (before the push)

`workflow-yaml-check.mjs`: 233 workflow files, 0 failing; the new step parses (169 steps in the job). `check-push-lands.mjs` (17/17 self-tests, 0 defects);
`check-no-literal-secret-writes.mjs` (no workflow installs a credential from a literal); `check-exposed-secrets.mjs`; `check-workflow-timeouts.mjs`;
`check-workflow-if-eval.mjs`: all exit 0.

## NOT verified yet (the CC-CMD's TASK 2 is the done condition)

- That the step prints `"ok":true`. Unknown: whether the Courier's stored `GITHUB_PAT` reaches `field-tonight` (see the CC-CMD). A `502 Public key`
  answer means it does not.
- That `field-tonight`'s deploy leaves the skip path, and that `https://field-tonight.jeffunglesbee.workers.dev/version.txt` equals the deployed commit.

## Integration status (Rule 65)

RELAY CONTRACT: the Courier's `POST /secret {name, value, repo, owner}`, unchanged. CLIENT CONSUMER: `field-tonight`'s `deploy.yml`, which reads
`secrets.CLOUDFLARE_API_TOKEN`. INTEGRATION STATUS: UNTESTED until the dispatch below runs. KNOWN MISMATCHES: none observed.
