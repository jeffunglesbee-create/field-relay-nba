# CC-CMD-2026-09-14-collision-closing-odds-conflict

Rule 87.4: the symmetric merge closed 30 of 32 pairs and refused 2. This is the
second CC-CMD that refusal requires, not a carry-forward.

## State at HEAD

`04b16c6`. The archive holds two collision pairs whose rows each carry a real
`closing_odds` blob and the blobs differ. No fill resolves this — `COALESCE`
writes only into a NULL — and `scripts/run-symmetric-collision-merge.mjs`
refuses to apply at all while either stands.

The watch condition
(`same_slate_pair_collisions_odds_disagree`) reads **2** and will stay open
until this is decided.

## The evidence, measured 2026-09-14 via `scripts/probe-collision-odds-conflict.mjs`

Artifact: `outbox/collision-odds-conflicts-2026-09-14T13-44-22-483Z.log`

### 2026-07-25 D.C. United v Toronto

| | `2026-07-25-mls-dc-tor` | `FIFA World Cup 2026_2026-07-25_dcunited_toronto` |
|---|---|---|
| score | none | 2 - 1 |
| espn_event_id | none | 761681 |
| finalized_at | none | 2026-07-26 01:45:42 |
| source | betmgm | betmgm |
| captured_at | `2026-07-25T23:55:28Z` | `2026-07-25T23:41:27.699Z` |
| moneyline home | 100 | **-105** |
| moneyline away | 220 | 220 |
| moneyline draw | 225 | **250** |
| spread | absent | present, both null |

### 2026-08-01 D.C. United v Nashville

| | `2026-08-01-mls-dc-nsh` | `FIFA World Cup 2026_2026-08-01_dcunited_nashville` |
|---|---|---|
| score | none | 2 - 2 |
| espn_event_id | none | 761699 |
| finalized_at | none | 2026-08-02 01:45:02 |
| source | betmgm | betmgm |
| captured_at | `2026-08-01T23:55:28Z` | `2026-08-01T23:41:07.783Z` |
| moneyline home | 170 | **160** |
| moneyline away | 135 | **125** |
| moneyline draw | 210 | **250** |
| spread | absent | present, both null |

## The reframe that decides it — and a wrong claim, corrected

### CORRECTED 2026-09-14: `23:55:28` is NOT a defaulted timestamp

This document first argued that both dash rows carrying `23:55:28` to the
second, on two different dates, was the signature of a defaulted timestamp, and
that this removed the only argument for preferring them.

**That was wrong.** Measured by `scripts/probe-closing-odds-capture-timing.mjs`
(artifact `outbox/closing-odds-capture-timing-2026-09-14T14-00-08*.log`), the
dash-scheme capture seconds spread across a window:

| second | rows |
|---|---:|
| `23:55:31` | 11 |
| `23:55:30` | 11 |
| `23:55:17` | 8 |
| `23:55:20` | 7 |
| `23:54:53` | 7 |
| `23:55:28` | 6 |

A cron fires at 23:55 and takes a second or so per row. Two dates landing on
`:28` inside a 40-second spread is coincidence. The timestamps are real
measurements and carry real ordering information.

### The reframe that survives

Stop asking which of two closing lines is correct. **A closing line is the last
price before kickoff** — that is what the column means, not a preference between
two writers, and it is decidable from the row. So the question becomes: is
either of these a closing line at all?

`scripts/probe-collision-odds-conflict.mjs` now answers it per pair. The
dash-scheme row carries no `start_time`, which is *why* the pair exists — the
two rows are the same match split across two writers, so the twin's kickoff is
this row's kickoff. Taking it from the twin is the definition of the pair, not
an assumption. If neither row carries one, the probe says the test could not be
run rather than reporting both as fine (Rule 99).

### MEASURED. Neither row holds a closing line.

`outbox/collision-odds-conflicts-2026-09-14T14-01-34-289Z.log`. The twin carries
`start_time`, and it is **23:30Z**, not the ~23:45 this document first inferred
from `finalized_at` minus a two-hour match. The match ran 2h15m.

| capture | against kickoff 23:30 |
|---|---|
| FIFA row, `23:41:27.699Z` | **+11 min — in-play** |
| dash row, `23:55:28Z` | **+25 min — in-play** |

Identical on both pairs.

**There is nothing to choose between.** Both are in-play prices in a column that
means "the last price before kickoff". Selecting either enshrines an in-play
price as the close, which is worse than leaving the disagreement visible — a
wrong value that agrees with itself stops anyone ever looking again.

So Task 1's three options are all wrong, and they are replaced below.

### What this exposes, which is larger than this CC-CMD

The wide probe (`scripts/probe-closing-odds-capture-timing.mjs`,
`outbox/closing-odds-capture-timing-2026-09-14T14-00-08*.log`) reported
`dash: 0` captures at or after kickoff. **That is not evidence the dash writer
is punctual.** Its MLS rows carry no `start_time`, so they were never asked —
and these two pairs prove it is 25 minutes late. The reassuring zero is the
532-row blind spot, and a collision is the only thing that made it visible.

What the probe did measure, on rows that could be asked:

- **90 of 879** comparable closing lines captured at or after kickoff, all on
  our-scheme ids.
- `CFL_2026-06-06_ottawaredblacks_edmontonelks`: **64 days** late.
- Ten rows stamped `2026-08-11T01:58` for games played 2026-08-05 — a backfill
  writing the book's price five days later into the closing column.
- **532 of 1411** closing lines sit on rows with no `start_time` and cannot be
  asked at all.

That is a separate defect with its own blast radius and gets its own CC-CMD
before this one closes (Rule 87.4).

## Task 0 — DONE

Asked whether `23:55:28` was a real capture or a default. Answered: real, one
second inside a 40-second cron window. Artifact
`outbox/closing-odds-capture-timing-2026-09-14T14-00-08*.log`. The conclusion it
was written to support was wrong and is corrected above.

## Task 1 — the remedy, on the owner's instruction only

Picking a line is off the table: both are in-play. The live options are:

- **Clear both.** `closing_odds = NULL` on both rows of both pairs. Honest —
  the archive holds no closing line for these matches — and it makes the pairs
  agree, closing the watch condition. Destroys two real in-play observations.
- **Relabel.** Move both blobs to an in-play column and leave `closing_odds`
  NULL. Keeps the observations, costs a schema change and a consumer audit.
- **Leave both, and stop asking them to agree.** Record the finding and exclude
  the two pairs from the condition by id. Cheapest; leaves two wrong values in
  a column consumers read as the close.

A session must not choose. This is odds data, and CLAUDE.md forbids correcting
or inventing it.

## Done condition

Under **clear both** or **relabel**:
`same_slate_pair_collisions_odds_disagree` reads `0` in a committed
`outbox/identity-ambiguity-watch-*.json`, with `same_slate_pair_collisions`
still `115` — the fix resolves values, it does not remove rows.

Under **leave both**: a committed note naming the two pairs, the condition
amended to exclude them by id, and a mutation proving the exclusion is by id
and not a blanket suppression.

## Scope boundary

Do not touch the 113 pairs the merge already settled or skipped. Do not delete
any row. Do not widen the fill past `opening_odds` / `closing_odds`
(`scripts/collision-cleanup-plan.mjs` records why).
