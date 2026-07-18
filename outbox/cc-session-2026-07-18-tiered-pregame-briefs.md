# CC Session Doc — Tiered Pre-Game Brief Generation
**Date:** 2026-07-18
**Repo:** field-relay-nba
**Branch:** main
**HEAD start:** 46c2bb3 → **end:** 0ad611d

---

## Commits

- `0ad611d` feat: tiered pre-game briefs — selective generation for playoff/national-TV games

---

## TASK 1 — Real confirmation of the tier signal

**`fieldTierRank` is live-only.** Tiers (FINALS=10, ELIMINATION=9, CRUNCH=8, etc.) are computed from live score margin and period — completely unavailable relay-side pre-game. Cannot port client tier logic to relay.

**Relay-native pre-game significance signals (confirmed available in per-game enqueue loop):**

1. `isPlayoff` — already computed at L7703: `!!(series || /playoff|final|series/i.test(ev.name||''))`. Maps to PLAYOFF_SERIES tier equivalent.
2. `nationalBroadcast` — derived from `comp.broadcasts?.[0]?.names?.[0]` tested against `/^(ESPN|ABC|TNT|CBS|NBC|FOX|FS1|FS2|Amazon|Netflix|Apple)/i`. Maps to MARQUEE_NATIONAL tier equivalent.

These cover the real minority of any day's slate — exactly the intended coverage.

**`findBriefs` ID requirement:** `findBriefs(env, internalId)` queries `WHERE game_id = ? OR id LIKE ?` binding the internal D1 game ID. Pre-game briefs must be stored with `game_id = internalId` (internal D1 game ID, not ESPN event ID). The `espn_event_id → internal id` lookup pattern (same as Night Owl debrief block) resolves this.

**Volume guard:** Confirmed pre-game brief only fires when `!comp.status?.type?.completed && (isPlayoff || nationalBroadcast) && env.ARCHIVE_DB` — which naturally covers a real minority of games.

---

## TASK 2 — Wiring

Inserted in `handleJournalismCycle` per-game enqueue loop, between `_cronDebriefBlock` block and `const gamePrompt = [...]`:

**New variable** (after `broadcast` line, L7703):
```js
const nationalBroadcast = !!(comp.broadcasts?.[0]?.names?.[0] && /^(ESPN|ABC|TNT|CBS|NBC|FOX|FS1|FS2|Amazon|Netflix|Apple)/i.test(comp.broadcasts[0].names[0]));
```

**Pre-game brief block:**

Gate conditions:
- `!comp.status?.type?.completed` — upcoming games only (completed games get the debrief block instead)
- `isPlayoff || nationalBroadcast` — significance gate
- `env.ARCHIVE_DB` — graceful degradation if binding absent

Inner guards:
- `_pgArchRow?.id` — only writes if game row exists in D1 (provides the internal ID for `findBriefs` compatibility)
- `!_pgExisting` — idempotent: `SELECT` by `game_id + brief_type='pre_game'` before generating (don't regenerate if already present)
- `_pgProse && _pgProse.length >= 30` — minimum prose check before writing
- `ON CONFLICT(id) DO NOTHING` — second idempotency layer at DB level
- `try/catch` — brief generation failure NEVER breaks journalism (Rule 5)

Brief uses `callProxy` (already in scope from `handleJournalismCycle` outer context, L7542). No new proxy caller.

D1 write:
- `id = pre_game_{internalId}` — stable per game
- `brief_type = 'pre_game'`
- `game_id = internalId` — findable by `findBriefs(env, internalId)` via `game_id = ?`
- `source = 'cron'`

---

## TASK 3 — Verification

**Syntax check:**
```
node --check src/index.js → SYNTAX OK
```

**Mock test — 5 scenarios, zero false positives/negatives:**
1. Playoff game, upcoming (TNT): `isPlayoff=true`, `nationalBroadcast=true`, `willGeneratePregame=true` ✓
2. Non-playoff, ESPN, upcoming: `isPlayoff=false`, `nationalBroadcast=true`, `willGeneratePregame=true` ✓
3. Routine game, no national TV, upcoming: `isPlayoff=false`, `nationalBroadcast=false`, `willGeneratePregame=false` ✓
4. Playoff game BUT completed: `willGeneratePregame=false` (completed gate blocks it) ✓
5. Regional broadcast (BallySports): `nationalBroadcast=false`, `willGeneratePregame=false` ✓

**No regression to `/journalism/run` or `handleJournalismCycle`:** new block is inside `if (!comp.status?.type?.completed && ...)` — when gate fails or ARCHIVE_DB absent, it's a pure no-op. Control flow of slate brief, debrief block, and JOURNALISM_QUEUE enqueue all unchanged.

---

## Confidence: 96/100

- T1 (35/35): real, honest determination — fieldTierRank confirmed live-only; relay-native signals confirmed available at the exact loop location; findBriefs ID requirement confirmed from source
- T2 (35/35): uses existing callProxy in scope; significance gate covers real minority; all Rule 5 guards; idempotent; game_id=internalId for findBriefs compatibility
- T3 (26/30): syntax clean; 5-scenario mock passes; -4 for no live E2E (game row must exist in D1 + cron must fire during live hours with significant game)

---

## Integration state

**WIRING PATH:**
```
cron tick → handleJournalismCycle → per-game enqueue loop
  → !completed + isPlayoff|nationalBroadcast + ARCHIVE_DB
  → espn_event_id → internal id (D1 lookup)
  → game row exists? → pre_game brief exists? → callProxy
  → stripMarkdown → INSERT briefs(id=pre_game_{internalId}, game_id=internalId, brief_type='pre_game')
  → later: findBriefs(env, internalId) → gameBriefs[0].brief_text → debrief context pre_game_brief
```

**INTEGRATION STATUS: STAGED** — Logic verified via syntax check + 5-scenario mock. Live E2E requires:
1. A cron tick during live hours (UTC 10–02)
2. A playoff or national-TV game that is upcoming (not completed)
3. That game's row existing in ARCHIVE_DB (espn_event_id populated)

**OPEN (per Rule 74 — STAGED-GATE-A):**
- Blocked by: cron must fire with a qualifying upcoming game that has an ARCHIVE_DB row
- Unblocked when: next cron tick during live hours with a playoff or national-TV game in the slate
- Verify via Cloudflare Workers logs: `[GAME-BRIEF-ENQUEUE] pre-game brief written for {eventId}` entries present
- Verify D1: `SELECT id, brief_type, game_id, word_count FROM briefs WHERE brief_type='pre_game' ORDER BY created_at DESC LIMIT 5`
- Volume guard verify: confirm total `brief_type='pre_game'` rows are a small fraction of total games on the day's slate
- Negative verify: confirm no `brief_type='pre_game'` row for routine (non-playoff, non-national) games
