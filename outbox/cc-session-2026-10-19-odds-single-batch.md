# CC session — the odds charge in one D1 batch (option 1), 2026-10-18 to 2026-10-19

`docs/CC-CMD-2026-10-18-odds-charge-survives-cancellation.md`, option 1. The
owner delegated the choice ("go with Claude's best recommendations"); the
decisions are recorded in `b5a95e7c`.

**HEAD:** `4aacba4e` → `c8a45be7`, as one push of 13 commits.
**Deploy:** run 39183315552, green (deploy and verify).
**Guards:** run 39183315565, green.
**Integration status:** deployed. The done condition, measured over a
CFL-active day, is STAGED until 2026-10-25 (below).

## What landed, per commit

| commit | what |
|---|---|
| `7ec2d03f` | `chargeOdds(env, units, site)`: day, site and month in ONE five-statement batch, `['seed','monthSeed','site','monthCharge','charge']`. `checkAndIncrementDailyOdds` and `chargeMonthlyOdds` are removed; the three wrappers delegate in one line. `monthCharge` carries the day's predicate, so a day veto writes nothing anywhere. |
| `dd46eb6f` | the ceiling-grant check reads the guard by function, and covers the month |
| `b04beb27` | the pairing watch reads the one-batch `charge:` degrade reasons |
| `0dab44de` | a veto stays a veto when KV cannot record its warning (review round 1) |
| `57dad88c` | the month-reader check reads code, and the whole index (round 1) |
| `ca573152` | the pairing watch keeps its overload budget in path events (round 1) |
| `4c02e0ad` | the gate's comment tense (round 1; the hardening itself was dropped, see below) |
| `3a6b6ed5` | docs: the failure-path change stated both ways; gate hardening filed (round 1) |
| `6225d077` | the veto's warning cannot throw; the boundary tests vary units (round 2) |
| `eb466b49` | the pairing watch's fail-closed prefix weight has a test (round 2) |
| `9591bef2` | the month-reader check counts every use, and accepts equivalent spellings (round 2) |
| `1e5f7993` | docs: two more Decision-bullet corrections (round 2) |
| `c8a45be7` | docs: the gate-hardening CC-CMD re-measured, plus `outbox/odds-gate-wrapper-sweep-2026-10-19.log` (round 2) |

## Two adversarial review rounds

**Round 1:** three lenses (semantics, guard teeth, deploy), each finding
reproduced, then refuted or confirmed. **7 confirmed, 4 refuted.**

- **A real behaviour change.** A KV throw while recording a veto fell to the
  outer catch and degraded open, after the batch had committed the veto. The
  two-batch code still ran the month batch there. Fixed in `0dab44de`.
- **The spec text the decision rested on was false.** "The 85,000 limit binds
  earlier if anything, never later" fails on a thrown batch. Corrected in
  `3a6b6ed5`.
- **Two guard holes:**
  - G: no test of the source's own day-boundary binds;
  - M12 and M13: the month reader.
- **The pairing watch's budget silently loosened.** One `charge:` event per
  call counted against a budget set in two-path events.
- **The gate hardening was out of scope (Rule 69)**, and finding 4 on it was
  a hole. It was dropped from the branch and filed as
  `docs/CC-CMD-2026-10-18-odds-gate-reads-wrapper-bodies.md`.

**Round 2:** four lenses (semantics, teeth, sweep, docs) on the round-1
fixes. **17 confirmed, 1 refuted.** Most were docs and commit-message nits.
The code ones:

- **The veto's own warning could throw** on a rejection String() cannot
  convert. `_vetoErrText` now never throws. Wrapping the warning in `try`
  instead would have made M17 and M18 equivalent mutants; the review measured
  that.
- **G ran at units = 3 only**, so a literal 3 in a day-predicate bind passed.
  It now runs at 1, 3 and 30.
- **H failed the day and month keys together**, hiding a day-veto error that
  falls through and burns the month's 60-day limit key. M21 tests that.
- **The month-reader check was wrong in both directions:** too loose on
  `.slice(-1)[0]`, too strict on a renamed parameter. Both are fixed together.
- **The pairing watch's fail-closed weight had no test.** P15 covers it.

**Filed, not landed (Rule 69):** nine odds guards, check-monthly-atomic among
them, run only in `guards.yml`, which ignores `src/**`. That predates this
branch. It is now in the gate-hardening CC-CMD, with the trap that
check-monthly-atomic's W-check matches exact text and would block a correct
rewrite.

## Verification before the push

| check | result |
|---|---|
| check-monthly-atomic | 87 of 87 |
| mutate-monthly-atomic | 26 of 26 caught |
| mutate-ceiling-reached | 7 of 7 |
| mutate-odds-ceiling-grant | PASS |
| mutate-odds-pairing-rate | 15 of 15 |
| check-batch-order --self-test | 22 of 22, incl. E1-E3 equivalents green; deleting the use count turns M14/M15 red |
| every offline `node scripts/` step of guards.yml and deploy.yml | 107 of 110 green. The 3 reds are environment artifacts: the ratchet requires a checkout named `field-relay-nba` (green in a correctly named clone), and the BSD frame contract's live list fetch got HTTP 0 (sandbox egress; the branch touches no BSD file). All 3 are green on the runner in run 39183315565 |
| `npx wrangler deploy --dry-run` | built, 2088.87 KiB, no missing export |
| check-commit-skip-prose on the range | no commit suppresses CI |

## The done condition: month row minus sum of daily rows does not change over a CFL-active day

| when | month (2026-10) | sum of daily | gap | note |
|---|---|---|---|---|
| upstream close-out read, before the deploy (`4aacba4e`) | — | — | −2,766 | stable across two reads four hours apart |
| 2026-10-19T01:06Z, 3 min after the deploy | 35,857 | 38,647 | **−2,790** | baseline. 10-19 day 99 = site 99 |
| 2026-10-19T01:58Z | 35,875 | 38,665 | **−2,790** | first post-deploy read. Month +18 and daily +18 since 01:06Z, so the gap is unchanged; 10-19 day 117 = site 117. A small sample: 18 credits, no CFL game in it |
| 2026-10-25T06:30Z | 43,792 | 46,582 | **−2,790** | after CFL's 10-23 (54 credits) and 10-24 (588) games: **the done condition, PASS** (below) |

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

Was STAGED, per Rule 74 (now VERIFIED by the read above):

- **What is staged:** the done condition for option 1.
- **What blocks it:** no CFL-active day has closed since the deploy.
- **What unblocks it:** the 2026-10-24 UTC day closing, plus both reads
  above.
- **Verify:** the query in the 10-25 task. PASS means the gap is unchanged
  with CFL charges above 0.

The TASK 2 window of `CC-CMD-2026-10-18-odds-counter-internal-then-calendar`
(2026-11-08 to 11-23) is avoided: this landed on 10-19.

## Integration state (Rule 65)

- **Relay contract:** unchanged. `/budget/odds` reads the same tables. The
  degrade reasons are keyed `charge:` from now on; the old `daily:` and
  `month:` keys appear only on days before the cutover.
- **Consumers:**
  - `watch-odds-pairing-rate` counts the new prefix and weights it 2;
  - `odds-attribution-gap` and `odds-site-drift` read the same rows.
- **Known mismatches:** none.
