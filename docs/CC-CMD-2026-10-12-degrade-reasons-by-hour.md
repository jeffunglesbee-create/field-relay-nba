# Claude Code Command — give the degrade counter an hour, so a cause can be attributed

**Date:** 2026-10-12
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (instrument) — one field added to a counter that already exists
**Status:** OPEN. Filed rather than deferred, per Rule 87.4, by
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

## Done conditions

1. A closed day's `/budget/odds?date=` carries `daily.degraded_open.by_hour`.
2. The pairing watch prints it, and a mutation that drops it reads as
   `not-reported`, not as zero.
3. One day's overloads laid against that day's runs, in this document, with the
   hours named.
