# CC-CMD-2026-09-13-archive-duplicate-rows

**Filed 2026-09-13 by the session that found it.** Rule 87.4: the dedup is out of
scope for the ambiguity work, so it gets its own CC-CMD before that one closes.

**Not started. Nothing here is authorised — every task below is read-only until
the owner approves the deletion, which is a live D1 mutation of archive rows.**

## What was measured

`GET /identity/substitution-census` now reports `same_slate_pair_collisions`: two
rows in one `(table, date, sport)` whose `${hk}|${ak}` join key is identical.
Archive-wide, from `outbox/identity-ambiguity-watch-20260913T214253Z.json`:

```
coverage:    scanned 3237 of 3237 rows across 2 tables
collisions:  197, over 3024 distinct join keys across 625 slates
```

~~Every one is exactly 2 rows. **Every one is the same real game stored twice**,
written by producers using four different id schemes:~~

**CORRECTED 2026-09-13 by Task 1.** Both halves of that sentence are wrong.
There are **two producers, not four** — this relay has exactly one INSERT path
into these tables (`/archive/game`, minting three id shapes from one ternary) and
one external writer that this repository cannot write from at all. And **one of
the 197 is not a duplicate**: 2026-09-04 Guardians–Tigers is a doubleheader, two
real games. The original table is kept below because the id-scheme counts in it
are accurate; only the inference from scheme to producer was wrong.



| n | id scheme A | id scheme B | example |
|---:|---|---|---|
| 82 | `MLS_MLS-COM-00000K_R32-02_round1_2026-02-04` | `MLS_2026-02-04_sandiegofc_pumas` | postseason, competition-structured vs slug |
| 35 | `FIFA World Cup 2026_2026-07-22_austin_seattle` | `2026-07-22-mls-atx-sea` | id says World Cup, `sport` column says MLS |
| 34 | `MLB_2026-09-02_e401816785` | `2026-09-02-mlb-…` | ESPN event id vs date-first cron id |
| 30 | `MLS_2026-08-08_newengland_houston` | `2026-08-08-mls-ne-hou` | slug vs date-first cron id |
| 15 | `MLB_…_e401816785` | `MLB_…_angels_yankees` | two producers, neither the cron |
|  1 | `…_espnid` | `…_espnid` | |

By sport: MLS 181, MLB 16. By table: `regular_season_games` 115,
`postseason_games` 82.

## What this is NOT

**No false facts were found, and that was the thing being looked for.** 68 of the
197 have odds on both rows. In every case both rows name the same two teams, so
the odds are correct for both — duplicated, not wrong. The two rows whose
FIFA-prefixed side carries a closing line are the closest call and they are
clean:

```
2026-07-25  MLS  dcunited|torontofc
  2026-07-25-mls-dc-tor                       D.C. United vs Toronto FC    open+close
  FIFA World Cup 2026_2026-07-25_dcunited_toronto  D.C. United vs Toronto  close only
2026-08-01  MLS  dcunited|nashvillesc
  2026-08-01-mls-dc-nsh                       D.C. United vs Nashville SC  open+close
  FIFA World Cup 2026_2026-08-01_dcunited_nashville D.C. United vs Nashville close only
```

Same fixture, same teams, correct line on both.

**It also costs no extra Odds-API credit.** Both writers fetch once per
`(sport, date)` and apply the one response to every pending row in that bucket,
so a duplicate row is an extra UPDATE, never an extra call. Verified by reading
`snapshotCronOdds` and `runOddsBackfillForDate` at HEAD: the fetch is outside the
row loop in both.

## What it costs

1. **Every count over the archive is inflated by ~197 rows in 3237 (6.1%).**
   Including the coverage denominators this session has been quoting.
2. **A slate is served twice.** `/archive/date/{date}` and anything reading it
   returns one real game as two.
3. **The join cannot tell them apart, and nothing can.** `byPair` is keyed on the
   team pair; two rows with one key are one lookup with two winners. That is the
   limitation this measurement exists to surface, and it applies equally to a
   GENUINE MLB doubleheader — same teams, same date, two real games. None of the
   197 is a doubleheader, but the next collision might be, which is why the
   condition is stated as a count to be investigated, not a count to be zeroed
   by deletion reflex.

## Task 1 and Task 2 — DONE 2026-09-13, read-only

**Task 1. There are two producers, not four.** `INSERT INTO regular_season_games`
and `INSERT INTO postseason_games` appear exactly twice in this repository, both
inside `/archive/game`, both fed by one id ternary:

```
series_key ? `${sport}_${series_key}_${round}_${date}`
           : isEspnEventId(source_id) ? `${sport}_${date}_e${source_id}`
                                      : `${sport}_${date}_${idTail}`
```

The fourth shape — `2026-07-22-mls-atx-sea` — matches no branch. `src/d1-provenance.js`
already establishes why: it is the **external writer's** shape, and Task 1 of
`CC-CMD-2026-09-02-d1-write-provenance` enumerated all 285 `prepare()` sites (87
writes) to prove no path here can produce it.

Classified with that module's own `idScheme()`, not a restatement of it:

| population | n | dates | what it is |
|---|---:|---|---|
| `external-vs-ours` | **99** | 2026-07-22 → 09-13, all MLS | one row dash-scheme; **in all 99 the stale row is the external one and the keeper is ours — zero exceptions** |
| `ours-vs-ours`, series-key sibling | 82 | 2026-02-04 → 07-14, postseason MLS | residue of the 2026-07-15 id-scheme migration |
| `ours-vs-ours`, espn-id sibling | 15 | 2026-09-02 → 09-04, MLB | residue of the 2026-09-01 numeric-espn upsert key |
| `two-real-games` | 1 | 2026-09-04 MLB | a doubleheader |

**So "converge the id schemes" is not available for half the population.** 99 of
197 involve a writer this repository does not control. That was the decision this
task existed to make, and the data makes it for us.

**And read-time dedupe on `(sport, date, home, away)` is now ruled out too.** The
2026-08-08 session scored it as the stronger option having found a null-team PGA
hazard and no doubleheaders *in its window*. There is one: it would merge the two
Guardians–Tigers games into a single row. The option dies on a case its own
window could not see — the same shape of error as the probe scope in Task 0.

**Task 2. The `FIFA World Cup 2026_` rows are not a second bug.** All 35 carry
`league = MLS` and an `espn_event_id`, and **35 of 35 of those ids appear in the
`UPDATE ... SET sport = league` list** in
`outbox/soccer-league-mislabel-scope-2026-08-06T14-49-49-767Z.sql`. That file
says why the id was left alone:

> `id` deliberately untouched (analytics-engine.js JOINs briefs.game_id against g.id)

So the `sport = MLS` column is the **corrected** value and the FIFA prefix in the
id is inert text from before the correction. Nothing to fix; the first hypothesis
here — that the sport column was wrong — was checked against
`canonicalizeBriefSport`, which maps `FIFA World Cup 2026` to `FIFA World Cup`
and never to `MLS`, and was refuted.

## Tasks 3, 4 and 5 — DONE 2026-09-13/14

Owner-approved, then narrowed to **82 only**. 82 rows deleted from
`regular_season_games`; `rows_total` 3237 -> 3155 and collisions 197 -> 115,
both deltas exactly 82. The run failed AFTER the deletes on a change_log batch
that exceeded D1's bound-parameter cap; repaired to 82 entries from committed
artifacts. Full account in
`outbox/cc-session-2026-09-13-duplicate-rows-task3-5.md`.

## Tasks

0. **Probe, do not assume, which row is canonical.** For each of the 197, read
   both rows in full from D1 — `change_log` author, `finalized_at`, score
   columns, `league`, `series_key`, brief/debrief references. **The artifact is
   a committed per-collision table naming which row is the keeper and why.** The
   id scheme is a hypothesis about the producer, not evidence about the row.

1. **Find the producers.** Grep every writer that INSERTs into
   `regular_season_games` / `postseason_games` and record the id it mints. Four
   schemes are in the data; the fix is one scheme, and that decision belongs
   here, not in a dedup script.

2. **The `FIFA World Cup 2026_` rows with `sport = MLS` are a second bug.**
   35 rows whose id names one competition and whose sport column names another.
   Determine which is wrong before anything is deleted — a mislabelled sport
   column also mis-buckets the row for odds.

3. **Deletion requires explicit owner approval and is not authorised by this
   document.** When approved: delete in one reversible batch, log every deleted
   id to `change_log`, and re-run the census in the same session.

4. **Done condition.** `same_slate_pair_collisions` reaches 0 archive-wide in a
   committed `outbox/identity-ambiguity-watch-*.json`, AND the per-collision
   keeper table from Task 0 is committed, AND a re-run shows `rows_total` fell
   by exactly the number of rows deleted. A count alone is not the artifact.

5. **Outbox manifest** per Rule 67.

## Not claimed

That 197 is the total number of duplicate rows in the archive. It is the number
of duplicate rows **that collide on a join key within one slate** — which is the
only duplication this instrument can see. Two rows for one game on different
dates, or with a name that folds differently, are invisible to it.
