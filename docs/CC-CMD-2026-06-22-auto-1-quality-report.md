# CC-CMD AUTO-1: /quality/report endpoint

git pull. Read CLAUDE.md. Run `git log --oneline -3` first.
Write findings to outbox/cc-auto-1-quality-report-2026-06-22.md.

## WHAT

One endpoint. No new infrastructure. Reads D1 briefs table.
Returns degradation status + alerts. Runs in the analytics cron.
Writes quality_feedback to analytics_output so the Newspaper surfaces it.

## STATE CHECK

```bash
grep -n "'/quality'" src/index.js
grep -n 'quality_feedback' src/analytics-engine.js | head -5
grep -n 'quality_feedback' src/index.js | head -5
```

If /quality/report already exists, read its implementation and
report the current shape in outbox. Do not add a duplicate.

## TASK 1: GET /quality/report

File: src/index.js — near /integrity or /deploy endpoints.

```javascript
if (pathname === '/quality/report' && request.method === 'GET') {
    if (!env.ARCHIVE_DB) return new Response(
        JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
        { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

    const days = Math.min(parseInt(url.searchParams.get('days') || '7', 10) || 7, 30);
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const rows = await env.ARCHIVE_DB.prepare(`
        SELECT brief_type, sport,
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
        ORDER BY avg_score ASC NULLS LAST
    `).bind(since).all();

    const summary = rows.results || [];

    // Degradation alerts: avg < 170 OR >30% scored below 150
    const alerts = summary
        .filter(r => r.scored >= 3)
        .filter(r => r.avg_score < 170 || (r.below_150 / r.scored) > 0.3)
        .map(r => ({
            brief_type: r.brief_type,
            sport: r.sport || 'all',
            alert: r.avg_score < 170 ? 'avg_below_170' : 'high_failure_rate',
            avg_score: r.avg_score,
            failure_pct: Math.round((r.below_150 / r.scored) * 100),
        }));

    // Unscored types: scored = 0 but total > 0 — these are invisible to quality system
    const unscored = summary
        .filter(r => r.total > 5 && r.scored === 0)
        .map(r => ({ brief_type: r.brief_type, sport: r.sport, total: r.total }));

    return new Response(JSON.stringify({
        ok: true, days, since,
        summary,
        alerts,
        alert_count: alerts.length,
        unscored_types: unscored,
        unscored_count: unscored.length,
    }), { headers: { ...CORS, 'Content-Type': 'application/json',
                     'Cache-Control': 'public, max-age=300' } });
}
```

Add '/quality' to the ALLOWED_PREFIX array at ~line 9583.

## TASK 2: Wire into analytics cron

File: src/analytics-engine.js

In the nightly analytics phases, AFTER Phase 8 (quality_feedback),
add a quality check that writes an alert to analytics_output
when degradation is detected. This feeds the Newspaper.

```javascript
// Phase: quality_alert — writes to analytics_output if scoring is degraded
// This makes quality failures visible in the O(1) Newspaper automatically.
try {
    const alertRows = await env.ARCHIVE_DB.prepare(`
        SELECT brief_type,
               COUNT(*) as total,
               COUNT(quality_score) as scored,
               ROUND(AVG(quality_score), 1) as avg_score
        FROM briefs
        WHERE date >= ? AND quality_score IS NOT NULL
        GROUP BY brief_type
        HAVING COUNT(quality_score) >= 3
          AND (AVG(quality_score) < 170
               OR CAST(COUNT(CASE WHEN quality_score < 150 THEN 1 END) AS REAL)
                  / COUNT(quality_score) > 0.3)
    `).bind(yesterday).all();

    const unscoredRows = await env.ARCHIVE_DB.prepare(`
        SELECT brief_type, COUNT(*) as total
        FROM briefs
        WHERE date >= ? AND quality_score IS NULL
        GROUP BY brief_type
        HAVING COUNT(*) > 5
    `).bind(yesterday).all();

    const alerts = alertRows.results || [];
    const unscored = unscoredRows.results || [];
    const hasIssues = alerts.length > 0 || unscored.length > 0;

    if (hasIssues) {
        await writeAnalyticsOutput(env, {
            date,
            feature: 'quality_alert',
            sport: null,
            value: { alerts, unscored, checked_at: new Date().toISOString() },
            briefText: alerts.length > 0
                ? `Quality degraded on ${alerts.length} brief type(s). ` +
                  `${unscored.length} type(s) not being scored.`
                : `${unscored.length} brief type(s) not being scored.`,
        });
    }
} catch (_) { /* never block cron */ }
```

## TASK 3: Wire quality_alert into newspaper bundle

File: src/index.js — the /analytics/newspaper/{date} handler (~line 8044).

Currently the bundle has quality_feedback. Add quality_alert:

```javascript
quality_alert: recap.quality_alert ? {
    ...(recap.quality_alert.value || {}),
    brief: recap.quality_alert.brief_text || null,
} : null,
```

## SCOPE

DO: Add /quality/report endpoint, wire cron phase, add to newspaper bundle.
DO NOT: Touch brief generation paths, modify quality chain, touch client.

## SESSION END

1. node --check src/index.js && node --check src/analytics-engine.js
2. Single commit: "feat: /quality/report + cron quality alert → newspaper"
3. wrangler deploy
4. Verify: curl /quality/report?days=7
   Expect: unscored_count > 0 (confirms the gap is visible)
   Expect: alert_count = 0 or alerts with real data (not silence)
5. Write outbox manifest
6. write_handoff via MCP with updated RELAY HEAD
7. codex_write: key="endpoint/quality-report", category="endpoint",
   title="/quality/report — automated quality degradation monitoring"
