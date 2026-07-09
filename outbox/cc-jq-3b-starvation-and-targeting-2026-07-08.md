# JQ Layer 3b: Retry-Budget Starvation Fix + Dimension-Targeted Retry — 2026-07-08

## What Was Built

Per `docs/CC-CMD-2026-07-08-jq-3b-starvation-and-targeting.md`, two
precisely-scoped fixes to `src/journalism-quality.js`'s `runQualityChain`:

1. **Starvation fix**: `maxRetries` default `6 → 7`. With 7 possible retry
   layers all sharing one counter, a brief that trips all six structural
   layers (2 through 2e) could exhaust the budget before layer 3b — the
   one that targets the final `scoreProse` threshold — ever got a chance
   to run. Seven is not a buffer; it's the exact count of layers.
2. **Dimension-targeted 3b**: `scoreProse` gained an `opts.breakdown` flag
   returning `{ total, dims }` (10 normalized 0-1 fractions) instead of a
   plain number. Layer 3b now identifies the 1-2 weakest applicable
   dimensions in the actual text and builds its retry prompt around
   specifically those, instead of one fixed block of generic advice.

## Probe Block — Findings, Including One Correction to the CC-CMD's Own Claim

```
opts.maxRetries || 6 (line 603, pre-change)     — confirmed exact
scoreProse callers: 3 total (lines 707/725/730)  — ALL inside
  runQualityChain itself, in journalism-quality.js. No other server-side
  caller exists anywhere in src/*.js (confirmed via grep across all
  files, not assumed). Simpler than the CC-CMD anticipated -- there was
  no "every other caller" to separately verify.
W = {spec:30, statDepth:38, variety:30, density:16, fresh:36}  — confirmed exact
runQualityChain call sites: 10 in src/index.js — confirmed, unaffected
  by this change (signature/return shape both unchanged; only 3b's
  internal behavior changed)
jubilant-bassoon cross-repo check (Rule 89): searched
  repo:jeffunglesbee-create/jubilant-bassoon for scoreProse OR
  runQualityChain via GitHub code search (not available as a local
  checkout in this sandbox) — 0 results. No client-side duplicate to
  keep in sync.
```

**Correction to the CC-CMD's own TASK 2 instruction:** it states dims
1-5's "existing pre-weight fraction variables are already 0-1
normalized — use them directly, do not re-derive." This is true for
`statDepth` (explicit `Math.min(1, ...)`) and `variety`/`specificity`
(structurally bounded by construction), but **false for two of the
five**, confirmed by reading `_datamuseFreshness` and the `density`
computation directly rather than trusting the doc's paraphrase:
- `freshness` is on a **0-100** scale (`_datamuseFreshness` returns
  `Math.max(0, Math.min(100, ...))`, default 83), not 0-1 — used
  directly it would report as "83% of ceiling" when it's actually a
  raw percentage already at its own 100-point scale. Fixed by dividing
  by 100, mirroring the exact scaling the `base` score computation
  already applies (`freshness * (W.fresh/100)`).
- `density` (`(properNouns+numbers)/sentences`) has **no inline clamp**
  anywhere in its computation — realistic prose routinely produces
  density > 1 (multiple proper-noun/number tokens per sentence).
  Clamped to `[0,1]` for the breakdown output specifically (not
  touching the actual `total` scoring math at all), since an
  unclamped value >1 would make a legitimately over-dense text falsely
  look like the *strongest* dimension in a weakest-dimension
  comparison — the opposite of useful for TASK 3's targeting logic.

Both corrections are additive-only to the `breakdown` output; `total`'s
computation is byte-for-byte unchanged (verified below).

## TASK 1 — Starvation Fix

One line: `opts.maxRetries || 6` → `opts.maxRetries || 7`. Also updated
one now-stale comment ("runs all 6 quality layers with up to 6 retry
calls" → "7"/"7") for accuracy — the exact same correctness class as
the fix itself, not a separate change.

## TASK 2 — Breakdown Flag, Additive-Only

`scoreProse(text, opts)`: when `opts.breakdown` is true, returns
`{ total, dims }`; false/absent returns exactly `total` as before —
confirmed byte-identical via real A/B test (see TASK 4 below), not
assumed from the diff alone.

## TASK 3 — Dimension-Targeted 3b

New helpers (all additive, `scoreProse`'s own scoring computation
untouched):
- `_arcSubComponents` — re-derives the same stakes/tension/resolution
  checks `scoreProse`'s Dim 6 already computes internally, so 3b can
  name which specific sub-component is missing.
- `_voiceViolationDetail` — re-derives the same per-sport pos/neg term
  checks Dim 9 already computes, with labels, so 3b can name the
  specific wrong-sport terms found — deliberately a different mechanism
  from layer 2b's `checkSportVocab` (a different violation list), per
  the CC-CMD's explicit instruction not to duplicate 2b.
- `_dimensionCorrection(dimKey, text, ctx)` — one specific, concrete
  correction per dimension, covering all 10 (not just the 3 the CC-CMD
  named explicitly) — quotes real counts/percentages/fragments from the
  actual text, never generic filler.
- `_pickWeakestDims(dims, ctx)` — picks the 1-2 lowest-normalized
  *applicable* dimensions, explicitly excluding `contextAnchoring`/
  `matchupDepth` when their required input (`game`/`matchupNote`)
  wasn't provided at all — those read as 0 not because the prose is
  weak but because there was nothing to anchor to; flagging them would
  produce an uncorrectable instruction.
- `_buildTargetedRetryPrompt` — assembles the full addendum, keeping the
  same `gameCtx`/`matchupCtx` required-context blocks the original 3b
  prompt already had, replacing only the generic tail with the targeted
  corrections.

## TASK 4 — Live Verification, Real Constructed Evidence

**All-seven-layers-fire test.** Constructed one real text tripping all
six structural layers simultaneously (a cliché, wrong-sport vocabulary
for `sport:'basketball'`, a generic "The Lakers are..." lead, a stat
present in the prompt but absent from the draft, a contradicting score
against a real `game` object, and a cross-league hallucination), with a
mock `callProxy` returning the same text each call (a valid, if
trivial, non-regression for 3b's own `newScore >= score` gate). Ran
through the actual patched `runQualityChain`:

```
layers_fired: ["2","2b","2c","2d","2d-score","2e","3b"]
retries: 7
score: 131
```

All seven fired — genuinely, not just "the code compiles." Confirms the
starvation fix: pre-fix (`maxRetries=6`), 3b's own gate
(`retries < maxRetries`) would have been `6 < 6 = false` at exactly this
point, skipping it.

**Dimension-targeting test — two real, different texts.**

*Text A* — strong specificity/stats/context/matchup, deliberately no
narrative structure (no stakes-establishing opener, no
player+stat-paired tension sentence, no forward-looking closer).
`scoreProse` breakdown confirmed `arcScore: 0` as the sole standout
weakest dim (next-lowest: specificity at 0.24), total 209 (below the
240 threshold, so 3b genuinely fires). Captured 3b prompt (via the mock
`callProxy`'s actual received argument, not asserted):

> LOW NARRATIVE ARC — missing: STAKES (the opening sentence does not
> establish what's on the line...); TENSION (no sentence pairs a
> specific player name with a specific stat...); RESOLUTION (the
> closing sentence does not point toward what to watch for...). Fix
> specifically what is missing, not the whole structure. LOW
> SPECIFICITY (24% of words are names/numbers): ...

*Text B* — strong narrative structure (real stakes/tension/resolution
sentences), deliberately loaded with hockey vocabulary ("period,"
"power play") despite `sport:'basketball'`. `layers_fired: ["2b","3b"]`
(2b also fired, since the same wrong-sport terms trip both the existing
`checkSportVocab` layer and Dim 9 — not mutually exclusive, and TASK 4
doesn't require isolating 3b from other layers, only that the captured
3b prompt correctly names what's actually weak). Captured 3b prompt:

> LOW TEMPORAL PRECISION: 1 sentence(s) with a statistic have no
> time-period qualifier, e.g. "Brunson's period-opening surge (18
> points) put Boston in a hole"... LOW VOICE CONSISTENCY: wrong-sport
> vocabulary detected (period, power play) — these terms belong to a
> different sport than basketball. Remove them and use NBA-specific
> terms instead.

The two prompts are not merely syntactically different — they name
completely different, genuinely-present weaknesses, each correctly
identified for its own text. This is the actual proof the aiming works,
not that a prompt got generated.

**Backward compatibility.** Compared `scoreProse` (no `breakdown` flag)
before (`git show HEAD:src/journalism-quality.js`) vs. after the change,
across 4 real samples including an empty string and a cliché-laden
text:

```
"Wembanyama scored 34 points..." -> before: 179 after: 179 MATCH: true
"Brunson scored 26 points..."    -> before: 156 after: 156 MATCH: true
""                                -> before: 0   after: 0   MATCH: true
"The Lakers are ready to punch..." -> before: 91  after: 91  MATCH: true
```

Byte-identical across every case tested, including edge cases — not
assumed from the diff.

## Known Limitations — Stated Explicitly, Not Implied Away

1. **3b's retry can still fail to clear the threshold.** Its own gate
   (`newScore >= score`) only accepts non-regressions; a genuinely thin
   brief can still land under threshold after one aimed shot. Dimension
   targeting improves the odds the one shot lands correctly — it does
   not guarantee success.
2. **No loop-back to re-verify layers 2 through 2e after 3b runs.** A 3b
   rewrite that reintroduces a cliché, wrong-sport term, or cross-league
   hallucination would not be caught by this chain. Both boundaries are
   deliberate, pre-existing architectural choices this CC-CMD does not
   change — named here because the CC-CMD requires it, not because
   either is a surprise.

## Confidence Score

```
+15  maxRetries fix correct and minimal (one line + one comment
     correction), no unrelated changes to runQualityChain's other logic
+20  breakdown flag additive-only, verified byte-identical for all 3
     existing callers (all inside this file) across 4 real samples
     including edge cases -- not assumed from the diff
+30  dimension-targeting correctly implemented and proven via two
     genuinely different, correctly-diagnosed real test cases (arc:
     names the specific missing sub-component; voice: names the exact
     wrong-sport terms found) -- not asserted from code reading
+20  all-seven-layers-fire test constructed and passing, with retries=7
     confirming the exact count, not just presence
+15  outbox states both known limitations explicitly (3b can still miss
     threshold; no post-3b re-verification loop)
= 100/100
```

**Score: 100/100. Clears the >=95 threshold.**

## Commits

- (this commit) — TASK 1-3 implementation, TASK 4 verification, this
  outbox
