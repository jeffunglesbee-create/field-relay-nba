# CC-CMD-2026-09-15 — name the writer that emits a DraftKings blob with no total

**Status:** FILED, not started. Second CC-CMD required by Rule 87.4, opened
because `CC-CMD-2026-09-15-backfill-captured-at-not-snapshot-time` Task 0 proved
who the writer is **not**.

## What is known

22 archived `closing_odds` blobs (and, on the same games, the `opening_odds`
blobs) have this shape:

```
captured_at  2026-08-22T10:00:52.499Z    milliseconds — a writer's own clock
moneyline    115 / 180                   American
total        absent
source       draftkings
```

Their `odds_history` row carries decimal prices, a different bookmaker, a total,
and a whole-second `snapshot_time` ~1 minute before kickoff.
`.github/scripts/odds-backfill.js` cannot emit that shape: it carries the
history row's bookmaker, converts that row's decimal price, and copies that
row's `over_under`. `change_log` named it only because the sync loop logged
writes that matched nothing — now fixed.

All eight sampled games share one `opening_odds` `captured_at`:
`2026-08-22T10:01:21.633Z`. A single batch, one write per game, ~10:00–10:01Z.

## Tasks

0. **Probe by SHAPE, not by change_log.** Census every archived odds blob by
   `source`, by whether `total` is present, and by `captured_at` shape
   (milliseconds vs whole seconds), split by table and by month. The population
   that looks like the 22 is the population to attribute.
1. **Find the emitter in source.** Which writer sets `source: 'draftkings'` and
   omits `total`? Candidates to eliminate by reading, not guessing:
   `archive_game_closing` (`POST /archive/game`), `AmbientDO._captureClosingOdds`,
   and any `/d1/execute` caller. The Odds API returns a `markets` array — a
   consumer reading only `h2h` would produce exactly a moneyline with no total.
2. **Then decide** whether the 22 `captured_at` values are measurements (a live
   capture stamping its own clock is correct) or replays (a historical snapshot
   stamped with run time is not). Only then is repair a question.
3. A check that can fail, and an outbox manifest.

## Done condition

A named writer, with the source line that emits `source: 'draftkings'` without a
total, and a count of how many archived blobs it wrote.

## Scope boundary

No D1 writes. Do not modify any odds blob. Do not repair `captured_at` values
before the writer is named — a repair aimed at the wrong writer is a second
false fact on top of the first.
