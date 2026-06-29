# CC-CMD — MLB Stats API Complete Probe (15/15)

**Date:** 2026-06-29
**Repo:** jeffunglesbee-create/field-relay-nba (RELAY ONLY)
**Scope:** Re-probe the 3 endpoints that returned 404 using a completed gamePk
**Why:** Prior probe used pre-game gamePk 824822 (Scheduled). winProbability,
         decisions, and contextMetrics require a live or final game. Use
         yesterday's completed game to get real data from all 15 endpoints.
**Target time:** 15 min

---

## DONE CONDITION

File `outbox/mlb-complete-probe-2026-06-29.json` committed containing:
- 15/15 endpoints returning HTTP 200
- Real data from winProbability, decisions, and contextMetrics
- The completed gamePk used and its final score
- Confidence ≥ 95

---

## STEP 1: Add probe endpoint

```javascript
// TEMPORARY PROBE — MLB 15/15 complete (2026-06-29)
// Uses yesterday's completed game for the 3 endpoints that need final state.
if (pathname === '/mlb/complete-probe' && request.method === 'GET') {
  const BASE = 'https://statsapi.mlb.com/api/v1';
  const HEADERS = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };
  const results = {};

  async function probe(label, url) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.status !== 200) {
        results[label] = { status: r.status, ok: false };
        return null;
      }
      const data = await r.json();
      results[label] = {
        status: 200,
        ok: true,
        responseBytes: JSON.stringify(data).length,
      };
      return data;
    } catch (e) {
      results[label] = { ok: false, error: e.message };
      return null;
    }
  }

  // Step A: Find a completed gamePk from yesterday
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const schedData = await probe('schedule_yesterday',
    `${BASE}/schedule?sportId=1&date=${yesterday}&hydrate=linescore,team`);

  let completedPk = null;
  let completedGame = null;
  const games = schedData?.dates?.[0]?.games ?? [];
  for (const g of games) {
    if (g.status?.abstractGameState === 'Final') {
      completedPk = g.gamePk;
      completedGame = {
        gamePk: g.gamePk,
        date: yesterday,
        away: g.teams?.away?.team?.abbreviation || g.teams?.away?.team?.name,
        home: g.teams?.home?.team?.abbreviation || g.teams?.home?.team?.name,
        awayScore: g.teams?.away?.score,
        homeScore: g.teams?.home?.score,
        status: g.status?.detailedState,
      };
      break;
    }
  }

  results.completedGame = completedGame || { error: 'No Final game found yesterday' };

  if (!completedPk) {
    // Try 2 days ago
    const twoDaysAgo = new Date(Date.now() - 172800000).toISOString().split('T')[0];
    const sched2 = await probe('schedule_2daysago',
      `${BASE}/schedule?sportId=1&date=${twoDaysAgo}&hydrate=linescore,team`);
    const games2 = sched2?.dates?.[0]?.games ?? [];
    for (const g of games2) {
      if (g.status?.abstractGameState === 'Final') {
        completedPk = g.gamePk;
        completedGame = {
          gamePk: g.gamePk,
          date: twoDaysAgo,
          away: g.teams?.away?.team?.abbreviation || g.teams?.away?.team?.name,
          home: g.teams?.home?.team?.abbreviation || g.teams?.home?.team?.name,
          awayScore: g.teams?.away?.score,
          homeScore: g.teams?.home?.score,
          status: g.status?.detailedState,
        };
        results.completedGame = completedGame;
        break;
      }
    }
  }

  if (completedPk) {
    // ── The 3 previously-failed endpoints ──────────────────────

    const wpData = await probe('game_winProbability',
      `${BASE}/game/${completedPk}/winProbability`);
    if (wpData) {
      results.game_winProbability.count = Array.isArray(wpData) ? wpData.length : 0;
      results.game_winProbability.sample_keys = Array.isArray(wpData) && wpData[0]
        ? Object.keys(wpData[0]) : [];
    }

    const decData = await probe('game_decisions',
      `${BASE}/game/${completedPk}/decisions`);
    if (decData) {
      results.game_decisions.keys = Object.keys(decData);
      results.game_decisions.winner = decData.winner?.fullName || null;
      results.game_decisions.loser = decData.loser?.fullName || null;
      results.game_decisions.save = decData.save?.fullName || null;
    }

    const cmData = await probe('game_contextMetrics',
      `${BASE}/game/${completedPk}/contextMetrics`);
    if (cmData) {
      results.game_contextMetrics.game_keys = Object.keys(cmData.game || cmData);
      if (Array.isArray(cmData)) {
        results.game_contextMetrics.count = cmData.length;
        results.game_contextMetrics.item0_keys = cmData[0] ? Object.keys(cmData[0]) : [];
      }
    }

    // ── Also grab GUMBO for the completed game (weather, duration) ──

    const gumbo = await probe('game_feed_live_final',
      `${BASE.replace('v1','v1.1')}/game/${completedPk}/feed/live`);
    if (gumbo) {
      results.game_feed_live_final.weather = gumbo?.gameData?.weather || null;
      results.game_feed_live_final.gameDurationMinutes =
        gumbo?.gameData?.gameInfo?.gameDurationMinutes || null;
      results.game_feed_live_final.attendance =
        gumbo?.gameData?.gameInfo?.attendance || null;
      results.game_feed_live_final.flags = gumbo?.gameData?.flags || null;
      results.game_feed_live_final.allPlays_count =
        (gumbo?.liveData?.plays?.allPlays || []).length;
      results.game_feed_live_final.scoringPlays_count =
        (gumbo?.liveData?.plays?.scoringPlays || []).length;
    }
  }

  // ── Summary ──────────────────────────────────────────────────

  const allOk = Object.values(results).filter(r => r && typeof r === 'object' && 'ok' in r);
  const summary = {
    probeDate: new Date().toISOString(),
    completedGameUsed: completedGame,
    endpointsProbed: allOk.length,
    endpointsOk: allOk.filter(r => r.ok).length,
    endpointsFailed: allOk.filter(r => !r.ok).length,
    results,
  };

  return new Response(JSON.stringify(summary, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
// END TEMPORARY PROBE — MLB 15/15
```

---

## STEP 2: Deploy, call, capture

```bash
node --check src/index.js
git add src/index.js
git commit -m "temp: /mlb/complete-probe — 15/15 using completed gamePk"
git push origin main
sleep 50

curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/mlb/complete-probe" \
  | python3 -m json.tool | tee /tmp/mlb-complete-probe.json

python3 << 'PY'
import json
with open("/tmp/mlb-complete-probe.json") as f:
    d = json.load(f)
cg = d.get("completedGame", {})
print(f"Completed game: {cg.get('away','?')} {cg.get('awayScore','?')} @ {cg.get('home','?')} {cg.get('homeScore','?')} ({cg.get('date','?')})")
print(f"Probed: {d.get('endpointsProbed','?')} | OK: {d.get('endpointsOk','?')} | Failed: {d.get('endpointsFailed','?')}")
print()
for label, r in d.get("results", {}).items():
    if isinstance(r, dict) and "ok" in r:
        ok = "✅" if r["ok"] else "❌"
        print(f"  {ok} {r.get('status','?'):>3}  {label}")
        for k in ["count","keys","winner","loser","save","weather",
                   "gameDurationMinutes","attendance","flags",
                   "allPlays_count","scoringPlays_count","sample_keys",
                   "game_keys","item0_keys"]:
            if k in r and r[k] is not None:
                print(f"         {k}: {r[k]}")
PY
```

---

## STEP 3: Remove probe + save to outbox

```bash
grep -n "TEMPORARY PROBE\|END TEMPORARY PROBE" src/index.js
# Remove those lines
node --check src/index.js
git add src/index.js
git commit -m "temp(remove): /mlb/complete-probe removed — 15/15 verified"
git push origin main

mkdir -p outbox
cp /tmp/mlb-complete-probe.json outbox/mlb-complete-probe-2026-06-29.json
git add outbox/mlb-complete-probe-2026-06-29.json
git commit -m "docs(outbox): MLB Stats API 15/15 endpoint probe [skip ci]"
git push origin main
```

---

## CONFIDENCE SCORING

| Factor | Points | Check |
|--------|--------|-------|
| Found a completed gamePk | 20 | `completedGame.status == "Final"` |
| game_winProbability returned 200 | 20 | `ok && count > 0` |
| game_decisions returned 200 with W/L | 20 | `ok && winner != null` |
| game_contextMetrics returned 200 | 15 | `ok` |
| GUMBO final has weather + duration | 15 | `weather != {} && gameDurationMinutes != null` |
| Probe removed | 10 | `grep returns 0` |

Score < 95: do not commit. Report which endpoint failed and why.

---

**Session: 2026-06-29 · RELAY ONLY · 15 min target · Confidence gate: 95**
