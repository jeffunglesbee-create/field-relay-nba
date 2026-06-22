# Claude Code Command — Historical Brief Backfill

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-brief-backfill-historical-2026-06-22.md.

## CONTEXT

Zero game_brief rows exist in D1 for any date. The game_brief
backfill gate was broken (fixed in a separate prompt). This prompt
adds a one-time on-demand endpoint to backfill ALL completed games
that lack a game_brief row.

Current gap (verified June 22):
  regular_season_games: 34 completed (Jun 19-21), 0 game_briefs
  postseason_games: 22 completed (May 20 – Jun 15), 0 game_briefs
  Total: ~56 games needing briefs

The existing executeGameBriefBackfill processes max 3 per tick.
At dead-hour cadence that's ~5 hours. This endpoint processes
all gaps in one call with rate-limiting pauses between AI calls.

## TASK 1: GET /backfill/game-briefs endpoint

File: src/index.js

Add a new endpoint that:
1. Queries both game tables for completed games (home_score IS NOT NULL)
2. Cross-references against briefs table for existing game_brief rows
3. Generates briefs for missing games via the existing proxy + quality chain
4. Rate-limits to 1 game per 2 seconds (Gemini quota safe)
5. Returns progress as it works (or a summary after completion)

Place near other /backfill or /archive endpoints.

```javascript
// GET /backfill/game-briefs?limit=10&date=2026-06-21
// One-time historical backfill for per-game briefs.
// Processes completed games that lack a game_brief row in D1.
// Optional ?date= filters to a single date. Default: all dates.
// Optional ?limit= caps games per call (default 10, max 50).
if (pathname === '/backfill/game-briefs' && request.method === 'GET') {
    if (!env.ARCHIVE_DB) {
        return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
            { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    const dateFilter = url.searchParams.get('date') || null;
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 50);
    const dryRun = url.searchParams.get('dry') === 'true';

    try {
        await ensureBriefsTable(env);

        // 1. Find completed games missing game_brief
        const dateClause = dateFilter ? 'AND g.date = ?' : '';
        const regParams = dateFilter ? [dateFilter] : [];
        const regMissing = await env.ARCHIVE_DB.prepare(`
            SELECT g.id, g.date, g.sport, g.home, g.away,
                   g.home_score, g.away_score, g.closing_odds,
                   NULL as series_key, NULL as importance
            FROM regular_season_games g
            WHERE g.home_score IS NOT NULL ${dateClause}
              AND NOT EXISTS (
                  SELECT 1 FROM briefs b
                  WHERE b.game_id = g.id AND b.brief_type = 'game_brief'
              )
            ORDER BY g.date DESC
            LIMIT ?
        `).bind(...regParams, limit).all();

        const postMissing = await env.ARCHIVE_DB.prepare(`
            SELECT g.id, g.date, g.sport, g.home, g.away,
                   g.home_score, g.away_score, g.closing_odds,
                   g.series_key, g.importance
            FROM postseason_games g
            WHERE g.home_score IS NOT NULL ${dateClause}
              AND NOT EXISTS (
                  SELECT 1 FROM briefs b
                  WHERE b.game_id = g.id AND b.brief_type = 'game_brief'
              )
            ORDER BY g.date DESC
            LIMIT ?
        `).bind(...regParams, limit).all();

        const allMissing = [
            ...(regMissing.results || []),
            ...(postMissing.results || []),
        ].slice(0, limit);

        if (dryRun) {
            return new Response(JSON.stringify({
                ok: true, dry_run: true,
                missing: allMissing.length,
                games: allMissing.map(g => ({
                    id: g.id, date: g.date, sport: g.sport,
                    matchup: `${g.away} @ ${g.home}`,
                    score: `${g.away_score}-${g.home_score}`,
                })),
            }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
        }

        // 2. Generate briefs
        const results = [];
        for (const game of allMissing) {
            try {
                // Build context
                let sportContext = '';
                try {
                    sportContext = await assembleContext(env, {
                        sport: game.sport, home: game.home, away: game.away,
                        homeAbbr: '', awayAbbr: '',
                    }, 600);
                } catch (_) {}

                let seriesContext = '';
                if (game.series_key) {
                    try {
                        const series = await env.ARCHIVE_DB.prepare(
                            `SELECT * FROM postseason_series WHERE series_key = ? LIMIT 1`
                        ).bind(game.series_key).first();
                        if (series) {
                            seriesContext = `\nSeries: ${series.series_key}`;
                            if (series.narrative) seriesContext += ` — ${series.narrative}`;
                        }
                    } catch (_) {}
                }

                const prompt = `Write a 2-3 sentence recap of this completed game.
${game.away} ${game.away_score}, ${game.home} ${game.home_score} (${game.sport}, ${game.date})
${game.importance ? `Game importance: ${game.importance}` : ''}
${sportContext ? `\n[SPORT CONTEXT]\n${sportContext}` : ''}
${seriesContext}
Write factually. No cliches. Lead with the decisive moment or standout performance.`;

                const prose = await callProxy(prompt);
                if (!prose || prose.length < 30) {
                    results.push({ id: game.id, ok: false, reason: 'empty response' });
                    continue;
                }

                const finalText = stripMarkdown(prose);
                await env.ARCHIVE_DB.prepare(
                    `INSERT INTO briefs
                       (id, date, brief_type, sport, game_id, brief_text, model, quality_score, word_count, source)
                     VALUES (?, ?, 'game_brief', ?, ?, ?, 'gemini-3.1-flash-lite', NULL, ?, 'backfill')
                     ON CONFLICT(id) DO NOTHING`
                ).bind(
                    `game_brief_${game.sport}_${game.id}_${game.date}`,
                    game.date,
                    game.sport || null,
                    String(game.id),
                    finalText,
                    finalText.split(/\s+/).length
                ).run();

                results.push({ id: game.id, ok: true, words: finalText.split(/\s+/).length });

                // Rate limit — 2s between AI calls
                await new Promise(r => setTimeout(r, 2000));

            } catch (e) {
                results.push({ id: game.id, ok: false, reason: e.message });
            }
        }

        const succeeded = results.filter(r => r.ok).length;
        const failed = results.filter(r => !r.ok).length;

        return new Response(JSON.stringify({
            ok: true,
            processed: results.length,
            succeeded, failed,
            results,
        }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
}
```

IMPORTANT: The `callProxy` and `stripMarkdown` and `assembleContext`
functions already exist in the relay codebase. Do NOT redefine them.
Use the existing implementations.

## TASK 2: Add to probe allow-list

Find the ALLOWED_PREFIX array (~line 9217) and add '/backfill'
if not already present.

## SCOPE BOUNDARY

DO:
- Create GET /backfill/game-briefs endpoint
- Support ?date=, ?limit=, ?dry=true query params
- Use existing callProxy, stripMarkdown, assembleContext
- Add /backfill to allow-list
- ON CONFLICT DO NOTHING (never overwrite existing briefs)

DO NOT:
- Modify existing backfill functions
- Change the dead-hour backfill logic
- Touch the client repo
- Auto-trigger the backfill from cron (it's on-demand only)

## INSTRUCTIONS

1. Relay repo only (field-relay-nba).
2. git pull. Read CLAUDE.md.
3. Add /backfill/game-briefs endpoint.
4. Add /backfill to ALLOWED_PREFIX if needed.
5. node --check src/index.js.
6. Single commit: "feat: on-demand game brief backfill endpoint —
   /backfill/game-briefs generates briefs for archive gaps"
7. Deploy via wrangler deploy.
8. After deploy, dry-run first:
   curl /backfill/game-briefs?dry=true
   Verify it lists the ~56 missing games.
9. Then run a small batch:
   curl /backfill/game-briefs?limit=5
   Verify 5 game_brief rows appear in D1.
10. Write manifest to outbox.

POST-DEPLOY (for Jeff, not CC):
  Run in batches to backfill all gaps:
    curl /backfill/game-briefs?limit=20
    (repeat until dry-run returns 0 missing)
  Budget: ~56 games × 1 Gemini call each ≈ $0.05 total.
