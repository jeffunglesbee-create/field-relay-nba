# Claude Code Command — Generic Savant Reconcile-Sync Endpoint (CORRECTED v2)

**SUPERSEDES the original version of this file** (identical filename,
overwritten before execution — the original built a bespoke
`pitcher_expected_stats`-only endpoint. That was wrong, caught before
running, not after. See CONTEXT.

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-savant-xera-reconcile-2026-07-01.md.

## CONTEXT — why this differs from the original

`reconcile()` (`src/sync-reconciler.js`) is already fully generic —
`target`, `updates`, `changelog: {source, label}`, arbitrary table/field
names, with its own regex-based injection safety. The original version
of this CC-CMD built a bespoke `pitcher_expected_stats` table and a
bespoke `/savant/sync-pitcher-xera` endpoint hardcoding that one table
and two field names — adding unnecessary specificity on top of a
primitive that didn't need it. The exact same proliferation mistake was
found and corrected twice already this session (ESPN GOTD stores, name-
normalization schemes): N bespoke wirings instead of one shared
mechanism. Every future Savant field (sprint speed, team ABS, tempo —
and eventually lineup/weather/injury) would otherwise need its own
near-identical endpoint.

**Correction: one generic endpoint, with an explicit table allowlist**
(not unrestricted — an unrestricted `{table, updates}` endpoint would
let any caller write to any D1 table, a real scope-widening `reconcile()`
itself doesn't prevent; it only prevents SQL injection, not target
scope). The per-field precision that actually matters —
`isMaterialChange()`'s favorite-flip/magnitude-threshold/exact-match
logic — is untouched by this change and stays exactly as bespoke as it
needs to be. Only the fetch→write→diff→log plumbing is shared.

## PRE-BUILD PROBE (Rule 87)

```bash
grep -n "^async function reconcile" src/sync-reconciler.js
sed -n '4510,4535p' src/index.js
grep -n "CREATE TABLE" src/index.js | head -10
```

Confirm the real `reconcile()` signature and an existing lazy table-
creation pattern before writing anything.

## TASK 1: Table creation helper, generic across an allowlist

```javascript
// Allowlisted target tables for the generic sync endpoint below. Add an
// entry here (schema + name) each time a genuinely new Savant/lineup/
// weather/injury tracking table is needed — this is the one place that
// grows, not a new endpoint each time.
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

## TASK 2: Generic endpoint — POST /savant/sync

```javascript
// POST /savant/sync — generic reconcile-sync endpoint for Savant (and
// eventually lineup/weather/injury) data. Body: { table, rows: [{id,
// ...fields}], source, label }. `table` must be in _SYNC_TABLE_SCHEMAS
// (allowlist — this is the scope guard reconcile() itself doesn't
// provide). This is the ONE ingestion path for any field that needs to
// reach change_log; per-field materiality logic stays in
// isMaterialChange(), untouched by this endpoint.
if (pathname === '/savant/sync' && request.method === 'POST') {
    try {
        const body = await request.json().catch(() => null);
        const { table, rows, source, label } = body || {};
        if (!table || !_SYNC_TABLE_SCHEMAS[table]) {
            return new Response(JSON.stringify({ ok: false, error: 'table not allowlisted' }),
                { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        if (!Array.isArray(rows) || !rows.length || !env.ARCHIVE_DB) {
            return new Response(JSON.stringify({ ok: true, synced: 0 }),
                { status: 202, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        await ensureSyncTable(env, table);

        // First-population guard: seed unseen ids without a changelog
        // write — INSERT OR IGNORE before reconcile()'s diff, matching
        // the odds branch's existing "first population is not material"
        // rule. Column set derived from the first row's field keys
        // (excluding 'id') — validated by reconcile()'s own regex check
        // on the way through, not re-validated here.
        const fieldKeys = Object.keys(rows[0]).filter(k => k !== 'id');
        for (const r of rows) {
            if (!r.id) continue;
            const cols = ['id', ...fieldKeys];
            const placeholders = cols.map(() => '?').join(',');
            const vals = cols.map(c => c === 'id' ? r.id : (r[c] ?? null));
            await env.ARCHIVE_DB.prepare(
                `INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`
            ).bind(...vals).run();
        }

        const updates = rows.filter(r => r.id).map(r => {
            const fields = {};
            for (const k of fieldKeys) fields[k] = r[k] ?? null;
            return { id: r.id, fields };
        });
        const result = await reconcile(env, {
            target: table,
            updates,
            changelog: { source: source || 'savant', label: label || table },
        });
        return new Response(JSON.stringify({ ok: true, ...result }),
            { headers: { ...CORS, 'Content-Type': 'application/json' } });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
}
```

**Verify the INSERT-then-reconcile sequencing against `reconcile()`'s
real diff logic during the probe step** — confirm a genuinely-new row
produces no changelog entry (correct, matches "first population is not
material"), don't assume the reasoning above is airtight without
checking.

## TASK 3: Verification

```bash
node -c src/index.js
```

Cannot be verified end-to-end from the CC sandbox. Done condition:
syntax valid, matches the real `reconcile()` signature confirmed in
probe, `pitcher_expected_stats` present in `_SYNC_TABLE_SCHEMAS`.

**Chat-side follow-up:** once the companion client-side CC-CMD lands
and a real cron run POSTs to `/savant/sync` with
`table: 'pitcher_expected_stats'`, confirm via direct D1 query that
`change_log` finally has a `source: 'savant'` row.

## TASK 4: Outbox manifest (last task)

Note explicitly this replaces the original bespoke-endpoint version,
and that the allowlist pattern is the intended extension point for
every future Savant/lineup/weather/injury field, not a new endpoint per
field.
