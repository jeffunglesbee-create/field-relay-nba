# CC-CMD-2026-08-09-cleanup-stale-duplicate-rows — Result

## Status: DONE. Done condition met verbatim. **Confidence: 96.**

Branch `main` throughout. Commits `4de7fb4` (cleanup), `9da0132`
(repo-wide verification).

## Done condition — the two required lines, quoted

`outbox/duplicate-fixture-probe-*.log`, run 2026-08-10T02:58:46Z after
the delete:

```
   duplicate groups: 0
     name-scheme ids WITH a series_key   : 0   <- migration shape
```

## Task 1 — the blocking safety check

Run twice: once in the preflight, once again inside the cleanup script
immediately before the DELETE, because a DELETE must be gated on the
state it is about to act on rather than one that was true some minutes
earlier.

```
referenced stale rows: 0
```

## Task 2 — enumerated before deleting

```
delete-set count: 60
key-scheme survivors before: 57
total rows in window before: 112
```

Full 60-row enumeration in
`outbox/run-duplicate-row-cleanup-*.log`. All MLS, all unscored, all
name-scheme with a populated `series_key`, each with a key-scheme sibling
on the same `(sport, date, home, away)`.

60 rather than the measured 55 because the CC-CMD's Task 2 predicate is
**date-unscoped** while the original 55 was measured inside
2026-07-25..08-15. Five of the 60 fall outside that window — 2026-09-01,
09-15, 09-16, 09-17, 10-21 — and every one satisfies all four required
conditions. Within the CC-CMD's own "close to 55, or investigate" band,
and investigated rather than waved through.

**DELETE through `/d1/execute` was confirmed permitted from source**
before being used, not assumed: the handler (src/index.js:13130) has no
verb restriction, extracts the table with
`/(?:INTO|FROM|UPDATE|TABLE)\s+(\w+)/i`, and `postseason_games` is in
`ALLOWED_TABLES`.

The delete predicate is a single shared constant used by both the SELECT
and the DELETE. Two hand-copied predicates could drift by one character
and delete a set that was never enumerated — the exact failure that
enumerate-first exists to prevent.

## Task 3 — delete

```
meta.changes: 60
```

Equal to the enumerated 60, asserted in the script rather than eyeballed.

## The script reported FAIL — on one line, and the line was mine

```
duplicate groups: 0                (must be 0)
name-scheme ids WITH a series_key: 0   (must be 0)
key-scheme survivors after: 57      (must equal 57)
total rows in window after: 57      (must equal 112 - 60 = 52)
=== RESULT: FAIL ===
```

Every done condition passed except an arithmetic check I wrote, which
subtracted a **date-unscoped** delete set (60) from a **window-scoped**
total (112). 55 of the 60 were in-window, so 112 − 55 = 57 — exactly what
came back.

Per Rule 77 that reading was not accepted as the answer. It is a reading,
so `scripts/verify-duplicate-cleanup.mjs` measured the facts it implies,
repo-wide, where a wrong reading would have shown up:

```
3. key-scheme rows repo-wide           : 182
   key-scheme rows in 2026-07-25..08-15 : 57   (was 57 before AND after the delete)
4. the out-of-window dates the delete touched:
   2026-09-01  KEY-ID  MLS_MLS-COM-00002V_SF-02_semifinals_2026-09-01
   2026-09-01  KEY-ID  MLS_MLS-COM-00002V_SF-01_semifinals_2026-09-01
   ... (11 rows across the five dates, all KEY-ID except two placeholders)
```

No key-scheme row was removed anywhere. The survivors are the scored
rows, which is the CC-CMD's stated requirement.

The design flaw is worth recording: I measured survivors with a
window-scoped count while deleting on an unscoped predicate. The fix in
`run-duplicate-row-cleanup.mjs` — measuring survivors over the same range
as the delete set — is written into
`docs/CC-CMD-2026-08-10-pre-window-mls-duplicates.md` Task 3 so the next
cleanup does not repeat it.

## Two findings the repo-wide check surfaced

**1. 82 duplicate groups outside the cleaned window.** All MLS, all n=2,
all dated 2026-02-04 through 2026-07-14. None was in the delete set, and
the CC-CMD explicitly forbids touching rows outside its enumeration, so
they were correctly left alone. They are an unmeasured population, not a
leftover. Second CC-CMD written per Rule 87:
`docs/CC-CMD-2026-08-10-pre-window-mls-duplicates.md`, whose Task 1
requires establishing whether both siblings are unscored before any
delete is even proposed — if these hold two *scored* rows they are not
orphans and deleting either destroys a real result.

**2. Two rows matching the stale shape that were correctly not deleted:**

```
MLS_2026-09-01_forgefc_tbcaway
MLS_2026-09-15_tbchome_forgefc
```

The predicate requires a key-scheme sibling sharing
`(sport, date, home, away)`, and these carry placeholder names
(`TBC Home`, `TBC Away`) matching no sibling tuple. Unresolved bracket
placeholders, not orphans of a resolved fixture. Recorded so a future
session does not read them as cleanup leftovers.

## Task 4 — the read-time hazard, recorded and NOT fixed

A read-time dedupe on `(sport, date, home, away)` would **false-merge two
genuinely different events**. Re-measured after the cleanup, still true:

```
regular_season_games: 2 tuple(s) with 2+ scored rows carrying DIFFERENT scores
   2026-07-16 PGA Tour null v null n=2 distinct_scores=2
   2026-07-09 PGA Tour null v null n=2 distinct_scores=2
```

Both `home` and `away` are NULL for PGA Tour rows, so the tuple collapses
every same-date event into one key. This cleanup makes the dedupe
unnecessary; it was not implemented, per the CC-CMD. **Any future session
tempted by that key must add a null guard on `home`/`away` first.**

## Scope held

No id renamed. The id-construction ternary untouched. No read-time dedupe
implemented. No row deleted outside the Task 2 enumeration — `meta.changes`
equals the enumerated count exactly.

## Confidence gate

**96.** The done condition is quoted verbatim from the CC-CMD's own named
probe, both required lines read 0, the delete count equals the
enumeration exactly, and the one FAIL was diagnosed to my own arithmetic
and then falsified by an independent repo-wide measurement rather than
argued away.

Not higher because of the shape of what the repo-wide check found. The
CC-CMD's done condition is window-scoped, it is met, and the 82
out-of-window groups are genuinely out of scope — but I only know they
exist because I widened the check after a FAIL. Had my arithmetic been
right, the cleanup would have reported PASS and I would have closed this
without ever looking outside the window. The finding is real; the process
that surfaced it was luck, and a done condition that can only be
falsified inside its own window is a weaker artifact than it appears.

## Residual

None carried. Deferred work has its own spec:
`docs/CC-CMD-2026-08-10-pre-window-mls-duplicates.md`.
