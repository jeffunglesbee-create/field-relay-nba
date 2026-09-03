# CC-CMD-2026-09-01-mls-dual-writer-duplicate

**Filed from:** field-laboratory, from a fixture-identity sweep.
**Ask to:** field-relay-nba — the write path is NOT yet identified; Task 1 is
finding it.
**Relationship:** the second CC-CMD required by Rule 87 (4) before
`CC-CMD-2026-09-01-archive-game-numeric-espn-upsert-key` can be closed, and
before field-relay-nba#1 can be closed.
**Status:** OPEN. **Task 1 DONE 2026-09-01 — the answer is NOT (2).**
**SCOPE CORRECTED 2026-09-03 — the title is wrong and so is "every one MLS".**
An archive-wide sweep (field-laboratory `probe-archive-scheme-duplicates.mjs`,
run `33775532885`, 2777 rows read from D1 rather than from a 30-day
`/context/date` window) found **53 mixed-scheme clusters in two sports: 51 MLS
and 2 WNBA**. See the section below and
`field-laboratory outbox/2026-09-03-archive-scheme-duplicates.md`.

## The defect

Over 30 days of public `/context/date`, **51 MLS fixtures are each served as two
rows**, written under two different id schemes:

```
MLS_2026-08-30_stlouis_dallas       eid=761769   start=2026-08-30T23:00Z
2026-08-30-mls-stl-dal              eid=(none)   start=(none)

MLS_2026-08-30_columbus_newengland  eid=761758   start=2026-08-30T20:30Z
2026-08-30-mls-clb-ne               eid=(none)   start=(none)
```

The first is `provider-composite` — `${sport}_${date}_${shortify(home)}_${shortify(away)}`,
the shape `POST /archive/game` builds. The second classifies as
**`unrecognised`** against field-laboratory's registry of seven known id
schemes: an eighth shape, dash-separated, using 2-3 letter team abbreviations
rather than `shortify` output.

## Why the numeric-id key does not fix this

`d253209` keys the archive id on a bare numeric `source_id`. Applied here it
renames the first row to `MLS_2026-08-30_e761769` and leaves the second
untouched, because the second carries no `source_id` at all.

**Two rows before, two rows after.** The fix is not wrong; it is scoped to rows
that share an event id, and these do not.

## Why nothing had reported it

`relay-duplicate-fixture-watch.mjs` groups on `espn_event_id` and skips any row
without one. Every pair above has exactly one row with an id and one without, so
the watcher sees a single un-duplicated row and reports clean.

**The instrument and the fix share a scope**, so the fix succeeding and the
instrument being blind are indistinguishable from the outside. Found only by
grouping on fixture identity — date plus team names under subset matching —
which is what `scripts/probe-fixture-identity-duplicates.mjs` does.

Sweep result: 1064 rows, 170 with no event id (16.0%), 61 non-distinct groups,
**51 invisible to the event-id watcher**, every one MLS.

## Scope correction, 2026-09-03: 51 MLS is right, and it is not all of them

The 51 below is **correct to the row**. "Every one MLS" is not — it is a fact
about a 30-day served window being read as a fact about the archive. Reading both
tables directly:

| | MLS | WNBA |
|---|---|---|
| mixed-scheme clusters | 51 | 2 |
| schemes | `provider-composite + unrecognised` | `provider-composite + sport-prefixed-external` |
| `classifyPair` verdict | `indistinguishable` ×51 | **`duplicate` ×2** |

```
WNBA 2026-06-20 duplicate  provider-composite + sport-prefixed-external
    wnba_2026-06-20_atlantadre_indianafev
    WNBA_2026-06-20_dream_fever
```

**The WNBA pairs are a different defect wearing the same shape**, and three
things separate them:

1. **A third id scheme**, not the dash one this document hunts. Lowercase sport
   prefix, underscore separators, ten-character team truncations. Task 1's writer
   hunt was not looking for it and would not have found it.
2. **They classify as `duplicate`, not `indistinguishable`.** `classifyPair`
   returns `duplicate` only on evidence — two rows sharing an event id, or two
   sharing a start time. The 51 MLS pairs carry neither and remain a question;
   calling them duplicates would invent a bug. These two are answered.
3. **They are fixable now.** Task 3 says a shared upsert key "cannot be designed
   until the second writer has a name". That is true of the MLS 51. It is **not**
   true of the WNBA 2, which carry the discriminator a merge needs.

### And most `unrecognised` rows are not duplicates at all

`unrecognised` spans **22 sports and 1007 rows** — MLS 520, FIFA World Cup 103,
MLB 61, EFL Cup 57, and a long tail down to one row each for three UEFA
competitions. **Only MLS produces mixed-scheme clusters.** For the other ~487
rows the non-standard writer is the *only* writer for that fixture, so they are
not duplicates and merging is not the question there. Nothing in this document
distinguished those two situations before now.

### Two counts that look contradictory and are not

`CC-CMD-2026-09-02-d1-write-provenance`'s census reported **591 dash-scheme**;
this sweep reports **1007 `unrecognised`**. Different predicates over the same
rows: the relay's `idScheme` requires a leading ISO date AND no underscore
anywhere; field-laboratory's `schemeOf` calls `unrecognised` everything matching
none of seven known shapes. `unrecognised` ⊇ `dash`, and the 416-row difference
is rows in neither the dash shape nor any recognised one — its own question.

The table also grew **2750 → 2777 in twelve hours**, which is Task 1's "live
writer" conclusion showing up again as a rate.

### What this changes here

- The title. Not MLS-only, and not one dual writer.
- **Task 3 has two cases.** The WNBA one needs no writer identification.
- `relay-duplicate-fixture-watch.mjs` is blind to both, for the reason already
  given: it groups on `espn_event_id` and skips rows lacking one.

## A correction to field-relay-nba#1

That issue's third reported pair reads:

> `MLS 761769  Dallas @ St. Louis (final)  |  a "Scheduled — no start time" stub`

and the issue states every pair "shares one `espn_event_id`". **That is wrong for
this pair.** The final carries `761769`; the stub carries none. I repeated the
claim in a comment on that issue, asserting MLS rows with a numeric id were
covered by the numeric key. They are not, and neither is that pair.

## What is NOT yet known, and must be probed first

**The write path.** `grep` finds exactly one `INSERT INTO regular_season_games`
in this repo, at `POST /archive/game`, and its id is
`` `${sport}_${date}_${idTail}` `` — underscore-separated, which cannot produce
`2026-08-30-mls-stl-dal`. So one of these is true and Task 1 decides which:

1. a write path outside `/archive/game` reaches D1 — `/d1/execute` accepts
   non-SELECT statements and is a candidate;
2. the rows predate the current id scheme and are stale;
3. an external caller passes a `sport` or fields that compose to this shape.

Writing a fix before knowing which would be guessing at the mechanism, which is
the failure `CC-CMD-2026-08-09` recorded when a route was asked for something it
was never built to do.

## Task 1 RESULT — `live-writer`, and the writer is outside this repo

`scripts/probe-dash-scheme-writer.mjs` (field-laboratory), 30 days of public
`/context/date`, artifact `outbox/dash-scheme-writer-2026-09-01T16-06-43-389Z.txt`:

```
dash-scheme rows: 105, 105 carrying created_at
distinct created_at DAYS among them: 4
    2026-06-30  60 row(s)
    2026-07-06  43 row(s)
    2026-08-03   1 row(s)
    2026-08-31   1 row(s)
for contrast, composite rows span 29 created_at day(s)
VERDICT: live-writer
```

### The two singletons are the finding

```
2026-08-30 slate   9 dash rows   created 2026-07-06, 2026-08-31
2026-08-02 slate   8 dash rows   created 2026-07-06, 2026-08-03
```

**A dash-scheme row is INSERTED the day after the game it covers**, twice, a
month apart. `created_at` moving means an INSERT, not an UPDATE of a seeded row.
So this is not two bulk imports and nothing since; something is still writing,
and it wrote yesterday.

That conclusion rests on `stampsAfter > 0`, which fires independently of the
`distinctStamps > 3` count — so it does not depend on where that threshold was
drawn.

### A hypothesis from one capture was wrong, and the sweep is why

`data/context-2026-08-29.json` shows all 15 dash rows at `2026-06-30 17:13:24`,
a single instant, which read as a clean `stale-bulk`. It was recorded as a
hypothesis rather than an answer precisely because a capture is a copy. The
sweep found the two later writes the capture could not contain.

### Explanation (2) is eliminated. The writer is not in this repo.

`grep` across `src/`, `.github/scripts/` and `scripts/` finds **no code that
constructs a dash-separated id**, and exactly one
`INSERT INTO regular_season_games`, whose id is underscore-separated. A live
writer producing a shape no code here builds is external by elimination.

Which endpoint it reaches D1 through is **not determinable from outside**, and
is deliberately not asserted. `/d1/execute` accepts non-SELECT statements and
remains the leading candidate; confirming it needs relay-side evidence, which is
Task 2.

## Tasks

1. ~~**Probe the writer.**~~ **DONE** — `live-writer`, result above. Explanation
   (2) is eliminated, so the "report and stop" branch does not apply.
2. **Map the caller.** The writer is external to this repo and INSERTs the day
   after a game. Identify it from the relay side — request logs, or a
   short-lived log line at the D1 write paths recording caller and statement
   shape. Do NOT guess the endpoint from the id shape; that is what Task 1
   refused to do and the refusal was correct.
3. Then propose one upsert key both writers can agree on. `espn_event_id` cannot
   be it — one side has none, and that is exactly why the shipped numeric key
   does not merge these rows.
4. Do NOT rename existing ids. `briefs.game_id` joins `games.id`
   (`src/analytics-engine.js`) and the 2026-07-15 refusal to backfill applies
   here unchanged.

## Done condition

`node scripts/probe-fixture-identity-duplicates.mjs --days 30` (field-laboratory)
returns **`covered`** or **`clean`** — that is, zero groups invisible to the
event-id watcher. It currently returns `blind-spot` with 51.

That probe is credential-free and already wired as a dispatchable workflow, so
the done condition is one run and its committed artifact, not an assertion
anyone has to be trusted on.
