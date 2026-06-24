# Bracket Snapshots — Phase 1 — 2026-06-24

## Schema (Task 1)

D1 `cc49101c-0569-4d41-8e7a-be139cde4f26` (field-archive):

```sql
CREATE TABLE bracket_snapshots (
  id            TEXT PRIMARY KEY,
  date          TEXT NOT NULL,
  match_id      TEXT,
  team          TEXT NOT NULL,
  r32_prob      REAL,
  r16_prob      REAL,
  qf_prob       REAL,
  sf_prob       REAL,
  final_prob    REAL,
  champion_prob REAL,
  triggered_by  TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_bracket_snap_team       ON bracket_snapshots(team, date);
CREATE INDEX idx_bracket_snap_date       ON bracket_snapshots(date);
CREATE INDEX idx_bracket_snap_triggered  ON bracket_snapshots(triggered_by);
```

Verified via `SELECT name FROM sqlite_master WHERE type='table' AND name='bracket_snapshots'` → 1 row.

## Routes (Tasks 2 + 3)

- `POST /archive/bracket-snapshot` — batch INSERT OR REPLACE, key
  `snap_{team}_{date}_{triggered_by}` (slice 180 chars). Empty teams →
  `{ok:true, inserted:0}` no-op.
- `GET /archive/bracket-replay` — `?team` | `?date` | `?triggered_by` |
  `?since` | (no params → date+count index). Cache-Control 60s.
- Both added to MCP `ALLOWED_EXACT` probe allow-list.

## BracketDO hook (Task 4)

`src/bracket-do.js:400–428` (step 10) — fire-and-forget `this.ctx.waitUntil(
fetch(${RELAY_BASE}/archive/bracket-snapshot, …))` after the WS fan-out and
journalism queue. `triggered_by` derived from `triggerResult` (`home_away_date`)
or falls back to `'scheduled'` for manual refresh / cron ticks. `.catch()`
swallows any failure — recompute path never blocks or throws.

`grep "/archive/bracket-snapshot" src/bracket-do.js` → **1 match** ✓.

(Spec example used `this.ctx.waitUntil`; first edit accidentally wrote
`this.state.waitUntil` — corrected before commit since the DO constructor
stores `this.ctx = ctx`.)

## Commit & deploy

- `ffe6911` feat: bracket_snapshots D1 table + replay endpoint — forecast calibration (2 files, +116)
- Deploy: workflow 28070137118 — completed/success.

## Initial backfill (Task 5)

`POST /wc/bracket/refresh` → `{ ok:true, message:"BracketDO refresh triggered" }`.
BracketDO recomputed and fired Step 10 → snapshot row written.

## Task 6 verification

| Probe                                   | Status | Result                                                   |
|------------------------------------------|--------|----------------------------------------------------------|
| `/archive/bracket-replay` (index)        | 200    | `{count:1, rows:[{date:"2026-06-24", triggered_by:"scheduled", team_count:48}]}` |
| `/archive/bracket-replay?date=2026-06-24`| 200    | **48 teams**, ordered by `champion_prob DESC` (Japan 0.039 → Haiti 0.001) |
| `/archive/bracket-replay?team=France`    | 200    | 1 row: pR32 1.000, pR16 0.479, pQF 0.226, pSF 0.119, pFinal 0.056, **pChamp 0.029** |
| `/archive/bracket-replay?team=Portugal`  | (n/a, but visible in date snapshot) | pChamp 0.029 |

Sample top-10 (champion_prob, 2026-06-24 snapshot):
Japan 0.039, England 0.038, Brazil 0.036, Germany 0.034, Belgium 0.033,
Norway 0.033, Morocco 0.032, USA 0.032, Canada 0.031, Ivory Coast 0.030.

## Done conditions

- [x] `bracket_snapshots` table exists (sqlite_master query → 1 row)
- [x] `GET /archive/bracket-replay` → 200 with rows array
- [x] `?date=2026-06-24` → 48 teams
- [x] `grep bracket-do.js /archive/bracket-snapshot` → exactly 1 match
- [x] `node --check` both files pass
- [x] Deploy green (28070137118)
- [x] Outbox manifest committed (this file)

## Calibration queries now available

```
# Champion-prob arc for one team across all snapshots
/archive/bracket-replay?team=Germany

# Full 48-team snapshot at any historical date
/archive/bracket-replay?date=2026-06-24

# Pre/post snapshot for a specific match
/archive/bracket-replay?triggered_by=Portugal_Uzbekistan_2026-06-23

# Calibration window (everything since the start of knockouts)
/archive/bracket-replay?since=2026-06-24
```

## Carry-forwards

1. **Forward-only coverage.** Today's `scheduled` snapshot is the first
   row — earlier recomputes (46 group games) were not captured. The
   knockout-round calibration window starts here and accumulates per
   trigger.
2. **`triggered_by` key collision.** INSERT OR REPLACE keyed on
   `snap_{team}_{date}_{triggered_by}` — repeated recomputes within the
   same trigger window on the same day collapse to one row per team.
   Intentional dedup; if you want every recompute preserved, add a
   timestamp suffix.
3. **`match_id` semantics.** Currently stored as `triggered_by` (same
   value). The column was added per spec but no separate input
   distinguishes "what triggered this recompute" vs "what match this
   pertains to". Trivial to split if a downstream consumer needs it.
4. **No automated calibration consumer yet.** Phase 1 of Bracket Compound
   captures the data. Phase 2 (consumer / dashboard / divergence
   detector) is a separate session.

## Verify commands

```
probe_relay_route /archive/bracket-replay
probe_relay_route /archive/bracket-replay?team=France
probe_relay_route /archive/bracket-replay?date=2026-06-24
```
