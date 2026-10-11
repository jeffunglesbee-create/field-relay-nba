# Claude Code Command — the shootout is the whole residual, and the model cannot see it

**Date:** 2026-10-11
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (gap) — one state the model has no representation of
**Status:** DONE 2026-10-11. Three tasks, four done conditions. Session doc:
`outbox/cc-session-2026-10-11-wpa-shootout-residual.md`.

**TASK 1 — OPTION (1), TRUNCATE. Option (2) is not available from this data,
and the refuting numbers were committed before this document was filed:**

```
wentToShootout column   absent_from_header 122472 of 122472 rows
period-5 derivation            4 of 1400 games
period-4 derivation          288 of 1400 games
shootoutHomeShare_n            4
```

Both derivations sit in `outbox/hockey-wp-calibration-latest.json`. The vendor
column is absent on every row across four seasons, and `maxPeriod >= 5` — which
is *exactly* the "one comparison away" Task 3 describes — finds four games
against 288 reaching period 4. **The shots file does not record a shootout's
attempts as period-5 shot rows at all**, so `n = 4` is this source's ceiling
rather than a small sample. Done condition 3 asks for n above 100 and the third
stop condition says to refuse the number otherwise. Refused.

**TASK 3 NEEDED NO RUN.** Its premise — that the trainer is one comparison away
— is false, and the comparison it names is already being made.

**TASK 2 — both denominators, and the exclusion in the sentence a reader
quotes.** Run `38150764442`:

```
DOES NOT CLOSE on 2 of 23 non-shootout games at tolerance 0.01. STOP per the
document and report the residual. 5 shootout game(s) excluded from this
denominator: period 5 is a penalty-shot round the model has no representation
of, and a shootout term is unmeasurable from this source (wentToShootout absent
on 122,472 of 122,472 rows; period-5 derivation 4 of 1400 games).
```

`eligible 23 / eligible_closes 21 / excluded_shootout 5 / all_scored 28`.
`closingDenominator()` and `verdictFor()` are exported so the exclusion can be
made to fail — **16 self-tests**, including that a clean sweep still names the
exclusion and that "no shootout" says so explicitly rather than staying silent.

**Done condition 4 holds:** `src/hockey-wp-model.js` and
`outbox/hockey-wp-calibration-latest.json` are untouched.

**Required by Rule 87.4.** `docs/CC-CMD-2026-10-11-nhl-wpa-attribution.md`
stopped at its own Task 4 stop condition. This is the second document that stop
requires, rather than a carry-forward.

## The measurement that opened it

`outbox/nhl-wpa-conservation-latest.json`, 28 finished games across three dates,
tolerance 0.01:

| cohort | n | median residual | within 0.01 |
|---|---|---|---|
| regulation | 21 | **0.000** (max 0.019) | **19 of 21** |
| overtime, decided by a goal | 2 | -0.007 / 0.006 | **2 of 2** |
| **shootout** | **5** | **0.652** (0.635–0.701) | **0 of 5** |

The conservation check closes on **21 of 23 non-shootout games** and fails on
**5 of 5 shootouts**. The residual is not spread across overtime; it is the
shootout, entirely.

The five failing games all show the same shape — the home side winning from a
last recorded probability of 0.30 to 0.37. The NHL's final score includes the
shootout-winning goal, so the outcome says the home team won while the last
modelled shot state says it was behind.

## Why the model cannot see it

`src/hockey-wp.js`'s nine features are score differential, time remaining,
their interaction, skater differential, two empty-net flags, cumulative xG, an
OT flag and a playoff flag. **None of them describes a penalty-shot round.** A
shootout is not a continuation of play: the clock does not run, strength is
meaningless, and xG does not accumulate. Period 5 in a regular-season game is a
different game.

Nothing here is a defect in the attribution. For every state the model was
trained on, the deltas close.

## Tasks

**Task 1 — decide what a WPA series DOES at period 5, and say it.** Three
candidates, and this document does not pick:

1. **Truncate.** The series ends at the last regulation-or-overtime shot, and
   the conservation check excludes shootout games from its denominator with the
   exclusion stated. Honest, and it silently drops the deciding moment of 18%
   of games.
2. **A separate shootout term**, measured the way the OT home share was —
   `otHomeShare` is already `0.5417` with n = 288 in the committed model, and
   `shootoutHomeShare` was measured at `0.5` with **n = 4**, which is not a
   number anyone should use.
3. **Model it**, which is a feature-set change and therefore re-opens the
   calibration gate at Brier 0.171551 against both baselines. That is a third
   document, not a task here.

**Task 2 — whichever is chosen, the conservation check reports its denominator.**
It currently says "7 of 28 do not close". If shootouts are excluded it must say
"21 of 23 non-shootout games close; 5 shootout games excluded, reason stated" —
never "21 of 21". Rule 91: a denominator that quietly drops its hard cases is
the failure this repository keeps finding.

**Task 3 — measure `shootoutHomeShare` properly if Task 1 picks (2).** n = 4 is
not a measurement. The trainer already walks whole seasons and already derives
overtime from the max period per game; period 5 is one comparison away.

## Stop conditions

- **Do not change the feature vector, the coefficients or the calibration
  artifact.** Any of those re-opens the gate, and that is Task 1's option (3),
  which needs its own document.
- Do not report a conservation rate that has quietly excluded shootouts. The
  exclusion is the finding.
- Do not use `shootoutHomeShare = 0.5` at n = 4. Measure it or refuse it.

## Done conditions

1. A stated decision among the three, with its reason, in the source.
2. The conservation artifact reports its denominator and any exclusion by name.
3. If option (2): `shootoutHomeShare` carries a sample size above 100.
4. `src/hockey-wp.js`'s coefficients and calibration artifact are unchanged.
