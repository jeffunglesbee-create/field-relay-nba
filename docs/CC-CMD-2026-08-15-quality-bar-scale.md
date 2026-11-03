# CC-CMD-2026-08-15 — the flat 240 bar is on the wrong scale

**Filed by:** field-laboratory
**Severity:** low — reporting only. The live alert predicate is already correct.
**Type:** measurement + a naming change. No scoring behaviour changes.
**Status:** OPEN — falsifying test ANSWERED before filing — see the section below. The
recommendation survived it. One sub-question remains open for D1.

## The finding, in one line

`240` is **80.00%** of the 300-point rubric and **97.96%** of the 245 points this
worker can actually produce. It is reported as though it were the former.

## Established, not argued

`src/journalism-quality.js` states its own reachable total in its header:

```
// Worker runtime: no localStorage, no DOM, game object not available (relay
// scores without game context — Dims 7/10 return N/A, ceiling reduces to 245)
// Ceiling breakdown: 150(base) + 45(arc) + 25(ctx=N/A→0) + 20(temporal) +
//                    30(voice) + 30(matchup=N/A→0) = 245
```

So **55 of 300 points are unreachable by construction** — Dim 7 (Context, 25)
and Dim 10 (Matchup, 30) — not by writing badly.

`/quality/report` then reports every brief against a flat 240:

| quantity | value |
|---|---|
| headroom between 240 and the reachable ceiling | **5 points**, across eight dimensions |
| four fifths of the *reachable* scale | **196** |
| `above_240`, all 25 brief_type/sport rows, 7-day window (2026-08-15) | **0** |
| `below_flat_240_pct`, all 10 alerts | **100** |
| best brief in that window | **230** |

And offline, over the 592-brief `mlb_game` corpus already committed in
field-laboratory (`data/jq-mlb-game-corpus.json`):

- post-`6aed3bb`: **0 of 267** clear 240; best **179**, sixty-one short
- pre-`6aed3bb`: **31 of 325** exceed even 245, max **300**

The pre-era row is the control and it is the important one. Under the old
**unclamped** Dim 4, briefs blew past the documented ceiling entirely. The bar
looked survivable then for an arithmetic reason, not an editorial one — which is
why "scores dropped" and "the bar is on the wrong scale" are separate facts.

The five points of headroom have to absorb, among others, the 36-point Dim 5
freshness term, which is driven by a third-party word-frequency API and returns
83 on any Datamuse failure.

## Credit where it is due — and what this is NOT

**The alerting is already fixed.** The live predicate uses per-brief_type
calibrated percentiles — `threshold_source: brief_type_p25(n=57,era3)`, values
**123 to 169** — and `alert_count` is 10 against `alert_count_legacy_predicate`
13. This CC-CMD does not ask for that to change.

What remains is that 240 survives as a **reported** figure: `below_240`,
`above_240`, `below_flat_240_pct`. A constant 100 reads as a quality catastrophe
when it is an arithmetic certainty, and any consumer of those fields inherits the
confusion.

## The falsifying test — RUN, and the result

This CC-CMD was filed with a query designed to kill it. Two ways it could die:

1. **If anything clears 240**, the flat bar is a real bar and item 2 is wrong.
2. **If nothing clears 196 either**, a four-fifths bar merely relocates the
   problem and this CC-CMD is answering the wrong question.

Both halves are settled **without D1**, from `/quality/report`'s own `max_score`
column, 2026-08-15, seven-day window, 25 brief_type/sport rows:

```
122 125 130 130 148 132 171 135 179 156 148 148 153
172 205 200 173 173 230 211 209 185 209 189 221
```

A per-row **maximum** is more decisive than it looks. If a row's max is below a
bar, **no** brief in that row cleared it — exact, not an estimate.

| test | result |
|---|---|
| rows whose max reaches **240** | **0 of 25** — so `cleared = 0` exactly |
| rows whose max reaches **196** | **7 of 25** — `230, 221, 211, 209, 209, 205, 200` |

So **196 separates rows and 240 separates none.** The recommendation survives its
own falsifying test.

**What this does NOT answer:** the *count* of briefs clearing 196. A per-row
maximum proves at least one, never how many. That still needs the row data, and
it is the one thing worth running D1 for:

```sql
SELECT brief_type,
       COUNT(*)                                             AS n,
       MAX(quality_score)                                   AS best,
       SUM(CASE WHEN quality_score >= 196 THEN 1 ELSE 0 END) AS cleared_196
  FROM briefs
 WHERE created_at >= '2026-08-13 03:20:00'   -- era 3 only
   AND quality_score IS NOT NULL
 GROUP BY brief_type
 ORDER BY best DESC;
```

If `cleared_196` turns out to be a very small fraction of `n` across the board,
196 is technically discriminating but practically another unreachable bar, and
item 2 should be revisited rather than adopted. Report the row either way.

## Requested

1. **Name the scale wherever the flat bar is reported.** Either rename the fields
   to carry their denominator (`below_240_of_300_nominal`) or emit the reachable
   ceiling alongside them (`reachable_ceiling: 245`), so a reader can see that
   `below_flat_240_pct: 100` means "below 98% of achievable".
2. **If the flat bar is meant as a four-fifths standard, state it on the scale it
   is applied to** — 196 of 245 — rather than as a constant carried over from a
   rubric total the worker cannot reach. *Survived the falsifying test above;
   confirm against `cleared_196` before adopting.*
3. **Consider deriving the ceiling rather than hardcoding it.** It is currently a
   comment. Summing the weights actually in play would make it move when a
   dimension is added, disabled, or returns N/A.

Nothing here changes a score.

## Where the evidence lives

- `field-laboratory/src/Ceiling.fs` — the two scales as distinct types
- `field-laboratory/docs/CEILING-PROOF.md` — five compiler rejections, including
  that a threshold of 240 on one scale cannot be assigned to 240 on the other
- `field-laboratory/scripts/ceiling-check.mjs` — 16 assertions, run in `verify`,
  including the falsifying test above so it re-runs rather than being asserted once
- `field-laboratory/outbox/cc-quality-ceiling-2026-08-15.md`

## Addendum 2026-11-03 — `session_health` reports the same flat 240 as "degraded"

Added here under BUILD-ON-A and not filed again: it is the symptom of Request 1 (the flat
bar reported without its scale) on a second surface. The owner's could-not-verify list
asked about "the 50 degraded quality entries in session_health (no baseline in any
document)". Measured on 2026-11-03 at 07:5xZ, from the route's own SQL on D1 `field-archive`.

**What an entry is.** `quality.degraded` in `session_health` (search `ENRICHMENT_SH` in
`src/index.js`) groups `briefs` since today minus six days by (`brief_type`, `sport`), keeps
groups with `scored >= 3`, drops the six enrichment types and any sport containing `golf`,
keeps `ROUND(AVG(quality_score), 1) < 240`, and returns each group's `brief_type`. Its
origin is `CC-CMD-2026-06-24-phase8b-cleanup-quality-align.md` Task 2 (170 to 240, one day
to seven). It is the flat bar, uncalibrated, applied to a group average.

| quantity, window 2026-10-28 to now | value |
|---|---|
| groups the predicate considers | 43 |
| groups it lists as degraded | 43 |
| groups at or above 240 | 0 |
| lowest and highest group average | 158.5 and 205.2 |
| best single brief | 246 |
| scored briefs behind the 43 | 828 |
| distinct `brief_type` names among the 43 entries | 7 (an entry is a name; a name repeats once per sport) |

**The series, so the baseline is written down.** The same SQL with the window moved to the
six days before each date and that date, 60 days from 2026-09-05 to 2026-11-03:

| quantity | value |
|---|---|
| days on which degraded equals eligible | 60 of 60 |
| fewest and most entries on a day | 24 and 55 (2026-10-27) |
| entries on 2026-11-01, 11-02, 11-03 | 50, 48, 43 |
| highest group average on any of the 60 days | 213.3 |

**Reading.** The list is every scored, non-enrichment, non-golf group, every day: no group
has averaged 240 in the 60 days. Its length counts how many (`brief_type`, `sport`) groups
reached three scored briefs that week, which follows the slate. 50 sits inside 24 to 55 and
is not a deviation; 20 or 60 would not be one either. The figure that would be a baseline,
the count of eligible groups, is not reported beside it.

**The calibrated reading of the same week.** `/quality/report` (`days` 7, `since`
2026-10-27): `alert_count` 22 against `alert_count_legacy_predicate` 48. Of the 22, 18 come
from the failure-rate clause (more than a fifth of a group's scored briefs below its
calibrated p25) and 4 from the group average below its p25; one summary row has a brief
above 240, and it is the 246.

**Requested 1, status by surface.** `/quality/report` names the scale (`flat_bar` 240,
`flat_bar_pct_of_reachable` 95.24 of a reachable 252, `four_fifths_of_reachable` 202).
`session_health` still carries the bare 240.

**Not built, and why each waits.**

1. Additive fields beside `degraded` in `session_health`: `eligible` (the groups
   considered), `flat_bar` and `reachable_ceiling`. No score and no list changes, and no
   bar is chosen. It edits `src/index.js`, so it is a relay deploy. About 30 minutes with
   its check. Unblocked; waiting for the owner's word because it is a deploy.
2. Replacing the flat predicate with the calibrated one. That chooses the bar, which
   `CC-CMD-2026-09-10-quality-bar-true-ceiling.md` reserves for the owner.

**Not examined.** Whether anything acts on a non-empty `degraded` list.

---
_Generated by [Claude Code](https://claude.ai/code)_
