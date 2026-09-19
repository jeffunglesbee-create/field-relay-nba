# Task 1 — the odds budget schema, and the instruction that contradicted itself

**CC-CMD:** `docs/CC-CMD-2026-09-18-atomic-odds-counter.md`
**Status:** DONE. STAGED per Rule 74 — criteria below.

## What shipped

`ensureOddsBudgetTables(env)` in `src/budget-helpers.js`. Two tables, one
`batch()`, `CREATE TABLE IF NOT EXISTS`, module-level ready flag so the DDL runs
once per isolate rather than on every guarded call. Shape follows
`ensureBriefsTable`, which is the convention here.

```sql
CREATE TABLE IF NOT EXISTS odds_budget (
  day  TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS odds_budget_site (
  day  TEXT NOT NULL,
  site TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, site)
);
```

Both added to `/d1/execute`'s `ALLOWED_TABLES`, so CI probes can read them.

## The instruction was wrong, and it said so itself

Task 1 read: *"`DB` (field-d1), not `ARCHIVE_DB` (game archive) and not
`WC2026_DB`."*

| what was checked | what it said |
|---|---|
| `wrangler.toml` `database_id` | `DB` and `WC2026_DB` both `f26669de-…` — **the same database**. "use DB, not WC2026_DB" was one instruction telling itself no. |
| `env.DB` references in `src/` | **4**, all Whoop OAuth tokens (`whoop_tokens`). `env.ARCHIVE_DB`: **347**. |
| every runtime `CREATE TABLE` | briefs, codex_history, jq_retry_telemetry, change_log, analytics_runs, analytics_output — **all ARCHIVE_DB**. |
| the odds tables that already exist | `odds_history`, `odds_backfill_progress` — **ARCHIVE_DB**. |

Following the document would have put the odds budget in the World Cup
database, beside a fitness API's OAuth tokens, away from every other odds table.

The contradiction was visible in `wrangler.toml` the whole time. Nobody
compared the two `database_id` lines because the binding *names* differ, and
two different names reads as two different databases. That is the
source-versus-copy substitution again: the name is a label, the id is the
thing.

## Creation path: not /d1/execute

Task 0b established that route 403s any table outside `ALLOWED_TABLES`, so
`CREATE TABLE odds_budget` through it would have failed at Task 4 with an error
that reads like a D1 problem. The worker creates its own tables at runtime
instead, which is what the other six already do.

`ALLOWED_TABLES` still matters — for READING. A probe against an unlisted table
gets a 403 that is indistinguishable, from outside, from a D1 failure.

## STAGED — unblock criteria (Rule 74)

- **What is staged:** `ensureOddsBudgetTables`. It has no caller (Rule 63).
- **What blocks it:** Task 2, which rewrites `checkAndIncrementDailyOdds` to
  charge through these tables. It is the only intended caller.
- **What unblocks it:** Task 2 landing.
- **Verify when unblocked**, against a day with traffic:

      curl -s "$RELAY/d1/execute" -H "X-FIELD-Relay: $GATE" \
        -H 'Content-Type: application/json' \
        -d '{"sql":"SELECT day, used FROM odds_budget ORDER BY day DESC LIMIT 3"}'

  A row for today with `used > 0` means the guard is charging through D1. Zero
  rows after a day of traffic means it is not, whatever the deploy said.

## Verification

| what | result |
|---|---|
| `check-odds-budget-schema.mjs --self-test` | 12/12 |
| `mutate-odds-budget-schema.mjs` | 6/6 |
| live check | `ok` — 2 tables, ARCHIVE_DB, 2 of 2 allow-listed |
| module imports | `ensureOddsBudgetTables` is a function; `ODDS_BUDGET_TABLES` exports both names |

**S1 is the mutation worth keeping.** It relaxes the binding assertion so any
binding passes — which means a later session reading the CC-CMD rather than the
code puts the tables in the World Cup database and the guard agrees. The
document is what people read; the check exists because the document was wrong.

**One mutation survived first time, and it is the same shape as yesterday's.**
S6 replaced the DDL parser with a hardcoded `['odds_budget','odds_budget_site']`
and the suite stayed green — because the self-test fixture declared exactly
those two names, so a parser that never read anything still matched. Fixed with
a fixture using names that appear nowhere in the product. A fixture that
coincides with the expected answer makes its assertion vacuous, and reading
cannot see it.

## Not done here

`ensureOddsBudgetTables` is not called, so the tables do not exist in D1 yet —
they are created on first use. The live check says this in its own coverage
line rather than implying the schema is deployed.
