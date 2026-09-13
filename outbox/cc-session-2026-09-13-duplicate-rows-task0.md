# CC-CMD-2026-09-13-archive-duplicate-rows — Task 0 result

Read-only. **No row was deleted, and nothing here authorises deleting one.**

Artifacts:
- `outbox/duplicate-row-keeper-table-2026-09-13T22-08-18-357355+00-00.md` — every collision, keeper, stale row, reason
- `outbox/duplicate-row-keeper-table-2026-09-13T22-08-18-357355+00-00.json` — same, machine-readable
- Source: `outbox/identity-ambiguity-watch-20260913T220818Z.json`, `scanned 3237 of 3237 rows across 2 tables`

## The headline

```
197 collisions
   111  KEEP_SCORED           one row carries the result, the other never can
    83  HUMAN                 nothing in the data distinguishes them
     3  KEEP_ESPN_UNSCORED    neither played, one carries the ESPN anchor
  ----
    82  stale row safe to delete
    32  merge first — the stale row holds a field the keeper lacks
     0  blocked by a brief reference (nominated stale rows only)
    55  rows referenced by a brief, across every verdict
    83  need a human
```

**82 of 197, not 197.** The rest is the useful part.

## The prior cleanup's "0" was true of a slice

`CC-CMD-2026-08-08` diagnosed this class and a cleanup on 2026-08-10 deleted 60
rows, closing on a quoted probe line: `duplicate groups: 0`.

`scripts/duplicate-fixture-probe.mjs` queries **`postseason_games` only**, `WHERE
date BETWEEN '2026-07-25' AND '2026-08-15'`. Tested against today's archive:

| | |
|---|---:|
| postseason collisions **inside** that window | **0** |
| postseason collisions outside it (2026-02-04 → 2026-07-14) | 82 |
| regular-season collisions **inside** that same window, other table | **27** |

The delete worked. The done condition was met verbatim. The number was true of
one table across 22 days and was read as the archive. A Rule 91 failure in an
artifact written a month before Rule 91 existed — and the 27 in-window
regular-season rows are the proof it was a scope artefact, not a date artefact:
same dates, different table, never queried.

## A defect in this session's own classifier, caught by running it

The first run marked **114** collisions deletable. **30 of those would have
destroyed odds.**

In the 2026-07-22 MLS population each row holds half the truth:

```
2026-07-22  MLS  austinfc|seattlesoundersfc
  2026-07-22-mls-atx-sea                        Austin FC vs Seattle Sounders FC
      score —            espn —        odds opening+closing
  FIFA World Cup 2026_2026-07-22_austin_seattle Austin vs Seattle
      score 3-1          espn 761674   odds —
```

"The scored row wins" is right for the 2026-08 migration shape, where the stale
row was never scored and held nothing else. Here it nominates the *malformed*
row — host-city names, an id naming the wrong competition — and deletes the
well-formed one carrying the market data.

**Neither is a delete. Both are a merge, and a merge is a different
authorisation.** `LOSS_BEARING` now blocks any delete where the stale row carries
a field the keeper lacks: opening odds, closing odds, `espn_event_id`, `venue`,
`start_time`, `finalized_at`. 32 collisions move out of the deletable set on
that rule; all 32 are FIFA-prefixed keepers against date-first strays, losing
`has_opening_odds` (14) or both lines (18).

Two mutations pin it. K7 removes the override. **K8 makes the comparison
symmetric** — which refuses every collision where the rows differ at all, i.e.
all of them, and a classifier that decides nothing while looking cautious is the
subtler failure.

## The first collision that is not a duplicate at all

```
2026-09-04  MLB  clevelandguardians|tigers      verdict HUMAN
  MLB_2026-09-04_e401816801  Guardians 4-3 Tigers  espn 401816801  final 02:45
  MLB_2026-09-04_e401877193  Guardians 7-6 Tigers  espn 401877193  final 22:00
```

A **doubleheader**. Two real games, two ESPN ids, two results. The CC-CMD
predicted this case as the reason not to zero the count by deletion reflex; it
turned up in the first run. Both rows must stay.

It also exposes a limitation worth stating: `byPair` holds one entry per team
pair, so **for a doubleheader the odds join cannot tell game 1 from game 2**.
Both rows here carry an opening line and only one of them can be the right one.
Not fixed, not fixable by deletion, and now written down.

## The 82 postseason escalations

Identical in every field the census carries — same teams, same league, same
score, same `series_key`, no ESPN id, no odds on either side. They differ only in
id scheme and by one day of `finalized_at` (2026-07-15 vs 2026-07-16), which is
the two bulk imports the 2026-08-08 session identified.

**50 of the brief-carrying rows are the name-scheme (legacy) side**, 2 the
key-scheme side. So the convention-correct row is usually the one *without* the
brief. Picking a keeper here means repointing `briefs.game_id`, not deleting —
Task 1's producer inventory has to come first.

## A reporting bug fixed in the same pass

The summary printed `0 blocked by a brief reference` while 55 rows are
brief-referenced. `blocked` counts only collisions where a *nominated* stale row
is referenced, and HUMAN nominates none — so it reads 0 exactly when the
escalated set is the one full of briefs. Both numbers are now printed, labelled.

## Gates added

| check | assertions | mutations |
|---|---:|---:|
| `check-duplicate-row-keeper-table.mjs` | 22 | 8, all caught |
| `check-odds-writers-sport-scoped.mjs` | 13 | 6, all caught |

Both run in `deploy.yml`. K5's anchor went stale when the override changed the
line it pointed at; the harness reported `ANCHOR occurs 0 times` and mutated
nothing rather than passing.

## Task 0 status

**Done.** The keeper table exists, names a keeper and a reason per collision, and
refuses 115 of 197. Tasks 1 and 2 (producer inventory; the `FIFA World Cup 2026_`
rows carrying `sport = MLS`) are unstarted. Task 3 needs owner approval and has
not been sought.
