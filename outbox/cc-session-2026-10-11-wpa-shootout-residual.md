# CC session — the shootout term cannot be measured, so the series truncates

**Date:** 2026-10-11
**Repo:** field-relay-nba, branch `main` — direct commits, no PR
**CC-CMD:** `docs/CC-CMD-2026-10-11-wpa-shootout-residual.md` — three tasks,
four done conditions.

## Task 1 — option (1), truncate, and the decision was already measured

The document offers three options and declines to pick. **Option (2), a
separate shootout term, is not available from this data** — and the refuting
numbers were committed in `outbox/hockey-wp-calibration-latest.json` **before
that document was filed**:

```
premises.column_states.wentToShootout   absent_from_header 122472
                                        empty 0, usable 0
                                        verdict "absent from the header"
premises.overtime.wentToOT                   288 of 1400 games
premises.overtime.wentToShootout               4 of 1400 games
premises.overtime.shootoutHomeShare_n          4
```

The vendor column is absent on **every one of 122,472 rows across four
seasons**, and the period derivation — `maxPeriod >= 5`, which is *exactly* the
"one comparison away" Task 3 describes — finds **four games** against **288**
reaching period 4.

**So the shots file does not record a shootout's attempts as period-5 shot rows
at all.** `n = 4` is this source's ceiling, not a small sample from a short run.
Done condition 3 asks for n above 100 and the third stop condition says to
refuse the number otherwise. Refused.

**Task 3 needed no run.** Its premise — that the trainer is one comparison away
from the measurement — is false, and the comparison it names is already being
made. Rule 100: the refuting value was in hand.

Option (3), giving the model a shootout feature, re-opens the Brier 0.171551
gate and is a separate document by this document's own words.

The decision and all four figures are written into `src/hockey-wp.js` beside the
conservation block, and into the artifact as a `decision` object.

## Task 2 — the denominator, and the sentence a reader quotes

It said *"7 of 28 do not close"*, which hid the shape. Reporting *"21 of 21"*
would hide the exclusion, which this repository keeps finding to be the worse
failure.

The artifact now carries both denominators:

```
eligible              23
eligible_closes       21
eligible_rate         0.913
excluded_shootout      5
excluded_reason       period 5 is a penalty-shot round the model has no representation of
all_scored            28
all_closes            21
```

And the verdict sentence names the exclusion itself, run `38150764442`:

```
DOES NOT CLOSE on 2 of 23 non-shootout games at tolerance 0.01. STOP per the
document and report the residual. 5 shootout game(s) excluded from this
denominator: period 5 is a penalty-shot round the model has no representation
of, and a shootout term is unmeasurable from this source (wentToShootout absent
on 122,472 of 122,472 rows; period-5 derivation 4 of 1400 games).
```

### The exclusion is provably unable to go silent

`closingDenominator()` and `verdictFor()` are exported so they can be made to
fail. **16 self-tests**, and these four are the ones that matter:

| | |
|---|---|
| a clean sweep STILL names the exclusion | `CLOSES on 2 of 2 non-shootout games` **and** `1 shootout game(s) excluded` |
| no shootout says so **explicitly** | so "none excluded" is distinguishable from "exclusion not reported" |
| an all-shootout set is UNMEASURED | not a vacuous 0-of-0 pass |
| an empty set is its own state | `no finished game was scored` |

**One expectation was wrong when written.** The failing branch reports the count
that did NOT close — `1 of 3`, not `2 of 3` — and the self-test caught my
expectation rather than the code.

## Done conditions

| | |
|---|---|
| 1. a stated decision among the three, with its reason, in the source | `src/hockey-wp.js`, with all four figures |
| 2. the artifact reports its denominator and any exclusion by name | both denominators, plus the verdict sentence |
| 3. if option (2): n above 100 | **option (2) refused** — n = 4 is the source's ceiling |
| 4. coefficients and calibration artifact unchanged | `git diff` empty on `hockey-wp-model.js` and the artifact |

63 checks, 18 of 18 mutations caught, and the full sweep — 89 check scripts and
42 mutation harnesses — **0 failing**, run before pushing this time rather than
after a red deploy.
