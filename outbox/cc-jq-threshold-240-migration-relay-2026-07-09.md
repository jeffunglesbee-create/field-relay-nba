# JQ Threshold 130→240 Migration — field-relay-nba Portion (TASK 1 only) — 2026-07-09

## Scope

Per `docs/CC-CMD-2026-07-09-jq-threshold-240-migration.md`'s own dispatch
split, this session executed **TASK 1 only** — the relay's own
`/journalism/generate` fallback. TASKS 2-4 are jubilant-bassoon-scoped
(client shared helper, four hardcoded call sites, live before/after
verification) and are out of scope for a field-relay-nba session by the
CC-CMD's own design — not deferred, not partially attempted, genuinely
a different repo's work.

## Probe Block

```
grep -n "scoreFloor.*130\|scoreThreshold.*130" src/index.js
-> 11226: const scoreFloor = body.scoreThreshold || 130;
```
Confirmed exact match to the CC-CMD's citation before editing.

## TASK 1 — Relay Fallback Raised

`body.scoreThreshold || 130` → `body.scoreThreshold || 240`, with a
comment explaining why (240/300 = 80%, the real standard since the
2026-06-24 session; 130 was a pre-300-point-scale fossil never
revisited).

**Also fixed, directly adjacent, not scope creep:** the RUWT-compliance
comment three lines above this fallback literally said `"score < 130"
check` — this would have become factually wrong the instant the value
changed, so it was updated to say `"score < threshold"` instead of
re-hardcoding a different stale number in its place.

## Real Finding, Explicitly Out of Scope for TASK 1 — Flagged, Not Fixed

The same call site (line 11319, a few lines below the edited fallback)
passes `maxRetries: 6` explicitly into `runQualityChain`'s opts:

```js
const result = await runQualityChain(promptWithVoice, initial, callProxy, {
  sport,
  scoreThreshold: scoreFloor,
  maxRetries: 6,
  ...
```

`runQualityChain`'s own default (`opts.maxRetries || 7`, fixed
2026-07-08 for the exact retry-budget starvation bug this call site
now silently reintroduces) only applies when a caller doesn't pass a
value at all. Since this caller passes `6` explicitly, `6 || 7`
evaluates to `6` — **this specific route still has the starvation bug
yesterday's CC-CMD fixed everywhere else.** Not touched here: TASK 1's
scope is the threshold value only, and this is a different bug in a
different field, not "required by its direct dependencies." Flagged
here so it isn't lost — worth its own CC-CMD.

## Verification

`node --check src/index.js` — clean. `git diff` reviewed — exactly the
threshold line, its explanatory comment, and the one directly-adjacent
stale comment; nothing else touched. No live test required by TASK 1's
own DONE CONDITIONS (live verification in this CC-CMD is entirely
TASK 4, jubilant-bassoon-scoped).

## Confidence (TASK 1's own scope, not the full cross-repo table)

The CC-CMD's confidence table spans all four tasks across two repos;
only `+15 — relay fallback correct, comment added` is executable from
this repo. Scoring that portion: fallback value correct, comment
accurate and specific (not generic), no unrelated changes beyond the
one adjacent comment that would otherwise have gone stale, syntax
verified. High confidence in TASK 1 specifically.

**TASK 1: done. TASKS 2-4 remain for a jubilant-bassoon session
(dispatch instructions already in the CC-CMD's own ONE-LINER).**

## Commit

- (this commit) — TASK 1 + this outbox
