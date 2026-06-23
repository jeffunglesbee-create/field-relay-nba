# CC-CMD: Soccer FBref Fetch Relay Endpoint
**Date:** 2026-06-23  
**Repo:** field-relay-nba (relay Worker)  
**Client repo:** jubilant-bassoon (workflow update only)  
**Relay HEAD at spec time:** 5b7d261  
**Client HEAD at spec time:** c424138  

## Problem

`soccer-fbref-wc.yml` and all FBref workflows return HTTP 403 Forbidden from
GitHub Actions runner IPs. FBref has blocked GH Actions. Every run since
June 10 has silently uploaded `teams: {}` to R2 — the health sentinel shows
"ok" (file exists) but `assembleContext` returns empty for all soccer sports
(WC, EPL, MLS, etc.) because there are no teams to look up.

Confirmed from job logs (run 27957196348):
```
❌ Shooting: HTTP Error 403: Forbidden
❌ Misc: HTTP Error 403: Forbidden  
❌ Passing: HTTP Error 403: Forbidden
❌ GK: HTTP Error 403: Forbidden
0 squads with data
✅ R2 upload OK → soccer/fbref/wc2026.json   ← empty teams: {}
```

Same for epl.json, laliga.json, seriea.json, bundesliga.json, ligue1.json.

## Fix

Add `POST /soccer/fbref/fetch` to the relay Worker. CF edge IPs are not
blocked by FBref. The Worker fetches FBref HTML server-side, parses squad
stats, and writes to R2. Replace GitHub Actions scraping with a relay cron
trigger using the same `X-FIELD-Relay: field-relay-cron-2026` auth pattern
as `/fixtures/fetch`.

---

## Task 1: Add `POST /soccer/fbref/fetch` to `src/index.js`

### Auth and binding requirements
- Auth: `X-FIELD-Relay: field-relay-cron-2026` header (same as `/fixtures/fetch`)
- Bindings needed: `env.FIELD_DATA` (R2 bucket for writing)
- No new bindings required — `FIELD_DATA` is already bound

### Request body
```json
{
  "leagues": ["wc2026", "epl", "mls", "laliga", "seriea", "bundesliga", "ligue1"]
}
```
- `leagues`: array of league keys to fetch. Optional — defaults to all leagues.
- Each key maps to an FBref competition config (see config table below).

### League config table (hardcoded in the route)
```js
const FBREF_LEAGUES = {
  wc2026:     { compId: '1',  season: '2026',      slug: 'World-Cup',            r2Key: 'soccer/fbref/wc2026.json',     competition: 'FIFA World Cup 2026' },
  epl:        { compId: '9',  season: '2025-2026',  slug: 'Premier-League',        r2Key: 'soccer/fbref/epl.json',        competition: 'Premier League 2025-26' },
  mls:        { compId: '22', season: '2025',       slug: 'Major-League-Soccer',   r2Key: 'soccer/fbref/mls.json',        competition: 'MLS 2025' },
  laliga:     { compId: '12', season: '2025-2026',  slug: 'La-Liga',               r2Key: 'soccer/fbref/laliga.json',     competition: 'La Liga 2025-26' },
  seriea:     { compId: '11', season: '2025-2026',  slug: 'Serie-A',               r2Key: 'soccer/fbref/seriea.json',     competition: 'Serie A 2025-26' },
  bundesliga: { compId: '20', season: '2025-2026',  slug: 'Fussball-Bundesliga',   r2Key: 'soccer/fbref/bundesliga.json', competition: 'Bundesliga 2025-26' },
  ligue1:     { compId: '13', season: '2025-2026',  slug: 'Ligue-1',               r2Key: 'soccer/fbref/ligue1.json',     competition: 'Ligue 1 2025-26' },
};
```

URL construction — same formula for all leagues:
`https://fbref.com/en/comps/{compId}/{season}/{tableType}/{season}-{slug}-Stats`

Table types to fetch: `shooting`, `misc`, `passing`, `keepers`

### HTML parsing

FBref tables are identified by `id` attribute. Parse from raw HTML string
using regex — no DOM parser available in Workers.

**Parse pattern:**
1. Find `<table[^>]+id="{tableId}"[^>]*>(.*?)</table>` (DOTALL)
2. From `<thead>`, find the last `<tr>` NOT containing `over_header`,
   extract `data-stat="([^"]+)"` values as column names
3. From `<tbody>`, for each `<tr>` (skip rows with `class="spacer"` or `thead`):
   - Extract `<t[hd][^>]*>(.*?)</t[hd]>` cell text, strip HTML tags
   - Zip with column names
   - `squad` column is the team name — skip if empty or `=== 'Squad'`

**Stats to extract:**

Shooting for (`stats_squads_shooting_for`):
- `xGFor` ← column `xg` (parseFloat, 3dp)
- `goalsFor` ← column `goals_gk` ?? `gf` (parseInt)
- `shots` ← column `shots` (parseInt)
- `shotsOnTarget` ← column `shots_on_target` (parseInt)

Shooting against (`stats_squads_shooting_against`):
- `xGAgainst` ← column `xg` (parseFloat, 3dp)
- `goalsAgainst` ← column `goals_gk` ?? `ga` (parseInt)

Misc for (`stats_squads_misc_for`):
- `pressures` ← column `pressures` (parseInt)
- `pressureSuccess` ← column `pressure_regains` ?? `pressures_succ` (parseFloat, 3dp)
- `setpieceGoals` ← column `corner_kick_goals` ?? `goal_kick_goals` (parseInt)

Passing for (`stats_squads_passing_for`):
- `progressivePasses` ← column `progressive_passes` ?? `prog` (parseInt)
- `passCompletion` ← column `passes_pct` ?? `cmp_pct` (parseFloat, 3dp)
- `keyPasses` ← column `assisted_shots` ?? `kp` (parseInt)

Keepers for (`stats_squads_keeper_for`):
- `psxgDiff` ← column `psxg_net` ?? `psxg_plus_minus` (parseFloat, 3dp)
- `svPct` ← column `save_pct` ?? `sv_pct` (parseFloat, 3dp)
- `cleanSheets` ← column `clean_sheets` ?? `cs` (parseInt)

After all tables, derive:
```js
if (team.xGFor != null && team.goalsFor != null) {
  team.xGDivergence = Math.round((team.goalsFor - team.xGFor) * 1000) / 1000;
}
```

### Fetch headers (required to avoid FBref blocking)
```js
const FBREF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://fbref.com/',
};
```

### R2 output format
```json
{
  "updated": "2026-06-23T01:00:00.000Z",
  "competition": "FIFA World Cup 2026",
  "season": "2026",
  "source": "FBref squad stats via CF Worker relay",
  "teams": {
    "Argentina": { "xGFor": 3.2, "xGAgainst": 0.8, "xGDivergence": 0.1 }
  }
}
```

Write to R2:
```js
await env.FIELD_DATA.put(
  league.r2Key,
  JSON.stringify(output),
  { httpMetadata: { contentType: 'application/json' } }
);
```

**Rule 77 — NO-RATIONALIZE-A:** If squads === 0 for a league, do NOT write
to R2. Skip the put and report `ok: false` for that league. Empty data is
worse than stale data.

### Response format
```json
{
  "ok": true,
  "results": [
    { "league": "wc2026", "squads": 32, "ok": true },
    { "league": "epl", "squads": 0, "ok": false, "error": "403 Forbidden" }
  ]
}
```

### Placement in index.js
Place immediately AFTER the `/fixtures/fetch` route block (~line 7820).
Same auth boilerplate:
```js
if (pathname === '/soccer/fbref/fetch' && request.method === 'POST') {
    const authHeader = request.headers.get('X-FIELD-Relay');
    if (authHeader !== 'field-relay-cron-2026')
        return new Response('unauthorized', { status: 401, headers: CORS });
    if (!env.FIELD_DATA)
        return new Response(JSON.stringify({ ok: false, error: 'FIELD_DATA R2 not bound' }),
            { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
    // ... implementation
}
```

Also add `'/soccer/fbref/fetch'` to the probe_relay_route allowlist
(search for where `/health` or `/fixtures/fetch` appear in any allowlist array).

---

## Task 2: Update `soccer-fbref-wc.yml` in jubilant-bassoon

Replace the Python script step with a relay curl call. No repo checkout
needed — relay writes directly to R2.

```yaml
name: Soccer FBref Stats Update

on:
  schedule:
    - cron: '0 8 */3 * *'
  workflow_dispatch:

# No permissions block needed — no git writes

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger relay FBref fetch
        run: |
          RESULT=$(curl -s -f -X POST \
            -H "X-FIELD-Relay: field-relay-cron-2026" \
            -H "Content-Type: application/json" \
            -d '{"leagues":["wc2026","epl","mls","laliga","seriea","bundesliga","ligue1"]}' \
            https://field-relay-nba.jeffunglesbee.workers.dev/soccer/fbref/fetch)
          echo "$RESULT"
          echo "$RESULT" | python3 -c "
import json,sys
d=json.load(sys.stdin)
failed=[r for r in d.get('results',[]) if not r.get('ok')]
if failed:
    print('FAILED leagues:', [r['league'] for r in failed])
    exit(1)
print('All leagues OK')
"
```

---

## Task 3: Update `soccer-fbref-mls.yml` in jubilant-bassoon

Same fix as Task 2 but MLS-only:

```yaml
name: Soccer FBref MLS Stats Update

on:
  schedule:
    - cron: '0 8 * * 1'   # Weekly Monday
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger relay FBref fetch (MLS)
        run: |
          curl -s -f -X POST \
            -H "X-FIELD-Relay: field-relay-cron-2026" \
            -H "Content-Type: application/json" \
            -d '{"leagues":["mls"]}' \
            https://field-relay-nba.jeffunglesbee.workers.dev/soccer/fbref/fetch
```

---

## Verification commands

```bash
# 1. Test the endpoint (run after relay deploys)
curl -s -X POST \
  -H "X-FIELD-Relay: field-relay-cron-2026" \
  -H "Content-Type: application/json" \
  -d '{"leagues":["wc2026"]}' \
  https://field-relay-nba.jeffunglesbee.workers.dev/soccer/fbref/fetch
# Expected: {"ok":true,"results":[{"league":"wc2026","squads":32,"ok":true}]}

# 2. Confirm context assembler now returns WC data
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/journalism/context-probe
# WC games should now show contextLength > 0 (was 0 before fix)

# 3. Confirm health sentinel shows non-empty
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/health/sources
# soccer_fbref_wc should show entries > 0
```

---

## Constraints

- DO NOT ASSUME FBref table IDs are stable. If squads === 0, log the first
  2000 chars of the raw HTML response to help diagnose table ID changes.
- DO NOT add sleep/delay between requests — Workers have no `setTimeout` for
  delays. Accept rate limiting as a workflow-level concern.
- Rule 5: per-league failures must never crash the whole request.
- Rule 77: if squads === 0, skip the R2 write for that league.
- Rule 79: resolve against current relay HEAD 5b7d261.
- The `competition` field in R2 output must match the value in FBREF_LEAGUES
  config — downstream `buildSoccerFBrefContext` doesn't use it but it aids
  debugging.

---

## Session end
Write findings to `outbox/cc-soccer-fbref-fetch-2026-06-23.md`.
