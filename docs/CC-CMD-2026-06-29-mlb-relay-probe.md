# CC-CMD — MLB Stats API Relay Probe

**Date:** 2026-06-29
**Repo:** jeffunglesbee-create/field-relay-nba (RELAY ONLY)
**Scope:** Add temporary probe endpoint, fetch real MLB Stats API data, remove probe
**Target time:** 15 min
**Rule 87:** Self-completing. Probe first. Remove probe after capture.

---

## ENVIRONMENT CONSTRAINTS

- `statsapi.mlb.com` is reachable from CF Workers (relay), NOT from CC egress
- Relay repo: `field-relay-nba` — NOT `jubilant-bassoon`
- Deploy via Wrangler / GitHub Actions on push to main
- After probe capture: REMOVE the endpoint immediately. Do not leave it deployed.

---

## DONE CONDITION

File `outbox/mlb-probe-raw-2026-06-29.json` committed to field-relay-nba containing:
- Full HTTP response from `statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-06-29&hydrate=broadcasts(all),linescore,venue,teams`
- First 2 games in full (not truncated)
- Top-level key inventory for game[0]
- Linescore keys, broadcast array, teams.home/away keys
- Status code from MLB Stats API

Also: The probe endpoint has been REMOVED from src/index.js after capture.

Confidence ≥ 95 required. Do not commit if API returned non-200 or zero games.

---

## PROBE BLOCK

```bash
git log -1 --oneline
# Confirm this is field-relay-nba, NOT jubilant-bassoon
basename $(git remote get-url origin)
# Expected: field-relay-nba

# Confirm relay source file
ls src/index.js

# Check if /mlb route already exists
grep -n "mlb\|MLB\|statsapi" src/index.js | head -20

# Check current V2_LEAGUES.mlb
grep -n "mlb" src/index.js | grep -i "league\|espn\|source" | head -10
```

---

## STEP 1: Add temporary probe endpoint to src/index.js

Find the `/health` or `/deploy/verify` route. Insert BEFORE it:

```javascript
// TEMPORARY PROBE — remove after source verification (2026-06-29)
if (pathname === '/mlb/probe-raw' && request.method === 'GET') {
  const date = new URL(request.url).searchParams.get('date') ||
    new Date().toISOString().split('T')[0];
  try {
    const url = `https://statsapi.mlb.com/api/v1/schedule` +
      `?sportId=1&date=${date}` +
      `&hydrate=broadcasts(all),linescore,venue,teams`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    });
    const data = await r.json();
    const games = data?.dates?.[0]?.games ?? [];
    return new Response(JSON.stringify({
      ok: true,
      date,
      statusCode: r.status,
      gameCount: games.length,
      games: games.slice(0, 2),
      game0_keys: games[0] ? Object.keys(games[0]) : [],
      game0_linescore_keys: games[0]?.linescore ? Object.keys(games[0].linescore) : [],
      game0_broadcasts: games[0]?.broadcasts ?? [],
      game0_teams_home_keys: games[0]?.teams?.home ? Object.keys(games[0].teams.home) : [],
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
// END TEMPORARY PROBE
```

---

## STEP 2: Deploy relay

```bash
node --check src/index.js
git add src/index.js
git commit -m "temp: /mlb/probe-raw — MLB Stats API source verification"
git push origin main
# Wait for deploy
sleep 45
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/deploy/verify
```

---

## STEP 3: Call probe and save full response

```bash
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/mlb/probe-raw?date=2026-06-29" \
  | python3 -m json.tool | tee /tmp/mlb-probe-raw.json

# Also print key summary
python3 << 'PY'
import json
with open("/tmp/mlb-probe-raw.json") as f:
    d = json.load(f)
print(f"Status: {d.get('statusCode')}")
print(f"Games: {d.get('gameCount')}")
print(f"game0 keys: {d.get('game0_keys')}")
print(f"linescore keys: {d.get('game0_linescore_keys')}")
print(f"teams.home keys: {d.get('game0_teams_home_keys')}")
print(f"broadcasts: {json.dumps(d.get('game0_broadcasts',[])[:3], indent=2)}")
if d.get('games'):
    g = d['games'][0]
    print(f"\nGame 1: {g.get('teams',{}).get('away',{}).get('team',{}).get('abbreviation','?')} @ "
          f"{g.get('teams',{}).get('home',{}).get('team',{}).get('abbreviation','?')}")
    print(f"  Score: {g.get('teams',{}).get('away',{}).get('score','?')}-{g.get('teams',{}).get('home',{}).get('score','?')}")
    print(f"  Status: {g.get('status',{}).get('detailedState','?')}")
    ls = g.get('linescore',{})
    print(f"  Inning: {ls.get('inningHalf','?')} {ls.get('currentInningOrdinal','?')} | Outs: {ls.get('outs','?')}")
PY
```

---

## STEP 4: Remove probe endpoint

```bash
# Delete the TEMPORARY PROBE block from src/index.js
grep -n "TEMPORARY PROBE\|END TEMPORARY PROBE" src/index.js
# Remove those lines (inclusive)

node --check src/index.js
git add src/index.js
git commit -m "temp(remove): /mlb/probe-raw removed — source verified"
git push origin main
```

---

## STEP 5: Save probe data to outbox and commit

```bash
mkdir -p outbox
cp /tmp/mlb-probe-raw.json outbox/mlb-probe-raw-2026-06-29.json
git add outbox/mlb-probe-raw-2026-06-29.json
git commit -m "docs(outbox): MLB Stats API raw probe 2026-06-29 [skip ci]"
git push origin main
```

---

## CONFIDENCE SCORING

| Factor | Points | Check |
|--------|--------|-------|
| MLB Stats API returned HTTP 200 | 40 | `statusCode == 200` |
| Games returned for today | 20 | `gameCount > 0` |
| game[0] has teams/linescore/broadcasts | 20 | All three keys present |
| Probe endpoint removed after capture | 10 | `grep "TEMPORARY PROBE" src/index.js` returns 0 |
| Full JSON saved to outbox | 10 | File exists |

Score < 95: do not commit outbox. Report what failed.

---

**Session: 2026-06-29 · RELAY ONLY · 15 min target · Confidence gate: 95**
