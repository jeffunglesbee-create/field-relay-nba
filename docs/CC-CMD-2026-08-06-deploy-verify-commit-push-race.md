# CC-CMD-2026-08-06-deploy-verify-commit-push-race

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-06-deploy-verify-commit-push-race.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## The real, observed bug

`.github/workflows/deploy.yml`'s `verify` job ends with a `Commit results`
step whose last line is a **bare `git push`** — no fetch, no rebase, no
retry:

```yaml
      - name: Commit results
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add outbox/live-verify-*.md
          git commit -m "chore: post-deploy live verification [skip ci]" || echo "nothing to commit"
          git push
```

This repo has many concurrent writers (probe workflows that commit to
`outbox/`, cron jobs, chat/CC sessions). Any push landing between this
job's checkout and its push makes `git push` fail with
`! [rejected] main -> main (fetch first)`, which fails the step, which
fails the `verify` job, which makes the **entire deploy run report
`failure` even though the `deploy` job and every structural probe
succeeded**.

**Real observed cost:** this produced three separate false alarms in the
2026-08-06 session alone. Each one cost a full investigation to
establish that a healthy, live deploy was not actually broken. Runs
[`31112262449`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/31112262449)
and [`30781954383`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/30781954383)
are two confirmed instances (both: `deploy` job `success`, only
`Commit results` failed). This is a Rule 77 hazard in the infrastructure
itself — it trains sessions to read `failure` as noise, which is exactly
how a real deploy failure eventually gets waved through.

**Second, latent defect in the same step:** `git add outbox/live-verify-*.md`
has no `|| true` and the step runs under `bash -e`. `git add` is atomic
across pathspecs — an unmatched glob returns non-zero and aborts the
step. This has the same shape as a real bug found and fixed on
2026-08-06 in `soccer-league-mislabel-scope-probe.yml`, where an
unmatched `*.sql` glob silently prevented a `.log` from ever being
staged.

## Task 1 — Probe from HEAD before changing anything (Rule 87)

Do not trust the YAML quoted above; re-read it fresh — the line numbers
and content may have moved.

```bash
git log --oneline -5
grep -n "Commit results" .github/workflows/deploy.yml
sed -n "$(grep -n 'name: Commit results' .github/workflows/deploy.yml | cut -d: -f1),+12p" .github/workflows/deploy.yml
```

- Confirm the bare `git push` is still present and still unguarded.
- Confirm whether `verify` is a separate job from `deploy` (it is as of
  `504b0e5`) — this determines whether the fix can affect deploy safety
  at all. If `verify` has been merged into `deploy` since, STOP and
  report: the risk calculus below no longer holds.
- Establish the real precedent to follow (Rule 62): this repo's probe
  workflows already use a fetch/rebase/retry loop. Read one directly,
  e.g. `.github/workflows/soccer-league-mislabel-scope-probe.yml`, and
  match that pattern rather than inventing a new one.

## Task 2 — Fix the push race

- Replace the bare `git push` with the repo's existing retry pattern
  (fetch/rebase/push, bounded attempts with backoff).
- Guard the `git add` so an unmatched glob cannot abort the step.
- **Do not blanket-swallow failures.** A push race is retryable and must
  not fail the run; a *permission* error (`403`, `denied to
  github-actions[bot]`) is a real defect and must still fail loudly.
  These are distinguishable in the push output — the fix must
  distinguish them rather than reaching for `|| true`, which would trade
  a noisy false-failure for a silent real one. If they genuinely cannot
  be distinguished, report that verbatim and stop rather than guessing.

**Scope boundary — do not touch:** the `deploy` job, any STRUCTURAL or
PROBE step, the wrangler deploy step, the Courier/proxy deploy steps, or
any secret-bootstrap step. This CC-CMD changes exactly one step in the
`verify` job.

## Task 3 — Real verification (Rule 89 — artifact required)

"The workflow looks right" is not acceptable. Required artifacts:

1. **A real deploy run whose `verify` job's `Commit results` step
   succeeds**, reported by run ID and job conclusion. Trigger it by
   whatever real change this CC-CMD itself pushes.
2. **A real forced-race test**, proving the retry actually recovers
   rather than merely not having raced. Concretely: dispatch a probe
   workflow that commits to `outbox/` so it lands in the same window as
   a deploy, then show the `Commit results` step's own log containing a
   rejected first attempt followed by a successful retry. If a natural
   race cannot be induced within the session, say so explicitly and
   report the unforced-run evidence as partial — do not claim the race
   path is verified when only the happy path was exercised.
3. **A diff showing exactly the expected lines changed in exactly
   `.github/workflows/deploy.yml`** and no other file.

## Explicitly NOT in scope

- Do not change what the `verify` job checks, or add/remove any check.
- Do not change the `[skip ci]` convention on the verification commit.
- Do not "fix" the same pattern in other workflows in this commit — if
  other workflows have a bare `git push`, list them in the outbox for a
  separate CC-CMD (Rule 69).

## Outbox

`outbox/cc-session-2026-08-06-deploy-verify-commit-push-race.md`: the
real before/after of the step, the run ID whose `Commit results` step
passed, the forced-race evidence (or an explicit statement that it could
not be induced), and the list of any other workflows found with the same
unguarded-push pattern.
