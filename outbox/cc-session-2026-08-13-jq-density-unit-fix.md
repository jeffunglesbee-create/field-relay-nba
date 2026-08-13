# CC-CMD-2026-08-13-jq-density-unit-fix — Result

## Status: DONE. All five done conditions produced. **Confidence: 95.**

Branch `main` throughout (`git branch --show-current` → `main`).

| commit | what |
|---|---|
| `793c0ad` | census — Dim 4 both ways over the real corpus, run BEFORE any code change |
| `940e06b` | TASK 1 + TASK 3 — unit fix, `SCORING_ERAS`, served on `/quality/report` |
| `88adb01` | TASK 2 — failures counted against the reported threshold |
| `f07d8e1` | live verifier for done conditions 4 and 5 |

## TASK 0 — probed from HEAD, including the claim the spec flagged as inferred

The CC-CMD said its central claim about `/quality/report` was "inferred from
the response shape, not from reading the handler." Read:

- `src/index.js:12606` — `SUM(CASE WHEN quality_score < 240 ...) as below_240`.
  **Hardcoded**, in SQL.
- the alert map — `failure_pct: Math.round(((r.below_240 || 0) / r.scored) * 100)`
  while `threshold` is `briefTypeCalibration[type]?.p25 ?? 240`.

So the inference was correct: one constant decides the number reported, a
different calibrated value is reported beside it. The alert also fires on
`avg_score < threshold` **OR** `below_240/scored > 0.2`, which is exactly how a
type lands at `threshold: 156, avg_score: 164.2, failure_pct: 100`.

Ceiling arithmetic re-derived from `journalism-quality.js:424` and Dims 6-10:
`30+38+30+16+36 = 150` base, `+45+25+20+30+30` = **300**; relay path drops
Dims 7 and 10 (no `opts.game`, no `opts.matchupNote`) = **245**; density
floored = **229**. The document's arithmetic holds.

## The corpus was re-measured, not inherited

The CC-CMD pointed at `field-laboratory`'s committed snapshot. Rule 72 — that
is an inherited artifact and the authoritative table is one query away, so
`scripts/jq-density-census.mjs` pulls `briefs` fresh from D1 via `/d1/execute`.

It reproduced the prior measurement independently:

| | this session (D1) | CC-CMD (snapshot) |
|---|---|---|
| corpus | 592 (325 pre / 267 post) | 592 (325 / 267) |
| Dim 4 floored | 91.2% | 91.4 / 91.0% |
| Dim 4 mean pts | 0.35 of 16 | 0.37 / 0.33 |
| numbers-only mean | 9.89 | 9.24 / 10.69 |
| stored mean | 203.2 → 135.4 | 203.2 → 135.4 |
| post-era max | 179 | 179 |

Two independent extractions agreeing to the decimal is a stronger basis than
either alone.

## DONE CONDITION 1 — Dim 4 floored, before and after (n=592)

```
as shipped   (properNouns+numbers)/sent   mean 4.43   FLOORED 91.2%   0.35 of 16 pts
numbers-only  numbers/sent                mean 1.76   floored  7.9%   9.89 of 16 pts
corpus minimum raw (shipped unit)         1.75  — no brief is near the curve's peak of 1.0
```

The dimension returned the same value for nine briefs in ten. The 7.9% that
still floor are exactly those at ≥3 numbers/sentence — the briefs the rule
itself names as "a box score with verbs", which is the metric working.

## DONE CONDITION 2 — achievable ceiling, with arithmetic

`300` full · `245` relay path · `229` with density floored. Restoring Dim 4
returns the relay path to its stated 245.

## DONE CONDITION 3 — is `above_240` reachable?

**No.** `postEraAbove240: 0` of 267; post-era maximum stored score **179**.
The 40 briefs above 240 in the corpus are all first-era scores, written under
a formula that no longer exists.

Restoring Dim 4 adds at most 16 points, so the reachable maximum moves from
~179 to ~195. **240 remains unreachable**, which is the finding: it was never
a quality gate on this path, it was a stuck alarm.

## DONE CONDITION 4 — the self-contradictory alert shape is gone

`outbox/jq-report-verify-*.log`, live:

```
alert_count: 14
self-contradictory (failure_pct 100 AND avg_score > threshold): 0
```

The same-run before/after is in the response itself. `below_flat_240_pct` was
deliberately retained on each alert — it *is* the old metric — and it reads
**100 on all 14 rows**. Eight of those 14 have `avg_score > threshold`:

```
epl_match  EPL   thr=115 avg=128.1  fail= 24%  flat240=100%
mlb_game   MLB   thr=125 avg=136.1  fail= 24%  flat240=100%
night_owl  WC    thr=132 avg=137.9  fail= 38%  flat240=100%
night_owl  MLB   thr=132 avg=139.8  fail= 21%  flat240=100%
night_owl  AFL   thr=132 avg=141.8  fail= 50%  flat240=100%
game_recap mlb   thr=156 avg=162.0  fail= 25%  flat240=100%
pre_game   mlb   thr=155 avg=162.9  fail= 23%  flat240=100%
game_recap MLB   thr=156 avg=164.5  fail= 29%  flat240=100%
```

Under the old metric all eight would have reported `failure_pct: 100` while
exceeding their own threshold. Now none does. The CC-CMD's cited example,
`game_recap MLB`, reads `thr=156 avg=164.5 fail=29%`.

**On the alert count itself: I do not have a clean same-moment "before".** The
13 in the CC-CMD was measured days earlier; my post-change reading is 14, and
the eligible (type, sport) set moves as briefs accrue. So 13→14 compares two
epochs and I am not presenting it as a result. The `flat240` column is the
comparison that is valid, because both numbers come from one response.

## DONE CONDITION 5 — the cutover is recorded

`SCORING_ERAS` in `journalism-quality.js`, **served** by `/quality/report` and
read back from the live endpoint rather than the source file — a constant
nobody is served is not recorded anywhere a reader will look:

```
era 3 recorded and served: true
window straddles: [
  {"era":2,"from":"2026-07-16T01:36:49Z","deploy":"6aed3bb"},
  {"era":3,"from":"2026-08-13T03:20:00Z","deploy":"CC-CMD-2026-08-13-jq-density-unit-fix"}
]
```

The 30-day window currently straddles **both** boundaries, and now says so.
That is precisely the warning whose absence sent two calibration rechecks
(2026-07-16, 2026-07-17) chasing a 68-point "quality decline" that was
entirely the formula.

## TASK 3 — what happens to the rolling window

`brief_type_calibration` computes p25/p50/p75 over a fixed 30-day window. For
the next ~30 days that window holds a **mixture of era-2 and era-3 scores**:
era-3 briefs score roughly 9.9 points higher on average for identical prose.

Consequences, stated rather than discovered later:

- **p25 drifts upward** as era-3 scores displace era-2 ones — gradually, not
  as a step, because it is a percentile over a sliding mixture.
- **Alerts near their threshold will flap** during the transition. A type
  whose avg sits within ~10 points of p25 may alert, clear, and alert again
  purely from the mixture ratio changing.
- **This is not a new bug and must not be "fixed" by tuning p25.** It is the
  known cost of a formula change, and it self-resolves once the window holds
  only era-3 scores (≈2026-09-12).
- The `window_straddles_era` field makes the condition visible for exactly as
  long as it applies, then empties on its own.

**No rows were rescored or backfilled**, per the CC-CMD. Existing stored
scores keep their era's values — which is also why the alert list could not
improve immediately, and why the honest measure of this change is the
contradiction count, not the alert count.

## Dim 1 — decided, not skipped

**Not changed.** It has the same conflation and cites the same rule, but it is
**not saturated**: ~7% at floor, running at about a quarter of its 30-point
range, so it is still discriminating between briefs. Dim 4 was returning one
value for 91% of the corpus — a broken instrument. Dim 1 is a possibly
mis-specified but working one.

Changing both at once would make the two effects inseparable, which is the
CC-CMD's own reason for flagging it, and there is a real argument that Dim 1
*should* count names — "specificity" plausibly means named specificity. That
deserves a decision on its own evidence.

Filed as `docs/CC-CMD-2026-08-13-jq-dim1-unit-and-taper.md`, together with the
taper-peak contradiction (`6aed3bb` calls 1.9/sentence "much closer to ideal"
while shipping a curve peaking at 1.0 that docks its own exemplar 45%) — now
directly measurable, since the corpus mean is 1.76 numbers/sentence and sits
on the falling limb.

## Scope held

Taper shape unchanged. Proper-noun crowding deliberately **not** folded back
in as a compensating term — a combined metric is what produced this bug. No
change to `runQualityChain`, the voice judge, the `/^\s*FAIL/i` parse,
`sweepKVBriefs`, the id schemes, or the generator prompts. `properNouns` was
removed only because this change left it with no consumer (Rule 63).

## Confidence gate

**95.** Every done condition is a committed artifact: an independent
re-measurement of the corpus from D1 agreeing with the prior one to the
decimal, the floored percentages before and after at n=592, the ceiling
derived from source, `postEraAbove240: 0`, a live `/quality/report` showing
zero self-contradictory alerts with the old metric preserved in the same
response for comparison, and the era table read back from the served endpoint.

Not higher because of the alert-count gap above: I did not capture
`/quality/report`'s alert list immediately before deploying, so the only clean
before/after on that specific artifact is the one embedded in the response
(`below_flat_240_pct`), not a true prior snapshot. That is a sequencing
mistake — the census ran before the change, and the report probe should have
too.

## Residual

None carried. Deferred work has a spec:
`docs/CC-CMD-2026-08-13-jq-dim1-unit-and-taper.md`.

**Watch, not deferred:** the rolling-window mixture described under TASK 3.
Expected to self-resolve ≈2026-09-12; `window_straddles_era` reports the
condition until it does.
