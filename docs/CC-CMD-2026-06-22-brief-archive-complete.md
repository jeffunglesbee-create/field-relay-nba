# Claude Code Command — Brief Archive: Fix + Historical Backfill

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-brief-archive-complete-2026-06-22.md.

## CONTEXT

Two pipeline gaps + one data gap in the brief archive:

1. KV sweep (brief:game:* → D1) only runs dead hours. Per-game
   briefs written to KV during live hours with 1h TTL can expire
   before capture. Fix: sweep every cron tick.

2. game_brief backfill only fires when briefResult.skipped (slate
   already existed). For recent dates where the slate was just
   generated live, skipped is never true. Fix: widen the gate.

3. Zero game_brief rows exist in D1 for any date. ~56 completed
   games (34 regular season Jun 19-21, 22 postseason May 20 –
   Jun 15) have no per-game brief. Fix: on-demand backfill endpoint.

## TASK 1: Extract sweepKVBriefs function

File: src/index.js

Extract the inline KV sweep (~lines 4797-4847, inside the
dead-hours block) into a standalone async function. Place it
near the other brief utility functions.

```javascript
async function sweepKVBriefs(env) {
    if (!env.FIELD_JOURNALISM || !env.ARCHIVE_DB) return null;
    await ensureBriefsTable(env);
    const listed = await env.FIELD_JOURNALISM.list({ prefix: 'brief:game:', limit: 50 });
    let swept = 0;
    for (const key of (listed.keys || [])) {
        const kvVal = await env.FIELD_JOURNALISM.get(key.name).catch(() => null);
        if (!kvVal) continue;
        let briefText = kvVal;
        let qualityScore = null;
        if (kvVal[0] === '{') {
            try {
                const p = JSON.parse(kvVal);
                briefText = p.brief || p.brief_text || p.text || kvVal;
                qualityScore = p.quality_score || p.score || null;
            } catch(_) {}
        }
        if (!briefText || briefText.length < 50) continue;
        const parts = key.name.replace('brief:game:', '').split(':');
        const gameId = parts.length >= 2 ? parts[parts.length - 1] : parts[0];
        const sport  = parts.length >= 2 ? parts[0] : null;
        if (!sport) {
            const existing = await env.ARCHIVE_DB.prepare(
                `SELECT 1 FROM briefs WHERE game_id = ? AND sport IS NOT NULL AND sport != '' LIMIT 1`
            ).bind(gameId).first().catch(() => null);
            if (existing) continue;
        }
        const sweepDate = new Date().toISOString().slice(0, 10);
        await env.ARCHIVE_DB.prepare(
            `INSERT INTO briefs
               (id, date, brief_type, sport, game_id, brief_text, quality_score, word_count, source)
             VALUES (?, ?, 'game_recap', ?, ?, ?, ?, ?, 'kv_sweep')
             ON CONFLICT(id) DO NOTHING`
        ).bind(
            `game_recap_${gameId}_${sweepDate}`,
            sweepDate, sport, gameId, briefText, qualityScore,
            briefText.split(/\s+/).length
        ).run();
        swept++;
    }
    return swept > 0 ? { swept } : null;
}
```

## TASK 2: Wire sweep into BOTH live and dead hour paths

1. After the live-hour journalism cycle (~line 5679,
   `ctx.waitUntil(handleJournalismCycle(env))`), add:

```javascript
ctx.waitUntil(sweepKVBriefs(env).catch(e =>
    console.error('[KV-SWEEP]', e.message)));
```

2. Replace the inline sweep in the dead-hours block (~lines 4797-4847)
   with:

```javascript
try {
    sweepResult = await sweepKVBriefs(env);
} catch(_) { /* sweep failure never breaks cron */ }
```

Keep the null-sport cleanup block that follows (~lines 4851-4860)
in place — it stays dead-hours-only.

## TASK 3: Fix game_brief backfill gate

File: src/index.js, ~line 4868

Change:
```javascript
if (env.ARCHIVE_DB && nextDate && briefResult && briefResult.skipped) {
```
To:
```javascript
if (env.ARCHIVE_DB && nextDate && briefResult && (briefResult.skipped || briefResult.ok)) {
```

executeGameBriefBackfill already deduplicates internally.

## TASK 4: On-demand historical backfill endpoint

Add GET /backfill/game-briefs endpoint. Place near other /archive
or /integrity endpoints.

```javascript
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

        const results = [];
        for (const game of allMissing) {
            try {
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
                await new Promise(r => setTimeout(r, 2000));

            } catch (e) {
                results.push({ id: game.id, ok: false, reason: e.message });
            }
        }

        return new Response(JSON.stringify({
            ok: true,
            processed: results.length,
            succeeded: results.filter(r => r.ok).length,
            failed: results.filter(r => !r.ok).length,
            results,
        }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
}
```

IMPORTANT: callProxy, stripMarkdown, assembleContext already exist.
Do NOT redefine them.

## TASK 5: Add /backfill to probe allow-list

Find the ALLOWED_PREFIX array (~line 9217) and add '/backfill'
if not already present.

## SCOPE BOUNDARY

DO:
- Extract sweepKVBriefs into standalone function
- Wire sweep into both live and dead hour cron paths
- Fix game_brief backfill gate condition
- Create GET /backfill/game-briefs endpoint
- Add /backfill to allow-list

DO NOT:
- Change the sweep logic itself (list, parse, insert pattern)
- Change executeGameBriefBackfill internals
- Touch the client repo
- Auto-trigger /backfill/game-briefs from cron
- Modify KV TTLs or write paths

## INSTRUCTIONS

1. Relay repo only (field-relay-nba).
2. git pull. Read CLAUDE.md.
3. Extract sweepKVBriefs function (Task 1).
4. Wire into live-hour path via ctx.waitUntil (Task 2).
5. Replace inline dead-hour sweep with function call (Task 2).
6. Fix backfill gate condition (Task 3).
7. Add /backfill/game-briefs endpoint (Task 4).
8. Add /backfill to ALLOWED_PREFIX (Task 5).
9. node --check src/index.js.
10. Single commit: "fix: brief archive pipeline — KV sweep every
    tick + backfill gate + on-demand /backfill/game-briefs"
11. Deploy via wrangler deploy.
12. After deploy, verify:
    curl /backfill/game-briefs?dry=true
    Expect ~56 missing games listed.
    curl /backfill/game-briefs?limit=5
    Expect 5 game_brief rows written.
13. Write manifest to outbox.
