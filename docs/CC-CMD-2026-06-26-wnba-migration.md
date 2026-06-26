# CC-CMD: WNBA Migration — API-Sports basketball → ESPN scoreboard
# Date: 2026-06-26
# Repo: field-relay-nba
# Scope: src/index.js only
# Rule 87: self-completing

## CONTEXT

V2_LEAGUES['wnba'] currently routes to v1.basketball.api-sports.io (leagueId=13).
ESPN basketball/wnba returns 3 live games confirmed tonight.
WNBA was on ESPN BEFORE the May 30 V2 migration — proven path.

ESPN WNBA shape (confirmed 2026-06-26):
  status.type.name: STATUS_SCHEDULED | STATUS_IN_PROGRESS | STATUS_FINAL
  status.period: 0 (pre) | 1-4 (quarters) | 5+ (OT)
  status.displayClock: '7:24' live | '0.0' final/pre
  status.type.shortDetail: 'Q3 7:24' | 'Final' | '6/26 - 7:30 PM EDT'
  home.linescores: [{value: 38.0}, ...] per quarter
  venue.fullName: 'Mohegan Sun Arena'

The _espnSportPath fix (MLB migration) already handles espnSport:'basketball'
→ URL becomes sports/basketball/wnba/scoreboard correctly.

Naming adaptESPNBasketball() (not adaptESPNWNBA) so NBA migration can reuse
the same function with sportKey='nba'.

## PRE-BUILD PROBE

```bash
# Confirm ESPN WNBA returns live games
curl -s "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
events=d.get('events',[])
print(len(events),'events')
if events:
    comp=events[0].get('competitions',[{}])[0]
    teams=comp.get('competitors',[])
    h=next((t for t in teams if t.get('homeAway')=='home'),{})
    a=next((t for t in teams if t.get('homeAway')=='away'),{})
    print(a.get('team',{}).get('abbreviation'),'@',h.get('team',{}).get('abbreviation'))
    print('period:',comp.get('status',{}).get('period'))
    print('venue:',comp.get('venue',{}).get('fullName'))
"
# Expected: 3+ events, period=0 pre-game or 1-4 live

# Confirm current source
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=wnba" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('source:',d.get('source'),'games:',len(d.get('games',[])))"
# Expected: source=apisports
```

## CHANGE 1 — V2_LEAGUES: update wnba entry

Find:
```
    'wnba':         { sport: 'basketball', leagueId: 13,  season: '2026'      }, // [VERIFY leagueId]
```

Replace with:
```
    'wnba':         { sport: 'wnba', espnLeague: 'wnba', espnSport: 'basketball', season: '2026' },
```

## CHANGE 2 — handleV2Games: add basketball branch to adapter dispatch

Find:
```
            espnGames = (espnData.events || []).map(ev =>
                cfg.espnSport === 'baseball'
                    ? adaptESPNMLB(ev)
                    : adaptESPNWCSoccer(ev, sport)
            );
```

Replace with:
```
            espnGames = (espnData.events || []).map(ev =>
                cfg.espnSport === 'baseball'    ? adaptESPNMLB(ev)
                : cfg.espnSport === 'basketball' ? adaptESPNBasketball(ev, sport)
                : adaptESPNWCSoccer(ev, sport)
            );
```

## CHANGE 3 — add adaptESPNBasketball() function

Insert immediately BEFORE adaptESPNMLB():

```js
// Adapts ESPN basketball/wnba (or /nba) scoreboard event → standard V2 FieldGame shape.
// Named generically so NBA migration reuses the same function with sportKey='nba'.
// ESPN shape confirmed 2026-06-26 against WNBA scoreboard:
//   status.period: 0=pre, 1-4=Q1-Q4, 5+=OT
//   status.displayClock: '7:24' live | '0.0' pre/final
//   status.type.shortDetail: 'Q3 7:24' | 'Final' | '6/26 - 7:30 PM EDT'
//   competitors[i].linescores: [{value: 38.0}, ...] per quarter
//   venue.fullName: arena name (empty string if unavailable)
//   situation (live): {possession?} — minimal for WNBA
function adaptESPNBasketball(ev, sportKey = 'wnba') {
    const comp  = ev.competitions?.[0] || {};
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

    // Quarter/OT tracking
    const period = st.period || 0;
    const clock  = st.displayClock || '';
    const periodLabel = state === 'post' ? 'F'
                      : state === 'live'
                            ? (period > 4 ? `OT${period - 4 > 1 ? period - 4 : ''}` : `Q${period}`)
                      : 'NS';

    // Per-quarter linescores
    const ls = arr => (arr || []).map(l =>
        (typeof l === 'object' && l !== null ? l?.value : l) ?? null
    );

    // Situation (live only)
    const situation = state === 'live' ? {
        quarter:    period,
        clock,
        possession: sit.possession ?? null,
    } : null;

    return {
        id:          `espn:${ev.id}`,
        espnEventId: ev.id,
        sport:       sportKey,
        league:      sportKey === 'nba' ? 'NBA' : 'WNBA',
        state,
        start:       ev.date || '',
        home: {
            name:  home.team?.displayName  || '',
            abbr:  home.team?.abbreviation || '',
            score: parseInt(home.score) || 0,
        },
        away: {
            name:  away.team?.displayName  || '',
            abbr:  away.team?.abbreviation || '',
            score: parseInt(away.score) || 0,
        },
        periodNum:   period,
        periodLabel,
        clock,
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
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=wnba" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
games=d.get('games',[])
print('source:', d.get('source'))
print('games:', len(games))
if games:
    g=games[0]
    print('sample:', g.get('away',{}).get('abbr'),'@',g.get('home',{}).get('abbr'))
    print('venue:', g.get('venue'))
    print('espnEventId present:', bool(g.get('espnEventId')))
    print('sport field:', g.get('sport'))
"
```
Expected:
- source contains 'espn' (not 'apisports')
- games: 3+ (tonight's WNBA slate)
- venue populated (Mohegan Sun Arena, Wintrust Arena, etc)
- espnEventId: True — enables ESPN summary context builder for WNBA briefs
- sport: 'wnba'

3. /v2/games?sport=mlb — source still 'espn' (unchanged)
4. /v2/games?sport=wc26 — 6 WC games (unchanged)
5. Commit: "feat(wnba): migrate V2_LEAGUES WNBA from API-Sports to ESPN scoreboard"
