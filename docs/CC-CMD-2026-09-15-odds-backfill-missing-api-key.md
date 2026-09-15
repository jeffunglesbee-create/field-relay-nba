# CC-CMD-2026-09-15 — the odds backfill has been dead for fifteen days

**Status:** **CLOSED 2026-09-15.** The owner set `ODDS_API_KEY`. Run
`35012183015` (`workflow_dispatch`, head `67d025b5`) is the first green run
since at least 2026-09-01.

The discriminator is duration, not the green tick: runs 84–98 each died at
**9 seconds** on the first guard. Run 99 ran **83 seconds** and did real work.

```
quota: remaining=40654, monthly_used=59346, daily_budget=2700
22 unprocessed date(s); oldest 2026-08-24, newest 2026-09-14
done: dates=22/22 games=19 credits=1120
sync: attempted=21, opening_odds=1613 (reg=1587, post=26),
                    closing_odds=1444 (reg=1418, post=26)
```

**Done condition met** — green, `attempted=21` which is non-zero, and the
22-date backlog the fifteen dead days accumulated is now drained in one pass.

**Task 2 also met, on its first real run.** The candidate-SQL change shipped
earlier the same day had never executed in production. Its counters both read
zero and, more to the point, said so explicitly rather than silently:

```
sync: 0 game(s) in no games table, 0 game(s) already had every column this
      run could fill — neither logged to change_log.
```

That line is the phantom-`change_log` fix reporting its own absence correctly.
The three `left NULL for 0` guard lines likewise printed their zeros rather
than omitting themselves.

### One thing this run does NOT establish

The log reports `attempted=21` and the resulting archive totals, but **never
states how many columns were actually filled**. "19 games fetched" and "21
sync attempts" are not "N rows written", and nothing in this output closes
that gap. Task 3 below — what the fifteen days cost — remains unmeasured, and
the temptation to read `games=19` as the answer is exactly the substitution
this document was filed to avoid.

Remaining quota is worth watching but is not a finding yet: 40654 credits with
~15 days left is 2710/day against a 2700 daily budget, and this run's 1120 was
a fifteen-day backlog rather than a steady-state cost.

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
3. ~~Measure what the fifteen days cost.~~ **DONE 2026-09-15.** Counts from run
   `35013181130` (head `d6c52c1`); league breakdown from run `35013308603`
   (head `da80809`). Script `scripts/measure-backfill-outage-cost.mjs`,
   artifacts `outbox/backfill-outage-cost-*.log`.

   (Both ids read back from the Actions API. The first draft of this entry
   carried an id that was invented, which is the same defect HANDOFF.md:548
   already records — caught here before the commit rather than after.)

   | games dated ≥ 2026-09-01 | 862 |
   |---|---|
   | `opening_odds IS NULL` | 532 |
   | → has an `odds_history` row (**recoverable, still empty**) | **0** |
   | → has no `odds_history` row | 532 |

   **The recoverable residual is zero.** Not one game carries an
   `odds_history` row whose opening line went unfilled, so the catch-up
   recovered everything it was able to.

   The 532 is NOT the outage's cost and is not reported as such. Broken down
   by league, the postseason half resolves completely against a finding this
   repo already made:

   | league | n | status |
   |---|---:|---|
   | TELUS Canadian Championship | 10 | **NOT OFFERED** by vendor |
   | U.S. Open Cup | 2 | **NOT OFFERED** by vendor |
   | Campeones Cup | 2 | **NOT OFFERED** by vendor |

   14 of 14 postseason rows, per `CC-CMD-2026-09-14-cup-competitions-under-mls`
   (measured against `/v4/sports`). Nothing to do with a dead cron.

   Regular season: `MLS 247`, `CFB 177`, then UCL 18, Bundesliga 18, NFL 16,
   EFL Cup 11, La Liga 10, Ligue 1 7, EFL Trophy 7, Serie A 4, EPL 2, CFL 1.
   The `MLS 247` is consistent in size with the 243 cup fixtures that
   CC-CMD carries under `sport='MLS'`, but **they have not been shown to be
   the same rows** and that is left unclaimed rather than asserted.

   **`CFB 177` is the one large bucket no existing finding explains** and is
   filed as its own CC-CMD rather than carried forward (Rule 87.4):
   `docs/CC-CMD-2026-09-15-cfb-opening-odds-gap.md`.

4. Outbox manifest.

## Done condition

`odds-backfill.yml`'s most recent scheduled run is green **and** its log shows a
non-zero `attempted` count, with `watch-silently-dead-crons.mjs` green on the
same day.

## Scope boundary

Do not put a key in a workflow file, a script, a commit message or an outbox
document. Do not work around the guard. The guard is correct: it is the only
reason this was findable at all.
