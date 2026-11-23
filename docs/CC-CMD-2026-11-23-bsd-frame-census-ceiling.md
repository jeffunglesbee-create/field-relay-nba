# CC-CMD-2026-11-23-bsd-frame-census-ceiling

**Status:** PARTIAL 2026-11-23: Task 1 (the census reads what it plans to) is built, pushed as `db92f6f` and read on the runner: Repo guards run `45115192139`, all 64 steps success, step 45 prints `2531 of 2531 planned reads, 0 failed` and `PASS`. Task 2 (the permanent form, so the step stops depending on a constant) waits on an owner ruling, with its unblock criteria below.

**BUILD-ON-A, searched 2026-11-23.** `grep -rli "check-bsd-frame-contract" docs` lists `CC-CMD-2026-10-16-bsd-list-and-contract.md` (DONE; it built this check and the guard step) and `CC-CMD-2026-10-19-guards-only-src-readers.md`; `grep -rn "READ_CAP" docs scripts` finds only the separate next-goal census's own cap (default 1500, `bsd-next-goal-census.mjs`, dispatch-only workflow, 246 reads on its last run). No CC-CMD covers the frame census's read cap. Nothing here undoes a ruling or a hold of either document; the contract declaration, `guards.yml`, `src/` and `wrangler.toml` are untouched.

## What happened (Rule 73: read 2026-11-23, by the method named)

| claim | evidence | method |
|---|---|---|
| Step 45 was red on the read cap alone: all five declared frames AGREE, the five in-run mutations are caught, and the step exits 3 | run `45107453911` (`e638661`), step output: `COVERAGE: 2869 keys in 4 list page(s); 1363 events, 1262 non-shell read; 2500 reads, 0 failed, CAPPED at 2500`, five `AGREE` rows, then `INSUFFICIENT: 0 read(s) failed, reads capped; the sample is not the census it claims`; the job has one `##[error]`, exit code 3 | job log fetched with `get_job_logs`, step output read from the saved file |
| The cap began to bind on 2026-11-22 at 16:21Z, not at the 20:25Z an earlier session record gives | the last uncapped census read `2497 reads, 0 failed` (2835 keys, 1245 usable events) and passed; run `45043402749` (created 2026-11-22T16:21:44Z, `get_workflow_run`) read `2500 reads, 0 failed, CAPPED at 2500` (2845 keys, 1250 events). The 20:25Z in `outbox/cc-session-2026-11-22-aflw-kali-source-read.md` is the earliest run that record looked back to, a lower bound | the COVERAGE lines of both runs, from their saved logs |
| The 2500 was a constant, not a change: the check, the contract and the declaration did not move between the passing and the failing census | the same two COVERAGE lines: reads 2497 against the cap 2500, then 2500 | as above |
| The census needs 2531 reads today | run `45115192139`, step 45: `COVERAGE: 2869 keys in 4 list page(s); 1363 events, 1262 non-shell read; 2531 of 2531 planned reads, 0 failed; 120 own goals excluded`, then `PASS: every declared frame agrees with the captures` | job `137496315841` log, read the same way |
| The bucket grows about 24 keys a day | 2026-10-16: 1927 keys, 791 usable events, 1589 reads (`outbox/cc-session-2026-10-16-bsd-list-and-contract.md`); 2026-11-22: 2835 keys, 1245 events, 2497 reads. 908 keys in 37 days. A weekend slate adds up to about 60 a day | arithmetic over the two logged runs |
| List plus 2500 reads took 38.9 s on a runner (about 64 reads a second) | the log's own timestamps, `12 mutations: 12 caught` at 03:47:07.755Z to `=== BSD frame contract` at 03:47:46.624Z. Not measured above 2500 reads; retries on a 5xx or 429 (1, 2 and 4 s sleeps) are not counted as reads | log timestamps |

## Task 1: the census reads what it plans to (DONE)

`scripts/check-bsd-frame-contract.mjs`: the fixed `READ_CAP = 2500` is replaced by `plannedReads(usable)` (the reads the list implies, an upper bound that is exact when nothing fails) and `READ_CEILING = 10000` (the runaway guard; a census needing more is still INSUFFICIENT, printing both numbers). The loop moved into `readCensus(get, ceiling)` and `live(contractSource, get, ceiling)` takes both, so the self-test serves a bucket from memory and drives the whole run. `wantedFiles(e)` is the one definition of which files an event needs, shared by the usable filter, the plan and the loop. The COVERAGE line now reads `N of M planned reads`.

`scripts/mutate-bsd-frame-contract.mjs`: 12 mutations became 30, each applied exactly once and each caught by the assertion its name describes (each was run on a copy and its first failing assertion read).

**Done condition, read from the runner (VERIFY-ARTIFACT-A):** the guards step prints a COVERAGE line with no `CAPPED` and ends `PASS`. Met on run `45115192139` (`db92f6f`): `2531 of 2531 planned reads, 0 failed`, `PASS: every declared frame agrees with the captures`, step 45 took 91 s.

## Review of Task 1 before it was pushed (three independent skeptics, read-only)

| lens | verdict | what it found | disposition |
|---|---|---|---|
| fidelity | sound | the refactor reproduces HEAD's loop on 4000 random buckets (reads, order, failed, capped, parts all identical); `plannedReads` is never below the reads made and exceeds the ceiling whenever capped | none needed |
| premise | defect (two points) | the cap-alone premise holds; but the onset time was wrong, and 9 of 14 extra mutants survived, among them the `failed || capped` exit branch that is the very line that turned the step red, the COVERAGE print, and every event shape at its byte boundaries | onset corrected above and in the code comment; 11 mutations and 9 self-test cases added so each survivor now fails |
| overreach | defect (two points) | raising 2500 to 10000 is a bounded deferral whose horizon was not recorded, and the mutation gap above | horizon recorded in the code comment (about 4 to 11 months from 2026-11-23, because 2531 of 10000 planned reads are used at about 22 to 60 reads a day) and Task 2 filed here |

One suggestion was not adopted: failing at once when `planned > ceiling`, without reading. A capped census still prints its AGREE or DISAGREE rows over the reads it did make, which is how this very red was diagnosed (all five frames agreeing on 2500 reads); refusing to read would remove that.

## Task 2: the permanent form (owner ruling needed)

The cost of the step grows with history, not with change: every push re-reads every finished capture, and a finished capture does not change. A larger constant binds again, by design, in months.

| option | what it is | cost | what it changes about the claim |
|---|---|---|---|
| A. leave it | raise `READ_CEILING` when the COVERAGE line nears it | one line, every few months | nothing |
| B. wall-clock budget | read until a time budget, print `N of M` | small | census becomes a sample (Rule 91 allows it if printed); the all-history claim is lost |
| C. measure each event once | commit a baseline of per-path counts for events through a boundary; each run reads only events after it and merges | moderate: a baseline file and a rule for when to regenerate | keeps "every capture agrees"; cost grows with new events only; needs a rule if the relay ever rewrites an old capture |

**Recommendation: C**, because A is a deferral by construction and B gives up the claim the guard exists to make. It changes what the guard is, so it is the owner's ruling, not a build here.

**Unblock criteria (Rule 74).** Blocked by: an owner ruling on A, B or C. Unblocked when: the ruling arrives, or the latest Repo guards run prints planned reads at 7000 or more (70% of the ceiling), whichever is first. Verify the trigger: in the latest `guards.yml` run's step "every BSD frame the contract declares matches the captures", read the `COVERAGE:` line; `N of M planned reads` with `M >= 7000` fires it. **Done condition for Task 2:** after the ruling, the planned reads in two guards runs a week apart differ by no more than the reads for the events captured in between (C), or the ruling says A and the ceiling constant is raised with its horizon re-measured (A).
