# Claude Code Command — BSD team form carries xG, which the forecaster has been without since June

**Date:** 2026-10-10
**Repo:** field-relay-nba, then field-laboratory — one change, two repos, per Rule 70
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** C (feature) — a new route; the model stays in the laboratory
**Status:** STOPPED AT TASK 1, 2026-10-11, by this document's own stop
condition: *"If `league_id` does not filter, STOP at Task 1 and report."*
Tasks 2-5 were not executed. Artifact:
`outbox/bsd-form-probe-latest.json` (run 38118306032, 4 calls of a declared 8).

**`league_id` IS ACCEPTED AND EMPTIES THE RESULT FOR EVERY VALUE.**

| call | `matches` |
|---|---|
| no `league_id` | **10** |
| `league_id=1` — the club's OWN competition | **0** |
| `league_id=7` | **0** |
| `league_id=99999999` — an id that cannot exist | **0** |

Not filtering, and not the labelling this document predicted either. A third
behaviour: the parameter is accepted, it changes the answer, and every value
empties it. Per-competition scope cannot be built on it, so Task 2's route
would have shipped a scope that is a guess — which is the thing the stop
condition exists to prevent.

**THE HEADLINE PREMISE HOLDS, and is now located precisely.** xG is real in the
form payload, nested one level down in `stats`, which the surface probe's
`carriesXg: true` could not have told anyone:

```
overall.stats.expected_goals              average 0.858  total 8.58  matches 10
overall.stats.expected_goals_on_target    average 0.78   total 7.8   matches 10
overall.stats.xg                          average 0.877  total 8.77  matches 10
```

Present identically in `home`, `away` and `vs_stronger` — and **ABSENT from
`vs_weaker`**. That is the one block this document singles out as the thing a
points-per-game model structurally cannot express, and it is the one block
without xG. Any laboratory document built on this must treat `vs_weaker` xG as
a fourth state, not as zero.

**THE WINDOW, which was named and not measured, is now measured.**
`requested: 10`, `matches: 10`, `from_date 2026-08-08T19:00:00+00:00`,
`to_date 2026-10-03T21:05:00+00:00` — a **56-day span covering the last ten
matches**. Not season-to-date, not a fixed window. `overall` is an aggregate
block with a 52-key `stats` object and no per-match rows, confirming
`rowCount: null`.

**What would unblock the rest of this document:** either a per-competition
scope reached some other way, or an explicit decision to ship an
ALL-COMPETITIONS form route — the default call works, returns ten matches and
carries xG. That is a different scope from the one Task 2 assumes, so it needs
its own document rather than a quiet widening here (Rule 87.4).

### Two defects in the probe, both caught before they were published

1. **The control compared the question, not the answer.** `league_id` is echoed
   in the payload and the fingerprint included it, so every fingerprint differed
   by construction and the first real run reported **FILTERS** over four
   responses that said 10 / 0 / 0 / 0.
2. **The xG scan was top-level only** and reported `[]` on a payload carrying
   three xG fields in `stats` — it would have refuted this document's headline
   premise on evidence that supports it.

A third, cheaper one: the first run sent `Authorization: Bearer` and took four
401s. `src/index.js` authenticates every BSD call as `Authorization: Token` at
:2437, :3056 and :4468. The classifier refused to read four identical failures
as a verdict, which is the half of it that worked.

**Rule F:** team form and xG are published by every major provider. Commodity.
**Rule 47:** the relay forwards form; it computes no rating and no forecast.
The model is the laboratory's, which is the division
`CC-CMD-2026-08-27-relay-per-play-epa.md` settled: *"the laboratory must not
build a second EP model. One model, one owner, two consumers."* The inverse
applies here — the relay must not build the forecast.

## Why this exists

`field-laboratory/docs/CC-CMD-2026-09-11-epl-forecaster-phase1.md` records its
own blocked input, re-probed 2026-10-03: fbref xG **empty, `teams: 0`,
`updated 2026-06-23`, 3.5 months stale and still labelled 2025-2026.**

So `src/Forecast.fs` ships with `METHOD = "table-v1: ppg + 0.25*gdpg +
0.10*gfpg, home +0.30"` — a points-and-goal-difference model, because goals were
the only input reachable. That is a reasonable table-based forecast and it is
not an xG model.

**Measured 2026-10-10** (`outbox/bsd-surface-probe-latest.json`, task2_form),
`/api/v2/teams/{id}/form/` on an EPL club returned HTTP 200 with:

```
team_id, team_name, requested, matches, league_id, from_date, to_date,
overall, home, away, vs_stronger, vs_weaker
```

`carriesXg: true`. `perCompetitionEvidence: ["league_id"]`. Verdict, verbatim:
*"form shape served: non-list row(s), xG PRESENT, per-competition evidenced by
league_id"*.

And per-event xG is already in a call the relay makes — event 223324 carried
`expected_goals` 1.39/1.69, `xg.actual`, `expected_goals_on_target`,
`big_chances`, `ball_possession`, with `has_xg` true on **193 of 193** rows in
`outbox/bsd-field-census-latest.json`.

`overall / home / away / vs_stronger / vs_weaker` is better than the ask. A
home-advantage term is a constant in `Forecast.fs` (`HOME_ADVANTAGE = 0.30`);
`home` and `away` splits make it measurable. And `vs_stronger` / `vs_weaker` is
the one thing a points-per-game model structurally cannot express — a club that
beats everyone below it and loses to everyone above it has the same ppg as a
club that draws everyone.

## WHAT IS NOT MEASURED, and must be read before it is used

The probe recorded **key names, not values.** `from_date`, `to_date`,
`requested` and `matches` exist; **the window they describe does not appear in
the artifact.** So:

- the span is **named, not measured** — do not assume last-5, last-10, or
  season-to-date;
- `rowCount: null` and `rowKeysVerbatim: []` mean the payload is aggregate
  blocks rather than a match list — so there is no per-match row to join on,
  and whatever `matches` holds is the only count available;
- whether `league_id` **filters** or merely **labels** is unestablished. A
  parameter that is accepted and silently ignored is this vendor's documented
  behaviour: `scripts/bsd-tennis-date-probe.mjs` found `date`, `match_date`,
  `start_date`/`end_date` and `day` all returning HTTP 200 with the SAME
  unfiltered page.

**Task 1 reads those values. Nothing downstream may assume them.**

## Tasks

**Task 1 — read the window and the filtering, with a control.** One call per
question, artifact written. Record the literal `from_date`, `to_date`,
`requested` and `matches` values, and the xG field names inside `overall`.
Then the control: request the same club with a DIFFERENT `league_id` and
confirm the numbers change. If they do not, `league_id` labels rather than
filters, and a per-competition forecast cannot be built on it — report that and
stop rather than shipping a route whose scope is a guess.

**Task 2 — the route.** `/bsd/teams/{id}/form` → `/api/v2/teams/{id}/form/`,
pure forward, BSD's shape verbatim (Rule 62). TTL from what form actually
changes at: a club plays at most twice a week, so this is not a 25s payload —
pick a number and write the reason beside it, as `/bsd/coverage` does at 600s.

**Task 3 — three states at the boundary.** `has_xg` is true on 193/193 rows
today, but `pitch_condition` and `travel_distance_km` are null on 39 of 193 and
**`attendance` is null on 193 of 193** — the same census proved a field can be
served and empty. So: xG present, xG absent for this club, and the call failed
must be three distinguishable answers. A forecast rendered from an absent xG
reading at the model's default is indistinguishable from a forecast of a level
fixture, which is Rule 99 and the exact failure
`field-laboratory/src/Typography.fs`'s `scoreAxisCss` was written to refuse.

**Task 4 — the identity join, named rather than assumed.** BSD team ids are
BSD's. `src/identity-resolver.js` and `resolveTeamKey` are the existing
machinery, and `src/odds-name-match.js` exists because name matching for EPL
clubs needed its own module. Report the join rate for the 20 EPL clubs with a
denominator, and name the misses. Do not ship a route whose join is unquantified
— `CC-CMD-2026-09-11-epl-forecaster-phase1.md` records that the abbreviation
join already fails on two real clubs.

**Task 5 — then the laboratory (Rule 70), as a SEPARATE dispatch.** The model
change is `Forecast.fs`'s business and does not belong in this document. File
the laboratory CC-CMD, do not write the F#. What it will need from here: the
route, the window, the join rate, and the three-state contract.

## Stop conditions

- Do not compute a rating, a strength or a forecast in the relay. Rule 47.
- If `league_id` does not filter, STOP at Task 1 and report. Everything
  downstream assumes per-competition scope.
- If the join rate is below the rate the forecaster already achieves by name
  (13 of 20 by name, 12 of 20 through the relay's matcher, measured 2026-10-03/04
  and recorded in `scripts/forecast-run.mjs`), say so plainly — a new source
  that joins worse is not an improvement.

## Done conditions

1. An artifact records the literal window values, the xG field names, and the
   `league_id` control result.
2. `/bsd/teams/{id}/form` forwards BSD's shape with a reasoned TTL.
3. xG-present, xG-absent and call-failed are three distinguishable answers, with
   a check.
4. The EPL join rate is reported with a denominator and the misses named.
5. A laboratory CC-CMD is filed and dispatched separately; no F# is written here.
