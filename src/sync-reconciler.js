// src/sync-reconciler.js
// Generic Sync Reconciler — propagates enrichment data between D1 tables
// and logs every change to change_log for O(1) Newspaper + Brief Freshness
// Guard. Spec: docs/CC-CMD-2026-06-21-sync-reconciler.md.
//
// Callers compute the new values however they like (Odds API response,
// R2 read, calculation, another D1 table) and hand off a list of
// per-row updates. reconcile() resolves diffs against the live target
// row, batches the UPDATE + change_log INSERTs, and returns counters.
//
// ADR-002 / Rule 47 clean: the reconciler syncs data and records facts
// about WHAT changed (field old→new). It does not interpret or score.

// Idempotent table bootstrap — safe to call on every cron tick. The
// table sits next to briefs / analytics_runs / analytics_output in
// ARCHIVE_DB.
async function ensureChangeLogTable(env) {
    if (!env || !env.ARCHIVE_DB) return;
    await env.ARCHIVE_DB.batch([
        env.ARCHIVE_DB.prepare(`
            CREATE TABLE IF NOT EXISTS change_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id TEXT NOT NULL,
                source TEXT NOT NULL,
                field TEXT NOT NULL,
                old_value TEXT,
                new_value TEXT NOT NULL,
                ts TEXT NOT NULL DEFAULT (datetime('now')),
                consumed INTEGER DEFAULT 0
            )
        `),
        env.ARCHIVE_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_changelog_ts ON change_log(ts)`),
        env.ARCHIVE_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_changelog_game ON change_log(game_id)`),
        env.ARCHIVE_DB.prepare(`CREATE INDEX IF NOT EXISTS idx_changelog_source ON change_log(source)`),
    ]);
}

// D1 batch ceiling (Workers runtime caps batch() statements). Keep a
// conservative chunk size so a large sync stays inside one round-trip
// per chunk instead of bumping into the limit.
const RECONCILE_BATCH_CHUNK = 40;

function _scalarString(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v;
    return String(v);
}

// Diff two scalar-ish values. Treats null === undefined so a column
// that's currently NULL doesn't trigger a "changed" event when the
// caller passes undefined (it should pass null or omit the field).
function _changed(oldVal, newVal) {
    const a = oldVal === undefined ? null : oldVal;
    const b = newVal === undefined ? null : newVal;
    if (a === b) return false;
    return _scalarString(a) !== _scalarString(b);
}

/**
 * Sync columns into a target table, logging every change to change_log.
 *
 * @param {object} env  - Worker env (must have ARCHIVE_DB binding)
 * @param {object} spec - { target, updates, changelog }
 *   target: string  D1 table to UPDATE (must already exist)
 *   updates: Array<{ id, fields: { [col]: value } }>
 *     Caller-supplied. reconcile() SELECTs current values for these
 *     ids, diffs against fields, UPDATEs only the changed columns, and
 *     emits one change_log row per changed (id, field) pair.
 *   changelog: { source, label } | false
 *     source = string written to change_log.source. Falsy disables
 *     changelog writes (UPDATEs still happen).
 * @returns {{ synced: number, changes_logged: number }}
 */
async function reconcile(env, spec) {
    if (!env || !env.ARCHIVE_DB || !spec || !Array.isArray(spec.updates) || !spec.updates.length) {
        return { synced: 0, changes_logged: 0 };
    }
    const target = spec.target;
    if (!target || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(target)) {
        // Reject obviously-invalid identifiers to dodge SQLi via spec.target.
        throw new Error(`reconcile: invalid target table: ${target}`);
    }
    const source = spec.changelog?.source || 'reconciler';
    const wantsLog = !!spec.changelog;

    // 1. Compute the column set actually touched by these updates so
    //    the SELECT is exactly what we need.
    const columnSet = new Set();
    for (const u of spec.updates) {
        for (const k of Object.keys(u.fields || {})) {
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) {
                throw new Error(`reconcile: invalid field name: ${k}`);
            }
            columnSet.add(k);
        }
    }
    const cols = [...columnSet];
    if (!cols.length) return { synced: 0, changes_logged: 0 };

    // 2. Bulk-read current row state. ids may be any string/number; the
    //    bind path handles both.
    const ids = spec.updates.map(u => u.id);
    const placeholders = ids.map(() => '?').join(',');
    const cur = await env.ARCHIVE_DB.prepare(
        `SELECT id, ${cols.join(', ')} FROM ${target} WHERE id IN (${placeholders})`
    ).bind(...ids).all();
    const currentById = {};
    for (const r of (cur.results || [])) currentById[r.id] = r;

    // 3. Build per-row UPDATE + change_log statements. Skip rows where
    //    no field actually changed.
    const stmts = [];
    let syncedCount = 0;
    let loggedCount = 0;
    const nowIso = new Date().toISOString();

    for (const u of spec.updates) {
        const current = currentById[u.id] || {};
        const diffs = [];
        for (const [col, newVal] of Object.entries(u.fields || {})) {
            const oldVal = current[col];
            if (!_changed(oldVal, newVal)) continue;
            diffs.push({ col, oldVal, newVal });
        }
        if (!diffs.length) continue;

        const setClause = diffs.map(d => `${d.col} = ?`).join(', ');
        const setValues = diffs.map(d => d.newVal);
        stmts.push(
            env.ARCHIVE_DB.prepare(`UPDATE ${target} SET ${setClause} WHERE id = ?`)
                .bind(...setValues, u.id)
        );
        syncedCount++;

        if (wantsLog) {
            for (const d of diffs) {
                stmts.push(
                    env.ARCHIVE_DB.prepare(
                        `INSERT INTO change_log (game_id, source, field, old_value, new_value, ts)
                         VALUES (?, ?, ?, ?, ?, ?)`
                    ).bind(
                        String(u.id), source, d.col,
                        _scalarString(d.oldVal), _scalarString(d.newVal), nowIso,
                    )
                );
                loggedCount++;
            }
        }
    }

    // 4. Execute in chunks so a large sync (100s of rows × N cols)
    //    stays comfortably under D1's batch ceiling per round-trip.
    for (let i = 0; i < stmts.length; i += RECONCILE_BATCH_CHUNK) {
        const chunk = stmts.slice(i, i + RECONCILE_BATCH_CHUNK);
        await env.ARCHIVE_DB.batch(chunk);
    }
    return { synced: syncedCount, changes_logged: loggedCount };
}

/**
 * Recent changelog entries for the newspaper assembler / freshness guard.
 *
 * @param {object} env
 * @param {object} opts
 *   since:  ISO string (e.g. '2026-06-20T00:00:00Z') — exclusive lower bound
 *   gameIds: string[] — optional, limit to these game ids
 *   sources: string[] — optional, limit to these sources
 *   limit:  number (default 20, hard cap 200)
 *   includeConsumed: boolean (default false)
 * @returns {Array<{id, game_id, source, field, old_value, new_value, ts, consumed}>}
 */
async function getRecentChanges(env, opts = {}) {
    if (!env || !env.ARCHIVE_DB) return [];
    const since   = opts.since || '1970-01-01T00:00:00Z';
    const limit   = Math.min(opts.limit || 20, 200);
    const gameIds = Array.isArray(opts.gameIds) ? opts.gameIds : null;
    const sources = Array.isArray(opts.sources) ? opts.sources : null;

    let sql = `SELECT id, game_id, source, field, old_value, new_value, ts, consumed
               FROM change_log WHERE ts > ?`;
    const binds = [since];
    if (!opts.includeConsumed) sql += ' AND consumed = 0';
    if (gameIds && gameIds.length) {
        sql += ` AND game_id IN (${gameIds.map(() => '?').join(',')})`;
        binds.push(...gameIds);
    }
    if (sources && sources.length) {
        sql += ` AND source IN (${sources.map(() => '?').join(',')})`;
        binds.push(...sources);
    }
    sql += ' ORDER BY ts DESC LIMIT ?';
    binds.push(limit);

    try {
        const res = await env.ARCHIVE_DB.prepare(sql).bind(...binds).all();
        return res.results || [];
    } catch (_) {
        return [];
    }
}

/**
 * Mark changelog entries as consumed (newspaper assembler should call this
 * after a render so the next run doesn't re-include them as "moving").
 */
async function markConsumed(env, ids) {
    if (!env || !env.ARCHIVE_DB || !Array.isArray(ids) || !ids.length) {
        return { updated: 0 };
    }
    const placeholders = ids.map(() => '?').join(',');
    const r = await env.ARCHIVE_DB.prepare(
        `UPDATE change_log SET consumed = 1 WHERE id IN (${placeholders})`
    ).bind(...ids).run();
    return { updated: r?.meta?.changes ?? 0 };
}

/**
 * Cleanup: delete consumed entries older than 30 days. Intended to run
 * once a day from the analytics cron (Phase 11). Wired separately so
 * this prompt stays minimal-touch on the cron pipeline.
 */
async function cleanupChangelog(env) {
    if (!env || !env.ARCHIVE_DB) return { deleted: 0 };
    try {
        const r = await env.ARCHIVE_DB.prepare(
            `DELETE FROM change_log WHERE consumed = 1 AND ts < datetime('now', '-30 days')`
        ).run();
        return { deleted: r?.meta?.changes ?? 0 };
    } catch (_) {
        return { deleted: 0 };
    }
}

export {
    ensureChangeLogTable,
    reconcile,
    getRecentChanges,
    markConsumed,
    cleanupChangelog,
};
