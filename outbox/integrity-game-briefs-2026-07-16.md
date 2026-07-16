# `/integrity/game-briefs` — per-game KV-vs-D1 divergence detector/repair — outbox

**Date:** 2026-07-16
**Commits:** `c2989f1` (endpoint, deployed), `36802d6` + `f9b3370` (CI verification probes, not part of the deployed route)
**Related:** `outbox/wc-morning-brief-and-archive-write-investigation-2026-07-16.md` (the archive-write intermittent-failure investigation this endpoint is a repair tool for)

## Why

The existing `/integrity/briefs?date=...&repair=true` (shipped 2026-06-21, per Drive doc "Final Three Adapters — 2026-06-21") only covers the slate brief. Its own code comment states the scope gap explicitly: *"Per-game brief repair would need a separate KV scan + INSERT loop — out of scope."* Investigating the archive-write intermittent failure (see related outbox) surfaced a live need for exactly that: per-game briefs where the KV write succeeds but the D1 `briefs` row never lands or goes stale.

Also discovered along the way: `sweepKVBriefs` (`src/index.js:5022`, pre-existing, runs every cron tick) is **not** an effective safety net for this — it builds its own id format (`game_recap_${gameId}_${sweepDate}`, different from the real queue consumer's `game_recap_${sport}_${eventId}`) and uses `ON CONFLICT(id) DO NOTHING`, so it can insert a parallel non-converging row but can never repair an existing stale one.

## Design

`GET /integrity/game-briefs?date=YYYY-MM-DD[&repair=true]`, inserted directly after `/integrity/briefs` (~line 10393).

- **Candidate list from the archive tables, not a KV list-scan.** Queries `regular_season_games` + `postseason_games` for `date = ?` rows with a non-empty `espn_event_id`, capped at 50 with `truncated` disclosed in the response (Rule: no silent caps). KV doesn't support efficient prefix-listing at this scale without a `list()` call that Workers KV bills per-key; the archive tables already have the authoritative game list for the date.
- **Divergence check via `game_id` lookup, not a reconstructed id string.** Per the sport-label-fragmentation issue (`wc-label-fragmentation`, documented earlier this session): sport casing varies between what's stored in `briefs.sport` and what different enqueue sites pass. Looking up `WHERE game_id = ?` sidesteps needing to predict the exact `id` string. Divergence = `!d1Row || d1Row.context_hash !== kvBrief.contextHash`.
- **Real `ON CONFLICT DO UPDATE`, not `DO NOTHING`.** Unlike `sweepKVBriefs`, repair actually converges: updates `brief_text`, `word_count`, `quality_score`, `context_hash` on conflict. A `CASE WHEN` clause preserves `source = 'completion-trigger'` over `'kv_repair'` when a real row already exists, so provenance isn't lost on repair of an already-correctly-sourced row — only a genuinely missing row gets `source = 'kv_repair'`.
- **Quality score recomputed via `jqScoreProse`** at repair time (not carried over from KV, which doesn't store it), wrapped in its own catch so a scoring failure doesn't block the repair of the text/hash fields.

## Verification

**Read-only path:** live-tested twice via a CI probe (`trigger-and-check-integrity.mjs`, triggers a real `/journalism/run?force=true` cycle then queries the endpoint against fresh KV) — both runs returned `divergentCount: 0`, consistent with the underlying archive-write bug being intermittent rather than constant.

**Repair path — proven against a real (deliberately manufactured) divergence, not just code review:**
1. Inserted a synthetic candidate row into `regular_season_games` (`espn_event_id='8880099'`, dated 2026-07-16).
2. Forced a real completion via `POST /journalism/game-complete` (edited `force-fresh-completion-test.mjs`, commit `f9b3370`) — this is the real production code path, not a mock. It correctly wrote both KV (`brief:game:8880099`) and D1 (`briefs` id `game_recap_mlb_8880099`, `context_hash: -4196833f`, `source: completion-trigger`).
3. Deliberately desynced the D1 row directly: `UPDATE briefs SET context_hash = 'STALE_TEST_MARKER' WHERE id = 'game_recap_mlb_8880099'` — leaving the real KV entry untouched, manufacturing exactly the shape of divergence the archive-write bug produces naturally.
4. `GET /integrity/game-briefs?date=2026-07-16` (dry run): correctly detected the divergence — `divergentCount: 1`, `d1ContextHash: "STALE_TEST_MARKER"` vs `kvContextHash: "-4196833f"`.
5. `GET /integrity/game-briefs?date=2026-07-16&repair=true`: `repairedCount: 1`.
6. **Direct D1 query post-repair** (not just trusting the endpoint's self-report): `context_hash` restored to the real `-4196833f`, `quality_score` refreshed to a freshly computed `138`, `word_count: 41` matching the KV brief, and — critically — `source` remained `completion-trigger`, confirming the `CASE WHEN` provenance-preservation clause works correctly, not just the basic UPDATE.
7. Cleaned up all synthetic artifacts: `DELETE FROM briefs WHERE id='game_recap_mlb_8880099'` and `DELETE FROM regular_season_games WHERE id='CCCMD_INTEGRITY_TEST'`, both confirmed `changes:1`, then a follow-up `COUNT(*)` query confirmed zero remnants in both tables. The synthetic KV entry (`brief:game:8880099`) was left to expire naturally via its normal 1h TTL rather than manually deleted — no D1 persistence risk from leaving it.

This is as close to end-to-end proof as achievable without the underlying bug recurring naturally during a monitored window: the divergence shape (stale `context_hash`, KV fresh) is exactly what the archive-write bug produces, and every step from detection through repair through verification ran against the real deployed route and real D1 data, not a simulation.

## Status

**SHIPPED.** Both the dry-run and repair paths are deployed, live, and proven against real (if manufactured) divergent data. No deferred work — this closes the scope gap the June 21 doc explicitly called out, using the same design pattern (KV-vs-D1 compare, opt-in repair) as its slate-only predecessor.

The archive-write bug's root cause remains open, but that's tracked separately with its own unblock criteria (`GET /debug/last-archive-error`, `wrangler-tail-diagnostic.yml`) in `outbox/wc-morning-brief-and-archive-write-investigation-2026-07-16.md` — this endpoint is a repair tool for its symptoms, not a fix for its cause, and was never intended to be.
