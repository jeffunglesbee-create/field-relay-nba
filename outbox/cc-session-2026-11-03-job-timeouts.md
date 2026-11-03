# CC session — 2026-11-03 — the Drive upload cannot hang for hours, and a check holds it

**State:** TASK 1 of `docs/CC-CMD-2026-11-03-workflow-jobs-have-no-time-limit.md` is built and pushed with this record. `drive-upload-outbox.yml` now carries a 120 s request limit and a 15-minute job limit, and a new check fails when either is removed or raised past its cap. Run against a local server that accepts the request and never answers, the unedited upload step was still waiting at 150 s; the edited step failed at 120 s with exit 1 and wrote nothing to the ledger file. The CI runs of the push itself are read in the next commit. TASKS 2 and 3 of the CC-CMD are not started.

## Why

The 14:04Z close-out left one item "Open, small": `drive-upload-outbox.yml` had no request timeout and no job timeout, after run 41650246688 attempt 1 held a runner for 941 s on one Apps Script request and ended `Connection reset by peer`. A search of `docs/` and `HANDOFF.md` by content (BUILD-ON-A: `timeout-minutes`, `urlopen`, `drive-upload-outbox`, `hung`, `runner minutes`, `6 hours`, `360 min`, `cancel-in-progress`) found no CC-CMD that owned it. The only mention of `timeout-minutes` is TASK 4b of `docs/CC-CMD-2026-11-02-scheduled-job-skipped-every-time.md`, for the client's `patent-watch.yml`, which this work does not touch.

## The approval, as it was given

My previous message ended: "reply `Next approved` and I file one CC-CMD for the missing job timeouts (79 of 200 workflow files). I then build its first task: a request timeout and a job limit on `drive-upload-outbox.yml`, with a guard that fails when either is removed. I push to `main` and read the `Repo guards` run to green." The owner replied "Next approved" (Tuesday 15:33 ET). That is the scope: one CC-CMD, its first task, a push to `main`, a read of `Repo guards`. Not approved, and not done: the ratchet over the other workflows (TASK 2), the burn-down (TASK 3), any other workflow file, the `session_health` additive fields, any dispatch, any Odds API call.

The "79 of 200" in that message was a text count that included 13 files which only call reusable workflows. A parse gives the real figure (below), and the CC-CMD carries the correction.

## What was built

| | |
|---|---|
| The CC-CMD | `docs/CC-CMD-2026-11-03-workflow-jobs-have-no-time-limit.md`: the measurements, the rulings and holds it honours, the premises table, TASKS 1 to 3, six done conditions |
| The parser, lifted | `scripts/lib/parse-workflow-yaml.mjs`, moved unchanged out of `scripts/workflow-yaml-check.mjs` so a second check can share it. The gate prints the same line before and after (`workflow-yaml-check: 200 workflow file(s) in .github/workflows, 0 failing`), and `scripts/mutate-workflow-if-eval.mjs` is still 25 of 25 |
| The fix | `drive-upload-outbox.yml`: job `upload` gets `timeout-minutes: 15`, and the generated Python calls `urlopen(req,timeout=120)`. A comment block carries the numbers. The ledger step, which a ruling calls "a CHOICE, not a defect" (`docs/CC-CMD-2026-10-10-push-lands-or-goes-red.md`), is untouched |
| The guard | `scripts/lib/workflow-timeouts.mjs` (the judge), `scripts/check-workflow-timeouts.mjs` (a 63-case self-test, and the live check of the protected set, which is `drive-upload-outbox.yml`), `scripts/mutate-workflow-timeouts.mjs` (Rule 90); a step in `workflow-yaml-gate.yml` runs the live check when a workflow changes, and a step in `guards.yml` runs the self-test and the mutants on every push |

**The values.** From the job-level timings of the last 100 runs (since 2026-10-19): the slowest whole upload step was 46 s and the slowest job 112 s. A request limit of 120 s is 2.6 times the step and an eighth of the 941 s hang; a job limit of 15 minutes is eight times the job. The check refuses a request limit above 300 s and a job limit above 30 minutes, so the numbers cannot drift back to GitHub's default of 360 minutes unnoticed.

**What the request limit is.** `urlopen`'s timeout is a wait for the peer, not a deadline for the exchange. Probed: a local server answered one byte a second for 8 s, and `urlopen(timeout=3)` read all of it without raising, 8.0 s after it started. The limit ends a peer that goes silent. A peer that keeps sending is ended only by the job limit, which is why both are required. The workflow's comment and the judge's header say so.

## What it was proven against

**The upload step, against a local server.** The step's script was parsed out of each workflow file (PyYAML `safe_load`, not retyped); its `/tmp/` paths were redirected to a private directory; nothing else was changed. The server read the full request in every run (a 127-byte POST).

| | a server that answers | a server that accepts and never answers |
|---|---|---|
| the step as it was | `OK … -> Drive doc DOC123`, `Results: 1 uploaded, 0 failed`, exit 0, the basename written to the uploaded-ok file | after 150 s still waiting, stopped by the harness (exit 124); output ends at `Uploading: …`; nothing written |
| the step as edited | the same | at 120 s: `FAIL … response: {"error": "timed out"}`, `Results: 0 uploaded, 1 failed`, exit 1; nothing written, so the next sweep retries the document |

**The check, on the real file.** Read from git, the workflow as it was before the fix gives two findings and exit 1: `job "upload" sets no timeout-minutes` and `request in job "upload", step "Upload to Drive via Apps Script" has no timeout= keyword`. The fixed workflow gives none and exit 0, and the check prints what it looked at: `checked 1 of 201 workflow file(s): 1 job(s) and 1 urlopen call(s). The other 200 file(s) are NOT judged here`.

**The mutants.** 28 of 28 caught, each with a unique, applied anchor, the unmutated control green before and after, about 12 s. They are made in a copy under the temp directory, so an interrupted run leaves nothing to restore. Ten fixture directories, made from the real workflow's text, run through the real check: the workflow as it is beside an unbounded decoy (exit 0: a file outside the protected set is not judged), each limit removed, both removed, the job limit 360, `timeout=None`, `timeout=3600`, the Python rewritten to another call (nothing left to judge is a finding, not a pass), the file missing, and a file that is not YAML. With the self-test layer switched off for a one-off run, the fixtures alone catch 17 of 28: removal of either limit, both caps, `timeout=None`, the strict rule for a rewritten step, the protected list, and seven mutations of the live check. The other 11 are ten edge conditions of the judge (zero, a quoted number, a variable, an unclosed call, a reusable-workflow job, a workflow with no job, the argument scan, the word boundary, the keyword match) that the real workflow's shape does not exercise, and the `--self-test` flag itself, which the fixtures never run; the 63-case self-test owns them.

**The wiring.** A check that no workflow runs fails nothing. The harness parses `workflow-yaml-gate.yml` and `guards.yml` and requires the step that runs the live check and the step that runs the self-test and the mutants; and each of those two tests goes red when its step is taken out (shown in a temp copy of the tree, exit 1, with the one reason). That proves the steps are in the files. The runs of the push are the evidence that GitHub ran them.

**Other local gates, on the rebased tree.** `workflow-yaml-check.mjs`: 201 files, 0 failing. `check-push-lands.mjs`: 17 of 17 self-tests, 0 defects. `check-exposed-secrets.mjs`, `check-no-literal-secret-writes.mjs`, `check-d1-batch-param-cap.mjs` and `check-aggregate-launders-unknowns.mjs`, the two guards that enumerate `scripts/`: pass.

## What was measured, and a correction

- **A parse, not a text count** (PyYAML, all 200 files then, 0 unparsed): 202 jobs; 13 call a reusable workflow and cannot take the key; of the other 189, 121 set `timeout-minutes` and **68 do not, in 66 files**. 39 files are scheduled, 15 with a job lacking a limit. Two jobs set 360, which is GitHub's default and bounds nothing.
- **At the head this push is rebased onto** (`91dd2276`): 203 jobs in 201 files. The Drive job now has its limit, and `worker-cpu-read.yml`, added today by another session, arrived with `timeout-minutes: 5`. Of 190 non-reusable jobs, 123 set a limit and **67 do not, in 65 files**; 14 scheduled files have a job lacking one. A TASK 2 baseline written now would hold 69 (the 67 and the two at 360), not the 70 the CC-CMD first stated.
- **A run-level duration is not a job duration.** `updated_at` minus `run_started_at` reported 967 s for a run whose upload step took 3 s. The earlier sentence in the patent-watch session doc, "the 14 completed runs before it took 8 to 30 s", was a sample of 14; the 100-run job-level figures above replace it.

## What is not established

- **Why the Apps Script request hung.** One occurrence, and the Apps Script side cannot be read from here.
- **Whether the ledger step runs after a job-level timeout.** GitHub's behaviour for `if: always()` when the job itself times out was not tested, and cannot be from here. It matters only if the job limit is reached, which takes about seven timed-out requests in a row (7 × 120 s is 840 of the 900 s) or a peer that sends slowly. If the ledger step does not run then, documents that landed earlier in that job would not be recorded, and the next sweep would upload them again (the Apps Script does not dedupe).
- **A peer that sends a byte at a time.** Bounded by the job limit only, by the probe above. A total deadline on the process (for example `timeout 150 python3 …`) would bound it at the request level; it was not added, because the approved scope was a request timeout and a job limit.
- **A real timeout in production.** Done condition 6 of the CC-CMD. It may never be observable on demand.
- **The push's own runs.** `Repo guards`, `Workflow YAML Gate` and `FIELD Outbox to Drive` on the head of this push are read in the next commit, which ticks done conditions 1 and 3. The new session document in this push is the one the Drive run should deliver (`Results: 1 uploaded, 0 failed`).
- **That the live check fails in CI.** It was shown red locally on the pre-fix file. A red run in CI is not produced on purpose, because it would put `main` red.

## Docs changed

- `docs/CC-CMD-2026-11-03-workflow-jobs-have-no-time-limit.md`: filed, then updated here (Status, the census at the push head, the premises table, TASK 2's baseline 70 to 69, TASK 3's 15 scheduled files to 14, the Observed entry).
- `HANDOFF.md`: a new close-out entry at the top; the "Open, small" bullet of the 14:04Z entry now says it was done.
- `outbox/cc-session-2026-11-03-patent-watch-dispatch.md`: an update bracket on the Observed bullet about the Drive hang.

## Not changed

- The ledger step of `drive-upload-outbox.yml`, and every other workflow file apart from the two that run the check.
- The 67 other jobs without a limit (TASK 3), the ratchet baseline (TASK 2), and the six files whose `urlopen` calls lack `timeout=`.
- No dispatch, no Odds API call, no `session_health` change, nothing the calendar experiment's VOID window (2026-11-08 to 2026-11-23) lists.

Sources: [Workflow syntax for GitHub Actions, `jobs.<job_id>.timeout-minutes` ("Default: 360")](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions).
