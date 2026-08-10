# CC-CMD-2026-08-09-cfl-seed-row-backfill — Result

## Status: DONE, after a failed first attempt that this session caused and repaired in full. **Confidence: 95.**

Branch `main` throughout. Commits `53f87d7` (the backfill, which failed),
`e49d5aa` (the repair, which passed).

## Done condition, met

`outbox/repair-cfl-seed-duplicates-*.log`:

```
null-score CFL rows: 0   (must be 0)
0-0 phantom rows:    0   (must be 0)
rows on 2026-06-06:  2   (must be 2 -- one per real fixture)
total CFL rows: 7 -> 5
=== RESULT: PASS ===
```

The two 2026-06-06 fixtures now read `Winnipeg Blue Bombers @ Calgary
Stampeders 30-28` and `Edmonton Elks @ Ottawa RedBlacks 29-21`, both
carrying source ids (13419675, 13419676).

## Task 1 — gate

`scripts/preflight-archive-backfills.mjs`: `cflSeedRows: "PROCEED"`, two
null-score rows on 2026-06-06, both with `espn_event_id` NULL.

## Task 2 — the writer, identified by elimination

The seed rows were **not** written by the `[ARCHIVE-SEED]` block
(src/index.js:~7551): that block opens `if (!gm.eventId) continue`, and
both rows have `espn_event_id` NULL, so it cannot have produced them.
`created_at` is `2026-06-15 20:32:50` for both — a single bulk write, and
one that predates the current collector.

The repair log settles it beyond the elimination argument, by printing
the stored ids:

```
cfl_2026-06-06_calgarysta_winnipegbl
cfl_2026-06-06_ottawaredb_edmontonel
```

Lowercase `cfl_` prefix, team names truncated to 10 characters. Neither
matches any id scheme in `src/index.js` at HEAD. A retired writer.

## Task 3 FAILED — and the failure was mine, in the interesting way

`run-cfl-seed-backfill.mjs` POSTed the two real results to
`/archive/game` expecting `ON CONFLICT(id) DO UPDATE ... home_score =
COALESCE(excluded.home_score, home_score)` to fill the NULLs.

Result (run 31350990187):

```
null-score rows: 2  (must be 0)
row count before/after: 5/7  (must be equal)
=== RESULT: FAIL ===
```

It inserted two new rows instead of filling two old ones. **The upsert
keys on `id`**, and I had verified the *upsert semantics* — which were
exactly as I described them in the script's own header comment — without
verifying that the seed rows' ids would match what the route builds:

```
stored id : cfl_2026-06-06_calgarysta_winnipegbl
route id  : CFL_2026-06-06_calgarystampeders_winnipegbluebombers
```

This is the same error shape this session has now hit several times:
**two claims conflated into one**. "Does the upsert fill NULLs" and "will
this write reach that row" are different questions, and reading the
`ON CONFLICT` clause answers only the first. The second was answerable in
one query before writing anything, and I did not ask it.

Worth naming precisely because a plausible wrong diagnosis was sitting
right there in the log: the seed row says `Ottawa Redblacks` and the real
one says `Ottawa RedBlacks`. Casing. It is not the cause —
`shortify` lowercases before building the id, so both collapse to
`ottawaredblacks` — and stopping at it would have produced a "fix" for a
non-bug while the real mismatch (a retired id scheme) went untouched.
The repair script prints stored-vs-computed id for **every** CFL row so
the cause is an artifact rather than an argument, and the five rows that
DO match are the control.

## The repair, and why deletion rather than a second fill attempt

There is no id under which a write could reach the seed rows short of
renaming them, and id renaming is the specific hazard src/index.js:11105
declines to accept (`briefs.game_id` JOINs `games.id`).

The state after the failed run is exactly the postseason stale-sibling
shape: an unscored row alongside a real scored row for the same fixture.
Deleting the two superseded seed rows reaches the CC-CMD's own done
condition and simultaneously removes the two rows this session added.

Bounded by five required conditions — sport CFL, date 2026-06-06,
`home_score` AND `away_score` NULL, `espn_event_id` NULL, and a scored
sibling must exist — gated on the same `briefs` join-safety check the
postseason cleanup uses (`referenced rows: 0`), and gated on the delete
set being **exactly 2** before any DELETE is issued.

## Scope held

No source change. Two rows deleted, both written by this session's own
failed attempt's predecessor and both superseded by real scored rows. No
CFL row on any other date was touched — the 2026-08-08 rows appear
unchanged in both before and after listings.

## Confidence gate

**95.** The done condition is a live artifact, the root cause is proved
by a printed id comparison with five matching rows as the control, and
the repair reversed this session's own damage exactly (7 → 5, the
starting count).

Not higher, and deliberately not: this CC-CMD's first execution wrote two
wrong rows to a production table on an assumption I had documented in the
script header as if verified. The end state is right, the artifact chain
is complete, and the process that produced it was not. A score above 95
would be claiming the execution was clean, and it was not.

## Residual

None. No carry-forwards. The generalisable lesson — that `/archive/game`
INSERTs rather than fills when the id does not match, so a fill-shaped
task must probe the target's id first — is written into
`docs/CC-CMD-2026-08-10-archive-gap-real-write-path.md` Task 1, which is
the next session that will touch that route.
