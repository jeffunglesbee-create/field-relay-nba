# Outbox — Generic Savant Reconcile-Sync Endpoint (Corrected v2)

**Date:** 2026-07-02
**Relay HEAD:** 7542011
**CC-CMD:** docs/CC-CMD-2026-07-01-savant-xera-reconcile-relay.md (CORRECTED v2 — supersedes original bespoke endpoint version)
**Status:** SHIPPED (branch claude/zealous-brahmagupta-tm92w3; syntax verified, awaiting merge to main for deploy)

---

## Pre-Build Probe Results

| Probe | Finding |
|-------|---------|
| `grep -n "^async function reconcile" src/sync-reconciler.js` | Line 74: `async function reconcile(env, spec)` |
| `reconcile()` signature | `(env, { target, updates, changelog })` where `updates: Array<{id, fields: {col: val}}>` |
| `reconcile()` SQL injection guard | Regex `/^[a-zA-Z_][a-zA-Z0-9_]*$/` on both `target` and field names — prevents SQLi but NOT target scope (caller's responsibility) |
| `reconcile()` first-population behavior | `currentById[u.id]` is `{}` for unknown rows; `_changed(undefined, val)` → `undefined` coerced to `null` → non-null val is "changed" → would diff and changelog-write without INSERT OR IGNORE guard |
| INSERT-then-reconcile sequencing | CONFIRMED: INSERT OR IGNORE seeds row with same values → reconcile SELECT finds the row → no diffs → no change_log entry on first population ✓ |
| Existing `CREATE TABLE IF NOT EXISTS` pattern | `ensureBriefsTable()` at line 4193 + `_briefsReady` memoization flag; `ensureCodexStatusColumn()` at 4215 |
| POST allow-list location | `src/index.js:8461` — explicit AND-chain of `!(pathname === X && method === 'POST')` expressions |
| Savant-adjacent endpoint | `/mlb-savant-update` at line 10944 — good insertion point for `/savant/sync` |

---

## What Was Built

### `src/index.js` — three changes

**1. `_SYNC_TABLE_SCHEMAS` allowlist + `ensureSyncTable()` helper (inserted after `ensureCodexStatusColumn`, line 4226):**
```js
const _SYNC_TABLE_SCHEMAS = {
    pitcher_expected_stats: `
        CREATE TABLE IF NOT EXISTS pitcher_expected_stats (
            id TEXT PRIMARY KEY,
            era REAL,
            xera REAL,
            updated_at TEXT DEFAULT (datetime('now'))
        )`,
    // Future: team_expected_stats, sprint_speed_tracking, etc. — add here,
    // not as new endpoints.
};

async function ensureSyncTable(env, table) {
    const ddl = _SYNC_TABLE_SCHEMAS[table];
    if (!ddl) throw new Error(`sync target not allowlisted: ${table}`);
    await env.ARCHIVE_DB.prepare(ddl).run();
}
```

**2. POST allow-list entry (line 8487):**
```js
&& !(pathname === '/savant/sync' && request.method === 'POST')
```

**3. `POST /savant/sync` endpoint (inserted after `/mlb-savant-update` block, line 10982):**
- Validates `table` against `_SYNC_TABLE_SCHEMAS` → 400 if not allowlisted
- Returns 202 if `rows` empty or `ARCHIVE_DB` unbound (no-op, not an error)
- `ensureSyncTable()` → `CREATE TABLE IF NOT EXISTS pitcher_expected_stats ...`
- INSERT OR IGNORE loop seeds unseen ids without triggering reconcile diff
- Builds `updates: [{id, fields}]` from rows, calls `reconcile(env, {target, updates, changelog})`
- Returns `{ok: true, synced, changes_logged}`; full try/catch returns 500 on any error

---

## Done Condition

Per CC-CMD: "syntax valid, matches the real `reconcile()` signature confirmed in probe, `pitcher_expected_stats` present in `_SYNC_TABLE_SCHEMAS`."

- `node -c src/index.js` → **SYNTAX OK**
- `reconcile(env, {target, updates, changelog})` signature confirmed at `sync-reconciler.js:74` ✓
- `pitcher_expected_stats` in `_SYNC_TABLE_SCHEMAS` at `src/index.js:4230` ✓

---

## Allowlist Pattern — Extension Point

This replaces the original bespoke-endpoint version of this CC-CMD. The `_SYNC_TABLE_SCHEMAS` object is the intended extension point for every future Savant/lineup/weather/injury field:
- Add a new key + DDL to `_SYNC_TABLE_SCHEMAS` in `src/index.js`
- Call `POST /savant/sync` with `table: '<new_table>'`
- No new endpoint, no new route, no new reconciler call site

Every future Savant field (sprint speed, team ABS, tempo, eventually lineup/weather/injury) uses this one path. Per-field precision (`isMaterialChange()` thresholds) stays bespoke inside `brief-freshness.js` — only the fetch→write→diff→log plumbing is shared.

---

## Chat-Side Follow-Up

Once the companion client-side CC-CMD lands and a real cron run POSTs to `/savant/sync` with `table: 'pitcher_expected_stats'`, confirm via direct D1 query:
```sql
SELECT * FROM change_log WHERE source = 'savant' ORDER BY ts DESC LIMIT 5;
```
Expected: zero rows on first run (first-population guard working), one row per changed field on subsequent runs.

---

## Branch Note

Committed to `claude/zealous-brahmagupta-tm92w3` per session environment directive (not directly to main). CI does not trigger on non-main branches. Syntax check is the verifiable done condition from within the sandbox; end-to-end deploy verification requires merge to main.
