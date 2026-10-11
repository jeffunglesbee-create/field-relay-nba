# Claude Code Command — broadcasts, territory-scoped, into the column FIELD is named for

**Date:** 2026-10-10
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** C (feature) — two routes into the product's defining column
**Status:** FILED, not started.

**Rule F:** who is televising a match is a listing, not a composite. Commodity.
**Rule A:** pull only.

## Why this exists

FIELD's own description is scores, **broadcast costs** and journalism, and the
broadcast column has holes in it. `/context/date/2026-10-08`, read live:

```
NHL  Islanders–Blackhawks   streams: "ESPN+, CHSN, MSGSN"
NHL  Senators–Flyers        streams: "ESPN+, NBC Sports Phil"
NBA  Cavaliers–Celtics      streams: null
NBA  Heat–Pelicans          streams: null
NBA  Nets–76ers             streams: null
NBA  Spurs–Hawks            streams: null
MLB  White Sox–Guardians    streams: "TBS, truTV"
```

Five of six NBA rows carried nothing. And `streams` is free text — a
comma-joined string with "(Local)" suffixes — so nothing downstream can filter
it, join it or tell a national carry from a regional one.

**Measured 2026-10-10** (`outbox/bsd-surface-probe-latest.json`,
task4_broadcastsAndLineups). `/api/v2/events/{id}/broadcasts/` returned **200 at
pre-match and 200 at finished**, and `/api/v2/tv-channels/583/broadcasts/`
returned **29 rows**. Row keys, verbatim:

```
id, event_id, home_team_id, home_team, away_team_id, away_team,
league_id, league_name, event_date,
country_code, channel_id, channel_name, channel_link, scheduled_start_time
```

`territory.scoped: true`, via `country_code`.

**The territory field is the whole reason this is worth building.** A channel
list with no territory is worse than none — it tells a US reader to watch a
channel that does not exist where they are, confidently. That was the explicit
disqualifying condition in the probe spec, and the measurement cleared it.

`scheduled_start_time` separate from `event_date` is a second real gain: a
broadcast window is not the kickoff, and FIELD's string column cannot express
the difference.

## Tasks

**Task 1 — two routes, pure forward.** `/bsd/events/{id}/broadcasts` and
`/bsd/tv-channels/{id}/broadcasts`, BSD's shape verbatim (Rule 62), including
`country_code`, `channel_link` and `scheduled_start_time`. TTLs with their
reasons written beside them: a listing firms up as the fixture approaches and
is immutable afterwards.

**Task 2 — DO NOT flatten into `streams`.** The existing column is a free-text
string and the temptation is to comma-join `channel_name` into it, which would
destroy `country_code` on the way and reproduce the defect. Serve the structured
rows. Whether the client keeps `streams`, replaces it, or carries both is a
client decision with its own CC-CMD — and `streams` has non-BSD sources behind
it for the North American leagues, so replacing it is not a one-way door.

**Task 3 — territory is a filter the CALLER applies, and absence is a third
state.** A row whose `country_code` is null is not a US row and not a non-US
row. It is a listing of unstated territory, and it must stay distinguishable
from both. Report the non-null rate for `country_code` with a denominator —
the field census proved twice today that a field can be served and empty, and
`attendance` was null on 193 of 193 rows.

**Task 4 — the join rate, with a denominator.** The rows carry
`home_team_id`/`away_team_id` and `event_id` in BSD's id space. FIELD's rows
carry `espn_event_id` and FIELD team names. `src/identity-resolver.js` and
`src/odds-name-match.js` are the existing machinery and the second exists
because EPL club matching needed its own module. Report how many of one real
slate's soccer fixtures join, and name the misses. An unjoined broadcast row is
a channel beside no game.

**Task 5 — measure the coverage before anyone plans on it.** Two questions the
probe did not ask, one call each: does the broadcasts endpoint serve rows for
**non-football** BSD sports, and does it cover the North American leagues where
FIELD's holes actually are? Basketball's league list includes the NBA and WNBA
(measured today, 7 leagues) while **hockey's 13 leagues do not include the NHL**
— so the answer may be "soccer only," and that is still worth having, provided
nobody plans an NBA fix on it. Say which.

## Stop conditions

- Do not reshape BSD's rows into the `streams` string. Rule 62, and Task 2 is
  the point of this document.
- Do not drop `country_code` as "mostly US anyway." The field is the feature.
- If `country_code` is null on most rows, STOP and report before building a
  filter on it. A territory filter over mostly-unstated territory is a confident
  wrong answer, which is the class this whole day's work has been about.

## Done conditions

1. Both routes forward BSD's shape with `country_code`, `channel_link` and
   `scheduled_start_time` intact, with reasoned TTLs.
2. `streams` is untouched.
3. Null `country_code` is distinguishable from a stated one, with a check, and
   its non-null rate is reported with a denominator.
4. The join rate against one real slate is reported and the misses named.
5. An artifact states which sports and which leagues the endpoint actually
   serves broadcasts for.
