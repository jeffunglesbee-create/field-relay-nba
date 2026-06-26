# WNBA Migration — API-Sports → ESPN — 2026-06-26

## Commit

- `62b115f` feat(wnba): migrate V2_LEAGUES WNBA from API-Sports to ESPN scoreboard
- Deploy run: 28265940532 — conclusion: **success** at 21:21:34Z+
- All 32 steps passed including PROBE F (BSD R2 pitch map)

## Changes (src/index.js only)

### CHANGE 1 — V2_LEAGUES: wnba entry

```js
// before
'wnba': { sport: 'basketball', leagueId: 13, season: '2026' }  // [VERIFY leagueId]

// after
'wnba': { sport: 'wnba', espnLeague: 'wnba', espnSport: 'basketball', season: '2026' }
```

### CHANGE 2 — handleV2Games: basketball branch in adapter dispatch

```js
espnGames = (espnData.events || []).map(ev =>
    cfg.espnSport === 'baseball'    ? adaptESPNMLB(ev)
    : cfg.espnSport === 'basketball' ? adaptESPNBasketball(ev, sport)
    : adaptESPNWCSoccer(ev, sport)
);
```

### CHANGE 3 — adaptESPNBasketball() function (inserted before adaptESPNMLB)

Named generically for future NBA migration reuse (pass `sportKey='nba'`).
Returns standard V2 FieldGame shape with:
- `state`: pre / live / post
- `periodNum` / `periodLabel`: quarter (1-4) or OT, `NS` / `Q3` / `OT` / `OT2` / `F`
- `situation` (live): `{quarter, clock, possession}`
- `linescores`: `{home: [pts per quarter], away: [...]}`
- `venue`: arena name
- `espnEventId`: enables ESPN summary context builder for WNBA briefs
- `league`: `'WNBA'` (or `'NBA'` when sportKey='nba')

## Done conditions

- [x] `node --check src/index.js` clean
- [x] `/v2/games?sport=wnba` → `source: "espn-wc"`, 3 games, venue populated, `espnEventId` present, `sport: "wnba"`

  Live probe output:
  - WSH @ CON | Mohegan Sun Arena | state: pre | espnEventId: 401857024
  - POR @ CHI | Wintrust Arena | state: pre | espnEventId: 401857025
  - ATL @ GS  | Chase Center    | state: pre | espnEventId: 401857026

- [x] Deploy run 28265940532 — all 32 steps success including PROBE F

## Routing note

`espnSport: 'basketball'` is the new dispatch key. MLB uses `'baseball'`,
soccer (wc26 + 11 club leagues) fall through to `adaptESPNWCSoccer`.
Tennis (atp/wta) exits earlier via `cfg.espnSource && cfg.sport === 'tennis'`.
NBA migration will reuse `adaptESPNBasketball(ev, 'nba')` — no new function needed.

## Compliance

- **Rule 47**: Config + adapter change only. No editorial computation.
- **Rule 69**: Only `src/index.js` touched. One commit.
- **Rule 77**: All 32 CI steps verified via job step list before marking done.
- **Rule 87**: Self-completing. Live probe executed in-session confirms ESPN source and venue.
