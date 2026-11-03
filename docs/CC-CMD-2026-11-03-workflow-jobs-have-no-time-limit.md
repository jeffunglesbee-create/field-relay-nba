# Claude Code Command — a workflow job with no time limit runs for six hours when something hangs

**Date:** 2026-11-03
**Repo:** field-relay-nba (the workflows, and the check that holds them).
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** B (a defect found in operation, with a check that holds the repair)
**Confidence gate:** >= 95 before any commit
**Status:** OPEN 2026-11-03 — filed; TASK 1 is built in the same push, TASKS 2 and 3 are open.
**Filed by:** the owner's `Next approved` (Tuesday 2026-11-03 15:33 ET), which answered a message that named this scope: file one CC-CMD for the missing job timeouts and build its first task, nothing else. Searched first, by content (BUILD-ON-A), over `docs/` and `HANDOFF.md`: `timeout-minutes`, `urlopen`, `drive-upload-outbox`, `hung`, `runner minutes`, `Actions minutes`, `6 hours`, `360 min`, `cancel-in-progress`. No CC-CMD owns the subject. The one mention of `timeout-minutes` is TASK 4b of `docs/CC-CMD-2026-11-02-scheduled-job-skipped-every-time.md`, which prescribes `timeout-minutes: 30` for the client's `patent-watch.yml` job; this work does not touch it.

---

## What was measured (2026-11-03, at relay `d5434eb1`)

- **The hang.** `FIELD Outbox to Drive` run 41650246688, attempt 1 (the push of `40bf5aad`, started 14:05:17Z): job 952 s, step "Upload to Drive via Apps Script" 941 s, `failure`, ending `Connection reset by peer`; the ledger step then wrote nothing ("nothing confirmed delivered"). One `gh run rerun --failed` made attempt 2: 17 s, `success`, one document uploaded. Why the Apps Script request hung is **not established**: one occurrence, and the Apps Script side cannot be read from here.
- **Why nothing ended it.** `.github/workflows/drive-upload-outbox.yml` sets no `timeout-minutes` on its job `upload`, and the inline Python it writes to `/tmp/upload.py` calls `urllib.request.urlopen(req)` with no `timeout`. A `urlopen` without a timeout waits on the socket for as long as the peer allows. GitHub's default for `jobs.<job_id>.timeout-minutes` is 360 ([workflow syntax reference](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions), "Default: 360"), so the run would have been allowed up to six hours.
- **What a normal run costs** (the job's own `started_at` to `completed_at`, read from the Actions API for the last 100 runs of the workflow, since 2026-10-19; 85 push, 15 schedule, 0 dispatch): 54 ran the upload step and 46 found no new file. Upload step: minimum 2 s, median 3 s, 90th percentile 11 s, maximum 46 s. Whole job: median 11 s, maximum 112 s. The hang is 941 s against a slowest normal step of 46 s. **A run-level duration (`updated_at` minus `run_started_at`) is not a job duration**: it reported 967 s for run 39284368746, whose upload step took 3 s (what the other 964 s were was not read).
- **How many jobs lack a limit, by a parse** (PyYAML `safe_load`, the fallback parser of `scripts/workflow-yaml-check.mjs`, over all 200 files in `.github/workflows/`; 0 did not parse): 202 jobs. 13 call a reusable workflow (`uses:`), which cannot take the key. Of the other 189, **121 set `timeout-minutes` and 68 do not, in 66 files**. 39 files declare a schedule; **15 of those have a job without a limit**. Values in use: 5 (34 jobs), 6 (8), 8 (4), 10 (46), 12 (3), 15 (10), 20 (5), 25 (3), 30 (1), 45 (2), 60 (2), 320 (1), 360 (2). A limit of 360 equals the default and bounds nothing: two jobs set it (`bsd-fanout-live-verify.yml::verify`, `bsd-ws-capture.yml::capture`), and `ambient-capture-probe.yml::probe` sets 320; none of the three is scheduled. A first count by text search said 79 files; it counted the 13 files that only call reusable workflows, and the figure was reported to the owner before this parse existed.
- **The same call elsewhere** (inline `run:` blocks only, by parse): 19 `urlopen(` calls in 14 files; 11 carry `timeout=` and **8 do not, in 6 files**: `deploy-health-protocol.yml`, `drive-upload-outbox.yml`, `field-playground-verify.yml`, `mcp-oauth-probe.yml`, `playground-write-allowlist-verify.yml`, `verify-pending-checks.yml`. Not measured: scripts under `scripts/` that workflows call, `curl` without `--max-time`, `requests`, Node `fetch`.
- **Precedent for a limit.** `workflow-yaml-gate.yml` sets `timeout-minutes: 5` on its job, and 121 jobs set one. This is not a new convention; it is an uneven one.

## Cause

Established: the upload step had no bound of its own and the job had none either, so the only thing that ended it was the connection being reset after 941 s. The check that would have caught this does not exist: `scripts/workflow-yaml-check.mjs` asserts that every workflow parses, has a trigger and a runnable job, and that a scheduled one has a root job that can run on a schedule event; none of its five assertions looks at a time limit.

Not established: what the Apps Script was doing for 941 s.

## Rulings and holds this work honours (BUILD-ON-A)

- `docs/CC-CMD-2026-10-10-push-lands-or-goes-red.md` (DONE): the ledger step of `drive-upload-outbox.yml` ends a lost push with `echo "next sweep re-records"; exit 0`, and that is "a CHOICE, not a defect". **The ledger step is not touched by this work.**
- `docs/CC-CMD-2026-10-18-relay-governance-guards.md`: a guard that is red before it is wired is the wallpaper failure; where a back catalogue lacks a property, the guard is a ratchet at the measured number, not a requirement. TASK 2 is a ratchet at the measured number (70) for that reason; TASK 1's check judges one workflow that already conforms when the check lands.
- The calendar experiment's VOID list (`outbox/odds-cfl-season-end-prediction-2026-10-18.md`, 2026-11-08 to 2026-11-23): `handleCFLOddsProbs`, `consumeOddsCredit` and `chargeOdds`, `reconcileOddsCredit`, the client's `fetchCFLOddsProbs` and `fetchSchedule` call, the options of `docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md`. No workflow and no guard is on it. TASK 1 lands on 2026-11-03.
- `CLAUDE.md` Rule 87 (probe first, a done condition that is an artifact, execution inside the session), Rule 90 (the check fails on purpose before it is trusted), Rule 91 (the check prints its own coverage), Rule 100 (premises, each with the one command that tried to refute it), and the convention in `scripts/workflow-yaml-check.mjs`: parse a workflow the way the runner does; a string scan is not a parse.

## Premises, and the one command that tried to refute each (Rule 100)

| premise | the command | result |
|---|---|---|
| a 60 s request limit is far above any real upload | job-level step durations for the last 100 runs (`gh api …/runs/<id>/jobs`) | **refuted as a basis**: the slowest whole upload step was 46 s, and it may hold several requests; the limit is set at 120 s |
| run-level duration measures the job | the same runs, run-level against job-level | **refuted**: 967 s against a 3 s upload step |
| 79 files lack a limit | a parse of all 200 files | **refined**: 68 jobs in 66 files; 13 files only call reusable workflows |
| a request that times out takes the workflow's existing failure path (doc left off the ledger, step exits 1) | the real `/tmp/upload.py` and the real loop, run against a local server that accepts and never answers | run in TASK 1; the result is recorded under Observed |
| the check can fail for the reason claimed | one mutation per limit, an unapplied-mutation control | run in TASK 1; the result is recorded under Observed |

## TASK 1 — the Drive upload cannot hang, and a check holds it

Files: `.github/workflows/drive-upload-outbox.yml` (job `timeout-minutes: 15`; `urlopen(req,timeout=120)`; a comment carrying the numbers above); `scripts/lib/parse-workflow-yaml.mjs` (the parser of `workflow-yaml-check.mjs`, lifted unchanged so a second check can share it; the gate imports it); `scripts/lib/workflow-timeouts.mjs` (the judge); `scripts/check-workflow-timeouts.mjs` (self-test, and the real check of the protected set, which is `drive-upload-outbox.yml`); `scripts/mutate-workflow-timeouts.mjs` (Rule 90); `.github/workflows/workflow-yaml-gate.yml` (runs the real check when a workflow changes); `.github/workflows/guards.yml` (self-test and mutants on every guards run). No other workflow and no part of the ledger step changes.

The values, from the measurements above: a request limit of 120 s is 2.6 times the slowest whole upload step and an eighth of the hang; a job limit of 15 minutes is eight times the slowest job and bounds the sum of several timed-out requests. The check refuses a request limit above 300 s and a job limit above 30 minutes, so the number cannot drift back to the default unnoticed. A dispatch with an empty `file_pattern` uploads every outbox document (899 today, and the Apps Script does not dedupe); at the median 3 s that is about 45 minutes, so it would not fit in 15, and the workflow's comment says so.

Not added, on purpose: a `timeout-minutes` on the upload step. Once the request is bounded, the job limit can only be reached by several requests timing out in a row, and a step limit would add a third number for the same case. Whether the ledger step runs after a job-level timeout is not verified.

Verification artifacts (Rule 89):
- (a) The real generated `upload.py` against a local server that never answers: before the edit it is still waiting when the harness stops it at 150 s; after, it prints a JSON error within 125 s and the loop's FAIL branch runs (`Results: 0 uploaded, 1 failed`, exit 1, the ledger file unchanged).
- (b) `node scripts/check-workflow-timeouts.mjs --self-test` passes N of N; `node scripts/mutate-workflow-timeouts.mjs` catches every mutation (each limit removed, the job limit raised to 360, a second `urlopen` without `timeout=`, `timeout=None`, the workflow deleted) and its unmutated control stays green.
- (c) The push's own `FIELD Outbox to Drive` run, which executes the edited workflow, finishes `success` with `Results: 1 uploaded, 0 failed` for the session document added in the same push.
- (d) `Repo guards` and `Workflow YAML Gate` finish `success` on the push.

## TASK 2 — no new job without a limit; the baseline only goes down

`docs/workflow-timeouts-baseline.json` lists `file::job` for every non-reusable job with no limit, or a limit of 360, at the number measured on the day it is written (70 on 2026-11-03: the 68 without the key and the two at 360). `scripts/check-workflow-timeouts.mjs` fails when a job without a limit is not in the baseline (a new one) and when the baseline lists a job that now has one (the number must be lowered, as `MISSING_BUDGET` is in `scripts/cc-cmd-status-check.mjs`). Reusable-workflow calls are excluded and counted in the printed coverage. Artifact: the committed baseline, the printed line `judged 189 job(s) in 200 file(s); 70 baselined; 0 new; 0 stale`, and mutants that add an unlimited job, remove a baseline line, and leave a stale one.

## TASK 3 — burn the baseline down, scheduled workflows first

For each of the 15 scheduled files with a job lacking a limit (the three jobs at 320 or 360 are not scheduled): read the job's longest successful duration over its last 100 runs (job-level), set the limit to eight times that, at least 10 minutes and rounded up to a multiple of 5, edit the file, and remove its lines from the baseline in the same commit. A job whose longest run is above 60 minutes is read by hand before a number is chosen. One commit per file, so each is revertable. Then the other 51 files in the same way. The six files with a `urlopen` call lacking `timeout=` are done in the same pass as their job limits. Not before TASK 2 lands.

## Done conditions

1. [ ] TASK 1 landed; `Repo guards` and `Workflow YAML Gate` `success` on the push (run ids under Observed).
2. [ ] The local run of the real `upload.py` against a never-answering server recorded under Observed with the seconds it waited before and after.
3. [ ] The push's `FIELD Outbox to Drive` run delivered the session document with the limits live (`Results: 1 uploaded, 0 failed`).
4. [ ] TASK 2 landed with the baseline at the measured number.
5. [ ] TASK 3: the 15 scheduled files have limits, then the rest; the baseline is empty.
6. [ ] A real timeout met in production: a request that exceeds 120 s, logged as the FAIL branch, the document delivered by the next sweep. **May never be observable on demand**; it is stated as not observed until a run logs it.

## Observed

(none yet)
