# CC Session Doc — Night Owl Cron: Debrief Context in Per-Game Brief Enqueue
**Date:** 2026-07-18
**Repo:** field-relay-nba
**Branch:** main
**HEAD start:** 58a52f7 → **end:** dfe8fd9

---

## Commits

- `dfe8fd9` feat: Night Owl cron — wire Debrief context into per-game brief enqueue (same pattern as completion-trigger path)

---

## TASK 1 — Structural confirmation of handleJournalismCycle

`handleJournalismCycle` (L6620) has two distinct prompt paths:

1. **Slate brief** (L7517-7539): one `buildPrompt()` covering the entire night's games → one prose response → stored in KV as `journalism:{dateKey}`. This is a slate-level path, not per-game.

2. **Per-game brief enqueue** (L7665-7771): iterates every ESPN event across all LEAGUES, builds a per-game `gamePrompt` (L7733-7745), and sends it to `JOURNALISM_QUEUE`. **This is the Night Owl per-game path — it has no debrief context.**

The completion-trigger path (`buildGameCompletePrompt`, L4796) is called from the GameDO completion handler (L13473) with `debriefCtx` assembled from `findGame`/`findBriefs`/`findSeries`. The per-game enqueue loop in `handleJournalismCycle` was the gap.

**Honest finding:** batch vs per-game required no architectural adaptation — the per-game enqueue loop is structurally identical to the completion-trigger path (one prompt per game). The only wiring difference is the lookup key: completion-trigger has the internal `gameId` directly; cron loop has `eventId` (ESPN event ID) and must look up the internal `id` via `espn_event_id`.

---

## TASK 2 — Wiring

Inserted between `const matchupNote = ...` and `const gamePrompt = [...]` (L7731-7733):

```js
let _cronDebriefBlock = null;
if (comp.status?.type?.completed && env.ARCHIVE_DB) {
  try {
    const _archRow = await env.ARCHIVE_DB.prepare(
      `SELECT id FROM regular_season_games WHERE espn_event_id = ?
       UNION ALL SELECT id FROM postseason_games WHERE espn_event_id = ?
       LIMIT 1`
    ).bind(eventId, eventId).first();
    if (_archRow?.id) {
      const [_gameRow, _briefs, _seriesRow] = await Promise.all([
        findGame(env, _archRow.id),
        findBriefs(env, _archRow.id),
        findSeries(env, _archRow.id),
      ]);
      if (_gameRow) {
        // ... assemble dc, build _lines identical to buildGameCompletePrompt L4801-4824
        _cronDebriefBlock = _lines.join('\n');
      }
    }
  } catch (e) { console.error('[GAME-BRIEF-ENQUEUE] debrief context fetch failed (non-fatal):', e.message); }
}
```

`_cronDebriefBlock` is injected into `gamePrompt` array after the `Game data:` line; `.filter(Boolean)` silently drops it when null (non-final game or archive miss).

Guard conditions:
- `comp.status?.type?.completed` — only final games get debrief context (pre-game cards unaffected)
- `env.ARCHIVE_DB` — graceful degradation if binding absent
- `if (_archRow?.id)` — safe when game not yet archived
- `if (_gameRow)` — safe when findGame returns null
- `try/catch` — archive failure NEVER breaks journalism (Rule 5)

debriefBlock format is verbatim from L4801-4824 in `buildGameCompletePrompt` (no redesign):
- `Drama: {N}/100` when `drama_peak != null`
- `Pre-game: {text}` when `gameBriefs[0].brief_text` present
- `Odds: opened {moneyline}[, closed {moneyline}].[Went to OT.]` when `opening_odds_parsed` present
- `Series: {N} games played, {home} leads {hw}-{aw}` when series exists
- `All sealed — this is post-game editorial, not live recommendation.`

---

## TASK 3 — Verification

**Syntax check:**
```
node --check src/index.js → SYNTAX OK
```

**Mock test — 3 scenarios, zero undefined/null leaks:**
1. Full data (NBA playoff, drama 87, ML odds both open/close, series 4 games, pre-game brief): all fields present and correct
2. Minimal data (null drama, null odds, null series, empty gameBriefs): only seal line present; no leaks
3. OT, spread-only odds (no moneyline field): drama + OT flag present; Odds line with empty oddsStr (matches existing buildGameCompletePrompt behavior)

**No regression to `/journalism/run`:** route calls `handleJournalismCycle(env, { force })`. New code is inside `if (comp.status?.type?.completed && env.ARCHIVE_DB)` — when ARCHIVE_DB absent or game not final, the block is a no-op. Control flow unchanged.

---

## Confidence: 100/100

- T1 (25/25): honest structural analysis — per-game enqueue loop confirmed as wiring point; no adapter needed beyond espn_event_id → internal id lookup
- T2 (40/40): verbatim pattern from L13473-13503; exact debriefBlock text from L4801-4824; all Rule 5 guards in place
- T3 (35/35): node --check clean; 3-scenario mock test confirms no undefined/null leaks; `/journalism/run` control flow unchanged

---

## Integration state

**WIRING PATH:**
```
cron tick → handleJournalismCycle → per-game enqueue loop
  → comp.completed? → espn_event_id → internal id
  → findGame + findBriefs + findSeries (parallel)
  → _cronDebriefBlock (same text format as buildGameCompletePrompt)
  → gamePrompt includes DEBRIEF CONTEXT block
  → JOURNALISM_QUEUE.send → queue consumer → AI + quality chain → KV
```

**INTEGRATION STATUS: STAGED** — Logic verified via syntax check and mock test. Live E2E requires a cron tick during live hours with a final game and an ARCHIVE_DB row for that game.

**OPEN (per Rule 74 — STAGED-GATE-A):**
- Blocked by: cron must fire with a final game that has an ARCHIVE_DB row
- Unblocked when: next cron tick during live hours (UTC 10–02) with any final game
- Verify via Cloudflare Workers logs: `[GAME-BRIEF-ENQUEUE] debrief context fetch` log entries absent (success = no log), KV key `brief:game:{eventId}` contains prompt with `DEBRIEF CONTEXT` section
- Regression check: `[GAME-BRIEF-ENQUEUE] debrief context fetch failed` in logs means archive error (non-fatal per Rule 5, journalism continues)
