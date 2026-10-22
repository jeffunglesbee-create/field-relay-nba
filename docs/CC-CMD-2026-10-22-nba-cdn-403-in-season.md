# Claude Code Command — the relay's NBA board is empty in-season: cdn.nba.com answers 403

**Date:** 2026-10-22
**Repo:** field-relay-nba (consumers in jubilant-bassoon)
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (a data path that is silently empty)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched
**Filed by:** TASK 0 of `docs/CC-CMD-2026-10-22-ambient-capture-coverage-gaps.md`,
Rule 87.4.

---

## What was measured

Read through the relay self-probe on 2026-10-22, about 03:45Z, the night after
NBA games at 02:00Z and 02:30Z:

| route | answer |
|---|---|
| `/nba/liveData/scoreboard/todaysScoreboard_00.json` | `403`, body `nba returned 403` |
| `/v2/games?sport=nba&date=2026-10-20`, `…10-21`, `…10-22` | `200`, `count 0`, `source nba-cdn-empty` |

- `outbox/scoreboard-probe-20260919T161751Z.body` holds the same 403 from
  2026-09-19.
- `docs/CC-CMD-2026-06-26-nba-cdn.md` says "Off-season 403 from /nba/* is
  expected — CDN has no scoreboard when no games", and `handleV2Games` maps
  any non-OK CDN answer to an empty board with `nba-cdn-empty`. The
  archive's NBA rows place games on 10-20, 10-21 and 10-22, so it is
  in-season, and the 403 persists.
- `deploy.yml`'s "PROBE A — NBA CDN scoreboard" is `continue-on-error`. It
  prints the status and does not fail.

## Who reads it

- **AmbientDO** (`/v2/games?sport=nba`). It captures no NBA closing lines,
  even with SPORT_ACTIVE_MONTHS fixed.
- **jubilant-bassoon `src/legacy/field.js`:**
  - `fetchNBAScoreboard()` (about line 36437) builds `_nbaGameIdMap` for the
    live box scores. It returns silently on a non-OK answer.
  - `fetchNBAScoreboardViaRelay()` (about line 17375).
- Any other `/nba/*` reader should be found by grep before the fix.

## TASK 0 — premises, one command each

1. **The 403 holds during live play.** Read the route while an NBA game is
   live (archive `start_time` plus 30 minutes). A 200 refutes "in-season
   403".
2. **It is the relay's egress, not the URL.**
   - From a GitHub Actions runner, fetch
     `https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json`
     directly, with and without the headers the relay sends.
   - If the runner gets 200 and the relay gets 403, the CDN refuses the
     Worker. If both get 403, the URL or the required headers changed.
3. **Every consumer.** Grep both repos for `/nba/` and `nbaSource`, and list
   each reader and what it does on an empty or failed answer.

## TASK 1 — decided from TASK 0

- **If the CDN refuses the Worker:** move the NBA board to the ESPN adapter
  that the other ESPN leagues use (`espnLeague: 'nba'`).
  - Keep the response shape; read CONTRACTS.md first (Rule 86).
  - The client's CDN-specific box score path needs its own decision.
- **If the URL or headers changed:** fix the request.
- Either way, `nba-cdn-empty` must stop meaning both "no games today" and
  "the CDN refused us".

## Done condition (Rule 90 artifacts)

1. TASK 0's three outputs committed.
2. `/v2/games?sport=nba&date=<a game day>` returns that day's games during
   the season, read through the relay self-probe and committed.
3. A failed upstream read is distinguishable in the response from an empty
   slate, with a check that fails when the two are conflated.
