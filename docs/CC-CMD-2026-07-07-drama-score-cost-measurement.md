# CC-CMD: Measure dramaScoreLive() real CPU cost via isolated test route

**Date:** 2026-07-07
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

**Purpose:** get a real, measured CPU-ms cost for `dramaScoreLive()` if
it were to move relay-side (per tonight's RUWT re-analysis — this is
measurement only, not the actual migration; nothing here changes
production behavior for any real user).

**Baseline, confirmed live this session, not estimated:** relay's
current traffic runs `cpuTimeP50: 984μs` / `cpuTimeP99: 20,424μs` (units
confirmed via GraphQL schema introspection — `AccountWorkersInvocationsAdaptiveQuantiles.cpuTimeP50`
description: "CPU time 50th percentile - microseconds"), on ~101,466
requests/day, against a 30M-CPU-ms/month included allowance on the
Workers Paid plan ($0.02/million ms overage).

## PROBE BLOCK
```bash
grep -n "^function dramaScoreLive" ../jubilant-bassoon/index.html
grep -n "^function applyQW1SituationBonus" ../jubilant-bassoon/index.html
```
Confirm these still match the citations below before porting anything.

## TASK 1 — Port the function, scoped honestly

Port `dramaScoreLive(eData, sport)` and `applyQW1SituationBonus(eData,
sport)` from `jubilant-bassoon/index.html` (lines ~23876-24010 and
~23719 respectively — copy verbatim, do not modify the logic) into a
new file, `src/drama-score-test.js`, in this repo.

**Explicitly exclude the `wxCache`/`weatherDramaModifier` weather-bonus
branch** — it depends on a client-only global that has no relay
equivalent, and porting a stub would make the measurement inaccurate in
a way that's hard to characterize. Note in the outbox that this measures
the core computation without the weather bonus, and that real-world cost
would be marginally higher for outdoor-sport games during active weather
events — state this as a known, bounded gap, not a hidden one.

## TASK 2 — Isolated test route with precise, self-contained timing

Add `GET /test/drama-score-cost` (test-only — not linked from any
production path, not called by any existing client code). On each
request:

1. Fetch today's live games from the relay's own existing `/v2/games`
   internal logic (reuse, don't refetch from scratch) for whatever
   sports currently have live games.
2. For each live game, run `dramaScoreLive()` (with `applyQW1SituationBonus`)
   and measure wall-clock time immediately before/after with
   `performance.now()` (sub-millisecond resolution, more precise than
   `Date.now()` for this purpose) around the computation only — not
   around the data fetch.
3. Return the real per-call timings directly in the JSON response:
   `{ gameCount, timings: [...], min, max, avg, p50 }` — measured in
   milliseconds, computed from the actual timing array, not estimated.

This measures the function in isolation, uncontaminated by the rest of
the relay's traffic — a more precise approach than diffing aggregate
Worker-wide GraphQL stats, since this repo's normal traffic varies
request-to-request for unrelated reasons.

## VERIFICATION

- `node --check src/index.js` (or wherever the route gets wired) and
  the new file.
- Call the real, deployed route live, at least twice, at different
  times (ideally when different numbers of games are live) — report
  the actual returned numbers, not a single sample treated as
  definitive.
- Cross-check: does the measured per-call cost, multiplied by a
  realistic invocation estimate (once per live game per relay poll
  cycle — check the actual current polling cadence rather than assume
  it), fit comfortably within remaining CPU-ms headroom implied by the
  baseline above? Show the arithmetic, don't just assert a conclusion.

## DONE CONDITIONS
- [ ] Probe block confirms citations before porting
- [ ] `dramaScoreLive` + `applyQW1SituationBonus` ported verbatim, weather bonus explicitly and honestly excluded
- [ ] Test-only route added, not wired into any production path
- [ ] Real per-call timings measured via `performance.now()`, isolated from data-fetch time
- [ ] Called live at least twice, real numbers reported both times
- [ ] Cost arithmetic shown against the real baseline headroom, not just concluded
- [ ] Outbox written, explicitly noting this route should be removed or gated before any real migration decision ships

## CONFIDENCE SCORING TABLE
+25  Functions ported verbatim, weather-bonus exclusion honestly scoped and disclosed
+30  Timing isolated correctly around computation only, using performance.now()
+25  Real live measurement, called more than once, real numbers reported
+10  Cost arithmetic shown against real baseline, not asserted
+10  Outbox flags this as test-only, needing removal before any production decision

## ONE-LINER
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO -- this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-07-drama-score-cost-measurement.md.
Port dramaScoreLive() and applyQW1SituationBonus() verbatim from
jubilant-bassoon/index.html (weather bonus explicitly excluded, disclosed
honestly) into a new test-only route, GET /test/drama-score-cost, that
measures real per-call CPU cost via performance.now() around the
computation only, against real live game data. Call it live at least
twice and report the actual numbers. Show the cost arithmetic against
the real baseline (cpuTimeP50 984μs, 30M CPU-ms/month included) rather
than just concluding. This route is test-only and must be flagged for
removal before any real migration ships. Do not commit unless
confidence >= 95. If score < 95, report verbatim and stop.
