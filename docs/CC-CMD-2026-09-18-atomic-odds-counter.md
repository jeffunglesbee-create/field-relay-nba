# CC-CMD-2026-09-18 — atomic odds counter

**STATUS: gate satisfied 2026-09-19. The verdict came back
`gap-grows-while-spending` — but the reason to do this has CHANGED, and the
change matters more than the verdict.**

**UNBLOCKED 2026-09-19.** Task 3 said two decisions were the owner's. Both were
measurements written up as values judgments; both are now measured and
answered in place. Nothing in this CC-CMD is waiting on a human.

**Task 6 must still report the 0d numbers.** Answered is not the same as
unmeasured-and-assumed.

## The verdict, and the falsification underneath it

`odds-site-drift`, 2026-09-18:

| from | to | usedD | gapD | verdict |
|---|---|---|---|---|
| 15:51 | 18:22 | 66 | -6 | gap-did-not-grow |
| 18:22 | 20:03 | 74 | +43 | gap-grew-while-spending |
| 20:03 | 22:53 | 1232 | +242 | gap-grew-while-spending |

Zero `clamp-witnessed` intervals. The clamp needed `used` to FALL; it never
fell. So the per-site clamp is not the cause and `_bumpSite` is not the fix.

**And the lost-update story does not survive either.** The 2026-09-19 01:50Z
sample reads `used 166, by_site_sum 150` — gap **-16**, sites UNDER the total.
Lost updates on the hot daily key can only ever make daily SMALLER than the sum
of sites, so they cannot produce a negative gap. The sign flipped, and one
mechanism cannot make it flip.

That is not a footnote. It is the finding:

> **Two non-atomic counters, written from concurrent isolates by different code
> paths at different frequencies, with a swallowed catch on one and not the
> other, will disagree in BOTH directions. There is no single root cause to
> find. They disagree because nothing makes them agree.**

Three candidates have now been killed by reading (midnight skew, ceiling
saturation, wrong-sign site loss) and two by measurement (the clamp, and a
single-mechanism lost-update account). Hunting a sixth is the iteration this
repo's Rule 42 exists to stop.

## Why this CC-CMD is still right, for a different reason

Its value is NOT "atomic, therefore no lost updates" — that was an argument for
a diagnosis that did not hold. Its value is Task 2's batch:

> daily and per-site are written in the SAME transaction, so they cannot
> diverge, in either direction, for any reason, including ones nobody has
> thought of.

A fix that does not depend on the diagnosis being right is the correct answer to
a defect whose diagnosis keeps changing. Execute it for that reason and state
that reason in its commit.

## THE LARGER GAP THIS DOES NOT CLOSE — read before starting

Everything measured so far is the difference **between two of our own counters**.
Nothing has established which of them is RIGHT. Both could be wrong together.

The only authoritative third number is the vendor's bill, and the pairing watch
already reads it: on 2026-09-18 it measured provider +506 against our ledger -76
over 18.4h, leaving **442 credits UNEXPLAINED** after known CI spend. That is
the number with money attached. `by_site` has no code consumer in either repo
(see below) and cannot overspend anything.

**If `odds:daily:*` is under-counting, real spend exceeded 3800 on every capped
day and the ceiling has been guarding a number below the truth.** That claim is
unproven and is the one worth proving. Closing daily-vs-site does not touch it.

So: execute this CC-CMD because single-transaction writes are right regardless,
and do NOT report the -397 class as "solved" when it lands. Daily-vs-vendor is
the open question, and it needs its own CC-CMD.

## The defect this addresses (as originally stated, 2026-09-18)

Measured 2026-09-17, closed day: `used` 3799 against `by_site_sum` 4196, a gap
of -397 past a 190 tolerance. Measured 2026-09-18 intraday at 15:50Z: `used`
274, gap +45 — 16% at a tenth of the volume, so the gap is not a ceiling
artifact.

Both counters are `get`-then-`put` on KV, non-atomic. `reconcileOddsCredit`'s
own comment says so. Concurrent isolates lose updates, and not evenly:

- `odds:daily:<date>` is written on **every** permitted call.
- Each of ten `odds:site:*` keys is written only on calls naming it, and one
  consumer (`ambientCaptureClosingOdds`) takes 62-88% of traffic, so the other
  nine are colder still.

The hot key loses proportionally more writes than the sum of the cold ones, so
the daily total drifts BELOW `by_site_sum`. **SUPERSEDED: the probe measured a
negative gap on 2026-09-19, which this account cannot produce. Kept for the
record, not as the rationale.**

### What this is NOT worth fixing for

`by_site` and `by_site_sum` have no code consumer: they appear only in
`peekDailyOdds`'s return (`src/budget-helpers.js:297,302`), nowhere else in the
relay, and nowhere in jubilant-bassoon (grepped repo-wide, zero hits, absent
from both CONTRACTS.md). A gap in a diagnostic cannot overspend anything.

The reason to fix it is the **enforcing** counter: if `odds:daily:*` is losing
writes, the ceiling is guarding a number lower than real spend, and 3800/3800
never actually meant 3800. That is the claim worth proving, and it is the same
mechanism.

## Task 0 — probe block (run first, ~20 min)

Nothing below is written from memory. Each line populates the spec.

```bash
# 0a. The verdict. Read the newest odds-site-drift log; if inconclusive, STOP.
git log --oneline -5 -- outbox/odds-site-drift-\*.log
git show origin/main:$(git ls-tree -r --name-only origin/main outbox/ \
  | grep 'odds-site-drift-2' | sort | tail -1)

# 0b. Does D1 here support RETURNING? SQLite has it since 3.35; this repo uses
#     ON CONFLICT DO UPDATE in six places and RETURNING in none. UNVERIFIED.
#     Run against DB (field-d1) via the existing /d1/execute path.
#     Expected: a row containing used=1. If it errors, the design in Task 2
#     changes to a batch() with a follow-up SELECT and the atomicity argument
#     must be re-made, not assumed.

# 0c. Current call sites — confirm the count before changing any.
grep -rn "checkAndIncrementDailyOdds(" src/ | grep -v budget-helpers
grep -rn "reconcileOddsCredit(" src/ | grep -v budget-helpers

# 0d. Latency, BOTH SIDES — see Task 3.2 for why one side is not enough.
#     Time these on the same isolate, from the worker, and report both:
#       (a) four sequential FIELD_JOURNALISM ops, as the guard does them now
#       (b) one env.DB.batch([...]) of the three Task 2 statements
#     ambientCaptureClosingOdds runs on a cron; fetchSportOddsLive runs per
#     request (STANDARDS Rule 24).
```

## Task 1 — schema  [DONE 2026-09-19, and it corrected itself]

No new Durable Object class. CLAUDE.md prohibits it ("requires migration
entries"), and D1 gives atomicity without one.

**~~`DB` (field-d1), not `ARCHIVE_DB` (game archive) and not `WC2026_DB`.~~
SUPERSEDED. It is `ARCHIVE_DB`, and the original instruction was wrong in a way
that contradicted itself.** Four measurements:

| what was checked | what it said |
|---|---|
| `wrangler.toml` `database_id` | `DB` and `WC2026_DB` are **`f26669de-…`, the same value** — two bindings onto one database. "use DB, not WC2026_DB" was one instruction telling itself no. |
| `grep -c 'env\.DB'` across `src/` | **4**, all Whoop OAuth tokens (`whoop_tokens`, ~11311-11376). `env.ARCHIVE_DB`: **347**. |
| every runtime `CREATE TABLE` | briefs, codex_history, jq_retry_telemetry, change_log, analytics_runs, analytics_output — **all ARCHIVE_DB, none DB**. |
| where the odds tables already are | `odds_history`, `odds_backfill_progress` — **ARCHIVE_DB**. |

Following the document would have put the odds budget in the World Cup
database, beside a fitness API's OAuth tokens, away from every other odds
table.

**Creation path.** Not `/d1/execute` — Task 0b established it 403s any table
outside `ALLOWED_TABLES`. The worker creates its own tables at runtime, the way
the other six do: `ensureOddsBudgetTables(env)` in `src/budget-helpers.js`,
`CREATE TABLE IF NOT EXISTS` in one `batch()`, module-level ready flag so the
DDL runs once per isolate. Both tables are now in `ALLOWED_TABLES` so probes
can READ them.

**STAGED** (Rule 74). The function has no caller; Task 2 is its caller. Unblock
criteria in `outbox/2026-09-19-odds-budget-schema.md`. Guarded by
`scripts/check-odds-budget-schema.mjs` — which fails on `wrong-binding`
specifically so a session following this document rather than the code cannot
move it back.

```sql
CREATE TABLE IF NOT EXISTS odds_budget (
  day  TEXT PRIMARY KEY,      -- UTC YYYY-MM-DD
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS odds_budget_site (
  day  TEXT NOT NULL,
  site TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, site)
);
```

## Task 2 — the guard, atomic and ceiling-enforcing in one statement

The ceiling goes in the `WHERE`, so there is no read-then-decide window and no
compensating write on veto.

```sql
-- 1. seed (no-op after the day's first call)
INSERT OR IGNORE INTO odds_budget (day, used) VALUES (?1, 0);
-- 2. charge, but only if it fits. Zero rows back = ceiling veto, unambiguously.
UPDATE odds_budget SET used = used + ?2
 WHERE day = ?1 AND used + ?2 <= ?3
 RETURNING used;
-- 3. the site split, IN THE SAME BATCH
INSERT INTO odds_budget_site (day, site, used) VALUES (?1, ?4, ?2)
  ON CONFLICT(day, site) DO UPDATE SET used = used + excluded.used;
```

All three in one `env.DB.batch([...])`. **This is the point of the whole
change**: daily and site are written in one transaction, so they become
structurally incapable of diverging. The -397 class stops existing rather than
being watched.

Statement 3 runs only if statement 2 returned a row.

## Task 3 — SUPERSEDED 2026-09-19. Neither was a decision.

This section read "two decisions the owner makes, not CC", and it gated the
whole CC-CMD from 2026-09-18. Both questions were measurements written up as
values judgments, and that is why neither got answered: as posed, neither has
an answer.

The original text is kept below, because the mistake is the useful part.

### 3.1 — degrade open, and it was never the leak

Keep the existing degrade-OPEN behaviour. Not a preference — the quantity the
question turns on was already measured and nobody looked.

`outbox/odds-pairing-rate-20260919T140742Z.log`, a 23.4h window:

```
escaped the ledger: 885
known CI spend    : 200
UNEXPLAINED       : 685   (tolerance 243)
guard fell open   : partial — 24 credit(s)
```

**24 of 685 credits.** Degrading closed recovers those 24 and stops odds
serving whenever D1 is unreachable; the other 661 is untouched by either
answer. The question was framed as though it governs the leak. It governs 3.5%
of it — and 24 is a floor, because the `!env.FIELD_JOURNALISM` path has nowhere
to record itself (see `_countDegradeOpen`'s header).

**The batch also removes the half-state the question was about.** Today the
guard can authorize spend and then fail to record it: the `put` throws, the
catch returns `true`, the vendor is called, and `odds:daily:*` never moved.
With the ceiling inside `UPDATE ... WHERE ... RETURNING`, charge and decision
are one statement — a throw means nothing was charged AND nothing was
authorized. What remains is the ordinary "no answer from the store" case, and
`return true` there is the same trade the code makes today, now bounded to a
window where no spend was recorded as permitted.

Keep `_countDegradeOpen`. It is the only reason any of the above is a number
rather than a guess.

### 3.2 — not a budget, a comparison; see Task 0d

Task 0d read "Time one /d1/execute round trip from the worker, because every
odds call gains one." It gains none.

Counted from `src/budget-helpers.js:176` (`async function
checkAndIncrementDailyOdds`), one permitted call today does **four** KV round
trips: `get(odds:daily:*)`, `put(odds:daily:*)`, then a `get` and a `put` on
`odds:site:*` inside `async function _bumpSite`. The Task 2 design is **one**
`env.DB.batch([...])` carrying all three statements. It is 4 → 1, not 0 → 1.

That does not make it faster and this document does not claim it does. KV reads
are edge-cached and cheap; KV writes and D1 both go to a central store, so a
lower op count is not by itself a lower latency. What it means is that "what
budget will you accept for an added round trip" has no answer, because there is
no added round trip. Measure both sides; do not reason about either.

Report both numbers in the Task 6 manifest.

If (b) is slower than (a), the batching question in the original text becomes
live again — one charge per slate rather than per game on
`ambientCaptureClosingOdds`. Decide it from the measurement, not before it.

---

### The original Task 3, superseded — kept for the record

> **Two decisions the owner makes, not CC**
>
> 1. **Degrade open or closed?** Today both guards return `true` when KV errors
>    (witnessed 2026-09-18: 4 credits through). With D1, degrading closed means
>    odds fetches stop when D1 is down; degrading open means the same silent
>    leak, relocated. CLAUDE.md Rule 5 covers archive writes, not budget guards,
>    so it does not decide this. **Ask.**
> 2. **Latency budget.** Task 0d's number against the per-call cost on the
>    `ambientCaptureClosingOdds` cron. If a round trip is material, the closing
>    capture may need to charge in one batched call per slate rather than per
>    game. **Report 0d before implementing, do not absorb it silently.**

**Why this is worth keeping.** Rule 100 says a premise is not probed until one
command has tried to refute it. Both premises here were refutable by one
command each — `cat` the newest pairing log, and read 38 lines of
`budget-helpers.js` — and neither was run before the questions were filed and
sent to the owner. That publication is the defect, exactly as Rule 100's
corollary describes. The cost was a day of the CC-CMD sitting gated on
questions that could not be answered.

## Task 4 — cutover

At a UTC day boundary. New day, new row; the KV keys carry
`expirationTtl: 172800` and age out on their own. No backfill, no dual-write
phase, no double-count window.

`peekDailyOdds` reads D1 for the current day and KV for any older day still
within its 48h TTL, so `/budget/odds?date=` keeps working across the boundary.

## Task 5 — mutations (Rule 90, before the check is trusted)

Each must be shown red before the fix is believed:

1. Ceiling moved out of the `WHERE` into a JS comparison after the update —
   restores the read-then-decide race.
2. Statement 3 moved out of the batch into its own call — restores the
   divergence this whole CC-CMD removes.
3. Zero-rows-returned treated as success — a vetoed call proceeds to spend.
4. `INSERT OR IGNORE` dropped — day one of every month silently vetoes
   everything, or throws.

## Done condition

Not "deployed". Two probe outputs, both already automated:

1. `odds-site-drift` reports `gap-did-not-grow` across **at least 8 same-day
   intervals** on a day where `used` exceeds 1000. Fewer intervals or a quiet
   day does not count — `inconclusive` is not a pass.
2. `odds-attribution-gap` reports `ok` on a **closed** day:
   `|unaccounted| <= max(25, 5% of used)`.

Both are read from committed outbox logs, not from a live curl.

## Task 6 — outbox manifest (last)

Commit hash, deploy run ID, the two done-condition outputs pasted verbatim,
**both** 0d latency numbers (four-KV and one-batch, same isolate), and — if
(b) came back slower than (a) — the per-slate batching decision from 3.2.

There is no owner answer to record. Task 3.1 is answered from the pairing log
and cited there.

## Retire the probe

`odds-site-drift` exists to answer one question. Once the done condition holds
for three consecutive days, delete the workflow and the two scripts. It was
built on 2026-09-18 and must not become the 22nd permanent scheduled watch —
the repo already runs 21 read-only watches against 16 workflows that do work.
