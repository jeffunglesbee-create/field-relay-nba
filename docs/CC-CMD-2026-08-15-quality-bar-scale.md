# CC-CMD-2026-08-15 — the flat 240 bar is on the wrong scale

**Filed by:** field-laboratory
**Severity:** low — reporting only. The live alert predicate is already correct.
**Type:** measurement + a naming change. No scoring behaviour changes.
**Status:** falsifying test ANSWERED before filing — see the section below. The
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

---
_Generated by [Claude Code](https://claude.ai/code)_
