# CC session — NHL win probability, built because nobody serves one

**Date:** 2026-10-11
**Repo:** field-relay-nba, branch `main` (direct commits, no PR)
**CC-CMD:** `docs/CC-CMD-2026-10-10-nhl-win-probability-from-xg.md`
**Verdict:** **SHIPS** — and the one comparison it loses is stated below, not buried.

## The gate, first, with its denominator

Held-out season **2023** (the 2023-24 NHL season): 1,400 games, 122,472 shot
states. Trained on 2020, 2021 and 2022 — 3,752 games, 322,108 states. Whole
seasons, never shuffled; the trainer refuses to run if any game id appears on
both sides, and it reported **0**.

| predictor | Brier | log loss | n (states) |
|---|---|---|---|
| **FIELD hockey-wp** | **0.172669** | 0.506653 | 122,472 |
| constant 0.5 | 0.250000 | 0.693147 | 122,472 |
| constant home-win base rate (0.5371) | 0.248571 | 0.690287 | 122,472 |
| de-vigged market | 0.228414 | 0.646964 | 108,825 |
| **FIELD, market-covered games only** | **0.171551** | 0.503532 | 108,825 |

`SHIPS — beats constant 0.5 and the de-vigged market over 1243 of 1400 games.`

### The comparison it LOSES, which is the honest one

| first minute of play only | Brier | n |
|---|---|---|
| de-vigged market | **0.232640** | 1,575 |
| FIELD hockey-wp | 0.247177 | 1,575 |

At puck drop the market knows which teams are playing and the model does not —
it carries no team-strength feature, so its t=0 output is near-constant. Beating
a *static* pre-game number across in-game states is close to arithmetic once the
model can see the scoreboard; the pre-game column is where the two are actually
compared on equal footing, and the market wins it.

**The design already matches that measurement, which is the only reason it is
not a defect.** Before the first shot `hockeyWinProb` returns
`state: 'prior'` labelled **`FIELD pre-game prior`** — the measured home-win
base rate — and never a model read. `src/wp-resolver.js`'s `Market estimate`
remains the better pre-game number and is untouched.

## Calibration, because a good Brier with a bowed curve is right on average and wrong everywhere

| bin | n | predicted | observed | gap |
|---|---|---|---|---|
| 0.0-0.1 | 11,312 | 0.0370 | 0.0359 | -0.0011 |
| 0.1-0.2 | 8,043 | 0.1516 | 0.1493 | -0.0023 |
| 0.2-0.3 | 7,500 | 0.2575 | 0.2679 | +0.0104 |
| 0.3-0.4 | 11,095 | 0.3394 | 0.3770 | **+0.0376** |
| 0.4-0.5 | 9,191 | 0.4680 | 0.5097 | **+0.0417** |
| 0.5-0.6 | 31,590 | 0.5386 | 0.5385 | -0.0001 |
| 0.6-0.7 | 4,962 | 0.6630 | 0.6600 | -0.0030 |
| 0.7-0.8 | 14,249 | 0.7389 | 0.7321 | -0.0068 |
| 0.8-0.9 | 9,007 | 0.8563 | 0.8609 | +0.0046 |
| 0.9-1.0 | 15,523 | 0.9637 | 0.9606 | -0.0031 |

Worst gap **+0.042**, in the 0.3-0.5 bins — the model is mildly pessimistic
about home sides it rates slightly against. Everything else is inside ±0.011.

By game state:

| split | n | model Brier |
|---|---|---|
| even 5-on-5 | 95,394 | 0.176607 |
| power play | 24,498 | 0.153611 |
| final two minutes | 4,460 | 0.059837 |
| empty net | 3,646 | 0.051573 |

Nothing is broken where it is read: the final two minutes and empty-net states,
which the CC-CMD singles out as the places a homogeneous Poisson is least
accurate, are the model's *best* splits.

## Architecture: option (b), and the coefficients say why

The CC-CMD deliberately did not pick between (a) xG rates into a Poisson over
remaining time and (b) a direct logistic on game state. **(b) was built, cleared
the bar, and (a) was therefore not built.**

Standardised coefficients, held-out-season model:

| feature | coefficient |
|---|---|
| `sdPerSqrtT` (score differential / √time remaining) | **2.035819** |
| `scoreDiff` | **0.440981** |
| `xgDiff` (cumulative, home − away) | 0.185472 |
| `skaterDiff` | 0.068115 |
| `awayEmptyNet` | −0.095051 |
| `homeEmptyNet` | 0.042876 |
| `tRem` | 0.035900 |
| `isPlayoff` | −0.016402 |
| `isOT` | −0.016247 |

Score differential and time remaining dominate by **11×** over xG. That was the
instruction and it is now a measurement rather than an assurance.

The two empty-net signs look backwards and are not: *conditional on the score*,
a pulled goalie means that side is attacking with an extra skater, so an empty
away net is slightly worse for the home team.

**Nothing is ported from `src/soccer-wp.js`, and `DC_RHO` is absent by design** —
it inflates low-score **draw** probabilities and hockey has no draws. `draw: 0`
in the payload is a fact, not a placeholder.

## Task 1 — the xG model

Needed because at runtime the relay has NHL play-by-play, not MoneyPuck's
`xGoal` column.

| xG predictor | Brier | mean prediction |
|---|---|---|
| FIELD xG | 0.060742 | 0.07001 |
| MoneyPuck's own xGoal | 0.057960 | 0.071462 |
| constant base rate | 0.065100 | — |
| actual goal rate | — | **0.07000** |

Better than the base rate, slightly worse than the vendor's, and calibrated on
the mean to five decimal places. Reported as a comparison, not a claim of parity.

**The rink geometry reproduces the vendor's own columns exactly.** 20,000 shots
inspected, 20,000 distance agreements, 20,000 angle agreements, **worst gap
0.0000**. `xCordAdjusted 57, yCordAdjusted -40` carries `shotDistance
51.2249938995` and `shotAngleAdjusted 51.3401917459`; the formula returns
51.225 and 51.3402. A formula aimed at the wrong end of the rink returns a
number too, which is why this is a measured agreement rate and two self-tests.

Shot-type vocabulary: **0 unmapped values**, 0% of rows.

## Task 3's baseline — three sources eliminated, and the fourth was not what it looked like

| source | why not |
|---|---|
| Odds API historical | ceiling **REACHED 2026-10-07**; credits need approval |
| field-archive (D1) | no odds column in `regular_season_games` or `postseason_games` |
| ESPN scoreboard | **0 of 40** past games carry odds across three 2024 dates |
| ESPN summary `pickcenter` | carries one — but **three-way** |

The first three games de-vigged to an overround of **0.818 / 0.822 / 0.819**.
A two-sided book cannot overround below 1. A census across five dates and three
seasons returned **10 of 10 games as three-way**, one provider (Unibet),
overround 0.8176-0.8587: Unibet quotes hockey as a **regulation three-way**
market (home / draw / away), and the two-way normalisation that is correct for
the Odds API's `h2h` market is a category error over this one.

Reconstructing it needs two measured constants, and the reconstruction has its
own falsifiable check: the implied book overround `k`.

| implied three-way overround | value |
|---|---|
| p05 | 1.0224 |
| median | **1.0353** |
| p95 | 1.0842 |
| below 1 (dropped) | **8** |
| above 1.25 | 0 |

A median of 1.035 is a textbook book margin — that is the evidence the
three-way reading is right. The eight rows below 1 are arithmetically
impossible and are **dropped per game, not explained away**: a garbage market
probability makes the *market's* Brier worse, which flatters the model, so
leaving them in would have bought the verdict with the baseline's own corrupt
rows.

**ESPN retains pickcenter by season.** 2023-24: **1,312 of 1,315 games**
(3 served empty, 0 unfetchable). 2024-25 onward: **0 of 16**. That boundary is
why the held-out season is 2023 and not 2024.

### The join verifies itself

ESPN carries date + abbreviation + score; MoneyPuck carries team codes +
`game_id` and, in the 2023 file, **no final-score columns at all**. So the key
is the k-th meeting of the season, and the two sources' **outcomes** are then
compared — a mis-ordered join disagrees on roughly half.

| | |
|---|---|
| matched | 1,243 of 1,400 games |
| outcome cross-check | **1,251 inspected, 1,251 agree, 0 disagree** |
| pairs with differing meeting counts | 36 (dropped) |
| codes only in ESPN | `MAT`, `MCD` (2024 All-Star teams), `USA`/`CAN`/`SWE`/`FIN` (4 Nations) |

**And it fired on a real failure.** A run with test season 2024 against the
2023-24 market file came back at **0.4933** — a coin flip, which is exactly what
pairing unrelated games produces — and the baseline was refused rather than
scored. A check that has only ever passed proves nothing; this one went red for
the right reason.

## Task 4 — three absent states, none of them 0.5

| state | returns |
|---|---|
| no shots yet | the measured base rate, `label: 'FIELD pre-game prior'`, with a caveat saying it is not a read of this game |
| `situationCode` unreadable | `state: 'refused'`, `problems: ['strength-unreadable']` — never scored as even strength |
| clock or score unreadable | refused, each named separately |
| `goalieInNetId` absent | **still scored**, with a caveat: goalie quality is not a model input, so there is nothing to default. Refusing would be theatre; ignoring it would hide that GSAx is not applied |

The label is **`FIELD model probability`** — distinct from `wp-resolver.js`'s
`Market estimate` and `Statistical probability`, both of which are exported as
constants so a check asserts the distinction rather than a spelling.

`src/hockey-wp-model.js` was committed as an explicit `null` before training
wrote a real table. A stub with invented coefficients would score every state
and be indistinguishable from a trained one at the call site.

## Done condition 2 — `situationCode`, confirmed two independent ways

Declared reading: four digits, away goalie / away skaters / home skaters / home
goalie. Game `2026020053`, 309 plays, 125 shots, 8 penalty windows.

Distribution: `1551` ×92, `1451` ×14, `1541` ×8, `0651` ×7, `1351` ×4.

1. **Penalty windows derived from the plays array** — an independent derivation
   of "was someone short-handed here". 125 agree, **0 disagree**. Of those, 99
   agree because both sides are negative, so **26 agreements are informative**.
   That denominator is in the artifact; an agreement rate of 1.0 without it
   would be a claim about everything.
2. **Goalie time-on-ice from the boxscore** — away goalies covered 3,364s of
   3,600 while `situationCode` independently reported `0651` for seven
   third-period shots. Two different fields, same conclusion.

Known empty-net shot: `0651`, period 3, 16:32. Known power-play shot: `1451`,
period 1, 05:34, inside a penalty window.

## Done condition 3 — the OT term, measured

| | |
|---|---|
| tie rate (reached overtime) | **0.2057** (288 of 1,400) |
| **home share of overtime games** | **0.5417**, n = **288** |
| shootout home share | 0.5000, n = 4 |
| pre-game home-win base rate | 0.5371 |

Not 0.5, and carrying its sample size. Derived from the max period per game,
which works on every season — see the defects below for why that matters.

## Task 5 — where the number goes

`src/index.js`'s NHLE branch fills the **same `g.winProb` field and the same
shape** the client already consumes, and posts to the **same** `GAME_DO` `/wp`
route for `openingWP` and `wpDelta`. `src/game-do.js:20` already sanctions the
field — `Poisson probability distribution output (factual)`.

One gamecenter play-by-play call per **live** game, on a pull, never on a cron.
Rule 78: TTL 20s and an explicit `cacheKey`, both copied from the two NHL
fetches already in that branch (scoreboard 30s, landing 300s).

`CONTRACTS.md` now carries the whole contract, including that a refusal is
absent rather than zero, and that the two reserved labels must not be reused.

## Defects found, each by a check rather than by review

1. **An absent column measured as a tie rate of zero.** `wentToOT` is absent
   from the 2021-2023 files. `otSemantics` counted `r.wentToOT === '1'` over
   `undefined` and published **`tieRate: 0.0000` across 1,400 games as a
   measurement** — the exact substitution Rule 99 forbids, committed in the same
   session as gates enforcing it. It then disabled the three-way reconstruction
   for 1,243 games.
2. **A gate that ruled on 8 of 1,400 games.** With the tie rate at zero the
   verdict read `DOES NOT SHIP — the model loses to the de-vigged market
   baseline`. Every number needed to see the sample was in the artifact and the
   **verdict string mentioned none of them.** It now refuses to rule below 50%
   coverage and states used-of-available in every outcome.
3. **A column present in the header and empty on every row.** Season 2024 lists
   `homeWinProbability`, `wentToOT`, `wentToShootout`, `homeTeamScore`,
   `roadTeamScore` and `timeLeft` — all empty. **This refutes a claim I had
   already published:** an earlier commit here said MoneyPuck's
   `homeWinProbability` column refutes the CC-CMD's "nobody serves one". It does
   not. There is no MoneyPuck WP baseline and the CC-CMD's premise stands.
   Rule 99 has four states and this script had been treating "in the header" as
   "usable".
4. **A goalie TOI sum that laundered absence into a conclusion.**
   `g.toi ?? '0:00'` summed over `pg[side]?.goalies || []` produced 0 seconds
   from no data — which in that cross-check means a side skated without a goalie
   all game. `check-aggregate-launders-unknowns.mjs` failed the deploy and was
   right to; it now routes through `lib/summary-invariants.mjs total()`.
5. **An unreachable guard.** `if (pDraw < 0) return null` could never fire:
   `pDraw` is identically the tie rate by the definition of `k`. Removed rather
   than kept, and the algebra written out — the reconstruction is the two-way
   ratio shrunk toward `otHomeShare`, so it can move calibration and cannot move
   discrimination. Its own test exposed it.
6. **`Number(null)` is 0 and finite**, so a completed game with absent scores
   became a real 0-0 result with `homeWon: 0`.
7. **A null xG model threw.** The WP path guarded it and the xG path did not, so
   `scoreLinear` dereferenced `intercept` on null and the whole play-by-play
   walk died.
8. **A throw left no artifact.** The first train run failed and the reason was
   unreadable — this project's GitHub client cannot follow the log blob
   redirect, and the `if: always()` commit step had nothing to stage. A throw now
   writes `outbox/hockey-wp-train-failure-*.json` with breadcrumbs and heap use.
   That artifact is what diagnosed the next failure in one read.
9. **`parseCsv` threw on any absent column**, which killed a run on season 2021
   after parsing 2020's 78,611 rows. Column sets are not constant across
   nineteen years of vendor output.
10. **Four checks pinned the placeholder model** and broke when training wrote a
    real one — testing which state the file was in rather than the guard. **And I
    did not see it, because I verified with `node check | tail -1`.** A
    pipeline's exit status is the last command's, so `tail`'s 0 masked the
    check's 1 and a commit went out with four red assertions. That is the same
    defect I fixed in this repo's push loop earlier the same day.
11. **Two mutation `expect` strings matched renamed assertions**, so both
    reported CAUGHT while being caught by a *different* assertion than the one
    they exist to prove — the dead-keeper shape, again.

### A false finding that was checked instead of published

`V2_NON_SOCCER_WP_SPORTS` lists `baseball`, `football`, `basketball` and
`australian-football` and does **not** list hockey, which reads exactly like the
soccer Dixon-Coles model computing NHL win probabilities in production. It is
not: the entire ESPN block is guarded by `if (cfg.espnLeague)` and the NHL config
carries `nhleSource` with no `espnLeague`, so that loop is unreachable for
hockey. One read of the guard, before saying anything.

## Checks

| | |
|---|---|
| `scripts/check-hockey-wp.mjs` | **42** checks |
| `scripts/mutate-hockey-wp.mjs` | **13** mutations, **13 caught, 0 unsound** |
| `scripts/hockey-wp-train.mjs --self-test` | 37 |
| `scripts/hockey-wp-market.mjs --self-test` | 23 |
| `scripts/hockey-wp-probe.mjs --self-test` | 18 |

All wired into `guards.yml`. The harness asserts each anchor is unique and was
applied before reporting; one mutation initially survived — the attacking net
flipping each period — and **the check was added rather than the gap
documented**, because a net aimed at the wrong end of the rink still returns a
number.

## Artifacts

| file | what |
|---|---|
| `outbox/hockey-wp-calibration-latest.json` | the gate, all baselines, reliability, splits, premises |
| `outbox/hockey-wp-probe-latest.json` | MoneyPuck columns, `situationCode` confirmation |
| `outbox/hockey-wp-probe-latest-espn.json` | `pickcenter` verbatim |
| `outbox/hockey-wp-market-census-latest.json` | overround per provider, three seasons |
| `outbox/hockey-wp-market-baseline-latest.json` | 1,312 games of de-vigged market |
| `src/hockey-wp-model.js` | the committed coefficient tables |

## Stop conditions

| condition | held |
|---|---|
| no ML runtime in the Worker | **yes** — inference is a dot product over committed coefficients |
| stop and report if the model loses the market baseline | **not triggered** overall; it **does** lose the pre-game comparison and that is reported above, not buried |
| no shuffled training | **yes** — whole seasons, 0 games on both sides, asserted not assumed |
| do not relabel or replace the market estimate | **yes** — `wp-resolver.js` untouched, both reserved labels asserted distinct |

## Residual

**None deferred.** Two things are measured limits rather than open work, and
both are stated where the result is read:

1. **The model loses the pre-game comparison** (0.2472 vs 0.2326). It carries no
   team-strength feature. Adding one is a different document; the pre-game path
   already returns a labelled prior rather than a model read, so nothing
   currently serves the weaker number as if it were the stronger one.
2. **There is no MoneyPuck WP baseline**, because that column is empty in every
   file checked. `beats_moneypuck` reads `null` and the artifact says why.

Option (a) — xG rates into a Poisson over remaining time — was not built,
because (b) cleared the bar. That is the CC-CMD's own instruction, not a
carry-forward.
