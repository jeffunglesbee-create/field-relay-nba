# Odds watches — daily read, 2026-10-19

The read began at 18:35Z. Six read-only readers each took one watch
workflow's newest run and the log that run committed. A seventh read
/budget/odds, through those logs only. An eighth reader took the open
threads. Each result not green then went to an adversarial checker: two for
watch 1, one for the threads. Everything was read through the Actions API
(GET only) and the GitHub MCP job-log tool. No credits were spent, nothing
was dispatched, and workers.dev was not reached. HEAD at the start of the
read was `e75f6b07`. The silently-dead-crons run that fired at 18:41Z was
read afterwards, at 20:11Z.

| watch | newest run | today | artifact |
|---|---|---|---|
| odds-daily-vs-vendor | 39199960834, 04:32Z, **failure** | **RED, not the breach.** `we-overcharge-ourselves` for 2026-10-18: counter 3442/3800, vendor billed 2569, known CI 220, residual `-1093` (tolerance 128), unreconciled 0. Second step `daily-exceeds-monthly`, EXCESS 2454 (1.07x) | `odds-daily-vs-vendor-2026-10-19T0432.log`, `odds-daily-vs-monthly-20261019T043219Z.log` |
| odds-attribution-gap | 39285816411, 16:29Z, success | `ok`. 2026-10-18 `used 3442`, `by_site_sum 3442`, `unaccounted 0` (within 172) | `odds-attribution-gap-20261019T162925Z.log` |
| odds-site-drift | 39281538810, 15:55Z, success | `inconclusive over 2 interval(s) of 3 same-day sample(s)`, gap 0 at all three samples (02:00, 08:08, 15:55Z; used 117, 141, 180) | `odds-site-drift-2026-10-19T1555.log` |
| odds-pairing-rate | 39292899496, 17:18Z, success | PASS. `UNEXPLAINED -472` (tolerance 133, one-sided). Provider 2658, ledger 2950 over the 27.1 h interval. Known CI 180 is a lower bound. Degrade: none, 0 credits. 14 rows, 0 spent-and-paired-zero | `odds-pairing-rate-20261019T171802Z.log` |
| silently-dead-crons | 39304682961, 18:41Z, success | green. `NEW, not in the baseline : 0`, `carried, already admitted : 1` (jubilant-bassoon `nba-clutch-update.yml`), `baseline entries resolved : 1` (field-laboratory `verify-full.yml`), overdue 0 | `silently-dead-crons-2026-10-19T18-45-23-267Z.log` |
| undeployed-src | 39296563816, 17:43Z, success | `deployed`, last green `1e0bfb8` at 17:27:51Z, 0 unbuilt. 4 runs today, 0 red | `undeployed-src-2026-10-19T1743.log` |
| /budget/odds | (no direct read) | 2026-10-18 closed 3442/3800. Today 702/3800 at 17:18Z. Month to date: provider 24,919, ledger 36,460 | via the logs above |

## Watch 1

**Not the breach.** Both checkers re-derived the newest verdict from the job
log and the series row with the script's own predicates. They both upheld
it:
- the window was 24.16 h, inside 22-26;
- vendorDay = 24178 − 21609 = 2569;
- 2569 − 3442 − 220 = −1093;
- tolerance = max(50, round(0.05 × 2569)) = 128.

Every scheduled run since 10-08 has failed, seven of them this week (10-13 to
10-19). In each of the seven, two steps failed:
- `Watch`, on this verdict's `die(1)` (`scripts/watch-odds-daily-vs-vendor.mjs`
  344-349); refusals there exit 0;
- `Our daily counter against our monthly counter`, on
  `daily-exceeds-monthly`, as the 10-18 read recorded.

The last three runs were read step by step in this read. The other four come
from the fact-check's `gh api` step read.
28 closed days now carry a verdict, across 33 logs:
- 26 `we-overcharge-ourselves`;
- 2 `tracks-the-bill` (10-01, 10-06);
- 0 `counter-under-counts`.

The 2026-10-18 ruling in `CC-CMD-2026-09-19-daily-vs-vendor` calls its done
condition met and says "Do not fix the over-record yet". Nothing here asks
for that fix.

**`daily-exceeds-monthly`** grew 940 → 1929 → 2454 over 10-17, 10-18 and
10-19. Every day in that sum predates the chargeOdds one-batch deploy
(`7ec2d03f`, deploy run 39183315552, live 01:04Z today). Whether the excess
stops growing is the 2026-10-25T06:30Z read of
`CC-CMD-2026-10-18-odds-charge-survives-cancellation`, not this watch's call.

## The other watches

- **site-drift:** gap 0 at every sample since the chargeOdds deploy. That is
  not evidence chargeOdds fixed anything, because this watch compares day to
  by-site, which were already one D1 batch from 2026-09-19 (`5edb19a`), and
  never reads the month. All 60 samples on file have gap 0.
- **pairing-rate:** the tolerance is not 120. The script computes
  max(50, round(0.05 × provider billed)), which gives 133 today.
- **silently-dead-crons:** yesterday's read expected field-laboratory's
  `verify-full.yml` run on 10-19 to be red. It passed, but only because
  session entries dated 10-19 already existed (`23b01d23`). The run flags it
  as "fixed or gone; remove it". It is deliberately kept: `23b01d23` (18:35Z) holds the entry
  until the 2026-10-26 scheduled run. That run is the first to carry
  field-laboratory `f73c874`, and the lab's
  `docs/CC-CMD-2026-10-26-read-scheduled-verify-full.md` resolves it.
- **undeployed-src:** `1e0bfb80` changes only scripts/. The src change in
  the same push is `4e230ef5` (8 comment lines), and deploy 39294330163 built
  both. The watch confirms each trigger commit went through a successful
  deploy run. It cannot confirm the running worker's SHA, because no build
  stamp exists.

## Open threads against today's evidence

| thread | state | today's evidence |
|---|---|---|
| per-consumer demand (CC-CMD-2026-09-16 Task 2) | **unblocked**, not built | `unaccounted 0` on 27 consecutive closed days (09-22 to 10-18). The CC-CMD still reads "Status: SPEC" |
| per-consumer ceiling (Task 3) | blocked | On Task 2 |
| ~19,700 offset | blocked | Ledger − vendor +11,541 (pairing log 17:18Z) and +11,721 (series 04:32Z). A level only, not merged with watch 1 |
| soccer pairing at 0 | blocked | The job logs are readable now (below), so the zero is located: on 10-17 the five European leagues paired 0, with vendor events in the pool (EPL 4, La Liga 4, Serie A 4, Bundesliga 2, Ligue 1 5), while MLS paired 19. The unblock still needs a fixture that spends credits |
| CFB done condition | **exercised since 2026-09-18, pairing non-zero; defects filed** | It ran on all 19 CFB dates: 164 paired, 150 priced. Found: 1 wrong stage-2 pair of 150, 1 pair priced backwards by the sync, and 171 of 288 Saturday rows unpriced by the 23:59Z snapshot. No pass criterion was ever stated. See §CFB below |

**The correction to the last three reads.** The 10-16, 10-17 and 10-18 reads
called CFB and soccer "blocked, same blind spot", because the pairing watch
counts by date, not by sport, and `gh api` job-log downloads are refused
here. The GitHub MCP `get_job_logs` tool returns the backfill's per-sport
lines, so the blind spot was in how the logs were read, not in what the logs
contain.

## CFB

Recorded at the owner's request by a second workflow:
- two job-log census readers covering all 34 odds-backfill runs from
  2026-09-16 to 10-19;
- an audit of the Saturday identity-join probe;
- a D1 reader;
- two adversarial checkers.

Both checkers refuted the first draft's "tested in production", and the
record follows them. Its three central claims were then re-run by hand: the
D1 rows, the matcher reproduction, and the orientation join. A third pass
fact-checked every changed file against primary sources before commit. It
corrected 31 points, among them an inverted coverage figure in my draft,
which called 117 rows "never priced" when 117 is the priced count.

1. **Exercised, with no pass criterion.** Every one of the 19 CFB slate dates
   from 2026-09-17 to 10-17 has a backfill `americanfootball_ncaaf` line. The
   counters sum to 150 by name, 14 by elimination, 161 unmatched and 6
   ambiguous. All three main counters count archive game rows: 150 + 14 + 161
   = 325, the D1 CFB row count. 164 paired became 150 priced in D1. The
   unblock happened on 2026-09-18, not today, and §7.6 never stated what
   would pass.
2. **A wrong pair is live in D1.** `CFB_2026-09-19_e401856686`, Georgia @
   Arkansas (kickoff 16:00Z, final 19:30Z), carries draftkings odds from
   Georgia Southern @ Jacksonville State (commence 23:02Z), stamped
   `late_minutes 475`. `matchSlate` reproduces it at stage 2: "Georgia"
   prefix-matches "Georgia Southern Eagles", and the other side matches
   nothing. The real GA Southern @ Jax State row is unpriced.
3. **A pair priced backwards.** `CFB_2026-09-19_e401856802`: the archive's
   home team Virginia carries +870, which is West Virginia's 9.7. The sync
   writes `home_ml` by position (`odds-backfill.js:517`).
4. **Most of each Saturday is unpriced by the backfill.** 171 of 288 CFB rows
   over five Saturdays (59%) are unpriced; 117 (41%) are priced.
   - 154 of the 171 kicked off before 22:00Z. On 10-17, every game at or
     before 21:00Z is unpriced (30 of 30), including Ohio State @ Indiana,
     Texas vs Florida and Tennessee vs Alabama.
   - The backfill reads one historical snapshot at 23:59Z
     (`odds-backfill.js:192`). Its own 10-17 line shows the absence: 23
     events in the pool, all 23 paired, and 29 games with no event.
   - The 09-12 Saturday, filled from a 12:00Z snapshot, priced 35 of its 42
     pre-22:00Z games, so an earlier snapshot reaches them.
   - 76 of the 117 priced rows are after-kickoff captures. They are marked in
     both columns, but CC-CMD-2026-09-14 covered only `closing_odds`. The
     `opening_odds` readers do not check the mark: the debrief "opened" line,
     `buildBackfillPrompt`, the slate odds line, and the client's `_isUpset`.
5. **The formal Task 3 artifact cannot pass.** `/identity/mismatches` never
   got `matchSlate`.
   - **The wrong day:** the Saturday probe's 6 scheduled runs all started on
     Sunday UTC (01:24Z to 02:51Z). The 7th run was a pre-slate dispatch on
     09-12. CFB reads NO_ROWS in 7 of 7 artifacts, and every run concluded
     success.
   - **The cost:** the ledger estimates it at 12 credits a run (3 by
     `oddsCreditCost` for each of 4 sports), not the 1 its comment says. The
     provider's actual bill per run is unmeasured.

Filed, not fixed, with no D1 write and no spend:
- `docs/CC-CMD-2026-10-19-cfb-stage2-wrong-pair.md` (items 2 and 3, plus a
  repair that needs an owner decision);
- `docs/CC-CMD-2026-10-19-cfb-saturday-coverage-and-join-probe.md` (items 4
  and 5, the unmarked `opening_odds` readers, and owner decisions on the
  snapshot and on what Task 3 measures).

Stale statuses corrected: 09-16d §7.4 and §7.6, CC-CMD-2026-09-11's header,
and HANDOFF's "still UNTESTED" line. The reproduction and D1 rows are in
`outbox/cfb-wrong-pair-repro-2026-10-19.log`.

## Waiting on the owner

- **The CFB repair** (stage2-wrong-pair TASK 3: NULL the wrong blobs, or
  re-derive them by team), and the Saturday snapshot decision (coverage
  TASK A1). Both are D1 or spend decisions.
- Any spend. The targeted fill's newest plan is the 2026-09-23 dry run: 134
  pairs = 2,680 credits, with the 10-pair row at 200 credits for 116 games.
  It is 26 days old, and no fill has run since 35812334701. Re-pricing it is
  a 0-credit dry run; an `--apply` needs approval.
- `rotate-relay-secret.yml` with `confirm=ROTATE`: still 0 runs.

## The stored prompt for this read is stale in two numbers

- "Tolerance 120" for the pairing watch: the script computes it daily (133
  today, 85 yesterday).
- "104-405 min" for the scheduled-run delay: re-measured over the last 33
  silently-dead-crons scheduled runs (09-16 to 10-18) at 193-539 min. The
  longest delays fell on Mondays.

The routine (`trig_01Br5AvFmbTB5RbMVKGe4JWE`) was not edited. That is an
owner call.

## Coverage

- 6 watch workflows: the newest run of each, read through the Actions API
  and the log the run committed. /budget/odds was read through those logs
  only. The sub-daily crons (site-drift, undeployed-src)
  were read for every run today.
- odds-daily-vs-vendor: all 33 committed logs, tallied for the verdict; the
  last 3 runs' job logs read step by step; the newest series row recomputed
  twice.
- attribution-gap: all committed logs, for the streak.
- site-drift: today's 3 logs in full; all 60 series samples and all 143 logs
  grepped for gap.
- /budget/odds: read only through the logs above, never directly.
