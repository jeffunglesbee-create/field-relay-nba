# Odds watches — daily read, 2026-10-20

The read began at 18:36Z. It took each of the six watch workflows' newest run
and the log that run committed, plus /budget/odds through those logs only.
Everything was read through the Actions API (GET only) and the committed
`outbox/` logs. No credits were spent, nothing was dispatched, and workers.dev
was not reached. HEAD at the start of the read was `383b19a0`.

| watch | newest run | today | artifact |
|---|---|---|---|
| odds-daily-vs-vendor | 39370910084, 04:41Z, **failure** | **`tracks-the-bill` for 2026-10-19.** Counter 1569/3800, vendor billed 1770, known CI 180, residual `21` (tolerance 89), unreconciled 0. The `Watch` step passed. Only `Our daily counter against our monthly counter` failed: `daily-exceeds-monthly`, EXCESS 2433 (1.07x) | `odds-daily-vs-vendor-2026-10-20T0441.log`, `odds-daily-vs-monthly-20261020T044142Z.log` |
| odds-attribution-gap | 39438179901, 14:19Z, success | `ok`. 2026-10-19 by site: ambientCaptureClosingOdds 1149, fetchSportOddsLive 204, fetchSportOddsHistorical 180, handleCFLOddsProbs 36, unattributed 0. Sum 1569 = counter 1569, `\|0\| within 78` | `odds-attribution-gap-20261020T141940Z.log` |
| odds-site-drift | 39434497446, 13:54Z, success | `inconclusive over 2 interval(s) of 3 same-day sample(s)`, gap 0 in both intervals (02:17→07:58, 07:58→13:54Z) | `odds-site-drift-2026-10-20T1354.log` |
| odds-pairing-rate | 39449262847, 15:31Z, success | PASS. `UNEXPLAINED 0` (tolerance 65). Over 22.2 h: provider 1304, ledger 1164, escaped 140 = known CI 140. Degrade: none, 0 credits. D1 overloads on 10-19: 0. 14 rows, 0 spent-and-paired-zero | `odds-pairing-rate-20261020T153200Z.log` |
| silently-dead-crons | 39461967702, 16:57Z, success | green. `NEW, not in the baseline : 0`, `carried, already admitted : 1` (jubilant-bassoon `nba-clutch-update.yml`), `baseline entries resolved : 1` (field-laboratory `verify-full.yml`), overdue 0. 4 repos, 440 workflows, 100 judged | `silently-dead-crons-2026-10-20T17-00-48-377Z.log` |
| undeployed-src | 39433676432, 13:48Z, success | `deployed`, last green `8cf7f81` at 02:05:25Z, 0 unbuilt. 3 runs today, 0 red. No deploy-trigger commit since (`git log --since=02:00Z -- src wrangler.toml workers`: only `6c8f4e7f` and `95a94ec8`, both inside that deploy) | `undeployed-src-2026-10-20T1349.log` |
| /budget/odds | (no direct read) | 2026-10-19 closed 1569/3800. Today 297/3800 at 15:32Z. Month to date: provider 26,223, ledger 37,624 | via the logs above |

## Watch 1

**The first `tracks-the-bill` since the chargeOdds one-batch deploy.** The
deploy (`7ec2d03f`, run 39183315552) went live at 01:04Z on 10-19, so this
closed day had about one hour before the fix. The window was 24.2 h, inside
22-26.
- 1770 − 1569 − 180 = 21; tolerance = max(50, round(0.05 × 1770)) = 89.

**One premise checked before publishing (Rule 100).** The day's 180 of known
CI matches the counter's own `fetchSportOddsHistorical 180`. If they were the
same credits, they would be subtracted twice: the true residual would be 201
and the day would read `counter-under-counts`, the breach. Checking the source
refuted it. `.github/scripts/odds-backfill.js` calls
`api.the-odds-api.com/v4/historical/...` directly (lines 190-197), not through
the relay, so its credits never reach the counter. The equal figures are two
different sets of calls, both priced at 20 credits each.

The tally now covers 34 logs. Of the 29 closed days that carry a verdict:
- 26 `we-overcharge-ourselves`;
- 3 `tracks-the-bill` (10-01, 10-06, 10-19);
- 0 `counter-under-counts`.

The remaining logs are refusals: 2 `window-drift`, 1 `month-boundary`,
1 `no-data`, and 1 with no verdict line.

**`daily-exceeds-monthly`** went 940 → 1929 → 2454 → 2433 over the reads of
10-17 to 10-20. For the first time it did not grow. The 10-19 row is
daily 1569 against a monthly move of 1590, which is −21. The log itself says
"A row is not a verdict: the two windows differ by the read hour". 10-19 was
also not a CFL-active day. So this is not the done condition of
`CC-CMD-2026-10-18-odds-charge-survives-cancellation`, which needs a CFL-active
day: the 2026-10-25T06:30Z read, after the 10-23 and 10-24 games. The failed
step is that cumulative sum, and every day that grew it predates the fix.

## The other watches

- **attribution-gap:** the closed day decomposes exactly. Every credit has a
  site.
- **site-drift:** gap 0 at every sample today. As yesterday, this does not show
  that chargeOdds fixed anything. The watch compares samples within one day,
  and it saw no drift before the fix either.
- **pairing-rate:** what escaped the ledger equals the known CI exactly
  (140 = 140), and no D1 overload or degrade occurred.
- **silently-dead-crons:** the resolved entry is already held. Its
  baseline row (`docs/dead-cron-baseline.json`, review_by 2026-10-27) names
  field-laboratory `docs/CC-CMD-2026-10-26-read-scheduled-verify-full.md` as
  what resolves or re-dates it, from the 10-26 scheduled run. It is not
  removed here, because that would pre-empt the CC-CMD.
- **undeployed-src:** no named commit, so no
  ROUTE_PROVENANCE_GENERATED_AT diff applies, and no deploy was dispatched.

## Open threads

None is unblocked today. The next gate is the 2026-10-25T06:30Z CFL-day read
(see Watch 1). The targeted fill still needs the owner's approval to spend. No
credits were spent.

## The stored prompt for this read is still stale

`get_trigger` shows the prompt was last updated 2026-09-19. These numbers are
still the ones yesterday's read named, and two more are now out of date:
- pairing tolerance "120": the watch computes it daily. Today it is 65.
- "four consecutive days have now closed at 3799-3800": the last three closes
  were 3320, 3442 and 1569.
- watch 3's "The fix is docs/CC-CMD-2026-09-18-atomic-odds-counter.md": that
  document's gate was satisfied 2026-09-19, and the one-batch charge landed on
  10-19.

The prompt itself says to read today's runs rather than its numbers. That is
what this read did. Correcting the prompt is the owner's call, so it was not
edited here.

## Coverage

Seven watches, one newest run each, plus each run's committed log. Today's run
counts were read: site-drift 3, undeployed-src 3, and the other four 1 each.
Of those runs, only the vendor watch's was red, on the cumulative step named
above. /budget/odds was read only through the logs above, never directly.
