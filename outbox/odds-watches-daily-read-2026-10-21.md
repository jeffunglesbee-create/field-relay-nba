# Odds watches — daily read, 2026-10-21

The read began at 18:33Z, with HEAD at `2bc2b12c`. Six readers each took one
watch workflow's newest run and the log that run committed. A seventh read the
open threads. Each was read through the Actions API (GET only). Three checkers
then tried to refute the results: two on watch 1, re-deriving it from the
series and the script's own predicates, and one on the threads. Both watch-1
checkers upheld it. The thread checker did not: it refuted "no thread is
unblocked", and the correction is below. No credits were spent and nothing was
dispatched. workers.dev was reached once on purpose, and once by accident (see
Coverage).

| watch | newest run | today | artifact |
|---|---|---|---|
| odds-daily-vs-vendor | 39544991469, 04:36Z, **failure** | **RED, not the breach.** `we-overcharge-ourselves` for 2026-10-20: counter 818/3800, vendor billed 872, known CI 140, residual `-86` (tolerance 50), unreconciled 0. Both steps failed. The second is `daily-exceeds-monthly`, EXCESS 2334 (1.06x) | `odds-daily-vs-vendor-2026-10-21T0436.log`, `odds-daily-vs-monthly-20261021T043656Z.log` |
| odds-attribution-gap | 39617337724, 14:30Z, success | `ok`. 2026-10-20 used 818, by_site_sum 818, unaccounted 0 (within 41). By site: handleCFLOddsProbs 336, fetchSportOddsLive 264, fetchSportOddsHistorical 210, getWCPregameLambdas 8, all others 0 | `odds-attribution-gap-20261021T143018Z.log` |
| odds-site-drift | 39614598851, 14:11Z, success | `inconclusive over 2 interval(s) of 3 same-day sample(s)`. Gap 0 at all three samples (used 183, 267, 378) and at all five 10-20 samples | `odds-site-drift-2026-10-21T1411.log` |
| odds-pairing-rate | 39628945690, 15:48Z, success | PASS. `UNEXPLAINED -185` (tolerance 50; one-sided, and negative is the reconcile direction). Over 24.3 h: provider 794, ledger 899, known CI 80. Guard fell open: 3 credits, from the 10-20 close. D1 overloads on 10-20: 0. 14 rows, 0 spent-and-paired-zero | `odds-pairing-rate-20261021T154809Z.log` |
| silently-dead-crons | 39640858338, 17:06Z, success | green. NEW 0, carried 1 (jubilant-bassoon `nba-clutch-update.yml`), resolved 1 (field-laboratory `verify-full.yml`), overdue 0. 4 repos, 440 workflows, 100 judged. The diff against 10-20 is timing lines only | `silently-dead-crons-2026-10-21T17-09-40-642Z.log` |
| undeployed-src | 39613674939, 14:05Z, success | `deployed`, last green `8cf7f81` (2026-10-20T02:05:25Z), 0 unbuilt. 3 runs today, 0 red. `git log 8cf7f818..HEAD -- src wrangler.toml workers` is empty | `undeployed-src-2026-10-21T1405.log` |
| /budget/odds | read once (Coverage) | 2026-10-20 closed 818/3800. Today 378/3800 at 15:48Z. Monthly counter 38,711 and provider 27,143 at 18:52Z | relay self-probe |

## Watch 1

**Not the breach.** Both checkers re-derived the verdict and upheld it:
- **The window:** 23.9 h, inside 22-26.
- **vendorDay:** 26820 − 25948 = 872.
- **Residual:** 872 − 818 − 140 = −86.
- **Tolerance:** max(50, round(0.05 × 872) = 44) = 50.

One checker ran the script's three functions, extracted verbatim, on the series
rows. The output was `{"state":"we-overcharge-ourselves","residual":-86,"tol":50}`.

**The premises attacked, and how each stands:**
- **CI subtracted twice: refuted.** `.github/scripts/odds-backfill.js` calls
  `api.the-odds-api.com` directly. It never calls a relay odds route.
- **Is 818 final? Yes.** It read 818 at 04:36Z and at 14:30Z on 10-21.
- **Other direct-vendor callers in the window: none.** One checker read all 98
  runs between 10-19T23:00Z and 10-21T05:00Z. An unseen one would push the
  residual further negative, never positive.
- **The verdict's margin is 36 credits.** It flips to `tracks-the-bill` only if
  real CI spend was 104 or less. The 140 is the backfill's own estimate of
  7 calls × 20, not a vendor receipt. The pairing log corroborates it: in the
  window holding that run, the vendor billed exactly 140 more than the ledger.
- **The window is offset.** It runs from 04:41Z to 04:36Z, not over the UTC
  day. Aligned to the window, the residual is −185 by the ledger's own 917, or
  between −263 and −95 by the site-drift brackets. That is more negative, not
  less. This defect is already filed as `docs/CC-CMD-2026-10-13-vendor-residual-window.md`
  (OPEN).

**Where the over-record sits.** These figures are derived from the closed day's
reconcile tally (`/budget/odds?date=2026-10-20`): each site's by_site minus its
credits_kept.

| site | by_site | credits_kept | difference |
|---|---|---|---|
| handleCFLOddsProbs | 336 | 144 | 192 |
| getWCPregameLambdas | 8 | 0 | 8 |
| fetchSportOddsLive | 264 | 267 | −3 |
| fetchSportOddsHistorical | 210 | 210 | 0 |
| **total** | 818 | 621 | 197 |

- Most of the gap opened between 13:54Z and 18:47Z. The site-drift samples read
  credits_kept 279 of used 279 at 13:54Z, 456 of 650 at 18:47Z, and 603 of 803
  at 23:30Z. By the close the cache-HIT reconciles numbered 241 for CFL and 86
  for WC, and those keep 0 credits.
- The log's named sub-cause, no-header estimates, is 0, so it does not carry the
  over-record.
- This is the CFL never-reconciled anomaly already named twice:
  - P5 of `CC-CMD-2026-10-13-vendor-residual-window`;
  - the CFL half of `CC-CMD-2026-10-18-odds-charge-survives-cancellation`.
  Both are held, with their reasons recorded.
- `CC-CMD-2026-09-19-daily-vs-vendor`:172 still says "Do not fix the
  over-record yet", and a negative residual is its fourth outcome, already ruled.

**The tally**, across 35 logs. Of the 30 closed days that carry a verdict:
- 27 `we-overcharge-ourselves`;
- 3 `tracks-the-bill` (10-01, 10-06, 10-19);
- 0 `counter-under-counts`.

The two days since the one-batch charge deploy (`7ec2d03f`, live 10-19 01:04Z)
read +21 and −86.

**`daily-exceeds-monthly`** went 2454 → 2433 → 2334 over the reads of 10-19 to
10-21. It fell for the second day running, and the 10-20 row is 818 against a
monthly move of 917 (−99). The log itself says a row is not a verdict. 10-20 was
not a CFL game day. The done condition is still the 2026-10-25T06:30Z read.

## The other watches

- **attribution-gap:** the closed day decomposes exactly.
  `ambientCaptureClosingOdds` fell from 1149 to 0. It also read 0 on 10-01,
  10-02, 10-07 and 10-08. This watch cannot tell whether no closing captures
  were due or whether the path failed; it shows only that the spend decomposes.
- **site-drift:** gap 0 at every sample on both days. As before, this does not
  show the fix worked; the watch saw no drift before the fix either.
- **pairing-rate:** PASS. **One defect in its output:** it prints
  `what threw : NOT RECORDED — this reading predates the reason histogram`, and
  that is false.
  - The 3 credits are the 10-20 close's, while line 776 reads the running day's
    map.
  - The cause, read from the relay: `charge: D1_ERROR: Network connection lost.`,
    1 event, 3 credits, at 2026-10-20T23:30:32Z.
  - A fetchSportOddsLive call costs 3 credits, and that site kept 3 more than it
    was charged. That fits one Live call whose charge failed while its receipt
    was kept, but it is derived, not read.
  - Filed: `docs/CC-CMD-2026-10-21-pairing-watch-names-closed-day-degrade-cause.md`.
- **silently-dead-crons:** the resolved entry stays held. Its baseline row
  names field-laboratory `docs/CC-CMD-2026-10-26-read-scheduled-verify-full.md`,
  review_by 2026-10-27.
- **undeployed-src:**
  - No named commit, so no deploy was dispatched.
  - `ROUTE_PROVENANCE_GENERATED_AT` is unchanged since `2142bad6` (10-14).
  - Today's census commit `11d7119f` carries the skip directive but touched only
    `outbox/`.

## Open threads

| thread | state | today's evidence |
|---|---|---|
| per-consumer demand (CC-CMD-2026-09-16 Task 2) | **unblocked**, not built, not dispatched | The prerequisite still holds: `unaccounted 0` for 10-20. It needs no credits, and the CC-CMD still reads "Status: SPEC" |
| per-consumer ceiling (Task 3) | blocked | On Task 2 |
| ~19,700 offset | level only | Ledger − vendor = 38,523 − 27,017 = 11,506 (pairing log). Not merged with watch 1 |
| soccer pairing at 0 | blocked | The unblock needs a fixture that spends credits |
| odds charge survives cancellation | blocked | Until the 2026-10-25T06:30Z read, after CFL's 10-23 and 10-24 games |
| targeted fill | blocked | The owner's approval to spend. Its newest run is still the 2026-09-23 dry run |

**Correction to yesterday's read.** `odds-watches-daily-read-2026-10-20.md` said
"None is unblocked today". That dropped per-consumer demand without giving a
reason. The 10-16, 10-17, 10-18 and 10-19 reads all list it as "unblocked, not
built", and nothing has re-blocked it. A note now says so in that file.

Building it means dispatching a CC-CMD that was never dispatched. A scheduled
read does not do that. It is the owner's call.

## The stored prompt for this read is still stale

`get_trigger` showed it was last updated 2026-09-19. The three numbers that the
10-20 read listed are still stale: the pairing tolerance "120" (65 yesterday, 50
today), "four consecutive days … closed at 3799-3800" (the last three closed at
3442, 1569 and 818), and the atomic-counter CC-CMD named as the fix (its gate
was satisfied 09-19, and the one-batch charge landed 10-19). Editing the prompt
is the owner's call.

## Not acted on

- `handleCFLOddsProbs`'s header comment says 2 credits per call.
  `oddsCreditCost` and the receipts both give 6. The comment is stale and the
  charging is unaffected. Rule 69: recorded here and not edited.

## Coverage

- **What was read:** six watch workflows, one newest run each, the log each run
  committed, and today's run counts: site-drift 3, undeployed-src 3, the others
  1 each. Only the vendor watch's run was red.
- **Job logs were not read.** `gh api …/jobs/{id}/logs` is refused by a blob
  redirect, so the backfill run's own `credits=` line was not seen.
- **workers.dev, on purpose:** one `GET /budget/odds?date=2026-10-20` through the
  relay self-probe, to name the degrade cause. That route's vendor call is
  `/v4/sports`, which costs 0 credits.
- **workers.dev, by accident:** one checker imported
  `scripts/watch-odds-daily-vs-vendor.mjs` to evaluate its functions. Its
  top-level code tried the same `GET /budget/odds?date=2026-10-20`. The request
  errored in undici, so it is unknown whether it reached the relay. No file was
  written, and that checker then used verbatim extracted copies.
