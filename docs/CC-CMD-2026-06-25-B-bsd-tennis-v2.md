# CC-CMD B: BSD Tennis V2 + ESPN ATP/WTA Scoreboards
**Date:** 2026-06-25 · **Repo:** field-relay-nba · **Sequence:** After CC-CMD-A. · **Rule 87:** Self-completing.

## WHAT THIS ADDS

Wire ATP/WTA tennis into the V2 games pattern so the client gets tennis
via `/v2/games?sport=atp` and `/v2/games?sport=wta`.

Current state: no ATP/WTA in V2_LEAGUES. The May session built an unofficial
ATP relay. Wimbledon draw is June 27 (2 days). Sports Pack already active.

Data sources:
- Scores/schedule: ESPN unofficial (site.api.espn.com/tennis/atp + /tennis/wta)
  — confirmed returning live data this session
- Match detail / predictions: BSD tennis REST API (/bsd/tennis/matches/*)
- Relay routes for BSD tennis: already shipped in CC-CMD-A

ESPN tennis scoreboard returns tournament-level events with match arrays nested.
Response shape differs from other sports (no single event→competition pattern).

## PROBE BLOCK

```bash
cd /home/claude/field-relay-nba

# 1. Confirm CC-CMD-A shipped (BSD routes present)
grep -c 'pathname.startsWith.*bsd' src/index.js
# Expected: ≥ 1

# 2. Confirm ATP/WTA NOT in V2_LEAGUES yet
grep -n "'atp'\|'wta'" src/index.js | head -5
# Expected: 0 lines

# 3. Find V2_LEAGUES insertion point
grep -n "V2_LEAGUES = {" src/index.js
# Note the line number — add atp/wta entries after 'afl' entry

# 4. Find handleV2Games function
grep -n "function handleV2Games\|handleV2Games" src/index.js | head -5
# Note line range

# 5. Live ESPN tennis probe (verify schema)
curl -s "https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); e=d['events'][0]; print(json.dumps({k:e[k] for k in list(e.keys())[:8]}, indent=2))"
# Expected: tournament name, id, competitions array with individual matches
```

## TASK 1 — Add ATP/WTA to V2_LEAGUES

After the `'afl'` entry in V2_LEAGUES (currently last entry):

```javascript
    'atp':  { sport: 'tennis', espnSource: true, espnLeague: 'atp',
              description: 'ATP Tour — BSD Sports Pack active' },
    'wta':  { sport: 'tennis', espnSource: true, espnLeague: 'wta',
              description: 'WTA Tour — BSD Sports Pack active' },
```

## TASK 2 — Add tennis branch in handleV2Games

Find the `espnSource: true` branch in `handleV2Games` (the branch that handles
`pga` golf via ESPN). Add a parallel tennis branch:

```javascript
// Tennis: ESPN returns tournament-level events with nested competitions (matches).
// Shape: event.id = tournament slug (e.g. "444-2026"), event.name = tournament name,
// event.competitions[] = individual matches. Flatten to FIELD game objects.
if (league.sport === 'tennis') {
  const espnLeague = league.espnLeague; // 'atp' or 'wta'
  const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/tennis/${espnLeague}/scoreboard`;
  const r = await fetch(espnUrl, { headers: { 'User-Agent': 'FIELD/1.0' } });
  if (!r.ok) return new Response(JSON.stringify({ sport, date, games: [], error: `ESPN tennis ${r.status}` }),
    { headers: { 'Content-Type': 'application/json', ...CORS } });
  const d = await r.json();
  const games = [];
  for (const tournament of (d.events || [])) {
    const tournamentName = tournament.name || 'Tennis';
    for (const match of (tournament.competitions || [])) {
      const competitors = match.competitors || [];
      const home = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};
      const away = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};
      const status = match.status?.type?.description || 'scheduled';
      const score = `${home.score ?? '-'} - ${away.score ?? '-'}`;
      // BSD match ID — try to find from match name / external IDs
      const bsdMatchId = match.id || null;
      games.push({
        id: `tennis:${match.id}`,
        sport: sport, // 'atp' or 'wta'
        home: home.team?.displayName || home.team?.name || 'TBD',
        away: away.team?.displayName || away.team?.name || 'TBD',
        homeAbbr: home.team?.abbreviation,
        awayAbbr: away.team?.abbreviation,
        score,
        homeScore: home.score,
        awayScore: away.score,
        status,
        isFinal: match.status?.type?.completed === true,
        isLive: match.status?.type?.state === 'in',
        date,
        tournament: tournamentName,
        tournamentId: tournament.id,
        round: match.notes?.[0]?.headline || match.round?.displayName,
        broadcasts: (match.broadcasts || []).map(b => b.names || []).flat(),
        bsdMatchId,
        espnEventId: match.id,
        // Detailed set scores from competitions array
        sets: (home.linescores || []).map((s, i) => ({
          home: s.value,
          away: (away.linescores || [])[i]?.value,
        })),
      });
    }
  }
  const payload = JSON.stringify({ sport, date, games, source: 'espn-tennis', tournament: d.events?.[0]?.name });
  return new Response(payload, { headers: { 'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=25', ...CORS } });
}
```

## TASK 3 — Add ESPN tennis to espn_summary context builder

In context-assembler.js, update CONTEXT_SOURCES `espn_summary` sports array
to include `'atp'` and `'wta'`:

OLD:
```javascript
{ id: 'espn_summary', priority: 3, budget: 200, builder: buildESPNSummaryContext,
  sports: ['mlb', 'nba', 'wnba', 'nhl', 'wc26', 'soccer'] },
```

NEW:
```javascript
{ id: 'espn_summary', priority: 3, budget: 200, builder: buildESPNSummaryContext,
  sports: ['mlb', 'nba', 'wnba', 'nhl', 'wc26', 'soccer', 'atp', 'wta'] },
```

## TASK 4 — Smoke assertions

```javascript
assert('V2_LEAGUES has atp', src.includes("'atp':") && src.includes("espnLeague: 'atp'"));
assert('V2_LEAGUES has wta', src.includes("'wta':") && src.includes("espnLeague: 'wta'"));
assert('tennis branch in handleV2Games', src.includes("league.sport === 'tennis'"));
assert('tennis game flatten', src.includes("tournament.competitions"));
```

## DONE CONDITIONS

```bash
# 1. Smoke passes
node smoke.js 2>&1 | tail -3

# 2. ATP/WTA in V2_LEAGUES
grep "'atp'\|'wta'" src/index.js | grep -c espnLeague
# Expected: 2

# 3. Live probe
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=atp" | jq '.games | length'
# Expected: integer ≥ 0 (tournament matches)

curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=wta" | jq '.games | length'

# 4. diff check — relay + context-assembler only
git diff --stat
```

## COMMIT

```bash
git add src/index.js src/context-assembler.js
git commit -m "feat(tennis): wire ATP/WTA via ESPN scoreboard + V2_LEAGUES + espn_summary context"
git push origin main
```
