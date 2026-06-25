# BSD Endgame Capture + Retry + Score Fix — 2026-06-25

## Commit

- `1e355cb` feat(bsd): endgame cron capture + retry + score fix at game-final
- Deploy: workflow 28206273087 — step 6 (Deploy to Cloudflare Workers) success at 23:11:01Z

## Three patches shipped

**PATCH 1 — Score UPDATE in `writeWCResult`**
Added `UPDATE wc_results SET home_score = ?, away_score = ? WHERE game_id = ?` immediately
after `INSERT OR IGNORE`. The INSERT was keeping the original 0-0 row unchanged at game-final
(it only fires once — on first write, which was often a kickoff pre-insert). The UPDATE now
always writes the authoritative final score. Ecuador vs Germany (`football:1489410`) was
stuck at 0-0 in D1 — this fixes it going forward. The stuck row requires a manual D1
UPDATE (blocked in-session by Rule 80 — CF_API_TOKEN not in context).

**PATCH 2 — `captureWithRetry` replaces fire-and-forget R2 capture**
New module-level function `captureWithRetry(url, r2Key, env, meta, maxAttempts=7, intervalMs=15000)`.
7 attempts × 15s = 105s window. Handles headers internally via `env.BSD_API_TOKEN`.
Replaced the old fire-and-forget single-attempt map in the `writeWCResult` R2 capture block.
Also fixed `env._ctx.waitUntil` → `ctx?.waitUntil` (ctx is the real parameter, not env._ctx).

**PATCH 3 — `runBSDEndgameCapture` in `scheduled()` (every-5-min cron)**
New function polls BSD `/api/v2/events/live/` for WC games (league_id=27) at `current_minute >= 83`.
Captures all 4 endpoints (momentum, stats, incidents, average-positions) with single attempt
per tick — data is live, overwrites R2 on each cron. Fires at ~83' and ~88', preserving
momentum + average-positions before they go stale at game-final.

## Bundle verification (Rule 77 — no /deploy/verify alone)

`workers_get_worker_code` grep against live bundle at 23:11:29Z:
- `captureWithRetry`: 4 hits ✓
- `runBSDEndgameCapture`: 3 hits ✓
- `UPDATE wc_results SET home_score`: 1 hit ✓

`/deploy/verify` showed `match=false` at check time (23:11:29Z, 28s after step 6 completion).
This is CF edge propagation lag — not a build failure. Bundle-level verification via
`workers_get_worker_code` is authoritative (see golf outbox for /deploy/verify reliability notes).

## Done conditions

- [x] `node --check src/index.js` — passes
- [x] `captureWithRetry` grep: 4 (function def + 2 call sites + 1 comment)
- [x] `runBSDEndgameCapture` grep: 4 (function def + scheduled hook + 2 comments)
- [x] `UPDATE wc_results SET home_score` grep: 1
- [x] Cron filter simulation: `Would capture: 1 game(s)` for a game at 85'
- [x] R2 list — 4 existing keys preserved (8341 + 8342 incidents + stats)
- [x] Bundle verified via `workers_get_worker_code` — all 3 patches present
- [ ] `/deploy/verify match=true` — pending CF propagation (checked 28s post-deploy)
- [ ] Ecuador 2-1 Germany D1 fix — requires manual `CF_API_TOKEN` UPDATE (Rule 80 blocks in-session)

## Residual

**Ecuador 0-0 D1 fix**: The `UPDATE wc_results SET home_score=2, away_score=1 WHERE game_id='football:1489410'`
probe step requires `CF_API_TOKEN` which cannot be in agent context (Rule 80). Fix options:
1. POST to `/admin/wc/bsd-backfill` with `leagueId=27` after Ecuador@Germany goes live again in BSD (unlikely post-final)
2. Direct D1 console UPDATE in the CF dashboard
3. The score fix shipped in `1e355cb` ensures all future game-finals write correct scores — Ecuador was a historical artifact

**WC endgame activation**: `runBSDEndgameCapture` will fire on the next cron tick (within 5 min)
and capture any live WC game at 83'+. WC league_id=27 confirmed live (Ecuador@Germany + Curaçao group).

## Compliance

- **Rule 80**: No credentials in agent context. `env.BSD_API_TOKEN` used relay-side only.
- **Rule 5**: `captureWithRetry` failure returns `false` — never throws into calling context.
  `writeWCResult` capture block is inside `if (game.bsdEventId)` guard, not on the D1 write path.
- **Rule 47**: Arithmetic + classification only — no editorial computation.
- **Rule 69**: Only `src/index.js` touched. One commit.
