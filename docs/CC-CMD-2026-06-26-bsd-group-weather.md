# CC-CMD: BSD group_name + weather enrichment — gate fix
# Date: 2026-06-26
# Repo: field-relay-nba
# Scope: src/index.js — TWO LINES ONLY
# Rule 87: self-completing
# URGENT: MD3 final group stage in progress — last window to verify in production

## CONTEXT

BSD group_name + weather enrichment block exists at L3265 but has never fired.
Two-line bug: the gate uses cfg.bsdLeagueId which is undefined for wc26.

V2_LEAGUES wc26 has no bsdLeagueId field — only club soccer leagues do.
Result: entire enrichment block silently skipped for every WC26 request.

Confirmed 2026-06-26 via live probe:
  BSD /bsd/events/by-date?date=2026-06-26&league_id=27 → 26 group stage events
  group_name: "Group I", "Group J", "Group K", "Group L", "Group G", "Group H" ✅
  weather: {description: "rain", temperature_c: 22, wind_speed: 5.6} ✅ (pre-populated)
  Weather is present BEFORE kickoff — no live match required.

Tonight is the ONLY window: MD3 is the last group stage round.
After tonight, group_name becomes irrelevant until next tournament.

## PRE-BUILD PROBE

```bash
# Confirm the gate uses cfg.bsdLeagueId (the bug)
grep -n "BSD_API_TOKEN && cfg.bsdLeagueId" src/index.js
# Expected: 1 hit at L3272-ish

# Confirm cfg.bsdLeagueId is the URL variable too
grep -n "league_id=\${cfg.bsdLeagueId}" src/index.js
# Expected: 1 hit in same block

# Confirm wc26 has no bsdLeagueId in V2_LEAGUES
grep -A3 "'wc26'" src/index.js | grep bsdLeagueId
# Expected: no output
```

## CHANGE 1 — Fix gate condition

Find:
```
        if (env.BSD_API_TOKEN && cfg.bsdLeagueId) {
```

Replace with:
```
        if (env.BSD_API_TOKEN && sport === 'wc26') {
```

## CHANGE 2 — Fix URL league_id variable

Find:
```
                    `https://sports.bzzoiro.com/api/v2/events/?date=${date}&league_id=${cfg.bsdLeagueId}`,
```

Replace with:
```
                    `https://sports.bzzoiro.com/api/v2/events/?date=${date}&league_id=27`,
```

(27 is the WC2026 league_id — already hardcoded correctly in all other BSD WC26 routes)

## DONE CONDITIONS

1. node --check src/index.js passes

2. grep -c "sport === 'wc26'" src/index.js → at least 1 new hit in enrichment block

3. After deploy — probe live WC26 game in progress:
```bash
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=wc26" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
for g in d.get('games',[]):
    print(g.get('away',{}).get('abbr'),'@',g.get('home',{}).get('abbr'))
    print('  round:', repr(g.get('round','')))
    print('  weather:', g.get('weather'))
"
# Expected:
#   round: 'Group I' (not '')
#   weather: {'description': 'cloudy', 'temperature_c': 19, 'wind_speed': 15.1, 'code': 2}
# (or similar — values will match live BSD weather at venue)
```

4. Commit: "fix(wc26): BSD group_name + weather enrichment — gate was cfg.bsdLeagueId (undefined for wc26), fix to sport === 'wc26'"
