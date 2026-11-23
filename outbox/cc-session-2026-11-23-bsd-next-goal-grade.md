# CC session 2026-11-23 — BSD next-goal grade: 372 of 372 gradeable calls agree with FIELD's own goal timelines

**Task:** the owner's "Yes, run from relays runner" (2026-11-23), answering the two unblocks of field-laboratory `docs/CC-CMD-2026-11-22-bsd-next-goal-grade-against-field-timelines.md`: the proof may run, from this repository's runner.
**Spec and result:** that document (its Result section is the full record). **Result:** DONE.

## HEAD progression (field-relay-nba, branch `main`)

`2dc5875` (start) -> the first runner commits (`57a3ef8` the census exports `collect()`, `8ad6c42` the runner and workflow) -> `45765fa` the census reads redirects as statuses and every fetch has a timeout -> `24429a0` the runner after the first review -> `377f434` the runner and a three-job workflow after the second -> `e1f3a64` the run's own artifact commit -> this close-out. Laboratory: `5e8fd8da`, `c3a5ffa3`, `59af6e89` (the commit that ran), `fd8ffb27` (the Result). Other sessions' commits are interleaved and not recorded.

## What was built (the grading RULE and its counting live in field-laboratory, LAB-FIRST-A)

- `scripts/bsd-next-goal-grade.mjs` — the runner: reuses the census's `collect()`, selects the census's own gradeable population, loads the laboratory's pure core BEFORE anything is spent, checks the core's return, requires the core's calls, distinct captures and calls per R2 directory to equal the census's, writes a counts-only artifact tied to the laboratory commit, the core's sha256 and its own file hashes.
- `scripts/check-bsd-next-goal-grade-run.mjs` (22 scenarios, 126 assertions, against stub servers and the real core) and `scripts/mutate-bsd-next-goal-grade.mjs` (162 mutations, all caught, with two controls that a copy changing nothing passes).
- `.github/workflows/bsd-next-goal-grade.yml` — three jobs: `verify` (no secret: the laboratory's and this repository's checks and both mutation harnesses), `grade` (the token, read-only, no persisted credential), `commit` (the write credential, no token, no laboratory code; accepts only files named like the grade's own). `lab_ref` is a required 40-hex SHA; the dispatch must be on main.
- `scripts/bsd-next-goal-census.mjs`: `collect()` exported; fetches read a redirect as a status and carry `FETCH_TIMEOUT_SECONDS` (default 30). Census harness 200 of 200 caught.

## Two adversarial reviews before the run (71 agents), and why

The first build was reviewed by 45 agents and found unsafe to run; the revision by 26 more, which found no wrong grade but 81 behaviours the check could not see and that the grade job held a write credential. Both rounds' confirmed findings were fixed and pinned. The ones that would have mattered on the run: the runner harness was vacuous ("79 of 79" was meaningless, now with controls); a grade of zero calls advanced `-latest.json`; a vendor `goal_type` of `__proto__` rewrote `Object.prototype`; a stalled response body hung the run on Node 22 with `redirect: 'error'` (the abort is lost after about 9 s); the token could reach stderr through an error; `lab_ref` defaulted to main. The owner's weekly usage ruled out a third round.

## Result (verified, not assumed)

Run 45263837691 (2026-11-23T20:56Z): verify, grade and commit all green; 11 BSD requests of 16, 249 reads. Ledger 1,754 calls, census gradeable 372 on 238 matches. **372 of 372 agree, 0 disagree, 0 not applicable;** ledger hit and FIELD hit 282, ledger miss and FIELD miss 90; every resolving goal at the ledger's `resolved_minute`; 372 calls on 367 distinct goals; 13 stoppage-time, 26 penalty and 13 own-goal resolving goals all agree; 118 calls on captures with VAR rows agree. Every counted premise held. One observation is not explained: on 1 in-play capture (2 calls) the live row's score differs from the last goal's; those calls agree.

## Not verified, and what it is not

Not an independent grade: FIELD's captures and the vendor's ledger both come from BSD, so agreement is one feed read twice. The one capture with a differing live-row score is unnamed (the artifact holds counts only). Calls in untracked leagues (1,265) were not graded. Rule 45: no ledger row, team, player or event id is in the artifact.

## Carry-forwards

None owed by this CC-CMD. An independent reference (a second source's goal timeline) would be its own CC-CMD if the owner wants one.

## Re-run

Dispatch `bsd-next-goal-grade.yml` on main with `lab_ref` set to a full laboratory SHA (the checks and harnesses run first and stop the run if any is blind).
