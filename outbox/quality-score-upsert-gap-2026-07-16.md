# quality_score/context_hash UPSERT gap — outbox

**Date:** 2026-07-16
**Trigger:** direct user instruction ("Fix the quality_score UPSERT gap"), following its discovery as a disclosed byproduct of `docs/CC-CMD-2026-07-16-dead-hours-bypass.md`'s own verification step.
**Commit:** `8329373` (fix, deployed — `Deploy RELAY Worker` + `Post-deploy live verification`, both success)

## What was found

The `queue()` handler's `type:'game-brief'` branch (`src/index.js`, the sole D1 write path for real per-game recaps) writes to `briefs` via:

```sql
INSERT INTO briefs (id, date, brief_type, sport, game_id, brief_text, model, quality_score, context_hash, word_count, source)
VALUES (?, ?, 'game_recap', ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  brief_text = excluded.brief_text,
  word_count = excluded.word_count,
  source = CASE WHEN briefs.source = 'completion-trigger' THEN briefs.source ELSE excluded.source END
```

`quality_score` and `context_hash` are bound as fresh, per-run values (`qResult.score`, `job.gameHash`) but were never included in the `UPDATE SET` clause. Any job that re-processed an existing row's id — e.g. a real completion firing after an earlier cron preview had already inserted the row, exactly what happened tonight with `espn:401857070` — would correctly overwrite the prose but silently leave the *previous* run's score and hash in place. Found as a direct, disclosed byproduct of manually triggering that exact game via the dead-hours-bypass CC-CMD: the row's `brief_text` updated to the real 88-75 result, but `quality_score` stayed at `259`, the old pre-game preview's stale value.

## Scope check before fixing

Grepped all 5 `ON CONFLICT(id) DO UPDATE SET` sites in the file before touching anything:

| Site | Table | Has the gap? |
|---|---|---|
| Slate brief INSERT (~L7339) | `briefs` | No — already updates `quality_score` |
| Postseason game upsert (~L9661) | `postseason_games` | N/A — no `quality_score` column |
| Regular season game upsert (~L9692) | `regular_season_games` | N/A — no `quality_score` column |
| Archive-brief route (~L9985) | `briefs` | No — already updates `quality_score` (COALESCE-guarded) |
| **Game-brief queue consumer (~L15115)** | `briefs` | **Yes — the only site missing it** |

Confirms this was an isolated bug at one call site, not a systemic pattern across the file — scoped the fix to exactly that one clause.

## Fix

Added `quality_score = excluded.quality_score` and `context_hash = excluded.context_hash` to the `UPDATE SET` clause. Left the existing `source` CASE logic (deliberate — never downgrade a `completion-trigger` row back to `cron` on a later conflicting write) untouched. Did not touch the `date` column, which has its own separate, already-identified issue (`briefDate` at this same call site is computed via raw UTC, not the `getFieldDateKey()` ET-anchored helper added earlier tonight) — adding `date` to this UPDATE SET without first fixing that computation would have introduced a regression (silently overwriting a correct `2026-07-15` date with an incorrect `2026-07-16` one). Flagged, not fixed — out of scope for what was asked.

## Verification

- `node --check src/index.js`: clean.
- **Real D1-level round-trip test** (not simulated) run directly against production `field-archive` before deploying: inserted a synthetic test row (`quality_score:100, context_hash:'hash1'`), then a conflicting re-insert (`quality_score:200, context_hash:'hash2'`) using the exact fixed SQL. Confirmed the row read back `200`/`'hash2'` — the new values, not stale ones.
- **Second round-trip confirming the `source`-preservation logic is unaffected**: inserted with `source:'completion-trigger'`, then a conflicting re-insert with `source:'cron'`. Confirmed `source` stayed `'completion-trigger'` while `quality_score`/`context_hash`/`brief_text` all correctly updated to the new write's values — the fix and the pre-existing, deliberate behavior coexist correctly.
- Test rows deleted after confirming.
- Deploy confirmed successful (`8329373`, `Deploy RELAY Worker` + `Post-deploy live verification`, both success).

## Data correction (one real row, directly tied to this bug)

`game_recap_wnba_401857070`'s stored `quality_score` was known-stale at `259` from the dead-hours-bypass dispatch's own test. Computed its real score by running the actual, deployed `scoreProse` against its actual current `brief_text` with real game context (`home: Indiana Fever, away: Golden State Valkyries, homeScore: 75, awayScore: 88`): **157**. Updated directly via `UPDATE briefs SET quality_score = 157 WHERE id = 'game_recap_wnba_401857070'`. Scoped to only this one row — the specific, known-affected case from tonight's own work, not a broader historical backfill (no attempt made to find or correct any other pre-existing stale rows from before this bug was found).

## Outcome

Bug fixed at its source, verified against the real database engine rather than assumed, and the one concretely-known-affected row corrected. Future conflicting writes to any `game-brief` row (completion-trigger following an earlier cron preview, or vice versa) will now correctly carry forward the latest run's real score and content hash instead of stranding stale ones next to fresh prose.
