# Claude Code Command — Odds Story Materializer

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-odds-story-materializer-2026-06-22.md.

## CONTEXT

FIELD now captures both opening odds (snapshotCronOdds) and closing
odds (Game State Transition Hook). The Identity Resolver matches
them to the correct games. But the journalism prompt receives
raw JSON odds blobs — the LLM has to compute line movement itself.

"NYY opened -150, closed -180" requires the LLM to:
1. Parse two JSON objects
2. Extract the moneyline.home field from each
3. Compute the difference (-30)
4. Decide if that's significant
5. Generate the narrative

This is unreliable. The LLM sometimes ignores odds data, sometimes
miscalculates, sometimes invents movement that didn't happen.

The Odds Story Materializer pre-computes structured line movement
narratives at game-start time and stores them in D1. The Context
Assembler reads them and injects a clean one-liner like:

```
[ODDS STORY] NYY line moved 30 pts favorite-ward since open
(opened -150, closed -180). Total dropped 1.5 (opened 8.5,
closed 7.0) — under pressure.
```

The LLM turns this into prose. No computation required.

## ADR-002 STATUS: CLEAN

This is factual data transformation (numbers → structured text).
No drama scoring, no interest calculation. Same as ABS grades
or clutch stats — pure facts delivered to the LLM.

## PRE-BUILD PROBE

```bash
# 1. Check opening_odds shape in D1
# SELECT id, substr(opening_odds, 1, 200) FROM regular_season_games
#   WHERE opening_odds IS NOT NULL LIMIT 3

# 2. Check closing_odds shape (if any exist yet)
# SELECT id, substr(closing_odds, 1, 200) FROM regular_season_games
#   WHERE closing_odds IS NOT NULL LIMIT 3

# 3. Check if the Context Assembler's source registry exists
grep -n "CONTEXT_SOURCES" src/context-assembler.js

# 4. Check the assembleContext function signature
grep -n "async function assembleContext" src/context-assembler.js
```

## TASK 1: Create line movement computation

In `src/odds-story.js` (new file):

```javascript
// Compute structured line movement between opening and closing odds.
// Returns a human-readable string or '' if insufficient data.

export function computeOddsStory(openingOdds, closingOdds) {
    if (!openingOdds || !closingOdds) return '';

    const open = typeof openingOdds === 'string'
        ? JSON.parse(openingOdds) : openingOdds;
    const close = typeof closingOdds === 'string'
        ? JSON.parse(closingOdds) : closingOdds;

    const parts = [];

    // Moneyline movement
    const oML = open.moneyline;
    const cML = close.moneyline;
    if (oML?.home != null && cML?.home != null) {
        const diff = cML.home - oML.home;
        if (Math.abs(diff) >= 10) {
            // Determine direction: more negative = more favored
            const direction = diff < 0 ? 'favorite-ward' : 'underdog-ward';
            parts.push(
                `ML moved ${Math.abs(diff)} pts ${direction}` +
                ` (opened ${oML.home > 0 ? '+' : ''}${oML.home},` +
                ` closed ${cML.home > 0 ? '+' : ''}${cML.home})`
            );
        }
    }

    // Spread movement
    const oSP = open.spread;
    const cSP = close.spread;
    if (oSP?.home != null && cSP?.home != null) {
        const diff = cSP.home - oSP.home;
        if (Math.abs(diff) >= 0.5) {
            const direction = diff < 0 ? 'toward home' : 'toward away';
            parts.push(
                `Spread moved ${Math.abs(diff).toFixed(1)} ${direction}` +
                ` (opened ${oSP.home > 0 ? '+' : ''}${oSP.home},` +
                ` closed ${cSP.home > 0 ? '+' : ''}${cSP.home})`
            );
        }
    }

    // Total movement
    const oTO = open.total;
    const cTO = close.total;
    if (oTO?.over != null && cTO?.over != null) {
        const diff = cTO.over - oTO.over;
        if (Math.abs(diff) >= 0.5) {
            const direction = diff > 0 ? 'over pressure' : 'under pressure';
            parts.push(
                `Total moved ${Math.abs(diff).toFixed(1)}` +
                ` (opened ${oTO.over}, closed ${cTO.over})` +
                ` — ${direction}`
            );
        }
    }

    if (!parts.length) return '';

    // Only surface stories with SIGNIFICANT movement
    // (at least one part means something moved past the threshold)
    return '[ODDS STORY] ' + parts.join('. ') + '.';
}
```

## TASK 2: Register as Context Assembler source

In `src/context-assembler.js`, add a new builder and register it:

```javascript
import { computeOddsStory } from './odds-story.js';

async function buildOddsStoryContext(env, game) {
    if (!env?.ARCHIVE_DB) return '';
    const { resolveTeamKey } = await import('./identity-resolver.js');
    const home = game.home || '';
    const away = game.away || '';

    // Find the game in D1 by team names + today's date
    const today = new Date().toISOString().slice(0, 10);
    for (const table of ['regular_season_games', 'postseason_games']) {
        try {
            const rows = await env.ARCHIVE_DB.prepare(
                `SELECT opening_odds, closing_odds FROM ${table}
                 WHERE date = ? AND opening_odds IS NOT NULL`
            ).bind(today).all();

            const homeKey = resolveTeamKey(home);
            const awayKey = resolveTeamKey(away);

            for (const row of (rows.results || [])) {
                // Match by resolved team key in the game id
                // (archive ids contain normalized team names)
                const story = computeOddsStory(row.opening_odds, row.closing_odds);
                if (story) return story;
            }
        } catch (_) {}
    }
    return '';
}
```

Register in CONTEXT_SOURCES with priority 5 (before sport stats):

```javascript
{ id: 'odds_story', priority: 5, budget: 100,
  builder: buildOddsStoryContext,
  sports: ['mlb', 'nba', 'nhl', 'nfl', 'wnba', 'epl', 'mls',
           'wc26', 'laliga', 'seriea', 'bundesliga', 'ligue1'] },
```

## TASK 3: Add probe endpoint

Add `GET /odds-story/preview?date=YYYY-MM-DD` that computes the
odds story for all games on a date without storing anything:

```javascript
// For each game with both opening_odds and closing_odds:
// 1. computeOddsStory(opening, closing)
// 2. Return the results

// Response shape:
{
    "date": "2026-06-21",
    "games": [
        {
            "id": "mlb_2026-06-21_nyy_det",
            "home": "Tigers",
            "away": "Yankees",
            "story": "[ODDS STORY] ML moved 25 pts favorite-ward...",
            "hasOpening": true,
            "hasClosing": true
        },
        {
            "id": "mlb_2026-06-21_kc_tb",
            "home": "Rays",
            "away": "Royals",
            "story": "",  // no significant movement
            "hasOpening": true,
            "hasClosing": false  // game hasn't started yet
        }
    ],
    "withStory": 3,
    "withoutStory": 12,
    "missingClosing": 8
}
```

## IMPORTANT: RUWT COMPLIANCE

The Odds Story is factual data about PUBLISHED odds. It describes
what happened to publicly available betting lines. This is NOT a
composite interest level score (banned by RUWT patent US 9,421,446
B2). It's a factual statement: "the line moved X points." Same
category as reporting a stock price change.

No named binary conditions are created. No "SHARP MONEY" or
"LINE ALERT" flags. Just the numbers and direction.

## SCOPE BOUNDARY

DO:
- Create src/odds-story.js (computation)
- Register buildOddsStoryContext in Context Assembler
- Add /odds-story/preview probe endpoint
- Test with computeOddsStory unit probes

DO NOT:
- Modify the journalism prompt rules or voice
- Touch BracketDO or WC projections
- Modify the odds fetch pipeline
- Create any named binary conditions (RUWT)
- Add drama scoring or interest calculations

## INSTRUCTIONS

1. Relay repo only (field-relay-nba).
2. Pre-build probes — check if any closing_odds exist in D1.
3. node --check all files.
4. Single commit: "feat: odds story materializer — pre-computed
   line movement narratives for journalism context"
5. Deploy via wrangler deploy.
6. After deploy, hit /odds-story/preview?date=2026-06-21.
7. Write manifest to outbox.

NOTE: Closing odds may be sparse right now (the Game State
Transition Hook just shipped). The materializer will produce
stories as closing odds accumulate. The probe endpoint shows
which games have both opening + closing vs which are still
waiting.
