# CC-CMD-2026-09-15 — 22 archived closing lines carry a captured_at that is not their snapshot_time

**Status:** FILED, not started. Opened by the residual measurement of
`CC-CMD-2026-09-14-closing-odds-captured-after-kickoff` Task 2.

## What was measured (2026-09-15, `outbox/odds-history-snapshot-time-*.log`)

The question asked was the coverage cost of the 2026-09-14 skip — the backfill
no longer writes `closing_odds` when the `odds_history` row carries no
`snapshot_time`. The answer is **zero**:

| | |
|---|---:|
| `odds_history` rows | 184 |
| distinct `game_id` | 184 |
| `snapshot_time IS NULL` | **0** |
| `snapshot_time = ''` | **0** |
| candidate games (a NULL odds column) | 2 |
| of those, dated before today — the only ones skippable | 2 |
| past candidates where NO row carries a snapshot_time | **0** |

The GROUP BY hazard the probe was built to catch does not arise either: one row
per game, so there is no group for SQLite to pick arbitrarily from.

## The part that is NOT closed

**22 of 182** archived closing lines whose game has an `odds_history` row carry
a `captured_at` that is not that row's `snapshot_time`. `change_log` attributes
every one to **`odds_backfill`** — 44 writes (two per game, one per table),
`2026-08-16 10:26:04` .. `2026-08-23 10:26:43`.

```
MLS_2026-08-22_sanjose_minnesota
  blob     2026-08-22T10:00:52.499Z     (milliseconds, decrementing across the batch)
  history  2026-08-22T23:54:46Z         (whole seconds, ~1 min before kickoff)
```

The blob timestamps decrement by fractions of a second across games in one
batch. That is a loop calling `new Date()`.

## Three readings, and why none is reportable yet

1. **The history row had no `snapshot_time` at write time and got one later.**
   Refuted by `insertOddsRow`: `INSERT OR IGNORE INTO odds_history` never
   updates an existing row.
2. **A later run inserted the 23:54 row.** Then the archive blob's
   `2026-08-22T10:00` stamp came from something that ran on 08-22 — but at
   10:00 on 08-22 the match had not kicked off, so `isPast` is false and the
   backfill does not write `closing_odds` at all.
3. **The JOIN pairs the blob with a different capture event.** One row per
   game_id table-wide makes this unlikely, but it has not been tested.

Each reading is refuted or untested. **No mechanism is claimed here** — the
point of filing rather than concluding.

## Tasks

0. **Probe.** For the 22 game_ids: `SELECT id, date, snapshot_time,
   snapshot_type, commence_time, bookmaker FROM odds_history`, beside the blob's
   `captured_at`, `source` and prices, beside every `change_log` row for that
   game and field. One table, one read. It settles which of the three readings
   holds, or names a fourth.
1. Only then: decide whether the 22 `captured_at` values are repairable from a
   measurement, or whether they must be marked as unmeasured provenance.
2. Whatever Task 0 finds about the write path, a check that can fail.
3. Outbox manifest.

## Done condition

A probe output naming the mechanism, and for each of the 22 rows either a
measured `captured_at` or an explicit mark that its capture time is unknown.

## Scope boundary

No D1 writes under Task 0. Do not modify `odds_history`. Do not change the
backfill schedule — `cron: '0 10 * * *'` is a fact this investigation uses, not
a thing to adjust before the mechanism is known.
