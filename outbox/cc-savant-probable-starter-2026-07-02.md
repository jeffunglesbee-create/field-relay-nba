# Outbox — Wire Probable Starter into Savant Context

**Date:** 2026-07-02
**CC-CMD:** docs/CC-CMD-2026-07-02-savant-probable-starter.md
**Status:** SHIPPED

---

## Pre-Build Probe Results

| Probe | Finding |
|-------|---------|
| Probables computation | `buildGameLine(ev, league)` at line 4065 — accesses `team.probables?.[0]?.athlete?.displayName` from ESPN event competitors |
| assembleContext at ~8804 | Inside `handleJournalismCycle`, iterates `allMissing` game records — backfill/completion-trigger path, NOT live journalism |
| assembleContext at ~6138 | Inside `handleJournalismCycle`, slate brief build path — iterates `gameMeta` built from live ESPN scoreboard; **this is the correct target** |
| assembleContext at ~4927 | `executeGameBriefBackfill(env, date)` — D1-sourced game records, no ESPN event object, probables not available |
| assembleContext at ~9967 | Debug/probe route in fetch handler — not the live journalism path |
| `resolveEntity` export | `export { resolveTeamKey, resolveEntity }` confirmed in `src/identity-resolver.js` line 493 |
| Existing import in context-assembler.js | `import { resolveTeamKey } from './identity-resolver.js'` — `resolveEntity` not yet imported |

---

## Task 1 — Call Site Confirmation

**Wired call site: `assembleContext` at line 6138 inside `handleJournalismCycle`.**

This is the correct target. The `gameMeta` array is built from the live ESPN scoreboard loop at lines 5638–5666. The same `home`/`away` competitor objects from `ev.competitions[0].competitors` that `buildGameLine` uses to read `team.probables?.[0]?.athlete` are also available at the `gameMeta.push()` site.

No additional ESPN fetch was required — the probables data is already present in the same event objects already fetched for the `gameLines`/`gameMeta` build loop. Task 1 required zero new fetches.

The other 3 call sites were not wired:
- Line 4927 (`executeGameBriefBackfill`): game data comes from D1, not from ESPN event objects. Probables not available and semantically inappropriate (backfill = past games).
- Line 8804 (`handleJournalismCycle` completion-trigger): same reason — processes `allMissing` D1 records.
- Line 9967 (debug probe route): not a journalism-output path.

---

## Task 2 — Changes Made

### `src/index.js` — gameMeta capture (line ~5659)

Added two fields to `gameMeta.push()`:
```js
probableHome: home?.probables?.[0]?.athlete?.displayName || null,
probableAway: away?.probables?.[0]?.athlete?.displayName || null,
```

### `src/index.js` — assembleContext thread-through (line ~6145)

Added to the `assembleContext(env, {...}, 600)` call:
```js
probableHome: m.probableHome || null,
probableAway: m.probableAway || null,
```

### `src/context-assembler.js` — import

```js
import { resolveTeamKey, resolveEntity } from './identity-resolver.js';
```

### `src/context-assembler.js` — `buildSavantContext` pitcher arsenal

Replaced the flat `for (const abbr of [ha, aa])` loop with a two-branch structure:

1. **Probable starter path**: if `game.probableHome`/`game.probableAway` is present, call `resolveEntity('player', probableName)` → find matching `arsenals.data` entry with same canonical key AND same team abbreviation → render as `${abbr} starter ${name}: best pitch ${desc}.` (singular — the confirmed starter).
2. **Fallback path**: if no probable name, or the name doesn't resolve to a Savant entry, use the existing top-2-by-whiff-rate team-wide logic unchanged.

The `_abbr(v.team) === abbr` guard on the entry lookup prevents false cross-team matches when two pitchers share a canonical name — same discipline as the existing team-filter in the fallback.

---

## Task 3 — Verification

```
node -c src/context-assembler.js  → OK
node -c src/index.js              → OK
```

Lookup mechanism dry-run (inline test):
```
PASS: resolveEntity('player', 'Kevin Gausman') → 'gausman'
PASS: found Savant entry 'Kevin Gausman' with 1 pitch(es)
Lookup mechanism verified.
```

`arsenals.data` keys are ESPN-style full names (e.g., `"Kevin Gausman"`). ESPN `displayName` is the same format. `resolveEntity('player', name)` on both sides produces identical canonical keys, so the `find()` correctly matches them.

---

## Task 4 — Data Availability Confirmation

Probables data is available at the `gameMeta.push()` call site without any additional fetch. The ESPN scoreboard response (`/api/v2/sports/{sport}/{league}/scoreboard?dates=YYYYMMDD`) includes `probables` in competitor objects for MLB games when ESPN has populated the field. The CC-CMD's note that ESPN "populated inconsistently" is handled by the fallback — when `probableHome`/`probableAway` is `null` (or the name doesn't resolve to a Savant entry), the existing top-2-by-whiff-rate logic runs as before.

---

## Chat-Side Follow-Up

Confirm against a real live/recent MLB game journalism output that the Savant context block now shows `${abbr} starter ${name}:` (confirmed starter's specific pitch) rather than `${abbr} pitcher ${name}:` (team-wide approximation). The label change from "pitcher" to "starter" in the output is the observable signal that the probable-starter path ran.
