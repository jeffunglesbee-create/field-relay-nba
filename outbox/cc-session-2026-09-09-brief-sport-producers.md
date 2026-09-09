# The producers, traced — and a canonicaliser that handled one fragmentation of four

2026-09-09 · field-relay-nba · `f18b98c`, deploy 920

`brief-label-migration` had failed on **every scheduled run since 2026-08-24**.
Its `verify` mode reported residual non-conforming rows and exited 1. Applying
the migration would have cleared them and the next run would have gone red again,
because nothing had stopped the writers.

It is green now, and the reason it will stay green is that the four producers
were fixed or fenced first.

## The count kept growing, which is the whole finding

| date | non-conforming rows |
|---|---|
| 2026-08-24 | 2 |
| 2026-08-31 | 7 |
| 2026-09-07 | 10 |
| 2026-09-09 | **12** |

Two more appeared between the trace and the fix, in one day.

## Traced to a line each

| value | rows | producer | line |
|---|---|---|---|
| `MLS Soccer` | 7 | **client** — `archiveBrief('epl_match', game.league, …)` / `('night_owl', topGame.league, …)` | `field.js:31075`, `:41603` |
| `CFL – 2026 Season · Week 14` | 2 | **client** — same two call sites | same |
| `PGA TOUR` | 2 | **relay** — golf per-round enqueue | `index.js ~8540` |
| `wc` | 1 | **relay** — BracketDO POSTs to `/archive/brief` | `bracket-do.js ~409` |

The row ids confirm each independently.
`game_recap_pga tour_golf_401811963_R4` is the queue consumer's
`` `${type}_${sport.toLowerCase()}_${eventId}` ``;
`epl_match_<date>_all` and `night_owl_<date>_<id>` are `archiveBrief`'s own id
shape (`type + '_' + date + '_' + (gameId || 'all')`).

### The relay was emitting a value its own canonicaliser rejected

`canonicalizeWC26Sport` tested `s === 'wc26'` or `s.startsWith('fifa world
cup')`. BracketDO sends `'wc'`. The function written to stop label fragmentation
did not recognise a label its own repo produced.

### `game.league` means two different things

Both client call sites carry a comment saying `league` "carries the competition's
real declared label (the relay sets it from its LEAGUES table)". That is true for
**relay-sourced soccer** — the deploy's "Soccer league label contract check"
asserts it — and false for the client's own hardcoded fixture tables:

```
src/legacy/field.js:9461   league: 'CFL – 2026 Season · ' + (round.name || '')
src/legacy/field.js:9326   league: "WNBA – 2026 Season"
```

So the residual was never a fixed list of four variants. It is **whatever
`game.league` happens to hold**, which is unbounded. `WNBA – 2026 Season` is
already sitting in the client waiting for the first WNBA night-owl brief.

## The authority was measured, not assembled

`scripts/brief-sport-authority-census.mjs`, read from the live games tables:
**28 distinct labels**, one case-insensitive collision (`WNBA` / `wnba`), and
exactly four briefs labels outside the set.

This census exists because `brief-label-migration.mjs` already paid for the
alternative. Its first run used a hand-written conforming set, lacked EFL Cup,
EFL Trophy and the three UEFA qualifying labels, and reported **106
correctly-labelled rows as non-conforming**.

Two of the 28 are lowercase **and correct** — `golf` and `wnba`. The games tables
carry those exact forms, so a "fix the lowercase values" pass breaks working
joins. They are members of the declared set, so they return unchanged before any
rule runs: the warning honoured by construction rather than by a special case.

## `canonicalizeBriefSport`

Supersedes `canonicalizeWC26Sport` at both write boundaries, which were already
wired (`index.js:12976` for `/archive/brief`, `:20289` for the queue consumer).

1. Already a declared label → unchanged.
2. Explicit alias (`MLS Soccer` → `MLS`, `wc` → `FIFA World Cup`, …).
3. `FIFA World Cup …` suffix → the bare label (the original WC26 rule).
4. Caption prefix (`CFL – 2026 Season · Week 14` → `CFL`), splitting on the
   dashes and the middot **only** — never a plain hyphen, because a real
   competition label could contain one — with a trailing season year stripped and
   re-checked.
5. Casing recovery against **exactly one** case-insensitive match. `WNBA` and
   `wnba` are both real, so two matches is a guess and is refused.
6. Otherwise **unchanged**. That is the boundary between this function and
   invention: an unknown value is reported by the guard and by the migration, not
   replaced.

Both relay producers were also fixed at source, so the canonicaliser is their
safety net rather than their mechanism.

**The client was deliberately not changed.** The relay owns the contract
(Rule 60) and now enforces it; a client-side normalisation is the band-aid
Rule 64 names. Recorded in `CONTRACTS.md`, including the `game.league` ambiguity.

## Six mutations. Two survived the first attempt.

```
CAUGHT  drop the MLS Soccer alias
CAUGHT  casing recovery ignores ambiguity
CAUGHT  caption splits on a plain hyphen
CAUGHT  casing recovery disabled entirely
CAUGHT  drop a label from the declared set
CAUGHT  context prefix disabled
```

**`casing recovery ignores ambiguity` survived** — `hits.length === 1` changed to
`>= 1` passed every row. Because `golf`, `wnba`, `WNBA` and the rest are caught
by the conforming check first, casing recovery was never reached at all. Nothing
exercised it on an ambiguous input. Added `'Wnba'`, which matches both real
labels, plus `'mlb'` so "refuse everything" cannot pass in its place.

**`conforming check removed` survived** — `if (false) return raw` passed every
row, because for all 28 labels `sportContextPrefix` reaches the same answer: none
of them contains a separator, so splitting returns the whole string and set
membership is re-tested inside the helper. That is a true fact about today's
labels rather than a defect. The line stays — it states the intent and is the
only one that survives a future label containing a separator — its redundancy is
recorded in the guard, and the set's contents are asserted directly instead of
through the function.

### And one assertion of mine was simply wrong

`declared.size === 28` failed at 31. `SOCCER_LEAGUE_LABELS` declares EFL
Championship, EFL League One and EFL League Two, none of which has an archived
game yet. Declaring a competition before its first fixture is the point of a
declaration.

The invariant is one-directional: every label the games tables carry must be
declared; the reverse is not a defect. An equality assertion would have gone red
on every new competition, training someone to widen the number without reading
it. It now asserts coverage and reports the extras as information.

## The guard, both halves

| half | where | asks |
|---|---|---|
| static | deploy gate | does the function map the four measured values, and leave the labels alone? |
| `--live` | verify job | does the declared set still cover what the games tables hold? |

The static half **evaluates** the function rather than pattern-matching it. A
regex asserting "the alias map contains `MLS Soccer`" passes on a map that is
never consulted, which is the shape of half this repo's recorded defects.

## The migration, end to end

```
scope    12 rows, 0 unclassified, 0 recaps to retype
apply    MLS Soccer  7 -> MLS            7 changed, 0 skipped
         PGA TOUR    2 -> PGA Tour       2 changed, 0 skipped
         CFL caption 2 -> CFL            2 changed, 0 skipped
         wc          1 -> FIFA World Cup 1 changed, 0 skipped
         drift: 0 appeared since scope, 0 gone
verify   non_conforming_remaining []   recaps_remaining 0   CLEAN true
```

`verify` ran as a separate dispatch after `apply`, against a fresh read — not
inferred from the UPDATE counts. **`brief-label-migration` is green for the first
time since 2026-08-24.**

## Residual

None for this defect. The producers are fixed or fenced, the boundary
canonicalises, the deploy gate holds the mapping and the verify job holds the
coverage.

The one thing worth watching: `game.league` remains a caption in the client, so
new captions will keep arriving. They now resolve at the boundary instead of
accumulating — but a caption whose prefix is *not* a declared label still passes
through unchanged and will show up in the weekly `verify`. That is the design:
reported, not guessed.
