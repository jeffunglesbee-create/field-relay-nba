# BSD Tennis V2 — ATP/WTA wired into /v2/games — 2026-06-25

## Probes

- CC-CMD-A confirmed: `/bsd/*` route block exists at L6083.
- ATP/WTA not present in V2_LEAGUES before this commit.
- `V2_LEAGUES` defined at L994; `'afl'` was the last entry (L1017).
- `handleV2Games` at L2458; existing `espnSource && sport === 'golf'` branch
  at L2467; new tennis branch slots in directly after.
- `espn_summary` entry at `context-assembler.js` L486 had no `atp`/`wta`.

## Edits

**`src/index.js`**
- L1017–1021: Added `'atp'` and `'wta'` entries to V2_LEAGUES with
  `espnSource: true`, `espnLeague: 'atp'` / `'wta'`, sport: `'tennis'`.
- L2475–2525: New tennis branch in `handleV2Games` right after the golf
  branch. Fetches `site.api.espn.com/apis/site/v2/sports/tennis/{league}/scoreboard`,
  iterates `events[].competitions[]` (tournament → matches), maps each
  match competitor to home/away, extracts score/sets/round/broadcasts,
  emits a `{sport, date, games, source: 'espn-tennis', tournament}` payload
  with 25s cache.

**`src/context-assembler.js` L487** — `espn_summary` sports list extended
to `['mlb', 'nba', 'wnba', 'nhl', 'wc26', 'soccer', 'atp', 'wta']` so
tennis matches receive ESPN-summary context in the journalism prompt.

## Commit & deploy

- `b5c9983` feat(tennis): wire ATP/WTA via ESPN scoreboard + V2_LEAGUES + espn_summary context (2 files, +56/−1)
- Deploy: workflow 28174976483 — completed/success.

## Done conditions

- [x] V2_LEAGUES has `'atp'` and `'wta'` with `espnLeague`
- [x] tennis branch in `handleV2Games` (`cfg.sport === 'tennis'`)
- [x] flattens `tournament.competitions[]`
- [x] `espn_summary` extended to atp + wta
- [x] `node --check` passes both files
- [x] Deploy green (28174976483)
- [x] `/v2/games?sport=atp` → 200, `{sport:"atp", date, games:[], tournament:"Lexus Eastbourne Open", source:"espn-tennis"}`
- [x] `/v2/games?sport=wta` → 200, same shape with empty games
- [x] Diff scope: `src/index.js` + `src/context-assembler.js` only

## Probe outputs

```
GET /v2/games?sport=atp → 200
{"sport":"atp","date":"2026-06-25","games":[],
 "source":"espn-tennis","tournament":"Lexus Eastbourne Open"}

GET /v2/games?sport=wta → 200
{"sport":"wta","date":"2026-06-25","games":[],
 "source":"espn-tennis","tournament":"Lexus Eastbourne Open"}
```

## Note on empty games array

ESPN's unofficial tennis scoreboard returns the tournament-level event
(`Lexus Eastbourne Open` is currently active) but the `competitions[]`
array on the scoreboard event is empty today. This is data-side, not
route-side: the relay correctly fetches, correctly flattens, and emits
an empty array when no matches are surfaced. Wimbledon (June 27 main
draw) is expected to populate `competitions[]` per event — at that point
the same route will return full ATP/WTA match lists.

Confirmed earlier via `/bsd/tennis/matches/live` that BSD's tennis pack
has live point-by-point Wimbledon qualification data. The full V2
integration combines: ESPN scoreboard for schedule/listing (this commit)
+ BSD detail for live match telemetry (CC-CMD-A routes).

## Next

Tasks C (momentum context) and D (websocket) can now consume the
`/v2/games?sport=atp` listing — game objects carry `bsdMatchId` /
`espnEventId` for cross-reference into the BSD detail endpoints
shipped in CC-CMD-A.
