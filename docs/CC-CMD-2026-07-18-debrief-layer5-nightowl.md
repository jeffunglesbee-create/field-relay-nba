# Claude Code Command — The Debrief Layer 5: Night Owl / Context Graph prompt integration

**Date:** 2026-07-18
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5.

---

## CONTEXT

Source spec: Compound Architecture doc, Part 3, Layer 5. Phase 3a/3b (relay drama_peak write + client rendering, Layers 1-4) are confirmed live and verified. This closes the final layer — injecting the same real Debrief context into the Night Owl recap's journalism prompt, so the recap itself reads with full context rather than bare score data.

**Real, confirmed fields available now (Phase 3a verification):**
- `game.drama_peak` (number, 0-100)
- `game.drama_arc_parsed` (array)
- `game.opening_odds_parsed` / `closing_odds_parsed` (`{moneyline, spread, total}`)
- `game.went_to_ot`
- `archive.gameBriefs[]` (often empty — see note below)
- `series` (null for regular season; real shape confirmed: `{series, games[], margins[]}`)

**Real, honest note on `gameBriefs[]`:** it's frequently empty not because of a bug (the query itself is correct — `WHERE game_id = ? OR id LIKE ?`), but because most games genuinely don't have a game-specific pre-game brief written. This CC-CMD should treat pre-game brief context as optional/best-effort in the prompt injection, the same way the spec's own example does (falls back gracefully), not as something to force-populate as part of this task — expanding brief coverage is a separate, larger journalism-pipeline scope, not this CC-CMD's job.

**Same patent-safety framing as Phase 3a/Gap 6 — restated because it applies here too:** this is retrospective content assembled for a recap written *after* the game ended. It is not a real-time recommendation or a live interest computation. No part of this integration should make drama_score influence *whether* a recap gets written or *which* games get selected for Night Owl — only what's said once a recap is already being written for a given (already-final) game.

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline -5
grep -n "function handleJournalismCycle" src/index.js
# Confirm the real, current Night Owl prompt-building code path
grep -n "Night Owl\|nightOwl\|night_owl" src/index.js | head -15
```

Confirm the real, current prompt construction site before writing anything — the spec's own reference is a month old.

---

## TASK 1 — Real confirmation of the current Night Owl prompt path

Find the real, current function/code path that builds the Night Owl recap prompt. Confirm whether it already calls the Context Graph (`/context/game/{id}` internally, or an equivalent direct DB read) for anything, or builds purely from raw game data today.

## TASK 2 — Build the Debrief context block for prompt injection

Per spec's own example structure, adapted to real confirmed field names:
```
DEBRIEF CONTEXT — use to enrich the recap, don't list mechanically:
 Drama: {drama_peak}/100
 Pre-game: {gameBriefs[0]?.brief_text or omitted if none exists}
 Odds: opened {opening_odds_parsed...}, closed {closing_odds_parsed...}. {went_to_ot ? 'Went to OT.' : ''}
 Series: {only if series is non-null — margins/games summary}
 All sealed — this is post-game editorial, not live recommendation.
```

Handle every field as genuinely optional — a regular-season game with no pre-game brief and no series should still produce a clean, valid context block using just drama + odds, not an error or a block full of "undefined."

## TASK 3 — Wire into the real prompt-building path

Inject the context block into the real, confirmed Night Owl prompt construction from TASK 1 — positioned per spec, before the voice/style rules, after the raw game data.

## TASK 4 — Real verification

Real probe: trigger or inspect a real Night Owl generation for a real, recently-final game (the same Brewers/Marlins game used in Phase 3a/3b's own verification is a good candidate, given its real data is already confirmed) and confirm the actual generated prompt (or, if the prompt itself isn't directly inspectable, the actual generated recap text) genuinely reflects the injected context — not just that the code path executed without error.

---

## DONE CONDITION

The real, current Night Owl prompt construction includes the Debrief context block, built from the same real, confirmed fields Phases 3a/3b already use, handling missing optional fields (brief, series) gracefully — verified via a real probe against a real, recently-final game, not assumed from code inspection alone. No part of the send/selection decision for which games get a Night Owl recap is altered.

**Confidence scoring:**
- TASK 1 (15 pts): real current prompt path confirmed
- TASK 2 (30 pts): context block correctly handles all-optional fields, matches spec's intent
- TASK 3 (25 pts): real wiring into the confirmed prompt path
- TASK 4 (30 pts): real verification against a real, recently-final game's actual output

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
