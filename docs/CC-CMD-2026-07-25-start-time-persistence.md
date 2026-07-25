# CC-CMD-2026-07-25-start-time-persistence

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Scope:** add a `start_time` column to the two game tables, persist the value that is already being sent, and let it flow to `/context/date`.

---

## Why

`field-playground`'s DeskCard wanted a "starts in 2h 14m" countdown. There
is no start time in `/context/date`'s response, so a placeholder was built
client-side and labeled `(sample)` — fabricated content on every row. It has
since been removed rather than left in. This CC-CMD makes the real value
available so a genuine countdown is possible.

**The gap is narrower than it first looks — verified against HEAD, not assumed:**

- `/context/date/{date}` (around line 9391) does
  `SELECT * FROM regular_season_games WHERE date = ?` and returns
  `reg.value.results` **verbatim**. It drops nothing and maps nothing.
- `POST /archive/game` (around line 10305) **already destructures
  `start_time`** out of the request body.
- The live-scores catch-up path (around line 7032, and two sibling paths at
  ~7116 and ~7202) **already sends** `start_time: gm.startTime || null` in
  that body.
- The `INSERT INTO regular_season_games` (around line 10419) does **not**
  include `start_time` in its column list — so the value arrives, is
  destructured, and is silently discarded.
- Confirmed by direct D1 query against `field-archive`
  (`cc49101c-0569-4d41-8e7a-be139cde4f26`): **neither
  `regular_season_games` nor `postseason_games` has a `start_time`
  column.**

So this is a schema + INSERT change. Once the column exists and is written,
`SELECT *` carries it to the client with no handler change at all.

---

## PROBE FIRST (read from HEAD before writing anything)

Do not work from the line numbers above — they are from a pull and may have
moved. Read the current text of each:

1. `grep -n "INSERT INTO regular_season_games" src/index.js` — read the full
   statement including its `.bind(...)` list and the `ON CONFLICT` clause.
2. `grep -n "INSERT INTO postseason_games" src/index.js` — same, if present.
3. `grep -n "start_time" src/index.js` — confirm the destructure in
   `/archive/game` and the three sending paths still exist as described.
4. Confirm current schema before altering:
   `SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('regular_season_games','postseason_games')`
   — if a `start_time` column already exists, stop and report; the migration
   has already run.

---

## TASK 1 — schema migration

Add the column to both tables. Idempotent: check `sqlite_master` first (per
the probe) and skip if present.

```sql
ALTER TABLE regular_season_games ADD COLUMN start_time TEXT;
ALTER TABLE postseason_games ADD COLUMN start_time TEXT;
```

`TEXT`, nullable, no default — matching how every other optional field on
these tables is declared. Existing rows get `NULL`, which is correct: those
games' start times were never captured and must not be invented.

Both tables, not just regular season — `/archive/game` writes to both
depending on `series_key`, and `/context/date` returns both.

---

## TASK 2 — persist it on insert

In the `INSERT INTO regular_season_games` statement:

- add `start_time` to the column list
- add a matching `?` to `VALUES`
- add `start_time || null` to the `.bind(...)` call **in the correct
  positional order** — this is a positional bind list, so an off-by-one
  silently writes the wrong value into the wrong column. Count carefully
  against the probe output.
- add to the `ON CONFLICT(id) DO UPDATE SET` clause, matching the existing
  style exactly:
  `start_time = COALESCE(excluded.start_time, start_time)`

`COALESCE` in that direction means a later write that lacks a start time
will not erase one already captured — same protection the other fields have.

Repeat for the `postseason_games` insert if one exists.

Note there is a second, narrower insert immediately above the main one
(ending `home_score ?? null).run()`) — read it in the probe and decide
whether it needs the field too. If it is a score-only fast path, leave it
alone and say so in the outbox rather than changing it silently.

---

## TASK 3 — verify with real data, inside this session

Do not defer verification.

1. Confirm the columns exist:
   `SELECT sql FROM sqlite_master WHERE type='table' AND name='regular_season_games'`
2. Confirm new rows populate it. Either wait for a live ingest cycle, or
   `POST /archive/game` directly with a known `start_time` and a
   throwaway `id`, then read that row back and confirm the value landed.
   Delete the test row afterward if one was created.
3. Confirm it reaches the client:
   `curl -s https://field-relay-nba.jeffunglesbee.workers.dev/context/date/{today} | head -c 2000`
   and confirm `start_time` now appears as a key on game objects.

**Done condition:** `start_time` is present as a key on `/context/date`
game objects, holding a real value for at least one freshly-ingested game
and `null` for older rows. A response where the key is entirely absent
means Task 2 did not take effect.

---

## Explicitly NOT in scope

- **No backfill.** Historical games have no captured start time. Leave them
  `NULL` — do not derive, estimate, or infer one. A wrong start time is
  worse than a missing one.
- **No `/context/date` handler change.** `SELECT *` already carries new
  columns automatically; touching the handler is unnecessary risk.
- **No client work.** The playground countdown is a separate, later change
  and depends on this shipping first.
- **No format normalization.** Store whatever `gm.startTime` already
  provides. If it turns out to be inconsistent across sports, report that
  in the outbox as a finding — do not silently reformat it here.

---

## Outbox

Last task: write `outbox/cc-session-2026-07-25-start-time-persistence.md`
covering what shipped, the verification output from Task 3 verbatim, the
decision made about the narrower second insert, and the actual format
`start_time` arrives in per sport (which the client will need to know).
