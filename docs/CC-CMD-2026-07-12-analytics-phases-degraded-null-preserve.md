# Claude Code Command — Preserve "not tracked" vs "confirmed not degraded" in session_health's analytics_phases

**Date:** 2026-07-12
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Scope:** One-line fix, same shape as `docs/CC-CMD-2026-07-12-wenttoot-null-preserve.md`
(already shipped separately — do not conflate, this is a different field, different
function, single-concern per Rule 7).

`session_health`'s `analytics_phases` builder does:
```javascript
phases[r.feature] = { date: r.date, degraded: !!r.degraded };
```
where `r.degraded` comes from `JSON_EXTRACT(value, '$.degraded')` against
`analytics_output`.

**Live-queried directly before writing this CC-CMD, not assumed:**
```sql
SELECT feature, COUNT(*) as rows_last_14d,
  SUM(CASE WHEN JSON_EXTRACT(value,'$.degraded') IS NULL THEN 1 ELSE 0 END) as missing_degraded_key,
  SUM(CASE WHEN JSON_EXTRACT(value,'$.degraded')=1 THEN 1 ELSE 0 END) as degraded_true,
  SUM(CASE WHEN JSON_EXTRACT(value,'$.degraded')=0 THEN 1 ELSE 0 END) as degraded_false
FROM analytics_output WHERE date >= date('now','-14 days') GROUP BY feature;
```
Result: of 14 tracked features, **12 NEVER include a `degraded` key in their JSON
payload at all** (field_pick, circadian_preview, circadian_late, morning_report,
quality_alert, quality_feedback, streak_board, truth_is, jinx, broken_record,
composite_brief, sport_of_week — 100% `missing_degraded_key` on every row, all
14/14 or fewer-day samples). Only 2 features (`night_stars`, `contradiction`)
actually compute and store it.

`!!r.degraded` maps "this feature's output format has no degraded concept at
all" to the exact same value (`false`) as "this feature ran and genuinely
confirmed itself not degraded." Practical effect: 9 of the 10 phases currently
shown by `session_health` report `degraded:false` as a coercion artifact every
single time, regardless of actual health — only `night_stars` is a real,
varying signal (5 true / 9 false in the last 14 days). This undermines
`session_health`'s own stated purpose for 90% of what it currently displays.

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write findings to outbox/cc-analytics-phases-degraded-null-preserve-2026-07-12.md.

## PROBE BLOCK

```bash
grep -n "phases\[r.feature\]" src/index.js
sed -n '12920,12940p' src/index.js
```
Confirm the line and query above it still match before editing. Also locate
the `respond(...)` call that returns `session_health`'s result (search forward
from `if (toolName === 'session_health')`) to confirm the exact MCP response
envelope shape before writing TASK 2's verification call — do not assume a
shape; find how this codebase's own existing probe/CI patterns already invoke
other MCP tools for real (e.g. how `get_ci_status` or `get_deploy_status` get
called in any existing post-probe.yml / cf-api-probe-style workflow) and reuse
that exact pattern rather than inventing a new invocation method.

## TASK 1 — Preserve "not tracked" as null, not false

Replace:
```javascript
if (!phases[r.feature])
    phases[r.feature] = { date: r.date, degraded: !!r.degraded };
```
with:
```javascript
if (!phases[r.feature])
    phases[r.feature] = { date: r.date, degraded: r.degraded == null ? null : !!r.degraded };
```

Not a fallback — no default substituted. `null` (key absent in the source JSON)
stays `null` in the response. `0`/`1` still become `false`/`true` exactly as
before for the two features that actually compute it.

## TASK 2 — Verification

```bash
node --check src/index.js
```

Then call the real `session_health` MCP tool (not a plain HTTP GET — this is
JSON-RPC over `/mcp`) using this repo's own established pattern for invoking
its MCP tools live, found via the probe block above. Confirm the actual
`analytics_phases` output shows `null` for the 12 features that don't track
degradation and a real `true`/`false` for `night_stars`/`contradiction` (if
either has a row in the last 2 days at call time — re-run the 14-day D1 query
above fresh if the exact current picture matters, don't assume the counts in
this doc are still current days from now).

## DONE CONDITION

The coercion no longer collapses "no degraded key in this feature's JSON" and
"confirmed not degraded" into the same value. Live-verified against a real
`session_health` tool call, not just `node --check`. This is a pure
signal-fidelity fix — it does not change which phases get computed or how,
only what the health report is honest about. If TASK 2's live call cannot be
completed for a real infrastructure reason (not a shortcut), report that
honestly and state exactly what was verified instead (e.g., a direct D1 query
simulating the same transform against real rows).

**Confidence scoring:**
- Probe confirms exact cited line AND the real response envelope shape before
  editing/verifying (20 pts)
- Replacement exactly mirrors the wentToOT pattern — null preserved, no
  default introduced (25 pts)
- `node --check` clean (10 pts)
- Live-verified against a real `session_health` call (not simulated) showing
  `null` for untracked phases and real booleans for the 1-2 that track it (30 pts)
- No unrelated fields in this function touched (15 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.

## ONE-LINER
```
git pull. Read docs/CC-CMD-2026-07-12-analytics-phases-degraded-null-preserve.md. Execute all tasks. Do not commit below 95 confidence.
```
