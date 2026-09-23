# CC session 2026-09-23 — the dead-pair ledger, and two counters that never agreed

HEAD `43f38ab` → `b6f76b8` (relay). Spent at the vendor: **0 credits.**
Deploy 986 green. All work on `main`.

Tracked by `docs/CC-CMD-2026-09-19-daily-vs-vendor.md` (watches) and
`HANDOFF.md`'s fill entries (ledger).

---

## 1. The worsening residual was not ours

`odds-daily-vs-vendor` went `-2477` → `-3295` and reads as deterioration.
Decomposed:

| | 09-20 | 09-21 | moved |
|---|---|---|---|
| our daily counter | 3800 | 3799 | **1** |
| vendor billed | 1543 | 704 | **839** |
| residual | −2477 | −3295 | 818 |

All the movement is in the subtrahend. The watch has been plotting the vendor's
bill, inverted. Five candidate causes died against that curve across previous
sessions because it was never ours to explain.

## 2. The comparison nobody had made

`consumeOddsCredit` (src/index.js:6535) charges the identical `units` to the
daily counter and then to the monthly one, in one function, in that order.
Within a UTC day they cannot legitimately diverge.

| day | vendorΔ | our monthlyΔ | our dailyΔ |
|---|---|---|---|
| 2026-09-19 | 4323 | 3554 | 3800 |
| 2026-09-20 | 1543 | 1337 | 3800 |
| 2026-09-21 | 704 | **146** | **3799** |

The monthly counter tracks the vendor within a few hundred every day. The daily
counter tracks nothing: the vendor's spend varied SIX-FOLD while the daily
figure varied by one. Both numbers arrive in a single `/budget/odds` read.

**It is not a difference.** `daily.used` is a closed UTC day; `monthly.used` is
a running total and the readings land at ~04:48Z. Differencing them would
rebuild the two-window substitution that cost jubilant-bassoon ten days on an
unrelated defect this same week. So `scripts/lib/daily-vs-monthly.cjs` uses an
inequality that holds for any window:

> the monthly delta over `[first, last]` covers every day FULLY CONTAINED in
> that span plus the partial edge hours, so `monthlyDelta >= sum(day_used)`.

Live: **7599 vs 5037, excess 2562** — a floor on the error, not an estimate.
Edge days are excluded rather than prorated; the verdict is one-sided on
purpose, because `monthlyDelta > dailySum` is the healthy case.

Runs as a step inside `odds-daily-vs-vendor.yml` on the series that job just
wrote, so it cannot judge a stale series and there is no second copy to drift.

**This says the two disagree. It does NOT say which one is wrong.**

## 3. The dead-pair ledger

The fill plan is rebuilt each run from games with no `odds_history` row, sorted
by game count, so a pair the vendor cannot fill keeps all its games forever and
sorts back to the top at 20 credits a run. The 2026-09-19 fill proved four
exist — and **not for the same reason**:

| pair | reading | class | kind |
|---|---|---|---|
| 2026-08-22 nfl | 272 ev, **0 in window** | `none-in-window` | matcher |
| 2026-08-28 nfl | 272 ev, **0 in window** | `none-in-window` | matcher |
| 2026-09-12 cfb | 95 ev, **80 in window**, 0/13 | `priced-zero` | matcher |
| 2026-05-24 la liga | **1 ev**, 1/10 | `vendor-exhausted` | **vendor** |

`2026-09-12 cfb` had 80 events in window and priced none — **our reading
failed, their data did not**, and that is the class a matcher fix recovers. A
ledger excluding all four permanently would make it unreachable forever.

So every row records the code it was measured under: the request shape, and a
sha256 of `src/odds-name-match.js`. A matcher-class exclusion **expires by
itself** when that file changes. No constant to bump.

`vendor-exhausted` (`events < wanted - priced`) is the one class that is a
counting fact: one event cannot price nine games however well we read it. Its
ceiling is deliberately generous — `events` is the whole snapshot, wider than
our date — so it errs toward re-buying rather than locking out.

### Verified end to end, zero credits

```
pairs skipped as known-dead : 1 (20 credits not spent)
    2026-05-24  la liga     vendor-exhausted
matcher fingerprint 6ce1b7d8a5f9
plan: 134 pair(s) = 2680 credits        (was 135 / 2700)
```

`outbox/targeted-odds-fill-20260923T025616Z.log`. Classify → seed → D1 → read →
exclude → plan shrinks.

## 4. Five defects, none found by reading

1. **`CREATE TABLE` 403'd.** `/d1/execute` has an allow-list; I wrote the DDL
   from assumption. The guard was right and the dry run spent nothing.
2. **The gate for that existed with too narrow a denominator.**
   `check-odds-budget-schema.mjs` reads DDL out of `ensureOddsBudgetTables`, so
   it covers tables the WORKER creates. A table created by a SCRIPT was outside
   it. `check-script-created-tables.mjs` closes the other half.
3. **My own comment corrupted the allow-list parser.** It contained `403'd`;
   that apostrophe opened a quote which closed on the next one, so the parser
   returned thirteen real tables plus `"d here — the guard working — and spent
   nothing.\n"` as a fourteenth. The new table was never parsed, and the sibling
   gate printed **"OK: all readable from CI"** against that list. `allowedTables`
   strips comments now, with the apostrophe as a regression case.
4. **The new gate's `--self-test` printed the OTHER gate's 12/12 and exited** —
   it imported from a module whose body reacts to the shared argv. `allowedTables`
   now lives in a CLI-free module both import.
5. **The seed sent `x-field-gate` and wrote 0 of 10 rows — then exited 0.** The
   correct header, `X-FIELD-Relay`, is three lines from code I had been editing.
   And writing nothing reported success: the absence collapse, inside the tool
   built to stop a different one. `seedVerdict` has five outcomes now, and a
   PARTIAL write fails too.

## 5. Verification

| check | result |
|---|---|
| `check-daily-vs-monthly.mjs` | 17/17 |
| `mutate-daily-vs-monthly.mjs` | **8 of 8**, positive control green |
| `check-dead-pairs.mjs` | 46/46, built on the ten real pairs |
| `mutate-dead-pairs.mjs` | **13 of 13**, positive control green |
| `check-script-created-tables.mjs` | 14/14, verified able to fail |
| `seed-dead-pairs.mjs --self-test` | 10/10, verified able to fail |

Three harness findings worth keeping:

- **D1 was a DEAD mutation** — it added a class to a second set while the class
  stayed in the first, so nothing changed and the harness said NOT CAUGHT. That
  two sets existed at all was the latent bug; replaced with one `CLASS_KIND`
  mapping, which makes it unrepresentable.
- **D4, D6 and D1 later went FAIL, not NOT CAUGHT**, when their anchors moved.
  The harness refusing a verdict it did not produce is the property it was
  built for.
- **D13 went NOT CAUGHT on a real gap in my fixtures**: `events < wanted` and
  `events < wanted - priced` agree on all ten pairs in the fill log, so no live
  data separates them.

## 6. What is NOT established

- **Which counter is wrong.** The excess says they disagree. Nothing here says
  whether daily over-counts or monthly under-counts.
- **Three of the four dead pairs do not yet exclude.** They are matcher-class
  with a sentinel fingerprint, so they are history and get re-measured on the
  next `apply` fill, which writes real fingerprints. The provable saving today
  is **20 credits**, and the seed's own output says so.
- ~~Whether the daily counter being pinned at the ceiling refuses real
  requests.~~ **MEASURED — see §8.**

## 7. Carry-forwards

None deferred. The open items are scheduled measurements: `odds-daily-vs-vendor`
needs a third closed day for its done condition, and the next `apply` fill
writes real fingerprints for the three matcher-class pairs.

---

## 8. The ceiling probe, and a correction to §2

`outbox/odds-site-drift-series.json`, 29 samples already committed — no new run,
no credits. The intraday shape of `daily.used`:

| day | samples | ceiling reached |
|---|---|---|
| 2026-09-19 | 166 · 231 · 345 · 1014 · **3800** (19:39) · **3800** (22:32) | before 19:39, still capped at 22:32 |
| 2026-09-20 | 318 · 423 · 806 · 2226 · 3506 · **3800** (22:45) | late evening |
| 2026-09-21 | 216 · 264 · 318 · 1860 (21:17) → closed **3799** | after 21:17 |
| 2026-09-22 | 1571 · 1625 · 1694 · 1781 · **3800** (23:19) | late evening |
| 2026-09-23 | 1257 · 1365 · 1401 (13:54) | not yet |

### The correction

§2 said the daily counter "tracks nothing — the vendor's spend varied SIX-FOLD
while the daily figure varied by one." Every number in that sentence is right
and the conclusion it invites is wrong.

Those three figures — 3800, 3800, 3799 — are **closed-day totals of a counter
that saturates**. They are flat because the cap is flat, not because the counter
is dead. Intraday it climbs from a few hundred to the ceiling every day. I
compared end-of-day values of a capped series and read the cap as a defect.

That is the same shape as the sections gap this session already corrected:
a number that is correct, compared across the wrong axis.

**What survives the correction:** the daily-vs-monthly excess. 7599 against
5037 over two fully-contained days is an inequality violation that saturation
does not explain — a capped counter cannot exceed the monthly counter that the
same function increments alongside it.

### What the probe establishes

`checkAndIncrementDailyOdds` returns false at the ceiling and the callers at
`src/index.js:1176`, `:3277` and `:3422` return null rather than fetching. The
counter reaches the ceiling on **four of the last five days**, and on 2026-09-19
it was already at 3800 by 19:39 and still at 3800 at 22:32 — **at least three
hours during which every odds fetch was refused**, while the monthly ledger sat
at roughly 60,000 of 85,000 and the vendor billed 4,323 for the whole day.

So this is an availability question as well as an accounting one, and it recurs
nightly.

### What it does NOT establish

That any particular call was attempted and refused. A veto writes
`odds:daily:<date>:warned` to KV with a 24h TTL
(`src/budget-helpers.js:226-233`) — that key is the direct evidence, and **no
route exposes it**. `peekDailyOdds` returns used, ceiling, sites and source, and
not the warn flag.

Inferring attempts from the cron cadence would be exactly the untested premise
Rule 100 prohibits. The next measurement is to surface the flag on
`/budget/odds`, which is a src change and a deploy, not a probe.
