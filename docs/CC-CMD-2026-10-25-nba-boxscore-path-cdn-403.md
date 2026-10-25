# Claude Code Command — the client's NBA box-score and play-by-play paths read the CDN route that answers 403

**Date:** 2026-10-25
**Repo:** field-relay-nba (consumer in jubilant-bassoon)
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (a data path that is silently empty)
**Confidence gate:** >= 95 before any commit
**Status:** FILED, not dispatched. The direction is the owner's: the options
below differ in which repo serves the box score, and no build starts until one
is chosen.
**Filed by:** the close-out of `docs/CC-CMD-2026-10-22-nba-cdn-403-in-season.md`,
which moved the NBA scoreboard to ESPN and named this path as its own decision
(Rule 87.4). Nothing in that CC-CMD's TASK 1 touched it.

---

## What was measured

- **2026-10-24T23:09:30Z:** with game 401909853 live on the ESPN board, the
  relay's `/nba/liveData/scoreboard/todaysScoreboard_00.json` answered 403,
  body `nba returned 403`. The CDN refuses the Worker in live play
  (`docs/CC-CMD-2026-10-22-nba-cdn-403-in-season.md`, Live check 2).
- The client reads three more `/liveData/` routes through the same relay
  passthrough, by function: `fetchNBABoxScoreViaRelay`,
  `fetchNBALiveBoxscore` (reads `/liveData/boxscore/boxscore_<nbaId>.json`) and
  a play-by-play fetch (`/liveData/playbyplay/playbyplay_<nbaId>.json`). The NBA
  CC-CMD's "Who reads it" lists the
  scoreboard readers and says the box-score and play-by-play fetches "all fail
  under the 403".
- That sentence was written from reading, not from a request. TASK 0 replaces it.

## TASK 0 — premises, one command each (run before choosing a direction)

1. **The box-score request is never made.** `fetchNBALiveBoxscore` returns null
   when `_nbaGameIdMap` has no id, and the map is built by `fetchNBAScoreboard`
   from the 403 scoreboard. Run the real function against an empty map and
   count outbound `fetch` calls. Zero refutes "the 403 is what fails"; the
   request never leaves, and fixing the box-score route alone would change
   nothing.
2. **ESPN serves the box score for the same game in live play.** From a
   runner (the sandbox cannot reach ESPN), request the summary of event
   `401909853` while it is live and read whether it carries per-player lines.
   An empty `boxscore.players` refutes ESPN as a source.
3. **The relay has no ESPN box-score route.** Grep the route table for a
   `pathname` that serves a basketball summary. A hit refutes "build one".
4. **The other `/nba/*` readers.** For each of `daily-brief.yml`,
   `field-data.yml`, MCP `get_live_scores`, `deploy.yml` PROBE A and
   `scoreboard-probe.yml`, run it or its request once and record the status.
   A 200 refutes "all of them fail" for that reader.

## TASK 1 — options, decided by the owner after TASK 0

- **(a) Relay serves an ESPN box score** at a route the client calls (Rule 60:
  the relay owns the contract). Either the relay reproduces the CDN shape the
  client parses today (read `fetchNBALiveBoxscore` first), or the client reads
  a new one.
- **(b) Client reads the id from `/v2/games`** (`espnEventId`) and drops
  `_nbaGameIdMap`, then takes (a) for the box score.
- **(c) Retire the NBA box-score and play-by-play features** in the client, if
  TASK 0 shows nothing on screen depends on them.
- Rule 45: whether ESPN may serve this data is flagged for human review, as in
  the NBA CC-CMD.

## Done condition (Rule 90 artifacts)

1. TASK 0's four outputs committed, each with the command that produced it.
2. The owner's choice recorded here, with the date.
3. After the chosen build: a live NBA game's box score read through the path
   the client uses, with per-player lines present, committed as a probe log.
