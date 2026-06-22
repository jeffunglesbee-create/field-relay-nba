# Budget Coordinator — Shared KV Daily Ceiling (2026-06-21)

## Pre-build probes

- `consumeOddsCredit(env, units)` in `src/index.js:3817` — monthly KV
  counter at `odds:credits:YYYY-MM` (FIELD_JOURNALISM), ceiling 18 000.
  Used by `snapshotCronOdds` and `runOddsBackfillForDate` via
  `fetchSportOddsLive`/`fetchSportOddsHistorical`.
- `_consumeAmbientOddsCredit(env, units)` in `src/ambient-do.js:817` —
  same monthly KV key, ceiling 18 000. Used by `_fetchLiveOdds` and
  (after this commit) `_captureClosingOdds`.
- `_closingOddsToday` / `_closingOddsDate` — in-memory daily counter
  (30/day) inside `_captureClosingOdds`. Invisible to other consumers.

The two monthly counters already share the KV key (`odds:credits:YYYY-MM`)
— good. There's no daily coordination today and the closing-odds capture
counter is per-DO-isolate, so it can blow past 30/day if multiple
isolates run concurrently.

## What ships

1. `src/budget-helpers.js` (new): two exports —
   - `peekDailyOdds(env)` returns `{ date, used, ceiling, remaining }`.
   - `checkAndIncrementDailyOdds(env, units)` — guard + increment in
     a single call. Returns true on pass (and writes used+units to KV),
     false when the daily ceiling would be exceeded.
2. `src/index.js`:
   - Import `checkAndIncrementDailyOdds` + `peekDailyOdds` from the
     new helpers.
   - `consumeOddsCredit` calls the daily guard FIRST (before its
     existing monthly logic). Either guard returning false aborts.
     Daily-passed-then-monthly-blocked over-counts daily by `units`;
     ceiling has 2-3× headroom so the race is irrelevant (per spec).
   - Add `GET /budget/odds` endpoint that returns both daily + monthly
     counters in one read.
3. `src/ambient-do.js`:
   - Import the same helpers.
   - `_consumeAmbientOddsCredit` calls daily guard first, same as the
     index.js path.
   - `_captureClosingOdds` replaces the in-memory daily cap
     (`_closingOddsToday` + `_closingOddsDate`) with a single
     `checkAndIncrementDailyOdds(env, 1)` call. The instance variables
     are deleted.

## Daily ceiling

`ODDS_DAILY_CEILING = 900` per the spec (20k/month ÷ 22 active days
≈ 900/day). Realistic spend today is ~200-400/day, so the ceiling
acts as a runaway-prevention safety net rather than a binding limit.

## Concurrency note

`checkAndIncrementDailyOdds` is read-then-write, not atomic. Two
concurrent callers can both read N and both write N+units (under-
counting by `units`). With ~900 daily headroom and observed peak
spend ~400 the race is benign — same trade-off the existing
`consumeOddsCredit` already makes.

## Behavioral contract preserved

- Monthly KV key `odds:credits:YYYY-MM` shape unchanged.
- Monthly ceiling 18 000 unchanged.
- `consumeOddsCredit` / `_consumeAmbientOddsCredit` signature
  unchanged — same `(env, units) → bool` contract.
- Per-sport cooldown / quota-floor guards in `_fetchLiveOdds`
  unchanged.

## Failure modes (silent per Rule 5)

- FIELD_JOURNALISM unbound: `peekDailyOdds` returns null; the daily
  guard `checkAndIncrementDailyOdds` returns true (degrade-open).
  Existing monthly guard already follows this convention.
- KV read/write throws: caught → guard returns true (degrade-open).
  Better to over-spend a few credits than to silently kill live
  coverage on a KV blip.
- `/budget/odds` endpoint: returns `{ ok:false, error }` 503 when
  FIELD_JOURNALISM is unbound; otherwise 200 with whatever the KV
  contains (zero counters if both keys are absent).

## Carry-forwards

1. Atomic increment would require D1 (not KV). When the journalism
   throughput grows past the headroom, migrate the daily counter to
   D1 with a single SQL UPSERT. Not warranted at today's spend.
2. Per-consumer daily breakdown would help diagnose runaway spend.
   The current shared counter aggregates across all three consumers;
   adding `source` to the key (`odds:daily:<source>:YYYY-MM-DD`)
   would let `/budget/odds` show per-consumer attribution. Out of
   scope for this prompt.
