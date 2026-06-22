# Claude Code Command — Backfill Prompt Quality Fix

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-backfill-prompt-quality-2026-06-22.md.

## CONTEXT

The /backfill/game-briefs endpoint generates per-game recaps but
the prompt is thin — it only has score + assembleContext (which
returns ABS challenge stats for MLB, nothing useful for other sports).
Result: every MLB recap leads with "Automated Ball-Strike challenge
system" stats. Golf recaps are nameless. WC recaps are generic.

The LIVE journalism pipeline (handleJournalismCycle) uses a rich
prompt with:
- FIELD_PROSE_STYLE (JQ_STYLE) — banned phrases, specificity rules
- runQualityChain — 6-layer quality gate with retry
- buildFinalsContextBlock — postseason series context
- buildWCTeamContextBlock — WC team narratives from D1
- sportContextBlock — per-game R2 stats from assembleContext
- enrichmentBlock — narrative_context + standings from D1
- voiceExemplarBlock — high-quality examples from past briefs

The backfill endpoint has NONE of these. It needs them.

## TASK 1: Import quality chain and style into backfill

File: src/index.js

Find the /backfill/game-briefs handler. The current prompt at
~line 7439 is:

```
Write a 2-3 sentence recap of this completed game.
${game.away} ${game.away_score}, ${game.home} ${game.home_score} (${game.sport}, ${game.date})
...
Write factually. No cliches. Lead with the decisive moment or standout performance.
```

Replace the prompt construction AND post-processing with the same
quality pipeline used by the live cron (executeGameBriefBackfill,
~line 4394). That function already:
1. Builds a rich prompt with sport context + series context
2. Runs runQualityChain with 3 retries
3. Strips markdown
4. Records quality_score

The simplest fix: have /backfill/game-briefs CALL
executeGameBriefBackfill(env, date) for each date that has gaps,
instead of reimplementing the prompt inline.

BUT — executeGameBriefBackfill processes max 3 games per call
and only handles one date. The backfill endpoint needs to handle
multiple dates and higher throughput.

So instead: COPY the prompt pattern from executeGameBriefBackfill
into the backfill handler, keeping the multi-date + limit features.

Replace the prompt block in /backfill/game-briefs with:

```javascript
// Build prompt matching the live pipeline quality
const sportLabel = game.sport || 'unknown';
const isPostseason = !!(game.series_key || game.importance);

// Series context from D1
let seriesContext = '';
if (game.series_key) {
    try {
        const series = await env.ARCHIVE_DB.prepare(
            `SELECT * FROM postseason_series WHERE series_key = ? LIMIT 1`
        ).bind(game.series_key).first();
        if (series) {
            // Count series wins
            const hW = (await env.ARCHIVE_DB.prepare(
                `SELECT COUNT(*) AS n FROM postseason_games
                 WHERE series_key = ? AND home_score > away_score AND home_score IS NOT NULL`
            ).bind(game.series_key).first().catch(() => null))?.n || 0;
            const aW = (await env.ARCHIVE_DB.prepare(
                `SELECT COUNT(*) AS n FROM postseason_games
                 WHERE series_key = ? AND away_score > home_score AND away_score IS NOT NULL`
            ).bind(game.series_key).first().catch(() => null))?.n || 0;
            seriesContext = `\nSeries record: ${hW}-${aW}`;
            if (series.narrative) seriesContext += `\nContext: ${series.narrative}`;
        }
    } catch (_) {}
}

// Sport context from R2 (Savant, NHL, NBA clutch, FBref)
let sportContext = '';
try {
    sportContext = await assembleContext(env, {
        sport: sportLabel, home: game.home, away: game.away,
        homeAbbr: '', awayAbbr: '',
    }, 600);
} catch (_) {}

// Build prompt with quality rules (matches live pipeline)
const gamePrompt = [
    `Write a 50-70 word game brief for this ${sportLabel}${isPostseason ? ' playoff' : ''} game.`,
    `${game.away} ${game.away_score} at ${game.home} ${game.home_score}`,
    `Date: ${game.date}`,
    isPostseason ? `Round: ${game.importance || 'postseason'}${seriesContext}` : '',
    sportContext || '',
    `Rules: Lead with the decisive moment or stat. No clichés. One paragraph, no headers.`,
    JQ_STYLE,
].filter(Boolean).join('\n');

const prose = await callProxy(gamePrompt);
if (!prose || prose.length < 30) {
    results.push({ id: game.id, ok: false, reason: 'empty response' });
    continue;
}

// Quality chain — same as live pipeline
const qResult = await runQualityChain(gamePrompt, prose, callProxy, {
    sport: sportLabel, scoreThreshold: 90, maxRetries: 2,
});
const finalText = stripMarkdown(qResult.text);
```

Update the INSERT to include quality_score:

```javascript
await env.ARCHIVE_DB.prepare(
    `INSERT INTO briefs
       (id, date, brief_type, sport, game_id, brief_text, model, quality_score, word_count, source)
     VALUES (?, ?, 'game_brief', ?, ?, ?, 'gemini-3.1-flash-lite', ?, ?, 'backfill')
     ON CONFLICT(id) DO NOTHING`
).bind(
    `game_brief_${game.sport}_${game.id}_${game.date}`,
    game.date,
    game.sport || null,
    String(game.id),
    finalText,
    qResult.score,
    finalText.split(/\s+/).length
).run();
```

## TASK 2: Verify JQ_STYLE and runQualityChain are accessible

JQ_STYLE is imported at line 43:
```javascript
import { FIELD_PROSE_STYLE as JQ_STYLE, ... } from './journalism-quality.js';
```

runQualityChain is imported similarly. Both are module-level.
Verify they are accessible inside the /backfill/game-briefs handler.
If not (e.g. the handler is in a different scope), add the import.

## TASK 3: Delete and re-backfill existing low-quality briefs

After deploying the fix, the existing 59 backfill rows need to be
replaced. Add a ?force=true query param that deletes existing
game_brief rows with source='backfill' before re-generating:

```javascript
const force = url.searchParams.get('force') === 'true';
// After allMissing is assembled, if force=true, also include
// games that DO have a brief but it was source='backfill'
if (force) {
    // Delete existing backfill briefs for matched games
    for (const game of allMissing) {
        await env.ARCHIVE_DB.prepare(
            `DELETE FROM briefs WHERE game_id = ? AND brief_type = 'game_brief' AND source = 'backfill'`
        ).bind(game.id).run().catch(() => {});
    }
}
```

Actually simpler: change the NOT EXISTS subquery when force=true
to also find games where the only game_brief is source='backfill':

```javascript
const existsClause = force
    ? `AND NOT EXISTS (
        SELECT 1 FROM briefs b
        WHERE b.game_id = g.id AND b.brief_type = 'game_brief' AND b.source != 'backfill'
    )`
    : `AND NOT EXISTS (
        SELECT 1 FROM briefs b
        WHERE b.game_id = g.id AND b.brief_type = 'game_brief'
    )`;
```

And before inserting, delete any existing backfill row:
```javascript
if (force) {
    await env.ARCHIVE_DB.prepare(
        `DELETE FROM briefs WHERE game_id = ? AND brief_type = 'game_brief' AND source = 'backfill'`
    ).bind(String(game.id)).run().catch(() => {});
}
```

## SCOPE BOUNDARY

DO:
- Replace thin backfill prompt with live-pipeline quality prompt
- Add JQ_STYLE to the prompt
- Add runQualityChain to post-processing
- Add ?force=true to re-generate existing backfill briefs
- Record quality_score in D1

DO NOT:
- Modify the live cron pipeline
- Modify executeGameBriefBackfill
- Change assembleContext or journalism-quality.js
- Touch the client repo
- Add new data sources

## INSTRUCTIONS

1. Relay repo only (field-relay-nba).
2. git pull. Read CLAUDE.md.
3. Update /backfill/game-briefs prompt + quality chain (Task 1).
4. Verify imports accessible (Task 2).
5. Add ?force=true support (Task 3).
6. node --check src/index.js.
7. Single commit: "fix: backfill prompt quality — JQ_STYLE + quality
   chain + force mode for re-generation"
8. Deploy via wrangler deploy.
9. After deploy, re-generate all existing briefs:
   curl /backfill/game-briefs?force=true&limit=50
   (repeat until done)
10. Spot-check 3 briefs — verify no ABS fixation, no nameless recaps.
11. Write manifest to outbox.
