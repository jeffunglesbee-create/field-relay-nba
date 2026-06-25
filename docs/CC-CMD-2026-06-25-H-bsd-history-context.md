# CC-CMD H: BSD History Context + WC League ID Discovery
**Date:** 2026-06-25 · **Repo:** field-relay-nba · **Rule 87:** Self-completing.
**Urgency:** Run after Ecuador vs Germany goes final (~22:00 UTC tonight).
**Cross-repo dep:** field-relay-nba HEAD ≥ a55ebd3 (R2 capture at game-final).

---

## WHAT THIS DOES

Two tasks in one CC-CMD:

**TASK 1 — League ID discovery + MD1-MD2 backfill**
When Ecuador vs Germany goes final, BSD live endpoint returns the WC game with
its internal `league_id`. Capture it, query `/bsd/events/season?league_id={id}`,
scan all WC 2026 events, match against `wc_results` rows, UPDATE `bsd_event_id`
for completed MD1-MD2 games.

**TASK 2 — `buildBSDHistoryContext` CONTEXT_SOURCE**
Reads R2 at `bsd/wc26/{bsd_event_id}/` for a team's previous WC match data.
Injects into journalism prompt as `[BSD HISTORY]` block with:
- Shot volume and xG quality from prior matches
- Momentum peaks and shifts
- Key incidents (goals, red cards, penalties)
Registered in CONTEXT_SOURCES for `wc26` sport, priority 7, budget 200.

---

## PROBE BLOCK

```bash
cd /home/claude/field-relay-nba && git pull

# 1. Confirm R2 capture is in writeWCResult
grep -n 'bsd/wc26' src/index.js | head -5
# Expected: R2 key prefix at ~3 locations

# 2. Confirm bsd_event_id in wc_results schema
# (Cannot query D1 from CC sandbox — verify via relay endpoint)
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/wc/results?group=D | \
  python3 -c "import json,sys; r=json.load(sys.stdin)['results']; \
    print(f'{len(r)} Group D results'); \
    [print(f'  {x[\"home\"]} vs {x[\"away\"]}: bsd_event_id={x.get(\"bsd_event_id\",\"MISSING\")}') for x in r]"
# Expected: results list with bsd_event_id field (null for old games, ID for tonight's)

# 3. Confirm FIELD_DATA R2 is bound
grep -n 'FIELD_DATA' wrangler.toml
# Expected: binding = "FIELD_DATA"

# 4. Check if any BSD data has landed in R2 from tonight's games
# (run this AFTER Ecuador vs Germany goes final)
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/bsd/r2/list?prefix=bsd/wc26/"
# Expected: list of keys if any games have completed with bsdEventId
# If 404: route doesn't exist yet — that's expected, Task 2 adds it

# 5. Find context-assembler.js CONTEXT_SOURCES for insertion point
grep -n "id: 'bracket_impact'" src/context-assembler.js | head -3
# Expected: 1 line — use as reference for CONTEXT_SOURCES entry location

# 6. Find buildESPNSummaryContext as template for new builder pattern
grep -n "function buildESPNSummaryContext" src/context-assembler.js
# Expected: 1 line — builder function to mirror
```

---

## TASK 1 — League ID discovery + MD1-MD2 backfill

Run this AFTER Ecuador vs Germany goes final (~22:00 UTC).

### Step 1a: Probe BSD live endpoint for WC league_id

```bash
# Probe BSD live events to find WC 2026 league_id
LIVE=$(curl -s https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/live)
echo $LIVE | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(f'count={d[\"count\"]}')
for e in d.get('events',[])[:5]:
    print(f'  id={e[\"id\"]} league_id={e[\"league_id\"]} {e[\"home_team\"]} vs {e[\"away_team\"]} status={e[\"status\"]}')
"
# Expected: count > 0, events with league_id for WC 2026 games
# Capture the league_id value
```

### Step 1b: Query BSD for all WC 2026 events

```bash
# Replace {LEAGUE_ID} with the league_id from Step 1a
WC_LEAGUE_ID={LEAGUE_ID}
ALL_WC=$(curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/season?league_id=${WC_LEAGUE_ID}")
echo $ALL_WC | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(f'count={d[\"count\"]}')
# Show completed games (status=finished/ft)
finished = [e for e in d.get('results',[])
            if e.get('status','').lower() in ('finished','ft','ended','completed')]
print(f'Completed: {len(finished)}')
for e in finished[:10]:
    print(f'  id={e[\"id\"]} {e[\"home_team\"]} {e[\"home_score\"]}-{e[\"away_score\"]} {e[\"away_team\"]} [{e[\"event_date\"][:10]}]')
"
```

### Step 1c: Match BSD events to wc_results and UPDATE D1

```bash
# Run this only if Step 1b shows completed WC games
ALL_WC_JSON=$(curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/season?league_id=${WC_LEAGUE_ID}&season=2026")
WC_RESULTS=$(curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/wc/results")

python3 << 'PYEOF'
import json, sys, re, urllib.request

PAT = os.environ.get('FIELD_PAT', '')  # set FIELD_PAT env var before running
CF_ACCOUNT = "b57e9af57ab46c52ca9215804e689c29"
D1_DB = "f26669de-e772-4b56-a6d1-f8fdea08a4d4"

# Load from env or paste
import os
wc_league_id = os.environ.get('WC_LEAGUE_ID', '')
if not wc_league_id:
    print("Set WC_LEAGUE_ID env var first"); sys.exit(1)

# Fetch BSD events and wc_results
bsd_r = urllib.request.urlopen(
    f"https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/season?league_id={wc_league_id}")
bsd_events = json.loads(bsd_r.read()).get('results', [])

wc_r = urllib.request.urlopen(
    "https://field-relay-nba.jeffunglesbee.workers.dev/wc/results")
wc_results = json.loads(wc_r.read()).get('results', [])

def norm(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())

finished_bsd = [e for e in bsd_events
                if e.get('status','').lower() in ('finished','ft','ended','completed')]
print(f"BSD finished WC events: {len(finished_bsd)}")
print(f"wc_results rows: {len(wc_results)}")

matches = []
for wr in wc_results:
    if wr.get('bsd_event_id'): continue  # already set
    for be in finished_bsd:
        bh = norm(be.get('home_team',''))
        ba = norm(be.get('away_team',''))
        wh = norm(wr['home']); wa = norm(wr['away'])
        if (bh and wh and bh[:5] == wh[:5] and ba[:5] == wa[:5]) or \
           (bh and wa and bh[:5] == wa[:5] and ba[:5] == wh[:5]):
            matches.append({'game_id': wr['game_id'], 'bsd_event_id': str(be['id']),
                           'home': wr['home'], 'away': wr['away']})
            break

print(f"\nMatched {len(matches)} games:")
for m in matches:
    print(f"  {m['game_id']}: {m['home']} vs {m['away']} → bsd_event_id={m['bsd_event_id']}")

if matches:
    print("\nWRITING to D1 via CF API...")
    for m in matches:
        sql = f"UPDATE wc_results SET bsd_event_id = '{m['bsd_event_id']}' WHERE game_id = '{m['game_id']}' AND bsd_event_id IS NULL"
        payload = json.dumps({"sql": sql}).encode()
        cf_req = urllib.request.Request(
            f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/d1/database/{D1_DB}/query",
            data=payload, method="POST",
            headers={"Authorization": f"Bearer {os.environ.get('CF_API_TOKEN','')}",
                     "Content-Type": "application/json"}
        )
        with urllib.request.urlopen(cf_req) as r:
            result = json.loads(r.read())
            if result.get('success'):
                print(f"  ✅ {m['game_id']} → {m['bsd_event_id']}")
            else:
                print(f"  ❌ {m['game_id']}: {result}")
PYEOF
```

**NOTE:** CC needs `CF_API_TOKEN` env var for the D1 write. If not available, print
the UPDATE statements and apply them via the admin endpoint at `/wc/result` (POST)
with `{ game_id, group_id, home, away, home_score, away_score, bsd_event_id }`.

---

## TASK 2 — `buildBSDHistoryContext` in context-assembler.js

### 2a: Add R2 list endpoint to index.js (for probe verification)

Add before `/health/sources` block in src/index.js:

```javascript
// /bsd/r2/list?prefix=bsd/wc26/ — list R2 keys for BSD captures
if (pathname === '/bsd/r2/list') {
    if (!env.FIELD_DATA)
        return new Response(JSON.stringify({ error: 'FIELD_DATA not bound' }),
            { status: 503, headers: { 'Content-Type': 'application/json', ...CORS } });
    const prefix = url.searchParams.get('prefix') || 'bsd/wc26/';
    const list = await env.FIELD_DATA.list({ prefix, limit: 100 });
    return new Response(JSON.stringify({
        keys: list.objects.map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded })),
        truncated: list.truncated,
    }), { status: 200, headers: { 'Content-Type': 'application/json',
          'Cache-Control': 'no-store', ...CORS } });
}
```

### 2b: Add `buildBSDHistoryContext` to src/context-assembler.js

Add as a new exported builder function:

```javascript
// ── buildBSDHistoryContext ────────────────────────────────────────────────
// Reads R2 BSD data for a team's previous WC matches and injects historical
// shot quality, momentum, and incidents into the journalism prompt.
// R2 keys: bsd/wc26/{bsd_event_id}/stats.json (shotmap)
//          bsd/wc26/{bsd_event_id}/momentum.json
//          bsd/wc26/{bsd_event_id}/incidents.json
// Source: wc_results.bsd_event_id for each team's prior games.
async function buildBSDHistoryContext(game, env) {
    if (!env?.FIELD_DATA || !env?.WC2026_DB) return '';
    if (game.sport !== 'wc26' && game.sport !== 'soccer') return '';

    const homeName = game.home?.name || game.home || '';
    const awayName = game.away?.name || game.away || '';
    if (!homeName || !awayName) return '';

    try {
        // Find previous WC matches for both teams that have BSD data
        const { results: prior } = await env.WC2026_DB.prepare(`
            SELECT home, away, home_score, away_score, match_date, bsd_event_id
            FROM wc_results
            WHERE bsd_event_id IS NOT NULL
              AND (home = ? OR away = ? OR home = ? OR away = ?)
            ORDER BY match_date DESC
            LIMIT 4
        `).bind(homeName, homeName, awayName, awayName).all();

        if (!prior || !prior.length) return '';

        const sections = [];

        for (const match of prior) {
            const isHome = match.home === homeName || match.home === awayName;
            const teamLabel = match.home === homeName ? homeName
                : match.away === homeName ? homeName : awayName;

            // Fetch stats (shotmap) from R2
            let shotSummary = '';
            try {
                const statsObj = await env.FIELD_DATA.get(
                    `bsd/wc26/${match.bsd_event_id}/stats.json`);
                if (statsObj) {
                    const stats = await statsObj.json();
                    const shots = stats?.statistics || stats?.shots || [];
                    if (shots.length) {
                        const totalShots = shots.length;
                        const xgTotal = shots.reduce((s, sh) => s + (sh.xg || 0), 0);
                        const onTarget = shots.filter(s => s.on_target).length;
                        shotSummary = `${totalShots} shots, ${onTarget} on target, xG ${xgTotal.toFixed(2)}`;
                    }
                }
            } catch (_) {}

            // Fetch momentum from R2
            let momentumSummary = '';
            try {
                const momObj = await env.FIELD_DATA.get(
                    `bsd/wc26/${match.bsd_event_id}/momentum.json`);
                if (momObj) {
                    const mom = await momObj.json();
                    const entries = mom?.momentum || mom?.data || [];
                    if (entries.length) {
                        const peak = entries.reduce(
                            (best, e) => Math.abs(e.value || 0) > Math.abs(best.value || 0) ? e : best,
                            entries[0]);
                        momentumSummary = `peak pressure ${peak.value > 0 ? '+' : ''}${peak.value} at ${peak.minute || '?'}'`;
                    }
                }
            } catch (_) {}

            const scoreline = `${match.home_score}-${match.away_score}`;
            const opponent = match.home === teamLabel ? match.away : match.home;
            const parts = [`vs ${opponent} (${scoreline})`];
            if (shotSummary) parts.push(shotSummary);
            if (momentumSummary) parts.push(momentumSummary);
            sections.push(`  ${match.match_date}: ${parts.join(' | ')}`);
        }

        if (!sections.length) return '';

        return `[BSD HISTORY]\n` +
            `Prior WC match data (shot quality + momentum):\n` +
            sections.join('\n') + '\n';

    } catch (_) { return ''; }
}
```

### 2c: Register in CONTEXT_SOURCES

Find the CONTEXT_SOURCES array and add:

```javascript
{ id: 'bsd_history', priority: 7, budget: 200, builder: buildBSDHistoryContext,
  sports: ['wc26'],
  description: 'BSD historical shot quality + momentum for prior WC matches' },
```

### 2d: Export

Add `buildBSDHistoryContext` to the module.exports block.

---

## DONE CONDITIONS

```bash
# 1. R2 list endpoint responds
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/bsd/r2/list?prefix=bsd/wc26/
# Expected: {"keys":[...],"truncated":false}
# Keys will be empty until a WC game completes with bsdEventId tonight

# 2. buildBSDHistoryContext in context-assembler.js
grep -c 'buildBSDHistoryContext' src/context-assembler.js
# Expected: 3 (def + CONTEXT_SOURCES entry + export)

# 3. bsd_history in CONTEXT_SOURCES
grep -n "id: 'bsd_history'" src/context-assembler.js
# Expected: 1 line

# 4. wc_results has bsd_event_id after tonight (check after game-final)
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/wc/results?group=C | \
  python3 -c "import json,sys; r=json.load(sys.stdin)['results']; \
    [print(f'{x[\"home\"]} vs {x[\"away\"]}: {x.get(\"bsd_event_id\",\"null\")}') for x in r]"
# Expected: tonight's games show a BSD event ID after going final

# 5. Smoke passes
node smoke.js 2>&1 | tail -3
# Expected: N passed, 0 failed
```

---

## COMMIT

Two-repo commit:
```bash
# field-relay-nba
git add src/index.js src/context-assembler.js
git commit -m "feat(bsd): buildBSDHistoryContext + R2 list endpoint + WC league ID backfill"
git push origin main
```
