# Night-Owl game_id Fix — 2026-06-23

## Probe

`src/index.js:7133–7143` — D1 lookup tried `regular_season_games.id`
then `postseason_games.id`. Client briefs pass synthesized FIELD ids
(`mlb_arizonadiamo_minnesotatwi`) which don't match either format.
Result: `_archiveGameCtx = null` for every night_owl / mlb_game /
wnba_game brief → Dims 7+10 silently degraded to 0.

## What shipped

`src/index.js` D1 lookup block extended to 3 tries:

1. `regular_season_games.id` (primary key — relay-generated briefs)
2. `regular_season_games.espn_event_id` (client briefs that pass
   `topGame.sourceId` = ESPN numeric event ID)
3. `postseason_games.id` (postseason fallback)

`note` column included on the espn_event_id path so Dim 10 also fires.

## Commit & deploy

- `bf4fe9d` fix: /archive/brief D1 lookup — espn_event_id fallback for
  client briefs (1 file, +9)
- Deploy: workflow 28064816305 — completed/success.

## Verification

End-to-end verification is **DEFERRED-EXPECTED** until tonight's
night_owl cron archives a brief with `topGame.sourceId` populated AND
the client-side change to pass that as `game_id` has shipped.

When both are in place:
- The next night_owl brief lookup will hit Try 2 (espn_event_id).
- Dims 7 + 10 will populate from the matched D1 row.
- `/quality/report` night_owl `above_240` will start incrementing
  (currently `above_240: 0` for both MLB and WC night_owl groups).

## Carry-forwards

1. **Client must pass numeric ESPN id.** This fix is half of an atomic
   change (Rule 70). The client side — `archiveBrief('night_owl', sport,
   topGame.sourceId, ...)` — needs to pass `topGame.sourceId` (ESPN id),
   not the FIELD-synthesized id. Without the client-side change the
   lookup still misses; `_archiveGameCtx` remains null. Track that
   change in jubilant-bassoon.
2. **espn_event_id only populated for new POSTs.** Legacy rows have
   `espn_event_id = NULL`, so Try 2 misses them. New `/archive/game`
   POSTs going forward populate the column — coverage accumulates.
3. **Postseason espn_event_id not queried.** Rare case where a client
   archives a postseason brief by ESPN id. If it surfaces, add a Try 4:
   `postseason_games.espn_event_id`.

## Verify commands

```
probe_relay_route /quality/report
# Watch night_owl rows — above_240 should climb after the client
# starts passing topGame.sourceId as game_id and the espn_event_id
# column starts populating.
```
