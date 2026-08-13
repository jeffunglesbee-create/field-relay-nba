# BSD average-positions — probe, diagnosis, fix

## Status: DONE. A question this repo recorded as open on 2026-07-15 is now closed. **Confidence: 95.**

Branch `main` throughout (`git branch --show-current` → `main`).

| commit | what |
|---|---|
| `e4bb963` | BSD surface probe |
| `40bbd6d` | two defects in that probe, found by its own first run |
| `ee53892` | targeted average-positions diagnosis |
| `f6a1fd5` | route served from `/stats/`; CONTRACTS.md updated |
| `1e6b449` | dead dedicated-endpoint call removed from capture |
| `1f08656` | never write an empty `average_positions` over a populated one |

## Done condition — full surface, live

`outbox/bsd-api-probe-2026-08-13T02-31-10*.log`:

```
200  contract            1895B
200  events/live          457B  1 live
200  events/by-date     55251B  48 events
200  shotmap            16932B  payload 140
200  momentum            1534B  payload  92
200  incidents           3343B  payload  17
200  odds               52149B  11 markets
200  average-positions   2090B  payload  29   object{away,home}   ← was 404
200  tennis/live        22826B  11 matches
400  r2/read (bad key)         invalid key
404  r2/read (missing)         not found
404  unknown route             Unknown BSD route
```

Nine routes serving, three guards behaving. `average-positions` was 404 on
every event before this work.

## What the diagnosis actually settled

This was **not** a new discovery — it was an old question nobody had been
able to answer. CONTRACTS.md and the `_bsdCaptureStatsWithAvgPositions`
comment both recorded, on 2026-07-15, that a 404 from
`/api/v2/events/{id}/average-positions/` was consistent with two different
explanations that testing could not separate:

> either the route doesn't exist, or it's a live-only real-time feed that
> stops serving once the match ends

Every prior test — two historical codex entries plus that CC-CMD's own probe
— had used a **finished** event. That CC-CMD said so plainly: the question
*"remains genuinely unresolved until a real live game is available to test
against directly,"* and its own `/bsd/events/live` check came back empty for
the third time running.

The missing measurement was one live match.
`scripts/bsd-avgpos-diagnose.mjs`, 6 events across 4 days:

| event | status | `/average-positions/` | `/stats/`.average_positions |
|---|---|---|---|
| **207955** | **2nd_half (LIVE)** | 404 | `{}` |
| 223324 | finished | 404 | `{away, home}` |
| 207987 | finished | 404 | `{away, home}` |
| 207962 | finished | 404 | `{away, home}` |
| 207956 | finished | 404 | `{away, home}` |
| 587659 | finished | 404 | `{}` |

All six byte-identical: `{"error": true, "status": 404, "detail": "Not found"}`.

**A live match 404s exactly like a finished one.** The live-only theory is
falsified; that endpoint never served anything.

The same run settled the half the note suspected but could not show:
`/stats/`'s embedded field is **post-final only** — the live event's was
`{}`. During play the data exists in *neither* source.

Incidental corroboration from the regression run two hours later: 207955,
which returned `{}` while in `2nd_half`, now returns 29 players. The data
appears when the match ends, exactly as the model predicts.

## The three fixes

1. **Route** (`f6a1fd5`) — serves `parsed.average_positions` from `/stats/`.
   Returns `{}` in play, `{away, home}` after final, 404 only when the key is
   absent entirely. Same shape the R2 capture already stores, so live and
   archived are one shape rather than two.

2. **Dead call removed** (`1e6b449`) — the capture helper's level-1 fetch of
   the dedicated endpoint. It was correct design under 2026-07-15's
   uncertainty and is now one guaranteed-failing request per game per
   5-minute tick. `customMetadata.source` moves `stats-fallback` →
   `stats-embedded`, because naming a fallback that no longer exists would
   mislead the next reader. One shared helper, so this covers both
   `runBSDEndgameCapture` (WC26) and `runBSDClubLeagueEndgameCapture`.

3. **Empty-write guard** (`1f08656`) — `{}` is truthy, and `{}` is what a
   match in progress returns. This capture fires across an 80-120 minute
   window, i.e. mostly *before* full time, so the unguarded write would put
   an empty object over a populated one on any later pre-final tick.

Fix 3 is the same failure class as `src/mlb-savant-r2.js` earlier the same
day (`7588b24`), where an empty object written to R2 cost the client's entire
pitch-arsenal line for weeks because an empty object is a cache **hit**, not
a miss. Two independent instances in one day is the argument for treating
"never overwrite good data with nothing" as a standing rule rather than a
local fix.

## Two defects in my own probe, caught by its first run

Worth recording because run 1 would have reported three false failures.

- `itemCount` counted **wrapper keys**, so `momentum` returning 35 bytes of
  `{event_id, momentum: []}` reported `items=2` and sailed past the
  `emptyButOk` check — the exact 200-with-nothing class the probe exists to
  catch. Now sums elements across all top-level arrays.
- `pickIds` unwrapped only `results`/`data`, but `/bsd/events/live` returns
  `{count, events}`, so live's ids were invisible.
- Substantively: run 1 probed event `223325`, a fixture that had not kicked
  off, whose shotmap/momentum/incidents were legitimately empty. Reported
  as-is that reads as three broken routes. Run 2 filters for a played status
  first — `statusValuesSeen` came back
  `["notstarted","postponed","cancelled","2nd_half"]`, only 2 of 48 events
  playable.

## Confidence gate

**95.** The route fix is proven end-to-end on the live deployment: 404 → 200
with 29 real player positions, plus a full-surface regression showing the
other eight routes and all three guards unchanged. The diagnosis rests on six
enumerated events with byte-identical bodies quoted whole, including the live
case that every previous attempt lacked.

Not higher because **the capture-path changes have not been observed
firing.** Commits `1e6b449` and `1f08656` are deployed and syntactically
verified, and they read the same expression the route now serves — but the
cron fires on an 80-120 minute window during a live match, and I did not
watch one execute. The reasoning is strong and the code is simple; that is
not the same as evidence, and this session has twice today shipped a change
that was correct in shape and inert in practice.

**Unblock criteria (Rule 74):** the next club match crossing the 80-120
minute window writes `bsd/{slug}/{bsdEventId}/average-positions.json`.
Verify with
`GET /bsd/r2/read?key=bsd/{slug}/{id}/average-positions.json` — pass is a
populated `{away, home}` and `customMetadata.source` reading
`stats-embedded` rather than `stats-fallback`. A `{}` body would mean the
guard did not hold.

## Residual

None deferred. The one item flagged in CONTRACTS.md at the route fix — the
capture path's dead first fallback level — was the follow-up, and it is done
here rather than carried.
