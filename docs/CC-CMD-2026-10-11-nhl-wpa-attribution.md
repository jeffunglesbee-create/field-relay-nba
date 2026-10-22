# Claude Code Command — win probability added, attributed to the players the feed already names

**Date:** 2026-10-11
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** C (feature) — **no model change, no retraining, no new upstream call**
**Status:** **STOPPED AT TASK 4**; TASKS 1, 2, 3 AND 5 DONE 2026-10-11. Stopped by this
document's own stop condition: *"If the Task 4 conservation check does not
close, STOP and report the residual."* Artifact:
`outbox/nhl-wpa-conservation-latest.json` (run 38119842995, 28 games, 31 calls
of a declared 40). Second document filed per Rule 87.4:
`docs/CC-CMD-2026-10-11-wpa-shootout-residual.md`.

**THE CHECK DOES NOT CLOSE, AND THE RESIDUAL IS ENTIRELY THE SHOOTOUT.**

| cohort | n | median residual | within 0.01 |
|---|---|---|---|
| regulation | 21 | **0.000** (max 0.019) | **19 of 21** |
| overtime decided by a goal | 2 | −0.007 / 0.006 | **2 of 2** |
| **shootout** | **5** | **0.652** (0.635–0.701) | **0 of 5** |

21 of 23 non-shootout games close. 5 of 5 shootouts fail, all with the home
side winning from a last modelled probability of 0.30–0.37 — because the NHL's
final score includes the shootout-winning goal while the last shot state says
the home team was behind. The model's nine features describe score, clock,
strength and xG; **none describes a penalty-shot round**, and period 5 is a
different game.

**AND THE CHECK PROVES LESS THAN IT APPEARS TO.** The deltas **telescope**:
`sum(wp_i − wp_{i−1})` is identically `wp_last − wp_first`, measured true on
every one of the 28 games. So the sum carries no information the two endpoints
do not, and the residual is just `outcome − wp_last`. A double-counted or
dropped play in the middle of a game would cancel out and the check would still
close. It is a real check on the ENDPOINTS and not on the attribution between
them, and that limit belongs beside it.

### A defect the conservation check could not have caught

The score carry sat BELOW the snapshot push in the walk, so a goal's snapshot
held the **pre-goal** score, its own swing landed on whatever shot came next,
and the scorer was credited **−0.0012** on a goal that opened the scoring. The
same goal now credits **+0.1068** to the scorer and +0.0445 / +0.0267 to the
assists. Telescoping means the conservation sum was identical either way — this
was caught by reading one credited number, not by the check that exists to make
the work falsifiable.

**Tasks 1, 2, 3 and 5 are complete and committed.** The delta series comes from
the existing walk with one model evaluation per shot state; the 60/25/15 credit
split is stated as a convention in one changeable place with its reasoning; four
states are distinguished and none is a ΔWP of zero, with the prior excluded as
an endpoint; and `WPA_LABEL` is asserted distinct from the four labels that
already exist. 63 checks, 18 of 18 mutations caught.

**Rule F:** a difference between two of our own probabilities, attributed to the
player the vendor names on the event. Arithmetic. Commodity.
**Rule A:** pull only. No cron, no alert, no badge-on-change — a swing in win
probability is the single most tempting thing in this repository to notify on,
and notification is not cleared.
Follows `docs/CC-CMD-2026-10-10-nhl-win-probability-from-xg.md` (DONE).

## Why this exists

"Can the model know the players?" has two answers and only one of them needs
on-ice history.

Adding player identity to the WP **feature set** needs historical on-ice state,
multiplies the parameter space, and invalidates the calibration that cleared the
gate at Brier 0.171551. That is `CC-CMD-2026-10-11-nhl-shift-charts-on-ice.md`,
and it is a bigger job.

**Attribution needs none of it.** The model already produces a probability for
any state. Take the difference between consecutive states and attribute it to
the players the event already names. That is win probability added — standard in
baseball, commodity, and it uses only fields measured as present on
game 2026020053:

| event | fields | n |
|---|---|---|
| `shot-on-goal` | `shootingPlayerId` | 49 |
| `blocked-shot` | `shootingPlayerId`, `blockingPlayerId` | 38 |
| `missed-shot` | `shootingPlayerId` | 30 |
| `goal` | `scoringPlayerId`, `assist1PlayerId` (7), `assist2PlayerId` (3) | 8 |
| `faceoff` | `winningPlayerId`, `losingPlayerId` | 53 |
| `hit` | `hittingPlayerId`, `hitteePlayerId` | 29 |
| `penalty` | `committedByPlayerId`, `drawnByPlayerId` (7) | 8 |

Plus `goalieInNetId` on every shot, and `rosterSpots` — **40 entries** carrying
`playerId, teamId, sweaterNumber, positionCode, firstName, lastName, headshot`
**in the same payload**, so no second call is needed to turn an id into a name.

And for FIELD's purpose it is the better feature. *"Ovechkin's goal was worth
+0.31 win probability"* is a sentence a brief can carry and a scorer can check
against the row. *"WP adjusted for who was on the ice"* is invisible to a
reader. `src/journalism-quality.js:105` is explicit about which kind of input
earns points — it `reads a RELATION between two numbers` that, in its own
words, `cannot be copied from the prompt`.

## It also lets GSAx finally reach the goalie it describes

`src/nhl-gsax-r2.js` has computed GSAx weekly since June and nothing consumes it
per game. The WP model's own caveat records the gap in its own words —
*"goalieInNetId absent; goalie quality is not a model input, so nothing was
substituted for it."* Attribution is where that join belongs: every shot names
the goalie facing it, so the goalie's share of WPA can be reported beside their
GSAx without either becoming a model feature.

## Tasks

**Task 1 — ΔWP over the existing walk, one pass.** `stateFromPlayByPlay` already
walks the plays array once, carrying the previous play for rebound and rush
detection. Extend that walk to evaluate the committed model at each shot state
and emit the delta. **Do not re-walk and do not re-import the model** — one
model, one owner, one evaluation path.

**Task 2 — attribute, and be explicit that credit is a CONVENTION.** A goal's
ΔWP split across scorer and assists is a choice, not a measurement. State the
split in the source with its reasoning, do not bury it in a constant, and make
it one place a future reader can change. Same for a faceoff win, a block and a
drawn penalty. **A convention stated is honest; a convention implied is a
fabrication with a decimal point.**

**Task 3 — four states, and none is zero (Rule 99).** The model refuses on an
unreadable `situationCode` or an absent score, and returns a labelled **prior**
before the first shot. So a ΔWP is unavailable whenever either endpoint of the
difference is not `state: 'modelled'`. That is **not a ΔWP of 0.0** — a play
that changed nothing and a play we could not evaluate are different facts.
Four: computed; one endpoint refused; both refused; the play names no player.
The prior-to-first-modelled transition is **not** a ΔWP and must be excluded
explicitly rather than silently producing a large bogus swing.

**Task 4 — a conservation check, which is the thing that makes this falsifiable.**
Over a complete game, the sum of all ΔWP plus the opening prior must equal the
final outcome (1 or 0) within tolerance. Assert it per game and report the
residual distribution across a season. **A non-closing sum means plays are being
double-counted or dropped**, and no amount of plausible per-play numbers would
reveal that. Report the tolerance and how it was chosen.

**Task 5 — the label.** `hockey-wp.js` exports `WP_LABEL`, `PRIOR_LABEL`, and
`MARKET_LABEL`/`VENDOR_LABEL` explicitly so they are **not** reused. WPA is a
fifth kind of number. Give it its own label and add it to that block with the
same comment discipline.

## Stop conditions

- Do not change the coefficients, the feature vector, or the calibration
  artifact. If a task requires it, STOP — that is the shift-chart document.
- Do not add a cron, a watch, or a diff-on-change. Rule A.
- Do not fold GSAx into the WP model as a feature. Report it beside the goalie's
  WPA; a feature change re-opens the gate.
- If the Task 4 conservation check does not close, STOP and report the residual.
  Shipping per-play numbers whose sum is wrong is the failure this task exists
  to catch.

## Done conditions

1. One walk emits ΔWP per shot state, from the committed model, with no second
   evaluation path.
2. The credit convention is stated in the source, in one place, with its
   reasoning.
3. Four states are distinguishable and a refused endpoint never reads as 0.0;
   the prior-to-first-shot transition is excluded by name.
4. The conservation check runs per game, with a stated tolerance and a reported
   residual distribution over a season.
5. A goalie's WPA is reportable beside their GSAx, with neither becoming a model
   feature.
6. A fifth label exists and no existing label is reused.
