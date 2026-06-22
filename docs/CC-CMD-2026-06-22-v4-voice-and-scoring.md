# Claude Code Command — v4 Voice Register + Quality Scoring

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-v4-voice-scoring-2026-06-22.md.

## WHAT

Two changes, one commit:
1. Export FIELD_VOICE_REGISTER from journalism-quality.js
2. Prepend it to every prompt that generates prose

## TASK 1: Add the export

File: src/journalism-quality.js

After the FIELD_PROSE_STYLE export (~line 475), add:

```javascript
export const FIELD_VOICE_REGISTER = <CONTENT>;
```

To get the content, read jubilant-bassoon (clone if needed):
```bash
git clone --depth 1 https://github.com/jeffunglesbee-create/jubilant-bassoon.git /tmp/jb
sed -n '23607,23709p' /tmp/jb/index.html
```

Copy the ENTIRE array content. Do not edit, summarize, or
paraphrase. The exemplar text IS the voice specification.
Join with '\n' like the client does.

## TASK 2: Import and wire

File: src/index.js

Add to the import (~line 43):
```javascript
import { FIELD_PROSE_STYLE as JQ_STYLE, FIELD_VOICE_REGISTER, ... }
```

Then find every prompt that generates user-facing prose and prepend
FIELD_VOICE_REGISTER as the first element. There are 6 paths:

1. Cron slate brief prompt (~line 5460, buildPrompt array)
2. Per-game dead-hour backfill (executeGameBriefBackfill, ~line 4394, gamePrompt array)
3. /backfill/game-briefs handler (~line 7439, prompt string)
4. /journalism/generate live endpoint (~line 8260)
5. Night Owl NBA recap (~line 2766)
6. Night Owl NHL recap (~line 2855)
7. WC post-match recap (~line 1564)

For each: add `FIELD_VOICE_REGISTER,` or `FIELD_VOICE_REGISTER + '\n' +` as the first line of the prompt. Keep JQ_STYLE where it already is.

## TASK 3: Wire runQualityChain into paths that skip it

Paths 5-7 above (Night Owl NBA/NHL, WC recap) currently do:
```javascript
const prose = await callProxy(prompt);
// ... straight to INSERT
```

Change to:
```javascript
const initial = await callProxy(prompt);
if (!initial || initial.length < 30) { ... skip ... }
const qResult = await runQualityChain(prompt, initial, callProxy, {
    sport: sportLabel, scoreThreshold: 90, maxRetries: 2,
});
const prose = stripMarkdown(qResult.text);
const qualityScore = qResult.score;
// ... INSERT with qualityScore
```

Also update the backfill handler (path 3) the same way.

## TASK 4: Verify

```bash
node --check src/journalism-quality.js
node --check src/index.js
wrangler deploy
# After deploy:
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/health
# Trigger one brief generation and check AI Gateway for voice register in prompt
```

## SCOPE

DO: export const, import, prepend to prompts, wire quality chain
DO NOT: modify FIELD_PROSE_STYLE, modify runQualityChain internals, touch client repo, add new endpoints

One commit: "feat: v4 voice register + quality chain on all prose paths"
