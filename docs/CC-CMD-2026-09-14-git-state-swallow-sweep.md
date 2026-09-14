# CC-CMD-2026-09-14 — eight workflows still hide a failed pull behind `|| true`

Filed per Rule 87.4 from `CC-CMD-2026-09-13-probe-commit-race-unrecoverable`,
which fixed this shape in `_reusable-probe.yml` and measured where else it lives.
Not deferred without a spec, and not silently folded into that CC-CMD's scope.

## Measured 2026-09-13

`grep -rn "pull --rebase --autostash.*|| true" .github/workflows/*.yml`, with the
recover-then-swallow form excluded:

```
brief-sport-authority-census.yml
codex-overwrite-diagnostics.yml
codex-queue-adjudicate.yml
codex-undetermined-watch.yml
odds-coverage-census.yml
provenance-census.yml
session-health-queue-probe.yml
timetravel-window-watch.yml
```

Two more — `collision-cleanup.yml` and `identity-ambiguity-watch.yml` — carry
`|| git rebase --abort || true`. That is a LESSER defect and deliberately not on
the list.

**MEASURED 2026-09-14, not asserted.** `scripts/check-abort-form-loop.sh`
extracts the real loop text from each YAML and races it. Both, for both
workflows:

```
ends on a branch, not detached          main
leaves no half-rebased tree             no
exits non-zero rather than succeeding   1
the losing run's content does NOT land  the other run's
```

So the exclusion is earned: it recovers state. **And the cost is larger than
"lesser defect" suggested** — the losing run fails and its artifact never lands.
For `identity-ambiguity-watch` that is a lost measurement, and a lost
measurement in a watch is exactly the failure the watch exists to prevent.

Converting these two is therefore worth more than the `|| true` eight in one
respect: those eight fail loudly and visibly, while a watch that silently fails
to record looks identical to a watch with nothing to report.

## Why it matters

`|| true` swallows the exit code but not the STATE. A content conflict leaves a
detached HEAD with unmerged files; every later push fails with "You are not
currently on a branch" and every later pull with "Exiting because of an
unresolved conflict". The remaining attempts are guaranteed failures with real
sleeps between them, and the run reports the symptom of its own damage rather
than the original race. Measured on runs 34737627491 and its NFL EPA sibling:
both probes succeeded, both runs concluded failure.

## Already held

`scripts/check-git-state-swallow.mjs` runs in `deploy.yml` as a RATCHET: the
eight above are allowed, a ninth fails the build, and a fixed workflow must be
removed from the list or the check goes red for a stale entry. So this cannot
get worse while it waits.

## Tasks

0. **Read each of the eight before changing it.** They do not all stage the same
   paths or write the same commit message, and two are not probes at all. **The
   artifact is a per-workflow line: what it stages, what message it commits, and
   whether any file it writes is APPENDED rather than regenerated.** The
   appended case exists in this repo — `outbox/.drive-uploaded` — and a
   take-ours applied to it discards another run's Drive deliveries.

1. **Convert each to `scripts/probe-commit-retry.sh`** where its staging matches
   (`git add outbox/`). Where it does not, either widen the script's inputs or
   record why that workflow keeps its own loop.

2. **Remove each converted workflow from `KNOWN`** in
   `scripts/check-git-state-swallow.mjs` in the same commit. The check fails on
   a stale entry, so this cannot be forgotten.

3. **Mutation (Rule 90).** For any workflow given a loop that is not the shared
   script, drive it through `scripts/check-probe-commit-retry.sh`'s harness or
   an equivalent. A retry loop that has only ever run unconflicted has proven
   nothing — which is how the original shipped.

4. **Outbox manifest** per Rule 67.

## Done condition

`scripts/check-git-state-swallow.mjs` reports `0 still swallow, 0 allowed`, and
every converted workflow has a committed run showing a real conflict resolved —
not "the loop looks right" (Rule 89).

## Not claimed

That the eight are the only sites. The grep covers `pull --rebase --autostash`;
a `git merge … || true` or a `git cherry-pick … || true` would not have matched
it, though the check's own pattern does cover those verbs going forward.
