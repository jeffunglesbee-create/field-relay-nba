# CC-CMD — Phase 12: automated quality alert in analytics-engine.js

**Repo:** field-relay-nba
**Date:** 2026-06-23
**Scope:** src/analytics-engine.js only — one new phase function + dispatch

---

## WHY THIS EXISTS

The per-brief quality chain (runQualityChain) is automated inline.
Aggregate quality monitoring is not. `/quality/report` is a manual GET
endpoint that requires someone to remember to call it. The newspaper
bundle already has a `quality_alert` slot at index.js L8844 that reads
from `analytics_output WHERE feature = 'quality_alert' AND date = ?`.
Nothing writes to it. This phase closes that loop.

After this ships: the analytics cron (daily 9AM UTC) automatically
computes the 7-day quality summary, writes it to `analytics_output`,
and the newspaper surfaces it in `bundle.quality_alert` without any
manual intervention.

---

## VERIFIED FACTS (Rule 68 — probed before spec was written)

- `writeAnalyticsOutput(env, {date, feature, sport, value, briefText})`
  at L155 — INSERT OR REPLACE into analytics_output. id = feature_date.
- `addDays(iso, n)` helper at ~L68 — date arithmetic utility.
- `PHASE_NAMES` array at L12 — add 'phase12' here.
- `processDate` finally block at L1480-1510 — phase11 always runs here.
  Phase 12 runs BEFORE the finally (inside the main try body), same as
  all other phases.
- Phase dispatch pattern (from phase6d context at L1466-1469):
  ```javascript
  try {
      await runPhase6DBrokenRecord(env, date);
      featuresComputed++;
      phasesCompleted.push('phase6d');
  } catch (e) { phasesFailed.push('phase6d'); errors.push(`phase6d: ${e.message}`); }
  ```
- Newspaper reads `recapRows` from yesterday's date. Analytics engine
  processes yesterday's data. Quality alert written for `date` (yesterday)
  → appears in today's `bundle.quality_alert`. Correct behavior.
- `analytics_output` schema: id, date, feature, sport, value (JSON string),
  brief_text, created_at. Confirmed at L45-56.
- ENRICHMENT_TYPES used in /quality/report at L7787: wc_matchup,
  standings_snapshot, narrative_context, enrichment, kv_harvest, wc_tab.
  Replicate here.

---

## PRE-BUILD PROBES (Rule 68)

```bash
# 1. Confirm PHASE_NAMES line
sed -n '12p' src/analytics-engine.js

# 2. Confirm writeAnalyticsOutput signature
sed -n '155,163p' src/analytics-engine.js

# 3. Confirm addDays helper exists
grep -n "^function addDays" src/analytics-engine.js

# 4. Confirm phase6d dispatch block (last phase before finally)
grep -n "phase6d\|phase11\|phasesCompleted.push" src/analytics-engine.js | tail -10

# 5. Read the finally block exactly
sed -n '1478,1513p' src/analytics-engine.js

# 6. Confirm no existing phase12 or quality_alert write
grep -n "phase12\|quality_alert" src/analytics-engine.js
```

Write probe output to outbox manifest before writing any code.

---

## TASK 1 — Add runPhase12QualityAlert function

Add immediately before the `processDate` function (find its opening line
from probe #4 context — likely `async function processDate(`).

```javascript
// ── Phase 12: Quality Alert ───────────────────────────────────────────────
// Daily quality snapshot: scans the 7-day briefs window, finds any types
// with avg_score < 240 (excellence threshold) or failure_pct > 20%,
// writes to analytics_output as feature='quality_alert'.
// The newspaper endpoint reads this automatically — bundle.quality_alert
// is populated without manual intervention.
//
// Enrichment types excluded (wc_matchup, standings_snapshot, etc.) — they
// are reference data, not journalism prose. Golf excluded — structural
// ceiling, no context builder exists.
async function runPhase12QualityAlert(env, date) {
    if (!env.ARCHIVE_DB) return { skipped: true, reason: 'ARCHIVE_DB not bound' };
    const since = addDays(date, -6); // 7-day window ending at date

    const rows = await env.ARCHIVE_DB.prepare(`
        SELECT brief_type, sport,
               COUNT(*) as total,
               COUNT(quality_score) as scored,
               ROUND(AVG(quality_score), 1) as avg_score,
               MAX(quality_score) as max_score,
               SUM(CASE WHEN quality_score < 240 THEN 1 ELSE 0 END) as below_240,
               SUM(CASE WHEN quality_score >= 240 THEN 1 ELSE 0 END) as above_240
        FROM briefs WHERE date >= ? AND date <= ?
        GROUP BY brief_type, sport
        ORDER BY avg_score ASC NULLS LAST
    `).bind(since, date).all();

    const summary = rows.results || [];

    const ENRICHMENT = new Set([
        'wc_matchup', 'standings_snapshot', 'narrative_context',
        'enrichment', 'kv_harvest', 'wc_tab',
    ]);

    const alerts = summary
        .filter(r => r.scored >= 3)
        .filter(r => {
            if (ENRICHMENT.has(r.brief_type)) return false;
            if (r.sport && r.sport.toLowerCase().includes('golf')) return false;
            const failRate = r.below_240 / r.scored;
            return r.avg_score < 240 || failRate > 0.2;
        })
        .map(r => ({
            brief_type: r.brief_type,
            sport: r.sport || 'all',
            avg_score: r.avg_score,
            failure_pct: Math.round((r.below_240 / r.scored) * 100),
            above_240: r.above_240 || 0,
        }));

    const typesAbove240 = summary.filter(r => (r.above_240 || 0) > 0).length;
    const totalScored   = summary.reduce((n, r) => n + (r.scored || 0), 0);

    const value = {
        alert_count: alerts.length,
        alerts,
        since,
        through: date,
        types_above_240: typesAbove240,
        total_types: summary.filter(r => r.scored >= 3 && !ENRICHMENT.has(r.brief_type)).length,
        total_scored: totalScored,
        generated_at: new Date().toISOString(),
    };

    const briefText = alerts.length === 0
        ? `Quality OK — ${typesAbove240} type${typesAbove240 !== 1 ? 's' : ''} above 240/300 threshold`
        : `${alerts.length} quality alert${alerts.length !== 1 ? 's' : ''}: `
          + alerts.slice(0, 2).map(a => `${a.brief_type}/${a.sport} avg ${a.avg_score}`).join(', ')
          + (alerts.length > 2 ? ` +${alerts.length - 2} more` : '');

    await writeAnalyticsOutput(env, {
        date,
        feature: 'quality_alert',
        sport: null,
        value,
        briefText,
    });

    return { alerts: alerts.length, typesAbove240, totalScored, skipped: false };
}
```

---

## TASK 2 — Add phase12 to PHASE_NAMES

Find `const PHASE_NAMES = [` at L12. Add `'phase12'` to the end of the array.

Before:
```javascript
const PHASE_NAMES = ['phase0', 'phase1', ..., 'phase11'];
```
After:
```javascript
const PHASE_NAMES = ['phase0', 'phase1', ..., 'phase11', 'phase12'];
```

---

## TASK 3 — Dispatch phase12 in processDate

Find the phase6d dispatch block (last phase before the finally). After it,
add phase12 dispatch:

```javascript
        // Phase 12: Quality Alert — daily quality snapshot to analytics_output.
        // Runs after all content phases so it captures the complete day's output.
        try {
            await runPhase12QualityAlert(env, date);
            featuresComputed++;
            phasesCompleted.push('phase12');
        } catch (e) { phasesFailed.push('phase12'); errors.push(`phase12: ${e.message}`); }
```

Place this BEFORE the `} else {` that closes the Phase 6 Sunday-only block
(i.e., it runs every day, not just Sunday). Verify positioning from probe #4.

---

## TASK 4 — Deploy and verify

```bash
# After deploy:

# 1. Trigger analytics engine manually to run phase12 for yesterday
curl -s -X POST "https://field-relay-nba.jeffunglesbee.workers.dev/analytics/trigger"   -H "Content-Type: application/json"   -d '{}'   | node -e 'const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")); console.log(JSON.stringify(d, null, 2))'

# 2. Check analytics_output for quality_alert row
# (via /analytics/{feature}/{date} generic endpoint)
YESTERDAY=$(date -u -v-1d '+%Y-%m-%d' 2>/dev/null || date -u -d 'yesterday' '+%Y-%m-%d')
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/analytics/quality_alert/${YESTERDAY}"   | node -e '
    const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
    if (d.value) {
      console.log("alert_count:", d.value.alert_count);
      console.log("types_above_240:", d.value.types_above_240, "/", d.value.total_types);
      d.value.alerts.slice(0,3).forEach(a=>console.log(" ALERT:", a.brief_type, a.sport, "avg:", a.avg_score));
    } else {
      console.log("No quality_alert row found:", JSON.stringify(d).slice(0,100));
    }
  '

# 3. Check newspaper bundle for quality_alert
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/analytics/newspaper/$(date -u '+%Y-%m-%d')"   | node -e '
    const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
    console.log("quality_alert in bundle:", d.quality_alert ? "YES" : "null");
    if (d.quality_alert) console.log(JSON.stringify(d.quality_alert, null, 2).slice(0, 300));
  '
```

**Done condition:**
1. Deploy success
2. `quality_alert` row exists in `analytics_output` for yesterday's date
3. `bundle.quality_alert` is non-null in the newspaper endpoint response
4. `brief_text` in the quality_alert row accurately describes current alert state

---

## TASK 5 — Outbox manifest

Write `outbox/cc-quality-alert-automation-2026-06-23.md`:
- Commit + deploy run ID
- phase12 confirmed in phasesCompleted
- quality_alert row content (value.alert_count, value.alerts summary)
- newspaper bundle.quality_alert non-null confirmed

---

## WHAT THIS CLOSES

Before: `/quality/report` must be called manually. Quality state is invisible
unless someone remembers to probe it each morning.

After: Analytics cron runs daily at 9AM UTC. Phase 12 writes quality state
to analytics_output. Newspaper surfaces it in bundle.quality_alert. Zero
manual intervention required. The user sees quality state in the same
morning report as all other FIELD intelligence.

---

## SCOPE (Rule 69 — TOUCH-ONLY-A)

DO:
- Add `runPhase12QualityAlert` function to src/analytics-engine.js
- Add 'phase12' to PHASE_NAMES
- Add phase12 dispatch in processDate
- Single commit + deploy

DO NOT:
- Modify index.js (newspaper already reads quality_alert from analytics_output)
- Modify journalism-quality.js
- Add new D1 tables or KV namespaces
- Touch jubilant-bassoon
