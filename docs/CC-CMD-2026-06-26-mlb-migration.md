# CC-CMD: MLB Migration — API-Sports baseball → ESPN scoreboard
# Date: 2026-06-26
# Repo: field-relay-nba
# Scope: src/index.js only
# Rule 87: self-completing

## CONTEXT

V2_LEAGUES['mlb'] currently routes to v1.baseball.api-sports.io (leagueId: 1).
ESPN baseball/mlb scoreboard returns 15 games confirmed live.
Existing /mlb-stats relay routes (statsapi.mlb.com) stay unchanged —
they provide deep game data (GUMBO, probable pitchers, WP, pace) and
are not replaced by this migration.

The cfg.espnLeague branch in handleV2Games hardcodes 'soccer' in the
URL — MLB needs espnSport: 'baseball' to override this.

## PRE-BUILD PROBE

```bash
# Confirm ESPN MLB returns games
curl -s "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('events',[])), 'events')"
# Expected: 10+ events (there are games today)

# Confirm current V2 MLB source
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=mlb" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('source:', d.get('source'))"
# Expected: source contains 'apisports'
```

## CHANGE 1 — V2_LEAGUES: update mlb entry

Find:
```
    'mlb':          { sport: 'baseball',   leagueId: 1,   season: '2026'      },
```

Replace with:
```
    'mlb':        { sport: 'mlb', espnLeague: 'mlb', espnSport: 'baseball', season: '2026' },
```

## CHANGE 2 — handleV2Games: support espnSport in URL construction

Find:
```
        const espnUrl  = `https://site.api.espn.com/apis/site/v2/sports/soccer/${cfg.espnLeague}/scoreboard?dates=${espnDate}`;
```

Replace with:
```
        const _espnSportPath = cfg.espnSport || 'soccer';
        const espnUrl  = `https://site.api.espn.com/apis/site/v2/sports/${_espnSportPath}/${cfg.espnLeague}/scoreboard?dates=${espnDate}`;
```

## CHANGE 3 — handleV2Games: route to adaptESPNMLB for baseball

Find:
```
            espnGames = (espnData.events || []).map(ev => adaptESPNWCSoccer(ev, sport));
```

Replace with:
```
            espnGames = (espnData.events || []).map(ev =>
                cfg.espnSport === 'baseball'
                    ? adaptESPNMLB(ev)
                    : adaptESPNWCSoccer(ev, sport)
            );
```

## CHANGE 4 — add adaptESPNMLB() function

Insert immediately BEFORE the adaptESPNWCSoccer function definition:

```js
// Adapts ESPN baseball/mlb scoreboard event → standard V2 FieldGame shape.
// ESPN shape confirmed 2026-06-26:
//   status.type.name: STATUS_SCHEDULED | STATUS_IN_PROGRESS | STATUS_FINAL
//   status.period: inning number (1-9+)
//   status.type.shortDetail: 'Top 5th - 2 Outs' | 'Final' | '6/26 - 6:40 PM EDT'
//   competitors[i].linescores: [{value: N}, ...] per-inning runs
//   competitors[i].team.abbreviation / displayName / score
//   venue.fullName: stadium name
//   situation (live): {balls, strikes, outs, onFirst, onSecond, onThird}
function adaptESPNMLB(ev) {
    const comp = ev.competitions?.[0] || {};
    const teams = comp.competitors || [];
    const home  = teams.find(t => t.homeAway === 'home') || {};
    const away  = teams.find(t => t.homeAway === 'away') || {};
    const st    = comp.status || {};
    const stt   = st.type?.name || '';
    const sit   = comp.situation || {};

    // State
    const state = stt === 'STATUS_FINAL'       ? 'post'
                : stt === 'STATUS_IN_PROGRESS' ? 'live'
                : 'pre';

    // Inning + half from shortDetail: 'Top 5th - 2 Outs', 'Bot 7th - 1 Out'
    const inningNum  = st.period || 1;
    const detail     = st.type?.shortDetail || '';
    const isTop      = /^top/i.test(detail);
    const outsMatch  = detail.match(/(\d)\s+out/i);
    const outs       = outsMatch ? parseInt(outsMatch[1]) : null;
    const halfLabel  = state === 'live' ? (isTop ? 'T' : 'B') : '';
    const periodLabel = state === 'post' ? 'F'
                      : state === 'live' ? `${halfLabel}${inningNum}`
                      : 'NS';

    // Per-inning linescores
    const ls = arr => (arr || []).map(l => (typeof l === 'object' ? l?.value : l) ?? null);

    // Situation (live only)
    const situation = state === 'live' ? {
        inning:   inningNum,
        isTop,
        outs,
        balls:    sit.balls   ?? null,
        strikes:  sit.strikes ?? null,
        onFirst:  sit.onFirst  ?? false,
        onSecond: sit.onSecond ?? false,
        onThird:  sit.onThird  ?? false,
    } : null;

    return {
        id:          `espn:${ev.id}`,
        espnEventId: ev.id,
        sport:       'mlb',
        league:      'MLB',
        state,
        start:       ev.date || '',
        home: {
            name:  home.team?.displayName   || '',
            abbr:  home.team?.abbreviation  || '',
            score: parseInt(home.score) || 0,
        },
        away: {
            name:  away.team?.displayName   || '',
            abbr:  away.team?.abbreviation  || '',
            score: parseInt(away.score) || 0,
        },
        periodNum:   inningNum,
        periodLabel,
        clock:       st.displayClock || '',
        venue:       comp.venue?.fullName || '',
        situation,
        linescores: {
            home: ls(home.linescores),
            away: ls(away.linescores),
        },
    };
}
```

## DONE CONDITIONS

1. node --check src/index.js passes
2. After deploy:

```bash
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=mlb" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
games=d.get('games',[])
print('source:', d.get('source'))
print('games:', len(games))
if games:
    g=games[0]
    print('sample:', g.get('away',{}).get('abbr'),'@',g.get('home',{}).get('abbr'),
          '| venue:', g.get('venue'), '| state:', g.get('state'))
    print('espnEventId present:', bool(g.get('espnEventId')))
"
```

Expected:
- source: 'espn-wc' (shares the same source label as soccer ESPN path)
- games: 10+ (there are games today)
- venue: populated (PNC Park etc) — was empty with API-Sports
- espnEventId: present — enables ESPN summary context builder downstream

3. /v2/games?sport=wc26 still returns WC games (soccer path unaffected)
4. /v2/games?sport=epl still returns ESPN soccer (unchanged)
5. Commit: "feat(mlb): migrate V2_LEAGUES MLB from API-Sports to ESPN scoreboard"
