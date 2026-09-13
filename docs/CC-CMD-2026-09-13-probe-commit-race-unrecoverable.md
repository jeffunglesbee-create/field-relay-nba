# CC-CMD-2026-09-13 — the probe commit retry loop cannot recover from the race it exists for

Filed per Rule 87.4 from `CC-CMD-2026-09-13-team-key-sport-blind`, whose deploy
burst made this visible. It is not that CC-CMD's work and it is not deferred
without a spec.

## Measured

Runs 34737627491 (`Provenance Runtime Probe`) and its sibling NFL EPA probe both
concluded `failure` on 8ce0bc6 at 2026-09-13T04:20Z. **The probe step succeeded
in both.** Only `Commit result` failed.

From the job log:

```
8240e41..f265306  main -> origin/main
Auto-merging outbox/provenance-runtime-probe-latest.json
CONFLICT (content): Merge conflict in outbox/provenance-runtime-probe-latest.json
Rebasing (1/1)
error: could not apply ff736ee... chore: provenance runtime probe result [skip ci]
...
fatal: You are not currently on a branch.
error: Pulling is not possible because you have unmerged files.
fatal: Exiting because of an unresolved conflict.      <- repeated 3x, then exit 1
```

## The defect

`.github/workflows/_reusable-probe.yml:92-107`. The comment above the step states
the requirement:

> a race against a concurrent writer must not fail the run; a real permission
> failure must still fail loudly, not be swallowed.

The loop does not meet it:

```yaml
for i in 1 2 3 4 5; do
  if git push; then echo "pushed on attempt $i"; exit 0; fi
  git pull --rebase --autostash origin main || true
  sleep $((i * 3))
done
exit 1
```

`|| true` swallows the rebase's exit code but **not its state**. A content
conflict leaves the repo mid-rebase: detached HEAD, unmerged files. Every
subsequent `git push` then fails with `You are not currently on a branch`, and
every subsequent `git pull` with `Exiting because of an unresolved conflict`.
The remaining attempts cannot succeed — they are guaranteed-failing retries, and
the 3/6/9/12s sleeps between them are pure wall-clock.

**`|| true` on a command that mutates repository state is the general shape.** It
converts a failure into a silently corrupted working tree, which is worse than
the failure, because the loop then reports the symptom of its own damage rather
than the original race.

## Why "take ours" is the correct resolution, not a merge

`outbox/provenance-runtime-probe-latest.json` is REGENERATED WHOLE by every run.
It is not accumulated. Two concurrent runs do not have two half-truths to
reconcile: each has a complete, current probe result, and the later one
supersedes. A textual merge of two complete JSON documents is meaningless — which
is exactly why git cannot do it and raises a conflict.

Check every `*-latest.*` artifact before assuming this generalises: a file that
APPENDS (a ledger, a log) must NOT take-ours, and if any exists this needs two
resolutions, not one.

## Tasks

0. **Probe which files the reusable probe writes, and whether each is
   regenerated or appended.** `grep` every caller of `_reusable-probe.yml` for
   its `commit_message` and the paths its probe script writes. **The artifact is
   that list, each file marked REGENERATED or APPENDED**, because the fix
   differs between them and a wrong classification silently discards history.

1. **Make the loop recover its own state.** On a failed rebase, return to a
   clean branch before retrying — `git rebase --abort` (or `--skip`), then
   re-apply. Never leave a mutating git command's failure unhandled behind
   `|| true`. A permission failure must still exit non-zero (the existing
   requirement, currently also unmet — it is indistinguishable from the race).

2. **Resolve regenerated artifacts by taking the local copy.** For files Task 0
   marks REGENERATED. Do not add a merge driver for APPENDED files in this
   CC-CMD; if Task 0 finds any, that is a third task, written before this one
   closes.

3. **Consider serialising instead.** A `concurrency:` group on the probe
   workflows would prevent the race rather than resolve it, and is smaller than
   either. Weigh it against the cost: concurrency cancels or queues probe runs,
   and a cancelled probe is a missing measurement. **Decide on evidence from
   Task 0's list and record the reason either way** — this task is satisfied by
   a written decision, not by picking one.

4. **Mutation (Rule 90).** Simulate the race: create the conflict locally
   (two branches each rewriting the same `-latest.json`), run the fixed loop,
   and assert it pushes. Then break the recovery and assert it goes red. A retry
   loop that has only ever run unconflicted has proven nothing — which is how
   this shipped.

5. **Outbox manifest** per Rule 67.

## Done condition

Two probe workflow runs racing on the same file both conclude `success`, with
the later run's content winning, demonstrated by the committed run IDs and the
resulting file. Not "the loop looks right" (Rule 89).

## Not claimed

That this only affects the two probes observed. Every workflow using
`_reusable-probe.yml` shares the step; Task 0 exists because the blast radius is
unmeasured.
