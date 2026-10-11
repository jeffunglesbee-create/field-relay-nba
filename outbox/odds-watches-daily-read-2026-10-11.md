# Odds watches — daily read, 2026-10-11

Read from each watch's committed artifact for today. Two reds. Every figure
below is quoted from an artifact in `outbox/`; where a mechanism is a
hypothesis it is labelled as one and the command that would test it is named.

## Verdicts

| watch | verdict, in the watch's own words | artifact |
|---|---|---|
| odds-daily-vs-vendor | **RED** — `we-overcharge-ourselves`, residual `-1967` (tolerance 100) | `odds-daily-vs-vendor-2026-10-11T0539.log` |
| odds-attribution-gap | `ok` — `\|0\| within 190`, `unattributed 0` | `odds-attribution-gap-20261011T154354Z.log` |
| odds-site-drift | `inconclusive  over 2 interval(s) of 3 same-day sample(s)`; `gap 0` on both | `odds-site-drift-2026-10-11T1651.log` |
| odds-pairing-rate | `UNEXPLAINED : -2362 (tolerance 194)`; ceiling `within_ceiling (3800/3800, 100%)` | `odds-pairing-rate-20261011T162919Z.log` |
| silently-dead-crons | **RED** — 3 NEW, 1 resolved | `silently-dead-crons-2026-10-11T17-42-23-075Z.log` |
| undeployed-src | `deployed` — "every deploy-triggering commit has been through a successful deploy" | `undeployed-src-2026-10-11T1556.log` |
| /budget/odds | `used 3800  by_site_sum 3800`, ceiling reached 14:03:59.125Z | read via site-drift; the sandbox cannot reach workers.dev |

## Watch 1 is red, and it is not the breach

Verbatim, closed day 2026-10-10:

```
  2026-10-10 our counter : 3800 / 3800
  vendor billed that day : 1993
  known CI spend         : 160   (1 run(s), 0 undated)
  residual               : -1967   tolerance 100
  verdict: we-overcharge-ourselves
```

Its own FAIL line: *"our counter recorded 1967 MORE than the vendor billed.
That is not a breach — it is headroom thrown away."*

**The watch states its own limits:** ONE closed day, 23 readings on file.
`knownCI` is a LOWER bound — only `odds-backfill` records its own credits, and
`targeted-odds-fill` calls the vendor directly with no counter at all — so the
residual is an **upper bound** on the shortfall, not a measurement of it.

**Six readings, by residual and verdict:**

| log date | residual | tolerance | verdict |
|---|---|---|---|
| 10-06 | -202 | 50 | we-overcharge-ourselves |
| 10-07 | +38 | 50 | tracks-the-bill |
| 10-08 | -3544 | 50 | we-overcharge-ourselves |
| 10-09 | -112 | 50 | we-overcharge-ourselves |
| 10-10 | -1020 | 115 | we-overcharge-ourselves |
| 10-11 | -1967 | 100 | we-overcharge-ourselves |

Five of six. `counter-under-counts` appears in none of them.

**Month to date, from `odds-daily-vs-vendor-series.json`:**

| reading | day | day_used | vendor_month | ledger_month |
|---|---|---|---|---|
| 10-08 | 10-07 | 3799 | 4103 | 10318 |
| 10-09 | 10-08 | 481 | 4592 | 10751 |
| 10-10 | 10-09 | 3225 | 6897 | 14036 |
| 10-11 | 10-10 | 3800 | 8890 | 18183 |

Cumulatively the ledger stands at 2.05x the vendor's bill. The daily deltas do
not hold that ratio: vendor +489 / +2305 / +1993 against ledger +433 / +3285 /
+4147, so 0.89x then 1.43x then 2.08x. The cumulative ratio is measured; a
constant daily multiplier is not, and the first of those three days has the
ledger *below* the vendor.

**The done condition has no branch for this.** `docs/CC-CMD-2026-09-19-daily-vs-vendor.md`
lines 130-143 enumerate "all three within tolerance" or "a consistent POSITIVE
residual". Five negatives in six readings fire neither, so the document's third
clause governs: *"An inconclusive mixture is a third real outcome and is
reported as such, never rounded to the first."*

## Where the over-recording could be coming from

`gap 0` on both of today's intervals, and attribution `|0| within 190` with
`unattributed 0`. **Our two internal counters agree exactly.** Whatever this is,
it is not a disagreement between them — so the atomic-counter work is not the
lead here.

What the site-drift log does show, for 2026-10-11:

```
  ceiling   : REACHED at 2026-10-11T14:03:59.125Z — one charge refused then;
              spend since is UNOBSERVED (no interval on file lies wholly after it)
  reconcile : 1884 call(s) over 20 cell(s), credits_kept 3201 of used 3800
    site                        state         cache        n   kept
    ambientCaptureClosingOdds   reconciled    EXPIRED     538   1614
    ambientFetchLiveOdds        no-header     EXPIRED     289    578
    fetchSportOddsLive          reconciled    EXPIRED     147    441
```

`ambientFetchLiveOdds` is charged 578 credits across 289 calls — 2.0 each — in
state **`no-header`**: the vendor returned no usage header, so those charges
have nothing to reconcile against and the estimate stands. That is 578 of 3800,
15% of the day, which is a real un-reconciled estimate and is **not** large
enough to account for −1967 on its own.

**Hypothesis, not a finding.** `chargedFromBatch` (`src/budget-helpers.js:773`)
throws `odds budget batch returned N result(s), expected 3` and its own comment
calls an absent result a shape the code has never seen, routed to the degrade
path deliberately because reading it as a veto "would silently stop every odds
call". If that is firing, charges would be recorded on a path the ceiling does
not settle. **No artifact in this repo counts its occurrences** — the string
appears in source and nowhere in `outbox/`. The command that would test it:
count that error in the worker's logs or tail for 2026-10-11, or add the count
to the site-drift artifact. Until then it is a guess, and it is recorded here
as one.

## Visible downstream, with one row that does not support it

`field-laboratory/outbox/drift-log.md`, today:

```
07:26  odds-coverage-lost  cov=MLS:0/6
17:36  odds-coverage-lost  cov=NFL:0/13 NBA:0/4 NHL:0/3 La Liga:0/4 Bundesliga:0/2 golf:0/1
18:23  odds-coverage-lost  (identical slate)
```

The 17:36 and 18:23 rows fall after the 14:03:59Z ceiling. **The site-drift log
says post-ceiling spend is UNOBSERVED**, so "the ceiling caused the afternoon
coverage loss" is consistent with the timing and is not established by it. The
07:26 row is before the ceiling and carries `MLS:no-start-time=6`, so that one
has a different cause and is not evidence for this at all.

## Watch 5 — three new, one removed

NEW, not in the baseline. The watch FAILs on these, correctly:

- `field-laboratory/.github/workflows/drift-sentinel.yml` — red since 2026-10-10T17:13Z
- `field-relay-nba/.github/workflows/tennis-tier-ladders.yml` — red since 2026-09-21, last run 2026-10-05
- `jubilant-bassoon/.github/workflows/forward-window-probe.yml` — red since 2026-10-09

Not admitted to the baseline. The script's own words: *"an entry is an admission
with a date on it, not a way to make this quiet."*

**drift-sentinel's cause is identified.** Run 38163516333, 18:22Z: every step
green except step 15, `Fail if the sentinel failed`, which re-raises
`steps.sentinel.outputs.code`. The failing check is `drift-check.mjs` returning
`odds-coverage-lost` — the rows above, not a laboratory defect. Steps 8 and 9
(`The i-have-adhd skill is still verbatim`, `A pinned skill divergence is still
reported`) both pass now.

RESOLVED, removed from `docs/dead-cron-baseline.json` in this commit:

- `field-playground/.github/workflows/build-check.yml` — fixed earlier today.

Verified before committing, with the mutation: against the edited baseline
`ratchetVerdict` returns `resolved=0`; with the key put back it returns
`resolved=1`, `carried=3`, `unexpected=3`. A removal check that could not still
see the entry when present would prove nothing about the removal.

## Not done, and why

No credits were spent and nothing was dispatched. The three new dead crons need
fixes, not baseline entries. The over-recording needs the one count named above
before anyone writes a fix, and the fix itself touches the odds budget path, so
it needs its own CC-CMD and the owner's approval.
