# Claude Code Command — Port v4 Voice Register to Relay (1 of 3)

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-v4-register-port-2026-06-22.md.

## CONTEXT

FIELD_VOICE_EXEMPLARS (the v4 voice register: warm/wise/uplifting/
cheeky/wry palette + 4 exemplars + anti-exemplar + numbers-in-prose
grammar + wire-copy detection) lives ONLY in the client (index.html).
It's injected into 2 surfaces: J3 omnibus brief and compound prompt.

ALL other brief paths — relay cron slate briefs, per-game cron
briefs, /backfill/game-briefs, /journalism/generate live endpoint,
dead-hour backfill — use FIELD_PROSE_STYLE from journalism-quality.js
which has style RULES but not the voice REGISTER.

Result: per-game briefs sound like wire copy. The quality chain
catches clichés but can't inject warmth/personality because the
voice framing isn't in the prompt.

## TASK 1: Add FIELD_VOICE_EXEMPLARS to journalism-quality.js

File: src/journalism-quality.js

Add the complete v4 register as an exported const, AFTER the
existing FIELD_PROSE_STYLE export (~line 475). Copy the full
content from the client's const at jubilant-bassoon index.html
line 23607-23709. This is ~120 lines.

Name it: `export const FIELD_VOICE_REGISTER`

IMPORTANT: Copy the EXACT content from the client. Do NOT
paraphrase, summarize, or edit the exemplars. The exemplar
text IS the voice specification — changing a word changes
the voice. Read the client file first:

```bash
cd ~/jubilant-bassoon && git pull
sed -n '23607,23709p' index.html
```

Then create the export in journalism-quality.js:

```javascript
// ── v4 Voice Register (ported from client FIELD_VOICE_EXEMPLARS) ────────
// This is the COMPLETE voice specification. All brief generation paths
// must include this in their prompt. The register (warm/wise/uplifting/
// cheeky/wry) + exemplars + anti-exemplar + numbers-in-prose grammar
// collectively define what FIELD writing sounds like.
export const FIELD_VOICE_REGISTER = [
  // ... paste full content from client ...
].join('\n');
```

## TASK 2: Import and wire into all brief generation paths

File: src/index.js

Update the import at ~line 43:
```javascript
import {
  FIELD_PROSE_STYLE as JQ_STYLE,
  FIELD_VOICE_REGISTER,  // NEW
  ...
} from './journalism-quality.js';
```

Then inject FIELD_VOICE_REGISTER into every prompt that currently
uses only JQ_STYLE. There are 5 paths to update:

### Path 1: Cron slate brief (~line 5460)
Current: `JQ_STYLE,`
Change to: `FIELD_VOICE_REGISTER, JQ_STYLE,`
(Voice register BEFORE rules — model reads framing first)

### Path 2: Cron per-game brief (executeGameBriefBackfill, ~line 4394)
Current prompt array:
```javascript
const gamePrompt = [
  `Write a 50-70 word game brief...`,
  ...
  `Rules: Lead with the decisive moment...`,
].filter(Boolean).join('\n');
```
Add FIELD_VOICE_REGISTER as the FIRST element:
```javascript
const gamePrompt = [
  FIELD_VOICE_REGISTER,
  `Write a 50-70 word game brief...`,
  ...
```

### Path 3: /backfill/game-briefs handler (~line 7439)
Same pattern — add FIELD_VOICE_REGISTER as first element of prompt.

### Path 4: /journalism/generate live endpoint (~line 8260)
Find where the prompt is assembled for the live relay path.
Add FIELD_VOICE_REGISTER before JQ_STYLE.

### Path 5: Night Owl / game_recap cron paths
Find where night_owl and game_recap prompts are built
(~lines 2766 for NBA, ~2855 for NHL, ~1564 for WC).
Add FIELD_VOICE_REGISTER before each prompt.

For each path, the pattern is the same:
- FIELD_VOICE_REGISTER goes FIRST (sets framing)
- Then the task instruction ("Write a 50-70 word brief...")
- Then game data
- Then JQ_STYLE rules
- Then specific constraints

## TASK 3: Verify token budget

FIELD_VOICE_REGISTER is ~2000 tokens. The Gemini context window
is 1M tokens. Adding 2000 tokens to each prompt is negligible.
But verify that no prompt exceeds the max_tokens parameter
(currently 400-1000 depending on path). The register goes in
the PROMPT, not the response — it doesn't affect max_tokens.

Log the prompt length for each path in the outbox manifest.

## SCOPE BOUNDARY

DO:
- Export FIELD_VOICE_REGISTER from journalism-quality.js
- Import in index.js
- Add to all 5 brief generation prompt paths
- Copy exact content from client — do not edit

DO NOT:
- Modify FIELD_PROSE_STYLE
- Modify runQualityChain
- Remove JQ_STYLE from any prompt (register + rules, not register instead of rules)
- Touch the client repo
- Modify the quality scoring system

## INSTRUCTIONS

1. Relay repo (field-relay-nba). Also clone jubilant-bassoon for reference.
2. git pull both repos. Read CLAUDE.md.
3. Copy FIELD_VOICE_EXEMPLARS from client index.html lines 23607-23709.
4. Add as FIELD_VOICE_REGISTER export in journalism-quality.js.
5. Import in index.js.
6. Wire into all 5 prompt paths.
7. node --check src/journalism-quality.js && node --check src/index.js
8. Single commit: "feat: port v4 voice register to relay — all brief
   paths now use FIELD_VOICE_REGISTER + JQ_STYLE"
9. Deploy via wrangler deploy.
10. Verify: trigger /journalism/generate for one game and check AI
    Gateway log for voice register in prompt.
11. Write manifest to outbox.
