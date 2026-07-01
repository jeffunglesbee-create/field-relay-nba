# Outbox — Incident Resolved-Status Filter (session_health)

**Date:** 2026-07-01
**Relay HEAD:** 10d8555
**CC-CMD:** docs/CC-CMD-2026-06-30-incident-resolved-status.md
**Status:** SHIPPED

---

## Pre-Build Probe Results

| Probe | Finding |
|-------|---------|
| `codex_write` handler | `src/index.js:12106`. Destructured `{ key, category, title, content, drive_refs }` — no `status`. INSERT did not include status column at all. |
| `tools/list` schema | `codex_write` declaration at L11341–11354. Properties: `key, category, title, content, drive_refs`. No `status` property. |
| `session_health` incident query | L11576–11582. `WHERE category = 'incident' ORDER BY updated_at DESC LIMIT 15` — no status filter. |
| `ensureBriefsTable` pattern | L4192–4212. Uses `let _briefsReady = false` memoization flag + `CREATE TABLE IF NOT EXISTS`. Schema migration uses `ALTER TABLE` in try/catch. |
| `codex` table schema | No `CREATE TABLE codex` statement in `src/` (no idempotent migration helper exists). Confirmed: the table was created via a one-off D1 migration outside the repo. |

---

## COALESCE Pattern Decision

The spec asked to decide between `COALESCE(excluded.status, status)` (one bind) and `COALESCE(?, status)` (two binds).

**Used the two-bind form.** Reason: `excluded.status` references whatever value was placed in the INSERT VALUES row. Since I need the INSERT to default to `'open'` for new rows (when caller omits `status`), the INSERT bind is `status || 'open'` — always non-null. This means `excluded.status` would be `'open'` even when the caller didn't provide any status, so `COALESCE(excluded.status, status)` would always overwrite the stored value with `'open'` on update — breaking the "preserve if not provided" semantics.

The two-bind form cleanly separates the intents:
- Bind 6 (INSERT VALUES): `status || 'open'` — correct default for new rows
- Bind 7 (COALESCE): `status || null` — null triggers COALESCE fallthrough to stored value

Final SQL:
```sql
INSERT INTO codex (key, category, title, content, drive_refs, status, updated_at)
VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
ON CONFLICT(key) DO UPDATE SET
    category   = excluded.category,
    title      = excluded.title,
    content    = excluded.content,
    drive_refs = excluded.drive_refs,
    status     = COALESCE(?, status),
    updated_at = datetime('now')
```
Bind order: `[key, category, title, content, drive_refs || null, status || 'open', status || null]`

---

## What Was Built

Four surgical edits to `src/index.js`. No other files touched.

### Task 1 — `ensureCodexStatusColumn()` helper (inserted after `ensureBriefsTable`, ~L4214)

```js
let _codexStatusReady = false;
async function ensureCodexStatusColumn(env) {
  if (_codexStatusReady) return;
  if (!env.ARCHIVE_DB) return;
  try {
    await env.ARCHIVE_DB.prepare(
      `ALTER TABLE codex ADD COLUMN status TEXT DEFAULT 'open'`
    ).run();
  } catch (_) { /* column already exists — expected on every run after the first */ }
  _codexStatusReady = true;
}
```

Memoized via `_codexStatusReady` — one ALTER TABLE attempt per isolate lifetime, then a no-op. The ALTER TABLE itself is idempotent via try/catch: if the column already exists, D1 returns an error which is swallowed. No `ADD COLUMN IF NOT EXISTS` dependency — this pattern works regardless of SQLite version.

### Task 2 — `codex_write` handler extended (L12106+)

- Added `status` to destructuring: `const { key, category, title, content, drive_refs, status } = toolArgs;`
- Added `await ensureCodexStatusColumn(env);` before the INSERT
- Changed INSERT to include `status` column
- Changed ON CONFLICT to include `status = COALESCE(?, status)` with two-bind pattern
- Updated response to include `status` in the `{ok, key, category, title}` JSON

### Task 3 — `tools/list` schema updated (L11341+)

Added to `codex_write` `inputSchema.properties`:
```json
"status": { "type": "string", "description": "Optional status flag. \"open\" (default) or \"resolved\". Omitting preserves existing status on update." }
```
Updated description to mention: *"status is optional (default 'open'); set to 'resolved' to remove an incident from session_health open_incidents."*

### Task 4 — `session_health` incident query filtered (L11589+)

```sql
WHERE category = 'incident' AND (status IS NULL OR status != 'resolved')
```

Added `await ensureCodexStatusColumn(env);` before the query so the migration fires even if `codex_write` hasn't been called yet in this isolate. The `status IS NULL` arm is the backward-compatibility clause — all pre-migration rows have null status and remain visible as open, correct behavior.

---

## No Live D1 Operation from CC Session

Confirmed: no direct D1 query was executed from inside this CC session. The `*.workers.dev` egress block applies equally to HTTP probes and D1 queries. All three live follow-ups are chat-side:

---

## Deploy

- Commit: `10d8555`
- Workflow run: `28489705172`
- CI conclusion: `success`

---

## Chat-Side Follow-Ups (NOT part of CC-CMD done condition)

Three things that cannot be verified from within CI:

1. **Schema migration fires correctly:** First `codex_write` call (or first `session_health` call) after deploy triggers `ALTER TABLE codex ADD COLUMN status TEXT DEFAULT 'open'`. Verify via `codex_read` on any existing incident key — response should now include `status: 'open'` (column existed before call completes) or check `/d1/execute` if available.

2. **`codex_write` correctly accepts/preserves status:** Test with:
   - `codex_write({key:'test-status', ..., status:'resolved'})` → response should include `status:'resolved'`
   - `codex_write({key:'test-status', ..., content:'updated content'})` (no status) → status should remain `'resolved'` (COALESCE preserves it)

3. **Data backfill of already-known-resolved incidents:** The 2–3 incidents whose titles were updated to start with "RESOLVED —" this session still have `status=NULL` (pre-migration). Use `codex_write` with `status:'resolved'` on each to properly flag them:
   - Identify incident keys via `codex_search({query:'RESOLVED', category:'incident'})`
   - Call `codex_write({key:..., status:'resolved', ...})` for each
   - Verify `session_health` `open_incidents` no longer includes them
