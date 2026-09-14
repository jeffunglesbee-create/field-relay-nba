# CC-CMD-2026-09-14-closing-odds-captured-after-kickoff

**Tasks 0 and 1 DONE 2026-09-14.** 91 of 877 askable closing lines captured at or
after kickoff; 530 not askable; the dash-scheme writer measured 0 of 0 — never
tested at all. Two measurement defects fixed first; both had produced a number
that was quoted. Task 1 found the slow mode has no author at all: 62 of 91 late rows
carry no `change_log` entry and `odds_backfill` appears zero times, so this
document's own "backfill writes the present into a past column" framing is
unconfirmed. Task 2 is reshaped — naming the author comes before any guard.

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

## Task 0 — DONE 2026-09-14

Artifact: `outbox/closing-odds-capture-timing-2026-09-14T15-4*.log`.

### Two measurement defects fixed before any number was trusted

**The comparison was text.** `start_time` arrives as `2026-07-25T20:05Z`
(minute precision) and `2026-06-06T23:00:00+00:00` (offset form); `captured_at`
as `2026-07-25T20:05:30.000Z`. As text, `'Z'` (0x5A) sorts above `':'` (0x3A),
so a capture thirty seconds AFTER a minute-precision kickoff read as before it.
Both formats were printed by the probe's own step 0 and read past. Now
`julianday()` on both sides, with unparseable start_times counted separately
rather than folded into "not late" (Rule 99). **This moved the headline from
90 of 879 to 91 of 877.**

**The twin test could not find the case it was built for.** It joined on exact
`(date, sport, home, away)` and returned 0 — the only possible answer, since the
pairs it was modelled on differ on exactly those columns (`Toronto FC` against
`Toronto`). The question now goes to `/identity/substitution-census`, which
already pairs rows with the relay's own normaliser. **0 became 10.**

### The measured state

| | regular_season | postseason |
|---|---:|---:|
| closing lines, total | 1381 | 26 |
| **askable** (start_time present and parseable) | **877** | 0 |
| **late** — captured at or after kickoff | **91** | 0 |
| unaskable (no start_time) | 504 | 26 |
| of those, with a census-paired twin carrying start_time — **PROVEN route** | 10 | 0 |
| of those, carrying an espn_event_id — an anchor, **resolvability UNTESTED** | 476 | 0 |

Overlap between the twin and espn sets is **not measured**; they cannot be added.

### The finding that changes the shape of this CC-CMD

**The dash-scheme writer has never been measured. 0 late of 0 asked — all 70 of
its rows carrying a closing line lack `start_time`.** Earlier today that `0` was
read as "that writer is punctual" while the D.C. United pairs showed it
**25 minutes past kickoff**. The denominator is not merely invisible; it is
zero. Nothing in the aggregate below describes that writer at all.

`postseason_games` is the same: 26 closing lines, none askable, neither route
available. Genuinely unknowable today.

## Task 1 — DONE 2026-09-14

Artifact: `outbox/closing-odds-capture-timing-2026-09-14T15-5*.log`, steps 4 and 4b.

### The task as written would have produced a copy

Task 1 asked for the partition to be made "by capture-to-kickoff distance: days
versus minutes". `change_log` records `source` for every odds write —
`src/brief-freshness.js` names five — so the archive already states which writer
produced each row. Splitting on lateness infers an answer the data gives
outright, and is wrong for any backfill that ran promptly or any cron that ran
very late. **Attribution is the partition; distance is the cross-check.**

### The distribution, every late row (not the top ten)

| bucket | rows | observed range |
|---|---:|---|
| `<1 min` | 3 | 0..0 |
| `1-5 min` | 20 | 1..4 |
| `5-15 min` | 3 | 5..12 |
| `15-60 min` | 4 | 24..25 |
| `1-6 h` | 8 | 110..316 |
| `6-24 h` | 19 | 681..906 |
| `1-7 d` | 33 | 5758..7668 |
| `>7 d` | 1 | 92393 |

**Bimodal — measured, not assumed.** A peak of 20 at 1-5 min, a trough of 7
across 5-60 min, then a second mass of 53 from 6 h out. Only the top ten had
ever been looked at, and ten days-late rows is also what a unimodal tail looks
like from that end.

### The cut point, justified by two independent signals

**60 minutes.** The count trough sits there (7 rows across 5-60 min), and the
attribution agrees without being asked to:

| | rows | `closing_odds_capture` | `archive_game_closing` | no `change_log` |
|---|---:|---:|---:|---:|
| **< 60 min** | 30 | **25 (83%)** | 1 (3%) | 4 (13%) |
| **≥ 60 min** | 61 | 1 (2%) | 2 (3%) | **58 (95%)** |

### THE FINDING THAT CONTRADICTS THIS CC-CMD'S OWN FRAMING

This document asserted two causes, the first being "backfill writes the present
into a past column". **`odds_backfill` appears zero times among the 91.**

**62 of 91 late rows have no `change_log` entry at all** — including 53 of the
54 rows more than six hours late. The slow mode is not attributed to a backfill;
it is not attributed to anything. Its shape is consistent with a backfill
(ten rows stamped `2026-08-11T01:58` for games played 2026-08-05), but shape is
not authorship, and this CC-CMD already spent a correction on reading a pattern
as a cause.

One known mechanism would explain part of it: `archive_game_closing` wrote no
`change_log` entry at all until 2026-09 — its own source comment says so, and
names that silence as the reason it stayed hidden. How many of the 62 that
accounts for is **not measured**.

### What is actually established

1. **Cron timing, named:** `closing_odds_capture` (AmbientDO), 25 rows, all
   ≤ 15 min late. It captures on its own schedule with no reference to kickoff.
2. **Unattributed slow mass:** 58 rows ≥ 60 min late with no author in
   `change_log`, up to 64 days. Cause unknown.
3. **`archive_game_closing`:** 3 rows, 15 min to 6 h.

### This reshapes Task 2

Task 2 is "stop the writers producing more". Two of the three groups have no
writer to stop. **Naming the author of the 62 comes before any guard**, or the
guard is written against the one writer that does log and the larger group
continues unobserved.

## Task 2 precondition — DONE 2026-09-14. The author is named.

Artifact: `outbox/closing-odds-authorship-2026-09-14T16-03*.log`.

### 58 of the 62 are `archive_game_closing`

Not observed directly — the archive does not record it — but established by
elimination, with every step measured:

1. **58 of the 62 carry `_oddsProof`**, captured 2026-08-08 .. 2026-08-21.
2. `_oddsProof` is stamped by `extractOddsForGame` and nothing else, added in
   `3f0fe3d` on 2026-06-29 — before every one of those captures.
3. `extractOddsForGame` has three call sites. Two (src/index.js ~6641, ~6777)
   write **`opening_odds` only**, source `odds_api`. The third is
   `archive_game_closing`. `git log -S` over 2026-07-15..2026-09-01 shows three
   commits touching the function and **none adding a caller**; 4 occurrences at
   HEAD = 1 definition + 3 call sites.
4. `.github/scripts/odds-backfill.js` also emits proof-carrying closing rows
   from 2026-08-15 — but it logged to `change_log` **continuously** from
   2026-06-28 to 2026-08-22, so its writes in that window are attributed. These
   are not.
5. `archive_game_closing`'s first `change_log` entry is **2026-08-23**. Its own
   source comment says it "logged NOTHING until now, which is precisely why it
   stayed hidden".

### The number that makes it structural rather than incidental

**968 of 968** unattributed regular-season closing rows, and **26 of 26**
postseason, were captured before 2026-08-23. Every single one. The
unattributed set is not a scatter of lost writes; it is the shape of one
writer's silence, and it ends on the day that writer started logging.

### Two blob fingerprints were tried and both refuted themselves

Recorded because the failures are the reason the dated argument exists:

| fingerprint | why it failed |
|---|---|
| key-set (`_oddsProof` / `spread` / neither) | `proof` appeared under BOTH `archive_game_closing` and `odds_backfill` — the backfill adopted `extractOddsForGame` mid-August. A builder is not a writer. |
| identical `captured_at` in both odds columns | 16 `archive_game_closing` rows carry it (it reads historical snapshots too), and it misses 50 of 58 `odds_backfill` rows. Neither necessary nor sufficient. |

A third guess would have been fitting rather than measuring, so there isn't one.

### Residual, stated rather than closed

**4 of the 62 are not named by this chain** — 3 `neither`, 1
`spread-no-proof`, captured 2026-07-25 .. 2026-08-01. The argument rests on two
assumptions it does not prove: that no removed writer stamped `_oddsProof` in
August (git log finds no such caller, which is evidence, not proof), and that
`odds-backfill.js`'s `change_log` insert — which carries `.catch(() => {})` and
swallows failures silently — did not fail for exactly these rows.

### Task 2 can now proceed, against a named writer

`archive_game_closing` (src/index.js ~13022) captures whenever `/archive/game`
is called for a finalized row with no closing line, with **no comparison
between the snapshot time and kickoff**. That is the guard to write. The
`.catch(() => {})` on the backfill's change_log insert is a second, separate
defect: a write that can lose its own record.

## Task 2 — stop the writers producing more

Only after the precondition above, which is now met. Backfill must not write
`closing_odds` for a match already played; `archive_game_closing` must place its
snapshot against kickoff before writing. Both need a mutation proving the guard
bites. The swallowed `change_log` insert gets its own fix — a write that cannot
record itself recreates this whole investigation.

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
