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

## Update: TASK 2 step 1 was run, and the bootstrap step was skipped

Dispatched `Deploy RELAY Worker` (run `46056375985`, head `24d07a5d`, 2026-11-27 19:23Z). It failed at step 132, `a staged claim names a verifier that exists and runs`
(`scripts/staged-verifier-check.mjs`), and the 38 steps after it, including the Courier and Claude-proxy deploys and every bootstrap step, were skipped.

- **Not caused by this change, measured:** `node scripts/staged-verifier-check.mjs` exits 1 on `24d07a5` AND on `24d07a5~1`.
- **Cause:** `db0828a` (16:16Z, docs only, another session) added a STAGED paragraph at `docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md:468` with no verifier tag.
- **Impact:** none yet, measured: no commit touching `src/`, `wrangler.toml` or `workers/` landed after 16:16Z, so no push-triggered deploy was due. The next one will fail at step 132.
- **Not fixed by this session:** tagging it needs a verdict id from `scripts/staged-verdicts.mjs`, chosen by the owner of that 524-row staged write.
- **What this session did instead:** TASK 2b, a one-shot workflow making the same approved Courier call. It is not a second rotation mechanism.

STILL NOT VERIFIED: that the Courier's `GITHUB_PAT` reaches `field-tonight`, and the deploy and `version.txt` checks. UNTESTED until the one-shot's reply is read.
