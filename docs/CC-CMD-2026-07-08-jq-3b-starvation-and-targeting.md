# CC-CMD: Fix Layer 3b starvation + make 3b's retry dimension-targeted

**Date:** 2026-07-08
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

## CONTEXT

Two related, precisely-scoped fixes to `src/journalism-quality.js`'s
`runQualityChain`, found via direct code reading this session, not
inferred:

**Fix 1 — retry-budget starvation.** `runQualityChain` has 7 possible
retry layers (`2`, `2b`, `2c`, `2d`, `2d-score`, `2e`, `3b`), each firing
at most once, all sharing one `retries` counter gated by
`opts.maxRetries || 6`. In the worst case (a brief trips all six
structural layers 2 through 2e), `retries` reaches 6 before layer 3b —
the actual holistic score-threshold rewrite — ever runs, because its own
gate (`retries < maxRetries`) is already false. The layer that targets
the metric everything else is trying to protect (the final `scoreProse`
total) is the one layer that can get silently skipped, and only in
exactly the cases — many structural defects at once — that need it most.
Fix: `opts.maxRetries || 6` → `opts.maxRetries || 7`. Seven is not a
buffer, it is the exact count of layers that exist; this guarantees 3b's
gate is always true in every possible combination, without changing
behavior for any brief that doesn't hit the worst case.

**Fix 2 — 3b's retry prompt is generic, not targeted.** `scoreProse`
computes 10 dimension sub-scores internally (specificity, statDepth,
variety, density, freshness, arcScore, dim7/context-anchoring,
temporalScore, voiceScore, dim10/matchup-depth) and discards all of them
into a single `total`. Layer 3b's retry prompt is currently one fixed
block of text regardless of *which* dimension actually caused the low
score — meaning a brief weak specifically in Narrative Arc gets told to
"add more statistics," which doesn't address a structural narrative gap
and could make an already-stat-heavy brief worse. Fix: expose the
per-dimension breakdown, normalize each against its own ceiling (not
raw point values — Density's ceiling of 16 and Arc's ceiling of 45 are
not comparable un-normalized), identify the one or two weakest, and
build 3b's retry prompt around them specifically — following the exact
same "name the specific violation, give a specific correction" pattern
layers 2 through 2e already use in this same file. Do not invent new
prompt-writing style; extend the established one.

**Explicitly not in scope, state this in the outbox:** this does not
guarantee 3b's retry *succeeds* — its own gate (`newScore >= score`)
still only accepts non-regressions, and a genuinely thin brief could
still land under threshold after one aimed shot. It also does not add a
loop-back to re-verify layers 2 through 2e after 3b runs — a 3b rewrite
that reintroduces a cliché would not be caught. Both are real,
deliberate boundaries, not oversights — naming them is required, not
optional.

## PROBE BLOCK

```bash
git log --oneline -5

grep -n "opts.maxRetries || 6" src/journalism-quality.js
sed -n '/export async function runQualityChain/,/^}/p' src/journalism-quality.js
# Re-confirm current implementation exactly — this doc's citations may
# already be stale.

grep -n "scoreProse(" src/*.js
# Enumerate EVERY caller of scoreProse, not just runQualityChain's own
# internal calls — the optional breakdown flag must be strictly additive
# (plain-number return unchanged when the flag is absent/false) for
# every single one of these, confirmed by reading each call site, not
# assumed from the two calls inside runQualityChain alone.

grep -n "const W = " -A2 src/journalism-quality.js
# Confirm the exact weight constants (spec:30, statDepth:38, variety:30,
# density:16, fresh:36) before writing normalization logic — re-verify
# rather than trust this doc's numbers.

grep -n "runQualityChain(" src/index.js
# Re-confirm all 10 call sites and their scoreThreshold values (240
# default; 90 at GET /backfill/brief-scores; scoreFloor variable at
# /journalism/generate; job.scoreThreshold || 240 at one queue-consumer
# branch) — the targeted-prompt logic must work correctly regardless of
# which threshold a given call site passes, confirm this holds for each.

grep -rn "scoreProse\|runQualityChain" ../jubilant-bassoon/index.html 2>/dev/null || echo "not present client-side, or path unavailable -- confirm via separate check if needed"
# Cross-repo check (Rule 89): confirm this scoring logic has no
# client-side duplicate that would also need updating.
```

## TASK 1 — Fix the starvation bug

Change `opts.maxRetries || 6` to `opts.maxRetries || 7` in
`runQualityChain`. One line. Do not touch any call site's explicit
`scoreThreshold` values — this is orthogonal to threshold, it's about
retry-budget ceiling only.

## TASK 2 — Add the optional breakdown to scoreProse

Add `opts.breakdown` (default `false`) to `scoreProse`'s signature.
When true, return `{ total, dims }` where `dims` is every dimension's
**normalized 0-1 fraction of its own ceiling** — not raw points. For
dims 1-5 (specificity, statDepth, variety, density, freshness), the
existing pre-weight fraction variables are *already* 0-1 normalized —
use them directly, do not re-derive. For dims 6-10 (arcScore, dim7,
temporalScore, voiceScore, dim10), which are computed as raw point
values against their own ceiling (45, 25, 20, 30, 30 respectively),
divide by that ceiling to normalize. Get every ceiling value from the
probe-confirmed source, not from this doc's paraphrase of them. When
`opts.breakdown` is false or absent, return exactly what the function
returns today — a plain number, zero shape change. This must hold for
every caller enumerated in the probe block, not just the ones inside
this same file.

## TASK 3 — Make 3b's retry prompt dimension-targeted

In the 3b block, call `scoreProse(text, { ..., breakdown: true })`
instead of the plain call. Identify the one or two lowest-normalized
dimensions. Build the retry prompt's correction language around
specifically those, following the existing pattern this file already
uses elsewhere (name the concrete problem, give a concrete fix — see
layers 2/2b/2c/2d/2d-score/2e for the established style, don't invent a
new tone). At minimum, cover:
- Low Narrative Arc: name specifically whether stakes, tension, or
  resolution is missing (they're independently checkable, don't just
  say "arc is weak" — say which of the three failed)
- Low Voice Consistency: point at the sport-vocabulary mismatch
  specifically, don't duplicate layer 2b's separate mechanism
- Low Matchup Depth: name that the provided editorial context
  (matchupNote) isn't being used, quote a fragment of it if available

Extend the same specific-diagnosis pattern to the remaining dimensions
(specificity, statDepth, variety, density, freshness, context-anchoring,
temporal precision) using their existing scoring logic as the basis for
what "weak" means in each case — do not write generic filler text for
any of them.

## TASK 4 — Live verification, both fixes, with real constructed evidence

**For Task 1:** construct a real test string that trips all six
structural layers (a cliché, wrong-sport vocabulary, a generic "The
[Team]..." lead, a stat present in the prompt but missing from the
draft, a contradicting score, and a cross-league claim) and run it
through the actual patched `runQualityChain`. Confirm `layers_fired`
contains `2, 2b, 2c, 2d, 2d-score, 2e, 3b` — all seven — proving 3b
genuinely fired, not just that the code compiles.

**For Task 2/3:** construct two different real test texts — one
deliberately weak in Narrative Arc but strong elsewhere, one
deliberately weak in Voice Consistency but strong elsewhere. Run each
through the patched chain and confirm the two resulting 3b retry
prompts are genuinely different from each other and each correctly
names the dimension that was actually weak in that specific text — not
that they merely differ syntactically, that they target the right
thing. This is the actual proof the aiming works, not that a prompt got
generated.

**For backward compatibility:** call `scoreProse` without the
breakdown flag on a real sample text before and after the change,
confirm the returned number is byte-identical.

## DONE CONDITIONS

- [x] `maxRetries` default is 7, confirmed via diff
- [x] All seven layers confirmed firing in one real constructed test
      case (not four, not six — all seven)
- [x] `scoreProse`'s plain-number return confirmed unchanged for every
      caller enumerated in the probe, not just the ones in this file
- [x] Two real, different weak-dimension test cases produce two
      genuinely different, correctly-targeted 3b prompts
- [x] Outbox explicitly states both known limitations (3b can still
      land under threshold; no loop-back re-check after 3b) rather than
      implying this eliminates degraded output

## CONFIDENCE SCORING

- +15 — maxRetries fix correct and minimal, no unrelated changes
- +20 — breakdown flag additive-only, verified byte-identical for
  existing callers
- +30 — dimension-targeting correctly implemented and proven via two
  genuinely different real test cases, not asserted from code reading
- +20 — all-seven-layers-fire test constructed and passing
- +15 — outbox honestly states both known limitations

**Do not commit unless confidence >= 95. If score < 95, report verbatim
and stop.**

## ONE-LINER

```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-08-jq-3b-starvation-and-targeting.md. Execute all tasks. Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```
