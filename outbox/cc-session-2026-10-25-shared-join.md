# CC session 2026-10-25 — the shared odds join lands

**Date:** 2026-10-25 · **Repo:** field-relay-nba
**HEAD:** `a6a9f3b` → `63e75fe` → `d46106b` → `f4bea6a` → this doc
**Branch:** main. Commit identity `claude@field.dev` / FIELD CI (owner, 2026-10-23).
**CC-CMD:** `docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md`,
shape (a), ruled by the owner on 2026-10-23. Status PARTIAL.

## Per commit

| commit | what |
|---|---|
| `d46106b` | fix: no opening line is written once its game has started. The cron and the worker backfill refuse a line captured at or after the row's kickoff, or after the vendor's commence for a row without one |
| `f4bea6a` | fix: one per-team join behind the three odds writers that match by name. `src/odds-join.js`; `findOddsForRow` callers hand it `start_time`; `JOIN_UNWRITABLE` gets an end date (`until` 2026-10-26); `scripts/check-odds-join-shared.mjs` (19 scenarios, the real writers on node:sqlite) and its mutation harness |
| this doc's commit | docs: the patch `outbox/staged-shared-join-2026-10-24.patch` removed; the CC-CMD Status and heading; this doc; HANDOFF |

## How it landed

1. **Held for the 11:07Z read.** The owner's ruling: the commits change
   `scripts/measure-odds-consumer-demand.mjs`, so they land after the closing-capture
   demand read. Run 40187677225 finished and its log was on main
   (`outbox/odds-consumer-demand-20261025T110935Z.log`).
2. **Rebased** from the local patch onto `origin/main`. No conflict; main held only
   bot logs.
3. **`until`.** `JOIN_UNWRITABLE.until` was already `2026-10-26`. A deploy on 10-25
   makes 10-26 the first full UTC day after it. The demand script's self-test and
   21 mutations pass.
4. **Gates.** 134 of 136 deploy and guards steps on a clean worktree named
   `field-relay-nba`. The two failures are the environment-only ones (the BSD frame
   list fetch returned HTTP 0; `RELAY_SHARED_SECRET` is unset in the sandbox).
   `check-commit-skip-prose` is clean.
5. **Pushed 14:31:38Z**, in the capture gap 14:30Z to 15:05Z (AmbientDO's windows are
   T-10 minutes before a kickoff; the D1 kickoffs for 10-25 put the next at 15:15Z).
6. **Green.** Deploy RELAY Worker 40202657716 at 14:38:06Z, Repo guards
   40202657752, Workflow YAML Gate 40202657785.
7. **Review before this session.** Workflows `wf_0d274771-67f` (design, two critics)
   and `wf_ffee75ef-5a0` (adversarial review); every finding was verified.

## Verified and staged (Rules 61, 74)

- **VERIFIED:**
  - the harness replays 165 recorded rows through the real writers: the four sports
    go from 0 to 110 of 112 right, 0 wrong; MLS 40 to 41 of 43; MLB, CFL and WNBA
    unchanged. 19 of 19 scenarios, 21 of 21 mutations caught;
  - G4 43 of 43 (7 of 7 caught), G5 27 of 27 (5 of 5), the demand script 21 of 21;
  - the deploy and the guards are green on `f4bea6a`.
- **STAGED: done conditions 3 and 4.**
  - **What is staged:** the live effect: opening lines for NHL, NBA, CFB and NFL, and
    the demand run's "unwritable" line reading 0 credits.
  - **What blocks it:** no full closed day with rows of these sports has passed since
    the deploy. The archive seeds rows for the current day only; on 10-25 it holds
    NBA 7, NFL 12 and NHL 5, and none for CFB or for later days.
  - **What unblocks it:** 2026-10-26 closes at 00:00Z on 10-27. The read is
    `trig_01N9VpHitdamufLWMkqWx6un` at 2026-10-27 12:00Z. A sport with no closed day
    with rows is re-armed day by day, to 2026-11-07.
  - **Verify:**
    `SELECT substr(game_id,1,instr(game_id,'_')-1) lg, count(*) FROM change_log WHERE source='odds_api' AND field='opening_odds' AND substr(ts,1,10)='<D>' GROUP BY 1`
    above 0 per sport; no row with `ts` at or after its kickoff since the deploy;
    `archive_game_closing` for NFL or CFB above 0; `odds-consumer-demand.yml` with
    `days=1` reading 0 unwritable credits.
- **Early read, 2026-10-25 14:50Z (VERIFIED on the first cron cycle after the deploy).**
  The opening cron ran at 14:45:55Z to 14:46:05Z, about 8 minutes after the deploy
  (14:38:06Z). `change_log`, source `odds_api`, field `opening_odds`, `ts` at or
  after 14:38Z, joined to `regular_season_games` for the ET day 10-25:

  | sport | games | opening lines written | written at or after kickoff |
  |---|---|---|---|
  | NBA | 7 | 7 | 0 |
  | NHL | 5 | 5 | 0 |
  | NFL | 12 | 11 | 0 |

  Before the deploy these four sports had 0 opening writes over 10-23 to 10-25
  (the read at 14:42Z). The one NFL game without a line starts at 13:30Z, before the
  cron's 14:46Z pass, which is what the kickoff refusal of `d46106b` is for; the
  match of that game to the vendor's listing was not tested separately. CFB has no
  row today. This is one cycle on one day: done conditions 3 and 4 still read a full
  closed day per sport.

## Integration state (Rule 65)

- **Relay contract:** no response shape changed. `change_log` rows keep their source
  (`odds_api`, field `opening_odds`; `archive_game_closing`, field `closing_odds`).
- **What changed for consumers:** `/archive/game` now writes a closing line for NBA,
  NHL, NFL and CFB. It is the noon snapshot, about 13 hours before kickoff, where the
  CI backfill's line lands 21 to 82 minutes before it; the owner ruled this.
- **Client consumers:** not re-read this session. The diff touches no schema and no
  route: `src/index.js` 27 lines and `src/odds-join.js` 50, in the matching rule and
  its three callers. Only which rows get written changes.
- **Known mismatch:** none.

## Open, each with a home

- Done conditions 3 and 4, above.
- `docs/CC-CMD-2026-10-23-odds-ceiling-prerequisites.md` is PARTIAL on fix 2 alone. It
  is set to DONE only when done condition 4 passes, which lifts the owner's hold on
  Task 3 of `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`. Task 3 is not started.
- Comments that still describe the old pair join:
  `docs/CC-CMD-2026-10-23-odds-docs-stale.md`.
