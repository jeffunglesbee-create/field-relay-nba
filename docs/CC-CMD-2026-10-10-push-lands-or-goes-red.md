# Claude Code Command — a workflow that loses its push must go red

**Date:** 2026-10-10
**Repo:** field-relay-nba
**Branch:** main — commit directly, no feature branch, no PR
**Type:** B (correctness) — a success signal that can be false
**Status:** DONE 2026-10-10. Executed in the session that filed it.
Session doc: `outbox/cc-session-2026-10-10-push-lands-or-goes-red.md`.

**Rule 47:** untouched. No relay code; this is CI hygiene.

## Why this exists

A step that commits an artifact, retries the push, loses every attempt and
still exits 0 reports a lost artifact as success. Nothing downstream can tell
that apart from a real push.

`.github/workflows/bsd-param-probe.yml` has carried a comment describing the
mechanism since before this check existed:

```
for i in 1 2 3; do
  git pull --rebase origin main && git push origin main && break
  sleep $((i * 5))
done
                 <- nothing here
```

The loop's last command is `sleep`, which succeeds. `set -e` does not fire,
because a failing `&&` list is a tested command. All three attempts can fail
and the step exits 0.

**The same class was hit live on 2026-10-10**, in a session shell rather than a
workflow: `git push origin main 2>&1 | tail -1`. A pipeline's exit status is
its LAST command's, so `tail` succeeding masked a rejected push. The retry loop
around it broke on the first attempt because `tail` returned 0, and the commit
was reported as pushed while sitting only in the local branch. Caught by
running `git merge-base --is-ancestor HEAD origin/main` afterwards — which is
the whole remedy, and is why it is now a check.

## MEASUREMENT — "no guard" is not "broken", and the first count was wrong

A grep for workflows that push and lack the is-ancestor guard returns **35 of
63**. Reporting that as 35 defects would have been wrong. Three were sampled
before any fix, and gave three different answers:

| workflow | shape | verdict |
|---|---|---|
| `odds-attribution-gap.yml` | `git pull ... && git push ...` as the block's last command | SAFE — its status IS the step's |
| `jq-health-watch.yml` | retry loop, then `echo ::error::`, then `exit 1` | SAFE — by a different route |
| `drive-upload-outbox.yml` | retry loop, then `echo "next sweep re-records"; exit 0` | a CHOICE, not a defect |

The third is the one that matters for the check's design. A daily ledger sweep
re-records anything that workflow loses, so failing the run would be noise.
A check that cannot tell a deliberate `exit 0` from an accidental one would
either fail it every day or be switched off.

**True count across 62 pushing run blocks: ONE defect.**

## MEASUREMENT 2 — the detector's own first verdict was right for the wrong reason

The first version flagged `temp-wrangler-tail.yml` as `piped`. The line is:

```
git push origin main || echo "push failed, will need manual retry"
```

That is an or-else, not a pipe. The regex `/\|(?!\|)/` matched the SECOND bar
of `||`, because that bar is not followed by a bar. Right file, right verdict,
wrong reason — and a reason that would have mislabelled every `||` in the repo.

Fixed by stripping `||` before testing for a pipe, and by giving the swallow
its own verdict. They are different defects: a single `|` hands the status to
the downstream command, `||` discards it when the right-hand side succeeds.
The defect in that file is real either way — `echo` always succeeds, so the
manual retry it names was never prompted.

## Tasks

**Task 1 — the detector.** `scripts/check-push-lands.mjs`. Classify every
`run: |` block containing a `git push`:

| verdict | meaning | fails? |
|---|---|---|
| `safe-ancestor` | loop, then `merge-base --is-ancestor` | no |
| `safe-exit1` | loop, then `exit 1` | no |
| `safe-bare` | no loop; the push is the block's last command | no |
| `deliberate-exit0` | loop, then an explicit `exit 0` | no — reported |
| `DEFECT` | loop, nothing after it | YES |
| `swallowed` | `git push ... || <something that succeeds>` | YES |
| `piped` | `git push ... \| <cmd>` | YES |
| `bare-then-more` | no loop, but work runs after the push | YES |

**Task 2 — mutations (Rule 90).** Each defect shape must be shown failing, and
each safe shape must be shown passing, before the check is trusted.

**Task 3 — fix the one defect.** `temp-wrangler-tail.yml`, to the loop plus
is-ancestor form, with the old line quoted in a comment rather than deleted.

**Task 4 — wire it.** `workflow-yaml-gate.yml` already fires on every
`.github/workflows/**` change, which is the only moment this can catch
anything. Self-test first, then the check.

## Stop conditions

- If the census reports more than a handful of defects, STOP and re-read the
  shapes before fixing any of them. A large count means the detector is
  conflating safe forms with broken ones, which is what the 35-vs-1 gap above
  already demonstrated once.
- Do NOT convert a `deliberate-exit0` to `exit 1`. Each has a stated reason and
  a backstop; failing those runs daily is how a gate gets switched off.
- Do NOT add the is-ancestor guard to a `safe-bare` block. A bare push as the
  last command already propagates, and the extra fetch costs an API call for
  nothing.

## Done conditions

1. `node scripts/check-push-lands.mjs` exits 0, with the census printed and its
   coverage denominator beside the result.
2. `--self-test` exits 0 and every defect shape has a mutation that fails.
3. The check runs in CI on any change under `.github/workflows/`.
4. `temp-wrangler-tail.yml` carries the loop and the is-ancestor guard.

## Provenance

Census run against `.github/workflows` at `main` on 2026-10-10: 159 workflow
files, 62 `run: |` blocks containing a `git push`. The live failure that
prompted it is in this session's own git history — a commit reported as pushed
that `merge-base --is-ancestor` showed was not.
