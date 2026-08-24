# briefs_counted: 0, cleared_196: 66, all_passed: true — twice

## Result

```
quality-scale-verify-20260822T234307Z  briefs_counted: 0  cleared_196: 61  all_passed: true
quality-scale-verify-20260823T145535Z  briefs_counted: 0  cleared_196: 66  all_passed: true
```

Zero briefs counted, and sixty-six of them cleared 196. Published two days
apart, both reporting success. Eleven assertions passed because not one of them
read `briefs_counted`.

One line did it, `scripts/verify-quality-scale-2026-08-16.mjs:114`:

```js
n: x.n ?? x.count ?? null,                            // then...
const tot = (k) => rows.reduce((s, x) => s + (Number(x[k]) || 0), 0)
```

`/quality/report` serves `total` and `scored`. It has never served `n` or
`count`. Both guesses missed, `n` was null on all 48 rows.

## The null was the honest part

`n: null` correctly said *I do not know*. Two operators laundered it:

- `??` dressed the unknown as a deliberate value
- `Number(...) || 0` made it arithmetic

A sum over 48 erased unknowns is indistinguishable from a real zero. Neither
operator is wrong on its own — `type: e.type?.text ?? null` in a probe is honest,
because it *publishes* the null. What is wrong is either one standing between a
possibly-absent field and a number that gets summed.

**This is a new shape for this session.** Every earlier instance was a value
whose name and measurement disagreed. This is the next stage: an unknown
converted to a number and then aggregated, after which no reader can recover the
difference.

And this is the probe whose own note said it existed to inform the 110-vs-240
judgement. It informed it with a denominator of zero. That question was settled
by measuring `runQualityChain` directly instead, which is the only reason it
didn't bite.

## The static guard's first version was a bad instrument

Recorded because the failure is instructive. It flagged any coalescing chain
ending in `null`/`0` on a member expression: **27 hits across 45 scripts, one of
them the defect.** A guard at 4% precision gets ignored, and an ignored guard is
the same as no guard.

The defect was never "a coalesce exists". Retargeted to the actual shape — a
coercion inside a `reduce` callback:

```
n + (r.total || 0)                     verify-2f-score-bias.mjs:53
sum + (dims[k] || 0) * (W[k] ?? 0)     rescore-quality-6b.mjs:89
s + (Number(x[k]) || 0)                the one that shipped
```

Three hits across 44 scripts, two genuine. Coercions on the reduce's own
accumulator are exempt — `(a[k] || 0) + 1` creates a tally slot on purpose rather
than hiding a missing input — with an assertion that the exemption keys on the
accumulator **name** and still catches `a + (d.count || 0)`.

## The second instance was worse than the first

`rescore-quality-6b.mjs` mapped `matchupDepth: 'matchup'` and had **no `finality`
entry at all**. Era 5 added Dim 11 (20 points); era 6 renamed the Dim 10
breakdown key `matchupDepth` → `marginAgreement` and the SCALE key `matchup` →
`margin`. After both, `dims.matchupDepth` and `W.matchup` were undefined, and
`(dims[k] || 0) * (W[k] ?? 0)` turned each miss into a silent zero.

`scoreUnder` reconstructed a **244-point rubric and reported it under
`nominal_total: 294`**. It shows as the candidate block disagreeing with the
rescored means sitting beside it in the same manifest:

| manifest | rescored gap | candidate gap | |
|---|---|---|---|
| `20260824T053829Z` | −14.0 | −14.1 | agree (pre-era-5) |
| `20260824T121117Z` | −0.2 | −11.1 | **disagree by 10.9** |

`DIM_TO_SCALE` is now asserted complete against `SCALE` at import, and
`scoreUnder` throws on a missing dim or weight instead of contributing zero.

## Correction to era 5's published record

Era 5's `measuredEffect` read **"−11.1 at 4.1× → −0.2 at 0.1×"**. The −11.1 is
not from the before-run at all — it is `candidates.current` in the **after** run,
from the broken block above. The published before/after compared two different
instruments inside one run, one of them measuring a rubric that excluded the very
dimension the era added.

Corrected to one instrument, `rescored.gap_rescored`, on both runs:

```
BEFORE  -14.1 at 4.4x the standard error
AFTER    -0.2 at 0.1x  — INDISTINGUISHABLE from noise
```

**The conclusion is unchanged and the effect is larger than was published.** The
error was in the citation, not the finding.

## The fix, four parts

1. **Read the real field.** `scored` — briefs that *have* a quality_score, the
   right denominator for "cleared 196". `total` includes unscored rows, which
   cannot clear any bar.
2. **No coalescing between a missing field and an aggregate.** `total()` sums
   only numbers and reports `skipped`. `0 (48 skipped)` and `0 (0 skipped)` are
   different findings and used to look identical.
3. **Assert the relay contract by field name** (Rule 60), so a rename on the
   relay side reds the probe instead of nulling it.
4. **Invariants that make the impossible pair fail** — `cleared_196 <=
   briefs_counted`, `above_240 <= cleared_196`, and a zero denominator may not
   sit beside a non-zero numerator.

One implementation in `scripts/lib/summary-invariants.mjs`, taking rows and
nothing else — era 5's lesson was that one implementation with two consumers
still diverges if they hand it different arguments, so there is no argument to
get wrong.

## What makes the guard more than a claim

The replay half feeds **both actual published artifacts** through the invariants
and requires them to go red:

```
20260822T234307Z  rows=47  briefs_counted=0  cleared_196=61  all_passed=true  -> 3 invariants fail
20260823T145535Z  rows=48  briefs_counted=0  cleared_196=66  all_passed=true  -> 3 invariants fail
```

Plus an assertion that every artifact failing an invariant had claimed
`all_passed: true` — the point being that these were not reported as failures at
the time.

## Files

- `scripts/lib/summary-invariants.mjs` — `total`, `CONTRACT`,
  `missingContractFields`, `invariants`
- `scripts/check-aggregate-launders-unknowns.mjs` — new deploy gate, static +
  replay
- `scripts/verify-quality-scale-2026-08-16.mjs` — real fields, contract
  assertion, invariants
- `scripts/verify-2f-score-bias.mjs` — routed through `total()`, throws on a
  short read
- `scripts/rescore-quality-6b.mjs` — `DIM_TO_SCALE` completed and asserted,
  `scoreUnder` throws
- `src/journalism-quality.js` — era 5's `measuredEffect` corrected
- `.github/workflows/deploy.yml` — the gate
