# CC-CMD: AFL Migration — API-Sports → Squiggle
# Date: 2026-06-26
# Repo: field-relay-nba
# Scope: src/index.js only
# Rule 87: self-completing

## CONTEXT

V2_LEAGUES['afl'] currently routes to v1.afl.api-sports.io via handleV2Games.
Known API-Sports AFL issues: rejects league/season filters, date-only queries only,
unreliable primary source (documented June 26 2026 Drive spec).

Squiggle (api.squiggle.com.au) is already in the relay as /squiggle relay route.
Squiggle confirmed live: 86 upcoming games, Round 16 tonight (Carlton vs West Coast).
This migration switches the V2_LEAGUES pipeline to call Squiggle directly server-side.

Different from all previous migrations — NOT espnLeague/espnSport pattern.
Squiggle has its own URL structure (?q= params), its own game shape, its own
date format (AEST local time, not UTC).

Squiggle shape confirmed 2026-06-26:
  Fields: hteam, ateam, hscore, ascore, hgoals, hbehinds, agoals, abehinds
          round, roundname, date (AEST), localtime, complete, timestr, venue, id
          is_final, is_grand_final, winner, winnerteamid, unixtime
  complete: 0=upcoming or live, 100=finished
  timestr: '' (pre) | 'Q3 12:45' (live) | 'Full Time' (post)
  date format: 'YYYY-MM-DD HH:MM:SS' in AEST (NOT UTC)

## PRE-BUILD PROBE

```bash
# 1. Confirm Squiggle returns AFL games today
TODAY=$(date -u +%Y-%m-%d)
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/squiggle?q=games;year=2026" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
games=d.get('games',[])
print(f'{len(games)} total games')
today=[g for g in games if (g.get(\"date\",\"\") or \"\").startswith(\"${TODAY}\")]
print(f'{len(today)} games today ({\"${TODAY}\"})')
if today: print(f'  sample: {today[0][\"hteam\"]} vs {today[0][\"ateam\"]} | {today[0][\"date\"]}')
"

# 2. Confirm current source is api-sports
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=afl" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('current source:', d.get('source'))"
```

## CHANGE 1 — V2_LEAGUES: add squiggleSource flag

Find:
```
    'afl':          { sport: 'afl',        leagueId: 1,   season: 2026        },
```

Replace with:
```
    // AFL — migrated June 26 2026: API-Sports → Squiggle (api.squiggle.com.au)
    // API-Sports AFL had known issues (rejected league/season filters, date-only).
    // squiggleSource: true triggers the Squiggle branch in handleV2Games.
    // date field in Squiggle is AEST local time — filter matches Australian calendar day.
    'afl':          { sport: 'afl', squiggleSource: true, season: 2026 },
```

## CHANGE 2 — add adaptSquiggleAFL() function

Insert immediately BEFORE function adaptAFL() (the old API-Sports AFL adapter, keep it):

```js
// Adapts Squiggle API game object → standard V2 FieldGame shape.
// Squiggle shape confirmed 2026-06-26 (api.squiggle.com.au).
// complete: 0=not started or live, 100=finished.
// timestr: '' pre-game | 'Q3 12:45' live | 'Full Time' post-game.
// date field is AEST local time (not UTC) — Australian calendar day.
// No abbreviation field in Squiggle — abbr left as '' (same as old adaptAFL).
function adaptSquiggleAFL(g) {
    // State detection: timestr with quarter/halftime signals live
    const ts       = String(g.timestr || '').trim();
    const isLive   = g.complete < 100 && /^(Q[1-4]|HT|OT|ET)/i.test(ts);
    const state    = g.complete >= 100 ? 'post'
                   : isLive            ? 'live'
                   : 'pre';

    // Period from timestr: 'Q3 12:45' → periodNum=3, periodLabel='Q3'
    const qMatch  = ts.match(/^(Q([1-4])|HT|OT)/i);
    const periodNum   = qMatch?.[2] ? parseInt(qMatch[2]) : (state === 'post' ? 4 : 0);
    const periodLabel = state === 'post' ? 'F'
                      : qMatch ? qMatch[1].toUpperCase()
                      : 'NS';

    return {
        id:          `squiggle:${g.id}`,
        sport:       'afl',
        league:      g.roundname || `Round ${g.round}`,
        state,
        start:       g.date || '',
        home: {
            name:  g.hteam || '',
            abbr:  '',           // Squiggle has no abbr field
            score: g.hscore ?? null,
        },
        away: {
            name:  g.ateam || '',
            abbr:  '',
            score: g.ascore ?? null,
        },
        periodNum,
        periodLabel,
        clock:  ts,
        venue:  g.venue  || '',
        situation: isLive ? {
            quarter:  periodNum,
            timestr:  ts,
            complete: g.complete || 0,
        } : null,
        // Australian rules scoring (goals.behinds)
        homeGoals:   g.hgoals   ?? null,
        homeBehinds: g.hbehinds ?? null,
        awayGoals:   g.agoals   ?? null,
        awayBehinds: g.abehinds ?? null,
        squiggleId:  g.id,
        round:       g.round    || null,
        isFinal:     !!g.is_final,
        isGrandFinal:!!g.is_grand_final,
    };
}
```

## CHANGE 3 — handleV2Games: add Squiggle branch

Find the cfg.espnLeague branch opening:
```
    // For sports with espnLeague configured, bypass API-Sports entirely.
```

Insert the Squiggle branch BEFORE the espnLeague block (so it fires first for AFL):

```js
    // ── Squiggle branch (AFL) ─────────────────────────────────────────────
    // api.squiggle.com.au — free, no key, server-side fetch bypasses CORS.
    // Replaces v1.afl.api-sports.io which had known league/season filter issues.
    // date field in Squiggle = AEST local time → filter on Australian calendar day.
    if (cfg.squiggleSource) {
        const year = cfg.season || new Date().getUTCFullYear();
        const squiggleUrl = `https://api.squiggle.com.au/?q=games;year=${year}`;
        let squiggleGames = [];
        try {
            const _sr = await fetch(squiggleUrl, {
                headers: {
                    'User-Agent': 'FIELD/1.0 field-relay-nba Cloudflare-Worker',
                    'Accept': 'application/json',
                },
                cf: { cacheTtl: 60, cacheEverything: true, cacheKey: squiggleUrl },
            });
            if (!_sr.ok) throw new Error(`Squiggle upstream ${_sr.status}`);
            const _sd = await _sr.json();
            // Filter to today's AFL date (AEST) — date format: 'YYYY-MM-DD HH:MM:SS'
            squiggleGames = (_sd.games || [])
                .filter(g => (g.date || '').startsWith(date))
                .map(adaptSquiggleAFL);
        } catch (_e) {
            return new Response(
                JSON.stringify({ error: _e.message, sport, date, source: 'squiggle' }),
                { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }
        return new Response(
            JSON.stringify({ sport, date, games: squiggleGames, source: 'squiggle' }),
            { headers: { 'Content-Type': 'application/json',
                         'Cache-Control': 'public, max-age=30', ...CORS } }
        );
    }
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
    print('sample:', g.get('away',{}).get('name'),'vs',g.get('home',{}).get('name'))
    print('venue:', g.get('venue'))
    print('round:', g.get('round'))
    print('state:', g.get('state'))
    print('squiggleId:', g.get('squiggleId'))
"
```
Expected:
- source: 'squiggle' (not 'apisports')
- games: N (tonight's Round 16 AFL games)
- venue populated (MCG, GMHBA Stadium, etc)
- squiggleId present

3. /v2/games?sport=wnba — source still 'espn-wc' (unchanged)
4. /v2/games?sport=wc26 — 6 WC games (unchanged)
5. Commit: "feat(afl): migrate V2_LEAGUES AFL from API-Sports to Squiggle"
