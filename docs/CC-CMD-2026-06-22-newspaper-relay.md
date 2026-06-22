# Claude Code Command — O(1) Newspaper (RELAY)

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-newspaper-relay-2026-06-22.md.

## CONTEXT

FIELD's Analytics Cron runs daily at 9 UTC and writes editorial
features to D1 analytics_output + KV. Morning Report, Night Stars,
Truth Is, FIELD's Pick, Circadian Preview, Streak Board — all
generated, stored, never displayed to users.

The O(1) Newspaper needs ONE relay endpoint that bundles all
features into a single response. This prompt covers the RELAY
repo only. The client prompt is in jubilant-bassoon.

## TASK 1: GET /analytics/newspaper/{date} endpoint

File: src/index.js

Add a DEDICATED route BEFORE the generic `/analytics/{feature}/{date}`
handler (line ~7821). The generic handler serves single features;
the newspaper endpoint bundles ALL features for a date.

```javascript
// GET /analytics/newspaper/{date} — O(1) Newspaper bundle
// Assembles all analytics_output features + KV editorial into
// one atomic response. One fetch, one render.
// {date} = TODAY's date. Endpoint fetches recap from yesterday
// and preview from today internally.
if (pathname.startsWith('/analytics/newspaper/') && request.method === 'GET') {
    if (!env.ARCHIVE_DB) {
        return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
            { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    const date = pathname.slice('/analytics/newspaper/'.length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return new Response(JSON.stringify({ ok: false, error: 'invalid date' }),
            { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    try {
        // The analytics cron runs at 9 UTC and stores:
        //   - Recap features (morning_report, night_stars, truth_is,
        //     streak_board) under YESTERDAY's date
        //   - Preview features (circadian_preview, field_pick) under
        //     TODAY's date
        //
        // The {date} parameter is TODAY. We need both dates.
        // Compute yesterday from the requested date.
        const reqDate = new Date(date + 'T12:00:00Z');
        const yestDate = new Date(reqDate);
        yestDate.setDate(yestDate.getDate() - 1);
        const yesterday = yestDate.toISOString().slice(0, 10);

        // 1. Batch-read features from BOTH dates
        const [recapRows, previewRows] = await Promise.all([
            env.ARCHIVE_DB.prepare(
                `SELECT feature, value, brief_text FROM analytics_output WHERE date = ?`
            ).bind(yesterday).all(),
            env.ARCHIVE_DB.prepare(
                `SELECT feature, value, brief_text FROM analytics_output WHERE date = ?`
            ).bind(date).all(),
        ]);

        const parseRows = (rows) => {
            const out = {};
            for (const row of (rows.results || [])) {
                let parsed = null;
                try { parsed = JSON.parse(row.value); } catch (_) { parsed = row.value; }
                out[row.feature] = { value: parsed, brief_text: row.brief_text || null };
            }
            return out;
        };

        const recap = parseRows(recapRows);    // yesterday's recaps
        const preview = parseRows(previewRows); // today's previews

        // 2. Assemble bundle — recap from yesterday, preview from today
        const bundle = {
            date,
            recap_date: yesterday,
            generated_at: recap.morning_report?.value?.generated_at || null,
            morning_report: recap.morning_report?.brief_text || null,
            truth_is: recap.truth_is ? {
                ...(recap.truth_is.value || {}),
                brief: recap.truth_is.brief_text || null,
            } : null,
            night_stars: recap.night_stars?.value || null,
            // Preview features from TODAY's date
            pick: preview.field_pick ? {
                ...(preview.field_pick.value || {}),
                brief: preview.field_pick.brief_text || null,
            } : null,
            preview: preview.circadian_preview?.brief_text || null,
            streak_board: recap.streak_board?.value || null,
            quality_feedback: recap.quality_feedback?.value || null,
            // completed_games from yesterday for "What Changed"
            completed_games: [],
        };

        // 3. Completed games — structural facts for "What Changed"
        //
        //    SCHEMA REALITY (verified June 22):
        //    regular_season_games: id, sport, home, away, home_score,
        //      away_score, closing_odds, opening_odds (NO status, NO
        //      went_to_ot, NO is_elimination, NO is_series_clinch)
        //    postseason_games: same + importance ('clinch'|'elimination'|
        //      'playoffs'), series_key, series_record, series_margins
        //
        //    "Completed" = home_score IS NOT NULL.
        //    OT not stored in D1 — cannot detect from archive alone.
        //    Structural flags derived from: margin, closing_odds (upset),
        //      importance column (postseason only).
        try {
            const regGames = await env.ARCHIVE_DB.prepare(`
                SELECT id, sport, home, away, home_score, away_score,
                       closing_odds, NULL as importance
                FROM regular_season_games
                WHERE date = ? AND home_score IS NOT NULL
            `).bind(yesterday).all();

            const postGames = await env.ARCHIVE_DB.prepare(`
                SELECT id, sport, home, away, home_score, away_score,
                       closing_odds, importance
                FROM postseason_games
                WHERE date = ? AND home_score IS NOT NULL
            `).bind(yesterday).all();

            const allGames = [
                ...(regGames.results || []),
                ...(postGames.results || []),
            ];

            bundle.completed_games = allGames.map(g => {
                // Detect upset: underdog won based on closing moneyline
                let wasUpset = false;
                try {
                    if (g.closing_odds) {
                        const odds = typeof g.closing_odds === 'string'
                            ? JSON.parse(g.closing_odds) : g.closing_odds;
                        const homeML = odds?.moneyline?.home;
                        const awayML = odds?.moneyline?.away;
                        if (homeML && awayML && homeML !== null && awayML !== null) {
                            const homeFav = homeML < 0 && awayML > 0;
                            const awayFav = awayML < 0 && homeML > 0;
                            const homeWon = g.home_score > g.away_score;
                            if (homeFav && !homeWon) wasUpset = true;
                            if (awayFav && homeWon) wasUpset = true;
                            // Only flag meaningful upsets (underdog ML >= +150)
                            if (wasUpset) {
                                const underdogML = homeFav ? awayML : homeML;
                                if (underdogML < 150) wasUpset = false;
                            }
                        }
                    }
                } catch (_) {}

                const margin = Math.abs((g.home_score || 0) - (g.away_score || 0));
                // importance column: 'clinch', 'elimination', 'playoffs', or null
                const isSeriesClinch = g.importance === 'clinch';
                const isElimination = g.importance === 'elimination';

                return {
                    id: g.id,
                    sport: g.sport,
                    home: g.home,
                    away: g.away,
                    homeScore: g.home_score,
                    awayScore: g.away_score,
                    wentToOT: false, // not stored in D1 — always false
                    wasUpset,
                    isSeriesClinch,
                    isElimination,
                    margin,
                };
            });
        } catch (_) {
            // Tables may not exist yet — degrade gracefully
            bundle.completed_games = [];
        }

        return new Response(JSON.stringify({ ok: true, ...bundle }), {
            headers: {
                ...CORS,
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=300',
            },
        });
    } catch (e) {
        return new Response(JSON.stringify({
            ok: false, error: e.message,
            _note: 'analytics_output table may not exist yet',
        }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
}
```

CRITICAL: This route MUST appear BEFORE the generic `/analytics/`
handler (~line 7821). If it appears after, the generic handler
will match `/analytics/newspaper` as feature="newspaper" and
return a single-row lookup instead of the bundle.

The probe allow-list at ~line 9217 already includes '/analytics'.

## SCOPE BOUNDARY

DO:
- Create /analytics/newspaper/{date} endpoint
- Place it BEFORE the generic /analytics/{feature}/{date} handler

DO NOT:
- Modify any existing endpoints
- Add new D1 tables or columns
- Change Analytics Cron phases
- Touch the client repo (jubilant-bassoon)

## INSTRUCTIONS

1. Relay repo only (field-relay-nba).
2. git pull. Read CLAUDE.md.
3. Add /analytics/newspaper/{date} route BEFORE generic handler.
4. node --check src/index.js.
5. Single commit: "feat: O(1) Newspaper bundle endpoint —
   /analytics/newspaper/{date} assembles recap + preview"
6. Deploy via wrangler deploy.
7. After deploy, verify:
   curl https://field-relay-nba.jeffunglesbee.workers.dev/analytics/newspaper/2026-06-22
   Expect: morning_report from 2026-06-21, pick from 2026-06-22,
   completed_games from 2026-06-21's archived games.
8. Write manifest to outbox.
