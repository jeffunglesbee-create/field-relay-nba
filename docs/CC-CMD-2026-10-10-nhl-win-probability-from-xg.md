# Claude Code Command — NHL win probability, built from xG because nobody serves one

**Date:** 2026-10-10
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** C (feature) — a model, in the relay, one file
**Status:** FILED, not started.

**Rule F:** cleared by the same argument `src/soccer-wp.js` makes in its own
header — *"predicts binary outcome probability — arithmetic on game state. Not
an interest/excitement level. Relay-is-dumb: writes probabilities (facts), not
editorial interest."* Identical claim, different sport.
**Rule A:** pull only. No cron, no push, no badge-on-change.
**Rule 47:** `soccer-wp.js` is the standing precedent for a probability model
living in the relay. One model, one owner — the rule
`CC-CMD-2026-08-27-relay-per-play-epa.md` settled. New file, per the
one-file-one-concern convention `cache-helpers.js`, `odds-shape.js` and
`soccer-wp.js` already follow: **`src/hockey-wp.js`**.

## Why this exists — the sourcing question is closed

Measured 2026-10-10, three independent dead ends:

- **ESPN** serves no hockey win probability. `/espn-summary/sports/hockey/nhl/summary?event=401891820`
  returned 200 at 467,871 bytes with 19 top-level keys — `againstTheSpread,
  article, boxscore, broadcasts, format, gameInfo, header, injuries, leaders,
  meta, news, odds, onIce, pickcenter, plays, seasonseries, standings, videos,
  wallclockAvailable`. No `winprobability`. That array exists for basketball and
  baseball, which is why `wp-resolver.js` branches on
  `s === 'nba' || s === 'wnba' || s === 'mlb'` and NHL is routed to the Odds API
  instead — correctly, and labelled as such at line 105.
- **The NHL's own API** serves none either. All four gamecenter endpoints pulled
  through the relay's `/nhl/*` proxy on game `2026020053`, full bodies searched:

  | endpoint | bytes | keys | win/prob/expect/xg matches |
  |---|---|---|---|
  | `/landing` | 13,967 | 89 | none |
  | `/boxscore` | 13,280 | 78 | `faceoffWinningPctg` |
  | `/right-rail` | 5,277 | 61 | `awayTeamWins`, `homeTeamWins`, `seasonSeriesWins` |
  | `/play-by-play` | 129,078 | 102 | `winningPlayerId` |

- **BSD cannot help.** Its hockey league list is 13 leagues — DEL, SHL, KHL,
  Liiga, Extraliga, National League A, Spengler Cup, U20 Worlds and others —
  **and no NHL** (`outbox/bsd-surface-probe-latest.json`, task3_leagues).

The open internet sells odds, not models. The one live-WP project found,
`github.com/samintisar/icewatch`, reads **"Phase 1: data layer (in progress)"**
and ingests exactly the two sources FIELD already has. That is a datapoint about
difficulty, not a shortcut.

So the only honest NHL win probability FIELD can have is one it builds, and the
only alternative is the de-vigged moneyline already served at
`wp-resolver.js:511` as `label: 'Market estimate'`.

## THE SUBSTRATE IS ALREADY IN HAND — measured, not assumed

`/nhl/v1/gamecenter/2026020053/play-by-play`, 309 plays, **125 shot events**
(49 `shot-on-goal`, 38 `blocked-shot`, 30 `missed-shot`, 8 `goal`). Every shot
carries:

```
details: { xCoord, yCoord, shotType, zoneCode, goalieInNetId,
           eventOwnerTeamId, homeScore, awayScore }
situationCode, homeTeamDefendingSide, timeInPeriod, timeRemaining,
periodDescriptor
```

Sample: `situationCode: 1551`, `xCoord: -72`, `yCoord: 6`,
`shotType: 'backhand'`, `zoneCode: 'O'`, `timeRemaining: '19:37'`.
Game level: `clock`, `otInUse`, `shootoutInUse`, `regPeriods`, `maxPeriods`,
`gameOutcome`.

**`situationCode` is the field that makes this tractable.** Four digits —
away goalie, away skaters, home skaters, home goalie — so `1551` is 5-on-5 with
both goalies in. A `0` in the first or fourth position is a pulled goalie, and
any skater asymmetry is a power play. One field, both of the two states a
soccer-shaped model gets most wrong. **Confirm that reading against a known
empty-net and a known power-play shot before building on it.**

## FOUR WAYS HOCKEY BREAKS A SOCCER PORT — do not copy `soccer-wp.js`

1. **There are no draws.** `P(home win) = P(home ahead at 60) + P(tied at 60) ×
   P(home wins OT/SO)`. That second term is a separate estimation problem —
   3-on-3 sudden death then a shootout — and it must be **measured from
   history**, not assumed to be 0.5. Roughly a quarter of NHL games reach it, so
   it is not a rounding error.
2. **Empty net.** A homogeneous Poisson over remaining time is least accurate in
   the final two minutes, which is precisely when a win probability is read. The
   trailing team's rate and the leading team's rate both move sharply, in
   opposite directions, and `situationCode` reports it.
3. **Power play.** Scoring rates differ by a multiple, not a margin — and
   `src/nhl-series-r2.js` already computes **series-adjusted PP%/PK%** from
   gamecenter boxscores, written precisely because season averages misdescribe a
   current series ("CAR pk:93.5 was their pre-SCF PK%").
4. **Goalie quality.** `src/nhl-gsax-r2.js` already computes **GSAx** weekly
   from MoneyPuck, and every shot names `details.goalieInNetId`. Both halves of
   that adjustment are already in the tree.

**DO NOT port Dixon-Coles.** `soccer-wp.js`'s `DC_RHO = -0.130` is a low-score
**draw** inflation correction. Hockey has no draws. Using it would be a category
error dressed as reuse.

## Tasks

**Task 1 — train offline, score online, and that split is the feasibility.**
A logistic regression's inference is a dot product, so the Worker needs **no ML
runtime** — it needs a committed coefficient table. Train in a script against
MoneyPuck `shots_YYYY.csv` (already a wired dependency), commit the
coefficients as a constant with the training date, row count and feature list
beside them, and score live shots in the Worker.

Features, from what the PBP actually carries: adjusted distance and angle from
`xCoord`/`yCoord` normalised by `homeTeamDefendingSide`, `shotType`,
`zoneCode`, strength and empty-net from `situationCode`, rebound and rush from
the previous event's type and time delta. `github.com/BenReed29/xG-Model` is a
public model of exactly this shape, benchmarked against MoneyPuck's own xG —
read it for the feature set, do not vendor it.

**Task 2 — choose the WP architecture by measurement, not by preference.** Two
candidates, and the document deliberately does not pick:

- **(a) xG rates → Poisson over remaining time → WP**, the `soccer-wp.js` shape.
- **(b) a direct logistic WP on game state** — score differential, time
  remaining, strength, cumulative xG differential — trained on historical
  play-by-play outcomes.

**Score differential and time remaining dominate win probability; xG is a
secondary input.** A model that consumes xG and ignores the scoreboard would be
confidently wrong, and "build it from xG" must not be read as "build it from xG
alone." Default to (b) with xG as one feature, build (a) only if (b) is beaten
on Task 3's bar, and report both.

**Task 3 — THE BAR. Calibration against two baselines, or it does not ship.**
An uncalibrated win probability is a confident wrong answer with a percentage
sign. Hold out whole seasons, never shuffled games, and report:

1. **Brier score** against **constant 0.5** — the floor.
2. **Brier score against the de-vigged market estimate** `wp-resolver.js:511`
   already serves. **If the model cannot beat the market number FIELD already
   has, it does not ship.** That is the falsifiable condition and it is the
   whole point of writing it down before building.
3. A **reliability curve** — bin predictions, compare predicted rate to observed
   outcome rate per bin, print the table. A good Brier with a bowed reliability
   curve is a model that is right on average and wrong everywhere.

Report by game state too: 5-on-5, power play, and the final two minutes
separately. A model that is calibrated overall and broken at 6-on-5 is broken
where it is read.

**Task 4 — three states, and none of them is 0.5 (Rule 99).**

- **no shots yet** (pre-puck-drop) is not an even game. Either refuse, or return
  a stated pre-game prior that is labelled as a prior and is NOT the market
  estimate wearing a model's label.
- **`situationCode` unreadable** is not even strength.
- **`goalieInNetId` absent** is not an average goalie.

Each must be distinguishable in the return value, and the label must be distinct
from `'Market estimate'` and from `'Statistical probability'` — this is a third
kind of number and conflating it with either is the substitution this repository
keeps finding.

**Task 5 — where the number goes.** `src/game-do.js:20` already documents
`winProb: Poisson probability distribution output (factual)` and `:245` the V2
polling loop that fills it for live football games. Reuse that path rather than
inventing a second one. No new cron.

## Stop conditions

- **No ML runtime in the Worker.** If inference needs more than arithmetic over
  committed coefficients, STOP and report — that is a different architecture and
  a different document.
- If the model loses to the market baseline, STOP and report the numbers. A
  model that is worse than what ships today is a finding, not a failure, and the
  refusal belongs beside `wp-resolver.js` the way the BSD odds refusal does.
- Do not train on shuffled shots or shuffled games. Leakage would make Task 3
  pass and the product wrong, and Task 3 is the only thing standing between this
  and a plausible fabrication.
- Do not relabel or replace the market estimate. Both numbers may exist; one
  must not be dressed as the other.

## Done conditions

1. `src/hockey-wp.js` exists, trains offline, scores in the Worker from a
   committed coefficient table carrying its training date, row count and
   feature list.
2. The `situationCode` reading is confirmed against a known empty-net shot and a
   known power-play shot, in an artifact.
3. The OT/shootout term is a measured constant with its sample size, not 0.5.
4. An artifact reports Brier against both baselines and a reliability table,
   overall and split by 5-on-5 / power play / final two minutes.
5. The three absent states are distinguishable in the return value, with a
   check, and the label is distinct from the two that already exist.
6. No cron, no push, no second copy of the model.
