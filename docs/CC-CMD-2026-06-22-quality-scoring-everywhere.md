# Claude Code Command — Quality Scoring on All Brief Paths (2 of 3)

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-quality-scoring-2026-06-22.md.

## CONTEXT

Only 12 of 540 briefs in D1 have a quality_score (10 slate, 2
series_preview). All other brief types — game_recap (128 rows),
game_brief (59), night_owl (148), mlb_game (51), wc_matchup (72),
wnba_game (3) — have quality_score = NULL.

The quality chain (runQualityChain) exists and works. It just
isn't wired into most paths. Analytics Engine (JQ_ANALYTICS)
receives data from 2 paths but not the others.

This prompt wires quality scoring into EVERY brief write path
and adds a /quality/report endpoint for automated monitoring.

## TASK 1: Score every brief at write time

File: src/index.js

Find every path that INSERTs into the briefs table. For each one
that doesn't already run runQualityChain, add scoring.

There are two categories:

### Category A: Paths that generate via LLM (can run full quality chain)

These paths call callProxy and get prose back. Wire runQualityChain
BEFORE the INSERT:

1. Night Owl NBA recap (~line 2766) — currently no quality chain
2. Night Owl NHL recap (~line 2855) — currently no quality chain
3. WC post-match recap (~line 1564) — currently no quality chain
4. /backfill/game-briefs handler (~line 7439) — add per Task 1 of
   the backfill-prompt-quality CC-CMD (if not yet deployed)
5. KV sweep captured briefs (~sweepKVBriefs) — these are pre-generated
   text, not LLM calls. Score with scoreProse only (no retry).

For LLM paths (1-4), the pattern is:

```javascript
// After getting prose from callProxy:
const qResult = await runQualityChain(prompt, prose, callProxy, {
    sport: sportLabel, scoreThreshold: 90, maxRetries: 2,
});
const finalText = stripMarkdown(qResult.text);
const qualityScore = qResult.score;
// Use finalText and qualityScore in INSERT
```

### Category B: Paths that receive pre-written text (score only, no retry)

These paths get text from KV or client POST — can't retry because
there's no prompt to retry with. Use scoreProse directly:

1. KV sweep (sweepKVBriefs function)
2. Client-sourced briefs (mlb_game, wnba_game, night_owl from client POST)
3. kv_capture on /archive/game

For these, add a lightweight score:

```javascript
// scoreProse is already exported from journalism-quality.js
// It returns a numeric score (0-300) without retrying
const qualityScore = scoreProse(briefText, { sport });
// Include in INSERT
```

If scoreProse is not exported, add the export. It should be a
pure function that scores text without calling an LLM.

## TASK 2: Analytics Engine on all paths

Every path that writes to D1 should also write to JQ_ANALYTICS
(if bound). Use the same writeDataPoint pattern as the cron
slate brief (~line 5527):

```javascript
if (env.JQ_ANALYTICS) {
    env.JQ_ANALYTICS.writeDataPoint({
        indexes: [briefType, sport || 'none'],
        blobs: [layers_fired || 'none'],
        doubles: [qualityScore, retries || 0, ms || 0,
                  0, 0, 0, 0, promptLength || 0, textLength || 0],
    });
}
```

## TASK 3: GET /quality/report endpoint

Add a new endpoint that reads quality data from D1 and returns
a monitoring report:

```javascript
if (pathname === '/quality/report' && request.method === 'GET') {
    const days = parseInt(url.searchParams.get('days') || '7', 10);
    const since = new Date(Date.now() - days * 86400000)
        .toISOString().slice(0, 10);

    const report = await env.ARCHIVE_DB.prepare(`
        SELECT
            brief_type,
            sport,
            COUNT(*) as total,
            COUNT(quality_score) as scored,
            ROUND(AVG(quality_score), 1) as avg_score,
            MIN(quality_score) as min_score,
            MAX(quality_score) as max_score,
            SUM(CASE WHEN quality_score < 150 THEN 1 ELSE 0 END) as below_150,
            SUM(CASE WHEN quality_score >= 200 THEN 1 ELSE 0 END) as above_200
        FROM briefs
        WHERE date >= ?
        GROUP BY brief_type, sport
        ORDER BY avg_score ASC
    `).bind(since).all();

    // Flag degradation: any type with avg < 170 or >30% below 150
    const rows = report.results || [];
    const alerts = rows.filter(r =>
        r.scored > 0 && (r.avg_score < 170 || (r.below_150 / r.scored) > 0.3)
    ).map(r => ({
        brief_type: r.brief_type,
        sport: r.sport,
        alert: r.avg_score < 170 ? 'avg_below_170' : 'high_failure_rate',
        avg_score: r.avg_score,
        failure_rate: r.scored > 0 ? Math.round(r.below_150 / r.scored * 100) : 0,
    }));

    return new Response(JSON.stringify({
        ok: true, days, since,
        summary: rows,
        alerts,
        alert_count: alerts.length,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
}
```

Add '/quality' to ALLOWED_PREFIX.

## TASK 4: Quality degradation check in analytics cron

In the analytics cron (analyticsEngine function in analytics-engine.js),
add a quality check phase that runs once per day (during the 9 UTC
tick). It reads the /quality/report data and writes a quality_feedback
row to analytics_output if degradation is detected:

```javascript
// Phase: quality monitor (daily at 9 UTC)
const qualityRows = await env.ARCHIVE_DB.prepare(`
    SELECT brief_type, sport, AVG(quality_score) as avg,
           COUNT(*) as n
    FROM briefs
    WHERE date >= ? AND quality_score IS NOT NULL
    GROUP BY brief_type, sport
    HAVING avg < 170 AND n >= 3
`).bind(yesterday).all();

if (qualityRows.results?.length) {
    await env.ARCHIVE_DB.prepare(`
        INSERT INTO analytics_output (feature, date, value)
        VALUES ('quality_feedback', ?, ?)
        ON CONFLICT DO UPDATE SET value = excluded.value
    `).bind(today, JSON.stringify({
        degraded_types: qualityRows.results,
        generated_at: new Date().toISOString(),
    })).run();
}
```

This feeds into the O(1) Newspaper — quality_feedback is already
in the newspaper bundle response.

## SCOPE BOUNDARY

DO:
- Wire runQualityChain into Night Owl, WC recap, backfill paths
- Wire scoreProse into KV sweep, client-sourced, kv_capture paths
- Write quality_score to D1 on every brief INSERT
- Write to JQ_ANALYTICS on every brief path
- Add /quality/report endpoint
- Add quality check phase to analytics cron

DO NOT:
- Modify runQualityChain or scoreProse internals
- Change FIELD_PROSE_STYLE or FIELD_VOICE_REGISTER
- Touch the client repo
- Modify existing brief text (only add scoring)

## INSTRUCTIONS

1. Relay repo only (field-relay-nba).
2. git pull. Read CLAUDE.md.
3. Wire quality scoring into all brief INSERT paths (Task 1).
4. Wire JQ_ANALYTICS on all paths (Task 2).
5. Add /quality/report endpoint (Task 3).
6. Add quality check phase to analytics cron (Task 4).
7. node --check src/index.js && node --check src/analytics-engine.js
8. Single commit: "feat: quality scoring on all brief paths +
   /quality/report monitoring endpoint"
9. Deploy via wrangler deploy.
10. Verify: curl /quality/report?days=7
11. Write manifest to outbox.
