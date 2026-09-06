# What FIELD consumes from BSD, against what BSD offers

Measured 2026-09-06 on a GitHub Actions runner with `BSD_API_TOKEN`
(`scripts/bsd-newsletter-claims.mjs`, 21 upstream calls, artifact
`outbox/bsd-newsletter-claims-latest.json`, commit 6adde27). Sandbox egress is
blocked, so every number here came off the runner.

## The headline

`GET /api/schema/` returns an OpenAPI document declaring **217 paths**.
Combined with three more this run proved directly, the offered surface is
**220 endpoints**.

FIELD fetches **8**.

| | |
|---|---|
| offered by BSD | 220 |
| consumed by FIELD | 8 |
| **offered, never fetched** | **213** |

The 8, extracted from `src/index.js` at run time rather than listed by hand:

    /api/v2/events/                         by-date, season
    /api/v2/events/live/                    4 call sites
    /api/v2/events/{id}
    /api/v2/events/{id}/stats/              3 sites — serves shotmap,
                                            momentum AND average-positions
    /api/v2/events/{id}/incidents/
    /api/v2/events/{id}/odds/comparison/
    /tennis/api/v2/matches/live/
    /tennis/api/v2/matches/{id}/

Eight fetches behind thirteen relay routes. The numbers differ because a route
and a fetch are not the same thing.

## The 213 unused, by surface

     103  football (core /api/ and /api/v2/)
      21  basketball
      17  horseracing
      14  csgo
      12  darts
      12  hockey
      12  tennis
       9  padel
       6  wom
       3  odds
       3  tipsters
       1  docs

Whole sports are present in the vendor and absent from FIELD: basketball,
hockey, darts, padel, horseracing, CS:GO. FIELD reads BSD for football and
tennis only.

Named football endpoints FIELD does not call, from the schema:

    /api/v2/events/{id}/h2h/            /api/v2/events/{id}/lineups/
    /api/v2/events/{id}/player-stats/   /api/v2/events/{id}/prediction/
    /api/v2/events/{id}/broadcasts/     /api/v2/leagues/{id}/standings/
    /api/v2/players/{id}/stats/         /api/v2/players/{id}/transfers/
    /api/v2/teams/{id}/squad/           /api/v2/managers/{id}/career/
    /api/v2/referees/{id}/matches/      /api/v2/venues/{id}/competitions/
    /api/v2/leagues/{id}/top/{stat}/    /api/v2/worldcup/squads/

`/api/v2/events/{id}/broadcasts/` and `/api/v2/tv-channels/` are worth naming
separately: this repo has two workflows about Bundesliga broadcast routes.

## The four newsletter claims

Rule 72 makes a vendor newsletter a hypothesis. Measured:

### 1. New live states — CONFIRMED, one part unobserved

All 154 events for 2026-09-06 walked, no truncation. Seven distinct statuses:

    notstarted 130   finished 10   postponed 6
    halftime 3       2nd_half 3    1st_half 1   cancelled 1

- **halftime: present**, as status `halftime` and period `HT`. Confirmed.
- **"never reached a confirmed result": present** as `postponed` and
  `cancelled`.
- **extra time: NOT OBSERVED.** No match reached it on this date. That is
  absence of evidence, not evidence of absence — the vocabulary is only as
  wide as the day's fixtures. Re-check on a knockout date.

### 2. Odds breadth — PARTLY CONFIRMED, two claims not found

Event 5255 (finished), 26 bookmakers, 376 prices, 10 markets:

    1x2 (18 books)          btts (16)           asian_handicap (12)
    draw_no_bet (10)        double_chance (6)   over_under_25 (6)
    over_under_15 (5)       over_under_35 (5)   total_corners (4)
    over_under_05 (3)

- **BTTS at 16 bookmakers.** The newsletter said 18. Measured 16 on this
  event; 1x2 is the one that reaches 18. One event is one event.
- **draw_no_bet: present**, 10 bookmakers. Confirmed.
- **european_handicap: NOT FOUND.** No market key matches.
- **opening prices: NOT FOUND.** Zero fields match `/open/i` anywhere in the
  payload. What exists is `movement` — `SHORTENING` / `DRIFTING` — on every
  price, which is a direction, not an opening number.

### 3. Squad injury fields — CONFIRMED

`/api/v2/teams/{id}/squad/` (200) carries `players[].injury_type` and
`players[].injury_expected_return`. Both claims land.

`/api/v2/events/{id}/lineups/` (200) additionally carries
`unavailable_players.{home,away}[]` with `reason` and `status` — richer than
the newsletter mentioned, and FIELD calls neither.

"Retired players removed" is not checkable from a shape probe: it is an
absence, and no field asserts it.

### 4. Managers and referees — CONFIRMED, under `managers` not `coaches`

    /api/v2/managers/         200
    /api/v2/managers/{id}/    200
    /api/v2/referees/         200
    /api/v2/referees/{id}/    200
    /api/v2/coaches/          404
    /api/v2/coaches/{id}/     404

A manager record carries `tactical_profile`, `preferred_formation`, `win_pct`,
`avg_goals_scored`, `avg_goals_conceded`, `avg_possession`. A referee record
carries `avg_yellow_per_match`, `avg_red_per_match`, `avg_fouls_per_match`,
`career_games`.

`/api/v2/events/` already returns `home_coach_id`, `away_coach_id` and
`referee_id` on every row. FIELD receives those ids today and resolves none of
them.

Naming: the event payload says **coach**, the endpoint says **manager**, and
`/api/v2/coaches/` is a 404. Anything built here must not guess between them.

## One newsletter claim that did not hold up

**RateLimit headers were not observed.** Zero of `ratelimit-limit`,
`ratelimit-remaining`, `ratelimit-reset` or `retry-after` appeared on any of
the 21 responses. The probe reads all four and recorded `{}`. Either they are
not served on these routes, or not on this plan.

## Not measured

- Nine new competitions: needs a league-list diff against a prior reading, and
  no prior reading exists. `/api/v2/leagues/` is one call away.
- Extra-time vocabulary: needs a knockout fixture.
- Retired-player removal: not observable from shape.
- 213 unused endpoints were counted, not probed. Only the 9 candidates in
  claims 3 and 4 were called.
