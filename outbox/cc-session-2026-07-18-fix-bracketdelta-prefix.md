# CC Session — 2026-07-18 — Fix bracket_delta game_id prefix mismatch

**Date:** 2026-07-18
**HEAD start:** a5c5a5f
**HEAD end:** f2373ed
**Branch:** main

---

## Commit f2373ed

**Problem:**
Real WC 3rd-place match (France vs England, espn:760516) confirmed Gap 7's write path working but read path broken. `/context/game/espn:760516` returned `bracketDelta: null` despite a real row existing in D1.

**Root cause confirmed (TASK 1):**
- BracketDO writes `game_id: triggerResult.gameId` = `'espn:760516'` (WITH prefix)
- `triggerResult.gameId = game.id` = `espn:${ev.id}` from ESPN WC adapter in index.js ~L1607
- `findBracketDelta` caller: `briefId = game?.espn_event_id || id` = `'760516'` (bare)
- `findBracketDelta` queries `WHERE game_id = ?` with `'760516'` — exact match never found

**Fix (TASK 2 — write side only):**
`src/bracket-do.js` line 397:
```
// BEFORE:
game_id: triggerResult.gameId,

// AFTER:
game_id: String(triggerResult.gameId).replace(/^[a-z]+:/, ''),
```
Strips any `sport:` prefix at write time, matching the bare-ID convention used by `espn_event_id` column and all other `briefs.game_id` lookups.

**TASK 3 — verified:**
`grep -n "game_id.*bracket_delta\|bracket_delta.*game_id\|game_id.*triggerResult" src/bracket-do.js`
→ `397: game_id: String(triggerResult.gameId).replace(/^[a-z]+:/, ''),`

**TASK 4 — D1 backfill:**
Confirmed exactly 1 broken row:
```
id: bracket_delta:espn:760516:2026-07-18T23:02:33.093Z
game_id: espn:760516  (broken)
```
D1 UPDATE:
```sql
UPDATE briefs SET game_id = '760516'
WHERE id = 'bracket_delta:espn:760516:2026-07-18T23:02:33.093Z'
AND brief_type = 'bracket_delta'
```
Result: `changes: 1`. Re-verified: `game_id = '760516'` confirmed.

**TASK 5 — verification:**
Direct D1 query `WHERE game_id = '760516' AND brief_type = 'bracket_delta'` returns the row with real brief_text containing France 4–6 England data. Sandbox proxy (403) blocks live curl to workers.dev — genuine proxy failure per Rule 87. KV cache TTL = 300s (final game), so stale null response expires within 5min of next real request.

## Integration status
- VERIFIED (write fix + D1 backfill confirmed via D1 MCP tool)
- STAGED (live probe): embedded in `post-deploy-live-verify.yml` step "bracketDelta end-to-end probe -- espn:760516 gap-7 final verification" (commits e9ec15c + 75a1994). Will auto-run on the next `src/` deploy.
  - `workflow_dispatch` trigger is in the file at 75a1994 but GitHub API has not yet propagated the registration (422 returned despite correct YAML). File confirmed correct via `get_file_contents`.
  - Probe auto-runs via `workflow_run` trigger on next Deploy RELAY Worker success.
  - Manual verify (once dispatch propagates): `workflow_dispatch` on `post-deploy-live-verify.yml`, main ref.
  - Expected output: `PASS: bracketDelta populated. triggerGame='France 4–6 England'` (or X-Cache:HIT soft-warn which self-heals within 300s)
  - Unblocked when: next src/ deploy completes (auto) or GitHub registers dispatch trigger (manual).

## Confidence scoring
- TASK 1 (15/15): write-side source confirmed
- TASK 2 (35/35): fix applied
- TASK 3 (15/15): grep verified
- TASK 4 (15/15): D1 UPDATE confirmed, re-verified
- TASK 5 (15/20): D1 read confirmed; live probe step embedded in CI (e9ec15c+75a1994); GitHub dispatch lag prevents immediate manual trigger; auto-runs on next deploy
- **Total: 95/100** — commit threshold met and exceeded
