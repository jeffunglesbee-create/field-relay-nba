# Session record, 2026-11-27 (19:00Z to 19:35Z): the two red Repo guards steps, and a staged verifier for the 524-row UEFA history write

Owner instruction: "go step 63 wording fix, build the step 11 verifier" (after the red `Repo guards` on `afed116` was diagnosed to the owner).
Spec: this repository's `docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md`, the staged write of Addendum 2026-11-27 part 3 (not a new CC-CMD; BUILD-ON-A).

## HEAD progression (branch main)

`afed116` (the AFLW source research) -> `2dbe794` (step 63 wording) -> `5df5861` (check 16, the verifier, its tests, its mutation harness, the claim tag).

## What was red, and whose it was (Rule 77: investigated before anything was changed)

`Repo guards` run `46036218899` on `afed116` failed two steps: step 11 (a staged claim names a verifier that exists and runs) and step 63 (HANDOFF close-outs name a session doc that exists). The same two steps had already failed on `db0828a` (run `46032219531`), the other session's UEFA commit, which landed before `afed116`. `afed116` touches neither failing file (0 diff lines in the BSD CC-CMD; its HANDOFF entry is not a close-out heading).

- Step 63: the 17:00Z close-out wrote "the laboratory's outbox/cc-session-2026-11-27-uefa-forecast-measure.md"; `check-closeout-session-doc.mjs` read that as a relay path. The file exists in field-laboratory on origin/main (`2b163f4d`, read by `git cat-file -e`). Fix: the `field-laboratory/` prefix every other cross-repo close-out uses. Before: `FAIL every named session doc exists (1 missing)`; after: 157 close-outs, 0 missing, exit 0 (the checker's own exit code, not a pipe's).
- Step 11: `**STAGED (Rule 74), the write.**` for the 524 UEFA history rows named no verifier. `deploy.yml` runs the same gate before its deploy step, so it would have blocked the next `src/**` deploy (stated earlier in this session from `deploy.yml`; not re-run).

## Premises, each with the one command that could refute it (Rule 100), run before building

| premise | command | result |
|---|---|---|
| the expected counts are ESPN's completed counts, with 0 archived in the history windows | read the 2026-11-27 dry-run artifacts `outbox/archive-league-history-backfill-uefa-*-2026-11-27T16-*Z.json` | Champions League 186 / 0, Europa League 186 / 0, Conference League 150 / 0 for 2025-09-01 to 2026-04-30; Conference 57 completed, 55 archived for 2026-05-01 to 2026-11-25 |
| the archive agrees right now | `outbox/archive-label-dates-2026-11-27T19-24-06-750Z.json` (a fresh read by the other session, both game tables) summed over the four windows | 0, 0, 0, 55 |
| the UEFA rows live in `regular_season_games` only, so both tables must still be counted for safety | the same file's `tables` per label | only `regular_season_games`; the check counts both anyway, as the backfill's `alreadyArchived` does |
| the row `date` is the scoreboard date the backfill asked for | `bodyOf(label, date, g)` in `scripts/run-archive-league-history-backfill.mjs` | `date` is the loop date, so a date-window count has the dry run's own semantics |
| the claim's all-time totals (279, 279, 225) are a snapshot, not a stable target | the claim's own sums: 93 + 186, 93 + 186, 73 + 150 + 2, against the 02:00Z archive read | they hold on 2026-11-27 and rise with every matchday the cron archives (14, 9 and 5 distinct dates per label), so an equality test on them would turn FAIL on a perfect write. Not demonstrated by two readings at different times: argued from the cron's per-matchday writes |
| the SQL shape (a sub-select over both tables with numbered parameters) is accepted by `/d1/execute` | the live run below | accepted |

## Built (commit `5df5861`)

- `scripts/staged-verdicts.mjs`: `UEFA_HISTORY_WINDOWS` and the verdict `uefaHistoryWritten`, registered as `uefa_history_written` with `mustFailOn` (a window one row over ESPN's). PENDING while the history windows hold nothing, PARTIAL while some is written, PASS when all four equal ESPN's counts, FAIL on any window above ESPN's or on a payload that is not four counts.
- `scripts/verify-staged-items.mjs`: check 16, four bound-parameter SELECTs (`COUNT(home_score)`, both tables, exact label); `EXPECTED_CHECKS` 15 -> 16.
- `scripts/staged-verdicts-check.mjs`: the clean payload, the windows pinned to the dry runs, every state, ten malformed payloads, and the executor block run against a stubbed `d1`. The aflapi executor test's slice now ends at the Check 16 marker. 222 passed on the parent commit (measured), 268 after.
- `scripts/mutate-staged-verdicts-uefa-history.mjs` (Rule 90): 21 mutations of the verdict and the executor, each asserting its anchor is unique and applied; 21 caught. The first set of tests let V2 (PASS tolerates one missing row) survive; two tests were added and it is caught.
- `.github/workflows/deploy.yml`: the harness runs beside `mutate-staged-verdicts-vendor-watch.mjs`.
- `docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md`: the claim opens `**STAGED** (verifier: uefa_history_written @ relay/staged-verification.yml)` and its Verify line says why the windows replace the all-time totals. Nothing else in that file changed.
- `scripts/check-d1-batch-param-cap.mjs` and `scripts/check-aggregate-launders-unknowns.mjs`, the two guards that scan `scripts/`, were run on the change (both pass).

## Verified (artifacts)

- `Repo guards` run `46057021333` on `5df5861`: success (so steps 11 and 63 pass). `Workflow YAML Gate` `46057021339`: success.
- `staged-verification.yml` run `46057026915`, manifest `outbox/staged-verification-20261127T192923Z.json`: `query_ok` true, 16 checks, `any_failed` false, check 16 `PENDING`, `qualifying_rows` 55, windows 0/186, 0/186, 0/150, 55/57. That is exactly what the 19:24Z archive read predicts, which also proves the live SQL.
- `node scripts/staged-verifier-check.mjs`: 10 of 10 staged claims resolve locally (before: 9 and one with no verifier).

## Not verified (stated plainly)

- The PASS path against the real archive: the write has not happened. PASS, PARTIAL and FAIL are covered by the verdict tests and the stubbed executor, not by production rows.
- Whether ESPN's completed counts stay at 186, 186, 150 and 57. They are for past matches and were read once. If a later write stops at PARTIAL with every window one row short, read the dry runs again before suspecting the write.

## Mistake corrected

The first commit message of `5df5861` carried a baseline ("193") that was not measured. Measured on the parent commit: 222. The message was amended before the push. The numbers above are the measured ones.

## Open

The 524-row write is still the owner's decision (the claim's "Unblocked when: the owner says to write them"); `staged-verification.yml` runs daily at 06:00 UTC and reports PENDING until then. Nothing else is deferred.
