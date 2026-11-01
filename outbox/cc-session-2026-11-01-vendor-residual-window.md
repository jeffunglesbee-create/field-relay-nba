# CC session 2026-11-01 — the vendor watch judges the vendor's window, not the UTC day

**Task:** `docs/CC-CMD-2026-10-13-vendor-residual-window.md`, Task 1. Built on the owner's `go` to the offer made in the 2026-11-01 CFB close-out. Task 2 (P5) was not started.
**HEAD progression:** `4fe8519` (the 11-01 reading of the daily watch) → `46a929f` (the change) → this session doc.
**Credits:** 0. No relay Worker code changed; every changed file is a script, a workflow, a baseline or a document, so there is no deploy.

## Premises (Rule 100), each with the command that could refute it

| premise | the command | result |
|---|---|---|
| the UTC-day counter and the vendor window are different 24 hours, and it changes verdicts | `node scripts/watch-odds-daily-vs-vendor.mjs --self-test` on three verbatim series pairs (10-12, 10-23, 10-30) with each day's logged CI spend | 10-12: window -190, UTC-day -616. **10-23: window 0 = `tracks-the-bill`, UTC-day +75 = `counter-under-counts`** (the breach verdict). 10-30: window -406, UTC-day -631 |
| the replacement formula reproduces the hand table in the CC-CMD | an independent reviewer replayed `judgeDay` over all 43 consecutive real series pairs with each day's logged CI | 40 judged, 3 refused (month boundary, window drift), none unreadable; the eight closed days 10-23 to 10-30 match the "Data points" table exactly |
| `monthly.used` is a live read at the reading instant | read of `/budget/odds`, `peekMonthlyOdds`, and a grep for Cache API use in the handler | live D1 read, no Cache API in the handler. The vendor figure is the header of an edge-cached `/v4/sports` answer up to 60 s old: "same two readings" is exact to about a minute, far inside the tolerance |
| `monthly.used` is not always D1 | `peekMonthlyOdds` | `source` is `d1`, `kv`, or `kv-d1-unreadable`; the last serves a KV correction counter (tens against a month total of tens of thousands). A reviewer reproduced it corrupting two verdicts when stored as a baseline |
| the CI rows come back in the shape the old code read | `src/index.js`, POST `/d1/execute` | **No.** Success is the FLAT `{ success: true, results: [rows], meta }`; the old code unwrapped a nested shape the route never sends, and read any failure as zero CI spend |
| CI (odds-backfill) credits are not in the ledger | read of `.github/scripts/odds-backfill.js`: it calls the vendor directly and uses the relay only for `/d1/execute` and `/context/date` | **Read from source, not measured**: the CC-CMD's P2. A day with no CI spend would measure it; every day since 10-23 has had 100 to 240 |

## Built (46a929f)

- `scripts/watch-odds-daily-vs-vendor.mjs`: `ledgerWindow`, `judgeDay` (one function for the run and the self-test), `judgementLines`, `ciRowsFrom`; the verdict is vendor delta - ledger delta over the same two readings - known CI; the UTC-day figure is printed beside it, labelled "NOT the verdict". `readingFrom` stores the ledger only when `monthly.source` is `d1` and keeps the source. A window that cannot be measured fails the run (exit 1) with its reason: `ledger-unreadable`, `ledger-went-backwards`, `ci-unreadable`. No figure is substituted. Refusals (no-data, month-boundary, counter-reset, window-drift, unreadable) are unchanged and exit 0.
- `scripts/check-odds-daily-vs-vendor-run.mjs` + `scripts/lib/fake-clock.cjs`: the whole watch, spawned, against a stub relay that speaks the routes' real shapes (the secret header, a 401 without it, the flat D1 success, `is_today`), with a pinned clock; 11 cases, and it reads the series back.
- `scripts/mutate-odds-daily-vs-vendor.mjs`: 51 mutants (V1-V14 existing, W1-W16, X1-X21). The run check is optional (`--with-run`): the daily workflow runs the harness BEFORE the measurement, where a red harness would skip the day's reading and split the next vendor window, so without the flag the 15 run-only mutants are skipped and the output says so.
- `.github/workflows/guards.yml`: self-test, run check and `mutate ... --with-run` on every push (the watch's checks previously ran only inside the daily workflow, so a change to the watch was first judged by the run that needed it). `odds-daily-vs-vendor.yml`: header, and the run check after the measurement with `if: always()`.
- `docs/declared-detectors.json`: the detector's stated condition (1). `docs/absence-collapse-baseline.json`: lowered by two (the old CI parsing had two `|| []` sites).

## Proof

- Self-test 78 cases; run check 11 cases, **10 red on the previous watch** (the 11th, the month boundary, is unchanged behaviour); mutation harness **51 of 51** with `--with-run`, 36 of 36 without it, and every mutant named by the check that catches it.
- The absence-collapse ratchet: `bash scripts/absence-collapse-ratchet.sh` in a copy named `field-relay-nba` passes, with its own mutation caught.

## Review (three lenses, a skeptic per finding; 25 agents)

22 candidate findings; **15 confirmed by a skeptic, 2 more reproduced by me, 5 refuted.** The disk filled during the verify phase (my own `cp` of the repo beside the reviewers' copies) and three skeptics could not run commands; the two findings they were meant to check I reproduced myself.

| finding | disposition |
|---|---|
| a failed CI read became zero CI spend: the 10-12 pair read `tracks-the-bill` on a D1 500 (wrong-behaviour) | fixed: `ciRowsFrom`, `ci-unreadable` fails the run; X5-X9 |
| `monthly.source` never read: a KV value stored as the baseline (wrong-behaviour) | fixed: stored as null with the source; X1, X2 |
| the run check's stub spoke a D1 shape the route never sends, accepted any request, echoed any date, and never read the series | fixed: real flat shape, secret required, out-of-window CI rows, the asked day pinned, the series read back; X3, X4, X7-X14 |
| the harness ran the run check before the measurement, contradicting the workflow's own comment | fixed: `--with-run` |
| a new `|| []` in the run check failed the relay's absence-collapse ratchet and would have blocked a deploy | fixed: removed; the baseline is lowered, which the ratchet's own mutation requires |
| header and FAIL text said the verdict tested the enforcing counter; `declared-detectors.json` named the old formula | fixed |
| tolerance not distinguishable on the 10-12 pair (169 both); operand lines unpinned; ledger boundaries (-1, Infinity) | fixed: a 10000/6000 pair; every operand line; X15-X21 |
| refuted: a stored null ledger fails two runs in a row; `check-refusal-streak` does not list the new states; the 60 s vendor-header age; a coverage-text nit; a streak nit | not changed. The two-run failure is the specified behaviour (the bad reading is the next baseline); the sibling watch's `unreadable` already latches the streak gate at three |

## Verified, and what was not

| claim | status | evidence |
|---|---|---|
| the verdict is the window-aligned residual; the 10-12 pair is -190 | **VERIFIED** | self-test and run check, above |
| the watch fails closed on an unmeasurable window | **VERIFIED against a stub** | run-check cases for a null ledger, a KV ledger, a fallen ledger, a D1 500 and a wrong secret |
| the real `/budget/odds` and `/d1/execute`, the workflow, the series commit | **STAGED** | the sandbox cannot reach the relay and dispatching `odds-daily-vs-vendor.yml` would split the window. **Unblocked by:** the scheduled run of 2026-11-02 (fires about 05:30Z to 07:00Z). **Verify:** `outbox/odds-daily-vs-vendor-2026-11-02T*.log` prints `residual (window-aligned)`, the labelled diagnostic, a `verdict:` line and a stored series row with a numeric `ledger_month_used` and `ledger_source` `d1`; the first row of November (11-01) is its baseline. A wake is armed |

## Not changed, and why

The window-drift refusal (22 to 26 h) stays: the ledger and the vendor now cover the same instants, so a long window no longer manufactures a shortfall, but the diagnostic and the tolerance still assume about a day. Relaxing it would turn skipped days into judged ones: a separate decision. Task 2 (P5, `handleCFLOddsProbs`) is open. The CI term is an estimate (`credits_used` is 20 per attempted call, including non-OK answers), as it always was.
