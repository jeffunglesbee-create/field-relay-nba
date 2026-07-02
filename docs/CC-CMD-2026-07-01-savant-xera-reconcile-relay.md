# Claude Code Command — Wire Savant Pitcher xERA Into change_log (Relay Side)

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-savant-xera-reconcile-2026-07-01.md.

## CONTEXT

Verified directly: `change_log` has exactly two `source` values ever
written — `odds_api`, `odds_backfill`. Zero Savant, lineup, weather, or
injury entries. `isMaterialChange()`'s Savant/lineup/weather/injury
branches are ALL currently unreachable, not just xERA — only odds has
ever flowed through `reconcile()`. This CC-CMD builds the missing write
path for pitcher xERA specifically (the immediate need); it does NOT
attempt to fix lineup/weather/injury in the same pass — those are
separate, equally-real gaps, explicitly out of scope here.

Confirmed live: `baseballsavant.mlb.com/leaderboard/expected_statistics
?type=pitcher&year=2026&min=50&csv=true` returns real data with a
genuine `xera` column (Alcantara 3.88, Gausman 3.75, etc.) — the source
data is real and available; it has simply never been fetched by
anything in FIELD, and even if fetched, nothing currently writes
Savant-sourced values into a D1 table for `reconcile()` to diff against.

**Architecture: mirror the completion-triggered-journalism pattern
already shipped tonight (commit a89e71e).** A separate script/process
POSTs bare fetched data to a new relay endpoint; the relay endpoint does
all D1/reconcile work. Nothing decides "is this material" outside
`reconcile()`+`isMaterialChange()` — this endpoint's job is only to get
real numbers into the table.

## PRE-BUILD PROBE (Rule 87)

```bash
grep -n "^async function reconcile" src/sync-reconciler.js
sed -n '4510,4535p' src/index.js
grep -n "CREATE TABLE" src/index.js | head -10
```

Confirm the real `reconcile()` signature and an existing table-creation
pattern (e.g. the lazy `ALTER TABLE`/`CREATE TABLE IF NOT EXISTS`
pattern used for the codex `status` column earlier this session) before
writing the new table's schema.

## TASK 1: Create pitcher_expected_stats table (lazy creation, idempotent)

```javascript
async function ensurePitcherExpectedStatsTable(env) {
    await env.ARCHIVE_DB.prepare(`
        CREATE TABLE IF NOT EXISTS pitcher_expected_stats (
            id TEXT PRIMARY KEY,
            era REAL,
            xera REAL,
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `).run();
}
```

Verify this exact schema against what `reconcile()`'s `SELECT id, ${cols}`
pattern actually requires — confirm `id` as primary key is sufficient,
don't assume without checking `reconcile()`'s real SELECT/UPDATE logic
from the probe step.

## TASK 2: New endpoint — POST /savant/sync-pitcher-xera

```javascript
// POST /savant/sync-pitcher-xera — receives bare {id, era, xera} rows
// from the mlb-weekly-update.yml cron (jubilant-bassoon repo), writes
// them through reconcile() so real changes reach change_log with
// source:'savant', field:'xera'. This is the first real Savant write
// path into change_log — previously only odds ever reached it.
if (pathname === '/savant/sync-pitcher-xera' && request.method === 'POST') {
    try {
        const body = await request.json().catch(() => null);
        const rows = Array.isArray(body?.rows) ? body.rows : [];
        if (!rows.length || !env.ARCHIVE_DB) {
            return new Response(JSON.stringify({ ok: true, synced: 0 }),
                { status: 202, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        await ensurePitcherExpectedStatsTable(env);

        // First-population guard: insert any ids that don't exist yet
        // WITHOUT a changelog write (matches the odds branch's existing
        // "old_value === null is not material" rule) — reconcile()
        // diffs existing rows, it doesn't create new ones, so a plain
        // INSERT OR IGNORE seeds first-seen pitchers silently.
        for (const r of rows) {
            if (!r.id) continue;
            await env.ARCHIVE_DB.prepare(
                `INSERT OR IGNORE INTO pitcher_expected_stats (id, era, xera) VALUES (?, ?, ?)`
            ).bind(r.id, r.era ?? null, r.xera ?? null).run();
        }

        const updates = rows.filter(r => r.id).map(r => ({
            id: r.id,
            fields: { era: r.era ?? null, xera: r.xera ?? null },
        }));
        const result = await reconcile(env, {
            target: 'pitcher_expected_stats',
            updates,
            changelog: { source: 'savant', label: 'pitcher_xera' },
        });
        return new Response(JSON.stringify({ ok: true, ...result }),
            { headers: { ...CORS, 'Content-Type': 'application/json' } });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
}
```

**Verify the INSERT-then-reconcile sequencing doesn't produce a false
first-run change_log entry** — `reconcile()`'s SELECT happens after the
`INSERT OR IGNORE`, so a genuinely new row would already exist with the
new value before `reconcile()` diffs it, meaning no change would be
detected (correct — matches "first population is not material"). But
confirm this against `reconcile()`'s real diff logic in the probe step
rather than assuming this reasoning is airtight — if `reconcile()`
compares against a value fetched in the SAME request before the
`INSERT OR IGNORE`, the sequencing could be wrong. Check, don't assume.

## TASK 3: Verification

```bash
node -c src/index.js
```

Cannot be verified end-to-end from the CC sandbox (no way to POST real
data and observe `change_log` from inside CC's environment). Done
condition: syntax valid, matches the real `reconcile()` signature
confirmed in probe.

**Chat-side follow-up (not checkable by CC):** once the companion
client-side CC-CMD (jubilant-bassoon, fetches real pitcher xERA and
POSTs here) also lands and a real weekly cron run happens, verify via
direct D1 query that `change_log` finally has at least one `source:
'savant', field: 'xera'` row, and that the already-shipped
`>= 0.25` threshold correctly classifies it.

## TASK 4: Outbox manifest (last task)
