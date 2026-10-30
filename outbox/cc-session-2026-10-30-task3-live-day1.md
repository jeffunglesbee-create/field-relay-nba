# Session 2026-10-30 (12:00Z wake) — Task 3 live day 1: the per-site caps on the closed day 2026-10-29

Spec: the wake `trig_019pHMT7Ym3XGHi3KVKQLDZx` ("Site caps: read the first closed full day"), set when the owner's three decisions were built on
2026-10-28 (commit `0e6a894`, Deploy RELAY Worker run 40777339113). Result section: `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`,
"Task 3 live day 1". No code changed. No Odds API call was made.

## HEAD progression

field-relay-nba: docs only. Reads were taken at origin/main as of 2026-10-30T12:01Z.

## What was read, and the artifact for each

| claim | artifact |
|---|---|
| 2026-10-29 closed at used 1184 of 3800, `by_site_sum` 1184, `unaccounted` 0 | `GET /budget/odds?date=2026-10-29`, 2026-10-30T12:01Z |
| no cap refused: every `site_ceiling_reached_at` null, `refusals []`, both stamp-unreadable fields null | same response |
| D1 agrees with the route | `odds_budget` 1184 = sum of 6 `odds_budget_site` rows = 1184; `odds_budget_refusal` 0 rows for the day; `odds_budget_gate` one row; `odds_budget_month` 2026-10 = 47394 |
| the new route labels | `archiveGameClosing` 30 credits (one historical MISS, one HIT); `identityMismatches` 0; `archiveOddsBackfill` 0 |
| `degraded_open` | 5 events, 30 credits, all "D1 DB is overloaded", last 16:04:03Z; unchanged between the 18:34Z reading on the day and this one |

## Verified vs not

- Verified: the route and D1 against each other, for the closed day.
- Not observed: a cap actually refusing. The highest cap use was 15%, so the refusal path is still proven only by the harness and the
  2026-10-28 live proof, not by a day of real demand.
- Not attributed: the hour and site of the 5 D1 overloads. The relay keeps no per-event record; the open
  `docs/CC-CMD-2026-10-12-degrade-reasons-by-hour.md` is the instrument and received this data point.
- Read at 18:01Z, after this document was first written: the pairing watch's `refusals, closed day 2026-10-29  : none` and its D1 block (5 overloads, 10 path events against the budget of 13, `within`), from `outbox/odds-pairing-rate-20261030T165531Z.log`.

## Carry-forward

None. The one open item (the pairing watch's closed-day line) was read at 2026-10-30T18:01Z by the wake that was armed for it, and is recorded in
`docs/CC-CMD-2026-09-16-odds-spend-attribution.md`, "Task 3 live day 1".
