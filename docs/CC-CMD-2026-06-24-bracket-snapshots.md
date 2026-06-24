# CC-CMD: Bracket Snapshots — Phase 1
**Date:** 2026-06-24  
**Repo:** field-relay-nba  
**Spec:** Drive `1Wm29D2KYtEPR1G3N-n__7KPm6FKR-0L6_4S99mtsAxU` (Bracket Compound)  
**Rule 87:** Self-completing. All probes, edits, schema, verification, and outbox manifest run inside this session.

---

## CONTEXT

BracketDO recomputes Monte Carlo projections after every WC result. Each
recompute overwrites KV — no history is retained. The tournament is 46 games
in. Knockout-round data is the highest-value calibration window: probabilities
are higher-variance and outcomes are binary (advance/eliminated). This CC-CMD
captures all future recomputes in D1 for forecast calibration.

---

## PROBE BLOCK — read before writing anything

1. Check `src/bracket-do.js`: confirm `_recomputeAndBroadcast` ends around
   line 400. Find the exact last line before `return true` — the snapshot
   hook goes there as fire-and-forget.

2. Check `src/index.js`: grep for `/archive/brief` POST endpoint as a pattern
   reference for D1 insert structure. Confirm `ARCHIVE_DB` binding name.

3. Check wrangler.toml: confirm `ARCHIVE_DB` is bound to field-archive D1.
   Confirm BracketDO binding is present (`BRACKET_DO`). Note the D1 database
   ID for field-archive.

4. Check current `/wc/projections` response shape — specifically `teams` array.
   Confirm each team object has: `name`, `pR32`, `pR16`, `pQF`, `pSF`,
   `pFinal`, `pChamp`. These map to the D1 column names.

5. Confirm `/archive/bracket-snapshot` does NOT already exist in index.js.

---

## TASK 1 — Create `bracket_snapshots` table in field-archive D1

Use the Cloudflare D1 MCP tool to run this DDL against the field-archive
database (ID from wrangler.toml):

```sql
CREATE TABLE IF NOT EXISTS bracket_snapshots (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  match_id TEXT,
  team TEXT NOT NULL,
  r32_prob REAL,
  r16_prob REAL,
  qf_prob REAL,
  sf_prob REAL,
  final_prob REAL,
  champion_prob REAL,
  triggered_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bracket_snap_team
  ON bracket_snapshots(team, date);

CREATE INDEX IF NOT EXISTS idx_bracket_snap_date
  ON bracket_snapshots(date);

CREATE INDEX IF NOT EXISTS idx_bracket_snap_triggered
  ON bracket_snapshots(triggered_by);
```

**Verification:** Query `SELECT name FROM sqlite_master WHERE type='table' AND name='bracket_snapshots'` — must return one row.

---

## TASK 2 — Add `POST /archive/bracket-snapshot` endpoint to `src/index.js`

Find the block of `/archive/*` POST endpoints. Add BEFORE the first `/archive/`
catch-all or after the last `/archive/brief` endpoint.

The endpoint receives an array of team snapshots from BracketDO and batch-inserts
into D1. Fire-and-forget from BracketDO — returns 200 even on partial failure.

```javascript
// POST /archive/bracket-snapshot — batch-write projection snapshot for calibration.
// Called by BracketDO after every _recomputeAndBroadcast. Fire-and-forget.
// Body: { triggered_by, date, teams: [{name, pR32, pR16, pQF, pSF, pFinal, pChamp}] }
if (pathname === '/archive/bracket-snapshot' && request.method === 'POST') {
    if (!env.ARCHIVE_DB) return new Response(
        JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
        { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
    try {
        const body = await request.json();
        const { triggered_by = 'unknown', date, teams = [] } = body;
        if (!teams.length) return new Response(
            JSON.stringify({ ok: true, inserted: 0 }),
            { headers: { ...CORS, 'Content-Type': 'application/json' } }
        );
        const snapshotDate = date || new Date().toISOString().slice(0, 10);
        const safeTriggeredBy = (triggered_by || 'unknown').slice(0, 120);

        // Batch insert — D1 batch API, one statement per team
        const stmts = teams.map(t => {
            const id = `snap_${(t.name||'').replace(/\s+/g,'_')}_${snapshotDate}_${safeTriggeredBy}`.slice(0, 180);
            return env.ARCHIVE_DB.prepare(
                `INSERT OR REPLACE INTO bracket_snapshots
                 (id, date, match_id, team, r32_prob, r16_prob, qf_prob, sf_prob, final_prob, champion_prob, triggered_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                id, snapshotDate, triggered_by || null,
                t.name || '', t.pR32 ?? null, t.pR16 ?? null,
                t.pQF ?? null, t.pSF ?? null, t.pFinal ?? null,
                t.pChamp ?? null, safeTriggeredBy
            );
        });

        await env.ARCHIVE_DB.batch(stmts);
        return new Response(
            JSON.stringify({ ok: true, inserted: stmts.length, date: snapshotDate, triggered_by: safeTriggeredBy }),
            { headers: { ...CORS, 'Content-Type': 'application/json' } }
        );
    } catch (e) {
        return new Response(
            JSON.stringify({ ok: false, error: e.message }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
        );
    }
}
```

---

## TASK 3 — Add `GET /archive/bracket-replay` endpoint to `src/index.js`

Add alongside the new POST endpoint. Supports calibration queries.

```javascript
// GET /archive/bracket-replay — query historical bracket snapshots.
// ?team=Germany          → full arc for one team
// ?date=2026-06-20       → full 48-team snapshot at a date
// ?triggered_by=wc26_... → pre/post snapshot for a specific match
// ?since=2026-06-20      → all snapshots from date forward (calibration window)
if (pathname === '/archive/bracket-replay' && request.method === 'GET') {
    if (!env.ARCHIVE_DB) return new Response(
        JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
        { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
    try {
        const team        = url.searchParams.get('team');
        const date        = url.searchParams.get('date');
        const triggeredBy = url.searchParams.get('triggered_by');
        const since       = url.searchParams.get('since');

        let query, params;
        if (team) {
            query  = `SELECT * FROM bracket_snapshots WHERE team = ? ORDER BY date, created_at`;
            params = [team];
        } else if (triggeredBy) {
            query  = `SELECT * FROM bracket_snapshots WHERE triggered_by = ? ORDER BY team, created_at`;
            params = [triggeredBy];
        } else if (since) {
            query  = `SELECT * FROM bracket_snapshots WHERE date >= ? ORDER BY date, created_at`;
            params = [since];
        } else if (date) {
            query  = `SELECT * FROM bracket_snapshots WHERE date = ? ORDER BY champion_prob DESC`;
            params = [date];
        } else {
            // No params — return distinct dates + counts (index page)
            query  = `SELECT date, triggered_by, COUNT(*) as team_count FROM bracket_snapshots GROUP BY date, triggered_by ORDER BY date DESC LIMIT 50`;
            params = [];
        }

        const rows = await env.ARCHIVE_DB.prepare(query).bind(...params).all();
        return new Response(
            JSON.stringify({ ok: true, count: rows.results?.length ?? 0, rows: rows.results }),
            { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } }
        );
    } catch (e) {
        return new Response(
            JSON.stringify({ ok: false, error: e.message }),
            { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
        );
    }
}
```

Add both new routes to the probe allow-list (`ALLOWED_EXACT` or `ALLOWED_PREFIX`):
- `/archive/bracket-snapshot` → ALLOWED_PREFIX (or EXACT for POST — check pattern)
- `/archive/bracket-replay` → ALLOWED_EXACT

---

## TASK 4 — Hook BracketDO `_recomputeAndBroadcast` to write snapshots

In `src/bracket-do.js`, find `_recomputeAndBroadcast`. The last step before
`return true` is the WebSocket fan-out and journalism queue. Add a new final
step — fire-and-forget POST to the relay's own `/archive/bracket-snapshot`:

Find the line:
```javascript
        console.log(`[BracketDO] recomputed: ${newSnapshot.teams?.length} teams · delta significant: ${delta?.significant} · ws clients: ${fanOutCount}`);
        return true;
```

Replace with:
```javascript
        console.log(`[BracketDO] recomputed: ${newSnapshot.teams?.length} teams · delta significant: ${delta?.significant} · ws clients: ${fanOutCount}`);

        // 10. Write projection snapshot to D1 for calibration/replay.
        // Fire-and-forget — never blocks or throws into the recompute path.
        if (newSnapshot.teams?.length > 0) {
            const today = new Date().toISOString().slice(0, 10);
            const triggeredBy = triggerResult
                ? `${triggerResult.home}_${triggerResult.away}_${today}`.replace(/\s+/g, '_').slice(0, 120)
                : 'scheduled';
            this.ctx.waitUntil(
                fetch(`${RELAY_BASE}/archive/bracket-snapshot`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({
                        triggered_by: triggeredBy,
                        date:         today,
                        teams:        newSnapshot.teams.map(t => ({
                            name:   t.name,
                            pR32:   t.pR32   ?? null,
                            pR16:   t.pR16   ?? null,
                            pQF:    t.pQF    ?? null,
                            pSF:    t.pSF    ?? null,
                            pFinal: t.pFinal ?? null,
                            pChamp: t.pChamp ?? null,
                        })),
                    }),
                }).catch(e => console.warn('[BracketDO] snapshot write failed:', e.message))
            );
        }

        return true;
```

**Verification:** After edit, grep bracket-do.js for `/archive/bracket-snapshot` — must appear exactly once.

---

## TASK 5 — Initial backfill snapshot (current state)

After deploy, trigger a manual refresh to write the current state as the
first D1 snapshot. This captures the model's view after 46 group stage games
as the baseline for knockout-round calibration.

POST to `/wc/bracket/refresh` (manual trigger). Then verify:

```
GET /archive/bracket-replay
```

Must return rows with `date = today` and `team_count = 48` (or however many
teams are in the current projection).

---

## TASK 6 — Verify end-to-end

1. `GET /archive/bracket-replay` → index page with date + count rows
2. `GET /archive/bracket-replay?date=2026-06-24` → 48 teams with pChamp values
3. `GET /archive/bracket-replay?team=France` → single team arc (1 row from backfill)
4. `GET /archive/bracket-replay?team=Portugal` → same, confirm pChamp matches `/wc/projections`

---

## TASK 7 — Smoke + commit + deploy

1. `node --check src/bracket-do.js src/index.js` — both must pass.
2. Commit:
   ```
   feat: bracket_snapshots D1 table + replay endpoint — forecast calibration
   
   - bracket_snapshots table in field-archive D1 (48 teams × per-recompute)
   - POST /archive/bracket-snapshot: BracketDO batch-insert after every recompute
   - GET /archive/bracket-replay: team arc, date snapshot, triggered_by query
   - BracketDO _recomputeAndBroadcast step 10: fire-and-forget snapshot write
   - Initial backfill: current state (post-46-games) as calibration baseline
   
   Enables: forecast calibration, bracket replay, pre/post match impact queries.
   Phase 1 of Bracket Compound spec (Drive 1Wm29D2KYtEPR1G3N-n__7KPm6FKR-0L6_4S99mtsAxU).
   ```
3. Push — deploy workflow triggers automatically.
4. After deploy gate green: POST `/wc/bracket/refresh` for initial backfill.

---

## TASK 8 — Outbox manifest

Write `outbox/cc-bracket-snapshots-2026-06-24.md` with:
- Schema created (column list)
- Routes added
- BracketDO hook location (file:line)
- Backfill verification output (row count, sample team + pChamp)
- Commit hash + deploy status
- Calibration query examples that now work

Commit with `[skip ci]` and push.

---

## DONE CONDITIONS

- [ ] `SELECT name FROM sqlite_master WHERE name='bracket_snapshots'` → 1 row
- [ ] `GET /archive/bracket-replay` returns HTTP 200 with rows array
- [ ] `GET /archive/bracket-replay?date=2026-06-24` returns 48 teams
- [ ] grep `bracket-do.js` for `/archive/bracket-snapshot` → exactly 1 match
- [ ] `node --check` both files pass
- [ ] Deploy green
- [ ] Outbox manifest committed
