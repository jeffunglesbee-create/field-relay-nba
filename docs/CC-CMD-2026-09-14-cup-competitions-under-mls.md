# CC-CMD-2026-09-14 — five cup competitions are filed under `sport = MLS`

Filed per Rule 87.4 from `CC-CMD-2026-09-13-archive-duplicate-rows`, whose 82
escalations turned out to be a symptom of this rather than a duplicate problem.
Not deferred without a spec.

## Measured 2026-09-14

`postseason_games`, every row where `sport = 'MLS'`:

| league | rows | opening odds | closing odds | dates |
|---|---:|---:|---:|---|
| CONCACAF Champions Cup | 80 | **0** | **0** | 2026-02-04 → 05-07 |
| Leagues Cup | 63 | **0** | **0** | 2026-08-04 → 08-27 |
| U.S. Open Cup | 58 | **0** | **0** | 2026-04-14 → 09-17 |
| TELUS Canadian Championship | 40 | **0** | **0** | 2026-05-05 → 10-21 |
| Campeones Cup | 2 | **0** | **0** | 2026-09-16 → 09-17 |

**243 rows, five competitions, one sport label, and not one line of odds ever.**

For contrast, `regular_season_games` at the same sport label: 157 MLS-league rows
carry 96 opening lines, and 367 `(null)`-league rows carry 74.

## Why the label is the defect

`runOddsBackfillForDate` buckets pending rows by `sport`, so every one of these
243 is matched against a `soccer_usa_mls` payload. That payload carries MLS
LEAGUE fixtures. San Diego FC vs Pumas in the CONCACAF Champions Cup is not in
it and never will be. The rows are not failing to match — they are being asked
the wrong question.

This is the same shape as two defects this repo has already fixed:

- the 2026-08-06 `UPDATE … SET sport = league` pass, which corrected 52 rows
  whose `sport` said FIFA World Cup and whose `league` said otherwise — and
  which evidently did not cover cup competitions;
- the `FIFA World Cup 2026_` ids still carried by 32 rows whose `sport` column
  was corrected but whose id was deliberately left alone.

In all three, `sport` was set from the context a writer happened to be in rather
than from the competition the game belongs to.

## Not claimed

That relabelling makes these rows get odds. Whether The Odds API covers any of
these five competitions is UNKNOWN and is Task 0's first question — a correct
label that maps to no odds key is still a correct label, but it is a different
outcome and the CC-CMD must not promise the wrong one.

## Tasks

0. **Probe before deciding.** For each of the five leagues: is there an Odds API
   sport key? `archiveSportToOddsKey` is keyed on the archive `sport` label —
   **the artifact is that map's current contents beside the five league names**,
   so the answer is "these two map, these three do not" rather than a hope.

1. **Find the writer.** Which call path sets `sport = 'MLS'` on a Champions Cup
   tie? `/archive/game` takes `sport` from its POST body, so the caller is
   outside this repo or in a schedule import. **Name it before changing rows.**

2. **Decide label vs id.** The 2026-08-06 fix corrected `sport` and deliberately
   left `id` alone because `briefs.game_id` joins `games.id`. The same
   constraint applies here and the same answer is probably right — record it
   either way rather than rediscovering it.

3. **Any D1 write needs explicit owner approval.** 243 rows is a live mutation
   of archive data and is not authorised by this document.

4. **Outbox manifest** per Rule 67.

## Done condition

`postseason_games` holds no row whose `sport` names a competition its `league`
contradicts, shown by a committed query grouping `sport` against `league` with
zero disagreeing groups — not "the labels look right" (Rule 89).

## What is already handled

The 82 collisions these rows produce are no longer escalated as odds hazards.
The watch condition is `same_slate_pair_collisions_odds_disagree`: a collision
counts only when its two rows hold DIFFERENT odds (including one holding a line
and the other none), compared on a digest of the blob rather than the
`has_*_odds` booleans. These 82 pairs carry no odds on either side, so they
agree and are inert. The duplication remains visible in the raw
`same_slate_pair_collisions` count as archive hygiene. Nothing here waits on
that.

Superseded 2026-09-14: the earlier `same_slate_pair_collisions_with_odds` asked
whether EITHER row carried a line, which is a condition that can never close —
filling the 32 half-truth pairs removes the hazard and leaves both rows carrying
odds. The relay still serves that key as an alias for one cycle.
