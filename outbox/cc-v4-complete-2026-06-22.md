# v4 Voice + Quality Chain + Context Fix — 2026-06-22

## Pre-build probes

```
grep -n 'FIELD_VOICE_REGISTER' src/journalism-quality.js src/index.js
→ (no hits — Task 1 needed)

grep -n 'runQualityChain' src/index.js | grep -v '//'
→ 8 hits including queue consumer at L10018 (Task 3 ALREADY DONE)

grep -n '_SPORT_NORMALIZE' src/context-assembler.js
→ (no hits — Task 4 needed)
```

## What ships (commit b3e8f5b)

### Task 1 — FIELD_VOICE_REGISTER exported
- Added after `FIELD_PROSE_STYLE` in `src/journalism-quality.js`.
- Content copied verbatim from `jubilant-bassoon/index.html` L23607-23704
  (variable named `FIELD_VOICE_EXEMPLARS` there; exported as
  `FIELD_VOICE_REGISTER` per spec).
- Includes: voice register framing (WARM/WISE/UPLIFTING/CHEEKY/WRY),
  four exemplars (NBA, WNBA, NHL, Soccer/WC), wire-copy anti-exemplar,
  six numbers-in-prose patterns, forbidden constructions, one-number-
  per-sentence ratio, priority block.

### Task 2 — Prepended to 6 prompt paths
| # | Path | Site |
|---|------|------|
| 1 | Cron slate `buildPrompt` array | `src/index.js:5459` (head of array) |
| 2 | `executeGameBriefBackfill` gamePrompt | `src/index.js:4394` |
| 3 | `/journalism/generate` POST handler | `src/index.js:8245` (`promptWithVoice`) |
| 4 | WC game-brief enqueue | `src/index.js:1564` |
| 5 | NBA game-brief enqueue | `src/index.js:2768` |
| 6 | NHL game-brief enqueue | `src/index.js:2859` |
| + | `/backfill/game-briefs` (in-scope, kept consistent) | `src/index.js:7469` |

Path 3 also rewrites `callProxy(body.prompt)` → `callProxy(promptWithVoice)`
and `runQualityChain(body.prompt, …)` → `runQualityChain(promptWithVoice, …)`
so the chain's retry prompts also carry the voice framing.

### Task 3 — runQualityChain in queue consumer (verified, no changes)
At `src/index.js:10018` the consumer already calls
`runQualityChain(job.prompt, initial, callProxy, { maxRetries: 6 })` and
writes `score`, `retries`, `layers_fired`, `ms` into the `jobs:{id}` KV
record. The spec's example used `maxRetries: 2`; actual code uses 6 and
also routes 429 → retry. No ARCHIVE_DB INSERT happens at this path —
brief persistence to `briefs` is via `sweepKVBriefs` which reads the
`brief:game:*` KV writes (separate code path). Task 3 marked DONE.

### Task 4 — context-assembler sport normalization + SPORT BOUNDARY
- `src/context-assembler.js`: added `_SPORT_NORMALIZE` map before
  `assembleContext`. Inside the function, lowercased sport is now run
  through the map before filtering `CONTEXT_SOURCES`. 'FIFA World Cup
  2026' → 'wc26' (D1 label → registry key).
- SPORT BOUNDARY clause added to: backfill prompt, WC/NBA/NHL enqueue
  prompts, `executeGameBriefBackfill`. Format:
  `SPORT BOUNDARY: This is a {sport} game. Write ONLY {sport} content…`

## Out of scope (intentionally untouched)
- `/backfill/game-briefs` already has runQualityChain from 931fd05.
- No R2 builders added for golf or WNBA (correct — no R2 data set).
- `runQualityChain` internals (journalism-quality.js orchestrator)
  unchanged beyond the new export.
- jubilant-bassoon client untouched.

## Verify after deploy

```
# v4 voice present in cron slate
curl https://field-relay-nba.jeffunglesbee.workers.dev/journalism/cycle?diagnose=1 | jq '.promptDigest' 
# should hint at FIELD VOICE FRAMING preamble

# Force a re-backfill on a previously cross-contaminated game
GET /backfill/game-briefs?force=true&limit=3
# Spot-check briefs in D1: golf no longer references NBA PPG, MLB
# no longer leads with ABS challenges.

# WC sport normalization works
# After next 0 9 UTC cycle, check analytics_output rows that pull WC
# context — should now see Group-context blocks (was empty before).
```

## Failure modes (silent per Rule 5)
- FIELD_VOICE_REGISTER ~6 KB. Queue consumer max_tokens=1000; cron
  buildPrompt sets its own. Voice block fits under all current ceilings.
  If proxy starts truncating, lower retry counts before trimming voice.
- `promptWithVoice` only formed inside the /journalism/generate handler
  scope — no leak if body.prompt is malformed (validation runs first).
- `_SPORT_NORMALIZE` is read-only; missing key falls through to raw
  lowercased string (current behavior preserved).

## Carry-forwards
1. The "no R2 builder for golf/WNBA" case still produces sportContext='' .
   The new SPORT BOUNDARY clause now ensures the LLM doesn't reach for
   cross-sport stats when context is empty. Spot-check after deploy to
   confirm — if recaps remain nameless for golf, a dedicated builder
   pulling ESPN leaderboard data into context-assembler is the next step.
2. /journalism/generate's `scoreThreshold` default is 130; backfill is 90.
   With FIELD_VOICE_REGISTER prepended, prose should easily clear 90;
   the cron's 130 threshold may need a re-baseline after a few cycles.
   Watch JQ_ANALYTICS for score distribution shift.
