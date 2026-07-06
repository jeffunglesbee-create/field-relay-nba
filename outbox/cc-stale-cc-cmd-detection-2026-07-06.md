# Stale CC-CMD Detection in session_health — 2026-07-06

## Commit

- `944b842` feat(session-health): add stale_pending_cc_cmds field from codex cc-cmd-queue

## What Changed

### TASK 1 — `stale_pending_cc_cmds` added to session_health (`src/index.js:12413`)

Inserted immediately after the `open_incidents` block, same indentation (24 spaces), same try/catch safety shape:

```javascript
try {
    const cq = await env.ARCHIVE_DB.prepare(`
        SELECT key, title, updated_at,
               ROUND((julianday('now') - julianday(updated_at)) * 24, 1) AS hours_stale
        FROM codex
        WHERE category = 'cc-cmd-queue' AND title LIKE 'PENDING%'
        ORDER BY updated_at ASC LIMIT 15
    `).all();
    out.stale_pending_cc_cmds = (cq.results || [])
        .filter(r => r.hours_stale >= 2)
        .map(r => ({ key: r.key, title: r.title, hours_stale: r.hours_stale }));
} catch(_) { out.stale_pending_cc_cmds = 'unavailable'; }
```

2-hour threshold: prevents false positives for CC-CMDs dispatched minutes ago; short enough to catch same-day drift.

### TASK 2 — Verification

**D1 direct query confirmed 4 real codex rows** with `category='cc-cmd-queue' AND title LIKE 'PENDING%'`:

| key | updated_at | hours_stale (SQL) | hand-checked |
|-----|-----------|-------------------|--------------|
| CC-CMD-2026-07-06-fields-pick-fix.md | 13:35:37 | 1.3 | ~14:57Z − 13:35:37 = 1h22m = 1.37h ✓ |
| CC-CMD-2026-07-06-wenttoot-newspaper-bundle-wire.md | 13:46:49 | 1.1 | ~14:57Z − 13:46:49 = 1h10m = 1.17h ✓ |
| CC-CMD-2026-07-06-wenttoot-client-filter-wire.md | 13:46:56 | 1.1 | ~14:57Z − 13:46:56 = 1.17h ✓ |
| CC-CMD-2026-07-06-stale-cc-cmd-detection.md | 14:51:00 | 0.1 | ~14:57Z − 14:51 = 6min = 0.1h ✓ |

All 4 are under 2h → `stale_pending_cc_cmds: []` is correct.

**Live session_health call post-deploy confirmed:**
```json
"stale_pending_cc_cmds": []
```
Field present, correct value, no error. Deploy run `28800895069` on commit `944b842`.

## Detection scope — honest statement

This is **detection automation, not execution automation.** There is no mechanism for a Claude Code session to start autonomously — a human still has to paste the one-liner from the CC-CMD. What this does: make `session_health` (called every session per Rule 85) automatically surface which pending CC-CMDs have gone stale (≥2h since last update), instead of requiring manual cross-referencing of git log against Codex. Once any of the current 4 codex entries crosses the 2-hour threshold, a future session will see them in `stale_pending_cc_cmds` without having to ask.

## Side note

The `open_incidents` field still shows "wentToOT hardcoded false in newspaper (needs GameDO/AmbientDO write)" — this incident predates today's `5152137` fix. That codex entry should be resolved in a follow-up; it no longer reflects reality.

## Confidence Score

```
+40  Query added correctly; matches open_incidents try/catch shape exactly; same indentation
+30  Real codex data verified; hours_stale arithmetic hand-checked against wall clock for all 4 rows
+20  Live session_health call confirmed new field present and returning correct [] value post-deploy
+10  Outbox explicitly scopes this as detection-only, not execution, automation
= 100/100
```

## Compliance

- Rule 68: probe block confirmed exact citation (lines 12403-12411) before editing; D1 queried directly for real codex data
- Rule 69: only the single insertion after open_incidents; no other session_health logic touched
- Rule 87: verification executed within session (D1 direct query + live session_health call); outbox is last task
