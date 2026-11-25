# CC session 2026-11-25 — the ESPN reference grade's runner (Task 1 of the independent-reference CC-CMD, relay half)

**Task:** the owner's "Build task 1" (2026-11-25), `field-laboratory/docs/CC-CMD-2026-11-23-bsd-next-goal-independent-reference.md`. **Not run:** Task 2 (one independent reader), Task 3 (the run: needs the owner's go-ahead) and Task 4 (the record). **No `src/` change, no deploy.**

## HEAD progression (field-relay-nba, `main`)

`13a3349` → `92718a8` (the Task 0 lib's `reachEach` and `summaryToEspn`, `readDays` exported from the reach probe; lib check 78 assertions, harness 77 of 77) → `6d23457` (the runner, its run check, its harness) → `431c0cc` (the workflow). Laboratory half: `49f53f0e` (core, check 84 assertions, harness 78 of 78).

## What was built

- `scripts/espn-reference-grade.mjs`: loads and shape-checks both laboratory cores BEFORE any request (a missing `LAB_DIR`, a core that lacks an export or `RULE_VERSION`, or, under the Actions, a `LAB_SHA` that is not 40 hex, exits 1 with no request made); the census's `collect()` and `populationOf` give the calls; `matchesOf`/`readDays` read `/context/date`; `reachEach` says which matches reach exactly one ESPN id (the relay's existing join does the matching, nothing is joined here); one ESPN summary per reached match, one second apart, a 403 or 429 stops the run, a redirect is a status, every read times out; the laboratory's `gradeAgainstEspn` grades. The artifact is counts only (no name, id or token), records both cores' sha256, the laboratory commit and this repository's own file hashes, and `-latest.json` advances only on a complete run.
- `scripts/check-espn-reference-grade-run.mjs`: the REAL runner against stub BSD, relay and ESPN servers, with the real laboratory cores: 3 scenarios, **49 assertions** (a complete run of 7 calls on 6 matches, each landing somewhere different; what stops it: 429, 403, caps, a throttled day, an unread day, BSD 429, no token, a redirect, a 200 that is not JSON or not the summary, an ESPN read that never answers, the spacing; the cores that are not what the runner needs, including ones that throw with the token in their message).
- `scripts/mutate-espn-reference-grade.mjs`: **50 of 50 mutants caught**, controls ok (unmodified copy passes with at least 49 assertions, a comment-only copy passes). Equivalent or unexercised terms are listed in its header with the reason.
- `.github/workflows/espn-reference-grade.yml`: dispatch-only, main-only, `lab_ref` a full SHA, bounded caps; `verify` (no secret) → `grade` (token, no write credential, step timeout 20 min) → `commit` (write credential, no token, only the grade's own JSON files).

## What the harness found in my first draft of the check

A core that throws with the token in its message left NO artifact (the runner's own refuse-if-token step fired first): the error text kept in the artifact is now redacted, so the spend is recorded and the token is not. The ESPN timeout, the spacing, a throttled day whose body is still valid, and an empty ledger were each unasserted; each has a scenario now. One term, `bsdStopped === null` in `complete`, cannot be made to matter by any input (any BSD stop leaves the ledger incomplete, so the census verdict already refuses): documented as equivalent in the harness header, not mutated.

## Verified, by a command each

- `node scripts/check-espn-reference-grade-run.mjs --lab /home/user/field-laboratory` → `ok 3 scenarios, 49 assertions`.
- `node scripts/mutate-espn-reference-grade.mjs --lab /home/user/field-laboratory` → `50 of 50 mutations caught; controls ok; 49 assertions required of the clean copy`.
- Every check the workflow's `verify` job runs, run locally against the laboratory checkout: lab bsd core `--self-test` OK and 200 assertions; lab espn core 84; census 96 and 66; grade-run 126; task0 lib 78; reach probe 27. `bash scripts/absence-collapse-ratchet.sh` → ratchet OK. `workflow-yaml-check`: 229 files, 0 failing. `check-workflow-timeouts`: 0 findings.

## STAGED (Rule 74)

- **The run.** Blocked by: the owner's go-ahead (Task 3). Unblocked when the owner says to run it. Command: dispatch `espn-reference-grade.yml` on `main` with `lab_ref` = the laboratory's full SHA at that time. Verify: `outbox/espn-reference-grade-latest.json` has `reachedTarget` true and `grade.partitions` true, and `grade.population` equals the census's gradeable count.
- **Not exercised:** real ESPN through this runner (Task 0 read the same summary shape from a runner, but the grade's reads are the first through this code); ESPN's own-goal convention; a shootout row in the summary header's `details` (it carries no `shootout` flag, so it would break the goal-count guard and surface as a named reason, not a wrong grade).

**Integration state (Rule 65):** relay contract: reads the relay's `/context/date/{day}` (`games.regular[]`/`games.postseason[]` rows with `bsd_event_id`, `espn_event_id`, `sport`, `id`) and `/bsd/r2/*`; no relay change. Client consumer: none. Status: runner and workflow STAGED (built, checked on stubs, not dispatched).
