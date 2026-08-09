# CC-CMD-2026-08-08-confirm-duplicate-fixture-mechanism — Result

## Status: DONE. The CC-CMD's hypothesis is REFUTED by the data. Neither fix applied, per scope.

Method: `scripts/duplicate-fixture-probe.mjs` on a GitHub runner,
SELECTs only. Raw log:
`outbox/duplicate-fixture-probe-20260808T231536Z.log`.

## Task 1 — code and measurement re-verified from HEAD

The id ternary still reads exactly as the doc describes, located by
content rather than line number (`src/index.js`):

```js
const id = series_key
    ? `${sport}_${series_key}_${shortify(round) || 'r'}_${date}`
    : `${sport}_${date}_${idTail}`;
```

Its comment still claims the duplicate "self-heals — every subsequent
write to that same series_key+round+date correctly upserts via the new
id from then on."

Re-measured fresh: **55 duplicate groups** across 2026-07-25 .. 08-15,
all MLS, every one exactly n=2. Larger than the doc's 18, because the
doc sampled 14 days and the duplicates extend through 08-14.

## Task 2 — the mechanism, and where the hypothesis breaks

The hypothesis has two halves. The first holds; the second is false.

**Holds: the seed path genuinely cannot obtain a `series_key`.** Read
from source, not inferred. The `[ARCHIVE-SEED]` POST body sends exactly
`sport, league, date, home, away, venue, start_time, streams,
source_id` — no `series_key`. It is built from `gameMeta`, which is
populated purely from ESPN scoreboard events, and ESPN carries no MLS
`series_key` (that identifier — `MLS-COM-000006_MLS-MAT-000A38` — is a
stats-api.mlssoccer.com match id). So the seed could not supply one even
if the ternary wanted it.

**False: the seed path is not what produced these duplicates.** Across
all 110 rows in all 55 duplicate groups:

```
key-scheme ids                      : 55
name-scheme ids WITH a series_key   : 55   <- migration shape
name-scheme ids with NO series_key  :  0   <- seed-path shape
```

**Zero.** Every name-scheme row carries a populated `series_key` column.
A seed-path write is definitionally incapable of that. The id scheme was
detected structurally, not guessed: a key-scheme id contains its own
`series_key` as a substring.

The `created_at` distribution names the real mechanism outright:

```
NAME-ID rows : 2026-06-30 19:27:03 .. 19:27:09   (54 of 55, one on 07-15)
KEY-ID  rows : 2026-07-16 12:23:37 .. 12:23:58   (all 55)
```

Two bulk writes, twenty seconds wide each, sixteen days apart — one
schedule import under the old id scheme, one under the new. Not a
per-game seed racing a per-game resolution.

**So the code comment is right about the mechanism and wrong about the
consequence.** It is a migration artifact, as it says. But "self-heals"
describes the *id* healing, not the *row*: the 06-30 row was written for
a then-future fixture, the fix landed before that fixture was played, so
resolution went to a new id and the old row was never touched again. It
sits permanently unscored. 55 of them, and every one of these is a
future-dated fixture at import time — which is why a change framed as
"any currently-pending leg duplicates exactly once" produced 55
duplicates rather than the handful that framing implies.

Per the CC-CMD's own instruction ("only the comment text may be
corrected"), this is the one in-place correction it authorises. Made in
a separate commit so it is independently revertable.

## Task 3 — the two candidate fixes, re-scored against what was found

**Option 1 — converge the id schemes.** Task 2's finding removes its
premise. The seed path was never the second writer, so making it emit a
`series_key` id changes nothing about these 55 rows. Converging would
mean *renaming historical ids*, which is precisely what the existing
comment declined to do, and `briefs.game_id` joins `games.id` in
`src/analytics-engine.js` — renaming risks silently breaking those joins
for already-referenced rows. **Not viable as stated.**

**Option 2 — read-time dedupe on (sport, date, home, away).** Now the
stronger option, but its stated precondition needed re-checking, and the
check found a real hazard:

- `postseason_games`: **0** tuples where two scored rows carry different
  scores. Safe for MLS, which is the entire affected population.
- `regular_season_games`: **2** unsafe tuples — `2026-07-16` and
  `2026-07-09`, both `PGA Tour`, both with `home` and `away` NULL. Two
  NULL-team rows on one date collapse into one tuple and would be
  false-merged.

So option 2 is safe only if the dedupe key requires non-null `home` and
`away`. The doc worried about doubleheaders; the actual hazard is
null-team golf rows. Worth stating plainly because "check whether that's
a real, current occurrence" would have been answered "no doubleheaders
found" and shipped a merge that breaks PGA rows.

**A third option the CC-CMD did not list, and the one I would
recommend:** a one-time targeted DELETE of the 55 stale name-scheme
rows. They are exactly identifiable (name-scheme id, `series_key`
present, `home_score` NULL, a key-scheme sibling exists), none has been
scored, and none can ever be scored. That is a bounded one-time cleanup
rather than option 2's permanent cost in the read path. It needs its own
CC-CMD — the join-safety question (does any `briefs.game_id` reference
one of these 55 ids?) must be answered before any DELETE, and this
CC-CMD forbids applying a fix.

## Scope

No fix applied. The only file change is the comment correction Task 2
authorises. The 55 rows are untouched.

## Confidence gate

**98.** The finding rests on a 55-0 measurement across all 110 rows in every duplicate group, not on a sample or an inference. The only change made was the comment correction the CC-CMD authorises, and the diff was verified comment-only (0 non-comment lines). Not 99 because the id-scheme detection is structural (`instr(id, series_key)`) rather than an authoritative record of which writer produced each row.

*(Backfilled 2026-08-09. The score was stated in session at execution time but never written into this doc. Chat is ephemeral; this file is the record, and a gate that exists only in scrollback is not a gate.)*
