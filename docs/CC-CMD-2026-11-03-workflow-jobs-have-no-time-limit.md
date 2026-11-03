# Claude Code Command — a workflow job with no time limit runs for six hours when something hangs

**Date:** 2026-11-03
**Repo:** field-relay-nba (the workflows, and the check that holds them).
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** B (a defect found in operation, with a check that holds the repair)
**Confidence gate:** >= 95 before any commit
**Status:** PARTIAL 2026-11-03 — TASK 1 (the fix, the check, its mutants and the wiring) landed and was verified, locally and by the CI runs of its push (run ids under Observed). TASKS 2 and 3 are open, and done condition 6 is not observed.
**Filed by:** the owner's `Next approved` (Tuesday 2026-11-03 15:33 ET), which answered a message that named this scope: file one CC-CMD for the missing job timeouts and build its first task, nothing else. Searched first, by content (BUILD-ON-A), over `docs/` and `HANDOFF.md`: `timeout-minutes`, `urlopen`, `drive-upload-outbox`, `hung`, `runner minutes`, `Actions minutes`, `6 hours`, `360 min`, `cancel-in-progress`. No CC-CMD owns the subject. The one mention of `timeout-minutes` is TASK 4b of `docs/CC-CMD-2026-11-02-scheduled-job-skipped-every-time.md`, which prescribes `timeout-minutes: 30` for the client's `patent-watch.yml` job; this work does not touch it.

---

## What was measured (2026-11-03, at relay `d5434eb1`)

- **The hang.** `FIELD Outbox to Drive` run 41650246688, attempt 1 (the push of `40bf5aad`, started 14:05:17Z): job 952 s, step "Upload to Drive via Apps Script" 941 s, `failure`, ending `Connection reset by peer`; the ledger step then wrote nothing ("nothing confirmed delivered"). One `gh run rerun --failed` made attempt 2: 17 s, `success`, one document uploaded. Why the Apps Script request hung is **not established**: one occurrence, and the Apps Script side cannot be read from here.
- **Why nothing ended it.** `.github/workflows/drive-upload-outbox.yml` sets no `timeout-minutes` on its job `upload`, and the inline Python it writes to `/tmp/upload.py` calls `urllib.request.urlopen(req)` with no `timeout`. A `urlopen` without a timeout waits on the socket for as long as the peer allows. GitHub's default for `jobs.<job_id>.timeout-minutes` is 360 ([workflow syntax reference](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions), "Default: 360"), so the run would have been allowed up to six hours.
- **What a normal run costs** (the job's own `started_at` to `completed_at`, read from the Actions API for the last 100 runs of the workflow, since 2026-10-19; 85 push, 15 schedule, 0 dispatch): 54 ran the upload step and 46 found no new file. Upload step: minimum 2 s, median 3 s, 90th percentile 11 s, maximum 46 s. Whole job: median 11 s, maximum 112 s. The hang is 941 s against a slowest normal step of 46 s. **A run-level duration (`updated_at` minus `run_started_at`) is not a job duration**: it reported 967 s for run 39284368746, whose upload step took 3 s (what the other 964 s were was not read).
- **How many jobs lack a limit, by a parse** (PyYAML `safe_load`, the fallback parser of `scripts/workflow-yaml-check.mjs`, over all 200 files in `.github/workflows/`; 0 did not parse): 202 jobs. 13 call a reusable workflow (`uses:`), which cannot take the key. Of the other 189, **121 set `timeout-minutes` and 68 do not, in 66 files**. 39 files declare a schedule; **15 of those have a job without a limit**. Values in use: 5 (34 jobs), 6 (8), 8 (4), 10 (46), 12 (3), 15 (10), 20 (5), 25 (3), 30 (1), 45 (2), 60 (2), 320 (1), 360 (2). A limit of 360 equals the default and bounds nothing: two jobs set it (`bsd-fanout-live-verify.yml::verify`, `bsd-ws-capture.yml::capture`), and `ambient-capture-probe.yml::probe` sets 320; none of the three is scheduled. A first count by text search said 79 files; it counted the 13 files that only call reusable workflows, and the figure was reported to the owner before this parse existed.
- **At the push head** (relay `91dd2276`, after the rebase; PyYAML, 201 files, 0 unparsed): 203 jobs, 13 reusable. The Drive job has its limit now, and `worker-cpu-read.yml`, added today by another session, arrived with `timeout-minutes: 5`. Of 190 non-reusable jobs, **123 set a limit and 67 do not, in 65 files**; 14 scheduled files have a job lacking one (15 before TASK 1). Values in use: 5 (35 jobs), 6 (8), 8 (4), 10 (46), 12 (3), 15 (11), 20 (5), 25 (3), 30 (1), 45 (2), 60 (2), 320 (1), 360 (2). `urlopen(` in inline `run:` blocks: 19 calls in 14 files, 12 with a literal `timeout=` and **7 without, in 5 files**.
- **What a request limit is.** `urlopen`'s `timeout` is a wait for the peer, not a deadline for the exchange. Probed 2026-11-03: a local server answered one byte a second for 8 s, and `urlopen(timeout=3)` read all of it without raising, after 8.0 s. A limit of 120 s ends a peer that goes silent; a peer that sends a byte now and then is ended only by the job limit.
- **The same call elsewhere** (inline `run:` blocks only, by parse): 19 `urlopen(` calls in 14 files; 11 carry `timeout=` and **8 do not, in 6 files**: `deploy-health-protocol.yml`, `drive-upload-outbox.yml`, `field-playground-verify.yml`, `mcp-oauth-probe.yml`, `playground-write-allowlist-verify.yml`, `verify-pending-checks.yml`. Not measured: scripts under `scripts/` that workflows call, `curl` without `--max-time`, `requests`, Node `fetch`.
- **Precedent for a limit.** `workflow-yaml-gate.yml` sets `timeout-minutes: 5` on its job, and 121 jobs set one. This is not a new convention; it is an uneven one.

## Cause

Established: the upload step had no bound of its own and the job had none either, so the only thing that ended it was the connection being reset after 941 s. The check that would have caught this does not exist: `scripts/workflow-yaml-check.mjs` asserts that every workflow parses, has a trigger and a runnable job, and that a scheduled one has a root job that can run on a schedule event; none of its five assertions looks at a time limit.

Not established: what the Apps Script was doing for 941 s.

## Rulings and holds this work honours (BUILD-ON-A)

- `docs/CC-CMD-2026-10-10-push-lands-or-goes-red.md` (DONE): the ledger step of `drive-upload-outbox.yml` ends a lost push with `echo "next sweep re-records"; exit 0`, and that is "a CHOICE, not a defect". **The ledger step is not touched by this work.**
- `docs/CC-CMD-2026-10-18-relay-governance-guards.md`: a guard that is red before it is wired is the wallpaper failure; where a back catalogue lacks a property, the guard is a ratchet at the measured number, not a requirement. TASK 2 is a ratchet at the measured number (70 when filed, 69 after TASK 1) for that reason; TASK 1's check judges one workflow that already conforms when the check lands.
- The calendar experiment's VOID list (`outbox/odds-cfl-season-end-prediction-2026-10-18.md`, 2026-11-08 to 2026-11-23): `handleCFLOddsProbs`, `consumeOddsCredit` and `chargeOdds`, `reconcileOddsCredit`, the client's `fetchCFLOddsProbs` and `fetchSchedule` call, the options of `docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md`. No workflow and no guard is on it. TASK 1 lands on 2026-11-03.
- `CLAUDE.md` Rule 87 (probe first, a done condition that is an artifact, execution inside the session), Rule 90 (the check fails on purpose before it is trusted), Rule 91 (the check prints its own coverage), Rule 100 (premises, each with the one command that tried to refute it), and the convention in `scripts/workflow-yaml-check.mjs`: parse a workflow the way the runner does; a string scan is not a parse.

## Premises, and the one command that tried to refute each (Rule 100)

| premise | the command | result |
|---|---|---|
| a 60 s request limit is far above any real upload | job-level step durations for the last 100 runs (`gh api …/runs/<id>/jobs`) | **refuted as a basis**: the slowest whole upload step was 46 s, and it may hold several requests; the limit is set at 120 s |
| run-level duration measures the job | the same runs, run-level against job-level | **refuted**: 967 s against a 3 s upload step |
| 79 files lack a limit | a parse of all 200 files | **refined**: 68 jobs in 66 files; 13 files only call reusable workflows |
| a request that times out takes the workflow's existing failure path (doc left off the ledger, step exits 1) | the step's script, parsed out of each workflow file, run against a local server that accepts and never answers | **held**: the step as it was, still waiting at 150 s (stopped by the harness); as edited, `FAIL … {"error": "timed out"}` at 120 s, `Results: 0 uploaded, 1 failed`, exit 1, nothing written to the ledger file |
| the check can fail for the reason claimed | the check on the pre-fix file read from git; 28 mutations with unique-anchor assertions and an unmutated control | **held**: the pre-fix file gives 2 findings, exit 1; 28 of 28 caught; the control green before and after |
| a 120 s request limit bounds the request | a local server answering one byte a second for 8 s, read with `urlopen(timeout=3)` | **refuted as stated**: it read all of it, after 8.0 s. The limit is a wait for the peer; the job limit bounds the rest |
| 70 jobs belong in the baseline | the census re-run at relay `91dd2276` | **refined**: 69, because TASK 1 bounded one of the 68 and the one new workflow arrived with a limit |

## TASK 1 — the Drive upload cannot hang, and a check holds it

Files: `.github/workflows/drive-upload-outbox.yml` (job `timeout-minutes: 15`; `urlopen(req,timeout=120)`; a comment carrying the numbers above); `scripts/lib/parse-workflow-yaml.mjs` (the parser of `workflow-yaml-check.mjs`, lifted unchanged so a second check can share it; the gate imports it); `scripts/lib/workflow-timeouts.mjs` (the judge); `scripts/check-workflow-timeouts.mjs` (self-test, and the real check of the protected set, which is `drive-upload-outbox.yml`); `scripts/mutate-workflow-timeouts.mjs` (Rule 90, and the test that the two workflow steps below are present); `.github/workflows/workflow-yaml-gate.yml` (runs the real check when a workflow changes); `.github/workflows/guards.yml` (self-test and mutants on every guards run). No other workflow and no part of the ledger step changes.

The values, from the measurements above: a request limit of 120 s is 2.6 times the slowest whole upload step and an eighth of the hang; a job limit of 15 minutes is eight times the slowest job and bounds the sum of several timed-out requests. The check refuses a request limit above 300 s and a job limit above 30 minutes, so the number cannot drift back to the default unnoticed. A dispatch with an empty `file_pattern` uploads every outbox document (899 today, and the Apps Script does not dedupe); at the median 3 s that is about 45 minutes, so it would not fit in 15, and the workflow's comment says so. The request limit is a wait for the peer, not a deadline (the probe above), so the job limit is what ends a peer that keeps sending; the check requires both.

Not added, on purpose: a `timeout-minutes` on the upload step. Once the request is bounded, the job limit can only be reached by several requests timing out in a row, and a step limit would add a third number for the same case. Whether the ledger step runs after a job-level timeout is not verified. Also not added: a total deadline on the Python process (`timeout 150 python3 …`), which would bound a peer that sends slowly at the request level; the approved scope was a request timeout and a job limit.

Verification artifacts (Rule 89):
- (a) The real generated `upload.py` against a local server that never answers: before the edit it is still waiting when the harness stops it at 150 s; after, it prints a JSON error within 125 s and the loop's FAIL branch runs (`Results: 0 uploaded, 1 failed`, exit 1, the ledger file unchanged).
- (b) `node scripts/check-workflow-timeouts.mjs --self-test` passes 63 of 63; `node scripts/mutate-workflow-timeouts.mjs` catches every mutation (each limit removed, the job limit raised to 360, a second `urlopen` without `timeout=`, `timeout=None`, the workflow deleted) and its unmutated control stays green.
- (c) The push's own `FIELD Outbox to Drive` run, which executes the edited workflow, finishes `success` with `Results: 1 uploaded, 0 failed` for the session document added in the same push.
- (d) `Repo guards` and `Workflow YAML Gate` finish `success` on the push.

## TASK 2 — no new job without a limit; the baseline only goes down

`docs/workflow-timeouts-baseline.json` lists `file::job` for every non-reusable job with no limit, or a limit of 360, at the number measured on the day it is written (70 when this was filed; 69 at relay `91dd2276` after TASK 1 bounded `drive-upload-outbox.yml::upload`: the 67 without the key and the two at 360). `scripts/check-workflow-timeouts.mjs` fails when a job without a limit is not in the baseline (a new one) and when the baseline lists a job that now has one (the number must be lowered, as `MISSING_BUDGET` is in `scripts/cc-cmd-status-check.mjs`). Reusable-workflow calls are excluded and counted in the printed coverage. Artifact: the committed baseline, the printed line `judged 190 job(s) in 201 file(s); 69 baselined; 0 new; 0 stale` (the figures of 2026-11-03, re-measured when TASK 2 is built), and mutants that add an unlimited job, remove a baseline line, and leave a stale one.

## TASK 3 — burn the baseline down, scheduled workflows first

For each of the 14 scheduled files with a job lacking a limit (15 before TASK 1 bounded `drive-upload-outbox.yml`; the three jobs at 320 or 360 are not scheduled): read the job's longest successful duration over its last 100 runs (job-level), set the limit to eight times that, at least 10 minutes and rounded up to a multiple of 5, edit the file, and remove its lines from the baseline in the same commit. A job whose longest run is above 60 minutes is read by hand before a number is chosen. One commit per file, so each is revertable. Then the other 51 files in the same way. The five files that still have a `urlopen` call lacking `timeout=` (six before TASK 1) are done in the same pass as their job limits. Not before TASK 2 lands.

## Done conditions

1. [x] TASK 1 landed; `Repo guards` and `Workflow YAML Gate` `success` on the push (run ids under Observed).
2. [x] The local run of the step's script against a never-answering server recorded under Observed with the seconds it waited before and after (150 s and still waiting; 120 s and failed).
3. [x] The push's `FIELD Outbox to Drive` run delivered the session document with the limits live (`Results: 1 uploaded, 0 failed`).
4. [ ] TASK 2 landed with the baseline at the measured number.
5. [ ] TASK 3: the 14 scheduled files have limits, then the rest; the baseline is empty.
6. [ ] A real timeout met in production: a request that exceeds 120 s, logged as the FAIL branch, the document delivered by the next sweep. **May never be observable on demand**; it is stated as not observed until a run logs it.

## Observed

### TASK 1 — built 2026-11-03, on the owner's `Next approved` of 15:33 ET

- **The step against a server that never answers** (done condition 2). The step's script, parsed out of each workflow file and run with its `/tmp/` paths redirected: against a server that answers, both versions print `Results: 1 uploaded, 0 failed` and exit 0. Against a server that reads the request and never answers: the step as it was, still waiting at **150 s** when the harness stopped it (exit 124), its output ending at `Uploading:`; the step as edited, at **120 s**, `FAIL … response: {"error": "timed out"}`, `Results: 0 uploaded, 1 failed`, exit 1, nothing written to the uploaded-ok file.
- **The check.** On the workflow as it was before the fix, read from git: 2 findings (no `timeout-minutes`; no `timeout=` keyword), exit 1. On the fixed workflow: 0 findings, exit 0, `checked 1 of 201 workflow file(s): 1 job(s) and 1 urlopen call(s). The other 200 file(s) are NOT judged here`. Self-test 63 of 63.
- **The mutants.** 28 of 28 caught (20 of the judge, 8 of the live check), anchors unique and applied, the control green before and after, about 12 s. Ten fixtures made from the real workflow's text. With the self-test layer off for a one-off run, the fixtures alone catch 17. The wiring test (the gate step and the guards step are present in the parsed workflows) goes red when either is taken out.
- **The parser lift.** `scripts/workflow-yaml-check.mjs` prints the same line before and after; `scripts/mutate-workflow-if-eval.mjs` is still 25 of 25.
- **Found while building.** The request limit is a wait for the peer, not a deadline (the probe under "What was measured"). The census moved while this was built, so the baseline of TASK 2 is 69, not 70.
- **The push** (`d3cbbd7b`, five commits, 21:11Z; done conditions 1 and 3): `Repo guards` run 41719446378 `success`, 57 of 57 steps (the new step 50 ran 9 s: self-test 63/63, the baseline, the wiring test and 28 of 28 mutations caught); `Workflow YAML Gate` run 41719446389 `success`, its new step 7 green; `FIELD Outbox to Drive` run 41719446427 `success` on the edited workflow: `Found 1 new file(s): outbox/cc-session-2026-11-03-job-timeouts.md`, upload step 3 s, `Results: 1 uploaded, 0 failed`; the ledger step pushed on attempt 2.
- **Not established.** Why the Apps Script request hung. Whether the ledger step runs after a job-level timeout. A real timeout in production (done condition 6).
