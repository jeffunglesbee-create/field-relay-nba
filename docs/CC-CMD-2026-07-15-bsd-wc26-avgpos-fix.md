# Claude Code Command — Fix WC26 endgame capture's dead average-positions URL

**Date:** 2026-07-15
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }; git pull.

Write findings to outbox/bsd-wc26-avgpos-fix-2026-07-15.md. Commit the outbox manifest with `[skip ci]` in the message.

## CONTEXT

Discovered during CC-CMD-2026-07-14-bsd-endgame-capture-generalize, then **corrected** the same day after a sharper read of the evidence: BSD's `/api/v2/events/{id}/average-positions/` URL 404'd when tested against a real event ID (8345, Paraguay vs Australia, June 26 2026 WC group match) — but that event had finished weeks before the test, so the 404 does NOT distinguish "the route doesn't exist" from "the route is a live-only real-time feed that stops serving once the match ends." Two independent, real, historical codex entries (`bsd-endgame-cron-validation-june26`, `cf/2026-07-02/soccer-crosscheck-first-run-bugs`) both document the identical 404 against non-live events — and the first explicitly labels its own confirmation that `/stats/`'s embedded `average_positions` field is populated as **"post-final"** specifically, with no evidence it's populated during live play. `momentum/` and `incidents/` ARE confirmed real, dedicated, working endpoints even on a stale event (200 with real data), which is a different situation — nothing suggests those are live-gated.

**The original version of this CC-CMD (now superseded) recommended a straight swap** — always source `average-positions.json` from `/stats/`'s embedded field instead of the dedicated URL. That was wrong: it would silently return nothing during the actual 80-120 min live capture window (the same failure mode, just relocated), since the embedded field's *only* confirmed-populated state on record is post-final, not live. The corrected design (already shipped for the sibling club-league function, `_bsdCaptureStatsWithAvgPositions` in `src/index.js`, added/fixed by CC-CMD-2026-07-14-bsd-endgame-capture-generalize) is a **2-level fallback** (Rule 76): try the dedicated live endpoint first (plausibly the real live-data source, untested live since no club match was live during either investigation), fall back to the `/stats/`-embedded field only if that fails. This CC-CMD applies the same corrected fallback pattern to the WC26 path — NOT the straight swap.

`runBSDEndgameCapture` (`src/index.js` ~L1742, WC26-specific, untouched by the prior dispatch on purpose — its scope explicitly preserved WC26's capture mechanics unchanged) still calls only the dedicated `/average-positions/` URL via `captureWithRetry`, with no fallback. Because `captureWithRetry` fails silently (catches the error, returns `false`, no exception, `Promise.allSettled` isolates it), if the dedicated endpoint genuinely doesn't serve data right at/after final, this has likely written incomplete `average-positions.json` coverage for some WC26 games without ever surfacing as an error.

## TASK 0 — Probe (confirm the finding still holds, don't just trust either prior version of this doc — Rule 72/CHALLENGE-A)

```bash
# Re-verify against a real WC26 event ID before touching code:
# 1. GET /bsd/events/{id}/average-positions -- expect 404 for a finished/old event
# 2. GET /bsd/events/{id}/shotmap (proxies /api/v2/events/{id}/stats/) -- expect 200 with a populated average_positions field
# 3. If ANY club or WC league has a genuinely live game (check /bsd/events/live)
#    at execution time, test /average-positions against that live event ID --
#    this is the one test neither prior investigation could run (nothing was
#    live either time) and would be decisive evidence either way.
# Use probe_relay_route (or curl with BSD_API_TOKEN if running where the token is available).
```
Confirm current, not stale — re-confirm before shipping a fix against a claim that's now more than a day old. If a live game IS available this time, prioritize that test over repeating the stale-event probe — it's the evidence this doc has been missing twice.

## TASK 1 — Fix

In `runBSDEndgameCapture`, replace the plain `captureWithRetry` call for the `average-positions` entry in the 4-type capture loop (`['momentum', 'stats', 'incidents', 'average-positions']`) with the same 2-level-fallback pattern as `_bsdCaptureStatsWithAvgPositions` (`src/index.js`, read its real current body first — don't reimplement from this description): try the dedicated URL first, and only if that fails, extract `average_positions` from the already-fetched `/stats/` response and write it as the fallback. Consider factoring this into one shared helper both `runBSDEndgameCapture` and `runBSDClubLeagueEndgameCapture` call, rather than duplicating the logic a second time — check whether that's a clean, low-risk refactor or whether it's simpler to keep them independent (WC26's function has its own retry/meta shape; don't force a shared abstraction if it adds risk for no real benefit).

Preserve everything else about `runBSDEndgameCapture` unchanged — this is scoped to exactly the one capture type's fallback behavior, not a broader rewrite.

## TASK 2 — Verify

- `node --check src/index.js`: clean.
- Real evidence the fallback logic works correctly for both branches (dedicated endpoint succeeds → used; dedicated endpoint fails → stats-embedded fallback used) — live evidence if TASK 0 found a genuinely live game, otherwise a forced-condition test using the real, live-probed `/stats/` response shape, honestly labeled as such either way.
- Confirm the other 3 capture types (`momentum`, `stats`, `incidents`) and the WC26 R2 key format (`bsd/wc26/...`) are unaffected — diff review.

## DONE CONDITION

WC26's endgame capture has the same 2-level average-positions fallback as the club-league function — no longer betting entirely on one untested-live theory — verified via real probing (prioritizing a live-game test if one is available this time) and a forced-condition test covering both fallback branches.

**Confidence scoring:**
- TASK 0 (30 pts): re-confirms the finding live, actively attempts the live-game test neither prior investigation could run, doesn't just cite either prior version of this doc
- TASK 1 (40 pts): fallback applied correctly (dedicated-first, stats-embedded-fallback), scoped only to the one capture type, doesn't touch anything else about WC26 capture
- TASK 2 (30 pts): real or forced-condition evidence covering both fallback branches, non-regression of the other 3 capture types confirmed

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop. Automate follow-ups. No fallbacks, only fixes.
