# CC-CMD-2026-08-13-jq-dim1-unit-and-taper

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-13-jq-dim1-unit-and-taper.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Why this exists

Split out of `CC-CMD-2026-08-13-jq-density-unit-fix`, which fixed Dim 4's
unit and deliberately left two adjacent questions alone so their effects stay
separable. Both are now the only remaining known defects in `scoreProse`.

## Question 1 — Dim 1 has the same conflation

`specificity` (0→30) counts `nouns + nums` per sentence and scores 1 fact per
sentence as ideal, citing the same FIELD_PROSE_STYLE ONE-NUMBER-PER-SENTENCE
rule that Dim 4 cited:

```js
const nouns = sw.filter(w => /^[A-Z]/.test(w) && w !== first && w.length > 1).length;
const nums  = sw.filter(w => /\d/.test(w)).length;
return nouns + nums;
```

Same unit mismatch. The parent CC-CMD did NOT change it, and that was correct:
unlike Dim 4 it is **not saturated** — roughly 7% at floor, running at about a
quarter of its 30-point range — so it is still discriminating between briefs.
Changing both at once would have made the two effects inseparable.

**This is a judgement call, not an automatic fix.** Dim 1 may be right to count
names: "specificity" plausibly means *named* specificity, not just numeric.
That reading is defensible and would mean Dim 1 should keep its unit and stop
citing a numbers-only rule in its comment. Decide, and state which.

## Question 2 — the taper peak contradicts its own exemplar

`6aed3bb`'s source comment calls Exemplar A "1.9/sentence, **much closer to
ideal**" and then ships `1 - |raw - 1| * 0.5`, peaking at 1.0 — which scores
Exemplar A at 0.55, docking FIELD's own reference text by 45%.

Now that Dim 4 uses numbers/sentence, this is directly measurable rather than
theoretical: the corpus mean is **1.76 numbers/sentence** and the curve peaks
at 1.0, so the average brief sits on the falling limb. If the house style's
real ideal is ~1.9, the peak is in the wrong place and the corpus is being
docked for complying.

## TASK 0 — probe from HEAD

Re-read `scoreProse` and confirm the current Dim 1 body and Dim 4 taper. The
parent CC-CMD changed Dim 4 on 2026-08-13; do not assume this document's
quotes still match.

Also read `SCORING_ERAS` in `src/journalism-quality.js`. **Any change here
creates a fourth era** and must add an entry — that table exists precisely
because the 6aed3bb boundary went unrecorded.

## TASK 1 — measure before deciding

Extend `scripts/jq-density-census.mjs` (do not edit it in place — it is a
closed CC-CMD's artifact; copy to a new script) to report, over the same
`mlb_game` corpus at n≥500 pulled from D1:

- Dim 1 as shipped: mean points of 30, floored %, and the distribution of
  `nouns+nums` per sentence
- Dim 1 numbers-only: the same three
- Dim 4 under the current taper vs peaks at 1.5, 1.9 and 2.0

**Artifact:** those numbers committed to `outbox/`. Integers and means, not
prose.

## TASK 2 — decide each question separately

For Dim 1: change the unit, or keep it and fix the comment so it stops citing
a rule it does not implement. Either is acceptable; an unstated choice is not.

For the taper: move the peak only if TASK 1's distribution shows the corpus
is being docked for compliance. If the peak moves, **all briefs' scores
move**, so this is a fourth era with everything that implies.

## Explicitly NOT in scope

- Do not rescore or backfill existing `briefs` rows.
- Do not fold proper-noun crowding into Dim 4 as a compensating term. If
  proper-noun density is worth measuring it is its own dimension with its own
  weight and its own CC-CMD.
- Do not change `/quality/report`'s threshold logic — fixed 2026-08-13,
  `88adb01`.

## DONE CONDITION

1. Before/after means and floored percentages for whichever dimension changed,
   at n≥500.
2. If nothing changed, the stated reasoning for each of the two questions.
3. A `SCORING_ERAS` entry if and only if scores moved, verified served by
   `GET /quality/report`.

## Outbox

`outbox/cc-session-2026-08-13-jq-dim1-unit-and-taper.md`
