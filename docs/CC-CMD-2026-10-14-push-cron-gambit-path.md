# Claude Code Command — the push cron's live-game poll is refused by its own route

**Date:** 2026-10-14
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (dead path) — touches push, so ADR-002 Rule A applies
**Status:** **OPEN — owner decision.** Filed, not built.

## What was measured

Found by the 2026-10-14 ESPN inventory (workflow `wf_e4283b41-c05`), then
checked against source at `ec97b3e`:

- `handleCron` polls, for each of the 8 entries in `SPORT_CONFIG`
  (`src/analytics-engine.js:46-53`),
  `${RELAY}/espn-gambit/apis/site/v2/sports/${cfg.path}/scoreboard`
  (`src/index.js` ~5517), and `if (!r.ok) continue`.
- `/espn-gambit/*` (`src/index.js` ~17337) refuses any path for which
  `espnGambitAllowed` is false, with 403 and
  `X-RELAY-Error: espn-gambit-path-not-whitelisted`.
- `espnGambitAllowed` (`src/index.js:908`) is
  `path.startsWith('/apis/v1/challenges/')`. Executed with node on the cron's
  paths: `/apis/site/v2/sports/basketball/nba/scoreboard`,
  `.../football/nfl/scoreboard`, `.../soccer/eng.1/scoreboard` all `false`.

So every poll is refused, every iteration `continue`s, and `live` stays empty:
the live-game half of the push heartbeat collects nothing. Since when is
UNMEASURED; the clone's history is shallow.

Even an allowed path would not help as written: `/espn-gambit` proxies
`ESPN_GAMBIT_BASE` (gambit-api-partner.fantasy.espn.com), not the site API
the path names.

## Why this is the owner's decision

The dead path is the one that would push live close-game notifications.
ADR-002 Rule A says the relay serves on pull and never pushes a value-based
alert unprompted. Restoring it could reopen exactly that question, so the
first decision is whether this loop should exist at all.

1. **Delete the loop** and its `SPORT_CONFIG` gates from the cron, if push of
   live games is not wanted. No behaviour changes, since it does nothing now.
2. **Repair it**: poll `${ESPN_API_BASE}` directly (the same host as
   `/v2/games`), after an ADR-002 review of what it pushes.
3. Leave it, and record why a loop that cannot succeed stays.

## Done condition

Option 1: no `espn-gambit/apis/site` string in `src/`, and a deploy green.
Option 2: one cron tick's log shows at least one sport's scoreboard read with
HTTP 200, and the ADR-002 review is written down beside the code.
