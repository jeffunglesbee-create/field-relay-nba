# CC-CMD-2026-08-09-cleanup-stale-duplicate-rows

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-09-cleanup-stale-duplicate-rows.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## What this cleans up, and why it is safe to consider

`CC-CMD-2026-08-08-confirm-duplicate-fixture-mechanism` measured 55
duplicate groups in `postseason_games` (2026-07-25..08-15, all MLS, all
n=2) and established the mechanism: two bulk schedule imports either
side of the archive id-scheme change (`created_at` 2026-06-30 19:27 and
2026-07-16 12:23). Every name-scheme row carries a populated
`series_key`; name-scheme rows with no `series_key`: zero.

The stale sibling is exactly identifiable and can never be scored: the
fixtures were future-dated at import, so resolution wrote the new id and
never touched the old row.

That CC-CMD forbade applying a fix. This one applies it — **after** the
join-safety question is answered, not before.

## Task 1 — the blocking safety check

`src/analytics-engine.js` JOINs `briefs.game_id` against `games.id`.
Before any DELETE, establish whether any brief references one of the
stale ids.

```sql
SELECT COUNT(*) FROM briefs b
  JOIN postseason_games g ON b.game_id = g.id
 WHERE g.series_key IS NOT NULL
   AND instr(g.id, g.series_key) = 0      -- name-scheme id
   AND g.home_score IS NULL
```

**Artifact:** that count. **If it is not 0, STOP** and report — deleting
a referenced row breaks those joins silently, which is the exact hazard
the id ternary's comment declined to accept.

## Task 2 — enumerate the delete set before deleting it

Run the SELECT form of the delete predicate and commit the full row list
as the artifact. A row qualifies only if ALL hold:
- `series_key IS NOT NULL`
- `instr(id, series_key) = 0` (name-scheme id)
- `home_score IS NULL AND away_score IS NULL`
- a key-scheme sibling exists with the same `(sport, date, home, away)`

**Artifact:** the enumerated list, and its count. If the count is not
close to 55, the predicate is wrong — investigate, do not proceed.

Note `/d1/execute` allows `postseason_games`; confirm it permits DELETE
from source before assuming it does.

## Task 3 — delete, then prove it

Run the DELETE with the identical predicate from Task 2.

**Done condition:** re-run `scripts/duplicate-fixture-probe.mjs` via
`.github/workflows/archive-gap-probe.yml` and commit the log. Pass 1
must report `duplicate groups: 0`, and pass 2's tally must show
`name-scheme ids WITH a series_key : 0`. Quote both lines.

Also confirm no key-scheme row was removed: the key-scheme count in pass
2 must still be 55 before the groups collapse, i.e. the surviving rows
are the scored ones.

## Task 4 — the read-time hazard, recorded not fixed

The same investigation found that a read-time dedupe on
`(sport, date, home, away)` would false-merge two `PGA Tour` tuples
(2026-07-16 and 2026-07-09) whose `home` and `away` are both NULL. This
cleanup makes that dedupe unnecessary, so do NOT implement it. Record
the hazard in the outbox so a future session does not adopt the key
without the null guard.

## Explicitly NOT in scope

- Do not rename any id.
- Do not change the id-construction ternary's logic.
- Do not implement read-time dedupe.
- Do not touch rows outside the Task 2 enumeration.

## Outbox

`outbox/cc-session-2026-08-09-cleanup-stale-duplicate-rows.md`: the Task
1 count, the Task 2 enumeration, and the Task 3 probe lines.
