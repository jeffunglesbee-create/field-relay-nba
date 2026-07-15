# Claude Code Command — brief:game:{id} follow-up: live verification + golf + game-complete

**Date:** 2026-07-15
**Repo:** field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }; git pull; git log --oneline -5.

Write findings to outbox/brief-game-kv-followup-2026-07-15.md.

## CONTEXT

`CC-CMD-2026-07-15-brief-game-kv-id-convention` shipped `stripKVIdPrefix()` for WC26/NHL/NBA (commit `b2bcb84`, deployed) based on strong indirect evidence — real client source code confirming bare-id requests, 9/9 forced tests, confirmed deploy — but scored only 63/100 (`outbox/brief-game-kv-id-convention-2026-07-15.md`) because:
1. A live trigger-and-observe round trip (re-request `/v2/games?sport=wc26&date=X`, confirm `/journalism/game/{bareId}` returns the real brief) was attempted and came back inconclusive — the one real test game available (England vs Argentina, `espn_event_id=760515`) had unchanged content since its pre-fix generation, so the dedup check's skip-vs-regenerate outcome couldn't be cleanly observed within that session's remaining time.
2. Golf's composite KV key (`golf_{id}_R{round}`) and `/journalism/game-complete`'s GameDO-sourced `gameId` format were left unaddressed — the round suffix is functionally load-bearing for golf, and GameDO's real id format wasn't confirmed against client code.

## TASK 1 — Complete the live verification

Find a WC26 (or NHL/NBA) game that has gone final SINCE `b2bcb84` deployed (`2026-07-15T23:51Z` — check for anything finalized after that timestamp) so its content hash is guaranteed fresh and the dedup check cannot skip it. If none exists yet, wait for one or trigger against the next one that finalizes. Confirm live: `GET /journalism/game/{bareEspnId}` returns a real, non-null brief for that game. This closes the one real gap in the prior dispatch's evidence.

## TASK 2 — Golf

Confirm, live against jubilant-bassoon (`mcp__FIELD_Handoff__read_source`/`read_file`), whether the golf card renderer ever requests a specific round via `/journalism/game/{id}` or always just wants "the latest" brief for an event. If it's round-agnostic (matching the pattern already confirmed for WC26/NHL/NBA), collapsing the KV key to the bare event id (dropping the `_R{round}` suffix) is a strict improvement — currently the client's bare-id request never matches golf's composite key at all (confirmed 100% miss). If it needs round-awareness, document why and leave it as a known, permanent exception rather than forcing a fix.

## TASK 3 — game-complete's GameDO gameId

Search jubilant-bassoon directly for where it opens the GameDO WebSocket connection (look for `GAME_DO`, `wss://`, or the DO's route path rather than the literal string `gameId=`, which didn't surface a src/ hit last time) to confirm what format it passes as the `gameId` query param. If bare ESPN id, no code change needed (already correct). If prefixed, apply `stripKVIdPrefix()` at the `/journalism/game-complete` route's KV interaction the same way the prior dispatch did for the other 3 sites.

## DONE CONDITION

Live proof (not inferred) that the KV id-prefix fix works end-to-end for at least one genuinely fresh WC26/NHL/NBA game. Golf and game-complete either fixed with the same real-evidence discipline as the prior dispatch, or explicitly, permanently exempted with a stated reason — not left as a silent unknown a third time.

**Confidence scoring:**
- TASK 1 (40 pts): real live confirmation using a genuinely fresh game, not a re-assertion of the prior dispatch's inconclusive attempt
- TASK 2 (30 pts): real client-behavior check for golf, decision made and justified either way
- TASK 3 (30 pts): real client-behavior check for GameDO's gameId format, fixed or exempted with justification

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
