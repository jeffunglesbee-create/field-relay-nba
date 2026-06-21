# Claude Code Command — Sync Reconciler + Changelog (Phase 1)

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-sync-reconciler-2026-06-21.md.

## CONTEXT

The relay has a hardcoded odds sync that copies opening_odds and
closing_odds from odds_history into regular_season_games and
postseason_games. This sync is scattered across multiple functions
(~line 3739, 3901, 3987 in src/index.js).

This command creates a generic reconcile(env, spec) pattern,
refactors the odds sync to use it, and creates a change_log D1
table that records every data change. The changelog becomes the
content engine for O(1) Newspaper's "What's Moving" section and
the Brief Freshness Guard's staleness detector.

Drive spec: 1edcpJptVPaA7VP6svP4QjDuhtq-POrJrbZJYAhxcppc

## ADR-002 STATUS: CLEAN

The reconciler syncs DATA between tables and logs structural
facts (field X changed from Y to Z). No drama scores, no interest
calculations. The changelog records what happened to the data,
not what it means subjectively. Same pattern as existing odds
sync — just generic.

## PRE-BUILD PROBE (Rule 68 — PROBE-FIRST-A)

Before writing any code, run these probes:

```bash
# 1. Verify ARCHIVE_DB tables exist and check their columns
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/d1/execute \
  -X POST -H "Content-Type: application/json" \
  -H "X-FIELD-Admin: 1" \
  -d '{"sql":"SELECT sql FROM sqlite_master WHERE type=\"table\" AND name IN (\"regular_season_games\",\"postseason_games\",\"odds_history\",\"briefs\",\"change_log\") ORDER BY name"}' \
  2>/dev/null | node -e 'const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")); (d.results||[]).forEach(r=>console.log(r.sql))'

# 2. Check if change_log already exists
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/d1/execute \
  -X POST -H "Content-Type: application/json" \
  -H "X-FIELD-Admin: 1" \
  -d '{"sql":"SELECT COUNT(*) as n FROM sqlite_master WHERE type=\"table\" AND name=\"change_log\""}' \
  2>/dev/null

# 3. Find the existing odds sync functions
grep -rn "opening_odds IS NULL\|syncOdds\|UPDATE.*SET.*opening_odds\|closing_odds" src/index.js | head -20

# 4. Find where odds sync is called from (cron phases)
grep -rn "runOddsSync\|odds.*sync\|syncArchive\|opening_odds" src/index.js | grep -i "phase\|cron\|schedule\|alarm\|function" | head -15

# 5. Check the /d1/execute allowlist
grep -n "d1/execute\|TABLE_ALLOWLIST\|table.*allow" src/index.js | head -10
```

Write probe results to outbox BEFORE writing any code.

NOTE: If the sandbox cannot reach *.workers.dev (403), derive
table schemas from the CREATE TABLE statements in src/index.js
and the /archive/game handler (~line 6758). Document the
adaptation in the outbox manifest.

## TASK 1: Create src/sync-reconciler.js (~120 lines)

Create a new source file with the generic reconciler pattern.

```javascript
// src/sync-reconciler.js
// Generic Sync Reconciler — propagates enrichment data between D1 tables
// and logs every change to change_log for O(1) Newspaper + Brief Freshness Guard.
// Spec: Drive 1edcpJptVPaA7VP6svP4QjDuhtq-POrJrbZJYAhxcppc

/**
 * Ensure the change_log table exists in ARCHIVE_DB.
 * Safe to call repeatedly (IF NOT EXISTS).
 */
async function ensureChangeLogTable(env) {
  if (!env.ARCHIVE_DB) return;
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
    env.ARCHIVE_DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_changelog_ts ON change_log(ts)
    `),
    env.ARCHIVE_DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_changelog_game ON change_log(game_id)
    `),
    env.ARCHIVE_DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_changelog_source ON change_log(source)
    `),
  ]);
}

/**
 * Generic reconcile — syncs columns from source table to target table,
 * logging every change to change_log.
 *
 * @param {object} env - Worker env with ARCHIVE_DB binding
 * @param {object} spec - Reconciler specification:
 *   {
 *     source: string,           // source table name
 *     target: string,           // target table name
 *     joinKey: { source: string, target: string },
 *     columns: [{ source: string, target: string, transform?: fn }],
 *     condition: 'IS NULL' | 'CHANGED',  // IS NULL = fill empty, CHANGED = update on diff
 *     changelog: boolean,       // whether to log diffs
 *     label: string,            // human-readable source name for changelog
 *   }
 * @returns {{ synced: number, changes_logged: number }}
 */
async function reconcile(env, spec) {
  // Implementation: see Drive spec for full pseudocode.
  // Key requirements:
  // 1. Find candidate rows where target columns match spec.condition
  // 2. For each candidate, read source row via joinKey
  // 3. Compute new values (with optional transform)
  // 4. Skip if new value === old value
  // 5. Build UPDATE statement for target table
  // 6. If spec.changelog, INSERT into change_log with old/new values
  // 7. Execute all statements in a single batch
  // 8. Return { synced, changes_logged }
}

/**
 * Query recent changelog entries for a game or date range.
 * Used by the newspaper assembler and Brief Freshness Guard.
 */
async function getRecentChanges(env, { since, gameIds, sources, limit = 20 }) {
  // SELECT from change_log WHERE ts > since
  // AND game_id IN (gameIds) if provided
  // AND source IN (sources) if provided
  // ORDER BY ts DESC LIMIT limit
}

/**
 * Mark changelog entries as consumed after newspaper generation.
 */
async function markConsumed(env, ids) {
  // UPDATE change_log SET consumed = 1 WHERE id IN (ids)
}

/**
 * Cleanup: delete consumed entries older than 30 days.
 * Called from analytics cron.
 */
async function cleanupChangelog(env) {
  // DELETE FROM change_log WHERE consumed = 1 AND ts < datetime('now', '-30 days')
}

export {
  ensureChangeLogTable,
  reconcile,
  getRecentChanges,
  markConsumed,
  cleanupChangelog,
};
```

Implement ALL functions fully. The pseudocode above shows the
structure — implement each with actual D1 SQL. Use the Drive spec's
reconcile() pseudocode as the reference implementation.

## TASK 2: Refactor odds sync to use generic reconciler

Find the existing odds sync functions in src/index.js. There are
multiple related functions that handle opening_odds and closing_odds
population. The primary ones:

- The function at ~line 3739 that syncs odds into archive game tables
- The function at ~line 3901 that runs per-cron snapshot
- The function at ~line 3987 that does batch sync

Replace the sync logic (the UPDATE statements that set opening_odds
and closing_odds) with calls to reconcile(). Keep the existing
odds FETCHING logic unchanged — only replace the SYNC/UPDATE part.

Define the odds reconciler spec:

```javascript
const ODDS_RECONCILER_SPEC = {
  source: 'odds_history',
  target: 'regular_season_games',  // also postseason_games
  joinKey: { source: 'game_id', target: 'id' },
  columns: [
    { source: 'opening_line', target: 'opening_odds' },
    { source: 'closing_line', target: 'closing_odds' },
  ],
  condition: 'IS NULL',
  changelog: true,
  label: 'odds',
};
```

IMPORTANT: The existing odds sync handles BOTH regular_season_games
and postseason_games tables. The reconciler must handle both.
Either run reconcile() twice with different target tables, or
make the spec accept an array of targets.

## TASK 3: Add change_log to /d1/execute TABLE_ALLOWLIST

Find the TABLE_ALLOWLIST in the /d1/execute handler and add
'change_log' to it. This allows the changelog to be queried
via the admin endpoint.

## TASK 4: Wire ensureChangeLogTable into startup

Find where ensureBriefsTable(env) is called at the start of
cron/journalism functions and add ensureChangeLogTable(env)
alongside it. The table must exist before any reconciler runs.

A single call site is sufficient — find the earliest common
entry point in the cron pipeline.

## TASK 5: Add /changelog/{date} endpoint (optional, low priority)

If time allows, add a simple GET endpoint that returns recent
changelog entries for a date:

```
GET /changelog/2026-06-21
→ { changes: [...], count: N }
```

This is for debugging and future newspaper integration.
Skip this task if the core reconciler + refactor takes longer
than expected.

## TASK 6: Verify

```bash
# Build check
node --check src/sync-reconciler.js

# Deploy
wrangler deploy

# Post-deploy health
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/health | grep "RELAY OK"

# Verify change_log table was created (may need a cron trigger)
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/d1/execute \
  -X POST -H "Content-Type: application/json" \
  -H "X-FIELD-Admin: 1" \
  -d '{"sql":"SELECT sql FROM sqlite_master WHERE name=\"change_log\""}' \
  2>/dev/null
```

## SCOPE BOUNDARY (Rule 69 — TOUCH-ONLY-A)

DO:
- Create src/sync-reconciler.js (new file)
- Refactor odds sync UPDATE logic to use reconcile()
- Add change_log to TABLE_ALLOWLIST
- Wire ensureChangeLogTable into cron startup
- Optionally add /changelog/{date} endpoint

DO NOT:
- Modify odds FETCHING logic (The Odds API calls, budget tracking)
- Modify the journalism prompt builder or context assembler
- Touch any client code (jubilant-bassoon)
- Add new reconciler specs beyond odds (Savant, weather, etc. are Phase 2+)
- Modify analytics-engine.js phases
- Create new cron schedules

## INSTRUCTIONS

1. This is a single-repo task: field-relay-nba only.
2. Run pre-build probes FIRST. Write probe results to outbox.
3. Create src/sync-reconciler.js with all functions fully implemented.
4. Refactor odds sync to use reconcile() — minimal touch on existing code.
5. Add change_log to TABLE_ALLOWLIST.
6. Wire ensureChangeLogTable into cron startup.
7. node --check all modified files before commit.
8. Single commit: "feat: sync reconciler + change_log table + odds refactor"
9. Deploy via wrangler deploy.
10. Write manifest to outbox/cc-sync-reconciler-2026-06-21.md.

## KEY CONSTRAINT: ODDS SYNC MUST NOT BREAK

The odds sync currently populates 130 opening_odds + 124 closing_odds
rows. After refactoring, the same rows must still populate correctly.
The reconciler is a REFACTOR of existing behavior, not new functionality.
If reconcile() fails, odds sync fails, and the Odds Story feature
loses its data pipeline.

Test strategy: after deploy, verify that an odds sync cron run
still populates the same fields. The change_log should also contain
entries for any newly synced odds.

## D1 SCHEMA REFERENCE

change_log table (from spec):

```sql
CREATE TABLE IF NOT EXISTS change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  source TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  consumed INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_changelog_ts ON change_log(ts);
CREATE INDEX IF NOT EXISTS idx_changelog_game ON change_log(game_id);
CREATE INDEX IF NOT EXISTS idx_changelog_source ON change_log(source);
```

Storage: ~200 bytes/row, ~50 changes/day, 30-day retention.
