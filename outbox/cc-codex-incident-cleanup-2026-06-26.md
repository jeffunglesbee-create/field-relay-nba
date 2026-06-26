# Codex Incident Cleanup — 2026-06-26

MCP-only CC-CMD. No source edits, no deploys. Three codex entries
re-categorized via `codex_write` to drop stale items from
`session_health.open_incidents`.

## Writes performed

| Key | Before | After | Title (after) |
|-----|--------|-------|---------------|
| `cf/2026-06-22/assemblecontext-sport-label-mismatch--g` | `incident` | `resolved` | assembleContext sport-label mismatch — RESOLVED (7b08e5c 8e38dc1 8791ef6) |
| `cf/2026-06-22/assemblecontext-sport-label-mismatch-gol` | `incident` | `resolved` | assembleContext sport-label mismatch — RESOLVED (7b08e5c 8e38dc1 8791ef6) |
| `bsd-endgame-cron-validation-june26` | `incident` | `fix` | BSD endgame cron validated live — 02:00Z MD3 games (June 26 2026) |

The two `cf/...` mismatch entries pointed at the same problem (golf/WNBA/WC
games getting empty CONTEXT_SOURCES). Both were already fixed in the
2026-06-26 deploy chain (`7b08e5c` → `8e38dc1` → `8791ef6`). The
`bsd-endgame-cron-validation-june26` record was a validation log, not a
live incident — re-categorized to `fix` so it stops surfacing as an open
issue.

Content preserved verbatim on the bsd-endgame entry (drive_refs included).
The two mismatch entries got short resolved-summaries pointing at codex
key `context-assembler-sport-label-fix-june26` for the fix detail.

## Verification

### Pre-cleanup `session_health.open_incidents` (15 items)

```
BSD endgame cron validated live — 02:00Z MD3 games (June 26 2026)    ← target #3
Odds Story Materializer — CC-CMD exists (...)
assembleContext sport-label mismatch — golf/WNBA still get empty context    ← target #1
wentToOT hardcoded false in newspaper (...)
KV editorial keys not consulted by newspaper endpoint
nba_clutch + nhl_series R2 stale — seasons over, heals Oct/Nov
API-Sports Football Pro renewal — JUNE 29 DEADLINE
Stale Data Sentinel (/health/sources) — CC-CMD exists, unexecuted
Odds Story Materializer — CC-CMD exists, unexecuted
Smoke regression 724 to 663 — root cause unknown
assembleContext sport-label mismatch golf/WNBA/WC empty context    ← target #2
Phase 8b quality_alert threshold tuning after June 29
API-Sports Football Pro renewal decision — JUNE 29 DEADLINE
NFL SPORT_TO_V2 — September 9 deadline
Phase 8b threshold tuning after June 29
```

### Post-cleanup `session_health.open_incidents` (15 items)

Three targeted titles gone:
- ✗ `BSD endgame cron validated live...`
- ✗ `assembleContext sport-label mismatch — golf/WNBA still get empty context`
- ✗ `assembleContext sport-label mismatch golf/WNBA/WC empty context`

Three older entries surfaced into the freed slots (session_health appears
to pull a fixed quota of next-oldest incidents):
- `session_health phase degradation signal gap`
- `/session/record POST — "Method not allowed" from direct curl, needs CC verification`
- `session_health analytics_phases — not all degradation signals use value.degraded`

These are pre-existing entries, not regressions — they were simply queued
behind the three we cleared. They're separate cleanup work if any.

### `codex_read` confirmation (post-write)

- `bsd-endgame-cron-validation-june26.category` = `"fix"` ✓
  (content + drive_refs preserved verbatim)
- `cf/2026-06-22/assemblecontext-sport-label-mismatch--g.category` = `"resolved"` ✓
- `cf/2026-06-22/assemblecontext-sport-label-mismatch-gol.category` = `"resolved"` ✓

## Done conditions

- [x] No file commits, no deploys (MCP `codex_write` only)
- [x] Three targeted titles removed from `open_incidents`
- [x] `bsd-endgame-cron-validation-june26` now under `category: fix`
- [x] No duplicate `assembleContext sport-label mismatch` entries surfacing

## Note on the underlying fix

The codex key `context-assembler-sport-label-fix-june26` (category: `fix`,
written earlier in this session by another step) holds the full root cause +
fix detail referenced by both resolved entries. Anyone investigating "what
happened with the sport-label mismatch?" should read that record.

## Compliance

- **Rule 47**: Classification only (incident → resolved/fix). No editorial.
- **Rule 80**: No credentials handled. MCP tools resolve auth server-side.
- **Rule 87**: Self-completing. Spec executed verbatim; no carry-forward.
