# CC session 2026-11-24 — the BSD game join backfill: approved, scoped by a measurement, first five dates written and verified

**Task:** the owner's "Backfill approved" (2026-11-24), option (a) of the 2026-11-15 addendum of `docs/CC-CMD-2026-10-28-bsd-join-aliases-beyond-the-fixture-dates.md`. The full record is that document's "Addendum 2026-11-24". **Result:** RUNNING: 5 dates done; about 59 to go (European and MLS) on a daily schedule.

## What was built (field-relay-nba, `main`; no `src/` change, no deploy)

- `scripts/bsd-backfill-lib.mjs` (pure), `scripts/bsd-game-join-backfill.mjs`, `.github/workflows/bsd-game-join-backfill.yml` (gate, verify, backfill with only `RELAY_SHARED_SECRET`, commit with only the write credential). Each rule has a check and a mutation harness: lib 43 assertions / 36 of 36 mutants; script 13 scenarios / 39 assertions / 27 of 27. Both harnesses found a gap in their own check first (an unasserted "complete" case; a crash that passed for a refusal) and one stale anchor.
- Existing work reused (BUILD-ON-A): the route, `reconcile()`, the `bsd_game_join` change_log source and the join (`CC-CMD-2026-10-27`); `scripts/probe-bsd-join-today.mjs` is the one-date probe this generalises (not imported: it exits at import).

## Decisions that came from measurements

- **Scope.** The first dry run surfaced 64 days / 607 rows against the addendum's 34 dates / 197 rows. The 30 extra days are MLS-only, and the addendum had left MLS out. I narrowed the selection to the five European leagues (an MLS row on a chosen date is still joined: the route cannot filter by sport) and added `include_mls` for a separate go-ahead. The second dry run reproduced 34 dates / 197 rows exactly.
- **Stop rules, not assumptions.** A date whose pass answered but left rows pending is not asked again (otherwise the schedule re-spends BSD pages on it daily); a failed one is retried; any verification mismatch stops the run.

## First real run (run 45483895799)

5 dates, 69 rows written, 17 upstream pages (1 to 9 a date), every date verified against `/context/date`, no stop. **Independent D1 read** (read-only SELECT): the addendum's done-condition query went from 197 rows / 34 dates to **190 / 29**. Table and caveats in the CC-CMD addendum.

## Open, with the command that closes each

- **The backfill finishing.** Daily 07:23Z, 5 dates a day, about 2026-11-30. Done when `outbox/bsd-join-backfill-complete.json` exists and `SELECT COUNT(*), COUNT(DISTINCT date) FROM regular_season_games WHERE sport IN ('EPL','La Liga','Serie A','Bundesliga','Ligue 1') AND bsd_event_id IS NULL AND date BETWEEN '2026-08-15' AND '2026-10-23'` returns only the rows BSD has no event for (the marker lists them).
- **MLS: included on the owner's "include MLS" (2026-11-24).** The scheduled run sets `INCLUDE_MLS`; scope is all six sports, 2026-08-01 to 2026-10-23; 538 rows (457 regular + 81 postseason, D1 read-only) over about 59 dates remain, so about 2026-12-06. MLS rows before 2026-08-01 (113 rows over 12 dates, 2026-03-07 to 07-31) are NOT in scope: a further go-ahead (`from` on a dispatch), and BSD's reach back that far is untested.
- **The first scheduled run has never fired.** A reminder for 2026-11-25 08:30Z checks it (`MLS` in `survey.scopeSports`, 5 verified dates, no stop). The completion reminder is 2026-12-07 09:00Z.
- **The grade's population.** After the backfill the laboratory's reach probe (`espn-task0.yml`, `parts` = `reach`) will say how many of the 56 early matches now reach an ESPN id; the lab CC-CMD's "Task 0 result" is updated from that artifact.

**Integration state (Rule 65):** VERIFIED for the first five dates (route answer, `/context/date` re-read, and D1); STAGED for the remaining 29 dates (scheduled).
