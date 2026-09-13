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


---

# RESOLVED 2026-09-13

| task | state | evidence |
|---|---|---|
| 0 · enumerate duplicate keys in every identity table | **done** | 333 pairs across 5 tables, exactly 1 collision. Became a permanent gate: `scripts/check-identity-table-collisions.mjs` (+3 mutations) |
| 1 · confirm or refute the date story | **done — CONFIRMED** | `outbox/tigers-forensics-20260913T143322Z.json`: 69 rows named Tigers, 52 with odds, **0 unaccounted for** |
| 2 · builder refuses a silent overwrite | **done** | records the collision and removes the key; writing the same canonical twice is still allowed |
| 3 · decide what `Tigers` means | **done** | neither club. See below |
| 4 · mutation | **done** | 7 mutations, `scripts/mutate-ambiguous-team-identity.mjs`; N1 restores the old builder verbatim |
| 5 · done condition | **done, restated** | see below |
| 6 · outbox manifest | **done** | `outbox/cc-session-2026-09-13-tigers-resolution-and-backfill.md` |

## Task 1 — CONFIRMED, per row rather than by argument

Every odds-carrying row named `Tigers` is accounted for by a write that happened
outside the regression window:

```
written before the alias flip        41
written after the fix (live cron)     1
backfilled after the fix (tranche 1) 10
UNACCOUNTED FOR                       0
```

**The first run of this measurement said REFUTED and was wrong.** It classified
rows by GAME DATE falling inside the window — using the date of play as a proxy
for when the odds were written. Ten of its eleven "refuting" rows were dates
backfilled by hand three hours earlier, after the fix. The eleventh was captured
`2026-08-21T10:00:53Z`, thirteen hours before `0faf37f` landed at `23:17:42Z`.

Recorded because the failure is the same family as the trap this CC-CMD already
documents: `captured_at` is not a write time for a backfilled row, and game date
is further from the write than `captured_at` is. Writing the warning did not
stop me reaching for the worse proxy an hour later.

The corrected discriminator is durable and needs no memory of what anyone ran: a
historical backfill requests noon UTC on the game's own date, so its stamp lands
within minutes of it; a live capture does not.

## Task 3 — `Tigers` means neither club

A map from variant to canonical cannot hold a variant that means two things, so
it answered by file order. Nobody chose Hull City.

The table now records the ambiguity and removes the key, so `resolveTeamKey`
falls through to the bare fold (`tigers`) — an honest unknown that can miss a
join but can never assert a team that was not named. The odds join resolves it
from the vendor payload it already holds (`resolveTeamKeyIn`), which is
unambiguous and one sport per response.

## Task 5 — RESTATED, because the fix is not the shape the condition assumed

**As written:** "`/identity/substitution-census?key=hullcity` reports `hullcity`
claimed by ONE family, and a second probe shows Detroit Tigers rows resolving to
`detroittigers`."

**The second half cannot be met by the fix that was chosen, and should not be.**
All 69 rows resolve to `tigers`, deliberately: the resolver refuses to name
either club standalone, and the payload decides at join time. A condition
requiring `detroittigers` presumes the fix picks a winner — which is the
approach this CC-CMD's own Task 3 rejected.

**Restated, and met:**

1. `hullcity` is claimed by one family — watch artifacts either side of the
   deploy, identical archive (3237 rows both runs):
   `identity-ambiguity-watch-20260913T122853Z.json` (OPEN: soccer 6 + MLB 69)
   → `identity-ambiguity-watch-20260913T131526Z.json` (**DONE**), and
   `ambiguous_key_count` 12 → 11.

2. **A Detroit Tigers game received odds through the repaired join.**
   `MLB_2026-09-13_e401816920` (Comerica Park), `opening_odds.captured_at`
   `2026-09-13T13:16:54Z` — a live cron write **eight minutes after the fix
   deployed at ~13:09Z**. That is the end-to-end proof (Rule 61) the fix commit
   could not yet claim, and it is stronger than the original wording asked for:
   not "the key looks right" but "the market data arrived".

## Residual

None for this CC-CMD. The one-shot `tigers-forensics.yml` is deleted as its own
header instructed; `?name=` on the census is the durable instrument and the
committed artifact is the durable answer.
