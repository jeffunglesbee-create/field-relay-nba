# Claude Code Command — a scheduled job that is skipped on every tick raises nothing, and nothing was counting it

**Date:** 2026-11-02
**Repo:** field-relay-nba (TASK 4 lands in jubilant-bassoon and waits for the owner)
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (a scheduled path that is silently empty, and the watch that could not see it)
**Confidence gate:** >= 95 before any commit
**Status:** PARTIAL 2026-11-02. TASKs 1 to 3 are built, pushed and green (`9b82593e`, `dfb123f3`, `e228c22c`). TASK 4 (patent-watch, in the client) waits for the owner's go. TASK 5 (the first scheduled EPA run, and the watch that follows it) waits for GitHub to fire them.
**Filed by:** the 2026-11-02 read of the client, relay and laboratory outbox files (finding 1), built on the owner's "Next approved" of the same day. Session doc: `outbox/cc-session-2026-11-02-scheduled-job-skipped-every-time.md`.

---

## What was measured (2026-11-02)

**The EPA route probe has never run on its schedule.** `nfl-epa-route-probe.yml` declares `0 14 * * *`. The Actions API lists 66 scheduled runs of it, created from 2026-08-28T23:19Z to 2026-11-01T18:40Z, and all 66 are `completed` with conclusion `skipped`. The job's `if:` read `github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'`. A schedule event carries no `workflow_run` payload, so the second operand reads null, `null == 'success'` is false, the job is skipped, and the run finishes `skipped`. A skipped run is not a failure: nothing went red and no step ran.

The `if:` came first. `d48ee942` (2026-08-27T22:24:51Z) added it, when the file had only `workflow_dispatch` and `workflow_run`. `fca36656` (22:42:42Z, 17 minutes 51 seconds later) added the cron to a file whose gate could not let it run. The file's heartbeat mode (`EPA_PROBE_HEARTBEAT`, set only on a schedule event, where "not observable" is neutral) has therefore never executed. The probe's other trigger ran throughout: among the newest 100 runs of the file, 78 are `workflow_run` runs (58 `success`, 15 `skipped` because the deploy it waits for had not succeeded, which is by design, and 5 `failure`).

**The dead-cron watch could not see it.** `scripts/watch-silently-dead-crons.mjs` called a workflow dead only when each of its last three scheduled runs concluded `failure`, and a skipped run is not a failure. 53 committed watch logs (2026-09-15 to 2026-11-01) never name the probe. The first log that does is the dispatch of 2026-11-02, after the change.

**The same blind spot hid a second workflow: `patent-watch.yml` in the client.** 21 of 21 runs, 2026-06-10 to 2026-10-28, are `startup_failure`: it has never started a job. See TASK 4.

## What was built (relay, direct to main)

| TASK | commit | what | proof |
|---|---|---|---|
| 1 | `9b82593e` | The EPA job's `if:` is `github.event_name != 'workflow_run' \|\| github.event.workflow_run.conclusion == 'success'`: only a `workflow_run` event has an upstream conclusion to read. Cron and triggers unchanged. | The pre-fix file fails the new gate; the new `if:` is judged "runs" on a schedule event. Not yet seen on a live tick: TASK 5. |
| 2 | `dfb123f3` | The watch calls a workflow dead when none of its last 3 completed scheduled runs worked: each is `failure`, `skipped` or `startup_failure`. A window holding a success, `cancelled`, `timed_out`, `action_required` or `neutral` counts healthy, and the COVERAGE block says so. The report names the kind (SKIPPED, STARTUP_FAILURE, or the list of conclusions for a mixture). `surveyRepo` takes its API calls as a parameter, so the survey is tested against a fake. | Self-test 56 cases; 32 of 32 mutants (E1 to E15 are new); the two live runs below. |
| 3 | `e228c22c` | `scripts/lib/workflow-if-eval.mjs` judges a job's `if:` on the `schedule` event with a three-valued evaluator (only a provable false counts; "may run" is counted, not guessed). `scripts/workflow-yaml-check.mjs` fails a scheduled workflow whose EVERY root job is provably skipped. `guards.yml` proves on every push that the judge is right and that the check can still fail. | 74 cases; 25 of 25 mutants plus four fixture directories through the real gate; the pre-fix EPA file fails, the real tree passes (0 of 199 failing). |
| - | the commit titled "wording: a skipped run is not a failure; drop the colour claim nobody verified" | Wording only. Five comments and the check's own failure text said the Actions page shows a skipped run green. The API gives the conclusion; the colour was never observed here. | No behaviour change; the same four suites. |

**Live control, twice.** The dispatch of `silently-dead-crons.yml` (run 41506676878) ran the self-test and 32 mutants green, then the live watch over four repos (462 workflows, 100 judged) named exactly two workflows as NEW decay and exited 1: `nfl-epa-route-probe.yml` (every scheduled run SKIPPED, latest 2026-11-01T18:40:47Z) and, in jubilant-bassoon, `patent-watch.yml` (every scheduled run STARTUP_FAILURE, latest 2026-10-28T20:56:25Z). Its log is `outbox/silently-dead-crons-2026-11-02T19-08-20-619Z.log`. The first scheduled run of the new watch (run 41530556202, created 21:40Z, nominal 12:15Z) read the same two and exited 1: `outbox/silently-dead-crons-2026-11-02T21-44-21-324Z.log`. The relay's repo guards (run 41506527611, 55 of 55 steps) and the workflow YAML gate (run 41506527605) were green at `e228c22c`.

## Expected, and stated now so it is not read as a regression

1. **The daily watch is red until both workflows clear or are admitted.** It exits 1 on NEW decay, and as of 2026-11-02 21:44Z it does. The probe leaves the list when a scheduled run created after `9b82593e` finishes with something other than `skipped`, `failure` or `startup_failure` and sits in the watch's three-run window (one working run in three is healthy). A first run that FAILS keeps it listed, as "no scheduled run worked: failure, skipped, skipped". GitHub fires both workflows late and unevenly: the watch (nominal 12:15Z) was created at 17:54Z, 17:14Z, 17:58Z, 18:25Z on the four days before 11-02 and at 21:40Z on 11-02; the probe (nominal 14:00Z) at 18:55Z, 18:03Z and 18:40Z on 10-30 to 11-01. At 21:50Z on 11-02 no scheduled probe run for 11-02 had been created.
2. **The first scheduled EPA run is the first time heartbeat mode has ever executed.** It may find a real problem in a path nobody has run. If it does, record it under "Observed"; do not make it quiet.
3. **One more Actions minute a day.** The probe now runs every day (about a minute) where it ran no step before.

## TASK 1, 2, 3 — built

See the table. TASK 3's check judges relay workflows only (the gate runs on this repo's `.github/workflows`); the watch in TASK 2 covers four repos and, on 2026-11-02, found no other workflow whose window held only skipped or never-started runs. It judges a workflow only once it has 3 completed scheduled runs, so a newly added cron that is skipped from its first tick is invisible to it for three ticks; TASK 3's check sees it at the push.

## TASK 4 — `patent-watch.yml` (client): one line, held for the owner's go

Evidence:
- 21 scheduled runs, the whole history of the workflow, all `startup_failure`: first 2026-06-10T22:32:29Z, last 2026-10-28T20:56:25Z (weekly, Wednesdays 16:00Z). A `startup_failure` run has no jobs and no check runs, so GitHub's own message is not readable from the API.
- `actionlint` on the caller (jubilant-bassoon at `78ed7b0`, `.github/workflows/patent-watch.yml`): input "skip_drive" is not defined in "./.github/workflows/patent-fulltext.yml" reusable workflow; defined inputs are "patents", "skip_dropbox". The caller's `followup` job passes `skip_drive: false`; the callee declares `skip_dropbox` (default false) and no Drive input. The cause is derived from actionlint, not observed from GitHub.

The change: in the `followup` job of the client's `patent-watch.yml`, replace `skip_drive: false` with `skip_dropbox: false`. The callee's default is false, so deleting the line is equivalent.

**Why it is held.** It switches on a dormant weekly automation, and that is the owner's decision. From the workflow's own header: each Wednesday it scans USPTO grant and pre-grant XML for the assignees in `.github/patent-watchlist.txt`; files a GitHub issue per week with matches, **assigned to the repo owner (a mobile push)**; commits `outbox/patents/` to the client's main; and, for grant hits, chains `patent-fulltext.yml`, which fetches full text with `PATENTSVIEW_API_KEY`, builds the FIELD comparison tables, uploads to Dropbox when its secrets are set, and commits again. None of that has run since the workflow was created.

Until it is done, the watch lists `patent-watch.yml` as NEW decay and exits 1 daily. The alternative is an entry in `docs/dead-cron-baseline.json` with `red_since`, `unblocked_by` and `review_by`. That is an admission, not a fix, and this document does not recommend it.

Done: a scheduled or dispatched run of `patent-watch.yml` starts its `watch` job. Verify: the workflow's run list shows a run whose conclusion is not `startup_failure`.

## TASK 5 — read the first scheduled EPA run, and the watch that follows it

- The first scheduled run of `nfl-epa-route-probe.yml` created after 2026-11-02T19:04Z (the push of `9b82593e`): its conclusion, the steps that ran, the committed `outbox/nfl-epa-route-probe-*.json` (verdict, `route_plays`, `client_plays`, `disagreements`, game), and whether a game was observable.
- The watch run after it: the probe is off the NEW list, or still on it with the reason.
- Two scheduled tasks are armed (fresh sessions, docs only, they append under "Observed"): `trig_01CruYHrcseUdDi11SyKeg4R` at 2026-11-03T20:45Z reads the first probe run; `trig_01EeLZTDbdyihnpkjnH6kMdw` at 2026-11-04T22:30Z reads the 11-04 watch and backfills the probe reading if the first did not find a run.

## Done condition (Rule 90 artifacts)

1. TASKs 1 to 3 committed with their proof: done, above.
2. A scheduled run of `nfl-epa-route-probe.yml` that executed its probe step, recorded under "Observed" with its run id and verdict (TASK 5).
3. The watch run that follows it reads the probe healthy, or names why not (TASK 5).
4. `patent-watch.yml` starts a job, or the owner's decision is recorded here (TASK 4).
5. Status moves to DONE only when 2, 3 and 4 hold.

## Observed

Nothing yet. The first entries are written by the two scheduled tasks named under TASK 5.
