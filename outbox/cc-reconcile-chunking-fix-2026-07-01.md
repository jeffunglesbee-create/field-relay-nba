# Outbox — reconcile() D1 100-Parameter-Limit Fix

**Date:** 2026-07-02
**Relay HEAD:** 7be87ae
**CC-CMD:** docs/CC-CMD-2026-07-01-reconcile-chunking-fix.md
**Status:** SHIPPED

---

## Pre-Build Probe Results

| Probe | Finding |
|-------|---------|
| `sed -n '74,140p' src/sync-reconciler.js` | Bug confirmed at lines 99–108: single `WHERE id IN (${placeholders})` with all ids unrolled, no chunking |
| Downstream of `currentById` | Consumed identically by the per-row diff loop at line 117+; no other code paths affected |
| Per-row UPDATE statements | Each binds only a small number of params (changed fields + id); NOT affected by D1's 100-param limit |

---

## Root Cause

Cloudflare D1's bound-parameter limit is **100 per query**, not SQLite's standard 999. `reconcile()`'s bulk SELECT was building one `?` placeholder per id with zero chunking:

```js
const placeholders = ids.map(() => '?').join(',');
const cur = await env.ARCHIVE_DB.prepare(
    `SELECT id, ${cols.join(', ')} FROM ${target} WHERE id IN (${placeholders})`
).bind(...ids).all();
```

633 pitchers → 633 bound params → `D1_ERROR: too many SQL variables`. The `INSERT OR IGNORE` loop in `/savant/sync` runs before `reconcile()` and succeeded (633 rows written to `pitcher_expected_stats`); only the diff/changelog step failed.

---

## What Was Fixed

**`src/sync-reconciler.js`** — bulk SELECT chunked at 90 ids per query:

```js
const ids = spec.updates.map(u => u.id);
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

Chunk size 90 (not 100) leaves headroom for future callers that may need to bind additional params alongside id in the same statement shape.

`currentById` is consumed identically downstream — all diff/update/changelog logic is untouched.

---

## Verification

- `node -c src/sync-reconciler.js` → **SYNTAX OK**
- Logic check (node -e): 3 ids → 1 loop iteration (identical to old single-query behavior); 633 ids → 8 iterations of ≤90 each ✓

---

## This Fix Is General-Purpose

This bug was not specific to pitcher xERA or `/savant/sync`. **Any `reconcile()` caller passing more than 100 rows in a single call would have hit the identical `D1_ERROR`.** The fix is applied once in `reconcile()` itself, protecting all current and future callers. The only caller that has historically run at small scale (odds sync, typically <30 game ids per day) was never affected.

---

## Chat-Side Follow-Up

Re-trigger the pitcher xERA sync (`mlb-weekly-update.yml` workflow_dispatch). Confirm via direct D1 query:
```sql
SELECT * FROM change_log WHERE source = 'savant' ORDER BY ts DESC LIMIT 10;
```
Expected: rows present after re-run — this is the first end-to-end completion of the full xERA pipeline built this session (materiality threshold → generic sync endpoint → chunking fix).
