# Layer 2d-score — Score Contradiction Check — 2026-06-24

## What Layer 2d does vs what 2d-score adds

- **Layer 2d** (existing): catches **omissions** — stats present in the
  prompt that the LLM dropped from the prose. Fires when the prompt says
  "Argentina won 3-1" and the brief never mentions the score.
- **Layer 2d-score** (new): catches **contradictions** — scores that appear
  in the prose but conflict with the known result. Fires when the brief
  opens with "Colombia's 1-0 win" (correct) but later writes "2-3 result"
  (fabricated).

Two distinct failure modes, two distinct checks.

## Root-cause case study

Colombia 1-0 Congo DR brief (2026-06-24) scored 258/300 and shipped to
production. Opening line contained the correct "1-0" so Layer 2d passed.
Mid-brief stat fabrication ("2-3 result") slipped through every other
layer. The brief's headline number was right; a downstream sentence
invented a contradictory score and the quality chain had no detector
for it.

2d-score would have caught the "2-3" → forced a retry with `SCORE
CONTRADICTION` injected into the prompt → either fixed the brief or
preserved the original if the retry didn't improve things.

## Where it fires

Inserted between `// 2d: stat verification` (ends ~L649) and
`// 2e: cross-sport hallucination` (~L692). Position is intentional:
runs immediately after the omission check, before the cross-sport sweep.
Subject to the same `retries < maxRetries` budget as the other layers.

## Validation logic

```
valid = { "{hs}-{as}", "{as}-{hs}", "{hs}–{as}", "{as}–{hs}" }
match = /\b(\d{1,2})[–-](\d{1,2})\b/g
contradiction = found_score ∉ valid && reversed_score ∉ valid
```

- Both **hyphen** and **en-dash** forms accepted in both directions.
- Reversal check (`split('-').reverse().join('-')`) handles writers using
  "1-0" / "0-1" interchangeably.
- Regex captures 1-2 digit scores (covers all real game scores; an arbitrary
  "97-92" basketball score also slots in).
- `as_` (not `as`) used since `as` is reserved in JavaScript.

## Activation requirements

`opts.game.homeScore` AND `opts.game.awayScore` must both be defined. That
means the check fires for the call sites that pass game context:
- WC queue consumer (`game-brief` handler, since the bracket-impact wiring CC-CMD)
- /journalism/generate when the client sends `game` (post the relay-side JQ
  game-context fix)
- `/backfill/game-briefs`
- `executeGameBriefBackfill`
- Slate cron (`gameMeta` carries scores)
- Series preview (after the JQ game-context fix)

For paths that don't pass game (no scores available), the block is a no-op
and the chain proceeds to 2e — never throws, never blocks.

## Commit & deploy

- `7236e4d` fix: Layer 2d-score — score contradiction check in
  runQualityChain (1 file, +37)
- Deploy: workflow 28074686416 — completed/success.

## Done conditions

- [x] `2d-score` block present between `2d` and `2e` in `runQualityChain`
- [x] `layers_fired.push('2d-score')` present
- [x] PROOF comment present after the block (Colombia 1-0 Congo DR case)
- [x] `node --check src/journalism-quality.js` passes
- [x] Deploy green (28074686416)
- [x] Outbox manifest committed

## grep output

```
$ grep "2d-score" src/journalism-quality.js
651:  // 2d-score: score contradiction — verifies no score in the text contradicts
653:  // 2d fires when a stat from the prompt is absent; 2d-score fires when a
678:        text = retried.trim(); retries++; layers_fired.push('2d-score');
```

**3 matches**, not the spec's stated 2. Spec's example block itself contains
"2d-score" on two comment lines (header L651 + body description L653) plus
the `layers_fired.push` line (L678). Implementation matches the spec example
verbatim — spec's done-condition count was miscalculated. All three are the
expected occurrences.

## Why `as_` not `as`

`as` is a reserved word in ES Module syntax (`import { x as y }`). Using it
as a `const`/`let` binding inside a regular function isn't a parse error in
modern V8 but is a reserved keyword in strict mode and was risky for older
runtimes. `as_` is safer and grep-able.

## Verify

Next brief written through any of the listed call sites that contradicts
the known score will:
1. Trigger Layer 2d-score
2. Append `SCORE CONTRADICTION:` block to the retry prompt
3. Push `2d-score` into `layers_fired`
4. Either accept the corrected retry (if newScore ≥ score) or keep the
   original — same retry-acceptance rule as Layer 3b.

To verify live, watch the AI Gateway log for `SCORE CONTRADICTION` injections
on the next 24 hours of cron + queue runs.
