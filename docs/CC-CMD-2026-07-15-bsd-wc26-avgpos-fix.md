# Claude Code Command — Fix WC26 endgame capture's dead average-positions URL

**Date:** 2026-07-15
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/bsd-wc26-avgpos-fix-2026-07-15.md. Commit the outbox manifest with `[skip ci]` in the message.

## CONTEXT

Discovered during CC-CMD-2026-07-14-bsd-endgame-capture-generalize (real, live probing, not assumed): BSD's `/api/v2/events/{id}/average-positions/` URL does **not exist** as its own endpoint — confirmed 404 against a real, known event ID (8345, Paraguay vs Australia, June 26 2026 WC group match). `momentum/` and `incidents/` ARE real, dedicated, working endpoints (confirmed 200 with real data on the same event ID). `average_positions` data instead lives embedded as a sub-field inside the `/api/v2/events/{id}/stats/` response — confirmed directly by fetching that endpoint and finding a populated `average_positions: {home: [...], away: [...]}` object.

`runBSDEndgameCapture` (`src/index.js` ~L1742, WC26-specific, untouched by the above dispatch on purpose — that dispatch's own scope explicitly preserved WC26's capture mechanics unchanged) still calls the dead `/average-positions/` URL directly via `captureWithRetry`. Because `captureWithRetry` fails silently (catches the error, retries per its `maxAttempts`, returns `false`, no exception propagates, `Promise.allSettled` isolates it from the other 3 capture types), this has likely **never written a real `average-positions.json` for any WC26 game**, for the entire lifetime of this function, without ever surfacing as an error anywhere.

The sibling club-league function (`runBSDClubLeagueEndgameCapture`, added by the above dispatch) already avoids this bug — it derives `average-positions.json` from the real `/stats/` response's embedded field via `_bsdCaptureStatsWithAvgPositions` instead of calling the dead URL. This CC-CMD applies the equivalent fix to the WC26 path.

## TASK 0 — Probe (confirm the finding still holds, don't just trust the prior dispatch's claim — Rule 72/CHALLENGE-A)

```bash
# Re-verify against a real WC26 event ID before touching code:
# 1. GET /bsd/events/{id}/average-positions -- expect 404
# 2. GET /bsd/events/{id}/shotmap (proxies /api/v2/events/{id}/stats/) -- expect 200 with a populated average_positions field
# Use probe_relay_route (or curl with BSD_API_TOKEN if running where the token is available).
```
Confirm current, not stale — this dispatch found it true on 2026-07-15; re-confirm before shipping a fix against a claim that's now up to a day old.

## TASK 1 — Fix

In `runBSDEndgameCapture`, replace the `average-positions` entry in the 4-type capture loop (`['momentum', 'stats', 'incidents', 'average-positions']`) with logic equivalent to the club-league function's `_bsdCaptureStatsWithAvgPositions` (`src/index.js`, added by CC-CMD-2026-07-14-bsd-endgame-capture-generalize, read its real current body first — don't reimplement from this description) — fetch `/stats/` once, write it to `stats.json` as before, and additionally extract and write the embedded `average_positions` field to `average-positions.json`. Consider factoring this into one shared helper both `runBSDEndgameCapture` and `runBSDClubLeagueEndgameCapture` call, rather than duplicating the logic a second time — check whether that's a clean, low-risk refactor or whether it's simpler to keep them independent (WC26's function has its own retry/meta shape; don't force a shared abstraction if it adds risk for no real benefit).

Preserve everything else about `runBSDEndgameCapture` unchanged — this is scoped to exactly the one dead capture type, not a broader rewrite.

## TASK 2 — Verify

- `node --check src/index.js`: clean.
- Real evidence the fix produces a non-empty `average-positions.json` for a real or forced-condition WC26-shaped game (no WC games are live post-tournament — 2026-07-15 is after the WC26 window closes per `_wcClose` — so this will very likely need a forced-condition test using the real, live-probed `/stats/` response shape, honestly labeled as such).
- Confirm the other 3 capture types (`momentum`, `stats`, `incidents`) and the WC26 R2 key format (`bsd/wc26/...`) are unaffected — diff review.

## DONE CONDITION

WC26's endgame capture writes real, non-empty `average-positions.json` files instead of silently failing against a dead URL, verified via real probing (not re-trusting the prior dispatch's finding without re-checking) and a forced-condition test.

**Confidence scoring:**
- TASK 0 (30 pts): re-confirms the dead-URL finding live, doesn't just cite the prior dispatch
- TASK 1 (40 pts): fix applied correctly, scoped only to the dead capture type, doesn't touch anything else about WC26 capture
- TASK 2 (30 pts): real or forced-condition evidence the fix works, non-regression of the other 3 capture types confirmed

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
