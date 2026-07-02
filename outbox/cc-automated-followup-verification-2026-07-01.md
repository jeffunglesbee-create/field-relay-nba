# Outbox — Automated Follow-Up Verification Workflow

**Date:** 2026-07-02
**Relay HEAD:** 04c7894
**CC-CMD:** docs/CC-CMD-2026-07-01-automated-followup-verification.md
**Status:** SHIPPED

---

## Pre-Build Probe Results

| Probe | Finding |
|-------|---------|
| `/d1/execute` location | `src/index.js:9628` |
| Auth header | `X-FIELD-Relay: field-relay-cron-2026` ✓ |
| Request shape | `{ sql, params }` — `params` spread-bound via `stmt.bind(...params)` ✓ |
| Response shape | `{ success: true, results: [...], meta: {...} }` — Python uses `savant.get('results', ...)` ✓ |
| `ALLOWED_TABLES` | `['odds_history', 'odds_backfill_progress', 'regular_season_games', 'postseason_games', 'change_log', 'analytics_output', 'briefs']` — **`codex` was missing** |
| `codex` table schema (via D1 query) | `key TEXT PRIMARY KEY, category TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, drive_refs TEXT, status TEXT DEFAULT 'open'` — `ON CONFLICT(key) DO UPDATE` syntax confirmed valid ✓ |

---

## Bug Found and Fixed During Probe

**`codex` was not in `/d1/execute`'s `ALLOWED_TABLES`.** The workflow's codex-write step would have returned 403, crashing the Python step with `HTTPError`. Fixed by adding `'codex'` to `ALLOWED_TABLES` in `src/index.js:9644` — a direct requirement of the CC-CMD, not a scope expansion.

---

## What Was Built

### `.github/workflows/verify-pending-checks.yml` (new)

Triggers: `schedule: '0 */6 * * *'` (every 6 hours) + `workflow_dispatch`.

**Step 1** (`savant`): `SELECT COUNT(*) as n FROM change_log WHERE source = ?` with params `["savant"]`. Confirms xERA reconcile pipeline has written to change_log.

**Step 2** (`journalism`): `SELECT COUNT(*) as n FROM briefs WHERE source = ?` with params `["completion-trigger"]`. Confirms game-completion journalism has produced at least one brief.

**Step 3**: Python reads both step outputs. Prints counts unconditionally. Only POSTs to codex (upsert on `auto-verify-{date}` key, category `verification`) if `savant_n > 0 OR journalism_n > 0` — avoids spamming codex on every 6h tick when conditions aren't yet met.

### `src/index.js:9644` — `codex` added to `ALLOWED_TABLES`

Required for the workflow's codex write step. `codex` is a legitimate ARCHIVE_DB table (used by MCP `codex_write`, `/session/record` endpoint, and the whole session handoff infrastructure) — its omission from the allowlist was an oversight.

---

## YAML Fix Applied

The CC-CMD's Python block had 0-indented lines after a 10-space-indented `python3 -c "` line. YAML block scalars terminate when a content line has less indentation than the first content line — the 0-indented Python lines were breaking out of the block scalar. Fixed by indenting all Python lines to 10 spaces (the YAML parser strips the 10-space block indent before the shell sees the code; Python sees clean 0-indented top-level code).

---

## Verification

- `python3 -c "import yaml; yaml.safe_load(open(...))"` → **YAML VALID**
- Python logic dry-run with `savant_n=0, journalism_n=0` → correctly printed `Neither condition met yet — no codex write, avoiding noise.`
- `node -c src/index.js` → **SYNTAX OK**
- Pre-commit hook: `✅ Branch + syntax checks passed`

---

## Chat-Side Follow-Up (one-time, per CC-CMD)

Trigger `verify-pending-checks.yml` via `workflow_dispatch` once to confirm it runs cleanly (curl returns 200 from both D1 queries, Python executes without error). After that, the schedule takes over — no more manual checks needed for these two conditions.
