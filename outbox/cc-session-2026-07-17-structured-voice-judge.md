# CC Session 2026-07-17 — Structured Voice Judge

## Date
2026-07-17

## Repo
field-relay-nba

## HEAD Progression
- Before: fe36d0f — docs: move cc-cmd to docs/ with date prefix [skip ci]
- After:  ce4885b — feat: Layer 3b targeted retry using structured judge SENTENCE/FIX output

## Commits
1. `acd11f5` — feat: structured SENTENCE/FIX output format for voice judge prompt
2. `042a297` — fix: remove hasCliche gate from runQualityChain Layer 2
3. `ce4885b` — feat: Layer 3b targeted retry using structured judge SENTENCE/FIX output

## What Was Done

Executed `docs/CC-CMD-2026-07-17-structured-voice-judge.md` in full.

### Change 1: `_buildVoiceJudgePrompt` structured output
Changed response format from single-line `FAIL: <reason>` to three-line structured:
```
FAIL
SENTENCE: <verbatim failing sentence from draft>
FIX: <one concrete rewrite instruction>
```

### Change 2: Remove hasCliche gate
Removed the Layer 2 cliché gate block from `runQualityChain`. The `hasCliche()` and
`countSparingly()` exports are preserved — both are injected into `FIELD_VOICE_REGISTER`
as prompt context (lines 542-543) and imported by `index.js` as `jqHasCliche`. Only
the runQualityChain gate call was removed.

Rationale: the structured judge (Layer 3b) catches phrase violations with higher
precision — it identifies the exact violating sentence and provides a concrete fix
rather than triggering on substring matches alone.

### Change 3: Layer 3b targeted retry
When the judge returns structured `FAIL\nSENTENCE: ...\nFIX: ...`, the retry prompt
now quotes the exact failing sentence and a specific fix instruction. Graceful
degradation: unstructured `FAIL` responses fall back to the existing generic note.

## Verification
- `node --check src/journalism-quality.js` → SYNTAX OK (verified 3 times, once per change)
- Inline assertion: SENTENCE/FIX fields present, hasCliche exported, runQualityChain exported → ALL ASSERTIONS PASS

## Integration Status
STAGED — changes are relay-only. The judge prompt format change affects what the
proxy model sees; structured output parsing is self-contained within journalism-quality.js.
No client-side changes required (Layer 3b operates entirely in the relay quality chain).

## Open Items
- Haiku 4.5 "clinical efficiency" / "surgical efficiency" phrases: still worth adding to
  BANNED_PHRASES. The structured judge mandate handles them via FIX instruction, but an
  explicit BANNED_PHRASES entry prevents them from reaching the judge in the first place.
  (Separate session — see jubilant-bassoon CC-CMD-2026-07-17-remove-vestigial-scoring.md)

## Confidence: 95/100
All three changes implemented, syntax verified, exports confirmed. The judge response
parsing is regex-based against a format the judge is now explicitly mandated to produce.
