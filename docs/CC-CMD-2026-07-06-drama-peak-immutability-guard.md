# CC-CMD: Immutability guard on drama_peak writes

**Date:** 2026-07-06
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

**Source:** RUWT patent re-analysis this session. `'326` claim 1's trigger
is "the rating...has changed" — requires two distinct values over time
for the same event. FIELD's actual, current backfill behavior already
never overwrites a scored game (verified: the only caller,
`drama-backfill.mjs`, sources exclusively from the NULL-filtered
`/archive/drama-missing` list). This CC-CMD makes that a hard guarantee
instead of an incidental fact of how the one existing caller happens to
behave. **Verified this exact change has zero effect on any current
caller** — confirmed directly this session before writing this doc.

**Target time:** ~10 min

## PROBE BLOCK
```bash
sed -n '8230,8285p' src/index.js
grep -n "archive/drama-by-id\|archive/drama\b" ../jubilant-bassoon/scripts/*.mjs 2>/dev/null || true
```
Confirm both UPDATE statements still match citations below before editing.

## TASK — Add the guard to both write paths

Line ~8240:
```sql
UPDATE ${table} SET drama_peak = ?, drama_arc = ? WHERE id = ? AND drama_peak IS NULL
```
Lines ~8277 and ~8281 (both tables):
```sql
UPDATE regular_season_games SET drama_peak = ?, drama_arc = ? WHERE id = ? AND drama_peak IS NULL
UPDATE postseason_games    SET drama_peak = ?, drama_arc = ? WHERE id = ? AND drama_peak IS NULL
```
Check `result.changes` after each write. If `changes === 0` for a
request that expected to write (i.e., the row already had a
`drama_peak`), return a clear response indicating the row was already
scored and the write was skipped — not a generic success, so a caller
mistakenly trying to overwrite an existing value gets an honest signal
rather than silent success.

## VERIFICATION
- `node --check src/index.js`
- Run the existing `drama-backfill.mjs` against real data (or a real
  subset) and confirm it behaves identically to before — same rows
  filled, same count, since it only ever targets NULL rows anyway.
- Manually attempt a write against a game that already has a
  `drama_peak` (via curl, using a real already-scored game's id) and
  confirm it now returns the "already scored, skipped" response with
  `changes: 0`, not a silent overwrite.

## DONE CONDITIONS
- [ ] Probe block confirms citations before editing
- [ ] Guard added to all 3 UPDATE statements
- [ ] `changes === 0` case returns an honest "already scored" response, not generic success
- [ ] Real backfill run confirmed unaffected
- [ ] Real attempted-overwrite test confirmed blocked
- [ ] Outbox written

## CONFIDENCE SCORING TABLE
+35  Guard added correctly to all 3 statements
+25  changes===0 case handled honestly, not silently
+25  Verified live: real backfill unaffected, real overwrite attempt blocked
+15  Outbox written

## ONE-LINER
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO -- this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-06-drama-peak-immutability-guard.md.
Add `AND drama_peak IS NULL` to all 3 UPDATE statements writing
drama_peak, and make the changes===0 case return an honest
"already-scored, skipped" response. Verify the real drama-backfill
script still behaves identically, and verify a real attempted overwrite
against an already-scored game is now blocked. Do not commit unless
confidence >= 95. If score < 95, report verbatim and stop.
