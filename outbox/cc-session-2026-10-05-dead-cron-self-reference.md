# The dead-cron watch had become its own finding

**Date:** 2026-10-05
**Repo:** field-relay-nba
**Script:** `scripts/watch-silently-dead-crons.mjs`

## The loop, measured

`if (failed) process.exit(1)` — the watch exits non-zero whenever it has
findings. Three findings in a row therefore make IT a workflow with three
consecutive failed scheduled runs, which the next run reports as new decay, and
that report exits 1 again.

Timeline from the committed logs:

| date | what made it red |
|---|---|
| 2026-10-01 | `seed-coverage.yml` went NEW |
| 2026-10-02 | `drift-sentinel.yml` went NEW |
| 2026-10-03 | third consecutive red |
| 2026-10-04 | **it listed itself** under `NEW, not in the baseline`, beside the one genuine finding |

A self-sustaining entry can never settle into the baseline, because the thing
keeping it red is its own redness. It would have sat in the NEW list forever.

## The fix: excluded, and the exclusion is PRINTED

A detector's red IS its output — `docs/declared-detectors.json` already says so
for other workflows; this applies the same rule to the file that enforces it.
Excluded rather than declared, because a declaration describes a condition
someone should fix and there is no condition here.

**Repo-qualified**, for the reason `declaredKey` is: excluding a bare path would
excuse a genuinely dead namesake in another repo, which is the exact failure
that forced repo-qualified keys on 2026-09-17. `isSelf` is tested against both.

The exclusion prints a line naming itself and why. A guard that removes a
finding without saying so is the amnesty shape this repo watches for.

## A second defect, found while testing the first

**The self-test total was the hardcoded string `28/28`.** Three assertions were
added and it still printed `28/28`. A reader comparing two runs would have seen
no change — and a DELETED assertion would have been equally invisible. Now
counted: **31/31**.

That is the rule this repo applies to confidence scores ("a self-reported number
is not evidence of anything") and had not applied to its own test count.

## Mutations: 2, not 3

- **S1** unqualified exclusion (`SELF.endsWith(path)`) — CAUGHT, the namesake
  assertion fails.
- **S3** the count reverts to the hardcoded string — CAUGHT, the printed total
  reads 28/28 against 31 assertions run.
- **S2 REMOVED.** Deleting the `if (isSelf…)` line leaves a dangling `else if`,
  so node fails to parse and the suite goes red for the wrong reason. It proved
  the parser works, not that the routing is guarded. Counting it would have
  inflated the number.

**Honest coverage boundary:** the self-test cannot reach `surveyRepo`'s routing
at all — that needs the API, and the sandbox token is a proxy placeholder. `S1`
covers `isSelf`, which is where the decision lives. The live half is verified by
dispatching the workflow and reading its committed log, which is what this
script's own COVERAGE line already says.

## Not fixed here

The watch will still exit 1 today, because `drift-sentinel.yml` is a genuine
finding. That is correct behaviour. What changes is that its own redness no
longer manufactures a second one.
