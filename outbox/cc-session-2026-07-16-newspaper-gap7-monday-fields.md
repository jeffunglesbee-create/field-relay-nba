# CC Session 2026-07-16 — Newspaper Gap 7: Monday-Only Fields

## Date
2026-07-16

## Repos
- field-relay-nba (branch: claude/field-actuality-promises-gap-427jhz)
- jubilant-bassoon (branch: main)

## HEAD Progression

### field-relay-nba
- 91ed859 — feat(newspaper): expose Phase 6 Monday-only fields in /analytics/newspaper bundle
- 123560f — docs(contracts): add broken_record to newspaper bundle contract + expand Monday-only field shapes

### jubilant-bassoon
- e2234ea — feat(newspaper): render Phase 6 Monday-only sections in renderNewspaper

## What Was Built

### Gap 7 — Newspaper bundle: 3 Monday-only fields never assembled

**Problem:** `/analytics/newspaper/{date}` assembled morning_report, truth_is, night_stars, pick,
preview, streak_board, quality_feedback, completed_games — but the three Monday-only Phase 6
fields (sport_of_week, composite_brief, contradiction) were absent from the assembler, and
broken_record was missing from CONTRACTS.md entirely.

**Relay fix (src/index.js, 91ed859):**
Added 4 fields to the bundle object after `quality_alert`:
```js
sport_of_week:   recap.sport_of_week?.value        || null,
composite_brief: recap.composite_brief?.brief_text  || null,
contradiction:   recap.contradiction?.brief_text    || null,
broken_record:   recap.broken_record?.value         || null,
```
All four read from `recap` (yesterday's analytics_output) which already contains Phase 6 rows
when Monday morning cron ran. null on non-Monday days — client hides null sections per contract.

**CONTRACTS.md (both repos, 123560f / e2234ea):**
Added `broken_record: object | null // Monday only` entry and expanded all four field shape docs.

**Client render (index.html, e2234ea):**
In `renderNewspaper(bundle)`, inserted after Streak Board and before early-return guard:
- `composite_brief` → `<div class="np-section np-weekly"><div class="np-label">THE WEEK IN SPORTS</div>...`
- `contradiction` → `WHAT WE GOT WRONG`
- `sport_of_week.winner` → `SPORT OF THE WEEK` (uses sow.summary || sow.winner)
- `broken_record` not rendered — Phase 6D briefText is null (no prose); value shape is complex
  object. STAGED: needs its own render design (a chip list or table, not prose).

**SW_VERSION:** 2026-07-16c → 2026-07-16d

**Smoke:** 954 passed, 0 failed

## Integration Status
STAGED — relay now serves the fields; client now renders on Monday when analytics_output
has Phase 6 rows. Cannot verify E2E without next Monday morning cron cycle populating
analytics_output with sport_of_week, composite_brief, contradiction rows.

Unblock criteria:
- Monday morning cron must run (processingDay === 0 gate in analytics-engine.js)
- Verify: `SELECT feature, date FROM analytics_output WHERE feature IN ('sport_of_week','composite_brief','contradiction','broken_record') ORDER BY date DESC LIMIT 8`
- Verify relay: `curl /analytics/newspaper/YYYY-MM-DD` on next Monday → sport_of_week/composite_brief/contradiction should be non-null strings/objects
- Verify client: newspaper modal should show THE WEEK IN SPORTS, WHAT WE GOT WRONG, SPORT OF THE WEEK sections on Monday

## Open Carry-Forwards
- broken_record client render — Phase 6D has no briefText prose; needs chip/table design
- getDramaGateway() CC-CMD: docs/CC-CMD-2026-07-16-drama-gateway.md
- Broadcast chip durable fix: docs/CC-CMD-2026-07-16-broadcast-chip-durable-fix.md
- Frozen card / duplicate status fix
- wc_third_place_standings VIEW (2 live call sites will throw if hit)
- drama_arc JSON shape needs CONTRACTS.md entry
- Gap 5: enrichment.recentGames vs enrichment.history field name + team-scope
- Gap 6: enrichment.narratives/standings/wcMatchup brief types never written
