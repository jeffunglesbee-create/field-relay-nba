# Claude Code Command — the month write and the reconcile both depend on a request finishing

**Date:** 2026-10-18
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Confidence gate:** >= 95 before any commit
**Status:** PARTIAL — option 1 chosen 2026-10-18 (owner delegated: "go with Claude's best recommendations"); options 2 and 3 and TASK 0's CFL half held, reasons under "Decision".
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
3. **TASK 0, CFL half (why CFL calls strand): held.** It only informs option
   2.
4. **Option 2: held.** It closes the vendor-side over-record, which raises
   effective spend toward the real ceiling. That is the capacity change the
   2026-10-18 ruling defers to a later CC-CMD.
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
   - option 2: never-reconciled CFL calls fall to near 0;
   - option 3: CFL charges fall by the measured page-load share.

## FORBIDDEN

- No credits.
- No change to counter arithmetic, and no change to routing, without the
  owner's choice above.
- Do not widen `daily-exceeds-monthly` or any watch to make a gap disappear.
