# CC session — 2026-09-16d · odds spend attribution, and three watches that read the wrong thing

**Date:** 2026-09-16 18:00Z → 2026-09-17 02:45Z
**Branch:** `main` throughout. 0 PRs. Confirmed via `git branch --show-current`.
**HEAD:** `9b8dce1` → `71433fe` → `a96af3a` → `a71724f` → `41b7ad4`
**Deploys:** 35137916107 ✅ · 35152703394 ✅ · 35155571062 ✅ (35135398019 ❌, see below)

---

## 1. Deploy had been red for 4h10m and the attribution commit never shipped

`71433fe` ("Task 1 — the odds ledger says WHO spent it") was reported as landed.
It was not. Deploy run **35135398019 failed at step 63**,
`check-aggregate-launders-unknowns`, and every step after it — including
`Deploy to Cloudflare Workers` — was skipped.

Red since run **969** (`729eae6`, 17:44Z). Last green: run **968**, `f384913`,
12:58Z.

**Why the gate only started firing then, which is the more interesting half.**
The two `Number(r.credits_used || 0)` reduces in `watch-odds-pairing-rate.mjs`
had been there since the watcher was written. The gate's corpus is scripts
containing the string `outbox/` — the ones where a laundered zero becomes a
*durable* claim rather than a transient print. `ff61e97` gave the watcher a
series file to write, the watcher entered the corpus (107 → 108 scripts), and
lines that had always been wrong became lines that mattered.

The gate did not change. The blast radius did.

Fixed in `a96af3a`:

- both watcher sums route through `scripts/lib/summary-invariants.mjs` `total()`,
  which sums only values that ARE numbers and reports how many were not. The
  denominator travels with the sum (Rule 91):
  `4210  (from 9 of 14 rows; 5 non-numeric — NOT zero)`.
- `games_paired_in_window` is stored as `null` when any row was unreadable,
  because that field is the baseline every future delta subtracts from.
- **and my own new code in `src/budget-helpers.js`**, which the gate does not
  scan because it is under `src/`:
  `Object.values(sites).reduce((a, v) => a + (Number(v) || 0), 0)` — inside the
  function whose own comments say a site present with 0 differs from a site
  absent. `_readSites` sets `null` for an unreadable key and that null was being
  summed as a zero. **Fourth null-as-zero collapse of the day**, in the code
  written to make spend visible. `by_site_sum` and `unaccounted` are now `null`
  when any counter is unreadable, with `unreadable_sites` naming which.

---

## 2. Nine consumers had two names, so the correction never reached the counter

Attribution shipped at 19:00Z. Two readings, thirteen minutes apart:

| | 19:04:08Z | 19:17:27Z | Δ |
|---|---:|---:|---:|
| `used` | 322 | 768 | +446 |
| `by_site_sum` | 113 | 662 | **+549** |
| `unaccounted` | 209 | 106 | −103 |

I had published the residue reading — *attribution deployed at 19:00, so the 209
is pre-deploy spend* — as a **premise**, with the one measurement that would
refute it (Rule 100). It refuted it. A sum cannot outgrow the total it
decomposes by arriving late.

**Cause, read from source and not inferred.** `reconcileOddsCredit` corrects
`odds:daily:*` and `odds:credits:*` by the provider's real `x-requests-last` and
never touched `odds:site:*`. The two counters counted different things: site
held the pre-charge **estimate**, `used` held estimate-plus-correction.
`unaccounted` was the net refund wearing the name of a gap, on its way negative.

**And the one-line fix does not work.** `reconcileOddsCredit` already takes
`site` as its fourth argument — but four of nine consumers passed it a
*different* name than the guard:

| guard (`KNOWN_SITES`) | reconcile |
|---|---|
| `ambientFetchLiveOdds` | `_fetchLiveOdds` |
| `ambientCaptureClosingOdds` | `_captureClosingOdds` |
| `wpResolver` | `wp-resolver:fetchSportOddsLive` |
| `oddsProxyRoute` | `odds-proxy` |

Pointing reconcile at the site key would have minted
`odds:site:_fetchLiveOdds:*` that `_readSites` never reads — the same
private-copy shape as the fourth sport-key registry deleted on 2026-09-15.

**Shipped (`a71724f`):** one exported `ODDS_SITES` in `budget-helpers.js`; the
four literals renamed; `_bumpSite` called from reconcile with the (possibly
negative) delta, clamped at zero so a lost race cannot erase spend that
happened.

**Correction to what I reported in chat:** I said `oddsProxyRoute` had no
reconcile call. It has one, `src/index.js:16078`, under the name `odds-proxy`.
My grep was truncated. All nine charge and all nine reconcile; four disagreed
about who they were.

**Confirmed live, and not by the gap.** `ambientFetchLiveOdds` went **268 → 264**
between 21:33Z and 21:47Z. A site counter *decreased*. Only reconcile's negative
delta can do that.

| | 21:33Z | 21:47Z | Δ |
|---|---:|---:|---:|
| `used` | 1426 | 1598 | +172 |
| `by_site_sum` | 1768 | 1920 | +152 |
| `unaccounted` | −342 | −322 | +20 |

Bleed of −103 per 13-minute interval → +20. Today's −322 is frozen pre-fix
residue; 2026-09-16 spans the deploy.

**Rule 90 caught two apparatus defects.** A11 and A12 came back NOT CAUGHT.
`reconcileSkipsSiteKey` regex-tested the function body, so it passed on
`// await _bumpSite(...)` — commenting out the call did not move it; it is
line-anchored now. A12 had no predicate at all; the clamp was untested.

---

## 3. The spend watch compared two populations. Both watches read the wrong day.

`odds-pairing-rate-watch.yml` **had never run.** Its cron slot had not come
round, so it had never produced a verdict anyone had read. Dispatched at 21:52Z
it produced two FAILs and the second was false:

```
FAIL: the provider billed 1377 where 1232 was allowed
...a day above the ceiling is the signature of a guard that stopped guarding
```

Measured against the same interval it was judging (14:05Z → 21:52Z):

| | |
|---|---:|
| provider delta | 1377 |
| our ledger delta | **1467** — ninety MORE than the vendor billed |
| daily counter | 1598 / 3800 = **42%** of the ceiling |

Nothing escaped any guard. Two defects in one line:

**(a) Two populations.** `daySpendVerdict` subtracted the PROVIDER's cumulative
counter and judged the result against OUR ledger's ceiling. Those two stood
19,582 apart — the comparison measured that gap, not a guard.

**(b) A daily ceiling is not a rate.** Spend here is bursty; the closing capture
concentrates in the evening. Prorating 3800/day over a 7.8h evening gives 1232.
The guard itself never prorates: it compares a running total to 3800 and refuses
the call that would exceed it. A watch modelling the guard differently from the
guard reports on a system that does not exist.

Replaced with `ledgerIntegrityVerdict` (the two counters against **each other**
over the same interval — `escaped = providerΔ − ledgerΔ`, immune to the standing
cumulative gap) and `ceilingVerdict` (`used > ceiling`, no arithmetic). Both real
2026-09-16 numbers are now self-test cases, so the false alarm cannot return.

### The schedule comments were false in both files

| claim | measured |
|---|---|
| "the backfill's 10:00 UTC cron" | last ten scheduled runs **started 13:25–16:13 UTC** |
| "an hour after" | repo-wide delay **104–405 min**, 25 scheduled runs / 7 workflows |
| "the day's progress row exists" | there is **never** a row for today |

`odds-backfill.js` walks dates *"oldest-first from 2026-06-11 → yesterday"* (its
own header, line 14) and keys `odds_backfill_progress` by the **backfilled**
date. A `--days=1` dispatch at 21:53Z returned exactly one row, dated
**2026-09-15**, on a day whose cron had succeeded.

Artifact: `outbox/gha-cron-delay-2026-09-16.json`.

### That measurement condemned the watch I had shipped 90 minutes earlier

`odds-attribution-gap.yml` was set to `30 23 * * *` to "read the whole of today".
At 104–405 minutes it fires **01:14–06:15 the NEXT day** and would have read the
new day's near-empty counters as a finding about the old one, every night, while
its own comment explained why that could not happen.

Fixed at the root rather than by moving the hour:

- `/budget/odds?date=YYYY-MM-DD` reads a closed day. Refused beyond
  `odds:site:*`'s 2-day TTL rather than served as zeros, because expired
  evidence is not an absence of spend.
- the watcher asks for **yesterday**, so a closed day reads the same whenever the
  runner wakes; schedule moved to `20 9 * * *`.
- the watcher verifies the date came **back** (`dateHonoured`) — an older
  deployed worker would ignore the parameter and hand it today.

Verified live: `date: 2026-09-15, requested_date: 2026-09-15, is_today: false`.

**A third, smaller one:** the provider series held a 14-row reading (16 paired)
and a 1-row reading (0 paired) because I dispatched both. Subtracting them
printed `-16`. The window size travels with every reading and the delta now
refuses when denominators differ.

---

## 4. Live state at close (2026-09-16 22:05Z)

```
/budget/odds
  daily 2026-09-16   used 1598 / 3800   by_site_sum 1920   unaccounted -322
    ambientCaptureClosingOdds  1200      fetchSportOddsHistorical  120
    ambientFetchLiveOdds        264      fetchSportOddsLive         66
    getWCPregameLambdas         256      handleWCOddsProbs           8
    handleCFLOddsProbs            6      wpResolver / oddsProxyRoute 0
  monthly 2026-09    ledger 46,347 / 85,000
  provider           66,085 used / 33,915 remaining

/budget/odds?date=2026-09-15
  used 3800 / 3800   remaining 0        ← the cap DOES bind on real days
  by_site all zero (attribution did not exist on 09-15)
```

`ambientCaptureClosingOdds` is **62%** of attributed spend. That is the shape a
per-consumer ceiling would be specced against, once a clean day confirms it.

**The odds backfill cron is no longer dead.** Run 35110321483, 2026-09-16
14:42Z, **success**, after failing every scheduled run 2026-09-01 → 09-15. The
`ODDS_API_KEY` secret was set between those two runs.

---

## 5. Gate counts

| harness | result |
|---|---|
| `mutate-odds-attribution.mjs` | **19 / 19** |
| `mutate-odds-matcher.mjs` | **35 / 35** |
| `check-odds-attribution.mjs --self-test` | **20 / 20** |
| `watch-odds-attribution-gap.mjs --self-test` | **16 / 16** |
| `watch-odds-pairing-rate.mjs --self-test` | **23 / 23** |
| `mutate-scope-claims.mjs` | 6 / 6 |

M24 existed to **defend** the proration that turned out to be the defect, so it
now defends the two-counter comparison instead. A18/A19 came back NOT CAUGHT
because the date logic sat at module scope where no case could reach it;
`defaultDate(now)` and `dateHonoured(daily, want)` are exported and have five
cases, one firing the clock at 04:12 on the 17th and requiring `2026-09-16`.

---

## 6. Claims I published and then had to withdraw

Recorded because Rule 100's corollary makes the publication, not the belief, the
defect.

| published | refuted by | cost to check first |
|---|---|---|
| "the 209 gap is pre-deploy residue" | a second reading 13 min later | one probe |
| "`oddsProxyRoute` has no reconcile call" | `grep -aon` without a truncating `head` | zero |
| "GitHub cron delay spreads are per-workflow" | 25 runs across 7 workflows, all 104–405 min | one loop |

---

## 7. OPEN — with unblock criteria (Rule 74)

### 7.1 Task 2 — per-consumer demand · BLOCKED until 2026-09-18
- **Blocked by:** no fully-attributed UTC day exists yet. 2026-09-16 spans the
  deploy (`unaccounted -322`); 2026-09-17 is the first clean day.
- **Unblocked when:** `odds-attribution-gap.yml`'s 09-18 run (reading 09-17)
  passes `|unaccounted| <= max(25, 5% of used)`.
- **Verify:** `curl -s "$RELAY/budget/odds?date=2026-09-17" | node -e '...'`, or
  read the committed `outbox/odds-attribution-gap-*.log`.
- **Automated:** check-in `trig_01XKN5kUAQNw6yo8bcGaUFpq`, 2026-09-18 17:00Z.

### 7.2 Task 3 — a per-consumer ceiling · BLOCKED on 7.1
- Blocked by the spec's own "What NOT to do": no ceiling may be specced against
  a number nobody can decompose. Earlier measurement already refuted the
  demand-derived ceiling proposal — the backfill is **1.1%** of spend, so
  capping it would have starved live polling and saved nothing.

### 7.3 The ~19,700 provider-vs-ledger gap · UNEXPLAINED
- 66,085 provider vs 46,347 ledger = **19,738** at 22:05Z.
- Established **not** to be live leakage: the 2026-09-05 artifact shows ~17,800
  already, so it grew ~1,900 over 11.5 days. An old static offset.
- **Origin UNKNOWN.** `ledgerIntegrityVerdict` now watches for it *recurring*
  (it compares the two deltas to each other), but cannot explain the existing
  offset.
- **Unblocked by:** the Odds API dashboard's per-day history, which this session
  had no access to.

### 7.4 The targeted fill — 123 pairs / 2,460 credits · APPROVED, UNRUN
- Approved earlier in the session; never executed. The last 1-pair probe spent
  20 credits and inserted 0 rows **on the old matcher**. The matcher is now
  80/80 CFB and 15/15 MLB, so the economics changed and the fill should be
  re-costed before running.

### 7.5 Soccer pairs 0 · CAUSE UNVERIFIED
- La Liga and EFL Cup pair 0. MLB was fixed by the contiguous-window matcher;
  soccer was not measured against a fixture.
- **Unblocked by:** a soccer fixture, the same way the MLB one (20 credits)
  unblocked MLB. `scripts/probe-*` pattern already exists.

### 7.6 CFB done condition · UNTESTED
- No CFB slate on Monday 2026-09-15. The 80/80 fixture result is offline only.
- **Unblocked by:** the next CFB date reaching the backfill window.

### 7.7 `silently-dead-crons` · MEASURED, NOT FIXED
**This is the one item in this doc where work was started and not finished.**

Measured 2026-09-17 02:3xZ, full paginated sweep:

```
workflows total 150 | active 150 | the script reads the first 100 -> misses 50
FAILING 3 CONSECUTIVE SCHEDULED RUNS: 2   (both declared detectors, both visible)
declares a cron but ZERO scheduled runs: 4   (all four INVISIBLE, past the cap)
```

- `scripts/watch-silently-dead-crons.mjs:42` —
  `actions/workflows?per_page=100`, **no pagination**, against 150 workflows.
- line 44 prints `${workflows.length} workflow(s)` → **"100 workflow(s)"**,
  which reads as the repo total. Rule 91, in the instrument built to be the
  repo-wide one.
- line 57 files a workflow with zero scheduled runs under
  `never run on a schedule — not judged`. That conflates *no `schedule:` block*
  (correctly unjudged) with *declares a cron and has never fired* (the deadest
  state there is).
- **Today's contents are benign and that was checked, not assumed.**
  `bsd-newsletter-claims` and `bsd-leagues-baseline` were added 2026-09-06 with
  day-3/day-4 monthly crons, next due 10-03 and 10-04. The other two are the
  watches shipped today. No dead cron is hiding. That is luck, not design.

**Proposed fix, not applied:** paginate; split `unscheduled` into "no schedule
block" vs "declares a cron, never fired"; make the coverage line state what it
did NOT cover. Plus a mutation per change.

---

## 8. The observation that ties 7.7 to §3, and is worth a rule

Three watches were examined today. All three had **correct logic on the wrong
population**:

| watch | logic | population |
|---|---|---|
| pairing rate | sound | provider's counter judged against our ledger's ceiling |
| attribution gap | sound | the wrong UTC day |
| silently dead crons | sound | 100 of 150 workflows |

All three printed a Rule 91 coverage line. All three lines were **true about
what the code fetched** and **wrong about what a reader would infer**.
`COVERAGE: 14 progress rows since 2026-09-02`. `100 workflow(s)`. Neither says
what was left out.

**Rule 91 as written asks for the numerator. What would have caught all three is
the denominator.** `100 workflow(s)` → `100 of 150 — 50 not examined`.

Proposed as a STANDARDS amendment rather than applied unilaterally.
