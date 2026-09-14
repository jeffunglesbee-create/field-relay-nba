# CC-CMD-2026-09-14-closing-odds-captured-after-kickoff

Rule 87.4. Found while resolving two collision pairs
(`CC-CMD-2026-09-14-collision-closing-odds-conflict.md`); larger than that
CC-CMD and separate from it.

## The claim

`closing_odds` means the last price before kickoff. Across the archive it does
not reliably hold one, and nothing today detects that.

## Measured 2026-09-14

`scripts/probe-closing-odds-capture-timing.mjs`, artifacts
`outbox/closing-odds-capture-timing-2026-09-14T14-00-08*.log` and
`outbox/collision-odds-conflicts-2026-09-14T14-01-34-289Z.log`.

| | count |
|---|---:|
| closing lines captured at or after kickoff, on rows that could be asked | **90 of 879** |
| closing lines on rows with no `start_time`, which could NOT be asked | **532 of 1411** |
| latest observed | `CFL_2026-06-06_ottawaredblacks_edmontonelks`, **+64 days** |
| a single backfill cluster stamped `2026-08-11T01:58` for 2026-08-05 games | 10 rows, ~5 days late |

Two distinct causes, and they need different fixes:

1. **Backfill writes the present into a past column.** Ten rows stamped
   `2026-08-11T01:58` for matches played on 2026-08-05 are not late captures of
   a closing line; they are captures of a *different* price recorded under the
   closing name. `+64 days` is the same thing, further out.

2. **A cron that fires on the clock, not on kickoff.** Both writers stamp near
   `:55` and near `:41`. For a 23:30 MLS kickoff both are in-play. This is
   invisible in the aggregate above because the affected rows have no
   `start_time` — see below.

## The measurement trap this already sprang, recorded so it is not repeated

The first version of the probe printed `dash: 0` captures at or after kickoff,
which reads as "the dash writer is punctual". It is 25 minutes late on both
D.C. United pairs. Its MLS rows carry no `start_time`, so they were never in the
denominator — a bare zero over an invisible denominator is a claim about
everything (Rule 91). The probe now prints `N late of M asked — K not asked` per
scheme. **Any count in this CC-CMD that is not accompanied by its unaskable set
is not usable.**

## Task 0 — close the blind spot before measuring anything else

532 of 1411 closing lines cannot be tested. Establish how many of those rows
have a twin, a scheduled fixture, or an ESPN event that supplies a kickoff, and
how many are genuinely unknowable. A percentage computed over 879 while 532 sit
unasked is not a percentage of the archive.

Artifact: a committed log giving, per table and id scheme, the three counts —
asked, late, unaskable — and the unaskable set broken down by whether a kickoff
is recoverable.

## Task 1 — separate the two causes

Partition the 90 (plus whatever Task 0 adds) into backfill-written and
cron-timing, by capture-to-kickoff distance: days versus minutes. They do not
share a remedy and a single number hides that.

Artifact: a committed histogram of lateness in minutes, with the cut point
stated and justified from the data rather than chosen.

## Task 2 — stop the writers producing more

Only after Tasks 0 and 1. Backfill must not write `closing_odds` for a match
already played; a cron must place its capture against kickoff before writing.
Both need a mutation proving the guard bites.

## Task 3 — the existing rows

Requires owner authorisation: this is odds data, and CLAUDE.md forbids
correcting or inventing it. Present the partition and the options; do not
choose.

## Done condition

A gate in `deploy.yml` that fails when any writer can record `closing_odds`
whose `captured_at` is at or after a known kickoff, with a mutation showing it
red. Plus a committed count of the existing rows, partitioned, with its
unaskable set named alongside.

## Scope boundary

Do not modify any `closing_odds` value under this CC-CMD — Task 3 is
authorisation, not execution. Do not touch `opening_odds`. Do not change the
collision condition; that is the other CC-CMD.
