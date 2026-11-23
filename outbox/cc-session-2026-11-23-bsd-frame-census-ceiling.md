# cc-session-2026-11-23-bsd-frame-census-ceiling

Scope: relay Repo guards step 45 ("every BSD frame the contract declares matches the captures"), red on every run since 2026-11-22T16:21Z. CC-CMD: `docs/CC-CMD-2026-11-23-bsd-frame-census-ceiling.md`.

## HEAD progression

`58a014d`/`448f76c` (main at start, red step) -> `db92f6f` (the fix, pushed 2026-11-23T05:00Z) -> this record.

## What was built, per commit

- `db92f6f` `fix: the BSD frame census reads what it plans to, not a fixed 2500`: `scripts/check-bsd-frame-contract.mjs` (+167/-15 over the original, with the self-test) and `scripts/mutate-bsd-frame-contract.mjs` (+23 over the original). The fixed `READ_CAP = 2500` became `plannedReads()` plus `READ_CEILING = 10000`; the loop moved into `readCensus(get, ceiling)`; `live()` takes `get` and `ceiling`; the COVERAGE line prints `N of M planned reads`. Self-test: 13 new assertions (28 PASS lines before, 41 after) that drive the whole run over a bucket in memory. Mutations: 12 to 30, 30 caught, 0 survived, 0 not applied.

## Verified end to end (Rule 61)

- Runner, `guards.yml` run `45115192139` on `db92f6f`: all 64 steps success; step 45 (91 s) printed `COVERAGE: 2869 keys in 4 list page(s); 1363 events, 1262 non-shell read; 2531 of 2531 planned reads, 0 failed; 120 own goals excluded` and `PASS: every declared frame agrees with the captures`. That is the done condition: a COVERAGE line with no `CAPPED`, ending PASS.
- Local, before the push: `guards.yml` run step by step, 58 pass, 3 skipped (network or secret: credential count, HANDOFF workflow claim, archive kickoff date), 1 not runnable here (step 45's own live read: `FAIL: list page 1 failed: HTTP 0`, the sandbox cannot reach the relay; its self-test and 30 mutations passed locally and the runner then passed the live read). A mock relay with 1262 events: HEAD caps at 2500 and exits 3, the fix reads 3786 of 3786.

## Review before the push (three read-only skeptics, one workflow)

Fidelity: sound (4000 random buckets, identical to HEAD's loop). Premise: the cap-alone premise holds; the recorded onset was wrong; the exit branch `failed || capped` and the printed lines were untested. Overreach: the 10000 horizon was unrecorded. All three are closed in `db92f6f` and the CC-CMD; the full dispositions are in the CC-CMD.

## Incidents (Rule 77)

- The step was reported in this session's earlier records as "not mine, not investigated" and was red for about 13 hours. It was not caused by any commit of this session, which the run history shows (the first capped run, `45043402749`, is at 16:21Z on 2026-11-22), but a red gate named and left unread is the pattern Rule 77 exists for. It took one saved log and one reading of the script's last lines to find the cause.
- The onset in `outbox/cc-session-2026-11-22-aflw-kali-source-read.md` ("the five runs back to `45066353369` (20:25Z) are red") is a lower bound, not the onset: the first capped census is run `45043402749` at 16:21:44Z. Two other steps were red in the same window (the absence-collapse baseline at 16:29Z, and the unauthenticated odds route labels at 20:04Z and 20:25Z); neither is red now.
- A first push of `db92f6f` was rejected because a bot commit had moved `main`; the commit was rebased onto it and pushed (`git pull --rebase`, then push).

## Open, with the second CC-CMD (Rule 87.4)

Task 2 of the CC-CMD (the permanent form: the step's cost should follow new captures, not history) waits on an owner ruling among A (raise the constant), B (wall-clock budget, a sample) and C (per-event baseline; recommended). Trigger and verify command are in the CC-CMD (planned reads of 7000 or more in the step's COVERAGE line). No other residual: the Task 1 done condition is met.
