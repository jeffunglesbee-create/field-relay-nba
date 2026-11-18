# Claude Code Command — the CFL archive writer keys `date` on the UTC day; every boundary-crossing row is stamped one day ahead

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba
**Confidence gate:** >= 95 before any commit
**Filed:** 2026-10-16 by chat, read from `src/index.js` blob `92478cc` (commit `176f0c7` when filed — cite the blob, not the commit: an agent rebase on this branch orphans the commit sha and leaves the citation unverifiable, which is what happened to the first version of this line), measured against live `field-archive` (`cc49101c-0569-4d41-8e7a-be139cde4f26`)
**Status:** **DONE — 2026-10-19.** Writer fixed and deployed, 13 rows migrated and verified, guard live in both gates. Session doc: `outbox/cc-session-2026-10-18-cfl-archive-date-keying.md`.

| task | state |
|---|---|
| 1 — `fieldDayOfInstant` helper | **landed** `e6a5078e`, pushed 00:05Z, deploy run 39179159880 green |
| 2 — the CFL writer | **landed** `e6a5078e`. The window stays on `gameDateUtc`; the stamped `date` is `fieldDayOfInstant(t.date)` |
| 3 — migration | **applied** 2026-10-19T00:16Z: one 65-statement transaction through the session's D1 connector (the runner token gets 7403), all 39 guards `ok`. Dry run 39179186247, verify 39180106033: **VERIFIED 13 of 13** |
| 4 — guard | `scripts/check-archive-date-keying.mjs`: 13 → **0 mismatches over 3385 compared rows**. Live in `guards.yml` (`4bd33e08`, run 39180185016) and `deploy.yml` verify (`5e1c067b`, run 39180192675), both green |
| 5 — verify | probe A `keyed_UTC = 0` for every sport (836 rows). New ids 13, old 0. change_log 4 on the new ids, 0 on the old. `/context/date` 13 of 13. Guard mutation CAUGHT on live data in both runs |
| review | ten adversarial findings, nine fixed (`147f375`); the tenth, the timing order, kept |

**The guard fails on purpose and that is correct.** Run today it exits 1 with
`writer helper: "const gameDate = fieldDayOfInstant(t.date);" occurs 0 times in src/index.js; expected exactly 1`.
It was built before the fix it checks for, so it refuses to pass — Rule 90.

**It is deliberately NOT in `guards.yml`**, against TASK 4 as filed, and
`9e76e87` states why: *"That read needs the writer fix on main, so the guard is
not yet in guards.yml: the migration workflow runs it and commits its output,
before the apply (expected to fail, the baseline) and in verify (must pass)."*
Wiring a guaranteed-red guard into push CI is the wallpaper failure
`scripts/odds-coverage.mjs` documents at its own cost. Promoting it to
`guards.yml` is the step that closes TASK 4, and it is not done.

**The tenth review finding is an order, not code** (`147f375`): push the writer
fix only after 2026-10-19T00:00Z, apply only after 00:15Z.

**THIS DOCUMENT IS THE SOURCE OF THE WRITER FIX. A STASH IS A COPY.** Added
2026-10-18 by chat, for the resuming session.

TASK 1 and TASK 2 below specify the change verbatim — the whole
`fieldDayOfInstant` helper, and the `gameDateUtc` / `gameDate` split with its
comments. **Apply them from here.** The scheduled resume task's step 1 names a
`git stash` entry "CFL writer fix (TASK 1/2)" and
`scratchpad/cfl-writer-fix.patch`. Both live on one session's container disk,
which is reclaimed after inactivity, and neither is on any ref: verified
2026-10-18, `origin/main:src/index.js` still reads `_cflToday` /`_cflYday` from
`new Date().toISOString()` at 8940–8941 and `const gameDate = String(t.date ||
'').slice(0, 10)` at 8947.

So: if a stash or patch is there, use it as a convenience and then confirm the
diff matches this document. **If it does not match, this document wins. If it is
gone, that is not a blocker** — write the change from TASK 1 and TASK 2 and say
in the session doc that you did. The fix was never at risk; only a copy of it
was.

This is the repo's own question from `CLAUDE.md`, asked of the fix itself:
*"Is this the source, or a copy of the source?"* A stash is almost always
locally true, which is what would have made it convincing.

**Live state, measured 2026-10-18:** 13 CFL rows still keyed UTC, 0 keyed ET,
and the writer still accrues one per CFL game kicking off after 20:00 ET.

**Status line corrected 2026-10-18 by chat.** It read `NOT STARTED — not
dispatched` while three commits cited this document by task number. Nothing
caught that: unlike `field-laboratory`, this repo has no
`scripts/cc-cmd-status-check.mjs`, so a status may contradict its own
implementation indefinitely. Filed as
`docs/CC-CMD-2026-10-18-relay-governance-guards.md`.

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
| MLB | 333 | 333 | 0 |
| MLS | 133 | 133 | 0 |
| WNBA | 104 | 104 | 0 |
| CFB | 100 | 100 | 0 |
| NHL | 76 | 76 | 0 |
| NBA | 35 | 35 | 0 |
| NFL | 34 | 34 | 0 |
| **CFL** | **13** | **0** | **13** |
| FIFA World Cup | 6 | 6 | 0 |

**821 ET, 13 UTC, 0 ambiguous** (re-probed 2026-10-17T14:10Z; 800/12/0 at
filing on 2026-10-16, and the per-sport figures above are the re-probe). CFL is
the only sport keyed UTC, and it is 100% of CFL's discriminating rows.

**The set grows while the writer is unfixed** — one row per CFL game that kicks
off after 20:00 ET. The thirteenth, `CFL_2026-10-17_e13419748`, finalised at
2026-10-17 10:03 ET, roughly eleven hours after this CC-CMD was filed. Expect a
higher count at dispatch; TASK 0 says what to do about it. The writer is the one at `8947`/`8960`:

```js
const gameDate = String(t.date || '').slice(0, 10);   // 8947
...
date: gameDate,                                        // 8960
```

`t.date` is the vendor's instant (`2026-10-16T23:00:00+00:00`). Slicing it to
ten characters yields the **UTC** calendar day. For a CFL kickoff after 20:00 ET
that is the following day.

Every one is stamped exactly one day ahead, and **the error is in the primary
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
| `CFL_2026-10-17_e13419748` | `2026-10-17T01:30:00+00:00` | 2026-10-16 |

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

42 regular rows, 0 postseason rows, 0 with an empty `start_time` (2026-10-17).
29 of the 42 do not cross UTC midnight and are therefore correct **by
accident** — the writer is wrong for all 42, the stored value is wrong for 13.

---

## TASK 0 — re-probe before writing anything (Rule 87)

Do not trust the numbers above. Re-run them. **Then pin the shape, not the
count.**

The first version of this task said "if any number disagrees, stop and report
verbatim". That was wrong, and it would have halted this CC-CMD on its own
dispatch. The writer is live and unfixed, so the mis-keyed set **grows by one
row per CFL game that kicks off after 20:00 ET**: it went from 12 to 13 in the
eleven hours between filing and the first re-probe, when
`CFL_2026-10-17_e13419748` finalised. A count higher than the one recorded here
is the expected state of an unfixed writer, not evidence that the row set is
untrustworthy. Compute the set at runtime from query B and migrate what it
returns.

Stop and report verbatim on any of these, each of which means this CC-CMD does
not describe what is in the table:

| condition | why it halts |
|---|---|
| any **non-CFL** sport with `keyed_UTC` > 0 | a second writer has the same defect, and TASK 2 does not touch it |
| any row keyed as **neither** ET nor UTC | a third keying exists that this CC-CMD does not describe |
| any **collision** at a corrected id | the operation is a merge, not a rename — not authorised here |
| any reference in **`briefs`**, **`game_thread_notes`** or **`odds_history`** | TASK 3 re-points `change_log` only |
| the mis-keyed count is **below 13** | part of the set has already been migrated; stop rather than half-migrate |

A count at or above 13 with all of the above clean is a green light, whatever
the number.

```sql
-- A. the discriminating census. 821 ET / 13 UTC / 0 neither at 2026-10-17.
--    Expect keyed_UTC to be CFL-only and keyed_ET+keyed_UTC to equal the
--    row count for every sport; the CFL figure itself may be higher.
SELECT sport,
  COUNT(*) AS discriminating_rows,
  SUM(CASE WHEN date = date(start_time,'-4 hours') THEN 1 ELSE 0 END) AS keyed_ET,
  SUM(CASE WHEN date = date(start_time)            THEN 1 ELSE 0 END) AS keyed_UTC
FROM regular_season_games
WHERE start_time IS NOT NULL AND start_time <> ''
  AND date >= '2026-03-09' AND date <= '2026-10-31'
  AND date(start_time) <> date(start_time,'-4 hours')
GROUP BY sport;

-- B. the row set to migrate, with collisions. Expect collision 0 on every row.
SELECT r.id AS old_id,
  'CFL_' || date(r.start_time,'-4 hours') || substr(r.id, length('CFL_' || r.date) + 1) AS new_id,
  (SELECT COUNT(*) FROM regular_season_games x
    WHERE x.id = 'CFL_' || date(r.start_time,'-4 hours') || substr(r.id, length('CFL_' || r.date) + 1)
  ) AS collision_at_new_id
FROM regular_season_games r
WHERE r.sport = 'CFL' AND r.start_time IS NOT NULL AND r.start_time <> ''
  AND date(r.start_time) <> date(r.start_time,'-4 hours');

-- C. inbound references. Expect briefs 0, change_log 4,
--    game_thread_notes 0, odds_history 0 (re-probed 2026-10-17).
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
 * preferred: measured 2026-10-17 over the 834 rows whose UTC day and ET day
 * differ, the 821 non-CFL rows carry the plain ET calendar day of kickoff,
 * 821 of 821. A rollback here would put CFL out of step with those 821 rather
 * than into step.
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
precisely the boundary-crossing games this CC-CMD exists for.

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
    // CFL kickoff after 20:00 ET falls on the next UTC day, so 13 of 42 stored
    // rows were stamped one day ahead -- and the date is embedded in the
    // archive id, so each was a wrong primary key, not just a wrong column.
    // Measured 2026-10-17: 821 of 821 non-CFL discriminating rows key on the
    // ET day; CFL was 0 of 13, the only sport in the table keyed on UTC.
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

`Date.parse` is safe on this feed: all 42 CFL rows carry an explicit `+00:00`
offset (`2026-10-16T23:00:00+00:00`), 42 of 42 measured 2026-10-17, which is also why the
existing `.slice(0, 10)` really is the UTC day rather than a local one.

---

## TASK 3 — migrate the mis-keyed rows (13 at 2026-10-17, and growing)

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
   migration SQL. It is correct for every row in today's set and becomes wrong the
   moment this script is re-run after 2026-11-01.
2. **Rebuild the id by assertion, not by substitution.** Assert
   `old_id.startsWith('CFL_' + old_date)`; if it does not, skip that row and
   report it. Then
   `new_id = 'CFL_' + new_date + old_id.slice(('CFL_' + old_date).length)`.
   A blind `replace(old_date, new_date)` would also rewrite a date appearing
   later in the id.
3. **Re-check the collision at every target id at runtime and abort the whole
   run if any is non-zero.** Measured 0 of 13 on 2026-10-17; a collision would mean a
   correctly-dated sibling row already exists and the operation is a merge, not
   a rename. A merge is NOT authorised by this CC-CMD — stop and report.
4. **Re-point `change_log.game_id`.** Four rows, `consumed = 0`, on two of the
   set (`CFL_2026-08-23_torontoargonauts_hamiltontigercats`,
   `CFL_2026-09-13_e13419731`). `getRecentChanges()` in
   `src/sync-reconciler.js:181` accepts `opts.gameIds` and filters
   `game_id IN (…)`, so an un-repointed row becomes permanently unreachable:
   the retention sweep at `:235` only deletes rows with `consumed = 1`, so it
   would never be cleaned up either.
5. **`briefs` needs no change, and this is the opposite of what the code
   comment predicts.** `src/index.js:13440` warns that "briefs.game_id joins
   games.id in src/analytics-engine.js" — true in general, and **measured at 0
   references for this set**, re-probed 2026-10-17. Do not write a briefs migration on the
   strength of that comment. Re-run probe C; if it returns non-zero, stop and
   report rather than extending the script.
6. `game_thread_notes` and `odds_history` also carry `game_id` — both measured
   at 0 for this set. The code comment names only `briefs`, so the
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
- Expected baseline: **whatever count TASK 0 measured before TASK 3, and 0
  after.** Record both in the file. Do not hardcode 13 — the number at dispatch
  depends on how many CFL games have crossed UTC midnight since filing.

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
3. Confirm every new id exists and every old id does not.
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
- **Do not add a 4am rollback to `fieldDayOfInstant`.** 821/821 says plain ET.
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
thirteen wrong primary keys in place, one of them written while this was being
drafted, because the hypothesis was aimed at the two
writers that agree and the defect was in the two that were never in frame. The
discriminating census was cheap, took one query, and did not depend on the
hypothesis being right. The reusable rule: when a trace is about which
of two candidate values a column holds, measure the column against both
candidates per row before arguing about the writers. Reading the writers finds
the writers you thought of.

## Observed 2026-11-15: the guard fired on a CFB row, the first live mismatch since 2026-10-19

- **What failed.** `Repo guards` run 43662679610 (push `4df1070`, 2026-11-15T01:21Z), step "Every archived game is dated on the ET day of its own kickoff": `checked 4489 rows with a start_time`, 4,471 compared, **1 off their ET day**: `regular_season_games CFB_2026-11-14_e401856887`, sport CFB, `date` 2026-11-14, `start_time` 2026-11-15T18:00Z (ET day 2026-11-15), created 2026-11-14 10:01:36 (Oklahoma v Ole Miss, ESPN event 401856887). The guard's own mutation was CAUGHT in the same run. The previous `Repo guards` run (09a296b, 2026-11-12) was green. The same check is in `deploy.yml`'s verify step (the line next to `check-archive-date-keying`), so **a relay deploy would fail it too**, including the 2026-11-24 landings, until the row is fixed.
- **The game is a real one.** ESPN's status for 401856887 is `Scheduled`; the relay's `/v2/games?sport=cfb&date=2026-11-15` lists it as that day's only CFB game, state `pre`, start 2026-11-15T18:00Z (Memorial Stadium, Norman). Its `change_log` rows: one, `opening_odds` at 2026-11-14T10:02:07Z. `start_time` is not change-logged.
- **Mechanism, consistent with the code and NOT observed.** The archive upsert in `/archive/game` is `ON CONFLICT(id) DO UPDATE SET ... start_time = COALESCE(excluded.start_time, start_time)` and never sets `date`; the id embeds the date the row was created under. So a game whose kickoff later moves to another ET day keeps its old `date` and id and gets the new `start_time`. **The owner stated, 2026-11-15 (their own words, not independently verified): "numerous CFB games were rescheduled this weekend, most notably Oklahoma v Ole Miss".** That settles that this game moved; the row's earlier `start_time` is still not recorded anywhere I can read, so the old kickoff day is not known. At 01:40Z only this row mismatched: 56 CFB rows dated 2026-11-14 (the only one whose `start_time` ET day differs from its `date`), 0 CFB games on the relay's 2026-11-16 slate, the 2026-11-17 slate a normal Tuesday MACtion three. So the other reschedules either stayed inside their ET day or have not been written back to the archive yet; **expect more mismatches if more moved games are re-upserted**. One in 4,471 compared rows says it is rare, not systematic.
- **Not fixed, and why.** The writer is `src/index.js` (the CFL VOID window, 2026-11-08 to 2026-11-23, forbids a `src/index.js` commit); the row is a production write that needs the owner's word. The shapes: update the old row's `date` in place, or delete it once a correctly dated row exists. The daily creation at 10:00Z on 2026-11-15 may insert a second row, `CFB_2026-11-15_e401856887`, for the same game; an in-place update would then leave two rows dated 2026-11-15. A read-only check of that is armed for 2026-11-15T10:35Z (`trig_01XEbEkXn7NskBftGLrPvTQ3`), and it recommends one of: in-place update, delete the stale row, wait for the writer fix on 2026-11-24, or a named exemption (a fallback, not recommended).
- **Standing cost until fixed.** Every push to this repo shows `Repo guards` red on this one step (the later steps still run: 55 of 56 steps passed on `4df1070`); the red hides a second failure only if someone stops reading at the first.
- **Read 2026-11-15 10:36Z, after today's 10:00Z creation (read-only, D1 `field-archive`; nothing written).**
  1. **No duplicate.** Exactly one row exists for ESPN event 401856887, the old `CFB_2026-11-14_e401856887`. Today's creation ran (NBA 9, NFL 12, NHL 5 rows dated 2026-11-15, created 10:00:24 to 10:00:36) and created **no CFB row**, although the relay lists this game on 2026-11-15. Consistent with a dedupe on `espn_event_id` (a comment in `src/index.js` near the archive writer speaks of "archive dedup keyed on espn_event_id"); not confirmed for the creation path.
  2. **Still exactly one mismatch.** All 59 CFB rows dated 2026-11-12 to 2026-11-14, ET day of every `start_time` computed: only Oklahoma v Ole Miss is off its day. No CFB row is dated 2026-11-15 or later.
  3. **The mechanism above is weakened, not confirmed.** The 2026-11-14 batch was created in ascending `start_time` order (created_at 10:00:44 to 10:01:36, kickoffs 17:00Z rising to 2026-11-15T04:00Z), and this row is the LAST of it (10:01:36). A row whose `start_time` was changed after creation would sit in the middle of that order. So it very likely already had its 2026-11-15T18:00Z kickoff when it was created, and was dated 2026-11-14 because it was listed in that day's slate: the writer dated by the slate it iterated, not by `fieldDayOfInstant` of the kickoff (the CFL writer was fixed that way on 2026-10-19; this is the same class, narrower). Whether the 2026-11-14 listing still carries this game is not read (a probe body is cut at 12,000 characters; the relay-read route list does not cover `/v2/games`). Both accounts are inference from the rows and the code; neither is observed.
  4. **Not done:** the relay's full 2026-11-14 and 2026-11-15 CFB listings against the archive ids (item 3 of the armed read), for the reason above. Only this one game is known to be affected.
- **Recommendation (the owner's decision):** leave the row until Oklahoma v Ole Miss finalizes tonight (kickoff 18:00Z, final about 21:30Z), then read whether live archival added a second row. If none: one in-place `UPDATE regular_season_games SET date = '2026-11-15' WHERE id = 'CFB_2026-11-14_e401856887' AND date = '2026-11-14' AND start_time = '2026-11-15T18:00Z'` (1 row; the id stays; undo is the reverse update). If a second, correctly dated row exists: no delete without a plan for the old row's `change_log` and odds rows. Cost of waiting: `Repo guards` stays red on this one step until then, and no relay deploy is planned before 2026-11-24. The writer fix is a separate change in `src/index.js` after 2026-11-23. The armed follow-up `trig_01DrtUC8zfMiPfKvQFP8ttQT` (2026-11-15T23:30Z) applies the update ONLY if this document carries a line `OWNER GO archive date-keying row: <date>`, written from the owner's own words.

- **Read 2026-11-15 23:31Z, after Oklahoma v Ole Miss finalized (trigger `trig_01DrtUC8zfMiPfKvQFP8ttQT`; read-only, D1 `field-archive`; nothing written, the one-row UPDATE was NOT applied).**
  1. **A second row exists, so the condition on the owner's go is not met.** Two rows for ESPN event 401856887, same `start_time` 2026-11-15T18:00Z, same teams and venue:

     | | `CFB_2026-11-14_e401856887` | `CFB_2026-11-15_e401856887` |
     |---|---|---|
     | `date` | 2026-11-14 | 2026-11-15 |
     | `created_at` | 2026-11-14 10:01:36 | 2026-11-15 21:15:31 |
     | score, `finalized_at` | none, none | 24 (Oklahoma) to 17, 2026-11-15 21:15:31 |
     | `opening_odds` | draftkings, captured 2026-11-14T10:02:07Z, moneyline -142 / +120, spread -2.5, total 49.5 | null |
     | `closing_odds` | draftkings, captured 2026-11-14T23:55:04Z, moneyline -147 / +124, total 48.5, kickoff verified | draftkings, captured 2026-11-15T11:55:36Z, moneyline -142 / +120, spread -2.5, total 48.5, kickoff verified |
     | `change_log` | 26626 `odds_api` `opening_odds` (2026-11-14T10:02:07Z); 26722 `odds_backfill` `closing_odds` (2026-11-15 16:51:48) | 26734 `archive_game_closing` `closing_odds` (2026-11-15 21:15:32) |
     | `drama_peak`, `drama_arc` | null, null | 0, the string "null" |

     All three `change_log` rows have `consumed` 0. `bsd_event_id` is null on both.
  2. **The 10:36Z "no duplicate" read was right at 10:36Z and is superseded.** The second row was created at 21:15:31, about 11 hours later, at the moment the game was finalized, under an id that embeds 2026-11-15. The 10:00Z creation job did not make it (10:36Z item 1). Which writer made it is not read here; its `finalized_at`, its `created_at` equal to `finalized_at`, and its `change_log` source `archive_game_closing` (21:15:32) point at the finalization path. That is a reading of the data, not a tested mechanism.
  3. **What was not done, and why.** No write. The owner's "Go" answered the 10:36Z recommendation, which said to update the old row's date "only if no second row for the game exists"; that condition is false, so the go does not apply, and it does not cover any option below (each is a production write that needs its own word). The guard step "Every archived game is dated on the ET day of its own kickoff" stays red on the old row. A fresh count over the 417 rows dated 2026-11-06 or later (golf excluded) found this as the only mismatch.
  4. **Options for the owner, with what each costs.**
     - **A (recommended). Merge forward, then delete the old row.** Copy the old row's `opening_odds` into `CFB_2026-11-15_e401856887`, then delete `CFB_2026-11-14_e401856887`. One row per game, the one with the score and the later closing line, and the opening line kept. Two production writes. The deleted row's two `change_log` rows (26626, 26722) would point at an id that no longer exists; the opening and closing values stay readable in them.
     - **B. Delete the old row only.** One production write. The opening line survives only inside `change_log` row 26626.
     - **C. Re-date the old row to 2026-11-15.** Turns the guard green and leaves two rows for one game on one date, one without a score. Not recommended.
     - **D. Leave both until the writer fix.** No write. `Repo guards` stays red on one step, and `deploy.yml`'s verify step blocks any relay deploy, until the fix lands after the VOID window (2026-11-24 onward). The 2026-11-24 landings (items 3 and the NFL R2 callers) need that step green, so D has a date it stops being viable.
  5. **Probed 2026-11-16, both premises (read-only: code at `origin/main` `397b961`, with `src/`, `workers/`, `scripts/` and `.github/` unchanged through `ca464ce`, plus D1 `field-archive` and one relay GET; nothing written).**
     - **Coverage.** Seven read areas across the four repos. The finders recorded 308 sites; second readers re-opened 230 of them (162 confirmed, 68 corrected; the rule was every flagged site plus up to five unflagged per area, so 78 were not re-opened) and listed 60 more readers they noticed. Two completeness critics searched by name (`change_log` appears in 49 relay files, 3 client, 3 lab, 0 playground; every relay hit line was read) and by consumer (362 files naming a route or a games table) and added 63 sites that nobody re-checked. Unread, named by the census: the WC D1 code (`src/index.js` 2483-3760), the ESPN/BSD/CFL/AFL/NHL adapters (10554-12057) and the MCP tool bodies (20905-22436, grepped only). Nothing was executed except the reads below, so "which row `LIMIT 1` returns" is from code except where measured.
     - **P1: does anything resolve `change_log.game_id` to a games row? No, so A and B drop nothing.**
       1. None of the 371 recorded sites reads `change_log` and then looks a games row up from it. The 27 sites flagged as joining are driven from the games side (a correlated subquery, or an `IN` list built from games ids), so an orphan row is never visited; none errors, drops a figure or re-triggers work.
       2. The one live reader, `getRecentChanges` (`/changelog`, `/freshness`), returns rows raw. `/freshness` matches `change_log.game_id` to `briefs.game_id`. Both briefs of this game carry `game_id` 401856887 (D1, 2026-11-16: `game_live_cfb_401856887`, `game_recap_cfb_401856887`), so a row keyed to either games id matches no brief, before or after a delete.
       3. `consumed` is inert: `markConsumed` has no caller in the four repos, and `cleanupChangelog` deletes only `consumed = 1` rows, so it deletes nothing and never prunes an orphan.
       4. Production already runs on orphans: 16,255 of 26,704 `change_log` rows (61%) have no games row (16,170 are Savant rows keyed by pitcher). The 2026-09-13 cleanup deleted 82 games rows and left their `change_log` rows where they were; nothing in HEAD handles them (read from HEAD, commit history was not readable).
       5. Two scripts read `change_log` by id and refuse: `scripts/migrate-cfl-date-keying.mjs` aborts if `change_log` already has rows on a target id (a dry-run SQL emitter, CFL only), and `scripts/repair-collision-cleanup-changelog.mjs` blocks on a count by source. Neither runs under A or B.
       6. What A should do because of it: write one `change_log` row keyed to the keeper for the copied opening line, as the 2026-09-14 merge did (`scripts/run-symmetric-collision-merge.mjs:157`), so the copy stays attributable.
     - **P2: does anything count rows per game, or look a game up by event id and take any match? Yes, and it already changes what is served.** The finders' classification of all 308 sites for a second row of one game, before the 68 corrections: 83 double-count, 33 pick an arbitrary row, 25 give a wrong figure, 13 error (mostly CI gates), 6 spend credits (LLM calls or odds credits), 19 unclear, 71 unaffected, 58 not applicable. Measured on the real pair:
       1. The query `isGameFinalByEventId` runs (`src/index.js:7959`, `UNION ALL ... LIMIT 1`) returns `finalized_at` null. The old row (rowid 5868, no score) is read before the new one (5902), so a game that finished 24 to 17 reads as not final. `sweepKVBriefs`, `/archive/game` and `/integrity/game-briefs` call it.
       2. `GET /context/game/espn:401856887` serves the OLD row: `home_score` null, `finalized_at` null, the old row's odds. Its `archive.gameBriefs` holds `game_recap_cfb_401856887` (created 2026-11-15 21:16:34) and `game_live_cfb_401856887` (created 2026-11-14 10:04:54) with the same 49-word text, the 24-17 recap. A `game_live` brief carrying final text is what the code predicts when `isGameFinalByEventId` answers false; the writer was not isolated.
       3. By day: CFB 2026-11-14 has 56 rows, 1 unscored (the old row); CFB 2026-11-15 has 1 row (the new one, `opening_odds` null). A per-day count sees the game once on each day. Totals across days (`rows_total` in `/identity/substitution-census`, the drift log's `games`, any payload spanning both dates) count it twice.
     - **Per option.**
       - **A:** the only option after which no row-count or event-id site sees two rows. `LIMIT 1` returns the finalized row, `/context/game` serves the score, and CFB 2026-11-15 has no row with `opening_odds` null, so that date is not a pending odds-backfill pair. Cost: two inert orphans (P1) and the one `change_log` row for the copy.
       - **B:** the same for the P2 sites, but the new row keeps `opening_odds` null: `lineMovement.spreadOpen` is null in `/context/game`, and CFB 2026-11-15 stays a pending (sport, date) pair for `runOddsBackfillForDate`. `pickNextOddsBackfillDate` takes the oldest pending date first (CFB 2026-11-14 has 4 such rows), reaches 2026-11-15 after those are cleared or tried, and the first attempt is one historical-snapshot purchase, about 30 credits by the code's own comment. Not run.
       - **C:** two rows on one date. `LIMIT 1` still returns the old unscored row, so items 1 and 2 above persist, and the pair becomes a same-slate collision: `same_slate_pair_collisions` rises, and `identity-ambiguity-watch`'s condition "no collision whose rows disagree about odds" can open (the rows hold different odds digests; from code, not run). `/context/date`, `/archive/date`, `matchSlate` and `/odds-story/preview` list or count both.
       - **D:** the measured state above continues until the writer fix after 2026-11-23, with `Repo guards` red on one step and the relay deploy gate closed.
     - **The recommendation stands: A.** The probe removed the objection to A (orphans are already the norm and no reader resolves them) and added a cost to D and C that item 4 did not have: the game is served as unscored and not final today.
     - **Not probed:** which writer put final text in `game_live_cfb_401856887`; whether the client payload for the slate spans both dates; the 100-bound-parameter cap in `/freshness` (see the note in `docs/CC-CMD-2026-06-21-brief-freshness-guard.md`).

OWNER GO archive date-keying row: 2026-11-15 (the owner's own word, "Go", in answer to the recommendation of 2026-11-15 10:36Z: one in-place date UPDATE of `CFB_2026-11-14_e401856887`, applied only after Oklahoma v Ole Miss has finalized and only if no second row for the game exists)

OWNER GO archive duplicate row, option A: 2026-11-18 (the owner's own words, "Go with claudes best recommendations", in answer to "reply A, B, C or D" after the 2026-11-16 probe; the recommendation was A: copy the opening line of `CFB_2026-11-14_e401856887` into `CFB_2026-11-15_e401856887`, then delete `CFB_2026-11-14_e401856887`. This covers that one pair and no other row, and no Odds API call.)

- **Found 2026-11-18, before the write: a third table is keyed to the old id.** `odds_history` holds one row for it (`CFB_2026-11-14_e401856887_draftkings_close`, `snapshot_time` 2026-11-14T23:55:04Z, decimal moneylines 1.68 / 2.24, total 48.5 with over 1.89 and under 1.93). Today 0 of 1,556 `odds_history` rows have no games row, so this would be the first. `briefs` hold 2 rows for the event id 401856887 and none for either games id, and `game_thread_notes` hold none for either id, so neither is affected. The over and under prices exist only in that history row (the closing blob in `closing_odds` carries no prices), so deleting it would lose data; the apply left it in place (the reader census and the decision are in the 2026-11-18 verification below).

## 2026-11-18: option A APPLIED (the owner, again the same day: "Option A")

Applied by `scripts/apply-oklahoma-duplicate-option-a.mjs` through the dispatch-only `.github/workflows/apply-oklahoma-duplicate-option-a.yml` (`/d1/execute`, the pattern of `reset-drama-refused-read`), run 44223383680:

- **Before:** `CFB_2026-11-14_e401856887` (2026-11-14, unscored, opening line present) and `CFB_2026-11-15_e401856887` (2026-11-15, 24-17, opening line NULL), exactly as measured beforehand.
- **Copy:** the old row's `opening_odds` into the new row, `changes=1`. **Delete:** the old row, `changes=1`.
- **After:** one row for event 401856887, `CFB_2026-11-15_e401856887`, scored, carrying the copied line byte for byte.
- **Kept:** the one `odds_history` row keyed to the old id, by the plan (its over and under prices exist nowhere else); it is now the table's only orphan. [Superseded 2026-11-18: repointed to the keeper, items 9 and 10.]
- No Odds API call. The writer fix (the upsert that updates `start_time` but never `date`) is still the separate change after 2026-11-23.

## 2026-11-18, second session: independent verification of the apply, the `odds_history` census, and what the apply did not record

Read-only. Another session applied option A (run 44223383680) on the owner's "Option A". This session had been given the same order ("Go with claudes best recommendations"), had built and twice reviewed a guarded four-statement executor for it, and did not run it once the apply was on `main`: nothing was written twice, and that tooling is not in the repo.

1. **State, read from D1 and the relay on 2026-11-18 after the apply.** One row for ESPN event 401856887, `CFB_2026-11-15_e401856887`: 24-17, finalized `2026-11-15 21:15:31`, `opening_odds` present and byte-identical (277 characters) to the old row's opening line as read at about 02:00Z, `closing_odds` unchanged. `GET /context/game/espn:401856887` now serves that row with its score and the opening line (`lineMovement` spreadOpen -2.5, spreadClose -2.5); before the apply it served the unscored old row. `change_log` for the two ids is the same 3 rows (26626, 26722, 26734), `briefs` 2 (keyed by the event id), `odds_history` 1,556 rows of which 1 has no games row.
2. **The guard that went red.** `Repo guards` run 44223368895 (head `0c7a708`): all 56 steps green, including "Every archived game is dated on the ET day of its own kickoff" (02:34:07Z), "CC-CMD status lines are greppable and consistent" and "HANDOFF.md is not stale" — the first fully green run since 2026-11-15. A D1 approximation of the guard (UTC-5, non-golf, `date` >= 2026-11-06) finds 0 mismatches in 449 rows.
3. **The `odds_history` reader census (the decision the 2026-11-18 note above promised).** Read-only, eight agents over `origin/main` `2ea3a22`: relay `src/` (4 of 57 files name the table), `.github/` (6 of 212), `scripts/` (19 of 505), and the other three repos. Every hit line was read; second readers re-opened 40 sites (7, 14, 16 and 3 by area) and corrected 8, none to a harmful effect. **Nothing errors on, flags, repairs, deletes or re-creates a history row that has no games row.** The readers: `GET /odds/history/:game_id` (exact id, no join); analytics Phase 4 (a point lookup by a stored pick id) and Phase 1 (`WHERE date = ?`, result discarded by `void odds`); `.github/scripts/odds-backfill.js` (driven from games, so the row is never selected, and a deleted games row is no longer offered by `/context/date/2026-11-14`, so the id is not re-created); and the scripts (games-driven joins or exact ids; the two whole-table counts in `probe-odds-history-snapshot-time.mjs` are dispatch-only and count it as a row). Not read: 53 of the 57 `src/` files beyond a grep, and `src/index.js` beyond the cited ranges. The review's live lens read the live schema: no foreign keys, and no trigger on `regular_season_games` or `change_log`.
4. **A departure from prior art, on purpose.** The laboratory's MLS merge of 2026-09-03 (`field-laboratory`, `outbox/2026-09-03-mls-merge.md`; 51 pairs, 0 dangling) repointed `change_log` and `odds_history` rows to the survivor. The apply did not, for two reasons that did not apply there: the owner approved option A as filed, which left the two `change_log` rows in place; and the history row is an EARLIER closing snapshot (2026-11-14T23:55:04Z, moneyline 1.68 / 2.24) that disagrees with the keeper's own closing (2026-11-15T11:55:36Z, -142 / +120), so attached to the keeper it would read as a misjoined row to `scripts/repair-odds-wrong-pairs.mjs` and the `captured_at` probes. It stays reachable at its own id with its over and under prices (1.89 / 1.93). If the owner prefers the repoint it is one statement: `UPDATE odds_history SET game_id = 'CFB_2026-11-15_e401856887' WHERE game_id = 'CFB_2026-11-14_e401856887'`. [Superseded 2026-11-18: the owner ordered it; the "misjoined" warning in this item is refuted in item 9, and the guarded form that ran is in item 10.]
5. **What the apply did not record.** Neither write left a `change_log` entry: the copy of the opening line onto the keeper has none, and the deletion has no `row_deleted` entry of the kind the 2026-09-13 cleanup wrote (`docs/CC-CMD-2026-09-13-archive-duplicate-rows.md`, Task 3). Nothing is lost: the old row's opening and closing blobs are in `change_log` 26626 and 26722, its closing line with the over and under prices is in the kept `odds_history` row, and its date, names and ids are in this document. The two entries are a bookkeeping write the owner's go did not name, so they are not written here; if the owner wants them, it is two `INSERT`s into `change_log` (source `archive_duplicate_merge`: a copy entry on the keeper and a `row_deleted` entry on the old id carrying both blobs and naming the keeper), rebuilt from the read of 2026-11-18 02:00Z.
6. **Two sessions, one order.** The owner's order reached two sessions, and the second to act checked `origin/main` and the live state before dispatching anything. The apply script is also safe to re-run (it reads first and reports "already applied" when it finds one scored row carrying a line). The one-shot workflow `apply-oklahoma-duplicate-option-a.yml` stays dispatchable; it changes nothing on a re-run.
7. **Still open, unchanged:** the writer fix (the `/archive/game` upsert updates `start_time` but never `date`, and the finalization path writes under the finalization date) is a `src/index.js` change after the VOID window (2026-11-23); until it lands, the next game moved to another day makes the same pair.

8. **The two audit rows are written (2026-11-18, the owner's "Write the audit rows"; closes item 5).** Exactly two append-only `change_log` inserts, nothing else.
   - **Tooling, committed `e5fe9d4`:** `scripts/write-oklahoma-audit-rows.mjs` (dry run unless `--apply`; reads the archive first and refuses any state other than the one the order was given against; each statement is an `INSERT .. SELECT` that writes only when its own entry is absent and its facts still hold), `scripts/check-write-oklahoma-audit-rows.mjs` (148 checks, including a real child process against an HTTP stand-in for the relay) and `scripts/mutate-write-oklahoma-audit-rows.mjs` (70 mutants in throwaway copies; all 70 turned the check red for their named reason). `.github/workflows/write-oklahoma-audit-rows.yml`: dispatch only, main only, the input must be the literal word `APPLY`.
   - **Dry run, run 44227491296** (log `outbox/oklahoma-audit-rows-dryrun-2026-11-18T03-02-20-995Z.log`, commit `357ae12`): phase `fresh`, 8 of 8 preconditions PASS against the live archive, nothing written.
   - **Apply, run 44227605344** (log `outbox/oklahoma-audit-rows-applied-2026-11-18T03-03-28-044Z.log`, commit `c79ab72`): both statements reported `changes=1`; the writer's re-read passed 12 of 12 checks; the games row and the three existing `change_log` rows were unchanged.
   - **Independent read-back, D1 connector (read-only), after the apply, 6 assertions in SQL, all true:** `change_log` 27069 on `CFB_2026-11-15_e401856887`, source `archive_duplicate_merge`, field `opening_odds`, old NULL, new 277 characters, equal to 26626's `new_value` and to the keeper's `opening_odds`. `change_log` 27070 on `CFB_2026-11-14_e401856887`, field `row_deleted`, `old_value` valid JSON (842 characters) whose `opening_odds` equals 26626's `new_value` and whose `closing_odds` equals 26722's `new_value`, `new_value` the keeper's id. Rows with source `archive_duplicate_merge`: 2; ids 27069 and 27070 are consecutive and the table's maximum id; 26626, 26722 and 26734 are present; the event has 1 games row (24-17); the `odds_history` row on the old id is still there.
   - **Measured, was unmeasured:** D1's `meta.changes` for an `INSERT .. SELECT` through `/d1/execute` is 1 per inserted row.
   - **Read these entries as:** both carry `ts` 2026-11-18T03:03:28.924Z, the time they were written, not the time of the delete in run 44223383680. The source label is in no source set of `src/brief-freshness.js`, so neither entry reads as a change.
   - **Not run live:** a second dispatch. The `done` phase (both entries present and agreeing, writes nothing) is covered by the check, not by a second run. The workflow stays dispatchable.
9. **The `odds_history` repoint: owner go, what was probed first, and what it refuted (2026-11-18).**
   - **OWNER GO.** After the audit rows, the owner said "Repoint the odds_history row": the optional one-statement repoint item 4 documented. The primary key is not part of the order and is not changed.
   - **Premises probed before anything was written (Rule 100), read-only, 5 agents and 342 tool uses.** Three probes (writers and duplicates, consumers and the misjoin warning, the MLS precedent) and two skeptics over the relay (108 of 108 files naming the table swept by regex, 15 of 32 code-bearing files read in context), the laboratory (5 of 2,146 files name it) and the client (1 of 4,445). Verdicts: the writes skeptic UNSAFE-CONDITIONAL (it arms two latent paths), the reads skeptic SAFE TO RUN AS ORDERED, nothing blocking.
   - **Item 4's warning is refuted.** "Attached to the keeper it would read as a misjoined row to `scripts/repair-odds-wrong-pairs.mjs`" is false: the script has no mismatch predicate, works only from three closed lists of literal ids (the event id appears 0 times in it), writes nothing itself, and no workflow or `package.json` runs it. The "captured_at probes" half is true and meaningless: one read-only, dispatch-only line, among 708 of 1,555 joined rows that already differ.
   - **Item 3's "driven from games, so the row is never selected" holds only for the orphan.** The sync half of `.github/scripts/odds-backfill.js` selects history rows by `game_id` for games whose `opening_odds` or `closing_odds` is NULL. Attached to the keeper, this row becomes a candidate there.
   - **Two latent paths the repoint arms, neither live today, both needing a manual data-destroying step.** (1) If a keeper blob is ever NULLed, the daily sync refills it from this earlier snapshot (-147/+124, captured 2026-11-14T23:55:04Z) over the real one (-142/+120). (2) If the `odds_backfill_progress` row for 2026-11-15 is ever deleted, a reprocess inserts `CFB_2026-11-15_e401856887_draftkings_close` beside this row: that backfill dedupes by primary key only and the table has no unique index on (game_id, bookmaker, snapshot_type). The writer refuses to run unless both keeper blobs are non-NULL, the progress row exists and the new-style id is free. After the write both conditions stand: before NULLing a keeper blob or resetting progress for 2026-11-15, delete or re-id this history row first.
   - **What was not done, and why.** The primary key is not renamed: it is outside the order, the laboratory's MLS merge left ids alone on its 20 repoints, and a rename closes the duplicate path only, not the refill. If the owner wants it, it is one more statement (`id` to `CFB_2026-11-15_e401856887_draftkings_close`, guarded the same way). No `change_log` entry is written for the repoint: none was ordered, and the old game id stays recoverable from the primary key's prefix, from `change_log` 27070 and from this document.
   - **Two data-shape firsts, recorded because no reader compares them.** The row's `date` (2026-11-14) will differ from its games row's `date` (2026-11-15): the first of 1,556. Its primary key will not start with its `game_id`: the first non-MLS row (20 MLS rows today).
   - **A spent one-shot goes stale.** `scripts/write-oklahoma-audit-rows.mjs` pins "one `odds_history` row on the old id". After the repoint a re-dispatch of `write-oklahoma-audit-rows.yml` refuses (exit 1, nothing written to D1) and commits a refused log, where item 8 says it prints ALREADY DONE. Not changed: a reviewed, applied plan.
   - **Pre-flight.** The statement's `WHERE` predicate, run as a `SELECT` on D1's own engine on 2026-11-18: 1 row. Dry run, run 44239518896 (log `outbox/oklahoma-odds-history-repoint-dryrun-2026-11-18T04-45-54-784Z.log`): phase `fresh`, 8 of 8 preconditions PASS, nothing written.
   - **Tooling, committed `0356907`:** the writer, a check of 153 assertions on a real SQLite, a harness of 87 mutants (all caught for their named reason) and a dispatch-only workflow. A four-lens adversarial review (SQL and engine, false OK, workflow, scope) returned safe-to-run from all four; its gaps (an unbacked dry-run default, workflow assertions narrower than their labels, a secret-leak test reading the wrong output, an overstated success line, a retyped table regex) are closed in that commit, each with a mutant.
10. **The repoint is applied and verified (2026-11-18).**
   - **Apply, run 44239772368** (head `f4c2ccb`; log `outbox/oklahoma-odds-history-repoint-applied-2026-11-18T04-48-19-079Z.log`, commit `b8b5dfe`): preconditions 8 of 8 PASS, `changes=1`, the writer's own re-read 9 of 9 PASS. The dry run before it (44239518896) ran the same `scripts/` and `.github/`: a diff of those two directories between the dry run's log commit and the apply's head is empty.
   - **Independent read-back, D1 connector (read-only), after the apply.** The row `CFB_2026-11-14_e401856887_draftkings_close` now has `game_id` `CFB_2026-11-15_e401856887`; its primary key and its 15 other columns equal what was read before the write (its `date` is still 2026-11-14). Rows on the old game id 0, on the keeper 1, under the new-style id 0. The table holds 1,556 rows, as before, with 1,556 distinct (game_id, bookmaker, snapshot_type) triples; history rows with no games row 0 (it was 1); rows whose id does not start with their `game_id` 21 (20 MLS and this one). The event has one games row (24-17) whose blobs are 277 and 347 characters, unchanged; `change_log` 26626, 26722, 26734, 27069 and 27070 are all present; the 2026-11-15 progress row is present; the daily sync's candidate predicate matches 0 rows for the keeper.
   - **Measured, was unmeasured:** `meta.changes` for a guarded `UPDATE` with correlated subqueries through `/d1/execute` is 1 per row moved.
   - **The two conditions item 9 named now stand.** Before NULLing a keeper blob or resetting the 2026-11-15 progress row, delete or re-id this history row.
   - **Supersedes** item 4's last paragraph and its "misjoined" warning (refuted in item 9), and the "table's only orphan" sentence under Kept: the table now has no history row without a games row.
   - **Not run live:** a second dispatch. The `done` phase (the row already on the keeper, nothing written) is covered by the check, not by a second run. The workflow stays dispatchable.
