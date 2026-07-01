# Claude Code Command — Incident Resolved-Status Filter (session_health)

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-incident-resolved-status-2026-06-30.md.

## CONTEXT

`session_health`'s `open_incidents` field has no resolved-flag mechanism.
Confirmed by reading the live query directly (index.js ~11576-11582):

```js
const cf = await env.ARCHIVE_DB.prepare(`
    SELECT key, title FROM codex
    WHERE category = 'incident'
    ORDER BY updated_at DESC LIMIT 15
`).all();
out.open_incidents = (cf.results || []).map(r => r.title);
```

This always returns the 15 most-recently-*updated* rows in the
`incident` category, with zero filtering on whether the issue is
actually resolved. Two real incidents this session (smoke-regression
false alarm, odds-materializer mislabel) were independently diagnosed
and had their codex titles updated to start with "RESOLVED —", but that
is a cosmetic convention only — it does not remove them from
`open_incidents`. They stayed visible (title now self-describing, but
still surfaced as if open) purely because `updated_at DESC LIMIT 15`
happened to keep them in the recency window. Once 15 other incidents get
touched, a genuinely-resolved-but-never-flagged incident silently drops
off the list without ever having been marked resolved in a structured
way — indistinguishable from "still open, just old."

**CRITICAL CONSTRAINT — read before writing anything:** there is no
`CREATE TABLE codex` statement anywhere in `src/` (grepped, confirmed
absent) — the table was created via a one-off D1 migration outside the
repo, not an idempotent `CREATE TABLE IF NOT EXISTS` pattern like
`ensureBriefsTable`. This means:
- CC cannot introspect the live schema directly (no D1 access from the
  CC sandbox — same `*.workers.dev` egress block as every other CC-CMD
  this session, which also rules out live D1 access, not just HTTP).
- Any schema change MUST be written as a lazy, idempotent migration
  inside the Worker code (wrap `ALTER TABLE codex ADD COLUMN status TEXT`
  in try/catch and swallow the "duplicate column" error on repeat runs —
  do not assume `ADD COLUMN IF NOT EXISTS` syntax is supported without
  verifying; the try/catch approach is safe regardless of syntax
  support and matches the idempotency pattern already used by
  `ensureBriefsTable` elsewhere in this file).
- The actual DATA backfill (marking the 2-3 already-known-resolved
  incidents as resolved) cannot happen inside the CC session either,
  for the same egress reason — it happens chat-side after deploy, via
  the now-extended `codex_write` tool. This mirrors the exact pattern
  used by every other CC-CMD this session (closing-odds capture,
  KV-brief backfill): CC builds the mechanism, chat runs the live data
  operation afterward. State this explicitly in the outbox doc so it
  isn't mistaken for an incomplete task.

## PRE-BUILD PROBE (read every symbol below from HEAD before writing anything — Rule 87)

```bash
grep -n "toolName === 'codex_write'" src/index.js
sed -n '12106,12127p' src/index.js   # current codex_write handler
grep -n "open_incidents\|category = 'incident'" src/index.js
sed -n '11570,11583p' src/index.js   # current session_health incident query
grep -n "'codex_write'" src/index.js | grep -i "tools/list\|description\|inputSchema"
grep -n "async function ensureBriefsTable" src/index.js   # idempotency pattern to mirror
```

Confirm the exact `tools/list` JSON schema block for `codex_write` (used
by the MCP tool declaration, separate from the handler) before editing
it — find it via the grep above, don't assume its location.

## TASK 1: Idempotent schema migration

Add a small helper mirroring `ensureBriefsTable`'s pattern:

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

Call this at the top of the `codex_write` handler and inside
`session_health`'s incident-query try block, before either touches the
`status` column. Memoized exactly like `ensureBriefsTable` — cheap
no-op after the first successful call per isolate.

## TASK 2: Extend `codex_write` to accept optional `status`

Handler (~line 12106-12127): destructure an optional `status` from
`toolArgs`. On insert, default to `'open'` if not provided. On update
(`ON CONFLICT`), only overwrite `status` if explicitly provided —
preserve the existing value otherwise, using the same
`COALESCE(excluded.x, x)` pattern already used throughout this file for
exactly this "don't overwrite unless told" semantics (see `/archive/game`
handler for reference):

```js
const { key, category, title, content, drive_refs, status } = toolArgs;
...
await ensureCodexStatusColumn(env);
await env.ARCHIVE_DB.prepare(`
    INSERT INTO codex (key, category, title, content, drive_refs, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
        category = excluded.category,
        title    = excluded.title,
        content  = excluded.content,
        drive_refs = excluded.drive_refs,
        status   = COALESCE(?, status),
        updated_at = datetime('now')
`).bind(key, category, title, content, drive_refs || null, status || 'open', status || null).run();
```

Note the `status` bind appears twice — once for the INSERT branch
(defaults `'open'` for a brand new row) and once for the UPDATE branch's
`COALESCE(?, status)` (passes `null` when not provided, so COALESCE
falls through to the existing stored value). Verify this binding order
matches D1's positional-parameter behavior before committing — read how
other dual-purpose INSERT-with-COALESCE statements in this file handle
repeated bind values (the `/archive/game` handler's `ON CONFLICT DO
UPDATE ... COALESCE(excluded.x, x)` pattern is different — it reads
from `excluded.x` rather than a second bind — decide which pattern is
correct here by checking whether `status` should follow the
`COALESCE(excluded.status, status)` form instead, which would need only
ONE bind of `status`, not two. Prefer the `excluded.status` form if it
works, since it's the pattern already proven elsewhere in this codebase
— only fall back to a duplicate bind if `excluded` isn't accessible in
that context for some D1-specific reason. Confirm before shipping,
don't guess.

Also update the `codex_write` tool's `tools/list` JSON schema
declaration to document the new optional `status` string parameter.

## TASK 3: Filter `session_health`'s incident query

```js
const cf = await env.ARCHIVE_DB.prepare(`
    SELECT key, title FROM codex
    WHERE category = 'incident' AND (status IS NULL OR status != 'resolved')
    ORDER BY updated_at DESC LIMIT 15
`).all();
```

`status IS NULL` covers every pre-migration row (backward compatible —
nothing pre-existing gets silently hidden or exposed incorrectly by the
migration itself).

## TASK 4: Verification — CC-side scope is build/CI only

Same constraint as every CC-CMD this session: CC's egress blocks
`*.workers.dev`. Done condition is code committed, CI green, deploy
completed (GitHub Actions API, not the live endpoint). State explicitly
in the outbox doc that (a) the schema migration firing correctly, (b)
`codex_write` correctly accepting/preserving `status`, and (c) the data
backfill of already-known-resolved incidents are ALL chat-side
follow-ups — none of the three are checkable from inside CI.

## TASK 5: Outbox manifest (last task)

Write `outbox/cc-incident-resolved-status-2026-06-30.md` covering: which
COALESCE pattern was actually used for the status field and why, the
exact diff, CI/deploy status, and explicit confirmation that no live D1
operation was attempted from inside the CC session.
