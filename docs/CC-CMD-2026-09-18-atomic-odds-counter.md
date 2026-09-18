# CC-CMD-2026-09-18 — atomic odds counter

**STATUS: GATED. Do not start until the drift probe returns a verdict.**

`odds-site-drift` runs every 3h and separates the two live candidates for the
site-vs-daily gap:

| verdict | meaning | what to do |
|---|---|---|
| `gap-grows-while-spending` | lost updates on the hot key | **this CC-CMD is correct — execute it** |
| `clamp-witnessed` | the per-site clamp discards refunds | **this CC-CMD is WRONG — fix `_bumpSite` instead** |
| `inconclusive` | not caught yet | wait; inconclusive is not absence |

Starting before the verdict repeats the 2026-09-18 pattern: changing production
code from a reading rather than a measurement.

## The defect this addresses

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
the daily total drifts BELOW `by_site_sum`. Direction follows from the code.
**Magnitude does not and is not claimed** — that is what the probe measures.

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

# 0d. Latency floor. Time one /d1/execute round trip from the worker, because
#     every odds call gains one. ambientCaptureClosingOdds runs on a cron;
#     fetchSportOddsLive runs per request (STANDARDS Rule 24).
```

## Task 1 — schema

No new Durable Object class. CLAUDE.md prohibits it ("requires migration
entries"), and D1 gives atomicity without one.

`DB` (field-d1), not `ARCHIVE_DB` (game archive) and not `WC2026_DB`.

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

## Task 3 — two decisions the owner makes, not CC

1. **Degrade open or closed?** Today both guards return `true` when KV errors
   (witnessed 2026-09-18: 4 credits through). With D1, degrading closed means
   odds fetches stop when D1 is down; degrading open means the same silent
   leak, relocated. CLAUDE.md Rule 5 covers archive writes, not budget guards,
   so it does not decide this. **Ask.**
2. **Latency budget.** Task 0d's number against the per-call cost on the
   `ambientCaptureClosingOdds` cron. If a round trip is material, the closing
   capture may need to charge in one batched call per slate rather than per
   game. **Report 0d before implementing, do not absorb it silently.**

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
the 0d latency number, and the owner's answer to Task 3.1.

## Retire the probe

`odds-site-drift` exists to answer one question. Once the done condition holds
for three consecutive days, delete the workflow and the two scripts. It was
built on 2026-09-18 and must not become the 22nd permanent scheduled watch —
the repo already runs 21 read-only watches against 16 workflows that do work.
