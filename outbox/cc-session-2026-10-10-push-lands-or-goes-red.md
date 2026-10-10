# CC session — a workflow that loses its push must go red

**Date:** 2026-10-10
**Repo:** field-relay-nba, branch `main`
**Spec:** `docs/CC-CMD-2026-10-10-push-lands-or-goes-red.md` — 4 tasks, 3 stop conditions
**Outcome:** all 4 executed, all 4 done conditions met, no stop condition hit.

## Where this came from

Not from an audit. From a live failure in the preceding session, in my own
shell rather than in a workflow:

```
for i in 1 2 3 4; do git push -u origin main 2>&1 | tail -1 && break || sleep ...; done
```

A pipeline's exit status is its LAST command's. `tail` always succeeds, so the
loop broke on the first attempt and the commit was reported as pushed while
sitting only in the local branch. It was caught by running
`git merge-base --is-ancestor HEAD origin/main` afterwards, which is the entire
remedy and is now the check.

## The count I almost published

A grep for pushing workflows without the is-ancestor guard returns **35 of 63**.
I was one step from reporting 35 defects. Sampling three first gave three
different answers — one safe by `&&` propagation, one safe by a trailing
`exit 1`, one a deliberate `exit 0` with a stated backstop.

**True count: 1 defect in 62 pushing run blocks.** The 35 was the absence of
one particular remedy, not the presence of a defect, and those are different
facts.

The deliberate case is the one that shaped the design.
`drive-upload-outbox.yml` ends its retry loop with
`echo "ledger push lost every attempt; next sweep will re-record"; exit 0` —
a daily sweep re-records anything lost, so failing the run would be noise. A
check that could not tell that from an accidental fall-through would fail it
every day until someone switched the check off.

## The detector's own first verdict was right for the wrong reason

It flagged `temp-wrangler-tail.yml` as `piped`. The line is
`git push origin main || echo "push failed, will need manual retry"` — an
or-else, not a pipe. The regex `/\|(?!\|)/` matched the SECOND bar of `||`,
because that bar is not followed by a bar.

Right file, right verdict, wrong reason — and a reason that would have
mislabelled every `||` in the repo. Fixed by stripping `||` before testing for
a pipe and giving the swallow its own verdict, with a self-test asserting the
two produce DIFFERENT verdicts so they cannot silently merge again.

The defect is real under either label: `echo` always succeeds, so the manual
retry that line names was never prompted.

## Verified

```
17/17 self-tests, every defect shape caught by a mutation
62 pushing run blocks across 159 workflows:
   28  safe-ancestor
   26  safe-exit1
    4  safe-bare
    3  deliberate-exit0   (reported, not failed)
    0  defects
PASS: 0 defect(s)
```

`workflow-yaml-check.mjs`: 159 files, 0 failing — the new step did not break
the gate it was added to.

Wired into `workflow-yaml-gate.yml`, which already fires on every
`.github/workflows/**` change. The self-test runs first, so a check that can no
longer fail is caught before its verdict is trusted.

## Carry-forwards

**None.**

One limitation, stated in the check's own output rather than here: shell is
read as text, not YAML-parsed, so a push built from a variable would be missed.
Parsing the YAML strictly would mean re-emitting shell these files carry
verbatim, which is how a checker starts testing its own round-trip instead of
the file.
