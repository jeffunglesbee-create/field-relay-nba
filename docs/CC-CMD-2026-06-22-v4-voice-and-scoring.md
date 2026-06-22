# Claude Code Command — v4 Voice + Quality Chain + Context Fix

git pull. Read CLAUDE.md. Run `git log --oneline -5` first.

Write all findings to outbox/cc-v4-complete-2026-06-22.md.

## WHAT

Three changes, one commit. Verify current state before writing any code:

```bash
grep -n 'FIELD_VOICE_REGISTER' src/journalism-quality.js src/index.js
grep -n 'runQualityChain' src/index.js | grep -v '//'
grep -n '_SPORT_NORMALIZE' src/context-assembler.js
```

If FIELD_VOICE_REGISTER already exists, skip Task 1. If runQualityChain
is already in a path, skip that path in Task 3. Verify before writing.

## TASK 1: Export v4 voice register

File: src/journalism-quality.js

Verify not already present, then add after FIELD_PROSE_STYLE (~line 475):

```javascript
export const FIELD_VOICE_REGISTER = <CONTENT>;
```

Get content:
```bash
git clone --depth 1 https://github.com/jeffunglesbee-create/jubilant-bassoon.git /tmp/jb
sed -n '23607,23709p' /tmp/jb/index.html
```

Copy the ENTIRE .join('\n') array verbatim. Do not edit.

## TASK 2: Prepend voice register to prose prompts

File: src/index.js

Import: add FIELD_VOICE_REGISTER to the import from journalism-quality.js (~line 43).

Prepend to (verify each path, skip if already present):

Path 1: Cron slate brief buildPrompt array (~line 5460)
Path 2: executeGameBriefBackfill gamePrompt array (~line 4394)
Path 3: /journalism/generate live endpoint prompt (~line 8260)
Path 4: WC game-brief enqueue prompt (~line 1564)
Path 5: NBA game-brief enqueue prompt (~line 2779)
Path 6: NHL game-brief enqueue prompt (~line 2868)

NOTE: The queue consumer at ~line 9904 processes job.prompt which
is built at enqueue time (paths 4-6). Prepend at the enqueue sites,
not inside the consumer.

## TASK 3: Wire runQualityChain into queue consumer

File: src/index.js, ~line 9904 (async queue handler)

Currently:
```javascript
const initial = await callProxy(job.prompt);
const cliches = jqHasCliche(initial);
if (cliches.length) { ... single retry ... }
let finalText = initial; // or retried
```

Replace with:
```javascript
const initial = await callProxy(job.prompt);
if (!initial) throw new Error('proxy returned no prose');
const qResult = await runQualityChain(job.prompt, initial, callProxy, {
    sport: job.sport || null, scoreThreshold: 90, maxRetries: 2,
});
const finalText = stripMarkdown(qResult.text);
```

Update the ARCHIVE_DB INSERT to record qResult.score in quality_score
(currently NULL at this path).

NOTE: /backfill/game-briefs already has runQualityChain from commit
931fd05. Do NOT modify that path.

## TASK 4: Fix context-assembler.js sport normalization

File: src/context-assembler.js

D1 labels vs registry: 'FIFA World Cup 2026' → needs 'wc26'.
Golf and WNBA have no builders (correct — no R2 data).

Inside assembleContext, after computing sport string, add:

```javascript
const _SPORT_NORMALIZE = {
    'fifa world cup 2026': 'wc26',
    'fifa world cup': 'wc26',
    'world cup': 'wc26',
};
const sport = (_SPORT_NORMALIZE[String(game.sport || '').toLowerCase()])
    || String(game.sport || '').toLowerCase();
```

Also add to /backfill/game-briefs prompt and enqueue prompts
(paths 4-6 above), after sport context:

```
SPORT BOUNDARY: This is a {sportLabel} game. Write ONLY {sportLabel}
content. Do not reference players, stats, or terminology from any
other sport. If context is empty, write from the score and date only.
```

## SCOPE

DO: verify first, export register, prepend to prompts, replace light cliché
check in queue consumer with runQualityChain, normalize sport labels,
add sport boundary guard

DO NOT: touch /backfill/game-briefs quality chain (done at 931fd05),
add R2 builders for golf/WNBA, modify runQualityChain internals, touch client

One commit: "feat: v4 voice register + queue consumer quality chain +
context sport normalization"
