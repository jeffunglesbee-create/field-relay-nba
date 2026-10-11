# Claude Code Command — NHL shift charts make on-ice state a backfill, not a wait

**Date:** 2026-10-11
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** A then C — **Task 1 is a probe and nothing ships from it**
**Status:** FILED, not started.

**Rule F:** a shift chart is a timekeeper's record. Commodity.
**Rule A:** pull only. No cron in this document.
Follows `docs/CC-CMD-2026-10-10-nhl-win-probability-from-xg.md` (DONE).

## Why this exists, and what it overturns

The live-WP model shipped with on-ice personnel as its stated frontier. The
NHL play-by-play carries none — every key in the plays array was searched for
`onice|on_ice|skater|forward|defen|shift|toi` and the single hit was
`homeTeamDefendingSide`. `situationCode` gives skater *counts*, never *which*
skaters.

ESPN's `onIce` was then probed live on 2026-10-11 and **is** real on-ice
personnel: game 401892480 (regulation) reported **6 per side**, game 401892481
(**overtime**) reported **4 per side**, and re-sampling 80 seconds later turned
over five of six skaters for Calgary, five of six for Anaheim, three of four in
OT for Vegas and two of four for Los Angeles — with each goalie persisting. A
dressed-roster snapshot cannot produce 6-versus-4 by period type.

**But `onIce` is a CURRENT snapshot with no per-event attachment**, so it cannot
be joined to a shot that already happened, and nothing in the tree has been
polling it. That is what made on-ice-adjusted WP look like a capture-first,
train-next-season problem.

**It is not.** `https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=2026020053`
returns **HTTP 200**, JSON, one row per shift:

```json
{"playerId":8471214,"firstName":"Alex","lastName":"Ovechkin","teamId":15,
 "teamAbbrev":"WSH","period":1,"shiftNumber":2,"startTime":"03:25",
 "endTime":"04:24","duration":"00:59","eventNumber":97,"typeCode":517,
 "hexValue":"#041E42"}
```

Every shift, every player, with start and end times. Interval-join a shot's
elapsed second against that and the five skaters on the ice are exact — **for
any historical game, not only games someone thought to poll.**

## MEASURED NEGATIVE — `eventNumber` is NOT the join key

The obvious move is to join `shiftcharts[].eventNumber` to `plays[].eventId`.
**It does not work.** Measured on game 2026020053: the nine shift
`eventNumber`s sampled (5, 97, 122, 208, 266, 373, 470, 509, 555) appear as a
`plays[].eventId` **zero times out of nine.** The play `eventId` range on that
game is 7–1029 and the shift numbers fall inside it, so the two look joinable
and are different numbering spaces.

This is the shape BSD's tennis date parameters already taught this repository —
four parameter names "accepted and silently dropped", returning HTTP 200 with
the same unfiltered page. A join on `eventNumber` would produce a confident
wrong on-ice set rather than an error. **Join by time interval.**

Caveat stated: nine samples, one game. Task 1 widens it.

## A SECOND HOST, not a second path

`src/index.js:16446` proxies `/nhl/*` to `NHL_BASE` =
`https://api-web.nhle.com`, gated by `nhlAllowed(cleanPath)`. Shift charts live
on **`api.nhle.com`** — a different host. Adding `/stats/rest/...` to
`nhlAllowed` would forward it to `api-web.nhle.com` and fail. This needs its own
base constant and its own route, not an allow-list entry.

## Tasks

**Task 1 — PROBE ONLY, nothing ships.** One artifact,
`outbox/nhl-shiftcharts-probe-<ts>.json`, declaring a call budget and reporting
`callsMade`:

1. **Historical depth.** Request shift charts for one game in each of 2020,
   2021, 2022 and 2023 — the WP model's own train and test seasons. If any
   season returns nothing, the backfill window is bounded and the model's
   training window is the binding constraint, not the data.
2. **Widen the `eventNumber` negative** to 3 games and every shift row, not
   nine samples. Report matched/total with a denominator. If it ever matches,
   STOP and report — that would mean the negative above is wrong.
3. **Interval-join rate.** For one game, join every shot's elapsed second
   against the shift intervals and report, with denominators: how many shots
   resolve to **exactly 5 skaters + 1 goalie per side**, how many resolve to a
   count that **disagrees with `situationCode`** on the same shot, and how many
   resolve to no players at all. `situationCode` is the independent control and
   it is already confirmed — two derivations, 26 informative agreements, 0
   disagreements. **A reconstruction that disagrees with it is wrong, not
   interesting.**
4. **Boundary semantics.** Is `endTime` inclusive or exclusive, and are shift
   times period-relative (they appear to be — `startTime` `03:25` in period 1)?
   A shot at a shift boundary must not resolve to 6 skaters. State the rule
   measured, not assumed.
5. **Clock direction.** The WP model derives elapsed seconds as
   `(period-1)*1200 + mm*60 + ss` from `timeInPeriod`. Shift `startTime`/`endTime`
   must be confirmed to use the same direction. The model's own premise block
   already records `timeLeft` as unusable in the MoneyPuck data; a mixed
   convention here would silently invert every join.

**Task 2 — the route, only if Task 1 clears.** A new base constant and
`/nhl-stats/*` (or similar — `/nhl/*` is taken and points elsewhere) forwarding
to `api.nhle.com/stats/rest/en/*`, path allow-listed the way `nhlAllowed` does
it, with a TTL from what the data does: a finished game's shift chart is
immutable, a live game's grows. Two TTLs, each with its reason beside it.

**Task 3 — the reconstruction, as a pure function.** `onIceAt(shifts, period,
elapsedSeconds)` returning `{home: [...playerIds], away: [...playerIds]}` or a
named refusal. Four states, not two: resolved; **disagrees with
`situationCode`**; no shift data for that game; shift data present but the
instant falls in no interval. Rule 99 — none of those is an empty array, and an
empty array must not read as "nobody on the ice."

**Task 4 — nothing is modelled in this document.** No feature is added to
`hockey-wp.js`, no retraining, no recalibration. The on-ice set becomes
available and that is the deliverable. Adding it to the model is a separate
CC-CMD and must re-run the full calibration gate against both baselines,
because a feature set change invalidates the 0.171551 that cleared it.

**Task 5 — the fallback, ONLY if Task 1.1 shows the history is too shallow.**
Lines change at stoppages and every stoppage has a faceoff carrying
`winningPlayerId`/`losingPlayerId`; `rosterSpots.positionCode` plus boxscore TOI
ranks centres into lines. That yields a "line rank" proxy derivable from
play-by-play alone, for every season the PBP exists. **It is a proxy and must be
validated before use**: report how often the shooter is a linemate of the last
faceoff centre, with a denominator. Do not build this if Task 1.1 clears — a
proxy beside real data is two sources free to disagree.

## Stop conditions

- **Task 1 ships nothing.** If a task tempts a route or a feature before the
  artifact exists, STOP.
- If the interval join disagrees with `situationCode` on a material share of
  shots, STOP and report the rate. `situationCode` is confirmed and this is not.
- Do not add `/stats/rest/...` to `nhlAllowed`. Wrong host; it would forward to
  `api-web.nhle.com` and fail in a way that looks like a missing path.
- Do not touch `hockey-wp.js`, its coefficients, or its calibration artifact.

## Done conditions

1. An artifact records shift-chart availability for 2020, 2021, 2022 and 2023,
   each with a game id and an HTTP status.
2. The `eventNumber` negative is confirmed over 3 games and all shift rows, with
   a denominator — or refuted, in which case the work stops and reports.
3. The interval-join rate is reported against `situationCode` as the control,
   with counts for agree, disagree and unresolvable.
4. Boundary and clock-direction semantics are stated as measured.
5. If and only if Task 1 cleared: a route exists with two reasoned TTLs, and
   `onIceAt` returns four distinguishable states.
6. `hockey-wp.js` is byte-identical.
