# Claude Code Command — the odds counter's two disagreements, cheapest first

**Date:** 2026-10-18
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** A (measurement) — no production change, no credits
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched.
**Authorised by:** the 2026-10-18 ruling in `docs/CC-CMD-2026-09-19-daily-vs-vendor.md`, owner delegated.

---

## What this is for

The 2026-09-19 watch has produced a verdict on 26 closed days and it is a
consistent **negative** residual: the ceiling guards a number **above** real
spend. That is now a named fourth outcome in its spec and its done condition is
met. This CC-CMD is the only follow-up that ruling authorises, and it is
deliberately the two cheapest things available.

**It does not fix the over-record.** Correcting it raises effective spend toward
the real ceiling and buys no information about whether the breach path exists.
That is a capacity change for a later CC-CMD. Any task here that proposes
changing a counter's arithmetic is out of scope — stop and report.

**It spends no credits.** Not one. If a task appears to need a vendor call, it
is the wrong task; stop and report.

---

## TASK 1 — the disagreement that is entirely ours (do this first)

`daily-exceeds-monthly` has been **red on every run**, with EXCESS 877, 931 and
940 on the three most recent. Its own log says it cannot tell which counter is
wrong. Both counters are in this project's own D1, so unlike the vendor
comparison there is no second party and no tolerance — one of two numbers we
wrote is wrong, and the answer is fully in hand.

A starting asymmetry, from the 2026-10-16 close: `used 2868`, `by_site_sum
2868`, `unaccounted 0`. **The per-site rows reconstruct the daily counter
exactly.** So the daily figure is corroborated by a second, independently
written set of rows, and the monthly figure is corroborated by nothing. That is
a lead, not a conclusion — report it as a lead and then test it.

1. Reconstruct the month from the per-site rows and from the daily closes
   independently, and compare both against `ledger_month_used`. State which of
   the three disagrees with the other two, per closed day, over every day the
   series holds.
2. Name the mechanism, not just the gap. A monthly counter that disagrees with
   the sum of its own days is either double-counting a day, missing one, or
   writing outside the day boundary the daily counter uses. Those leave
   different fingerprints — say which one the data shows.
3. `/budget/odds` is read **through the committed logs only**, as the daily read
   does. Do not call it directly.
4. If the three reconcile and the EXCESS is an artefact of the watch's own
   arithmetic rather than of a stored counter, that is the finding and it is a
   better one. Say so plainly.

**Do not change a counter in this task.** Task 1 ends with a named mechanism
and the row evidence for it.

---

## TASK 2 — the experiment the calendar runs for free

The suspected cause is already named in the 2026-10-17 daily read:
`handleCFLOddsProbs` moved **90 → 798** by site between the 10-15 and 10-16
closes, and the residual deepened −561 → −675. Over 10-16T04:24:18Z →
10-17T04:17:28Z the ledger moved **+2,859** against the vendor's **+2,313**, a
**−666** gap that fits CFL over-recording going unbilled.

CFL's season ends. When it does, that handler's contribution goes to zero with
no code change, no credits and no instrumentation. That is a control group the
schedule provides.

1. **Write the prediction down BEFORE the last CFL game, with numbers.** Record
   the CFL by-site figure at the last close before CFL's final game, and the
   residual on that day. Then state the predicted residual range for the seven
   closed days after, on the hypothesis that CFL over-recording is the whole
   cause, and on the hypothesis that it is none of it. A prediction written
   afterwards proves nothing.
2. **The end date is a lookup, not a query.** The archive holds no forward
   schedule — measured 2026-10-18: `regular_season_games` has **0 CFL rows
   dated after 2026-10-18 and 0 unscored CFL rows**, because the writer's window
   is yesterday and today. Get the date from the CFL schedule; do not infer it
   from D1 and do not guess it.
3. After seven closed days, report the measured residual against both
   predictions. If it contracts by roughly the recorded CFL by-site figure, the
   cause is confirmed. If it does not contract at all, CFL is exonerated and
   the lead was wrong — which is equally a result and must be reported as one.
4. The arithmetic in the daily read that produced −666 is that reader's, on the
   series rows, **not the watch's verdict**. Keep that distinction in anything
   this task writes.

---

## FORBIDDEN

- **No credits.** Not one call that bills.
- **No counter arithmetic changed** — not in `src/`, not in the watches. This
  CC-CMD measures.
- **Do not re-litigate the fourth outcome.** It is ruled. If the evidence here
  contradicts it, report the contradiction and stop; do not act on it.
- **Do not fix `daily-exceeds-monthly` by widening its tolerance.** It has no
  tolerance, by design: both numbers are ours. Widening is the fallback shape.
- No PR. Commit to `main`.

## Done condition

1. Task 1 names which of the three reconstructions disagrees, with the
   mechanism and the per-day rows behind it, in `outbox/`.
2. Task 2's prediction is committed **before** CFL's final game, with the
   figures it will be judged against.
3. Neither task spent a credit, and the spend ledger after shows it.

## Why cheapest-first rather than root-cause-first

The vendor comparison has two parties, a tolerance, and a cost per question.
The internal one has one party, no tolerance, and costs nothing. Both are
plausibly the same bug. Working the expensive, ambiguous side of a possibly
shared cause before the free, unambiguous side is the error this ordering
exists to avoid — and if they are the same bug, Task 1 answers the vendor
question for free as a side effect.
