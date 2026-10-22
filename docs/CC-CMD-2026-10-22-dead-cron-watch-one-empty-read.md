# Claude Code Command — silently-dead-crons calls a cron "never fired" on one empty API answer

**Date:** 2026-10-22
**Repo:** field-relay-nba
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** B (a watch that went red on false readings)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** the 2026-10-22 daily odds and CI read,
`outbox/odds-watches-daily-read-2026-10-22.md` (Rule 87.4).

---

## What was measured (2026-10-22)

- Run 39819731719 (17:06Z) went red: NEW 6, all in the section
  `DECLARES A CRON, NEVER FIRED`, which had read 0 in every log from 10-18 to
  10-21:
  - field-laboratory `skill-drift.yml`;
  - field-playground `anomaly-null-model-probe.yml`;
  - field-relay-nba `drama-backfill.yml`, `espn-reachability-monitor.yml` and
    `rescore-quality-6b.yml`;
  - jubilant-bassoon `mlbn-schedule.yml`.
  A seventh, relay `odds-daily-vs-vendor.yml`, read the same way but was inside
  the grace window.
- The same query the watch makes (`runs?event=schedule&per_page=3&status=completed`)
  was re-run after the watch, by filename and by numeric id. It returned 3
  completed scheduled runs for each of the 7, created before the watch ran
  (drama-backfill 14:45Z, espn-reachability 12:40Z, mlbn-schedule 14:13Z,
  odds-daily-vs-vendor 04:35Z; the other three on 10-19).
- `scripts/watch-silently-dead-crons.mjs` (about line 335) files a workflow as
  never fired when one response has an empty `workflow_runs`. Its `gh()`
  throws on a non-2xx, so that run got 2xx answers with no runs. The cause of
  the empty answers was **not observed**: that is derived from the code. The
  script has not changed since `c6c22565` (10-17).

## TASK 0 — test the premise first

1. Re-run the watch (workflow_dispatch, no credits) and record whether the 6
   come back. If they do not, the empty answers were transient.
2. For one of the 6, call the same endpoint 20 times a minute apart and count
   empty answers. Record `total_count` on each, to see whether an empty list
   arrives with a non-zero count.

## TASK 1 — only if TASK 0 shows the empty answers

- Before filing a workflow as never fired, read it once more, without the
  `status=completed` filter, and use `total_count`. Only two empty answers in a
  row count as never fired.
- Add a self-test where the first answer is empty and the second has runs, and
  a mutation that removes the second read.
- Do not add the 6 to `docs/dead-cron-baseline.json`: they are false readings.

## Done condition (Rule 90 artifacts)

1. TASK 0's two outputs committed here, with the run id and the counts.
2. If TASK 1 is built: the new self-test is red before and green after, the
   mutation is caught, and the next scheduled run reads NEW 0 for the 6.
3. If TASK 0 shows no empty answers in 20 reads and the re-run is clean:
   Status WITHDRAWN as a one-off, with both outputs.
