# Claude Code Command — the month write and the reconcile both depend on a request finishing

**Date:** 2026-10-18
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Confidence gate:** >= 95 before any commit
**Status:** PARTIAL 2026-11-03. Option 1 landed 2026-10-19 (`7ec2d03f`..`c8a45be7`, deploy run 39183315552 green), after two adversarial review rounds, and its done condition PASSED on the 2026-10-25T06:30Z read: the month-minus-daily gap read −2,790 at the baseline and −2,790 after CFL's 10-23 (54 credits) and 10-24 (588 credits) games; see "Done condition, result". Option 2 was UNHELD on 2026-11-01 by the owner's order "Build task 3", built as Task 3 of `docs/CC-CMD-2026-10-13-vendor-residual-window.md`, DEPLOYED 2026-11-01T17:25Z (`6589bc1`, run 41330484626) and PROVED against an abandoned request on 2026-11-02 (run 41413685131, `abort-loses-nothing`); its done condition 3 is HALF MET: the busy-day half is OPEN and is read by hand at 2026-11-08T08:00Z by `trig_01E9kMQiyKXENeyzuxNFBNsV` (`node scripts/analyze-cfl-reconcile-gap.mjs --day 2026-11-07`), with the result recorded in the vendor-residual CC-CMD's Data points and NOT here, because this document is on the calendar experiment's VOID list and takes no commit from 2026-11-08 to 11-23 (Note 2026-11-02). Option 3 and TASK 0's CFL half stay held by the 2026-10-18 ruling under "Decision" until 2026-11-24, when `trig_019aQvU36rYwZ7PqjaMnV5ut` judges the CFL post-window. This document flips to DONE on or after 2026-11-24, when that judgment has run and the busy-day result is recorded. Session doc: `outbox/cc-session-2026-10-19-odds-single-batch.md`.
**Filed by:** CC, from TASK 1 of `docs/CC-CMD-2026-10-18-odds-counter-internal-then-calendar.md`, which measures and may not fix.

---

## What was measured

`outbox/odds-counter-internal-2026-10-18.md`, from the D1 counter tables on
2026-10-18:

1. **`odds_budget_month` is short.** October read 34,369 against 37,135 in
   the daily rows. Every charge writes day and site in one D1 batch, then the
   month in a separate, later batch.
   - **25% of the gap** came in the 10-07 burst. Month-path D1 overloads were
     recorded on 10-10 and 10-11, and on 10-07 no reasons were stored.
   - **62% came after 10-12**, with no thrown month batch witnessed.
2. **Estimates are never replaced by a receipt.** This covers the
   vendor-side negative residual on every tally day: summed over 10-11 to
   10-17, −5,187 against 5,154. There are two sources:
   - `handleCFLOddsProbs` calls charged and never reconciled, 20% to 51% of
     that route's calls;
   - `ambientFetchLiveOdds` calls reconciled with no receipt header
     (10-09 to 10-11).
3. **Why CFL strands is not known.** It is request-driven, but so are the
   WC lambdas, which strand 0.8% to 5.2%.

## TASK 0 — find where CFL calls stop, with a measurement that exists

A per-path invocation outcome for a past day **does not exist to be read**:
- Workers analytics (`workersInvocationsAdaptive`) aggregates per script, by
  status (`clientDisconnected`), with no path dimension.
- The script-wide disconnect count is dominated by the SSE route
  (`/live/ambient`), where every stream ends in a disconnect.
- `wrangler.toml` has no `[observability]` block and no tail consumer.

So TASK 0 creates the measurement first. Two ways, for the owner:

- **(a) Workers Logs.** Turn on observability for the relay, then read the
  per-invocation outcome and URL for `/cfl/odds-probs` over one CFL day. This
  is a `wrangler.toml` change: not a binding, but config, so the owner
  decides. It has its own cost and retention.
- **(b) A stage tally, measurement only.** One D1 upsert per stage reached
  (`day-charged`, `month-charged`, `fetched`, `reconciled`) per site per day,
  using the same increment-cell shape as `odds_reconcile_state`. The last
  stage a call reached says where it stopped. No counter arithmetic changes.
  It adds D1 writes on every odds call; that cost is measured first, since
  `month: D1_ERROR … overloaded` was recorded on the charge path on 10-10
  and 10-11.

**Done:** one CFL-active day's artifact, committed, giving per-stage counts for
`handleCFLOddsProbs` with its coverage stated. If calls do not stop between
stages (the stage counts match), the cancellation reading is wrong: correct the
outbox document.

## The options, for the owner, after TASK 0

1. **One transaction for the charge.** Write day, site and month in a single
   D1 batch. This closes the internal gap, whatever its cause, because no
   stop can land between them. It does not touch the vendor-side over-record,
   and it changes no arithmetic: the same three increments, in one call.
2. **A stopped request still reconciles.** Run fetch-and-reconcile under
   `ctx.waitUntil()`.
   - **What it closes:** the never-reconciled part, if TASK 0 shows calls
     stopping after the charge. That raises effective spend toward the real
     ceiling, which is the capacity change the 2026-10-18 ruling defers.
   - **What it does not close:** the internal gap, which opens before the
     fetch.
   - **The cost:** `handleCFLOddsProbs(env)` is dispatched without `ctx`, so
     `ctx` has to be threaded through the routing. That is a structural change
     to the fetch handler, which CLAUDE.md gates on authorisation.
3. **Stop buying per page load.** Serve `/cfl/odds-probs` from a cron-filled
   cache, or gate it on CFL having events. That means fewer charges, and the
   season end then really zeroes the route. No counter path is touched.

The no-header estimates (`ambientFetchLiveOdds`) are a separate class, and none
of these options addresses them.

## Decision, 2026-10-18 (owner delegated)

The owner delegated the choice. Recorded here, with the reason for each:

1. **Option 1: yes, now.**
   - **Why it is safe:** it is the same three increments with the same
     predicates, sent as one batch. No stop can land between the day write and
     the month write, whatever the cause.
   - **What it changes:** when the batch commits and KV answers, nothing
     changes: the same increments and the same vetoes. When a D1 call throws,
     it changes in both directions. (Corrected 2026-10-18 by the branch's adversarial
     review; this bullet first said "the 85,000 monthly limit binds earlier
     if anything, never later", which is false on a thrown batch.)
     - **Stricter:** a fault that would have hit the second (month) call has
       no second call to hit. The one batch that commits also charges the
       month, and the limit can veto. Before, the day committed and then the
       month missed the charge.
     - **Looser:** a fault on the one batch charges neither counter, and the
       hard limit cannot veto that call. Before, a thrown day batch still ran
       the month batch, which charged the month and could refuse the call at
       85,000.

     So on a thrown batch the month can record less than the two-batch code
     did, and the limit can bind later. The `charge:` degrade-open count and
     its credits on `/budget/odds` witness that loss, but they do not bound
     it in either direction:
     - they count every thrown batch, including ones whose month write would
       have failed under the old code too;
     - `_countDegradeOpen` is a best-effort KV read-modify-write. It drops
       counts when degrades run concurrently, and records nothing when KV
       refuses the write, which is likeliest in the D1-overload storms this
       path exists for.

     Its credits are a floor on what degraded open. The month's loss is at
     most what degraded open.

     A third change, on the KV path, is stricter than the two-batch code.
     Sometimes a batch commits a veto and then the get or put of its warned
     key throws. In that case, `b5a95e7c` fell into its degrade-open catch
     and let the refused call spend:
     - on a day veto, the month batch still ran and charged the month
       +units;
     - on a month-limit veto, the call spent past 85,000 uncharged.

     The single batch now holds the veto whatever KV does: both cases refuse
     the call, charge nothing, and are not counted as degrade-opens. Its
     first commit on this branch let these calls through with no counter
     charged; a follow-up fix commit on the branch closed that. Option 1 does
     not touch the vendor-side over-record, which the 2026-10-18 ruling holds
     back.
   - **What it proves:** if the month gap still grows after it lands, the
     "lost between batches" cause is refuted, and the cause is another writer
     (`/d1/execute`) or something unlisted.
2. **TASK 0, month half: replaced** by option 1's done condition, which tests
   the same thing with a fix in place.
3. **TASK 0, CFL half (why CFL calls strand): held; SUPERSEDED 2026-11-01.** It
   only informed option 2, and Task 2b of
   `docs/CC-CMD-2026-10-13-vendor-residual-window.md` is the measurement it
   asked for (a disconnect stops the awaited chain: supported by one call, then
   proved fixed by the repeat on 2026-11-02).
4. **Option 2: held on 2026-10-18; UNHELD 2026-11-01** by the owner's order
   "Build task 3", built as Task 3 of
   `docs/CC-CMD-2026-10-13-vendor-residual-window.md` (see the Notes at the end),
   deployed 2026-11-01T17:25Z and proved against an abandoned request 2026-11-02;
   its busy-day half is open (Note 2026-11-02).
   It closes the vendor-side over-record, which raises effective spend toward
   the real ceiling. That was the capacity change the 2026-10-18 ruling deferred
   to a later CC-CMD; the order of 2026-11-01 takes it.
5. **Option 3: held until 2026-11-24.** Changing `/cfl/odds-probs` now would
   change what `CC-CMD-2026-10-18-odds-counter-internal-then-calendar`'s TASK 2
   measures over 2026-11-08 to 11-23. Revisit after its judgment run.

## Done condition

1. TASK 0's artifact committed.
2. The owner's choice recorded under "The options".
3. For whichever option lands, measured over one CFL-active day, with
   CC-CMD-2026-10-18's TASK 2 window (2026-11-08 to 11-23) avoided or
   declared, since a change there voids that experiment:
   - option 1: month row minus the sum of daily rows does not change that day;
   - option 2: never-reconciled CFL calls fall to near 0 (read as at most 48 credits of `stranded` on a day with at least 100 HIT calls; Note 2026-11-02, item 1);
   - option 3: CFL charges fall by the measured page-load share.

## Done condition, result (2026-10-25)

**Read 2026-10-25T06:30Z (scheduled `trig_01YbnNqGQr72vNhVUHPPpnXq`), verbatim.**

Step 0, no month veto on the measured days (relay self-probe, 06:31Z):

```
/budget/odds?date=2026-10-23  month_limit_reached_at null, ceiling_reached_at null,
                              stamps_unreadable null, used 636, unaccounted 0
/budget/odds?date=2026-10-24  month_limit_reached_at null, ceiling_reached_at null,
                              stamps_unreadable null, used 2324, unaccounted 0
monthly (both):               used 43792, limit 85000, remaining 41208
```

The field is present on both days, so fix 3 B of
`docs/CC-CMD-2026-10-23-odds-ceiling-prerequisites.md` is live and the veto
check ran on the field itself, not the monthly fallback.

D1 `cc49101c`, the query from the task:

```
SELECT (SELECT used FROM odds_budget_month WHERE month='2026-10')
     - (SELECT SUM(used) FROM odds_budget WHERE day LIKE '2026-10-%') AS gap, ...

gap = -2790   month_used = 43792   daily_sum = 46582
d23 = 636     d24 = 2324
handleCFLOddsProbs: 10-23 = 54, 10-24 = 588
```

| when | month (2026-10) | sum of daily | gap |
|---|---|---|---|
| 2026-10-19T01:06Z (baseline) | 35,857 | 38,647 | −2,790 |
| 2026-10-19T01:58Z | 35,875 | 38,665 | −2,790 |
| 2026-10-23T18:39Z | | | −2,790 |
| **2026-10-25T06:30Z** | **43,792** | **46,582** | **−2,790** |

Since the baseline the month row rose 7,935 and the daily rows rose 7,935. The
window holds CFL charges on both closed game days, 54 and 588 credits.

**PASS.** The gap is unchanged, with CFL charges above 0 on 10-23 and 10-24. The
gap did not grow, so the "lost between batches" cause is not refuted, and no
other writer moved the month row against the daily rows in this window.

Coverage (Rule 91): this is one aggregate over one window, 6 days and 7,935
credits. It would not show a month loss offset by an equal daily loss. It is
what the done condition asked for.

**Re-read 2026-10-27T18:35Z** (D1 `cc49101c`, the same query): month 45,196, daily
rows 47,986, **gap −2,790**. Since the 06:30Z read on 10-25 (month 43,792, daily 46,582)
the month row and the daily rows have each risen 1,404, through the rest of 10-25, all of
10-26 and part of 10-27. The note of 2026-10-27 below reads "+66" across 10-19 to 10-26;
that figure sums the per-day diagnostic rows of the `daily-vs-monthly` log over offset
windows, which the log marks diagnostic, while the gap above is the exact month-minus-daily
total, and it has not moved.

## FORBIDDEN

- No credits.
- No change to counter arithmetic, and no change to routing, without the
  owner's choice above.
- Do not widen `daily-exceeds-monthly` or any watch to make a gap disappear.

---

## Note 2026-10-27: why `Odds daily vs vendor` has run red since at least 10-20, and when it clears

Measured from `outbox/odds-daily-vs-monthly-20261027T045612Z.log` (run 40452449705). The workflow's failing step is
`watch-odds-daily-vs-monthly.mjs`; it exits 1 only on verdict `daily-exceeds-monthly` (`scripts/watch-odds-daily-vs-monthly.mjs:96-110`).
`month-boundary`, `no-contained-day` and `consistent` all exit 0.

- The month's segment starts at the 10-01 reset, so the watch sums daily counters over 10-02 to 10-26: 47,455 against a monthly
  delta of 44,935, EXCESS 2,520 (ratio 1.06x). Across the eight logs since 10-20 the excess sits between 2,127 and 2,538.
- The diagnostic per-day rows sum to excess 2,877. Rows 10-19 to 10-26 sum to **+66**; rows 10-01 to 10-18 sum to **+2,811**.
  The single-batch deploy was 10-19 (run 39183315552), and the gap it froze was −2,790. The red is the pre-10-19 days
  still inside the segment, not a live divergence. Individual rows are offset windows (the log says diagnostic only); the sums
  over contiguous ranges are exact up to the two edge hours.
- Prediction, falsifiable: the first run after the 2026-11-01 reset reads `month-boundary` or `no-contained-day` and exits 0, and
  every later run exits 0 unless the post-10-19 days diverge. A run that reads `daily-exceeds-monthly` with excess above 500 on
  days that all follow 10-19 would mean the single-batch fix did not hold, and this note is wrong.
- Not changed: no code. A floor at the deploy instant would clear the red 5 days earlier at the cost of a new constant in a guard;
  the watch cannot fire on a new divergence until 11-01 either way, which is the whole price of leaving it.
- **Result, read by the scheduled wake of 2026-11-02 (fired 10:00Z): the prediction held, and the half of it that can fail is not
  yet tested.** Both runs started at about 05:54Z, not 04:30Z; GitHub starts the schedule late.
  - Run 41278695947, 2026-11-01T05:54Z, sha `df74feb2`: success, every step green, step 6 (`Our daily counter against our monthly
    counter`) included. `outbox/odds-daily-vs-monthly-20261101T055434Z.log` reads `verdict: month-boundary`: 44 readings on file,
    1 in the current segment (43 dropped at the reset of 2026-11-01T05:54:31Z), 0 days fully inside the span.
  - Run 41396684994, 2026-11-02T05:54Z, sha `60dcf2a2`: success, every step green. `outbox/odds-daily-vs-monthly-20261102T055419Z.log`
    reads `verdict: no-contained-day`: 45 readings on file, 2 in the segment, span 2026-11-01T05:54:31Z to 2026-11-02T05:54:15Z,
    0 days fully inside.
  - Before them all six scheduled runs of 10-26 to 10-31 were red, and step 6 failed in every one. The last, run 41172781486, read
    `daily-exceeds-monthly` with EXCESS 2,580 (ratio 1.05x), just above the range of 2,127 to 2,538 quoted above. On four of the
    six (10-26, 10-29, 10-30, 10-31) step 5, `Watch`, was red as well. That is the vendor watch, a different verdict (on 10-31
    `we-overcharge-ourselves`, residual -631 against a tolerance of 50) kept in
    `docs/CC-CMD-2026-10-13-vendor-residual-window.md`, not predicted here. Its first window-aligned verdict, in the 11-02 run, was
    `tracks-the-bill` (residual -22, tolerance 50).
  - What the green shows: the pre-10-19 days left the segment with the reset, which is what the prediction said would clear the red.
    What it does not show: both logs end "Not a pass and not a failure — the comparison did not run (Rule 99)". No closed UTC day
    lay inside the span, so nothing was compared. A green from an empty comparison is no evidence that the single-batch fix
    holds, and the condition that would refute this note (`daily-exceeds-monthly` on days that all follow 10-19) is still open.
  - When it can be read: the run of 2026-11-03 (about 05:54Z) is the first whose span holds a whole closed UTC day, 2026-11-02, so it
    is the first that compares anything. `dailyVsMonthly` on the committed series plus one invented reading for that day returns
    `consistent` with one contained day, which tests that the code leaves `no-contained-day` then; it does not predict the figure.
    The watch exits 1 on any excess above its FLOOR of 50, while this note's bar for "the fix did not hold" is 500, so a
    `daily-exceeds-monthly` with an excess of 51 to 500 turns the workflow red without refuting the note.
  - **Second reading, 2026-11-03: `consistent`, with one contained day. The note stands on that one data point.** Read at 08:51Z
    by the wake `trig_01Kc6YEYyFDtRDsuQzjtrHxW` (fired 08:30:45Z, item 8 of Note 2026-11-02). Run 41591246150, scheduled, created
    2026-11-03T06:39:18Z, sha `09677a77`, `success`; no step failed (steps 4 to 9 all `success`, among them 5 `Watch` and 6
    `Our daily counter against our monthly counter`). `outbox/odds-daily-vs-monthly-20261103T063934Z.log`: 46 readings on file, 3 in
    the current segment (43 dropped at the reset of 2026-11-01T05:54:31Z), `days fully inside the span: 1 (2026-11-02:339)`, span
    2026-11-01T05:54:31Z to 2026-11-03T06:39:30Z, `verdict: consistent`, `daily sum 339 <= monthly delta 997 — no contradiction`.
    There is no EXCESS to quote: the log prints one only for `daily-exceeds-monthly`. The per-day rows, which the log calls
    diagnostic and not a verdict: 11-02 reads 339 against 300 (excess 39, under the floor of 50, a 24.8 h span) and 11-01 reads
    760 against 697 (excess 63, 24 h; 11-01 is not a contained day, its first hours fall before the reset). Judged by this Note's
    rule and nothing else: `consistent` means the post-10-19 day agrees, and the condition that would refute the Note
    (`daily-exceeds-monthly` with an excess above 500 on days that all follow 10-19) did not occur. What it does not show: one day
    is not proof, and the verdict is a one-sided inequality with 658 of slack here (997 less 339, because the span also holds the
    edge hours of 11-01 and 11-03), so it could not have gone red on a divergence under 658 credits. The finer evidence is the
    11-02 row (excess 39), and it is offset by the read hour. Each later run adds a contained day until the segment resets on
    2026-12-01, and the workflow exits 1 on `daily-exceeds-monthly`, so no further wake is scheduled.

---

## Note 2026-11-01: option 2 is built, by the owner's order, and what it changes

**The hold is lifted.** Decision 4 above held option 2 because it "closes the vendor-side over-record, which raises effective spend toward the real ceiling". On 2026-11-01, after Task 2b of `docs/CC-CMD-2026-10-13-vendor-residual-window.md` showed the mechanism for at least one call (run 41313403502: 0 of 5 aborted `/cfl/odds-probs` calls tallied against 5 of 5 that were not, one charge left standing; for the other four the ledger cannot say cut or never arrived), the owner ordered "Build task 3". That is option 2, and it is built there, not here. The CLAUDE.md gate on structural changes to the fetch handler is answered by the same order: the change threads `ctx` through ONE call site, the `/cfl/odds-probs` route, and touches no other routing.

**What was built differs from option 2 as written, for a measured reason.** Option 2 said "run fetch-and-reconcile under `ctx.waitUntil()`". The experiment aborted calls at 3, 10, 25, 50 and 100 ms and cannot say where it cut each one (the ledger keeps no count of charges), so a registration placed after the fetch would leave every earlier moment open to a cut. So the whole call (charge, vendor fetch, reconcile, tally) is one promise, registered with `waitUntil` in the handler's synchronous segment and also returned, so the response, `reconciled` included, is unchanged. It also does not close "the internal gap, which opens before the fetch": option 1 did that, and still stands.

**What it does to this document's done condition 3 for option 2** ("never-reconciled CFL calls fall to near 0"): HALF MET. The repeat of Task 2b RAN on 2026-11-02 with the owner's approval and returned `abort-loses-nothing` (5 of 5 abandoned calls cut, every refund and tally landed; run 41413685131). The busy-day half is still open: it is measured by `node scripts/analyze-cfl-reconcile-gap.mjs` on the next busy CFL day (2026-11-07, the Division Finals), against the criterion fixed in Task 3 of the vendor-residual CC-CMD before the data exist: a gap of at most 48 credits across a day with at least 100 HIT calls tallied (the figure was moved from `gap` to `stranded` on 2026-11-03, before any 11-07 data existed: Note 2026-11-02, item 1). "Near 0" in this document is read as that, not as exactly 0: quiet days before the fix already showed a gap of 12.

**What it does to effective spend.** Option 2 was held because it raises effective spend toward the real ceiling, and it does. The stranded charges were the ledger's over-record (about 2,076 credits over 11 measured windows, 1,962 of it CFL's gap), so closing them returns that headroom to the guards that read the ledger: the daily counter and the per-site ceilings stop counting 6 credits for every cut cache-HIT call. A call that was cut before its vendor fetch now completes, and on a cache MISS that bills the vendor, which is spend the old behaviour sometimes avoided by accident (a cut call that never fetched). Neither effect is measured separately; the per-site ceiling for this route is unchanged by this change.

**What it does to the calendar experiment** (`docs/CC-CMD-2026-10-18-odds-counter-internal-then-calendar.md`, TASK 2, window 2026-11-08 to 11-23): the fix is committed on 2026-11-01 (commit `6589bc1`, deployed 2026-11-01T17:25Z by Deploy RELAY Worker run 41330484626), outside the window, so the prediction's own VOID rule (a commit to `handleCFLOddsProbs` between 11-08 and 11-23) voids nothing. Unlike option 1 on 10-19, which left the measured rows untouched, this change TARGETS the quantity the experiment measures. The prediction document records that under "Added 2026-11-01": the judging run scores every test as committed, annotates H-whole, spec 2.3 and M (c) as measured after an intervention, and re-statuses nothing.

## Note 2026-11-02: what the vendor-residual CC-CMD left open is carried here (wrap-up filed 2026-11-03), and the CC-CMD's last edit before the VOID window

Filed here, not as a new CC-CMD, by BUILD-ON-A and Rule 87.4: `docs/CC-CMD-2026-10-13-vendor-residual-window.md` was closed on 2026-11-02 (wrap-up 2026-11-03) and hands what it left open to this document, which already owns "the stranded part of the ledger" (`docs/CC-CMD-2026-10-23-odds-spend-without-need.md` says so). **Items 1 to 9 are all of it, each with an owner, a trigger or its outcome. This is the last commit this document takes before the calendar experiment's VOID window (2026-11-08 to 11-23): the prediction document lists "any option of" this document among the things that void it, so the 11-07 result is recorded in the vendor-residual CC-CMD instead (item 1), and every other leftover has its outcome stated here now.** (Item 8 is the one exception, by design: its wake appended the Second reading on 2026-11-03, before the window opened.)

1. **Option 2's done condition 3, the busy-day half. OPEN, read by hand; the criterion moved from `gap` to `stranded` on 2026-11-03, before any 11-07 data exist.**
   - **The figure.** `stranded` = `by_site - (credits_kept - credits_kept of the state=error rows)`. An `error` row is a reconcile that threw after its refund landed (measured for CFL on 2026-11-01: `by_site` rose by exactly the billed calls while an `error` call added kept +6), so its kept is an intent with no standing charge. `gap` (`by_site - kept`) therefore under-reads the charges that stayed by exactly that amount, and a stranded call and an error call on the same day cancel in it. On the committed series (60 samples, 2026-10-20 to 11-02) the two differ on two days: 10-22 (gap 90, stranded 96) and 11-01 (18 and 24). Both figures are printed; the verdict reads `stranded`.
   - **The criterion** (otherwise unchanged from Task 3, part 2 of the vendor-residual CC-CMD): `stranded` at most 48 credits (8 calls) on a UTC day with at least 100 cache-HIT calls tallied; fewer is inconclusive. One addition, a design choice of the read and not a measured boundary: the day's last drift sample must be at or after 21:00Z, because on 10 of the series' 14 days the last sample still added spend over its own interval, so the hours after it are unread; the output prints how many. A `stranded` that is negative or not a whole number of 6-credit calls (it was a whole number in 59 of 59 CFL samples) gets no verdict.
   - **The command and its artifact.** `node scripts/analyze-cfl-reconcile-gap.mjs --day 2026-11-07` prints the figures and the verdict (`pass`, `fail`, `inconclusive:few-hit-calls`, `inconclusive:partial-day`, `inconclusive:figure-not-a-count-of-calls`, `no-data`) and writes `outbox/cfl-stranded-day-2026-11-07.json`; it exits 0 whatever the verdict. Self-test 41 assertions, harness 35 of 35 mutants, both in `runner-read-guards.yml`.
   - **The read.** `trig_01E9kMQiyKXENeyzuxNFBNsV`, 2026-11-08T08:00Z, runs the command for 2026-11-03 through 2026-11-07 (five closed days, all printed; 11-02 is excluded, its last sample is 20:55Z). The verdict that counts is the 11-07 line, the day the criterion was filed for. **The result is recorded in the vendor-residual CC-CMD's Data points, with the artifact committed beside it, and not in this document.** If 11-07 is inconclusive, done condition 5 closes as that, stated, and the five lines stand as context; nothing is re-armed.
   - **What the deploy shows so far** (read 2026-11-03, from the same series): between the 17:17Z and 21:24Z samples of 11-01 (the deploy, 17:25Z, lies 8 minutes inside that span) `stranded` stayed at 24 while the tally grew from 15 to 134 calls, so 0 stranded charges in 119 calls; 11-02 to its 20:55Z sample, 0 of 39 calls, 14 of them the repeat of Task 2b's own. Neither is a busy day, and all 4 of 11-01's stranded charges were already counted at the 17:17Z sample.
2. **The same fix at the other sites. The owner's call; nothing is built.** From the committed drift series (`outbox/odds-site-drift-series.json`, last sample of each UTC day, 2026-10-20 to 2026-11-02, read 2026-11-02), `stranded` per site:

   | site | days with a stranded charge (calls of 4 credits) | busiest day |
   |---|---|---|
   | `getWCPregameLambdas` | 10-20: 2, 10-21: 2, 10-24: 2, 10-29: 11, 10-30: 1, 11-01: 4; the other 8 days 0 | 10-29: 11 calls (44 credits) beside 131 HIT calls, a day with 5 recorded D1 overload degrades |
   | `handleCFLOddsProbs` (6 credits), before the fix | 11 of the 12 days 10-20 to 10-31, 2 to 98 calls (10-23: 0) | 10-29: 98 calls beside 357 HIT; 10-24: 75 beside 389 |
   | `handleCFLOddsProbs`, after the deploy | 11-01, 17:17Z sample to 21:24Z sample (deploy 17:25Z inside it): 0 of 119 calls; 11-02 to 20:55Z: 0 of 39 calls, 14 of them the repeat of Task 2b's own | not yet a busy day |

   The WC lambdas strand a few calls on some days (0 to 11), against CFL's tens, and the ledger cannot say whether a client disconnect, an AmbientDO-driven call hitting a D1 overload, or something else caused them: both callers (`handleV2Games` for a client, AmbientDO) bill under the one label `getWCPregameLambdas`. **Recommendation:** do not register that route's calls yet; first split the label by caller (the same change Decision 2 of `docs/CC-CMD-2026-09-16-odds-spend-attribution.md` made for the identity routes) so the next busy week says which caller strands, then decide. That is a Worker change and the owner's order of 2026-11-01 covered the CFL route only. **There is an open remedy for most of these calls already:** TASK 1 of `docs/CC-CMD-2026-10-23-odds-spend-without-need.md` (Status FILED, not dispatched) gates the lambdas on the tournament window, because their demand outside June to July is 0, which removes the calls and the charges stranded on them; it should land BEFORE any `waitUntil` registration for this route, and a registration is worth deciding only on a day inside the tournament window, when the calls have a consumer. `handleWCOddsProbs` has a gap of 0 in all 42 samples and `oddsProxyRoute` has no rows at all (absence of rows, not a measured zero).
3. **P2 of the vendor-residual CC-CMD, "the known CI spend is not in the ledger": CLOSED 2026-11-03, by measurement; it had been read from source.** If CI's credits were also in the ledger, the residual (which subtracts them) plus the CFL gap would sit near −CI; if they are not, near 0. Over the committed windows (`node scripts/analyze-cfl-reconcile-gap.mjs --out outbox/cfl-reconcile-gap-2026-11-03.json`, the `P2` line and `p2` in that file; the 2026-11-01 record `outbox/cfl-reconcile-gap.json` is left as it was, since the drift series is a rolling 60 samples and a later run cannot reproduce its early windows): of 11 measured windows (12 in all) residual + gap is nearer 0 in **10** and nearer −CI in 1, with known CI between 80 and 240 credits per window. The one the other way is 10-30 to 10-31 (residual −406, gap midpoint 198, CI 160, so −208 left over), which neither reading explains; it is recorded, not explained. The premise stands on 10 of 11 windows.
4. **The window-drift refusal (22 to 26 h) stays; no decision is waiting on it.** HANDOFF recorded it as "could be relaxed" now that the ledger and the vendor cover the same instants. Of the 34 committed watch logs since 2026-10-01, one is a `window-drift` refusal (2026-10-12T00:10, an off-schedule run) and none of the 22 since; no run has been lost to it. A relaxation would be a change to the watch for a cost nobody has paid. If the owner wants it relaxed, it is a one-line change to `vendorDay` with its self-test case and mutant.
5. **Absence collapsed to 0 in `noHeaderCredits` (`scripts/watch-odds-daily-vs-vendor.mjs`): FIXED 2026-11-03.** It summed `credits_kept` and `n` as `Number(x) || 0`, a loop the absence-collapse gate cannot see. A row that is not an object, or a `no-header` row without a numeric `credits_kept` or `n`, now makes the tally null (UNREADABLE), as its own comment said it must. It feeds only the diagnostic line "unreconciled estimate", not `judgeDay`. Self-test 83, mutants V3a (the original defect) and V3b. Noted in `docs/CC-CMD-2026-10-11-no-header-estimates-unreconciled.md`, which owns the function.
6. **The "2 credits per call" header comments: FIXED 2026-11-03** (comment-only, `src/index.js`). `/cfl/odds-probs` charges 6 (3 markets x 2 regions, `oddsCreditCost`; measured 2026-09-05, `X-Requests-Last` 6); the line above `handleWCOddsProbs` said 2 and the route charges 4 (2 markets x 2 regions).
7. **Accepted, not changed:** a vendor fetch that throws goes to the route's catch branch and the charge stands with no reconcile (the route's existing behaviour; the prediction document names it as a reason the stranded figure will not be exactly 0); if `ctx.waitUntil` itself threw synchronously after the pipeline had started, the call would run unregistered (the documentation names no such condition; Task 3 states it).
8. **The open half of Note 2026-10-27 (does the single-batch fix hold?) is carried by `trig_01Kc6YEYyFDtRDsuQzjtrHxW`**, a one-shot at 2026-11-03T08:30Z bound to `session_01X1QRUKcA6Q8MCKMehmeiXX` (the session that wrote that Note's Result bullet). The 2026-11-03 run of `Odds daily vs vendor (read-only)` is the first whose span holds a whole closed day (2026-11-02); the wake reads its `outbox/odds-daily-vs-monthly-20261103T*.log`, judges by the Note's own rule (`daily-exceeds-monthly` with an excess above 500 on days that all follow 10-19 refutes it) and appends "Second reading, 2026-11-03" under that Result bullet. This document is PARTIAL (not DONE) in part so that this stays open until that reading is recorded. **Recorded 2026-11-03: the wake fired at 08:30:45Z and its reading is the "Second reading, 2026-11-03" sub-bullet under that Result bullet (run 41591246150, `consistent`, one contained day, 2026-11-02: 339 against a monthly delta of 997). The Note stands on that one data point. This item is closed; the Status stays PARTIAL for the reasons it gives.**
9. **Option 3 (the page-load share) is revisited on 2026-11-24, by the judge's wake.** Decision 5 held it until "its judgment run", and the judge's prompt (`trig_019aQvU36rYwZ7PqjaMnV5ut`) named neither this document nor option 3, so nothing would have done the revisit. On 2026-11-03 one additive sentence was appended to that prompt (the pre-registered scoring text is untouched; the sentence is recorded in the prediction document under "Added 2026-11-03"): after judging, read this document's Decision 5 and record in a new Note whether option 3 should proceed, and flip this Status to DONE only if the busy-day result (item 1) is recorded in the vendor-residual CC-CMD. 2026-11-24 is outside the VOID window (it ends 2026-11-23), so that commit is allowed.
