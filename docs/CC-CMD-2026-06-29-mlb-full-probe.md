# CC-CMD — MLB Stats API Full Endpoint Probe

**Date:** 2026-06-29
**Repo:** jeffunglesbee-create/field-relay-nba (RELAY ONLY)
**Scope:** Probe every MLB Stats API endpoint FIELD is supposed to consume
**Why:** Schedule probe confirmed 13 games + field shapes. This probes the
         other 80% of MLB Stats API that FIELD docs describe but hasn't verified.
**Target time:** 25 min
**Rule 87:** Self-completing. Report real data only. Never invent.

---

## CONTEXT FROM DRIVE DOCS

Three Drive docs define what MLB Stats API should provide for FIELD:

**May 16 2026 — MLB Stats API Adapter + Broadcast Chip Resolver**
- Schedule with broadcasts (hydrate=broadcasts(all),team,linescore)
- Live game feed (/api/v1.1/game/{gamePk}/feed/live) — GUMBO
- Standings (leagueId=103,104)
- Status code mapping (S/I/F/DR → pregame/live/final/postponed)
- Broadcast chip mapping (Apple TV+ → MLB_APPLE, FOX → MLB_FOX, etc.)
- Peacock time resolution (Leadoff vs SNB)

**May 26 2026 — Baseball Savant + MLB Stats API Data Landscape**
- gameDurationMinutes in GUMBO feed — PACE badge
- gamePace endpoint — league average pace back to 1999
- Player season stats — Milestone Proximity badge
- Standings with magicNumber — CLINCH WATCH badge
- Statcast CSV — win probability delta per pitch
- Pitch Tempo leaderboard — pitcher pace
- ABS Challenges (NEW 2026) — automated ball-strike
- Sprint Speed, Exit Velocity, Enhanced Game Scores

**June 26 2026 — MLB Data Source Expansion**
- Complete endpoint map (game, schedule, standings, people, transactions, umpires, stats, reference)
- v1.1 preferred for live feed
- diffPatch for efficient polling
- Weather from GUMBO (gameData.weather)
- Win probability per play (/game/{gamePk}/winProbability)
- Transactions for journalism ("X came off IL yesterday")
- Umpire assignments for ABS context

---

## ENVIRONMENT CONSTRAINTS

- `statsapi.mlb.com` reachable from CF Workers (relay), NOT from CC
- Deploy temp probe endpoint → call from CC → remove → save to outbox
- Prior schedule probe established pattern: add endpoint, deploy, call, remove
- Use a real gamePk from today's schedule (824822 confirmed from prior probe)

---

## DONE CONDITION

File `outbox/mlb-full-probe-2026-06-29.json` committed to field-relay-nba containing
probe results for every endpoint category. Confidence ≥ 95.

---

## PROBE BLOCK

```bash
git log -1 --oneline
basename $(git remote get-url origin)
# Expected: field-relay-nba

# Confirm prior schedule probe exists (need gamePk from it)
ls outbox/mlb-probe-raw-2026-06-29.json
```

---

## STEP 1: Add comprehensive probe endpoint

Insert temporary probe. Uses gamePk from today's schedule.

```javascript
// TEMPORARY PROBE — MLB Stats API full endpoint audit (2026-06-29)
// Remove after capture.
if (pathname === '/mlb/full-probe' && request.method === 'GET') {
  const BASE = 'https://statsapi.mlb.com/api/v1';
  const HEADERS = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };
  const results = {};

  async function probe(label, url, extract) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      const status = r.status;
      if (status !== 200) {
        results[label] = { status, ok: false, error: `HTTP ${status}` };
        return;
      }
      const data = await r.json();
      const extracted = extract ? extract(data) : null;
      results[label] = {
        status,
        ok: true,
        responseBytes: JSON.stringify(data).length,
        ...(extracted || {}),
      };
    } catch (e) {
      results[label] = { ok: false, error: e.message };
    }
  }

  // Get a real gamePk from today
  const today = new Date().toISOString().split('T')[0];
  let gamePk = null;
  await probe('schedule', `${BASE}/schedule?sportId=1&date=${today}&hydrate=linescore`, d => {
    const games = d?.dates?.[0]?.games ?? [];
    gamePk = games[0]?.gamePk || null;
    return { date: today, gameCount: games.length, gamePk };
  });

  // If no games today (e.g., All-Star break), use yesterday
  if (!gamePk) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    await probe('schedule_yesterday', `${BASE}/schedule?sportId=1&date=${yesterday}&hydrate=linescore`, d => {
      const games = d?.dates?.[0]?.games ?? [];
      gamePk = games[0]?.gamePk || null;
      return { date: yesterday, gameCount: games.length, gamePk };
    });
  }

  if (gamePk) {
    // ── GAME ENDPOINTS (per gamePk) ──────────────────────────────

    await probe('game_feed_live', `${BASE.replace('v1','v1.1')}/game/${gamePk}/feed/live`, d => ({
      topKeys: Object.keys(d || {}),
      gameData_keys: Object.keys(d?.gameData || {}),
      liveData_keys: Object.keys(d?.liveData || {}),
      weather: d?.gameData?.weather || null,
      venue: d?.gameData?.venue?.name || null,
      probablePitchers: d?.gameData?.probablePitchers || null,
      status: d?.gameData?.status?.abstractGameState || null,
      gameDurationMinutes: d?.gameData?.gameInfo?.gameDurationMinutes || null,
      flags: d?.gameData?.flags || null,
      currentPlay_keys: Object.keys(d?.liveData?.plays?.currentPlay || {}),
      allPlays_count: (d?.liveData?.plays?.allPlays || []).length,
      scoringPlays_count: (d?.liveData?.plays?.scoringPlays || []).length,
      boxscore_away_keys: Object.keys(d?.liveData?.boxscore?.teams?.away || {}),
      decisions: d?.liveData?.decisions || null,
      leaders: d?.liveData?.leaders ? Object.keys(d.liveData.leaders) : null,
    }));

    await probe('game_boxscore', `${BASE}/game/${gamePk}/boxscore`, d => ({
      teams_keys: Object.keys(d?.teams || {}),
      away_teamStats_keys: Object.keys(d?.teams?.away?.teamStats || {}),
      away_players_count: Object.keys(d?.teams?.away?.players || {}).length,
    }));

    await probe('game_linescore', `${BASE}/game/${gamePk}/linescore`, d => ({
      keys: Object.keys(d || {}),
      currentInning: d?.currentInning || null,
      innings_count: (d?.innings || []).length,
    }));

    await probe('game_winProbability', `${BASE}/game/${gamePk}/winProbability`, d => ({
      isArray: Array.isArray(d),
      count: Array.isArray(d) ? d.length : 0,
      sample: Array.isArray(d) && d.length > 0 ? Object.keys(d[0]) : [],
    }));

    await probe('game_playByPlay', `${BASE}/game/${gamePk}/playByPlay`, d => ({
      allPlays_count: (d?.allPlays || []).length,
      play0_keys: d?.allPlays?.[0] ? Object.keys(d.allPlays[0]) : [],
    }));

    await probe('game_content', `${BASE}/game/${gamePk}/content`, d => ({
      keys: Object.keys(d || {}),
      highlights_count: (d?.highlights?.items || []).length,
    }));

    await probe('game_decisions', `${BASE}/game/${gamePk}/decisions`, d => ({
      keys: Object.keys(d || {}),
    }));

    await probe('game_contextMetrics', `${BASE}/game/${gamePk}/contextMetrics`, d => ({
      isArray: Array.isArray(d),
      count: Array.isArray(d) ? d.length : 0,
    }));
  }

  // ── STANDINGS ────────────────────────────────────────────────────

  await probe('standings', `${BASE}/standings?leagueId=103,104&season=2026&standingsTypes=regularSeason`, d => {
    const rec = d?.records?.[0]?.teamRecords?.[0];
    return {
      divisions: (d?.records || []).length,
      team0_keys: rec ? Object.keys(rec) : [],
      hasMagicNumber: rec ? 'magicNumber' in rec : false,
      hasClinched: rec ? 'clinched' in rec : false,
      hasWildCardGamesBack: rec ? 'wildCardGamesBack' in rec : false,
      hasStreak: rec ? 'streak' in rec : false,
      sample: rec ? {
        name: rec?.team?.name,
        wins: rec?.wins,
        losses: rec?.losses,
        pct: rec?.leagueRecord?.pct,
        divisionRank: rec?.divisionRank,
      } : null,
    };
  });

  // ── TRANSACTIONS ─────────────────────────────────────────────────

  await probe('transactions', `${BASE}/transactions?startDate=${today}&endDate=${today}&sportId=1`, d => ({
    count: (d?.transactions || []).length,
    transaction0_keys: d?.transactions?.[0] ? Object.keys(d.transactions[0]) : [],
    types: [...new Set((d?.transactions || []).map(t => t.typeDesc))].slice(0, 10),
  }));

  // ── UMPIRES ──────────────────────────────────────────────────────

  await probe('umpires', `${BASE}/jobs?jobType=UMP&date=${today}`, d => ({
    count: (d?.roster || d?.jobs || []).length,
    keys: Object.keys(d || {}),
  }));

  // ── GAME PACE ────────────────────────────────────────────────────

  await probe('gamePace', `${BASE}/gamePace?sportId=1&season=2026`, d => ({
    keys: Object.keys(d || {}),
    sports_count: (d?.sports || []).length,
    sport0_keys: d?.sports?.[0] ? Object.keys(d.sports[0]) : [],
  }));

  // ── STAT LEADERS ─────────────────────────────────────────────────

  await probe('statLeaders_HR', `${BASE}/stats/leaders?leaderCategories=homeRuns&sportId=1&season=2026&limit=3`, d => {
    const cat = d?.leagueLeaders?.[0];
    return {
      category: cat?.leaderCategory || null,
      leaders_count: (cat?.leaders || []).length,
      leader0: cat?.leaders?.[0] ? {
        name: cat.leaders[0].person?.fullName,
        value: cat.leaders[0].value,
        team: cat.leaders[0].team?.name,
      } : null,
    };
  });

  // ── SEASON INFO ──────────────────────────────────────────────────

  await probe('seasons', `${BASE}/seasons/2026?sportId=1`, d => ({
    keys: Object.keys(d?.seasons?.[0] || d || {}),
  }));

  // ── SUMMARY ──────────────────────────────────────────────────────

  const summary = {
    probeDate: today,
    capturedAt: new Date().toISOString(),
    gamePkUsed: gamePk,
    endpointsProbed: Object.keys(results).length,
    endpointsOk: Object.values(results).filter(r => r.ok).length,
    endpointsFailed: Object.values(results).filter(r => !r.ok).length,
    results,
  };

  return new Response(JSON.stringify(summary, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
// END TEMPORARY PROBE — MLB full endpoint audit
```

---

## STEP 2: Deploy, call, capture

```bash
node --check src/index.js
git add src/index.js
git commit -m "temp: /mlb/full-probe — full MLB Stats API endpoint audit"
git push origin main
sleep 50
```

```bash
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/mlb/full-probe" \
  | python3 -m json.tool | tee /tmp/mlb-full-probe.json

# Summary
python3 << 'PY'
import json
with open("/tmp/mlb-full-probe.json") as f:
    d = json.load(f)
print(f"Probed: {d['endpointsProbed']} endpoints")
print(f"OK: {d['endpointsOk']}")
print(f"Failed: {d['endpointsFailed']}")
print(f"gamePk: {d['gamePkUsed']}")
print()
for label, r in d['results'].items():
    status = "✅" if r.get('ok') else "❌"
    size = r.get('responseBytes','?')
    extra = ""
    if 'gameCount' in r: extra = f" ({r['gameCount']} games)"
    if 'weather' in r and r['weather']: extra = f" (weather: {r['weather']})"
    if 'count' in r: extra = f" ({r['count']} items)"
    if 'divisions' in r: extra = f" ({r['divisions']} divisions)"
    if 'leader0' in r and r['leader0']: extra = f" (#{1}: {r['leader0']['name']} {r['leader0']['value']})"
    if 'gameDurationMinutes' in r: extra += f" duration={r['gameDurationMinutes']}"
    if 'allPlays_count' in r: extra += f" plays={r['allPlays_count']}"
    print(f"  {status} {label:25} {size:>8} bytes{extra}")
PY
```

---

## STEP 3: Remove probe endpoint

```bash
grep -n "TEMPORARY PROBE\|END TEMPORARY PROBE" src/index.js
# Remove those lines (inclusive)
node --check src/index.js
git add src/index.js
git commit -m "temp(remove): /mlb/full-probe removed — audit complete"
git push origin main
```

---

## STEP 4: Save to outbox and commit

```bash
mkdir -p outbox
cp /tmp/mlb-full-probe.json outbox/mlb-full-probe-2026-06-29.json
git add outbox/mlb-full-probe-2026-06-29.json
git commit -m "docs(outbox): MLB Stats API full endpoint audit 2026-06-29 [skip ci]"
git push origin main
```

---

## CONFIDENCE SCORING

| Factor | Points | Check |
|--------|--------|-------|
| All probes ran (no script crash) | 20 | `endpointsProbed >= 12` |
| Schedule returned games | 10 | `schedule.ok && schedule.gameCount > 0` |
| GUMBO feed returned (game_feed_live) | 20 | `game_feed_live.ok` |
| Standings returned with magicNumber/clinched | 15 | `standings.ok && standings.hasMagicNumber` |
| Transactions endpoint accessible | 10 | `transactions.ok` |
| gamePace endpoint accessible | 10 | `gamePace.ok` |
| Stat leaders returned real data | 10 | `statLeaders_HR.ok && statLeaders_HR.leader0` |
| Probe removed from src/index.js | 5 | `grep returns 0` |

Score < 95: do not commit. Report which endpoints failed and why.

---

## WHAT SUCCESS LOOKS LIKE

```
Probed: 14 endpoints
OK: 14
Failed: 0

  ✅ schedule                  21158 bytes (13 games)
  ✅ game_feed_live           285420 bytes (weather: {condition:"Sunny", temp:"84"}) plays=312
  ✅ game_boxscore             45200 bytes
  ✅ game_linescore             2100 bytes
  ✅ game_winProbability       18300 bytes (312 items)
  ✅ game_playByPlay           92000 bytes (312 plays)
  ✅ game_content               8400 bytes (12 highlights)
  ✅ game_decisions              800 bytes
  ✅ game_contextMetrics       14200 bytes
  ✅ standings                 12800 bytes (6 divisions)
  ✅ transactions               4200 bytes (8 items)
  ✅ umpires                    1200 bytes
  ✅ gamePace                   3400 bytes
  ✅ statLeaders_HR             2100 bytes (#1: Judge 32)
  ✅ seasons                     800 bytes
```

If any endpoint returns non-200: report the status code and error. That is a real finding about what MLB Stats API actually provides vs what the docs claim.

---

**Session: 2026-06-29 · RELAY ONLY · 25 min target · Confidence gate: 95**
