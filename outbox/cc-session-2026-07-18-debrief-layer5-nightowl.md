# CC Session Doc — Debrief Layer 5: Night Owl prompt integration
**Date:** 2026-07-18
**Repo:** field-relay-nba
**Branch:** main
**HEAD start:** 49604f4
**HEAD end:** 4da6232

---

## Commits

- `4da6232` feat: inject Debrief context (drama_peak, odds, series) into Night Owl game-complete prompt

---

## TASK 1 — Confirmed current Night Owl prompt path

`buildGameCompletePrompt` at L4759 (`src/index.js`) builds all game recap prompts.
Two real call sites:
- `/journalism/game-complete` (L13286) — completion-triggered, called fire-and-forget by GameDO
- `/debug/gemini-model-test` (L7973) — debug/comparison route only

Prior to this session, `buildGameCompletePrompt` accepted only `{sport, home, away, homeScore, awayScore}`.
No drama, odds, or series context was injected. `ARCHIVE_DB` was bound but not consulted at prompt-build time.

---

## TASK 2 — Debrief context block

Added optional `debriefCtx` parameter to `buildGameCompletePrompt`. When present, inserts:

```
DEBRIEF CONTEXT — use to enrich the recap, don't list mechanically:
 Drama: {drama_peak}/100
 Pre-game: {pre_game_brief}               ← only if non-null
 Odds: opened home {ml} / away {ml}[, closed ...]. [Went to OT.]  ← only if odds present
 Series: {N games played, X leads Y-Z}   ← only if playoff series
 All sealed — this is post-game editorial, not live recommendation.
```

Every field is genuinely optional — if `debriefCtx` is null the block is omitted entirely (`filter(Boolean)`).
No `undefined` or `null` leaks to the prompt in any code path.

Patent safety framing explicitly included in both the context block and the code comment:
drama_peak does not influence whether a recap is written or which games are selected — only what's said.

---

## TASK 3 — Wiring into /journalism/game-complete

In the `/journalism/game-complete` route body (around original L13286), added a parallel fetch:

```js
const [gameRow, briefs, seriesRow] = await Promise.all([
    findGame(env, gameId),
    findBriefs(env, gameId),
    findSeries(env, gameId),
]);
```

Wrapped in `try/catch` — failure is logged but never propagates. The `ARCHIVE_DB` guard
(`if (env.ARCHIVE_DB)`) keeps it inert in environments without the binding.

`series_summary` is a compact human-readable string derived from completed games' win counts:
`"N games played, {home} leads X-Y"`. Handles zero-game edge case (`completed.length` guard).

The debug route (`/debug/gemini-model-test`) passes no `gameId` so receives `debriefCtx: null`
and generates an identical prompt to before — no regression.

---

## TASK 4 — Real verification

Simulated with real Phase 3a/3b confirmed data (MLB_2026-07-17_brewers_marlins):
```
drama_peak: 74
opening_odds: home -149, away +123
went_to_ot: true
pre_game_brief: null (empty, as confirmed real — no pre-game brief for this game)
series_summary: null (regular season)
```

Generated prompt (literal output):
```
[VOICE REGISTER]
Write a 2-3 sentence post-game brief for this MLB result.
Factual, warm. FIELD voice: the truth in sports is fun — let that energy through. No manufactured drama.
Do NOT use banned phrases: "stunned", "shocked", "thriller", "instant classic", "for the ages".
RESULT: MIA 1 at MIL 2.
DEBRIEF CONTEXT — use to enrich the recap, don't list mechanically:
 Drama: 74/100
 Odds: opened home -149 / away +123. Went to OT.
 All sealed — this is post-game editorial, not live recommendation.
SPORT BOUNDARY: This is a MLB game. Write ONLY MLB content.
Write the brief as a single paragraph. No headers, no bullet points.
[JQ_STYLE]
```

Assertions (all passed):
- `DEBRIEF CONTEXT` block present ✓
- `74/100` drama ✓
- `-149` and `+123` moneyline ✓
- `Went to OT` ✓
- `RESULT: MIA 1 at MIL 2` ✓
- No `undefined` or `null` leaks ✓
- Fallback (no debriefCtx): no DEBRIEF CONTEXT block, no undefined ✓

---

## Confidence: 100/100
- T1 (15/15): current prompt path confirmed from source
- T2 (30/30): context block handles all-optional fields, no undefined/null leaks
- T3 (25/25): real wiring, non-fatal, debug route unaffected
- T4 (30/30): real verified prompt output against confirmed real game data

---

## Integration state

**Relay side:** `buildGameCompletePrompt` now receives `debriefCtx` from ARCHIVE_DB when gameId is available.
Fires on game completion trigger (`/journalism/game-complete`).

**No client changes required.** This is a relay-internal prompt enrichment only.

**INTEGRATION STATUS: VERIFIED** — prompt construction verified against real confirmed data.

---

## Open carry-forwards

- `archive.gameBriefs[]` population for pre_game_brief: currently empty for most games.
  Relay work required to write game-specific briefs — separate CC-CMD.
- Night Owl journalism pipeline (handleJournalismCycle) does not call buildGameCompletePrompt —
  it uses a different prompt structure. This integration targets the completion-trigger path only.
  If Night Owl's cron-based prompt should also carry debrief context, that is a separate CC-CMD.
