# Brief Archive — Night Owl D1 Writes — 2026-06-17

## Commit A — Night Owl D1 write in game-brief queue consumer (commit `8e3745a`)

**Location**: `src/index.js` queue consumer, `job.type === 'game-brief'` branch.

**KV put mapped**: `FIELD_JOURNALISM.put('brief:game:{job.eventId}', ...)` at the existing line
with `{expirationTtl: 3600}`. The D1 write is inserted immediately after, before `msg.ack()`.

**Variables used (from queue consumer scope)**:
- `job.eventId` → `game_id` and id suffix
- `job.sport` → `sport`
- `job.enqueuedAt` → `date` (ISO slice 0-10; falls back to `Date.now()`)
- `job.gameHash` → `context_hash`
- `finalText` → `brief_text` (already stripped of markdown)
- `'claude-haiku-4-5-20251001'` → `model` (hardcoded in callProxy at the top of this branch)
- `quality_score = NULL` — game-brief path runs cliché check only, not `runQualityChain`, so no numeric score

**Row shape**:
```
id              = 'game_recap_{sport}_{eventId}'
brief_type      = 'game_recap'
source          = 'cron'
ON CONFLICT(id) → update brief_text, word_count, source
```

Covers all sports enqueuing `type: 'game-brief'`: NBA, NHL, MLB, WNBA, WC26.

Wrapped in `try/catch` per CLAUDE.md Rule 5 — archive failure must not break the KV put or `msg.ack()`.

---

## Commit B — No direct relay path (no code change)

**Verdict**: No synchronous / direct relay path exists for Night Owl game-recap brief generation.

Game-brief generation is exclusively async via `JOURNALISM_QUEUE`. The enqueuers:
- WC26 results: `src/index.js` ~L1472 — enqueues on `state === 'final'` in `handleWCResults`
- NBA finals: ~L2210 — enqueues from `handleJournalismCycle` NBA final games block
- NHL finals: ~L2299 — enqueues from `handleJournalismCycle` NHL block
- MLB/WNBA: ~L4197 — enqueued per-game in `handleJournalismCycle` game-briefs block

The `/journalism/generate` endpoint (`src/index.js:5428`) is a sync quality-chain path for
general prompts sent from the browser — it does not generate game-brief type content and has
no `game_id` concept. No `source='live'` write is applicable.

**Action**: skipped. No Commit B.

---

## Commit C — POST /archive/brief brief_type whitelist (no code change)

**Verdict**: No `brief_type` whitelist exists in the handler.

The handler at `src/index.js:5125` validates only that `brief_type` is present (truthy) as part
of the required-field check:
```javascript
if (!id || !brief_type || !date || !brief_text) { ... 400 ... }
```

The value is not validated against an allowed set. Any non-empty string is accepted.

**Types currently written to D1 by relay-side code**:
| brief_type    | Source                                              |
|---------------|-----------------------------------------------------|
| `'slate'`     | `handleJournalismCycle` cron D1 write               |
| `'game_recap'`| Queue consumer game-brief path (this commit)        |
| `'backfill'`  | `executeBackfill` in `/archive/backfill` route      |

**Types the browser client (jubilant-bassoon) may POST**:
`game_recap`, `series_preview`, `game_brief`, `stakes_brief` — per spec.

Since there is no whitelist to modify, Commit C is skipped. If a whitelist is added in the
future, include: `'slate'`, `'game_recap'`, `'backfill'`, `'series_preview'`, `'game_brief'`,
`'stakes_brief'`.

---

## ARCHIVE_DB binding confirmation

Per `wrangler.toml`:
```toml
binding       = "ARCHIVE_DB"
database_name = "field-archive"
database_id   = "cc49101c-0569-4d41-8e7a-be139cde4f26"
```

Confirmed: binding is `ARCHIVE_DB`, not `FIELD_ARCHIVE`. Used correctly in Commit A.
