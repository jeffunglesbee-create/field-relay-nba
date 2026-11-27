# Session record, 2026-11-27 (20:00Z to 20:20Z): the 524-row UEFA history write, on the owner's word

Owner instruction: "UEFA history write approved" (after the staged verifier `uefa_history_written` was built and read PENDING).
Spec: `docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md`, the staged write of Addendum 2026-11-27 part 3 (BUILD-ON-A: nothing re-specified; its dispatches were used as written).
No code changed in this session; one production write, one claim marked done, this record.

## Stated before the first dispatch (the claim's "side effect to state first")

`bsd-game-join-backfill.yml` (range from 2026-02-01) picks up the February to April rows on its own schedule and spends BSD pages on them; rows before 2026-02-01 stay unjoined, which a results-only forecast does not need. **CORRECTED 2026-11-27 (after the 21:38Z read): this is wrong.** `outbox/bsd-join-backfill-complete.json` exists, so every SCHEDULED `bsd-game-join-backfill.yml` run skips at its gate (run `46070490625`, 21:28Z, all three jobs skipped); the 126 rows dated 2026-02-01 to 2026-04-30 read 0 joined (re-read at 22:54Z, `outbox/archive-label-dates-2026-11-27T22-54-51-161Z.json`) and all 524 stay unjoined until someone DISPATCHES the join, which spends BSD pages. I repeated the claim from the staged text without checking the gate (Rule 72); the decision is the owner's, in the Addendum 2026-11-27, part 4.

## Checked before dispatching

`archive-league-history-backfill.yml` had no run in progress (the newest, 46031447108, completed 2026-11-27T16:13Z); the workflow keeps one pending run per group, so the four runs were dispatched one at a time, each after the previous run's artifact was read. The windows are 242 days and 19 days, under the runner's 366-day limit.

## The four runs (`dry_run` false, the `league` and `label` exactly as the cron writes them)

| # | league / label | window | run | completed | written | failed | archive after (n, scored) | artifact |
|---|---|---|---|---|---|---|---|---|
| 1 | `uefa.champions` / UEFA Champions League | 2025-09-01 to 2026-04-30 | `46060604957` | 186 | 186 | 0 | 186, 186 | `outbox/archive-league-history-backfill-uefa-champions-league-2026-11-27T20-03-57-680Z.json` |
| 2 | `uefa.europa` / UEFA Europa League | 2025-09-01 to 2026-04-30 | `46061081424` | 186 | 186 | 0 | 186, 186 | `...uefa-europa-league-2026-11-27T20-08-04-108Z.json` |
| 3 | `uefa.europa.conf` / UEFA Europa Conference League | 2025-09-01 to 2026-04-30 | `46061545774` | 150 | 150 | 0 | 150, 150 | `...uefa-europa-conference-league-2026-11-27T20-11-44-263Z.json` |
| 4 | `uefa.europa.conf` / UEFA Europa Conference League | 2026-05-01 to 2026-05-19 | `46062013710` | 2 | 2 | 0 | 2, 2 | `...uefa-europa-conference-league-2026-11-27T20-12-47-575Z.json` |

Every run: `alreadyArchived` 0, `noEventId` 0, `stopped` null. 186 + 186 + 150 + 2 = 524 rows written. Each run reads ESPN's scoreboard fresh, so `completed` equal to `written` is the comparison the claim's Verify line asks the dry runs for; separate dry runs were not repeated.

## Done condition, read (Rule 89)

- `staged-verification.yml` run `46062121581`, manifest `outbox/staged-verification-20261127T201324Z.json`: check 16 `uefa_history_written` is **PASS**, windows 186/186, 186/186, 150/150, 57/57, `qualifying_rows` 579, `query_ok` true, `any_failed` false. The same check read PENDING (0/186, 0/186, 0/150, 55/57) at 19:29Z, before the write (`outbox/staged-verification-20261127T192923Z.json`), so the verifier moved from PENDING to PASS on the real rows: its PASS path is now demonstrated in production, which `outbox/cc-session-2026-11-27-uefa-history-verifier.md` listed as not verified.
- `read-archive-label-dates.yml` (`like` `UEFA%`), run `46062242721`, `outbox/archive-label-dates-2026-11-27T20-14-33-355Z.json`: `UEFA Champions League` 279 rows, `UEFA Europa League` 279, `UEFA Europa Conference League` 225, exactly the totals the claim's Verify line predicted (those totals are a snapshot of this day; the cron raises them on each matchday). `postseason_games` holds 0 UEFA rows. The four windows summed from the same file: 186, 186, 150, 57.

## Residual (not deferred work)

The 524 rows are unjoined (`joined` 0 in each artifact; the label totals read joined 93, 93 and 73, which are the rows that were already there). `bsd-game-join-backfill.yml` joins the rows from 2026-02-01 on its own schedule, oldest first, and spends BSD pages on them, as stated before the write. **CORRECTED 2026-11-27 (after the 21:38Z read): this is wrong.** `outbox/bsd-join-backfill-complete.json` exists, so every SCHEDULED `bsd-game-join-backfill.yml` run skips at its gate (run `46070490625`, 21:28Z, all three jobs skipped); the 126 rows dated 2026-02-01 to 2026-04-30 read 0 joined (re-read at 22:54Z, `outbox/archive-label-dates-2026-11-27T22-54-51-161Z.json`) and all 524 stay unjoined until someone DISPATCHES the join, which spends BSD pages. I repeated the claim from the staged text without checking the gate (Rule 72); the decision is the owner's, in the Addendum 2026-11-27, part 4. Nothing was dispatched for it.

## Changed

`docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md`: the claim now opens `**DONE 2026-11-27 (was STAGED under Rule 74), the write.**` with the runs and the done condition above, the original text kept as the record. `node scripts/staged-verifier-check.mjs` (self-test and run): exit 0, 9 staged claims left, all resolved.

## For the other session

The laboratory's `docs/CC-CMD-2026-11-27-uefa-forecast-on-tonights-cards.md` listed "every later task blocked on the owner" for this write. The archive now holds last season's UEFA results (2025-09-01 to 2026-04-30) for the three labels. That session has not been told; nothing here messages it.
