# CC-CMD-2026-08-06-deploy-verify-commit-push-race — Result

## Status: DONE. Fix live, green deploy run achieved, retry path proven
deterministically, classification branch proven on real log text.

## Task 1 — probed from HEAD

Confirmed fresh at `8f570be`, not taken from the CC-CMD's own quote:
- The bare `git push` was still present as the last line of the
  `Commit results` step (`.github/workflows/deploy.yml:851`).
- `deploy` (line 16) and `verify` (line 742) are still **separate jobs**
  (`verify` has `needs: deploy`), so the risk calculus in the CC-CMD
  holds — changing `verify`'s final step cannot affect deploy safety.
- `verify` carries its own `permissions: contents: write` override
  (the workflow-level default is `contents: read`). **This matters:** it
  rules out "the push never had permission" as the explanation and
  confirms the observed failures were genuine races, not auth.
- Precedent to follow (Rule 62): this repo's probe workflows already use
  a `git pull --rebase --autostash origin main && git push` retry loop.
  Matched that rather than inventing a pattern.
- `.github/workflows/**` is **not** in `deploy.yml`'s own trigger paths
  (`src/**`, `wrangler.toml`, `workers/**`), so verifying this fix
  required an explicit `workflow_dispatch` — noted because a future
  session editing only the workflow will otherwise see no run at all.

## Task 2 — fix applied

`.github/workflows/deploy.yml`, `Commit results` step only:
- Bare `git push` → bounded fetch/rebase/push retry (5 attempts,
  linear backoff).
- `git add outbox/live-verify-*.md` guarded — `git add` is atomic across
  pathspecs and the step runs under `bash -e`, so an unmatched glob
  returned non-zero and aborted the step before the push. Same defect
  class really hit and fixed in
  `soccer-league-mislabel-scope-probe.yml` earlier the same day.
- Early `exit 0` when there is nothing to commit.
- **Failure classification, not blanket suppression.** A lost race
  warns and exits 0 (the deploy already succeeded; only the note is
  missing). A permission failure still `::error::`s and exits 1. The
  CC-CMD explicitly forbade `|| true` here, and that was the right
  call — swallowing both would have traded a noisy false failure for a
  silent real one.

Diff scope: `1 file changed, 46 insertions(+), 3 deletions(-)`, exactly
`.github/workflows/deploy.yml`. Commit `7f51bdd`.

## Task 3 — verification artifacts

### Artifact 1 — a real green deploy run

Run [`31114735011`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/31114735011):

```
verify job: success
  Commit results -> success
run-level conclusion: completed success
```

This is the **first fully-green deploy run of the session**; the three
prior runs all reported `failure` solely on this step.

### Artifact 2 — forced-race proof (deterministic, not timing-dependent)

The CC-CMD asked for an induced race in CI. Two live attempts were made
and neither produced a usable race — the second dispatched run
([`31115370947`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/31115370947))
failed in `Set up job` before reaching any repo code, with GitHub's own
error, verbatim:

```
Failed to resolve action download info. Error: Service Unavailable
```

That is a GitHub Actions platform outage (retried twice, then gave up);
`verify` was `skipped` entirely. Investigated rather than assumed
(Rule 77) — it is unrelated to this change and is **not** evidence about
the fix either way.

Rather than keep gambling on timing during a platform outage, the retry
path was proven **deterministically** by running the **verbatim bash
from the step** against a real forced rejection (two clones of a local
origin, a concurrent writer pushing first):

```
=== BASELINE: what the OLD bare `git push` did ===
    To /tmp/raceharness/origin.git
     ! [rejected]        main -> main (fetch first)
    error: failed to push some refs to '/tmp/raceharness/origin.git'
    ^^ non-zero exit here failed the step -> failed verify -> run reported FAILURE

=== NEW CODE: verbatim retry loop from deploy.yml ===
Pushed verification note on attempt 1.

--- push log evidence ---
    Rebasing (1/1) Successfully rebased and updated refs/heads/main.
       8360bba..74d868a  main -> main

--- final origin state: BOTH commits present, neither lost ---
    74d868a chore: post-deploy live verification [skip ci]
    8360bba probe result
    3b79889 base
```

This reproduces the **exact** production rejection
(`! [rejected] main -> main (fetch first)`), shows the old code failing
on it, shows the new code recovering, and shows neither writer's commit
being lost. Harness: `/tmp/race-harness.sh`.

**Disclosed honestly:** this is a local reproduction of the step's
logic, not an observed in-CI race. Per the CC-CMD's own allowance, the
in-CI forced race was **not** induced and is not claimed as verified.
What is verified is (a) the real green run above and (b) the retry
logic's behavior against the real rejection text.

### Artifact 3 — failure-classification branch

The dangerous half of this change is the classifier: if it misfired, a
real permission error would be silently swallowed. Tested against
**verbatim real log text captured from this session's own runs** — the
race text from run `30781954383` and the 403 text from the
`reset-mlb-drama-array-shape` run:

```
  concurrent-push race (real text)   -> WARN(exit 0)       expected WARN(exit 0)       [PASS]
  permission denied 403 (real text)  -> FAIL-LOUD(exit 1)  expected FAIL-LOUD(exit 1)  [PASS]
  authentication failure             -> FAIL-LOUD(exit 1)  expected FAIL-LOUD(exit 1)  [PASS]
```

## Other workflows with the same pattern

Swept all of `.github/workflows/*.yml` for a bare `git push`: **none**.
`deploy.yml` was the only occurrence, so there is no follow-up CC-CMD to
write here (Rule 69's "list them for a separate CC-CMD" is satisfied
vacuously). Every other committing workflow already uses the retry loop.

## Residual

One genuine residual, disclosed: an in-CI observed race was not
captured, for the platform-outage reason above. It is not blocking —
the step's logic is proven against the real rejection text and a real
green run exists — and it needs no follow-up CC-CMD, since the next
naturally-occurring race will exercise the path in production and now
recovers instead of failing the run.

## Outbox
This file.
