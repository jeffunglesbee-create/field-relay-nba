# CC-CMD: AFL Migration — API-Sports → ESPN australian-football/afl
# Date: 2026-06-26 (rewrites stale Squiggle version)
# Repo: field-relay-nba
# Scope: src/index.js only
# Rule 87: self-completing

## CONTEXT

Previous CC-CMD targeted Squiggle. ESPN confirmed better:
  - 7 AFL Round 16 events tonight ✅
  - Team abbreviations (HAW, CARL, COLL, BL) — Squiggle has none
  - espnEventId present — enables ESPN summary context builder
  - Per-quarter linescores confirmed: [23.0, 37.0, 27.0, 9.0]
  - Venues: MCG, Gabba, Marvel Stadium, Adelaide Oval, Optus Stadium
  - Shape identical to basketball — adaptESPNBasketball(ev, 'afl') works as-is

ESPN AFL shape confirmed 2026-06-26:
  status.type.name: STATUS_SCHEDULED | STATUS_IN_PROGRESS | STATUS_FINAL
  status.period: quarter (1-4, 5=OT)
  status.displayClock: '30:26' (AFL clock counts UP from 0:00)
  status.type.shortDetail: 'Q3 30:26' | 'Final' | '6/27 - 2:35 AM EDT'
  competitors[i].linescores: [{value: N}] per quarter
  competitors[i].team.abbreviation: 'HAW', 'CARL', 'GWS', etc.
  venue.fullName: 'MCG', 'Gabba', 'Marvel Stadium', etc.

TWO CHANGES ONLY — no new adapter, no new branch:
  1. V2_LEAGUES 'afl': add espnLeague + espnSport, remove leagueId
  2. Adapter dispatch: add 'australian-football' to basketball branch

_espnSportPath fix (MLB migration) already handles espnSport='australian-football'
→ URL: sports/australian-football/afl/scoreboard ✅ no change needed there.

Squiggle relay (/squiggle route) stays active for tips/power rankings —
these remain the unique analytics value Squiggle provides vs ESPN.

## PRE-BUILD PROBE

```bash
# Confirm ESPN AFL returns games
curl -s "https://site.api.espn.com/apis/site/v2/sports/australian-football/afl/scoreboard" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
events=d.get('events',[])
print(len(events),'events')
if events:
    comp=events[0]['competitions'][0]
    teams=comp['competitors']
    h=next(t for t in teams if t['homeAway']=='home')
    a=next(t for t in teams if t['homeAway']=='away')
    print(a['team']['abbreviation'],'@',h['team']['abbreviation'])
    print('venue:',comp.get('venue',{}).get('fullName'))
"
# Expected: 7 events, team abbreviations, venue names

# Confirm current source is api-sports
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=afl" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('source:', d.get('source'))"
# Expected: apisports
```

## CHANGE 1 — V2_LEAGUES: update afl entry

Find:
```
    // AFL Premiership (verified June 20 2026 via /apisports/afl/leagues — id:1,
    // season:2026 current:true). The api-sports AFL plan accepts only ?date=
    // (no league/season filter) on a ±1 day rolling window; the dispatch in
    // handleV2Games branches AFL to use ?date= only.
    'afl':          { sport: 'afl',        leagueId: 1,   season: 2026        },
```

Replace with:
```
    // AFL — migrated June 26 2026: API-Sports → ESPN australian-football/afl
    // ESPN confirmed: 7 events, team abbreviations, per-quarter linescores, venues.
    // adaptESPNBasketball(ev, 'afl') reused — same quarter-based shape as WNBA.
    // Squiggle relay (/squiggle route) stays active for tips + power rankings.
    'afl':          { sport: 'afl', espnLeague: 'afl', espnSport: 'australian-football', season: 2026 },
```

## CHANGE 2 — Adapter dispatch: add australian-football to basketball branch

Find:
```
                cfg.espnSport === 'baseball'    ? adaptESPNMLB(ev)
                : cfg.espnSport === 'basketball' ? adaptESPNBasketball(ev, sport)
                : adaptESPNWCSoccer(ev, sport)
```

Replace with:
```
                cfg.espnSport === 'baseball'                                      ? adaptESPNMLB(ev)
                : ['basketball','australian-football'].includes(cfg.espnSport)     ? adaptESPNBasketball(ev, sport)
                : adaptESPNWCSoccer(ev, sport)
```

## DONE CONDITIONS

1. node --check src/index.js passes

2. After deploy:
```bash
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=afl" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
games=d.get('games',[])
print('source:', d.get('source'))
print('games:', len(games))
if games:
    g=games[0]
    print('sample:', g.get('away',{}).get('abbr','?'),'@',g.get('home',{}).get('abbr','?'))
    print('venue:', g.get('venue','?'))
    print('espnEventId:', bool(g.get('espnEventId')))
    print('sport field:', g.get('sport','?'))
"
```
Expected:
- source: 'espn-wc' (not 'apisports')
- games: 5-7 (tonight's Round 16 slate)
- home/away abbr populated: HAW, CARL, COLL etc. (was empty with API-Sports)
- venue populated: MCG, Gabba etc.
- espnEventId: True
- sport: 'afl'

3. /v2/games?sport=wnba still 'espn-wc' (adaptESPNBasketball unchanged)
4. /v2/games?sport=wc26 still 6 WC games (soccer path unchanged)
5. Commit: "feat(afl): migrate V2_LEAGUES AFL from API-Sports to ESPN australian-football/afl"
