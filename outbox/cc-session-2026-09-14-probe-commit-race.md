# CC-CMD-2026-09-13-probe-commit-race-unrecoverable — Result

**Status: DONE.** Done condition met with a real conflict in a real runner.
**Confidence: 97.**

## Done condition — the race, resolved, in production

Three `Provenance Runtime Probe` runs dispatched within 9 seconds, all three
`success`:

| run | window | probe `checked_at` |
|---|---|---|
| 34797151404 | 01:49:22 → 01:49:35 | `01:49:31.093Z` |
| 34797155333 | 01:49:27 → 01:49:43 | `01:49:35.635Z` |
| 34797159013 | 01:49:31 → 01:49:54 | `01:49:39.773Z` |

`outbox/provenance-runtime-probe-latest.json` at `main` carries
**`01:49:39.773Z`** — the last run's. The later content won.

From run 34797159013's own log, which is the evidence the CC-CMD asked for
rather than "the loop looks right":

```
hint: Updates were rejected because the remote contains work that you do not have locally
CONFLICT (content): Merge conflict in outbox/provenance-runtime-probe-latest.json
error: could not apply cfb47a2... chore: provenance runtime probe result
resolved outbox/provenance-runtime-probe-latest.json by keeping this run's regenerated copy
Successfully rebased and updated refs/heads/main.
pushed on attempt 3
```

It lost the race **twice** and recovered both times. Under the old loop the
first conflict left a detached HEAD and attempts 2-5 could not succeed.

**The shallow-clone worry was unfounded.** `actions/checkout@v4` defaults to
depth 1 and my local harness uses full clones; I said before the run that if it
failed there I would fix it with evidence rather than pre-emptively. It did not
fail — git fetched what the rebase needed.

## Task 0 — the blast radius, and the file the CC-CMD warned about

Eleven workflows call `_reusable-probe.yml`. **All eleven write a TIMESTAMPED
file**, which cannot collide. **Exactly one** also writes
`provenance-runtime-probe-latest.json`, the only artifact the race can reach.
**Zero of the eleven append.**

But the CC-CMD's warning was right in a place it did not expect:
`outbox/.drive-uploaded` is an append-only ledger — `drive-upload-outbox.yml`
adds every delivered doc to it — and it lives in the directory this step stages
with `git add outbox/`. **A take-ours applied to the directory would discard
another run's Drive deliveries.** So the resolution is scoped to a
regenerated-file list, and a conflict outside that list aborts to a clean branch
and exits non-zero. That case has its own assertion and its own mutation.

## Task 1 — `|| true` swallows an exit code, not a state

A content conflict left a detached HEAD with unmerged files. Every later push
failed with "You are not currently on a branch", every later pull with "Exiting
because of an unresolved conflict". Four guaranteed-failing retries with 3/6/9/12
second sleeps between them, and the run reported the symptom of its own damage.

Now: every failure path returns to a clean branch before retrying, and a push
rejected for anything other than a non-fast-forward exits immediately — the
requirement the old comment stated and the old loop did not meet.

## Task 3 — no `concurrency:` group, decided on Task 0's numbers

Twelve workflows, one collidable artifact. Serialising all of them would trade a
resolvable conflict for cancelled or queued runs, and a cancelled probe is a
missing measurement. Recorded in `_reusable-probe.yml` beside the step.

## Task 4 — five mutations, two retargeted, and both retargets are findings

`scripts/check-probe-commit-retry.sh` builds a bare repo and two clones and makes
them fight over the same file, running the real script: **12 assertions**.

| mutation | caught by |
|---|---|
| R1 `--theirs` → `--ours` | the later run's content wins |
| R2 the 2026-09-13 `\|\| true` shape restored | the later run's content wins |
| R3 every push failure treated as a race | and says so instead of retrying into silence |
| R4 regenerated list widened to `outbox/*` | the appended ledger fails rather than picking a side |
| R5 refusal stops calling `rebase --abort` | leaves no half-rebased tree behind |

**R2 reported WRONG REASON first, and the reason is worth keeping.** Under the
old shape this script exits **zero**: the rebase leaves a detached HEAD at the
*other* run's commit, and `git push origin HEAD:main` succeeds from there as a
no-op. The old loop does not merely fail — **it can report success while
silently discarding the probe result.** The live runs failed only because the
workflow's bare `git push` refuses a detached HEAD. Same corruption, louder
symptom. Pinned on content, not exit code.

**R3 reported WRONG REASON too.** Without the guard the loop still exits 1, just
after five pointless retries. The exit code cannot tell "lost a race" from
"wrong token"; only the message can.

**R1 is the one that would have shipped.** During a rebase the replayed commit
is THEIRS, not OURS — the reverse of a merge. Picking ours keeps the run that
already pushed and looks like a clean pass.

## Automated follow-up

Eight other workflows carry the same `|| true` shape. Filed as
`docs/CC-CMD-2026-09-14-git-state-swallow-sweep.md` rather than folded into this
CC-CMD's scope, and held mechanically in the meantime:
`scripts/check-git-state-swallow.mjs` is a **ratchet** — the eight are allowed, a
ninth fails the build, and a workflow that gets fixed must leave the list or the
check goes red on the stale entry.

A gate that went red on day one would have been disabled, and a disabled gate
protects nothing. Three mutations: one adds a ninth (must go red), two add forms
that are NOT this defect — `|| git rebase --abort || true`, and the pattern
inside a comment — and must stay green.

## Confidence: 97

The behaviour is proven against a real conflict in the real runner, not only
locally. Not 99 because the harness exercises one conflicting file and the eight
unconverted workflows are held by a ratchet rather than fixed.

## Residual

**One, filed not deferred:** the eight workflows in
`CC-CMD-2026-09-14-git-state-swallow-sweep`. Two more —
`collision-cleanup.yml` and `identity-ambiguity-watch.yml` — use
`|| git rebase --abort || true`, which recovers state and so fails honestly
rather than corrupting; deliberately excluded from that list and from the
ratchet, with the reason recorded there.
