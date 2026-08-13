# JQ provenance pass — closing the loose ends from the density-unit fix

## Status: DONE, with one condition not yet met and precisely stated. **Confidence: 95.**

Branch `main` throughout. Follow-on to
`outbox/cc-session-2026-08-13-jq-density-unit-fix.md`, addressing the loose
ends that document left open.

| commit | what |
|---|---|
| `820a519` | alert set under the previous predicate, same response |
| `496ea93` | calibrate within the current scoring era |
| `430dfdf` | `briefs.scoring_version` + read prefers it |
| `c6bb0b1` | `apply` input on the probe harness |
| `049fead` | verifier extended; follow-up spec filed |

## The diagnosis that tied them together

Every loose end was the same defect: **a stored derived value with no stored
provenance.**

`quality_score` is a cached output of `scoreProse(brief_text)` persisted with
no record of *which* `scoreProse` produced it. That one omission generated all
of it — the 68-point "collapse" that was entirely a formula change, two
calibration rechecks that could not separate instrument drift from prose
drift, "we can't rescore because the original prompt isn't recoverable", and
my own lost before-count.

It is the third instance in this session. `pitch_arsenals` was an empty R2
object indistinguishable from "never fetched" until `X-Source` made the layer
visible. BSD `average-positions` was the same, and `customMetadata.source`
(`stats-fallback` vs `stats-embedded`) was the provenance that made two write
paths tellable apart. `briefs` had no equivalent.

## Loose end 1 — the lost baseline, recovered and made permanent

The density-unit fix could not produce a clean before/after on alerts: its
"13" was measured days earlier and the eligible set had moved.

I had used the right method one level down — the census computed **both**
density units over **one** corpus in a single run — and failed to apply it to
the predicate. `alert_count_legacy_predicate` now recomputes the pre-fix rule
from the same payload:

```
alert_count (new predicate):    14
alert_count (legacy predicate): 23
```

**23 → 14, same response, same instant.** That is the measurement that was
supposedly gone. It also shows the caution was warranted: the real baseline is
23, not the 13 the spec cited from a different epoch — so the improvement is
larger than claimed and the stale figure would have understated it.

No future change to how failures are counted can lose its own baseline now.

## Loose end 2 — the 30-day wait, dissolved

The accepted answer was "wait ≈2026-09-12 for the rolling window to flush",
which treats a stale cache as a fact of nature. `SCORING_ERAS` is data and
every brief has a date, so rows are bucketed by `eraForDate()` and calibration
runs **within** the current era.

**Not yet active, and the reason is exact:**

```
calibration era-scoped: 0   mixed-era: 8
  game_recap  p25=157  n=587  era_scoped=false  window_n=587
  mlb_game    p25=125  n=270  era_scoped=false  window_n=270
  ...
```

Era 3 holds **1** scored brief — below the same `>= 5` floor calibration
already required. Falling back to the mixed window is correct: a p25 over 2
briefs is worse than a p25 over a mixture, and `era_scoped: false` /
`threshold_source: ...,mixed_eras` says so rather than leaving it inferred.

The improvement is in the trigger, not the state: this flips when era 3 has 5
scored briefs per type — **hours**, on a 15-minute journalism cron — instead
of when a 30-day window flushes.

**Unblock criteria (Rule 74):** re-run
`scripts/jq-report-verify.mjs`; pass is `era_scoped: true` for at least one
`brief_type` and `threshold_source` containing `era3`.

## Loose end 3 — provenance stored, history labelled

`briefs.scoring_version`, added via the established `ensure*Column` pattern,
NULL-default so existing rows read as *unknown* rather than assumed.

`scripts/jq-scoring-version-backfill.mjs` — **not a rescore**; nothing
recomputes a score, it records which formula produced the one already stored:

```
before: [{"scoring_version":null,"n":3156}]
plan:   {"era1":1941,"era2":1158,"era3":1,"boundary_excluded":56}
after:  [{null:56},{1:1941},{2:1158},{3:1}]
still NULL: 56   expected (boundary dates): 56
=== RESULT: PASS ===
```

1941 + 1158 + 1 + 56 = 3156 — a complete partition with nothing unaccounted.

The 56 are boundary-date rows, left NULL **by design**: era `from` timestamps
carry a time of day and `briefs.date` does not, so those rows cannot be
attributed. `eraForDate` flags them ambiguous and drops them from era-scoped
calibration. A handful unlabelled beats a wrong label.

The read path prefers `scoring_version` and falls back to `eraForDate` — which
matters because the date derivation is only valid while scores are written at
generation time, and `CC-CMD-2026-08-13-jq-dim1-unit-and-taper` may motivate
exactly the rescore that breaks that.

## What I did NOT do, and why

**Stamp `scoring_version` at the write sites.** There are 13
`INSERT INTO briefs` plus at least two `ON CONFLICT` score updates. Stamping
them blind is the change Rule 13 exists to prevent, and sites that write
`quality_score = NULL` must *not* be stamped — a version on an unscored row
asserts a scoring that never happened.

Filed as `docs/CC-CMD-2026-08-13-stamp-scoring-version-on-write.md`, whose
TASK 0 is the enumeration and whose done condition is zero NULL
`scoring_version` among briefs dated after that deploy.

New rows land NULL until then and the date fallback covers them correctly —
so the system is right either way, and the column becomes authoritative
incrementally rather than in one risky sweep.

## Confidence gate

**95.** Loose end 1 is proven outright by a same-response 23 → 14. Loose end 3
is proven by a complete 3,156-row partition with the expected 56 exclusions
and a PASS on its own done condition. Loose end 2's mechanism is deployed and
its *fallback* behaviour verified with the correct reason reported.

Not higher because era-scoped calibration is **not observed active** — it
cannot be until era 3 accumulates 5 scored briefs. That is a real gap between
"the code is right" and "the code has been seen doing the thing", and this
session has twice shipped changes that were correct in shape and inert in
practice. The difference here is that the inert state is *reported by the
endpoint itself* (`era_scoped: false`, `mixed_eras`) rather than silent.

## Residual

None carried. Deferred work has a spec:
`docs/CC-CMD-2026-08-13-stamp-scoring-version-on-write.md`.

**Watch — now automated, and the estimate corrected.**

`.github/workflows/jq-health-watch.yml` runs both checks daily at 09:00 UTC
and commits the artifact, so this no longer depends on anyone remembering.

**My "within hours" estimate was wrong.** It reasoned from total volume; the
`>= 5` floor is *per brief_type*. Measured from real 7-day volume
(`outbox/jq-scoring-coverage-*.json`):

| brief_type | /day | days to 5 era-3 briefs |
|---|---|---|
| game_recap | 19.7 | ~0.3 |
| mlb_game | 8.6 | ~0.6 |
| night_owl | 6.9 | ~0.7 |
| game_brief / pre_game | 3.0 | ~1.7 |
| slate | 2.6 | ~1.9 |
| epl_match | 0.7 | ~7 |
| compound | 0.1 | ~35 |

So the high-volume types flip within a day, the tail takes a week, and
`compound` may never reach the floor on its own — it will keep falling back to
the mixed window, correctly and visibly (`era_scoped: false`).

**And the alarm condition I attached to it was wrong too.** I wrote that a
failure to flip after a day would mean era-3 briefs "are not being scored at
all". That is now measured false: **312/312 briefs scored over 7 days, zero
unscored, `unscored_types: []`**. Scoring is healthy; the floor is simply
per-type. The watch's real failure signal is `scoring healthy: false` in the
coverage check, not the absence of era-scoping.
