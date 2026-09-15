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

---

## Task 0 — CLOSED (2026-09-15, `outbox/captured-at-provenance-*.log`)

**Rule 42.** The three readings were all argued from timestamps and no fourth
timestamp could separate them. The discriminator nothing had looked at was the
**prices**.

```
MLS_2026-08-22_sanjose_minnesota
  blob     2026-08-22T10:00:52.499Z   ml 115/180    ou null   src draftkings
  history  2026-08-22T23:54:46Z       ml 2.17/2.9   ou 3.5    bk betrivers
```

**22 of 22: prices DIFFER. 0 match.** And they differ in *units* — the blob is
American, the history row decimal.

### None of the three readings was right. The fourth is

`odds-backfill` **cannot have written these blobs.** It builds the blob from
the `odds_history` row it read:

| the blob would carry | the blob actually carries |
|---|---|
| `source: row.bookmaker` → `betrivers` | `draftkings` |
| `decimalToAmerican(2.17)` → `117` | `115` |
| `total.over: row.over_under` → `3.5` | `null` |

Three independent fields, one row. The blob is a different capture event by a
different writer.

### So why does change_log name it?

Because the sync loop logged a write after **every** UPDATE:

```js
for (const table of ['regular_season_games', 'postseason_games']) {
  for (const field of fields) {
    await d1Query(`UPDATE ${table} SET ${field} = ? WHERE id = ? AND ${field} IS NULL...`);
    await d1Query(`INSERT INTO change_log ... 'odds_backfill' ...`);
```

A game lives in **one** table, so the other UPDATE always matched nothing and
still logged. And the candidate predicate is `opening_odds IS NULL OR
closing_odds IS NULL`, so a game needing only its opening line still produced a
`closing_odds` entry. **44 entries for 22 games — exactly two each.** That ratio
was the signature and it was in the first measurement.

The code even carried a comment asserting the invariant it was breaking:
*"Candidates are pre-filtered (field IS NULL), so the UPDATE above matched."*

### Fixed

The candidate query now returns `game_table`, `opening_is_null` and
`closing_is_null`; the loop writes the one table the game is in, and only the
columns that are actually empty; a game in neither table is skipped and counted
rather than logged twice. 16 assertions, 12 mutations, all caught. Blocking in
`deploy.yml`.

### What is NOT claimed

**The writer of the 22 is still unnamed.** This task proved who it is not.

**916 of 1422 archived `captured_at` values carry milliseconds** and 506 carry
whole seconds — the vendor's form. Milliseconds mean the stamp came from a
writer's own clock, which is **correct** for a hook capturing live and **wrong**
only for a writer replaying a historical snapshot. The shape alone does not
separate those two, so no count of false stamps is asserted here.

**A retroactive note.** `CC-CMD-2026-09-14` Task 1 named `archive_game_closing`
as the author of 62 rows. Its load-bearing argument was a *dated gap* — 968 of
968 unattributed rows predate that writer's first change_log entry — and a
phantom entry still carries a real timestamp from a real run, so that argument
stands. Any attribution there resting on change_log **counts** rather than
dates should be re-derived now that phantoms are known to exist.

## Tasks 1–3 — superseded

Task 1 (repair the 22 `captured_at` values) is not actionable until the writer
is named. Filed as the remaining question, not as deferred work: the next
CC-CMD is to identify which writer emits a DraftKings American-odds blob with
no total at ~10:00Z, using the blob shape rather than change_log.
