# WC table cleanup, applied 2026-11-24 (manifest)

**What:** Task 3 and Task 3b of `docs/CC-CMD-2026-11-07-wc-results-club-contamination.md`, on `WC2026_DB` (`wc2026`, `f26669de-e772-4b56-a6d1-f8fdea08a4d4`).
**Approval:** the owner's answer "Approve all of Task 3 and 3b" to the question asked in this session on 2026-11-24 (options offered: all of Task 3 and 3b, without the
deletes, not yet). **Not covered by that answer and NOT done:** step 1c (Bosnia's spelling), which the CC-CMD names as the owner's separate choice and the question did not list.
**Mechanism, and a correction.** The question said a GitHub Actions runner would apply the SQL because "the D1 tool here is read-only". That was wrong: the D1 tool in this
session accepts writes (a no-op `DELETE FROM wc_results WHERE 1 = 0` answered `success`, `changes` 0, before anything real ran). The SQL below is the approved SQL, unchanged,
applied by that tool, one statement per call, each call's `changes` read back. No runner workflow was written.
**Restore point.** The first write began at **2026-11-24T17:01:58Z**. The rows it touched are in `outbox/wc-cleanup-restore-2026-11-24.sql` (committed to main at 16:43Z, before
any write; 117 rows plus 12, checked against D1 by a positional checksum). D1 Time Travel is the other route (a restore to a time before 17:01:58Z).

## Before (read 2026-11-24 between 16:41Z and 17:02Z)

`wc_results` 219 rows: group 138, third 58, r32 5, r16 8, qf 4, sf 2, final 4. `wc_group` 59 rows (8 groups with a size other than 4). The 117 rows to delete: 61 outside the
tournament's dates and 56 legacy group rows (overlap 0); each of the 56 had an `espn:` twin in the same group, on the same date, with the same score (re-checked immediately
before the delete: 0 without one).

## The statements, in the order run (step numbers are Task 3b's), with the rows each changed (read from the call's own `meta.changes`)

| # | statement | changes |
|---|---|---|
| 1 (r32) | `UPDATE wc_results SET phase = 'r32', group_id = 'R32' WHERE game_id IN (9 ids)` | 9 |
| 1 (third) | `UPDATE wc_results SET phase = 'third', group_id = 'THIRD' WHERE game_id = 'espn:760516'` | 1 |
| 1b | `UPDATE wc_results SET bsd_event_id = '8342' WHERE game_id = 'espn:760468' AND bsd_event_id IS NULL` | 1 |
| 1b | `UPDATE wc_results SET bsd_event_id = '8341' WHERE game_id = 'espn:760473' AND bsd_event_id IS NULL` | 1 |
| 2 | `DELETE FROM wc_results WHERE phase = 'group' AND game_id NOT LIKE 'espn:%'` (the 56 duplicates) | 56 |
| 3 | `DELETE FROM wc_results WHERE match_date < '2026-06-11' OR match_date > '2026-07-19'` (the 61 club rows) | 61 |
| 4 | `DELETE FROM wc_group` then the `INSERT INTO wc_group ... SELECT ... GROUP BY group_id, team` of Task 3b step 4, in one call | 59 deleted, 48 inserted |

Before step 4 the SELECT of that INSERT was run alone: 48 rows, 12 groups, 4 teams in each, every team played 3, goals for 215 against 215.

## After: the done condition of the CC-CMD (Rule 89), each line the output of one query

```
SELECT group_id FROM wc_group GROUP BY group_id HAVING COUNT(*) <> 4                    -- 0 rows
SELECT COUNT(*) FROM wc_results WHERE phase = 'group'                                    -- 72
SELECT COUNT(*) FROM wc_results WHERE match_date < '2026-06-11' OR match_date > '2026-07-19'   -- 0
SELECT phase, COUNT(*) FROM wc_results GROUP BY phase                                    -- final 1, group 72, qf 4, r16 8, r32 14, sf 2, third 1
```

Also read: `wc_results` 102 rows (219 - 117); `wc_group` 48 rows; both `bsd_event_id` values present on `espn:760468` and `espn:760473`; no group row with a group_id outside A to L; no
`wc_group` team with `played` other than 3; every r32 row `group_id` 'R32'; `espn:760516` is `THIRD`/`third`.
**Read through the relay (Rule 61, data half):** `GET /wc/standings` answered 200 with 12 groups of 4 teams, every team `played` 3. That is the relay's output; the client's render of it was NOT read.

## Not reached by these writes (owner decisions, unchanged from the CC-CMD)

(a) BracketDO's stored snapshot, `results:all` and the rest, still reflect the contaminated results until a new result or `/wc/bracket/refresh`; (b) the ten `game_recap` briefs in
`ARCHIVE_DB` that frame the misfiled games as group games; (c) KV `wc:projections:current`, `wc:bracket:current` and `wc:movers:current` (the first `/wc/projections` miss should come
after this cleanup, and it now can); (d) step 1c, Bosnia's spelling: `/wc/standings` shows "Bosnia-Herzegovina" in group B, where the client's own group list names "Bosnia and Herzegovina";
how the client renders it is UNVERIFIED.
