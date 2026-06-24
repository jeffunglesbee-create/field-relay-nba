# CC-CMD: JQ Game Context — Relay Side
**Date:** 2026-06-24  
**Repo:** field-relay-nba  
**Rule 87:** Self-completing. All probes, edits, verification, and outbox manifest run inside this session.

---

## CONTEXT

Two `runQualityChain` call sites in `src/index.js` omit `game:` context, causing
Dimensions 7 (Context Anchoring, 0→25) and 10 (Matchup Depth, 0→30) to always
score 0. Max achievable score is 245/300 instead of 300/300. These are the highest-
volume brief types: Night Owl (via `/journalism/generate`) and series previews.

---

## PROBE BLOCK — read before writing anything

### Probe 1 — `/journalism/generate` handler (~L9140)
Search `src/index.js` for `pathname === '/journalism/generate'` or
`/journalism/generate`. Read the body extraction block. Confirm:
- `const sport = body.sport || null` — present
- `const briefType = body.briefType || 'generic'` — present  
- `const game = body.game || null` — **NOT present** (this is the gap)
- `const matchupNote = body.matchupNote || null` — **NOT present**

Read the `runQualityChain` call (~9 lines later). Confirm it has:
```javascript
{ sport, scoreThreshold: scoreFloor, maxRetries: 6 }
```
No `game:` or `matchupNote:` — confirm this.

### Probe 2 — Series preview call site (~L4325)
Search for `'series_preview'` or `runQualityChain(seriesPrompt`. Read 10 lines
before and after. Confirm:
- Variables in scope: `higherSeed`, `lowerSeed`, `higherWins`, `lowerWins`, `sport`
- `series.narrative` is available (the series context string)
- `runQualityChain(seriesPrompt, initial, callProxy, { sport, scoreThreshold: 240, maxRetries: 3 })`
- No `game:` or `matchupNote:` — confirm this.

---

## TASK 1 — Wire `game` + `matchupNote` through `/journalism/generate`

### 1a. Extract from body

Find the body extraction block (lines with `const sport = body.sport` etc.).
Add two lines immediately after the existing extractions:

```javascript
const game        = body.game        || null;
const matchupNote = body.matchupNote || null;
```

### 1b. Pass to `runQualityChain`

Find:
```javascript
            const result = await runQualityChain(promptWithVoice, initial, callProxy, {
              sport,
              scoreThreshold: scoreFloor,
              maxRetries: 6,
            });
```

Replace with:
```javascript
            const result = await runQualityChain(promptWithVoice, initial, callProxy, {
              sport,
              scoreThreshold: scoreFloor,
              maxRetries: 6,
              game,
              matchupNote,
            });
```

**Verification:** grep `index.js` for `game,` inside the `/journalism/generate`
block — must appear. grep for `matchupNote,` — must appear.

---

## TASK 2 — Wire `game` + `matchupNote` into series preview

Find the `runQualityChain` call in the series preview path. It will look like:
```javascript
    const qResult = await runQualityChain(seriesPrompt, initial, callProxy, {
      sport, scoreThreshold: 240, maxRetries: 3,
    });
```

Replace with:
```javascript
    const qResult = await runQualityChain(seriesPrompt, initial, callProxy, {
      sport,
      scoreThreshold: 240,
      maxRetries: 3,
      game:        { home: higherSeed, away: lowerSeed },
      matchupNote: series.narrative || null,
    });
```

**Verification:** grep `index.js` for `higherSeed` near `runQualityChain` — must appear.

---

## TASK 3 — `node --check` + commit + deploy

```
node --check src/index.js
```

Commit:
```
fix: wire game context into runQualityChain — /journalism/generate + series preview

- /journalism/generate: extract game + matchupNote from request body, pass to
  runQualityChain. Client callers (Night Owl, MLB Brief, Stakes Brief, J2 Series)
  now unlock Dims 7+10 (Context Anchoring + Matchup Depth, 0→55pts combined).
- Series preview: game:{home,away} + series.narrative as matchupNote — same fix,
  relay-internal path.

Removes 245/300 ceiling on these brief types. Full 300/300 now achievable.
```

Push. Deploy must succeed.

---

## TASK 4 — Outbox manifest

Write `outbox/cc-jq-game-context-relay-2026-06-24.md` with:
- Both call sites patched (location + what changed)
- Which dimensions are now unlocked (7 + 10, 55 pts combined)
- Commit hash + deploy status
- Note: client-side CC-CMD (`CC-CMD-2026-06-24-jq-game-context-client.md` in
  jubilant-bassoon) must also ship for Night Owl callers to actually send game data

Commit `[skip ci]` and push.

---

## DONE CONDITIONS

- [ ] `const game = body.game || null` in `/journalism/generate` body extraction
- [ ] `game, matchupNote,` in the `/journalism/generate` `runQualityChain` call
- [ ] `game: { home: higherSeed, away: lowerSeed }` in series preview `runQualityChain`
- [ ] `node --check src/index.js` passes
- [ ] Deploy green
- [ ] Outbox manifest committed [skip ci]
