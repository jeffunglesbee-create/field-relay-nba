# CC-CMD: Phase 8b Cleanup + Quality Threshold Alignment
**Date:** 2026-06-24  
**Repo:** field-relay-nba  
**Rule 87:** Self-completing. All probes, edits, verification, and outbox manifest run inside this session.

---

## PROBE BLOCK — read before writing anything

1. Read `src/analytics-engine.js` and confirm:
   - Line 12: `PHASE_NAMES` array contains `'phase8b_quality_alert'`... **it should NOT** — verify exact text
   - Lines ~1492–1531: Phase 8b block exists (comment starts `// Phase 8b: quality_alert`)
   - Lines ~1562–1572: Phase 12 block exists (`runPhase12QualityAlert`)

2. Read `src/index.js` and confirm session_health quality block (search `avg_score < 170`):
   - `since = new Date(Date.now() - 86400000)` — 1-day window
   - `avg_score < 170` threshold
   - Exact surrounding lines needed for safe str_replace

---

## TASK 1 — Delete Phase 8b block from `src/analytics-engine.js`

### 1a. Remove `phase8b_quality_alert` from PHASE_NAMES

Find the line:
```
const PHASE_NAMES = ['phase0', 'phase1', 'phase2', 'phase3', 'phase4', 'phase5', 'phase7', 'phase8', 'phase9', 'phase10a', 'phase10b', 'phase6a', 'phase6b', 'phase6c', 'phase6d', 'phase11', 'phase12'];
```

`phase8b_quality_alert` is **not in this array** (it was pushed at runtime, not declared here). Skip this sub-task if confirmed absent.

### 1b. Delete the entire Phase 8b try/catch block

Delete this exact block (including the blank line before the comment):

```javascript

        // Phase 8b: quality_alert — surfaces degradation in the O(1) Newspaper
        // by writing an analytics_output row when avg<170 or high unscored
        // counts are present. Silent on no-alert days. Never blocks cron.
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
                  AND AVG(quality_score) < 170
            `).bind(date).all();
            const unscoredRows = await env.ARCHIVE_DB.prepare(`
                SELECT brief_type, COUNT(*) as total
                FROM briefs WHERE date >= ? AND quality_score IS NULL
                GROUP BY brief_type HAVING COUNT(*) > 5
            `).bind(date).all();
            const alerts = alertRows.results || [];\
            const unscored = unscoredRows.results || [];
            if (alerts.length > 0 || unscored.length > 0) {
                await writeAnalyticsOutput(env, {
                    date,
                    feature: 'quality_alert',
                    sport: null,
                    value: { alerts, unscored, checked_at: new Date().toISOString() },
                    briefText: alerts.length > 0
                        ? `Quality degraded on ${alerts.length} brief type(s).`
                        : `${unscored.length} brief type(s) not being scored.`,
                });
                featuresComputed++;
            }
            phasesCompleted.push('phase8b_quality_alert');
        } catch (e) {
            phasesFailed.push('phase8b_quality_alert');
            errors.push(`phase8b_quality_alert: ${e.message}`);
        }
```

Replace with nothing (empty string) — the block is fully superseded by Phase 12.

**Verification:** After edit, grep `analytics-engine.js` for `phase8b` — must return zero matches.

---

## TASK 2 — Align session_health quality threshold in `src/index.js`

Find the session_health quality block. The exact text to replace:

```javascript
                            const since = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
                            const q = await env.ARCHIVE_DB.prepare(`
                                SELECT brief_type, COUNT(*) as total, COUNT(quality_score) as scored,
                                       ROUND(AVG(quality_score), 1) as avg_score
                                FROM briefs WHERE date >= ? GROUP BY brief_type
                            `).bind(since).all();
                            const types = q.results || [];
                            out.quality = {
                                degraded: types.filter(r => r.scored >= 3 && r.avg_score < 170)
                                               .map(r => r.brief_type),
                                unscored: types.filter(r => r.total > 5 && r.scored === 0)
                                               .map(r => r.brief_type),
                            };
```

Replace with (7-day window, 240 threshold, golf + enrichment excluded, matches Phase 12 logic):

```javascript
                            const since = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
                            const ENRICHMENT_SH = new Set(['wc_matchup','standings_snapshot','narrative_context','enrichment','kv_harvest','wc_tab']);
                            const q = await env.ARCHIVE_DB.prepare(`
                                SELECT brief_type, sport, COUNT(*) as total, COUNT(quality_score) as scored,
                                       ROUND(AVG(quality_score), 1) as avg_score
                                FROM briefs WHERE date >= ? GROUP BY brief_type, sport
                            `).bind(since).all();
                            const types = q.results || [];
                            out.quality = {
                                degraded: types
                                    .filter(r => r.scored >= 3)
                                    .filter(r => !ENRICHMENT_SH.has(r.brief_type))
                                    .filter(r => !(r.sport && r.sport.toLowerCase().includes('golf')))
                                    .filter(r => r.avg_score < 240)
                                    .map(r => r.brief_type),
                                unscored: types.filter(r => r.total > 5 && r.scored === 0)
                                               .map(r => r.brief_type),
                            };
```

**Verification:** grep `index.js` for `avg_score < 170` — must return zero matches. grep for `avg_score < 240` — must appear in the session_health block.

---

## TASK 3 — Smoke + commit

1. Run smoke tests: `npm test` (or however tests are run in this repo — check package.json). Must pass 0 failures.

2. Commit with message:
   ```
   fix: Phase 8b cleanup + session_health quality threshold aligned to 240/300
   
   - Delete stale Phase 8b quality_alert writer (threshold 170, today-only window)
     Phase 12 supersedes it — daily 7-day 240/300 scan via INSERT OR REPLACE
   - session_health quality.degraded: 170→240 threshold, 1-day→7-day window
     Now matches Phase 12 + /quality/report — consistent signal across all surfaces
   ```

3. Push to main.

---

## TASK 4 — Outbox manifest

Write `outbox/cc-phase8b-cleanup-quality-align-2026-06-24.md` with:
- Tasks completed (list with ✓)
- Verification results (grep outputs confirming 0 phase8b matches, 0 avg_score<170 matches)
- Smoke result
- Commit hash
- What this changes in observable behavior: session_health `quality.degraded` now fires only when avg < 240 over 7 days (was: avg < 170 over 1 day). Expect fewer false positives; alerts when fired will be genuine quality regressions.

Commit outbox file with `[skip ci]` and push.

---

## DONE CONDITION

All of the following must be true before declaring complete:
- [ ] grep `analytics-engine.js` for `phase8b` → 0 matches
- [ ] grep `index.js` for `avg_score < 170` → 0 matches  
- [ ] grep `index.js` for `avg_score < 240` → ≥1 match in session_health block
- [ ] Smoke tests pass
- [ ] Commit pushed to main
- [ ] Outbox manifest committed with [skip ci]
