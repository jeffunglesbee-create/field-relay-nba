# CC-CMD: Structured Voice Judge + Targeted Retry

**Repo:** field-relay-nba  
**File:** `src/journalism-quality.js`  
**Branch:** main (commit directly per CLAUDE.md)  
**Dependency:** none — self-contained relay change

## Problem

Two overlapping detection systems doing the same job:

1. `BANNED_PHRASES` (Layer 2) — finite string list, fires retry with the
   original prompt unchanged. Model guesses what to fix. Misses paraphrases —
   proven: "clinical efficiency" and "surgical efficiency" passed both
   `BANNED_PHRASES` and `RELAY_BANNED` in the 2026-07-17 eval session.

2. Layer 3b voice judge — semantic, reads `FIELD_VOICE_REGISTER`, already
   generalizes beyond enumerated phrases. Currently returns
   `FAIL: <one sentence>` → retry fires with original prompt again. Still
   guessing.

Fix: one detection system, one structured failure, one targeted repair.
No duplication. No guessing.

## Probe Block (run before writing any code)

```bash
# Confirm HEAD
git log --oneline -5

# Exact lines for all functions and constants being changed
grep -n "function _buildVoiceJudgePrompt\|function runQualityChain\|hasCliche\|BANNED_PHRASES\|SPARINGLY_PHRASES\|Layer 2\|3b\|judgeVerdict\|PASS\|FAIL" \
  src/journalism-quality.js | head -60

# Confirm whether BANNED_PHRASES / SPARINGLY_PHRASES are used outside jq.js
grep -rn "BANNED_PHRASES\|SPARINGLY_PHRASES\|hasCliche" src/

# Find where JQ_STYLE / FIELD_PROSE_STYLE are built — they may inject the
# phrase lists into prompts; those injections must NOT be removed
grep -n "JQ_STYLE\|FIELD_PROSE_STYLE\|BANNED_PHRASES\|SPARINGLY_PHRASES" src/index.js | head -20

# Confirm current judge verdict parse logic
grep -n "judgeVerdict\|PASS\|FAIL\|reverdict\|3b" src/journalism-quality.js | head -20
```

## Changes

### 1. `_buildVoiceJudgePrompt` (verify exact line from probe)

Change the verdict format from:

```
PASS
FAIL: <one concise sentence naming the biggest issue>
```

To structured output:

```
PASS
```

or:

```
FAIL
SENTENCE: <exact quoted sentence from the draft that violates FIELD voice>
FIX: <one instruction referencing the FIELD_VOICE_REGISTER pattern by name,
      e.g. "restructure as Pattern 2 (possessive compound): write the stat
      as the subject's attribute, not the predicate — 'Aho's 80-point
      season is why Carolina is here' not 'Aho leads Carolina with 80 points'">
```

Update the prompt instruction block in `_buildVoiceJudgePrompt` to request
this format. The judge must:

- Quote the single worst-offending sentence verbatim from the draft
- Name the `FIELD_VOICE_REGISTER` pattern that repairs it (Pattern 1–6,
  wire-copy verb, anti-exemplar class, club-context convention, etc.)
- Give one concrete rewrite example showing the corrected form

### 2. `runQualityChain` — Layer 3b retry logic (verify exact line from probe)

Currently: on FAIL, retry fires with `promptText` unchanged.

Change: parse the structured FAIL output and build a targeted retry prompt.

Parse logic:

```js
const failMatch = judgeVerdict.match(/^FAIL\s*\nSENTENCE:\s*(.+?)\s*\nFIX:\s*(.+)/s);
if (failMatch) {
  const parsedSentence = failMatch[1].trim();
  const parsedFix     = failMatch[2].trim();
  const targetedRetry = [
    promptText,
    '',
    '── VOICE CORRECTION ──',
    'The following sentence in your draft violates FIELD voice register:',
    `"${parsedSentence}"`,
    '',
    `Fix: ${parsedFix}`,
    '',
    'Rewrite the full brief with this correction applied.',
    'All other sentences may remain unchanged.',
  ].join('\n');
  // call callProxy(targetedRetry) instead of callProxy(promptText)
} else {
  // Judge returned old format or unparseable — fall back to promptText.
  // Graceful degradation, not a hard failure.
}
```

### 3. Remove `hasCliche()` gate from `runQualityChain`

After confirming from the probe that `BANNED_PHRASES` and `SPARINGLY_PHRASES`
are still used as prompt injections elsewhere (via `JQ_STYLE` /
`FIELD_PROSE_STYLE`), do **not** delete the exported arrays — only remove
the `hasCliche()` call from `runQualityChain`'s retry loop. The arrays stay
as prompt injection data; the judge now handles post-generation detection.

If `hasCliche()` has no other callers after this change: delete the function.  
If it has other callers: leave the function body, remove only the gate call.

## Scope Boundary — Do Not Touch

- Layer 2b (`checkSportVocab`) — keep
- Layer 2c (`checkLeadSentence`) — keep
- Layer 2d (`checkStatVerification`) — keep
- Layer 2e (`hasCrossSportHallucination`) — keep
- Layer 2f (`hasWireCopy`) — keep
- Layer 2g (`hasNarrativeHallucination`) — keep
- Layer 2h (`hasRecordAttributionError`) — keep
- `scoreProse()` — keep
- `BANNED_PHRASES` / `SPARINGLY_PHRASES` exports — keep (prompt injection data)
- `src/index.js` — do not touch
- jubilant-bassoon — not in scope (see companion CC-CMD)

## Commits

One concern per commit, each independently revertable:

1. `feat: structured voice judge output (SENTENCE + FIX fields)`
2. `feat: targeted retry from judge structured output`
3. `fix: remove hasCliche gate from runQualityChain`

## Done Condition

```bash
node --check src/journalism-quality.js
# → SYNTAX OK

node --input-type=module <<'EOF'
import { _buildVoiceJudgePrompt } from './src/journalism-quality.js';

const prompt = _buildVoiceJudgePrompt(
  'Aho leads Carolina with 80 points this season and the Hurricanes enter Game 1.'
);
console.assert(prompt.includes('SENTENCE:'), 'judge prompt must request SENTENCE field');
console.assert(prompt.includes('FIX:'),      'judge prompt must request FIX field');
console.log('Judge prompt format: OK');
EOF
```

## Outbox Manifest (last task)

Write `outbox/cc-session-{date}-structured-voice-judge.md` containing:

- HEAD before and after
- Diff of `_buildVoiceJudgePrompt` (old format vs new format, quoted verbatim)
- Diff of `runQualityChain` retry logic (original prompt vs `targetedRetry`)
- Confirmation that `hasCliche` gate is removed and `BANNED_PHRASES` export intact
- Note: jubilant-bassoon Dim 6/9 cleanup is a follow-on CC-CMD, dependent on this merge
