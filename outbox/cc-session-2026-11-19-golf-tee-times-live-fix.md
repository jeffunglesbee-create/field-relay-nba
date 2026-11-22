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

- Deploy run 44432843013: `deploy` and `verify` green.
- **Read 1 PASSED** (~01:05Z, `probe_relay_route`): `roundStart` 2026-11-19T13:30:00.000Z, `roundLastTee` 15:42Z, `teeTimes` {round 1, 147/147, 147 competitors}, `venue` Sea Island Golf Club (Seaside Course), Saint Simons Island, GA, `timeValid:false`.
- The `CONTRACTS.md identity check` has been red since 2026-11-11 (client copy missing the soccer board entry and my 11-18 golf entry). Synced in jubilant-bassoon `47d59909`; rerun 44434776572 green.

## Still open

- Still on the core API and still 403: `/v2/golf/eventlog`, `/v2/golf/competitor-stats` and the enriched top-20 stats, `/soccer/xg`, `/soccer/sub-impact`. These are recorded in the host-flip CC-CMD's Task 3; that decision is the owner's.

## 17:30Z read

`/v2/golf/enriched?date=2026-11-19` at 17:30:56Z: `status` "In Progress", `round` 1, `timeValid` false, `roundStart` `2026-11-19T13:30:00.000Z`, `roundLastTee` `2026-11-19T15:42:00.000Z`, `teeTimes` `{round 1, inRound 147, withTeeTime 147, competitors 147}`, `venue` Sea Island Golf Club (Seaside Course). Unchanged from the pre-round read and equal to the owner's screenshot. Read 2 (the archive row's `start_time`) is `trig_01RHFUoJYLWiiVM7hCh1nuva`, 2026-11-20 15:00Z.

## 2026-11-20

- **Unblocked:** the deploy of `3cbe458` (run 44761140537) stopped at the staged-claim gate on another session's untagged claim. A verifier was built and the claim tagged (`8d25d02`). The owner ordered the deploy dispatched (2026-11-20, "Dispatch now"): run 44763794787 on `8d25d02`, `deploy` and `verify` green.
- **Live read, round 2:** `/v2/golf/enriched?date=2026-11-20` returns `round` 2, `roundStart` `2026-11-20T13:30:00.000Z`, `roundLastTee` `2026-11-20T15:42:00.000Z`, `teeTimes {round 2, inRound 145, withTeeTime 145, competitors 147}`.
- **Round-1 rows corrected** on the owner's GO (2026-11-20, "Correct both to 13:30Z"). Run 44763910890 (`scripts/fix-rsm-r1-start-time.mjs`, log `outbox/fix-rsm-r1-start-time-*.log`) changed one row per UPDATE. Read back: `golf_2026-11-19_thersmclassic_r1` and `golf_2026-11-20_thersmclassic_r1` both carry `start_time` `2026-11-19T13:30:00.000Z`.
- **Still to read:** the round-2 archive row after round 2 completes, `start_time` `2026-11-20T13:30:00.000Z`. Armed below.

## 2026-11-21

- **`start_time` holds for every RSM row:**
  - `golf_2026-11-20_thersmclassic_r2` (created 2026-11-20 15:34:46) and `golf_2026-11-21_thersmclassic_r2` (created 2026-11-21 11:47:42) both carry `2026-11-20T13:30:00.000Z`.
  - The two round-1 rows carry `2026-11-19T13:30:00.000Z` (corrected).
  - The done conditions' start-time reads are met.
- **Found: round 2 was archived while it was being played.** The first round-2 row was created at 15:34:46Z, 8 minutes before round 2's last tee (15:42Z). Its leader is "Rasmus Neergaard-Petersen -9"; the next morning's row says "Marco Penge -9".
  - **Cause, read in the source:** `handleESPNGolfScoreboard` took each player's `today` and `thru` from `linescores[0]`, which is round 1, in every round.
  - **Measured on the scoreboard after round 2** (`outbox/golf-scoreboard-rsm-after-r2-2026-11-21.json`): `today` was the round-1 score for 128 of the 145 players past round 1. Every player who had finished round 1 read `thru` 18, so the client's fallback in `_isGolfRoundComplete` (top 60 all `thru` >= 18) fired as soon as round 2 began.
  - The 2026-11-20 15:40Z live read showed exactly that: `round` 2, every top player `thru` 18, each `today` equal to their round-1 score.
- **Fixed in `4943d43`:** `src/golf-round-line.js` `golfRoundLine` reads `today` and `thru` from the current round's own linescore. `scripts/check-golf-round-line.mjs` is in `deploy.yml`: 8/8, 5 mutants, among them "round 1 read in every round".
- **Not changed, the owner's call:** the two round-2 rows' `home_score`/`note` hold a mid-round leader. Their `start_time` is correct.
- **Still to read:** the round-3 row, once round 3 finishes after `4943d43` deploys. It should be created after round 3's last tee, with `start_time` equal to the relay's round-3 `roundStart`.

- `deploy_commit_results` read PASS at 2026-11-21 13:02Z (`outbox/staged-verification-20261121T130223Z.json`, run 44763794787).

- **`4943d43` live** (deploy run 44908060176, `deploy` and `verify` green), read 2026-11-21 13:30Z before round 3. `/v2/golf/enriched?date=2026-11-21` `today` is each player's round-2 score:
  - Penge `toPar` -9, `today` -5 (round 1 was -4).
  - Svensson -7, `today` +1 (round 1 was -8, the round-1 row's leader).
  - `round` is 2 and `thru` is 18 while round 3 has not begun.

### 2026-11-22 13:01Z: no round-3 row, because round 3 has not been played

- **D1:** no `R3` row for `golf_401850981`; the four R1/R2 rows are unchanged.
- **ESPN leaderboard** (FIELD browser tool, 13:01Z):
  - The competition reads `Suspended`, period 3.
  - All 66 players who made the cut are `pre` at period 3 with 0 round-3 holes.
  - Round-3 tee times run 2026-11-22T14:10Z to 16:00Z, 66 of 66.
  - So round 3 is played today. No row is the correct answer, and no round was archived at its start: `4943d43` held through the suspension.
- **Gap found, not changed:** before a round's first shot, `roundStart` serves the PREVIOUS round. At 13:01Z, `/v2/golf/enriched` would read round 2 (13:30Z on 11-20), not round 3's 14:10Z. The scoreboard's `round` counts rounds begun, and `teeTimeRound` uses it whenever it is set. Round 1 is the only round whose tee times show before play (the scoreboard's round is null then).
  - The archive row is unaffected: it is written when the round completes, with `round` = 3.
  - A consumer showing an upcoming round's first tee (the laboratory's Deep Cuts golf windows) would see the last round's time. The fix would choose the round with the next unplayed tee times. It needs the owner's word on what "the current round" means between rounds.
- **Re-read:** 2026-11-23 13:00Z (round 3 finishes today, round 4 is Monday's if the schedule slips).
