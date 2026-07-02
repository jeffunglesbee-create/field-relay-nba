# Claude Code Command — Fix reconcile()'s D1 100-Parameter-Limit Bug

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-reconcile-chunking-fix-2026-07-01.md.

## CONTEXT

Confirmed live, real bug — not theoretical. The client-side pitcher-xERA
CC-CMD (jubilant-bassoon) hit `D1_ERROR: too many SQL variables` POSTing
633 real pitchers to `/savant/sync`. Root cause, independently verified
against authoritative sources (Cloudflare's own docs, confirmed by
multiple real bug reports from Prisma/Drizzle/Payload CMS hitting the
identical error): **Cloudflare D1's real bound-parameter limit is 100
per query — not SQLite's standard 999.** `reconcile()`'s bulk SELECT
(`src/sync-reconciler.js`, ~line 100-104) builds one `?` placeholder per
`id` with zero chunking:

```javascript
const ids = spec.updates.map(u => u.id);
const placeholders = ids.map(() => '?').join(',');
const cur = await env.ARCHIVE_DB.prepare(
    `SELECT id, ${cols.join(', ')} FROM ${target} WHERE id IN (${placeholders})`
).bind(...ids).all();
```

633 ids is 6x the real limit. This has been a latent bug since
`reconcile()` was first written — the odds use case that originally
called it only ever processes a handful of games per day, never
triggering it. The per-row `UPDATE` statements later in the function are
NOT affected (each binds only a few params regardless of total batch
size) — only this one bulk SELECT needs fixing.

**Confirmed real side-effect of this bug tonight:** the `INSERT OR
IGNORE` loop in `/savant/sync` (which runs before `reconcile()` is
called) succeeded completely — 633 real rows exist in
`pitcher_expected_stats`, confirmed via direct D1 query. Only the
subsequent `reconcile()` call failed, meaning the endpoint's try/catch
returned a 500 to the caller even though the underlying data had
already been written. This CC-CMD does not need to touch the endpoint
or the data — the data is already correct; only `reconcile()`'s
diff/logging step needs to actually complete.

## PRE-BUILD PROBE (Rule 87)

```bash
sed -n '74,140p' src/sync-reconciler.js
```

Confirm exact current line numbers before editing.

## TASK 1: Chunk the bulk SELECT into batches of 100 or fewer ids

```javascript
// D1's real bound-parameter limit is 100 per query (not SQLite's
// standard 999) — confirmed against Cloudflare's own docs 2026-07-01,
// after a real 633-row batch hit D1_ERROR: too many SQL variables.
// Chunk defensively at 90 to leave headroom, since a future caller
// might also need id + a small number of extra bound params in the
// same statement shape.
const CHUNK_SIZE = 90;
const currentById = {};
for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const chunkPlaceholders = chunk.map(() => '?').join(',');
    const chunkRes = await env.ARCHIVE_DB.prepare(
        `SELECT id, ${cols.join(', ')} FROM ${target} WHERE id IN (${chunkPlaceholders})`
    ).bind(...chunk).all();
    for (const r of (chunkRes.results || [])) currentById[r.id] = r;
}
```

Replace the existing single-query block with this, preserving
everything downstream (`currentById` is consumed identically by the
rest of the function — no other changes needed).

**Verify this doesn't silently break for the common small-batch case**
(the existing odds use case, typically well under 90 ids) — confirm the
loop runs exactly once for small inputs and produces identical output
to the old single-query version.

## TASK 2: Verification

```bash
node -c src/sync-reconciler.js
```

Cannot fully verify end-to-end from the CC sandbox (would need a real
D1 call with >100 rows). Done condition: syntax valid, logic
demonstrably equivalent to the original for small batches, chunked
correctly for large ones.

**Chat-side follow-up (not checkable by CC):** re-trigger the pitcher
xERA sync (same `mlb-weekly-update.yml` workflow_dispatch used before)
once this lands, and confirm via direct D1 query that `change_log`
finally gets real `source: 'savant'` rows — this is the actual proof
the fix works, and it's also the first real end-to-end completion of
the whole xERA pipeline this session has been building toward.

## TASK 3: Outbox manifest (last task)

Note explicitly: this fix is general-purpose, not pitcher-xERA-specific
— any future `reconcile()` caller with more than 100 rows would have
hit the identical bug. State that clearly so it isn't mistaken for a
narrow patch.
