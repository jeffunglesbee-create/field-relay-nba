# Claude Code Command — Backfill Brief Quality Fix

git pull. Read CLAUDE.md. Read src/context-assembler.js.

Write all findings to outbox/cc-backfill-brief-quality-2026-06-22.md.

## CONTEXT

The /backfill/game-briefs endpoint generates recaps for completed
games but produces low-quality briefs because:

1. assembleContext receives empty abbreviations (homeAbbr:'',
   awayAbbr:'') so all R2 lookups fail silently → only ABS data
   (which matches by team display name) comes through.

2. The prompt only has score + ABS stats. The model fixates on
   "Automated Ball-Strike challenge system" because it's the only
   structured data available.

3. Golf briefs are vague ("the winner finishing at four-under")
   because there's no player/leaderboard context.

4. WC/soccer briefs are generic ("controlled the tempo") because
   there's no scorer/minute/attendance data.

5. WNBA/NBA briefs lack player names entirely.

The fix: fetch ESPN game summary data for each completed game
and inject it into the backfill prompt. ESPN summary provides
box score, player leaders, scoring plays, and key stats — exactly
what a recap needs.

## TASK 1: Add fetchESPNRecapContext helper

File: src/index.js (near the /backfill/game-briefs endpoint)

```javascript
// Fetch ESPN game summary for a completed game and return
// a structured context block for the recap prompt.
async function fetchESPNRecapContext(game) {
    // Map sport to ESPN endpoint
    const SPORT_MAP = {
        'MLB':    { sport: 'baseball',   league: 'mlb' },
        'WNBA':   { sport: 'basketball', league: 'wnba' },
        'NBA':    { sport: 'basketball', league: 'nba' },
        'NHL':    { sport: 'hockey',     league: 'nhl' },
        'FIFA World Cup 2026': { sport: 'soccer', league: 'fifa.world' },
        'MLS':    { sport: 'soccer',     league: 'usa.1' },
        'EPL':    { sport: 'soccer',     league: 'eng.1' },
    };

    const mapped = SPORT_MAP[game.sport];
    if (!mapped) return '';

    // Derive ESPN game ID from our game_id if possible,
    // or search by date + teams via scoreboard
    let espnGameId = null;

    // Try scoreboard search for the date
    try {
        const dateStr = game.date.replace(/-/g, '');
        const sbUrl = `https://site.api.espn.com/apis/site/v2/sports/${mapped.sport}/${mapped.league}/scoreboard?dates=${dateStr}`;
        const sbResp = await fetch(sbUrl, {
            headers: { 'User-Agent': 'FIELD-Relay/1.0' },
            signal: AbortSignal.timeout(5000),
        });
        if (!sbResp.ok) return '';
        const sb = await sbResp.json();

        // Match by team names
        const homeLower = String(game.home).toLowerCase();
        const awayLower = String(game.away).toLowerCase();
        for (const ev of (sb.events || [])) {
            const comps = ev.competitions?.[0]?.competitors || [];
            const names = comps.map(c =>
                (c.team?.displayName || c.team?.name || '').toLowerCase()
            );
            if (names.some(n => n.includes(homeLower) || homeLower.includes(n)) &&
                names.some(n => n.includes(awayLower) || awayLower.includes(n))) {
                espnGameId = ev.id;
                break;
            }
        }
    } catch (_) {}

    if (!espnGameId) return '';

    // Fetch summary
    try {
        const sumUrl = `https://site.web.api.espn.com/apis/site/v2/sports/${mapped.sport}/${mapped.league}/summary?event=${espnGameId}`;
        const sumResp = await fetch(sumUrl, {
            headers: { 'User-Agent': 'FIELD-Relay/1.0' },
            signal: AbortSignal.timeout(5000),
        });
        if (!sumResp.ok) return '';
        const sum = await sumResp.json();

        const ctx = [];

        // Extract leaders
        const leaders = sum.boxscore?.players || [];
        for (const team of leaders) {
            const teamName = team.team?.displayName || '';
            const stats = team.statistics || [];
            for (const statGroup of stats.slice(0, 2)) {
                const leaders = (statGroup.leaders || []).slice(0, 2);
                for (const leader of leaders) {
                    const athlete = leader.athlete?.displayName;
                    const value = leader.displayValue;
                    const label = statGroup.name || statGroup.label || '';
                    if (athlete && value) {
                        ctx.push(`${teamName} ${label}: ${athlete} ${value}`);
                    }
                }
            }
        }

        // Extract key events / scoring plays
        const keyEvents = sum.keyEvents || [];
        for (const ke of keyEvents.slice(0, 5)) {
            const text = ke.text || ke.shortText || '';
            if (text) ctx.push(`Key: ${text}`);
        }

        // Extract headline if available
        const headline = sum.header?.competitions?.[0]?.status?.type?.shortDetail;
        if (headline) ctx.push(`Result: ${headline}`);

        // Extract article headline if available
        const article = sum.news?.articles?.[0];
        if (article?.headline) ctx.push(`Headline: ${article.headline}`);

        // For soccer: extract scorers
        if (mapped.sport === 'soccer') {
            const scoringPlays = sum.scoringPlays || [];
            for (const sp of scoringPlays) {
                const scorer = sp.text || sp.shortText || '';
                const minute = sp.clock?.displayValue || '';
                if (scorer) ctx.push(`Goal ${minute}: ${scorer}`);
            }
        }

        // For MLB: extract pitching decisions
        if (mapped.sport === 'baseball') {
            const decisions = sum.boxscore?.players || [];
            // Look for WP/LP in the pitching stats
            for (const team of decisions) {
                const pitching = (team.statistics || [])
                    .find(s => s.name === 'pitching' || s.label === 'Pitching');
                if (pitching?.leaders) {
                    for (const p of pitching.leaders.slice(0, 2)) {
                        const name = p.athlete?.displayName;
                        const val = p.displayValue;
                        if (name && val) ctx.push(`Pitching: ${name} ${val}`);
                    }
                }
            }
        }

        if (!ctx.length) return '';
        return '\n[ESPN RECAP DATA]\n' + ctx.join('\n') + '\n';

    } catch (_) { return ''; }
}
```

## TASK 2: Fix abbreviation resolution in backfill

In the /backfill/game-briefs endpoint, when calling assembleContext,
resolve abbreviations from team display names:

Replace:
```javascript
sportContext = await assembleContext(env, {
    sport: game.sport, home: game.home, away: game.away,
    homeAbbr: '', awayAbbr: '',
}, 600);
```

With:
```javascript
const { resolveAbbr } = await import('./context-assembler.js');
sportContext = await assembleContext(env, {
    sport: game.sport, home: game.home, away: game.away,
    homeAbbr: resolveAbbr(game.home),
    awayAbbr: resolveAbbr(game.away),
}, 600);
```

NOTE: resolveAbbr is already exported from context-assembler.js.
Check the exports at the bottom of the file. If not exported, add:
  export { assembleContext, resolveAbbr };

## TASK 3: Inject ESPN recap context into the backfill prompt

In the /backfill/game-briefs endpoint, after assembleContext,
also fetch ESPN recap data:

```javascript
let espnContext = '';
try {
    espnContext = await fetchESPNRecapContext(game);
} catch (_) {}
```

Then update the prompt to use BOTH context sources:

```javascript
const prompt = `Write a 2-3 sentence recap of this completed game.
${game.away} ${game.away_score}, ${game.home} ${game.home_score} (${game.sport}, ${game.date})
${game.importance ? `Game importance: ${game.importance}` : ''}
${espnContext}
${sportContext ? `\n[SPORT CONTEXT]\n${sportContext}` : ''}
${seriesContext}

RULES:
- Lead with the decisive player performance or key moment, citing specific stats.
- Name the winning pitcher (MLB), top scorer (soccer/basketball), or series hero (playoffs).
- NEVER mention the Automated Ball-Strike system or ABS challenges. These are irrelevant to recaps.
- For soccer: mention goalscorers and minutes. For a 0-0 draw, mention the best chance or save.
- For golf: name the winner/leader and their score relative to par.
- For basketball: name the leading scorer and their point total.
- For baseball: name the winning pitcher or the key offensive performer.
- Write factually. No clichés ("controlled the tempo", "decisive win"). Be specific.`;
```

## TASK 4: Re-backfill all 59 existing game_brief rows

After deploying, the existing 59 backfilled briefs are low quality.
Delete them and regenerate:

```javascript
// Add a ?reset=true param to /backfill/game-briefs
if (url.searchParams.get('reset') === 'true') {
    await env.ARCHIVE_DB.prepare(
        `DELETE FROM briefs WHERE brief_type = 'game_brief' AND source = 'backfill'`
    ).run();
    // Then fall through to the normal backfill logic
}
```

## SCOPE BOUNDARY

DO:
- Add fetchESPNRecapContext helper
- Fix abbreviation resolution in backfill
- Inject ESPN context into backfill prompt
- Add explicit "NEVER mention ABS" rule to prompt
- Add sport-specific leader/scorer instructions
- Add ?reset=true param to delete+regenerate
- Export resolveAbbr from context-assembler.js if needed

DO NOT:
- Modify assembleContext internals
- Change the live journalism cron prompt
- Modify any other endpoints
- Touch the client repo

## INSTRUCTIONS

1. git pull. Read CLAUDE.md.
2. Read src/context-assembler.js — check if resolveAbbr is exported.
3. Add fetchESPNRecapContext function.
4. Fix abbreviation passing in backfill endpoint.
5. Inject ESPN context + improve prompt with sport-specific rules.
6. Add ?reset=true capability.
7. node --check src/index.js.
8. Single commit: "fix: backfill brief quality — ESPN recap context +
   abbreviation fix + sport-specific prompt rules"
9. Deploy via wrangler deploy.
10. After deploy:
    curl /backfill/game-briefs?reset=true&limit=50
    curl /backfill/game-briefs?limit=50
    (two calls to cover all ~59 games)
11. Verify sample briefs name specific players/stats.
12. Write manifest to outbox.
