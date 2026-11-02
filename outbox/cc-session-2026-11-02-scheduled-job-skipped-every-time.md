# CC session 2026-11-02 — a scheduled job skipped on every tick, and the watch that could not count it

**Task:** `docs/CC-CMD-2026-11-02-scheduled-job-skipped-every-time.md`, TASKs 1 to 3. Built on the owner's "Next approved" (2026-11-02, 13:30 ET), which approved the step proposed for finding 1 of that day's read of the client, relay and laboratory outbox files, and the appending of the evidence for findings 3 and 5 to their owning CC-CMDs in the same push. TASK 4 (patent-watch, client) is held for the owner's go; TASK 5 waits for GitHub to fire two scheduled runs.
**HEAD progression:** `7eff9a20` → `dfb123f3` (the watch) → `9b82593e` (the EPA `if:`) → `e228c22c` (the scheduled-job check) → the wording commit → this session doc.
**Credits:** 0. No Worker code changed (`src/**` untouched), so there is no deploy. Cost in CI: the probe now runs about one minute a day; the repo guards run took about 8 minutes at `e228c22c`.

## Premises (Rule 100), each with the command that could refute it

| premise | the command | result |
|---|---|---|
| all 66 scheduled runs of the EPA probe were skipped | `gh api repos/.../actions/workflows/nfl-epa-route-probe.yml/runs?event=schedule&per_page=100&page=N`, pages until empty, counted by `status`/`conclusion` | **66 runs, 66 `completed`/`skipped`**; first created 2026-08-28T23:19:15Z, last 2026-11-01T18:40:47Z. Among the newest 100 runs of the file (all events), 78 are `workflow_run` runs: 58 `success`, 15 `skipped` (the deploy it waits for had not succeeded: by design), 5 `failure` |
| the `if:` was added before the cron | `git log --follow` on the file, then `git show <sha>:<file>` grepped for `if:`, `cron:` | `d48ee942` (2026-08-27T22:24:51Z) adds the `if:` to a file with `workflow_dispatch` and `workflow_run` only; `fca36656` (22:42:42Z, 17 min 51 s later) adds `schedule:` under the same `if:`. The `schedule:` block was never reachable |
| the pre-fix `if:` is provably false on a schedule event; the fix is not | `WORKFLOW_DIR=<dir holding only the pre-fix file> node scripts/workflow-yaml-check.mjs`, then the same on the real tree | pre-fix: **1 failing** ("scheduled, but every root job is provably skipped on a schedule event: probe"); real tree: **199 files, 0 failing**; 39 declare a schedule; 40 root jobs judged: 39 run, 1 skipped, 0 undecided |
| the fix lets a tick RUN on GitHub | the first scheduled run created after the push of `9b82593e` | **Not observed.** At 2026-11-02 21:50Z no scheduled probe run for 11-02 had been created (the watch, nominal 12:15Z, only fired at 21:40Z). Verified statically only; this is TASK 5 |
| the one skipped root job in the real tree is not a false positive | a one-off script over the same library listing scheduled workflows with a skipped root job and no finding | exactly one: `auto-merge-stray-branches.yml`, two root jobs split by event (`auto-merge-on-push` skipped on a schedule, `auto-merge-sweep` runs). It is why the rule is "every root job" |
| the old watch could not see a skipped window | `grep -l nfl-epa-route-probe outbox/silently-dead-crons-*.log` | 54 logs on disk at the time; only the 2026-11-02 dispatch log names the probe. The 53 before it (2026-09-15 to 2026-11-01) never do |
| the new watch names both on live data | dispatch of `silently-dead-crons.yml` (run 41506676878), then the first scheduled run (41530556202) | both read the same: **NEW 2** (`nfl-epa-route-probe.yml` SKIPPED, `patent-watch.yml` STARTUP_FAILURE), carried 1 (`nba-clutch-update.yml`), exit 1. 100 judged: 95 healthy, 2 declared detectors, 3 reported |
| the new watch does not call a healthy workflow dead | the same logs, and mutants E3, E4, E15 | 95 of 100 judged are healthy (37 + 29 + 7 + 22); none of the three reported has a success in its window. E3 (one failure among successes), E4 (a window shorter than the streak) and E15 (every workflow with a window) are each caught |
| `patent-watch.yml` has never started a job | the same paged run list for the client's workflow | **21 runs in all, 21 `schedule`/`startup_failure`**: first 2026-06-10T22:32:29Z, last 2026-10-28T20:56:25Z. No dispatch run exists |
| the cause is the undeclared `skip_drive` input | `actionlint .github/workflows/patent-watch.yml` in jubilant-bassoon at `78ed7b0`; the callee's `workflow_call` inputs | actionlint: input "skip_drive" is not defined in the called workflow; defined inputs are "patents", "skip_dropbox". **Derived, not observed**: a `startup_failure` run has no jobs and no check runs, so GitHub's message is not readable from the API. The one-line change is the test, and it is held (below) |
| activating patent-watch has side effects | read of both workflow files at `78ed7b0` | a weekly issue assigned to the owner (mobile push), commits to the client's main, a PatentsView fetch, a Dropbox upload when secrets are set. The workflow has never started a job, so none of it has run |
| a skipped run is drawn green on the Actions page | none was possible from here | **Retracted.** I had written it in five comments and one failure message without observing it. Replaced by "not a failure" (the API gives the conclusion), in the wording commit |

## Built

- `dfb123f3` `scripts/watch-silently-dead-crons.mjs`: `DEAD_CONCLUSIONS` (`failure`, `skipped`, `startup_failure`), `streakKind` (a window is dead only if every run is one of them; `failure`, `skipped`, `startup_failure` or `mixed`), `deadLines`, `allDead`; `surveyRepo(repo, declared, io)` so the survey runs against a fake; the report heading "NO RUN WORKED, NOT PLAIN FAILURE" beside the unchanged "FAILING 3 CONSECUTIVE RUNS" (two months of committed logs still compare); the ratchet now judges every kind. `scripts/mutate-silently-dead-crons.mjs`: E1 to E15.
- `9b82593e` `.github/workflows/nfl-epa-route-probe.yml`: the job's `if:`.
- `e228c22c` `scripts/lib/workflow-if-eval.mjs` (a three-valued evaluator on the `schedule` event: GitHub's coercion, `&&`/`||` returning an operand, the payload keys a schedule event does not have), `scripts/check-workflow-if-eval.mjs`, `scripts/mutate-workflow-if-eval.mjs`, assertion 5 in `scripts/workflow-yaml-check.mjs`, one step in `guards.yml`. A bare `on:` parses as the key `true` under YAML 1.1; the library reads both.
- the wording commit: comments and the failure text only.

## Proof

- Watch: self-test **56/56**, mutation harness **32 of 32** (run again after the wording commit, and in CI inside the dispatch).
- Scheduled-job check: **74/74** cases, **25 of 25** mutants (M1 to M21 on the library, G1 to G4 on the gate) plus four fixture directories (buggy, fixed, pair, broken) run through the real gate with `WORKFLOW_DIR`.
- Red before, green after, on the real file: the pre-fix EPA file fails the gate; the real tree passes.
- CI at `e228c22c`: Workflow YAML Gate run 41506527605 success; Repo guards run 41506527611 success, 55 of 55 steps, including "The scheduled-job check fails on the shape that skipped 66 of 66 runs". The dispatch (41506676878) ran the watch's self-test and 32 mutants green; its live step failed by design. The first scheduled run (41530556202) did the same.

## Verified, and what was not

| claim | status | evidence |
|---|---|---|
| the watch counts skipped and startup_failure windows as dead, on live data | **VERIFIED**, twice | the two logs above |
| the gate fails the pre-fix shape and passes the real tree | **VERIFIED** | commands above; CI runs above |
| the EPA probe now runs on its schedule | **STAGED** | verified statically only. **Unblocked by:** GitHub firing a scheduled tick (nominal 14:00Z; observed 18:03Z to 18:55Z on 10-30 to 11-01; none by 21:50Z on 11-02). **Verify:** the run list shows a scheduled run created after 2026-11-02T19:04Z whose probe step ran, and `outbox/nfl-epa-route-probe-*.json` carries a verdict. Two scheduled tasks are armed (`trig_01CruYHrcseUdDi11SyKeg4R`, 2026-11-03 20:45Z; `trig_01EeLZTDbdyihnpkjnH6kMdw`, 2026-11-04 22:30Z) |
| heartbeat mode works | **NOT VERIFIED**; it has never executed | the first scheduled run is its first execution |
| `patent-watch.yml` starts once `skip_drive` is fixed | **NOT VERIFIED** | the fix is held for the owner's go (CC-CMD TASK 4) |

## Evidence appended to other CC-CMDs (BUILD-ON-A: added where the finding already lives, not filed again)

- `docs/CC-CMD-2026-09-15-dead-cron-triage.md`: the Rule 90 registry has one UNEXERCISED entry, not four; the watch prints a condition text that is stale since 2026-09-15.
- `docs/CC-CMD-2026-10-22-dead-cron-watch-one-empty-read.md`: a note that `surveyRepo` now takes `io`, which is the seam its TASK 1 needs for the "first answer empty, second has runs" case.
- field-laboratory `docs/CC-CMD-2026-10-18-coverage-alarm-names-its-cause.md`: its baseline (30 readings, 9 alarms) is stale; the measured split of the cause; one firing-rule observation, reported and not acted on (its TASK 3).

## Mistakes in my own work, found before they cost anything

- A comment dated the 66 skipped ticks from 2026-08-27, the day the cron was added; the first tick was 2026-08-28. Corrected before the commit, then found again in the library's header after the push and corrected in the wording commit.
- Five comments and the gate's own failure message said the Actions page shows a skipped run green. Never observed. Found after the push, retracted, replaced.
- Mutation M19 ("a workflow with no root job is vacuous") was not caught on the first run of the new harness because its case asserted the root count, not the finding count. A case was added; 25 of 25 now.
- A self-test case crashed under mutant E7 by indexing an empty list; it now reads through `map`.
- Importing the watch module for a rendering check runs its main block (the module has no main guard) and failed on a 401; nothing was written. Pre-existing.

## Not changed, and why

- `patent-watch.yml`: the one-line caller fix waits for the owner (it starts a weekly automation with an issue, commits and a Dropbox upload).
- `docs/dead-cron-baseline.json`: no entry added for either workflow. The watch stays red until the probe's first working tick lands and `patent-watch.yml` is fixed; an entry would make it quiet, not right.
- `docs/declared-detectors.json`: its stale `red_because` text for the Rule 90 monitor (the triage CC-CMD's TASK 3) is reported, not edited; a figure that ages daily should not be rewritten as another figure.
- Out of this task: finding 4 (a C7 timer margin; proposal only), the laboratory's phase-check matcher, the 2026-10-31 Drama backfill, the Serie A classifier skip.
