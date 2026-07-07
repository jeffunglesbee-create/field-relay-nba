# CC-CMD: Synthetic benchmark mode for drama-score-cost + confidence-gate correction

**Date:** 2026-07-07
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

**Two things in this doc — read both before starting.**

## PART A — A real process finding from the prior CC-CMD, not optional reading

The prior CC-CMD (`CC-CMD-2026-07-07-drama-score-cost-measurement.md`)
reported **85/100 confidence** and then **committed and deployed anyway**
(`04611bc`, `1c8b88e`) — despite its own explicit instruction: "Do not
commit unless confidence >= 95. If score < 95, report verbatim and
stop." Confirmed via `git log` — this is not a hypothetical. Every other
CC-CMD in this project that has scored below 95 has correctly stopped
without committing (e.g., the SW push redesign at 70/100 the same
session). This is the first known violation of that gate.

**This is not being reverted** — the ported functions and the test
route are themselves correct (the gap was in the *measurement*, not the
code), and the route is explicitly test-only and already flagged for
removal before any real migration. But the gate itself was real and was
not followed. State plainly in this CC-CMD's own outbox that this was
noticed and corrected going forward — do not repeat it here. If this
CC-CMD's own confidence lands below 95, stop and report, matching every
other CC-CMD in this project.

## PART B — The actual fix: synthetic benchmark mode

**The real problem:** the deployed route depends on a live game
existing at the moment it's called. At every point it's been checked
today (11:19 AM, 11:20 AM, and independently again just now), zero live
games existed — MLB/WNBA hadn't started for the day. Waiting for evening
game time works eventually but isn't the best available option — a
synthetic, controlled benchmark gives a real, immediate, and more
rigorous measurement, since it can deterministically exercise every
sport branch in `dramaScoreLive()` rather than depending on whichever
sport happens to be live at one arbitrary moment.

## PROBE BLOCK
```bash
sed -n '10818,10868p' src/index.js
```
Confirm this still matches the current route before extending it.

## TASK — Add `?synthetic=1` mode to the existing route

When `?synthetic=1` is present, skip the live `/v2/games` fetch entirely
and instead run `dramaScoreLiveTest()` against this fixed set of
representative synthetic `eData` objects — one per major branch in the
function, covering the sports with genuinely distinct code paths:

```javascript
const SYNTHETIC_CASES = [
  { sport: 'mlb',    eData: { state:'live', homeScore:4, awayScore:4, period:11, clock:'0', onFirst:true, onSecond:true, onThird:true, outs:2, balls:3, strikes:2 } }, // extra innings, bases loaded, full count
  { sport: 'nba',    eData: { state:'live', homeScore:98, awayScore:96, period:5, clock:'1:30', situation:{ homeFoulsBonus:true, shotClock:'6' } } }, // OT, bonus, shot clock pressure
  { sport: 'nhl',    eData: { state:'live', homeScore:2, awayScore:2, period:3, clock:'1:00', situation:{ homeGoaliePulled:true } } }, // empty net
  { sport: 'nfl',    eData: { state:'live', homeScore:21, awayScore:17, period:4, clock:'1:45', situation:{ isRedZone:true, downDistanceText:'4th and goal, 2-minute warning' } } }, // 2-min, red zone, 4th down
  { sport: 'soccer', eData: { state:'live', homeScore:1, awayScore:1, period:2, clock:'90+3', _wcAdvProb:{ homeAdvance:0.15, awayAdvance:0.60 }, _wcOpeningAdvProb:{ homeAdvance:0.50, awayAdvance:0.55 } } }, // stoppage time, elimination stakes, big swing
  { sport: 'afl',    eData: { state:'live', homeScore:88, awayScore:85, period:4, clock:'3:00' } },
  { sport: 'cfl',    eData: { state:'live', homeScore:24, awayScore:22, period:4, clock:'1:20' } },
  { sport: 'wnba',   eData: { state:'live', homeScore:80, awayScore:78, period:4, clock:'0:45' } },
  { sport: 'tennis', eData: { state:'live', homeScore:6, awayScore:5, period:3 } },
];
```

Run each case **1000 times** (not once — a single call includes JIT
warm-up noise; looping gives a stable, meaningful number) using the same
`performance.now()` wrapping pattern already in the route. Report
per-case and overall stats: `{ mode:'synthetic', casesRun, iterationsPerCase, perCase: [{sport, min, max, avg, p50}], overall: {min, max, avg, p50} }`.

Keep the existing live-game path completely unchanged for requests
without `?synthetic=1` — this is additive, not a replacement.

## VERIFICATION

- `node --check src/index.js`.
- Call `GET /test/drama-score-cost?synthetic=1` live, at least twice,
  and report the real returned numbers — this should work regardless
  of the time of day, verify that it actually does.
- Redo the cost arithmetic from the prior CC-CMD using these real
  measured numbers instead of the 0.001-0.01ms estimate, against the
  same real baseline (cpuTimeP50 984μs, 30M CPU-ms/month included) —
  show the corrected math.
- If real live games happen to exist at verification time, also call
  the existing non-synthetic path and report both side by side — real
  confirmation the synthetic cases are realistic, not just internally
  consistent.

## DONE CONDITIONS
- [ ] Part A's gate-violation finding acknowledged in this CC-CMD's own outbox
- [ ] Probe block confirms citation before editing
- [ ] `?synthetic=1` mode added, live-game path unchanged
- [ ] 1000 iterations per case, not single-shot timing
- [ ] Called live at least twice, real numbers reported
- [ ] Cost arithmetic redone with real numbers, shown not asserted
- [ ] This CC-CMD's own confidence gate respected — if <95, stop and report, do not repeat Part A's mistake
- [ ] Outbox written

## CONFIDENCE SCORING TABLE
+15  Part A's finding acknowledged, not glossed over
+30  Synthetic mode correctly implemented, additive, live path unchanged
+25  Real live measurement obtained, immune to time-of-day
+20  Cost arithmetic redone correctly with real (not estimated) numbers
+10  Outbox complete, gate genuinely respected this time

## ONE-LINER
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO -- this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-07-drama-score-synthetic-benchmark.md.
First: acknowledge in your own outbox that the prior CC-CMD committed at
85/100, below its own required 95 threshold -- a real gate violation,
not being reverted since the code itself was correct, but not to be
repeated. Then: add a ?synthetic=1 mode to the existing /test/drama-
score-cost route using the embedded synthetic test cases, 1000
iterations each, to get real CPU timing immediately regardless of
whether any real game is currently live. Call it live at least twice
and redo the cost arithmetic with real numbers. Respect your own
confidence gate this time: do not commit unless confidence >= 95. If
score < 95, report verbatim and stop -- actually stop.
