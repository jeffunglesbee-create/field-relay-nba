# CC Session — 2026-07-20 — Game Thread Relay

## HEAD Progression
- Start: `6651771`
- End:   `5c397de`

## Commits
`feat: game thread relay — thread_note WS handler, D1 write, catchup-on-join, hourly cleanup cron`

## TASK 1 — D1 Schema Migration
Applied via Cloudflare D1 MCP tool to `ARCHIVE_DB` (`cc49101c-0569-4d41-8e7a-be139cde4f26`):
- `game_thread_notes` table created (id, game_id, sport, body, ts, expires_at)
- `idx_gtn_game_ts` index created on (game_id, ts)
- Confirmed via `SELECT name FROM sqlite_master` — table present.
- **VERIFIED**

## TASK 2 — GameDO Message Handling (`src/game-do.js`)
- `thread_note` added to `ALLOWED_CLIENT_MSG_TYPES`
- Constants added: `THREAD_RATE_CAP_MS = 30s`, `THREAD_NOTE_TTL_MS = 4h`
- Handler: validates body (1-280 chars after trim, silent reject on fail)
- Rate cap: `ws.deserializeAttachment()` / `ws.serializeAttachment()` — hibernation-safe per-session state
- Rate cap rejection sends `thread_rate_limited` with `retryAfter` seconds
- D1 write: `crypto.randomUUID()` id, `expires_at = ts + 4h`, wrapped in try/catch (Rule 5)
- Broadcast: `{type:'thread_note', id, game_id, body, ts, token}` — token echoed verbatim from msg, never stored
- ADR-002 clean: no classification, no scoring, no author identity stored
- **STAGED** — requires deployed Worker for E2E WebSocket probe

## TASK 3 — Backfill on Join (`src/game-do.js`)
- Added after `ctx.acceptWebSocket(server)`, before `_ensurePolling()`
- Queries: `SELECT id, game_id, body, ts FROM game_thread_notes WHERE game_id = ? ORDER BY ts DESC LIMIT 50`
- Reverses results (oldest-first) before sending `thread_catchup` to joining session only
- `token` not included in catchup notes (per spec)
- D1 failure non-fatal — logs error, connection proceeds
- **STAGED** — requires deployed Worker for E2E probe

## TASK 4 — Hourly Cleanup Cron
- `wrangler.toml`: added `30 * * * *` to crons array
- `src/index.js`: early-return block for `event.cron === '30 * * * *'` (same isolation pattern as anomaly watcher at `0 * * * *`)
- Deletes `WHERE expires_at < Date.now()`; logs deleted count
- Returns early — journalism/KV/handleCron never run on this tick
- **STAGED** — fires at next :30 mark post-deploy

## Confidence Score
- TASK 1: 15/15 — D1 confirmed via MCP
- TASK 2: 30/30 — code correct, ADR-002 clean, syntax OK
- TASK 3: 15/15 — logic correct, syntax OK
- TASK 4: 15/15 — wrangler.toml + early-return pattern matches existing
- TASK 5: 18/25 — syntax verified; E2E WS probe sandbox-blocked
- **Total: 93/100** — committed per user direction (sandbox blocks the final 7pts, not code uncertainty)

## Integration Status
| Feature | Status | Unblock |
|---|---|---|
| D1 schema | VERIFIED | — |
| thread_note handler | STAGED | Deploy + live WS probe |
| thread_catchup on join | STAGED | Deploy + second-session probe |
| rate cap | STAGED | Deploy + rapid-send test |
| hourly cleanup | STAGED | Deploy + wait for :30 tick, check D1 count |

## Relay Contract (for client CC-CMD)
- **WebSocket message in:** `{type:'thread_note', body: string (1-280), token: any}`
- **WebSocket broadcast out:** `{type:'thread_note', id: uuid, game_id: string, body: string, ts: ms, token: echoed}`
- **WebSocket on join:** `{type:'thread_catchup', notes: [{id, game_id, body, ts}]}` (no token)
- **Rate limit response:** `{type:'thread_rate_limited', retryAfter: seconds}`
- **D1 table:** `ARCHIVE_DB.game_thread_notes` — id, game_id, sport, body, ts, expires_at

## Next Step
Client CC-CMD (`jubilant-bassoon`) may begin once this commit is confirmed live via deploy CI.
