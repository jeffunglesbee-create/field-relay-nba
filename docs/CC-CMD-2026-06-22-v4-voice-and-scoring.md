# Claude Code Command — v4 Voice + Quality Chain + Context Fix

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-v4-complete-2026-06-22.md.

## WHAT

Three changes, one commit:
1. Export v4 voice register from journalism-quality.js, prepend to all prose prompts
2. Wire runQualityChain into prose paths that skip it
3. Fix assembleContext sport-label matching so non-MLB sports don't get empty context

## TASK 1: Voice register export

File: src/journalism-quality.js

After the FIELD_PROSE_STYLE export, add:

```javascript
export const FIELD_VOICE_REGISTER = <CONTENT>;
```

Get the content by reading jubilant-bassoon:
```bash
git clone --depth 1 https://github.com/jeffunglesbee-create/jubilant-bassoon.git /tmp/jb
sed -n '23607,23709p' /tmp/jb/index.html
```

Copy the ENTIRE array. Do not edit. Join with '\n'.

## TASK 2: Wire voice register into all prose prompts

File: src/index.js

Import: `import { FIELD_VOICE_REGISTER, ... } from './journalism-quality.js';`

Prepend FIELD_VOICE_REGISTER to these prompt paths:
1. Cron slate brief (~line 5460, buildPrompt)
2. Per-game backfill (executeGameBriefBackfill, ~line 4394)
3. /backfill/game-briefs handler (~line 7439)
4. /journalism/generate live endpoint (~line 8260)
5. Night Owl NBA recap (~line 2766)
6. Night Owl NHL recap (~line 2855)
7. WC post-match recap (~line 1564)

## TASK 3: Wire runQualityChain into paths that skip it

Paths 5-7 and path 3 currently go straight from callProxy to INSERT.
Add runQualityChain between them:

```javascript
const initial = await callProxy(prompt);
if (!initial || initial.length < 30) { continue; }
const qResult = await runQualityChain(prompt, initial, callProxy, {
    sport: sportLabel, scoreThreshold: 90, maxRetries: 2,
});
const prose = stripMarkdown(qResult.text);
const qualityScore = qResult.score;
// INSERT with qualityScore
```

## TASK 4: Fix assembleContext sport-label matching

File: src/context-assembler.js

The sports filter does case-insensitive matching, but D1 stores:
- `MLB` (matches `mlb` ✓)
- `golf` (matches nothing — no builder exists)
- `WNBA` (matches nothing — no builder exists)
- `FIFA World Cup 2026` (matches nothing — registry has `wc26` not this string)

Two fixes:

### 4a: Normalize the sport label in assembleContext

At the top of assembleContext, add normalization:

```javascript
const _SPORT_NORMALIZE = {
    'fifa world cup 2026': 'wc26',
    'fifa world cup': 'wc26',
    'world cup': 'wc26',
    'wnba': 'wnba',
    'golf': 'golf',
    'pga': 'golf',
};
// Inside assembleContext:
let sport = String(game.sport || '').toLowerCase();
sport = _SPORT_NORMALIZE[sport] || sport;
```

### 4b: Add WNBA and WC to soccer_fbref sports list

The soccer_fbref builder already handles WC via the league-to-file
mapping (`'fifa world cup': 'wc2026.json'`). Just add `'wc26'` to
the soccer_fbref sports array and add the normalized alias:

```javascript
// In CONTEXT_SOURCES:
{ id: 'soccer_fbref', ...,
  sports: ['epl','mls','ucl','wc26','laliga','seriea','bundesliga','ligue1','soccer','fifa world cup 2026'] },
```

Actually simpler: the normalization in 4a handles this — `FIFA World Cup 2026` → `wc26` → matches existing `wc26` in sports list.

### 4c: Golf and WNBA get no context (no builder yet)

This is correct. There's no R2 data for golf or WNBA. Don't add
empty builders — they'd return '' anyway. The prompt should handle
missing context gracefully (which it will with the voice register).

BUT: add a sport-boundary instruction to the backfill prompt so
the LLM doesn't hallucinate cross-sport stats when context is empty:

In the backfill handler, after the sport context line, add:
```javascript
`CRITICAL: This is a ${sportLabel} game. Write ONLY about ${sportLabel}. Do not reference players, stats, or terminology from any other sport.`,
```

## SCOPE

One commit: "feat: v4 voice register + quality chain + context sport normalization"

DO: export, import, prepend, wire quality chain, normalize sport labels, add cross-sport guard
DO NOT: add new R2 builders, modify existing builder logic, touch client repo
