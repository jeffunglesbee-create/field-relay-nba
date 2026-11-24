# Odds counter, TASK 2 — the CFL post-window, judged

`docs/CC-CMD-2026-10-18-odds-counter-internal-then-calendar.md`, TASK 2, step 3.
Judged 2026-11-24 by the scheduled run `trig_019aQvU36rYwZ7PqjaMnV5ut` (fired
14:00:30Z), against `outbox/odds-cfl-season-end-prediction-2026-10-18.md` exactly as
that document committed its tests, including every paragraph headed "Added". No
credits were spent and no odds route was called: the figures come from read-only
`SELECT`s on `field-archive` (`cc49101c`), the committed `odds-daily-vs-vendor`
logs on `origin/main`, `git log` in both repos, and the Actions API.

Committed beside this document, so each figure can be re-run:
`outbox/odds-cfl-judgment-score-2026-11-24.mjs` (the scorer, the rows it scores,
and a `--self-test`) with its output `outbox/odds-cfl-judgment-score-2026-11-24.log`,
and `outbox/cfl-reconcile-gap-2026-11-24.json` (the 2026-11-01 paragraph's named
contrast, `node scripts/analyze-cfl-reconcile-gap.mjs --out ...`, offline).

## The answer

| | result |
|---|---|
| VOID | **No.** No commit in 2026-11-08..11-23 changed any VOID-listed function or file, in either repo (checked at function level; the file-level counts are in the VOID section). |
| Judged days | **Pre 7 of 7, post 6 of 7** (2026-11-23 is `window-drift`, excluded). Not INCONCLUSIVE (the bar is fewer than 5 of 7). |
| H-whole | **Holds** (\|0\| ≤ 303). It also held of the pre-window (\|0\| ≤ 350), so there was nothing to contract. |
| H-none | **Holds**: the post sum is 0 and the band is the single point 0, because the pre-window sum is 0. Any nonzero post sum would have failed it. |
| Spec 2.3 | **Both committed labels apply**, "contracts" and "did not contract": the bar (half) and the ceiling (a quarter) are both 0, and the contraction is 0. It cannot discriminate. |
| M (a) | **FAILS.** CFL by site was 0 on all 6 judged days that the app used the route (predicted above 0 on every one). |
| M (b) | **Holds** (\|0 + 0\| = 0 ≤ 350). It cannot tell the fix working from the fix failing (see below). |
| M (c) | **FAILS.** The stranded share was 0% on every judged day (predicted 15% to 55%). |

Two predictions failed (M (a), M (c)) and three held (H-whole, H-none, M (b)). The three
that held did so on a post-window of exact zeros that the pre-window also read, so this
window does not separate H-whole from H-none, and M (b) and spec 2.3 cannot discriminate.
This is reported as plainly as a pass would be. The sentences the prediction document
required are attached to the tests it named:

- **H-whole:** *measured after an intervention that targets the stranded part these
  tests measure; the result is not evidence about CFL's contribution in either direction.*
- **Spec 2.3:** *measured after an intervention that targets the stranded part these
  tests measure; the result is not evidence about CFL's contribution in either direction.*
- **M (c):** *measured after an intervention that targets the stranded part these
  tests measure; the result is not evidence about CFL's contribution in either direction.*
  M (c) fails by construction when the fix works, which is what the 2026-11-01
  paragraph said, and it is not a failed mechanism and not an exoneration.
- **M (b):** as written it is satisfied by two near-zero sums as readily as by the
  reference weeks' cancelling sums, so it cannot tell the fix working from the fix
  failing. Its pass here says nothing either way.

**One limit on M (a), stated by this report and not committed by the prediction.** The
2026-11-01 paragraph attaches its sentence to H-whole, spec 2.3 and M (c), and M (a) is
scored as committed above. M (a) needs a standing net CFL charge on every judged day, which
is the quantity the fix removed (item 3 below: 0 on 22 of 22 days since 11-02). A window
after the fix therefore cannot say whether the no-fix premise ("charging continues at one
call per page load") held without it.

## VOID check

The rule (`## What voids the experiment`, with its "Added 2026-10-19" paragraph): any
commit between 2026-11-08 and 2026-11-23 that changes `handleCFLOddsProbs`;
`consumeOddsCredit`, `checkAndIncrementDailyOdds` or `chargeMonthlyOdds` (the last two no
longer exist; `chargeOdds` stands for them); `reconcileOddsCredit`; jubilant-bassoon's
`fetchCFLOddsProbs` or its call in `fetchSchedule`; or any option of
`docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md`.

**Two readings of "checks with `git log --since=2026-11-08` on those files", both run.**
The list names functions and a document, so the rule is read at function level:
`git log origin/main --since=2026-11-08T00:00:00Z --until=2026-11-24T00:00:00Z -L
"/function NAME\b/,/^}/:FILE"` (also run without `--until`: the same zeros). Read at file
level instead, `src/index.js` has **15** commits in the window and the client's
`src/legacy/field.js`, `index.html` and `sw.js` have **2** each, so a reader who runs the
file-level sentence sees commits and needs this paragraph. Those 15 (`414cff7 ade0dd8
d002716 9ef280d 72faa99 3919b47 38754bb 8bdac8e 966fe0c 4943d43 3cbe458 9701fdd 464d4f7
20eb710 140fa56`) were checked hunk by hunk against the listed functions' line ranges at
each commit's parent: 0 intersections, the nearest hunk 95 lines away. The two client
commits (`2d5b6df` the FA Cup past-date navigation, 2026-11-11; `b3e2c87` the golf round
`start_time`, 2026-11-18) have hunks near lines 13,862, 16,139 to 16,271 and 23,458 to
23,481, nowhere near the call (line 22,003) or the function (34,077). Both clones are
shallow (history from 2026-11-05: relay root `c8ba583`, client root `47aee55`), which is
enough depth: the window starts 3 days after each root. Where each function lives was read
from `origin/main`, not remembered:

| function | file : lines at `origin/main` | commits in the window |
|---|---|---|
| `handleCFLOddsProbs` (since `6589bc1` a wrapper: ctx guard, `waitUntil`, return) | `src/index.js:3752-3757` | 0 |
| `cflOddsProbsPipeline` (the body: charge, vendor fetch, reconcile, tally) | `src/index.js:3758-3840` | 0 |
| `consumeOddsCredit` | `src/index.js:7038` | 0 |
| `consumeOddsCredit` (second copy) | `src/wp-resolver.js:208` | 0 |
| `_consumeAmbientOddsCredit` (a third wrapper of `chargeOdds`, not named by the rule) | `src/ambient-do.js:1560` | 0 |
| `chargeOdds` | `src/budget-helpers.js:504` | 0 |
| `reconcileOddsCredit` and the body it delegates to, `_reconcileOddsCredit` | `src/budget-helpers.js:1522`, `:1544` | 0, 0 |
| `checkAndIncrementDailyOdds`, `chargeMonthlyOdds` | absent from `src/` at `c8ba583` and at `origin/main` except in comments (reproduced). The prediction document and the options document name `7ec2d03f` as the commit that replaced them on 2026-10-19; that commit is older than the shallow history and is taken from those documents. | n/a, outside the window |
| the options document | `docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md` | 0 |
| `fetchCFLOddsProbs` and its call in `fetchSchedule` (jubilant-bassoon) | `src/legacy/field.js`: `fetchSchedule` 21,992, call 22,003, `fetchCFLOddsProbs` 34,077. `index.html` (the served copy): 27,053, 27,064, 39,138 | 0 on each file, by function name, by line range (21,995-22,010 and 34,077-34,130) and by pickaxe `-S fetchCFLOddsProbs` over the whole repo |

`handleCFLOddsProbs` is a six-line wrapper, so a query on it alone could not see a change
to the body; the `cflOddsProbsPipeline` and `_reconcileOddsCredit` rows exist for that
reason. The function bodies at `origin/main` are byte-identical to their text at `c8ba583`
for every relay row above (compared by hash of the extracted text, a brace-matching
comparison and not a syntax-tree one). "No commit changed it since 2026-11-05" is the claim
the shallow history supports; changes the root commits themselves made are not visible.

**The queries were shown able to fail before the zeros were believed.** The control
`runOddsBackfillForDate` in `src/index.js`, same window, prints its four commits
(`38754bb`, `3919b47`, `ade0dd8`, `414cff7`). On the client, `fetchRelayDateSections`
prints `2d5b6df` and `saveGolfRoundFinal` prints `b3e2c87`, on both `field.js` and
`index.html`. `src/budget-helpers.js`, `src/wp-resolver.js` and `src/ambient-do.js` have
no commit in the window at file level, so no in-window control exists for them; for those,
the unwindowed `-L` is the evidence (it prints only the root commit, which shows the query
matches the function). A by-name `-L` on `fetchSchedule` prints nothing in the window and
only the root commit unwindowed, which is the right answer for a function with no commit in
the window.

**Whether the fix was live for the whole window** (reported beside the scores, not part of
VOID): Deploy RELAY Worker run `41330484626` (run 1087, commit `6589bc1`, push to `main`)
started 2026-11-01T17:14:52Z and concluded `success` at 17:27:07Z; its "Deploy to
Cloudflare Workers" step ran 17:25:16Z to 17:25:40Z. `handleCFLOddsProbs` at `origin/main`
still registers `cflOddsProbsPipeline` with `ctx.waitUntil`, and the function is unchanged
since `c8ba583`. The window's first day is 7 days after that deploy. Not checked: that no
rollback or older redeploy ran in between (neither git nor the run list shows it).

## The days

Each log is named for the UTC day it was written on; its `day=` header names the closed
day it judges. The tolerance is the log's own.

| closed day | log | verdict | residual | tolerance |
|---|---|---|---|---|
| 11-17 | `odds-daily-vs-vendor-2026-11-18T0716.log` | tracks-the-bill | 0 | 50 |
| 11-18 | `...-11-19T0715.log` | tracks-the-bill | 0 | 50 |
| 11-19 | `...-11-20T0703.log` | tracks-the-bill | 0 | 50 |
| 11-20 | `...-11-21T0657.log` | tracks-the-bill | 0 | 50 |
| 11-21 | `...-11-22T0637.log` | tracks-the-bill | 0 | 53 |
| 11-22 | `...-11-23T0725.log` | tracks-the-bill | 0 | 50 |
| 11-23 | `...-11-24T0945.log` | **window-drift** | not computed | not computed |

**11-23 is excluded, per the rule** ("a refused day ... is excluded, and the number
judged is reported"). The log reads `verdict: window-drift` and, in its own words, "No
comparison this run — the vendor counter did not run continuously across the window". The
two readings it holds are 2026-11-23T07:25:43Z and 2026-11-24T09:45:23Z, which is 26.33 h
apart (the watch's bound is 22 to 26 h, `scripts/watch-odds-daily-vs-vendor.mjs:144`). The
watch was not dispatched to produce another reading: that would split the window. D1's
`daily − receipts` and CFL by site are 0 on 11-23 too, so excluding it changes no result.

**11-16 is "reported, not judged" as committed; 11-15 sits in neither window** (the
recording of 2026-11-15 was taken before its kickoff). Both read `tracks-the-bill` with
residual 0 (`odds-daily-vs-vendor-2026-11-16T0617.log`, `...-11-17T0747.log`). Their CFL
rows, which are the nearest reading to the season's last game: 11-15 CFL by site 66, CFL
receipts 66, 34 calls (23 cache-hit, 11 reconciled); 11-16 CFL by site 18, CFL receipts 18,
36 calls (25 cache-hit, 11 reconciled). Each by-site figure equals its receipts: nothing
stood on either day, and the by-site figure reaches 0 on the next, 11-17.

## The rows

Same four rows as the pre-window recording, same definitions (*receipts* are
`credits_kept` in states `reconciled` and `cache-hit` only, summed over every site; CFL is
site `handleCFLOddsProbs`). The pre-window rows were **re-derived from D1 today and match
the 2026-11-15 recording on every cell** (84, 60, 78, 114, 60, 66, 108 CFL by site; 504,
174, 144, 183, 165, 156, 516 daily; 19 and 6 `error` calls), so the baseline is read, not
inherited.

| | 11-17 | 11-18 | 11-19 | 11-20 | 11-21 | 11-22 | 11-23 | judged sum (6) |
|---|---|---|---|---|---|---|---|---|
| watch residual (window-aligned) | 0 | 0 | 0 | 0 | 0 | 0 | n/a | **0** |
| daily − receipts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| CFL by site | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| CFL by site − CFL receipts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| CFL reconciled calls | 13 | 13 | 9 | 12 | 11 | 10 | 12 | 68 |
| watch verdict | tracks | tracks | tracks | tracks | tracks | tracks | window-drift | 6 of 7 reconciling |

The inputs behind them:

| | 11-17 | 11-18 | 11-19 | 11-20 | 11-21 | 11-22 | 11-23 | judged sum |
|---|---|---|---|---|---|---|---|---|
| daily (`odds_budget.used`) | 57 | 105 | 66 | 207 | 819 | 693 | 348 | 1,947 |
| receipts (all sites) | 57 | 105 | 66 | 207 | 819 | 693 | 348 | 1,947 |
| `odds_budget_site` summed over sites | 57 | 105 | 66 | 207 | 819 | 693 | 348 | 1,947 |
| CFL receipts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| vendor billed in the window (log) | 153 | 132 | 132 | 358 | 1,068 | 741 | n/a | 2,584 |
| our ledger, same window (log) | 93 | 72 | 72 | 258 | 948 | 561 | n/a | 2,004 |
| known CI spend (log, a lower bound) | 60 | 60 | 60 | 100 | 120 | 180 | n/a | 580 |
| CFL cache-hit calls (0 credits) | 27 | 133 | 120 | 90 | 141 | 28 | 239 | 539 |
| CFL `error` calls | 0 | 1 | 1 | 39 | 0 | 0 | 1 | 41 |
| CFL `error` credits kept (not in CFL by site) | 0 | 6 | 6 | 234 | 0 | 0 | 6 | 246 |

Every judged day's residual is vendor billed − ledger − known CI = 0 (153−93−60,
132−72−60, 132−72−60, 358−258−100, 1,068−948−120, 741−561−180). The logs' own COVERAGE
line applies to each: the residual is an upper bound on the ledger's shortfall, because
known CI spend is a lower bound. **Coverage of this read:** every site and every day in
the window, from three tables, 16 closed days in all (11-08 to 11-23); not a sample.

`getWCPregameLambdas`, which the 2026-11-05 paragraph asked the judge to read: it has **no
`odds_budget_site` row on any day from 2026-11-06 to 2026-11-24** (`handleWCOddsProbs` has
a zero-credit row on 18 of those days). The rows from 11-06 on do not carry the lambdas, as
expected; the judge reads them as absent.

## CFL call volume, both windows

Calls tallied in `odds_reconcile_state` for `handleCFLOddsProbs` (all states):

| window | cache-hit | reconciled | error | total | credits kept by `reconciled` + `cache-hit` |
|---|---|---|---|---|---|
| pre, 11-08..11-14 (7 days) | 940 | 95 | 25 | **1,060** | 570 |
| post, 11-17..11-22 (6 judged days) | 539 | 68 | 41 | **648** | 0 |
| post, 11-17..11-23 (all 7 days) | 778 | 80 | 42 | 900 | 0 |

Per day, post: 40, 147, 130, 141, 152, 38 and 252 calls. **The route kept being called
every day after the final game** (38 to 252 calls a day), which is the condition the
prediction document set for any reading of the contraction. Pre-window, each `reconciled`
call kept 6 credits (95 calls, 570 credits); post-window, the 68 `reconciled` calls kept 0.

## The scoring, with the arithmetic

Judged days J: pre = 11-08..11-14 (7), post = 11-17..11-22 (6).

- **H-whole.** Σ post residuals = 0; Σ post tolerances = 50+50+50+50+53+50 = 303.
  \|0\| ≤ 303: holds. Contraction against the pre-window sum (0) is 0.
- **H-none.** Pre residual sum 0, scaled by days judged (6/7) is 0; ±50% of 0 is the point
  0; the post sum is 0: holds. The band is one point because the pre-window already read 0;
  a nonzero post sum of either sign would have failed it (the self-test's first mutant does
  exactly that). H-whole and H-none, which predict different things in general, are both
  satisfied here by the same zeros, so the window does not separate them.
- **Spec 2.3.** Pre-window mean daily (CFL by site − CFL receipts) = 0/7 = 0, so the bar
  (half) is 0 and the "did not contract" ceiling (a quarter) is 0. Contraction per
  judged day = (0 − 0)/6 = 0 (also 0 as a difference of daily means). 0 ≥ 0 and 0 ≤ 0:
  both committed labels apply, so neither is a result. The 2026-11-15 recording had
  already said that the bar is 0 and that the judging run reports a test that cannot
  discriminate.
- **M (a).** The route was used on all 6 judged days (calls 38 to 152). CFL by site was above 0
  on 0 of 6; CFL receipts were at most 12 on 6 of 6. The first clause fails, so (a) fails.
  The prediction expected a standing net charge to persist off-season.
- **M (b).** \|Σ residuals + Σ (daily − receipts)\| = \|0 + 0\| = 0 ≤ max(350, 10% × 0) = 350:
  holds.
- **M (c).** The share is the one `outbox/odds-counter-internal-2026-10-18.md` tabulates:
  stranded calls / (reconciled calls + stranded calls), with stranded = (CFL by site − CFL
  receipts) / 6 = 0. 0 / (68 + 0) = 0% in aggregate and 0% on each of the 6 days, outside
  15% to 55%: fails. (The raw form `(by_site − all kept) / 6` is negative on the days with
  `error` rows, because their kept is an intent with no standing charge; the spec's
  receipts definition removes it. Under either form the share is at most 0%, so the result
  does not depend on the choice.)

**The scorer was shown able to fail (Rule 90), and the evidence is committed.**
`node outbox/odds-cfl-judgment-score-2026-11-24.mjs --self-test` first asserts the recorded
scores above, then feeds the same scorer five altered copies of the rows, each built to
flip named tests, and exits 1 unless exactly those flip and each flip really changed (a
mutation that changed nothing is itself a failure). Its committed output
(`outbox/odds-cfl-judgment-score-2026-11-24.log`): a −800 residual on one judged day flips
H-whole, H-none and M (b); a CFL net charge of 6 a day with 6 receipts behind it flips M (a)
and nothing else; 24 stranded credits a day flips M (a) and M (c); a pre-window carrying 741
a day of residual and 647 a day of stranded credit moves H-none out of its point band and
spec 2.3 out of its degenerate state; three post days refused flips the INCONCLUSIVE rule.
7 recorded assertions, 5 mutants, 0 failures.

## What the window does and does not show

1. **The no-fix premise could not be tested here; what the window shows is that nothing
   stood.** The prediction document said "charging continues at one call per page load"
   after the season. The calls did continue (900 in 7 days). The route's NET charge to the
   ledger was 0 on every one of those days, and every `reconciled` call ended at 0 kept
   where the pre-window's ended at 6. But the window is wholly after the 2026-11-01 deploy
   that removed the stranded charges, so whether the charge would have continued without
   the fix is not something it can show (see the limit on M (a) above).
   `odds_budget_site` records only the net, so the gross charge is not observable here.
2. **The experiment could not do what it was designed for, as the 2026-11-01 paragraph
   foresaw.** The stranded figure was already 0 on all seven pre-window days (the
   2026-11-15 recording), so the season's end had nothing left to remove from the
   residual. H-whole, H-none, spec 2.3 and M (b) are satisfied by 0 = 0.
3. **The contrast the prediction document named as the real answer** ("the CFL gap and the
   window-aligned residual before and after the deploy, `node
   scripts/analyze-cfl-reconcile-gap.mjs`") was run, and read three ways. They use different
   instruments (the first and third read the vendor's counter, the second D1's tally), and
   all three measure the same stranded charges, so they are one finding read three ways and
   not three confirmations of a cause.

   | reading | before the deploy | after the deploy |
   |---|---|---|
   | **window-aligned residual** and the CFL gap added inside the same windows (`analyze-cfl-reconcile-gap.mjs`; before from the committed `outbox/cfl-reconcile-gap-2026-11-03.json`, after from `outbox/cfl-reconcile-gap-2026-11-24.json`) | 10 measured windows closing 10-21..10-30: residual sum **−1,891**, 7 of 10 outside the watch's tolerance; CFL gap summed 1,518 to 2,022 (midpoint 1,770) | 18 measured windows closing 11-05..11-22: residual sum **−6**, 0 outside tolerance; CFL gap summed −12 to −60 (midpoint −36: negative on days with `error` rows, whose kept is an intent with no standing charge) |
   | **D1 tally** (`daily − receipts`, and `CFL by site − CFL receipts`), one row per closed day | 23 days 10-09..10-31: **11,797** and **7,896**; 22 of 23 days above 0 (10-23 is the only 0). The deploy day 11-01 (fix live from 17:25Z): 40 and 24 | 22 days 11-02..11-23: **0** and **0**; 0 of 22 days above 0 |
   | **UTC-day vendor residual** (the definition the watch used until 11-02, and still prints as "residual against that", vendor billed − UTC-day counter − known CI), from the committed logs | 22 days 10-09..10-30: **−11,469**, largest day −1,967 | 21 days 11-02..11-22: **−60**, largest day 204 |

   Coverage, stated where the numbers are read: the window-aligned windows closing 11-02,
   11-03 and 11-04 are in neither committed record (the drift series is a rolling 60
   samples), and 10-31's window has no vendor reading; the window-aligned residual is not
   comparable with the UTC-day one across 11-02, which is why the third reading keeps the
   old definition (both formulas subtract known CI; what changed on 11-02 is that the
   counter became the ledger delta over the vendor's own window). The D1 series starts
   10-09, the first full tally day (the tally began, partially, on 10-08). The reference
   week 10-11..10-17 reproduces to within one 6-credit `error` row: `daily − receipts`
   5,154 as recorded; CFL stranded 4,536 against 4,530 recorded, where 10-14 reads 312 in D1
   and 306 in the 10-18 table. D1 holds exactly one CFL `error` row that day (1 call, 6 kept),
   and the 10-18 table's 10-14 row shows kept 66 (60 from `reconciled` and `cache-hit` plus
   those 6), so that table's 306 used all-state kept on one day, against the receipts
   definition; the committed definition gives 312.

   **What the contrast says.** Every stranded source reads high on 22 of 23 days before the
   deploy and 0 on 22 of 22 after it, on three instruments. CFL accounts for 67% of the
   pre-deploy `daily − receipts` (7,896 of 11,797), and for 91% from 10-11 to 10-31 (7,842
   of 8,609): the rest is mostly the `ambientFetchLiveOdds` `no-header` estimates, 3,134
   credits on 10-09 and 10-10 (528 and 1,039 calls kept 2 each), which D1 records through
   10-11 and never after.
   The step starts on the first full day after the deploy and does not break through the
   window: the busy day 11-07 (0 on 2,289 HIT calls) and the 11-03, 11-11 and 11-23 days of
   492, 470 and 252 calls are all 0.
   Call volume does not explain it: from 10-09 every pre-deploy day with at least 12 calls has a stranded CFL
   charge except 10-23 (18 calls), including 10-19 (16 calls, 12 credits) and 10-26
   (16 calls, 24 credits), while post-deploy days of 28 to 53 calls (11-02, 11-04, 11-05,
   11-06) read 0, and 11-07's 2,342 calls read 0 against a pre-deploy maximum of 670 calls
   (10-17, 1,914 credits).

   **What it does not say.** It is a before/after, not a control. Other things changed in the
   same weeks: the single-batch charge on 2026-10-19, the World Cup lambdas gate on 2026-11-05
   (232 net credits over 10-08..11-04), the end of the `no-header` spend after 10-11, and the
   season's own stage (the regular season ended 10-24; the playoffs ran to 11-15). So it does
   not isolate the fix, and it does not apportion the drop between CFL and the other sources.
   What supports the mechanism is the repeat of Task 2b (`abort-loses-nothing`,
   2026-11-02, run 41413685131) and the busy-day read (2026-11-07, `pass`), both recorded in
   the vendor-residual CC-CMD with their own limits: the repeat is "n = 5, one run, and not a
   measure of the share of real disconnects", and the busy-day read does not show "how many
   client disconnects there were that day (the tally records no aborts, so a quiet client and
   a working fix read the same)". The pre-registered tests of this experiment added nothing
   to those two; the window's data extend the post-fix run to 22 days at 0.
4. **The `error` rows are the one standing oddity in the window, and are not CFL
   over-recording.** 41 CFL `error` calls on the judged days (39 of them on 11-20) kept
   246 credits that appear in neither CFL by site nor the receipts (CFL by site was 0 on
   those days). That is the "error row with a landed refund" shape recorded in
   `docs/CC-CMD-2026-10-23-odds-guard-accounting-edges.md` item 3, unchanged by this
   judgment. Why 11-20 carried 39 is not investigated here.
5. **Not tested here, so not claimed:** why the route's net charge is 0 off-season (a
   refund path is the likely mechanism; the gross charge is not observable in these
   tables), who calls the route (the CC-CMD records that it was not found), and the 11-23
   refusal's cause beyond the arithmetic above.

## Status and the held option

- `docs/CC-CMD-2026-10-18-odds-counter-internal-then-calendar.md`: Status is DONE and records
  this judgment. Done conditions 1 (Task 1's artifact) and 2 (the prediction, committed
  2026-10-18 before the final game) are met; condition 3 (no credit spent) holds for this
  judgment (0, read-only) and is as each task's own document states it for the earlier
  work, which this judgment did not re-audit against the ledger.
- `docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md`: Decision 5 held option 3
  "until its judgment run". The busy-day result its Note 2026-11-02 item 1 required is
  recorded in the vendor-residual CC-CMD (2026-11-08 08:01Z, `pass`: 0 stranded credits on
  2,289 HIT calls), so the Status is DONE, and a new Note 2026-11-24 records whether option 3
  should proceed. **Recommendation: not now, and it is the owner's call.** The reasons, each
  from a measurement above:
  1. Its stated purpose, "the season end then really zeroes the route", was observed
     without it: net CFL charge 0 on every day 11-17..11-24 across 900 calls in 7 days.
  2. The stranded part, which was the larger share of CFL's cost before 11-02, is 0 on 22
     of 22 days since, including the busy day.
  3. What is left while the vendor still lists CFL games is the billed part: CFL receipts
     were 318 of 1,056 daily credits (30%) on 11-07, a Division Finals day, and 570 of 1,842
     (31%) on 11-08..11-14, a week with no game and the Grey Cup listed. Option 3 lowers
     that only if page loads cause upstream-cache misses that a cron fill would not, and who
     calls the route is unmeasured, so its done condition ("CFL charges fall by the measured
     page-load share") has no measured share to fall by.
  4. The cost of option 3 is also unmeasured (D1 writes, and a client contract change across
     both repos).
  What reopens it: CFL games resuming, then a caller measurement first. Nothing is built.
- `outbox/odds-cfl-season-end-prediction-2026-10-18.md`: a pointer paragraph to this
  document is appended; nothing above it is edited.

## Re-deriving this

D1 (`cc49101c-0569-4d41-8e7a-be139cde4f26`), all read-only:

```sql
SELECT b.day, b.used AS daily_used,
  (SELECT SUM(s.used) FROM odds_budget_site s WHERE s.day=b.day) AS by_site_sum,
  (SELECT s.used FROM odds_budget_site s WHERE s.day=b.day AND s.site='handleCFLOddsProbs') AS cfl_by_site,
  (SELECT SUM(r.credits_kept) FROM odds_reconcile_state r WHERE r.day=b.day AND r.state IN ('reconciled','cache-hit')) AS receipts_all,
  (SELECT SUM(r.credits_kept) FROM odds_reconcile_state r WHERE r.day=b.day AND r.site='handleCFLOddsProbs' AND r.state IN ('reconciled','cache-hit')) AS cfl_receipts
FROM odds_budget b WHERE b.day BETWEEN '2026-11-08' AND '2026-11-24' ORDER BY b.day;

SELECT day, state, cache, SUM(n) AS n, SUM(credits_kept) AS kept
FROM odds_reconcile_state WHERE site='handleCFLOddsProbs' AND day BETWEEN '2026-11-08' AND '2026-11-24'
GROUP BY day, state, cache ORDER BY day, state, cache;

SELECT site, COUNT(*), SUM(used), MIN(day), MAX(day), MAX(used) FROM odds_budget_site
WHERE day BETWEEN '2026-11-06' AND '2026-11-24' AND site IN ('getWCPregameLambdas','handleWCOddsProbs') GROUP BY site;
```

For the before/after table, the first query over `BETWEEN '2026-10-09' AND '2026-11-23'`
gives `daily − receipts` (`used − receipts_all`) and CFL stranded (`cfl_by_site −
cfl_receipts`) per day.

Logs: `git show origin/main:outbox/odds-daily-vs-vendor-2026-11-NNTHHMM.log`, the names in
the table above. Credits spent by this judgment: 0.
