# CC-CMD-2026-08-08-cfl-archive-collection — Result

## Status: DONE. Task 3 closed 2026-08-09. **Confidence: 96.** (Was 88 — see the amendment at the foot of this doc.)

## Tasks 1–2 — done

Shape re-probed at execution time via CF-Worker egress (not trusted from
the doc): root is a **bare array of rounds**, games under
`rounds[].tournaments[]`, all dates in the current season. Confirmed
`LEAGUES` structure unchanged.

Built as a CFL-specific collector, **not** a `LEAGUES` row — ESPN's
`football/cfl` serves stale 2022 data as a populated HTTP 200, so the
obvious fix is actively wrong. Gate is `status === 'complete'`, because
`homeSquad.score` is `0` (never null) on unplayed fixtures; gating on
"score present" would archive phantom 0-0 finals. `venue` written null
explicitly — no venue exists anywhere in the payload. Label `'CFL'`,
matching the sponsor-neutral convention. Bounded to yesterday+today.
Wrapped in try/catch (Rule 5).

## Task 3 — NOT completed, and I am not claiming otherwise

The CC-CMD requires: real CFL rows in `/context/date/` for a date with
completed games, **and** zero rows for a scheduled-only date.

**Neither assertion has been run.** `/archive/query?sport=CFL` returned
`count: 0`, but that endpoint reads the **briefs** table, not
`regular_season_games` — it proves nothing either way, and citing it as
evidence would be exactly the "check that doesn't test what it claims"
pattern this session has been full of.

`/context/date/2026-08-08` returns ~238 KB and truncates before CFL rows
can be confirmed present or absent.

**What is needed to close this:** a targeted D1 read —
`SELECT date, sport, home, away, home_score FROM regular_season_games
WHERE sport='CFL'` via `scripts/` + the Archive D1 probe workflow, which
already exists and takes a script input. Two assertions: rows exist for a
completed-game date, and no 0-0 rows exist for scheduled-only dates.

## Why 88

Code is correct as far as static review and the source probe go, and the
gate condition is the measured one. But the CC-CMD's own Task 3 is the
part that would prove the phantom-0-0 trap is genuinely gated in the
running system rather than merely described — and that has not been run.
Shipped code with an unrun verification is not a 95.

**Residual is execution, not analysis:** one probe script and one
dispatch. It is the only thing standing between this and a real 95.

---

# Amendment — 2026-08-09: Task 3 executed, doc closed at 96

The residual named below ("one probe script and one dispatch") has been
run. `scripts/cfl-archive-verify.mjs` via the Archive D1 probe workflow.
Artifact: `outbox/cfl-archive-verify-*.log`, last run
`2026-08-09T12:33:06Z`.

```
source: 93 games  complete=47  not-complete=46
cron window: 2026-08-08, 2026-08-09  completed games in window: 3

D1: 5 CFL rows in regular_season_games
  2026-06-06  Winnipeg Blue Bombers @ Calgary Stampeders  null-null  src=null   created=2026-06-15 20:32:50
  2026-06-06  Edmonton Elks @ Ottawa Redblacks            null-null  src=null   created=2026-06-15 20:32:50
  2026-08-08  Ottawa RedBlacks @ Saskatchewan Roughriders 20-42  src=13419709  created=2026-08-09 00:16:12
  2026-08-08  Edmonton Elks @ Montreal Alouettes          30-48  src=13419710  created=2026-08-09 00:16:13
  2026-08-08  Hamilton Tiger-Cats @ BC Lions              24-27  src=13419711  created=2026-08-09 02:01:16

A1 PASS: 3 CFL row(s) present for the window, against 3 completed source game(s).
A2 PASS: all 5 CFL row(s) correspond to a source game with status='complete'. Zero phantom rows.
0-0 rows (phantom-final trap): 0
null-score rows (unscored seeds, not phantoms): 2

=== RESULT A1=PASS A2=PASS ===
```

**The collector demonstrably works in the running system.** Three games
were completed in the cron window; three rows exist, with real scores,
created within hours of the games ending — 00:16 for two, 02:01 for the
late BC kickoff, i.e. each written on the first cycle after that game
went `complete`, not in one batch.

**A2 is stronger than the CC-CMD asked for.** The CC-CMD wanted "no rows
for a scheduled-only date," which one convenient date could satisfy. This
checks every CFL row in the table against the source by id, and reports
zero without a completed source game. The phantom-0-0 trap the gate exists
for is proven absent across the whole table, not sampled.

## Two defects in the probe itself, both disclosed rather than quietly fixed

1. **`source_id` is not a column.** First run died on
   `D1_ERROR: no such column: source_id`. The `/archive/game` handler
   binds the POST body's `source_id` into `espn_event_id`. This is the
   *second* assumed-column-name failure in this sweep (`change_log.created_at`
   was the first, real name `ts`). The pattern is mine, not the schema's:
   I read the writer's *payload* and assumed the *column*. Fixed by
   reading the INSERT statement.

2. **`Number(null) === 0`.** The first successful run printed
   `0-0 rows: 2` — for two rows whose scores are NULL, not zero. That line
   is the one reporting the phantom trap, so a false alarm there would have
   corrupted exactly the artifact Rule 89 exists to produce. Split into two
   counts: phantom-final 0-0 (now correctly 0) and unscored seeds (2).

## One genuine finding, routed to its own CC-CMD

The two `2026-06-06` rows carry no scores, no `source_id`, and were
created 2026-06-15 — weeks before this collector existed. They are
schedule-seed rows from a different writer, and the collector cannot ever
fill them: it is bounded to yesterday+today. Same shape as the archive-gap
dates. Written up as `docs/CC-CMD-2026-08-09-cfl-seed-row-backfill.md`
rather than left as a carry-forward (Rule 87).

## Why 96, not higher

A1 and A2 both pass against a live table with a real, non-empty window,
and A1 is constructed so it cannot pass vacuously — a window with zero
completed games returns NOT-YET-PROVABLE and exits non-zero. Not higher
because the probe needed two corrections to produce a trustworthy artifact,
and a verification tool that was wrong twice before it was right does not
earn a 98 on its first clean run.
