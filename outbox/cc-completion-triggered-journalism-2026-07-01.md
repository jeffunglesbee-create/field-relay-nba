# Outbox — Completion-Triggered Journalism

**Date:** 2026-07-02
**Relay HEAD:** a89e71e
**CC-CMD:** docs/CC-CMD-2026-07-01-completion-triggered-journalism.md
**Status:** SHIPPED

---

## Access Pattern: Indirect HTTP Relay

**Chosen pattern: indirect HTTP relay** — not direct `JOURNALISM_QUEUE.send()` from inside GameDO.

The direct binding approach was ruled out after probing the queue consumer at `src/index.js:12291`. Every `type: 'game-brief'` branch requires a `prompt` field — a pre-built journalism prompt string. GameDO has bare game facts (`homeName`, `awayName`, `homeScore`, `awayScore`) but cannot build a journalism prompt without:

1. Knowing `FIELD_VOICE_REGISTER`, `JQ_STYLE`, and sport-specific voice rules (all defined in `index.js`/`journalism-quality.js`, not accessible from the DO module)
2. Violating RELAY-IS-DUMB (Rule 47/ADR-002) — building prompt text in the DO would make it editorial, not a fact relay

The CC-CMD's suggested `type: 'game-recap'` was also confirmed non-existent in the consumer — it would fall through to the jobId path and be ack'd silently with no journalism generated.

The indirect pattern (fire-and-forget POST to a relay endpoint) is architecturally identical to the existing archive write and carries the same failure isolation guarantees.

---

## Pre-Build Probe Results

| Probe | Finding |
|-------|---------|
| `this.env` in GameDO constructor | `this.env = env` — full Worker env including all bindings |
| `JOURNALISM_QUEUE.send()` call sites | `src/index.js:1902`, `3321`, `3439`, `5893`, `6325` — all send `type:'game-brief'` |
| Consumer at L12291 | Routes on `job.type === 'game-brief'` (requires `prompt`); else falls through to `jobId` path |
| `type: 'game-recap'` | Does NOT exist in consumer — would be silently ack'd without generating any journalism |
| Final-state transition | `src/game-do.js:383` — `if (facts.state === 'final' && prevState !== 'final')` |
| `archived` dedup flag | `this.ctx.storage.get('archived')` gates both archive write and (now) journalism dispatch |
| POST allow-list | `src/index.js:8461` — explicit list of allowed POST routes; new endpoint required addition here |
| `FIELD_VOICE_REGISTER` | Imported at L51 from `journalism-quality.js`; available in relay Worker scope |
| `JQ_STYLE` | Aliased from `FIELD_PROSE_STYLE` at L50; used in journalism prompt construction |

---

## What Was Built

### `src/index.js` — POST allow-list entry

Added `/journalism/game-complete` to the method gate at L8464:

```js
&& !(pathname === '/journalism/game-complete' && request.method === 'POST')
```

### `src/index.js` — New endpoint `POST /journalism/game-complete`

Inserted before `/journalism/result/:jobId` (after the `/journalism/enqueue` block):

- Accepts `{ sport, gameId, home, away, homeScore, awayScore }` from GameDO
- Checks `brief:game:{gameId}` in FIELD_JOURNALISM — skips if brief already exists (covers the case where a cron tick generated the brief before the completion trigger fired)
- Builds a `game-brief`-shaped prompt using `FIELD_VOICE_REGISTER` + `JQ_STYLE` matching the pattern used by NHL (L3304) and NBA CDN (L3422) brief pipelines
- Sends `{ type: 'game-brief', prompt, eventId: gameId, max_tokens: 300, sport, home, away, homeScore, awayScore, enqueuedAt }` — exact shape the consumer already handles
- Always returns 202; full try/catch swallows all errors (DO fan-out cannot be affected)

### `src/game-do.js` — Fire-and-forget dispatch inside `if (!already)`

After the existing `/archive/game` fetch (L406-410), inside the same `if (!already)` block:

```js
fetch(relayBase + '/journalism/game-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        sport:     this.sport,
        gameId:    this.gameId,
        home:      facts.homeName,
        away:      facts.awayName,
        homeScore: facts.homeScore,
        awayScore: facts.awayScore,
        date,
    }),
}).catch(() => { /* journalism dispatch failure cannot affect DO */ });
```

**Dedup guarantee:** The `archived` DO storage flag gates entry into `if (!already)`. A duplicate poll after the game is final will find `archived` already set and skip the block entirely — neither the archive write nor the journalism dispatch can double-fire from a single DO instance.

---

## Dedup Analysis (Two-Layer)

| Layer | Mechanism | Scope |
|-------|-----------|-------|
| Primary | `this.ctx.storage.get('archived')` in GameDO | Per DO instance — prevents re-dispatch on every subsequent poll after `state:final` |
| Secondary | `FIELD_JOURNALISM.get('brief:game:{gameId}')` in relay endpoint | Cross-instance — skips enqueue if cron already generated the brief |

The secondary check also handles the race where a 15-min cron tick fires and generates the brief seconds before a completion-triggered dispatch arrives.

---

## Existing Archive Write — Provably Unchanged

The archive write (`fetch(relayBase + '/archive/game', ...)`) is untouched. The journalism dispatch is appended *after* it within the same `if (!already)` block, using the same fire-and-forget `.catch(() => {})` pattern. Neither can affect the other. The outer `try/catch` wrapping the entire `if (!already)` block remains — any failure in either dispatch is swallowed before it can reach the DO's primary fan-out loop.

---

## Verification

```
node --check src/game-do.js   → OK
node --check src/index.js     → OK
```

CI run `28561544952` — all 32 steps passed:
- Deploy to Cloudflare Workers: ✓
- Deploy gate (relay live): ✓
- STRUCTURAL 1-6 (health, whitelist, CORS, journalism e2e): ✓
- PROBE A-F (NBA, NHL, FPL, FD, BSD): ✓
- COURIER health/auth: ✓
- BOOTSTRAP sync: ✓

---

## Deploy

- **Commit:** `a89e71e`
- **Files changed:** `src/game-do.js` (+15 lines), `src/index.js` (+46 lines)
- **Workflow run:** `28561544952`
- **CI conclusion:** `success`

---

## Chat-Side Follow-Up (NOT part of CC-CMD done condition)

CC cannot observe a real game reaching `state:final` from the sandbox. Live verification requires watching the next real game completion across any covered sport (MLB, WC26, WNBA, NBA, NHL, etc.) and confirming:

1. A `brief:game:{eventId}` key appears in FIELD_JOURNALISM within seconds of game end (not minutes)
2. The brief appears without waiting for the next 15-min cron tick
3. The `/journalism/game-complete` endpoint returns 202 (visible in Worker logs)

The `source` field is NOT included in the enqueued job (consumer doesn't read it), but the brief's D1 archive row will have `source: 'cron'` (consumer hardcodes this — a minor cosmetic gap, not functional).
