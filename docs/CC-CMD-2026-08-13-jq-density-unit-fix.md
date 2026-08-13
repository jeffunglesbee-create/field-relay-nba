# CC-CMD-2026-08-13-jq-density-unit-fix

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-13-jq-density-unit-fix.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## The measurement this comes from

`/quality/report` has reported `failure_pct: 100` on every alerting `brief_type`
since 2026-07-16 — 13 alerts, all permanently firing, including types whose
average EXCEEDS the threshold they cite (`game_recap` MLB: `threshold: 156`,
`avg_score: 164.2`, `failure_pct: 100`).

The full `mlb_game` corpus was fetched and rescored by importing the real
`scoreProse` from `src/journalism-quality.js`. 592 briefs, 325 written before the
`6aed3bb` deploy (2026-07-16T01:36:49Z) and 267 after:

```
                      stored (production)    rescored (current rubric)
PRE  6aed3bb  n=325   mean 203.2  max 300    mean 136.4  max 179
POST 6aed3bb  n=267   mean 135.4  max 179    mean 137.3  max 181

stored delta -67.8      rescored delta +0.9
```

**The entire 68-point drop is the formula. None of it is the prose.** Under one
rubric the two eras differ by 0.9 points on a 300-point scale.

Corpus and harness live in `field-laboratory`:
`data/jq-mlb-game-corpus.json`, `scripts/jq-density-census.mjs`,
`outbox/cc-jq-density-census-2026-08-13.md`.

## The root cause, and why it is the unit and not the threshold

`FIELD_PROSE_STYLE`'s rule — cited by name in the source comments of BOTH Dim 1
and Dim 4 — governs **numbers**:

> Each sentence in the brief gets AT MOST ONE **number**. If a sentence has two,
> restructure or split. If a sentence has three, you have written a box score
> with verbs.

Both dimensions measure `properNouns + numbers`:

```js
const properNouns = words.filter(w => /^[A-Z]/.test(w) && !sentStarts.has(w) && w.length > 1)
const numbersAll  = words.filter(w => /\d/.test(w))
const rawDensity  = (properNouns.length + numbersAll.length) / nSent
const density     = Math.max(0, Math.min(1, 1 - Math.abs(rawDensity - 1) * 0.5))
```

Sports prose is obligate proper-noun-dense. "Baltimore Orioles pitcher Brandon
Young faces a lineup" carries three proper nouns and **zero numbers** — a
sentence that satisfies the rule perfectly and scores `rawDensity 3.0`, which the
taper maps to **0**.

Measured over the corpus:

```
                            PRE            POST
rawDensity (PN+NUM)/sent    4.45           4.40      curve peaks 1.0, hits 0 at 3.0
  corpus-wide minimum       1.75                     no brief is near the peak
numbers/sent (house rule)   1.86           1.64
Dim 4 as shipped   (0-16)   0.37           0.33      FLOORED 91.4% / 91.0%
Dim 4 numbers-only (0-16)   9.24          10.69      floored  8.9% /  6.7%
Dim 1 specificity  (0-30)   7.08           7.91      floored  6.5% /  7.1%
```

Two consequences:

1. **Dim 4 is not measuring the corpus.** It returns the same value for nine
   briefs in ten. Proper nouns outnumber numbers roughly 3:2, so the quantity the
   rule governs is the minority term in the metric that cites it.
2. **The threshold is a symptom, not the disease.** Dim 4 contributing 0 takes
   the relay-path ceiling from 245 (Dims 7/10 are N/A without game context) down
   to **229**. The report's `below_240`/`above_240` counters therefore can never
   see an `above_240`. Measured: the maximum rescore across 592 briefs is **181**.
   Fixing 240 alone silences 13 false alarms and restores no measurement.

**And the prose genuinely improved on the axis the rule governs** — numbers per
sentence fell 1.86 to 1.64, median 2.00 to 1.50 — while the shipped dimension
recorded that as 0.37 to 0.33. A correct unit records it as +1.45.

## TASK 0 — probe from HEAD, do not trust this document's line numbers

Re-read `scoreProse` in `src/journalism-quality.js` and record the CURRENT
tokenizer lines, the `W` weight object, and `/quality/report`'s failure
computation. Line numbers drift session to session and this doc quotes a sha
(`597f410`) that will move.

**Specifically confirm before changing anything:** does `/quality/report` compute
`failure_pct` against the literal 240, or against the `threshold` it reports? The
claim here is that it reports the calibrated p25 as `threshold_source` while
counting failures against 240, and that is inferred from the response shape
(`avg_score` above `threshold` with `failure_pct: 100`), not from reading the
handler. Read the handler.

## TASK 1 — the unit

Change Dim 4's ratio to the unit its own cited rule uses:

```js
const rawDensity = numbersAll.length / nSent
```

Leave the taper shape alone in this pass. Measured effect on the corpus: the
dimension moves from 0.35 mean / 91% floored to 9.9 mean / 7% floored, and
correctly floors the briefs the rule would flag (3.00 numbers/sentence → 0,
"a box score with verbs") while rewarding those near the band.

**Dim 1 is a JUDGEMENT CALL and is NOT automatically included.** It has the same
conflation and cites the same rule, but it is not saturated — 7% at floor,
running at about a quarter of its 30-point range. Changing both at once makes the
two effects inseparable. Decide, state the reasoning, and if you change both,
report their contributions separately.

**Do NOT fold proper-noun crowding in as a compensating term.** Five names in two
sentences is a real readability property, but it is a different property from the
one this rule governs, and a combined metric is what produced this bug. If it is
wanted, it is its own dimension with its own target and its own CC-CMD.

## TASK 2 — the threshold, only after Task 1 is measured

With Dim 4 live, recompute the achievable ceiling and re-measure the corpus. Then
decide what `/quality/report` should compare against. The report already computes
`brief_type_calibration` p25/p50/p75 per type; a hardcoded 240 alongside a
computed percentile is two thresholds where one is maintained.

State plainly whether 240 becomes reachable. If it does not, it is still wrong.

## TASK 3 — the discontinuity this fix CREATES

This is the task most likely to be skipped and it is the reason the current mess
was invisible for a month.

Changing the formula creates a **third scoring era**. Scores written before it
are not comparable to scores after it, exactly as `6aed3bb`'s scores are not
comparable to what preceded them — and nothing recorded that boundary, which is
why two calibration rechecks (2026-07-16, 2026-07-17) burned themselves out on
"is the trend real" when the answer needed a rescore, not more volume.

Required:
- Record the deploy timestamp of this change in the same place `6aed3bb`'s is
  recorded, or create that place if it does not exist.
- State in the outbox what happens to `brief_type_calibration`'s rolling window
  as it fills with third-era scores while still holding second-era ones.
- Do NOT backfill or rescore existing rows in this CC-CMD. That is a separate
  decision with its own risk (the on-receipt and backfill scorers both use a
  degenerate prompt — `Score this sports brief for journalism quality:\n\n${text}`
  — because the original prompt is not recoverable, so a rescore is uniform but
  not faithful).

## DONE CONDITION

A measured before/after on the same corpus, not a code-reading claim:

1. Dim 4's floored percentage before and after, over `mlb_game` at n≥500.
2. The maximum achievable score before and after, stated with its arithmetic.
3. Whether `above_240` is non-zero for any brief in the corpus after the change.
4. `/quality/report`'s alert count before and after, with any alert that still
   reports `failure_pct: 100` while `avg_score > threshold` named explicitly —
   that combination is self-contradictory and must not survive this CC-CMD
   unexplained.
5. The cutover timestamp recorded per Task 3.

## Explicitly NOT in scope

- Do not rescore or backfill existing `briefs` rows.
- Do not change `runQualityChain`, the voice judge, or the `/^\s*FAIL/i` parse.
- Do not touch `sweepKVBriefs` or the id schemes.
- Do not change the generator prompts. If the prose should carry fewer numbers,
  that is a prompt change and a different CC-CMD; this one fixes the instrument.

## Known internal contradiction, flagged rather than resolved

`6aed3bb`'s own source comment calls Exemplar A "1.9/sentence, **much closer to
ideal**" and then ships a curve peaking at 1.0, which scores Exemplar A at 0.55 —
docking its own reference text by 45%. That is independent of the unit bug and is
not resolved here. If Task 1's measurement makes the right peak obvious, say so;
otherwise leave it and file it.

## Confidence scoring

- TASK 0 (20 pts): current lines and the failure computation read from source, not inherited from this doc
- TASK 1 (30 pts): unit changed, effect measured on the real corpus, Dim 1 decided with stated reasoning
- TASK 2 (20 pts): threshold decided against a recomputed ceiling, not adjusted to fit
- TASK 3 (20 pts): the new discontinuity recorded where the last one was not
- DONE CONDITION (10 pts): all five artifacts present, before-and-after

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
Automate follow-ups. No fallbacks, only fixes.

## Outbox

`outbox/cc-session-2026-08-13-jq-density-unit-fix.md`
