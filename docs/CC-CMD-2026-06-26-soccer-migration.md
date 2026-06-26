# CC-CMD: Club Soccer Migration — API-Sports → ESPN + BSD
# Date: 2026-06-26
# Repo: field-relay-nba
# Scope: src/index.js only
# Rule 87: self-completing
# Depends: /bsd/r2/read route (a322a7c) ✅ already live

## CONTEXT

V2_LEAGUES has 11 club soccer leagues pointing to API-Sports
(v3.football.api-sports.io). The WC26 entry already uses the ESPN
path (cfg.espnLeague branch in handleV2Games). Club soccer follows
the identical pattern. Four changes: V2_LEAGUES config,
adaptESPNWCSoccer sport param, BSD by-date league_id, comment.

## PRE-BUILD PROBE

```bash
for slug in eng.1 usa.1 uefa.champions uefa.europa eng.2 esp.1 ita.1 ger.1 fra.1; do
  count=$(curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/$slug/scoreboard" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('events',[])))")
  echo "$slug: $count events"
done
```

## CHANGE 1 — V2_LEAGUES: replace 11 soccer entries

Find this exact block:

```
    'epl':          { sport: 'football',   leagueId: 39,  season: '2025'      },
    'mls':          { sport: 'football',   leagueId: 253, season: '2026'      },
    'ucl':          { sport: 'football',   leagueId: 2,   season: '2025'      },
    'europa':       { sport: 'football',   leagueId: 3,   season: '2025'      }, // UEFA Europa League
    'conference':   { sport: 'football',   leagueId: 848, season: '2025'      }, // UEFA Conference League
    'eflchamp':     { sport: 'football',   leagueId: 40,  season: '2025'      }, // EFL Championship
    'eflone':       { sport: 'football',   leagueId: 41,  season: '2025'      }, // EFL League One
    'efltwo':       { sport: 'football',   leagueId: 42,  season: '2025'      }, // EFL League Two
    'laliga':       { sport: 'football',   leagueId: 140, season: '2025'      },
    'seriea':       { sport: 'football',   leagueId: 135, season: '2025'      },
    'bundesliga':   { sport: 'football',   leagueId: 78,  season: '2025'      },
    'ligue1':       { sport: 'football',   leagueId: 61,  season: '2025'      },
```

Replace with:

```
    // Club soccer — migrated June 26 2026: API-Sports → ESPN + BSD
    // espnLeague: ESPN scoreboard slug. bsdLeagueId: BSD analytics (null = ESPN only).
    // Season: '2026-27' for Aug-start leagues, '2026' for MLS calendar year.
    // eflone/efltwo have no BSD coverage — Phase 12 alerts excluded by LOWER_SOCCER.
    'epl':        { sport: 'soccer', espnLeague: 'eng.1',            bsdLeagueId: 1,    season: '2026-27' },
    'mls':        { sport: 'soccer', espnLeague: 'usa.1',            bsdLeagueId: 18,   season: '2026'    },
    'ucl':        { sport: 'soccer', espnLeague: 'uefa.champions',   bsdLeagueId: 7,    season: '2026-27' },
    'europa':     { sport: 'soccer', espnLeague: 'uefa.europa',      bsdLeagueId: 8,    season: '2026-27' },
    'conference': { sport: 'soccer', espnLeague: 'uefa.europa.conf', bsdLeagueId: 8,    season: '2026-27' }, // same BSD lid=8 as Europa
    'eflchamp':   { sport: 'soccer', espnLeague: 'eng.2',            bsdLeagueId: 12,   season: '2026-27' },
    'eflone':     { sport: 'soccer', espnLeague: 'eng.3',            bsdLeagueId: null, season: '2026-27' }, // ESPN only
    'efltwo':     { sport: 'soccer', espnLeague: 'eng.4',            bsdLeagueId: null, season: '2026-27' }, // ESPN only
    'laliga':     { sport: 'soccer', espnLeague: 'esp.1',            bsdLeagueId: 3,    season: '2026-27' },
    'seriea':     { sport: 'soccer', espnLeague: 'ita.1',            bsdLeagueId: 4,    season: '2026-27' },
    'bundesliga': { sport: 'soccer', espnLeague: 'ger.1',            bsdLeagueId: 5,    season: '2026-27' },
    'ligue1':     { sport: 'soccer', espnLeague: 'fra.1',            bsdLeagueId: 6,    season: '2026-27' },
```

## CHANGE 2 — adaptESPNWCSoccer: add sportKey param

Find:
```
function adaptESPNWCSoccer(ev) {
```
Replace with:
```
function adaptESPNWCSoccer(ev, sportKey = 'wc26') {
```

Find inside the function body:
```
        sport:       'wc26',
```
Replace with:
```
        sport:       sportKey,
```

Find the call site:
```
            espnGames = (espnData.events || []).map(ev => adaptESPNWCSoccer(ev));
```
Replace with:
```
            espnGames = (espnData.events || []).map(ev => adaptESPNWCSoccer(ev, sport));
```

## CHANGE 3 — BSD by-date: use cfg.bsdLeagueId, not hardcoded 27

Find:
```
        if (env.BSD_API_TOKEN) {
            try {
                const _bsdByDate = await fetch(
                    `https://sports.bzzoiro.com/api/v2/events/?date=${date}&league_id=27`,
```
Replace with:
```
        if (env.BSD_API_TOKEN && cfg.bsdLeagueId) {
            try {
                const _bsdByDate = await fetch(
                    `https://sports.bzzoiro.com/api/v2/events/?date=${date}&league_id=${cfg.bsdLeagueId}`,
```

## CHANGE 4 — Comment update (cosmetic)

Find:
```
    // Currently: wc26 only. Identical downstream behavior: BSD enrichment,
```
Replace with:
```
    // All soccer leagues (wc26 + 11 club leagues). Identical downstream behavior: BSD enrichment,
```

## DONE CONDITIONS

1. node --check src/index.js passes
2. After deploy:
   curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=mls" \
     | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('source','?'), len(d.get('games',[])),'games')"
   Expected: source field references 'espn', not 'api-sports'
3. curl .../v2/games?sport=wc26 still returns WC games (unaffected — WC uses same ESPN path)
4. curl .../v2/games?sport=epl returns HTTP 200, 0 games acceptable (season starts Aug)
5. Commit: "feat(soccer): migrate club soccer V2_LEAGUES from API-Sports to ESPN + BSD
