# Half the scoring table was documentation

## What was wrong

`SCALE` has ten entries. `grep -n "SCALE\." src/journalism-quality.js` returns
one hit, and it covers five of them:

```
661:  const W = { spec: SCALE.spec, statDepth: SCALE.statDepth, variety: SCALE.variety,
662:              density: SCALE.density, fresh: SCALE.fresh };
```

That is the only read in `src/` or `scripts/`. Dims 1-5 are multiplied by their
weight in `base`. Dims 6-10 are summed **raw**, with their ceilings written as
literals inside their own computations — and the two halves had drifted apart in
both directions:

| dim | `SCALE` said | code reaches | expression |
|---|---|---|---|
| arc | 55 | **45** | `(stakes?10:0)+(tension?10:0)+(resolution?10:0)+(bonus?15:0)` |
| ctx | 32 | **25** | `dim7 += 8`, `+= 8`, `+= 9` |
| temporal | 25 | **20** | `Math.round((anchored / statSentences) * 20)` |
| voice | 20 | **30** | `Math.min(30, …)`, all four sport branches |
| matchup | 24 | **30** | `Math.min(30, hits * 10)` |

## Era 4 reweighted exactly those five

Its own `change` string reads *"arc 45->55, ctx 25->32, temporal 20->25, funded
by voice 30->20, density 16->10, matchup 30->24"* — and every from-value is the
code's real ceiling. That is the tell: the era wrote new numbers into a table
`scoreProse` does not consult for dims 6-10.

**One of the six landed.** `density 16->10`, because density is a dim 1-5.

The measured effect stands — the +11.5 gap came from rescoring 190 real rows,
not from reading constants. What was wrong is the attribution: the gap moved
6.4 → 11.5 on the strength of the dims 1-5 changes alone.

Its quoted reweighting ceiling of 41.6 was computed against the declared
weights, so the arithmetic needs redoing against the real scale before it is
cited again. The bound is real; the number is not yet.

## 294 is the scale. 300 never was.

```
base       <= 144   specificity   mean of per-sentence values each <= 1.0
                    statDepth     Math.min(1, …)
                    variety       uniqueW.size / words.length
                    density       Math.min(1, …)
                    freshness     0-100, applied as /100 * 36
dims 6-10  <= 150   45 + 25 + 20 + 30 + 30
```

`Math.min(300, …)` in `scoreProse` has never bound and cannot. Every score in
the archive was computed on a 294-point scale wearing a 300 label.

So correcting `NOMINAL_TOTAL` 300 → 294 **moves no score.** It corrects the
description of scores that already existed. The CC-CMD's scope boundary — *"do
not change the nominal total, 240/196/110 all read against 300"* — was
protecting a number that was never the total.

## The fix runs the other direction

The obvious reconciliation is "make dims 6-10 obey `SCALE`", which moves every
score and every threshold at once. The opposite direction costs nothing:
**`SCALE` becomes a read-out of the scorer, not an input to it.** The ceilings
stay exactly where they are in code; the declaration is corrected to match.
Nothing about scoring changes, and the fiction dies.

`scripts/check-scale-matches-implementation.mjs` keeps it dead. It reads each
ceiling out of the expression that produces it — not out of a second constant,
because a second constant is how the first one drifted — and requires the
declared weight to equal it.

Match counts are exact. A regex that finds three `dim7 +=` lines where it
expects three is trusted; four is `null` and a failure. Guessing from a partial
match is worse than refusing.

**Self-test, 8/8.** Each of the five weights is perturbed individually — a check
that only ever exercised `arc` would pass while four others drifted, which is
precisely the history. Plus three controls: the real table must pass, every
ceiling must have actually been read (all-null would make every perturbation
"fail" for the wrong reason while proving nothing), and —

## The check caught me first

The first version did not strip comments, and the commit that fixed `SCALE`
broke it. The new `SCALE` block annotates each weight with the expression it
came from:

```js
arc: 45,        // (stakes?10:0)+(tension?10:0)+(resolution?10:0)+(bonus?15:0)
```

which doubled the arc match count, tripped the exactly-N rule, and reported
three ceilings as unreadable. The guard was right to refuse rather than guess;
the reader was wrong to count a comment as code. It strips comments now, and
that exact failure is a self-test case: *a comment quoting the code does not
change the ceilings.*

## No new era, on purpose

An era exists to separate two **instruments**, and no instrument changed. Minting
era 5 would split `/quality/report`'s calibration window in half for a change
that cannot move a percentile.

`check-scoring-era-recorded.mjs` couples a fingerprint change to a new era, so
it now takes one other proof: a `correctedOn` + `correction` on the latest era
stating why no score moved. Without the escape hatch the check forces a fake
era; without the requirement, a real reweighting could hide behind the word
"correction".

**Demonstrated failing** by deleting `correctedOn` from era 4:

```
FAIL a SCALE change without a new era is a declared correction
exit 1
```

## Why this was step 1

`CC-CMD-2026-08-23-finality-dimension` asks for a new dimension and sets two
constraints: don't move the nominal total, and don't double-count arc and ctx by
funding the new dimension from them without saying so. **Both were
unenforceable** while five weights were fiction — a declaration in `SCALE` was
inert prose, and the total was a label.

They are enforceable now. Finality can be funded from real ceilings
(`arc 45→33`, `ctx 25→17`, `finality 20`), the total holds at 294, `scoreThreshold: 240`
keeps meaning what it meant, and a reader can check the subtraction.

## Fifth instance of one defect class this session

A value declared and never consumed.

| where | the value | what it actually was |
|---|---|---|
| `docs/history-boundary.txt` | a commit sha | rebased away by its own push |
| `stale-data-sentinel.js:39` | `entries` | computed, read by nothing |
| check 4 | `written_at` | when a row moved, not when its text was written |
| `drift-sentinel.yml` | the vocabulary artifact | written to a runner, never staged |
| `SCALE` | five of ten weights | documentation |

## Status

| | |
|---|---|
| scores changed | **none** — dims 6-10 were never read |
| `check-scale-matches-implementation` | 5/5 live, 8/8 self-test, all five perturbations caught |
| `check-scoring-era-recorded` | 8/8, correction rule demonstrated failing |
| next | finality dimension, funded from real ceilings, total held at 294 |

## Files

- `src/journalism-quality.js` — `SCALE` dims 6-10 corrected to real ceilings;
  era 4 gains `correctedOn`/`correction`; `NOMINAL_TOTAL` 300 → 294
- `scripts/check-scale-matches-implementation.mjs` — new
- `scripts/check-scoring-era-recorded.mjs` — fingerprint, 294, correction rule
- `.github/workflows/deploy.yml` — new gate step
