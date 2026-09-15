# CC-CMD-2026-09-15 — 177 CFB games since 2026-09-01 have no odds at all

**Status:** FILED, unexplained. Split out of
`CC-CMD-2026-09-15-odds-backfill-missing-api-key` Task 3 under Rule 87.4 — a
second CC-CMD rather than a carry-forward.

## Measured

Run `35013308603`, `scripts/measure-backfill-outage-cost.mjs`, head `da80809`.
Games dated ≥ 2026-09-01 with `opening_odds IS NULL` **and** no `odds_history`
row, by league:

| league | n |
|---:|---:|
| MLS | 247 |
| **CFB** | **177** |
| UEFA Champions League | 18 |
| Bundesliga | 18 |
| NFL | 16 |
| EFL Cup | 11 |
| La Liga | 10 |
| Ligue 1 | 7 |
| EFL Trophy | 7 |
| Serie A | 4 |
| EPL | 2 |
| CFL | 1 |

Postseason resolves completely and is **not** part of this question: TELUS
Canadian Championship 10, U.S. Open Cup 2, Campeones Cup 2 — 14 of 14 already
established as **NOT OFFERED** by the vendor in
`CC-CMD-2026-09-14-cup-competitions-under-mls`.

## Why CFB is the one worth asking about

Every other large bucket has a candidate explanation on file. CFB does not.

- **MLS 247** — consistent in size with the 243 cup fixtures that
  CC-CMD-2026-09-14 carries under `sport='MLS'`. NOT PROVEN to be the same
  rows; that is its own small task, not this one.
- **The European leagues** — UCL, Bundesliga, La Liga, Ligue 1, Serie A, EPL
  are all vendor-offered, and the counts are small enough to be ordinary
  per-date misses.
- **CFB 177** — the vendor does list American college football. 177 games in a
  fifteen-day window is not a rounding error, and the backfill's own catch-up
  run (`35012183015`) reported `games=19` across all 22 dates, so whatever it
  fetched, it was not these.

## The premises to refute FIRST (Rule 100)

Do not build before running these. Each is one command.

1. **"The vendor offers CFB."** — `probe-cup-competitions-odds-keys.mjs`
   already reads `/v4/sports`; point it at the CFB key. If NOT OFFERED, this
   whole document collapses into the cup-competition finding and closes.
2. **"These 177 are in the outage window for a reason."** — count CFB rows with
   `opening_odds IS NULL` for dates BEFORE 2026-09-01. If the rate is the same,
   the outage is not the cause and the gap is structural.
3. **"`odds_backfill_progress` thinks these dates are done."** — the catch-up
   reported `all dates complete`. If the progress table marks a date complete
   that yielded zero CFB games, the completion criterion is the defect, not the
   fetch.
4. **"CFB label matches what the odds lookup keys on."** — this repo has had
   this exact defect twice (`briefs.sport`, and `MLS Soccer` vs `mls` in
   `CC-CMD-2026-09-11`). Check the label in `regular_season_games.league`
   against the key the backfill uses.

Premise 4 is the one to take seriously. `detectSportClass` returning `null` for
`'cfb'` is already a recorded defect in field-laboratory's CLAUDE.md, and a
label that resolves to no vendor key produces exactly this symptom.

## Done condition

A statement of the form "N of 177 are explained by X, measured by <command>",
with the remainder either fixed or declared unfixable with the reason — not
"CFB odds coverage improved".

## Scope boundary

Read-only until the cause is named. No D1 writes, no re-fetch, no relabelling.
The 177 rows are not modified by this investigation.
