# Claude Code Command — Extend Debrief context to Night Owl's cron-based prompt path

**Date:** 2026-07-18
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly. No PRs.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git log --oneline -5.

---

## CONTEXT

Layer 5's own session doc explicitly named this as separate, outstanding scope: `buildGameCompletePrompt` (the completion-trigger path) now carries real Debrief context (`drama_peak`, odds, series — confirmed live, verified via real generated-prompt output). `handleJournalismCycle` (the cron-based Night Owl path) is a genuinely different code path and does not.

This CC-CMD closes that gap using the same real, confirmed pattern — not new design work, just extending what's already proven.

---

## PRE-BUILD PROBE BLOCK

```bash
git log --oneline -5
grep -n "function handleJournalismCycle" src/index.js
grep -n "function buildGameCompletePrompt" src/index.js
```

Confirm `handleJournalismCycle`'s real, current prompt-building logic before touching it — it may build prompts differently than `buildGameCompletePrompt` (e.g., batch-style rather than single-game), so the same `debriefCtx` parameter approach may need real adaptation, not a direct copy-paste.

---

## TASK 1 — Real confirmation of handleJournalismCycle's structure

Determine whether it builds one prompt per game (in which case the same per-game `debriefCtx` fetch pattern from `buildGameCompletePrompt` applies directly) or a batch/slate-style prompt covering multiple games (in which case the real design needs adapting — report this honestly rather than forcing a per-game pattern onto a batch structure).

## TASK 2 — Wire in the real Debrief context, adapted to the confirmed structure

Reuse the real `findGame`/`findBriefs`/`findSeries` calls and the same optional-field-safe context-block format already proven in `buildGameCompletePrompt` — do not redesign the block format, reuse it. Adapt only the wiring point to match TASK 1's real finding.

## TASK 3 — Real verification

Same standard as Layer 5's own verification: generate a real prompt (or the closest real equivalent for a batch structure) using real, confirmed data from an actual recently-final game, and confirm the Debrief context block appears correctly with no `undefined`/`null` leaks. Confirm the debug/test route (if `handleJournalismCycle` has an equivalent) is unaffected, matching Layer 5's own no-regression check.

---

## DONE CONDITION

Night Owl's cron-based prompt path carries the same real Debrief context as the completion-trigger path, verified via a real generated-prompt check against real data — not assumed correct because the completion-trigger path already works.

**Confidence scoring:**
- TASK 1 (25 pts): real structural confirmation, honest if batch vs. per-game requires real adaptation
- TASK 2 (40 pts): real wiring, reusing the proven context-block format
- TASK 3 (35 pts): real verification against real data, no regression to any debug/test route

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
