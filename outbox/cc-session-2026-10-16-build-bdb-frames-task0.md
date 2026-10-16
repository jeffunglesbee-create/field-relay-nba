# CC session — 2026-10-16 — build-bdb-frames, Task 0 only

**CC-CMD:** `docs/CC-CMD-2026-10-15-build-bdb-frames.md`, TASK 0 (measure
before extracting). Tasks 1-4 are not started; nothing was extracted and no
route was added.
**Stop condition:** NOT MET. `pass_forward` is an event string in the data:
1,004 plays of week 2.
**Evidence:** jubilant-bassoon run 38926713081 (commit `696a2b15`),
artifact `outbox/bdb-frames-task0-latest.json` in jubilant-bassoon, written
2026-10-16T15:47:35Z.

## What Task 1 has to settle first

1. **Where the builder runs.** The Kaggle credentials are jubilant-bassoon's
   secrets. No workflow or script in this repo references Kaggle credentials
   (this session cannot list secret names). The six existing BDB files are
   built in jubilant-bassoon (`build-bdb-data.py`, uploaded to R2), and this
   probe ran there for the same reason. So the builder runs in
   jubilant-bassoon, or this repo gets its own Kaggle credentials.
2. **Both events over week 2 are well over 2 MB.** The spec's sample envelope
   (without the coordinate-convention fields Task 2 also requires), week 2,
   `ball_snap` and `pass_forward`, compact JSON: **4,919,405 bytes**. The
   probe read "2 MB" as 2,097,152 bytes (2.35×); read as 2,000,000 it is
   2.46×. Keeping whole games in gameId order, 6 of 16 fit under 2,097,152
   (2,008,434 bytes) and fewer than 6 under 2,000,000. The spec orders the
   cut "fewer games, then fewer event frames" and prefers "one week, all
   teams"; which games to keep, and the gate's byte value, are Task 1's. The
   size of a `pass_forward`-only week was not measured.
3. **`ball_snap` is missing from 4 of 1,809 plays (week 2).** `snap` does not
   occur. `snap_direct` occurs in 4 plays (whether they are the same 4 was
   not measured). `frameType` is `SNAP` on 41,607 rows, which is 1,809 frames
   at 23 rows each (one per play was not checked).
4. **Five plays carry `pass_shovel` (week 2).** A shovel pass is a forward
   pass in the rules but is recorded under its own name. Whether any of those
   plays also carries `pass_forward` was not measured.

## Results

| Task 0 item | measured | population |
|---|---|---|
| weeks | **1-9**, every game `season` 2022 (136 games) | `games.csv`, all |
| games per week | 16, 16, 16, 16, 16, 14, 14, 15, 13 | `games.csv`, all |
| teams per week | 32 in weeks 1-5; 28, 28, 30, 26 in weeks 6-9 | `games.csv`, all |
| plays per week | 1,952 / 1,809 / 1,959 / 1,830 / 1,906 / 1,697 / 1,665 / 1,771 / 1,535 | `plays.csv`, all |
| plays per game | median 114.5 to 121 by week; min 67 (week 2), max 156 (week 1) | `plays.csv`, all |
| dropback plays per week | 1,219 / 1,111 / 1,223 / 1,051 / 1,142 / 1,035 / 991 / 1,050 / 914 | `plays.csv`, all; `isDropback` is literally `TRUE` 9,736 / `FALSE` 6,388 |
| sample rate | **0.1 s in all 289,684 consecutive-frame intervals** (10 Hz) | week 2, every row |
| frames per play | min 31, median 162, max 489; rows by `frameType`: BEFORE_SNAP 4,418,691, AFTER_SNAP 2,244,041, SNAP 41,607 | week 2 |
| players per frame | 22 player rows in every one of 291,493 frames; 291,493 `football` rows in all (one per frame on average, not counted per frame) | week 2 |
| bytes per week on disk | see below; week 2 streamed 916,177,128 bytes = the listed size, `text/csv`, no content encoding | Kaggle file listing, all |
| nflId → name | 1,150 nflIds in week 2, all 1,150 in `players.csv`; nflId unique there (1,697 rows), no empty name; 8 tracking names differ from `players.csv` | week 2 |
| nflId → team | tracking `club`: 32 distinct values on player rows; no player changes club inside a play or across the week; `player_play.teamAbbr` per play; offense/defense from `plays.possessionTeam`/`defensiveTeam` resolved for every emitted row (`ball_snap` and `pass_forward` frames) | week 2 |
| position, and its grain | **per-player.** Only `players.csv` has a position column; no position column in `player_play`, `plays`, `games` or any tracking file. 19 values, WR 224 ... LB 1 | columns: headers of all 13 CSVs; values: `players.csv`, all 1,697 rows |

Bytes per tracking week, from Kaggle's file listing:

| week | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|
| bytes | 971,403,802 | 916,177,128 | 975,586,722 | 922,169,785 | 971,152,971 | 852,375,725 | 824,474,366 | 903,573,224 | 774,645,862 |

Dataset total 8,171,097,577 bytes; `player_play.csv` 52,533,762, `plays.csv`
6,892,353, `players.csv` 104,749, `games.csv` 7,128. Version 1, last updated
2026-02-19.

## Event vocabulary, literal, week 2

Every row of week 2 (1 of 9 tracking files; the vocabulary of weeks 1 and
3-9 was not read). Counted by distinct frame; for every event, rows are 23 ×
frames. 35 distinct strings; 6,418,656 of 6,704,339 rows carry no event.

| event | frames | plays |
|---|---|---|
| `ball_snap` | 1,805 | 1,805 |
| `line_set` | 1,800 | 1,800 |
| `huddle_break_offense` | 1,410 | 1,410 |
| `first_contact` | 1,163 | 1,163 |
| `tackle` | 1,131 | 1,131 |
| `pass_forward` | **1,004** | **1,004** |
| `pass_arrived` | 806 | 804 |
| `handoff` | 635 | 633 |
| `pass_outcome_caught` | 612 | 611 |
| `man_in_motion` | 582 | 582 |
| `pass_outcome_incomplete` | 333 | 333 |
| `play_action` | 304 | 304 |
| `shift` | 239 | 231 |
| `out_of_bounds` | 186 | 186 |
| `run` | 93 | 93 |
| `qb_sack` | 55 | 55 |
| `touchdown` | 40 | 40 |
| `dropped_pass` | 34 | 34 |
| `pass_outcome_touchdown` | 29 | 29 |
| `pass_outcome_interception` | 22 | 22 |
| `fumble` | 21 | 21 |
| `pass_tipped` | 20 | 20 |
| `qb_kneel` | 17 | 17 |
| `play_submit` | 14 | 14 |
| `fumble_offense_recovered` | 13 | 13 |
| `qb_slide` | 13 | 13 |
| `fumble_defense_recovered` | 11 | 11 |
| `qb_strip_sack` | 7 | 7 |
| `pass_shovel` | 5 | 5 |
| `lateral` | 5 | 4 |
| `snap_direct` | 4 | 4 |
| `touchback` | 3 | 3 |
| `huddle_start_offense` | 3 | 3 |
| `qb_spike` | 1 | 1 |
| `safety` | 1 | 1 |

No frame carries two events. `pass_forward` never occurs twice in one play.
Of week 2's 1,111 dropback plays, **1,002 have a `pass_forward` frame
(90.2%)**; 2 `pass_forward` plays are not dropbacks.

## The week, and why

**Week 2.** Rule, stated in the artifact: of the weeks where every team plays
(1-5), the fewest `plays.csv` plays, lower week on a tie. Play count is the
size proxy; the artifact size was measured for week 2 only. Candidates:
1,952 / **1,809** / 1,959 / 1,830 / 1,906 plays.

## Premises in the CC-CMD, checked

- **"HTTP 401 ← credentialed; creds exist."** `scripts/bdb-access-probe.mjs`
  sends no Authorization header, so its 401 shows only that the endpoint
  wants credentials. They do exist, in jubilant-bassoon: its monthly
  `bdb-update.yml` run 36880327214 logged `sep week 1` through `sep week 9`
  on 2026-10-01 (e.g. `sep week 9: 606 pass_arrived plays, 604 scored`),
  and this probe used them.
- **"Kaggle ... delivers the archived 2022 season."** Holds: every game in
  `games.csv` has season 2022.
- **"~10 Hz over a ~4–6 second play ... 40–60 frames."** In week 2, 10 Hz
  holds in every interval. AFTER_SNAP is 2,244,041 rows, which is 97,567
  frames at 23 rows each, or 53.9 per play on average. Counting the pre-snap
  frames, the median is 162 frames per play.

## How it was measured

`jubilant-bassoon scripts/bdb-frames-task0-probe.py`, dispatch-only workflow
`bdb-frames-task0-probe.yml`. Stage A reads Kaggle's file listing (no file
downloaded). Stage B reads `games.csv`, `plays.csv` and `players.csv` whole,
plus the header line of every CSV. Stage C picks the week from A and B, then
streams that one tracking file and parses every row without storing it. The
artifact is rewritten after each stage. It holds no credential: HTTP
statuses, counts, file names, CSV headers and dataset metadata.

Before the run: the self-test passed (41 checks; the jubilant-bassoon commit
message says 36, counted before the last checks were added). 37/37 mutations made a check
fail, and the harness refuses an anchor that is not unique and requires the
unmutated self-test to pass. A fake Kaggle server ran it end to end (25
checks), including a truncated week file ending in a malformed row and a
table that 404s; both kept the earlier stages. The mutation harness and the
fake server are session scratch files, not committed. A two-lens review found 7 gaps before the first run,
all fixed: all-or-nothing writes, `isDropback` literals unrecorded, name and
team resolution unmeasured, position grain not concluded, the pick rule's
proxy unstated, the verdict's population unstated, and the spec's named
events not reported as present or absent.
