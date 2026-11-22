# CC-CMD-2026-11-22-nhl-feed-espn-event-id

**Filed from:** field-laboratory, `docs/CC-CMD-2026-11-11-live-scores-other-sports.md`.
**Ask to:** field-relay-nba.
**Status:** FILED 2026-11-22. Nothing here is built. The laboratory works without it (below); this retires a stand-in.

## The gap

`GET /v2/games?sport=nhl&date=D` serves NHL games from api-web.nhle.com (`adaptNhle`, `src/index.js`): `id: "nhl:2026020373"`, `nhleGameId: 2026020373`,
and **no `espnEventId`**. Every other sport the route serves (nba, wnba, mlb, nfl, cfb, afl, and every soccer key) carries `espnEventId`, and the archive row
the laboratory draws as a card carries `espn_event_id` from ESPN (`NHL_2026-11-21_e401892754`, `espn_event_id` 401892754). So an NHL card cannot be joined to
its live game by id, which is how the laboratory joins everything else (field-laboratory `src/LiveFeed.fs`, `readingFor`).

Read 2026-11-22 (probe of `/v2/games?sport=nhl&date=2026-11-22`, five games, state `pre`): every game has `nhleGameId` and `abbr` for both clubs and none has an ESPN id.
The 2026-11-11 live captures (`field-laboratory` `outbox/live-capture-nhl-2026-11-11-0100Z.json`, `-0201Z.json`): 0 of 6 games joined to an archive row by id.

## What the laboratory does meanwhile (a stand-in, not a fix)

For a feed game with no `espnEventId` the laboratory joins by the two club names on the feed's ET day (`Desk.sameTeam`, home to home, away to away; the archive says
`Sabres`, the feed `Buffalo Sabres`). That is a client-side compensation for a relay field that does not exist (Rule 60, Rule 64): it is retired when this lands, and it
is wrong the day two NHL games between the same clubs share an ET day (the NHL does not schedule that).

## The ask

Serve `espnEventId` (a string) on each NHL game of `/v2/games?sport=nhl` when the game can be matched to an ESPN event, additive, no existing field changes.

- **Value:** the same id the archive stores as `espn_event_id` for that game (`regular_season_games` / `postseason_games`, ids of the shape `NHL_<date>_e<id>`).
- **How is yours to decide.** The relay already walks ESPN's NHL scoreboard for the archive; matching on the clubs' abbreviations and the ET date is one way, reading the archive row another.
  A game that cannot be matched carries no `espnEventId` (absent, not `null`, not `""`); the laboratory then falls back to the names, as it does today.
- **Not in scope:** the lowercase `nhl_<date>_e<nhleGameId>` archive rows (the NHL API id written into `espn_event_id`, found 2026-11-21 as duplicates of the ESPN-id rows: see
  `CC-CMD-2026-09-13-archive-duplicate-rows.md`, "Found 2026-11-22"); any change to `nhleGameId`, `id` or the other fields.

## Done condition

For a date with NHL games, `GET /v2/games?sport=nhl&date=D` returns games whose `espnEventId`, where present, is the `espn_event_id` of exactly one row of `/context/date/D` with `sport` `NHL`.
**Artifact:** a committed probe output listing, per game, `nhleGameId`, `espnEventId` and the archive row id it matched, with `matched N of M games` stated; and the laboratory's
name join reading `0 of N` games joined by name on that day (its `data-why` is the evidence), after which the stand-in in `src/LiveFeed.fs` is deleted in a field-laboratory commit.
