# CC-CMD-2026-09-01-mls-dual-writer-duplicate

**Filed from:** field-laboratory, from a fixture-identity sweep.
**Ask to:** field-relay-nba — the write path is NOT yet identified; Task 1 is
finding it.
**Relationship:** the second CC-CMD required by Rule 87 (4) before
`CC-CMD-2026-09-01-archive-game-numeric-espn-upsert-key` can be closed, and
before field-relay-nba#1 can be closed.
**Status:** OPEN.

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

## Tasks

1. **Probe the writer.** For one known pair, read both rows' `created_at` from
   D1 and compare against the deploy that introduced the current id scheme.
   Determine which of the three explanations holds. **Report and stop if it is
   (2)** — stale rows are a cleanup, not a code change, and need their own spec.
2. Only if (1) or (3): map the caller, then propose a single upsert key both
   writers can agree on. `espn_event_id` cannot be it — one side has none.
3. Do NOT rename existing ids. `briefs.game_id` joins `games.id`
   (`src/analytics-engine.js`) and the 2026-07-15 refusal to backfill applies
   here unchanged.

## Done condition

`node scripts/probe-fixture-identity-duplicates.mjs --days 30` (field-laboratory)
returns **`covered`** or **`clean`** — that is, zero groups invisible to the
event-id watcher. It currently returns `blind-spot` with 51.

That probe is credential-free and already wired as a dispatchable workflow, so
the done condition is one run and its committed artifact, not an assertion
anyone has to be trusted on.
