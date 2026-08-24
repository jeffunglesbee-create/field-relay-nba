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

---

## Addendum — verified by a second instrument, and one claim above was wrong

### The convergence

Two `rescore-quality-6b` runs, seventeen minutes apart, either side of the
correction:

| manifest | `scale` dims 6-10 | `rescored.gap_rescored` | `candidate_summary` "current" |
|---|---|---|---|
| `045804Z` (before) | 55, 32, 25, 20, 24 | 4.5 (1.8x) | **8.6** (2.9x) |
| `051526Z` (after) | 45, 25, 20, 30, 30 | 4.5 (1.8x) | **4.5** (1.8x) |

Those two columns are computed by different code. `gap_rescored` comes from
`scoreProse()` totals — the real scorer, which reads literals. `candidate_summary`
computes `Σ(dim_k × SCALE_k)` — the declared table. They disagreed by 4.1 points
and now agree exactly.

That is the disconnect measured from outside, and its repair verified from
outside. Nothing in this change shares code with the thing that checked it.

### The claim above that was wrong

This document said: *"The measured effect stands — it came from rescoring 190
real rows, not from reading constants."*

Real prose, simulated instrument. The rows were real; the weighting applied to
them was `Σ(dim_k × SCALE_k)`, which production never computes for dims 6-10. So
era 4's recorded **+11.5 was never a production number**, and neither was the
6.4 it improved on.

**The live effect of era 4 is 4.5 points at 1.8× the standard error** — a figure
the script's own verdict calls *"INDISTINGUISHABLE from noise at this n"*.
`density 16->10` was the only change that reached the scorer, and it did not move
the gap out of noise.

`SCORING_ERAS[4].measuredEffect` now says this, with both manifests cited.

### Third correction: the reweighting ceiling

`forward_only_bound` — all weight on the three forward dimensions — is **38.2**
against the real scale. The CC-CMD and era 4 both quote 41.6, computed against
the declared one. The bound was always real; the number was 8% high.

### What this does to the finality ask

It removes the floor the ask was measured against. Finality is not "adding to
11.5" — it would be the first change to move the number at all, from a baseline
that is statistically zero.

It also exposes a contradiction inside the ask, independent of any of the above:

- `LIVE_LANG` classifies **by prose alone** — `'%at halftime%'`,
  `'%through 4_ minutes%'`. The done condition therefore measures the gap between
  prose that hedges and prose that does not.
- The ask's §2 requires scoring the disagreement **both ways**: a correctly
  hedged brief on a genuinely live game must score HIGH.

Build §2 and that gap can narrow. The done condition would report failure for a
dimension working exactly as specified.

**Replacement metric, same data, one extra join:** the 2×2 of
`regular_season_games.finalized_at` × reads-as-final, scoring the agreeing
diagonal. It measures what the dimension does rather than what correlates with
it, and it is the only split under which "score the disagreement both ways" can
show a gain.

## Status after the addendum

| | |
|---|---|
| step 1 | verified by an independent instrument; two runs, converged |
| era 4 record | corrected to the live 4.5 / 1.8x, both manifests cited |
| reweighting ceiling | 41.6 -> 38.2 against the real scale |
| step 2 | **blocked on a metric decision, not on code.** The dimension is designable (fund from real ceilings: arc 45->33, ctx 25->17, finality 20, total held at 294); its done condition is not usable as written. |

---

## Step 2, part one — the dimension exists, unwired, with the metric that can see it

Recommendation taken: amend the done condition to the 2x2 rather than narrow the
ask to one direction. The ask names both defects and the mirrored one is real; a
metric that cannot see half of what a dimension does is the wrong metric, not a
reason to build half a dimension.

### Shipped, STAGED

`finalityAgreement(text, isFinal)` in `src/journalism-quality.js`, exported,
`FINALITY_MAX = 20`, **not wired into scoreProse**. Its consumer today is
`scripts/rescore-quality-6b.mjs`, which projects its effect on real rows before
it is allowed to change a score (Rule 63 — staged, marked, and with a caller).

`isFinal` is three-valued. A joined game row with no `finalized_at` is KNOWN
unfinished; no joined row at all is unknown. A boolean would merge two different
facts, and the second one is not evidence about anything.

| game | prose reads | score | verdict |
|---|---|---|---|
| final | final | **20** | `agrees` |
| final | hedged | **0** | `hedges-a-finished-game` |
| live | hedged | **20** | `agrees` |
| live | final | **0** | `calls-a-live-game-final` |
| unknown | — | 10 | `unknown-finality` |
| either | neither / both | 10 | `no-clear-reading` |

The two abstains score the midpoint and say which one they are. Zero would repeat
Dim 10, which scored zero on 190 of 190 rows and passed every aggregate test for
two months while doing nothing.

### One implementation, two consumers, deliberately

Era 4's recorded effect was a projection `scoreProse` never applied, because the
projection and the scorer each carried their own copy of the weights. The
rescore script now **imports** this function; when it ships, `scoreProse` calls
the same one. There is nothing left to diverge.

### The metric

`m.finality_2x2` reports `n_agrees` / `n_disagrees` / `n_abstained`, a
`by_verdict` census, `mean_finality_when_final` and `mean_finality_when_live`
(both must be non-zero — the Dim 10 test), and two gaps on the same rows:

- `gap_current_same_rows` — today's scorer, agrees vs disagrees
- `gap_projected` — under the funded weighting, `arc 45->33`, `ctx 25->17`,
  `finality 20`, total held at 294

Funding is arithmetic, not assertion: `dims.arcScore` and
`dims.contextAnchoring` are fractions of 45 and 25, so each row loses its own
fraction times the points taken back. That is the CC-CMD's §3 — the answer to
"is this just re-buying arc and ctx under a new name" is a subtraction anyone
can check.

The LIVE_LANG figures stay in `rescored`, unchanged, so every earlier run
remains comparable.

### Guard

`scripts/finality-agreement-check.mjs`, gated in `deploy.yml`. Nine assertions,
every one an input/output pair. Two are controls that matter more than the
corners:

- **the four corners are not all the same number** — a dimension whose corners
  agree is a constant with extra steps
- **the same prose scores differently against different facts** — if the fact
  does not change the score, the dimension is reading the prose, which arc and
  ctx already do

### Still open, and it is the interesting half

`gap_projected` is unmeasured — the run needs CI (`*.workers.dev` is 403 from
this sandbox). The prediction, recorded before the number exists so it can be
wrong: with the live baseline at **4.5 (1.8x noise)**, a dimension reading the
fact should clear it comfortably, because the fact is not a proxy. If it does
not, the reading vocabulary is too narrow and the `no-clear-reading` count will
say so directly — that census is in the manifest for exactly this reason.

**Unblocks part two:** a `gap_projected` with n >= 8 per side and both
`mean_finality_when_*` non-zero. Then `scoreProse` gets the call, `SCALE` gets
`arc: 33, ctx: 17, finality: 20`, and era 5 ships with a measured effect — a
real one this time, confirmed post-deploy rather than projected and left there.

---

## Part two — era 5, the first instrument change since era 3

Dim 11 is wired into `scoreProse`. 20 points, funded entirely from the two
proxies it replaces: `arc 45->33` (literals `10/10/10/15 -> 8/8/8/9`),
`ctx 25->17` (`8/8/9 -> 6/6/5`). Nominal total unchanged at 294.

### The justification is a measurement of the OLD instrument

Era 4's recorded effect was a projection of the new one, and it described a
weighting the scorer never applied. This states what the rubric could not do,
on real rows, before anything changed:

```
blindness   gap_current -4.0   se 4.7   ratio_to_noise 0.9
            n_agrees 13   n_disagrees 33
            "the current rubric CANNOT separate these rows"
```

Three samples, three different draws, never above 1.0x. The ten-dimension rubric
scores a recap that correctly reports a finished game and one that hedges about
it the same.

**The dominant defect is the mirrored one**, which nothing was measuring:
28 of 128 briefs hedge about games that had already finished, against 1 that
calls a live game final.

**Both sides non-zero** — `mean_finality_when_final 6.9`,
`mean_finality_when_live 10.0`. That is the parent ask's done-condition #3, and
the test Dim 10 failed silently for two months at zero on 190 of 190 rows.

**And the sign of the old metric reverses under fact-stratified sampling:**
LIVE_LANG gap `+4.5 (1.8x) -> -14.1 (4.4x)`. Era 4 and the parent CC-CMD were
both reasoning from a direction that was an artifact of taking the newest rows.

### Two guards, both fixed by trying to use them

**`check-scale-matches-implementation`** learned Dim 11: its ceiling is read from
`export const FINALITY_MAX = 20`, so the declared weight and the constant cannot
drift apart. 11 dimensions, self-test green.

**The correction rule could not fire.** It compared `CURRENT_SCORING_ERA` against
`EXPECTED_ERA_FOR_FINGERPRINT` — two values updated together in the same commit,
so always equal. It failed era 5, a legitimate new era, while a SCALE edit that
bumped only the fingerprint would have passed. Exactly backwards.

Fixed by giving the file real history: `PREVIOUS_SCALE_FINGERPRINT` and
`PREVIOUS_ERA`. A fingerprint change is now legal only if it mints an era or
carries a `correctedOn`, and a second assertion fails if the previous fingerprint
was not updated — otherwise the rule silently stops firing again.

### Plumbing

`finalizedAt` added to `opts.game` at the two games-table call sites (`~6715`,
`~12849`). Sites without it pass `undefined`, which the dimension reads as
unknown and abstains at 10 rather than scoring zero.

### Status

| | |
|---|---|
| era 5 | shipped, `measuredEffect` carries the BEFORE measurement with artifacts named |
| AFTER | pending the first post-deploy `rescore-quality-6b` run |
| guards | 6/6 green, including the two repaired this commit |
| scores | **every brief's score moves.** First real instrument change since era 3 — era 4 moved nothing. |
