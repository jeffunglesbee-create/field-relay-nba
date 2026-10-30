# Session 2026-10-30 — the degrade counter files each event under its UTC hour (CC-CMD-2026-10-12-degrade-reasons-by-hour, Task 1)

Spec: `docs/CC-CMD-2026-10-12-degrade-reasons-by-hour.md`. Started on the owner's "go" after the Task 3 live-day-1 read recorded 5 degrade-opens
on 2026-10-29 whose hours could not be told. The owner's instruction mid-turn: the CC-CMD is 18 days old, do not assume it is up to date.

## HEAD progression

field-relay-nba: `8893c14` to `190eb14` (code), to this close-out. No client change (the client does not read `/budget/odds`).

## What the 18 days changed (re-verified against main before building)

- The watch's description was stale: `d1OverloadVerdict` now fails the run on `not-reported`, `unreadable` and `unattributed`. `by_hour` had to be
  a separate, informational verdict, or every record from before the deploy would turn the watch red.
- Task 2's `gh api` instrument is not available in these sessions.
- Unchanged and still true: the record's shape, the route passing the block through, "no new write", and nothing else building the field.
- The CFL experiment's VOID window (2026-11-08..11-23) names `chargeOdds`, `reconcileOddsCredit` and the wrappers, not `_countDegradeOpen`;
  this landed before it regardless, and `chargeOdds` and its call site are untouched.

## What was built

| file | change |
|---|---|
| `src/budget-helpers.js` | `bumpHour` (pure, exported), `D1_OVERLOAD_MARK`; `_countDegradeOpen` takes one instant for the day key, the hour and `last`, writes `by_hour` in the existing put |
| `scripts/watch-odds-pairing-rate.mjs` | `byHourVerdict`, `byHourLines`; printed under the closed-day section; informational, never sets `failed` |
| `scripts/check-degrade-by-hour.mjs` | 27 assertions on the real `chargeOdds` |
| `scripts/mutate-degrade-by-hour.mjs` | 12 mutations of the writer and the mark |
| `scripts/mutate-odds-pairing-rate.mjs` | 11 more (B1 to B11): 46 of 46 |
| `.github/workflows/deploy.yml`, `guards.yml` | the new check and harness |

## Two findings from the apparatus, not the product (Rule 90)

1. The first draft of the check crashed on `Object.values(undefined)` when `by_hour` was dropped, before reaching its source assertions. The
   harness reported it as a wrong-reason catch (3 red lines, none the expected one) instead of a catch. Fixed; the harness now also prints a
   CRASH verdict for an exit with no FAIL line.
2. One watch mutation (B8, an unreadable event count reading as covered) survived until two self-test cases were added: events missing and
   events null.
Also: `Object.keys` enumerates `'10'..'23'` before `'00'..'09'`; my first assertion expected hour order. The watch sorts explicitly and the
self-test asserts the trap.

## Proof

| claim | artifact |
|---|---|
| one put per degrade, the hour from the same instant, a record from before the field not claiming coverage | `scripts/check-degrade-by-hour.mjs`, 27 of 27 |
| the check can fail | `scripts/mutate-degrade-by-hour.mjs`, 12 of 12 caught; baseline green |
| the watch prints it, and absence is not zero | `watch-odds-pairing-rate.mjs --self-test`, 136 of 136 (includes the real 2026-10-29 record) |
| the watch's tests can fail | `scripts/mutate-odds-pairing-rate.mjs`, 46 of 46 |
| gates on the committed tree | `gates.py` on the committed tree: 159 of 161 passed; the two failures are the standing env-only ones (BSD frame list HTTP 0; `RELAY_SHARED_SECRET` unset) |
| deploy | Deploy RELAY Worker run 41088801910, success (16:19:16Z to 16:29:48Z). `GET /budget/odds` then answered 200; `degraded_open` for 2026-10-30 read `{events:0, credits:0, last:null}` (no event yet), `by_site_sum` equal to `used` |

## Done conditions, honestly

None of the CC-CMD's three done conditions can be met by a push. They need a closed day with at least one degrade-open event after the deploy
(2026-10-29 had 5, all before 16:05Z; days with none are common). Condition 2 is met in the watch's tests and not yet on a live log.

## Carry-forward, with its automation

Wake `trig_0161cHqx3qRLq7hs7T1bWx5P` (2026-10-31T18:00Z): read `GET /budget/odds?date=2026-10-30` and the newest `outbox/odds-pairing-rate-*.log` whose header names
closed day 2026-10-30. If `degraded_open.events` is above 0, record whether `by_hour` is present and sums to `events` (done condition 1), whether the
log printed the `by hour (UTC)` block (2), and, if the day had overloads, lay the hours against that day's workflow runs (3). If events is 0,
re-arm for the next day. Unblocked by: a closed day with events after 16:29Z on 2026-10-30. Verify:
`GET /budget/odds?date=<day>` then `daily.degraded_open.by_hour`.
