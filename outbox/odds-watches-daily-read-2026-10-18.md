# Odds watches — daily read, 2026-10-18

Read from 18:34Z from each watch's committed artifact and the Actions API (GET
only), by seven read-only readers and an adversarial verifier on the one watch
not green. No credits spent, nothing dispatched, workers.dev not reached. HEAD
at read `147f375e` (`f521e6d5` landed at 18:37Z: HANDOFF, the CFL CC-CMD's
status and a governance CC-CMD, no watch input).

| watch | newest run | today | artifact |
|---|---|---|---|
| odds-daily-vs-vendor | 39096869946, 04:22Z, **failure** | **RED, not the breach**: `we-overcharge-ourselves` for 2026-10-17. Counter 3320/3800, vendor billed 1545, known CI 180, residual `-1955` (tolerance 77), `unreconciled estimate : 0`. Second step `daily-exceeds-monthly`, EXCESS 1929 (1.06x) | `odds-daily-vs-vendor-2026-10-18T0422.log`, `odds-daily-vs-monthly-20261018T042244Z.log` |
| odds-attribution-gap | 39131047736, 13:19Z, success | `ok`. 2026-10-17 `used 3320`, `by_site_sum 3320`, `unaccounted 0` (within 166) | `odds-attribution-gap-20261018T131944Z.log` |
| odds-site-drift | 39150409956, 17:37Z, success | `inconclusive over 3 interval(s) of 4 same-day sample(s)`, gap 0 at every sample, store `d1`, no veto. 2026-10-18 `used 2005` at 17:37Z | `odds-site-drift-2026-10-18T1737.log` |
| odds-pairing-rate | 39135071944, 14:14Z, success | PASS. `UNEXPLAINED : -1062` (tolerance 85, one-sided). Known CI 220 is a lower bound. Degrade `none — 0`; D1 closed day 2026-10-17: 0 overloads. 14 rows, 0 spent-and-paired-zero | `odds-pairing-rate-20261018T141415Z.log` |
| silently-dead-crons | 39142135435, 15:48Z, success | green. `NEW, not in the baseline : 0`, `carried, already admitted : 2`, overdue 0; no review due before 10-27 | `silently-dead-crons-2026-10-18T15-51-37-775Z.log` |
| undeployed-src | 39143492853, 16:06Z, success | `deployed`, last green `62b0dce`, 0 unbuilt. 6 runs in 24 h against an hourly cron, 0 red | `undeployed-src-2026-10-18T1606.log` |
| /budget/odds | (no direct read) | 2026-10-17 closed 3320/3800 (87%), led by `handleCFLOddsProbs` 2058. 2026-10-18 at 2005 by 17:37Z (1314 at the same hour yesterday). `ceiling_reached_at` null | via the logs above |

## Watch 1

**Not the breach, and inside the owner's fourth outcome.** The log's words are
the overcharge's: `our counter recorded 1955 MORE than the vendor billed. That
is not a breach`. HANDOFF (2026-10-18) records the ruling that gave
`CC-CMD-2026-09-19-daily-vs-vendor` a fourth outcome, a consistent negative
residual, and calls its done condition met. Today fits it: 27 closed days now
carry a verdict across 32 logs, 25 `we-overcharge-ourselves`, 2
`tracks-the-bill` (10-01, 10-06), 0 `counter-under-counts`. Fixing the
over-record is not authorised by that ruling, and nothing here asks for it.

**What moved, measured two ways.** The watch's residual went from `-675` to
`-1955`. The largest this month are 10-07 (`-3544`) and 10-10 (`-1967`). But
`docs/CC-CMD-2026-10-13-vendor-residual-window.md` (OPEN) measured that most of
that figure on 10-12 was the watch's own window offset: it subtracts a UTC-day
counter from a vendor delta taken between two ~04:20Z readings. On the
window-aligned measure from the series rows (10-17T04:17Z to 10-18T04:22Z,
24.09 h): ledger +2331, vendor +1545, so 1545 − 2331 − 180 = **−966**, against
−666 the day before. The ledger ran 786 above the bill, and 966 is net of the
180 CI only because backfill is outside the ledger. That arithmetic is mine on
the series rows, not the watch's verdict.

**Our two D1 counters disagree, by an amount the rows cannot pin down.** The
10-17 row of the daily-vs-monthly log reads excess 989, and that log says of its
own rows "A row is not a verdict: the two windows differ by the read hour".
Bounding the daily counter at the two read instants from the site-drift series
(102 to 681 at 10-17T04:17Z, 78 to 254 at 10-18T04:22Z) puts the window-aligned
internal gap between **386 and 1141**. A real disagreement inside our own
database exists on this window; 989 is not its measurement. The cumulative
EXCESS 1929 over 16 days is window-free and is the number to cite.
`CC-CMD-2026-10-18-odds-counter-internal-then-calendar` (FILED, not dispatched)
is the document for that question, and it is left to it.

**Why the run is red, completely.** Two steps fail on their own. `Watch` exits
on the overcharge verdict, and `Our daily counter against our monthly counter`
fails whenever daily exceeds monthly. That second step failed in 11 of the 12
runs since the last success (run 37578274621, 2026-10-07), and run 38186966492
(10-12, dispatched) went red with `Watch` green. So this workflow stays red even
on a `tracks-the-bill` day while the internal excess holds.

## Corrections to inputs

- **Yesterday's read, my own line:** "`daily-exceeds-monthly` has been red on
  every run, with EXCESS 877, 931, 940". True of the three runs that read
  covered, not of the workflow: the 10-04 to 10-07 and 10-11 monthly logs read
  `verdict: consistent`, and 10-01 to 10-03 read `month-boundary`. The same
  words, carried into `CC-CMD-2026-10-18-odds-counter-internal-then-calendar.md`,
  overstate there too.
- **Yesterday's prediction, scope:** "jubilant-bassoon `carried, already
  admitted : 2`". All four numbers held, but that line is the ratchet for all
  four repos; jubilant-bassoon's share is 1 (`nba-clutch-update.yml`), and
  field-laboratory's `verify-full.yml` is the other.
- **The ruling's size figures are a day old:** `+10,587` and `-675` in
  `CC-CMD-2026-09-19-daily-vs-vendor.md` are now `+11,373` ledger − vendor
  (series row 10-18T04:22Z) and `-1955`.
- **The routine's watch-3 text** still names
  `CC-CMD-2026-09-18-atomic-odds-counter.md` as a pending fix. It landed
  (`5edb19ad`, 2026-09-19) and HANDOFF records it CLOSED; 126 of 138 drift logs
  read `store : d1`, and every log since 09-22 reads gap 0.
  `docs/declared-detectors.json` still names it as `tracked_by` for
  odds-attribution-gap.
- **The pairing tolerance today is 85** = max(50, 5% of 1,693 billed), not 120.
- **The dead-cron log's detector line for odds-daily-vs-vendor** quotes
  2026-09-21 figures (residual -3295, excess 2562). That is static text from
  `docs/declared-detectors.json`, not a reading.

## The other watches

- **attribution-gap:** 26 consecutive closed days at `unaccounted 0`
  (2026-09-22 to 10-17). `handleCFLOddsProbs` is 2058 of 3320 (62%); the 10-16
  close was led by `ambientCaptureClosingOdds` (1482, now 252). This watch only
  shows the day decomposes across sites; it says nothing about whether a site's
  count was billed.
- **site-drift:** 4 runs against the 7 three-hourly slots due by 18:34Z. One
  new `error` cell at 17:37Z, `getWCPregameLambdas  error  HIT  2  8`; the only
  other in 138 logs is 2026-10-14T21:01Z. It passes through the route's tally
  and does not touch the verdict.
- **pairing-rate:** UNEXPLAINED moved from -666 to -1062, 12 times the
  tolerance, in the reconcile direction the script calls "not a fault". Of the
  odds-related workflows that ran in the interval, unsubtracted CI could only
  push it further negative, so the lower bound cannot hide a positive breach.
- **silently-dead-crons:** soccer-fbref-mls is gone from never-fired, as
  `c6c22565` intended. field-laboratory's `verify-full.yml` scheduled run on
  Monday 10-19 is expected red and is admitted until 10-27.
- **undeployed-src:** 0 of the 85 commits since `62b0dce` touch a deploy path.
  **Prediction, so it can be checked:** the CFL writer fix
  (`CC-CMD-2026-10-16-cfl-archive-date-keying` TASKs 1 and 2) is held off
  origin until 2026-10-19T00:00Z by order and will be pushed shortly after.
  The first undeployed-src run after that should show a new last-green sha, not
  `undeployed`.

## Open threads against today's evidence

| thread | state | today's evidence |
|---|---|---|
| per-consumer demand (CC-CMD-2026-09-16 Task 2) | **unblocked**, not built | `unaccounted 0` on 26 consecutive closed days. The CC-CMD still reads "Status: SPEC" |
| per-consumer ceiling (Task 3) | blocked | On Task 2. Also: CFL closed 10-17 at 2058 by site against 144 credits kept by reconcile at 22:44Z (my arithmetic, attribution log and `odds-site-drift-2026-10-17T2244.log`), so the per-site counter is not per-site spend |
| ~19,700 offset | blocked | Ledger − vendor +11,373 (series 10-18T04:22Z) and +11,249 (pairing 14:14Z); it was +10,587 yesterday |
| soccer pairing at 0 | blocked | Unchanged: the pairing watch counts by date, not sport |
| CFB done condition | blocked | Unchanged, same blind spot |

## Waiting on the owner

- Any spend. Nothing here recommends spending.
- `rotate-relay-secret.yml` with `confirm=ROTATE`: still 0 runs. The
  `/archive/game` gate ruled today is blocked behind it.
- Dispatch of `CC-CMD-2026-10-18-odds-counter-internal-then-calendar`, if
  wanted; today's internal gap (386 to 1141 on the window) is its subject.
- field-laboratory `CC-CMD-2026-10-17-verify-full-scheduled-outbox-row.md`.

## Coverage

- 7 watches: the newest run of each, plus the runs in the last 24 h where the
  cron is sub-daily (site-drift 6, undeployed-src 6), from the Actions API and
  the logs those runs committed.
- odds-daily-vs-vendor: all 32 committed logs grepped for the verdict tally; the
  newest two monthly logs read in full; step conclusions for the 12 runs since
  the last success. Only the last 6 of 30 series rows printed.
- attribution-gap: all 32 committed logs, for the streak.
- site-drift: all 4 of today's logs in full; all 138 grepped for store, gap and
  verdict.
- /budget/odds: read only through the logs above, never directly.
- Not covered: per-sport pairing, the running worker's build stamp, job logs
  (served from a host this sandbox does not reach), the 18:00 site-drift slot,
  and anything after 18:43Z.
