# MLB Migration — API-Sports → ESPN — 2026-06-26

## Commit

- `e6f5f6e` feat(mlb): migrate V2_LEAGUES MLB from API-Sports to ESPN scoreboard
- Deploy run: 28265428303 — conclusion: **success** at 21:10:21Z
- All 32 steps passed including PROBE F (BSD R2 pitch map)

## Changes (src/index.js only)

### CHANGE 1 — V2_LEAGUES: mlb entry

```js
// before
'mlb': { sport: 'baseball', leagueId: 1, season: '2026' }

// after
'mlb': { sport: 'mlb', espnLeague: 'mlb', espnSport: 'baseball', season: '2026' }
```

### CHANGE 2 — handleV2Games: espnSport URL override

```js
// before
const espnUrl = `...sports/soccer/${cfg.espnLeague}/scoreboard?dates=${espnDate}`;

// after
const _espnSportPath = cfg.espnSport || 'soccer';
const espnUrl = `...sports/${_espnSportPath}/${cfg.espnLeague}/scoreboard?dates=${espnDate}`;
```

All soccer leagues (`cfg.espnSport` absent → defaults to `'soccer'`) unaffected.

### CHANGE 3 — handleV2Games: adapter dispatch

```js
espnGames = (espnData.events || []).map(ev =>
    cfg.espnSport === 'baseball'
        ? adaptESPNMLB(ev)
        : adaptESPNWCSoccer(ev, sport)
);
```

### CHANGE 4 — adaptESPNMLB() function (inserted before adaptESPNWCSoccer)

Returns standard V2 FieldGame shape with MLB-specific fields:
- `state`: pre / live / post (STATUS_SCHEDULED / STATUS_IN_PROGRESS / STATUS_FINAL)
- `periodNum` / `periodLabel`: inning number / `NS` | `T5` | `B7` | `F`
- `situation` (live): `{inning, isTop, outs, balls, strikes, onFirst, onSecond, onThird}`
- `linescores`: `{home: [runs per inning], away: [...]}`
- `venue`: stadium name (was empty with API-Sports)
- `espnEventId`: enables ESPN summary context builder downstream

## Done conditions

- [x] `node --check src/index.js` clean
- [x] `/v2/games?sport=mlb` → `source: "espn-wc"`, 15 games, venue populated (PNC Park, Comerica Park, etc.), `espnEventId` present
- [x] `/v2/games?sport=wc26` → 6 WC games (Norway 1-4 France final, Senegal 5-0 Iraq final), unaffected
- [x] `/v2/games?sport=epl` → HTTP 200, 0 games (off-season), unaffected
- [x] Deploy run 28265428303 — all 32 steps success including PROBE F

## Sample game (live probe)

```
source: espn-wc  games: 15
sample: CIN @ PIT | venue: PNC Park | state: pre
espnEventId present: True
```

## Compliance

- **Rule 47**: Config + adapter change only. No editorial computation.
- **Rule 69**: Only `src/index.js` touched. One commit.
- **Rule 77**: All 32 CI steps verified via job step list before marking done.
- **Rule 87**: Self-completing. All done-condition probes executed in-session.
