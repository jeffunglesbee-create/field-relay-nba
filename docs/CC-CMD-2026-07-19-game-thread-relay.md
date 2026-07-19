# CC-CMD — Game Thread: relay implementation (Phase 1 of approved spec)

**Date:** 2026-07-19
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5

---

## CONTEXT

Implements the relay side of `docs/SPEC-game-thread-2026-07-19.md` (client
repo, jubilant-bassoon), status "Approved for implementation." Per that
spec's own explicit ordering: relay first, client second — do not begin
client work until this relay implementation is confirmed live.

**Real, confirmed scope from the spec — re-read it directly before
starting, don't work from this summary alone:** a `game_thread_notes` D1
table (in `ARCHIVE_DB`), two new WebSocket message types on GameDO
(`thread_note` client→server, broadcast server→all), a 30-second per-
session rate cap (in-memory, not persisted), a 50-note backfill-on-join
(`thread_catchup`), and an hourly cleanup cron deleting expired rows
(15 minutes after the game's own final timestamp).

**Real, explicit ADR-002 constraint already built into the spec — confirm
you understand this before writing any code:** GameDO stores and echoes
note text verbatim. No classification, scoring, or editorializing of note
content. No author ID, no IP, no session token is ever stored server-side
— the `token` field is client-generated, echoed back verbatim, and treated
by the server as an opaque, meaningless label.

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline -5
grep -n "ALLOWED_CLIENT_MSG_TYPES" src/game-do.js
grep -n "webSocketMessage" src/game-do.js
# Confirm ARCHIVE_DB binding already present
grep -n "ARCHIVE_DB" wrangler.toml
# Confirm the real, current cron handler structure for adding the hourly sweep
grep -n "scheduled\|cron" src/index.js | head -10
```

Confirm the real, current shape of each of these before touching them —
the spec's own code snippets are illustrative, not necessarily an exact
match for current source.

---

## TASK 1 — D1 schema migration

```sql
CREATE TABLE IF NOT EXISTS game_thread_notes (
  id          TEXT PRIMARY KEY,
  game_id     TEXT NOT NULL,
  sport       TEXT NOT NULL,
  body        TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gtn_game_ts ON game_thread_notes(game_id, ts);
```

Apply via the real, established migration path for this repo (D1 MCP tool
or existing migration mechanism — confirm which is correct, don't assume).

## TASK 2 — GameDO message handling

Add `'thread_note'` to the real, current `ALLOWED_CLIENT_MSG_TYPES`. In the
real `webSocketMessage` handler: validate body (1-280 chars after trim,
silently reject if empty or over limit), apply the 30-second rate cap
(in-memory per-session, not persisted), write to `ARCHIVE_DB.game_thread_notes`,
broadcast to all connected sessions.

## TASK 3 — Backfill on join

On WebSocket open (after the existing `hello` handshake), fetch the last 50
notes for the game from D1, send as `thread_catchup` to the joining session
only — per spec, `token` is NOT included in catchup notes.

## TASK 4 — Hourly cleanup cron

Add to the real, existing cron handler: delete rows where `expires_at <
Date.now()`. Confirm the real, current cron schedule mechanism and add
this without disrupting existing scheduled jobs.

## TASK 5 — Real, direct verification

A real, manual WebSocket probe (not just code inspection) confirming:
1. A `thread_note` message is genuinely accepted, stored, and broadcast
2. A real D1 query confirms the row exists in `game_thread_notes`
3. A second, real connection to the same game receives `thread_catchup`
   with the real note included
4. Rate cap genuinely rejects a second send within 30 seconds

---

## DONE CONDITION

Matches the spec's own stated relay done-condition exactly: a real
WebSocket client connected to a LIVE game's GameDO instance can send a
`thread_note` and receive it broadcast back within 1 second, disconnect
and reconnect to receive the last 50 notes as `thread_catchup`, have the
note confirmed present in `ARCHIVE_DB.game_thread_notes` via a real D1
query, and confirmed absent 15 minutes after `expires_at`.

**Confidence scoring:**
- TASK 1 (15 pts): real schema migration confirmed
- TASK 2 (30 pts): real message handling, rate cap, broadcast — confirmed via pasted output
- TASK 3 (15 pts): real backfill-on-join, confirmed via pasted output
- TASK 4 (15 pts): real cleanup cron, confirmed via pasted output
- TASK 5 (25 pts): real, direct WebSocket probe confirming all 4 real behaviors above

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.

**This is relay-only. Do not begin any client-side work in this dispatch — the client CC-CMD is separate, and per the spec, must not start until this relay work is confirmed live.**
