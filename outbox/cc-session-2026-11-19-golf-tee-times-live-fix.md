# CC session 2026-11-19 — golf tee times: the live read failed, and the fix

**Repo:** field-relay-nba. **HEAD:** `d18f973` → `5cc1947` (probe workflow) → `f2dfd9e` (its artifact, by the runner) → `464d4f7` (the fix), then this doc and the HANDOFF entry.
**CC-CMD:** `docs/CC-CMD-2026-11-16-golf-tee-times.md` (STAGED). The owner's order: "Approved" (run the diagnostic, then fix both causes).

## Found

- `/v2/golf/enriched?date=2026-11-19` (RSM Classic, 00:40Z): `round`, `roundStart`, `teeTimes`, `venue` all null.
- **Cause 1: the Worker cannot read ESPN's core API.** Through the relay's own `/web-fetch`, run by `golf-core-reach-probe.yml` (artifact `outbox/golf-core-reach-probe-2026-11-19T00-41-40-114Z.json`): core event, competition and competitor status 403 from the Worker, 200 from a runner with or without a User-Agent; the site.api scoreboard 200 from both. Already recorded on 2026-10-14 in `docs/CC-CMD-2026-10-14-espn-host-flip.md` Task 3. My 11-18 build did not read it (BUILD-ON-A miss), and its Task 1 probe measured a runner, not the Worker.
- **Cause 2: no round before the first shot.** The scoreboard's round comes from empty linescores, so the reader never ran.

## Built (`464d4f7`)

- `getGolfLeaderboardFacts(url, eventId)`: ESPN's golf leaderboard on `ESPN_API_BASE`, one request, edge-cached 300 s. It returns competitor statuses and courses, and is called only from `/v2/golf/enriched`. The route builds the URL, so the provenance manifest names `site.api.espn.com`.
- `teeTimeRound(scoreboardRound, statuses)` in `src/golf-tee-times.js`: the scoreboard's round, else the highest competitor `period`.
- `venue` and `venueLocation` come from the leaderboard's host course; the core event read is removed.
- `teeTimes` is now `{round, inRound, withTeeTime, competitors}`. KV v7. `CONTRACTS.md` updated.
- Fixture `outbox/golf-leaderboard-rsm-r1-2026-11-19.json`: the read before round 1, trimmed to statuses and courses.

## Verified (local)

- `check-golf-tee-times`: 14/14 checks. Self-test: 9 of 9 mutants caught.
- A simulation of the helper on the full saved leaderboard response (mocked fetch):
  - fetched URL `site.api.espn.com/.../golf/leaderboard?league=pga&event=401850981`, with `cf` `{cacheTtl:300, cacheEverything:true}`;
  - round 1, 147/147, `roundStart` 13:30Z, `roundLastTee` 15:42Z;
  - venue Sea Island Golf Club (Seaside Course), Saint Simons Island, GA;
  - a wrong event id gives null.
- Every node step of `deploy.yml` run locally: green, apart from the expected exceptions:
  - three that need `RELAY_SHARED_SECRET` (CI holds it);
  - three mutation harnesses that refuse a dirty tree (run before the commit);
  - the route-provenance manifest, regenerated (`/v2/golf/enriched`: `sports.core.api.espn.com` → `site.api.espn.com`).
- Empty catches hold at 112.

## Live

- Follows the deploy of `464d4f7`. See the HANDOFF entry for the read.

## Still open

- Still on the core API and still 403: `/v2/golf/eventlog`, `/v2/golf/competitor-stats` and the enriched top-20 stats, `/soccer/xg`, `/soccer/sub-impact`. These are recorded in the host-flip CC-CMD's Task 3; that decision is the owner's.
