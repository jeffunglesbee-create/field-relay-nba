# Odds watches — daily read, 2026-10-17

Read from 18:37Z from each watch's committed artifact and the Actions API (GET
only), by seven read-only readers and an adversarial verifier on every red or
flagged watch. No credits spent, nothing dispatched, workers.dev not reached.
HEAD at read `22e011c9`.

| watch | newest run | today | artifact |
|---|---|---|---|
| odds-daily-vs-vendor | 39001998846, 04:17Z, **failure** | **RED, not the breach**: `we-overcharge-ourselves` for 2026-10-16. Vendor billed 2313, counter 2868, known CI 120, residual `-675` (tolerance 116), `unreconciled estimate : 0`. Second step `daily-exceeds-monthly`, EXCESS 940 (1.03x) | `odds-daily-vs-vendor-2026-10-17T0417.log`, `odds-daily-vs-monthly-20261017T041731Z.log` |
| odds-attribution-gap | 39034699665, 12:59Z, success | `ok`. 2026-10-16 `used 2868`, `by_site_sum 2868`, `unaccounted 0` (within 143) | `odds-attribution-gap-20261017T125919Z.log` |
| odds-site-drift | 39054336648, 17:34Z, success | `inconclusive over 3 interval(s) of 4 same-day sample(s)`, gap 0 at every sample, store `d1`. 2026-10-17 `used 1314` at 17:34Z, no veto | `odds-site-drift-2026-10-17T1734.log` |
| odds-pairing-rate | 39038944389, 14:00Z, success | PASS. `UNEXPLAINED : -666` (tolerance 126). Known CI 180 is a lower bound. Degrade `none — 0`; D1 closed day 2026-10-16: 0 overloads. 14 rows, 0 spent-and-paired-zero | `odds-pairing-rate-20261017T140104Z.log` |
| silently-dead-crons | 39045206350, 15:28Z, success | green. `NEW, not in the baseline : 0`, carried 3, overdue 0 — and all 3 due today; see below | `silently-dead-crons-2026-10-17T15-31-06-240Z.log` |
| undeployed-src | 39054048955, 17:30Z, success | `deployed`, last green `62b0dce`, 0 unbuilt. 6 runs in 24 h against an hourly cron, 0 red | `undeployed-src-2026-10-17T1730.log` |
| /budget/odds | (no direct read) | 2026-10-14 closed 1612/3800, 10-15 720, 10-16 2868. 2026-10-17 at 1314 by 17:34Z, `ceiling_reached_at` null | via the logs above |

## Watch 1

**Not the breach.** Both the breach (`scripts/watch-odds-daily-vs-vendor.mjs:343`,
after `the ceiling has been guarding a number below the truth`) and the
overcharge (`:349`, after `A different defect, and it must not be read as the other one`)
exit through `die(1)`, so a red run cannot tell them
apart and only the log's words can. Today's log: `our counter recorded 675 MORE
than the vendor billed. That is not a breach — it is headroom thrown away`. A
residual this size is not new this month: `-616` (10-12) and `-561` (10-13).

**Yesterday's test, answered.** The 10-16 read said the next vendor row tests
whether the 564 that `handleCFLOddsProbs` counted above its kept credits was
billed. Over 10-16T04:24:18Z → 10-17T04:17:28Z (`odds-daily-vs-vendor-series.json`)
`ledger_month_used` moved 27,792 → 30,651 (+2,859) and `vendor_month_used`
17,751 → 20,064 (+2,313). 2,313 − 2,859 − 120 = **−666**: our ledger counted
666 that the vendor did not bill. That fits the CFL over-recording going
unbilled. It does not name a cause, and that arithmetic is mine on the series
rows, not the watch's verdict. The 10-16 close shows `handleCFLOddsProbs` at
798 by site (against 90 on 10-15).

**Done condition (`docs/CC-CMD-2026-09-19-daily-vs-vendor.md`).** 26 closed days
now carry a verdict across 31 committed logs: 24 `we-overcharge-ourselves`, 2
`tracks-the-bill` (10-01, 10-06), 0 `counter-under-counts`. The spec names two
outcomes ("all three within tolerance", "a consistent positive residual") and a
third ("an inconclusive mixture"). This series is none of the three: it is a
consistent negative residual. That still needs the owner's ruling, as on 10-16.

`daily-exceeds-monthly` has been red on every run, with EXCESS 877, 931, 940.
Its own log says it does not say which counter is wrong.

## The three dead-cron entries due today, read and acted on

All three carried `review_by 2026-10-17`, so tomorrow's run would have failed
them by name. Each named read was done:

- **`jubilant-bassoon/soccer-fbref-mls.yml` (`never_fired`): a defect in the
  watch, fixed.** The schedule is commented out ("DEPRECATED 2026-06-23: FBref
  lost Opta licence") and the YAML parses to `workflow_dispatch` only.
  `cronFromSource` matched its regex against raw text, comments included.
  `soccer-fbref-wc.yml` has the same shape; those two are the only such files
  across 99 cron-matching workflows in four repos. `c6c22565` drops commented
  lines before matching. The new self-test case failed before the fix, and new
  mutation D18 is caught (17 of 17). The baseline entry is removed in the same
  commit.
- **`jubilant-bassoon/nba-clutch-update.yml` (`dead`): two causes, both read.** It
  stopped firing because its cron is `'0 6 */3 6,7 *'`, June and July only. It
  failed all 18 runs at "Commit outbox fallback", git exit 128. The script
  writes `outbox/nba/` only after a successful stats.nba.com fetch, it swallows
  a fetch error with exit 0, and `outbox/nba/` has never been tracked. That the
  fetch failed every time is an inference: the job logs are served from a host
  this sandbox does not reach. Re-dated to 2027-05-15, before its next window
  (`5d51d81a`).
- **`field-laboratory/verify-full.yml` (`dead`): one recurring structural row.**
  All five scheduled runs since 09-14 failed at the confidence gate. The
  mutation row failed on all five, and "this session wrote its outbox" on 09-14,
  09-28 and 10-12. That row needs an outbox entry dated the Eastern day, and
  those runs started 07:47–10:25 ET. The mutation row's baseline re-runs it:
  the committed 10-12 baseline names it as its one failing expectation. Filed
  as field-laboratory `docs/CC-CMD-2026-10-17-verify-full-scheduled-outbox-row.md`
  (`1841798`), an owner decision. Dispatched runs pass 530/530. Monday's run is
  expected red for that reason, so the entry is re-dated to 10-27 (`92287ba6`).

**Correction, same day.** `5d51d81a`'s first reason for verify-full named three
scheduled runs and said each failure was "since fixed". A verifier found five
runs (09-21 and 09-28 were missing) and a row that recurs by construction.
`92287ba6` replaces that reason.

**Prediction for tomorrow's run, so it can be checked:** jubilant-bassoon `NEVER
FIRED : 0`, `carried, already admitted : 2`, `NEW : 0`, `reviews overdue : 0`.

## Yesterday's reds, today

- `odds-daily-vs-vendor`: still red. It has failed every run since the last
  success, run 37578274621 on 2026-10-07.
- `silently-dead-crons`: green on 10-15, 10-16 and 10-17.

## Open threads against today's evidence

| thread | state | today's evidence |
|---|---|---|
| per-consumer demand (CC-CMD-2026-09-16 Task 2) | **unblocked**, not built | `unaccounted 0` on every closed day from 2026-09-22 to 2026-10-16, 25 days. Needs no credits |
| per-consumer ceiling (Task 3) | blocked | Blocked on Task 2 |
| ~19,700 offset | blocked | Ledger − vendor is now +10,587 (30,651 vs 20,064, series row 10-17T04:17Z) and +10,407 (30,975 vs 20,568, pairing log 14:01Z). It was +10,041 on 10-16 |
| soccer pairing at 0 | blocked | Unchanged: the pairing watch counts by date, not by sport, and the unblock spends credits |
| CFB done condition | blocked | Unchanged, same blind spot. 2026-10-17 is a CFB Saturday; its row arrives once the day closes |

## Corrections to inputs

- The pairing tolerance today is **126** = max(50, 5% of 2,529 billed). The
  routine's "Tolerance 120" matches the self-test fixture, not a live value.
- The routine's watch-3 text still names `CC-CMD-2026-09-18-atomic-odds-counter.md`
  as the fix whose priority waits on watch 1. site-drift's store has read `d1`
  (`batch() is one transaction`) in every log since 2026-09-20T01:53Z
  (2026-09-19T22:32Z read `kv + d1`), and today's four samples have gap 0 in
  every one. The 2026-09-18 `gap-grows-while-spending` verdict predates that
  store.

## Waiting on the owner

- Any spend. Nothing in this read recommends spending.
- `rotate-relay-secret.yml` with `confirm=ROTATE`: still 0 runs. The secret is
  readable in all three repos' public histories, and in the relay's current
  tree 33 times across 19 prose files.
- A ruling on CC-CMD-2026-09-19's consistently negative outcome.
- field-laboratory `CC-CMD-2026-10-17-verify-full-scheduled-outbox-row.md`.
- Two decisions filed 2026-10-14 are still `OPEN — owner decision`:
  `/archive/game` auth and the push cron's live-game loop.

## Coverage

- 7 watches, the newest run of each plus the two before it, read from the
  Actions API and the logs those runs committed.
- odds-site-drift: all 4 of today's logs read. 4 runs against the 6 three-hourly
  slots due by 17:34Z.
- undeployed-src: 6 runs in the last 24 h, all read, against an hourly cron.
- odds-daily-vs-vendor: all 31 committed logs read for the done-condition count.
- /budget/odds: read only through the logs above, never directly.
- The dead-cron cron-parsing check covered every workflow file in all four repos:
  99 that match the watch's regex, 97 with a parsed schedule.
- Not covered: per-sport pairing, the running worker's build stamp, job logs
  (served from a host this sandbox does not reach), and anything after 19:05Z.
