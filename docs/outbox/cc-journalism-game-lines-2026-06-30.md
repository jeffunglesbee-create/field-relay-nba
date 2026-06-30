# Outbox — /journalism/game-lines Endpoint

**Date:** 2026-06-30
**Relay HEAD:** 1ee41f8
**CC-CMD:** docs/CC-CMD-2026-06-27-relay-game-lines.md
**Status:** SHIPPED

---

## Pre-Build Probe Results

| Probe | Finding |
|-------|---------|
| P1 `FIELD_JOURNALISM` binding | `binding = "FIELD_JOURNALISM"` confirmed in wrangler.toml |
| P2 `brief:game:` prefix | Found at multiple lines; keys follow `brief:game:{sport}:{id}` AND `brief:game:{id}` patterns |
| P3 `game-lines` exists? | Zero matches — route did not exist |
| P4 journalism route block | `/journalism/tonight` at L10197, `/journalism/game/` at L10210 — insertion anchor confirmed |
| P5 `FIELD_JOURNALISM.list()` pattern | `FIELD_JOURNALISM.list({ prefix: 'brief:game:', limit: 50 })` at L4225 |
| P6 `node --check` baseline | PASS |

---

## Task Implemented

### Task 1 — `/journalism/game-lines` route

Inserted after the `/journalism/game/{eventId}` block (L10219), before the `/nflverse/` block.

Key implementation details:
- CF edge cache check first (60s TTL)
- `FIELD_JOURNALISM.list({ prefix: 'brief:game:', limit: 100 })`
- Per-key: get raw value, attempt JSON parse for `text/brief/brief_text` field, fall back to raw string
- First sentence extraction via `/\.\s+/` split
- Key parsing mirrors `sweepKVBriefs`: `parts.length >= 2 ? parts[parts.length - 1] : parts[0]` — handles both `brief:game:{sport}:{id}` and `brief:game:{id}` formats
- Minimum first-sentence length guard: 20 chars
- Returns `{ ok: true, lines: { [espnId]: "First sentence." }, count: N }`
- All KV ops in try/catch (Rule 5 compliant)

---

## Deploy

- Commit: `1ee41f8`
- Workflow run: `28480455057`
- Triggered automatically by push to `src/**` — no `[skip ci]`
- CI conclusion: `success`
- `deploy/verify` match: `true` — confirmed at 2026-06-30T22:40:26Z

---

## Post-Deploy Probe Results

| Probe | Result |
|-------|--------|
| P7 `/journalism/game-lines` | HTTP 200, `ok: true`, `count: 20` |
| P8 `/health` | HTTP 200, `RELAY OK` |

Sample lines from P7 response:
- `760490`: `"Norway secured a 2-1 victory over Ivory Coast at AT&T Stadium in this FIFA World Cup match broadcast on FOX."`
- `401815965`: `"Tarik Skubal brings a 3.32 ERA this season to Yankee Stadium to face Cam Schlittler, who holds a 1.62 ERA this season."`
- `401857321`: `"Commissioner's Cup Championship glory awaits the winner at Barclays Center on Prime Video."`

---

## Done Conditions

- [x] P1–P6 probes all passed before any edit
- [x] `/journalism/game-lines` route added to src/index.js
- [x] `node --check src/index.js` clean
- [x] Commit pushed, CI deploy green (run 28480455057, success)
- [x] `/journalism/game-lines` → HTTP 200, `ok: true`
- [x] `/health` still OK
- [x] Outbox manifest written to `docs/outbox/cc-journalism-game-lines-2026-06-30.md`
