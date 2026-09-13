# CC-CMD-2026-09-13 — one alias table, two entries, last write wins

Filed per Rule 87.4 from `CC-CMD-2026-09-13-team-key-sport-blind`. Found while
answering that CC-CMD's Task 1, and it is a DIFFERENT defect with a different
fix — filing it separately rather than widening that one.

## Measured at HEAD

```
resolveTeamKey("Tigers")         -> hullcity
resolveTeamKey("Detroit Tigers") -> detroittigers
```

`src/identity-resolver.js`:

```
253:   ['Tigers',       'Detroit Tigers'],
399:   ['Tigers',       'Hull City'],
```

Both live in ONE flat `pairs` array consumed by ONE loop that assigns into one
`strip` object. Same key, no warning, **last write wins**. Line 399 was added
2026-08-21 in `0faf37f` ("all three PL promoted clubs") and silently took over
the MLB entry that preceded it.

## Why this is not the sport-blind defect

The parent CC-CMD is about a BARE CITY resolving to that city's pro club
(`Colorado` -> coloradorapids). Neither `Tigers` entry is a city; both are
nicknames, deliberately listed (line 384 explains the `the Tigers` / `Tigers`
pair). The parent's candidate fix (b) — "drop the bare city aliases" — does not
touch this at all. Its fix (a), sport-scoping, would.

The class here is narrower and checkable without any sport knowledge: **a
key-value table whose builder cannot say that a key was already taken.**

## Blast radius, measured

`GET /identity/substitution-census?key=hullcity`, 2026-09-13:

- 68 MLB rows named `Tigers` resolve to `hullcity`
- 6 soccer rows named `Hull` resolve to `hullcity` (EPL, EFL Cup)

**Since 2026-08-21 every Detroit Tigers game misses the odds join**, because the
vendor sends `Detroit Tigers` -> detroittigers and D1 holds `Tigers` ->
hullcity. Silent: a missed join writes nothing and logs nothing.

## What is NOT claimed

**That the stored odds are wrong.** Every odds-carrying `Tigers` row observed is
dated 2026-06-27 to 2026-07-23, before the regression, when `Tigers` still
resolved to `detroittigers`. And a Hull City line could not reach a Tigers game
by this path in any case: the join builds `byPair` from the `baseball_mlb`
vendor response alone, which contains no English football club. Task 0 exists
because "observed" is not "all 68".

## Tasks

0. **Enumerate every duplicate strip key in every identity table**, not just
   this one. `CANONICAL_TEAM`, `CANONICAL_PLAYER`, the AFL table, the MLS club
   id map — any `pairs` array folded into an object. **The artifact is the list
   of (key, first canonical, last canonical) triples**, committed. One known
   instance is not a count.

1. **Confirm or refute the date story for all 68 rows.** Query the `Tigers` rows
   with odds and their `captured_at`/`change_log` entries. **The artifact is the
   max date among odds-carrying `Tigers` rows.** If any post-dates 2026-08-21,
   the "no false data" paragraph above is wrong and this becomes a data-integrity
   question, not just a coverage one.

2. **Make the builder refuse a silent overwrite.** A second write to an existing
   strip key with a DIFFERENT canonical must fail loudly at module load, not
   resolve to whichever line is lower in the file. Writing the same canonical
   twice is harmless and must stay allowed.

3. **Decide what `Tigers` means, and record why.** It cannot mean both. Options:
   scope by sport (the parent CC-CMD's fix (a), which subsumes this); or drop
   the bare nickname for one side and keep only `the Tigers` / `Detroit Tigers`.
   **Do not add a fallback chain (Rule 76).** Whichever is chosen, the OTHER
   sport's rows must be shown still resolving correctly — an enumerated
   input/output set, both sports, in the same check.

4. **Mutation (Rule 90).** Add a third colliding entry and assert the new guard
   goes red. Then assert it stays green when the same canonical is written
   twice. A guard that rejects both is worse than none, because the table
   legitimately repeats.

5. **Done condition.** `/identity/substitution-census?key=hullcity` reports
   `hullcity` claimed by ONE family, and a second probe shows Detroit Tigers rows
   resolving to `detroittigers`. Both committed.

6. **Outbox manifest** per Rule 67.

## Why the existing guard missed it

`scripts/check-team-identity-collisions.mjs` asserts no two clubs share a key —
but over a CURATED list (the four "Real ..." clubs, FPL short codes, and so on).
`Tigers` is in neither list. A check over a hand-written sample cannot find the
collision it was not told to look for; Task 0 is the census that can.

## How it was found, and the part worth keeping

By being wrong. The question was "do the 68 MLB `Tigers` rows carry odds?" and
the reasoned answer was no — the vendor says `Detroit Tigers`, the pair misses,
nothing is written. That reasoning was sound and the conclusion was false,
because it assumed the alias had always been what it is now. **The probe was run
anyway, because this repo's rule is that a cross-boundary fact is not verified by
reading, and it returned `has_opening_odds: true`.** The contradiction between a
sound argument and a measured fact is what exposed the 2026-08-21 regression.
