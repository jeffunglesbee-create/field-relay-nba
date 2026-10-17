# Claude Code Command — the CFL archive writer keys `date` on the UTC day; 12 rows are stamped one day ahead

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba
**Confidence gate:** >= 95 before any commit
**Filed:** 2026-10-16 by chat, read from `src/index.js` blob `92478cc` (commit `176f0c7` when filed — cite the blob, not the commit: an agent rebase on this branch orphans the commit sha and leaves the citation unverifiable, which is what happened to the first version of this line), measured against live `field-archive` (`cc49101c-0569-4d41-8e7a-be139cde4f26`)
**Status:** NOT STARTED — not dispatched.

Found while tracing a different hypothesis. The hypothesis was wrong and the
trace found a real defect next to it; both halves are recorded because the
wrong half is the reusable part.

---

## What was being looked for, and why it is not the defect

field-laboratory's `Desk.fs` rolls its `FieldDay` at **midnight ET**. This
repo's `getFieldDateKey()` rolls at **4am ET**:

```js
const etHour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }), 10);
const etDateBase = new Date();
if (etHour < 4) etDateBase.setTime(etDateBase.getTime() - 24 * 60 * 60 * 1000);
```

`Desk.fs`'s `fieldDayOfIso` **asserts** that this repo's `date` column is a
FIELD-zone day. Two different rollovers against one asserted contract is a
defect shape, so the column's writer was traced.

**The trace, and it closes cleanly:**

1. `date` on `regular_season_games` / `postseason_games` is written at INSERT
   only, by `POST /archive/game` (binds at `src/index.js:13480`, `13517`), from
   the request body. **No `UPDATE` sets it. No `ON CONFLICT` clause re-sets
   it.** Verified by scanning every `UPDATE` against both tables: the eight that
   exist set `importance`, `went_to_ot`, `drama_peak`/`drama_arc`,
   `home_score`/`away_score`/`espn_event_id`/`finalized_at`. None touches
   `date`.
2. Four in-worker callers, all inside `handleJournalismCycle`
   (`src/index.js:8086`–`9694`), driven by the `*/15` cron at `9781`:

   | line | `date:` value | keying |
   |---|---|---|
   | 8683 | `dateKey` = `getFieldDateKey()` | ET, 4am rollback |
   | 8786 | `dateKey` = same | ET, 4am rollback |
   | 8887 | `yesterdayKey` = `new Date(Date.now()-86400000).toISOString().slice(0,10)` | **UTC** |
   | 8960 | `gameDate` = `String(t.date \|\| '').slice(0, 10)` (CFL) | **vendor UTC** |

3. **The 4am branch cannot execute on this path.** Line 8098:

   ```js
   const hour = new Date().getUTCHours();
   const isLiveHours = hour >= 10 || hour <= 2;
   ```

   The dead band is UTC 3–9, and every path inside that block returns
   (`8355`, `8357`, `8376`, `8379`) before the archive catch-up at `8382`.
   `getFieldDateKey()`'s rollback fires at ET 00:00–03:59, which is UTC 04–07
   under EDT and UTC 05–08 under EST. **Both windows sit entirely inside the
   dead band, under both DST regimes.** The only writer that reads that clock
   never runs in the hours the rollback applies to.

So on the `date` column, `getFieldDateKey()` behaves as a plain ET calendar day,
which **agrees** with `Desk.fs`. The midnight-vs-4am divergence is latent. It is
not the defect and must not be "fixed" — see FORBIDDEN below.

---

## The defect the measurement found instead

Each row where the UTC day and the ET day of `start_time` differ casts a vote on
which keying produced its `date`. Measured 2026-10-16 across the EDT band
(`date` between 2026-03-09 and 2026-10-31):

| sport | discriminating rows | keyed ET | keyed UTC |
|---|---|---|---|
| MLB | 332 | 332 | 0 |
| MLS | 126 | 126 | 0 |
| WNBA | 104 | 104 | 0 |
| CFB | 91 | 91 | 0 |
| NHL | 72 | 72 | 0 |
| NBA | 35 | 35 | 0 |
| NFL | 34 | 34 | 0 |
| **CFL** | **12** | **0** | **12** |
| FIFA World Cup | 6 | 6 | 0 |

**800 ET, 12 UTC, 0 ambiguous.** CFL is the only sport keyed UTC, and it is
100% of CFL's discriminating rows. The writer is the one at `8947`/`8960`:

```js
const gameDate = String(t.date || '').slice(0, 10);   // 8947
...
date: gameDate,                                        // 8960
```

`t.date` is the vendor's instant (`2026-10-16T23:00:00+00:00`). Slicing it to
ten characters yields the **UTC** calendar day. For a CFL kickoff after 20:00 ET
that is the following day.

All twelve are stamped exactly one day ahead, and **the error is in the primary
key as well as the column**, because `id` embeds it
(`id = ${sport}_${date}_${idTail}`, `src/index.js:13458`–`13462`):

| current id | `start_time` | correct ET day |
|---|---|---|
| `CFL_2026-06-06_calgarystampeders_winnipegbluebombers` | `2026-06-06T01:00:00+00:00` | 2026-06-05 |
| `CFL_2026-08-08_saskatchewanroughriders_ottawaredblacks` | `2026-08-08T01:00:00+00:00` | 2026-08-07 |
| `CFL_2026-08-14_calgarystampeders_bclions` | `2026-08-14T01:00:00+00:00` | 2026-08-13 |
| `CFL_2026-08-15_winnipegbluebombers_ottawaredblacks` | `2026-08-15T00:30:00+00:00` | 2026-08-14 |
| `CFL_2026-08-22_edmontonelks_winnipegbluebombers` | `2026-08-22T01:30:00+00:00` | 2026-08-21 |
| `CFL_2026-08-23_torontoargonauts_hamiltontigercats` | `2026-08-23T00:06:00+00:00` | 2026-08-22 |
| `CFL_2026-08-29_winnipegbluebombers_montrealalouettes` | `2026-08-29T00:30:00+00:00` | 2026-08-28 |
| `CFL_2026-09-13_e13419731` | `2026-09-13T02:14:00+00:00` | 2026-09-12 |
| `CFL_2026-09-26_e13419735` | `2026-09-26T00:00:00+00:00` | 2026-09-25 |
| `CFL_2026-09-26_e13419736` | `2026-09-26T02:30:00+00:00` | 2026-09-25 |
| `CFL_2026-10-03_e13419740` | `2026-10-03T01:30:00+00:00` | 2026-10-02 |
| `CFL_2026-10-10_e13419744` | `2026-10-10T02:12:00+00:00` | 2026-10-09 |

### The consumer this breaks

field-laboratory's `Program.fs:51`:

```fsharp
queryParam "date" |> Option.defaultValue (Desk.fieldDayIso (Desk.fieldToday ()))
```

feeds `RELAY_DATE + viewedDate ()` (`Program.fs:24`, `77`) →
`GET /context/date/<D>` → `SELECT * FROM regular_season_games WHERE date = ?`.
A viewer on the correct ET day of a late CFL kickoff does not see the game; a
viewer on the following day sees it on a day it was not played.

### CFL scope, measured

41 regular rows, 0 postseason rows, 0 with an empty `start_time`. 29 of the 41
do not cross UTC midnight and are therefore correct **by accident** — the
writer is wrong for all 41, the stored value is wrong for 12.

---

## TASK 0 — re-probe before writing anything (Rule 87)

Do not trust the numbers above. Re-run them. If any disagrees, **stop and
report verbatim** — a changed count means something wrote to these tables since
this was filed and the migration's row set is no longer the one it was written
for.

```sql
-- A. the discriminating census. Expect 800 ET / 12 UTC / 0 neither.
SELECT sport,
  COUNT(*) AS discriminating_rows,
  SUM(CASE WHEN date = date(start_time,'-4 hours') THEN 1 ELSE 0 END) AS keyed_ET,
  SUM(CASE WHEN date = date(start_time)            THEN 1 ELSE 0 END) AS keyed_UTC
FROM regular_season_games
WHERE start_time IS NOT NULL AND start_time <> ''
  AND date >= '2026-03-09' AND date <= '2026-10-31'
  AND date(start_time) <> date(start_time,'-4 hours')
GROUP BY sport;

-- B. collisions at the corrected ids. Expect 0 for all 12.
SELECT r.id AS old_id,
  'CFL_' || date(r.start_time,'-4 hours') || substr(r.id, length('CFL_' || r.date) + 1) AS new_id,
  (SELECT COUNT(*) FROM regular_season_games x
    WHERE x.id = 'CFL_' || date(r.start_time,'-4 hours') || substr(r.id, length('CFL_' || r.date) + 1)
  ) AS collision_at_new_id
FROM regular_season_games r
WHERE r.sport = 'CFL' AND r.start_time IS NOT NULL AND r.start_time <> ''
  AND date(r.start_time) <> date(r.start_time,'-4 hours');

-- C. inbound references. Expect briefs 0, change_log 4,
--    game_thread_notes 0, odds_history 0.
WITH bad AS (
  SELECT id FROM regular_season_games
  WHERE sport = 'CFL' AND start_time IS NOT NULL AND start_time <> ''
    AND date(start_time) <> date(start_time,'-4 hours')
)
SELECT 'briefs' AS ref, COUNT(*) AS n FROM briefs WHERE game_id IN (SELECT id FROM bad)
UNION ALL SELECT 'change_log',        COUNT(*) FROM change_log        WHERE game_id IN (SELECT id FROM bad)
UNION ALL SELECT 'game_thread_notes', COUNT(*) FROM game_thread_notes WHERE game_id IN (SELECT id FROM bad)
UNION ALL SELECT 'odds_history',      COUNT(*) FROM odds_history      WHERE game_id IN (SELECT id FROM bad);
```

`-4 hours` is correct **only** for these probes: every row in the table that has
a `start_time` falls inside the 2026 EDT band. Measured — the table's `date`
range is 2026-03-05 to 2026-11-07, and rows outside 2026-03-08..2026-11-01 with
a non-empty `start_time` number **zero**. Production code and the guard must
still use the IANA zone, not this offset. See TASK 4.

`pragma_table_info` returns `SQLITE_AUTH` through the D1 MCP tool; read the
schema from `sqlite_master.sql` if you need column lists. A compound `SELECT`
of more than four `UNION ALL` terms returns
`too many terms in compound SELECT`; split it.

---

## TASK 1 — add an instant→FIELD-day helper

Add beside `getFieldDateKey()` in `src/index.js`. It is a **new** function; do
not modify `getFieldDateKey()`.

```js
/**
 * The FIELD-zone (America/New_York) calendar day containing a GIVEN instant.
 *
 * NOT getFieldDateKey(), which reads the CURRENT clock and rolls back before
 * 4am ET to answer "which slate is live now". This answers "which day did this
 * kickoff belong to" — a different question — and takes the instant as an
 * argument, so it is testable at fixed points rather than only during the four
 * hours a night that are hard to reach.
 *
 * PLAIN ET day, with no 4am rollback, and that is measured rather than
 * preferred: of 812 rows whose UTC day and ET day differ, the 800 non-CFL rows
 * carry the plain ET calendar day of kickoff, 800/800. A rollback here would
 * put CFL out of step with the other 800 rather than into step.
 *
 * Via the IANA zone name, not a fixed offset. EST resumes on 2026-11-01 and a
 * hardcoded -4 would start mis-dating evening games that day. Same
 * `toLocaleDateString('en-CA', { timeZone: … })` idiom as getFieldDateKey()'s
 * own last line, so the runtime's ICU support for it is already proven in
 * production rather than assumed here.
 *
 * Returns null on absent or unparseable input. There is deliberately no
 * fallback: the date is embedded in the archive primary key, so a guessed day
 * is a wrong key, and a wrong key is silent where a skip is loud.
 */
function fieldDayOfInstant(value) {
    if (value === null || value === undefined || value === '') return null;
    const t = Date.parse(value);
    if (Number.isNaN(t)) return null;
    return new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}
```

---

## TASK 2 — fix the CFL writer

**Read the whole loop before editing. `gameDate` does double duty and a
one-line substitution silently narrows the retry window for exactly the games
this CC-CMD is about.**

Current, `src/index.js:8946`–`8950`, verbatim:

```js
for (const t of (round?.tournaments || [])) {
    if (t?.status !== 'complete') continue;
    const gameDate = String(t.date || '').slice(0, 10);
    if (gameDate !== _cflToday && gameDate !== _cflYday) continue;
```

against, at `8942`–`8943`:

```js
const _cflToday = new Date().toISOString().slice(0, 10);
const _cflYday  = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
```

Both bounds are **UTC** days. So the one `gameDate` value is used for two
different jobs: a recency window (compared against UTC bounds) and the stamped
archive `date` (which must be the ET day). Replacing it in place with an ET day
would compare ET days against UTC bounds.

That is not a cosmetic mismatch. For a game whose UTC day V is one ahead of its
ET day E, the window changes from `V ∈ {U, U−1}` to `E ∈ {U, U−1}` for a cron
run on UTC day U — which moves the window one day earlier, so one of its two
days now falls **before the game kicks off**. The game is still written on the
UTC day it completes, so nothing is lost outright, but the retry coverage for
boundary-crossing CFL games drops from two useful UTC days to one. Those are
precisely the twelve games this CC-CMD exists for.

**Split the two uses. Do not touch `_cflToday` or `_cflYday`** — they are a
"recent two days" window, not a slate identity, and UTC is a fine basis for
that. Keeping them unchanged makes the window byte-identical to today's
behaviour.

```js
for (const t of (round?.tournaments || [])) {
    if (t?.status !== 'complete') continue;
    // CC-CMD-2026-10-16-cfl-archive-date-keying. This value was doing two jobs
    // under one name: the recency window below AND the stamped archive `date`.
    // Only the second was wrong, so only the second changes. The window stays
    // on the UTC day and stays compared against the UTC `_cflToday`/`_cflYday`
    // bounds -- an ET day here would shift the window a day earlier and halve
    // the retry coverage for the boundary-crossing games this fixes.
    const gameDateUtc = String(t.date || '').slice(0, 10);
    if (gameDateUtc !== _cflToday && gameDateUtc !== _cflYday) continue;

    // The stamped value. Was `gameDateUtc`, which is the UTC calendar day: a
    // CFL kickoff after 20:00 ET falls on the next UTC day, so 12 of 41 stored
    // rows were stamped one day ahead -- and the date is embedded in the
    // archive id, so each was a wrong primary key, not just a wrong column.
    // Measured: 800 of 800 non-CFL discriminating rows key on the ET day;
    // CFL was 0 of 12, the only sport in the table keyed on UTC.
    const gameDate = fieldDayOfInstant(t.date);
    if (!gameDate) {
        console.error(`[ARCHIVE-CFL] unparseable vendor date ${JSON.stringify(t.date)} for event ${t.id || '(no id)'} — skipping this archive write rather than stamping a guessed day`);
        continue;
    }
```

`date: gameDate` at `8960` then needs no edit, which is the point of keeping the
name: the POST body is unchanged and the diff is confined to the two lines that
compute the values.

`continue` is valid here — the site is the inner body of nested `for…of` loops
(`for (const round of rounds)` at `8945`, `for (const t of …)` at `8946`), and
the `status !== 'complete'` guard on the next line already uses it.

**Do not route the empty-date case through `/archive/game`'s
`if (!sport || !date)` 400** on the theory that it already catches this. That is
a fallback dressed as a guard, and it moves the failure to a place where the
vendor id is out of scope to log.

`Date.parse` is safe on this feed: all 41 CFL rows carry an explicit `+00:00`
offset (`2026-10-16T23:00:00+00:00`), 41 of 41 measured, which is also why the
existing `.slice(0, 10)` really is the UTC day rather than a local one.

---

## TASK 3 — migrate the 12 rows

New file `scripts/migrate-cfl-date-keying.mjs`. Dry-run by default; applies only
with `--apply`.

Per row, in one batch:

```sql
UPDATE change_log            SET game_id = ?2            WHERE game_id = ?1;
UPDATE regular_season_games  SET id = ?2, date = ?3      WHERE id = ?1;
```

Requirements, each of which is a real hazard:

1. **Compute the new day in JS with the same `Intl` call as TASK 1**, from each
   row's own `start_time`. Do not use `date(start_time,'-4 hours')` in the
   migration SQL. It is correct for today's twelve rows and becomes wrong the
   moment this script is re-run after 2026-11-01.
2. **Rebuild the id by assertion, not by substitution.** Assert
   `old_id.startsWith('CFL_' + old_date)`; if it does not, skip that row and
   report it. Then
   `new_id = 'CFL_' + new_date + old_id.slice(('CFL_' + old_date).length)`.
   A blind `replace(old_date, new_date)` would also rewrite a date appearing
   later in the id.
3. **Re-check the collision at every target id at runtime and abort the whole
   run if any is non-zero.** Measured 0/12 at filing; a collision would mean a
   correctly-dated sibling row already exists and the operation is a merge, not
   a rename. A merge is NOT authorised by this CC-CMD — stop and report.
4. **Re-point `change_log.game_id`.** Four rows, `consumed = 0`, on two of the
   twelve (`CFL_2026-08-23_torontoargonauts_hamiltontigercats`,
   `CFL_2026-09-13_e13419731`). `getRecentChanges()` in
   `src/sync-reconciler.js:181` accepts `opts.gameIds` and filters
   `game_id IN (…)`, so an un-repointed row becomes permanently unreachable:
   the retention sweep at `:235` only deletes rows with `consumed = 1`, so it
   would never be cleaned up either.
5. **`briefs` needs no change, and this is the opposite of what the code
   comment predicts.** `src/index.js:13440` warns that "briefs.game_id joins
   games.id in src/analytics-engine.js" — true in general, and **measured at 0
   references for these twelve**. Do not write a briefs migration on the
   strength of that comment. Re-run probe C; if it returns non-zero, stop and
   report rather than extending the script.
6. `game_thread_notes` and `odds_history` also carry `game_id` — both measured
   at 0 for these twelve. The code comment names only `briefs`, so the
   referencing surface is four tables, not one. Probe all four.
7. Print the full before/after table and the row counts each `UPDATE` reports.
   A `changes` count that is not 1 per statement is a failure, not a warning.

---

## TASK 4 — the guard that could have caught this

New file `scripts/check-archive-date-keying.mjs`, wired into the same gate the
other relay guards run from.

**Why the existing check could not catch it.** `Desk.fs`'s ZONE-PROOF note
records this measurement, verbatim:

> across a live 18-game slate, 8 games start on a LATER UTC day than their
> `date` and none start earlier. The date runs behind UTC, never ahead —
> Western-hemisphere keying, consistent with ET and inconsistent with UTC.

A UTC-keyed row scores **equal**, not earlier. Equal rows are also what plain ET
keying produces for every game that does not cross UTC midnight, so the test
cannot separate them. The measurement discriminated ET from UTC in aggregate and
was then read as establishing a single keying for every row. This is the same
class as `/bsd/contract`'s away-only goal: a claim whose evidence could not have
falsified it.

The guard must therefore compare **each row against the ET candidate**, not test
an inequality direction:

- Query `regular_season_games` and `postseason_games` for rows with a non-empty
  `start_time`.
- For each, compute `fieldDayOfInstant(start_time)` in JS via `Intl` with
  `America/New_York`, and compare to `date`.
- Exit **1** on any mismatch, listing every offending row. Not a report that
  exits 0 — `scripts/check-absence-collapse.mjs` in jubilant-bassoon prints 263
  flagged rows and exits 0 because `failed` is only ever set by its `--require`
  path, and a guard that cannot fail is documentation.
- Expected baseline: **12 before TASK 3, 0 after.** Record both in the file.

**Exempt exactly two sport labels, by exact string match:** `'golf'` and
`'PGA Tour'`. Rule 50 — no substring matching; do not test for `'golf'` as a
substring, because `'PGA Tour'` does not contain it and a future `'LPGA'` label
would need its own entry rather than a pattern.

The reason for the exemption is structural and measured, not a tolerance: for
golf, `start_time` is the **tournament** start and `date` is the **round** date,
so they are different quantities and the comparison is meaningless. Four rows
share `espn_event_id = 401850916` and the single `start_time`
`2026-10-08T04:00Z` while their `date` steps 2026-10-09, -10, -11, -12. This
matches the per-tournament id convention already documented at
`src/index.js:13358`–`13364`. Write that reason into the file; an exemption
without its reason becomes a tolerance nobody can re-derive.

**Self-test fixtures, run on every invocation.** Include at minimum these two,
which are the ones that fail a fixed-offset implementation in opposite
directions:

| `start_time` | correct ET day | a `-4` impl says | a `-5` impl says |
|---|---|---|---|
| `2026-11-10T04:30:00Z` (EST) | 2026-11-09 | 2026-11-10 ✗ | 2026-11-09 ✓ |
| `2026-07-10T04:30:00Z` (EDT) | 2026-07-10 | 2026-07-10 ✓ | 2026-07-09 ✗ |

Neither offset passes both. Also fixture: a golf row (must be skipped, not
passed), an empty `start_time` (must be skipped, not treated as a mismatch), and
a garbage `start_time` (must be reported as unparseable, not silently skipped —
`fieldDayOfInstant` returns `null` for both the empty and the garbage case, and
the guard must distinguish them).

---

## TASK 5 — verify

1. Re-run probe A. Every sport, `keyed_UTC` = 0.
2. Re-run the guard. Exit 0, and its own output states 0 mismatches over the
   full row count it checked — not "no output".
3. Confirm the twelve new ids exist and the twelve old ids do not.
4. Confirm `change_log` has 4 rows on the two new ids and 0 on the two old ones.
5. `GET /context/date/2026-10-09` includes `BC Lions` v `Ottawa RedBlacks`, and
   `GET /context/date/2026-10-10` no longer does.
6. Mutation test the guard: flip one row's `date` by a day in a scratch copy, or
   feed the fixture set a deliberately UTC-keyed row, and confirm the guard
   exits 1. A guard that has never been observed failing has not been tested.

---

## FORBIDDEN

- **Do not change `getFieldDateKey()`**, and do not "reconcile" its 4am rollback
  with `Desk.fs`'s midnight. The rollback is unreachable on the `date` path
  (dead-hour gate, UTC 3–9, both DST regimes) and is load-bearing for the
  journalism KV keys and the BSD endgame capture, which are different callers
  with a different question. Touching it to fix a divergence that does not bite
  would be a change with no measurement behind it.
- **Do not add a 4am rollback to `fieldDayOfInstant`.** 800/800 says plain ET.
- **Do not migrate the 29 CFL rows that currently agree.** Their stored value is
  correct; only the writer was wrong. Rewriting them would churn 29 primary keys
  for no change in value.
- **Do not fix the `yesterdayKey` writer here.** See below.
- No PR. Commit to `main`. `[skip ci]` on the docs-only commit, not on the code
  commits.

---

## Noted, not authorised — each wants its own CC-CMD

1. **`yesterdayKey` asks for the wrong slate for three hours a day.**
   `src/index.js:8809` computes UTC-now minus 24h. Between UTC 00:00 and 02:59
   (ET 20:00–22:59 EDT) that is the **current** ET date, so the "yesterday
   catch-up" re-fetches today and yesterday's late finals go unfilled until
   ET 06:00. It writes no mis-dated row — the same key feeds both the ESPN
   `?dates=` fetch and the stamp, and ESPN's calendar is itself ET-keyed, which
   is why probe A shows zero non-CFL UTC-keyed rows. A coverage gap, not a data
   defect. Do not bundle it.
2. **Label fragmentation remnant.** `regular_season_games` holds 256 rows under
   `WNBA` and 20 under `wnba`. All 20 have an empty `start_time`, so they are
   invisible to the guard either way.
3. **`getRecentChanges` swallows every error.** `src/sync-reconciler.js`
   `catch (_) { return []; }` — a query failure is indistinguishable from "no
   changes". Rule 99 shape: absence is not a sibling of the value.
4. **Closing odds captured after kickoff on two CFL games.** The
   `kickoff_backstamp` rows in `change_log` carry `late_minutes: 160` and
   `207`, with `verified: false`. Same two games as the `change_log` references
   above; noticed in passing, unrelated to the date keying.

---

## Why this was filed as its own CC-CMD

The original question — "do the two rollovers diverge?" — had a clean answer
(yes) and a clean consequence (no). Reporting that and stopping would have left
twelve wrong primary keys in place, because the hypothesis was aimed at the two
writers that agree and the defect was in the two that were never in frame. The
discriminating census was cheap, took one query, and did not depend on the
hypothesis being right. The reusable rule: when a trace is about which
of two candidate values a column holds, measure the column against both
candidates per row before arguing about the writers. Reading the writers finds
the writers you thought of.
