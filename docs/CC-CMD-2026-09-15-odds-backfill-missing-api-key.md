# CC-CMD-2026-09-15 — the odds backfill has been dead for fifteen days

**Status:** FILED. **Blocked on the owner** — the fix is a GitHub secret, which
is not a session's to set.

## Measured

`odds-backfill.yml` has failed **every scheduled run** from **2026-09-01** to
**2026-09-15** — runs 84 through 98, fifteen consecutive failures, all on
`schedule`. Cause confirmed at **both ends of the window** rather than inferred
across it:

```
2026-09-01T14:37:26Z   ODDS_API_KEY:
                       [odds-backfill] missing ODDS_API_KEY
                       Process completed with exit code 1

2026-09-15T14:42:31Z   ODDS_API_KEY:
                       [odds-backfill] missing ODDS_API_KEY
                       Process completed with exit code 1
```

The secret resolves to an **empty string** and the script exits at its first
guard, before a line of its own logic runs.

**Onset is NOT established.** Run 83 and earlier were not examined; fifteen days
is a floor, not the age of the defect.

**The cause of the empty secret is NOT established either** and is not guessed
at here. It is a credential and it belongs to the owner.

## What this does and does not explain

It does **not** explain the two odds populations this session already closed:

- the 874 run-clock `captured_at` rows all predate `a1937eb` (2026-08-22);
- the 243 cup-competition rows have no vendor coverage at all, measured against
  `/v4/sports` on 2026-09-15.

It is a **candidate** explanation for opening lines missing on games dated from
2026-09-01 onward, and that is unmeasured. Stated as a candidate deliberately:
a session that assumed it would be repeating the mistake this document exists
to record.

## It also corrects something I said today

While editing `.github/scripts/odds-backfill.js` I wrote that the changed
candidate SQL "fires unattended at 10:00 UTC" and built a read-only verifier for
it. The SQL is verified and correct — `outbox/backfill-candidate-sql-*.log`, two
candidates, flags agreeing with the rows they describe — but **it has never run
in production and will not until the secret is set.** The verification stands;
the claim about when it takes effect did not.

## Why fifteen days passed unnoticed

Every check in this repo, and every check I wrote today, asks about **one
workflow at a time**. A daily cron that dies at its first guard produces no
artifact, no diff and no alert. Its only evidence is a red dot on a page no
session opens.

`scripts/watch-silently-dead-crons.mjs` now asks the question none of the
per-workflow checks can: across every active workflow, is any failing its last
N scheduled runs (default 3)? A single failure is deliberately not enough — a
watch that fires on noise gets ignored, which is how fifteen days happen.

## Tasks

0. **Owner:** set `ODDS_API_KEY` in this repo's Actions secrets. Nothing below
   can proceed first, and no session should attempt it.
1. Re-run `odds-backfill.yml` and confirm it gets past the guard — the artifact
   is its own summary line (`attempted=N, opening_odds=…`), not a green tick.
2. **Then** the candidate-SQL change shipped 2026-09-15 has its first real run;
   check the two counters it added (`skippedNoTable`, `skippedFilled`) and that
   `change_log` gains no phantom `odds_backfill` rows.
3. Measure what the fifteen days cost: games dated ≥ 2026-09-01 with
   `opening_odds IS NULL` that have an `odds_history` row. Until then the cost
   is unknown, not zero.
4. Outbox manifest.

## Done condition

`odds-backfill.yml`'s most recent scheduled run is green **and** its log shows a
non-zero `attempted` count, with `watch-silently-dead-crons.mjs` green on the
same day.

## Scope boundary

Do not put a key in a workflow file, a script, a commit message or an outbox
document. Do not work around the guard. The guard is correct: it is the only
reason this was findable at all.
