# Automation Loop — Quality + Session + Cron Alert — 2026-06-22

## Pre-build state check

```
grep -n "'/quality/report'|'/briefs/spot-check'|'/session/record'" src/index.js
→ none (Tasks 1-3 needed)

grep -n "session_health" src/index.js
→ none (Task 4 needed)

grep -n "_SPORT_NORMALIZE|FIELD_VOICE_REGISTER" src/{index,context-assembler,journalism-quality}.js
→ already present (from prior session ce1e878)
```

All four code tasks fresh. Task 5 (cron alert) added inside the existing
analyticsEngine orchestrator between Phase 8 and the weekly phase block.

## What ships (commit 621726e)

### Task 1 — GET /quality/report?days=N
Per-(brief_type, sport) rollup of scored vs unscored briefs over the
window (default 7, max 30). Returns:
- `summary[]`: total, scored, avg/min/max, below_150, above_200
- `alerts[]`: groups with `avg<170` OR `>30%` below-150 rate, requires
  ≥3 scored to fire
- `unscored_types[]`: groups with >5 briefs and ZERO quality_score
- 5-min cache header for client polling
Inserted at `src/index.js:7554` (after /budget/odds).

### Task 2 — GET /briefs/spot-check?n=N&source=&type=
Pulls N most recent briefs (default 5, max 20), scans body text against:
- Banned phrases (ABS/challenge fixation + cliché list)
- Cross-sport leak dictionary (golf→PPG, MLB→hat trick, etc.)
- Word-count out-of-range (30-120)
Returns `verdict: 'PASS'|'FAIL'|'no_briefs'` plus per-brief
`pass`, `flagged_phrases`, `cross_sport`, `preview`. Cache: no-store
so session-end template always sees fresh state.
Inserted at `src/index.js:7611`.

### Task 3 — POST /session/record
Records a session close into the existing `codex` table:
- Required body: `client_head`, `relay_head`, `summary`
- Optional: `smoke`, `sw_version`, `session_type`, `carry_forwards[]`,
  `drive_docs[]`
- Writes one `session` row keyed `session_{date}_{relay_head}` (upsert on
  conflict so re-records overwrite)
- Each carry-forward becomes its own `incident` row keyed
  `cf/{date}/{slug}` (insert-only — first ten written, no duplicates)
- Response anchor pre-formatted for write_handoff
Inserted at `src/index.js:7665`.

### Task 4 — session_health MCP tool
Machine-generated session-start snapshot. No inputs. Pulls in parallel:
- Client + relay HEADs (GitHub git/refs API)
- Last successful deploy.yml run + deploy_match flag
- Quality degradation over last 24h (avg<170 OR unscored>5)
- Analytics phase status today + yesterday (degraded flag from value JSON)
- Top-15 most recent codex `incident` rows
Tool definition added next to `read_handoff` in the tools array; handler
inserted before the `read_handoff` handler. Uses the existing
`ghHeaders(ghToken)` helper.

### Task 5 — Analytics Phase 8b: quality_alert
File: `src/analytics-engine.js`. After Phase 8, runs two queries against
`briefs` for `date=date` (yesterday in cron context) and writes a
`quality_alert` row only when results are non-empty. Wrapped in
try/catch so it never blocks the orchestrator. Phase recorded in
`phasesCompleted` / `phasesFailed` as `phase8b_quality_alert`.

Newspaper bundle (`/analytics/newspaper`) now reads
`recap.quality_alert.value` + `brief_text` and exposes the chip data
directly to the client.

### Task 6 — ALLOWED_PREFIX
`['/quality', '/briefs', '/session']` appended — single edit at
`src/index.js:9606`.

### Task 7 — docs/CC-CMD-TEMPLATE-session-end.md
Four-section checklist:
- A: spot-check verdict gate (no PASS → no `ok` session/record)
- B: POST /session/record curl with embedded git-rev-parse heads
- C: write_handoff MCP call using returned anchor
- D: codex_write per feature touched

## What was NOT done

- **Task 8 (Codex seeding)** — 86 rule entries via codex_write MCP.
  This requires post-deploy access to the MCP `codex_write` tool. The
  spec says "Take as many MCP calls as needed." I'm leaving this as a
  follow-up — it should run from a chat session that has MCP write
  access against the deployed worker (not the CC session itself, which
  is targeted at code changes per scope).

## Verify after deploy

```
# Endpoint surface (post-deploy)
GET /quality/report?days=7
GET /briefs/spot-check?n=5
POST /session/record  -d '{"client_head":"abc","relay_head":"def","summary":"test"}'

# MCP session_health: call from any MCP client (claude.ai connector etc.)

# Newspaper chip
GET /analytics/newspaper/2026-06-22
# After the next 09:00 UTC analytics cron, response.quality_alert is
# populated when degradation exists.
```

## Failure modes (silent per Rule 5)

- /quality/report empty rows → 200 with empty summary/alerts arrays.
- /briefs/spot-check ARCHIVE_DB read failure → 503 (table-bound check).
- /session/record carry-forward INSERT throw → `.catch(()=>{})`, the
  main session row still records.
- session_health any-component failure → that field reports
  'unavailable'; the other fields still populate.
- Phase 8b alert query throw → try/catch swallows, phase marked failed
  in `phasesFailed`, orchestrator continues to weekly/pick phases.

## Carry-forwards

1. **Codex rule seeding (Task 8)**. ~86 rules in CLAUDE.md need
   `codex_write` MCP calls. Open a chat session with MCP access and run
   them in batches.
2. **Newspaper client wiring**. The relay now exposes `quality_alert`
   in the newspaper bundle, but jubilant-bassoon doesn't render it yet.
   Companion client prompt needed.
3. **Phase 8b threshold tuning**. `avg<170` and `unscored>5` are the
   default gates. With the v4 voice register in flight, expect scores
   to rise — re-baseline after one week of data.
4. **session_health analytics_phases field**. Reads
   `JSON_EXTRACT(value, '$.degraded')` — works for phases that write
   `value.degraded = true`. Phases that signal degradation differently
   (e.g. via `value.adjustments = []`) won't surface here. Cross-check
   the analytics_output schema for each phase if the chip stays empty.
