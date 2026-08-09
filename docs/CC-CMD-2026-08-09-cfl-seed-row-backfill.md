# CC-CMD-2026-08-09-cfl-seed-row-backfill

**Origin:** found while closing Task 3 of
`CC-CMD-2026-08-08-cfl-archive-collection`. Written as its own CC-CMD
rather than carried forward (Rule 87). Not urgent — two rows.

## The finding, measured not assumed

`outbox/cfl-archive-verify-*.log` (run 2026-08-09T12:33:06Z), raw D1 read
of every CFL row in `regular_season_games`:

```
2026-06-06  Winnipeg Blue Bombers @ Calgary Stampeders  null-null  src=null  created=2026-06-15 20:32:50
2026-06-06  Edmonton Elks @ Ottawa Redblacks            null-null  src=null  created=2026-06-15 20:32:50
```

Both games are `status: 'complete'` in
`https://cflscoreboard.cfl.ca/json/scoreboard/rounds.json`. Both rows have
NULL scores and NULL `espn_event_id`, and were created 2026-06-15 — weeks
before the CFL collector existed (shipped 2026-08-08). They are seed rows
from a different writer.

They will never self-heal: the collector in `handleJournalismCycle` is
bounded to yesterday+today by design, and 2026-06-06 is two months past.

## Task 1 — probe first, do not trust the above

`git log --oneline -5`. Then re-run the existing probe unchanged:

```
node scripts/cfl-archive-verify.mjs
```
(or dispatch `archive-gap-probe.yml` with `script=cfl-archive-verify.mjs`
if the sandbox 403s `*.workers.dev`, which it has consistently.)

Read `null-score rows (unscored seeds, not phantoms):` from the output.
If it is 0, these have already been filled by some other path — close this
CC-CMD as moot with the log as the artifact and stop.

## Task 2 — identify the writer before writing anything

`git log -S"2026-06" --oneline -- src/index.js` and grep for CFL seed
paths. **Do not skip this.** If a live writer is still creating null-score
CFL rows, backfilling two rows treats the symptom. Record what wrote them,
or record explicitly that the writer could not be identified.

## Task 3 — fill the two rows

`POST /archive/game` upserts on `id` and its `ON CONFLICT DO UPDATE` uses
`COALESCE(excluded.home_score, home_score)`, so a write carrying real
scores fills a NULL without disturbing anything else. Read that INSERT in
`src/index.js` before writing — do not take this paragraph's word for it.

Bodies come from the same traversal `cfl-archive-verify.mjs` already does:
`rounds[].tournaments[]` where `status === 'complete'` and
`date` starts `2026-06-06`. Use the collector's exact field mapping,
including `venue: null` and `sport: 'CFL'`.

**Scope boundary:** these two rows only. Do NOT backfill the whole CFL
season, do NOT change the collector's yesterday+today window, do NOT touch
any other sport.

## Done condition (artifact, per Rule 89)

Re-run `cfl-archive-verify.mjs`. The committed log must show:

- `null-score rows (unscored seeds, not phantoms): 0`
- `0-0 rows (phantom-final trap): 0` — unchanged, the backfill must not
  introduce one
- `RESULT A1=PASS A2=PASS` — unchanged
- both `2026-06-06` lines showing real, non-null scores

## Task 4 — outbox manifest

`outbox/cc-session-{date}-cfl-seed-row-backfill.md`: commit hash, the
before/after probe log paths, the writer identified in Task 2 (or an
explicit statement that it was not), and a confidence score.
