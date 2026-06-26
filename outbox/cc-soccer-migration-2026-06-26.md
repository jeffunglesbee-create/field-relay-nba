# Club Soccer Migration — API-Sports → ESPN + BSD — 2026-06-26

## Commit

- `b8a825a` feat(soccer): migrate club soccer V2_LEAGUES from API-Sports to ESPN + BSD
- Deploy run: 28264307344 — conclusion: **success** at 20:46:56Z
- All 32 steps passed including PROBE F (BSD R2 pitch map)

## Changes (src/index.js only)

### CHANGE 1 — V2_LEAGUES: 11 club soccer entries replaced

Before: `sport: 'football'`, `leagueId: <apisports-id>`, season `'2025'` / `'2026'`
After: `sport: 'soccer'`, `espnLeague: <espn-slug>`, `bsdLeagueId: <id-or-null>`, season `'2026-27'` / `'2026'`

| Key | espnLeague | bsdLeagueId | season |
|-----|------------|-------------|--------|
| epl | eng.1 | 1 | 2026-27 |
| mls | usa.1 | 18 | 2026 |
| ucl | uefa.champions | 7 | 2026-27 |
| europa | uefa.europa | 8 | 2026-27 |
| conference | uefa.europa.conf | 8 | 2026-27 |
| eflchamp | eng.2 | 12 | 2026-27 |
| eflone | eng.3 | null (ESPN only) | 2026-27 |
| efltwo | eng.4 | null (ESPN only) | 2026-27 |
| laliga | esp.1 | 3 | 2026-27 |
| seriea | ita.1 | 4 | 2026-27 |
| bundesliga | ger.1 | 5 | 2026-27 |
| ligue1 | fra.1 | 6 | 2026-27 |

### CHANGE 2 — adaptESPNWCSoccer: sportKey param

```js
// before
function adaptESPNWCSoccer(ev) {
    ...sport: 'wc26',

// after
function adaptESPNWCSoccer(ev, sportKey = 'wc26') {
    ...sport: sportKey,

// call site
espnGames = (espnData.events || []).map(ev => adaptESPNWCSoccer(ev, sport));
```

### CHANGE 3 — BSD by-date: dynamic league_id

```js
// before
if (env.BSD_API_TOKEN) {
    `...league_id=27`

// after
if (env.BSD_API_TOKEN && cfg.bsdLeagueId) {
    `...league_id=${cfg.bsdLeagueId}`
```

eflone/efltwo (`bsdLeagueId: null`) skip BSD enrichment; `round` and `weather` degrade gracefully.

### CHANGE 4 — Comment update

`// Currently: wc26 only` → `// All soccer leagues (wc26 + 11 club leagues)`

## Done conditions

- [x] `node --check src/index.js` clean
- [x] `/v2/games?sport=mls` → `source: "espn-wc"` (not api-sports), 200 OK, 0 games
- [x] `/v2/games?sport=wc26` → 6 WC games live (Norway 1-3 France @ 82', Senegal 4-0 Iraq @ 79'), unaffected
- [x] `/v2/games?sport=epl` → 200 OK, 0 games (EPL season starts Aug — acceptable)
- [x] Deploy run 28264307344 — all 32 steps success including PROBE F

## Routing note

Tennis (atp/wta) uses `cfg.espnSource && cfg.sport === 'tennis'` gate at ~L2927 and early-returns before the `if (cfg.espnLeague)` soccer block at ~L2979. No collision.
WC26 (`espnLeague: 'fifa.world'`, `sport: 'football'`) follows the same ESPN path — no wc26 regression.

## Compliance

- **Rule 47**: Config change only. No editorial computation.
- **Rule 69**: Only `src/index.js` touched. One commit.
- **Rule 77**: Deploy step + all probes verified via CI job step list before marking done.
- **Rule 87**: Self-completing. All done-condition probes executed in-session.
