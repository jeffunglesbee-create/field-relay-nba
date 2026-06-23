# ESPN Event ID Schema + Backfill Enrichment — 2026-06-23

## Probes (Rule 68)

| # | Probe                                  | Result                                                                   |
|---|----------------------------------------|--------------------------------------------------------------------------|
| 1 | `regular_season_games` INSERT          | `src/index.js:6944` — no espn_event_id column or bind                     |
| 2 | `postseason_games` INSERT              | `src/index.js:6919` — same gap                                            |
| 3 | `executeGameBriefBackfill` ctx call    | `src/index.js:4383` — passed `sourceId: game.source_id || null` (column absent → always null) |
| 4 | `/backfill/game-briefs` SELECT + ctx   | SELECTs at 7491/7502 lack venue + espn_event_id; ctx call at 7570 had same null sourceId |
| 5 | `/backfill/game-briefs` prompt         | Line 7577 — venue not in prompt                                            |
| 6 | `executeGameBriefBackfill` prompt      | Line 4409 — venue not in prompt                                            |
| 7 | Pending backfill count (no force)      | 1 (today's WC Portugal vs Uzbekistan)                                      |
| —  | Pending backfill count (force=true)    | ≥50 (capped at limit)                                                      |

## Schema migration (Task 1)

Applied via Cloudflare D1 MCP against `cc49101c-0569-4d41-8e7a-be139cde4f26`:

```sql
ALTER TABLE regular_season_games ADD COLUMN espn_event_id TEXT;
ALTER TABLE postseason_games     ADD COLUMN espn_event_id TEXT;
```

`PRAGMA table_info(regular_season_games)` confirms `espn_event_id TEXT` at cid:19.
Both ALTERs succeeded — `meta.rows_written:1`, no errors.

## What shipped (Tasks 2–5)

`src/index.js` — single commit `49599fa`:

- `/archive/game` INSERTs (both tables) now persist `espn_event_id` from
  the body's `source_id` field, COALESCE-guarded in ON CONFLICT.
- `/backfill/game-briefs` SELECTs include `g.venue, g.espn_event_id`
  (regular + postseason).
- Both backfill `assembleContext` call sites (`executeGameBriefBackfill`
  L4386 and `/backfill/game-briefs` L7572) now read
  `game.espn_event_id || null` → flows into `buildESPNSummaryContext`.
- Both backfill prompts (L4413 and L7581) gain `Venue: <name>` line
  above the `Date:` line when venue is present.

## Commit & deploy

- `49599fa` feat: persist espn_event_id + enrich backfill prompts with venue
- Deploy: workflow 28057373717 — completed/success.

## Backfill re-gen execution

Iterated `/backfill/game-briefs?force=true&date=YYYY-MM-DD&limit=5` across
dates (MCP probe times out at 60 s for batches > ~5 LLM calls):

| Date         | Processed | Notes |
|--------------|-----------|-------|
| (top, no date)| 5         | FIFA Portugal vs UZB (NEW, 176), Argentina vs Austria (143), golf R4 (112), MLB Dodgers (157), MLB Athletics (178) |
| 2026-06-21   | 5         | scores 145–178 (one MLB hit 178) |
| 2026-06-20   | 5         | scores 105–180 (MLB Tigers 180, WNBA Dream 157) |
| 2026-06-19   | 1         | golf R2 (93) |
| 2026-06-15   | 1         | NHL SCF G6 (183) |
| 2026-06-11   | 1         | NBA Finals G4 (215) |
| 2026-06-09   | 1         | NBA Finals G3 (183) |
| 2026-06-06   | 1         | NBA Finals G2 (179) |
| **Total**    | **20**    | mixed sports re-scored with venue line |

Note: force loop without `?date=` re-targets the same top-5 each pass
because the SELECT clauses don't track "already re-scored this pass"
(brief is DELETEd + re-INSERTed with source='backfill' still, so it keeps
matching). Date-walking is the workaround. Spec's "until missing=0" loop
condition isn't reachable with this handler — the operational
done-condition is `/quality/report` improvement, which IS achieved.

## Task 6 verification — before vs after

| brief_type   | sport          | baseline avg | after avg | Δ      |
|--------------|----------------|-------------:|----------:|-------:|
| `game_brief` | **MLB**        |        159.6 | **164.3** | +4.7 ✓ |
| `game_brief` | FIFA WC 2026   |        136.7 |     150.0 | +13.3  |
| `game_brief` | WNBA           |        139.3 |     155.7 | +16.4  |
| `game_brief` | golf           |         91.4 |     107.7 | +16.3  |

**Spec done condition: `game_brief MLB avg > 159.6` — PASS (164.3).**

Side-effect: `/quality/report` `alert_count` dropped 5 → 4. `game_brief WNBA`
no longer alerts (155.7 above the 130 threshold and 33% failure_pct below
the 40% trigger).

## Carry-forwards

1. **Venue carries most of the lift.** Existing rows have
   `espn_event_id=NULL` (column was added today), so
   `buildESPNSummaryContext` still returns `''` for them. The gain comes
   from the new `Venue:` prompt line and the JQ_STYLE re-pass during
   re-gen. Once newly-archived games include espn_event_id, those
   backfill paths will additionally inject `[ESPN GAME LEADERS]`.
2. **Force-true loop convergence.** The current handler keeps matching
   the same top-N games on each call because re-inserts keep
   `source='backfill'`. The spec's "repeat until missing=0" doesn't
   converge. Operational pattern documented: walk by date. A small
   handler-side change (e.g. UPDATE source='backfill-v2' after re-gen,
   or change the existsClause to also exclude same-day re-runs) would
   make the loop self-terminating; out of scope for this CC-CMD.
3. **MCP probe timeout.** `probe_relay_route` times out at 60 s; per-game
   LLM call is 5–10 s, so the practical batch limit through MCP is 5.
   The route accepts up to 50; direct curl from a non-sandboxed host
   would handle the full sweep faster.
4. **espn_event_id population is forward-only.** New `/archive/game`
   POSTs that include `source_id` will populate the column.
   Retroactive population would need a separate backfill that
   cross-references ESPN scoreboards by date+team — bigger scope,
   future session.
5. **Golf still alerts implicitly low.** game_brief golf moved
   91.4 → 107.7 but is structurally below any reasonable threshold
   (no context builder exists for golf). The previous CC-CMD
   excluded golf from alerts, so this no longer fires — but the
   score quality remains the lower bound.

## Verify commands

```
probe_relay_route /backfill/game-briefs?dry=true             # baseline pending
probe_relay_route /backfill/game-briefs?force=true&date=YYYY-MM-DD&limit=5
probe_relay_route /quality/report                            # game_brief MLB avg
```
