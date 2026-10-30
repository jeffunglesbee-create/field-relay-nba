# Claude Code Command — give the degrade counter an hour, so a cause can be attributed

**Date:** 2026-10-12
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (instrument) — one field added to a counter that already exists
**Status:** PARTIAL — Task 1 built 2026-10-30 (the counter carries `by_hour`; the pairing watch prints it). Task 2 and
done conditions 1 to 3 need a closed day with degrade events after the deploy, which cannot be produced on demand (see
"Done conditions, as of 2026-10-30"). Filed rather than deferred, per Rule 87.4, by
`docs/CC-CMD-2026-10-11-d1-overload-degrades.md`, which could not attribute
2026-10-11's 155 D1 overloads for want of exactly this.

## Why

`odds:degraded:<date>` holds `{ events, credits, reasons, last }` — a day's
totals and the time of the LAST event. Nothing says when the others happened.

The only timing on file comes from watches that sample the counter, and their
samples are 3 to 7 hours apart because GitHub's scheduled-run delay here is
104–405 minutes. On 2026-10-11 the count was 0 at 09:21Z and 111 at 16:29Z.
Inside that seven hours were four deploys and five archive-scanning probes, and
the counter cannot say whether the overloads clustered around them or spread
evenly through a busy afternoon. Those two readings have different fixes: one
is "stop deploying into the peak", the other is a capacity question.

## Task 1 — add `by_hour`

In `_countDegradeOpen`, beside `reasons`, keep `by_hour`: a map from the UTC
hour (`'00'`–`'23'`) to `{ events, overload }`, where `overload` counts reasons
containing `D1 DB is overloaded`. Twenty-four keys at most, so it cannot grow
past the existing reason cap's order of size, and it rides the same KV write
the counter already makes — **no new write per degrade**.

`/budget/odds` already returns the whole block, so the field reaches every
reader with no route change. `watch-odds-pairing-rate.mjs` prints it under the
closed-day section when present and treats its absence as `not-reported` for
that field only — never as zero (Rule 99).

## Task 2 — the attribution, once a day has it

For the first closed day with a non-trivial overload count, lay `by_hour`
against that day's workflow runs (`gh api .../actions/runs?created=<day>`,
with start and end times) and say which hours carried the overloads and what
ran in them. Record it in this document.

## Stop conditions

- Do not add a write. `by_hour` goes into the object the counter already writes.
- Do not change `DEGRADE_REASON_CAP` or the reason strings — the closed-day
  watch matches on them.
- Do not add a retry, a ceiling change or a cron change. The parent document's
  stop conditions stand.

## Re-verified 2026-10-30 — this document was 18 days old

Every claim above was re-read against `main` before building. Where the document and the code disagree, the code wins.

| the document says | on 2026-10-30 |
|---|---|
| `odds:degraded:<date>` holds `{ events, credits, reasons, last }` | True. Written by `_countDegradeOpen` in `src/budget-helpers.js`, one get and one put. |
| `/budget/odds` already returns the whole block, so no route change | True. The reader passes the parsed object through as `daily.degraded_open`; a new field reaches every reader. |
| the watch "treats its absence as `not-reported` for that field only" | **Stale.** The watch has since gained a block-level `d1OverloadVerdict` that FAILS the run on `not-reported`, `unreadable` and `unattributed`. `by_hour` is therefore a separate verdict (`byHourVerdict`) that prints and never fails: the field did not exist before this change, so every earlier record lacks it. |
| Task 2 uses `gh api .../actions/runs?created=<day>` | **Not available** in the sessions that read this. The run list comes from the Actions API through the GitHub tools. |
| "no new write per degrade" | True, and now asserted: `scripts/check-degrade-by-hour.mjs` requires exactly one put per degrade on the real `chargeOdds` path. |
| "do not change `DEGRADE_REASON_CAP` or the reason strings" | Respected. The parent's stop conditions (no retry, no degrade-closed, no ceiling or cron change) are respected too. |
| nothing else builds `by_hour` | True (grep of `src`, `scripts`, `docs`, `.github`: no hit before this change). |

Two things the document did not know: the VOID window of the CFL experiment (2026-11-08..11-23) names `chargeOdds`,
`reconcileOddsCredit` and the wrappers, not `_countDegradeOpen`, and this landed before it either way; and
`Object.keys` enumerates `'10'..'23'` before `'00'..'09'`, so the watch sorts the hours explicitly.

## Task 1 — built 2026-10-30

- `src/budget-helpers.js`: `bumpHour` (pure, exported) and `D1_OVERLOAD_MARK`; `_countDegradeOpen` takes ONE instant for the day
  key, the hour and `last`, and writes `by_hour` in the object it already wrote. `chargeOdds` and its call site are untouched.
- `scripts/check-degrade-by-hour.mjs`: 27 assertions on the real `chargeOdds` (node:sqlite D1 whose charge batch throws, recording
  KV, pinned clock), including the day boundary, a record from before the field, a failing KV, and mark equality with the watch.
  `scripts/mutate-degrade-by-hour.mjs`: 12 mutations, all caught; the first run found a crash in the check itself (it dereferenced
  `by_hour` unguarded), which is why the harness requires a FAIL line and not just a non-zero exit.
- `scripts/watch-odds-pairing-rate.mjs`: `byHourVerdict` (`none`, `reported`, `partial`, `inconsistent`, `not-reported`,
  `unreadable`) and `byHourLines`; self-test 136/136. A map that covers fewer events than the counter says `partial` with both
  numbers (the day of the deploy), and an absent map prints "this is NOT zero". `scripts/mutate-odds-pairing-rate.mjs`: 46 of 46.

## Done conditions, as of 2026-10-30

1. **Not yet observable.** Needs a closed day that has at least one degrade-open event after the deploy. 2026-10-29 had 5 (all before
   16:05Z, none after) and carries no map: it predates the field. Verify when one exists:
   `GET /budget/odds?date=<day>` then `daily.degraded_open.by_hour` is an object whose per-hour `events` sum to `daily.degraded_open.events`.
2. **Met in the watch's tests:** it prints the map, prints `not-reported` (not zero) on the real 2026-10-29 record, and mutations B1, B2
   and B9 turn those red. **Not yet seen on a live log**, for the reason in 1.
3. **Not met.** Needs 1, then the day's `by_hour` laid against that day's workflow runs. A wake reads the newest closed pairing-watch log
   daily until one has events after the deploy.

## Done conditions (as filed 2026-10-12)

1. A closed day's `/budget/odds?date=` carries `daily.degraded_open.by_hour`.
2. The pairing watch prints it, and a mutation that drops it reads as
   `not-reported`, not as zero.
3. One day's overloads laid against that day's runs, in this document, with the
   hours named.

## Data points

- **2026-10-29:** 5 degrade-opens, 30 credits, all `charge: D1_ERROR: D1 DB is overloaded. Requests queued for too long.`, last at
  16:04:03Z, none after (`GET /budget/odds?date=2026-10-29` read 2026-10-30T12:01Z; 18:34Z on the day read the same 5). Under the
  watch's budget of 13. The hour of each is unknown; this is the figure `by_hour` would split. Recorded in
  `docs/CC-CMD-2026-09-16-odds-spend-attribution.md`, "Task 3 live day 1".
