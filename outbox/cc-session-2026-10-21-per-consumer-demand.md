# CC session — per-consumer odds demand (2026-10-21)

`docs/CC-CMD-2026-09-16-odds-spend-attribution.md` Task 2, dispatched by the
owner ("dispatch per-consumer demand"). Status: Tasks 1 and 2 DONE. Task 3 is
unblocked and not dispatched.

**HEAD:** `fdb3c640` → `3d5f0655` (HANDOFF close-out) → `101263a5` (join
CC-CMD) → `d9ba2dbe` (the measurement) → this docs commit. Branch main
throughout.

**Where it lives:** in this repo. LAB-FIRST-A routes client work to the
laboratory. This measurement reads relay source (`src/ambient-do.js`,
`src/index.js`, `src/odds-sport-keys.js`, `oddsCreditCost`) and extends the
relay's own `scripts/measure-odds-demand.mjs` convention (Rule 62).

## What landed

| commit | what |
|---|---|
| `3d5f0655` | HANDOFF close-out for 10-19..21. Guards had been red on `6ea76d9b` (run 39656960732, "HANDOFF.md is not stale"). Green again: run 39683922850 |
| `101263a5` | Filed: `docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md` |
| `d9ba2dbe` | `scripts/measure-odds-consumer-demand.mjs`, `.github/workflows/odds-consumer-demand.yml`, and a by-name scope exclusion in `scripts/check-odds-calls-guarded.mjs` |
| this commit | Filed: `docs/CC-CMD-2026-10-21-closing-capture-calls-18x-its-need.md`. The CC-CMD's Status and Results, HANDOFF, and this doc |

## Done condition (Rule 90 artifact)

The done condition: "a committed artifact giving worker demand per day for the
last 7 days, next to worker spend from Task 1, with the ratio stated".

It is `outbox/odds-consumer-demand-20261021T224035Z.log`, from run 39688177856,
which succeeded at all three steps: the models can fail, measure, commit.

The run reproduced every figure predicted before it. The predictions came from
the four-lens review's independent run of the pure functions on D1 rows:

| | predicted | artifact |
|---|---|---|
| closing capture demand | 300 (100 slots) | 300 |
| CFL demand | 12 | 12 |
| opening snapshot demand | 141 | 141 |
| historical demand / unwritable | 870 / 570 | 870 / 570 |
| charged: closing, CFL, opening, historical, WC lambdas | 5361, 4746, 2514, 1620, 108 | the same |

The 7-day table is in the CC-CMD's Results.

## How the models were made

1. **Map, then attack.** Seven readers mapped every consumer: its trigger,
   gating, caching, price, demand unit and data source. A refuter then attacked
   each model, and a premise reader checked the inputs. 6 of 7 models did not
   survive as first proposed; the script uses the corrected ones.
2. **Build.** Every price is read from the consumer's own URL statement in
   `src/`, through an anchor that must be unique, and priced by
   `oddsCreditCost`. `_getOddsCooldown` and the World Cup window are evaluated
   from source with the day pinned.
3. **Review.** Four lenses: fidelity, real-data numbers, bugs and conventions.
   - 16 findings were raised; 15 were confirmed by a verifier and fixed.
   - The one refuted (scope gate) was a staging-order point. The commit
     carries the exclusion with the script, as it advised.
   - The confirmed ones that changed numbers:
     - historical units the join cannot write (570) are now kept out of demand;
     - opening snapshots count only rows seeded before kickoff;
     - the World Cup is in the ambient models;
     - the WC-probs model has its cron window;
     - a closed day must have settled (10:15Z).
   - One finding would have stopped every June run: the clock-pin test could
     not fail in June.
4. **Proof.** Self-test 26 cases; 20 of 20 mutations caught. The self-test was
   also run under June, October and January clocks. The guards that read these
   files pass on a clean export.

## What this session got wrong, and the cost

- **Missed a red run.** On 6ea76d9b I checked only the Drive upload and missed
  that Repo guards went red at 18:54Z. It stayed red about 4 hours, until
  `3d5f0655`. The cause was mine: my 10-20 HANDOFF entries used a dated
  heading the staleness checker does not read as a close-out.
- **My local guard runner could not see it.** It runs on a one-commit clean
  export, so the HANDOFF lag was invisible to it.
- **The first model set needed the review to correct it.** Six were wrong as
  first proposed, and five more defects were in the first built version.
- **A checker ran the live read once, by accident (earlier the same day).** It
  imported a watch script, whose top-level code ran a live
  `GET /budget/odds` (0 credits). This script runs only when invoked directly.
- **A stale agent worktree** (`.claude/worktrees/agent-ae0d…`, 0 unique
  commits) made local scope and ratchet checks fail falsely. It is removed.

## Residuals, filed (Rule 87.4)

- **`docs/CC-CMD-2026-10-21-closing-capture-calls-18x-its-need.md`.**
  - Closing capture kept 5,361 real credits against a need of 300.
  - The hypothesis (re-capture after a DO restart) is untested.
  - 10-20 had no capture at all with 10 games.
- **`docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md`.**
  NBA/NHL/NFL/CFB: 570 credits a week fetched with no possible write.
- **Task 3 (ceilings) is unblocked and not dispatched.** The Results say why a
  ceiling taken from today's spend would encode three defects.

## Limits, printed with the result (Rule 91)

- **Consumers covered:** 7 of 9 have a demand model.
  - wpResolver is UNKNOWN: pick volume is not readable from CI.
  - ambientFetchLiveOdds is "if served" only, and stays outside the totals.
- **Demand is a floor of need under each stated model.** The vendor may not
  list every scheduled game, for example NBA preseason.
- **`JOIN_UNWRITABLE` is a dated constant, not a measurement.** It is removed
  by the join CC-CMD.
- **The live window** is the median of finalized_at − start_time. finalized_at
  is stamped when a cron sees the final, so it runs a little long.
