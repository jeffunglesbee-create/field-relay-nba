# CC-CMD: Add a real finalized_at timestamp — the missing stable source

**Date:** 2026-07-07
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

**Source:** investigating a real user-reported bug ("The Truth Is"/Night
Stars renders inconsistently on iPad, never on Android) traced to a
genuine architectural gap, not a platform-specific rendering bug. The
client computes "how long ago did this game finish" using
`_finalizedAt`, a session-local in-memory map populated with
`Date.now()` the *first time the current session observes* a game as
final — not the game's real completion time. A fresh page load treats
every already-finished game as if it just ended; a long-running session
can lose this entirely if the page ever reloads mid-session. Two
different visible symptoms, one shared cause: **no stable, real
completion timestamp exists anywhere, client or server.** Confirmed via
direct schema check — `regular_season_games`/`postseason_games` have no
completion-time column at all, only `created_at` (pre-game row
creation, not completion).

**This CC-CMD is the prerequisite, not the full fix.** It adds the
missing stable source. A separate, follow-up client-side CC-CMD will
consume it — kept apart per Rule 7 (single-concern commits), and
because the client fix cannot be verified until this data actually
exists to read.

## PROBE BLOCK
```bash
sed -n '8195,8235p' src/index.js
```
Confirm `POST /archive/score-by-id` (used by `score-fill.mjs` — the
process that writes final scores) still matches before editing. This is
the correct, single point to add the timestamp — it's specifically the
final-score write path, not a live/in-progress score updater.

## TASK 1 — Schema migration

Add `finalized_at TEXT DEFAULT NULL` to both `regular_season_games` and
`postseason_games`, following the exact same `ALTER TABLE` pattern
already used for `went_to_ot`/`drama_peak` (find and reuse that exact
migration approach — check `ensureAnalyticsTables()` or wherever those
prior columns were added, do not invent a new migration mechanism).

## TASK 2 — Write it at the exact point scores are finalized

In `POST /archive/score-by-id`'s existing UPDATE statements, add
`finalized_at = COALESCE(finalized_at, datetime('now'))` — COALESCE so
a game is never re-finalized if this endpoint is somehow called more
than once for the same id, matching the same immutability spirit as
this session's earlier `drama_peak IS NULL` guard. Apply to all four
UPDATE variants (regular/postseason × with/without espn_event_id).

## TASK 3 — Expose it where the client can read it

Confirm `finalized_at` is included in whatever endpoint(s) the client
already uses to fetch archived/completed game data (`/v2/games` or
equivalent — check what the client's existing fetch actually returns
today before assuming a field needs adding to the response shape).

## VERIFICATION

- `node --check src/index.js`.
- Real D1 query: confirm the new column exists on both tables and is
  currently NULL for existing rows (expected — this only populates
  going forward, no backfill claimed).
- Trigger a real (or realistic synthetic) call to
  `/archive/score-by-id` for a test row, confirm `finalized_at` gets
  set to a real, current timestamp — report the actual value, not a
  hypothetical.
- Call the same endpoint again for the same id with different scores,
  confirm `finalized_at` does NOT change (COALESCE working) even
  though scores did — report the actual before/after values.

## DONE CONDITIONS
- [ ] Probe block confirms citation before editing
- [ ] `finalized_at` column added to both tables, matching the existing migration pattern
- [ ] Written via COALESCE at the exact score-finalization point, all four UPDATE variants
- [ ] Confirmed exposed in whatever the client already fetches for completed games
- [ ] Real test confirms it populates once and doesn't change on a second write
- [ ] Outbox explicitly states this is the prerequisite only — no client change here

## CONFIDENCE SCORING TABLE
+20  Schema migration correct, matches existing pattern
+30  COALESCE write correct across all four UPDATE variants, verified via real test
+20  Confirmed exposed in the client-facing endpoint
+15  Real before/after test proves immutability
+15  Outbox correctly scopes this as prerequisite-only

## ONE-LINER
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO -- this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-07-finalized-at-timestamp.md. Add a
real finalized_at TEXT column to both game tables (matching the existing
went_to_ot/drama_peak migration pattern), written via COALESCE at the
exact point /archive/score-by-id finalizes a score across all four
UPDATE variants, and confirm it's exposed in whatever the client already
fetches for completed games. This is the prerequisite only -- no client
change in this CC-CMD. Verify with a real test that it populates once
and doesn't change on a second write. Do not commit unless confidence
>= 95. If score < 95, report verbatim and stop.
