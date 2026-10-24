# Claude Code Command — the relay's NBA board is empty in-season: cdn.nba.com answers 403

**Date:** 2026-10-22
**Repo:** field-relay-nba (consumers in jubilant-bassoon)
**Branch:** main. Commit directly; no feature branch, no PR.
**Type:** A (a data path that is silently empty)
**Confidence gate:** >= 95 before any commit
**Status:** PARTIAL. TASK 0 premises 2 and 3 done, and TASK 1 deployed
2026-10-24 (`5919cab`, deploy run 40102174240). Done conditions 2 and 3 are
met. Premise 1 (the 403 during live play) is CONFIRMED (Live check 2, 23:09Z)
and the break reads `'live'` (23:19Z). Live check 3, all eight NBA closing lines
bought once, is read 2026-10-25 02:40Z; DONE follows it.
Built under BUILD-ON-A ("filing is not the work").
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

## TASK 0 — results (2026-10-24)

**Premise 2: the CDN refuses the Worker, not the URL.**
`.github/workflows/nba-cdn-egress-probe.yml` (dispatch-only,
`scripts/nba-cdn-egress-probe.mjs`) read the board from a GitHub runner at
11:26:26Z. Log: `outbox/nba-cdn-egress-probe-20261024T112626Z.log`.

| read | status | games |
|---|---|---|
| cdn.nba.com from the runner, no headers | 403 (Akamai "Access Denied") | — |
| cdn.nba.com from the runner, the relay's `NBA_HEADERS` | **200** | 12 |
| the relay's `/nba/liveData/scoreboard/todaysScoreboard_00.json` | **403** `nba returned 403` | — |
| the relay's `/v2/games?sport=nba&date=2026-10-24` | 200, `nba-cdn-empty` | 0 |
| ESPN `basketball/nba/scoreboard?dates=20261024` | 200 | 8 |

`VERDICT: cdn-refuses-the-worker`. The probe reads its headers from
`src/index.js`, and its verdict is self-tested (7/7, 5 of 5 mutations caught).
The CDN's 12 games were 10-23's slate: `todaysScoreboard_00.json` had not yet
turned over at 11:26Z, while ESPN's dated board held 10-24's 8, matching the
archive's 8 rows.

The premise this branch was built on was false from the start. "An off-season
403 means no games" was refuted by a runner on 2026-08-08: with the headers,
it got 200 and 0 games (`outbox/wnba-secondary-probe-20260808T233801Z.log`).
The 06-26 deploy probe already read `nba-cdn-empty`
(`outbox/cc-nba-cdn-2026-06-26.md`).

**Premise 3: every consumer.** Read-only map, workflow wf_c5379dd3-9f6 (three
maps and a critic).
- **Readers of `/v2/games?sport=nba`:**
  - AmbientDO: the closing capture, and finals.
  - Client: `fetchV2Games`, `fetchV2AllScores`, `mapV2ToESPN` and
    `fetchRelayDateSections`.
  - GameDO `_fetchFacts`.
  - analytics-engine Phase 9 and 10A.
  - `/archive/backfill-enrich`.
  - `/test/drama-score-cost`.

  None reads `nbaGameId`. The client's `mapV2ToESPN` reads only `'final'` as
  finished, which decided the final word below.
- **Readers of the `/nba/*` passthrough, which does not read `/v2/games`:**
  - Client: `fetchNBAScoreboard`, which builds `_nbaGameIdMap`, and its 8
    readers.
  - The box-score and play-by-play fetches.
  - `daily-brief.yml` and `field-data.yml`.
  - MCP `get_live_scores`.
  - `deploy.yml` PROBE A and `scoreboard-probe.yml`.

  All of them fail under the 403, and none changed in TASK 1. They are the
  client box-score decision that TASK 1 names.
- **Holds:** none. No ruling, hold or VOID window names `handleV2Games`, its
  NBA branch, `adaptNbaCDN` or `V2_LEAGUES.nba`. The CFL VOID list covers odds
  charge functions only. The ESPN host-flip CC-CMD's "Do not" list binds the
  ESPN fetch, which TASK 1 did not touch.
- **Rule 45:** whether ESPN may serve the NBA board is not a legal question
  this session rules on. The journalism cron and the archive seed already read
  the same ESPN NBA URL. Flagged for human review; no ruling exists.

**Premise 1: the 403 holds during live play.** CONFIRMED 2026-10-24T23:09:30Z.
`/v2/games?sport=nba&date=2026-10-24` listed 401909853 as `'live'` (Q2, clock
1:47, Hornets 61, Heat 54) and, in the same minute, the relay's
`/nba/liveData/scoreboard/todaysScoreboard_00.json` answered 403, body
`nba returned 403`. The CDN refuses the Worker while a game is being played, so
the move to ESPN was needed and not only an off-season workaround. Detail under
Live check 2.

## TASK 1 — decided from TASK 0

- **If the CDN refuses the Worker:** move the NBA board to the ESPN adapter
  that the other ESPN leagues use (`espnLeague: 'nba'`).
  - Keep the response shape; read CONTRACTS.md first (Rule 86).
  - The client's CDN-specific box score path needs its own decision.
- **If the URL or headers changed:** fix the request.
- Either way, `nba-cdn-empty` must stop meaning both "no games today" and
  "the CDN refused us".

## TASK 1 — results (2026-10-24)

The CDN refuses the Worker, so the board moved to ESPN. `5919cab`, deploy run
40102174240.

- `V2_LEAGUES.nba` is `{ espnLeague: 'nba', espnSport: 'basketball' }` and
  rides the ESPN branch that MLB and WNBA use, through `adaptESPNBasketball`,
  which was built on 2026-06-26 for exactly this. The ESPN fetch is untouched.
- **Final word.** An NBA final carries `'final'`, the only word `mapV2ToESPN`
  reads as finished (measured: an ESPN `'post'` final maps to `'in'`, live). No
  client change is needed (Rule 70). WNBA and AFL keep `'post'`. The two-word
  contract is filed, with the owner's decision, as
  `docs/CC-CMD-2026-10-24-v2-final-word.md`.
- **Breaks are live.** Review finding, reproduced on the real worker and the
  real AmbientDO. ESPN's halftime and end-of-quarter statuses came out as
  `'pre'`, so AmbientDO dropped the game from `liveGames`. If another game went
  final meanwhile, it could send `all_final` with this one still being played.
  The adapter now reads ESPN's `type.state === 'in'`, as
  `adaptESPNWCSoccer` does. This also corrects WNBA and AFL.
- `writeWCResult` runs only for soccer boards. Before this change only the
  soccer adapter emitted `'final'` in that branch.
- The CDN early-return and `adaptNbaCDN` are removed (Rule 63), and
  `src/route-provenance.js` is regenerated.
- **Checks:**
  - `scripts/check-v2-games-nba-board.mjs`, in `deploy.yml`: 16 checks, 10
    red on the old source, 10 of 10 mutations caught. Its fixture date is a
    past one and is asserted not to be today. EPL and a World Cup group match
    are the WC writer's controls.
  - `check-v2-games-ambient-no-briefs.mjs`: now 1 of 1 sites.
  - `check-ambient-capture-dedup.mjs` S18 uses the `espn:` id.
  - Gates: 132 of 134 deploy and guards steps on a clean tree. The 2
    failures need a secret or a GitHub list call the sandbox lacks, and fail
    the same way at the base.
- **Review** (workflow wf_b338e9b9-f0d, four lenses, one refuter per finding):
  - 7 confirmed. Fixed here: the break state, the fixture date, the wc26
    control and the stale comments.
  - Filed:
    - GameDO and analytics-engine ask for the UTC date:
      `docs/CC-CMD-2026-10-24-v2-games-callers-ask-utc-date.md`.
    - The client's brief route reads a key nothing writes, now also for
      `espn:` NBA ids: added to
      `docs/CC-CMD-2026-10-22-journalism-game-route-prefixed-ids.md`.
  - 2 refuted.

**Live, after the deploy** (relay self-probe):

```
2026-10-24T14:29Z  /v2/games?sport=nba&date=2026-10-24
  200, source espn-wc, count 8, every game state 'pre'
  espnEventId per game: 401909853 401909854 401909855 401909857
                        401909858 401909856 401909859 401909860
  D1 regular_season_games, sport NBA, date 2026-10-24: the same 8
  espn_event_id values, with equal start_time on each (22:00Z .. 02:00Z)

2026-10-24T14:29Z  /v2/games?sport=nba&date=2026-10-23
  200, source espn-wc, count 12, all state 'final', periodLabel 'F'
  (the old branch answered both dates with count 0, nba-cdn-empty)
```

### Live check 1 — 2026-10-24T22:04Z: the first NBA closing line, bought

D1 `cc49101c`, `change_log` joined to `regular_season_games`:

| game_id | ts | verified | book | start_time | equals the row's `closing_odds` |
|---|---|---|---|---|---|
| NBA_2026-10-24_e401909853 | 21:50:12 | 1 | draftkings | 22:00Z | yes |

- Heat at Hornets was matched through its ESPN event id (`espn_event_id`
  401909853) and bought 9.8 minutes before kickoff, once. Before 2026-10-24
  there were 0 NBA rows in `closing_odds_capture`.
- **Spend, accounted to the call.** `/budget/odds?date=2026-10-24`
  `by_site.ambientCaptureClosingOdds` read 42 at 18:33Z and 63 at 22:04Z: 21
  credits. `change_log` shows 7 captures between those readings, one per
  (sport, kickoff time): Ligue 1 and Serie A at 18:35, La Liga at 18:50, MLS and
  NHL at 19:20, MLS at 21:20, NBA at 21:50. Seven calls at 3 credits is 21, so
  the NBA call cost its 3 and nothing more.
- `/ambient/state?diag=1` at 22:04Z: `lastPutError` null, `lastAlarmError`
  null, `storedMatchesMem` true, `gameStartsSize` 29. The instance had just
  restarted (`instanceStartedAt` 22:04:35Z) and restored all 99 scores and its
  purchase record, so a restart did not re-buy the line.

At 22:04:36Z and 22:05:01Z the relay's
`/nba/liveData/scoreboard/todaysScoreboard_00.json` answered 403, and
`/v2/games?sport=nba` still listed 401909853 as `'pre'`. A 403 while the game is
`'pre'` does not test "the 403 holds during live play", so premise 1 was left
open until Live check 2.

### Live check 2 — 2026-10-24T23:09Z and 23:19Z: live play, then the break

| read | `/v2/games?sport=nba&date=2026-10-24`, game 401909853 | `/ambient/state?diag=1` |
|---|---|---|
| 23:09:30Z | `state 'live'`, `periodNum 2`, `periodLabel 'Q2'`, clock `1:47`, Hornets 61, Heat 54 | in `liveGames`, `lastPutError` null, `gameStartsSize` 36 |
| 23:19:58Z | `state 'live'`, `periodNum 2`, `periodLabel 'Q2'`, clock `0.0`, Hornets 66, Heat 58, `linescores` home `[31,35]` away `[31,27]` | in `liveGames` (66–58, period 2), `lastPutError` null, `lastAlarmError` null, `storedMatchesMem` true, `gameStartsSize` 36 |

- **Premise 1.** The CDN route answered 403, `nba returned 403`, in the 23:09Z
  minute, with the game live on the ESPN board. Confirmed.
- **The break.** At 23:19:58Z the game sat at the end of Q2: two completed
  quarters in `linescores`, no Q3 entry, clock `0.0`. This is the state the 10-24
  review found being read as `'pre'`. The board answered `'live'` with
  `periodLabel 'Q2'`, and AmbientDO kept the game in `liveGames`, so `all_final`
  could not have fired while this game was still being played.
- **What was not observed.** The relay does not carry ESPN's raw status name, so
  whether this break was `STATUS_HALFTIME` or `STATUS_END_PERIOD` was not read.
  The live read proves the effect (`'live'` at clock `0.0` with Q3 not started).
  The two status names are covered by `check-v2-games-nba-board.mjs` N1.
- The Ambient instance restarted at 23:19:53Z (`clientCount` 0) and restored 99
  scores, this game among them as live. A restart in the break did not drop it.

## Done condition (Rule 90 artifacts)

1. TASK 0's three outputs committed.
2. `/v2/games?sport=nba&date=<a game day>` returns that day's games during
   the season, read through the relay self-probe and committed.
3. A failed upstream read is distinguishable in the response from an empty
   slate, with a check that fails when the two are conflated.
